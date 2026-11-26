import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { storageKey } from "@/constant/app";
import { localForageStorage } from "@/lib/localforage-storage";

// 短剧生成任务队列：图片 / 声音 / 视频 / 资产统一登记，运行中的任务持有 AbortSignal。
// 只持久化任务元数据；页面刷新后运行中的任务标记为「已中断」，不假装还在跑。

export type DramaTaskKind = "asset" | "image" | "audio" | "video";
export type DramaTaskStatus = "running" | "done" | "failed" | "canceled" | "interrupted";

export type DramaTask = {
    id: string;
    sequenceId: string;
    shotId?: string;
    kind: DramaTaskKind;
    label: string;
    model?: string;
    /** 提交时的提示词快照，便于复现与排查。 */
    prompt?: string;
    status: DramaTaskStatus;
    error?: string;
    artifact?: string;
    retryCount: number;
    createdAt: string;
    updatedAt: string;
};

type StartInput = Pick<DramaTask, "sequenceId" | "kind" | "label"> & Pick<Partial<DramaTask>, "shotId" | "model" | "prompt">;

type DramaTaskStore = {
    hydrated: boolean;
    tasks: DramaTask[];
    /** 新建任务并返回取消信号；signal 必须继续传给实际请求。 */
    start: (input: StartInput) => { id: string; signal: AbortSignal };
    finish: (id: string, artifact?: string) => void;
    fail: (id: string, error: string) => void;
    cancel: (id: string) => void;
    remove: (id: string) => void;
    clearFinished: () => void;
};

// AbortController 不可序列化，放在内存里；刷新后自然失效（任务会被标记为中断）。
const controllers = new Map<string, AbortController>();

const now = () => new Date().toISOString();

export const useDramaTasks = create<DramaTaskStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            tasks: [],
            start: (input) => {
                const id = `task-${nanoid(8)}`;
                const controller = new AbortController();
                controllers.set(id, controller);
                const task: DramaTask = {
                    id,
                    sequenceId: input.sequenceId,
                    shotId: input.shotId,
                    kind: input.kind,
                    label: input.label,
                    model: input.model,
                    prompt: input.prompt,
                    status: "running",
                    retryCount: 0,
                    createdAt: now(),
                    updatedAt: now(),
                };
                set((state) => ({ tasks: [task, ...state.tasks].slice(0, 80) }));
                return { id, signal: controller.signal };
            },
            finish: (id, artifact) => {
                controllers.delete(id);
                set((state) => ({
                    tasks: state.tasks.map((task) => (task.id === id ? { ...task, status: "done", artifact: artifact ?? task.artifact, error: undefined, updatedAt: now() } : task)),
                }));
            },
            fail: (id, error) => {
                controllers.delete(id);
                set((state) => ({
                    tasks: state.tasks.map((task) => {
                        if (task.id !== id) return task;
                        // 用户主动取消后，请求抛出的 AbortError 不覆盖取消状态。
                        if (task.status === "canceled") return { ...task, updatedAt: now() };
                        return { ...task, status: "failed", error, updatedAt: now() };
                    }),
                }));
            },
            cancel: (id) => {
                controllers.get(id)?.abort();
                controllers.delete(id);
                set((state) => ({
                    tasks: state.tasks.map((task) => (task.id === id && task.status === "running" ? { ...task, status: "canceled", error: "已取消", updatedAt: now() } : task)),
                }));
            },
            remove: (id) => {
                controllers.delete(id);
                set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }));
            },
            clearFinished: () => set((state) => ({ tasks: state.tasks.filter((task) => task.status === "running") })),
        }),
        {
            name: storageKey("drama_tasks"),
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ tasks: state.tasks }),
            // 刷新后不可能还有活着的请求：运行中的任务标记为中断，避免界面一直转圈。
            onRehydrateStorage: () => (state) => {
                useDramaTasks.setState({
                    hydrated: true,
                    tasks: (state?.tasks ?? []).map((task) => (task.status === "running" ? { ...task, status: "interrupted" as const, error: "页面刷新或关闭后任务中断，请重试", updatedAt: now() } : task)),
                });
            },
        },
    ),
);

/** 当前是否还有同类任务在跑（用于按钮禁用与提示）。 */
export function runningTaskCount(kind?: DramaTaskKind) {
    return useDramaTasks.getState().tasks.filter((task) => task.status === "running" && (!kind || task.kind === kind)).length;
}
