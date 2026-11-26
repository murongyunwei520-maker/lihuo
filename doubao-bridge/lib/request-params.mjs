// 豆包 / Dola 网页端真实支持的参数拆分。
// requestedParams 保留画布的全部意图；appliedParams 只放执行器真正能提交的字段；
// 网页端没有控件的字段进入 unsupportedParams，并在检查器里明确展示，绝不静默丢弃。
const SUPPORTED_BY_KIND = {
    image: ["model", "mode", "ratio", "count", "attachmentCount"],
    video: ["model", "mode", "ratio", "duration", "count", "attachmentCount"],
    text: ["model", "mode", "attachmentCount"],
};

const REASONS = {
    size: "网页端只支持比例，已用 ratio 提交",
    resolution: "网页端没有清晰度控件，未提交",
    quality: "网页端没有画质控件，未提交",
    generateAudio: "网页端没有生成声音开关，未提交",
    watermark: "网页端没有水印开关，未提交",
    seed: "网页端没有种子参数，未提交",
};

export function resolveRequestedParams(requestedParams, artifactKind) {
    const appliedParams = {};
    const unsupportedParams = [];
    if (!requestedParams || typeof requestedParams !== "object") return { appliedParams, unsupportedParams };
    const supported = new Set(SUPPORTED_BY_KIND[artifactKind] || SUPPORTED_BY_KIND.text);
    for (const [key, value] of Object.entries(requestedParams)) {
        if (value === undefined || value === null || value === "") continue;
        if (supported.has(key)) appliedParams[key] = value;
        else unsupportedParams.push({ key, value, reason: REASONS[key] || "网页端没有对应控件，未提交" });
    }
    return { appliedParams, unsupportedParams };
}

/** 把 count / duration 收敛到网页端真实范围；返回修正后的值和需要提示的项。 */
export function normalizeAppliedParams(appliedParams, artifactKind) {
    const applied = { ...appliedParams };
    const unsupported = [];
    if (applied.count !== undefined) {
        const raw = Math.floor(Number(applied.count));
        const min = 1;
        const max = artifactKind === "video" ? 1 : 4;
        const count = Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : min;
        if (count !== raw) unsupported.push({ key: "count", value: applied.count, reason: `网页端单次最多 ${max} 个，已收敛为 ${count}` });
        applied.count = count;
    }
    if (applied.duration !== undefined && artifactKind === "video") {
        const raw = Math.round(Number(applied.duration));
        const duration = Number.isFinite(raw) ? Math.max(4, Math.min(15, raw)) : undefined;
        if (duration && duration !== raw) unsupported.push({ key: "duration", value: applied.duration, reason: `网页端只支持 4–15s，已收敛为 ${duration}s` });
        if (duration) applied.duration = duration;
        else delete applied.duration;
    }
    return { appliedParams: applied, unsupportedParams: unsupported };
}
