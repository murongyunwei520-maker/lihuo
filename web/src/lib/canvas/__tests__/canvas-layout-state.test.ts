import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CANVAS_LAYOUT, parseCanvasLayoutSnapshot, serializeCanvasLayoutSnapshot } from "../canvas-layout-state.ts";

test("首次进入：四个区域默认全部收起", () => {
    const state = parseCanvasLayoutSnapshot(null);
    assert.deepEqual(state, DEFAULT_CANVAS_LAYOUT);
    assert.equal(state.topBarOpen, false);
    assert.equal(state.taskBarOpen, false);
    assert.equal(state.inspectorOpen, false);
    assert.equal(state.accountsOpen, false);
});

test("用户手动展开后：快照能完整还原", () => {
    const raw = serializeCanvasLayoutSnapshot({ initialized: true, topBarOpen: true, taskBarOpen: true, inspectorOpen: false, accountsOpen: true });
    const state = parseCanvasLayoutSnapshot(raw);
    assert.equal(state.initialized, true);
    assert.equal(state.topBarOpen, true);
    assert.equal(state.taskBarOpen, true);
    assert.equal(state.inspectorOpen, false);
    assert.equal(state.accountsOpen, true);
});

test("损坏或非法快照：安全退回首次沉浸默认值", () => {
    assert.deepEqual(parseCanvasLayoutSnapshot("{bad json"), DEFAULT_CANVAS_LAYOUT);
    assert.deepEqual(parseCanvasLayoutSnapshot("null"), DEFAULT_CANVAS_LAYOUT);
    assert.deepEqual(parseCanvasLayoutSnapshot(JSON.stringify({ initialized: "yes", topBarOpen: 1 })), DEFAULT_CANVAS_LAYOUT);
});
