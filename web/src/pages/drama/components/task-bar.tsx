import { ChevronDown, ChevronUp, Image as ImageIcon, Mic, Video } from "lucide-react";

import { productionProgress } from "@/lib/drama/workflow";
import { cn } from "@/lib/utils";
import type { DramaSequence, DramaShot } from "@/types/drama";

type Props = {
    sequence: DramaSequence;
    collapsed: boolean;
    onToggle: () => void;
    onJumpStep: (step: number) => void;
    onSelectShot: (id: string) => void;
};

type TaskKind = "image" | "audio" | "video";

type TaskRow = {
    key: string;
    kind: TaskKind;
    shot: DramaShot;
    status: "pending" | "running" | "done" | "failed";
    step: number;
};

function tasksOf(sequence: DramaSequence): TaskRow[] {
    const rows: TaskRow[] = [];
    for (const shot of sequence.shots) {
        rows.push({ key: `image-${shot.id}`, kind: "image", shot, status: shot.imageRef ? "done" : shot.status === "failed" ? "failed" : shot.status === "running" ? "running" : "pending", step: 6 });
        if (shot.line.trim()) rows.push({ key: `audio-${shot.id}`, kind: "audio", shot, status: shot.audioRef ? "done" : "pending", step: 7 });
        rows.push({ key: `video-${shot.id}`, kind: "video", shot, status: shot.videoRef ? "done" : "pending", step: 8 });
    }
    return rows;
}

const KIND_META: Record<TaskKind, { label: string; icon: typeof ImageIcon }> = {
    image: { label: "图片", icon: ImageIcon },
    audio: { label: "声音", icon: Mic },
    video: { label: "视频", icon: Video },
};

const STATUS_TEXT: Record<TaskRow["status"], string> = { pending: "待生成", running: "生成中", done: "已完成", failed: "失败" };

/** 底部任务栏：读的是镜头上的真实生成状态，不是模拟进度。 */
export function TaskBar({ sequence, collapsed, onToggle, onJumpStep, onSelectShot }: Props) {
    const rows = tasksOf(sequence);
    const progress = productionProgress(sequence);
    const counts = (kind: TaskKind) => {
        const list = rows.filter((row) => row.kind === kind);
        return { total: list.length, done: list.filter((row) => row.status === "done").length, failed: list.filter((row) => row.status === "failed").length };
    };

    return (
        <div className={cn("drama-taskbar", collapsed ? "is-collapsed" : "is-open")}>
            <div className="flex shrink-0 items-center gap-3 px-4 py-2">
                <span className="text-[13px] font-medium">任务</span>
                {(["image", "audio", "video"] as TaskKind[]).map((kind) => {
                    const meta = KIND_META[kind];
                    const stat = counts(kind);
                    const Icon = meta.icon;
                    return (
                        <span key={kind} className="flex items-center gap-1.5 text-[13px] text-stone-500 dark:text-stone-400">
                            <Icon className="size-4" />
                            {meta.label}
                            <span className="tabular-nums text-stone-700 dark:text-stone-200">
                                {stat.done}/{stat.total}
                            </span>
                            {stat.failed ? <span className="text-red-500">· {stat.failed} 失败</span> : null}
                        </span>
                    );
                })}
                <span className="ml-auto hidden text-[13px] text-stone-400 sm:inline">
                    {progress.shots} 镜 · 画面 {progress.images} · 声音 {progress.audios}/{progress.voices} · 视频 {progress.videos}
                </span>
                <button type="button" className="drama-taskbar__toggle" onClick={onToggle}>
                    {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    {collapsed ? "展开" : "收起"}
                </button>
            </div>

            {collapsed ? null : (
                <div className="grid min-h-0 flex-1 grid-cols-3 gap-3 overflow-hidden px-4 pb-3">
                    {(["image", "audio", "video"] as TaskKind[]).map((kind) => {
                        const meta = KIND_META[kind];
                        const Icon = meta.icon;
                        const list = rows.filter((row) => row.kind === kind);
                        return (
                            <div key={kind} className="flex min-h-0 flex-col rounded-lg border border-[var(--studio-border-soft)]">
                                <div className="flex items-center gap-1.5 border-b border-[var(--studio-border-soft)] px-2.5 py-1.5 text-[13px] font-medium">
                                    <Icon className="size-4 text-stone-400" />
                                    {meta.label}任务
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto p-1">
                                    {list.length === 0 ? <div className="px-2 py-3 text-[13px] text-stone-400">还没有镜头</div> : null}
                                    {list.map((row) => (
                                        <button
                                            key={row.key}
                                            type="button"
                                            className="drama-task-row"
                                            onClick={() => {
                                                onSelectShot(row.shot.id);
                                                onJumpStep(row.step);
                                            }}
                                        >
                                            <span className={cn("size-1.5 shrink-0 rounded-full", row.status === "done" ? "bg-emerald-500" : row.status === "failed" ? "bg-red-500" : row.status === "running" ? "bg-amber-500" : "bg-stone-300 dark:bg-stone-600")} />
                                            <span className="min-w-0 flex-1 truncate text-left">镜 {row.shot.no} · {row.shot.scene || "未填场景"}</span>
                                            <span className={cn("shrink-0 text-[12px]", row.status === "failed" ? "text-red-500" : row.status === "done" ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400")}>{STATUS_TEXT[row.status]}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
