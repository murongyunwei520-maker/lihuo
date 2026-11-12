import { CanvasInspectorPanel } from "./canvas-inspector-panel";
import type { CanvasNodeData } from "@/types/canvas";

/**
 * 画布右侧停靠区：只放「属性·日志」。
 * 豆包和 Dola 的账号统一放在左侧账号池（按站点分组 + 颜色区分），右侧不再重复一份。
 */
export function CanvasSideDock({ nodes, selectedNodeIds }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string> }) {
    return (
        <div className="flex min-h-0 shrink-0 flex-col">
            <CanvasInspectorPanel nodes={nodes} selectedNodeIds={selectedNodeIds} />
        </div>
    );
}
