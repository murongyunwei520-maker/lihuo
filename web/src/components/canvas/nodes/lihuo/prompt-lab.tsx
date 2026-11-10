import { useState } from "react";
import { Button, Input, Segmented } from "antd";
import { Copy, Loader2, Plus, Sparkles, Wand2, X } from "lucide-react";

import { useCopyText } from "@/hooks/use-copy-text";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeResource } from "@/types/canvas-plugin";

export const LIHUO_PROMPT_TYPE = "lihuo:prompt";

type PromptMode = "image" | "text" | "video";

// 不同目标产物给模型不同的改写要求，提示词工坊只做这一件事。
const MODE_SYSTEM: Record<PromptMode, string> = {
    image: "你是资深 AI 绘图提示词工程师。把用户的想法改写成一段可直接用于文生图模型的中文提示词：只描述画面主体、构图、光线、材质、风格和镜头，不要解释、不要分点、不要加前后缀，控制在 120 字以内。",
    text: "你是资深提示词工程师。把用户的想法改写成一段结构清晰、可直接喂给大模型的中文提示词：先给目标，再给约束与输出格式，不要解释改写的理由，控制在 160 字以内。",
    video: "你是资深 AI 视频提示词工程师。把用户的想法改写成一段可直接用于文生视频模型的中文提示词：描述主体动作、镜头运动、节奏、光线和风格，不要解释、不要分点，控制在 120 字以内。",
};

const MODE_OPTIONS = [
    { label: "画面", value: "image" },
    { label: "文本", value: "text" },
    { label: "视频", value: "video" },
];

export function promptResource(node: CanvasNodeData): CanvasNodeResource | null {
    const text = node.metadata?.content;
    return text ? { kind: "text", text } : null;
}

function readPromptMode(node: CanvasNodeData): PromptMode {
    const mode = node.metadata?.promptMode;
    return mode === "text" || mode === "video" ? mode : "image";
}

// 节点卡片上的预览：只负责展示当前提示词，编辑入口在下方工坊面板。
export function PromptLabContent({ ctx }: { ctx: CanvasNodeContext }) {
    const content = ctx.node.metadata?.content || "";

    return (
        <div data-canvas-no-zoom className="flex size-full flex-col p-3.5" style={{ color: ctx.theme.node.text }}>
            {content ? (
                <div className="thin-scrollbar flex-1 overflow-y-auto whitespace-pre-wrap text-[13px] leading-6" style={{ userSelect: "none" }}>
                    {content}
                </div>
            ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center" style={{ color: ctx.theme.node.placeholder }}>
                    <Sparkles className="size-5" />
                    <span className="text-xs leading-5">点击节点打开提示词工坊</span>
                </div>
            )}
        </div>
    );
}

export function PromptLabPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const theme = ctx.theme;
    const copyText = useCopyText();
    const [draft, setDraft] = useState(ctx.node.metadata?.prompt || "");
    const [mode, setMode] = useState<PromptMode>(readPromptMode(ctx.node));
    const [result, setResult] = useState(ctx.node.metadata?.content || "");
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");

    // 点击画布时不要拖动节点或缩放画布。
    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

    // 调用宿主注入的 AI 能力；流式结果只落在面板本地 state，避免每个 token 都写回画布 store。
    const optimize = async () => {
        const idea = draft.trim();
        if (!idea || running) return;
        setRunning(true);
        setError("");
        setResult("");
        try {
            const { text } = await ctx.ai.generateText(idea, { system: MODE_SYSTEM[mode], onDelta: setResult });
            setResult(text);
            ctx.updateMetadata({ content: text, prompt: idea, promptMode: mode });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setRunning(false);
        }
    };

    // 把当前结果写回本节点，作为下游可以引用的文本资源。
    const saveToNode = () => {
        if (!result.trim()) return;
        ctx.updateMetadata({ content: result, prompt: draft, promptMode: mode });
    };

    // 另起一个文本节点，保留工坊结果，方便继续编排。
    const insertNode = () => {
        if (!result.trim()) return;
        ctx.applyOps([
            {
                type: "add_node",
                nodeType: "text",
                title: "提示词",
                position: { x: ctx.node.position.x + ctx.node.width + 48, y: ctx.node.position.y },
                metadata: { content: result },
            },
        ]);
    };

    return (
        <div data-canvas-no-zoom className="rounded-2xl border p-3 shadow-2xl backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onMouseDown={stop} onPointerDown={stop} onWheel={stop}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2">
                    <div className="shrink-0 text-xs font-semibold">提示词工坊</div>
                    <div className="truncate text-[11px] opacity-55">写一句想法，交给 AI 改写成可直接使用的提示词</div>
                </div>
                <Button size="small" type="text" className="!h-7 !w-7 !min-w-7 !p-0" icon={<X className="size-3.5" />} onClick={onClose} />
            </div>

            <div className="mb-2 flex items-center gap-2">
                <Segmented size="small" options={MODE_OPTIONS} value={mode} onChange={(value) => setMode(value as PromptMode)} />
                <span className="text-[11px] opacity-55">目标产物</span>
            </div>

            <Input.TextArea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="例如：赛博朋克雨夜的老街，霓虹灯牌倒映在积水里，中景，35mm" autoSize={{ minRows: 2, maxRows: 5 }} className="text-sm" />

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="primary" size="small" icon={running ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} disabled={running || !draft.trim()} onClick={optimize}>
                    {running ? "改写中" : "AI 改写"}
                </Button>
                <Button size="small" disabled={!result.trim() || running} onClick={saveToNode}>
                    写回节点
                </Button>
                <Button size="small" icon={<Plus className="size-3.5" />} disabled={!result.trim()} onClick={insertNode}>
                    插入画布
                </Button>
                <Button size="small" type="text" icon={<Copy className="size-3.5" />} disabled={!result.trim()} onClick={() => copyText(result, "提示词已复制")}>
                    复制
                </Button>
            </div>

            {result.trim() ? (
                <div className="thin-scrollbar mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-xl border px-3 py-2 text-[13px] leading-6" style={{ borderColor: theme.toolbar.border, background: theme.node.panel }}>
                    {result}
                </div>
            ) : null}

            {error ? <div className="mt-2 text-xs text-red-500">{error}</div> : null}
        </div>
    );
}
