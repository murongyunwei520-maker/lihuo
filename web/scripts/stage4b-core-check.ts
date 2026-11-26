// Stage 4B 确定性测试：stale 复核、锁定分离、局部 stale、版本差异、部分成功、旧数据归一化。
// 不调用模型；不读取浏览器项目数据。
import assert from "node:assert/strict";

import type {
    StudioProductionShot,
    StudioStoryboardDocument,
    StudioStoryboardReview,
    StudioStoryboardShotReview,
    StudioStoryboardVersion,
} from "../src/types/studio-production";
import {
    analyzeStoryboardReview,
    buildShotStaleDiff,
    createEmptyStoryboardReview,
    describeShotReviewStale,
    effectiveShotReviewStatus,
    isShotLocked,
    normalizeStoryboardReview,
    planStoryboardReviewRefresh,
    planStoryboardReviewReReview,
    planStoryboardReviewStatus,
    planStoryboardShotLocks,
    reviewStats,
    shotReviewContentHash,
    storyboardStaleAckKey,
} from "../src/lib/studio/review-engine";

const now = "2026-11-23T12:00:00.000Z";
const later = "2026-11-23T13:00:00.000Z";

function shot(shotId: string, shotNumber: number, input: Partial<StudioProductionShot> = {}): StudioProductionShot {
    return {
        shotId,
        episodeId: "ep-4b",
        sceneId: "scene-a",
        shotGroupId: "group-1",
        shotNumber,
        duration: 4,
        shotSize: "中景",
        cameraPosition: "平视",
        cameraAngle: "正面",
        lens: "35mm",
        cameraMovement: "固定",
        composition: "人物居中偏左",
        foreground: "雨幕",
        midground: "林舟",
        background: "钟楼",
        characterBlocking: "林舟站在画面左侧，面向右",
        eyeline: "看向守钟人",
        action: "递出铜钥匙",
        facialExpression: "克制",
        emotion: "警觉",
        dialogue: [],
        voiceOver: "",
        soundEffects: "雨声",
        backgroundMusic: "",
        lighting: "冷色侧光",
        environment: "钟楼底层",
        continuityRules: ["铜钥匙在左手"],
        characterBindings: [{ characterId: "char-a", name: "林舟" }],
        outfitBindings: [],
        sceneBindings: { locationId: "loc-a", locationVariantId: "variant-night" },
        propBindings: [{ propId: "prop-key", name: "铜钥匙", state: "发光" }],
        sourceReferences: {} as never,
        sourceScriptSceneId: "scene-a",
        imagePrompt: "钟楼底层，林舟递出铜钥匙，冷雨，35mm",
        videoPrompt: "林舟递出铜钥匙，镜头固定，雨幕缓慢落下",
        keyframeRefs: [],
        status: "draft",
        version: 1,
        locked: false,
        createdAt: now,
        updatedAt: now,
        ...input,
    };
}

function group(groupNumber: number, sceneId: string, sceneTitle: string, shotIds: string[]) {
    return {
        shotGroupId: `group-${groupNumber}`,
        episodeId: "ep-4b",
        sceneId,
        groupNumber,
        sceneTitle,
        sharedLayout: "林舟在左，守钟人在右",
        characterStartPositions: [{ characterId: "char-a", name: "林舟", position: "左侧", orientation: "向右", eyeline: "看向守钟人" }],
        cameraAxis: "从左向右",
        propStates: "铜钥匙在林舟左手",
        timeOfDay: "夜",
        lighting: "冷色侧光",
        weather: "雨",
        continuityRules: ["林舟始终在左"],
        shotIds,
        reviewedByUser: false,
        createdAt: now,
        updatedAt: now,
    };
}

function doc(version = 3): StudioStoryboardDocument {
    return {
        id: "storyboard-4b",
        episodeId: "ep-4b",
        episodeNumber: 1,
        sourceScriptId: "script-4b",
        sourceScriptVersion: 1,
        sourceEpisodePlanId: "plan-4b",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-4b",
        storyboardVersion: version,
        status: "draft",
        groups: [group(1, "scene-a", "钟楼底层", ["shot-a", "shot-b"]), group(2, "scene-b", "雨中台阶", ["shot-c", "shot-d"])],
        shots: [
            shot("shot-a", 1),
            shot("shot-b", 2, { shotGroupId: "group-1" }),
            shot("shot-c", 3, { sceneId: "scene-b", shotGroupId: "group-2" }),
            shot("shot-d", 4, { sceneId: "scene-b", shotGroupId: "group-2" }),
        ],
        checks: [],
        sourceSceneVersions: { "scene-a": 1, "scene-b": 1 },
        createdAt: now,
        updatedAt: now,
    };
}

function emptyReview(document: StudioStoryboardDocument): StudioStoryboardReview {
    return createEmptyStoryboardReview(document.episodeId, document.storyboardVersion, now);
}

function approveAll(document: StudioStoryboardDocument): StudioStoryboardReview {
    const plan = planStoryboardReviewStatus({
        document,
        review: emptyReview(document),
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

function withLocks(document: StudioStoryboardDocument, updates: Record<string, boolean>) {
    const next = clone(document);
    next.shots = next.shots.map((item) => (updates[item.shotId] === undefined ? item : { ...item, locked: updates[item.shotId] }));
    return next;
}

function record(shotId: string, status: StudioStoryboardShotReview["status"], version: number, input: Partial<StudioStoryboardShotReview> = {}): StudioStoryboardShotReview {
    return { shotId, status, note: "", storyboardVersion: version, reviewedAt: now, reviewedBy: "local-user", ...input };
}

// 1. 锁定与审核彻底分离：approved + locked 仍通过；pending + locked 不计通过；rejected + locked 阻塞。
{
    const baseDoc = doc();
    const approved = approveAll(baseDoc);
    const lockedDoc = withLocks(baseDoc, { "shot-a": true, "shot-b": true, "shot-c": true, "shot-d": true });
    const analysis = analyzeStoryboardReview({ document: lockedDoc, review: approved, now });
    assert.equal(analysis.statuses["shot-a"], "approved");
    assert.equal(analysis.stats.locked, 4);
    assert.equal(analysis.stats.approved, 4);
    assert.equal(analysis.stats.reviewed, 4);
    assert.equal(analysis.readiness.status, "ready_for_video", "全部 approved + locked 仍可进入视频生成");
    assert.equal(isShotLocked(lockedDoc, lockedDoc.shots[0]), true);
    assert.equal(shotReviewContentHash(baseDoc.shots[0]), shotReviewContentHash(lockedDoc.shots[0]), "锁定不改变内容签名");

    const emptyLocked = analyzeStoryboardReview({ document: withLocks(baseDoc, { "shot-a": true, "shot-b": true, "shot-c": true, "shot-d": true }), now });
    assert.equal(emptyLocked.statuses["shot-a"], "pending");
    assert.equal(emptyLocked.stats.pending, 4);
    assert.equal(emptyLocked.stats.reviewed, 0);
    assert.equal(emptyLocked.readiness.status, "not_ready", "全部锁定但未审核，不能进入视频生成");

    const mixed = planStoryboardReviewStatus({
        document: baseDoc,
        review: approved,
        shotIds: ["shot-a"],
        status: "needs_revision",
        action: "needs_revision",
        expectedVersion: baseDoc.storyboardVersion,
        now,
    });
    assert.equal(mixed.ok, true);
    if (!mixed.ok) throw new Error(mixed.error);
    const mixedLocked = withLocks(baseDoc, { "shot-a": true });
    const mixedAnalysis = analyzeStoryboardReview({ document: mixedLocked, review: mixed.review, now });
    assert.equal(mixedAnalysis.statuses["shot-a"], "needs_revision", "needs_revision + locked 保持需要修改");
    assert.equal(mixedAnalysis.stats.needsRevision, 1);
    assert.equal(mixedAnalysis.readiness.status, "not_ready");

    const rejected = planStoryboardReviewStatus({
        document: baseDoc,
        review: approved,
        shotIds: ["shot-b"],
        status: "rejected",
        action: "reject",
        expectedVersion: baseDoc.storyboardVersion,
        now,
    });
    assert.equal(rejected.ok, true);
    if (!rejected.ok) throw new Error(rejected.error);
    const rejectedLocked = analyzeStoryboardReview({ document: withLocks(baseDoc, { "shot-b": true }), review: rejected.review, now });
    assert.equal(rejectedLocked.statuses["shot-b"], "rejected");
    assert.equal(rejectedLocked.readiness.status, "blocked", "rejected + locked 不能因为锁定而变成可生成");
}

// 2. 严格版本过期：正式版本变化后全部旧审核 stale；重新审核只解除被重审镜头，旧历史保留。
{
    const base = doc(3);
    const approved = approveAll(base);
    const oldAuditIds = approved.audits.map((audit) => audit.id);
    const changed = clone(base);
    changed.storyboardVersion = 4;
    changed.shots[1].action = "守钟人后退半步，铜钥匙仍在左手";
    changed.shots[1].updatedAt = later;
    const analysis = analyzeStoryboardReview({ document: changed, review: approved, now: later });
    assert.equal(analysis.statuses["shot-a"], "stale", "版本变化后，即使镜头内容未变也必须 stale");
    assert.equal(analysis.statuses["shot-b"], "stale");
    assert.equal(analysis.statuses["shot-c"], "stale");
    assert.equal(analysis.statuses["shot-d"], "stale");
    assert.equal(analysis.stats.stale, 4);
    assert.equal(analysis.stats.approved, 0, "旧版本的 approved 不能计入当前版本");
    assert.equal(describeShotReviewStale(changed, approved, changed.shots[1]), "version", "版本过期优先于内容差异");

    const diff = buildShotStaleDiff({ document: changed, review: approved, shot: changed.shots[1] });
    assert.equal(diff.stale, true);
    assert.equal(diff.unavailable, false);
    assert.equal(diff.previousVersion, 3);
    assert.equal(diff.currentVersion, 4);
    assert.equal(diff.fields.some((field) => field.key === "action" && field.before !== field.after), true);

    const direct = planStoryboardReviewStatus({
        document: changed,
        review: approved,
        shotIds: ["shot-b"],
        status: "approved",
        action: "approve",
        expectedVersion: 4,
        now: later,
    });
    assert.equal(direct.ok, true);
    if (!direct.ok) throw new Error(direct.error);
    assert.equal(direct.updated.length, 0, "stale 镜头不能直接通过");
    assert.equal(direct.skipped[0]?.reason, "stale");

    const reReview = planStoryboardReviewReReview({
        document: changed,
        review: approved,
        shotIds: ["shot-b"],
        expectedVersion: 4,
        now: later,
    });
    assert.equal(reReview.ok, true);
    if (!reReview.ok) throw new Error(reReview.error);
    assert.equal(reReview.updated.length, 1);
    assert.equal(reReview.review.shots["shot-b"].status, "pending");
    assert.equal(reReview.review.shots["shot-b"].storyboardVersion, 4);
    assert.equal(Boolean(reReview.review.shots["shot-b"].shotContentHash), true);
    assert.equal(reReview.review.audits.length, oldAuditIds.length + 1);
    assert.equal(reReview.review.audits.at(-1)?.action, "re_review");
    assert.deepEqual(reReview.review.audits.slice(0, oldAuditIds.length).map((audit) => audit.id), oldAuditIds, "旧审核记录必须完整保留");
    const reAnalysis = analyzeStoryboardReview({ document: changed, review: reReview.review, now: later });
    assert.equal(reAnalysis.statuses["shot-b"], "pending", "重新审核后该镜头 stale 正确解除");
    assert.equal(reAnalysis.statuses["shot-a"], "stale", "未重审的旧版本记录仍 stale");
    assert.equal(reAnalysis.statuses["shot-c"], "stale");
    assert.equal(reAnalysis.statuses["shot-d"], "stale");
    assert.equal(reAnalysis.stats.stale, 3);

    const approveAgain = planStoryboardReviewStatus({
        document: changed,
        review: reReview.review,
        shotIds: ["shot-b"],
        status: "approved",
        action: "approve",
        expectedVersion: 4,
        now: later,
    });
    assert.equal(approveAgain.ok, true);
    if (!approveAgain.ok) throw new Error(approveAgain.error);
    assert.equal(approveAgain.review.shots["shot-b"].status, "approved");
    assert.equal(approveAgain.review.audits.length, oldAuditIds.length + 2);
    assert.equal(approveAgain.review.audits.some((audit) => audit.action === "re_review" && audit.storyboardVersion === 4), true);
}

// 3. 上游 stale ack：复核后进入 pending；上游再次变化后重新 stale；刷新不能消除 stale。
{
    const base = doc(3);
    const approved = approveAll(base);
    const upstream = clone(base);
    upstream.stale = { sceneIds: ["scene-a"], shotIds: ["shot-a", "shot-b"], scriptVersion: 2, reason: "台词调整", markedAt: "t1" };
    const staleAnalysis = analyzeStoryboardReview({ document: upstream, review: approved, now: later });
    assert.equal(staleAnalysis.statuses["shot-a"], "stale");
    assert.equal(staleAnalysis.statuses["shot-b"], "stale");
    assert.equal(staleAnalysis.statuses["shot-c"], "approved");

    const reReview = planStoryboardReviewReReview({
        document: upstream,
        review: approved,
        shotIds: ["shot-a", "shot-b"],
        expectedVersion: 3,
        now: later,
    });
    assert.equal(reReview.ok, true);
    if (!reReview.ok) throw new Error(reReview.error);
    assert.equal(reReview.review.shots["shot-a"].staleAckKey, storyboardStaleAckKey(upstream));
    const cleared = analyzeStoryboardReview({ document: upstream, review: reReview.review, now: later });
    assert.equal(cleared.statuses["shot-a"], "pending");
    assert.equal(cleared.statuses["shot-b"], "pending");

    const changedUpstream = clone(upstream);
    changedUpstream.stale.markedAt = "t2";
    changedUpstream.stale.reason = "台词再次调整";
    const staleAgain = analyzeStoryboardReview({ document: changedUpstream, review: reReview.review, now: later });
    assert.equal(staleAgain.statuses["shot-a"], "stale", "上游再次变化后旧 ack 失效");

    const refreshed = planStoryboardReviewRefresh({ document: changedUpstream, review: reReview.review, now: later });
    const refreshedAnalysis = analyzeStoryboardReview({ document: changedUpstream, review: refreshed, now: later });
    assert.equal(refreshedAnalysis.statuses["shot-a"], "stale", "刷新不能消除 stale");
    assert.equal(refreshed.audits.length, reReview.review.audits.length, "刷新不新增审核记录");
}

// 4. 历史内容不可比较时必须明确 unavailable；有 v3 快照时可展示真实字段差异。
{
    const base = doc(3);
    const oldReview = emptyReview(base);
    oldReview.shots["shot-d"] = record("shot-d", "approved", 3);
    const changed = clone(base);
    changed.storyboardVersion = 4;
    changed.shots[3].lighting = "暖色顶光";
    const unavailable = buildShotStaleDiff({ document: changed, review: oldReview, shot: changed.shots[3] });
    assert.equal(unavailable.stale, true);
    assert.equal(unavailable.unavailable, true);
    assert.match(unavailable.message, /无法完整比较历史内容/);
    assert.equal(unavailable.fields.length, 0, "旧数据缺失时不得编造字段差异");

    const snapshot: StudioStoryboardVersion = {
        id: "snapshot-v3",
        snapshotId: "snapshot-v3",
        version: 3,
        basedOnVersion: 3,
        snapshotType: "formal",
        reason: "测试",
        createdAt: now,
        document: base,
    };
    const available = buildShotStaleDiff({ document: changed, review: oldReview, shot: changed.shots[3], versions: [snapshot] });
    assert.equal(available.unavailable, false);
    assert.equal(available.fields.some((field) => field.key === "lighting" && field.before === "冷色侧光" && field.after === "暖色顶光"), true);
}

// 5. 批量部分成功：内容签名一致可继续写；缺签名旧版本冲突；锁定跳过；部分失败不回滚成功项。
{
    const base = doc(3);
    const approved = approveAll(base);
    const partialReview = clone(approved);
    delete partialReview.shots["shot-b"].shotContentHash;
    delete partialReview.shots["shot-b"].reviewedShot;
    const changed = clone(base);
    changed.storyboardVersion = 4;
    changed.shots[2].locked = true;
    const plan = planStoryboardReviewStatus({
        document: changed,
        review: partialReview,
        shotIds: ["shot-a", "shot-b", "shot-c", "missing-shot"],
        status: "needs_revision",
        action: "needs_revision",
        expectedVersion: 3,
        partialOnVersionChange: true,
        now: later,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) throw new Error(plan.error);
    assert.deepEqual(plan.updated, [], "旧版本记录不得写入当前版本，内容签名一致也不行");
    assert.equal(plan.skipped.some((item) => item.shotId === "shot-a" && item.reason === "version_conflict"), true);
    assert.equal(plan.skipped.some((item) => item.shotId === "shot-b" && item.reason === "version_conflict"), true);
    assert.equal(plan.skipped.some((item) => item.shotId === "shot-c" && item.reason === "locked"), true);
    assert.equal(plan.skipped.some((item) => item.shotId === "missing-shot" && item.reason === "missing"), true);
    assert.equal(plan.review.shots["shot-a"].status, "approved");
    assert.equal(plan.review.shots["shot-a"].storyboardVersion, 3);
    assert.equal(plan.review.shots["shot-b"].storyboardVersion, 3);
    assert.equal(plan.review.audits.length, 4, "冲突批次不得产生当前版本审核历史");

    const strict = planStoryboardReviewStatus({
        document: changed,
        review: approved,
        shotIds: ["shot-a"],
        status: "approved",
        action: "approve",
        expectedVersion: 3,
        partialOnVersionChange: false,
        now: later,
    });
    assert.equal(strict.ok, false);
    assert.equal(strict.ok === false && strict.conflict, true);
}

// 6. 锁定计划：只算 locked；整份锁定不能逐镜解锁；版本冲突拒绝；内容签名不受锁影响。
{
    const base = doc(3);
    base.shots[0].locked = true;
    const beforeHash = shotReviewContentHash(base.shots[1]);
    const plan = planStoryboardShotLocks({ document: base, shotIds: ["shot-a", "shot-b", "missing-shot"], locked: true, expectedVersion: 3 });
    assert.equal(plan.ok, true);
    if (!plan.ok) throw new Error(plan.error);
    assert.deepEqual(plan.updated, ["shot-b"]);
    assert.equal(plan.skipped.some((item) => item.shotId === "shot-a" && item.reason === "unchanged"), true);
    assert.equal(plan.skipped.some((item) => item.shotId === "missing-shot" && item.reason === "missing"), true);

    const unlocked = planStoryboardShotLocks({ document: withLocks(base, plan.updates), shotIds: ["shot-b"], locked: false, expectedVersion: 3 });
    assert.equal(unlocked.ok, true);
    if (!unlocked.ok) throw new Error(unlocked.error);
    assert.deepEqual(unlocked.updated, ["shot-b"]);
    assert.equal(shotReviewContentHash(withLocks(base, plan.updates).shots[1]), beforeHash, "锁定不改变镜头内容签名");

    const documentLocked = clone(base);
    documentLocked.status = "locked";
    const blockedUnlock = planStoryboardShotLocks({ document: documentLocked, shotIds: ["shot-a"], locked: false, expectedVersion: 3 });
    assert.equal(blockedUnlock.ok, true);
    if (!blockedUnlock.ok) throw new Error(blockedUnlock.error);
    assert.equal(blockedUnlock.skipped[0]?.reason, "document_locked");

    const conflict = planStoryboardShotLocks({ document: base, shotIds: ["shot-b"], locked: true, expectedVersion: 2 });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.ok === false && conflict.conflict, true);
}

// 7. 旧数据归一化：locked / stale 审核状态回退 pending；同版本旧记录补签名；历史审核保留为 pending。
{
    const base = doc(3);
    const old = emptyReview(base);
    old.shots["shot-a"] = record("shot-a", "locked" as unknown as StudioStoryboardShotReview["status"], 3);
    old.shots["shot-b"] = record("shot-b", "stale" as unknown as StudioStoryboardShotReview["status"], 3);
    old.shots["shot-c"] = record("shot-c", "approved", 2);
    old.audits = [
        { id: "audit-old-1", episodeId: "ep-4b", shotId: "shot-a", action: "approve", fromStatus: "locked" as never, toStatus: "approved", note: "", actor: "local-user", storyboardVersion: 3, createdAt: now },
    ];
    const normalized = normalizeStoryboardReview(old, base, later);
    assert.ok(normalized);
    assert.equal(normalized?.shots["shot-a"]?.status, "pending");
    assert.equal(normalized?.shots["shot-b"]?.status, "pending");
    assert.equal(Boolean(normalized?.shots["shot-a"]?.shotContentHash), true, "同版本旧记录补内容签名");
    assert.equal(Boolean(normalized?.shots["shot-a"]?.reviewedShot), true);
    assert.equal(normalized?.shots["shot-c"]?.storyboardVersion, 2);
    assert.equal(Boolean(normalized?.shots["shot-c"]?.shotContentHash), false, "旧版本记录缺签名时不能伪造签名");
    assert.equal(normalized?.audits[0]?.fromStatus, "pending");
    assert.equal(normalized?.audits.length, 1, "历史审核记录不得被删除");
    assert.equal(effectiveShotReviewStatus(base, normalized, base.shots.find((item) => item.shotId === "shot-c")!), "stale");
}

// 8. 刷新与统计：refresh 不创建新审核；reviewStats reviewed 只计 approved，locked 单列。
{
    const base = doc(3);
    const old = emptyReview(base);
    old.shots["shot-a"] = record("shot-a", "approved", 3);
    const refreshed = planStoryboardReviewRefresh({ document: base, review: old, now: later });
    assert.equal(refreshed.shots["shot-a"].status, "approved");
    assert.equal(refreshed.audits.length, 0);
    assert.equal(Boolean(refreshed.shots["shot-a"].shotContentHash), true);

    const locked = withLocks(base, { "shot-a": true, "shot-c": true });
    const stats = reviewStats(locked, refreshed, []);
    assert.equal(stats.locked, 2);
    assert.equal(stats.approved, 1);
    assert.equal(stats.reviewed, 1);
    assert.equal(stats.pending, 3, "未审核镜头仍为 pending，不因锁定改变");
}

console.log("stage4b-core-check: 8 groups passed");
