import type { DramaAsset, DramaSequence, DramaShot } from "@/types/drama";

import { totalSeconds } from "./lint";
import { DEFAULT_DRAMA_SETTINGS, episodeCountOf } from "./settings";

// 镜头 → 生成提示词 / 参考图：短剧页面与画布节点共用这一份，避免各写一套口径。
// 只拼装已有字段，不新增状态，也不发请求。

export function assetsOfShot(sequence: DramaSequence, shot: DramaShot): DramaAsset[] {
    const byId = new Map(sequence.assets.map((asset) => [asset.id, asset]));
    return shot.assetIds.map((id) => byId.get(id)).filter((asset): asset is DramaAsset => Boolean(asset));
}

/** 画面提示词：画风 + 场景/景别/运镜 + 画面描述 + 参考资产 + 比例。 */
export function shotPrompt(sequence: DramaSequence, shot: DramaShot): string {
    const settings = sequence.settings ?? DEFAULT_DRAMA_SETTINGS;
    const parts: string[] = [];
    if (settings.style !== "自动") parts.push(settings.style);
    if (shot.scene) parts.push(shot.scene);
    parts.push([shot.size, shot.move].filter(Boolean).join("，"));
    if (shot.light !== "none") parts.push(shot.light === "left" ? "左侧主光" : "右侧主光");
    if (shot.prompt) parts.push(shot.prompt);
    const assets = assetsOfShot(sequence, shot);
    if (assets.length) parts.push(`参考：${assets.map((asset) => (asset.description ? `${asset.name}（${asset.description}）` : asset.name)).join("、")}`);
    if (settings.ratio !== "自动") parts.push(`画面比例 ${settings.ratio}`);
    return parts.filter(Boolean).join("，");
}

/** 已生成资产的参考图（storageKey 或公网 URL），供节点生成时作为参考。 */
export function shotReferences(sequence: DramaSequence, shot: DramaShot): string[] {
    return assetsOfShot(sequence, shot).flatMap((asset) => asset.refs);
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
