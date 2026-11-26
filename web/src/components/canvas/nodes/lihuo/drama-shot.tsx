import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Wand2, X } from "lucide-react";

import { ratioToSize } from "@/lib/drama/prompt";
import { frameGradient, lightOverlay } from "@/lib/drama/schema";
import { assetVersionSnapshot, assetsOfShot, buildShotImagePrompt, referenceKeysForShot } from "@/lib/studio/prompt";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { useStudioStore } from "@/stores/use-studio-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { StudioEpisode, StudioProject, StudioShot } from "@/types/studio";

export const LIHUO_DRAMA_SHOT_TYPE = "lihuo:drama-shot";

type Bound = { project: StudioProject | null; episode: StudioEpisode | null; shot: StudioShot | null };

/** 节点只存 projectId / episodeId / shotId；镜头始终读取 Studio 的唯一权威数据。旧 sequenceId 走迁移兼容。 */
export function resolveFromProjects(projects: StudioProject[], node: CanvasNodeData): Bound {
    const meta = node.metadata ?? {};
    const projectId = typeof meta.projectId === "string" ? meta.projectId : "";
    const sequenceId = typeof meta.sequenceId === "string" ? meta.sequenceId : "";
    const shotId = typeof meta.shotId === "string" ? meta.shotId : "";
    const project = projects.find((item) => item.id === projectId) ?? (sequenceId ? projects.find((item) => item.legacySequenceId === sequenceId || item.id === sequenceId) : null) ?? null;
    if (!project) return { project: null, episode: null, shot: null };
    const episodeId = typeof meta.episodeId === "string" ? meta.episodeId : "";
    let episode = project.episodes.find((item) => item.id === episodeId) ?? null;
    let shot = episode?.shots.find((item) => item.id === shotId) ?? null;
    if (!shot) {
        episode = project.episodes.find((item) => item.shots.some((candidate) => candidate.id === shotId)) ?? null;
        shot = episode?.shots.find((item) => item.id === shotId) ?? null;
    }
    return { project, episode: episode ?? project.episodes[0] ?? null, shot };
}

export function resolveShot(node: CanvasNodeData): Bound {
    return resolveFromProjects(useStudioStore.getState().projects, node);
}

/**
 * Workflow 生成首帧：直接使用 Studio 的提示词与参考资产，画布只负责模型调用。
 * 结果写入镜头候选版本，不覆盖正式版；正式版必须由用户在节点面板手动选择。
 */
export async function generateShotImage(ctx: CanvasNodeContext) {
    const { project, episode, shot } = resolveShot(ctx.node);
    if (!project || !episode || !shot) return;
    const meta = ctx.node.metadata ?? {};
    if (meta.status === "loading") return;
    const model = typeof meta.model === "string" ? meta.model : shot.imageModel || project.settings.imageModel;
    const ratio = shot.imageRatio || project.settings.imageRatio || "自动";
    const prompt = buildShotImagePrompt(project, episode, shot);
    ctx.updateMetadata({ status: "loading", errorDetails: undefined, prompt });
    try {
        const refs = await Promise.all(referenceKeysForShot(project, shot, episode).map((key) => resolveMediaUrl(key, key)));
        const result = await ctx.ai.generateImage(prompt, {
            model: model || undefined,
            size: ratioToSize(ratio),
            references: refs.filter(Boolean),
        });
        const dataUrl = result.images[0];
        if (!dataUrl) throw new Error("模型没有返回图片");
        const blob = await (await fetch(dataUrl)).blob();
        const file = await uploadMediaFile(blob, "studio-workflow");
        const version = useStudioStore.getState().recordShotVersion(project.id, episode.id, shot.id, "image", {
            storageKey: file.storageKey,
            model: model || undefined,
            prompt,
            params: { ratio },
            source: "workflow",
            assetVersionIds: assetVersionSnapshot(project, shot, episode),
        }, { makeOfficial: false, status: "succeeded" });
        ctx.updateMetadata({ status: "success", storageKey: file.storageKey, versionId: version?.id, mimeType: file.mimeType, bytes: file.bytes, errorDetails: undefined });
    } catch (error) {
        ctx.updateMetadata({ status: "error", errorDetails: error instanceof Error ? error.message : "画面生成失败" });
    }
}

export function DramaShotContent({ ctx }: { ctx: CanvasNodeContext }) {
    const projects = useStudioStore((state) => state.projects);
    const { project, episode, shot } = resolveFromProjects(projects, ctx.node);
    const meta = ctx.node.metadata ?? {};
    const nodeKey = typeof meta.storageKey === "string" ? meta.storageKey : "";
    const storageKey = nodeKey || shot?.imageRef || "";
    const official = shot?.imageRef ?? "";
    const [src, setSrc] = useState("");

    useEffect(() => {
        let alive = true;
        if (!storageKey) {
            setSrc("");
            return () => {
                alive = false;
            };
        }
        resolveMediaUrl(storageKey)
            .then((url) => {
                if (alive) setSrc(url);
            })
            .catch(() => {
                if (alive) setSrc("");
            });
        return () => {
            alive = false;
        };
    }, [storageKey]);

    const theme = ctx.theme;
    if (!project || !episode || !shot) {
        return (
            <div className="flex size-full items-center justify-center rounded-xl px-3 text-center text-[11px]" style={{ background: theme.node.fill, color: theme.node.placeholder }}>
                未绑定 Studio 镜头
            </div>
        );
    }

    const loading = meta.status === "loading";
    const failed = meta.status === "error";
    const candidate = Boolean(nodeKey && nodeKey !== official);
    return (
        <div
            data-canvas-no-zoom
            className="flex size-full flex-col overflow-hidden rounded-xl"
            style={{ background: theme.node.panel, border: `1px solid ${ctx.isSelected ? theme.node.activeStroke : theme.node.stroke}` }}
        >
            <div className="relative flex-1 overflow-hidden" style={{ background: frameGradient(shot.sceneName || shot.no) }}>
                {src ? <img src={src} alt={`镜 ${shot.no}`} draggable={false} className="size-full object-cover" /> : <div className="absolute inset-0" style={{ background: lightOverlay(shot.lighting === "left" || shot.lighting === "right" ? shot.lighting : "none") }} />}
                <span className="absolute left-2 top-1.5 rounded px-1 text-[10px] font-medium" style={{ color: "#fff", background: "rgba(0,0,0,.35)" }}>
                    镜 {shot.no}
                </span>
                {candidate ? <span className="absolute right-2 top-1.5 rounded px-1 text-[9px]" style={{ color: "#fff", background: "rgba(0,0,0,.45)" }}>候选</span> : null}
                {loading ? (
                    <div className="absolute inset-0 grid place-items-center" style={{ background: "rgba(0,0,0,.4)" }}>
                        <LoaderCircle className="size-5 animate-spin" style={{ color: "#fff" }} />
                    </div>
                ) : null}
                {failed ? (
                    <div className="absolute inset-x-0 bottom-0 truncate px-2 py-1 text-[10px]" style={{ background: "rgba(0,0,0,.55)", color: "#fff" }}>
                        {typeof meta.errorDetails === "string" ? meta.errorDetails : "生成失败"}
                    </div>
                ) : null}
            </div>
            <div className="shrink-0 px-2.5 py-2 text-[10px]" style={{ color: theme.node.muted }}>
                <div className="flex items-center gap-1.5">
                    <span style={{ color: theme.node.text }}>{shot.seconds}s</span>
                    <span>·</span>
                    <span>{shot.size}</span>
                    <span>·</span>
                    <span>{shot.movement}</span>
                </div>
                <div className="truncate" title={shot.line || shot.description}>
                    {shot.line || shot.description || "（未填画面）"}
                </div>
            </div>
        </div>
    );
}

export function DramaShotPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const projects = useStudioStore((state) => state.projects);
    const chooseShotVersion = useStudioStore((state) => state.chooseShotVersion);
    const { project, episode, shot } = resolveFromProjects(projects, ctx.node);
    const meta = ctx.node.metadata ?? {};
    const [model, setModel] = useState(typeof meta.model === "string" ? meta.model : "");
    const models = ctx.ai.listModels("image");
    const theme = ctx.theme;

    const prompt = useMemo(() => (project && episode && shot ? buildShotImagePrompt(project, episode, shot) : ""), [project, episode, shot]);
    const assets = useMemo(() => (project && shot ? assetsOfShot(project, shot) : []), [project, shot]);
    const loading = meta.status === "loading";

    if (!project || !episode || !shot) {
        return (
            <div className="flex items-center justify-between gap-3 p-4 text-xs" style={{ color: theme.node.muted }}>
                <span>这个节点没有绑定到存在的 Studio 镜头，请从项目锚点节点重新投影。</span>
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}>
                    <X className="size-3" />
                    关闭
                </button>
            </div>
        );
    }

    const official = shot.imageRef ?? "";
    const latest = shot.imageVersions.slice(0, 6);

    return (
        <div className="flex flex-col gap-3 p-4 text-xs" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">镜 {shot.no}</span>
                <span style={{ color: theme.node.faint }}>{shot.seconds}s · {shot.size} · {shot.movement}</span>
                <button type="button" onClick={onClose} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                    <X className="size-3" />
                    关闭
                </button>
            </div>

            <div>
                <div className="mb-1" style={{ color: theme.node.muted }}>生成提示词（与 Studio 同一份）</div>
                <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg p-2 leading-relaxed" style={{ background: theme.node.fill, color: theme.node.text }}>
                    {prompt}
                </div>
            </div>

            <div>
                <div className="mb-1" style={{ color: theme.node.muted }}>参考资产</div>
                {assets.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {assets.map((asset) => (
                            <span key={asset.id} className="rounded-md px-2 py-0.5" style={{ background: theme.node.fill, color: theme.node.muted }}>
                                {asset.name}
                                <span style={{ color: asset.officialRef ? theme.canvas.relationText : theme.node.faint }}>{asset.officialRef ? " · 有正式参考图" : " · 缺正式参考图"}</span>
                            </span>
                        ))}
                    </div>
                ) : (
                    <span style={{ color: theme.node.faint }}>这一镜没有挂参考资产</span>
                )}
            </div>

            <div className="flex items-center gap-2">
                <span style={{ color: theme.node.muted }}>图片模型</span>
                <select
                    value={model}
                    onChange={(event) => {
                        setModel(event.target.value);
                        ctx.updateMetadata({ model: event.target.value });
                    }}
                    className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
                    style={{ background: theme.node.fill, color: theme.node.text, border: `1px solid ${theme.node.stroke}` }}
                >
                    <option value="">跟随项目默认</option>
                    {models.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                </select>
            </div>

            <button
                type="button"
                disabled={loading}
                onClick={() => void generateShotImage(ctx)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{ background: theme.canvas.selectionStroke, color: "#fff", opacity: loading ? 0.6 : 1 }}
            >
                {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                {loading ? "生成中…" : "生成首帧候选"}
            </button>
            {typeof meta.errorDetails === "string" && meta.status === "error" ? <div style={{ color: theme.canvas.relationText }}>{meta.errorDetails}</div> : null}

            <div>
                <div className="mb-1" style={{ color: theme.node.muted }}>最近候选（点击设为正式首帧）</div>
                {latest.length ? (
                    <div className="flex flex-col gap-1.5">
                        {latest.map((version) => (
                            <div key={version.id} className="flex items-center gap-2 rounded-md px-2 py-1" style={{ background: theme.node.fill }}>
                                <span className="min-w-0 flex-1 truncate" style={{ color: version.storageKey === official ? theme.canvas.relationText : theme.node.muted }}>
                                    {version.source === "workflow" ? "画布" : version.source === "upload" ? "上传" : "Studio"} · {version.model || "未知模型"} · {new Date(version.createdAt).toLocaleString("zh-CN")}
                                </span>
                                {version.storageKey === official ? (
                                    <span className="shrink-0" style={{ color: theme.canvas.relationText }}>正式</span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            chooseShotVersion(project.id, episode.id, shot.id, "image", version.id);
                                            ctx.updateMetadata({ storageKey: version.storageKey, versionId: version.id, status: "success", errorDetails: undefined });
                                        }}
                                        className="shrink-0 rounded px-1.5 py-0.5"
                                        style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}
                                    >
                                        设为正式
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <span style={{ color: theme.node.faint }}>还没有候选图。生成后只进候选，正式版由你选择。</span>
                )}
            </div>
            <div style={{ color: theme.node.faint }}>
                画布生成不会自动覆盖正式首帧；正式版变更会标记依赖它的视频镜头，需人工确认。
            </div>
        </div>
    );
}
