import { resolveVideoCapability } from "@/lib/drama/video-caps";
import { resolveVideoParamSchema } from "@/stores/model-schema";
import type { StudioEpisode, StudioProject, StudioShot } from "@/types/studio";

import { buildShotVideoPrompt } from "./prompt";

// 视频请求计划：模型能力、镜头时长、画面比例、首帧/尾帧、参数先在这里收敛。
// 不支持的比例/时长直接拦下，不静默改成别的值；账号检查在提交动作里做。

export type StudioVideoPlan = {
    prompt: string;
    model: string;
    seconds: number;
    ratio: string;
    quality: string;
    references: string[];
    params: Record<string, string>;
    blocked: string;
    warnings: string[];
    lastFrame: boolean;
};

/** 尾帧能力只在模型 Schema 明确声明时才启用，未确认一律不提交。 */
export function supportsLastFrame(model: string | undefined) {
    const schema = resolveVideoParamSchema(model ?? "");
    return schema.some((field) => /last.?frame|end.?image|tail.?frame/i.test(field.key));
}

export function buildStudioVideoPlan(args: {
    project: StudioProject;
    episode: StudioEpisode;
    shot: StudioShot;
    model?: string;
    quality?: string;
    promptOverride?: string;
}): StudioVideoPlan {
    const { project, episode, shot } = args;
    const model = (args.model ?? shot.videoModel ?? project.settings.videoModel ?? "").trim();
    const capability = resolveVideoCapability(model);
    const warnings: string[] = [];
    const quality = (args.quality ?? shot.videoQuality ?? project.settings.videoQuality ?? "自动").trim() || "自动";
    const wantedRatio = (shot.videoRatio ?? project.settings.videoRatio ?? "自动").trim();
    const wantedSeconds = (shot.videoSeconds ?? project.settings.videoSeconds ?? "自动").trim();
    const seconds = wantedSeconds && wantedSeconds !== "自动" ? Number.parseFloat(wantedSeconds) : Math.round(shot.seconds);
    const prompt = (args.promptOverride ?? buildShotVideoPrompt(project, episode, shot)).trim();
    const lastFrame = Boolean(shot.videoLastFrameRef && supportsLastFrame(model));

    if (!model) return { prompt, model, seconds: Math.round(shot.seconds), ratio: wantedRatio, quality, references: [], params: {}, blocked: "还没有选择视频模型：先在视频中心选择项目默认模型，或给这一镜单独指定", warnings, lastFrame };
    if (!prompt) return { prompt, model, seconds, ratio: wantedRatio, quality, references: [], params: {}, blocked: "这一镜还没有视频提示词", warnings, lastFrame };
    if (!shot.imageRef) {
        return { prompt, model, seconds, ratio: wantedRatio, quality, references: [], params: {}, blocked: "这一镜还没有正式首帧：先在画面中心生成并选为正式版，或上传首帧", warnings, lastFrame };
    }
    if (!Number.isFinite(seconds)) {
        return { prompt, model, seconds: shot.seconds, ratio: wantedRatio, quality, references: [], params: {}, blocked: "镜头时长不是有效数字", warnings, lastFrame };
    }
    if (seconds < capability.seconds.min || seconds > capability.seconds.max) {
        return {
            prompt,
            model,
            seconds,
            ratio: wantedRatio,
            quality,
            references: [],
            params: {},
            blocked: `这个镜头计划 ${seconds}s，当前模型支持 ${capability.seconds.min}–${capability.seconds.max}s：请调整镜头时长，或换一个支持的模型`,
            warnings,
            lastFrame,
        };
    }
    if (wantedRatio !== "自动" && !capability.ratios.includes(wantedRatio)) {
        return {
            prompt,
            model,
            seconds,
            ratio: wantedRatio,
            quality,
            references: [],
            params: {},
            blocked: `当前模型不支持 ${wantedRatio} 比例：请改选支持的 ${capability.ratios.join(" / ")}，或换模型`,
            warnings,
            lastFrame,
        };
    }
    if (shot.videoLastFrameRef && !lastFrame) {
        warnings.push("当前模型未声明尾帧能力，这一镜的尾帧不会提交");
    }
    if (wantedSeconds === "自动") warnings.push(`时长为自动：按镜头计划 ${seconds}s 提交`);

    const ratio = wantedRatio === "自动" ? "自动" : wantedRatio;
    const references = lastFrame ? [shot.imageRef, shot.videoLastFrameRef!] : [shot.imageRef];
    const params: Record<string, string> = {
        seconds: String(seconds),
        references: String(references.length),
    };
    if (ratio !== "自动") params.ratio = ratio;
    if (quality !== "自动") params.quality = quality;

    return { prompt, model, seconds, ratio, quality, references, params, blocked: "", warnings, lastFrame };
}
