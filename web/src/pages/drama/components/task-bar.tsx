import { ChevronDown, ChevronUp, Image as ImageIcon, Mic, Video, X } from "lucide-react";

import { productionProgress } from "@/lib/drama/workflow";
import { cn } from "@/lib/utils";
import { useDramaTasks, type DramaTaskKind } from "@/stores/use-drama-tasks";
import type { DramaSequence } from "@/types/drama";

type Props = {
    sequence: DramaSequence;
    collapsed: boolean;
    onToggle: () => void;
    onJumpStep: (step: number) => void;
    onSelectShot: (id: string) => void;
};

const KIND_META: Record<DramaTaskKind, { label: string; icon: typeof ImageIcon; step: number }> = {
    asset: { label: "资产", icon: ImageIcon, step: 4 },
    image: { label: "图片", icon: ImageIcon, step: 6 },
    audio: { label: "声音", icon: Mic, step: 7 },
    video: { label: "视频", icon: Video, step: 8 },
};

const STATUS_TEXT = {
    running: "进行中",
    done: "完成",
    failed: "失败",
    canceled: "已取消",
    interrupted: "已中断",
} as const;

/** 底部任务栏：读真实任务队列（谁在跑、谁失败、可取消），同时保留镜头级进度统计。 */
export function TaskBar({ sequence, collapsed, onToggle, onJumpStep, onSelectShot }: Props) {
    const tasks = useDramaTasks((state) => state.tasks);
    const cancel = useDramaTasks((state) => state.cancel);
    const remove = useDramaTasks((state) => state.remove);
    const mine = tasks.filter((task) => task.sequenceId === sequence.id);
    const running = mine.filter((task) => task.status === "running");
    const progress = productionProgress(sequence);

    return (
        <div className={cn("drama-taskbar", collapsed ? "is-collapsed" : "is-open")}>
            <div className="flex shrink-0 items-center gap-3 px-4 py-2">
                <span className="text-[13px] font-medium">任务</span>
                {(["image", "audio", "video"] as DramaTaskKind[]).map((kind) => {
                    const meta = KIND_META[kind];
                    const Icon = meta.icon;
                    const stat = kind === "image" ? progress.images : kind === "audio" ? progress.audios : progress.videos;
                    const total = kind === "image" ? progress.shots : kind === "audio" ? progress.voices : progress.shots;
                    const failed = kind === "image" ? progress.imageFailed : kind === "audio" ? progress.audioFailed : progress.videoFailed;
                    return (
                        <span key={kind} className="flex items-center gap-1.5 text-[13px] text-stone-500 dark:text-stone-400">
                            <Icon className="size-4" />
                            {meta.label}
                            <span className="tabular-nums text-stone-700 dark:text-stone-200">
                                {stat}/{total}
                            </span>
                            {failed ? <span className="text-red-500">· {failed} 失败</span> : null}
                        </span>
                    );
                })}
                {running.length ? <span className="text-[13px] text-amber-600 dark:text-amber-400">· {running.length} 个任务进行中</span> : null}
                <span className="ml-auto hidden text-[13px] text-stone-400 sm:inline">{mine.length ? `最近 ${Math.min(mine.length, 6)} 条任务` : "还没有生成任务"}</span>
                <button type="button" className="drama-taskbar__toggle" onClick={onToggle}>
                    {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    {collapsed ? "展开" : "收起"}
                </button>
            </div>

            {collapsed ? null : (
                <div className="min-h-0 flex-1 overflow-hidden px-4 pb-3">
                    {mine.length === 0 ? (
                        <div className="grid h-full place-items-center text-[13px] text-stone-400">生成资产图、画面、配音或视频后，任务会在这里出现；可取消进行中的任务。</div>
                    ) : (
                        <div className="grid h-full min-h-0 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2 overflow-y-auto">
                            {mine.slice(0, 12).map((task) => {
                                const meta = KIND_META[task.kind];
                                const Icon = meta.icon;
                                return (
                                    <div key={task.id} className="drama-task-card">
                                        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => {
                                            if (task.shotId) onSelectShot(task.shotId);
                                            onJumpStep(meta.step);
                                        }}>
                                            <Icon className="size-4 shrink-0 text-stone-400" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[13px]">{task.label}</span>
                                                <span className="block truncate text-[12px] text-stone-400">
                                                    {task.model || "默认模型"} · {STATUS_TEXT[task.status]}
                                                    {task.error ? ` · ${task.error}` : ""}
                                                </span>
                                            </span>
                                        </button>
                                        {task.status === "running" ? (
                                            <button type="button" className="drama-task-cancel" title="取消任务" onClick={() => cancel(task.id)}>
                                                <X className="size-3.5" />
                                            </button>
                                        ) : (
                                            <button type="button" className="drama-task-cancel" title="从列表移除" onClick={() => remove(task.id)}>
                                                <X className="size-3.5" />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
