import { useEffect, useRef, useState } from "react";

import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeResource } from "@/types/canvas-plugin";

export const LIHUO_NOTE_TYPE = "lihuo:note";

// 便签配色：暖色为主，在浅色纸面和深色画布上都能拉开层次。
export const LIHUO_NOTE_COLORS = ["#fde68a", "#fbcfe8", "#ddd6fe", "#bfdbfe", "#a7f3d0", "#fca5a5"] as const;
export const LIHUO_NOTE_DEFAULT_COLOR: string = LIHUO_NOTE_COLORS[0];

// 读取便签颜色，未设置或数据异常时回落到默认色。
export function readNoteColor(node: CanvasNodeData) {
    const color = node.metadata?.noteColor;
    return typeof color === "string" && color ? color : LIHUO_NOTE_DEFAULT_COLOR;
}

// 工具栏换色：按预设顺序循环。
export function nextNoteColor(node: CanvasNodeData) {
    const index = (LIHUO_NOTE_COLORS as readonly string[]).indexOf(readNoteColor(node));
    return LIHUO_NOTE_COLORS[(index + 1) % LIHUO_NOTE_COLORS.length];
}

// 便签内容可以作为文本资源被下游节点引用。
export function noteResource(node: CanvasNodeData): CanvasNodeResource | null {
    const text = node.metadata?.content;
    return text ? { kind: "text", text } : null;
}

export function LihuoNoteContent({ ctx }: { ctx: CanvasNodeContext }) {
    const [editing, setEditing] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const content = ctx.node.metadata?.content || "";
    const color = readNoteColor(ctx.node);

    // 点击便签外部时退出编辑并收起调色板。
    // 必须用 pointerdown 的 capture 阶段：宿主在 pointerdown 上 preventDefault，普通 mousedown 不会触发。
    useEffect(() => {
        if (!editing && !paletteOpen) return;
        const handleDocumentPointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setEditing(false);
                setPaletteOpen(false);
            }
        };
        document.addEventListener("pointerdown", handleDocumentPointerDown, true);
        return () => document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    }, [editing, paletteOpen]);

    // 交互控件上按下时阻止冒泡，避免误触发节点拖动。
    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

    return (
        <div
            ref={rootRef}
            data-canvas-no-zoom
            className="relative flex size-full flex-col rounded-2xl p-3.5"
            style={{ background: color, cursor: editing ? "text" : "move", boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.45)" }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                setEditing(true);
            }}
        >
            <div className="absolute right-2 top-2 z-[5]" onMouseDown={stop} onDoubleClick={stop}>
                <button type="button" title="便签颜色" aria-label="便签颜色" onClick={() => setPaletteOpen((open) => !open)} className="size-5 cursor-pointer rounded-full border-2 border-black/20" style={{ background: color }} />
                {paletteOpen ? (
                    <div className="absolute right-0 top-7 grid grid-cols-3 gap-1.5 rounded-xl bg-white p-2 shadow-xl">
                        {LIHUO_NOTE_COLORS.map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                title={preset}
                                aria-label={preset}
                                onClick={() => {
                                    ctx.updateMetadata({ noteColor: preset });
                                    setPaletteOpen(false);
                                }}
                                className={`size-5 cursor-pointer rounded-full ${preset === color ? "border-2 border-stone-900" : "border-2 border-black/10"}`}
                                style={{ background: preset }}
                            />
                        ))}
                    </div>
                ) : null}
            </div>

            {editing ? (
                <textarea
                    autoFocus
                    value={content}
                    placeholder="双击输入朱笺内容…（Esc 或点击别处退出）"
                    onChange={(event) => ctx.updateMetadata({ content: event.target.value })}
                    onBlur={() => setEditing(false)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.stopPropagation();
                            setEditing(false);
                        }
                    }}
                    onMouseDown={stop}
                    onPointerDown={stop}
                    onWheel={stop}
                    className="flex-1 resize-none border-0 bg-transparent text-[15px] leading-relaxed text-stone-900 outline-none"
                />
            ) : (
                <div className="flex-1 overflow-hidden whitespace-pre-wrap pr-5 text-[15px] leading-relaxed" style={{ color: content ? "#1c1917" : "rgba(28, 25, 23, 0.42)", userSelect: "none" }}>
                    {content || "双击输入朱笺内容"}
                </div>
            )}
        </div>
    );
}
