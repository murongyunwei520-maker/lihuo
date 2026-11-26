// 豆包 / Dola 任务的统一参数契约。
// 前端各入口只负责把画布配置收敛成这里的类型化对象，桥接再按网页端真实支持的字段拆分；
// 不在多层之间用 Record<string, unknown> 传来传去，避免字段在中途被静默丢掉。
export type DoubaoImageMode = "text-to-image" | "image-to-image";
export type DoubaoVideoMode = "text-to-video" | "image-to-video" | "reference-to-video";
export type DoubaoTextMode = "text-to-text" | "image-to-text";
export type DoubaoGenerationMode = DoubaoImageMode | DoubaoVideoMode | DoubaoTextMode;

/**
 * 请求参数：包含画布真正想表达的全部参数。
 * 网页端是否支持由桥接按能力拆分：ratio/count/duration/model/mode 会进入执行器，
 * size/resolution 等网页没有控件的字段会进入 unsupportedParams，而不是静默丢弃。
 */
export type DoubaoRequestedParams = {
    model: string;
    mode: DoubaoGenerationMode;
    ratio?: string;
    size?: string;
    resolution?: string;
    count?: number;
    duration?: number;
    attachmentCount?: number;
};

type OptionalParam = string | undefined;

function compact(value: OptionalParam) {
    const text = String(value ?? "").trim();
    return text ? text : undefined;
}

/** 图片入口：比例、尺寸、清晰度、数量、模式、参考素材数量一次组装完整。 */
export function buildDoubaoImageRequestedParams(input: {
    model: string;
    mode: DoubaoImageMode;
    ratio?: string;
    size?: string;
    resolution?: string;
    count?: number;
    attachmentCount?: number;
}): DoubaoRequestedParams {
    return {
        model: input.model,
        mode: input.mode,
        ...(compact(input.ratio) ? { ratio: compact(input.ratio) } : {}),
        ...(compact(input.size) ? { size: compact(input.size) } : {}),
        ...(compact(input.resolution) ? { resolution: compact(input.resolution) } : {}),
        count: Math.max(1, Math.floor(Number(input.count) || 1)),
        attachmentCount: Math.max(0, Math.floor(Number(input.attachmentCount) || 0)),
    };
}

/** 视频入口：模型、比例、时长、清晰度、模式、参考素材数量一次组装完整。 */
export function buildDoubaoVideoRequestedParams(input: {
    model: string;
    mode: DoubaoVideoMode;
    ratio?: string;
    duration?: number;
    size?: string;
    resolution?: string;
    count?: number;
    attachmentCount?: number;
}): DoubaoRequestedParams {
    return {
        model: input.model,
        mode: input.mode,
        ...(compact(input.ratio) ? { ratio: compact(input.ratio) } : {}),
        ...(compact(input.size) ? { size: compact(input.size) } : {}),
        ...(compact(input.resolution) ? { resolution: compact(input.resolution) } : {}),
        ...(Number.isFinite(Number(input.duration)) && Number(input.duration) > 0 ? { duration: Math.round(Number(input.duration)) } : {}),
        count: Math.max(1, Math.floor(Number(input.count) || 1)),
        attachmentCount: Math.max(0, Math.floor(Number(input.attachmentCount) || 0)),
    };
}

export function buildDoubaoTextRequestedParams(input: {
    model: string;
    mode: DoubaoTextMode;
    attachmentCount?: number;
}): DoubaoRequestedParams {
    return {
        model: input.model,
        mode: input.mode,
        attachmentCount: Math.max(0, Math.floor(Number(input.attachmentCount) || 0)),
    };
}

export function doubaoImageMode(hasReferences: boolean): DoubaoImageMode {
    return hasReferences ? "image-to-image" : "text-to-image";
}

export function doubaoVideoMode(imageCount: number, videoCount = 0): DoubaoVideoMode {
    if (videoCount > 0) return "reference-to-video";
    return imageCount > 0 ? "image-to-video" : "text-to-video";
}
