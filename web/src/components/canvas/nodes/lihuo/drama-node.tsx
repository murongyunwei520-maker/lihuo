import { useMemo, useState } from "react";
import { Clapperboard, ExternalLink, LayoutGrid, X } from "lucide-react";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { useStudioStore } from "@/stores/use-studio-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { StudioEpisode, StudioProject } from "@/types/studio";

import { LIHUO_DRAMA_SHOT_TYPE } from "./drama-shot";

export const LIHUO_DRAMA_TYPE = "lihuo:drama";

// Workflow 里的项目锚点：一个节点绑定一个短剧项目的某一集，镜头卡引用同一份 Studio 数据。
// 不再读取旧 DramaSequence；旧节点只有 sequenceId 时，通过迁移记录的 legacySequenceId 对齐。

const PROJECT_COLUMNS = 4;
const PROJECT_COLUMN_WIDTH = 380;
const PROJECT_ROW_HEIGHT = 540;

function canvasProjectIdFromPath() {
    const matched = window.location.pathname.match(/^\/canvas\/([^/]+)/);
    return matched ? matched[1] : "";
}

function shotNodeId(shotId: string) {
    return `studio-shot-${shotId}`;
}

function studioPath(project: StudioProject, episode: StudioEpisode) {
    return `/drama?project=${encodeURIComponent(project.id)}&episode=${encodeURIComponent(episode.id)}&workspace=director`;
}

function resolveAnchor(projects: StudioProject[], metadata: Record<string, unknown> | undefined) {
    const projectId = typeof metadata?.projectId === "string" ? metadata.projectId : "";
    const sequenceId = typeof metadata?.sequenceId === "string" ? metadata.sequenceId : "";
    const project = projects.find((item) => item.id === projectId) ?? (sequenceId ? projects.find((item) => item.legacySequenceId === sequenceId || item.id === sequenceId) : null) ?? null;
    const episodeId = typeof metadata?.episodeId === "string" ? metadata.episodeId : "";
    const episode = project?.episodes.find((item) => item.id === episodeId) ?? project?.episodes[0] ?? null;
    return { project, episode };
}

export function LihuoDramaContent({ ctx }: { ctx: CanvasNodeContext }) {
    const projects = useStudioStore((state) => state.projects);
    const { project, episode } = resolveAnchor(projects, ctx.node.metadata);
    const theme = ctx.theme;
    const totalShots = project?.episodes.reduce((sum, item) => sum + item.shots.length, 0) ?? 0;

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
                <span className="truncate text-sm font-medium">{project?.title ?? "未绑定短剧项目"}</span>
            </div>
            {project ? (
                <>
                    <div className="text-[11px]" style={{ color: theme.node.muted }}>
                        第 {episode?.no ?? 1} 集 · {episode?.shots.length ?? 0} 镜 · {episode?.targetSeconds ?? 0}s
                    </div>
                    <div className="text-[11px]" style={{ color: theme.node.faint }}>
                        项目共 {project.episodes.length} 集 / {totalShots} 镜 · {project.assets.length} 资产
                    </div>
                    <div className="mt-auto truncate text-[10px]" style={{ color: theme.node.placeholder }}>
                        双击选择项目、分集并投影镜头
                    </div>
                </>
            ) : (
                <div className="text-[11px] leading-relaxed" style={{ color: theme.node.faint }}>
                    没有找到绑定的项目。双击节点选择项目，或从短剧工坊重新进入 Workflow。
                </div>
            )}
        </div>
    );
}

export function LihuoDramaPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const projects = useStudioStore((state) => state.projects);
    const { project: initialProject, episode: initialEpisode } = resolveAnchor(projects, ctx.node.metadata);
    const [projectId, setProjectId] = useState(initialProject?.id ?? projects[0]?.id ?? "");
    const [episodeId, setEpisodeId] = useState(initialEpisode?.id ?? initialProject?.episodes[0]?.id ?? "");
    const [note, setNote] = useState("");
    const theme = ctx.theme;

    const project = projects.find((item) => item.id === projectId) ?? projects[0] ?? null;
    const episode = project?.episodes.find((item) => item.id === episodeId) ?? project?.episodes[0] ?? null;

    const projected = useMemo(() => {
        if (!episode) return 0;
        const existing = new Set(ctx.getNodes().map((node) => node.metadata?.shotId).filter(Boolean));
        return episode.shots.filter((shot) => existing.has(shot.id)).length;
    }, [ctx, episode]);

    const bind = (nextProjectId: string, nextEpisodeId: string, message?: string) => {
        setProjectId(nextProjectId);
        setEpisodeId(nextEpisodeId);
        ctx.updateMetadata({ projectId: nextProjectId, episodeId: nextEpisodeId, sequenceId: undefined, status: "idle" });
        setNote(message ?? "");
    };

    const projectShots = () => {
        if (!project || !episode) return;
        const existing = new Set(ctx.getNodes().map((node) => node.id));
        const existingShotIds = new Set(ctx.getNodes().map((node) => node.metadata?.shotId).filter(Boolean));
        const originX = ctx.node.position.x + ctx.node.width + 80;
        const originY = ctx.node.position.y;
        const ops: CanvasAgentOp[] = [];
        episode.shots.forEach((shot, index) => {
            const id = shot.workflowNodeId && existing.has(shot.workflowNodeId) ? shot.workflowNodeId : shotNodeId(shot.id);
            if (!existingShotIds.has(shot.id) && !existing.has(id)) {
                ops.push({
                    type: "add_node",
                    id,
                    nodeType: LIHUO_DRAMA_SHOT_TYPE,
                    title: `镜 ${shot.no}`,
                    position: { x: originX + (index % PROJECT_COLUMNS) * PROJECT_COLUMN_WIDTH, y: originY + Math.floor(index / PROJECT_COLUMNS) * PROJECT_ROW_HEIGHT },
                    width: 340,
                    height: 480,
                    metadata: { projectId: project.id, episodeId: episode.id, shotId: shot.id, shotNo: shot.no, status: "idle" },
                });
            }
            ops.push({ type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: existingShotIds.has(shot.id) ? shot.workflowNodeId ?? id : id });
            useStudioStore.getState().updateShot(project.id, episode.id, shot.id, { workflowNodeId: id });
        });
        if (ops.length) ctx.applyOps(ops);
        const canvasId = canvasProjectIdFromPath();
        useStudioStore.getState().updateEpisode(project.id, episode.id, { workflowProjectId: canvasId || episode.workflowProjectId });
        ctx.updateMetadata({ projectId: project.id, episodeId: episode.id, status: "success" });
        setNote(ops.length ? `已投影 ${episode.shots.length} 镜；生成结果只进候选版本` : "这些镜头已经全部在画布上");
    };

    if (!projects.length) {
        return (
            <div className="flex items-center justify-between gap-3 p-4 text-xs" style={{ color: theme.node.muted }}>
                <span>还没有短剧项目。先去短剧工坊创建项目并拆镜。</span>
                <a href="/drama" className="inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}>
                    打开短剧工坊
                    <ExternalLink className="size-3" />
                </a>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 p-4 text-xs" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">短剧项目 · Workflow</span>
                {project && episode ? (
                    <a href={studioPath(project, episode)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                        回 Studio 编辑
                        <ExternalLink className="size-3" />
                    </a>
                ) : null}
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                    <X className="size-3" />
                    关闭
                </button>
            </div>

            <div className="flex items-center gap-2">
                <span style={{ color: theme.node.muted }}>项目</span>
                <select
                    value={project?.id ?? ""}
                    onChange={(event) => {
                        const next = projects.find((item) => item.id === event.target.value);
                        bind(next?.id ?? "", next?.episodes[0]?.id ?? "");
                    }}
                    className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
                    style={{ background: theme.node.fill, color: theme.node.text, border: `1px solid ${theme.node.stroke}` }}
                >
                    {projects.map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                    ))}
                </select>
            </div>

            <div className="flex items-center gap-2">
                <span style={{ color: theme.node.muted }}>分集</span>
                <select
                    value={episode?.id ?? ""}
                    onChange={(event) => bind(project?.id ?? "", event.target.value)}
                    className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
                    style={{ background: theme.node.fill, color: theme.node.text, border: `1px solid ${theme.node.stroke}` }}
                >
                    {project?.episodes.map((item) => (
                        <option key={item.id} value={item.id}>第 {item.no} 集 · {item.title}</option>
                    ))}
                </select>
            </div>

            <div style={{ color: theme.node.muted }}>
                {episode?.shots.length ?? 0} 镜 · 合计 {episode?.shots.reduce((sum, shot) => sum + shot.seconds, 0) ?? 0}s / 目标 {episode?.targetSeconds ?? 0}s · 已投影 {projected} 镜
            </div>

            <div className="max-h-56 overflow-auto rounded-lg" style={{ border: `1px solid ${theme.node.stroke}` }}>
                {episode?.shots.length ? (
                    episode.shots.map((shot) => (
                        <div key={shot.id} className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderTop: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                            <span className="w-10 shrink-0" style={{ color: theme.node.text }}>镜 {shot.no}</span>
                            <span className="w-10 shrink-0">{shot.seconds}s</span>
                            <span className="w-12 shrink-0">{shot.size}</span>
                            <span className="truncate">{shot.line || shot.description || shot.sceneName || "—"}</span>
                        </div>
                    ))
                ) : (
                    <div className="px-2.5 py-2" style={{ color: theme.node.faint }}>这一集还没有镜头，先去导演中心拆镜。</div>
                )}
            </div>

            <button
                type="button"
                onClick={projectShots}
                disabled={!project || !episode || !episode.shots.length}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{ background: theme.canvas.selectionStroke, color: "#fff", opacity: !project || !episode?.shots.length ? 0.55 : 1 }}
            >
                <LayoutGrid className="size-3.5" />
                投影到画布（{episode?.shots.length ?? 0} 镜）
            </button>
            {note ? <div style={{ color: theme.canvas.relationText }}>{note}</div> : null}
            <div style={{ color: theme.node.faint }}>
                镜头卡与 Studio 共用同一份镜头数据。画布里生成的图只进候选版本，需在镜头卡面板手动设为正式首帧。
            </div>
        </div>
    );
}
