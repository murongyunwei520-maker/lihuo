// Stage 4：正式分镜的资产引用必须指向当前项目内仍可用（未归档）的资产。
// 只按稳定 ID 校验，不按名称猜测；失败必须明确报错并保留原正式分镜，不静默清空绑定。

import type { StudioAsset } from "@/types/studio";
import type { StudioProductionShot, StudioStoryboardDocument } from "@/types/studio-production";

export type StoryboardAssetReferenceStatus = "valid" | "invalid" | "unverified";

export type StoryboardAssetReferenceValidation =
    | { ok: true; status: "valid"; unverifiedDetails: [] }
    | { ok: true; status: "unverified"; unverifiedDetails: string[] }
    | { ok: false; status: "invalid"; error: string; details: string[] };

const KIND_LABEL: Record<StudioAsset["kind"], string> = {
    character: "人物",
    scene: "场景",
    costume: "服装",
    prop: "道具",
};

function assetError(asset: StudioAsset | undefined, id: string, kind: StudioAsset["kind"]): string | undefined {
    if (!id) return `缺少${KIND_LABEL[kind]}资产 ID`;
    if (!asset) return `未找到${KIND_LABEL[kind]}资产「${id}」`;
    if (asset.kind !== kind) return `资产「${id}」不是${KIND_LABEL[kind]}资产（当前为${KIND_LABEL[asset.kind]}）`;
    if (asset.archived) return `${KIND_LABEL[kind]}资产「${id}」已归档，不能用于正式分镜`;
    return undefined;
}

/** 共享校验：提案应用、快照正式写入与后续 4F 交接都必须走这里。 */
export function validateStoryboardAssetReferences(
    document: StudioStoryboardDocument,
    assets: StudioAsset[] | undefined,
): StoryboardAssetReferenceValidation {
    const available = (assets ?? []).filter((asset) => asset && typeof asset.id === "string");
    const byId = new Map(available.map((asset) => [asset.id, asset]));
    const details: string[] = [];
    const unverifiedDetails: string[] = [];
    const push = (path: string, message: string) => details.push(`${path}：${message}`);
    const pushUnverified = (path: string, message: string) => unverifiedDetails.push(`${path}：${message}`);

    const groupIds = new Set<string>();
    for (const [groupIndex, group] of document.groups.entries()) {
        const path = `镜头组 ${group.shotGroupId || `#${groupIndex + 1}`}`;
        if (!group.shotGroupId) push(path, "缺少 shotGroupId");
        else if (groupIds.has(group.shotGroupId)) push(path, "shotGroupId 重复");
        else groupIds.add(group.shotGroupId);
        if (group.episodeId !== document.episodeId) push(path, `所属分集 ${group.episodeId} 与正式分镜 ${document.episodeId} 不一致`);
    }

    const validateShot = (shot: StudioProductionShot) => {
        const path = `镜头 ${shot.shotNumber || shot.shotId}`;
        if (shot.episodeId !== document.episodeId) push(path, `所属分集 ${shot.episodeId} 与正式分镜 ${document.episodeId} 不一致`);
        const group = document.groups.find((item) => item.shotGroupId === shot.shotGroupId);
        if (!shot.shotGroupId) push(path, "缺少 shotGroupId");
        else if (!group) push(path, `shotGroupId「${shot.shotGroupId}」不存在`);
        else {
            if (group.sceneId !== shot.sceneId) push(path, `镜头场景 ${shot.sceneId} 与镜头组场景 ${group.sceneId} 不一致`);
            if (!group.shotIds.includes(shot.shotId)) push(path, `镜头未登记在镜头组 ${group.shotGroupId}`);
        }

        const characterIds = new Set<string>();
        for (const binding of shot.characterBindings ?? []) {
            const error = assetError(byId.get(binding.characterId), binding.characterId, "character");
            if (error) push(`${path} / 人物绑定`, error);
            else characterIds.add(binding.characterId);
            if (binding.outfitId) {
                const outfitError = assetError(byId.get(binding.outfitId), binding.outfitId, "costume");
                if (outfitError) push(`${path} / 人物 ${binding.characterId} 服装`, outfitError);
            }
        }
        for (const binding of shot.outfitBindings ?? []) {
            const characterError = assetError(byId.get(binding.characterId), binding.characterId, "character");
            if (characterError) push(`${path} / 服装绑定人物`, characterError);
            if (!characterIds.has(binding.characterId)) push(`${path} / 服装绑定人物`, `人物 ${binding.characterId} 未在 characterBindings 中声明`);
            const outfitError = assetError(byId.get(binding.outfitId), binding.outfitId, "costume");
            if (outfitError) push(`${path} / 服装变体`, outfitError);
        }
        const locationId = shot.sceneBindings?.locationId ?? "";
        const sceneError = assetError(byId.get(locationId), locationId, "scene");
        if (sceneError) push(`${path} / 场景绑定`, sceneError);
        const locationVariantId = shot.sceneBindings?.locationVariantId ?? "";
        if (!locationVariantId) push(`${path} / 场景变体`, "缺少 locationVariantId");
        else {
            // 当前资产模型只有场景资产，没有独立 location variant 记录；不能按名称或前缀猜成有效。
            pushUnverified(`${path} / 场景变体`, `场景变体「${locationVariantId}」没有独立资产记录，当前无法验证`);
        }
        for (const binding of shot.propBindings ?? []) {
            const error = assetError(byId.get(binding.propId), binding.propId, "prop");
            if (error) push(`${path} / 道具绑定`, error);
        }
        for (const state of shot.continuity?.characters ?? []) {
            const characterError = assetError(byId.get(state.characterId), state.characterId, "character");
            if (characterError) push(`${path} / 连续性人物`, characterError);
            if (state.outfitId) {
                const outfitError = assetError(byId.get(state.outfitId), state.outfitId, "costume");
                if (outfitError) push(`${path} / 连续性服装变体`, outfitError);
            }
            if (state.weaponPropId) {
                const propError = assetError(byId.get(state.weaponPropId), state.weaponPropId, "prop");
                if (propError) push(`${path} / 连续性武器道具`, propError);
            }
        }
        for (const state of shot.continuity?.props ?? []) {
            const propError = assetError(byId.get(state.propId), state.propId, "prop");
            if (propError) push(`${path} / 连续性道具`, propError);
        }
        for (const line of shot.dialogue ?? []) {
            const error = assetError(byId.get(line.characterId), line.characterId, "character");
            if (error) push(`${path} / 对白人物`, error);
            if (!characterIds.has(line.characterId)) push(`${path} / 对白人物`, `人物 ${line.characterId} 未在 characterBindings 中声明`);
        }
    };

    for (const [shotIndex, shot] of document.shots.entries()) {
        if (!shot || typeof shot !== "object") {
            push(`镜头 #${shotIndex + 1}`, "镜头记录不可解析");
            continue;
        }
        validateShot(shot);
    }

    if (details.length) {
        const shown = details.slice(0, 12);
        return {
            ok: false,
            status: "invalid",
            error: `正式分镜包含 ${details.length} 处无效资产引用，已拒绝写入：${shown[0]}`,
            details: details.length > shown.length ? [...shown, `另有 ${details.length - shown.length} 项未展开`] : shown,
        };
    }
    if (unverifiedDetails.length) {
        return { ok: true, status: "unverified", unverifiedDetails };
    }
    return { ok: true, status: "valid", unverifiedDetails: [] };
}
