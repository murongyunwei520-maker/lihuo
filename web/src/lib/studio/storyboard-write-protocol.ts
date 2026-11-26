// Stage 3.2.2 B：正式分镜统一写入协议。
// 关键边界：版本比较、备份快照校验、冲突快照保留、正式写入与回读验证在同一个
// IndexedDB readwrite 事务内完成；Web Locks 只做跨标签页排队，不替代最终版本校验。

import { nanoid } from "nanoid";

import { createStoryboardSnapshot, storyboardContentHash } from "./storyboard-snapshots";
import { storyboardVersionConflictMessage } from "./production-locks";
import { normalizeStoryboardReview } from "./review-engine";
import {
    assertNoStaleFormalWrite,
    createIndexedDbStudioStateStore,
    parseStudioEnvelope,
    serializeStudioEnvelope,
    type StudioPersistedEnvelope,
    type StudioStatePlan,
    type StudioStateStore,
    StudioStateVerificationError,
} from "@/lib/studio-store-persistence";
import type { StudioEpisode, StudioProject } from "@/types/studio";
import type {
    StudioEpisodeProduction,
    StudioProductionCheck,
    StudioStoryboardDocument,
    StudioStoryboardVersion,
    StudioStoryboardWriteJournalEntry,
    StudioStoryboardWriteOperationType,
    StudioStoryboardWriteScope,
} from "@/types/studio-production";

const nowIso = () => new Date().toISOString();
const LOCK_NAME = "lihuo:studio-storyboard-write";
const CHANNEL_NAME = "lihuo:studio-storyboard";
const JOURNAL_LIMIT = 30;

export type FormalStoryboardApplyContext = {
    production: StudioEpisodeProduction;
    project: StudioProject;
    episode: StudioEpisode;
    current?: StudioStoryboardDocument;
    currentVersion: number;
    operationId: string;
    now: string;
    actor: string;
};

export type FormalStoryboardApplyPlan =
    | {
          ok: false;
          error: string;
          conflict?: boolean;
          preserve?: StudioStoryboardDocument;
          currentVersion?: number;
      }
    | {
          ok: true;
          production: StudioEpisodeProduction;
          document: StudioStoryboardDocument;
          backup?: StudioStoryboardVersion;
          result?: unknown;
          requireBackup?: boolean;
      };

export type FormalStoryboardWriteInput = {
    projectId: string;
    episodeId: string;
    operationId?: string;
    operationType: StudioStoryboardWriteOperationType;
    expectedVersion: number;
    scope: StudioStoryboardWriteScope;
    actor?: string;
    sourceSnapshotId?: string;
    candidateDocument?: StudioStoryboardDocument;
    /** 首次 hydrate 前测试或新项目落盘时使用；真实页面写入优先读取持久化状态。 */
    fallbackProjects?: StudioProject[];
    apply: (context: FormalStoryboardApplyContext) => FormalStoryboardApplyPlan;
    store?: StudioStateStore;
    hooks?: FormalStoryboardWriteHooks;
};

export type FormalStoryboardWriteHooks = {
    /** 模拟序列化失败；默认 JSON.stringify。 */
    serialize?: (envelope: StudioPersistedEnvelope) => string;
    /** put + 回读后、事务提交前；用于故障注入。 */
    afterWrite?: (readBack: string, expectedRaw: string) => void;
};

export type FormalStoryboardWriteResult = {
    ok: boolean;
    error?: string;
    operationId: string;
    duplicate?: boolean;
    conflict?: {
        baseVersion: number;
        currentVersion: number;
        preservedVersionId?: string;
        preservedSnapshotId?: string;
    };
    conflictSnapshotId?: string;
    newVersion?: number;
    backupSnapshotId?: string;
    production?: StudioEpisodeProduction;
    projects?: StudioProject[];
    result?: unknown;
};

function operationIdFor(input: FormalStoryboardWriteInput) {
    return input.operationId ?? `sbw-${nanoid(12)}`;
}

function cloneProduction(production: StudioEpisodeProduction): StudioEpisodeProduction {
    return JSON.parse(JSON.stringify(production)) as StudioEpisodeProduction;
}

function storyboardVersion(production: StudioEpisodeProduction | undefined) {
    return production?.storyboard?.storyboardVersion ?? 0;
}

function findProject(projects: StudioProject[], projectId: string) {
    return projects.find((project) => project.id === projectId);
}

function mergeChecks(existing: StudioProductionCheck[], incoming: StudioProductionCheck[]) {
    const byId = new Map(existing.map((check) => [check.id, check]));
    for (const check of incoming) {
        const previous = byId.get(check.id);
        if (previous && previous.status !== "open") byId.set(check.id, { ...check, status: previous.status });
        else byId.set(check.id, check);
    }
    return [...byId.values()];
}

function conflictCheck(input: {
    episodeId: string;
    episodeNumber: number;
    operationType: StudioStoryboardWriteOperationType;
    scope: StudioStoryboardWriteScope;
    baseVersion: number;
    currentVersion: number;
    preserved?: StudioStoryboardVersion;
    reason?: string;
}): StudioProductionCheck {
    const at = nowIso();
    const message = input.reason || storyboardVersionConflictMessage(input.baseVersion, input.currentVersion);
    return {
        id: `stage3-check-${input.episodeId}-storyboard-write-conflict-${input.baseVersion}-${input.currentVersion}-${input.operationType}-${input.scope.sceneId ?? ""}-${input.scope.shotId ?? ""}`,
        level: "warning",
        source: "deterministic",
        category: "分镜连续性",
        code: "storyboard_write_conflict",
        message,
        suggestion: input.preserved
            ? `失败方内容已保留为冲突快照 ${input.preserved.snapshotId}（基于 v${input.preserved.basedOnVersion}）；当前正式 v${input.currentVersion} 未被覆盖。`
            : "当前正式内容未被覆盖；请刷新后人工决定是否重试。",
        status: "open",
        episodeNumber: input.episodeNumber,
        sceneId: input.scope.sceneId,
        shotId: input.scope.shotId,
        createdAt: at,
        updatedAt: at,
    };
}

function withJournal(production: StudioEpisodeProduction, entry: StudioStoryboardWriteJournalEntry): StudioEpisodeProduction {
    return {
        ...production,
        storyboardWriteOperations: [entry, ...(production.storyboardWriteOperations ?? [])].slice(0, JOURNAL_LIMIT),
        updatedAt: entry.finishedAt,
    };
}

function journalEntry(input: {
    operationId: string;
    projectId: string;
    episodeId: string;
    operationType: StudioStoryboardWriteOperationType;
    scope: StudioStoryboardWriteScope;
    status: StudioStoryboardWriteJournalEntry["status"];
    expectedVersion: number;
    baseVersion: number;
    newVersion?: number;
    sourceSnapshotId?: string;
    conflictSnapshotId?: string;
    actor: string;
    createdAt: string;
    error?: string;
}): StudioStoryboardWriteJournalEntry {
    return { ...input, finishedAt: nowIso() };
}

function uniqueSnapshotId(id: string, existing: StudioStoryboardVersion[]) {
    let snapshotId = id;
    let suffix = 1;
    while (existing.some((version) => version.snapshotId === snapshotId)) snapshotId = `${id}-${suffix++}`;
    return snapshotId;
}

function validateSnapshotIdentity(snapshot: StudioStoryboardVersion, existing: StudioStoryboardVersion[], label: string) {
    if (!snapshot.snapshotId || !snapshot.id) throw new StudioStateVerificationError(`${label}缺少唯一 ID`);
    if (existing.some((version) => version.snapshotId === snapshot.snapshotId || version.id === snapshot.id)) {
        throw new StudioStateVerificationError(`${label} ID 冲突：${snapshot.snapshotId}`);
    }
    if (!snapshot.document || snapshot.contentHash !== storyboardContentHash(snapshot.document)) {
        throw new StudioStateVerificationError(`${label}内容校验失败：${snapshot.snapshotId}`);
    }
}

function scopeSnapshot(document: StudioStoryboardDocument | undefined, scope: StudioStoryboardWriteScope) {
    if (!document) return "";
    if (scope.kind === "scene") {
        return JSON.stringify({
            groups: document.groups.filter((group) => group.sceneId !== scope.sceneId),
            shots: document.shots.filter((shot) => shot.sceneId !== scope.sceneId),
        });
    }
    if (scope.kind === "shot") {
        return JSON.stringify({
            groups: document.groups,
            shots: document.shots.filter((shot) => shot.shotId !== scope.shotId),
        });
    }
    return "";
}

function verifyUnchangedScope(input: {
    previous?: StudioStoryboardDocument;
    next?: StudioStoryboardDocument;
    scope: StudioStoryboardWriteScope;
}) {
    if (!input.previous || !input.next) return;
    if (input.scope.kind !== "scene" && input.scope.kind !== "shot") return;
    if (scopeSnapshot(input.previous, input.scope) !== scopeSnapshot(input.next, input.scope)) {
        throw new StudioStateVerificationError(`正式写入越界：${input.scope.kind} 范围外内容发生变化`);
    }
}

function verifyEpisodeVersions(previousProjects: StudioProject[], nextProjects: StudioProject[], target: { projectId: string; episodeId: string; newVersion?: number }) {
    for (const previousProject of previousProjects) {
        const nextProject = nextProjects.find((project) => project.id === previousProject.id);
        if (!nextProject) continue;
        if (nextProject.episodes.length !== previousProject.episodes.length) {
            throw new StudioStateVerificationError(`正式写入误改分集数量：${previousProject.id}`);
        }
        for (const previousEpisode of previousProject.episodes) {
            const nextEpisode = nextProject.episodes.find((episode) => episode.id === previousEpisode.id);
            if (!nextEpisode) continue;
            const before = storyboardVersion(previousEpisode.production);
            const after = storyboardVersion(nextEpisode.production);
            const isTarget = previousProject.id === target.projectId && previousEpisode.id === target.episodeId;
            if (isTarget && target.newVersion !== undefined && after !== target.newVersion) {
                throw new StudioStateVerificationError(`正式版本回读不一致：目标 v${after}，期望 v${target.newVersion}`);
            }
            if (!isTarget && after !== before) {
                throw new StudioStateVerificationError(`正式写入误改其他分集：${previousProject.id}/${previousEpisode.id} v${before} → v${after}`);
            }
        }
    }
}

function notify(message: Record<string, unknown>) {
    if (typeof BroadcastChannel === "undefined") return;
    try {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage(message);
        channel.close();
    } catch {
        // 通知失败只影响其他标签页刷新时机，不影响已经提交的正式数据。
    }
}

function runWithLock<T>(task: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
        return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, task) as Promise<T>;
    }
    // 测试 / 不支持 Web Locks 的环境仍有 IndexedDB 事务作为最终版本闸门。
    const globalQueue = globalThis as typeof globalThis & { __lihuoStoryboardWriteQueue?: Promise<unknown> };
    const previous = globalQueue.__lihuoStoryboardWriteQueue ?? Promise.resolve();
    const next = previous.then(task, task);
    globalQueue.__lihuoStoryboardWriteQueue = next.catch(() => undefined);
    return next;
}

/** 审核元数据写入与正式分镜写入共用同一把跨标签页锁，避免 read / write 交错。 */
export function withStudioWriteLock<T>(task: () => Promise<T>): Promise<T> {
    return runWithLock(task);
}

function readProjects(envelope: StudioPersistedEnvelope | null, fallback: StudioProject[] | undefined): StudioProject[] {
    if (envelope?.state?.projects && Array.isArray(envelope.state.projects)) return envelope.state.projects as StudioProject[];
    return fallback ?? [];
}

function replaceEpisodeProduction(projects: StudioProject[], projectId: string, episodeId: string, production: StudioEpisodeProduction): StudioProject[] {
    return projects.map((project) => {
        if (project.id !== projectId) return project;
        return {
            ...project,
            episodes: project.episodes.map((episode) => (episode.id === episodeId ? { ...episode, production, updatedAt: nowIso() } : episode)),
            updatedAt: nowIso(),
        };
    });
}

function newEnvelope(base: StudioPersistedEnvelope | null, projects: StudioProject[]): StudioPersistedEnvelope {
    return {
        ...(base ?? {}),
        state: {
            ...(base?.state ?? {}),
            projects,
            migrationDone: base?.state?.migrationDone ?? false,
        },
        version: base?.version ?? 0,
    };
}

function buildConflictPlan(input: {
    projectId: string;
    production: StudioEpisodeProduction;
    episode: StudioEpisode;
    operationId: string;
    operationType: StudioStoryboardWriteOperationType;
    scope: StudioStoryboardWriteScope;
    expectedVersion: number;
    baseVersion: number;
    currentVersion: number;
    actor: string;
    createdAt: string;
    generated?: StudioStoryboardDocument;
    error: string;
    reason?: string;
}) {
    const currentFormal = input.production.storyboardVersions.find(
        (version) => version.snapshotType === "formal" && version.version === input.currentVersion,
    );
    const existing = [...input.production.storyboardVersions];
    let preserved: StudioStoryboardVersion | undefined;
    if (input.generated) {
        preserved = createStoryboardSnapshot({
            document: input.generated,
            snapshotType: "conflict",
            basedOnVersion: input.baseVersion,
            reason: `并发冲突保留：${input.operationType} / 基础 v${input.baseVersion} → 当前 v${input.currentVersion}`,
            conflictWithSnapshotId: currentFormal?.snapshotId,
        });
        const snapshotId = uniqueSnapshotId(preserved.snapshotId, existing);
        preserved = { ...preserved, snapshotId, id: `storyboard-version-${snapshotId}` };
        validateSnapshotIdentity(preserved, existing, "冲突快照");
    }
    const check = conflictCheck({
        episodeId: input.episode.id,
        episodeNumber: input.episode.no,
        operationType: input.operationType,
        scope: input.scope,
        baseVersion: input.baseVersion,
        currentVersion: input.currentVersion,
        preserved,
        reason: input.error || input.reason,
    });
    const entry = journalEntry({
        operationId: input.operationId,
        projectId: input.projectId,
        episodeId: input.episode.id,
        operationType: input.operationType,
        scope: input.scope,
        status: "conflict",
        expectedVersion: input.expectedVersion,
        baseVersion: input.baseVersion,
        sourceSnapshotId: undefined,
        conflictSnapshotId: preserved?.snapshotId,
        actor: input.actor,
        createdAt: input.createdAt,
        error: input.error,
    });
    const production = withJournal({
        ...input.production,
        storyboardVersions: preserved ? [preserved, ...existing].slice(0, 20) : existing,
        checks: mergeChecks(input.production.checks, [check]),
    }, entry);
    return { production, preserved, entry };
}

export async function commitFormalStoryboardWrite(input: FormalStoryboardWriteInput): Promise<FormalStoryboardWriteResult> {
    const operationId = operationIdFor(input);
    const actor = input.actor ?? "local-user";
    const createdAt = nowIso();
    const store = input.store ?? createIndexedDbStudioStateStore();
    return runWithLock<FormalStoryboardWriteResult>(async () => {
        try {
            return await store.transact<FormalStoryboardWriteResult>((currentRaw): StudioStatePlan<FormalStoryboardWriteResult> => {
                const baseEnvelope = parseStudioEnvelope(currentRaw);
                if (currentRaw && !baseEnvelope) {
                    return { result: { ok: false, error: "本地工作区数据无法解析，已拒绝写入", operationId } };
                }
                const projects = readProjects(baseEnvelope, input.fallbackProjects);
                const project = findProject(projects, input.projectId);
                const episode = project?.episodes.find((item) => item.id === input.episodeId);
                if (!project || !episode) {
                    return { result: { ok: false, error: "项目或分集不存在，未写入正式分镜", operationId } };
                }
                const production = cloneProduction(episode.production ?? {
                    version: 1,
                    scriptVersions: [],
                    storyboardVersions: [],
                    storyboardDrafts: [],
                    checks: [],
                    updatedAt: nowIso(),
                });
                const currentVersion = storyboardVersion(production);
                const duplicate = (production.storyboardWriteOperations ?? []).find((entry) => entry.operationId === operationId);
                if (duplicate) {
                    return {
                        result: {
                            ok: duplicate.status === "committed",
                            error: duplicate.error,
                            duplicate: true,
                            operationId,
                            newVersion: duplicate.newVersion,
                            conflictSnapshotId: duplicate.conflictSnapshotId,
                        },
                    };
                }

                if (currentVersion !== input.expectedVersion) {
                    let generated = input.candidateDocument;
                    if (!generated) {
                        // 失败方未提供整份候选时，基于 expectedVersion 对应的 formal 快照重放一次变更，
                        // 保证冲突快照保留的是失败方原本要提交的内容，而不是当前最新版本。
                        const baseline = production.storyboardVersions.find(
                            (version) => version.snapshotType === "formal" && version.version === input.expectedVersion,
                        )?.document ?? production.storyboard;
                        if (baseline) {
                            try {
                                const preservePlan = input.apply({
                                    production: { ...production, storyboard: baseline },
                                    project,
                                    episode,
                                    current: baseline,
                                    currentVersion: input.expectedVersion,
                                    operationId,
                                    now: createdAt,
                                    actor,
                                });
                                generated = preservePlan.ok
                                    ? preservePlan.document
                                    : preservePlan.preserve;
                            } catch {
                                generated = undefined;
                            }
                        }
                    }
                    const conflict = buildConflictPlan({
                        projectId: input.projectId,
                        production,
                        episode,
                        operationId,
                        operationType: input.operationType,
                        scope: input.scope,
                        expectedVersion: input.expectedVersion,
                        baseVersion: input.expectedVersion,
                        currentVersion,
                        actor,
                        createdAt,
                        generated,
                        error: storyboardVersionConflictMessage(input.expectedVersion, currentVersion),
                    });
                    const nextProjects = replaceEpisodeProduction(projects, input.projectId, input.episodeId, conflict.production);
                    const envelope = newEnvelope(baseEnvelope, nextProjects);
                    const nextRaw = (input.hooks?.serialize ?? serializeStudioEnvelope)(envelope);
                    return {
                        nextRaw,
                        result: {
                            ok: false,
                            error: storyboardVersionConflictMessage(input.expectedVersion, currentVersion),
                            operationId,
                            conflict: {
                                baseVersion: input.expectedVersion,
                                currentVersion,
                                preservedVersionId: conflict.preserved?.id,
                                preservedSnapshotId: conflict.preserved?.snapshotId,
                            },
                            production: conflict.production,
                            projects: nextProjects,
                        },
                        verify: (readBack) => {
                            const envelopeBack = parseStudioEnvelope(readBack);
                            const savedEpisode = findProject(readProjects(envelopeBack, undefined), input.projectId)?.episodes.find((item) => item.id === input.episodeId);
                            if (!savedEpisode) throw new StudioStateVerificationError("冲突快照回读失败：分集不存在");
                            const journal = savedEpisode.production?.storyboardWriteOperations?.find((entry) => entry.operationId === operationId);
                            if (!journal || journal.status !== "conflict") throw new StudioStateVerificationError("冲突日志回读失败");
                            if (conflict.preserved && !savedEpisode.production?.storyboardVersions.some((version) => version.snapshotId === conflict.preserved?.snapshotId)) {
                                throw new StudioStateVerificationError("冲突快照回读失败");
                            }
                            if (storyboardVersion(savedEpisode.production) !== currentVersion) throw new StudioStateVerificationError("冲突写入误改正式版本");
                        },
                    };
                }

                const applyPlan = input.apply({
                    production,
                    project,
                    episode,
                    current: production.storyboard,
                    currentVersion,
                    operationId,
                    now: createdAt,
                    actor,
                });

                if (!applyPlan.ok) {
                    if (!applyPlan.conflict) {
                        return { result: { ok: false, error: applyPlan.error, operationId } };
                    }
                    const conflict = buildConflictPlan({
                        projectId: input.projectId,
                        production,
                        episode,
                        operationId,
                        operationType: input.operationType,
                        scope: input.scope,
                        expectedVersion: input.expectedVersion,
                        baseVersion: input.expectedVersion,
                        currentVersion: applyPlan.currentVersion ?? currentVersion,
                        actor,
                        createdAt,
                        generated: applyPlan.preserve ?? input.candidateDocument,
                        error: applyPlan.error,
                    });
                    const nextProjects = replaceEpisodeProduction(projects, input.projectId, input.episodeId, conflict.production);
                    const envelope = newEnvelope(baseEnvelope, nextProjects);
                    const nextRaw = (input.hooks?.serialize ?? serializeStudioEnvelope)(envelope);
                    return {
                        nextRaw,
                        result: {
                            ok: false,
                            error: applyPlan.error,
                            operationId,
                            conflict: {
                                baseVersion: input.expectedVersion,
                                currentVersion: applyPlan.currentVersion ?? currentVersion,
                                preservedVersionId: conflict.preserved?.id,
                                preservedSnapshotId: conflict.preserved?.snapshotId,
                            },
                            production: conflict.production,
                            projects: nextProjects,
                        },
                        verify: (readBack) => {
                            if (conflict.preserved && (!readBack || !readBack.includes(conflict.preserved.snapshotId))) throw new StudioStateVerificationError("冲突快照回读失败");
                        },
                    };
                }

                const nextProduction = cloneProduction(applyPlan.production);
                const nextDocument = nextProduction.storyboard;
                if (!nextDocument || nextDocument.storyboardVersion !== currentVersion + 1) {
                    throw new StudioStateVerificationError("正式写入必须恰好递增一个版本");
                }
                if (storyboardContentHash(nextDocument) !== storyboardContentHash(applyPlan.document)) {
                    throw new StudioStateVerificationError("正式分镜内容与提交内容不一致");
                }
                const nextVersions = nextProduction.storyboardVersions ?? [];
                const formal = nextVersions.find((version) => version.snapshotType === "formal" && version.version === nextDocument.storyboardVersion);
                if (!formal) throw new StudioStateVerificationError("正式写入缺少 formal 快照");
                if (formal.contentHash !== storyboardContentHash(nextDocument)) throw new StudioStateVerificationError("formal 快照内容校验失败");
                validateSnapshotIdentity(formal, production.storyboardVersions, "formal 快照");

                let backup: StudioStoryboardVersion | undefined;
                if ((applyPlan.requireBackup ?? true) && production.storyboard) {
                    backup = applyPlan.backup ?? nextVersions.find((version) => version.snapshotType === "backup" && version.basedOnVersion === currentVersion);
                    if (!backup) throw new StudioStateVerificationError("正式写入缺少备份快照，已阻止提交");
                    const existingBackups = production.storyboardVersions;
                    validateSnapshotIdentity(backup, existingBackups, "备份快照");
                    if (backup.snapshotType !== "backup") throw new StudioStateVerificationError("备份快照类型错误");
                    if (backup.basedOnVersion !== currentVersion) throw new StudioStateVerificationError("备份快照 basedOnVersion 错误");
                    if (backup.contentHash !== storyboardContentHash(production.storyboard)) throw new StudioStateVerificationError("备份快照不是写入前正式内容");
                    if (!nextVersions.some((version) => version.snapshotId === backup?.snapshotId)) throw new StudioStateVerificationError("备份快照未进入待提交状态");
                }

                verifyUnchangedScope({ previous: production.storyboard, next: nextDocument, scope: input.scope });
                const entry = journalEntry({
                    operationId,
                    projectId: input.projectId,
                    episodeId: input.episodeId,
                    operationType: input.operationType,
                    scope: input.scope,
                    status: "committed",
                    expectedVersion: input.expectedVersion,
                    baseVersion: currentVersion,
                    newVersion: nextDocument.storyboardVersion,
                    sourceSnapshotId: input.sourceSnapshotId,
                    actor,
                    createdAt,
                });
                const committedReview = nextProduction.storyboardReview
                    ? normalizeStoryboardReview(
                          nextProduction.storyboardReview,
                          nextDocument,
                          entry.finishedAt,
                          { projectId: input.projectId, episodeId: input.episodeId, episodeNumber: episode.no },
                          { persistDerivedConflicts: true, operationId },
                      )
                    : undefined;
                const persistedVersionConflicts = (committedReview?.proposalApplications ?? []).filter(
                    (application) => application.status === "conflict" && application.operationId === operationId && application.derived !== true,
                );
                const committedProduction = withJournal({ ...nextProduction, storyboardReview: committedReview, updatedAt: entry.finishedAt }, entry);
                const nextProjects = replaceEpisodeProduction(projects, input.projectId, input.episodeId, committedProduction);
                const envelope = newEnvelope(baseEnvelope, nextProjects);
                const nextRaw = (input.hooks?.serialize ?? serializeStudioEnvelope)(envelope);
                const expectedHash = storyboardContentHash(nextDocument);
                return {
                    nextRaw,
                    result: {
                        ok: true,
                        operationId,
                        newVersion: nextDocument.storyboardVersion,
                        backupSnapshotId: backup?.snapshotId,
                        production: committedProduction,
                        projects: nextProjects,
                        result: applyPlan.result,
                    },
                    verify: (readBack) => {
                        input.hooks?.afterWrite?.(readBack ?? "", nextRaw);
                        const envelopeBack = parseStudioEnvelope(readBack);
                        const savedProjects = readProjects(envelopeBack, undefined);
                        const savedEpisode = findProject(savedProjects, input.projectId)?.episodes.find((item) => item.id === input.episodeId);
                        if (!savedEpisode) throw new StudioStateVerificationError("正式写入回读失败：分集不存在");
                        const savedProduction = savedEpisode.production;
                        if (storyboardVersion(savedProduction) !== nextDocument.storyboardVersion) throw new StudioStateVerificationError("正式版本回读不一致");
                        if (!savedProduction?.storyboard || storyboardContentHash(savedProduction.storyboard) !== expectedHash) {
                            throw new StudioStateVerificationError("正式内容回读 Hash 不一致");
                        }
                        if (backup && !savedProduction.storyboardVersions.some((version) => version.snapshotId === backup?.snapshotId)) {
                            throw new StudioStateVerificationError("备份快照回读失败，已阻止提交");
                        }
                        if (!savedProduction.storyboardVersions.some((version) => version.snapshotId === formal.snapshotId)) {
                            throw new StudioStateVerificationError("formal 快照回读失败");
                        }
                        const savedJournal = savedProduction.storyboardWriteOperations?.find((item) => item.operationId === operationId);
                        if (!savedJournal || savedJournal.status !== "committed") throw new StudioStateVerificationError("正式写入日志回读失败");
                        for (const expected of persistedVersionConflicts) {
                            const savedApplication = savedProduction.storyboardReview?.proposalApplications?.find((application) => application.applicationId === expected.applicationId);
                            if (!savedApplication?.persisted || savedApplication.derived === true) {
                                throw new StudioStateVerificationError("版本冲突记录未持久化确认，已阻止提交");
                            }
                        }
                        const pendingOldProposal = savedProduction.storyboardReview?.proposals?.find(
                            (proposal) => proposal.decision.status === "pending" && proposal.storyboardVersion !== nextDocument.storyboardVersion,
                        );
                        if (pendingOldProposal) throw new StudioStateVerificationError("旧版本提案仍为 pending，已阻止提交");
                        verifyEpisodeVersions(projects, savedProjects, {
                            projectId: input.projectId,
                            episodeId: input.episodeId,
                            newVersion: nextDocument.storyboardVersion,
                        });
                        assertNoStaleFormalWrite(currentRaw, readBack ?? "");
                    },
                };
            });
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "正式分镜写入失败", operationId };
        }
    }).then((result) => {
        notify({
            type: result.ok ? "storyboard-committed" : result.conflict ? "storyboard-conflict" : "storyboard-write-failed",
            ok: result.ok,
            projectId: input.projectId,
            episodeId: input.episodeId,
            operationId: result.operationId,
            newVersion: result.newVersion,
            conflict: result.conflict,
            at: nowIso(),
        });
        return result;
    });
}
