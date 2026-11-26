// 阶段 3.1 确定性测试：只验证纯函数与队列收口/冻结快照/分镜互斥，不调用模型。
import assert from "node:assert/strict";

import type { StudioProject } from "../src/types/studio";
import type { StudioProductionJob, StudioProductionJobStatus, StudioScriptDocument, StudioStoryboardDocument } from "../src/types/studio-production";
import { createProductionJob } from "../src/lib/studio/production-engine";
import { applyProductionJobReview, normalizeProductionForHydration, selectResumableJobs, selectRetryableJobs, selectReviewJobs } from "../src/lib/studio/production-workspace";
import { acquireStoryboardWriteLock, hasStoryboardVersionConflict, releaseStoryboardWriteLock } from "../src/lib/studio/production-locks";
import { replaceSceneInStoryboard } from "../src/lib/studio/production-schema";

const modelA = { channelId: "builtin-doubao", modelId: "对话", label: "对话（豆包）" };
const modelB = { channelId: "bytedance", modelId: "gpt-5.5", label: "gpt-5.5（默认渠道）" };

function job(status: StudioProductionJobStatus, overrides: Partial<StudioProductionJob> = {}): StudioProductionJob {
    return {
        ...createProductionJob({
            kind: "script",
            episodeIds: ["ep-test"],
            episodeNumbers: [1],
            model: modelA,
            modelParams: { temperature: 0.7, maxTokens: 4096, accountId: "db-test" },
            promptVersion: "stage3-script-v1",
            sourceHandoffId: "handoff-test",
            sourceBlueprintVersion: 1,
            sourcePlanVersions: [1],
            targetEpisodeId: "ep-test",
            targetModule: "episode",
        }),
        status,
        ...overrides,
    };
}

function hydrate(jobs: StudioProductionJob[]) {
    const project = {
        id: "proj-test",
        episodes: [],
        production: { version: 1, jobs, updatedAt: "2026-01-01T00:00:00.000Z" },
    } as unknown as StudioProject;
    return normalizeProductionForHydration(project).production!.jobs;
}

// 1) 刷新收口：提交前、提交中、结果未知、已成功、旧失败。
const queued = job("queued", { id: "job-queued" });
const submitting = job("submitting", { id: "job-submitting", remoteState: "submitted", taskId: "task-submitting" });
const returnedUnwritten = job("running", { id: "job-returned-unwritten", remoteState: "submitted", taskId: "task-returned", progress: 90, currentLabel: "模型已返回，正在写入项目" });
const unknown = job("unknown", { id: "job-unknown", remoteState: "unknown", needsReview: true });
const succeeded = job("succeeded", { id: "job-succeeded" });
const legacyFailed = job("failed", { id: "job-legacy-failed", remoteState: undefined, needsReview: undefined, retryable: undefined, error: "Failed to fetch" });
const interruptedUnknown = job("interrupted", { id: "job-interrupted-unknown", remoteState: "unknown", needsReview: true, retryable: false });
const hydrated = hydrate([queued, submitting, returnedUnwritten, unknown, succeeded, legacyFailed, interruptedUnknown]);
const byId = new Map(hydrated.map((item) => [item.id, item]));
assert.equal(byId.get(queued.id)!.status, "interrupted");
assert.equal(byId.get(queued.id)!.remoteState, "not_submitted");
assert.equal(byId.get(queued.id)!.needsReview, false, "确定未提交的排队任务可人工继续");
assert.equal(byId.get(submitting.id)!.status, "interrupted");
assert.equal(byId.get(submitting.id)!.remoteState, "unknown", "提交中刷新必须保留远端未知，不能转成可重发 queued");
assert.equal(byId.get(submitting.id)!.needsReview, true);
assert.equal(byId.get(returnedUnwritten.id)!.status, "interrupted", "模型已返回但尚未写入项目时刷新必须停在核对");
assert.equal(byId.get(returnedUnwritten.id)!.remoteState, "unknown");
assert.equal(byId.get(returnedUnwritten.id)!.needsReview, true);
assert.equal(byId.get(returnedUnwritten.id)!.retryable, false);
assert.equal(byId.get(unknown.id)!.status, "unknown");
assert.equal(byId.get(unknown.id)!.needsReview, true);
assert.equal(byId.get(succeeded.id)!.remoteState, "completed");
assert.equal(byId.get(succeeded.id)!.retryable, false);
assert.equal(byId.get(legacyFailed.id)!.remoteState, "unknown", "旧失败任务没有远端证据时默认未知");
assert.equal(byId.get(legacyFailed.id)!.needsReview, true);
assert.equal(byId.get(legacyFailed.id)!.retryable, false);
assert.equal(byId.get(interruptedUnknown.id)!.remoteState, "unknown");
assert.equal(byId.get(interruptedUnknown.id)!.retryable, false);

// 2) 继续/重试/核对选择：unknown 不自动重发，只有明确 failed 可重试。
const resume = selectResumableJobs(Array.from(byId.values()));
assert.deepEqual(resume.map((item) => item.id), [queued.id], "只有确定未提交的 interrupted 可继续");
const retryable = job("failed", { id: "job-retryable", remoteState: "failed", needsReview: false, retryable: true });
const nonRetryable = job("failed", { id: "job-non-retryable", remoteState: "unknown", needsReview: true, retryable: false });
const retry = selectRetryableJobs([...resume, retryable, nonRetryable, unknown, interruptedUnknown]);
assert.deepEqual(retry.map((item) => item.id), [retryable.id], "unknown 与 interrupted 不能被重试");
assert.ok(!selectResumableJobs([...Array.from(byId.values()), retryable]).some((item) => item.id === unknown.id), "unknown 点击继续不得进入可恢复集合");
assert.ok(!selectResumableJobs([...Array.from(byId.values()), retryable]).some((item) => item.id === interruptedUnknown.id), "interrupted/unknown 点击重试不得进入可恢复集合");
assert.ok(!selectResumableJobs([...Array.from(byId.values()), retryable]).some((item) => item.id === succeeded.id), "已成功任务不能被再次执行");
const review = selectReviewJobs([...byId.values(), retryable, nonRetryable]);
assert.ok(review.some((item) => item.id === submitting.id));
assert.ok(review.some((item) => item.id === unknown.id));
assert.ok(review.some((item) => item.id === legacyFailed.id));
assert.ok(!review.some((item) => item.id === retryable.id));

// 3) 人工核对三种决策：adopt 不重发，retry 清空旧 taskId/trace，mark-failed 不重试。
const adopted = applyProductionJobReview(unknown, "adopt-existing");
assert.equal(adopted.status, "succeeded");
assert.equal(adopted.remoteState, "completed");
assert.equal(adopted.taskId, unknown.taskId, "采纳已有结果不能伪装成新请求");
const requeued = applyProductionJobReview({ ...unknown, taskId: "task-old", trace: { model: modelA, modelParams: { temperature: 0.7 }, promptVersion: "v1", inputVersion: 0, inputChars: 10, outputChars: 20, calls: 1, startedAt: "x", finishedAt: "y" } }, "retry");
assert.equal(requeued.status, "queued");
assert.equal(requeued.taskId, undefined);
assert.equal(requeued.trace, undefined);
const failed = applyProductionJobReview(unknown, "mark-failed");
assert.equal(failed.status, "failed");
assert.equal(failed.retryable, false);

// 4) 分镜同集互斥；不同集互不影响；释放后可重新获取。
const episodeLock = acquireStoryboardWriteLock({ projectId: "proj-test", episodeId: "ep-a", operation: "episode" });
assert.equal(episodeLock.ok, true);
if (!episodeLock.ok) throw new Error(episodeLock.error);
const sceneLock = acquireStoryboardWriteLock({ projectId: "proj-test", episodeId: "ep-a", operation: "scene", targetId: "scene-1" });
assert.equal(sceneLock.ok, false, "整集生成期间单场必须被互斥拦截");
const shotLock = acquireStoryboardWriteLock({ projectId: "proj-test", episodeId: "ep-a", operation: "shot", targetId: "shot-1" });
assert.equal(shotLock.ok, false, "整集生成期间单镜必须被互斥拦截");
const otherEpisode = acquireStoryboardWriteLock({ projectId: "proj-test", episodeId: "ep-b", operation: "scene", targetId: "scene-1" });
assert.equal(otherEpisode.ok, true, "不同分集不得互相阻塞");
if (otherEpisode.ok) releaseStoryboardWriteLock(otherEpisode.lock);
releaseStoryboardWriteLock(episodeLock.lock);
const afterRelease = acquireStoryboardWriteLock({ projectId: "proj-test", episodeId: "ep-a", operation: "shot", targetId: "shot-1" });
assert.equal(afterRelease.ok, true);
if (afterRelease.ok) releaseStoryboardWriteLock(afterRelease.lock);
const sceneHold = acquireStoryboardWriteLock({ projectId: "proj-test", episodeId: "ep-a", operation: "scene", targetId: "scene-1" });
assert.equal(sceneHold.ok, true);
if (!sceneHold.ok) throw new Error(sceneHold.error);
const otherSceneSameEpisode = acquireStoryboardWriteLock({ projectId: "proj-test", episodeId: "ep-a", operation: "scene", targetId: "scene-2" });
assert.equal(otherSceneSameEpisode.ok, false, "同集另一场也要被分集级锁拦截，避免场景间静默覆盖");
const shotDuringScene = acquireStoryboardWriteLock({ projectId: "proj-test", episodeId: "ep-a", operation: "shot", targetId: "shot-2" });
assert.equal(shotDuringScene.ok, false, "单场生成期间同场/同集单镜必须被互斥拦截");
releaseStoryboardWriteLock(sceneHold.lock);
assert.equal(hasStoryboardVersionConflict(13, 14), true);
assert.equal(hasStoryboardVersionConflict(13, 13), false);

// 5) 入队冻结模型：旧 job 保持 A，新 job 使用 B；参数对象不串。
const frozenA = createProductionJob({
    kind: "script", episodeIds: ["ep-a"], episodeNumbers: [1], model: modelA,
    modelParams: { temperature: 0.7, maxTokens: 4096, accountId: "db-a" }, promptVersion: "stage3-script-v1",
    sourceHandoffId: "h", sourceBlueprintVersion: 1, sourcePlanVersions: [1], targetEpisodeId: "ep-a", targetModule: "episode",
});
const frozenB = createProductionJob({
    kind: "script", episodeIds: ["ep-b"], episodeNumbers: [2], model: modelB,
    modelParams: { temperature: 0.2, maxTokens: 8192 }, promptVersion: "stage3-script-v1",
    sourceHandoffId: "h", sourceBlueprintVersion: 1, sourcePlanVersions: [1], targetEpisodeId: "ep-b", targetModule: "episode",
});
assert.deepEqual(frozenA.model, modelA);
assert.deepEqual(frozenB.model, modelB);
assert.equal(frozenA.modelParams.accountId, "db-a");
assert.equal(frozenA.modelParams.temperature, 0.7);
assert.equal(frozenB.modelParams.temperature, 0.2);
assert.equal(frozenA.capability, "text");
assert.ok(frozenA.modelFrozenAt);
assert.equal(frozenA.remoteState, "not_submitted");
assert.equal(frozenA.id === frozenB.id, false);

// 6) 场景替换保留锁定镜头，版本递增，镜号连续。
const script = {
    id: "script-test", scriptVersion: 1, sourceEpisodePlanId: "ep-001", sourceBlueprintVersion: 1, sourceHandoffId: "h",
    scenes: [{ sceneId: "scene-a" }, { sceneId: "scene-b" }],
} as unknown as StudioScriptDocument;
const lockedShot = { shotId: "shot-locked", shotNumber: 1, sceneId: "scene-a", shotGroupId: "group-a", locked: true, version: 1 };
const oldShot = { shotId: "shot-old", shotNumber: 2, sceneId: "scene-a", shotGroupId: "group-a", locked: false, version: 1 };
const existing = {
    storyboardVersion: 5,
    groups: [{ shotGroupId: "group-a", sceneId: "scene-a", groupNumber: 1, shotIds: ["shot-locked", "shot-old"] }],
    shots: [lockedShot, oldShot],
} as unknown as StudioStoryboardDocument;
const replaced = replaceSceneInStoryboard(existing, {
    episodeId: "ep-a", episodeNumber: 1, script, sceneId: "scene-a", reason: "test",
    groups: [{ shotGroupId: "group-new", sceneId: "scene-a", groupNumber: 1, shotIds: ["shot-new"] }],
    shots: [{ shotId: "shot-new", shotNumber: 1, sceneId: "scene-a", shotGroupId: "group-new", locked: false, version: 0 }],
});
assert.equal(replaced.storyboardVersion, 6);
assert.ok(replaced.shots.some((shot) => shot.shotId === lockedShot.shotId && shot.locked), "场景替换必须保留锁定镜头");
assert.ok(replaced.shots.some((shot) => shot.shotId === "shot-new"));
assert.ok(replaced.shots.every((shot, index) => shot.shotNumber === index + 1), "替换后镜号必须连续");

// 7) 不同状态的任务不污染 activeJobId 之外的持久化字段。
const noTask = createProductionJob({
    kind: "storyboard", episodeIds: ["ep-a"], episodeNumbers: [1], model: modelA,
    modelParams: { temperature: 0.7 }, promptVersion: "stage3-storyboard-v6",
    sourceHandoffId: "h", sourceBlueprintVersion: 1, sourcePlanVersions: [1], targetEpisodeId: "ep-a", targetSceneId: "scene-a", targetModule: "scene",
});
assert.equal(noTask.status, "pending");
assert.equal(noTask.remoteState, "not_submitted");
assert.equal(noTask.needsReview, false);

console.log(JSON.stringify({
    ok: true,
    tests: "stage3_1-core-check",
    hydration: {
        queued: "interrupted/not_submitted",
        submitting: "interrupted/unknown",
        unknown: "unknown",
        succeeded: "completed",
        legacyFailed: "failed/unknown",
    },
    selection: { resumable: resume.length, retryable: retry.length, review: review.length },
    lock: { episodeBlocksScene: true, episodeBlocksShot: true, sceneBlocksScene: true, sceneBlocksShot: true, differentEpisodePasses: true },
    frozenModel: { old: frozenA.model.modelId, next: frozenB.model.modelId },
    storyboard: { version: replaced.storyboardVersion, lockedShotKept: true, shots: replaced.shots.length },
}));
