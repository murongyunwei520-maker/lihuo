// Stage 4D：AI 审核、提案决策与安全应用。
// 审核结果只写 storyboardReview.aiReviewRuns / proposals，绝不直接改正式分镜；
// 应用提案走正式分镜写入协议（版本闸门 + 备份快照 + formal 快照 + 回读校验）。

import { nanoid } from "nanoid";

import { findEpisode, findProject, refreshStudioStoreFromPersistence, useStudioStore } from "@/stores/use-studio-store";
import { buildContinuityCheck, type StudioContinuityScope } from "./continuity-engine";
import { createEmptyStoryboardReview, normalizeStoryboardReview, planStoryboardReviewRefresh, stampStoryboardReviewContext } from "./review-engine";
import { commitReviewState } from "./review-persistence";
import { parseStudioEnvelope } from "@/lib/studio-store-persistence";
import { commitFormalStoryboardWrite } from "./storyboard-write-protocol";
import { createStoryboardSnapshot } from "./storyboard-snapshots";
import { validateStoryboardDocument } from "./production-engine";
import { applyCommittedProduction, syncAfterFormalWrite } from "./production-actions";
import { buildStoryboardReviewPrompt, buildAiReviewRun, callStoryboardAiReview, STAGE4D_REVIEW_PROMPT_VERSION, type StoryboardAiReviewCallResult } from "./review-ai";
import { planProposalChanges, proposalDependencyError } from "./stage4d-engine";
import { validateStoryboardAssetReferences } from "./storyboard-asset-validation";
import { simpleHash } from "./novel-chapters";
import type { NovelTextModelRuntimeOverride } from "./novel-model";
import type { StudioProject } from "@/types/studio";
import type { StudioStateStore } from "@/lib/studio-store-persistence";
import type {
    StudioAiAdjustmentProposal,
    StudioAiProposalApplication,
    StudioAiProposalApplicationStatus,
    StudioAiReviewRun,
    StudioEpisodeProduction,
    StudioProductionCheck,
    StudioStoryboardDocument,
} from "@/types/studio-production";

const nowIso = () => new Date().toISOString();

export type Stage4AiReviewActionResult = {
    ok: boolean;
    persisted?: boolean;
    conflict?: boolean;
    run?: StudioAiReviewRun;
    proposals?: StudioAiAdjustmentProposal[];
    error?: string;
};

export type Stage4ProposalApplyResult = {
    ok: boolean;
    persisted?: boolean;
    conflict?: boolean;
    appliedChangeIds?: string[];
    newVersion?: number;
    applicationId?: string;
    error?: string;
    details?: string[];
    /** 资产 ID 有效、但当前模型没有独立变体记录；不能当作已验证事实。 */
    unverifiedAssetDetails?: string[];
};

function setProjects(projects: StudioProject[] | undefined) {
    if (projects) useStudioStore.setState({ projects });
}

function mergeChecks(existing: StudioProductionCheck[], incoming: StudioProductionCheck[]): StudioProductionCheck[] {
    const byId = new Map(existing.map((check) => [check.id, check]));
    for (const check of incoming) {
        const previous = byId.get(check.id);
        byId.set(check.id, previous && previous.status !== "open" ? { ...check, status: previous.status } : check);
    }
    return [...byId.values()];
}

function episodeSnapshot(projectId: string, episodeId: string) {
    const episode = findEpisode(projectId, episodeId);
    return {
        episode,
        document: episode?.production?.storyboard,
        production: episode?.production,
        review: episode?.production?.storyboardReview,
    };
}

async function persistAiReview(input: {
    projectId: string;
    episodeId: string;
    expectedVersion: number;
    run: StudioAiReviewRun;
    proposals: StudioAiAdjustmentProposal[];
    store?: StudioStateStore;
}): Promise<{ ok: boolean; persisted: boolean; conflict?: boolean; error?: string }> {
    const applyRun = (currentDocument: StudioStoryboardDocument, currentProduction: StudioEpisodeProduction) => {
        const baseReview = normalizeStoryboardReview(currentProduction.storyboardReview, currentDocument, nowIso(), undefined, { persistDerivedConflicts: true })
            ?? createEmptyStoryboardReview(currentDocument.episodeId, currentDocument.storyboardVersion, nowIso());
        const nextReview = {
            ...baseReview,
            aiReviewRuns: [input.run, ...(baseReview.aiReviewRuns ?? []).filter((run) => run.runId !== input.run.runId)].slice(0, 50),
            proposals: [...input.proposals, ...(baseReview.proposals ?? []).filter((proposal) => !input.proposals.some((item) => item.proposalId === proposal.proposalId))].slice(0, 100),
            updatedAt: nowIso(),
        };
        return {
            ok: true as const,
            production: { ...currentProduction, storyboardReview: nextReview, updatedAt: nowIso() },
            result: { ok: true, persisted: true, run: input.run, proposals: input.proposals } satisfies Stage4AiReviewActionResult,
            verifySaved: (saved: StudioEpisodeProduction) => {
                if (!saved.storyboardReview?.aiReviewRuns?.some((run) => run.runId === input.run.runId)) throw new Error("AI 审核记录回读失败");
                for (const proposal of input.proposals) {
                    if (!saved.storyboardReview.proposals?.some((item) => item.proposalId === proposal.proposalId)) throw new Error(`AI 提案回读失败：${proposal.proposalId}`);
                }
            },
        };
    };
    let result = await commitReviewState({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedStoryboardVersion: input.expectedVersion,
        store: input.store,
        apply: ({ production, document }) => applyRun(document, production),
    });
    setProjects(result.projects);
    if (result.ok) return { ok: true, persisted: true };
    if (!result.conflict) return { ok: false, persisted: false, error: result.error ?? "AI 审核记录保存失败" };
    // 模型调用期间正式分镜被其他操作更新：审核记录仍要保留，但必须绑定原版本并显式标注 stale。
    await refreshStudioStoreFromPersistence();
    const current = episodeSnapshot(input.projectId, input.episodeId);
    if (!current.document) return { ok: false, persisted: false, conflict: true, error: "正式分镜已不存在，AI 审核记录未保存" };
    input.run.warnings = [...(input.run.warnings ?? []), `审核基于 v${input.run.storyboardVersion}，提交时正式分镜已变为 v${current.document.storyboardVersion}；本记录保留为旧版本审核`];
    result = await commitReviewState({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedStoryboardVersion: current.document.storyboardVersion,
        store: input.store,
        apply: ({ production, document }) => applyRun(document, production),
    });
    setProjects(result.projects);
    if (!result.ok) return { ok: false, persisted: false, conflict: true, error: `AI 审核结果未能保存：${result.error ?? "写入失败"}` };
    return { ok: true, persisted: true, conflict: true };
}

/**
 * 单镜头 / 选中镜头 / 整集审核。先固定正式版本快照，再调用模型；
 * 审核期间版本变化时，结果仍保留为旧版本记录，不冒充当前审核。
 */
export async function runStoryboardAiReviewAction(input: {
    projectId: string;
    episodeId: string;
    scopeType: "shot" | "selection" | "episode";
    shotIds?: string[];
    model?: NovelTextModelRuntimeOverride;
    signal?: AbortSignal;
    store?: StudioStateStore;
    /** 测试注入；生产调用默认走真实 Bridge 模型。 */
    reviewCall?: (input: Parameters<typeof callStoryboardAiReview>[0]) => Promise<StoryboardAiReviewCallResult>;
}): Promise<Stage4AiReviewActionResult> {
    const project = findProject(input.projectId);
    const snapshot = episodeSnapshot(input.projectId, input.episodeId);
    if (!project || !snapshot.episode || !snapshot.document || !snapshot.production) {
        return { ok: false, persisted: false, error: "项目、分集或正式分镜不存在" };
    }
    const document = snapshot.document;
    const script = snapshot.production.script;
    const requestedIds = input.scopeType === "episode" ? document.shots.map((shot) => shot.shotId) : [...new Set(input.shotIds ?? [])];
    if (!requestedIds.length) return { ok: false, persisted: false, error: "没有选择要审核的镜头" };
    const missing = requestedIds.filter((id) => !document.shots.some((shot) => shot.shotId === id));
    if (missing.length) return { ok: false, persisted: false, error: `镜头不存在：${missing.join("、")}` };
    const shots = document.shots.filter((shot) => requestedIds.includes(shot.shotId));
    const selectedIndexes = new Set(shots.map((shot) => document.shots.findIndex((item) => item.shotId === shot.shotId)));
    const contextShots = input.scopeType === "episode"
        ? []
        : document.shots.filter((shot) => {
              const index = document.shots.findIndex((item) => item.shotId === shot.shotId);
              if (selectedIndexes.has(index)) return true;
              return [...selectedIndexes].some((selectedIndex) => Math.abs(index - selectedIndex) === 1);
          });
    const scope: StudioContinuityScope = input.scopeType === "shot" ? { type: "shot", id: shots[0].shotId } : { type: "episode" };
    const continuity = buildContinuityCheck({ document, script, scope });
    const runId = `ai-review-${nanoid(10)}`;
    const startedAt = nowIso();
    const allowedFindingShotIds = [...new Set([...requestedIds, ...contextShots.map((shot) => shot.shotId)])];
    const prompt = buildStoryboardReviewPrompt({
        project,
        document,
        script,
        shots,
        contextShots,
        scopeType: input.scopeType,
        continuity,
        review: snapshot.review,
    });
    try {
        const call = input.reviewCall ?? callStoryboardAiReview;
        const result = await call({
            project,
            prompt,
            document,
            script,
            scopeType: input.scopeType,
            scopeShotIds: requestedIds,
            allowedFindingShotIds,
            allowedProposalShotIds: requestedIds,
            continuity,
            runId,
            model: input.model,
            signal: input.signal,
        });
        const run = buildAiReviewRun({
            runId,
            projectId: input.projectId,
            document,
            scopeType: input.scopeType,
            scopeShotIds: requestedIds,
            continuity,
            parsed: result.parsed,
            trace: result.trace,
            promptVersion: result.promptVersion,
            startedAt,
        });
        const persisted = await persistAiReview({ projectId: input.projectId, episodeId: input.episodeId, expectedVersion: document.storyboardVersion, run, proposals: result.parsed.proposals, store: input.store });
        if (!persisted.ok) {
            return { ok: false, persisted: false, conflict: persisted.conflict, run, proposals: run ? result.parsed.proposals : undefined, error: persisted.error };
        }
        return { ok: true, persisted: true, conflict: persisted.conflict, run, proposals: result.parsed.proposals };
    } catch (error) {
        const message = error instanceof Error ? error.message : "AI 审核失败";
        const run = buildAiReviewRun({
            runId,
            projectId: input.projectId,
            document,
            scopeType: input.scopeType,
            scopeShotIds: requestedIds,
            continuity,
            promptVersion: STAGE4D_REVIEW_PROMPT_VERSION,
            error: message,
            startedAt,
        });
        const persisted = await persistAiReview({ projectId: input.projectId, episodeId: input.episodeId, expectedVersion: document.storyboardVersion, run, proposals: [], store: input.store });
        return { ok: false, persisted: persisted.persisted, conflict: persisted.conflict, run, error: persisted.ok ? message : `${message}；审核失败记录也未能保存：${persisted.error}` };
    }
}

async function recordProposalOutcome(input: {
    projectId: string;
    episodeId: string;
    expectedVersion: number;
    proposalId: string;
    status: StudioAiProposalApplicationStatus;
    acceptedChangeIds: string[];
    error: string;
    operationId?: string;
    conflictSnapshotId?: string;
    afterVersion?: number;
    store?: StudioStateStore;
}): Promise<{ ok: boolean; applicationId?: string; error?: string }> {
    const applicationId = `ai-apply-${nanoid(10)}`;
    let writtenApplicationId = applicationId;
    const appliedAt = nowIso();
    const result = await commitReviewState({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedStoryboardVersion: input.expectedVersion,
        store: input.store,
        apply: ({ production, document }) => {
            const review = normalizeStoryboardReview(production.storyboardReview, document, appliedAt, undefined, { persistDerivedConflicts: true });
            const proposal = review?.proposals?.find((item) => item.proposalId === input.proposalId);
            if (!review || !proposal) return { ok: false, error: "提案不存在或已被清理，未写入应用记录" };
            const existingConflict = input.status === "conflict"
                ? review.proposalApplications?.find((item) => item.proposalId === input.proposalId && item.status === "conflict" && item.derived !== true)
                : undefined;
            writtenApplicationId = existingConflict?.applicationId ?? applicationId;
            const application: StudioAiProposalApplication = {
                applicationId: writtenApplicationId,
                proposalId: input.proposalId,
                runId: proposal.runId,
                status: input.status,
                acceptedChangeIds: input.acceptedChangeIds,
                beforeVersion: proposal.storyboardVersion,
                afterVersion: input.afterVersion,
                operationId: existingConflict?.operationId ?? input.operationId,
                conflictSnapshotId: input.conflictSnapshotId,
                error: input.error,
                persisted: true,
                derived: false,
                appliedAt: existingConflict?.appliedAt ?? appliedAt,
            };
            const nextProposal: StudioAiAdjustmentProposal = {
                ...proposal,
                decision: {
                    ...proposal.decision,
                    status: input.status === "applied" ? "accepted" : input.status === "conflict" ? "conflict" : "failed",
                    acceptedChangeIds: input.acceptedChangeIds,
                    rejectedChangeIds: proposal.changes.filter((change) => !input.acceptedChangeIds.includes(change.changeId)).map((change) => change.changeId),
                    note: input.error,
                    decidedAt: appliedAt,
                    decidedBy: "local-user",
                },
                updatedAt: appliedAt,
            };
            const nextReview = {
                ...review,
                proposals: (review.proposals ?? []).map((item) => item.proposalId === input.proposalId ? nextProposal : item),
                proposalApplications: existingConflict
                    ? (review.proposalApplications ?? []).map((item) => item.applicationId === writtenApplicationId ? application : item)
                    : [application, ...(review.proposalApplications ?? [])].slice(0, 100),
                updatedAt: appliedAt,
            };
            return {
                ok: true,
                production: { ...production, storyboardReview: nextReview, updatedAt: appliedAt },
                result: { ok: true, persisted: true, applicationId: writtenApplicationId },
                verifySaved: (saved: StudioEpisodeProduction) => {
                    const savedReview = saved.storyboardReview;
                    if (!savedReview?.proposalApplications?.some((item) => item.applicationId === writtenApplicationId)) throw new Error("提案应用记录回读失败");
                    if (!savedReview.proposals?.some((item) => item.proposalId === input.proposalId && item.decision.status === (input.status === "applied" ? "accepted" : input.status === "conflict" ? "conflict" : "failed"))) {
                        throw new Error("提案决策回读失败");
                    }
                },
            };
        },
    });
    setProjects(result.projects);
    if (!result.ok) return { ok: false, error: result.error ?? "提案结果保存失败" };
    return { ok: true, applicationId: writtenApplicationId };
}

/** 用户拒绝提案：只记决策，不改正式分镜。 */
export async function rejectAiProposalAction(input: {
    projectId: string;
    episodeId: string;
    proposalId: string;
    note?: string;
    store?: StudioStateStore;
}): Promise<Stage4AiReviewActionResult> {
    const snapshot = episodeSnapshot(input.projectId, input.episodeId);
    if (!snapshot.document) return { ok: false, persisted: false, error: "当前分集还没有正式分镜" };
    const result = await commitReviewState({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedStoryboardVersion: snapshot.document.storyboardVersion,
        store: input.store,
        apply: ({ production, document }) => {
            const review = normalizeStoryboardReview(production.storyboardReview, document, nowIso(), undefined, { persistDerivedConflicts: true });
            const proposal = review?.proposals?.find((item) => item.proposalId === input.proposalId);
            if (!review || !proposal) return { ok: false, error: "提案不存在" };
            if (proposal.decision.status !== "pending") {
                return { ok: false, error: `提案已是「${proposal.decision.status}」状态，不能重复拒绝` };
            }
            const now = nowIso();
            const nextProposal: StudioAiAdjustmentProposal = {
                ...proposal,
                decision: { status: "rejected", acceptedChangeIds: [], rejectedChangeIds: proposal.changes.map((change) => change.changeId), note: input.note, decidedAt: now, decidedBy: "local-user" },
                updatedAt: now,
            };
            return {
                ok: true,
                production: {
                    ...production,
                    storyboardReview: { ...review, proposals: (review.proposals ?? []).map((item) => item.proposalId === input.proposalId ? nextProposal : item), updatedAt: now },
                    updatedAt: now,
                },
                result: { ok: true, persisted: true } satisfies Stage4AiReviewActionResult,
                verifySaved: (saved) => {
                    if (!saved.storyboardReview?.proposals?.some((item) => item.proposalId === input.proposalId && item.decision.status === "rejected")) {
                        throw new Error("提案拒绝决策回读失败");
                    }
                },
            };
        },
    });
    setProjects(result.projects);
    if (!result.ok) return { ok: false, persisted: false, error: result.error ?? "提案拒绝保存失败", conflict: result.conflict };
    return { ok: true, persisted: true };
}

/**
 * 将过期但仍 pending 的提案显式标记为版本冲突。只写审核决策与应用记录，
 * 不触碰正式分镜、不 rebase、不重新应用任何 change。
 */
export async function markAiProposalConflictAction(input: {
    projectId: string;
    episodeId: string;
    proposalId: string;
    store?: StudioStateStore;
}): Promise<Stage4AiReviewActionResult> {
    const snapshot = episodeSnapshot(input.projectId, input.episodeId);
    const proposal = snapshot.review?.proposals?.find((item) => item.proposalId === input.proposalId);
    if (!snapshot.document || !proposal) return { ok: false, persisted: false, error: "提案或正式分镜不存在" };
    if (proposal.decision.status !== "pending") {
        return { ok: false, persisted: false, error: `提案已是「${proposal.decision.status}」状态，不能重复标记冲突` };
    }
    if (proposal.storyboardVersion === snapshot.document.storyboardVersion) {
        return { ok: false, persisted: false, error: "提案仍基于当前正式版本，不能标记为版本冲突；请直接应用或拒绝" };
    }
    const message = `提案基于 v${proposal.storyboardVersion}，当前正式分镜已是 v${snapshot.document.storyboardVersion}；用户标记为版本冲突，未应用、未 rebase。`;
    const recorded = await recordProposalOutcome({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedVersion: snapshot.document.storyboardVersion,
        proposalId: input.proposalId,
        status: "conflict",
        acceptedChangeIds: [],
        store: input.store,
        error: message,
    });
    return {
        ok: recorded.ok,
        persisted: recorded.ok,
        conflict: true,
        error: recorded.ok ? undefined : `版本冲突记录保存失败：${recorded.error ?? "未知错误"}`,
    };
}

/**
 * 应用提案：只应用 acceptedChangeIds；版本、依赖版本、人工编辑、before 全部重新校验。
 * 成功后在同一正式写入事务内递增版本、保存 backup + formal 快照、重跑连续性并更新审核记录。
 */
export async function applyAiProposalAction(input: {
    projectId: string;
    episodeId: string;
    proposalId: string;
    acceptedChangeIds: string[];
    store?: StudioStateStore;
}): Promise<Stage4ProposalApplyResult> {
    const project = findProject(input.projectId);
    const snapshot = episodeSnapshot(input.projectId, input.episodeId);
    if (!project || !snapshot.episode || !snapshot.document || !snapshot.production) {
        return { ok: false, persisted: false, error: "项目、分集或正式分镜不存在" };
    }
    const proposal = snapshot.review?.proposals?.find((item) => item.proposalId === input.proposalId);
    if (!proposal) return { ok: false, persisted: false, error: "提案不存在" };
    if (proposal.decision.status !== "pending") {
        return {
            ok: false,
            persisted: false,
            conflict: proposal.decision.status === "conflict",
            error: `提案已是「${proposal.decision.status}」状态，不能重复应用；请重新审核生成新提案`,
        };
    }
    const acceptedIds = [...new Set(input.acceptedChangeIds)];
    if (!acceptedIds.length) return { ok: false, persisted: false, error: "没有选择要应用的修改" };
    if (proposal.storyboardVersion !== snapshot.document.storyboardVersion) {
        const message = `提案基于 v${proposal.storyboardVersion}，当前正式分镜已是 v${snapshot.document.storyboardVersion}；已阻止静默覆盖`;
        const recorded = await recordProposalOutcome({
            projectId: input.projectId,
            episodeId: input.episodeId,
            expectedVersion: snapshot.document.storyboardVersion,
            proposalId: input.proposalId,
            status: "conflict",
            acceptedChangeIds: acceptedIds,
            store: input.store,
            error: message,
        });
        return { ok: false, persisted: recorded.ok, conflict: true, error: recorded.ok ? message : `${message}；冲突记录保存失败：${recorded.error}` };
    }
    const dependencyError = proposalDependencyError(proposal, snapshot.document, snapshot.production.script?.scriptVersion);
    if (dependencyError) {
        const recorded = await recordProposalOutcome({
            projectId: input.projectId,
            episodeId: input.episodeId,
            expectedVersion: snapshot.document.storyboardVersion,
            proposalId: input.proposalId,
            status: "conflict",
            acceptedChangeIds: acceptedIds,
            store: input.store,
            error: dependencyError,
        });
        return { ok: false, persisted: recorded.ok, conflict: true, error: recorded.ok ? dependencyError : `${dependencyError}；冲突记录保存失败：${recorded.error}` };
    }
    const preview = planProposalChanges(snapshot.document, proposal, acceptedIds, snapshot.production.script?.scriptVersion);
    if (!preview.ok) {
        const recorded = await recordProposalOutcome({
            projectId: input.projectId,
            episodeId: input.episodeId,
            expectedVersion: snapshot.document.storyboardVersion,
            proposalId: input.proposalId,
            status: "failed",
            acceptedChangeIds: acceptedIds,
            store: input.store,
            error: preview.details.length ? `${preview.error}：${preview.details.join("；")}` : preview.error,
        });
        return { ok: false, persisted: recorded.ok, conflict: false, error: preview.error, details: preview.details };
    }
    const previewAssetCheck = validateStoryboardAssetReferences(preview.document, project.assets);
    if (!previewAssetCheck.ok) {
        const recorded = await recordProposalOutcome({
            projectId: input.projectId,
            episodeId: input.episodeId,
            expectedVersion: snapshot.document.storyboardVersion,
            proposalId: input.proposalId,
            status: "failed",
            acceptedChangeIds: acceptedIds,
            store: input.store,
            error: previewAssetCheck.error,
        });
        return { ok: false, persisted: recorded.ok, conflict: false, error: previewAssetCheck.error, details: previewAssetCheck.details };
    }
    const previewDocument: StudioStoryboardDocument = {
        ...preview.document,
        storyboardVersion: snapshot.document.storyboardVersion + 1,
        updatedAt: nowIso(),
    };
    const operationId = `ai-apply-${nanoid(10)}`;
    const commit = await commitFormalStoryboardWrite({
        projectId: input.projectId,
        episodeId: input.episodeId,
        operationId,
        operationType: "ai_proposal_apply",
        expectedVersion: proposal.storyboardVersion,
        scope: { kind: "document" },
        candidateDocument: previewDocument,
        fallbackProjects: useStudioStore.getState().projects,
        store: input.store,
        hooks: {
            afterWrite: (readBack) => {
                const envelope = parseStudioEnvelope(readBack);
                const savedReview = (envelope?.state?.projects as StudioProject[] | undefined)
                    ?.find((item) => item.id === input.projectId)
                    ?.episodes.find((item) => item.id === input.episodeId)
                    ?.production?.storyboardReview;
                if (!savedReview || savedReview.storyboardVersion !== previewDocument.storyboardVersion) throw new Error("提案应用后审核记录版本回读失败");
                if (!savedReview.proposalApplications?.some((item) => item.operationId === operationId && item.status === "applied")) throw new Error("提案应用记录未落盘");
                if (!savedReview.proposals?.some((item) => item.proposalId === input.proposalId && (item.decision.status === "accepted" || item.decision.status === "partial"))) throw new Error("提案决策未落盘");
            },
        },
        apply: ({ production, project: currentProject, current, currentVersion }) => {
            if (!current) return { ok: false, conflict: true, error: "当前正式分镜不存在" };
            const reviewProposal = production.storyboardReview?.proposals?.find((item) => item.proposalId === input.proposalId);
            if (!reviewProposal) return { ok: false, conflict: true, error: "提案在写入时已不存在" };
            if (reviewProposal.storyboardVersion !== current.storyboardVersion) {
                return { ok: false, conflict: true, error: `提案基于 v${reviewProposal.storyboardVersion}，当前是 v${current.storyboardVersion}` };
            }
            const dependencyError = proposalDependencyError(reviewProposal, current, production.script?.scriptVersion);
            if (dependencyError) return { ok: false, conflict: true, error: dependencyError };
            const plan = planProposalChanges(current, reviewProposal, acceptedIds, production.script?.scriptVersion);
            if (!plan.ok) return { ok: false, error: plan.details.length ? `${plan.error}：${plan.details.join("；")}` : plan.error };
            const assetCheck = validateStoryboardAssetReferences(plan.document, currentProject.assets);
            if (!assetCheck.ok) return { ok: false, error: assetCheck.error };
            const nextDocument: StudioStoryboardDocument = { ...plan.document, storyboardVersion: currentVersion + 1, updatedAt: nowIso() };
            const script = production.script;
            const nextReport = buildContinuityCheck({ document: nextDocument, script, scope: { type: "episode" } });
            const refreshed = planStoryboardReviewRefresh({ document: nextDocument, script, review: production.storyboardReview, scope: { type: "episode" }, continuity: nextReport });
            const applicationId = `ai-apply-${simpleHash(`${operationId}:${input.proposalId}`)}`;
            const selectedSet = new Set(acceptedIds);
            const nextProposal: StudioAiAdjustmentProposal = {
                ...reviewProposal,
                decision: {
                    status: plan.applied.length === reviewProposal.changes.length ? "accepted" : "partial",
                    acceptedChangeIds: plan.applied.map((change) => change.changeId),
                    rejectedChangeIds: reviewProposal.changes.filter((change) => !selectedSet.has(change.changeId)).map((change) => change.changeId),
                    note: "用户确认应用",
                    decidedAt: nowIso(),
                    decidedBy: "local-user",
                },
                updatedAt: nowIso(),
            };
            const application: StudioAiProposalApplication = {
                applicationId,
                proposalId: input.proposalId,
                runId: reviewProposal.runId,
                status: "applied",
                acceptedChangeIds: plan.applied.map((change) => change.changeId),
                beforeVersion: current.storyboardVersion,
                afterVersion: nextDocument.storyboardVersion,
                operationId,
                persisted: true,
                appliedAt: nowIso(),
            };
            const nextReview = stampStoryboardReviewContext({
                ...refreshed,
                proposals: (refreshed.proposals ?? []).map((item) => item.proposalId === input.proposalId ? nextProposal : item),
                proposalApplications: [application, ...(refreshed.proposalApplications ?? [])].slice(0, 50),
                updatedAt: nowIso(),
            }, { projectId: input.projectId, episodeId: nextDocument.episodeId, episodeNumber: nextDocument.episodeNumber });
            const checks = script ? validateStoryboardDocument(nextDocument, script) : [];
            const scriptChecks = production.checks.filter((check) => check.category === "剧本结构" || check.category === "时长" || check.category === "剧本对白");
            const backup = createStoryboardSnapshot({
                document: current,
                snapshotType: "backup",
                basedOnVersion: current.storyboardVersion,
                reason: "AI 提案应用前快照",
                sourceTaskId: operationId,
            });
            const formal = createStoryboardSnapshot({
                document: nextDocument,
                snapshotType: "formal",
                basedOnVersion: nextDocument.storyboardVersion,
                reason: `AI 提案应用 v${nextDocument.storyboardVersion}`,
                sourceTaskId: operationId,
            });
            const productionNext: StudioEpisodeProduction = {
                ...production,
                storyboard: nextDocument,
                storyboardReview: nextReview,
                storyboardVersions: [backup, formal, ...production.storyboardVersions].slice(0, 20),
                checks: mergeChecks([...scriptChecks, ...checks], checks),
                updatedAt: nowIso(),
            };
            return {
                ok: true,
                production: productionNext,
                document: nextDocument,
                backup,
                result: {
                    ok: true,
                    persisted: true,
                    appliedChangeIds: plan.applied.map((change) => change.changeId),
                    newVersion: nextDocument.storyboardVersion,
                    applicationId,
                    unverifiedAssetDetails: assetCheck.status === "unverified" ? assetCheck.unverifiedDetails : undefined,
                } satisfies Stage4ProposalApplyResult,
            };
        },
    });
    if (commit.projects) setProjects(commit.projects);
    if (commit.production) applyCommittedProduction(input.projectId, input.episodeId, commit.production);
    if (commit.ok) {
        syncAfterFormalWrite(input.projectId, input.episodeId, commit.production);
        return commit.result as Stage4ProposalApplyResult;
    }
    if (commit.conflict) {
        const message = commit.error ?? "正式分镜已在应用期间变化";
        const recorded = await recordProposalOutcome({
            projectId: input.projectId,
            episodeId: input.episodeId,
            expectedVersion: commit.conflict.currentVersion,
            proposalId: input.proposalId,
            status: "conflict",
            acceptedChangeIds: acceptedIds,
            store: input.store,
            error: message,
            operationId,
            conflictSnapshotId: commit.conflict.preservedSnapshotId,
        });
        return { ok: false, persisted: recorded.ok, conflict: true, error: recorded.ok ? message : `${message}；冲突记录保存失败：${recorded.error}` };
    }
    const recorded = await recordProposalOutcome({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedVersion: proposal.storyboardVersion,
        proposalId: input.proposalId,
        status: "failed",
        acceptedChangeIds: acceptedIds,
        store: input.store,
        error: commit.error ?? "应用失败",
        operationId,
    });
    return { ok: false, persisted: recorded.ok, error: commit.error ?? "应用失败" };
}
