// Stage 4B 审核写入：统一只改 storyboardReview 或镜头 locked 元数据。
// Stage 4D：审核写入改为 IndexedDB 事务确认；禁止用 Zustand 回读内存冒充持久化成功。
// 正式分镜内容与 storyboardVersion 不因审核 / 锁定而改变；冲突、锁定、stale 按批次部分成功。

import { findEpisode, useStudioStore } from "@/stores/use-studio-store";
import { commitReviewState } from "./review-persistence";
import { storyboardContentHash } from "./storyboard-snapshots";
import {
    planStoryboardReviewRefresh,
    planStoryboardReviewReReview,
    planStoryboardReviewStatus,
    planStoryboardShotLocks,
    shotReviewContentHash,
    type StudioStoryboardLockSkip,
    type StudioStoryboardReviewFailure,
    type StudioStoryboardReviewSkip,
} from "./review-engine";
import type { StudioContinuityScope } from "./continuity-engine";
import type {
    StudioContinuityCheckReport,
    StudioStoryboardReadiness,
    StudioStoryboardReview,
    StudioStoryboardReviewAction,
    StudioStoryboardShotStatus,
} from "@/types/studio-production";

const nowIso = () => new Date().toISOString();

export type Stage4ReviewActionResult = {
    ok: boolean;
    error?: string;
    conflict?: boolean;
    /** true 仅表示 IndexedDB 事务已提交并回读校验通过。 */
    persisted?: boolean;
    updated?: string[];
    skipped?: StudioStoryboardReviewSkip[];
    failed?: StudioStoryboardReviewFailure[];
    readiness?: StudioStoryboardReadiness;
    storyboardVersion?: number;
};

export type Stage4ShotLockResult = {
    ok: boolean;
    error?: string;
    conflict?: boolean;
    persisted?: boolean;
    updated?: string[];
    skipped?: StudioStoryboardLockSkip[];
    storyboardVersion?: number;
};

function readEpisode(projectId: string, episodeId: string) {
    return findEpisode(projectId, episodeId);
}

function reviewFailures(shotIds: string[], reason: StudioStoryboardReviewFailure["reason"], message: string): StudioStoryboardReviewFailure[] {
    return [...new Set(shotIds)].map((shotId) => ({ shotId, reason, message }));
}

function syncProjects(projects: ReturnType<typeof useStudioStore.getState>["projects"] | undefined) {
    if (projects) useStudioStore.setState({ projects });
}

function failedResult(error: string, conflict?: boolean, extra: Partial<Stage4ReviewActionResult> = {}): Stage4ReviewActionResult {
    return { ok: false, persisted: false, error, conflict, ...extra };
}

/** 重新跑确定性检查并落库；可按镜头 / 镜头组 / 场景 / 全集检查；不改审核结论与正式分镜。 */
export async function refreshStoryboardReviewAction(
    projectId: string,
    episodeId: string,
    expectedVersion?: number,
    scope: StudioContinuityScope = { type: "episode" },
    continuity?: StudioContinuityCheckReport,
): Promise<Stage4ReviewActionResult> {
    let committedRunId: string | undefined;
    let committedCheckedAt: string | undefined;
    const result = await commitReviewState({
        projectId,
        episodeId,
        expectedStoryboardVersion: expectedVersion ?? readEpisode(projectId, episodeId)?.production?.storyboard?.storyboardVersion ?? -1,
        apply: ({ production, document }) => {
            if (expectedVersion !== undefined && document.storyboardVersion !== expectedVersion) {
                return { ok: false, conflict: true, error: `当前正式分镜已变为 v${document.storyboardVersion}，原审核基于 v${expectedVersion}，请刷新后再检查` };
            }
            if (continuity) {
                if (continuity.storyboardVersion !== document.storyboardVersion) {
                    return { ok: false, conflict: true, error: `连续性检查基于 v${continuity.storyboardVersion}，当前正式分镜已是 v${document.storyboardVersion}；旧检查结果不能绑定新版本` };
                }
                if (continuity.episodeId !== episodeId) {
                    return { ok: false, conflict: true, error: "连续性检查所属分集与当前分集不一致；拒绝写入" };
                }
                if (continuity.scope.type !== scope.type || continuity.scope.id !== scope.id) {
                    return { ok: false, conflict: true, error: "连续性检查范围与提交范围不一致；拒绝写入" };
                }
            }
            const beforeHash = storyboardContentHash(document);
            const review = planStoryboardReviewRefresh({ document, script: production.script, review: production.storyboardReview, scope, continuity });
            const expectedRun = review.continuityRuns?.[0];
            committedRunId = expectedRun?.id;
            committedCheckedAt = review.readiness.checkedAt;
            return {
                ok: true,
                production: { ...production, storyboardReview: review, updatedAt: nowIso() },
                result: {
                    ok: true,
                    persisted: true,
                    readiness: review.readiness,
                    storyboardVersion: document.storyboardVersion,
                } satisfies Stage4ReviewActionResult,
                verifySaved: (saved) => {
                    if (!saved.storyboard || storyboardContentHash(saved.storyboard) !== beforeHash || saved.storyboard.storyboardVersion !== document.storyboardVersion) {
                        throw new Error("审核检查回读发现正式分镜被同时修改，已回滚");
                    }
                    const savedReview = saved.storyboardReview;
                    if (!savedReview || savedReview.readiness.checkedAt !== committedCheckedAt || (committedRunId && !savedReview.continuityRuns?.some((run) => run.id === committedRunId))) {
                        throw new Error("审核检查结果未能持久化，事务已回滚");
                    }
                },
            };
        },
    });
    syncProjects(result.projects);
    if (!result.ok) return { ...failedResult(result.error ?? "审核检查写入失败", result.conflict), ...(result.result as Partial<Stage4ReviewActionResult> | undefined) };
    return result.result as Stage4ReviewActionResult;
}

/** 单镜或批量审核；locked / stale / missing 镜头跳过，其余合法镜头提交，返回部分成功明细。 */
export async function setStoryboardShotReviewAction(input: {
    projectId: string;
    episodeId: string;
    shotIds: string[];
    status: StudioStoryboardShotStatus;
    action: StudioStoryboardReviewAction;
    note?: string;
    reporter?: string;
    expectedVersion: number;
    partialOnVersionChange?: boolean;
}): Promise<Stage4ReviewActionResult> {
    let committedUpdated: string[] = [];
    const result = await commitReviewState({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedStoryboardVersion: input.expectedVersion,
        apply: ({ production, document }) => {
            const plan = planStoryboardReviewStatus({
                document,
                script: production.script,
                review: production.storyboardReview,
                shotIds: input.shotIds,
                status: input.status,
                action: input.action,
                note: input.note,
                reviewer: input.reporter,
                expectedVersion: input.expectedVersion,
                partialOnVersionChange: input.partialOnVersionChange ?? true,
            });
            if (!plan.ok) {
                return {
                    ok: false,
                    error: plan.error,
                    conflict: plan.conflict,
                };
            }
            if (!plan.updated.length) {
                return {
                    ok: true,
                    production,
                    result: { ok: true, persisted: true, updated: [], skipped: plan.skipped, readiness: plan.review.readiness, storyboardVersion: document.storyboardVersion } satisfies Stage4ReviewActionResult,
                };
            }
            committedUpdated = plan.updated;
            const beforeHash = storyboardContentHash(document);
            return {
                ok: true,
                production: { ...production, storyboardReview: plan.review, updatedAt: nowIso() },
                result: { ok: true, persisted: true, updated: plan.updated, skipped: plan.skipped, readiness: plan.review.readiness, storyboardVersion: document.storyboardVersion } satisfies Stage4ReviewActionResult,
                verifySaved: (saved) => {
                    if (!saved.storyboard || storyboardContentHash(saved.storyboard) !== beforeHash || saved.storyboard.storyboardVersion !== document.storyboardVersion) {
                        throw new Error("审核提交回读发现正式分镜被同时修改，事务已回滚");
                    }
                    const savedReview = saved.storyboardReview;
                    if (!savedReview) throw new Error("审核状态未能持久化，事务已回滚");
                    for (const shotId of committedUpdated) {
                        const record = savedReview.shots[shotId];
                        if (!record || record.status !== input.status || record.storyboardVersion !== saved.storyboard.storyboardVersion || !record.shotContentHash) {
                            throw new Error(`审核状态回读不一致：${shotId}`);
                        }
                    }
                },
            };
        },
    });
    syncProjects(result.projects);
    if (!result.ok) {
        return failedResult(result.error ?? "审核提交失败", result.conflict, {
            ...(result.result as Partial<Stage4ReviewActionResult> | undefined),
            ...(result.conflict ? { failed: reviewFailures(input.shotIds, "version_conflict", result.error ?? "正式分镜已变化") } : {}),
        });
    }
    return result.result as Stage4ReviewActionResult;
}

/**
 * stale 明确复核：创建当前版本的新 pending 审核记录，旧 audits 完整保留。
 * 不修改旧记录的 storyboardVersion，不自动通过，不通过 refresh 清除 stale。
 */
export async function reReviewStoryboardShotsAction(input: {
    projectId: string;
    episodeId: string;
    shotIds: string[];
    expectedVersion: number;
    note?: string;
    reporter?: string;
}): Promise<Stage4ReviewActionResult> {
    let committedUpdated: string[] = [];
    const result = await commitReviewState({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedStoryboardVersion: input.expectedVersion,
        apply: ({ production, document }) => {
            const plan = planStoryboardReviewReReview({
                document,
                script: production.script,
                review: production.storyboardReview,
                shotIds: input.shotIds,
                expectedVersion: input.expectedVersion,
                note: input.note,
                reviewer: input.reporter,
            });
            if (!plan.ok) return { ok: false, error: plan.error, conflict: plan.conflict };
            if (!plan.updated.length) {
                return {
                    ok: true,
                    production,
                    result: { ok: true, persisted: true, updated: [], skipped: plan.skipped, readiness: plan.review.readiness, storyboardVersion: document.storyboardVersion } satisfies Stage4ReviewActionResult,
                };
            }
            committedUpdated = plan.updated;
            const beforeHash = storyboardContentHash(document);
            return {
                ok: true,
                production: { ...production, storyboardReview: plan.review, updatedAt: nowIso() },
                result: { ok: true, persisted: true, updated: plan.updated, skipped: plan.skipped, readiness: plan.review.readiness, storyboardVersion: document.storyboardVersion } satisfies Stage4ReviewActionResult,
                verifySaved: (saved) => {
                    if (!saved.storyboard || storyboardContentHash(saved.storyboard) !== beforeHash || saved.storyboard.storyboardVersion !== document.storyboardVersion) {
                        throw new Error("重新审核回读发现正式分镜被同时修改，事务已回滚");
                    }
                    const savedReview = saved.storyboardReview;
                    if (!savedReview || !saved.storyboard) throw new Error("重新审核状态未能持久化，事务已回滚");
                    const savedVersion = saved.storyboard.storyboardVersion;
                    for (const shotId of committedUpdated) {
                        const record = savedReview.shots[shotId];
                        if (!record || record.status !== "pending" || record.storyboardVersion !== savedVersion || !record.shotContentHash) {
                            throw new Error(`重新审核记录回读不一致：${shotId}`);
                        }
                        if (!savedReview.audits.some((audit) => audit.shotId === shotId && audit.action === "re_review" && audit.storyboardVersion === savedVersion)) {
                            throw new Error(`重新审核历史未落盘：${shotId}`);
                        }
                    }
                },
            };
        },
    });
    syncProjects(result.projects);
    if (!result.ok) {
        return failedResult(result.error ?? "重新审核失败", result.conflict, {
            ...(result.result as Partial<Stage4ReviewActionResult> | undefined),
            ...(result.conflict ? { failed: reviewFailures(input.shotIds, "version_conflict", result.error ?? "正式分镜已变化") } : {}),
        });
    }
    return result.result as Stage4ReviewActionResult;
}

/**
 * 批量锁定 / 解锁：只写 shot.locked，不递增 storyboardVersion，不触碰 storyboardReview。
 * 解锁必须由 UI 显式确认；整份分镜锁定不能从第四步逐镜解锁。
 */
export async function setStoryboardShotLocksAction(input: {
    projectId: string;
    episodeId: string;
    shotIds: string[];
    locked: boolean;
    expectedVersion: number;
}): Promise<Stage4ShotLockResult> {
    const result = await commitReviewState({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedStoryboardVersion: input.expectedVersion,
        apply: ({ production, document }) => {
            const plan = planStoryboardShotLocks({
                document,
                shotIds: input.shotIds,
                locked: input.locked,
                expectedVersion: input.expectedVersion,
            });
            if (!plan.ok) return { ok: false, error: plan.error, conflict: plan.conflict };
            if (!plan.updated.length) {
                return {
                    ok: true,
                    production,
                    result: { ok: true, persisted: true, updated: [], skipped: plan.skipped, storyboardVersion: document.storyboardVersion } satisfies Stage4ShotLockResult,
                };
            }
            const beforeReview = production.storyboardReview;
            const beforeContent = new Map(document.shots.map((shot) => [shot.shotId, shotReviewContentHash(shot)]));
            const nextDocument = {
                ...document,
                shots: document.shots.map((shot) => plan.updates[shot.shotId] === undefined ? shot : { ...shot, locked: plan.updates[shot.shotId], updatedAt: nowIso() }),
                updatedAt: nowIso(),
            };
            return {
                ok: true,
                production: { ...production, storyboard: nextDocument, updatedAt: nowIso() },
                result: { ok: true, persisted: true, updated: plan.updated, skipped: plan.skipped, storyboardVersion: nextDocument.storyboardVersion } satisfies Stage4ShotLockResult,
                verifySaved: (saved) => {
                    const savedDoc = saved.storyboard;
                    if (!savedDoc || savedDoc.storyboardVersion !== document.storyboardVersion) throw new Error("锁定回读发现正式分镜版本被同时修改，事务已回滚");
                    for (const [shotId, hash] of beforeContent) {
                        const savedShot = savedDoc.shots.find((shot) => shot.shotId === shotId);
                        if (!savedShot || shotReviewContentHash(savedShot) !== hash) throw new Error("锁定回读发现镜头内容被同时修改，事务已回滚");
                    }
                    const missing = plan.updated.filter((shotId) => {
                        const shot = savedDoc.shots.find((item) => item.shotId === shotId);
                        return !shot || shot.locked !== input.locked;
                    });
                    if (missing.length) throw new Error(`锁定状态回读不一致：${missing.join("、")}`);
                    if (JSON.stringify(beforeReview ?? null) !== JSON.stringify(saved.storyboardReview ?? null)) {
                        throw new Error("锁定操作意外改变了审核记录，事务已回滚");
                    }
                },
            };
        },
    });
    syncProjects(result.projects);
    if (!result.ok) return { ok: false, persisted: false, error: result.error ?? "锁定操作失败", conflict: result.conflict, ...(result.result as Partial<Stage4ShotLockResult> | undefined) };
    return result.result as Stage4ShotLockResult;
}

export function storyboardReviewForEpisode(projectId: string, episodeId: string): StudioStoryboardReview | undefined {
    return readEpisode(projectId, episodeId)?.production?.storyboardReview;
}
