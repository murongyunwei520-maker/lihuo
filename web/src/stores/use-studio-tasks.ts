import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { storageKey } from "@/constant/app";
import { localForageStorage } from "@/lib/localforage-storage";
import { recoverInterruptedTask, normalizeStudioTaskStatus } from "@/lib/studio/task-recovery";
import type { StudioTask, StudioTaskInput, StudioTaskRemote, StudioTaskStatus } from "@/types/studio";
// 全局任务中心：所有工作区共用一条队列，状态以任务记录为准。
// 队列与 AbortController 只在内存里；刷新后运行中的任务标记为中断，但参数与远端凭据保留，可续查/重试。

type TaskRunnerContext = {
    taskId: string;
    signal: AbortSignal;
    setProgress: (progress: number) => void;
    log: (message: string) => void;
    update: (patch: Partial<StudioTask>) => void;
};

type TaskRunnerResult = { outputKey?: string; remote?: StudioTaskRemote; note?: string } | void;

type TaskRunner = (ctx: TaskRunnerContext) => Promise<TaskRunnerResult>;

export type StudioTaskOutcome = { id: string; status: StudioTaskStatus; outputKey?: string; error?: string };

type StudioTaskStore = {
    hydrated: boolean;
    tasks: StudioTask[];
    maxConcurrent: number;
    setMaxConcurrent: (value: number) => void;
    start: (input: StudioTaskInput, runner: TaskRunner) => { id: string; promise: Promise<StudioTaskOutcome> };
    /** outcome 缺省时：未提交任务直接 cancelled；运行中任务先进入 cancelling，远端确认后由调用方显式 cancelled。 */
    cancel: (id: string, options?: { outcome?: "cancelling" | "cancelled" | "canceled" | "unknown"; error?: string }) => void;
    /** 远端已确认停止后，把 cancelling 落为 cancelled；无后端 API 时只能记录“用户人工核验”。 */
    confirmCancelled: (id: string, options?: { error?: string; by?: string; method?: "manual" | "remote_api"; note?: string }) => void;
    remove: (id: string) => void;
    clearFinished: () => void;
    /** 运行中的任务把远端凭据尽早写进任务记录，刷新后还能续查。 */
    updateTask: (id: string, patch: Partial<StudioTask>) => void;
};

const now = () => new Date().toISOString();
const queue: string[] = [];
const runners = new Map<string, TaskRunner>();
const controllers = new Map<string, AbortController>();
const resolvers = new Map<string, (outcome: StudioTaskOutcome) => void>();
const uncertain = new Set<string>();
let pumping = false;

const MAX_TASKS = 300;

// 任务记录必须在真正发出远端请求前落盘；这里绕开 persist 的异步排队，
// 在 start / 进入 running 前显式等待一次任务快照写入。
let taskPersistChain: Promise<void> = Promise.resolve();

function persistTasksSnapshot(tasks: StudioTask[], maxConcurrent: number) {
    const raw = JSON.stringify({ state: { tasks, maxConcurrent }, version: 0 });
    taskPersistChain = taskPersistChain.catch(() => undefined).then(() => localForageStorage.setItem(storageKey("studio_tasks"), raw)).then(() => undefined);
    return taskPersistChain;
}

function updateTaskInList(tasks: StudioTask[], id: string, patch: Partial<StudioTask>) {
    return tasks.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: now() } : task));
}

export const useStudioTasks = create<StudioTaskStore>()(
    persist(
        (set, get) => {
            const finish = (id: string, patch: Partial<StudioTask>) => {
                const normalized = patch.status ? { ...patch, status: normalizeStudioTaskStatus(patch.status) } : patch;
                set((state) => ({
                    tasks: updateTaskInList(state.tasks, id, {
                        ...normalized,
                        finishedAt: normalized.status === "cancelling" ? undefined : normalized.finishedAt ?? now(),
                    }),
                }));
                const task = get().tasks.find((item) => item.id === id);
                resolvers.get(id)?.({ id, status: task?.status ?? "failed", outputKey: task?.outputKey, error: task?.error });
                resolvers.delete(id);
                runners.delete(id);
                controllers.delete(id);
                uncertain.delete(id);
            };

            const pump = () => {
                if (pumping) return;
                pumping = true;
                try {
                    while (get().tasks.filter((task) => task.status === "running" || normalizeStudioTaskStatus(task.status) === "cancelling").length < Math.max(1, get().maxConcurrent) && queue.length) {
                        const id = queue.shift()!;
                        const runner = runners.get(id);
                        if (!runner) continue;
                        const controller = new AbortController();
                        controllers.set(id, controller);
                        set((state) => ({ tasks: updateTaskInList(state.tasks, id, { status: "running", submitState: "submitting", submitStartedAt: now(), startedAt: now(), error: undefined }) }));
                        const ctx: TaskRunnerContext = {
                            taskId: id,
                            signal: controller.signal,
                            setProgress: (progress) => set((state) => ({ tasks: updateTaskInList(state.tasks, id, { progress: Math.max(0, Math.min(100, Math.round(progress))) }) })),
                            log: (message) =>
                                set((state) => ({
                                    tasks: state.tasks.map((task) => (task.id === id ? { ...task, logs: [...task.logs, `${new Date().toLocaleTimeString("zh-CN")} ${message}`].slice(-50), updatedAt: now() } : task)),
                                })),
                            update: (patch) =>
                                set((state) => ({
                                    tasks: updateTaskInList(state.tasks, id, patch.remote
                                        ? { ...patch, submitState: patch.submitState ?? "submitted", submitConfirmedAt: patch.submitConfirmedAt ?? now() }
                                        : patch),
                                })),
                        };
                        // 先等待任务记录落盘，再调用 runner 发远端请求；落盘失败时绝不提交。
                        void (async () => {
                            try {
                                await persistTasksSnapshot(get().tasks, get().maxConcurrent);
                            } catch (error) {
                                finish(id, {
                                    status: "failed",
                                    submitState: "not_submitted",
                                    error: `任务记录未能保存，已阻止提交：${error instanceof Error ? error.message : "本地存储失败"}`,
                                });
                                pump();
                                return;
                            }
                            try {
                                const result = await runner(ctx);
                                const task = get().tasks.find((item) => item.id === id);
                                const normalizedStatus = task ? normalizeStudioTaskStatus(task.status) : undefined;
                                if (normalizedStatus === "cancelling" || normalizedStatus === "cancelled" || normalizedStatus === "unknown") {
                                    finish(id, { status: normalizedStatus, error: task?.error ?? "任务未完成" });
                                    return;
                                }
                                finish(id, {
                                    status: "succeeded",
                                    progress: 100,
                                    outputKey: result?.outputKey,
                                    remote: result?.remote ?? task?.remote,
                                    note: result?.note,
                                });
                            } catch (error: unknown) {
                                const task = get().tasks.find((item) => item.id === id);
                                const normalizedStatus = task ? normalizeStudioTaskStatus(task.status) : undefined;
                                const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
                                if (uncertain.has(id) || normalizedStatus === "unknown") {
                                    finish(id, { status: "unknown", submitState: "unknown", error: task?.error ?? "远端请求结果未知，请核对后处理" });
                                } else if (normalizedStatus === "cancelling") {
                                    finish(id, { status: "cancelling", error: task?.error ?? "取消请求已发出，远端尚未确认停止" });
                                } else if (aborted || normalizedStatus === "cancelled") {
                                    finish(id, { status: "cancelled", error: task?.error ?? "已确认取消；远端任务未再继续" });
                                } else {
                                    finish(id, { status: "failed", error: error instanceof Error ? error.message : "任务失败" });
                                }
                            } finally {
                                pump();
                            }
                        })();
                    }
                } finally {
                    pumping = false;
                }
            };

            return {
                hydrated: false,
                tasks: [],
                maxConcurrent: 3,
                setMaxConcurrent: (value) => set({ maxConcurrent: Math.max(1, Math.min(6, Math.round(value))) }),
                start: (input, runner) => {
                    const id = `task-${nanoid(10)}`;
                    const task: StudioTask = {
                        ...input,
                        id,
                        status: "submitting",
                        submitState: "not_submitted",
                        retryCount: input.retryOf ? 1 : 0,
                        logs: [],
                        createdAt: now(),
                        updatedAt: now(),
                    };
                    runners.set(id, runner);
                    set((state) => ({ tasks: [task, ...state.tasks].slice(0, MAX_TASKS) }));
                    const promise = new Promise<StudioTaskOutcome>((resolve) => resolvers.set(id, resolve));
                    // 先落盘任务 id / 项目 / 模型摘要 / Prompt 版本，再允许 runner 发远端请求。
                    void (async () => {
                        try {
                            await persistTasksSnapshot(get().tasks, get().maxConcurrent);
                        } catch (error) {
                            finish(id, {
                                status: "failed",
                                submitState: "not_submitted",
                                error: `任务记录未能保存，已阻止提交：${error instanceof Error ? error.message : "本地存储失败"}`,
                            });
                            return;
                        }
                        const currentStatus = get().tasks.find((item) => item.id === id)?.status;
                        if (currentStatus === "canceled" || currentStatus === "cancelled" || currentStatus === "cancelling") {
                            runners.delete(id);
                            resolvers.delete(id);
                            return;
                        }
                        set((state) => ({ tasks: updateTaskInList(state.tasks, id, { status: "queued" }) }));
                        queue.push(id);
                        pump();
                    })();
                    return { id, promise };
                },
                cancel: (id, options) => {
                    const task = get().tasks.find((item) => item.id === id);
                    if (!task) return;
                    const index = queue.indexOf(id);
                    if (index >= 0) queue.splice(index, 1);
                    const runningNow = task.status === "running";
                    const outcome = options?.outcome ?? (runningNow ? "cancelling" : "cancelled");
                    const normalizedOutcome = outcome === "canceled" ? "cancelled" : outcome;
                    const note = options?.error ?? (normalizedOutcome === "unknown"
                        ? (task.kind === "video" ? "已停止等待；远程视频任务可能仍在运行，可稍后到任务中心续查" : "已停止等待；远端结果未知")
                        : normalizedOutcome === "cancelling"
                            ? "取消请求已发出，远端尚未确认停止；请核对远端结果后再确认取消"
                            : "已取消；本地已停止等待");
                    if (normalizedOutcome === "unknown") uncertain.add(id);
                    controllers.get(id)?.abort();
                    const cancelRequest: StudioTask["cancelRequest"] = {
                        requestedAt: now(),
                        requestedBy: "local-user",
                        method: "local_abort",
                        remoteConfirmed: false,
                        note,
                    };
                    set((state) => ({
                        tasks: updateTaskInList(state.tasks, id, {
                            status: normalizedOutcome,
                            submitState: normalizedOutcome === "unknown" ? "unknown" : task.submitState,
                            error: note,
                            cancelRequest,
                            finishedAt: normalizedOutcome === "cancelling" ? undefined : now(),
                        }),
                    }));
                    resolvers.get(id)?.({ id, status: normalizedOutcome, error: note });
                    resolvers.delete(id);
                    if (normalizedOutcome !== "cancelling") {
                        runners.delete(id);
                        controllers.delete(id);
                        pump();
                    }
                },
                confirmCancelled: (id, options) => {
                    const task = get().tasks.find((item) => item.id === id);
                    if (!task || normalizeStudioTaskStatus(task.status) !== "cancelling") return;
                    const confirmedAt = now();
                    const confirmMethod = options?.method ?? "manual";
                    const note = options?.note ?? options?.error ?? (confirmMethod === "remote_api"
                        ? "后端 API 已确认远端停止，任务取消完成"
                        : "用户人工核验：已核对远端停止，任务取消完成");
                    const cancelRequest: StudioTask["cancelRequest"] = {
                        requestedAt: task.cancelRequest?.requestedAt ?? task.updatedAt,
                        requestedBy: task.cancelRequest?.requestedBy ?? "local-user",
                        method: task.cancelRequest?.method ?? "local_abort",
                        remoteConfirmed: true,
                        confirmedAt,
                        confirmedBy: options?.by ?? "local-user",
                        confirmMethod,
                        note,
                    };
                    set((state) => ({ tasks: updateTaskInList(state.tasks, id, { status: "cancelled", error: note, cancelRequest, finishedAt: confirmedAt }) }));
                    controllers.delete(id);
                    runners.delete(id);
                    uncertain.delete(id);
                    pump();
                },
                remove: (id) => {
                    queue.splice(0, queue.length, ...queue.filter((item) => item !== id));
                    runners.delete(id);
                    controllers.get(id)?.abort();
                    controllers.delete(id);
                    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }));
                },
                clearFinished: () =>
                    set((state) => ({
                        tasks: state.tasks.filter((task) => {
                            const status = normalizeStudioTaskStatus(task.status);
                            return status === "pending" || status === "submitting" || status === "queued" || status === "running" || status === "cancelling" || status === "retrying";
                        }),
                    })),
                updateTask: (id, patch) => set((state) => ({ tasks: updateTaskInList(state.tasks, id, patch) })),
            };
        },
        {
            name: storageKey("studio_tasks"),
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ tasks: state.tasks, maxConcurrent: state.maxConcurrent }),
            onRehydrateStorage: () => (state) => {
                const current = useStudioTasks.getState().tasks.map((task) => recoverInterruptedTask(task));
                const persisted = (state?.tasks ?? []).map((task) => recoverInterruptedTask(task));
                const currentIds = new Set(current.map((task) => task.id));
                useStudioTasks.setState({
                    hydrated: true,
                    // hydration 可能晚于一次 start；当前内存里刚创建的任务不能被旧持久化快照覆盖。
                    tasks: [...current, ...persisted.filter((task) => !currentIds.has(task.id))].slice(0, MAX_TASKS),
                });
            },
        },
    ),
);

export function runningTaskCount(kind?: StudioTask["kind"]) {
    return useStudioTasks.getState().tasks.filter((task) => {
        const status = normalizeStudioTaskStatus(task.status);
        return (status === "running" || status === "cancelling") && (!kind || task.kind === kind);
    }).length;
}
