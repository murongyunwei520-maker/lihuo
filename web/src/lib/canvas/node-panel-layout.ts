// 节点配置卡片的定位算法（纯函数，便于针对四个屏幕边缘和小屏做单测）。
// 输入全部使用屏幕坐标：卡片通过 portal 渲染到 body，不再受画布缩放 transform 影响。
export type RectLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
};

export type NodePanelPlacement = "below" | "above";

export type NodePanelLayout = {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    placement: NodePanelPlacement;
};

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
}

export function computeNodePanelLayout(input: {
    node: RectLike;
    viewport: RectLike;
    panelHeight: number;
    preferredWidth?: number;
    gap?: number;
    margin?: number;
    /** 视口顶部要避开的区域高度（顶栏） */
    topInset?: number;
    /** 视口底部要避开的区域高度（底部工具栏） */
    bottomInset?: number;
}): NodePanelLayout {
    const gap = Math.max(0, input.gap ?? 12);
    const margin = Math.max(0, input.margin ?? 12);
    const topBound = input.viewport.top + Math.max(0, input.topInset ?? 0);
    const bottomBound = input.viewport.bottom - Math.max(0, input.bottomInset ?? 0);
    const leftBound = input.viewport.left + margin;
    const rightBound = input.viewport.right - margin;
    const availableWidth = Math.max(0, rightBound - leftBound);
    const availableHeight = Math.max(1, bottomBound - topBound);

    const width = Math.min(input.preferredWidth ?? 600, availableWidth);
    const left = clamp(input.node.left + input.node.width / 2 - width / 2, leftBound, rightBound - width);

    const belowTop = Math.max(topBound, input.node.bottom + gap);
    const aboveBottom = Math.min(bottomBound, input.node.top - gap);
    const belowSpace = Math.max(0, bottomBound - belowTop);
    const aboveSpace = Math.max(0, aboveBottom - topBound);
    const wantedHeight = Math.max(1, Math.min(input.panelHeight, availableHeight));

    let placement: NodePanelPlacement;
    if (belowSpace >= wantedHeight) placement = "below";
    else if (aboveSpace >= wantedHeight) placement = "above";
    else placement = belowSpace >= aboveSpace ? "below" : "above";

    const space = placement === "below" ? belowSpace : aboveSpace;
    const maxHeight = Math.max(1, Math.min(wantedHeight, availableHeight, space));
    const height = Math.min(wantedHeight, maxHeight);
    const rawTop = placement === "below" ? belowTop : aboveBottom - height;
    const top = clamp(rawTop, topBound, bottomBound - height);

    return { left, top, width, maxHeight, placement };
}
