import type { StudioAsset, StudioMediaKind, StudioProject, StudioShot } from "@/types/studio";

import { officialVersionOf } from "./prompt";

// 依赖关系引擎：资产正式版变化后，找出引用它、且素材产自旧版本的镜头。
// 只标记，不删除下游成果，也不自动重新生成。

export type StudioAssetImpact = {
    episodeId: string;
    episodeTitle: string;
    shotId: string;
    shotNo: string;
    media: StudioMediaKind[];
    reason: string;
};

export function shotUsesAsset(asset: StudioAsset, shot: StudioShot): boolean {
    if (shot.assetIds.includes(asset.id)) return true;
    if (asset.kind === "character" && shot.characterNames.some((name) => name.trim() === asset.name.trim())) return true;
    if (asset.kind === "scene" && shot.sceneName.trim() === asset.name.trim()) return true;
    return false;
}

export function shotsUsingAsset(project: StudioProject, assetId: string): { episodeId: string; shot: StudioShot }[] {
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return [];
    return project.episodes.flatMap((episode) => episode.shots.filter((shot) => shotUsesAsset(asset, shot)).map((shot) => ({ episodeId: episode.id, shot })));
}

function versionUsesAsset(version: { assetVersionIds?: Record<string, string> } | undefined, assetId: string) {
    if (!version) return false;
    return Object.prototype.hasOwnProperty.call(version.assetVersionIds ?? {}, assetId);
}

export function affectedByAsset(project: StudioProject, assetId: string): StudioAssetImpact[] {
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return [];
    const currentVersion = officialVersionOf(asset);
    const impacts: StudioAssetImpact[] = [];
    for (const episode of project.episodes) {
        for (const shot of episode.shots) {
            if (!shotUsesAsset(asset, shot)) continue;
            const media: StudioMediaKind[] = [];
            const reasons = new Set<string>();
            const imageVersion = shot.imageVersions.find((version) => version.storageKey === shot.imageRef);
            if (shot.imageRef) {
                if (!versionUsesAsset(imageVersion, assetId)) {
                    media.push("image");
                    reasons.add("首帧未记录资产版本，需人工确认");
                } else if (imageVersion?.assetVersionIds?.[assetId] !== currentVersion) {
                    media.push("image");
                    reasons.add("首帧使用旧版参考图");
                }
            }
            const videoVersion = shot.videoVersions.find((version) => version.storageKey === shot.videoRef);
            if (shot.videoRef) {
                if (!versionUsesAsset(videoVersion, assetId)) {
                    media.push("video");
                    reasons.add("视频未记录资产版本，需人工确认");
                } else if (videoVersion?.assetVersionIds?.[assetId] !== currentVersion) {
                    media.push("video");
                    reasons.add("视频基于旧版首帧/资产");
                }
            }
            if (media.length) {
                impacts.push({
                    episodeId: episode.id,
                    episodeTitle: episode.title,
                    shotId: shot.id,
                    shotNo: shot.no,
                    media,
                    reason: [...reasons].join("；"),
                });
            }
        }
    }
    return impacts;
}

/** 人物音色变化只影响对白，不影响图片和视频。 */
export function affectedByVoice(project: StudioProject, asset: StudioAsset): { episodeId: string; shotId: string; shotNo: string }[] {
    if (asset.kind !== "character") return [];
    return project.episodes.flatMap((episode) =>
        episode.shots
            .filter((shot) => shot.speaker === asset.name && Boolean(shot.audioRef || shot.narrationRef))
            .map((shot) => ({ episodeId: episode.id, shotId: shot.id, shotNo: shot.no })),
    );
}
