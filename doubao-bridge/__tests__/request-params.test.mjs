import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAppliedParams, resolveRequestedParams } from "../lib/request-params.mjs";

test("图片：比例/数量/模式/模型进入 appliedParams，尺寸和清晰度明确列为未提交", () => {
    const { appliedParams, unsupportedParams } = resolveRequestedParams({ model: "Seedream 4.0", mode: "image-to-image", ratio: "16:9", count: 1, size: "1280x720", resolution: "1K", attachmentCount: 2 }, "image");
    assert.equal(appliedParams.model, "Seedream 4.0");
    assert.equal(appliedParams.ratio, "16:9");
    assert.equal(appliedParams.count, 1);
    assert.equal(appliedParams.mode, "image-to-image");
    assert.deepEqual(unsupportedParams.map((item) => item.key).sort(), ["resolution", "size"]);
});

test("视频：模型/比例/时长/模式进入 appliedParams，清晰度明确列为未提交", () => {
    const { appliedParams, unsupportedParams } = resolveRequestedParams({ model: "Seedance 1.0", mode: "reference-to-video", ratio: "9:16", duration: 8, resolution: "720p", attachmentCount: 2 }, "video");
    assert.equal(appliedParams.model, "Seedance 1.0");
    assert.equal(appliedParams.ratio, "9:16");
    assert.equal(appliedParams.duration, 8);
    assert.equal(appliedParams.mode, "reference-to-video");
    assert.equal(unsupportedParams.length, 1);
    assert.equal(unsupportedParams[0].key, "resolution");
});

test("数量超出网页上限会收敛并给出明确提示", () => {
    const { appliedParams, unsupportedParams } = normalizeAppliedParams({ count: 9, duration: 30 }, "video");
    assert.equal(appliedParams.count, 1);
    assert.equal(appliedParams.duration, 15);
    assert.deepEqual(unsupportedParams.map((item) => item.key).sort(), ["count", "duration"]);
});

test("未知参数不会静默消失", () => {
    const { unsupportedParams } = resolveRequestedParams({ model: "m", seed: 42, watermark: true }, "image");
    assert.equal(unsupportedParams.length, 2);
    assert.ok(unsupportedParams.every((item) => item.reason));
});
