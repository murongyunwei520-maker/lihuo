import type { DramaAssetKind, DramaLight, DramaShotStatus } from "@/types/drama";

// 单镜时长取自豆包视频的真实取值范围（见 .doubao-accounts/<id>/state/video-caps.json，4–15s）。
// 改这两个值会改变分镜表的硬约束，属于会改变实际行为的边界值，需先确认。
export const SHOT_MIN_SECONDS = 4;
export const SHOT_MAX_SECONDS = 15;

export const SHOT_SIZES = ["远景", "全景", "中景", "近景", "特写"];
export const SHOT_MOVES = ["固定", "推", "拉", "摇", "移", "跟拍", "手持"];
export const SHOT_CAMERAS = ["平视", "俯拍", "仰拍", "过肩", "主观视角"];
export const SHOT_COMPOSITIONS = ["中心构图", "三分构图", "对称构图", "留白构图", "前景遮挡"];

export const LIGHT_LABEL: Record<DramaLight, string> = {
    left: "左逆光",
    right: "右顺光",
    none: "无主光",
};

export const ASSET_KIND_LABEL: Record<DramaAssetKind, string> = {
    character: "人物",
    scene: "场景",
    costume: "服装",
    prop: "道具",
    effect: "特效",
    other: "其他",
};

export const SHOT_STATUS_LABEL: Record<DramaShotStatus, string> = {
    pending: "待生成",
    running: "生成中",
    done: "已出片",
    failed: "生成失败",
};

export const SHOT_STATUS_TONE: Record<DramaShotStatus, string> = {
    pending: "bg-stone-300 dark:bg-stone-600",
    running: "bg-amber-500",
    done: "bg-emerald-500",
    failed: "bg-red-500",
};

/** 镜头占位画面：用场景名做稳定哈希，同一场景每次渲染都是同一块颜色。 */
export function frameGradient(seed: string): string {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 360;
    return `linear-gradient(165deg, hsl(${hash} 16% 38%) 0%, hsl(${hash} 20% 24%) 52%, hsl(${hash} 24% 13%) 100%)`;
}

/**
 * 光位可视化：和 lint.ts 的「光位相反」规则对应。
 * 让检查器指出的方向跳变在占位画面上肉眼可见，而不只是一句文案。
 */
export function lightOverlay(light: DramaLight): string {
    if (light === "left") return "radial-gradient(75% 85% at 6% 32%, rgba(255,238,200,.32) 0%, rgba(255,238,200,.09) 38%, transparent 68%)";
    if (light === "right") return "radial-gradient(75% 85% at 94% 32%, rgba(208,230,255,.32) 0%, rgba(208,230,255,.09) 38%, transparent 68%)";
    return "none";
}

export function shotNumber(index: number): string {
    return String(index + 1).padStart(2, "0");
}
