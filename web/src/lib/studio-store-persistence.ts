import { STORAGE_NAMESPACE, storageKey } from "@/constant/app";
import { storyboardContentHash } from "@/lib/studio/storyboard-snapshots";
import type { StudioProject } from "@/types/studio";

// Stage 3.2.2：IndexedDB 级 compare-and-write。localforage 负责常规读写，
// 正式分镜写入和整仓持久化守卫必须共用同一个 app_state 事务，不能 read → check → write 分开。
export const STUDIO_DB_NAME = STORAGE_NAMESPACE;
export const STUDIO_DB_STORE = "app_state";
export const STUDIO_STORE_KEY = storageKey("studio_store");

export type StudioStatePlan<T> = {
    /** 不写时省略；写入前必须已经在同一个 IndexedDB 事务内读取 currentRaw。 */
    nextRaw?: string;
    result: T;
    /** put 后、事务提交前的语义校验；抛错会 abort，正式数据回滚。 */
    verify?: (readBack: string | null, expectedRaw: string) => void;
};

export type StudioStateStore = {
    transact<T>(plan: (currentRaw: string | null) => StudioStatePlan<T>): Promise<T>;
    readRaw(): Promise<string | null>;
};

export class StudioPersistenceUnavailableError extends Error {
    constructor(message = "IndexedDB 不可用，已拒绝正式分镜写入") {
        super(message);
        this.name = "StudioPersistenceUnavailableError";
    }
}

export class StudioStateVerificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StudioStateVerificationError";
    }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
}

// Stage 4D.2：每个标签页记住最近一次读到的项目 updatedAt。常规整仓写入必须
// 先确认当前 IndexedDB 的项目时间戳仍是这个标签页见过的版本；否则说明另一个
// 标签页已经改过项目，拒绝整仓覆盖，交给上层刷新后重试。
let observedProjectUpdatedAt: Map<string, string> | null = null;

function projectUpdatedAtMap(raw: string | null): Map<string, string> {
    const result = new Map<string, string>();
    const envelope = parseStudioEnvelope(raw);
    const projects = envelope?.state?.projects;
    if (!Array.isArray(projects)) return result;
    for (const project of projects) {
        if (!project || typeof project !== "object") continue;
        const id = (project as { id?: unknown }).id;
        if (typeof id !== "string") continue;
        result.set(id, String((project as { updatedAt?: unknown }).updatedAt ?? ""));
    }
    return result;
}

/** IndexedDB 直接写入成功后更新本标签页基线，避免下一次常规写入误判为冲突。 */
export function observeStudioStoreRaw(raw: string | null) {
    observedProjectUpdatedAt = projectUpdatedAtMap(raw);
}

/** 常规整仓写入不得把其他标签页已更新的项目、或另一标签页新建的项目静默抹掉。 */
export function assertNoStaleProjectMetadata(currentRaw: string | null, nextRaw: string) {
    if (!observedProjectUpdatedAt) return;
    const current = projectUpdatedAtMap(currentRaw);
    const next = projectUpdatedAtMap(nextRaw);
    for (const [id, observed] of observedProjectUpdatedAt) {
        const currentStamp = current.get(id);
        const nextStamp = next.get(id);
        if (nextStamp === undefined) {
            if (currentStamp !== undefined) throw new StudioStateVerificationError(`项目已被其他标签页更新，不能整仓删除：${id}；请刷新后重试`);
            continue;
        }
        if (currentStamp !== undefined && currentStamp !== observed) {
            throw new StudioStateVerificationError(`项目已被其他标签页更新：${id}；请刷新后重试`);
        }
        if (currentStamp === undefined) {
            throw new StudioStateVerificationError(`项目已被其他标签页删除：${id}；请刷新后重试`);
        }
    }
    for (const id of current.keys()) {
        if (next.has(id) || observedProjectUpdatedAt.has(id)) continue;
        throw new StudioStateVerificationError(`其他标签页新建了项目，当前整仓写入会丢失它：${id}；请刷新后重试`);
    }
}

function databaseName() {
    return STUDIO_DB_NAME;
}

function openDatabase(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new StudioPersistenceUnavailableError());
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName());
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STUDIO_DB_STORE)) db.createObjectStore(STUDIO_DB_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new StudioPersistenceUnavailableError("无法打开本地工作区数据库"));
    });
}

export function createIndexedDbStudioStateStore(): StudioStateStore {
    return {
        async readRaw() {
            if (typeof indexedDB === "undefined") throw new StudioPersistenceUnavailableError();
            const db = await openDatabase();
            try {
                const tx = db.transaction(STUDIO_DB_STORE, "readonly");
                const store = tx.objectStore(STUDIO_DB_STORE);
                const raw = await requestResult(store.get(STUDIO_STORE_KEY)) as string | null;
                observeStudioStoreRaw(raw);
                return raw;
            } finally {
                db.close();
            }
        },
        async transact<T>(plan: (currentRaw: string | null) => StudioStatePlan<T>) {
            if (typeof indexedDB === "undefined") throw new StudioPersistenceUnavailableError();
            const db = await openDatabase();
            const tx = db.transaction(STUDIO_DB_STORE, "readwrite");
            const store = tx.objectStore(STUDIO_DB_STORE);
            const done = new Promise<void>((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
                tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
            });
            try {
                const currentRaw = await requestResult(store.get(STUDIO_STORE_KEY)) as string | null;
                // plan 内部不得 await 非 IndexedDB Promise；当前实现只做同步 compare / serialize。
                const statePlan = plan(currentRaw);
                let wrote = false;
                if (statePlan.nextRaw !== undefined) {
                    const putRequest = store.put(statePlan.nextRaw, STUDIO_STORE_KEY);
                    await requestResult(putRequest);
                    wrote = true;
                    const readBack = await requestResult(store.get(STUDIO_STORE_KEY)) as string | null;
                    if (readBack !== statePlan.nextRaw) throw new StudioStateVerificationError("正式分镜写入后回读不一致");
                    statePlan.verify?.(readBack, statePlan.nextRaw);
                }
                await done;
                if (wrote && statePlan.nextRaw !== undefined) observeStudioStoreRaw(statePlan.nextRaw);
                return statePlan.result;
            } catch (error) {
                try {
                    tx.abort();
                } catch {
                    // 已结束的事务无法 abort；下面的 done 已经会反馈真实状态。
                }
                try {
                    await done;
                } catch {
                    // 保留原始写入失败原因。
                }
                throw error;
            } finally {
                db.close();
            }
        },
    };
}

export type StudioPersistedEnvelope = {
    state?: {
        projects?: unknown;
        migrationDone?: boolean;
        [key: string]: unknown;
    };
    version?: number;
    [key: string]: unknown;
};

export function parseStudioEnvelope(raw: string | null): StudioPersistedEnvelope | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed as StudioPersistedEnvelope : null;
    } catch {
        return null;
    }
}

export function serializeStudioEnvelope(envelope: StudioPersistedEnvelope): string {
    return JSON.stringify(envelope);
}

export function readProjectStoryboardVersion(project: unknown): Map<string, number> {
    const result = new Map<string, number>();
    if (!project || typeof project !== "object") return result;
    const episodes = (project as { episodes?: unknown }).episodes;
    if (!Array.isArray(episodes)) return result;
    for (const episode of episodes) {
        if (!episode || typeof episode !== "object") continue;
        const id = (episode as { id?: unknown }).id;
        const production = (episode as { production?: unknown }).production;
        const storyboard = production && typeof production === "object" ? (production as { storyboard?: unknown }).storyboard : undefined;
        const version = storyboard && typeof storyboard === "object" ? Number((storyboard as { storyboardVersion?: unknown }).storyboardVersion) : 0;
        if (typeof id === "string") result.set(id, Number.isFinite(version) ? version : 0);
    }
    return result;
}

/** 整仓同版本签名只看正式叙事内容；逐镜锁定与整组已复核不递增版本，不能把它们当成陈旧覆盖。 */
function guardStoryboardHash(storyboard: Record<string, unknown>) {
    const groups = Array.isArray(storyboard.groups)
        ? storyboard.groups.map((group) => group && typeof group === "object" ? { ...group, reviewedByUser: false } : group)
        : storyboard.groups;
    const shots = Array.isArray(storyboard.shots)
        ? storyboard.shots.map((shot) => shot && typeof shot === "object" ? { ...shot, locked: false } : shot)
        : storyboard.shots;
    return storyboardContentHash({ ...storyboard, groups, shots } as never);
}

/** 审核写入允许修改逐镜锁定 / 整组复核标记，但不能改正式叙事内容。 */
export function storyboardNarrativeHash(storyboard: Record<string, unknown>) {
    return guardStoryboardHash(storyboard);
}

function formalWriteSignature(project: unknown): Map<string, string> {
    const result = new Map<string, string>();
    if (!project || typeof project !== "object") return result;
    const episodes = (project as { episodes?: unknown }).episodes;
    if (!Array.isArray(episodes)) return result;
    for (const episode of episodes) {
        if (!episode || typeof episode !== "object") continue;
        const id = (episode as { id?: unknown }).id;
        const production = (episode as { production?: unknown }).production;
        if (typeof id !== "string" || !production || typeof production !== "object") continue;
        const value = production as {
            storyboard?: unknown;
            storyboardVersions?: unknown;
            storyboardWriteOperations?: unknown;
        };
        const storyboard = value.storyboard && typeof value.storyboard === "object" ? value.storyboard as Record<string, unknown> : undefined;
        const version = Number(storyboard?.storyboardVersion ?? 0);
        const contentHash = storyboard ? guardStoryboardHash(storyboard) : "";
        const versions = Array.isArray(value.storyboardVersions) ? value.storyboardVersions : [];
        const formalIds = versions
            .filter((snapshot) => snapshot && typeof snapshot === "object" && (snapshot as { snapshotType?: unknown }).snapshotType === "formal")
            .map((snapshot) => String((snapshot as { snapshotId?: unknown; id?: unknown }).snapshotId ?? (snapshot as { id?: unknown }).id ?? ""))
            .sort()
            .join(",");
        const conflictIds = versions
            .filter((snapshot) => snapshot && typeof snapshot === "object" && (snapshot as { snapshotType?: unknown }).snapshotType === "conflict")
            .map((snapshot) => String((snapshot as { snapshotId?: unknown; id?: unknown }).snapshotId ?? (snapshot as { id?: unknown }).id ?? ""))
            .sort()
            .join(",");
        const backupIds = versions
            .filter((snapshot) => snapshot && typeof snapshot === "object" && (snapshot as { snapshotType?: unknown }).snapshotType === "backup")
            .map((snapshot) => String((snapshot as { snapshotId?: unknown; id?: unknown }).snapshotId ?? (snapshot as { id?: unknown }).id ?? ""))
            .sort()
            .join(",");
        const journal = Array.isArray(value.storyboardWriteOperations) ? value.storyboardWriteOperations : [];
        const journalIds = journal
            .map((entry) => entry && typeof entry === "object" ? String((entry as { operationId?: unknown }).operationId ?? "") : "")
            .filter(Boolean)
            .sort()
            .join(",");
        result.set(id, `${version}|${contentHash}|${formalIds}|${conflictIds}|${backupIds}|${journalIds}`);
    }
    return result;
}

/** 常规整仓持久化不得把正式分镜版本写回旧值；这是第二道防线，正式 CAS 仍在统一协议内。 */
export function assertNoStaleFormalWrite(previousRaw: string | null, nextRaw: string) {
    const previous = parseStudioEnvelope(previousRaw);
    const next = parseStudioEnvelope(nextRaw);
    if (!previous?.state?.projects || !next?.state?.projects) return;
    const previousProjects = previous.state.projects;
    const nextProjects = next.state.projects;
    if (!Array.isArray(previousProjects) || !Array.isArray(nextProjects)) return;
    const previousById = new Map<string, unknown>(previousProjects.map((project) => {
        const id = project && typeof project === "object" ? (project as { id?: unknown }).id : undefined;
        return [typeof id === "string" ? id : "", project];
    }));
    for (const nextProject of nextProjects) {
        if (!nextProject || typeof nextProject !== "object") continue;
        const projectId = (nextProject as { id?: unknown }).id;
        if (typeof projectId !== "string") continue;
        const previousProject = previousById.get(projectId);
        if (!previousProject) continue;
        const previousSignatures = formalWriteSignature(previousProject);
        const nextSignatures = formalWriteSignature(nextProject);
        for (const [episodeId, previousSignature] of previousSignatures) {
            const nextSignature = nextSignatures.get(episodeId);
            const previousVersion = Number(previousSignature.split("|")[0] ?? 0);
            if (!nextSignature) {
                if (previousVersion > 0) {
                    throw new StudioStateVerificationError(`正式分集被整仓写入删除：${projectId}/${episodeId} v${previousVersion}`);
                }
                continue;
            }
            const nextVersion = Number(nextSignature.split("|")[0] ?? 0);
            if (nextVersion < previousVersion) {
                throw new StudioStateVerificationError(`正式分镜版本回退被拒绝：${projectId}/${episodeId} v${previousVersion} → v${nextVersion}`);
            }
            if (nextVersion === previousVersion && previousVersion > 0 && nextSignature !== previousSignature) {
                throw new StudioStateVerificationError(`同版本正式分镜被改写：${projectId}/${episodeId} v${previousVersion}`);
            }
        }
    }
    for (const [projectId, previousProject] of previousById) {
        if (!projectId) continue;
        if (nextProjects.some((project) => project && typeof project === "object" && (project as { id?: unknown }).id === projectId)) continue;
        const signatures = formalWriteSignature(previousProject);
        const hasFormalStoryboard = [...signatures.values()].some((signature) => Number(signature.split("|")[0] ?? 0) > 0);
        if (hasFormalStoryboard) {
            throw new StudioStateVerificationError(`正式项目被整仓写入删除：${projectId}`);
        }
    }
}

export type StudioSnapshotDiscardInput = {
    projectId: string;
    episodeId: string;
    snapshotId: string;
    expectedProjectUpdatedAt: string;
    expectedEpisodeUpdatedAt: string;
    store?: StudioStateStore;
};

export type StudioSnapshotDiscardResult = {
    ok: boolean;
    error?: string;
    projects?: StudioProject[];
};

/**
 * 丢弃 conflict / backup 快照会改变同版本签名，不能走常规整仓写入。
 * 该事务只删除目标非正式快照，校验调用方看到的 updatedAt，并回读正式版本不变。
 */
export async function commitStoryboardSnapshotDiscard(input: StudioSnapshotDiscardInput): Promise<StudioSnapshotDiscardResult> {
    const store = input.store ?? createIndexedDbStudioStateStore();
    try {
        return await store.transact<StudioSnapshotDiscardResult>((currentRaw) => {
            const envelope = parseStudioEnvelope(currentRaw);
            const projects = envelope?.state?.projects;
            if (!envelope || !Array.isArray(projects)) {
                return { result: { ok: false, error: "本地工作区数据无法读取，已拒绝删除快照" } };
            }
            const currentProjects = projects as StudioProject[];
            const project = currentProjects.find((item) => item.id === input.projectId);
            if (!project) return { result: { ok: false, error: "项目不存在" } };
            if (project.updatedAt !== input.expectedProjectUpdatedAt) {
                return { result: { ok: false, error: "项目已被其他操作更新，请刷新后重试" } };
            }
            const episode = project.episodes.find((item) => item.id === input.episodeId);
            if (!episode?.production) return { result: { ok: false, error: "分集不存在" } };
            if (episode.updatedAt !== input.expectedEpisodeUpdatedAt) {
                return { result: { ok: false, error: "分集已被其他操作更新，请刷新后重试" } };
            }
            const versions = episode.production.storyboardVersions;
            if (!Array.isArray(versions)) return { result: { ok: false, error: "分集快照数据不完整" } };
            const snapshot = versions.find((item) => item.snapshotId === input.snapshotId || item.id === input.snapshotId);
            if (!snapshot) return { result: { ok: false, error: "快照不存在" } };
            if (snapshot.snapshotType !== "conflict" && snapshot.snapshotType !== "backup") {
                return { result: { ok: false, error: "正式快照不能丢弃；它是正式版本的审计记录" } };
            }
            const beforeVersion = Number(episode.production.storyboard?.storyboardVersion ?? 0);
            const formalIdsBefore = versions
                .filter((item) => item.snapshotType === "formal")
                .map((item) => item.snapshotId)
                .sort()
                .join(",");
            const now = new Date().toISOString();
            const nextEpisode = {
                ...episode,
                production: {
                    ...episode.production,
                    storyboardVersions: versions.filter((item) => item.snapshotId !== snapshot.snapshotId && item.id !== snapshot.snapshotId),
                    updatedAt: now,
                },
                updatedAt: now,
            };
            const nextProject = {
                ...project,
                episodes: project.episodes.map((item) => item.id === input.episodeId ? nextEpisode : item),
                updatedAt: now,
            };
            const nextProjects = currentProjects.map((item) => item.id === project.id ? nextProject : item);
            const nextEnvelope: StudioPersistedEnvelope = {
                ...envelope,
                state: { ...(envelope.state ?? {}), projects: nextProjects },
                version: envelope.version ?? 0,
            };
            const nextRaw = serializeStudioEnvelope(nextEnvelope);
            return {
                nextRaw,
                result: { ok: true, projects: nextProjects },
                verify: (readBack) => {
                    const saved = parseStudioEnvelope(readBack);
                    const savedProject = (saved?.state?.projects as StudioProject[] | undefined)?.find((item) => item.id === input.projectId);
                    const savedEpisode = savedProject?.episodes.find((item) => item.id === input.episodeId);
                    if (!savedEpisode?.production) throw new StudioStateVerificationError("删除快照后回读失败：分集丢失");
                    const savedVersions = savedEpisode.production.storyboardVersions;
                    if (!Array.isArray(savedVersions)) throw new StudioStateVerificationError("删除快照后回读失败：快照数据不完整");
                    if (savedVersions.some((item) => item.snapshotId === input.snapshotId || item.id === input.snapshotId)) {
                        throw new StudioStateVerificationError("删除快照后回读失败：目标快照仍存在");
                    }
                    const savedVersion = Number(savedEpisode.production.storyboard?.storyboardVersion ?? 0);
                    if (savedVersion !== beforeVersion) throw new StudioStateVerificationError("删除快照越界：正式版本被改动");
                    const formalIdsAfter = savedVersions
                        .filter((item) => item.snapshotType === "formal")
                        .map((item) => item.snapshotId)
                        .sort()
                        .join(",");
                    if (formalIdsAfter !== formalIdsBefore) throw new StudioStateVerificationError("删除快照越界：正式快照被改动");
                },
            };
        });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "删除快照失败" };
    }
}

export type StudioStructuralDeletionInput = {
    projectId: string;
    episodeId?: string;
    expectedProjectUpdatedAt: string;
    expectedEpisodeUpdatedAt?: string;
    store?: StudioStateStore;
};

export type StudioStructuralDeletionResult = {
    ok: boolean;
    error?: string;
    projects?: StudioProject[];
};

/**
 * 项目 / 分集的显式删除必须走独立事务，不能伪装成“常规整仓写入”。
 * 事务内校验调用方看到的 updatedAt 仍是当前值，避免陈旧标签页借删除入口抹掉别人刚提交的数据。
 */
export async function commitStudioStructuralDeletion(input: StudioStructuralDeletionInput): Promise<StudioStructuralDeletionResult> {
    const store = input.store ?? createIndexedDbStudioStateStore();
    try {
        return await store.transact<StudioStructuralDeletionResult>((currentRaw) => {
            const envelope = parseStudioEnvelope(currentRaw);
            const projects = envelope?.state?.projects;
            if (!envelope || !Array.isArray(projects)) {
                return { result: { ok: false, error: "本地工作区数据无法读取，已拒绝删除" } };
            }
            const currentProjects = projects as StudioProject[];
            const project = currentProjects.find((item) => item.id === input.projectId);
            if (!project) return { result: { ok: false, error: "项目不存在" } };
            if (project.updatedAt !== input.expectedProjectUpdatedAt) {
                return { result: { ok: false, error: "项目已被其他操作更新，请刷新后重试" } };
            }

            let nextProjects: StudioProject[];
            if (input.episodeId) {
                const episode = project.episodes.find((item) => item.id === input.episodeId);
                if (!episode) return { result: { ok: false, error: "分集不存在" } };
                if (input.expectedEpisodeUpdatedAt && episode.updatedAt !== input.expectedEpisodeUpdatedAt) {
                    return { result: { ok: false, error: "分集已被其他操作更新，请刷新后重试" } };
                }
                if (project.episodes.length <= 1) return { result: { ok: false, error: "项目至少保留一集" } };
                const nextProject: StudioProject = {
                    ...project,
                    episodes: project.episodes.filter((item) => item.id !== input.episodeId),
                    updatedAt: new Date().toISOString(),
                };
                nextProjects = currentProjects.map((item) => item.id === project.id ? nextProject : item);
            } else {
                nextProjects = currentProjects.filter((item) => item.id !== input.projectId);
            }

            const nextEnvelope: StudioPersistedEnvelope = {
                ...envelope,
                state: { ...(envelope.state ?? {}), projects: nextProjects },
                version: envelope.version ?? 0,
            };
            const nextRaw = serializeStudioEnvelope(nextEnvelope);
            return {
                nextRaw,
                result: { ok: true, projects: nextProjects },
                verify: (readBack) => {
                    const saved = parseStudioEnvelope(readBack);
                    const savedProjects = saved?.state?.projects;
                    if (!Array.isArray(savedProjects)) throw new StudioStateVerificationError("删除后回读失败：工作区无法解析");
                    const savedList = savedProjects as StudioProject[];
                    if (input.episodeId) {
                        const savedProject = savedList.find((item) => item.id === input.projectId);
                        if (!savedProject) throw new StudioStateVerificationError("删除后回读失败：项目丢失");
                        if (savedProject.episodes.some((item) => item.id === input.episodeId)) {
                            throw new StudioStateVerificationError("删除后回读失败：目标分集仍存在");
                        }
                        if (savedProject.episodes.length !== project.episodes.length - 1) {
                            throw new StudioStateVerificationError("删除后回读失败：分集数量不一致");
                        }
                    } else {
                        if (savedList.some((item) => item.id === input.projectId)) {
                            throw new StudioStateVerificationError("删除后回读失败：目标项目仍存在");
                        }
                        if (savedList.length !== currentProjects.length - 1) {
                            throw new StudioStateVerificationError("删除后回读失败：项目数量不一致");
                        }
                    }

                    const versionsOf = (items: StudioProject[]) => {
                        const versions = new Map<string, number>();
                        for (const item of items) {
                            for (const [episodeId, version] of readProjectStoryboardVersion(item)) {
                                versions.set(`${item.id}/${episodeId}`, version);
                            }
                        }
                        return versions;
                    };
                    const beforeVersions = versionsOf(currentProjects);
                    const afterVersions = versionsOf(savedList);
                    for (const [key, version] of beforeVersions) {
                        if (input.episodeId && key === `${input.projectId}/${input.episodeId}`) continue;
                        if (!input.episodeId && key.startsWith(`${input.projectId}/`)) continue;
                        if (afterVersions.get(key) !== version) {
                            throw new StudioStateVerificationError(`删除越界：其他分集正式版本被改动 ${key}`);
                        }
                    }
                },
            };
        });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "项目 / 分集删除失败" };
    }
}
