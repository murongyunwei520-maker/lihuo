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

// P1-2: 禁止自动选账号——必须显式传入 accountId，并验证账号存在及登录状态
async function resolveAccountId(preferredAccountId?: string): Promise<string> {
    if (!preferredAccountId) {
        throw new Error("请先选择豆包账号（禁止自动分配）");
    }
    // 验证账号存在及登录状态
    const accounts = await listAccounts();
    const account = accounts.find((a) => a.id === preferredAccountId);
    if (!account) {
        throw new Error(`账号不存在: ${preferredAccountId}`);
    }
    if (!account.state.loggedIn) {
        throw new Error(`账号 ${account.name} 未登录，请先在号池扫码登录`);
    }
    return preferredAccountId;
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

export async function generateVideoViaDoubao(opts: {
    modelValue: string;
    prompt: string;
    ratio?: string;
    duration?: number;
    references?: { name?: string; dataUrl: string }[];
    signal?: AbortSignal;
    accountId?: string;
}): Promise<{ url: string; width?: number; height?: number }> {
    const accountId = await resolveAccountId(opts.accountId);
    const modelName = modelOptionName(opts.modelValue);
    // 连线的参考图必须真实上传给豆包，和提示词一起提交（图生视频）
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
        capability: "视频生成",
        expectedArtifactKind: "video",
        mode: attachments.length ? "image-to-video" : "text-to-video",
        modelName,
        requestedParams: {
            model: modelName,
            ...(opts.ratio ? { ratio: opts.ratio } : {}),
            ...(opts.duration ? { duration: opts.duration } : {}),
        },
        attachments,
        nodeId: undefined,
    });
    const done = await waitJob(job.id, undefined, 3000, 20 * 60 * 1000);
    if (done.status !== "succeeded") {
        throw new Error(done.error?.message || "豆包视频生成失败");
    }
    const video = done.files.find((f) => f.kind === "video" || (f.contentType || "").startsWith("video/"));
    if (!video) throw new Error("豆包未返回视频");
    // 直接返回 URL，前端 <video> 能播
    return { url: `${DOUBAO_BRIDGE_URL}/api/jobs/${done.id}/files/${done.files.indexOf(video)}` };
}
