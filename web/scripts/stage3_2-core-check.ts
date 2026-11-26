// Stage 3.2 确定性测试：剧本覆盖保护、场景版本/局部 stale、快照身份与恢复计划。
// 不调用真实模型；浏览器 localForage 未参与。
import assert from "node:assert/strict";

import type {
    StudioScriptDocument,
    StudioScriptScene,
    StudioStoryboardDocument,
    StudioStoryboardVersion,
} from "../src/types/studio-production";
import {
    clearStoryboardStale,
    ensureScriptSceneVersions,
    guardEpisodeScriptWrite,
    guardSceneScriptWrite,
    markScriptManualEdit,
    markStoryboardStaleForScriptChange,
    planScriptQueue,
    planScriptRestore,
    scriptBackupPresent,
    scriptContentHash,
    withNextScriptSceneVersions,
} from "../src/lib/studio/production-protection";
import {
    createStoryboardSnapshot,
    normalizeStoryboardSnapshots,
    planStoryboardSnapshotApply,
    storyboardContentHash,
} from "../src/lib/studio/storyboard-snapshots";
import { mergeDialogueIntoScript, replaceSceneInStoryboard, replaceShotInStoryboard } from "../src/lib/studio/production-schema";

const now = "2026-11-23T00:00:00.000Z";

function block(dialogueId: string, characterId: string, speaker: string, text: string) {
    return { dialogueId, characterId, speaker, text, delivery: "平静", emotion: "克制", subtext: "", linkedAction: "", timing: "3s" };
}

function scene(sceneId: string, sceneNumber: number, action: string, dialogueText: string): StudioScriptScene {
    return {
        sceneId, sceneNumber, sceneTitle: `场景 ${sceneNumber}`, locationId: "loc-a", locationVariantId: "variant-a",
        timeOfDay: "夜", environment: "潮湿码头", charactersPresent: ["char-a"], props: ["prop-a"],
        scenePurpose: "推进", conflict: "试探", action,
        dialogueBlocks: [
            block(`d-${sceneId}-1`, "char-a", "林舟", dialogueText),
            block(`d-${sceneId}-2`, "char-b", "沈鸢", "旧对白 B"),
        ],
        transitionIn: "切", transitionOut: "切", continuityNotes: "铜钥匙保持",
    };
}

function scriptDoc(): StudioScriptDocument {
    const document = {
        id: "script-test", episodeId: "ep-test", episodeNumber: 1, title: "第一集", logline: "", synopsis: "",
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
        sourceReferences: {}, continuityDependencies: [], adaptationChanges: [],
        createdAt: now, updatedAt: now,
    };
    return document as unknown as StudioScriptDocument;
}

function shot(shotId: string, shotNumber: number, sceneId: string, locked = false) {
    return { shotId, shotNumber, sceneId, shotGroupId: `group-${sceneId}`, locked, version: 1, createdAt: now, updatedAt: now };
}

function storyboardDoc(version = 18): StudioStoryboardDocument {
    const shots = [shot("shot-a", 1, "scene-a"), shot("shot-b", 1, "scene-b")];
    return {
        id: "storyboard-test", episodeId: "ep-test", episodeNumber: 1,
        sourceScriptId: "script-test", sourceScriptVersion: 1, sourceEpisodePlanId: "plan-1", sourceBlueprintVersion: 1, sourceHandoffId: "handoff-1",
        storyboardVersion: version, status: "draft",
        groups: [
            { shotGroupId: "group-scene-a", episodeId: "ep-test", sceneId: "scene-a", groupNumber: 1, sceneTitle: "场景 1", sharedLayout: "", characterStartPositions: [], cameraAxis: "", propStates: "", timeOfDay: "夜", lighting: "", weather: "", continuityRules: [], shotIds: ["shot-a"], reviewedByUser: false, createdAt: now, updatedAt: now },
            { shotGroupId: "group-scene-b", episodeId: "ep-test", sceneId: "scene-b", groupNumber: 2, sceneTitle: "场景 2", sharedLayout: "", characterStartPositions: [], cameraAxis: "", propStates: "", timeOfDay: "夜", lighting: "", weather: "", continuityRules: [], shotIds: ["shot-b"], reviewedByUser: false, createdAt: now, updatedAt: now },
        ],
        shots: shots as never, checks: [],
        sourceSceneVersions: { "scene-a": 1, "scene-b": 1 },
        createdAt: now, updatedAt: now,
    };
}

const script = ensureScriptSceneVersions(scriptDoc());
assert.deepEqual(script.sceneVersions, { "scene-a": 1, "scene-b": 1 }, "旧脚本缺失场景版本时补 1");
assert.equal(script.sceneVersions!["scene-a"], 1);

// 1) 全剧队列固定 skip_existing：已有正式/人工/锁定均不入队，只让无剧本集通过。
const queuePlan = planScriptQueue([
    { episodeId: "ep-1", episodeNumber: 1, episodeTitle: "已有正式", script: { ...script, manualEditedSceneIds: [], manualEditedAt: undefined }, hasPlan: true, draftAllowed: true },
    { episodeId: "ep-2", episodeNumber: 2, episodeTitle: "人工修改", script: markScriptManualEdit(script, ["scene-a"]), hasPlan: true, draftAllowed: true },
    { episodeId: "ep-3", episodeNumber: 3, episodeTitle: "已锁定", script: { ...script, status: "locked" }, hasPlan: true, draftAllowed: true },
    { episodeId: "ep-4", episodeNumber: 4, episodeTitle: "无剧本", hasPlan: true, draftAllowed: true },
    { episodeId: "ep-5", episodeNumber: 5, episodeTitle: "无规划", hasPlan: false, draftAllowed: true },
    { episodeId: "ep-6", episodeNumber: 6, episodeTitle: "准入未过", hasPlan: true, draftAllowed: false },
]);
assert.deepEqual(queuePlan.queue.map((item) => item.episodeId), ["ep-4"], "只有无剧本集进入队列");
assert.deepEqual(queuePlan.skips.map((item) => [item.episodeId, item.reason]), [
    ["ep-1", "existing_script"], ["ep-2", "manual_edited"], ["ep-3", "locked"], ["ep-5", "missing_plan"], ["ep-6", "admission_blocked"],
], "跳过原因必须落为记录，不能只靠 UI 提示");

// 2) 覆盖 guard：已有剧本默认要求确认；锁定永远拒绝；确认后必须备份。
const existingGuard = guardEpisodeScriptWrite(script);
assert.equal(existingGuard.ok, false);
if (!existingGuard.ok) { assert.equal(existingGuard.requiresConfirmation, true); assert.equal(existingGuard.code, "existing_script"); }
const confirmedGuard = guardEpisodeScriptWrite(script, { allowOverwriteExisting: true });
assert.equal(confirmedGuard.ok, true);
if (confirmedGuard.ok) { assert.equal(confirmedGuard.overwrite, true); assert.equal(confirmedGuard.backupRequired, true); }
const lockedGuard = guardEpisodeScriptWrite({ ...script, status: "locked" }, { allowOverwriteExisting: true });
assert.equal(lockedGuard.ok, false, "锁定剧本即使确认覆盖也必须拒绝");
const manualSceneGuard = guardSceneScriptWrite(markScriptManualEdit(script, ["scene-a"]), "scene-a", "scene", {});
assert.equal(manualSceneGuard.ok, false);
if (!manualSceneGuard.ok) assert.equal(manualSceneGuard.requiresConfirmation, true);
const dialogueGuard = guardSceneScriptWrite(markScriptManualEdit(script, ["scene-a"]), "scene-a", "dialogue", {});
assert.equal(dialogueGuard.ok, false, "旧场景级人工标记必须按整场保护，对白重生成也要确认");
if (!dialogueGuard.ok) assert.equal(dialogueGuard.requiresConfirmation, true);
const actionOnlyGuard = guardSceneScriptWrite(markScriptManualEdit(script, ["scene-a"], now, { "scene-a": ["action"] }), "scene-a", "dialogue", {});
assert.equal(actionOnlyGuard.ok, true, "只改动作不应误阻止对白模块");
const dialogueOnlyGuard = guardSceneScriptWrite(markScriptManualEdit(script, ["scene-a"], now, { "scene-a": ["dialogue"] }), "scene-a", "dialogue", {});
assert.equal(dialogueOnlyGuard.ok, false, "人工对白默认禁止覆盖");
const dialogueOnlySceneGuard = guardSceneScriptWrite(markScriptManualEdit(script, ["scene-a"], now, { "scene-a": ["dialogue"] }), "scene-a", "scene", {});
assert.equal(dialogueOnlySceneGuard.ok, false, "人工对白仍属于场景人工编辑，整场重生成要确认");
const sceneGuardConfirmed = guardSceneScriptWrite(markScriptManualEdit(script, ["scene-a"]), "scene-a", "scene", { allowOverwriteManual: true });
assert.equal(sceneGuardConfirmed.ok, true, "整场人工修改经用户确认后才允许");
if (sceneGuardConfirmed.ok) assert.equal(sceneGuardConfirmed.backupRequired, true);
const manualEpisodeGuard = guardEpisodeScriptWrite(markScriptManualEdit(script, ["scene-a"]));
assert.equal(manualEpisodeGuard.ok, false);
if (!manualEpisodeGuard.ok) {
    assert.equal(manualEpisodeGuard.code, "manual_edited", "人工编辑必须单独记录原因，不能只按 locked 判断");
    assert.equal(manualEpisodeGuard.requiresConfirmation, true);
}
const manualEpisodeConfirmed = guardEpisodeScriptWrite(markScriptManualEdit(script, ["scene-a"]), { allowOverwriteExisting: true });
assert.equal(manualEpisodeConfirmed.ok, true);
if (manualEpisodeConfirmed.ok) assert.equal(manualEpisodeConfirmed.backupRequired, true);

// 3) 备份存在性：没有落盘快照时不得视为成功。
assert.equal(scriptBackupPresent([{ snapshotId: "scs-1" }], "scs-1"), true);
assert.equal(scriptBackupPresent([{ snapshotId: "scs-1" }], "scs-2"), false);
assert.equal(scriptBackupPresent([], "scs-1"), false, "空快照列表必须判定备份失败");
assert.equal(scriptBackupPresent([{ snapshotId: undefined }], "scs-1"), false);
assert.notEqual(scriptContentHash(script), scriptContentHash({ ...script, scenes: [scene("scene-a", 1, "新动作 A", "旧对白 A"), script.scenes[1]] }), "内容变化必须反映到 hash");
assert.equal(scriptContentHash(script), scriptContentHash({ ...script, createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z" }), "时间戳不应制造伪变化");

// 4) 场景版本只升级内容变化/顺序变化的场景，避免整集失效。
const changed = withNextScriptSceneVersions(script, { ...script, scriptVersion: 2, scenes: [scene("scene-a", 1, "新动作 A", "旧对白 A"), script.scenes[1]] });
assert.equal(changed.sceneVersions!["scene-a"], 2);
assert.equal(changed.sceneVersions!["scene-b"], 1, "未变化场景不升级");
const swapped = withNextScriptSceneVersions(script, { ...script, scenes: [script.scenes[1], script.scenes[0]] });
assert.equal(swapped.sceneVersions!["scene-a"], 2);
assert.equal(swapped.sceneVersions!["scene-b"], 2, "场景顺序变化也应升级");

// 5) 剧本变化只标记受影响场景/镜头为 stale，不删除旧分镜。
const board = storyboardDoc();
const stale = markStoryboardStaleForScriptChange(board, script, changed);
assert.deepEqual(stale.changedSceneIds, ["scene-a"], "只修改 scene-a 时不得让 scene-b 失效");
assert.deepEqual(stale.document.stale?.sceneIds, ["scene-a"]);
assert.deepEqual(stale.document.stale?.shotIds, ["shot-a"]);
assert.equal(stale.document.shots.length, 2, "旧分镜必须保留");
const cleared = clearStoryboardStale(stale.document, changed, { sceneId: "scene-a" });
assert.equal(cleared.stale, undefined);
assert.equal(cleared.sourceSceneVersions!["scene-a"], 2);
assert.equal(cleared.sourceSceneVersions!["scene-b"], 1, "局部清理不得推进其他场景来源版本");
assert.equal(cleared.shots.length, 2);

// 6) 局部重生成只替换目标范围，保留其他场景、动作、绑定与人工标记。
const manual = markScriptManualEdit(script, ["scene-b"]);
const dialogueMerged = mergeDialogueIntoScript(manual, "scene-a", [block("d-new", "char-a", "林舟", "新对白 A")] as never);
assert.equal(dialogueMerged.scriptVersion, 2);
assert.equal(dialogueMerged.scenes[0].action, "旧动作 A", "对白重生成不得改场景动作");
assert.equal(dialogueMerged.scenes[0].environment, "潮湿码头");
assert.deepEqual(dialogueMerged.scenes[0].charactersPresent, ["char-a"]);
assert.deepEqual(dialogueMerged.scenes[0].props, ["prop-a"]);
assert.equal(dialogueMerged.scenes[0].dialogueBlocks[0].text, "新对白 A");
assert.deepEqual(dialogueMerged.scenes[1], manual.scenes[1], "其他场景必须逐字段保留");
assert.deepEqual(dialogueMerged.characterBindings, manual.characterBindings);
assert.deepEqual(dialogueMerged.manualEditedSceneIds, ["scene-b"], "不得清除其他场景人工标记");

const replaced = replaceSceneInStoryboard(board, {
    episodeId: "ep-test", episodeNumber: 1, script: changed, sceneId: "scene-a", reason: "test",
    groups: [{ ...board.groups[0], shotGroupId: "group-new", shotIds: ["shot-new"] }],
    shots: [shot("shot-new", 1, "scene-a")] as never,
});
assert.equal(replaced.storyboardVersion, 19, "单场正式提交只递增一次");
assert.ok(!replaced.shots.some((item) => item.shotId === "shot-a"));
assert.ok(replaced.shots.some((item) => item.shotId === "shot-b"), "其他场景镜头必须保留");
const noIncrement = replaceSceneInStoryboard(board, {
    episodeId: "ep-test", episodeNumber: 1, script: changed, sceneId: "scene-a", reason: "test",
    groups: [{ ...board.groups[0], shotGroupId: "group-new", shotIds: ["shot-new"] }],
    shots: [shot("shot-new", 1, "scene-a")] as never, incrementVersion: false,
});
assert.equal(noIncrement.storyboardVersion, 18, "整集按场构建时中间场不得占正式版本号");
assert.equal(replaceShotInStoryboard(board, shot("shot-b", 1, "scene-b") as never, "test").storyboardVersion, 19);

// 7) 快照身份：正式/备份/冲突各自唯一；冲突不占正式版本号。
const backup18 = createStoryboardSnapshot({ document: board, snapshotType: "backup", basedOnVersion: 18, reason: "自动备份" });
const formal18 = createStoryboardSnapshot({ document: board, snapshotType: "formal", basedOnVersion: 18, reason: "正式提交" });
const conflictA = createStoryboardSnapshot({ document: board, snapshotType: "conflict", basedOnVersion: 18, reason: "并发冲突保留：任务 A" });
const conflictB = createStoryboardSnapshot({ document: { ...board, storyboardVersion: 19 }, snapshotType: "conflict", basedOnVersion: 18, reason: "并发冲突保留：任务 B" });
assert.equal(new Set([backup18.snapshotId, formal18.snapshotId, conflictA.snapshotId, conflictB.snapshotId]).size, 4, "不同快照不得共享 snapshotId");
assert.equal(formal18.version, 18);
assert.equal(conflictA.version, 18, "冲突快照不得占用新的正式版本号");
assert.equal(conflictB.version, 18);
assert.equal(conflictB.document.storyboardVersion, 18, "冲突文档不得冒充当前正式 v19");
assert.equal(conflictA.basedOnVersion, 18);
assert.equal(formal18.snapshotType, "formal");
assert.equal(conflictA.snapshotType, "conflict");
assert.equal(backup18.snapshotType, "backup");
assert.notEqual(storyboardContentHash(board), storyboardContentHash({ ...board, shots: [{ ...board.shots[0], shotNumber: 9 }, board.shots[1]] }), "实际内容变化必须反映到分镜 hash");
assert.equal(storyboardContentHash(board), storyboardContentHash({ ...board, updatedAt: "2026-11-24T00:00:00.000Z", shots: board.shots.map((item) => ({ ...item, updatedAt: "2026-11-24T00:00:00.000Z" })) }), "快照 hash 忽略时间戳变化");

const v19 = createStoryboardSnapshot({ document: { ...board, storyboardVersion: 19 }, snapshotType: "formal", basedOnVersion: 19, reason: "正式提交" });
assert.equal(v19.version, 19);
assert.equal(conflictA.version < v19.version, true, "冲突快照版本必须低于后来成功的正式版本");

// 8) 旧快照兼容：只补身份字段，刷新两次 ID 稳定，重复迁移不新增/不重复。
const legacyConflict = {
    id: "legacy-conflict", version: 18, reason: "并发冲突保留：单镜重生成", createdAt: now,
    document: { ...board, storyboardVersion: 18 },
} as unknown as StudioStoryboardVersion;
const legacyFormal = {
    id: "legacy-formal", version: 18, reason: "场景分镜正式提交 v18", createdAt: now,
    document: { ...board, storyboardVersion: 18 },
} as unknown as StudioStoryboardVersion;
const legacyInput = [legacyConflict, legacyFormal];
const normalizedOnce = normalizeStoryboardSnapshots(legacyInput, "ep-test");
const normalizedTwice = normalizeStoryboardSnapshots(normalizedOnce, "ep-test");
assert.deepEqual(normalizedOnce.map((item) => item.snapshotId), normalizedTwice.map((item) => item.snapshotId), "刷新后 snapshotId 必须稳定");
assert.equal(normalizedOnce.length, 2, "迁移不得新增快照");
assert.equal(new Set(normalizedOnce.map((item) => item.snapshotId)).size, 2);
assert.equal(normalizedOnce[0].snapshotType, "conflict");
assert.equal(normalizedOnce[1].snapshotType, "formal", "旧正式提交快照不能被误判为 backup");
assert.equal(normalizedOnce[0].document.storyboardVersion, 18, "迁移不得改旧快照文档版本");

const duplicatedLegacy = normalizeStoryboardSnapshots([legacyConflict, { ...legacyConflict }], "ep-test");
assert.equal(new Set(duplicatedLegacy.map((item) => item.snapshotId)).size, 2, "同内容旧快照也必须得到不同但稳定的 ID");
assert.deepEqual(
    normalizeStoryboardSnapshots(duplicatedLegacy, "ep-test").map((item) => item.snapshotId),
    duplicatedLegacy.map((item) => item.snapshotId),
    "重复规范化不得重新生成 ID",
);

// 9) 恢复/应用快照：先备份当前，再生成新正式版本；版本不一致/锁定镜头拒绝。
const restoreSnapshot = conflictA;
const applyPlan = planStoryboardSnapshotApply({ current: v19.document, snapshot: restoreSnapshot, script, expectedVersion: 19, mode: "apply" });
assert.equal(applyPlan.ok, true);
if (applyPlan.ok) {
    assert.equal(applyPlan.backup.version, 19, "应用前必须备份当前正式版本");
    assert.equal(applyPlan.newVersion, 20, "恢复必须产生新的正式版本，不回滚版本号");
    assert.equal(applyPlan.restored.storyboardVersion, 20);
    assert.equal(applyPlan.formal.version, 20);
    assert.equal(applyPlan.restored.restoredFromSnapshotId, restoreSnapshot.snapshotId);
    assert.equal(v19.document.storyboardVersion, 19, "计划不得原地修改当前正式分镜");
}
const stalePlan = planStoryboardSnapshotApply({ current: v19.document, snapshot: restoreSnapshot, expectedVersion: 18, mode: "apply" });
assert.equal(stalePlan.ok, false, "应用前必须重新校验当前正式版本");
const lockedBoard = { ...v19.document, shots: [{ ...v19.document.shots[0], locked: true }] };
const lockedPlan = planStoryboardSnapshotApply({ current: lockedBoard, snapshot: restoreSnapshot, expectedVersion: 19, mode: "apply" });
assert.equal(lockedPlan.ok, false, "当前存在锁定镜头时不得整集覆盖");

// 10) 剧本恢复：当前版本先备份，恢复内容作为 +1 新版本。
const scriptRestore = planScriptRestore({ ...script, scriptVersion: 3 }, { id: "script-old", snapshotId: "scs-old", document: { ...script, scriptVersion: 1 } });
assert.equal(scriptRestore.newVersion, 4);
assert.equal(scriptRestore.backup?.version, 3);
assert.equal(scriptRestore.restored.restoredFromSnapshotId, "scs-old");
assert.deepEqual(scriptRestore.restored.manualEditedSceneIds, ["scene-a", "scene-b"], "恢复内容按人工资产保护");

console.log(JSON.stringify({
    ok: true,
    tests: "stage3_2-core-check",
    scriptProtection: {
        queue: queuePlan.queue.length,
        skips: queuePlan.skips.length,
    },
    sceneVersions: { changed: changed.sceneVersions, swapped: swapped.sceneVersions },
    stale: { sceneIds: stale.document.stale?.sceneIds, shotIds: stale.document.stale?.shotIds, oldShotsKept: stale.document.shots.length },
    snapshots: { formal: v19.version, conflict: conflictA.version, normalized: normalizedOnce.map((item) => item.snapshotType) },
    apply: applyPlan.ok ? { newVersion: applyPlan.newVersion, backupVersion: applyPlan.backup.version } : { error: applyPlan.error },
    scriptRestore: { newVersion: scriptRestore.newVersion, backupVersion: scriptRestore.backup?.version },
}));
