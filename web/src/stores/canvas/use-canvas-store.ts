import { storageKey } from "@/constant/app";
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { prepareForCloud } from "@/services/cloud-media";
import { createProjectRemote, deleteProjectRemote, getProject, importProjectsRemote, listProjects, saveProjectRemote, ServerApiError, type ProjectSummary } from "@/services/api/lihuo-server";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    /** 云端版本号；本地模式下为空 */
    revision?: number;
    /** 列表接口给的统计，避免为了数字去拉 payload */
    nodeCount?: number;
    connectionCount?: number;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    /** 云端列表是否已同步过一次（本地模式恒为 true） */
    cloudReady: boolean;
    cloudSyncing: boolean;
    cloudError: string | null;
    /** 本机有、云端没有的项目 id，用于一次性迁移 */
    importableIds: string[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    /** 云端模式按需拉取完整快照；本地模式等价于 openProject */
    loadProject: (id: string) => Promise<CanvasProject | null>;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
    syncCloudProjects: () => Promise<void>;
    /** 等待云端列表首次同步完成（直接打开项目链接时避免误判"项目不存在"） */
    waitForCloudReady: (timeoutMs?: number) => Promise<void>;
    importLocalToCloud: () => Promise<{ imported: number; skipped: number }>;
    clearCloudError: () => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = storageKey("canvas_store");
const SAVE_DEBOUNCE_MS = 1200;
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

/** 是否走云端：云端渠道 + 已登录 */
function cloudActive(): boolean {
    return useConfigStore.getState().config.channelMode === "cloud" && useAuthStore.getState().status === "authenticated";
}

let markHydrated: () => void = () => undefined;
const hydratedPromise = new Promise<void>((resolve) => {
    markHydrated = resolve;
});

/** 项目对象 → 云端 payload（去掉本地字段） */
function toPayload(project: CanvasProject): Record<string, unknown> {
    const { revision, nodeCount, connectionCount, ...rest } = project;
    void revision;
    void nodeCount;
    void connectionCount;
    return rest as unknown as Record<string, unknown>;
}

function summaryToShell(item: ProjectSummary): CanvasProject {
    return {
        id: item.id,
        title: item.title,
        createdAt: new Date(item.createdAt * 1000).toISOString(),
        updatedAt: new Date(item.updatedAt * 1000).toISOString(),
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: initialViewport,
        revision: item.revision,
        nodeCount: item.nodeCount,
        connectionCount: item.connectionCount,
    };
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const savingIds = new Set<string>();

function errorText(error: unknown): string {
    if (error instanceof ServerApiError) {
        if (error.status === 401) return "登录已过期，改动暂存在本地";
        if (error.code === "payload_inline_media") return "画布里还有内联图片，暂时无法保存到云端";
        if (error.code === "payload_too_large") return "画布快照超过云端上限";
        return error.message;
    }
    return (error as Error)?.message || "云端保存失败";
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => {
            /** 把某个项目推到云端；版本冲突时取回新版本再重试一次 */
            const flush = async (id: string, attempt = 0): Promise<void> => {
                if (!cloudActive() || savingIds.has(id)) return;
                const project = get().projects.find((item) => item.id === id);
                if (!project) return;
                // 列表只带元数据：拿到 payload 之前绝不写云端，否则会把画布覆盖成空白
                if ((project.nodeCount ?? 0) > 0 && project.nodes.length === 0) return;

                savingIds.add(id);
                try {
                    if (!project.revision) {
                        try {
                            const created = await createProjectRemote({ id, title: project.title, payload: await prepareForCloud(toPayload(project)) });
                            set((state) => ({
                                projects: state.projects.map((item) => (item.id === id ? { ...item, revision: created.revision } : item)),
                            }));
                        } catch (error) {
                            // 已存在（比如另一个标签页先建了）：取回版本后按更新处理
                            if (error instanceof ServerApiError && error.status === 409 && attempt === 0) {
                                const detail = await getProject(id);
                                set((state) => ({
                                    projects: state.projects.map((item) => (item.id === id ? { ...item, revision: detail.revision } : item)),
                                }));
                                savingIds.delete(id);
                                await flush(id, 1);
                            } else {
                                throw error;
                            }
                        }
                        return;
                    }

                    try {
                        const saved = await saveProjectRemote(id, {
                            revision: project.revision,
                            title: project.title,
                            payload: await prepareForCloud(toPayload(project)),
                        });
                        set((state) => ({
                            projects: state.projects.map((item) =>
                                item.id === id ? { ...item, revision: saved.revision, updatedAt: new Date(saved.updatedAt * 1000).toISOString() } : item,
                            ),
                        }));
                    } catch (error) {
                        // 同一账号多标签页编辑：以云端新版本为基准再写一次，避免改动丢失
                        if (error instanceof ServerApiError && error.status === 409 && attempt === 0) {
                            const current = (error.details as { currentRevision?: number } | null)?.currentRevision;
                            if (current) {
                                set((state) => ({
                                    projects: state.projects.map((item) => (item.id === id ? { ...item, revision: current } : item)),
                                }));
                                savingIds.delete(id);
                                await flush(id, 1);
                                return;
                            }
                        }
                        throw error;
                    }
                } catch (error) {
                    console.error("[canvas] 云端保存失败", id, error);
                    set({ cloudError: errorText(error) });
                } finally {
                    savingIds.delete(id);
                }
            };

            const scheduleSave = (id: string) => {
                if (!cloudActive()) return;
                const existing = saveTimers.get(id);
                if (existing) clearTimeout(existing);
                saveTimers.set(
                    id,
                    setTimeout(() => {
                        saveTimers.delete(id);
                        void flush(id);
                    }, SAVE_DEBOUNCE_MS),
                );
            };

            return {
                hydrated: false,
                projects: [],
                deletedProjects: [],
                cloudReady: false,
                cloudSyncing: false,
                cloudError: null,
                importableIds: [],

                createProject: (title = i18n.t("canvas.project.untitled")) => {
                    const now = new Date().toISOString();
                    const id = nanoid();
                    const project: CanvasProject = {
                        id,
                        title,
                        createdAt: now,
                        updatedAt: now,
                        nodes: [],
                        connections: [],
                        chatSessions: [],
                        activeChatId: null,
                        backgroundMode: "lines",
                        showImageInfo: false,
                        viewport: initialViewport,
                    };
                    set((state) => ({ projects: [project, ...state.projects] }));
                    if (cloudActive()) void flush(id);
                    return id;
                },
                importProject: (source) => {
                    const now = new Date().toISOString();
                    const project: CanvasProject = {
                        id: nanoid(),
                        title: source.title || i18n.t("canvas.project.imported"),
                        createdAt: source.createdAt || now,
                        updatedAt: now,
                        nodes: source.nodes || [],
                        connections: source.connections || [],
                        chatSessions: source.chatSessions || [],
                        activeChatId: source.activeChatId || null,
                        backgroundMode: source.backgroundMode || "lines",
                        showImageInfo: source.showImageInfo || false,
                        viewport: source.viewport || initialViewport,
                    };
                    set((state) => ({ projects: [project, ...state.projects] }));
                    if (cloudActive()) void flush(project.id);
                    return project.id;
                },
                openProject: (id) => {
                    return get().projects.find((item) => item.id === id) || null;
                },
                loadProject: async (id) => {
                    const cached = get().projects.find((item) => item.id === id) || null;
                    if (!cloudActive()) return cached;
                    // 本地刚创建、还没拿到 revision：直接用内存版本，别去云端查
                    if (cached && !cached.revision) return cached;

                    try {
                        const detail = await getProject(id);
                        const payload = detail.payload as Partial<CanvasProject>;
                        const project: CanvasProject = {
                            id: detail.id,
                            title: detail.title,
                            createdAt: new Date(detail.createdAt * 1000).toISOString(),
                            updatedAt: new Date(detail.updatedAt * 1000).toISOString(),
                            nodes: payload.nodes || [],
                            connections: payload.connections || [],
                            chatSessions: payload.chatSessions || [],
                            activeChatId: payload.activeChatId || null,
                            backgroundMode: payload.backgroundMode || "lines",
                            showImageInfo: payload.showImageInfo || false,
                            viewport: payload.viewport || initialViewport,
                            revision: detail.revision,
                            nodeCount: detail.nodeCount,
                            connectionCount: detail.connectionCount,
                        };
                        set((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== id)] }));
                        return project;
                    } catch (error) {
                        if (error instanceof ServerApiError && error.status === 404) {
                            set((state) => ({ projects: state.projects.filter((item) => item.id !== id) }));
                            return null;
                        }
                        // 拉不到完整快照就回列表：拿元数据壳渲染会让后续保存覆盖云端
                        set({ cloudError: errorText(error) });
                        return null;
                    }
                },
                renameProject: (id, title) => {
                    set((state) => ({
                        projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                    }));
                    scheduleSave(id);
                },
                deleteProjects: (ids) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    set((state) => {
                        const projects = state.projects.filter((project) => !removing.has(project.id));
                        const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                        return { projects, deletedProjects };
                    });
                    if (!cloudActive()) return;
                    for (const id of ids) {
                        const timer = saveTimers.get(id);
                        if (timer) {
                            clearTimeout(timer);
                            saveTimers.delete(id);
                        }
                        void deleteProjectRemote(id).catch((error) => set({ cloudError: errorText(error) }));
                    }
                },
                replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
                updateProject: (id, patch) => {
                    set((state) => ({
                        projects: state.projects.map((project) =>
                            project.id === id
                                ? {
                                      ...project,
                                      ...patch,
                                      ...(patch.nodes ? { nodeCount: patch.nodes.length } : {}),
                                      ...(patch.connections ? { connectionCount: patch.connections.length } : {}),
                                      updatedAt: new Date().toISOString(),
                                  }
                                : project,
                        ),
                    }));
                    scheduleSave(id);
                },

                waitForCloudReady: async (timeoutMs = 3000) => {
                    if (get().cloudReady) return;
                    const started = Date.now();
                    while (!get().cloudReady && Date.now() - started < timeoutMs) {
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                },

                syncCloudProjects: async () => {
                    if (!cloudActive()) {
                        set({ cloudReady: true, importableIds: [] });
                        return;
                    }
                    set({ cloudSyncing: true, cloudError: null });
                    try {
                        await hydratedPromise;
                        const localWithContent = get().projects.filter((project) => project.nodes.length > 0);
                        const { items } = await listProjects(1, 100);
                        const cloudIds = new Set(items.map((item) => item.id));
                        set({
                            projects: items.map(summaryToShell),
                            importableIds: localWithContent.filter((project) => !cloudIds.has(project.id)).map((project) => project.id),
                            cloudReady: true,
                        });
                    } catch (error) {
                        set({ cloudError: errorText(error), cloudReady: true });
                    } finally {
                        set({ cloudSyncing: false });
                    }
                },

                importLocalToCloud: async () => {
                    const ids = new Set(get().importableIds);
                    const locals = get().projects.filter((project) => ids.has(project.id) && project.nodes.length > 0);
                    if (!locals.length) return { imported: 0, skipped: 0 };
                    const prepared = [];
                    for (const project of locals) {
                        prepared.push({ id: project.id, title: project.title, payload: await prepareForCloud(toPayload(project)) });
                    }
                    const result = await importProjectsRemote(prepared);
                    set({ importableIds: [] });
                    await get().syncCloudProjects();
                    return result;
                },

                clearCloudError: () => set({ cloudError: null }),
            };
        },
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
                markHydrated();
            },
        },
    ),
);
