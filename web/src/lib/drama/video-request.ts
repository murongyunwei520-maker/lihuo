import type { AiConfig } from "@/stores/use-config-store";
import type { DramaSequence, DramaSettings, DramaShot } from "@/types/drama";

import { shotReferences, shotVideoPrompt } from "./prompt";
import type { DramaVideoCapability } from "./video-caps";

// 视频请求计划：把「分镜 + 项目设置 + 模型能力」折算成真正要提交的 prompt / 参数 / 参考图。
// 纯函数，页面用它构造请求，测试用它断言请求内容，不需要真的发网络请求。

export type DramaVideoPlan = {
    /** 最终提交给模型的动态提示词。 */
    prompt: string;
    /** 实际提交的单镜时长（已按模型能力收敛）。 */
    seconds: number;
    /** 分镜上写的时长，用于对比差异。 */
    requestedSeconds: number;
    ratio: string;
    quality: string;
    /** 提交的参考图（storageKey）：首帧 + 可选多参考。 */
    references: string[];
    referenceMode: "first-frame" | "first-frame+refs" | "none";
    /** 额外参数，仅放该模型确实支持的字段。 */
    params: Record<string, string>;
    /** 需要提示用户的差异与限制。 */
    warnings: string[];
    /** 非空表示不能提交。 */
    blocked: string;
};

type Args = {
    sequence: DramaSequence;
    shot: DramaShot;
    settings: DramaSettings;
    capability: DramaVideoCapability;
    /** 用户在检查器里改写过的提示词优先。 */
    promptOverride?: string;
};

export function buildVideoPlan({ sequence, shot, settings, capability, promptOverride }: Args): DramaVideoPlan {
    const warnings: string[] = [];
    const requestedSeconds = Number.isFinite(shot.seconds) ? Math.round(shot.seconds) : 5;
    const { min, max } = capability.seconds;
    const seconds = Math.min(max, Math.max(min, requestedSeconds));
    if (seconds !== requestedSeconds) {
        warnings.push(`镜头写的是 ${requestedSeconds}s，模型支持 ${min}–${max}s，本次按 ${seconds}s 提交`);
    }

    const wantedRatio = settings.videoRatio;
    const ratio = wantedRatio && wantedRatio !== "自动" && capability.ratios.includes(wantedRatio) ? wantedRatio : "自动";
    if (ratio !== wantedRatio && wantedRatio !== "自动") warnings.push(`模型不支持 ${wantedRatio}，本次按自动比例提交`);

    const firstFrame = shot.imageRef ?? "";
    const extras = capability.multiReference && firstFrame ? shotReferences(sequence, shot).filter((ref) => ref !== firstFrame).slice(0, 3) : [];
    const references = firstFrame ? [firstFrame, ...extras] : [];
    const referenceMode = !firstFrame ? "none" : extras.length ? "first-frame+refs" : "first-frame";

    const blocked = !firstFrame && !capability.textToVideo ? "这一镜还没有首帧，且当前模型不支持纯文生视频：先在视频卡片里上传首帧，或到「逐镜出图」生成画面" : "";
    if (!firstFrame && capability.textToVideo) warnings.push("没有首帧，本次按文生视频提交，人物一致性会变差");

    const params: Record<string, string> = { seconds: String(seconds) };
    if (ratio !== "自动") params.ratio = ratio;
    if (settings.videoQuality && settings.videoQuality !== "自动") params.quality = settings.videoQuality;

    return {
        prompt: promptOverride?.trim() || shot.videoPrompt?.trim() || shotVideoPrompt(sequence, shot),
        seconds,
        requestedSeconds,
        ratio,
        quality: settings.videoQuality || "自动",
        references,
        referenceMode,
        params,
        warnings,
        blocked,
    };
}

/** 把计划写回 AiConfig：这些字段才是 video.ts 真正读取并放进请求体的。 */
export function applyVideoPlan(config: AiConfig, plan: DramaVideoPlan): AiConfig {
    return {
        ...config,
        videoSeconds: String(plan.seconds),
        ...(plan.ratio !== "自动" ? { size: plan.ratio } : {}),
        ...(plan.quality !== "自动" ? { vquality: plan.quality } : {}),
    };
}
