import { useMemo, useState } from "react";
import { Button, Modal } from "antd";
import { ImagePlus, Link2 } from "lucide-react";

import { previewUrlFor } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";

type Props = {
    nodes: CanvasNodeData[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
};

/**
 * 参考图选择器：直接从画布里的图片节点勾选，不依赖拖线（拖线仍然有效）。
 * 解决「连线了但面板读不到」的问题——勾选结果存进节点 metadata，提交时一并上传。
 */
export function DoubaoImageRefPicker({ nodes, selectedIds, onChange }: Props) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<string[]>(selectedIds);

    const images = useMemo(() => nodes.filter((node) => node.type === "image" && (node.metadata?.content || node.metadata?.storageKey)), [nodes]);

    return (
        <>
            <Button size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => {
                setDraft(selectedIds);
                setOpen(true);
            }}>
                从画布选图（{selectedIds.length}）
            </Button>
            <Modal
                open={open}
                title="选择参考图片"
                width={640}
                okText={`使用选中的 ${draft.length} 张`}
                onCancel={() => setOpen(false)}
                onOk={() => {
                    onChange(draft);
                    setOpen(false);
                }}
            >
                {images.length === 0 ? (
                    <p className="py-8 text-center text-[12px] opacity-60">画布里还没有带内容的图片节点</p>
                ) : (
                    <div className="grid max-h-[420px] grid-cols-4 gap-2 overflow-y-auto">
                        {images.map((node) => {
                            const active = draft.includes(node.id);
                            const thumb = previewUrlFor(node.metadata?.storageKey) || String(node.metadata?.content || "");
                            return (
                                <button
                                    key={node.id}
                                    type="button"
                                    onClick={() => setDraft((prev) => (prev.includes(node.id) ? prev.filter((id) => id !== node.id) : [...prev, node.id]))}
                                    className={`cursor-pointer overflow-hidden rounded-lg border text-left transition ${active ? "border-[#6b57a8] ring-1 ring-[#6b57a8]/50" : "border-black/10 hover:border-[#6b57a8]/40 dark:border-white/12"}`}
                                >
                                    <div className="aspect-square bg-black/5 dark:bg-white/5">
                                        {thumb ? <img src={thumb} alt={node.title || "图片"} className="size-full object-cover" /> : null}
                                    </div>
                                    <div className="truncate px-1.5 py-1 text-[10px] opacity-70">{node.title || "图片"}</div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </Modal>
        </>
    );
}

/** 面板里展示「连线素材 + 手动勾选素材」的合计，便于自检。 */
export function RefSummary({ linked, manual }: { linked: number; manual: number }) {
    return (
        <span className="inline-flex items-center gap-1 text-[11px] opacity-70">
            <Link2 className="size-3" />
            连线 {linked} · 勾选 {manual}
        </span>
    );
}
