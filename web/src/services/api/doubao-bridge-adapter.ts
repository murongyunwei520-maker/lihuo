// 把豆包 bridge 的 job 流程适配成统一生图/视频返回格式。
// 选中 builtin-doubao 模型时，由 image.ts / video.ts 在入口路由到这里。
import {
    createVideoJob,
    listAccounts,
    waitJob,
    jobFileUrl,
    DOUBAO_BRIDGE_URL,
} from "./doubao-bridge";
import { modelOptionName } from "@/stores/use-config-store";

// 账号优先级：显式传入 > 配置里选的账号 > 左侧号池的「当前账号」。
// 都不存在时才报错——绝不静默随机分配。
async function resolveAccountId(preferredAccountId?: string): Promise<string> {
    const { useDoubaoAccountStore } = await import("@/stores/use-doubao-account-store");
    const { useConfigStore } = await import("@/stores/use-config-store");
    const configured = (useConfigStore.getState().config.doubaoAccountId || "").trim();
    const requested = (preferredAccountId || configured || useDoubaoAccountStore.getState().currentAccountId || "").trim();
    const accounts = await listAccounts();
    if (!requested) {
        const loggedIn = accounts.filter((account) => account.state.loggedIn);
        if (loggedIn.length === 1) return loggedIn[0].id;
        throw new Error("请先选择豆包账号：在左侧号池点一个账号设为当前，或在参数里选择账号");
    }
    const account = accounts.find((item) => item.id === requested);
    if (!account) throw new Error(`账号不存在: ${requested}`);
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
}): Promise<{ id: string; dataUrl: string }[]> {
    const accountId = await resolveAccountId(opts.accountId);
    const modelName = modelOptionName(opts.modelValue);
    // 连线/上传的参考图必须真实上传给豆包，和提示词一起提交（图生图 / 参考图）
    const { uploadAttachment } = await import("./doubao-bridge");
    const attachments: string[] = [];
    for (const [index, reference] of (opts.references || []).slice(0, 6).entries()) {
        try {
            const blob = await (await fetch(reference.dataUrl)).blob();
            attachments.push(await uploadAttachment(accountId, blob, reference.name || `ref-${index}.png`));
        } catch {
            /* 读不到字节的跳过 */
        }
    }
    const job = await createVideoJob({
        accountId,
        prompt: opts.prompt,
        capability: "图像生成",
        expectedArtifactKind: "image",
        mode: attachments.length ? "image-to-image" : "text-to-image",
        modelName,
        requestedParams: { model: modelName },
        attachments,
        nodeId: undefined,
    });
    const done = await waitJob(job.id, undefined, 3000, 20 * 60 * 1000);
    if (done.status !== "succeeded") {
        throw new Error(done.error?.message || "豆包生图失败");
    }
    const images = done.files.filter((f) => f.kind === "image" || (f.contentType || "").startsWith("image/"));
    if (!images.length) throw new Error("豆包未返回图片");
    const results = await Promise.all(
        images.map(async (f, i) => {
            const url = f.path.startsWith("http") ? f.path : `${DOUBAO_BRIDGE_URL}/api/jobs/${done.id}/files/${i}`;
            return { id: `${done.id}-${i}`, dataUrl: await fileToDataUrl(url) };
        }),
    );
    return results;
}

