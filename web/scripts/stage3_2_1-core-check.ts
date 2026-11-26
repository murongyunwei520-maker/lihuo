// Stage 3.2.1 确定性测试：模块级人工保护、独立分镜草稿、正式剧本变化判定。
// 不调用真实模型；备份落盘与正式写入回读由浏览器动作验收覆盖。
import assert from "node:assert/strict";

import type {
    StudioScriptDocument,
    StudioScriptScene,
    StudioStoryboardDocument,
    StudioStoryboardDraft,
    StudioStoryboardVersion,
} from "../src/types/studio-production";
import {
    ALL_SCRIPT_MANUAL_MODULES,
    clearScriptManualEditModules,
    ensureScriptManualModules,
    guardSceneScriptWrite,
    markScriptManualEdit,
    markStoryboardStaleForScriptChange,
    scriptContentChanged,
    scriptManualEditModules,
    scriptSceneEditModules,
    withNextScriptSceneVersions,
} from "../src/lib/studio/production-protection";
import {
    createStoryboardSnapshot,
    normalizeStoryboardDrafts,
    planStoryboardDraftApply,
    planStoryboardDraftFromSnapshot,
    planStoryboardSnapshotApply,
    validateStoryboardDraftDocument,
} from "../src/lib/studio/storyboard-snapshots";
import { mergeDialogueIntoScript } from "../src/lib/studio/production-schema";

const now = "2026-11-23T00:00:00.000Z";

function block(dialogueId: string, speaker: string, text: string) {
    return { dialogueId, characterId: "char-a", speaker, text, delivery: "平静", emotion: "克制", subtext: "", linkedAction: "", timing: "3s" };
}

function scene(sceneId: string, sceneNumber: number, action: string, dialogueText: string): StudioScriptScene {
    return {
        sceneId, sceneNumber, sceneTitle: `场景 ${sceneNumber}`, locationId: "loc-a", locationVariantId: "variant-a",
        timeOfDay: "夜", environment: "潮湿码头", charactersPresent: ["char-a"], props: ["prop-a"],
        scenePurpose: "推进", conflict: "试探", action,
        dialogueBlocks: [block(`d-${sceneId}`, "林舟", dialogueText), block(`d-${sceneId}-b`, "沈鸢", "旧对白 B")],
        transitionIn: "切", transitionOut: "切", continuityNotes: "铜钥匙保持",
    };
}

function scriptDoc(): StudioScriptDocument {
    return {
        id: "script-test", episodeId: "ep-test", episodeNumber: 1, title: "第一集", logline: "旧梗概", synopsis: "旧概要",
        durationTarget: 60,
        durationEstimate: { dialogueSeconds: 6, actionSeconds: 3, transitionSeconds: 0, pauseSeconds: 0, environmentSeconds: 0, totalSeconds: 9, deltaSeconds: 0, note: "" },
        sourceEpisodePlanId: "plan-1", sourceBlueprintVersion: 1, sourceHandoffId: "handoff-1",
        scriptVersion: 1, status: "draft",
        scenes: [scene("scene-a", 1, "旧动作 A", "旧对白 A"), scene("scene-b", 2, "旧动作 B", "旧对白 B")],
        characterBindings: [
            { characterId: "char-a", name: "林舟", role: "引航员", costume: "", look: "", sceneIds: ["scene-a", "scene-b"] },
            { characterId: "char-b", name: "沈鸢", role: "修钟师", costume: "", look: "", sceneIds: ["scene-a", "scene-b"] },
        ],
        locationBindings: [{ locationId: "loc-a", name: "码头", variantId: "variant-a", timeOfDay: "夜", weather: "雾", description: "", sceneIds: ["scene-a", "scene-b"] }],
        propBindings: [{ propId: "prop-a", name: "铜钥匙", holderCharacterId: "char-a", locationId: "loc-a", state: "发热", important: true, sceneIds: ["scene-a", "scene-b"] }],
        sourceReferences: {} as never, continuityDependencies: [], adaptationChanges: [],
        createdAt: now, updatedAt: now,
    } as StudioScriptDocument;
}

function shot(shotId: string, shotNumber: number, sceneId: string, locked = false) {
    return { shotId, shotNumber, sceneId, shotGroupId: `group-${sceneId}`, duration: 4, shotSize: "中景", cameraPosition: "平视", cameraAngle: "正面", lens: "35mm", cameraMovement: "固定", composition: "", foreground: "", midground: "", background: "", characterBlocking: "", eyeline: "", action: "旧动作", facialExpression: "", emotion: "", dialogue: [], voiceOver: "", soundEffects: "", backgroundMusic: "", lighting: "", environment: "", continuityRules: [], characterBindings: [], outfitBindings: [], sceneBindings: { locationId: "loc-a", locationVariantId: "variant-a" }, propBindings: [], sourceReferences: {} as never, sourceScriptSceneId: sceneId, imagePrompt: "", videoPrompt: "", keyframeRefs: [], status: "draft", version: 1, locked, createdAt: now, updatedAt: now };
}

function storyboardDoc(version = 18): StudioStoryboardDocument {
    return {
        id: "storyboard-test", episodeId: "ep-test", episodeNumber: 1,
        sourceScriptId: "script-test", sourceScriptVersion: 1, sourceEpisodePlanId: "plan-1", sourceBlueprintVersion: 1, sourceHandoffId: "handoff-1",
        storyboardVersion: version, status: "draft",
        groups: [
            { shotGroupId: "group-scene-a", episodeId: "ep-test", sceneId: "scene-a", groupNumber: 1, sceneTitle: "场景 1", sharedLayout: "", characterStartPositions: [], cameraAxis: "", propStates: "", timeOfDay: "夜", lighting: "", weather: "", continuityRules: [], shotIds: ["shot-a"], reviewedByUser: false, createdAt: now, updatedAt: now },
            { shotGroupId: "group-scene-b", episodeId: "ep-test", sceneId: "scene-b", groupNumber: 2, sceneTitle: "场景 2", sharedLayout: "", characterStartPositions: [], cameraAxis: "", propStates: "", timeOfDay: "夜", lighting: "", weather: "", continuityRules: [], shotIds: ["shot-b"], reviewedByUser: false, createdAt: now, updatedAt: now },
        ],
        shots: [shot("shot-a", 1, "scene-a"), shot("shot-b", 1, "scene-b")] as never,
        checks: [], sourceSceneVersions: { "scene-a": 1, "scene-b": 1 }, createdAt: now, updatedAt: now,
    } as StudioStoryboardDocument;
}

const script = scriptDoc();
const board = storyboardDoc();
const snapshot = createStoryboardSnapshot({ document: board, snapshotType: "formal", basedOnVersion: 18, reason: "正式提交 v18", createdAt: now });

// 1) 真实内容变化：时间戳、版本号、人工标记和场景版本缓存都不算内容变化。
assert.equal(scriptContentChanged(script, { ...script, scriptVersion: 9, updatedAt: "2026-11-24T00:00:00.000Z" }), false);
assert.equal(scriptContentChanged(script, markScriptManualEdit(script, ["scene-a"])), false, "只改人工标记不应递增正式版本");
assert.equal(scriptContentChanged(script, { ...script, title: "第一集改" }), true);
assert.equal(scriptContentChanged(script, { ...script, scenes: [scene("scene-a", 1, "新动作 A", "旧对白 A"), script.scenes[1]] }), true);

// 2) 旧场景级标记迁移成模块记录；迁移幂等，旧保护不丢失。
const legacy = markScriptManualEdit(script, ["scene-a"]);
assert.deepEqual(scriptManualEditModules(legacy, "scene-a"), ALL_SCRIPT_MANUAL_MODULES);
const migrated = ensureScriptManualModules(legacy);
assert.deepEqual(migrated.manualEditedModules?.["scene-a"], ALL_SCRIPT_MANUAL_MODULES);
assert.deepEqual(ensureScriptManualModules(migrated), migrated, "迁移必须幂等");
assert.deepEqual(scriptManualEditModules({ ...script, manualEditedSceneIds: ["scene-a"] }, "scene-a"), ALL_SCRIPT_MANUAL_MODULES, "未迁移旧数据仍按整场保护");

// 3) 模块细分：只改对白、动作或其他字段各自留下标记，不误伤其他模块。
assert.deepEqual(scriptSceneEditModules(script.scenes[0], { ...script.scenes[0], dialogueBlocks: [block("d-new", "林舟", "新对白 A")] }), ["dialogue"]);
assert.deepEqual(scriptSceneEditModules(script.scenes[0], { ...script.scenes[0], action: "新动作 A" }), ["action"]);
assert.deepEqual(scriptSceneEditModules(script.scenes[0], { ...script.scenes[0], environment: "干燥船舱" }), ["other"]);
assert.deepEqual(scriptSceneEditModules(script.scenes[0], script.scenes[0]), []);

// 4) 底层 guard：人工对白默认拒绝；人工动作不阻止无关对白；确认后才放行。
assert.equal(guardSceneScriptWrite(script, "scene-a", "dialogue", {}).ok, true, "未编辑场景对白可以生成");
const dialogueManual = markScriptManualEdit(script, ["scene-a"], now, { "scene-a": ["dialogue"] });
const dialogueGuard = guardSceneScriptWrite(dialogueManual, "scene-a", "dialogue", {});
assert.equal(dialogueGuard.ok, false, "人工对白默认禁止覆盖");
if (!dialogueGuard.ok) assert.equal(dialogueGuard.requiresConfirmation, true);
const dialogueConfirmed = guardSceneScriptWrite(dialogueManual, "scene-a", "dialogue", { allowOverwriteManual: true });
assert.equal(dialogueConfirmed.ok, true, "明确确认后才能覆盖人工对白");
const actionManual = markScriptManualEdit(script, ["scene-a"], now, { "scene-a": ["action"] });
assert.equal(guardSceneScriptWrite(actionManual, "scene-a", "dialogue", {}).ok, true, "动作人工编辑不应误阻止对白模块");
assert.equal(guardSceneScriptWrite(actionManual, "scene-a", "scene", {}).ok, false, "动作人工编辑仍应阻止整场覆盖");
assert.equal(guardSceneScriptWrite({ ...dialogueManual, status: "locked" }, "scene-a", "dialogue", { allowOverwriteManual: true }).ok, false, "锁定剧本即使确认也必须拒绝");

// 5) 确认后只清目标模块；其他人工模块仍保留。
const clearedDialogue = clearScriptManualEditModules(dialogueManual, "scene-a", ["dialogue"]);
assert.deepEqual(scriptManualEditModules(clearedDialogue, "scene-a"), []);
assert.equal(guardSceneScriptWrite(clearedDialogue, "scene-a", "dialogue", {}).ok, true, "确认覆盖后对白模块不再被误保护");
const mixedManual = markScriptManualEdit(markScriptManualEdit(script, ["scene-a"], now, { "scene-a": ["action"] }), ["scene-a"], now, { "scene-a": ["dialogue"] });
const clearedMixed = clearScriptManualEditModules(mixedManual, "scene-a", ["dialogue"]);
assert.deepEqual(scriptManualEditModules(clearedMixed, "scene-a"), ["action"]);
assert.equal(guardSceneScriptWrite(clearedMixed, "scene-a", "dialogue", {}).ok, true);
assert.equal(guardSceneScriptWrite(clearedMixed, "scene-a", "scene", {}).ok, false, "未覆盖的动作模块仍保护整场");

// 6) 对白合并保留其他模块/场景，场景版本只推进目标场，stale 只命中目标场。
const dialogueMerged = mergeDialogueIntoScript(script, "scene-a", [block("d-new", "林舟", "新对白 A")]);
const withVersions = withNextScriptSceneVersions(script, dialogueMerged);
assert.equal(withVersions.sceneVersions?.["scene-a"], 2);
assert.equal(withVersions.sceneVersions?.["scene-b"], 1);
assert.equal(withVersions.scenes[0].action, "旧动作 A");
assert.deepEqual(withVersions.scenes[0].charactersPresent, ["char-a"]);
assert.deepEqual(withVersions.scenes[1], script.scenes[1]);
assert.deepEqual(withVersions.characterBindings, script.characterBindings);
const stale = markStoryboardStaleForScriptChange(board, script, withVersions);
assert.deepEqual(stale.changedSceneIds, ["scene-a"]);
assert.deepEqual(stale.document.stale?.shotIds, ["shot-a"]);
assert.equal(stale.document.shots.length, 2, "旧分镜必须保留");

// 7) 复制快照只建独立草稿：正式文档/版本/原快照不变，深拷贝后改草稿不影响正式分镜。
const copyPlan = planStoryboardDraftFromSnapshot({ snapshot, existing: [], episodeId: "ep-test" });
assert.equal(copyPlan.ok, true);
assert.equal(copyPlan.reused, false);
assert.match(copyPlan.draft.draftId, /^sbd-/);
assert.equal(copyPlan.draft.sourceSnapshotId, snapshot.snapshotId);
assert.equal(copyPlan.draft.sourceStoryboardVersion, 18);
assert.equal(copyPlan.draft.storyboard.storyboardVersion, 18);
assert.equal(board.shots[0].action, "旧动作", "复制不得共享可变对象引用");
copyPlan.draft.storyboard.shots[0].action = "草稿动作";
assert.equal(board.shots[0].action, "旧动作", "修改草稿不能改正式分镜");
const reused = planStoryboardDraftFromSnapshot({ snapshot, existing: [copyPlan.draft], episodeId: "ep-test" });
assert.equal(reused.reused, true, "重复点击同一快照不应创建重复草稿");
assert.equal(reused.draft.draftId, copyPlan.draft.draftId);
const legacyDraft = normalizeStoryboardDrafts([{ ...copyPlan.draft, draftId: "", status: "active" }], "ep-test")[0];
const normalizedAgain = normalizeStoryboardDrafts([legacyDraft], "ep-test")[0];
assert.equal(legacyDraft.draftId, normalizedAgain.draftId, "旧草稿缺 ID 时生成稳定 ID");
assert.equal(normalizeStoryboardDrafts(undefined, "ep-test").length, 0, "旧项目缺草稿集合时补空数组");

// 8) 草稿应用计划：来源版本不一致先要求确认；应用时备份当前，正式版本 +1，记录 draftId。
const draftAtCurrent = { ...copyPlan.draft, storyboard: { ...copyPlan.draft.storyboard, storyboardVersion: 18 }, sourceStoryboardVersion: 18 };
const applyCurrent = planStoryboardDraftApply({ current: board, draft: draftAtCurrent, script, expectedVersion: 18 });
assert.equal(applyCurrent.ok, true);
if (applyCurrent.ok) {
    assert.equal(applyCurrent.backup.version, 18);
    assert.equal(applyCurrent.newVersion, 19);
    assert.equal(applyCurrent.formal.version, 19);
    assert.equal(applyCurrent.restored.storyboardVersion, 19);
    assert.equal(applyCurrent.restored.appliedDraftId, draftAtCurrent.draftId);
    assert.equal(board.storyboardVersion, 18, "应用计划不得原地修改正式分镜");
}
const oldDraft = { ...draftAtCurrent, sourceStoryboardVersion: 17 };
const conflict = planStoryboardDraftApply({ current: board, draft: oldDraft, script, expectedVersion: 18 });
assert.equal(conflict.ok, false);
if (!conflict.ok) { assert.equal(conflict.conflict, true); assert.equal(conflict.requiresConfirmation, true); }
const conflictConfirmed = planStoryboardDraftApply({ current: board, draft: oldDraft, script, expectedVersion: 18, allowStaleDraft: true });
assert.equal(conflictConfirmed.ok, true, "用户确认旧来源版本后才允许应用");
const wrongVersion = planStoryboardDraftApply({ current: board, draft: draftAtCurrent, script, expectedVersion: 17 });
assert.equal(wrongVersion.ok, false, "正式版本已变化时必须拒绝");
const lockedShot = planStoryboardDraftApply({ current: { ...board, shots: [{ ...board.shots[0], locked: true }, board.shots[1]] }, draft: draftAtCurrent, script, expectedVersion: 18 });
assert.equal(lockedShot.ok, false, "锁定镜头存在时不得应用草稿");
const duplicateShotDraft = { ...draftAtCurrent, storyboard: { ...draftAtCurrent.storyboard, shots: [{ ...draftAtCurrent.storyboard.shots[0] }, { ...draftAtCurrent.storyboard.shots[0] }] } };
assert.equal(validateStoryboardDraftDocument(duplicateShotDraft.storyboard).ok, false, "重复 shotId 的草稿必须被拒绝");
assert.equal(planStoryboardDraftApply({ current: board, draft: duplicateShotDraft, script, expectedVersion: 18 }).ok, false);

// 9) 快照 plan 的 copy 模式必须彻底拒绝，不能绕过草稿入口修改正式分镜。
const snapshotCopy = planStoryboardSnapshotApply({ current: board, snapshot, script, expectedVersion: 18, mode: "copy" });
assert.equal(snapshotCopy.ok, false);

console.log(JSON.stringify({
    ok: true,
    tests: "stage3_2_1-core-check",
    manual: {
        legacyModules: scriptManualEditModules(migrated, "scene-a"),
        dialogueBlocks: dialogueGuard.ok ? null : dialogueGuard.code,
        actionDoesNotBlockDialogue: guardSceneScriptWrite(actionManual, "scene-a", "dialogue", {}).ok,
        sceneStillBlocks: guardSceneScriptWrite(actionManual, "scene-a", "scene", {}).ok,
    },
    dialogueMerge: { sceneVersions: withVersions.sceneVersions, stale: stale.document.stale?.shotIds, shotsKept: stale.document.shots.length },
    draft: {
        id: copyPlan.draft.draftId,
        reused: reused.reused,
        sourceVersion: copyPlan.draft.sourceStoryboardVersion,
        formalVersion: applyCurrent.ok ? applyCurrent.newVersion : null,
        conflict: !conflict.ok ? conflict.conflict : null,
        staleConfirmed: conflictConfirmed.ok,
    },
}));
