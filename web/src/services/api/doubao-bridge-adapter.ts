// 把豆包 / Dola bridge 的 job 流程适配成统一生图/视频返回格式。
// 选中 builtin-doubao / builtin-dola 模型时，由 image.ts / video.ts 在入口路由到这里。
import {
    createVideoJob,
    listAccounts,
    waitJob,
    jobFileUrl,
} from "./doubao-bridge";
import { modelOptionName } from "@/stores/use-config-store";
import { builtinProviderName, builtinProviderOf, type BuiltinProvider } from "@/constants/doubao-builtin";

// 账号优先级：显式传入 > 配置里选的账号 > 号池的「当前账号」。
// 传入 provider（由模型决定站点）时只在同站点账号里找：豆包模型不能配 Dola 账号，反之亦然。
// 都不存在时才报错——绝不静默随机分配。
async function resolveAccountId(preferredAccountId?: string, provider: BuiltinProvider | null = null): Promise<string> {
    const { useDoubaoAccountStore } = await import("@/stores/use-doubao-account-store");
    const { useConfigStore } = await import("@/stores/use-config-store");
    const siteName = builtinProviderName(provider);
    const configured = (useConfigStore.getState().config.doubaoAccountId || "").trim();
    const requested = (preferredAccountId || configured || useDoubaoAccountStore.getState().currentAccountId || "").trim();
    const all = await listAccounts();
    const accounts = provider ? all.filter((account) => (account.provider ?? "doubao") === provider) : all;
    if (!accounts.length) {
        throw new Error(`号池里还没有${siteName}账号：请先在账号池添加并扫码登录`);
    }
    if (!requested) {
        const loggedIn = accounts.filter((account) => account.state.loggedIn);
        if (loggedIn.length === 1) return loggedIn[0].id;
        throw new Error(`请先选择${siteName}账号：在号池点一个账号设为当前，或在参数里选择账号`);
    }
    const account = accounts.find((item) => item.id === requested);
    if (!account) {
        // 号池里只有一个「当前账号」，它可能属于另一个站点（豆包 ↔ Dola）：
        // 这时按号池顺序退到同站点第一个已登录账号，而不是拿错站点的号去提交。
        const fallback = accounts.find((item) => item.state.loggedIn);
        if (fallback) return fallback.id;
        const mismatch = all.find((item) => item.id === requested);
        if (mismatch) {
            throw new Error(`「${mismatch.name}」是${mismatch.providerName || builtinProviderName((mismatch.provider ?? "doubao") as BuiltinProvider)}账号，不能用于${siteName}模型`);
        }
        throw new Error(`账号不存在: ${requested}`);
    }
    if (!account.state.loggedIn) throw new Error(`账号 ${account.name} 未登录，请先在号池扫码登录`);
    return requested;
}

async function fileToDataUrl(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载产物失败（${res.status}）`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取产物失败"));
        reader.readAsDataURL(blob);
    });
}

export async function generateImageViaDoubao(opts: {
    modelValue: string;
    prompt: string;
    references?: { name?: string; dataUrl: string }[];
    signal?: AbortSignal;
    accountId?: string;
    nodeId?: string;
    params?: { ratio?: string; quality?: string; count?: number };
}): Promise<{ id: string; dataUrl: string }[]> {
    const provider = builtinProviderOf(opts.modelValue);
    const accountId = await resolveAccountId(opts.accountId, provider);
    const modelName = modelOptionName(opts.modelValue);
    // 连线/上传的参考图必须真实上传给豆包，和提示词一起提交（图生图 / 参考图）
    // 并发上传：串行传多张会明显拖慢「传到豆包」的耗时
    const { uploadAttachment } = await import("./doubao-bridge");
    const attachments = (
        await Promise.all(
            (opts.references || []).slice(0, 6).map(async (reference, index) => {
                try {
                    const blob = await (await fetch(reference.dataUrl)).blob();
                    return await uploadAttachment(accountId, blob, reference.name || `ref-${index}.png`);
                } catch {
                    return ""; // 读不到字节的跳过
                }
            }),
        )
    ).filter(Boolean);
    const job = await createVideoJob({
        accountId,
        // 模型决定站点：桥接按 provider 只调度同站点的账号
        provider: provider || undefined,
        prompt: opts.prompt,
        capability: "图像生成",
        expectedArtifactKind: "image",
        mode: attachments.length ? "image-to-image" : "text-to-image",
        modelName,
        requestedParams: {
            model: modelName,
            ...(opts.params?.ratio ? { ratio: opts.params.ratio } : {}),
            ...(opts.params?.quality ? { quality: opts.params.quality } : {}),
            ...(opts.params?.count ? { count: opts.params.count } : {}),
        },
        attachments,
        nodeId: opts.nodeId,
    });
    const done = await waitJob(job.id, undefined, 3000, 20 * 60 * 1000);
    const siteLabel = builtinProviderName(provider);
    if (done.status !== "succeeded") {
        throw new Error(done.error?.message || siteLabel + "生图失败");
    }
    const images = done.files.filter((f) => f.kind === "image" || (f.contentType || "").startsWith("image/"));
    if (!images.length) throw new Error(siteLabel + "未返回图片");
    const results = await Promise.all(
        images.map(async (f, i) => {
            // 用任务里的真实下标取文件：过滤掉非图片后数组下标会和桥接的文件下标错位
            const url = f.path.startsWith("http") ? f.path : jobFileUrl(done.id, f.index);
            return { id: `${done.id}-${i}`, dataUrl: await fileToDataUrl(url) };
        }),
    );
    return results;
}

/**
 * 豆包「对话」能力：把提示词发到网页端，等回答稳定后取回正文。
 * 网页端没有具名文本模型（只有默认豆包 + 快速/思考开关），所以这里是单轮问答，不做模型选择。
 */
export async function askDoubao(opts: {
    prompt: string;
    images?: string[];
    signal?: AbortSignal;
    accountId?: string;
    nodeId?: string;
    /** 选中的内置模型：决定走豆包还是 Dola 站点 */
    modelValue?: string;
}): Promise<string> {
    const provider = builtinProviderOf(opts.modelValue);
    const accountId = await resolveAccountId(opts.accountId, provider);
    const siteLabel = builtinProviderName(provider);
    const { uploadAttachment } = await import("./doubao-bridge");
    // 画布上连到文本节点的图片：豆包对话支持图片输入，按附件传上去
    const attachments: string[] = [];
    for (const [index, dataUrl] of (opts.images || []).slice(0, 4).entries()) {
        try {
            const blob = await (await fetch(dataUrl)).blob();
            attachments.push(await uploadAttachment(accountId, blob, `ref-${index}.png`));
        } catch {
            /* 读不到字节的跳过 */
        }
    }
    const job = await createVideoJob({
        accountId,
        provider: provider || undefined,
        prompt: opts.prompt,
        capability: "对话",
        expectedArtifactKind: "text",
        mode: attachments.length ? "image-to-text" : "text-to-text",
        attachments,
        nodeId: opts.nodeId,
    });
    // 与 bridge 的 8 分钟对话等待对齐，再留出启动与发送的时间。
    const done = await waitJob(job.id, undefined, 2000, 10 * 60 * 1000, opts.signal);
    if (done.status !== "succeeded") {
        // 把 bridge 的最后一条进度带出来，方便判断是卡在登录、发送还是读取回答。
        const detail = done.progress ? `（${done.progress}）` : "";
        throw new Error((done.error?.message || siteLabel + "对话失败") + detail);
    }
    const text = (done.text || "").trim();
    if (!text) throw new Error(siteLabel + "没有返回回答内容");
    return text;
}

