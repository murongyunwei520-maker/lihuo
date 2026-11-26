import { CLOUD_CHANNEL_ID, resolveCloudTarget, type CloudTarget } from "@/lib/cloud-channel";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution } from "@/lib/media-size";
import { boolConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { VideoGenerationResult, VideoGenerationTask, VideoGenerationTaskState } from "./video";
import { chatStream, createVideoTask, generate, generateBlob, generateForm, getMediaUrl, getTask, ServerApiError } from "./lihuo-server";

/**
 * 云端生成：所有请求经离火后端，浏览器不持有任何上游 Key。
 * 只在 config.channelMode === "cloud" 时启用；模型来自后端注册表。
 */

export interface CloudImage {
    id: string;
    dataUrl: string;
}

type RequestOptions = { signal?: AbortSignal; nodeId?: string; temperature?: number; maxTokens?: number; idempotencyKey?: string };

export function isCloudMode(config: AiConfig): boolean {
    return config.channelMode === "cloud";
}

export { resolveCloudTarget };
export type { CloudTarget };

/** "lihuo-cloud::demo-image" → "demo-image"（兼容旧调用） */
export function cloudModelId(value: string): string {
    return resolveCloudTarget(value)?.model ?? "";
}

function requireTarget(value: string, label: string): CloudTarget {
    const target = resolveCloudTarget(value);
    if (!target) throw new Error(`请先在配置里选择云端${label}模型`);
    return target;
}

function withSystemPrompt(config: AiConfig, prompt: string): string {
    const system = String(config.systemPrompt || "").trim();
    return system ? `${system}\n\n${prompt}` : prompt;
}

function imageParams(config: AiConfig) {
    const count = Math.max(1, Math.min(8, Math.floor(Math.abs(Number(config.count)) || 1)));
    const size = /^\d+x\d+$/.test(String(config.size || "")) ? String(config.size) : "";
    const quality = ["low", "medium", "high", "auto"].includes(String(config.quality || "")) ? String(config.quality) : "";
    const background = ["transparent", "opaque", "auto"].includes(String(config.background || "")) ? String(config.background) : "";
    return { count, size, quality, background };
}

async function urlToDataUrl(url: string): Promise<string> {
    try {
        const res = await fetch(url);
        if (!res.ok) return url;
        const blob = await res.blob();
        return await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || url));
            reader.onerror = () => resolve(url);
            reader.readAsDataURL(blob);
        });
    } catch {
        return url;
    }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const res = await fetch(dataUrl);
    return res.blob();
}

/** 后端原样透传上游响应体，这里按 OpenAI 结构取图 */
async function parseCloudImages(payload: unknown): Promise<CloudImage[]> {
    const body = payload as { data?: Array<{ b64_json?: string; url?: string }>; images?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> };
    const list = body?.data || (body?.images as Array<{ b64_json?: string; url?: string }>) || (body?.results as Array<{ b64_json?: string; url?: string }>) || [];
    const images: CloudImage[] = [];

    for (const item of list) {
        const b64 = item?.b64_json;
        const url = item?.url;
        if (typeof b64 === "string" && b64) {
            images.push({ id: crypto.randomUUID(), dataUrl: `data:image/png;base64,${b64}` });
        } else if (typeof url === "string" && url) {
            images.push({ id: crypto.randomUUID(), dataUrl: await urlToDataUrl(url) });
        }
    }

    if (!images.length) throw new Error("云端未返回图片，请检查提示词或模型能力");
    return images;
}

export async function cloudGenerateImages(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    options: RequestOptions = {},
): Promise<CloudImage[]> {
    const target = requireTarget(config.model || config.imageModel, "生图");
    const model = target.model;
    const { count, size, quality, background } = imageParams(config);
    const finalPrompt = withSystemPrompt(config, prompt);

    try {
        if (references.length) {
            const form = new FormData();
            form.set("model", model);
            form.set("keySource", target.keySource);
            if (target.byokChannelId) form.set("byokChannelId", target.byokChannelId);
            form.set("prompt", finalPrompt);
            form.set("n", String(count));
            if (size) form.set("size", size);
            if (quality) form.set("quality", quality);
            const files = await Promise.all(references.map((reference) => dataUrlToBlob(reference.dataUrl)));
            const field = files.length > 1 ? "image[]" : "image";
            files.forEach((blob, index) => form.append(field, blob, references[index]?.name || `ref-${index}.png`));
            const { data } = await generateForm("image-edits", form, { signal: options.signal, idempotencyKey: options.idempotencyKey });
            return await parseCloudImages(data);
        }

        const { data } = await generate(
            "image-generations",
            {
                model,
                keySource: target.keySource,
                ...(target.byokChannelId ? { byokChannelId: target.byokChannelId } : {}),
                prompt: finalPrompt,
                n: count,
                ...(size ? { size } : {}),
                ...(quality ? { quality } : {}),
                ...(background ? { background } : {}),
            },
            { signal: options.signal, idempotencyKey: options.idempotencyKey },
        );
        return await parseCloudImages(data);
    } catch (error) {
        throw new Error(readCloudError(error));
    }
}

export async function cloudGenerateAudio(config: AiConfig, prompt: string, options: RequestOptions = {}): Promise<Blob> {
    const target = requireTarget(config.model || config.audioModel, "语音");
    const model = target.model;
    const instructions = String(config.audioInstructions || "").trim();
    try {
        const { blob } = await generateBlob(
            "audio-speech",
            {
                model,
                keySource: target.keySource,
                ...(target.byokChannelId ? { byokChannelId: target.byokChannelId } : {}),
                input: prompt,
                voice: config.audioVoice || "alloy",
                response_format: config.audioFormat || "mp3",
                speed: Number(config.audioSpeed || 1),
                ...(instructions ? { instructions } : {}),
            },
            { signal: options.signal, idempotencyKey: options.idempotencyKey },
        );
        return blob;
    } catch (error) {
        throw new Error(readCloudError(error));
    }
}

/**
 * 云端视频参数（Phase 5 P0-2）。
 *
 * 这里只做「画布配置 → 后端内部命名」的归一化，不做上游字段名转换：
 * 上游字段由后端适配器按渠道映射处理（core/channel/video-params.ts）。
 * 只发送有值的字段，避免把 undefined 变成「显式 null」传给上游。
 */
function videoParams(config: AiConfig): Record<string, unknown> {
    const rawSize = String(config.size || "");
    const ratio = inferVideoRatio(rawSize || "16:9");
    const resolution = `${parseVideoResolution(config.vquality)}p`;
    const size = /^\d+x\d+$/.test(rawSize) ? rawSize : computeVideoSize(config.vquality || "720", ratio);
    const mode = config.videoMode === "reference" ? "reference" : "frames";
    return {
        duration: Number(clampVideoSeconds(config.videoSeconds || "6")),
        ...(size && size !== "auto" ? { size } : {}),
        ...(ratio && ratio !== "auto" ? { aspect_ratio: ratio } : {}),
        resolution,
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
        mode,
    };
}

export async function cloudCreateVideoTask(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    options: RequestOptions = {},
): Promise<VideoGenerationTask> {
    // 后端视频端点目前只转提示词参数；静默丢掉参考图会产出「看起来对但内容不对」的视频，宁可报错
    if (references.length) throw new Error("云端视频暂不支持参考图，请先在本地渠道使用图生视频");
    const target = requireTarget(config.videoModel || config.model, "视频");
    const model = target.model;
    try {
        const created = await createVideoTask(
            {
                model,
                keySource: target.keySource,
                ...(target.byokChannelId ? { byokChannelId: target.byokChannelId } : {}),
                prompt,
                ...(options.nodeId ? { nodeId: options.nodeId } : {}),
                // P0-2：完整传递画布参数，由后端按模型白名单校验、按渠道映射转换字段名
                ...videoParams(config),
            },
            { idempotencyKey: options.idempotencyKey },
        );
        return { id: created.taskId, provider: "cloud", model };
    } catch (error) {
        throw new Error(readCloudError(error));
    }
}

export async function cloudPollVideoTask(task: VideoGenerationTask, options: RequestOptions = {}): Promise<VideoGenerationTaskState> {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
        const state = await getTask(task.id);
        if (state.status === "failed" || state.status === "canceled") {
            return { status: "failed", error: state.errorCode || "云端任务失败" };
        }
        if (state.status !== "succeeded" || !state.result?.mediaKey) return { status: "pending" };

        const signed = await getMediaUrl(state.result.mediaKey);
        const res = await fetch(signed.url);
        if (!res.ok) return { status: "failed", error: "产物下载失败" };
        const blob = await res.blob();
        const result: VideoGenerationResult = { blob, mimeType: state.result.mime || blob.type || "video/mp4" };
        return { status: "completed", result };
    } catch (error) {
        throw new Error(readCloudError(error));
    }
}

/**
 * 云端文本对话：走 /api/chat/stream（SSE），把增量回传给调用方。
 * 图片输入暂不支持（后端只转发文本消息），遇到图片直接给出明确提示。
 */
export async function cloudAsk(
    config: AiConfig,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> }>,
    onDelta: (text: string) => void,
    options: RequestOptions = {},
): Promise<string> {
    const target = requireTarget(config.model || config.textModel, "文本");
    const model = target.model;
    if (messages.some((message) => typeof message.content !== "string" && message.content.some((part) => part.type === "image_url"))) {
        throw new Error("云端对话暂不支持图片输入，请切换到本地渠道");
    }

    const flat = messages.map((message) => ({
        role: message.role,
        content: typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"),
    }));

    let text = "";
    try {
        await chatStream(
            {
                model,
                keySource: target.keySource,
                ...(target.byokChannelId ? { byokChannelId: target.byokChannelId } : {}),
                messages: flat,
                ...(Number.isFinite(options.temperature) ? { temperature: Math.max(0, Math.min(2, Number(options.temperature))) } : { temperature: 0.7 }),
                ...(Number.isFinite(options.maxTokens) && Number(options.maxTokens) > 0 ? { maxTokens: Math.round(Number(options.maxTokens)) } : {}),
            },
            {
                onDelta: (delta) => {
                    text += delta;
                    onDelta(delta);
                },
                onDone: () => undefined,
            },
            options.signal,
        );
        return text;
    } catch (error) {
        throw new Error(readCloudError(error));
    }
}

export function readCloudError(error: unknown): string {
    if (error instanceof ServerApiError) {
        if (error.status === 401) return "请先登录后再生成";
        if (error.status === 402) return "余额不足，请联系管理员充值";
        return error.message;
    }
    return (error as Error)?.message || "云端请求失败";
}
