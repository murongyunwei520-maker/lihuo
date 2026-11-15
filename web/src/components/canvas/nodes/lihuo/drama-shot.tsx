import { useEffect, useState } from "react";
import { LoaderCircle, Wand2, X } from "lucide-react";

import { assetsOfShot, ratioToSize, shotPrompt, shotReferences } from "@/lib/drama/prompt";
import { frameGradient, lightOverlay } from "@/lib/drama/schema";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { useDramaStore } from "@/stores/use-drama-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { DramaSequence, DramaShot } from "@/types/drama";

export const LIHUO_DRAMA_SHOT_TYPE = "lihuo:drama-shot";

/** 节点只存 sequenceId / shotId，镜头数据始终来自同一份短剧 store。 */
export function resolveShot(node: CanvasNodeData): { sequence: DramaSequence | null; shot: DramaShot | null } {
    const meta = node.metadata ?? {};
    const sequenceId = typeof meta.sequenceId === "string" ? meta.sequenceId : "";
    const shotId = typeof meta.shotId === "string" ? meta.shotId : "";
    const sequence = useDramaStore.getState().sequences.find((item) => item.id === sequenceId) ?? null;
    return { sequence, shot: sequence?.shots.find((item) => item.id === shotId) ?? null };
}

/**
 * 生成这一镜的画面：走宿主 ai.generateImage（模型与凭证由画布统一处理），
 * 返回的 data URL 先落本地素材库，metadata 只存 storageKey，避免项目 JSON 被 base64 撑大。
 */
export async function generateShotImage(ctx: CanvasNodeContext) {
    const { sequence, shot } = resolveShot(ctx.node);
    if (!sequence || !shot) return;
    const meta = ctx.node.metadata ?? {};
    if (meta.status === "loading") return;
    const model = typeof meta.model === "string" ? meta.model : "";
    const prompt = shotPrompt(sequence, shot);
    ctx.updateMetadata({ status: "loading", errorDetails: undefined, prompt });
    try {
        const refs = await Promise.all(shotReferences(sequence, shot).map((ref) => resolveMediaUrl(ref, ref)));
        const result = await ctx.ai.generateImage(prompt, {
            model: model || undefined,
            size: ratioToSize(sequence.settings?.ratio ?? "自动"),
            references: refs.filter(Boolean),
        });
        const dataUrl = result.images[0];
        if (!dataUrl) throw new Error("模型没有返回图片");
        const blob = await (await fetch(dataUrl)).blob();
        const file = await uploadMediaFile(blob, "drama-shot");
        ctx.updateMetadata({ status: "success", storageKey: file.storageKey, mimeType: file.mimeType, bytes: file.bytes, errorDetails: undefined });
        // 同时写回镜头本身，页面上也能看到画布生成的这张图。
        const latest = useDramaStore.getState().sequences.find((item) => item.id === sequence.id);
        if (latest) {
            useDramaStore.getState().updateSequence(sequence.id, {
                shots: latest.shots.map((item) => (item.id === shot.id ? { ...item, imageRef: file.storageKey, status: "done" } : item)),
            });
        }
    } catch (error) {
        ctx.updateMetadata({ status: "error", errorDetails: error instanceof Error ? error.message : "画面生成失败" });
    }
}

export function DramaShotContent({ ctx }: { ctx: CanvasNodeContext }) {
    const sequences = useDramaStore((state) => state.sequences);
    const meta = ctx.node.metadata ?? {};
    const sequenceId = typeof meta.sequenceId === "string" ? meta.sequenceId : "";
    const shotId = typeof meta.shotId === "string" ? meta.shotId : "";
    const sequence = sequences.find((item) => item.id === sequenceId) ?? null;
    const shot = sequence?.shots.find((item) => item.id === shotId) ?? null;
    // 节点自己的产物优先；节点还没生成时，用页面上逐镜出图写回的 shot.imageRef，两处共用同一张图。
    const nodeKey = typeof meta.storageKey === "string" ? meta.storageKey : "";
    const storageKey = nodeKey || shot?.imageRef || "";
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
    if (!sequence || !shot) {
        return (
            <div className="flex size-full items-center justify-center rounded-xl px-3 text-center text-[11px]" style={{ background: theme.node.fill, color: theme.node.placeholder }}>
                未绑定镜头
            </div>
        );
    }

    const loading = meta.status === "loading";
    const failed = meta.status === "error";
    return (
        <div
            data-canvas-no-zoom
            className="flex size-full flex-col overflow-hidden rounded-xl"
            style={{ background: theme.node.panel, border: `1px solid ${ctx.isSelected ? theme.node.activeStroke : theme.node.stroke}` }}
        >
            <div className="relative flex-1 overflow-hidden" style={{ background: frameGradient(shot.scene || shot.no) }}>
                {src ? <img src={src} alt={`镜 ${shot.no}`} draggable={false} className="size-full object-cover" /> : <div className="absolute inset-0" style={{ background: lightOverlay(shot.light) }} />}
                <span className="absolute left-2 top-1.5 rounded px-1 text-[10px] font-medium" style={{ color: "#fff", background: "rgba(0,0,0,.35)" }}>
                    镜 {shot.no}
                </span>
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
                    <span>{shot.move}</span>
                </div>
                <div className="truncate" title={shot.line || shot.prompt}>
                    {shot.line || shot.prompt || "（无台词）"}
                </div>
            </div>
        </div>
    );
}

export function DramaShotPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const sequences = useDramaStore((state) => state.sequences);
    const meta = ctx.node.metadata ?? {};
    const sequenceId = typeof meta.sequenceId === "string" ? meta.sequenceId : "";
    const shotId = typeof meta.shotId === "string" ? meta.shotId : "";
    const sequence = sequences.find((item) => item.id === sequenceId) ?? null;
    const shot = sequence?.shots.find((item) => item.id === shotId) ?? null;
    const [model, setModel] = useState(typeof meta.model === "string" ? meta.model : "");
    const models = ctx.ai.listModels("image");
    const theme = ctx.theme;

    if (!sequence || !shot) {
        return (
            <div className="flex items-center justify-between gap-3 p-4 text-xs" style={{ color: theme.node.muted }}>
                <span>这个节点还没有绑定镜头，请从「短剧工作室」节点重新投影。</span>
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}>
                    <X className="size-3" />
                    关闭
                </button>
            </div>
        );
    }

    const prompt = shotPrompt(sequence, shot);
    const assets = assetsOfShot(sequence, shot);
    const loading = meta.status === "loading";

    return (
        <div className="flex flex-col gap-3 p-4 text-xs" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">镜 {shot.no}</span>
                <span style={{ color: theme.node.faint }}>
                    {shot.seconds}s · {shot.size} · {shot.move}
                </span>
                <button type="button" onClick={onClose} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                    <X className="size-3" />
                    关闭
                </button>
            </div>

            <div>
                <div className="mb-1" style={{ color: theme.node.muted }}>
                    生成提示词
                </div>
                <div className="whitespace-pre-wrap rounded-lg p-2 leading-relaxed" style={{ background: theme.node.fill, color: theme.node.text }}>
                    {prompt}
                </div>
            </div>

            <div>
                <div className="mb-1" style={{ color: theme.node.muted }}>
                    参考资产
                </div>
                {assets.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {assets.map((asset) => (
                            <span key={asset.id} className="rounded-md px-2 py-0.5" style={{ background: theme.node.fill, color: theme.node.muted }}>
                                {asset.name}
                                <span style={{ color: asset.refs.length ? theme.canvas.relationText : theme.node.faint }}>{asset.refs.length ? " · 有参考图" : " · 未生成"}</span>
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
                    <option value="">跟随画布默认</option>
                    {models.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
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
                {loading ? "生成中…" : "生成画面"}
            </button>
            {typeof meta.errorDetails === "string" && meta.status === "error" ? <div style={{ color: theme.canvas.relationText }}>{meta.errorDetails}</div> : null}
        </div>
    );
}
