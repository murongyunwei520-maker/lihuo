import type { DramaAsset, DramaSequence, DramaShot } from "@/types/drama";

import { totalSeconds } from "./lint";
import { LIGHT_LABEL } from "./schema";
import { DEFAULT_DRAMA_SETTINGS, episodeCountOf } from "./settings";
import { consistencyLine, negativePrompt, resolveCinematography, visualContextLines } from "./visual";

// 镜头 → 提示词：图片与视频分开构造，共用项目视觉基准与摄影参数。
// 页面与画布节点都用这一份，避免各写一套口径。

/** 资产参考图的顺序：先保人脸，再保环境，最后道具 —— 参考图名额有限时先牺牲后者。 */
const KIND_WEIGHT: Record<DramaAsset["kind"], number> = { character: 0, scene: 1, costume: 2, prop: 3, effect: 4, other: 5 };

/** 只保留文字，用来判断「这一镜有没有提到这个道具」。 */
function nameKey(text: string) {
    return text
        .toLowerCase()
        .replace(/[\s\u3000·・]+/g, "")
        .replace(/[。！？!?，,、；;：:「」『』“”"'（）()\[\]【】…—\-]+/g, "");
}

/**
 * 这一镜要带的参考资产：绑定的人物 / 场景，加上画面里提到但没绑定的道具服装。
 * 老镜头（升级前拆的）没有道具绑定，也能靠名字补上参考图。
 */
export function assetsOfShot(sequence: DramaSequence, shot: DramaShot): DramaAsset[] {
    const byId = new Map(sequence.assets.map((asset) => [asset.id, asset]));
    const bound = shot.assetIds.map((id) => byId.get(id)).filter((asset): asset is DramaAsset => Boolean(asset));
    const haystack = nameKey([shot.prompt, shot.action, shot.line, shot.expression, shot.scene, shot.location].filter(Boolean).join(" "));
    const extra = sequence.assets.filter((asset) => {
        if (shot.assetIds.includes(asset.id)) return false;
        if (asset.kind !== "prop" && asset.kind !== "costume" && asset.kind !== "effect") return false;
        const key = nameKey(asset.name);
        return Boolean(key) && haystack.includes(key);
    });
    const seen = new Set<string>();
    return [...bound, ...extra]
        .filter((asset) => {
            if (seen.has(asset.id)) return false;
            seen.add(asset.id);
            return true;
        })
        .sort((left, right) => KIND_WEIGHT[left.kind] - KIND_WEIGHT[right.kind]);
}

/** 出场人物名：优先真实绑定的资产名，没有绑定时用拆分时留下的名字。 */
export function characterNames(sequence: DramaSequence, shot: DramaShot): string[] {
    const bound = assetsOfShot(sequence, shot)
        .filter((asset) => asset.kind === "character")
        .map((asset) => asset.name);
    return bound.length ? bound : (shot.characters ?? []).filter(Boolean);
}

function assetLine(assets: DramaAsset[]): string {
    if (!assets.length) return "";
    return assets.map((asset) => (asset.description.trim() ? `${asset.name}（${asset.description.trim()}）` : asset.name)).join("、");
}

function ratioText(sequence: DramaSequence): string {
    const settings = { ...DEFAULT_DRAMA_SETTINGS, ...(sequence.settings ?? {}) };
    return settings.ratio !== "自动" ? `画幅 ${settings.ratio}` : "";
}

/**
 * 分镜图片提示词：以「这一镜要看到的剧情画面」为主体，
 * 完整带入项目视觉、场景、人物、景别机位运镜构图光位、动作表情、参考资产、画幅与负面词。
 */
export function shotImagePrompt(sequence: DramaSequence, shot: DramaShot): string {
    const cinema = resolveCinematography(sequence, shot);
    const assets = assetsOfShot(sequence, shot);
    const characters = characterNames(sequence, shot);
    const lines = [
        ...visualContextLines(sequence),
        shot.scene.trim() ? `场景：${shot.scene}${shot.location ? ` · ${shot.location}` : ""}` : "",
        characters.length ? `出场人物：${characters.join("、")}` : "",
        `景别：${shot.size}；机位：${shot.camera || "平视"}；运镜：${shot.move}`,
        `构图：${cinema.composition}；光位：${LIGHT_LABEL[shot.light]}`,
        `摄影：${cinema.lens}，${cinema.aperture}，主光 ${cinema.keyLight}，辅光 ${cinema.fillLight}`,
        shot.action?.trim() ? `人物动作：${shot.action.trim()}` : "",
        shot.expression?.trim() ? `面部表情：${shot.expression.trim()}` : "",
        shot.prompt.trim() ? `画面：${shot.prompt.trim()}` : "",
        assetLine(assets) ? `参考资产：${assetLine(assets)}` : "",
        ratioText(sequence),
        consistencyLine(sequence, shot),
    ].filter(Boolean);
    return `${lines.join("；")}。负面提示词：${negativePrompt(sequence, ["不要出现剧情以外的人物"])}`;
}

/**
 * 分镜视频提示词：描述「怎么动」，而不是再描述一遍静帧。
 * 包含主体运动、动作起止、镜头运动、环境运动、连续性与避免项。
 */
export function shotVideoPrompt(sequence: DramaSequence, shot: DramaShot): string {
    const cinema = resolveCinematography(sequence, shot);
    const characters = characterNames(sequence, shot);
    const motion = shot.move === "固定" ? "镜头固定不动，只有主体与环境在动" : `镜头${shot.move}`;
    const action = shot.action?.trim() || shot.prompt.trim();
    const rainy = shot.location?.includes("雨") || shot.scene.includes("雨");
    const env = shot.sound?.trim() ? `环境运动：${shot.sound.trim()}` : rainy ? "环境运动：雨丝持续落下，地面积水有涟漪" : "";
    const ratio = sequence.settings?.videoRatio && sequence.settings.videoRatio !== "自动" ? sequence.settings.videoRatio : "9:16";
    const lines = [
        ...visualContextLines(sequence),
        shot.imageRef ? "以首帧画面为起点，保持构图、人物位置、服装与光线方向不变" : `场景：${shot.scene}${shot.location ? ` · ${shot.location}` : ""}`,
        characters.length ? `主体：${characters.join("、")}` : "",
        action ? `动作过程：从起始姿态开始，${action}，动作自然连贯、有明确收尾` : "动作过程：人物保持微小自然动作，不要静止成照片",
        shot.expression?.trim() ? `表情变化：${shot.expression.trim()}` : "",
        motion,
        env,
        `连续性与一致性：${consistencyLine(sequence, shot) || "人物外观、服装、场景与首帧保持一致"}；光线方向与色温不得跳变`,
        `时长：约 ${shot.seconds} 秒；画幅：${ratio}`,
        `摄影：${cinema.lens}，${cinema.aperture}`,
    ].filter(Boolean);
    return `${lines.join("；")}。负面提示词：${negativePrompt(sequence, ["不要换人、换脸、换服装", "不要切换场景或场景跳变", "不要突然加速或抽帧"])}`;
}

/** 兼容旧调用（画布节点 / 早期组件）：等同于图片提示词，已生成的自定义提示词优先。 */
export function shotPrompt(sequence: DramaSequence, shot: DramaShot): string {
    return shot.imagePrompt?.trim() || shotImagePrompt(sequence, shot);
}

/**
 * 当前镜头有效参考图：只取真实绑定（或画面里提到的道具）且已经有图的资产，
 * 顺序固定为人物 → 场景 → 服装道具，去重后交给图生图 / 图生视频。
 */
export function shotReferences(sequence: DramaSequence, shot: DramaShot): string[] {
    const keys = assetsOfShot(sequence, shot).flatMap((asset) => asset.refs.filter(Boolean));
    return [...new Set(keys)];
}

/** 比例 → 生成尺寸；「自动」返回 undefined，交给宿主默认。 */
export function ratioToSize(ratio: string): string | undefined {
    return ratio && ratio !== "自动" ? ratio : undefined;
}

/** 一次投影的统计，用于面板回显。 */
export function sequenceSummary(sequence: DramaSequence) {
    const settings = sequence.settings ?? DEFAULT_DRAMA_SETTINGS;
    return {
        shots: sequence.shots.length,
        seconds: totalSeconds(sequence),
        target: sequence.targetSeconds,
        assets: sequence.assets.length,
        episodes: episodeCountOf(settings),
    };
}
