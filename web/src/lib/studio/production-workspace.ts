// 阶段 3 工作区的默认值、兼容归一化与状态收口。
// 只读写 StudioProject.production / StudioEpisode.production；不新建项目根，也不改 2B 数据。

import type { StudioProject } from "@/types/studio";
import type {
    StudioEpisodeProduction,
    StudioProductionJob,
    StudioProductionJobRemoteState,
    StudioProductionJobReviewDecision,
    StudioProductionJobStatus,
    StudioProductionSkipRecord,
    StudioProductionWorkspace,
    StudioProductionCheck,
    StudioScriptDocument,
    StudioStoryboardDocument,
} from "@/types/studio-production";
import { ensureScriptManualModules, ensureScriptSceneVersions, scriptContentHash } from "./production-protection";
import { normalizeStoryboardDrafts, normalizeStoryboardSnapshots } from "./storyboard-snapshots";
import { normalizeStoryboardReview } from "./review-engine";

const nowIso = () => new Date().toISOString();

const ACTIVE_JOB_STATUSES: StudioProductionJobStatus[] = ["pending", "queued", "submitting", "running", "cancelling"];

export function createStudioProductionWorkspace(): StudioProductionWorkspace {
    return { version: 1, jobs: [], skips: [], updatedAt: nowIso() };
}

export function createEpisodeProduction(): StudioEpisodeProduction {
    return {
        version: 1,
        scriptVersions: [],
        storyboardVersions: [],
        storyboardDrafts: [],
        checks: [],
        updatedAt: nowIso(),
    };
}

export function normalizeStudioProduction(value: StudioProductionWorkspace | undefined): StudioProductionWorkspace {
    if (!value || typeof value !== "object") return createStudioProductionWorkspace();
    const jobs = Array.isArray(value.jobs) ? value.jobs.filter((job) => job && typeof job.id === "string").map(normalizeJob) : [];
    const skips = Array.isArray(value.skips) ? value.skips.filter(isSkipRecord).map(normalizeSkipRecord) : [];
    return {
        version: 1,
        handoff: value.handoff && typeof value.handoff === "object" ? { ...value.handoff } : undefined,
        jobs,
        skips,
        activeJobId: typeof value.activeJobId === "string" && jobs.some((job) => job.id === value.activeJobId) ? value.activeJobId : undefined,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
    };
}

/** 刷新/重开只做本地收口：已提交但结果未知的任务必须停在核对，绝不自动重发。 */
export function normalizeProductionForHydration(project: StudioProject): StudioProject {
    const production = normalizeStudioProduction(project.production);
    const jobs = production.jobs.map((job) => hydrateInterruptedJob(job));
    return {
        ...project,
        production: { ...production, jobs, activeJobId: undefined, updatedAt: nowIso() },
        episodes: project.episodes.map((episode) => ({
            ...episode,
            production: normalizeEpisodeProduction(episode.production, { projectId: project.id, episodeNumber: episode.no }),
        })),
    };
}

/** 队列继续只接纳确定未提交或在人工核对后重新入队的任务；unknown/interrupted 不自动进入 queued。 */
export function selectResumableJobs(jobs: StudioProductionJob[]): StudioProductionJob[] {
    return jobs.filter(
        (job) =>
            job.status === "pending" ||
            job.status === "queued" ||
            (job.status === "interrupted" && job.remoteState === "not_submitted" && job.needsReview !== true),
    );
}

/** 失败重试只接纳明确可重试且无需人工核对的 failed；unknown/interrupted 永不自动重试。 */
export function selectRetryableJobs(jobs: StudioProductionJob[]): StudioProductionJob[] {
    return jobs.filter(
        (job) =>
            job.status === "failed" &&
            job.retryable === true &&
            job.needsReview !== true &&
            (job.remoteState === "failed" || job.remoteState === "not_submitted"),
    );
}

/** 需要人工核对结果的任务：远端状态未知、停止确认中或失败但无法判定是否已提交/已计费。 */
export function selectReviewJobs(jobs: StudioProductionJob[]): StudioProductionJob[] {
    return jobs.filter(
        (job) =>
            job.status === "unknown" ||
            job.status === "cancelling" ||
            ((job.status === "interrupted" || job.status === "failed") && job.needsReview === true),
    );
}

/** 人工核对结果：采纳现有写入、明确重新入队或标记失败；不会把 unknown 伪装成成功/取消。 */
export function applyProductionJobReview(
    job: StudioProductionJob,
    decision: StudioProductionJobReviewDecision,
    at = nowIso(),
): StudioProductionJob {
    if (decision === "adopt-existing") {
        return {
            ...job,
            status: "succeeded",
            remoteState: "completed",
            needsReview: false,
            retryable: false,
            progress: 100,
            currentLabel: "人工确认：结果已写入",
            error: undefined,
            finishedAt: at,
            updatedAt: at,
        };
    }
    if (decision === "retry") {
        return {
            ...job,
            status: "queued",
            remoteState: "not_submitted",
            needsReview: false,
            retryable: true,
            progress: 0,
            currentLabel: "人工确认：重新排队",
            error: undefined,
            taskId: undefined,
            trace: undefined,
            startedAt: undefined,
            finishedAt: undefined,
            updatedAt: at,
        };
    }
    return {
        ...job,
        status: "failed",
        remoteState: "failed",
        needsReview: false,
        retryable: false,
        currentLabel: "人工确认：失败，不重试",
        finishedAt: at,
        updatedAt: at,
    };
}

function hydrateInterruptedJob(job: StudioProductionJob): StudioProductionJob {
    if (job.status === "succeeded") {
        return { ...job, remoteState: "completed", needsReview: false, retryable: false };
    }
    if (job.status === "cancelled") {
        return { ...job, remoteState: job.remoteState ?? "cancelled", needsReview: false };
    }
    if (job.status === "failed") {
        const remoteState = job.remoteState ?? "unknown";
        return {
            ...job,
            remoteState,
            needsReview: job.needsReview ?? remoteState === "unknown",
            retryable: job.retryable ?? false,
        };
    }
    if (job.status === "unknown") {
        return {
            ...job,
            remoteState: "unknown",
            needsReview: true,
            retryable: false,
            currentLabel: job.currentLabel || "远端状态未知，等待人工核对",
            error: job.error ?? "页面刷新后仍无法确认远端请求是否完成；不会自动重发",
        };
    }
    if (job.status === "interrupted") {
        const remoteState = job.remoteState ?? "unknown";
        return {
            ...job,
            remoteState,
            needsReview: job.needsReview ?? remoteState === "unknown",
            retryable: job.retryable ?? remoteState === "not_submitted",
        };
    }
    if (ACTIVE_JOB_STATUSES.includes(job.status)) {
        const notSubmitted = job.status === "pending" || job.status === "queued";
        return {
            ...job,
            status: "interrupted",
            remoteState: notSubmitted ? "not_submitted" : "unknown",
            needsReview: !notSubmitted,
            retryable: notSubmitted,
            currentLabel: notSubmitted ? "刷新时尚未提交，可安全继续" : "刷新后中断，需人工核对",
            error: notSubmitted
                ? "页面刷新或关闭时任务尚未提交，未产生模型请求；可人工继续"
                : "页面刷新或关闭时请求可能已提交；不会自动重发，请先核对结果",
            updatedAt: nowIso(),
        };
    }
    return job;
}

export function normalizeEpisodeProduction(value: StudioEpisodeProduction | undefined, context?: { projectId?: string; episodeNumber?: number }): StudioEpisodeProduction {
    if (!value || typeof value !== "object") return createEpisodeProduction();
    const script = normalizeScriptShallow(value.script);
    const normalizedScript = script ? ensureScriptManualModules(ensureScriptSceneVersions(script)) : undefined;
    const storyboard = normalizeStoryboardShallow(value.storyboard);
    if (storyboard && normalizedScript) {
        storyboard.sourceEpisodePlanId = storyboard.sourceEpisodePlanId || normalizedScript.sourceEpisodePlanId;
        storyboard.sourceBlueprintVersion = storyboard.sourceBlueprintVersion || normalizedScript.sourceBlueprintVersion;
        storyboard.sourceHandoffId = storyboard.sourceHandoffId || normalizedScript.sourceHandoffId;
        if (!storyboard.sourceSceneVersions) {
            storyboard.sourceSceneVersions = storyboard.sourceScriptVersion === normalizedScript.scriptVersion
                ? { ...(normalizedScript.sceneVersions ?? {}) }
                : Object.fromEntries(normalizedScript.scenes.map((scene) => [scene.sceneId, 0]));
        }
    }
    const normalizedScripts = Array.isArray(value.scriptVersions)
        ? value.scriptVersions
              .filter((version) => version && version.document)
              .map((version) => {
                  const document = ensureScriptManualModules(ensureScriptSceneVersions(normalizeScriptShallow(version.document) as StudioScriptDocument));
                  return {
                      ...version,
                      snapshotId: version.snapshotId || `script-snapshot-${version.id}`,
                      contentHash: version.contentHash || scriptContentHash(document),
                      document,
                  };
              })
              .slice(0, 20)
        : [];
    const normalizedStoryboards = normalizeStoryboardSnapshots(value.storyboardVersions, storyboard?.episodeId ?? normalizedScript?.episodeId ?? "");
    const normalizedDrafts = normalizeStoryboardDrafts(value.storyboardDrafts, storyboard?.episodeId ?? normalizedScript?.episodeId ?? "");
    return {
        version: 1,
        script: normalizedScript,
        scriptVersions: normalizedScripts,
        storyboard,
        storyboardVersions: normalizedStoryboards.slice(0, 20),
        storyboardDrafts: normalizedDrafts,
        storyboardWriteOperations: Array.isArray(value.storyboardWriteOperations) ? value.storyboardWriteOperations : [],
        storyboardReview: normalizeStoryboardReview(value.storyboardReview, storyboard, nowIso(), { projectId: context?.projectId, episodeId: storyboard?.episodeId ?? value.storyboard?.episodeId, episodeNumber: context?.episodeNumber ?? storyboard?.episodeNumber }),
        checks: Array.isArray(value.checks) ? value.checks.filter(isProductionCheck).map(normalizeCheck) : [],
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
    };
}

function normalizeJob(job: StudioProductionJob): StudioProductionJob {
    const status = isJobStatus(job.status) ? job.status : "unknown";
    const remoteState = isRemoteState(job.remoteState) ? job.remoteState : inferRemoteState(status);
    return {
        ...job,
        status,
        kind: job.kind === "storyboard" ? "storyboard" : "script",
        episodeIds: Array.isArray(job.episodeIds) ? job.episodeIds : [],
        episodeNumbers: Array.isArray(job.episodeNumbers) ? job.episodeNumbers : [],
        progress: Number.isFinite(Number(job.progress)) ? Math.max(0, Math.min(100, Number(job.progress))) : 0,
        currentLabel: typeof job.currentLabel === "string" ? job.currentLabel : "",
        model: job.model ?? { channelId: "", modelId: "", label: "未记录" },
        modelParams: job.modelParams && typeof job.modelParams === "object" ? job.modelParams : {},
        capability: "text",
        modelFrozenAt: typeof job.modelFrozenAt === "string" ? job.modelFrozenAt : job.createdAt,
        promptVersion: typeof job.promptVersion === "string" ? job.promptVersion : "",
        sourceHandoffId: typeof job.sourceHandoffId === "string" ? job.sourceHandoffId : "",
        sourceBlueprintVersion: Number(job.sourceBlueprintVersion) || 0,
        sourcePlanVersions: Array.isArray(job.sourcePlanVersions) ? job.sourcePlanVersions : [],
        remoteState,
        needsReview: typeof job.needsReview === "boolean" ? job.needsReview : defaultNeedsReview(status, remoteState),
        retryable: typeof job.retryable === "boolean" ? job.retryable : defaultRetryable(status, remoteState),
        taskId: typeof job.taskId === "string" ? job.taskId : undefined,
        trace: job.trace && typeof job.trace === "object" ? job.trace : undefined,
        inputChars: Number(job.inputChars) || 0,
        outputChars: Number(job.outputChars) || 0,
        calls: Number(job.calls) || 0,
        skipReason: typeof job.skipReason === "string" ? job.skipReason : undefined,
        createdAt: typeof job.createdAt === "string" ? job.createdAt : nowIso(),
        updatedAt: typeof job.updatedAt === "string" ? job.updatedAt : nowIso(),
    };
}

function isSkipRecord(value: StudioProductionSkipRecord | undefined): value is StudioProductionSkipRecord {
    return Boolean(value && typeof value.id === "string" && typeof value.episodeId === "string");
}

function normalizeSkipRecord(value: StudioProductionSkipRecord): StudioProductionSkipRecord {
    return {
        ...value,
        kind: value.kind === "storyboard" ? "storyboard" : "script",
        episodeNumber: Number(value.episodeNumber) || 0,
        episodeTitle: typeof value.episodeTitle === "string" ? value.episodeTitle : "",
        detail: typeof value.detail === "string" ? value.detail : "",
        createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(),
    };
}

function inferRemoteState(status: StudioProductionJobStatus): StudioProductionJobRemoteState {
    if (status === "succeeded") return "completed";
    if (status === "failed") return "unknown";
    if (status === "cancelled") return "cancelled";
    if (status === "pending" || status === "queued") return "not_submitted";
    if (status === "submitting" || status === "running") return "submitted";
    return "unknown";
}

function defaultNeedsReview(status: StudioProductionJobStatus, remoteState: StudioProductionJobRemoteState) {
    return status === "unknown" || status === "cancelling" || remoteState === "unknown";
}

function defaultRetryable(status: StudioProductionJobStatus, remoteState: StudioProductionJobRemoteState) {
    if (status === "failed") return false;
    if (status === "interrupted") return remoteState === "not_submitted";
    return false;
}

function isRemoteState(value: unknown): value is StudioProductionJobRemoteState {
    return ["not_submitted", "submitted", "unknown", "completed", "failed", "cancelled"].includes(String(value));
}

function normalizeCheck(value: StudioProductionCheck): StudioProductionCheck {
    return {
        ...value,
        level: value.level === "error" || value.level === "warning" ? value.level : "suggestion",
        source: value.source === "model" ? "model" : "deterministic",
        status: value.status === "accepted" || value.status === "ignored" || value.status === "resolved" ? value.status : "open",
        episodeNumber: Number(value.episodeNumber) || 0,
        createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(),
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
    };
}

function isProductionCheck(value: StudioProductionCheck | undefined): value is StudioProductionCheck {
    return Boolean(value && typeof value.id === "string" && typeof value.code === "string");
}

function normalizeScriptShallow(value: StudioScriptDocument | undefined): StudioScriptDocument | undefined {
    if (!value || typeof value !== "object") return undefined;
    return {
        ...value,
        scenes: Array.isArray(value.scenes) ? value.scenes : [],
        characterBindings: Array.isArray(value.characterBindings) ? value.characterBindings : [],
        locationBindings: Array.isArray(value.locationBindings) ? value.locationBindings : [],
        propBindings: Array.isArray(value.propBindings) ? value.propBindings : [],
        continuityDependencies: Array.isArray(value.continuityDependencies) ? value.continuityDependencies : [],
        adaptationChanges: Array.isArray(value.adaptationChanges) ? value.adaptationChanges : [],
        durationEstimate: value.durationEstimate ?? {
            dialogueSeconds: 0,
            actionSeconds: 0,
            transitionSeconds: 0,
            pauseSeconds: 0,
            environmentSeconds: 0,
            totalSeconds: 0,
            deltaSeconds: 0,
            note: "",
        },
    };
}

function normalizeStoryboardShallow(value: StudioStoryboardDocument | undefined): StudioStoryboardDocument | undefined {
    if (!value || typeof value !== "object") return undefined;
    return {
        ...value,
        groups: Array.isArray(value.groups) ? value.groups : [],
        shots: Array.isArray(value.shots) ? value.shots : [],
        checks: Array.isArray(value.checks) ? value.checks : [],
    };
}

function isJobStatus(value: unknown): value is StudioProductionJobStatus {
    return [
        "pending",
        "queued",
        "submitting",
        "running",
        "succeeded",
        "failed",
        "cancelling",
        "cancelled",
        "interrupted",
        "unknown",
    ].includes(String(value));
}
