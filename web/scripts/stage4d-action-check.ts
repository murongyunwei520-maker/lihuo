// Stage 4D 实际 action 验收：必须通过 Vite SSR 运行（action 链会加载 import.meta.env）。
// 运行：node scripts/vite-ssr-check.mjs /scripts/stage4d-action-check.ts
// 覆盖：单镜 / 整集 / 选中范围审核、失败 run 落盘、提案应用、版本冲突、人工保护、拒绝。

import assert from "node:assert/strict";
import "./stage2b-local-storage-stub";

const { applyAiProposalAction, markAiProposalConflictAction, rejectAiProposalAction, runStoryboardAiReviewAction } = await import("../src/lib/studio/stage4d-actions");
const { useStudioStore } = await import("../src/stores/use-studio-store");
const { parseStudioEnvelope, serializeStudioEnvelope } = await import("../src/lib/studio-store-persistence");
import type { StudioStateStore } from "../src/lib/studio-store-persistence";
import type { StudioProject } from "../src/types/studio";
import type {
    StudioAiAdjustmentProposal,
    StudioEpisodeProduction,
    StudioProductionShot,
    StudioScriptDocument,
    StudioShotGroup,
    StudioStoryboardDocument,
    StudioStoryboardReview,
} from "../src/types/studio-production";

const now = "2026-11-25T12:00:00.000Z";

function group(): StudioShotGroup {
    return {
        shotGroupId: "grp-1", episodeId: "ep-1", sceneId: "sc-1", groupNumber: 1, sceneTitle: "码头对峙",
        sharedLayout: "双人中景", characterStartPositions: [], cameraAxis: "A-B 轴线", propStates: "",
        timeOfDay: "夜", lighting: "冷光", weather: "小雨", continuityRules: [], shotIds: ["s1"],
        reviewedByUser: false, createdAt: now, updatedAt: now,
    };
}

function shot(overrides: Partial<StudioProductionShot> = {}): StudioProductionShot {
    return {
        shotId: "s1", episodeId: "ep-1", sceneId: "sc-1", shotGroupId: "grp-1", shotNumber: 1, duration: 5,
        shotSize: "中景", cameraPosition: "轴线左侧", cameraAngle: "平视", lens: "35mm", cameraMovement: "固定",
        composition: "双人左右站位", foreground: "雨水", midground: "两名人物", background: "仓库",
        characterBlocking: "林舟在左，沈砚在右", eyeline: "林舟看向右，沈砚看向左", action: "两人对峙",
        facialExpression: "紧绷", emotion: "警惕", dialogue: [], voiceOver: "", soundEffects: "雨声", backgroundMusic: "",
        lighting: "冷光", environment: "夜雨码头", continuityRules: [],
        characterBindings: [{ characterId: "char-a", name: "林舟", outfitId: "outfit-a" }, { characterId: "char-b", name: "沈砚", outfitId: "outfit-b" }],
        outfitBindings: [{ characterId: "char-a", outfitId: "outfit-a", description: "黑色雨衣" }, { characterId: "char-b", outfitId: "outfit-b", description: "灰色风衣" }],
        sceneBindings: { locationId: "loc-dock", locationVariantId: "variant-night" },
        propBindings: [{ propId: "prop-knife", name: "短刀", state: "出鞘" }],
        sourceReferences: {} as StudioProductionShot["sourceReferences"], sourceScriptSceneId: "sc-1",
        imagePrompt: "码头夜雨双人对峙", videoPrompt: "缓慢推近", keyframeRefs: [], status: "approved", version: 13,
        locked: false, createdAt: now, updatedAt: now, ...overrides,
    };
}

function doc(shots: StudioProductionShot[], version = 3): StudioStoryboardDocument {
    return {
        id: "sb-1", episodeId: "ep-1", episodeNumber: 1, sourceScriptId: "script-1", sourceScriptVersion: 2,
        sourceEpisodePlanId: "plan-1", sourceBlueprintVersion: 1, sourceHandoffId: "handoff-1", storyboardVersion: version,
        status: "approved", groups: [{ ...group(), shotIds: shots.map((item) => item.shotId) }], shots, checks: [], createdAt: now, updatedAt: now,
    };
}

function script(): StudioScriptDocument {
    return {
        id: "script-1", episodeId: "ep-1", episodeNumber: 1, title: "雾港夜航", logline: "", synopsis: "", durationTarget: 120,
        durationEstimate: { dialogueSeconds: 0, actionSeconds: 0, transitionSeconds: 0, pauseSeconds: 0, environmentSeconds: 0, totalSeconds: 0, deltaSeconds: 0, note: "" },
        sourceEpisodePlanId: "plan-1", sourceBlueprintVersion: 1, sourceHandoffId: "handoff-1", scriptVersion: 2, status: "approved",
        scenes: [{
            sceneId: "sc-1", sceneNumber: 1, sceneTitle: "码头对峙", locationId: "loc-dock", locationVariantId: "variant-night",
            timeOfDay: "夜", weather: "雨", environment: "夜雨码头", charactersPresent: ["char-a", "char-b"], props: [],
            scenePurpose: "建立对峙", conflict: "两人对峙", action: "两人对峙", dialogueBlocks: [],
            transitionIn: "淡入", transitionOut: "切出", continuityNotes: "",
            summary: "两人在码头对峙。", content: "林舟与沈砚在夜雨码头对峙。", dialogue: [], sourceText: "林舟与沈砚在夜雨码头对峙。",
            characterIds: ["char-a", "char-b"], locationIds: ["loc-dock"], propIds: [], manualEdited: false,
        }],
        characterBindings: [{ characterId: "char-a", name: "林舟", role: "主角", costume: "", look: "", sceneIds: ["sc-1"] }, { characterId: "char-b", name: "沈砚", role: "主角", costume: "", look: "", sceneIds: ["sc-1"] }],
        locationBindings: [], propBindings: [], sourceReferences: {} as StudioScriptDocument["sourceReferences"], continuityDependencies: [], adaptationChanges: [], createdAt: now, updatedAt: now,
    };
}

function review(version = 3, proposals: StudioAiAdjustmentProposal[] = []): StudioStoryboardReview {
    return {
        id: "review-1", episodeId: "ep-1", storyboardVersion: version, status: "pending",
        readiness: { level: "ready", summary: "", checkedAt: "", counts: { error: 0, warning: 0, suggestion: 0 } },
        checks: [], shots: [], groups: [], issues: [], findings: [], gaps: [], reviewRuns: [],
        proposals, proposalApplications: [], aiReviewRuns: [], createdAt: now, updatedAt: now,
    } as unknown as StudioStoryboardReview;
}

function project(storyboard: StudioStoryboardDocument, proposals: StudioAiAdjustmentProposal[] = []): StudioProject {
    const production = { id: "prod-1", episodeId: "ep-1", storyboard, storyboardReview: review(storyboard.storyboardVersion, proposals), script: script(), checks: [], storyboardVersions: [], storyboardWriteOperations: [] } as unknown as StudioEpisodeProduction;
    const assets = [
        { id: "char-a", kind: "character", name: "林舟", role: "主角" },
        { id: "char-b", kind: "character", name: "沈砚", role: "主角" },
        { id: "outfit-a", kind: "costume", name: "黑色雨衣" },
        { id: "outfit-b", kind: "costume", name: "灰色风衣" },
        { id: "loc-dock", kind: "scene", name: "码头" },
        { id: "prop-knife", kind: "prop", name: "短刀" },
    ] as unknown as StudioProject["assets"];
    return { id: "proj-1", title: "雾港夜航", assets, episodes: [{ id: "ep-1", title: "第一集", updatedAt: "ep-updated", scenes: [], shots: [], production }], updatedAt: "proj-updated" } as unknown as StudioProject;
}

function change(changeId: string, fieldPath: string, before: string, after: string) {
    return { changeId, shotId: "s1", fieldPath, fieldLabel: fieldPath, before, after, reason: "测试修改", impact: "仅影响该字段", evidence: "两人对峙", evidenceType: "explicit" as const, confidence: "high" as const, speculative: false };
}

function proposal(changes: ReturnType<typeof change>[], version = 3, overrides: Partial<StudioAiAdjustmentProposal> = {}): StudioAiAdjustmentProposal {
    return {
        proposalId: "prop-1", runId: "run-1", episodeId: "ep-1", storyboardVersion: version, sourceScriptVersion: 2, sourceScriptId: "script-1",
        title: "测试提案", rationale: "", confidence: "high", changes,
        decision: { status: "pending", acceptedChangeIds: [], rejectedChangeIds: [] }, createdAt: now, updatedAt: now,
        ...overrides,
    };
}

function createStore(initial: StudioProject) {
    let raw = serializeStudioEnvelope({ version: 1, state: { projects: [initial] } });
    const store: StudioStateStore = {
        async transact<T>(plan: (currentRaw: string | null) => { nextRaw?: string; result: T; verify?: (readBack: string | null, expectedRaw: string) => void }): Promise<T> {
            let result: { nextRaw?: string; result: T; verify?: (readBack: string | null, expectedRaw: string) => void };
            try {
                result = plan(raw);
            } catch (error) {
                throw error;
            }
            if (result.nextRaw !== undefined) {
                const previous = raw;
                raw = result.nextRaw;
                try {
                    result.verify?.(raw, result.nextRaw);
                } catch (error) {
                    raw = previous;
                    throw error;
                }
            }
            return result.result;
        },
        async readRaw() {
            return raw;
        },
    };
    return { store, raw: () => raw };
}

function useProject(value: StudioProject) {
    useStudioStore.setState({ projects: [value], hydrated: true, migrationDone: true });
}

function seed(kind: "shot" | "episode" | "selection") {
    const base = doc([shot()]);
    const value = project(base);
    useProject(value);
    const fake = createStore(value);
    return { base, project: value, ...fake, kind };
}

// 单镜 / 整集 / 选中范围审核
{
    const single = seed("shot");
    const result = await runStoryboardAiReviewAction({
        projectId: "proj-1", episodeId: "ep-1", scopeType: "shot", shotIds: ["s1"], store: single.store,
        reviewCall: async () => ({ parsed: { summary: "单镜", findings: [], proposals: [], warnings: [] }, trace: {} as never, promptVersion: "test-prompt", rawText: "{}" }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.persisted, true);
    const saved = parseStudioEnvelope(single.raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(saved.episodes[0].production!.storyboard.storyboardVersion, 3);
    assert.equal(saved.episodes[0].production!.storyboardReview?.aiReviewRuns?.[0]?.scope.type, "shot");
    assert.equal(saved.episodes[0].production!.storyboardReview?.aiReviewRuns?.[0]?.status, "completed");

    const episode = seed("episode");
    const episodeResult = await runStoryboardAiReviewAction({
        projectId: "proj-1", episodeId: "ep-1", scopeType: "episode", store: episode.store,
        reviewCall: async () => ({ parsed: { summary: "整集", findings: [], proposals: [], warnings: [] }, trace: {} as never, promptVersion: "test-prompt", rawText: "{}" }),
    });
    assert.equal(episodeResult.ok, true);
    const episodeSaved = parseStudioEnvelope(episode.raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(episodeSaved.episodes[0].production!.storyboardReview?.aiReviewRuns?.[0]?.scope.type, "episode");

    const selection = seed("selection");
    const selectionResult = await runStoryboardAiReviewAction({
        projectId: "proj-1", episodeId: "ep-1", scopeType: "selection", shotIds: ["s1"], store: selection.store,
        reviewCall: async () => { throw new Error("Bridge 不可用"); },
    });
    assert.equal(selectionResult.ok, false);
    assert.equal(selectionResult.persisted, true, "失败 run 也必须落盘");
    const failedSaved = parseStudioEnvelope(selection.raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(failedSaved.episodes[0].production!.storyboardReview?.aiReviewRuns?.[0]?.status, "failed");
    assert.match(failedSaved.episodes[0].production!.storyboardReview?.aiReviewRuns?.[0]?.error ?? "", /Bridge 不可用/);
    assert.equal(failedSaved.episodes[0].production!.storyboard.storyboardVersion, 3);
}

// 应用成功：版本 +1、备份 + 正式快照、审核状态、ID 稳定
{
    const base = doc([shot()]);
    const p = proposal([change("a1", "action", "两人对峙", "两人拔刀")]);
    const value = project(base, [p]);
    useProject(value);
    const fake = createStore(value);
    const result = await applyAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-1", acceptedChangeIds: ["a1"], store: fake.store });
    assert.equal(result.ok, true, `应用成功分支失败：${result.error}`);
    assert.equal(result.newVersion, 4);
    const saved = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    const production = saved.episodes[0].production!;
    assert.equal(production.storyboard.storyboardVersion, 4);
    assert.equal(production.storyboard.shots[0].action, "两人拔刀");
    assert.equal(production.storyboardReview?.storyboardVersion, 4);
    assert.equal(production.storyboardReview?.proposals?.[0]?.decision.status, "accepted");
    assert.equal(production.storyboardReview?.proposalApplications?.[0]?.status, "applied");
    assert.equal(production.storyboardReview?.proposalApplications?.[0]?.beforeVersion, 3);
    assert.equal(production.storyboardReview?.proposalApplications?.[0]?.afterVersion, 4);
    assert.ok(production.storyboardVersions.some((item) => item.snapshotType === "backup" && item.basedOnVersion === 3));
    assert.ok(production.storyboardVersions.some((item) => item.snapshotType === "formal" && item.basedOnVersion === 4));
    assert.deepEqual(production.storyboard.shots[0].characterBindings, base.shots[0].characterBindings);
    assert.deepEqual(production.storyboard.shots[0].sceneBindings, base.shots[0].sceneBindings);
    assert.deepEqual(production.storyboard.shots[0].propBindings, base.shots[0].propBindings);
}

// 版本变化后旧 pending 自动冲突：应用第一个提案后，另一个旧提案在读取/应用前已自动 conflict；显式标记不得重复成功
{
    const base = doc([shot()]);
    const pA = proposal([change("a1", "action", "两人对峙", "两人拔刀")], 3, { proposalId: "prop-a" });
    const pB = proposal([change("b1", "emotion", "警惕", "紧张")], 3, { proposalId: "prop-b" });
    const value = project(base, [pA, pB]);
    useProject(value);
    const fake = createStore(value);
    const first = await applyAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-a", acceptedChangeIds: ["a1"], store: fake.store });
    assert.equal(first.ok, true);
    const afterFirst = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    useStudioStore.setState({ projects: [afterFirst], hydrated: true, migrationDone: true });
    const marked = await markAiProposalConflictAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-b", store: fake.store });
    assert.equal(marked.ok, false, "旧提案已由版本守卫自动冲突，不能再次标记为成功");
    assert.match(marked.error ?? "", /已是.*conflict|不能重复标记/);
    const final = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    const production = final.episodes[0].production!;
    assert.equal(production.storyboard.storyboardVersion, 4, "自动冲突不得修改正式版本");
    assert.equal(production.storyboard.shots[0].emotion, "警惕");
    assert.equal(production.storyboardReview?.proposals?.find((item) => item.proposalId === "prop-b")?.decision.status, "conflict");
    assert.equal(production.storyboardReview?.proposals?.find((item) => item.proposalId === "prop-b")?.decision.autoConflict, true);
    assert.equal(production.storyboardReview?.proposalApplications?.find((item) => item.proposalId === "prop-b")?.status, "conflict");
    assert.equal(production.storyboardReview?.proposalApplications?.find((item) => item.proposalId === "prop-b")?.persisted, true, "正式版本变化必须通过写入协议持久化冲突");
    assert.equal(production.storyboardReview?.proposalApplications?.find((item) => item.proposalId === "prop-b")?.derived, false);
    assert.equal(production.storyboardReview?.proposalApplications?.find((item) => item.proposalId === "prop-b")?.acceptedChangeIds.length, 0);
    const repeat = await markAiProposalConflictAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-b", store: fake.store });
    assert.equal(repeat.ok, false, "已冲突提案不能重复标记");
    const current = await markAiProposalConflictAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-a", store: fake.store });
    assert.equal(current.ok, false, "已接受提案不能标记冲突");
}

// 同批多提案：接受一个后，另一个旧版本提案必须显式冲突，不得静默覆盖
{
    const base = doc([shot()]);
    const pA = proposal([change("a1", "action", "两人对峙", "两人拔刀")], 3, { proposalId: "prop-a" });
    const pB = proposal([change("b1", "emotion", "警惕", "紧张")], 3, { proposalId: "prop-b" });
    const value = project(base, [pA, pB]);
    useProject(value);
    const fake = createStore(value);
    const first = await applyAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-a", acceptedChangeIds: ["a1"], store: fake.store });
    assert.equal(first.ok, true, `第一次应用失败：${first.error}`);
    assert.equal(first.newVersion, 4);
    const afterFirst = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    useStudioStore.setState({ projects: [afterFirst], hydrated: true, migrationDone: true });
    const second = await applyAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-b", acceptedChangeIds: ["b1"], store: fake.store });
    assert.equal(second.ok, false);
    assert.equal(second.conflict, true, "旧版本提案必须显式版本冲突");
    const final = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(final.episodes[0].production!.storyboard.storyboardVersion, 4, "冲突提案不得再次递增版本");
    assert.equal(final.episodes[0].production!.storyboard.shots[0].emotion, "警惕");
    assert.equal(final.episodes[0].production!.storyboardReview?.proposals?.find((item) => item.proposalId === "prop-a")?.decision.status, "accepted");
    assert.equal(final.episodes[0].production!.storyboardReview?.proposals?.find((item) => item.proposalId === "prop-b")?.decision.status, "conflict");
}

// 版本冲突：不得覆盖正式，必须保留 conflict 记录
{
    const base = doc([shot()]);
    const value = project(base, [proposal([change("a1", "action", "两人对峙", "两人拔刀")], 2)]);
    useProject(value);
    const fake = createStore(value);
    const result = await applyAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-1", acceptedChangeIds: ["a1"], store: fake.store });
    assert.equal(result.ok, false);
    assert.equal(result.conflict, true);
    assert.equal(result.persisted, true, `版本冲突记录未落盘：${result.error}`);
    const saved = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(saved.episodes[0].production!.storyboard.storyboardVersion, 3);
    assert.equal(saved.episodes[0].production!.storyboardReview?.proposals?.[0]?.decision.status, "conflict");
    assert.equal(saved.episodes[0].production!.storyboardReview?.proposalApplications?.[0]?.status, "conflict");
}

// 人工编辑保护：不得覆盖，失败记录保留
{
    const base = doc([shot({ manualEditedAt: now, manualEditedFields: ["action"] })]);
    const value = project(base, [proposal([change("a1", "action", "两人对峙", "两人拔刀")])]);
    useProject(value);
    const fake = createStore(value);
    const result = await applyAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-1", acceptedChangeIds: ["a1"], store: fake.store });
    assert.equal(result.ok, false);
    assert.equal(result.persisted, true);
    assert.match((result.details ?? []).join("；"), /人工编辑/);
    const saved = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(saved.episodes[0].production!.storyboard.storyboardVersion, 3);
    assert.equal(saved.episodes[0].production!.storyboard.shots[0].action, "两人对峙");
    assert.equal(saved.episodes[0].production!.storyboardReview?.proposals?.[0]?.decision.status, "failed");
}

// 拒绝：只改决策，不改正式
{
    const base = doc([shot()]);
    const value = project(base, [proposal([change("a1", "action", "两人对峙", "两人拔刀")])]);
    useProject(value);
    const fake = createStore(value);
    const result = await rejectAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-1", note: "不需要", store: fake.store });
    assert.equal(result.ok, true, `拒绝失败：${result.error}`);
    assert.equal(result.persisted, true, `拒绝记录未落盘：${result.error}`);
    const saved = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(saved.episodes[0].production!.storyboardReview?.proposals?.[0]?.decision.status, "rejected");
    assert.equal(saved.episodes[0].production!.storyboard.storyboardVersion, 3);
}

// 资产 ID 校验：项目资产被删除后提案不能写入正式分镜，失败记录保留
{
    const base = doc([shot()]);
    const value = project(base, [proposal([change("a1", "action", "两人对峙", "两人拔刀")])]);
    value.assets = [];
    useProject(value);
    const fake = createStore(value);
    const result = await applyAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-1", acceptedChangeIds: ["a1"], store: fake.store });
    assert.equal(result.ok, false);
    assert.equal(result.conflict, false);
    assert.match(result.error ?? "", /资产/);
    assert.equal((result.details ?? []).some((detail) => detail.includes("未找到")), true);
    const saved = parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(saved.episodes[0].production!.storyboard.storyboardVersion, 3, "资产校验失败不得写入正式版本");
    assert.equal(saved.episodes[0].production!.storyboard.shots[0].action, "两人对峙");
    assert.equal(saved.episodes[0].production!.storyboardReview?.proposals?.[0]?.decision.status, "failed");
}

// 持久化失败：不得返回成功，正式分镜保持不变
{
    const base = doc([shot()]);
    const value = project(base, [proposal([change("a1", "action", "两人对峙", "两人拔刀")])]);
    useProject(value);
    const fake = createStore(value);
    const throwingStore: StudioStateStore = {
        async transact() { throw new Error("配额不足：模拟 IndexedDB 写入失败"); },
        async readRaw() { return fake.raw(); },
    };
    const result = await applyAiProposalAction({ projectId: "proj-1", episodeId: "ep-1", proposalId: "prop-1", acceptedChangeIds: ["a1"], store: throwingStore });
    assert.equal(result.ok, false);
    assert.equal(result.persisted, false, "持久化失败不得冒充已保存");
    assert.match(result.error ?? "", /配额不足|保存失败/);
    assert.equal((parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject).episodes[0].production!.storyboard.storyboardVersion, 3);

    const reviewResult = await runStoryboardAiReviewAction({
        projectId: "proj-1", episodeId: "ep-1", scopeType: "shot", shotIds: ["s1"], store: throwingStore,
        reviewCall: async () => ({ parsed: { summary: "无", findings: [], proposals: [], warnings: [] }, trace: {} as never, promptVersion: "test-prompt", rawText: "{}" }),
    });
    assert.equal(reviewResult.ok, false);
    assert.equal(reviewResult.persisted, false);
    assert.match(reviewResult.error ?? "", /未能保存|配额不足/);
    assert.equal((parseStudioEnvelope(fake.raw())?.state?.projects?.[0] as StudioProject).episodes[0].production!.storyboard.storyboardVersion, 3);
}

console.log("stage4d-action-check: shot/episode/selection review, failed run persistence, proposal apply, auto version-conflict, same-batch second proposal conflict, asset validation, manual protection, reject, storage failure passed");
