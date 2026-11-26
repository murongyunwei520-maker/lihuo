import assert from "node:assert/strict";
import test from "node:test";

import { computeNodePanelLayout, type RectLike } from "../node-panel-layout.ts";

function rect(left: number, top: number, width: number, height: number): RectLike {
    return { left, top, right: left + width, bottom: top + height, width, height };
}

const viewport = rect(0, 0, 1280, 720);

test("节点在左上：卡片不越出左边界，优先放下方", () => {
    const layout = computeNodePanelLayout({ node: rect(20, 40, 160, 120), viewport, panelHeight: 360 });
    assert.equal(layout.left, 12);
    assert.equal(layout.placement, "below");
    assert.equal(layout.width, 600);
    assert.ok(layout.top >= 40 + 120);
    assert.ok(layout.top + layout.maxHeight <= 720);
});

test("节点在右下：卡片向左收，并翻到上方", () => {
    const layout = computeNodePanelLayout({ node: rect(1100, 540, 160, 120), viewport, panelHeight: 360 });
    assert.equal(layout.left, 1280 - 12 - 600);
    assert.equal(layout.placement, "above");
    assert.ok(layout.top >= 0);
    assert.ok(layout.top + layout.maxHeight <= 540 - 12);
});

test("节点在左下：卡片向右偏移后仍翻到上方", () => {
    const layout = computeNodePanelLayout({ node: rect(20, 560, 160, 120), viewport, panelHeight: 460 });
    assert.equal(layout.left, 12);
    assert.equal(layout.placement, "above");
    assert.ok(layout.top >= 0);
});

test("小屏：宽度和高度都不超出可视区域，内容由 maxHeight 滚动", () => {
    const small = rect(0, 0, 360, 500);
    const layout = computeNodePanelLayout({ node: rect(80, 40, 120, 80), viewport: small, panelHeight: 900, topInset: 52, bottomInset: 88 });
    assert.equal(layout.width, 360 - 24);
    assert.ok(layout.left >= 12);
    assert.ok(layout.left + layout.width <= 360 - 12);
    assert.ok(layout.maxHeight <= 500 - 52 - 88);
    assert.ok(layout.top >= 52);
    assert.ok(layout.top + layout.maxHeight <= 500 - 88);
});

test("顶栏与底部工具栏会缩小可用高度", () => {
    const layout = computeNodePanelLayout({ node: rect(400, 300, 160, 120), viewport, panelHeight: 500, topInset: 72, bottomInset: 92 });
    assert.ok(layout.maxHeight <= 720 - 72 - 92);
});
