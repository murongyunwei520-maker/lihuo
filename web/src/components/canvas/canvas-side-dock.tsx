import { PanelRightOpen } from "lucide-react";

import { useCanvasLayoutStore } from "@/stores/use-canvas-layout-store";
import { CanvasInspectorPanel } from "./canvas-inspector-panel";
import type { CanvasNodeData } from "@/types/canvas";

/**
 * 画布右侧停靠区：只放「属性·日志」。
 * 豆包和 Dola 的账号统一放在左侧账号池（按站点分组 + 颜色区分），右侧不再重复一份。
 * 收起时不占布局宽度，只在画布右缘留一个悬浮展开按钮。
 */
export function CanvasSideDock({ nodes, selectedNodeIds }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string> }) {
    const open = useCanvasLayoutStore((state) => state.inspectorOpen);
    const setOpen = useCanvasLayoutStore((state) => state.setInspectorOpen);
    if (!open) {
        return (
            <button
                type="button"
                data-canvas-no-zoom
                onClick={() => setOpen(true)}
                className="absolute right-2 top-1/2 z-[90] grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-black/10 bg-white/85 text-slate-500 shadow-lg backdrop-blur transition hover:bg-white dark:border-white/15 dark:bg-[#1b1b1f]/85 dark:text-white/60 dark:hover:bg-[#24242a]"
                title="展开属性与日志"
            >
                <PanelRightOpen className="size-4" />
            </button>
        );
    }
    return (
        <div className="flex min-h-0 shrink-0 flex-col">
            <CanvasInspectorPanel nodes={nodes} selectedNodeIds={selectedNodeIds} />
        </div>
    );
}
