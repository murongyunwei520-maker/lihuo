import { useMemo, useState } from "react";
import { Clapperboard, ExternalLink, LayoutGrid, X } from "lucide-react";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { sequenceSummary } from "@/lib/drama/prompt";
import { useDramaStore } from "@/stores/use-drama-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

import { LIHUO_DRAMA_SHOT_TYPE } from "./drama-shot";

export const LIHUO_DRAMA_TYPE = "lihuo:drama";

// 投影排布：每行 4 镜，行距要放得下 200x300 的镜头卡。
const PROJECT_COLUMNS = 4;
const PROJECT_COLUMN_WIDTH = 224;
const PROJECT_ROW_HEIGHT = 330;

/** 镜头卡节点 id 由镜头 id 推导，重复投影时用它做幂等判断。 */
function shotNodeId(shotId: string) {
    return `drama-shot-${shotId}`;
}

/** 从 /canvas/:id 取当前项目 id；取不到就保留序列里已有的值。 */
function projectIdFromPath() {
    const matched = window.location.pathname.match(/^\/canvas\/([^/]+)/);
    return matched ? matched[1] : "";
}

export function LihuoDramaContent({ ctx }: { ctx: CanvasNodeContext }) {
    const sequences = useDramaStore((state) => state.sequences);
    const meta = ctx.node.metadata ?? {};
    const sequenceId = typeof meta.sequenceId === "string" && meta.sequenceId ? meta.sequenceId : sequences[0]?.id ?? "";
    const sequence = sequences.find((item) => item.id === sequenceId) ?? null;
    const summary = sequence ? sequenceSummary(sequence) : null;
    const theme = ctx.theme;

    return (
        <div
            data-canvas-no-zoom
            onDoubleClick={(event) => {
                event.stopPropagation();
                ctx.openPanel();
            }}
            className="flex size-full flex-col gap-2 overflow-hidden rounded-xl p-3.5"
            style={{ background: theme.node.panel, border: `1px solid ${ctx.isSelected ? theme.node.activeStroke : theme.node.stroke}`, color: theme.node.text }}
        >
            <div className="flex items-center gap-2">
                <Clapperboard className="size-4 shrink-0" style={{ color: theme.canvas.selectionStroke }} />
                <span className="truncate text-sm font-medium">{sequence?.title ?? "未选择序列"}</span>
            </div>
            {summary ? (
                <>
                    <div className="text-[11px]" style={{ color: theme.node.muted }}>
                        {summary.shots} 镜 · {summary.seconds}s / 目标 {summary.target}s · {summary.assets} 资产
                    </div>
                    <div className="text-[11px]" style={{ color: theme.node.faint }}>
                        全剧 {summary.episodes} 集 · 双击展开面板
                    </div>
                </>
            ) : (
                <div className="text-[11px] leading-relaxed" style={{ color: theme.node.faint }}>
                    还没有短剧序列。先去「短剧工作室」写剧本、拆一集，再回到这里投影。
                </div>
            )}
        </div>
    );
}

export function LihuoDramaPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const sequences = useDramaStore((state) => state.sequences);
    const meta = ctx.node.metadata ?? {};
    const initialId = typeof meta.sequenceId === "string" && meta.sequenceId ? meta.sequenceId : sequences[0]?.id ?? "";
    const [sequenceId, setSequenceId] = useState(initialId);
    const [note, setNote] = useState("");
    const sequence = sequences.find((item) => item.id === sequenceId) ?? null;
    const theme = ctx.theme;

    // 已投影的镜头数：只读节点图，用来决定按钮文案与提示，不写任何状态。
    const projected = useMemo(() => {
        if (!sequence) return 0;
        const existing = new Set(ctx.getNodes().map((node) => node.id));
        return sequence.shots.filter((shot) => existing.has(shotNodeId(shot.id))).length;
    }, [ctx, sequence]);

    const project = () => {
        if (!sequence) return;
        const existing = new Set(ctx.getNodes().map((node) => node.id));
        const originX = ctx.node.position.x + ctx.node.width + 80;
        const originY = ctx.node.position.y;
        const ops: CanvasAgentOp[] = [];
        sequence.shots.forEach((shot, index) => {
            const id = shotNodeId(shot.id);
            if (!existing.has(id)) {
                ops.push({
                    type: "add_node",
                    id,
                    nodeType: LIHUO_DRAMA_SHOT_TYPE,
                    title: `镜 ${shot.no}`,
                    position: { x: originX + (index % PROJECT_COLUMNS) * PROJECT_COLUMN_WIDTH, y: originY + Math.floor(index / PROJECT_COLUMNS) * PROJECT_ROW_HEIGHT },
                    width: 200,
                    height: 300,
                    metadata: { sequenceId: sequence.id, shotId: shot.id, status: "idle" },
                });
            }
            ops.push({ type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id });
        });
        if (ops.length) ctx.applyOps(ops);
        ctx.updateMetadata({ sequenceId: sequence.id });
        // 把镜头与画布节点、画布项目关联写回同一份序列，刷新后还能对上。
        useDramaStore.getState().updateSequence(sequence.id, {
            projectId: sequence.projectId || projectIdFromPath(),
            shots: sequence.shots.map((shot) => ({ ...shot, nodeId: shotNodeId(shot.id) })),
        });
        setNote(ops.length ? `已投影 ${sequence.shots.length} 镜到画布` : "这些镜头已经在画布上了，没有重复创建");
    };

    if (!sequence) {
        return (
            <div className="flex items-center justify-between gap-3 p-4 text-xs" style={{ color: theme.node.muted }}>
                <span>还没有短剧序列。先去「短剧工作室」建一集，再回来投影。</span>
                <a href="/drama" className="inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}>
                    打开短剧工作室
                    <ExternalLink className="size-3" />
                </a>
            </div>
        );
    }

    const summary = sequenceSummary(sequence);
    return (
        <div className="flex flex-col gap-3 p-4 text-xs" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">短剧工作室</span>
                <a href="/drama" className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                    在页面中编辑
                    <ExternalLink className="size-3" />
                </a>
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                    <X className="size-3" />
                    关闭
                </button>
            </div>

            <div className="flex items-center gap-2">
                <span style={{ color: theme.node.muted }}>序列</span>
                <select
                    value={sequenceId}
                    onChange={(event) => {
                        setSequenceId(event.target.value);
                        setNote("");
                    }}
                    className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
                    style={{ background: theme.node.fill, color: theme.node.text, border: `1px solid ${theme.node.stroke}` }}
                >
                    {sequences.map((item) => (
                        <option key={item.id} value={item.id}>
                            {item.title}
                        </option>
                    ))}
                </select>
            </div>

            <div style={{ color: theme.node.muted }}>
                {summary.shots} 镜 · 合计 {summary.seconds}s / 目标 {summary.target}s · {summary.assets} 资产 · 已投影 {projected} 镜
            </div>

            <div className="max-h-56 overflow-auto rounded-lg" style={{ border: `1px solid ${theme.node.stroke}` }}>
                {sequence.shots.length ? (
                    sequence.shots.map((shot) => (
                        <div key={shot.id} className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderTop: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                            <span className="w-10 shrink-0" style={{ color: theme.node.text }}>
                                镜 {shot.no}
                            </span>
                            <span className="w-10 shrink-0">{shot.seconds}s</span>
                            <span className="w-12 shrink-0">{shot.size}</span>
                            <span className="truncate">{shot.line || shot.prompt || shot.scene || "—"}</span>
                        </div>
                    ))
                ) : (
                    <div className="px-2.5 py-2" style={{ color: theme.node.faint }}>
                        这一集还没有镜头，先去页面里拆镜。
                    </div>
                )}
            </div>

            <button
                type="button"
                onClick={project}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{ background: theme.canvas.selectionStroke, color: "#fff" }}
            >
                <LayoutGrid className="size-3.5" />
                投影到画布（{sequence.shots.length} 镜）
            </button>
            {note ? <div style={{ color: theme.canvas.relationText }}>{note}</div> : null}
            <div style={{ color: theme.node.faint }}>
                镜头卡只引用同一份序列数据；改名、改时长、改光位后，画布上的卡会跟着变。
            </div>
        </div>
    );
}
