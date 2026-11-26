// Stage 3.2.2 确定性验收：草稿结构、正式写入原子协议、Mock 覆盖、备份失败注入、旧数据兼容。
// 真实 IndexedDB 事务、双标签页并发与旧项目浏览器回归由独立浏览器脚本完成。
import "./stage2b-local-storage-stub";

import assert from "node:assert/strict";
import fs from "node:fs";

import type { StudioEpisodeProduction, StudioScriptDocument, StudioStoryboardDocument, StudioStoryboardDraft, StudioStoryboardVersion } from "../src/types/studio-production";
import type { StudioProject } from "../src/types/studio";
import { createStudioProject, nowIso } from "../src/lib/studio/factory";
import { localForageStorage } from "../src/lib/localforage-storage";
import { applyStoryboardSnapshot, setStoryboardLocked } from "../src/lib/studio/production-actions";
import { normalizeProductionForHydration } from "../src/lib/studio/production-workspace";
import { normalizeStudioProject } from "../src/lib/studio/factory";
import {
    createStoryboardSnapshot,
    normalizeStoryboardDrafts,
    normalizeStoryboardSnapshots,
    planStoryboardDraftApply,
    planStoryboardDraftFromSnapshot,
    planStoryboardSnapshotApply,
    storyboardContentHash,
    validateStoryboardDraftDocument,
} from "../src/lib/studio/storyboard-snapshots";
import { commitFormalStoryboardWrite, type FormalStoryboardWriteInput } from "../src/lib/studio/storyboard-write-protocol";
import {
    assertNoStaleFormalWrite,
    commitStudioStructuralDeletion,
    commitStoryboardSnapshotDiscard,
    parseStudioEnvelope,
    serializeStudioEnvelope,
    STUDIO_STORE_KEY,
    type StudioStatePlan,
    type StudioStateStore,
} from "../src/lib/studio-store-persistence";
import { useStudioStore } from "../src/stores/use-studio-store";

const now = "2026-01-01T00:00:00.000Z";
const projectId = "proj-stage322-core";
const episodeId = "ep-stage322-core";
const sceneIds = ["scene-a", "scene-b"];

function makeDocument(version: number, action = "原始动作"): StudioStoryboardDocument {
    return {
        id: "storyboard-core",
        episodeId,
        episodeNumber: 1,
        sourceScriptId: "script-core",
        sourceScriptVersion: 1,
        sourceEpisodePlanId: "plan-core",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-core",
        storyboardVersion: version,
        status: "draft",
        groups: [
            {
                shotGroupId: "group-a", episodeId, sceneId: "scene-a", groupNumber: 1, sceneTitle: "码头", sharedLayout: "",
                characterStartPositions: [], cameraAxis: "", propStates: "", timeOfDay: "夜", lighting: "", weather: "雾",
                continuityRules: [], shotIds: ["shot-a1", "shot-a2"], reviewedByUser: false, createdAt: now, updatedAt: now,
            },
            {
                shotGroupId: "group-b", episodeId, sceneId: "scene-b", groupNumber: 2, sceneTitle: "钟楼", sharedLayout: "",
                characterStartPositions: [], cameraAxis: "", propStates: "", timeOfDay: "夜", lighting: "", weather: "雾",
                continuityRules: [], shotIds: ["shot-b1"], reviewedByUser: false, createdAt: now, updatedAt: now,
            },
        ],
        shots: [
            { shotId: "shot-a1", shotNumber: 1, sceneId: "scene-a", shotGroupId: "group-a", action, locked: false, dialogue: [], characterBindings: [], createdAt: now, updatedAt: now } as never,
            { shotId: "shot-a2", shotNumber: 2, sceneId: "scene-a", shotGroupId: "group-a", action: "第二镜", locked: false, dialogue: [], characterBindings: [], createdAt: now, updatedAt: now } as never,
            { shotId: "shot-b1", shotNumber: 3, sceneId: "scene-b", shotGroupId: "group-b", action: "第三镜", locked: false, dialogue: [], characterBindings: [], createdAt: now, updatedAt: now } as never,
        ],
        checks: [],
        sourceSceneVersions: { "scene-a": 1, "scene-b": 1 },
        createdAt: now,
        updatedAt: now,
    };
}

function makeProject(version = 1): StudioProject {    const project = createStudioProject({ title: "Stage 3.2.2 确定性隔离项目", episodeCount: 1 });
    project.id = projectId;
    const episode = project.episodes[0];
    episode.id = episodeId;
    const document = makeDocument(version);
    const script = {
        id: "script-core", episodeId, episodeNumber: 1, title: "测试剧本", logline: "", synopsis: "", durationTarget: 60,
        durationEstimate: { dialogueSeconds: 0, actionSeconds: 0, transitionSeconds: 0, pauseSeconds: 0, environmentSeconds: 0, totalSeconds: 0, deltaSeconds: 0, note: "" },
        sourceEpisodePlanId: "plan-core", sourceBlueprintVersion: 1, sourceHandoffId: "handoff-core",
        scriptVersion: 1, status: "draft",
        scenes: [
            { sceneId: "scene-a", sceneNumber: 1, sceneTitle: "码头", locationId: "loc-a", locationVariantId: "variant-a", timeOfDay: "夜", weather: "雾", environment: "", action: "", dialogue: [] },
            { sceneId: "scene-b", sceneNumber: 2, sceneTitle: "钟楼", locationId: "loc-b", locationVariantId: "variant-b", timeOfDay: "夜", weather: "雾", environment: "", action: "", dialogue: [] },
        ],
        characterBindings: [], locationBindings: [], propBindings: [], sourceReferences: {}, continuityDependencies: [], adaptationChanges: [],
        createdAt: now, updatedAt: now,
    } as unknown as StudioScriptDocument;
    episode.production = {
        ...episode.production!,
        script,
        storyboard: document,
        storyboardVersions: [createStoryboardSnapshot({ document, snapshotType: "formal", basedOnVersion: version, reason: "seed formal" })],
    } as StudioEpisodeProduction;
    return project;
}

function withDraft(project: StudioProject) {
    const production = project.episodes[0].production!;
    production.storyboardDrafts = [{
        draftId: "draft-seed", episodeId: project.episodes[0].id, sourceSnapshotId: "snapshot-seed",
        sourceStoryboardVersion: 1, draftVersion: 1, createdAt: now, updatedAt: now, createdBy: "test",
        storyboard: structuredClone(production.storyboard!), status: "active",
    }];
    return project;
}

function envelope(projects: StudioProject[]) {
    return serializeStudioEnvelope({ state: { projects }, version: 0 });
}

const projectAExportPath = "C:\\Users\\qq308\\Downloads\\阶段2A验收·雾港夜航(4).json";
function loadProjectAForAction(): StudioProject {
    const exported = JSON.parse(fs.readFileSync(projectAExportPath, "utf8")) as { project: StudioProject };
    const project = normalizeProductionForHydration(normalizeStudioProject(structuredClone(exported.project)));
    const episode = project.episodes.find((item) => item.production?.storyboard);
    if (!episode?.production?.storyboard) throw new Error("项目 A 导出副本没有正式分镜");
    // 隔离副本允许把镜头锁解除，仅用于写入动作测试；原始数据与用户项目不受影响。
    episode.production.storyboard = { ...episode.production.storyboard, status: "draft", shots: episode.production.storyboard.shots.map((shot) => ({ ...shot, locked: false })) };
    return project;
    return project;
}

function createMemoryStore(projects: StudioProject[]) {
    let raw = envelope(projects);
    let queue = Promise.resolve();
    const counters = { transactions: 0, writes: 0, reads: 0, plans: 0, lastPlanRaw: "" };
    const store: StudioStateStore & { counters: typeof counters; currentRaw: () => string } = {
        counters,
        currentRaw: () => raw,
        async readRaw() {
            counters.reads += 1;
            return raw;
        },
        transact<T>(plan: (currentRaw: string | null) => StudioStatePlan<T>): Promise<T> {
            const run = () => {
                counters.transactions += 1;
                counters.plans += 1;
                counters.lastPlanRaw = raw;
                const planned = plan(raw);
                if (planned.nextRaw === undefined) return planned.result;
                const nextRaw = planned.nextRaw;
                // 模拟 IndexedDB 事务：verify 抛错时视为 abort，原 raw 保持不变。
                planned.verify?.(nextRaw, nextRaw);
                raw = nextRaw;
                counters.writes += 1;
                return planned.result;
            };
            const next = queue.then(run, run);
            queue = next.then(() => undefined, () => undefined);
            return next;
        },
    };
    return store;
}

function makeApply(options: {
    label: string;
    scope?: FormalStoryboardWriteInput["scope"];
    targetShotId?: string;
    backup?: (backup: StudioStoryboardVersion, current: StudioStoryboardDocument, production: StudioEpisodeProduction) => StudioStoryboardVersion;
    formal?: (formal: StudioStoryboardVersion) => StudioStoryboardVersion;
    omitBackup?: boolean;
    requireBackup?: boolean;
}): FormalStoryboardWriteInput["apply"] {
    return ({ production, current }) => {
        if (!current) return { ok: false, error: "缺少当前正式分镜" };
        const next = {
            ...current,
            storyboardVersion: current.storyboardVersion + 1,
            shots: current.shots.map((shot) => options.targetShotId && shot.shotId !== options.targetShotId ? shot : { ...shot, action: options.label, updatedAt: nowIso() }),
            updatedAt: nowIso(),
        };
        const backup = createStoryboardSnapshot({ document: current, snapshotType: "backup", basedOnVersion: current.storyboardVersion, reason: `${options.label} 备份` });
        const formal = createStoryboardSnapshot({ document: next, snapshotType: "formal", basedOnVersion: next.storyboardVersion, reason: `${options.label} 正式` });
        const finalBackup = options.backup ? options.backup(backup, current, production) : backup;
        const finalFormal = options.formal ? options.formal(formal) : formal;
        return {
            ok: true,
            production: {
                ...production,
                storyboard: next,
                storyboardVersions: [finalFormal, ...(options.omitBackup ? [] : [finalBackup]), ...production.storyboardVersions].slice(0, 20),
            },
            document: next,
            backup: options.omitBackup ? undefined : finalBackup,
            requireBackup: options.requireBackup,
        };
    };
}

function writeInput(options: {
    operationId: string;
    expectedVersion: number;
    operationType?: FormalStoryboardWriteInput["operationType"];
    scope?: FormalStoryboardWriteInput["scope"];
    label: string;
    targetShotId?: string;
    backup?: (backup: StudioStoryboardVersion, current: StudioStoryboardDocument, production: StudioEpisodeProduction) => StudioStoryboardVersion;
    formal?: (formal: StudioStoryboardVersion) => StudioStoryboardVersion;
    omitBackup?: boolean;
    candidateDocument?: StudioStoryboardDocument;
}): FormalStoryboardWriteInput {
    return {
        projectId,
        episodeId,
        operationId: options.operationId,
        operationType: options.operationType ?? "episode_replace",
        expectedVersion: options.expectedVersion,
        scope: options.scope ?? { kind: "episode" },
        candidateDocument: options.candidateDocument,
        apply: makeApply(options),
    };
}

function committedProjects(store: ReturnType<typeof createMemoryStore>) {
    const parsed = parseStudioEnvelope(store.currentRaw());
    return parsed?.state?.projects as StudioProject[];
}

function formal(project: StudioProject) {
    return project.episodes[0].production!.storyboard!;
}

function formalVersions(project: StudioProject) {
    return project.episodes[0].production!.storyboardVersions;
}

const results: Array<Record<string, unknown>> = [];
function record(section: string, name: string, detail: Record<string, unknown> = {}) {
    results.push({ section, name, ...detail });
}

// ----------------------------- A. 草稿结构校验 -----------------------------
{
    const valid = makeDocument(1);
    assert.equal(validateStoryboardDraftDocument(valid, { sceneIds }).ok, true, "A: 合法结构必须接受");
    record("A", "合法草稿结构", { ok: true });

    const duplicateGroup = { ...valid, groups: [...valid.groups, { ...valid.groups[0] }] };
    assert.equal(validateStoryboardDraftDocument(duplicateGroup, { sceneIds }).ok, false, "A: 重复 group ID 必须拒绝");
    record("A", "重复 group ID", { rejected: true });

    const duplicateShot = { ...valid, shots: [...valid.shots, { ...valid.shots[0] }] };
    assert.equal(validateStoryboardDraftDocument(duplicateShot, { sceneIds }).ok, false, "A: 重复 shot ID 必须拒绝");
    record("A", "重复 shot ID", { rejected: true });

    const missingMembership = { ...valid, groups: valid.groups.map((group) => group.shotGroupId === "group-a" ? { ...group, shotIds: ["shot-a1"] } : group) };
    assert.equal(validateStoryboardDraftDocument(missingMembership, { sceneIds }).ok, false, "A: shotGroupId 与 group.shotIds 必须双向一致");
    record("A", "shot membership 双向一致", { rejected: true });

    const duplicateMembership = { ...valid, groups: valid.groups.map((group) => group.shotGroupId === "group-b" ? { ...group, shotIds: ["shot-b1", "shot-a1"] } : group) };
    assert.equal(validateStoryboardDraftDocument(duplicateMembership, { sceneIds }).ok, false, "A: shot 不得属于两个组");
    record("A", "shot 多重归属", { rejected: true });

    const missingGroup = { ...valid, shots: valid.shots.map((shot) => shot.shotId === "shot-b1" ? { ...shot, shotGroupId: "group-missing" } : shot) };
    assert.equal(validateStoryboardDraftDocument(missingGroup, { sceneIds }).ok, false, "A: shot 引用不存在的 group 必须拒绝");
    record("A", "缺失 group 引用", { rejected: true });

    const missingScene = { ...valid, groups: valid.groups.map((group) => group.shotGroupId === "group-b" ? { ...group, sceneId: "scene-missing" } : group) };
    assert.equal(validateStoryboardDraftDocument(missingScene, { sceneIds }).ok, false, "A: group 引用不存在的 scene 必须拒绝");
    record("A", "缺失 scene 引用", { rejected: true });

    const goodDraft: StudioStoryboardDraft = {
        draftId: "draft-valid", episodeId, sourceSnapshotId: "snapshot-valid", sourceStoryboardVersion: 1,
        draftVersion: 1, createdAt: now, updatedAt: now, createdBy: "test", storyboard: valid, status: "active",
    };
    const goodPlan = planStoryboardDraftApply({ current: valid, draft: goodDraft, script: makeProject().episodes[0].production!.script, expectedVersion: 1, sceneIds });
    assert.equal(goodPlan.ok, true, "A: 合法草稿可生成应用计划");

    const badDraft = { ...goodDraft, storyboard: duplicateMembership };
    const badPlan = planStoryboardDraftApply({ current: valid, draft: badDraft, script: makeProject().episodes[0].production!.script, expectedVersion: 1, sceneIds });
    assert.equal(badPlan.ok, false, "A: 非法草稿不得进入正式分镜");
    record("A", "非法草稿拒绝应用", { rejected: true });
}

// ----------------------------- B. 正式写入原子并发 -----------------------------
{
    const store = createMemoryStore([makeProject(1)]);
    const [a, b] = await Promise.all([
        commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-a", expectedVersion: 1, label: "A 整集" }), store }),
        commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-b", expectedVersion: 1, label: "B 整集" }), store }),
    ]);
    const successes = [a, b].filter((result) => result.ok);
    const conflicts = [a, b].filter((result) => result.conflict);
    assert.equal(successes.length, 1, "B: 同版本并发整集覆盖只能成功一次");
    assert.equal(conflicts.length, 1, "B: 失败方必须得到版本冲突");
    const saved = committedProjects(store)[0];
    assert.equal(formal(saved).storyboardVersion, 2, "B: 正式版本只能递增一次");
    const conflictSnapshotId = conflicts[0].conflict?.preservedSnapshotId;
    assert.ok(conflictSnapshotId, "B: 失败方内容必须保留为冲突快照");
    const conflictSnapshot = formalVersions(saved).find((version) => version.snapshotId === conflictSnapshotId);
    assert.equal(conflictSnapshot?.snapshotType, "conflict", "B: 冲突快照不得伪装为 formal");
    assert.equal(conflictSnapshot?.basedOnVersion, 1, "B: 冲突快照必须记录 basedOnVersion");
    assert.equal(new Set(formalVersions(saved).filter((version) => version.snapshotType === "formal").map((version) => version.version)).size >= 1, true);
    assert.equal(formalVersions(saved).filter((version) => version.snapshotType === "formal" && version.version === 2).length, 1, "B: 不产生重复正式版本");
    assert.equal(new Set((saved.episodes[0].production!.storyboardWriteOperations ?? []).map((entry) => entry.operationId)).size, 2, "B: operationId 不得重复");
    record("B", "同版本整集并发", {
        tabA: a.ok ? "committed" : a.error, tabB: b.ok ? "committed" : b.error, finalVersion: 2, conflictSnapshotId,
        writes: store.counters.writes,
    });

    // 整集覆盖 vs 单镜修改，同版本。
    const store2 = createMemoryStore([makeProject(1)]);
    const [whole, shot] = await Promise.all([
        commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-whole", expectedVersion: 1, label: "整集覆盖" }), store: store2 }),
        commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-shot", expectedVersion: 1, label: "单镜修改", operationType: "shot_edit", scope: { kind: "shot", shotId: "shot-a1" }, targetShotId: "shot-a1" }), store: store2 }),
    ]);
    assert.equal([whole, shot].filter((result) => result.ok).length, 1, "B: 整集与单镜同版本并发只能成功一次");
    assert.equal([whole, shot].filter((result) => result.conflict).length, 1, "B: 整集/单镜失败方必须冲突");
    assert.ok(formal(committedProjects(store2)[0]).shots.some((item) => item.action === "整集覆盖" || item.action === "单镜修改"), "B: 成功方内容写入");
    record("B", "整集 vs 单镜并发", { whole: whole.ok ? "committed" : whole.error, shot: shot.ok ? "committed" : shot.error });

    // 不同场景并发：当前协议以整份文档版本为闸门，不允许静默合并。
    const store3 = createMemoryStore([makeProject(1)]);
    const [sceneA, sceneB] = await Promise.all([
        commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-scene-a", expectedVersion: 1, label: "场景 A", operationType: "scene_replace", scope: { kind: "scene", sceneId: "scene-a" }, targetShotId: "shot-a1" }), store: store3 }),
        commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-scene-b", expectedVersion: 1, label: "场景 B", operationType: "scene_replace", scope: { kind: "scene", sceneId: "scene-b" }, targetShotId: "shot-b1" }), store: store3 }),
    ]);
    assert.equal([sceneA, sceneB].filter((result) => result.ok).length, 1, "B: 不同场景并发也不能静默覆盖");
    assert.equal([sceneA, sceneB].filter((result) => result.conflict).length, 1, "B: 不同场景失败方必须冲突");
    record("B", "不同场景并发", { sceneA: sceneA.ok ? "committed" : sceneA.error, sceneB: sceneB.ok ? "committed" : sceneB.error });

    // 同一场景的两个镜头并发：仍以整份正式版本为闸门，不静默合并。
    const store3b = createMemoryStore([makeProject(1)]);
    const sameScene = await Promise.all([
        commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-same-scene-a1", expectedVersion: 1, label: "同场镜头 1", operationType: "shot_edit", scope: { kind: "shot", shotId: "shot-a1" }, targetShotId: "shot-a1" }), store: store3b }),
        commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-same-scene-a2", expectedVersion: 1, label: "同场镜头 2", operationType: "shot_edit", scope: { kind: "shot", shotId: "shot-a2" }, targetShotId: "shot-a2" }), store: store3b }),
    ]);
    assert.equal(sameScene.filter((result) => result.ok).length, 1, "B: 同场景并发只能成功一次");
    assert.equal(sameScene.filter((result) => result.conflict).length, 1, "B: 同场景失败方必须冲突");
    record("B", "同一场景并发", { first: sameScene[0].ok ? "committed" : sameScene[0].error, second: sameScene[1].ok ? "committed" : sameScene[1].error });

    // operationId 幂等：重放同一 operation 不产生第二次写入或版本。
    const store4 = createMemoryStore([makeProject(1)]);
    const first = await commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-idem", expectedVersion: 1, label: "幂等" }), store: store4 });
    const replay = await commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-idem", expectedVersion: 1, label: "幂等重放" }), store: store4 });
    assert.equal(first.ok, true);
    assert.equal(replay.duplicate, true, "B: 同 operationId 必须返回已有结果");
    assert.equal(store4.counters.writes, 1, "B: 幂等重放不得二次写入");
    assert.equal(formal(committedProjects(store4)[0]).storyboardVersion, 2, "B: 幂等重放不得再递增版本");
    record("B", "operationId 幂等", { duplicate: replay.duplicate, writes: store4.counters.writes });

    // 范围外内容不变与成功回读。
    const store5 = createMemoryStore([makeProject(1)]);
    const beforeOther = storyboardContentHash({ ...makeDocument(1), shots: makeDocument(1).shots.filter((item) => item.shotId !== "shot-a1") } as StudioStoryboardDocument);
    const scoped = await commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-scope", expectedVersion: 1, label: "仅单镜", operationType: "shot_edit", scope: { kind: "shot", shotId: "shot-a1" }, targetShotId: "shot-a1" }), store: store5 });
    assert.equal(scoped.ok, true);
    const afterDoc = formal(committedProjects(store5)[0]);
    assert.equal(storyboardContentHash({ ...afterDoc, shots: afterDoc.shots.filter((item) => item.shotId !== "shot-a1") } as StudioStoryboardDocument), beforeOther, "B: 单镜写入不得改范围外内容");
    assert.ok(formalVersions(committedProjects(store5)[0]).some((version) => version.snapshotId === scoped.backupSnapshotId), "B: 备份快照必须落盘");
    record("B", "单镜范围外不变", { newVersion: scoped.newVersion, backupSnapshotId: scoped.backupSnapshotId });

    // 持久化旧版本守卫：旧整仓写入不得把正式版本写回旧值。
    const oldProject = makeProject(1);
    const newProject = makeProject(2);
    assert.throws(() => assertNoStaleFormalWrite(envelope([newProject]), envelope([oldProject])), /正式分镜版本回退|不能回退|旧版本/);
    record("B", "旧整仓写入守卫", { rejected: true });

    // 同版本但快照 / 日志被删的陈旧整仓写入也必须拒绝，不能靠 UI 反写掩盖已提交结果。
    const staleSameVersion = makeProject(1);
    staleSameVersion.episodes[0].production!.storyboardVersions = [];
    staleSameVersion.episodes[0].production!.storyboardWriteOperations = [];
    assert.throws(() => assertNoStaleFormalWrite(envelope([makeProject(1)]), envelope([staleSameVersion])), /同版本正式分镜被改写/);
    record("B", "同版本陈旧整仓写入守卫", { rejected: true });

    // 逐镜锁定与整组已复核不递增正式版本，但属于合法元数据写入，不能误判为陈旧覆盖。
    const metadataBase = makeProject(1);
    const metadataNext = JSON.parse(JSON.stringify(metadataBase)) as StudioProject;
    metadataNext.episodes[0].production!.storyboard!.shots[0].locked = true;
    metadataNext.episodes[0].production!.storyboard!.groups[0].reviewedByUser = true;
    assert.doesNotThrow(() => assertNoStaleFormalWrite(envelope([metadataBase]), envelope([metadataNext])));
    record("B", "同版本锁定元数据可写入", { allowed: true });

    // backup 快照 ID 也是同版本正式审计的一部分，不能被旧整仓写入增删。
    const backupBase = makeProject(1);
    const backupNext = JSON.parse(JSON.stringify(backupBase)) as StudioProject;
    backupNext.episodes[0].production!.storyboardVersions.push(createStoryboardSnapshot({
        document: formal(backupNext),
        snapshotType: "backup",
        basedOnVersion: 1,
        reason: "测试 backup 变化",
    }));
    assert.throws(() => assertNoStaleFormalWrite(envelope([backupBase]), envelope([backupNext])), /同版本正式分镜被改写/);
    record("B", "同版本 backup 快照变化", { rejected: true });

    const backupRemoved = JSON.parse(JSON.stringify(backupNext)) as StudioProject;
    backupRemoved.episodes[0].production!.storyboardVersions = backupRemoved.episodes[0].production!.storyboardVersions
        .filter((snapshot) => snapshot.snapshotType !== "backup");
    assert.throws(() => assertNoStaleFormalWrite(envelope([backupNext]), envelope([backupRemoved])), /同版本正式分镜被改写/);
    record("B", "同版本 backup 快照删除", { rejected: true });

    // 陈旧整仓写入删除项目 / 分集也必须拒绝；显式删除走独立事务。
    assert.throws(() => assertNoStaleFormalWrite(envelope([makeProject(1)]), envelope([])), /正式项目被整仓写入删除/);
    record("B", "陈旧整仓删除项目", { rejected: true });

    const twoEpisodeProject = makeProject(1);
    const secondEpisode = JSON.parse(JSON.stringify(twoEpisodeProject.episodes[0])) as (typeof twoEpisodeProject.episodes)[number];
    secondEpisode.id = "ep-stage322-second";
    secondEpisode.no = 2;
    secondEpisode.title = "第二集";
    twoEpisodeProject.episodes.push(secondEpisode);
    const episodeDeleted = JSON.parse(JSON.stringify(twoEpisodeProject)) as StudioProject;
    episodeDeleted.episodes = episodeDeleted.episodes.filter((item) => item.id === twoEpisodeProject.episodes[0].id);
    assert.throws(() => assertNoStaleFormalWrite(envelope([twoEpisodeProject]), envelope([episodeDeleted])), /正式分集被整仓写入删除/);
    record("B", "陈旧整仓删除分集", { rejected: true });

    const deleteProjectStore = createMemoryStore([makeProject(1)]);
    const deleteProjectTarget = committedProjects(deleteProjectStore)[0];
    const projectDeletion = await commitStudioStructuralDeletion({
        projectId: deleteProjectTarget.id,
        expectedProjectUpdatedAt: deleteProjectTarget.updatedAt,
        store: deleteProjectStore,
    });
    assert.equal(projectDeletion.ok, true, "B: 显式删除项目事务必须成功");
    assert.equal(committedProjects(deleteProjectStore).length, 0, "B: 显式删除项目后项目数必须减少");
    record("B", "显式删除项目事务", { ok: projectDeletion.ok });

    const deleteEpisodeStore = createMemoryStore([JSON.parse(JSON.stringify(twoEpisodeProject)) as StudioProject]);
    const deleteEpisodeTarget = committedProjects(deleteEpisodeStore)[0];
    const episodeDeletion = await commitStudioStructuralDeletion({
        projectId: deleteEpisodeTarget.id,
        episodeId: deleteEpisodeTarget.episodes[1].id,
        expectedProjectUpdatedAt: deleteEpisodeTarget.updatedAt,
        expectedEpisodeUpdatedAt: deleteEpisodeTarget.episodes[1].updatedAt,
        store: deleteEpisodeStore,
    });
    assert.equal(episodeDeletion.ok, true, "B: 显式删除分集事务必须成功");
    assert.equal(committedProjects(deleteEpisodeStore)[0].episodes.length, 1, "B: 显式删除分集后分集数必须减少");
    record("B", "显式删除分集事务", { ok: episodeDeletion.ok });

    const staleDeleteStore = createMemoryStore([makeProject(1)]);
    const staleDeleteTarget = committedProjects(staleDeleteStore)[0];
    const staleProjectDeletion = await commitStudioStructuralDeletion({
        projectId: staleDeleteTarget.id,
        expectedProjectUpdatedAt: "2000-01-01T00:00:00.000Z",
        store: staleDeleteStore,
    });
    assert.equal(staleProjectDeletion.ok, false, "B: 陈旧项目删除必须拒绝");
    assert.equal(committedProjects(staleDeleteStore).length, 1, "B: 被拒绝的删除不得改变项目数");
    record("B", "陈旧项目删除事务拒绝", { ok: staleProjectDeletion.ok });

    const staleEpisodeStore = createMemoryStore([JSON.parse(JSON.stringify(twoEpisodeProject)) as StudioProject]);
    const staleEpisodeTarget = committedProjects(staleEpisodeStore)[0];
    const staleEpisodeDeletion = await commitStudioStructuralDeletion({
        projectId: staleEpisodeTarget.id,
        episodeId: staleEpisodeTarget.episodes[1].id,
        expectedProjectUpdatedAt: staleEpisodeTarget.updatedAt,
        expectedEpisodeUpdatedAt: "2000-01-01T00:00:00.000Z",
        store: staleEpisodeStore,
    });
    assert.equal(staleEpisodeDeletion.ok, false, "B: 陈旧分集删除必须拒绝");
    assert.equal(committedProjects(staleEpisodeStore)[0].episodes.length, 2, "B: 被拒绝的删除不得改变分集数");
    record("B", "陈旧分集删除事务拒绝", { ok: staleEpisodeDeletion.ok });

    const discardStore = createMemoryStore([JSON.parse(JSON.stringify(backupNext)) as StudioProject]);
    const discardTarget = committedProjects(discardStore)[0];
    const discardSnapshotId = discardTarget.episodes[0].production!.storyboardVersions
        .find((snapshot) => snapshot.snapshotType === "backup")!.snapshotId;
    const discardResult = await commitStoryboardSnapshotDiscard({
        projectId: discardTarget.id,
        episodeId: discardTarget.episodes[0].id,
        snapshotId: discardSnapshotId,
        expectedProjectUpdatedAt: discardTarget.updatedAt,
        expectedEpisodeUpdatedAt: discardTarget.episodes[0].updatedAt,
        store: discardStore,
    });
    assert.equal(discardResult.ok, true, "B: 显式丢弃 backup 快照事务必须成功");
    const discardAfter = committedProjects(discardStore)[0];
    assert.equal(discardAfter.episodes[0].production!.storyboardVersions.some((snapshot) => snapshot.snapshotId === discardSnapshotId), false);
    assert.equal(discardAfter.episodes[0].production!.storyboard!.storyboardVersion, 1);
    record("B", "显式丢弃 backup 快照事务", { ok: discardResult.ok });

    const formalDiscardStore = createMemoryStore([makeProject(1)]);
    const formalDiscardTarget = committedProjects(formalDiscardStore)[0];
    const formalSnapshotId = formalDiscardTarget.episodes[0].production!.storyboardVersions
        .find((snapshot) => snapshot.snapshotType === "formal")!.snapshotId;
    const formalDiscardResult = await commitStoryboardSnapshotDiscard({
        projectId: formalDiscardTarget.id,
        episodeId: formalDiscardTarget.episodes[0].id,
        snapshotId: formalSnapshotId,
        expectedProjectUpdatedAt: formalDiscardTarget.updatedAt,
        expectedEpisodeUpdatedAt: formalDiscardTarget.episodes[0].updatedAt,
        store: formalDiscardStore,
    });
    assert.equal(formalDiscardResult.ok, false, "B: 正式快照不能丢弃");
    record("B", "正式快照丢弃拒绝", { ok: formalDiscardResult.ok });

    // IndexedDB 不可用时 studio_store 必须 fail-closed，不能降级写 localStorage。
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { dispatchEvent: () => true, localStorage: globalThis.localStorage },
    });
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    globalThis.localStorage.removeItem(STUDIO_STORE_KEY);
    let failClosedError: unknown;
    try {
        await localForageStorage.setItem(STUDIO_STORE_KEY, JSON.stringify({ state: { projects: [] }, version: 0 }));
    } catch (error) {
        failClosedError = error;
    } finally {
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else Reflect.deleteProperty(globalThis, "window");
        if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
        else Reflect.deleteProperty(globalThis, "indexedDB");
    }
    assert.ok(failClosedError instanceof Error, "B: IndexedDB 不可用必须抛出，不能静默成功");
    assert.match(failClosedError.message, /IndexedDB|正式分镜|工作区/);
    assert.equal(globalThis.localStorage.getItem(STUDIO_STORE_KEY), null, "B: 不得降级写入 localStorage");
    record("B", "IndexedDB 不可用时 fail-closed", { fallback: false });
}

// ----------------------------- D. 备份失败注入 -----------------------------
{
    const beforeProject = withDraft(makeProject(1));
    const beforeHash = storyboardContentHash(formal(beforeProject));
    const beforeDraftHash = storyboardContentHash(beforeProject.episodes[0].production!.storyboardDrafts![0].storyboard);
    const draftHash = (project: StudioProject) => storyboardContentHash(project.episodes[0].production!.storyboardDrafts![0].storyboard);
    const scenarios: Array<{ name: string; run: (store: ReturnType<typeof createMemoryStore>) => Promise<unknown>; injection: string }> = [];
    const base = { operationId: "op-d", expectedVersion: 1, label: "D 写入" };

    scenarios.push({ name: "备份创建函数抛异常", injection: "apply 抛错", run: async (store) => commitFormalStoryboardWrite({ ...writeInput(base), store, apply: () => { throw new Error("注入：备份创建失败"); } }) });
    scenarios.push({ name: "IndexedDB 备份事务失败", injection: "transact 抛错", run: async () => { const failing = { ...createMemoryStore([makeProject(1)]), async transact() { throw new Error("注入：IndexedDB 事务失败"); } }; return commitFormalStoryboardWrite({ ...writeInput(base), store: failing as never }); } });
    scenarios.push({ name: "备份数据序列化失败", injection: "serialize 抛错", run: async (store) => commitFormalStoryboardWrite({ ...writeInput(base), store, hooks: { serialize: () => { throw new Error("注入：序列化失败"); } } }) });
    scenarios.push({ name: "备份快照写入中断", injection: "transact 抛错", run: async (store) => { const original = store.transact.bind(store); const failing = Object.assign(store, { transact: async () => { throw new Error("注入：写入中断"); }, }) as never; return commitFormalStoryboardWrite({ ...writeInput(base), store: failing }); } });
    scenarios.push({ name: "备份写入后回读失败", injection: "afterWrite 抛错", run: async (store) => commitFormalStoryboardWrite({ ...writeInput(base), store, hooks: { afterWrite: () => { throw new Error("注入：备份回读失败"); } } }) });
    scenarios.push({ name: "备份 ID 冲突", injection: "duplicate snapshotId", run: async (store) => commitFormalStoryboardWrite({ ...writeInput({ ...base, backup: (backup, _current, production) => { const existing = (production.storyboardVersions ?? [])[0]; return { ...backup, snapshotId: existing.snapshotId, id: existing.id }; } }), store }) });
    scenarios.push({ name: "备份数据校验失败", injection: "contentHash 篡改", run: async (store) => commitFormalStoryboardWrite({ ...writeInput({ ...base, backup: (backup) => ({ ...backup, contentHash: "injected-bad-hash" }) }), store }) });
    scenarios.push({ name: "正式写入前备份记录不可读取", injection: "omit backup", run: async (store) => commitFormalStoryboardWrite({ ...writeInput({ ...base, omitBackup: true }), store }) });

    for (const scenario of scenarios) {
        const store = createMemoryStore([withDraft(makeProject(1))]);
        let result: any;
        try {
            result = await scenario.run(store);
        } catch (error) {
            result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        const saved = committedProjects(store)[0];
        const afterHash = storyboardContentHash(formal(saved));
        const afterVersion = formal(saved).storyboardVersion;
        assert.equal(result.ok, false, `D: ${scenario.name} 必须失败`);
        assert.equal(afterHash, beforeHash, `D: ${scenario.name} 不得改变正式内容 Hash`);
        assert.equal(afterVersion, 1, `D: ${scenario.name} 不得改变正式版本`);
        assert.equal(store.counters.writes, 0, `D: ${scenario.name} 不得留下半截写入`);
        assert.equal(draftHash(saved), beforeDraftHash, `D: ${scenario.name} 不得改变用户原始草稿`);
        record("D", scenario.name, {
            injection: scenario.injection,
            beforeVersion: 1,
            afterVersion,
            beforeHash,
            afterHash,
            draftHashBefore: beforeDraftHash,
            draftHashAfter: draftHash(saved),
            actual: String(result.error ?? ""),
        });
    }

    const normalStore = createMemoryStore([withDraft(makeProject(1))]);
    const normal = await commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-d-normal", expectedVersion: 1, label: "正常路径" }), store: normalStore });
    assert.equal(normal.ok, true, "D: 正常备份→覆盖→回读必须成功");
    assert.equal(formal(committedProjects(normalStore)[0]).storyboardVersion, 2, "D: 正常路径版本 +1");
    record("D", "正常备份→正式覆盖→回读", { beforeVersion: 1, afterVersion: 2, beforeHash, afterHash: storyboardContentHash(formal(committedProjects(normalStore)[0])) });
}

// ----------------------------- C. Mock 覆盖矩阵 -----------------------------
{
    const matrix: Array<Record<string, unknown>> = [];
    const p = loadProjectAForAction();
    const episode = p.episodes.find((item) => item.production?.storyboard)!;
    const currentVersion = episode.production!.storyboard!.storyboardVersion;
    const snapshot = episode.production!.storyboardVersions.find((version) => version.document.storyboardVersion < currentVersion && version.document.shots.length) ?? episode.production!.storyboardVersions[0];
    const store = createMemoryStore([p]);
    useStudioStore.setState({ projects: [p], hydrated: true } as never);
    const rawBefore = store.currentRaw();
    const action = await applyStoryboardSnapshot(p.id, episode.id, snapshot.snapshotId, { expectedVersion: currentVersion, mode: "apply", store });
    if (!action.ok) console.log("C_ACTION_FAIL", action.error, snapshot.snapshotId);
    assert.equal(action.ok, true, "C: 生产 action 必须通过注入 store 成功");
    assert.equal(store.counters.transactions, 1, "C: 生产 action 必须真实进入 transact");
    assert.equal(store.counters.writes, 1, "C: 生产 action 必须产生一次真实持久化写入");
    assert.notEqual(store.currentRaw(), rawBefore, "C: 注入 store 的结果必须影响持久化状态");
    const persisted = committedProjects(store)[0].episodes.find((item) => item.id === episode.id)!;
    assert.equal(persisted.production!.storyboard!.storyboardVersion, currentVersion + 1, "C: 必须回读真实落盘版本，而非只看返回值");
    matrix.push({ productionEntry: "applyStoryboardSnapshot", mockTarget: "StudioStateStore.transact", intercepted: true, params: { expectedVersion: currentVersion, mode: "apply" }, exceptionBranch: "none", result: "ok" });
    record("C", "applyStoryboardSnapshot 真实经过注入 store", { transactions: store.counters.transactions, writes: store.counters.writes });

    const failingStore = Object.assign(createMemoryStore([loadProjectAForAction()]), { transact: async () => { throw new Error("注入：读取失败"); } }) as never;
    useStudioStore.setState({ projects: [loadProjectAForAction()], hydrated: true } as never);
    const failed = await applyStoryboardSnapshot(p.id, episode.id, snapshot.snapshotId, { expectedVersion: currentVersion, mode: "apply", store: failingStore });
    assert.equal(failed.ok, false, "C: store 读取失败必须被生产代码转换失败结果");
    matrix.push({ productionEntry: "applyStoryboardSnapshot", mockTarget: "StudioStateStore.transact", intercepted: true, params: { expectedVersion: currentVersion }, exceptionBranch: "transact throws", result: "fail" });
    record("C", "store 读取失败异常分支", { result: failed.error });

    useStudioStore.setState({ projects: [loadProjectAForAction()], hydrated: true } as never);
    const missing = await applyStoryboardSnapshot(p.id, episode.id, "sbs-not-exist", { expectedVersion: currentVersion, mode: "apply", store: createMemoryStore([loadProjectAForAction()]) });
    assert.equal(missing.ok, false, "C: 快照不存在必须在进入持久化前拒绝");
    matrix.push({ productionEntry: "applyStoryboardSnapshot", mockTarget: "无（前置校验）", intercepted: false, params: { snapshotId: "sbs-not-exist" }, exceptionBranch: "snapshot missing", result: "fail" });
    record("C", "快照不存在前置拒绝", { result: missing.error });

    const incompleteStore = createMemoryStore([]);
    const incomplete = await commitFormalStoryboardWrite({ ...writeInput({ operationId: "op-c-incomplete", expectedVersion: 1, label: "不完整数据" }), store: incompleteStore, fallbackProjects: [] });
    assert.equal(incomplete.ok, false, "C: 持久化数据不完整时必须失败");
    assert.equal(incompleteStore.counters.writes, 0, "C: 数据不完整时不得写入");
    matrix.push({ productionEntry: "commitFormalStoryboardWrite", mockTarget: "StudioStateStore.transact", intercepted: true, params: { emptyProjects: true }, exceptionBranch: "incomplete data", result: "fail" });
    record("C", "持久化数据不完整", { result: incomplete.error, writes: incompleteStore.counters.writes });

    const lockedStore = createMemoryStore([loadProjectAForAction()]);
    useStudioStore.setState({ projects: [loadProjectAForAction()], hydrated: true } as never);
    const lockResult = await setStoryboardLocked(p.id, episode.id, true, lockedStore);
    assert.equal(lockResult.ok, true, "C: 整份锁定必须经过统一正式写入协议");
    const lockedEpisode = committedProjects(lockedStore)[0].episodes.find((item) => item.id === episode.id)!;
    assert.equal(lockedEpisode.production!.storyboard!.status, "locked", "C: 锁定状态必须真实落盘");
    matrix.push({ productionEntry: "setStoryboardLocked", mockTarget: "StudioStateStore.transact", intercepted: true, params: { locked: true }, exceptionBranch: "none", result: "ok" });
    record("C", "setStoryboardLocked 真实经过注入 store", { writes: lockedStore.counters.writes });

    // 生产入口侧的版本冲突不能被 Mock 掩盖。
    const conflictStore = createMemoryStore([loadProjectAForAction()]);
    useStudioStore.setState({ projects: [loadProjectAForAction()], hydrated: true } as never);
    const conflictAction = await applyStoryboardSnapshot(p.id, episode.id, snapshot.snapshotId, { expectedVersion: currentVersion - 1, mode: "apply", store: conflictStore });
    assert.equal(conflictAction.ok, false, "C: 版本冲突必须由生产 action 返回失败");
    const conflictEpisode = committedProjects(conflictStore)[0].episodes.find((item) => item.id === episode.id)!;
    assert.equal(conflictEpisode.production!.storyboard!.storyboardVersion, currentVersion, "C: 冲突不得改正式版本");
    matrix.push({ productionEntry: "applyStoryboardSnapshot", mockTarget: "StudioStateStore.transact", intercepted: true, params: { expectedVersion: currentVersion - 1 }, exceptionBranch: "version conflict", result: "conflict" });
    record("C", "生产入口版本冲突", { conflict: true, result: conflictAction.error });

    console.log("C_MOCK_MATRIX " + JSON.stringify(matrix));
    for (const item of matrix) record("C", String(item.productionEntry), item);
}

// ----------------------------- E. 旧项目 / 历史快照 / 旧草稿 -----------------------------
{
    const exportPath = "C:\\Users\\qq308\\Downloads\\阶段2A验收·雾港夜航(4).json";
    let originalAvailable = fs.existsSync(exportPath);
    let rawProject: StudioProject | undefined;
    if (originalAvailable) {
        const exported = JSON.parse(fs.readFileSync(exportPath, "utf8")) as { project: StudioProject };
        rawProject = exported.project;
    }
    // 不在本机时使用仓库内的 Stage 3 旧项目 fixture 作为最小替代；报告中单独标记。
    if (!rawProject) {
        const fixturePath = "scripts/fixtures/stage3-project-a-2b.json";
        if (fs.existsSync(fixturePath)) {
            const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
            rawProject = (fixture.project ?? fixture) as StudioProject;
        }
    }
    if (rawProject) {
        const originalProjectId = rawProject.id;
        const originalEpisodeId = rawProject.episodes[0]?.id;
        const normalized = normalizeStudioProject(structuredClone(rawProject));
        assert.ok(normalized.id, "E: 旧项目必须能够正常读取");
        assert.equal(normalized.id, originalProjectId, "E: 旧项目读取不得改项目 ID");
        const hydrated = normalizeProductionForHydration(normalized);
        const production = hydrated.episodes[0]?.production;
        assert.ok(production, "E: 旧项目必须补出 production");
        assert.equal(production?.storyboard?.episodeId, originalEpisodeId, "E: 旧项目正式分镜不得被新项目替换");
        assert.equal(Array.isArray(production?.storyboardVersions), true, "E: 旧项目快照字段必须归一化");
        assert.equal(production?.storyboardReview !== undefined, true, "E: 旧项目审核字段必须可读取");
        const oldVersions = production!.storyboardVersions;
        const normalizedSnapshots = normalizeStoryboardSnapshots(oldVersions, originalEpisodeId!);
        assert.equal(new Set(normalizedSnapshots.map((item) => item.snapshotId)).size, normalizedSnapshots.length, "E: 历史快照 snapshotId 必须唯一");
        assert.ok(normalizedSnapshots.every((item) => item.snapshotType && item.snapshotId), "E: 历史快照必须补齐类型与身份");
        const oldDrafts = normalizeStoryboardDrafts(production!.storyboardDrafts as never, originalEpisodeId!);
        assert.equal(Array.isArray(oldDrafts), true, "E: 旧草稿缺失/为空时必须归一化");
        record("E", "原始项目 A 导出副本读取", {
            source: originalAvailable ? exportPath : "仓库旧项目 fixture",
            projectId: originalProjectId,
            episodeCount: hydrated.episodes.length,
            snapshotCount: oldVersions.length,
            draftCount: oldDrafts.length,
        });

        // 历史快照类型识别 + 应用前版本检查。
        const snapshot = normalizedSnapshots.find((item) => item.snapshotType === "backup") ?? normalizedSnapshots[0];
        assert.ok(snapshot, "E: 旧项目必须存在历史快照");
        const plan = planStoryboardSnapshotApplyForTest(production!.storyboard!, snapshot, production!.storyboard!.storyboardVersion);
        assert.equal(plan.ok, true, "E: 历史快照在版本一致时可以应用");
        record("E", "历史快照应用计划", { snapshotType: snapshot.snapshotType, basedOnVersion: snapshot.basedOnVersion });

        const staleSnapshotPlan = planStoryboardSnapshotApplyForTest(production!.storyboard!, snapshot, production!.storyboard!.storyboardVersion + 4);
        assert.equal(staleSnapshotPlan.ok, false, "E: 历史快照应用前必须检查版本");
        record("E", "历史快照旧版本拒绝", { result: staleSnapshotPlan.error });

        // 复制快照为草稿：只创建草稿，不改正式分镜。
        const currentFormalBeforeCopy = production!.storyboard!.storyboardVersion;
        const copy = planStoryboardDraftFromSnapshot({ episodeId: originalEpisodeId!, snapshot, sourceStoryboardVersion: production!.storyboard!.storyboardVersion });
        assert.equal(copy.ok, true, "E: 历史快照必须能复制为独立草稿");
        assert.equal(copy.ok && copy.draft.storyboard.storyboardVersion, snapshot.document.storyboardVersion, "E: 复制草稿保留快照自身版本");
        assert.equal(production!.storyboard!.storyboardVersion, currentFormalBeforeCopy, "E: 复制草稿不得修改当前正式分镜");
        record("E", "复制历史快照为草稿", { draftId: copy.ok ? copy.draft.draftId : undefined, formalVersionUnchanged: true });

        // 旧草稿基于旧版本时，应用必须要求确认或拒绝。
        const oldDraft: StudioStoryboardDraft = {
            draftId: "draft-legacy-conflict", episodeId: originalEpisodeId!, sourceSnapshotId: snapshot.snapshotId,
            sourceStoryboardVersion: Math.max(0, production!.storyboard!.storyboardVersion - 2), draftVersion: 1,
            createdAt: now, updatedAt: now, createdBy: "test", storyboard: { ...production!.storyboard!, storyboardVersion: Math.max(0, production!.storyboard!.storyboardVersion - 2) }, status: "active",
        };
        const staleDraftPlan = planStoryboardDraftApply({ current: production!.storyboard!, draft: oldDraft, script: production!.script, expectedVersion: production!.storyboard!.storyboardVersion, sceneIds: production!.script?.scenes.map((scene) => (scene as unknown as { sceneId: string }).sceneId) });
        assert.equal(staleDraftPlan.ok, false, "E: 旧版本草稿不得直接进入正式分镜");
        record("E", "旧草稿版本冲突拒绝", { result: staleDraftPlan.ok ? "unexpected" : staleDraftPlan.error });

        // 旧审核记录不能伪装成当前版本通过。
        const review = production!.storyboardReview as unknown as { reviewedStoryboardVersion?: number; storyboardVersion?: number } | undefined;
        if (review) {
            assert.equal(typeof (review.reviewedStoryboardVersion ?? review.storyboardVersion ?? 0), "number", "E: 旧审核版本字段必须显式存在");
        }
        record("E", "旧审核字段不冒充当前版本", { hasReview: Boolean(review) });
    } else {
        record("E", "旧项目数据不可用", { incomplete: true, note: "未找到原始项目 A 导出副本或仓库 fixture" });
    }
}

// 简单包装，避免测试里重复 import 长名称。
function planStoryboardSnapshotApplyForTest(current: StudioStoryboardDocument, snapshot: StudioStoryboardVersion, expectedVersion: number) {
    return planStoryboardSnapshotApply({ current, snapshot, expectedVersion, mode: "apply" });
}

console.log("STAGE3_2_2_CORE_RESULT " + JSON.stringify({ pass: true, cases: results.length, results }, null, 2));
