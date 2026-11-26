// Stage 4A 确定性测试：审核状态、审核记录、部分失败、结构检查、readiness、旧数据兼容。
// 不调用模型；不读取真实项目数据。
import assert from "node:assert/strict";

import type {
    StudioEpisodeProduction,
    StudioProductionShot,
    StudioScriptDocument,
    StudioStoryboardDocument,
    StudioStoryboardReview,
    StudioStoryboardShotReview,
} from "../src/types/studio-production";
import {
    analyzeStoryboardReview,
    buildStoryboardReviewIssues,
    createEmptyStoryboardReview,
    effectiveShotReviewStatus,
    isShotLocked,
    normalizeStoryboardReview,
    planStoryboardReviewRefresh,
    planStoryboardReviewStatus,
    reviewStats,
} from "../src/lib/studio/review-engine";
import { validateStoryboardDraftDocument } from "../src/lib/studio/storyboard-snapshots";
import { normalizeEpisodeProduction } from "../src/lib/studio/production-workspace";

const now = "2026-11-23T08:00:00.000Z";

function scene(sceneId: string, sceneNumber: number, title: string) {
    return {
        sceneId,
        sceneNumber,
        sceneTitle: title,
        locationId: "loc-a",
        locationVariantId: "variant-night",
        timeOfDay: "夜",
        environment: "潮湿码头",
        charactersPresent: ["char-a"],
        props: ["prop-key"],
        scenePurpose: "推进悬念",
        conflict: "试探",
        action: "林舟握紧铜钥匙",
        dialogueBlocks: [],
        transitionIn: "切",
        transitionOut: "切",
        continuityNotes: "钥匙在左手",
        createdAt: now,
        updatedAt: now,
    };
}

function scriptDoc(): StudioScriptDocument {
    return {
        id: "script-stage4a",
        episodeId: "ep-stage4a",
        episodeNumber: 1,
        title: "第一集",
        logline: "林舟在码头找到铜钥匙",
        synopsis: "码头夜雾中，林舟与守钟人交接钥匙。",
        durationTarget: 30,
        durationEstimate: {
            dialogueSeconds: 6,
            actionSeconds: 12,
            transitionSeconds: 0,
            pauseSeconds: 0,
            environmentSeconds: 0,
            totalSeconds: 30,
            deltaSeconds: 0,
            note: "",
        },
        sourceEpisodePlanId: "plan-1",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-1",
        scriptVersion: 1,
        status: "draft",
        scenes: [scene("scene-a", 1, "码头入口"), scene("scene-b", 2, "钟楼底层")],
        characterBindings: [
            { characterId: "char-a", name: "林舟", role: "引航员", costume: "深灰风衣", look: "", sceneIds: ["scene-a", "scene-b"] },
            { characterId: "char-b", name: "守钟人", role: "修钟师", costume: "旧呢帽", look: "", sceneIds: ["scene-a", "scene-b"] },
        ],
        locationBindings: [{ locationId: "loc-a", name: "码头", variantId: "variant-night", timeOfDay: "夜", weather: "雾", description: "", sceneIds: ["scene-a", "scene-b"] }],
        propBindings: [{ propId: "prop-key", name: "铜钥匙", holderCharacterId: "char-a", locationId: "loc-a", state: "发热", important: true, sceneIds: ["scene-a", "scene-b"] }],
        sourceReferences: {} as never,
        continuityDependencies: [],
        adaptationChanges: [],
        createdAt: now,
        updatedAt: now,
    } as StudioScriptDocument;
}

function shot(input: {
    shotId: string;
    shotNumber: number;
    sceneId?: string;
    shotGroupId?: string;
    duration?: number;
    locked?: boolean;
    dialogue?: StudioProductionShot["dialogue"];
    imagePrompt?: string;
    videoPrompt?: string;
    action?: string;
    characterBlocking?: string;
    continuityRules?: string[];
    characterBindings?: StudioProductionShot["characterBindings"];
    propBindings?: StudioProductionShot["propBindings"];
    shotSize?: string;
    cameraPosition?: string;
    cameraMovement?: string;
}): StudioProductionShot {
    return {
        shotId: input.shotId,
        episodeId: "ep-stage4a",
        sceneId: input.sceneId ?? "scene-a",
        shotGroupId: input.shotGroupId ?? "group-a",
        shotNumber: input.shotNumber,
        duration: input.duration ?? 10,
        shotSize: input.shotSize ?? "中景",
        cameraPosition: input.cameraPosition ?? "平视",
        cameraAngle: "正面",
        lens: "35mm",
        cameraMovement: input.cameraMovement ?? "固定",
        composition: "人物在左三分之一",
        foreground: "湿栏杆",
        midground: "林舟与守钟人",
        background: "码头灯",
        characterBlocking: input.characterBlocking ?? "林舟站在画面左侧，面向守钟人",
        eyeline: "看向对方",
        action: input.action ?? "递出铜钥匙",
        facialExpression: "克制",
        emotion: "警觉",
        dialogue: input.dialogue ?? [],
        voiceOver: "",
        soundEffects: "雾气中的水声",
        backgroundMusic: "",
        lighting: "冷色侧光",
        environment: "潮湿码头",
        continuityRules: input.continuityRules ?? ["铜钥匙保持在左手"],
        characterBindings: input.characterBindings ?? [{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "守钟人" }],
        outfitBindings: [],
        sceneBindings: { locationId: "loc-a", locationVariantId: "variant-night" },
        propBindings: input.propBindings ?? [{ propId: "prop-key", name: "铜钥匙", state: "发热" }],
        sourceReferences: {} as never,
        sourceScriptSceneId: input.sceneId ?? "scene-a",
        imagePrompt: input.imagePrompt ?? "东方奇幻码头夜景，林舟递出铜钥匙，冷雾，35mm，中景",
        videoPrompt: input.videoPrompt ?? "林舟在码头把铜钥匙递给守钟人，镜头固定，冷雾缓慢流动",
        keyframeRefs: [],
        status: "draft",
        version: 1,
        locked: input.locked ?? false,
        createdAt: now,
        updatedAt: now,
    };
}

function group(shotGroupId: string, sceneId: string, groupNumber: number, shotIds: string[], title: string) {
    return {
        shotGroupId,
        episodeId: "ep-stage4a",
        sceneId,
        groupNumber,
        sceneTitle: title,
        sharedLayout: "林舟在左，守钟人在右，铜钥匙在两人之间",
        characterStartPositions: [{ characterId: "char-a", position: "画面左侧", orientation: "面向右", eyeline: "看向守钟人" }],
        cameraAxis: "轴线沿码头横向，从左向右",
        propStates: "铜钥匙在林舟左手",
        timeOfDay: "夜",
        lighting: "冷色侧光",
        weather: "雾",
        continuityRules: ["林舟始终在左，守钟人始终在右"],
        shotIds,
        reviewedByUser: false,
        createdAt: now,
        updatedAt: now,
    };
}

function storyboardDoc(version = 3): StudioStoryboardDocument {
    return {
        id: "storyboard-stage4a",
        episodeId: "ep-stage4a",
        episodeNumber: 1,
        sourceScriptId: "script-stage4a",
        sourceScriptVersion: 1,
        sourceEpisodePlanId: "plan-1",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-1",
        storyboardVersion: version,
        status: "draft",
        groups: [group("group-a", "scene-a", 1, ["shot-a", "shot-b"], "码头入口"), group("group-b", "scene-b", 2, ["shot-c"], "钟楼底层")],
        shots: [
            shot({ shotId: "shot-a", shotNumber: 1, sceneId: "scene-a", shotGroupId: "group-a", duration: 10, dialogue: [{ characterId: "char-a", speaker: "林舟", text: "钥匙在这里。", delivery: "低声", emotion: "克制" }] }),
            shot({ shotId: "shot-b", shotNumber: 2, sceneId: "scene-a", shotGroupId: "group-a", duration: 10, action: "守钟人接过铜钥匙，后退半步" }),
            shot({ shotId: "shot-c", shotNumber: 3, sceneId: "scene-b", shotGroupId: "group-b", duration: 10, action: "林舟抬头看向钟楼" }),
        ],
        checks: [],
        sourceSceneVersions: { "scene-a": 1, "scene-b": 1 },
        createdAt: now,
        updatedAt: now,
    };
}

function statusRecord(shotId: string, status: StudioStoryboardShotReview["status"], version = 3): StudioStoryboardShotReview {
    return { shotId, status, note: "", storyboardVersion: version, reviewedAt: now, reviewedBy: "local-user" };
}

function reviewFor(doc: StudioStoryboardDocument, shots: Record<string, StudioStoryboardShotReview> = {}): StudioStoryboardReview {
    return {
        ...createEmptyStoryboardReview(doc.episodeId, doc.storyboardVersion, now),
        shots,
        updatedAt: now,
    };
}

function codes(issues: ReturnType<typeof buildStoryboardReviewIssues>) {
    return issues.map((issue) => issue.code);
}

// 1. 初始审核、通过、批量部分成功与审核记录
{
    const doc = storyboardDoc();
    const base = reviewFor(doc);
    const first = planStoryboardReviewStatus({
        document: doc,
        review: base,
        shotIds: ["shot-a", "shot-b", "shot-c"],
        status: "approved",
        action: "approve",
        expectedVersion: doc.storyboardVersion,
        now,
    });
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.updated.length, 3);
    assert.equal(first.ok && first.review.audits.length, 3);
    assert.equal(first.ok && first.review.shots["shot-a"].status, "approved");
    assert.equal(first.ok && first.review.readiness.status, "ready_for_video");
    assert.equal(first.ok && first.review.storyboardVersion, doc.storyboardVersion);
    assert.equal(doc.storyboardVersion, 3, "审核写入不能改变正式分镜版本");
    assert.equal(first.ok && first.review.issues.some((issue) => issue.status === "open" && issue.level === "error"), false);

    const partial = planStoryboardReviewStatus({
        document: doc,
        review: first.ok ? first.review : base,
        shotIds: ["shot-a", "shot-b", "shot-c", "missing-shot"],
        status: "needs_revision",
        action: "needs_revision",
        expectedVersion: doc.storyboardVersion,
        now,
    });
    assert.equal(partial.ok, true);
    assert.equal(partial.ok && partial.updated.length, 3);
    assert.equal(partial.ok && partial.skipped.some((item) => item.shotId === "missing-shot" && item.reason === "missing"), true);
    assert.equal(partial.ok && partial.review.shots["shot-a"].status, "needs_revision");
}

// 2. 锁定、stale、旧版本和版本冲突全部走跳过 / 冲突
{
    const doc = storyboardDoc(5);
    doc.shots[1].locked = true;
    const old = reviewFor(doc, { "shot-a": statusRecord("shot-a", "approved", 3), "shot-c": statusRecord("shot-c", "approved", 5) });
    const plan = planStoryboardReviewStatus({
        document: doc,
        review: old,
        shotIds: ["shot-a", "shot-b", "shot-c"],
        status: "approved",
        action: "approve",
        expectedVersion: 5,
        now,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.ok && plan.updated.length, 0);
    assert.equal(plan.ok && plan.skipped.some((item) => item.shotId === "shot-a" && item.reason === "stale"), true);
    assert.equal(plan.ok && plan.skipped.some((item) => item.shotId === "shot-b" && item.reason === "locked"), true);
    assert.equal(plan.ok && plan.skipped.some((item) => item.shotId === "shot-c" && item.reason === "unchanged"), true);
    assert.equal(effectiveShotReviewStatus(doc, old, doc.shots[0]), "stale");
    assert.equal(effectiveShotReviewStatus(doc, old, doc.shots[1]), "pending", "4B：锁定不是审核状态");
    assert.equal(isShotLocked(doc, doc.shots[1]), true);
    assert.equal(reviewStats(doc, old, []).locked, 1);

    const conflict = planStoryboardReviewStatus({
        document: doc,
        review: old,
        shotIds: ["shot-a"],
        status: "approved",
        action: "approve",
        expectedVersion: 4,
        now,
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.ok === false && conflict.conflict, true);
}

// 3. 结构检查：重复组、跨组引用、缺失镜头、非法时长、未知场景、双向一致性
{
    const doc = storyboardDoc();
    doc.groups.push({ ...doc.groups[0], groupNumber: 9, shotIds: ["shot-a"] });
    doc.groups[1].shotIds = ["shot-c", "missing-shot"];
    doc.shots[2].duration = 0;
    doc.shots[2].sceneId = "scene-missing";
    doc.shots[0].shotGroupId = "group-missing";
    const issues = buildStoryboardReviewIssues({ document: doc, script: scriptDoc(), now });
    const found = codes(issues);
    assert.equal(found.includes("group_duplicate_id"), true);
    assert.equal(found.includes("shot_shared_by_groups"), true);
    assert.equal(found.includes("group_missing_shot"), true);
    assert.equal(found.includes("shot_duration_invalid"), true);
    assert.equal(found.includes("shot_unknown_scene"), true);
    assert.equal(found.includes("shot_unknown_group"), true);
    assert.equal(found.includes("group_duplicate_shot_ref"), false, "当前测试组未重复引用同一镜头，只验证跨组");
}

// 4. 草稿结构校验：4A 前置验收 A
{
    const valid = storyboardDoc();
    assert.equal(validateStoryboardDraftDocument(valid).ok, true);

    const duplicateGroup = storyboardDoc();
    duplicateGroup.groups.push({ ...duplicateGroup.groups[0] });
    assert.equal(validateStoryboardDraftDocument(duplicateGroup).ok, false);

    const crossGroup = storyboardDoc();
    crossGroup.groups[1].shotIds.push("shot-a");
    assert.equal(validateStoryboardDraftDocument(crossGroup).ok, false);
    assert.match(validateStoryboardDraftDocument(crossGroup).error ?? "", /同时被镜头组/);

    const missingShot = storyboardDoc();
    missingShot.groups[1].shotIds.push("missing-shot");
    assert.equal(validateStoryboardDraftDocument(missingShot).ok, false);

    const notRegistered = storyboardDoc();
    notRegistered.groups[0].shotIds = ["shot-a"];
    assert.equal(validateStoryboardDraftDocument(notRegistered).ok, false);
    assert.match(validateStoryboardDraftDocument(notRegistered).error ?? "", /未登记/);

    const duplicateRef = storyboardDoc();
    duplicateRef.groups[0].shotIds = ["shot-a", "shot-a", "shot-b"];
    assert.equal(validateStoryboardDraftDocument(duplicateRef).ok, false);
}

// 5. readiness：pending -> not_ready；有 Error -> blocked；全部锁定但仍待审 -> not_ready
{
    const doc = storyboardDoc();
    const empty = analyzeStoryboardReview({ document: doc, script: scriptDoc(), now });
    assert.equal(empty.readiness.status, "not_ready");
    assert.equal(empty.stats.pending, 3);
    assert.equal(empty.stats.total, 3);

    const withError = storyboardDoc();
    withError.shots[0].duration = 0;
    const blocked = analyzeStoryboardReview({ document: withError, script: scriptDoc(), now });
    assert.equal(blocked.readiness.status, "blocked");

    const locked = storyboardDoc();
    locked.shots.forEach((item) => { item.locked = true; });
    const lockedAnalysis = analyzeStoryboardReview({ document: locked, script: scriptDoc(), now });
    assert.equal(lockedAnalysis.statuses["shot-a"], "pending", "锁定不能变成审核状态");
    assert.equal(lockedAnalysis.stats.locked, 3);
    assert.equal(lockedAnalysis.stats.approved, 0);
    assert.equal(lockedAnalysis.readiness.status, "not_ready", "全部锁定但都未审核，不能进入视频生成");
}

// 6. 刷新检查只更新 issues / readiness，不改审核结论和审核记录
{
    const doc = storyboardDoc();
    doc.shots[0].imagePrompt = "";
    const initial = reviewFor(doc, { "shot-a": statusRecord("shot-a", "approved"), "shot-b": statusRecord("shot-b", "approved"), "shot-c": statusRecord("shot-c", "approved") });
    const refreshed = planStoryboardReviewRefresh({ document: doc, script: scriptDoc(), review: initial, now: "2026-11-23T09:00:00.000Z" });
    assert.equal(refreshed.shots["shot-a"].status, "approved");
    assert.equal(refreshed.audits.length, initial.audits.length);
    assert.equal(refreshed.issues.some((issue) => issue.code === "shot_prompt_empty" && issue.status === "open"), true);
    assert.equal(refreshed.readiness.status, "not_ready", "空提示词会产生 Warning，阻止 ready");
}

// 7. 统计、旧数据归一化、锁定 / stale 与 issue 状态保留
{
    const doc = storyboardDoc(7);
    const review = reviewFor(doc, {
        "shot-a": statusRecord("shot-a", "approved", 7),
        "shot-b": statusRecord("shot-b", "needs_revision", 7),
        "shot-c": statusRecord("shot-c", "approved", 5),
    });
    const analysis = analyzeStoryboardReview({ document: doc, script: scriptDoc(), review, now });
    assert.equal(analysis.stats.total, 3);
    assert.equal(analysis.stats.approved, 1);
    assert.equal(analysis.stats.needsRevision, 1);
    assert.equal(analysis.stats.stale, 1);
    assert.equal(analysis.statuses["shot-c"], "stale");

    const normalized = normalizeStoryboardReview(undefined, doc, now);
    assert.ok(normalized);
    assert.equal(normalized?.storyboardVersion, 7);
    assert.equal(normalized?.shots["shot-a"]?.status, undefined);

    const oldReview = { ...review, issues: [{ id: "old-issue", level: "warning" as const, code: "legacy", category: "旧", message: "旧问题", suggestion: "", episodeNumber: 1, source: "deterministic" as const, status: "accepted" as const, createdAt: now, updatedAt: now }] };
    const preserved = normalizeStoryboardReview(oldReview, doc, now);
    assert.equal(preserved?.issues[0].status, "accepted");

    const stats = reviewStats(doc, review, analysis.issues);
    assert.equal(stats.errors, 0);
    assert.equal(stats.total, 3);
}

// 8. Stage 3.2.1 兼容：normalizeEpisodeProduction 只补审核壳，不篡改旧剧本 / 分镜 / 草稿
{
    const script = scriptDoc();
    const storyboard = storyboardDoc();
    const production = {
        version: 1,
        script,
        scriptVersions: [],
        storyboard,
        storyboardVersions: [],
        storyboardDrafts: [],
        checks: [],
        updatedAt: now,
    } as StudioEpisodeProduction;
    const normalized = normalizeEpisodeProduction(production);
    assert.ok(normalized.storyboardReview);
    assert.equal(normalized.storyboardReview?.storyboardVersion, storyboard.storyboardVersion);
    assert.equal(normalized.storyboard?.storyboardVersion, storyboard.storyboardVersion);
    assert.equal(normalized.script?.scriptVersion, script.scriptVersion);
    assert.equal(normalized.storyboardDrafts.length, 0);
}

// 9. 统计口径：reviewed 只等于 approved；locked 单列
{
    const doc = storyboardDoc();
    doc.shots[0].locked = true;
    const review = reviewFor(doc, { "shot-a": statusRecord("shot-a", "approved"), "shot-b": statusRecord("shot-b", "approved") });
    const stats = reviewStats(doc, review, buildStoryboardReviewIssues({ document: doc, script: scriptDoc(), now }));
    assert.equal(stats.locked, 1);
    assert.equal(stats.approved, 2);
    assert.equal(stats.reviewed, 2);
    doc.shots[1].locked = true;
    const withPendingLocked = reviewStats(doc, reviewFor(doc, { "shot-a": statusRecord("shot-a", "approved") }), buildStoryboardReviewIssues({ document: doc, script: scriptDoc(), now }));
    assert.equal(withPendingLocked.locked, 2);
    assert.equal(withPendingLocked.approved, 1);
    assert.equal(withPendingLocked.pending, 2);
    assert.equal(withPendingLocked.reviewed, 1, "pending + locked 不能计入已通过");
}

console.log("stage4a-core-check: 9 groups passed");
