import type { DramaSettings } from "@/types/drama";

// 短剧项目的文档级设置：下拉预设、自定义值解析、生成提示词。
// 值随 DramaSequence 一起持久化（和 targetSeconds 同一处），不另建参数 store。

export const STYLE_OPTIONS = ["自动", "写实电影", "国漫赛璐璐", "胶片复古", "水墨", "3D 次世代", "日系插画"];
export const RATIO_OPTIONS = ["自动", "9:16", "16:9", "1:1", "4:3", "3:4", "21:9"];
export const CASTING_OPTIONS = ["自动", "固定角色", "每集重选"];
export const EPISODE_OPTIONS = ["自动", "3", "6", "10", "20"];
export const TARGET_DURATION_OPTIONS = ["自动", "60s", "90s", "120s"];
// 单镜时长以 video-caps.json 的 4–15s 为准，不给出范围外的预设。
export const SHOT_DURATION_OPTIONS = ["自动", "4s", "5s", "8s", "10s", "12s", "15s"];
// 资产图画质：对应 AiConfig.quality，不写具体像素，避免和渠道能力对不上。
export const ASSET_QUALITY_OPTIONS = ["自动", "标准", "高清"];
export const VIDEO_QUALITY_OPTIONS = ["自动", "720P", "1080P"];

export const DEFAULT_DRAMA_SETTINGS: DramaSettings = {
    textModel: "",
    imageModel: "",
    videoModel: "",
    audioModel: "",
    style: "自动",
    ratio: "自动",
    videoRatio: "9:16",
    videoSeconds: "自动",
    videoQuality: "自动",
    casting: "自动",
    episodes: "自动",
    targetDuration: "60s",
    shotDuration: "自动",
    assetQuality: "自动",
};

export type DramaSettingKey = keyof DramaSettings;

export const SETTING_OPTIONS: Record<Exclude<DramaSettingKey, "textModel" | "imageModel" | "videoModel" | "audioModel">, string[]> = {
    style: STYLE_OPTIONS,
    ratio: RATIO_OPTIONS,
    videoRatio: RATIO_OPTIONS.filter((value) => value === "自动" || value === "9:16" || value === "16:9" || value === "1:1"),
    videoSeconds: SHOT_DURATION_OPTIONS,
    videoQuality: VIDEO_QUALITY_OPTIONS,
    casting: CASTING_OPTIONS,
    episodes: EPISODE_OPTIONS,
    targetDuration: TARGET_DURATION_OPTIONS,
    shotDuration: SHOT_DURATION_OPTIONS,
    assetQuality: ASSET_QUALITY_OPTIONS,
};

/** 自定义值不是预设时，也要出现在下拉里，否则切换项目后会「看不见当前值」。 */
export function optionsWithCurrent(presets: string[], current: string): string[] {
    return current && !presets.includes(current) ? [...presets, current] : presets;
}

export function parseDramaNumber(value: string, fallback: number): number {
    const matched = String(value).match(/\d+/);
    return matched ? Number(matched[0]) : fallback;
}

/** 「自动」回落到默认值；自定义值按数字解析并钳到合法区间。 */
export function targetSecondsOf(settings: DramaSettings): number {
    return Math.min(600, Math.max(10, parseDramaNumber(settings.targetDuration, 60)));
}

export function episodeCountOf(settings: DramaSettings): number {
    return Math.min(30, Math.max(1, parseDramaNumber(settings.episodes, 3)));
}

export function shotSecondsOf(settings: DramaSettings): number | null {
    if (settings.shotDuration === "自动") return null;
    return Math.min(15, Math.max(4, parseDramaNumber(settings.shotDuration, 5)));
}

/** 视频时长：自动回落到 null（交给模型默认），否则钳到 4–15s。 */
export function videoSecondsOf(settings: DramaSettings): number | null {
    if (settings.videoSeconds === "自动") return null;
    return Math.min(15, Math.max(4, parseDramaNumber(settings.videoSeconds, 5)));
}

/** 把设置拼进生成/拆镜提示词：设置不是摆设，会真实影响模型输出。 */
export function buildSettingHint(settings: DramaSettings): string {
    const lines: string[] = [];
    if (settings.style !== "自动") lines.push(`画风：${settings.style}`);
    if (settings.ratio !== "自动") lines.push(`画面比例：${settings.ratio}`);
    if (settings.casting !== "自动") lines.push(`选角方式：${settings.casting}`);
    if (settings.episodes !== "自动") lines.push(`全剧共 ${episodeCountOf(settings)} 集，当前序列为第 1 集`);
    const shot = shotSecondsOf(settings);
    if (shot !== null) lines.push(`单镜时长偏好：${shot}s（不得超出 4–15s）`);
    if (!lines.length) return "";
    return `\n\n本片设定：\n${lines.map((line) => `- ${line}`).join("\n")}`;
}
