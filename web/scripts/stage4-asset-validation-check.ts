// Stage 4 资产引用校验：只按当前项目资产稳定 ID 校验；删除/归档/变体不存在必须阻断，
// 不按名称匹配、不静默清空。只做纯函数测试，不代表真实浏览器项目数据。

import assert from "node:assert/strict";

import type { StudioAsset } from "../src/types/studio";
import type { StudioProductionShot, StudioStoryboardDocument } from "../src/types/studio-production";
import { validateStoryboardAssetReferences } from "../src/lib/studio/storyboard-asset-validation";

const now = "2026-11-26T13:00:00.000Z";

function shot(overrides: Partial<StudioProductionShot> = {}): StudioProductionShot {
    return {
        shotId: "s1",
        episodeId: "ep-1",
        sceneId: "sc-1",
        shotGroupId: "grp-1",
        shotNumber: 1,
        duration: 5,
        shotSize: "中景",
        cameraPosition: "左",
        cameraAngle: "平视",
        lens: "35mm",
        cameraMovement: "固定",
        composition: "双人",
        foreground: "",
        midground: "两人",
        background: "仓库",
        characterBlocking: "林舟左",
        eyeline: "对视",
        action: "对峙",
        facialExpression: "紧绷",
        emotion: "警觉",
        dialogue: [],
        voiceOver: "",
        soundEffects: "",
        backgroundMusic: "",
        lighting: "冷光",
        environment: "码头",
        continuityRules: [],
        characterBindings: [{ characterId: "char-a", name: "林舟", outfitId: "outfit-a" }],
        outfitBindings: [{ characterId: "char-a", outfitId: "outfit-a", description: "黑色雨衣" }],
        sceneBindings: { locationId: "loc-dock", locationVariantId: "variant-night" },
        propBindings: [{ propId: "prop-knife", name: "短刀", state: "出鞘" }],
        sourceReferences: {} as never,
        sourceScriptSceneId: "sc-1",
        imagePrompt: "",
        videoPrompt: "",
        keyframeRefs: [],
        status: "draft",
        version: 1,
        locked: false,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function document(overrides: Partial<StudioStoryboardDocument> = {}): StudioStoryboardDocument {
    return {
        id: "sb-1",
        episodeId: "ep-1",
        episodeNumber: 1,
        sourceScriptId: "script-1",
        sourceScriptVersion: 1,
        sourceEpisodePlanId: "plan-1",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-1",
        storyboardVersion: 3,
        status: "draft",
        groups: [{
            shotGroupId: "grp-1",
            episodeId: "ep-1",
            sceneId: "sc-1",
            groupNumber: 1,
            sceneTitle: "码头",
            sharedLayout: "双人",
            characterStartPositions: [],
            cameraAxis: "AB",
            propStates: "",
            timeOfDay: "夜",
            lighting: "冷光",
            weather: "雨",
            continuityRules: [],
            shotIds: ["s1"],
            reviewedByUser: false,
            createdAt: now,
            updatedAt: now,
        }],
        shots: [shot()],
        checks: [],
        sourceSceneVersions: { "sc-1": 1 },
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

const assets = [
    { id: "char-a", kind: "character", name: "林舟" },
    { id: "outfit-a", kind: "costume", name: "黑色雨衣" },
    { id: "loc-dock", kind: "scene", name: "码头" },
    { id: "prop-knife", kind: "prop", name: "短刀" },
] as unknown as StudioAsset[];

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

// 1. 合法引用通过。
assert.equal(validateStoryboardAssetReferences(document(), assets).ok, true);

// 2. 人物删除 / 归档 / 名称匹配不能救回错误 ID。
{
    const missing = validateStoryboardAssetReferences(document(), assets.filter((asset) => asset.id !== "char-a"));
    assert.equal(missing.ok, false);
    assert.equal(missing.ok === false && missing.details.some((detail) => detail.includes("未找到人物资产")), true);
    const archived = clone(assets);
    archived[0].archived = true;
    const archivedResult = validateStoryboardAssetReferences(document(), archived);
    assert.equal(archivedResult.ok, false);
    assert.equal(archivedResult.ok === false && archivedResult.details.some((detail) => detail.includes("已归档")), true);
    const renamed = clone(assets);
    renamed[0].id = "char-other";
    renamed[0].name = "林舟";
    const renamedResult = validateStoryboardAssetReferences(document(), renamed);
    assert.equal(renamedResult.ok, false, "同名不同 ID 不能通过");
}

// 3. 服装变体缺失 / 场景资产类型错误 / 道具缺失阻断。
{
    const noOutfit = validateStoryboardAssetReferences(document(), assets.filter((asset) => asset.id !== "outfit-a"));
    assert.equal(noOutfit.ok, false);
    assert.equal(noOutfit.ok === false && noOutfit.details.some((detail) => detail.includes("服装变体")), true);
    const wrongScene = clone(assets);
    wrongScene.find((asset) => asset.id === "loc-dock")!.kind = "prop";
    const wrongSceneResult = validateStoryboardAssetReferences(document(), wrongScene);
    assert.equal(wrongSceneResult.ok, false);
    assert.equal(wrongSceneResult.ok === false && wrongSceneResult.details.some((detail) => detail.includes("不是场景资产")), true);
    const noProp = validateStoryboardAssetReferences(document(), assets.filter((asset) => asset.id !== "prop-knife"));
    assert.equal(noProp.ok, false);
    assert.equal(noProp.ok === false && noProp.details.some((detail) => detail.includes("未找到道具资产")), true);
}

// 4. 镜头组缺失 / 重复 / 镜头未登记阻断。
{
    const noGroup = validateStoryboardAssetReferences(document({ groups: [] }), assets);
    assert.equal(noGroup.ok, false);
    assert.equal(noGroup.ok === false && noGroup.details.some((detail) => detail.includes("shotGroupId")), true);
    const duplicate = document();
    duplicate.groups = [duplicate.groups[0], { ...duplicate.groups[0] }];
    const duplicateResult = validateStoryboardAssetReferences(duplicate, assets);
    assert.equal(duplicateResult.ok, false);
    assert.equal(duplicateResult.ok === false && duplicateResult.details.some((detail) => detail.includes("重复")), true);
    const notMember = document();
    notMember.groups[0].shotIds = [];
    const notMemberResult = validateStoryboardAssetReferences(notMember, assets);
    assert.equal(notMemberResult.ok, false);
    assert.equal(notMemberResult.ok === false && notMemberResult.details.some((detail) => detail.includes("未登记")), true);
}

console.log("stage4-asset-validation-check: 4 groups passed");
