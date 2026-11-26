// Stage 4A 严格版本过期验收：A 单镜内容变化、B 仅版本变化、C 重新审核、D 锁定分离、
// E 版本再次变化、F 旧项目兼容、G 统计/readiness 与 statuses 一致。
// 不调用模型；所有对象为内存 fixture。

import assert from "node:assert/strict";

import type {
    StudioProductionShot,
    StudioStoryboardDocument,
    StudioStoryboardReview,
} from "../src/types/studio-production";
import {
    analyzeStoryboardReview,
    createEmptyStoryboardReview,
    describeShotReviewStale,
    effectiveShotReviewStatus,
    normalizeStoryboardReview,
    planStoryboardReviewReReview,
    planStoryboardReviewStatus,
    planStoryboardShotLocks,
    reviewStats,
} from "../src/lib/studio/review-engine";

const now = "2026-11-26T10:00:00.000Z";
const later = "2026-11-26T11:00:00.000Z";

function shot(shotId: string, shotNumber: number, input: Partial<StudioProductionShot> = {}): StudioProductionShot {
    return {
        shotId,
        episodeId: "ep-4a",
        sceneId: "scene-a",
        shotGroupId: "group-1",
        shotNumber,
        duration: 4,
        shotSize: "中景",
        cameraPosition: "轴线左侧",
        cameraAngle: "平视",
        lens: "35mm",
        cameraMovement: "固定",
        composition: "人物居中",
        foreground: "雨",
        midground: "林舟",
        background: "钟楼",
        characterBlocking: "林舟在左侧",
        eyeline: "看向守钟人",
        action: "递出铜钥匙",
        facialExpression: "克制",
        emotion: "警觉",
        dialogue: [],
        voiceOver: "",
        soundEffects: "雨声",
        backgroundMusic: "",
        lighting: "冷光",
        environment: "钟楼底层",
        continuityRules: [],
        characterBindings: [{ characterId: "char-a", name: "林舟" }],
        outfitBindings: [],
        sceneBindings: { locationId: "loc-a", locationVariantId: "variant-night" },
        propBindings: [{ propId: "prop-key", name: "铜钥匙", state: "在左手" }],
        sourceReferences: {} as never,
        sourceScriptSceneId: "scene-a",
        imagePrompt: "钟楼底层，林舟递出铜钥匙",
        videoPrompt: "固定镜头，林舟递出铜钥匙",
        keyframeRefs: [],
        status: "draft",
        version: 1,
        locked: false,
        createdAt: now,
        updatedAt: now,
        ...input,
    };
}

function doc(version: number): StudioStoryboardDocument {
    return {
        id: "storyboard-4a",
        episodeId: "ep-4a",
        episodeNumber: 1,
        sourceScriptId: "script-4a",
        sourceScriptVersion: 1,
        sourceEpisodePlanId: "plan-4a",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-4a",
        storyboardVersion: version,
        status: "draft",
        groups: [{
            shotGroupId: "group-1",
            episodeId: "ep-4a",
            sceneId: "scene-a",
            groupNumber: 1,
            sceneTitle: "钟楼底层",
            sharedLayout: "林舟在左",
            characterStartPositions: [{ characterId: "char-a", name: "林舟", position: "左侧", orientation: "向右", eyeline: "看向守钟人" }],
            cameraAxis: "从左向右",
            propStates: "铜钥匙在左手",
            timeOfDay: "夜",
            lighting: "冷光",
            weather: "雨",
            continuityRules: [],
            shotIds: ["shot-a", "shot-b", "shot-c"],
            reviewedByUser: false,
            createdAt: now,
            updatedAt: now,
        }],
        shots: [shot("shot-a", 1), shot("shot-b", 2), shot("shot-c", 3)],
        checks: [],
        sourceSceneVersions: { "scene-a": 1 },
        createdAt: now,
        updatedAt: now,
    };
}

function approveAll(document: StudioStoryboardDocument): StudioStoryboardReview {
    const plan = planStoryboardReviewStatus({
        document,
        review: createEmptyStoryboardReview(document.episodeId, document.storyboardVersion, now),
        shotIds: document.shots.map((item) => item.shotId),
        status: "approved",
        action: "approve",
        expectedVersion: document.storyboardVersion,
        now,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) throw new Error(plan.error);
    assert.equal(plan.updated.length, document.shots.length);
    return plan.review;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

// A. 同版本 + 单镜内容变化：只有该镜 stale，原因 content。
{
    const base = doc(3);
    const approved = approveAll(base);
    const changed = clone(base);
    changed.shots[1].action = "守钟人后退半步";
    const analysis = analyzeStoryboardReview({ document: changed, review: approved, now: later });
    assert.equal(analysis.statuses["shot-a"], "approved");
    assert.equal(analysis.statuses["shot-b"], "stale");
    assert.equal(analysis.statuses["shot-c"], "approved");
    assert.equal(describeShotReviewStale(changed, approved, changed.shots[1]), "content");
    assert.equal(analysis.stats.stale, 1);
}

// B. 只改正式版本、镜头内容完全不变：所有旧审核 stale，原因是 version。
{
    const base = doc(3);
    const approved = approveAll(base);
    const changed = clone(base);
    changed.storyboardVersion = 4;
    const analysis = analyzeStoryboardReview({ document: changed, review: approved, now: later });
    for (const shotId of ["shot-a", "shot-b", "shot-c"]) {
        assert.equal(analysis.statuses[shotId], "stale", `${shotId} 必须因版本变化 stale`);
        assert.equal(describeShotReviewStale(changed, approved, changed.shots.find((item) => item.shotId === shotId)!), "version");
    }
    assert.equal(analysis.stats.stale, 3);
    assert.equal(analysis.stats.approved, 0);
}

// C. 重新审核绑定当前版本的新记录，旧历史保留；未重审镜头仍 stale。
{
    const base = doc(3);
    const approved = approveAll(base);
    const oldAuditIds = approved.audits.map((audit) => audit.id);
    const changed = clone(base);
    changed.storyboardVersion = 4;
    const reReview = planStoryboardReviewReReview({
        document: changed,
        review: approved,
        shotIds: ["shot-a"],
        expectedVersion: 4,
        now: later,
    });
    assert.equal(reReview.ok, true);
    if (!reReview.ok) throw new Error(reReview.error);
    assert.equal(reReview.review.shots["shot-a"].storyboardVersion, 4);
    assert.equal(reReview.review.shots["shot-a"].status, "pending");
    assert.deepEqual(reReview.review.audits.slice(0, oldAuditIds.length).map((audit) => audit.id), oldAuditIds);
    assert.equal(reReview.review.audits.at(-1)?.action, "re_review");
    const analysis = analyzeStoryboardReview({ document: changed, review: reReview.review, now: later });
    assert.equal(analysis.statuses["shot-a"], "pending");
    assert.equal(analysis.statuses["shot-b"], "stale");
    assert.equal(analysis.statuses["shot-c"], "stale");
    assert.equal(analysis.stats.stale, 2);
}

// D. 锁定与审核分离：锁定不改变 stale，也不把旧审核洗成当前有效。
{
    const base = doc(3);
    const approved = approveAll(base);
    const changed = clone(base);
    changed.storyboardVersion = 4;
    const lockPlan = planStoryboardShotLocks({
        document: changed,
        shotIds: ["shot-a"],
        locked: true,
        expectedVersion: 4,
    });
    assert.equal(lockPlan.ok, true);
    if (!lockPlan.ok) throw new Error(lockPlan.error);
    const lockedDoc = { ...changed, shots: changed.shots.map((item) => ({ ...item, locked: lockPlan.updates[item.shotId] ?? item.locked })) };
    assert.equal(effectiveShotReviewStatus(lockedDoc, approved, lockedDoc.shots[0]), "stale");
    const analysis = analyzeStoryboardReview({ document: lockedDoc, review: approved, now: later });
    assert.equal(analysis.statuses["shot-a"], "stale");
    assert.equal(analysis.stats.locked, 1);
}

// E. 重新审核后又发生版本变化：v4 的新记录也必须 stale，不能沿用。
{
    const base = doc(3);
    const approved = approveAll(base);
    const v4 = clone(base);
    v4.storyboardVersion = 4;
    const reReview = planStoryboardReviewReReview({ document: v4, review: approved, shotIds: ["shot-a"], expectedVersion: 4, now: later });
    assert.equal(reReview.ok, true);
    if (!reReview.ok) throw new Error(reReview.error);
    const v5 = clone(v4);
    v5.storyboardVersion = 5;
    const analysis = analyzeStoryboardReview({ document: v5, review: reReview.review, now: later });
    assert.equal(analysis.statuses["shot-a"], "stale");
    assert.equal(describeShotReviewStale(v5, reReview.review, v5.shots[0]), "version");
    assert.equal(reReview.review.shots["shot-a"].storyboardVersion, 4);
}

// F. 旧项目兼容：缺少 storyboardVersion 的旧记录不得继承当前版本冒充有效。
{
    const base = doc(4);
    const approved = approveAll(base);
    const legacy = clone(approved);
    delete legacy.shots["shot-a"].storyboardVersion;
    const normalized = normalizeStoryboardReview(legacy, base, now)!;
    assert.equal(normalized.shots["shot-a"].storyboardVersion, -1);
    assert.equal(effectiveShotReviewStatus(base, normalized, base.shots[0]), "stale");
}

// G. 统计/readiness 与 statuses 同源：approved 只计当前版本，stale 同时进入 readiness。
{
    const base = doc(3);
    const approved = approveAll(base);
    const changed = clone(base);
    changed.storyboardVersion = 4;
    const analysis = analyzeStoryboardReview({ document: changed, review: approved, now: later });
    const stats = reviewStats(changed, approved, analysis.issues);
    const statuses = Object.values(analysis.statuses);
    assert.equal(stats.approved, statuses.filter((status) => status === "approved").length);
    assert.equal(stats.stale, statuses.filter((status) => status === "stale").length);
    assert.equal(stats.approved, 0);
    assert.equal(stats.stale, changed.shots.length);
    assert.equal(analysis.readiness.storyboardVersion, 4);
    assert.equal(analysis.readiness.status, "not_ready");
    assert.equal(analysis.readiness.reasons.some((reason) => reason.includes("需要重新审核")), true);
}

console.log("stage4a-strict-version-check: A–G 7 groups passed");
