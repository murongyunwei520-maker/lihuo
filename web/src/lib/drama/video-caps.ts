import { isDoubaoBuiltinModel } from "@/constants/doubao-builtin";
import { VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { resolveVideoParamSchema } from "@/stores/model-schema";

// 视频模型能力：只从项目里真实存在的模型参数 Schema 推导，不凭印象编造能力。
// 无法确认的能力（文生视频 / 多参考图）默认关闭，宁可拦下请求也不发无效参数。

export type DramaVideoCapability = {
    model: string;
    provider: "builtin" | "channel" | "unknown";
    /** 支持以一张图作为首帧（图生视频）。短剧链路默认依赖它。 */
    firstFrame: boolean;
    /** 是否支持纯文生视频。未确认的模型一律 false，避免发出不支持的首帧缺失请求。 */
    textToVideo: boolean;
    /** 是否支持除首帧外的多参考图。 */
    multiReference: boolean;
    /** 可提交的画面比例（不含「自动」）。 */
    ratios: string[];
    /** 可提交的单镜时长范围（秒）。 */
    seconds: { min: number; max: number };
    /** 模型 Schema 里存在的额外开关。 */
    toggles: { generateAudio: boolean; watermark: boolean };
    /** 给用户看的限制说明。 */
    notes: string[];
};

const DRAMA_MAX_SECONDS = 15;

/**
 * 解析某个视频模型在短剧链路里可用的能力。
 * 比例 / 时长 / 开关来自该模型的参数 Schema（豆包内置模型来自账号态能力表）。
 */
export function resolveVideoCapability(model: string | undefined): DramaVideoCapability {
    const value = (model ?? "").trim();
    const schema = value ? resolveVideoParamSchema(value) : [];
    const durationField = schema.find((field) => field.configKey === "videoSeconds");
    const ratioField = schema.find((field) => field.configKey === "size" || field.key === "ratio" || field.key === "aspect_ratio");

    const schemaRatios = (ratioField?.options ?? []).map((option) => option.value).filter((ratio) => ratio && ratio !== "自动" && ratio !== "auto");
    const ratios = schemaRatios.length ? schemaRatios : videoRatioOptions.filter((option) => option.value !== "auto").map((option) => option.value);

    const min = Math.max(1, durationField?.min ?? VIDEO_SECONDS_MIN);
    const max = Math.max(min, Math.min(durationField?.max ?? DRAMA_MAX_SECONDS, DRAMA_MAX_SECONDS));

    const notes: string[] = [];
    if (!value) notes.push("未选择视频模型，将使用画布默认视频模型，能力按通用规则处理");
    notes.push(`单镜时长按 ${min}–${max}s 校验`);
    if (!schema.length) notes.push("该模型没有参数 Schema，只提交提示词、首帧与时长");
    notes.push("文生视频与多参考图尚未确认，默认不提交");

    return {
        model: value,
        provider: !value ? "unknown" : isDoubaoBuiltinModel(value) ? "builtin" : "channel",
        firstFrame: true,
        textToVideo: false,
        multiReference: false,
        ratios,
        seconds: { min, max },
        toggles: {
            generateAudio: schema.some((field) => field.key === "generate_audio" || field.configKey === "videoGenerateAudio"),
            watermark: schema.some((field) => field.key === "watermark" || field.configKey === "videoWatermark"),
        },
        notes,
    };
}
