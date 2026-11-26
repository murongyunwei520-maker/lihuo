// 把豆包 / Dola bridge 的 job 流程适配成统一生图/视频返回格式。
// 选中 builtin-doubao / builtin-dola 模型时，由 image.ts / video.ts 在入口路由到这里。
import {
    cancelJob,
    createVideoJob,
    listAccounts,
    waitJob,
    jobFileUrl,
} from "./doubao-bridge";
import { modelOptionName } from "@/stores/use-config-store";
import { builtinProviderName, builtinProviderOf, type BuiltinProvider } from "@/constants/doubao-builtin";
import { buildDoubaoImageRequestedParams, buildDoubaoTextRequestedParams, doubaoImageMode, type DoubaoImageMode } from "./doubao-request-params";

// 账号优先级：显式传入 > 配置里选的账号 > 号池的「当前账号」。
// 传入 provider（由模型决定站点）时只在同站点账号里找：豆包模型不能配 Dola 账号，反之亦然。
// 都不存在时才报错——绝不静默随机分配。
export async function resolveDoubaoAccountId(preferredAccountId?: string, provider: BuiltinProvider | null = null): Promise<string> {
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
        // 当前账号属于另一个站点时不能静默换号：账号决定额度与登录态，必须让用户自己确认。
        const mismatch = all.find((item) => item.id === requested);
        if (mismatch) {
            throw new Error(`「${mismatch.name}」是${mismatch.providerName || builtinProviderName((mismatch.provider ?? "doubao") as BuiltinProvider)}账号，不能用于${siteName}模型；请在参数里改选${siteName}账号（不会自动换号）`);
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

/**
 * 等待桥接任务，并在前端取消时同步取消桥接任务。
 * 只停止轮询不取消后台任务，会让旧任务继续跑：用户重新生成后，旧产物晚到还会覆盖同一张卡片。
 */
async function waitJobWithCancel(id: string, signal: AbortSignal | undefined, intervalMs = 3000, timeoutMs = 20 * 60 * 1000) {
    const cancel = () => {
        void cancelJob(id).catch(() => undefined);
    };
    if (signal?.aborted) {
        cancel();
        throw new DOMException("Aborted", "AbortError");
    }
    signal?.addEventListener("abort", cancel, { once: true });
    try {
        return await waitJob(id, undefined, intervalMs, timeoutMs, signal);
    } finally {
        signal?.removeEventListener("abort", cancel);
    }
}

export async function generateImageViaDoubao(opts: {
    modelValue: string;
    prompt: string;
    references?: { name?: string; dataUrl: string }[];
    signal?: AbortSignal;
    accountId?: string;
    nodeId?: string;
    params?: {
        ratio?: string;
        size?: string;
        resolution?: string;
        count?: number;
        mode?: DoubaoImageMode;
    };
}): Promise<{ id: string; dataUrl: string }[]> {
    const provider = builtinProviderOf(opts.modelValue);
    const accountId = await resolveDoubaoAccountId(opts.accountId, provider);
    const modelName = modelOptionName(opts.modelValue);
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // 连线/上传的参考图必须真实上传给豆包，和提示词一起提交（图生图 / 参考图）
    // 并发上传：串行传多张会明显拖慢「传到豆包」的耗时；任何一张失败都明确报错，不能静默退化成文生图。
    const { uploadAttachment } = await import("./doubao-bridge");
    const attachments = await Promise.all(
        (opts.references || []).map(async (reference, index) => {
            const blob = await (await fetch(reference.dataUrl, { signal: opts.signal })).blob();
            const path = await uploadAttachment(accountId, blob, reference.name || `ref-${index}.png`);
            if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            return path;
        }),
    );
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const mode = opts.params?.mode ?? doubaoImageMode(attachments.length > 0);
    const requestedParams = buildDoubaoImageRequestedParams({
        model: modelName,
        mode,
        ratio: opts.params?.ratio,
        size: opts.params?.size,
        resolution: opts.params?.resolution,
        count: opts.params?.count,
        attachmentCount: attachments.length,
    });
    const job = await createVideoJob({
        accountId,
        provider: provider || undefined,
        accountSelectionMode: "manual",
        prompt: opts.prompt,
        capability: "图像生成",
        expectedArtifactKind: "image",
        mode,
        modelName,
        requestedParams,
        attachments,
        nodeId: opts.nodeId,
    });
    const done = await waitJobWithCancel(job.id, opts.signal, 3000, 20 * 60 * 1000);
    const siteLabel = builtinProviderName(provider);
    if (done.status !== "succeeded") {
        throw new Error(done.error?.message || siteLabel + "生图失败");
    }
    // 任务必须属于发起它的画布节点；万一桥接串了任务，宁可报错也不把别的卡片结果贴过来。
    if (opts.nodeId && done.nodeId && done.nodeId !== opts.nodeId) {
        throw new Error(`${siteLabel}任务归属校验失败（任务节点 ${done.nodeId} ≠ 当前节点 ${opts.nodeId}）`);
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
    const accountId = await resolveDoubaoAccountId(opts.accountId, provider);
    const siteLabel = builtinProviderName(provider);
    const { uploadAttachment } = await import("./doubao-bridge");
    // 画布上连到文本节点的图片：豆包对话支持图片输入，按附件传上去；失败要明确报错，不能悄悄退回纯文本。
    const attachments: string[] = [];
    for (const [index, dataUrl] of (opts.images || []).entries()) {
        const blob = await (await fetch(dataUrl, { signal: opts.signal })).blob();
        attachments.push(await uploadAttachment(accountId, blob, `ref-${index}.png`));
        if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const textMode = attachments.length ? "image-to-text" : "text-to-text";
    const textModelName = opts.modelValue ? modelOptionName(opts.modelValue) : "";
    const requestedParams = buildDoubaoTextRequestedParams({ model: textModelName, mode: textMode, attachmentCount: attachments.length });
    const job = await createVideoJob({
        accountId,
        provider: provider || undefined,
        accountSelectionMode: "manual",
        prompt: opts.prompt,
        capability: "对话",
        expectedArtifactKind: "text",
        mode: textMode,
        modelName: textModelName || undefined,
        requestedParams,
        attachments,
        nodeId: opts.nodeId,
    });
    // 与 bridge 的 8 分钟对话等待对齐，再留出启动与发送的时间。
    const done = await waitJobWithCancel(job.id, opts.signal, 2000, 10 * 60 * 1000);
    if (done.status !== "succeeded") {
        // 把 bridge 的最后一条进度带出来，方便判断是卡在登录、发送还是读取回答。
        const detail = done.progress ? `（${done.progress}）` : "";
        throw new Error((done.error?.message || siteLabel + "对话失败") + detail);
    }
    const text = (done.text || "").trim();
    if (!text) throw new Error(siteLabel + "没有返回回答内容");
    return text;
}

