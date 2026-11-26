import assert from "node:assert/strict";
import test from "node:test";

import { buildDoubaoImageRequestedParams, buildDoubaoTextRequestedParams, buildDoubaoVideoRequestedParams, doubaoVideoMode } from "../doubao-request-params.ts";

test("图片：比例、尺寸、清晰度、数量、模式、参考图数量都进入请求契约", () => {
    const params = buildDoubaoImageRequestedParams({ model: "Seedream 4.0", mode: "image-to-image", ratio: "16:9", size: "1280x720", resolution: "1K", count: 1, attachmentCount: 2 });
    assert.equal(params.model, "Seedream 4.0");
    assert.equal(params.mode, "image-to-image");
    assert.equal(params.ratio, "16:9");
    assert.equal(params.size, "1280x720");
    assert.equal(params.resolution, "1K");
    assert.equal(params.count, 1);
    assert.equal(params.attachmentCount, 2);
});

test("视频：模型、比例、时长、清晰度、模式、附件数量都进入请求契约", () => {
    const params = buildDoubaoVideoRequestedParams({ model: "Seedance 1.0", mode: "image-to-video", ratio: "9:16", duration: 8, size: "720x1280", resolution: "720p", count: 1, attachmentCount: 1 });
    assert.equal(params.model, "Seedance 1.0");
    assert.equal(params.mode, "image-to-video");
    assert.equal(params.ratio, "9:16");
    assert.equal(params.duration, 8);
    assert.equal(params.resolution, "720p");
    assert.equal(params.attachmentCount, 1);
});

test("视频模式：无素材是文生视频，有图片是图生视频，有视频参考是参考视频", () => {
    assert.equal(doubaoVideoMode(0, 0), "text-to-video");
    assert.equal(doubaoVideoMode(2, 0), "image-to-video");
    assert.equal(doubaoVideoMode(1, 1), "reference-to-video");
});

test("文本入口也带模型和附件数量，不再只有 prompt", () => {
    const params = buildDoubaoTextRequestedParams({ model: "Doubao Seed 1.6", mode: "image-to-text", attachmentCount: 1 });
    assert.equal(params.model, "Doubao Seed 1.6");
    assert.equal(params.mode, "image-to-text");
    assert.equal(params.attachmentCount, 1);
});

test("数量非法时收敛到至少 1，不会传 0 或小数", () => {
    assert.equal(buildDoubaoImageRequestedParams({ model: "m", mode: "text-to-image", count: 0 }).count, 1);
    assert.equal(buildDoubaoImageRequestedParams({ model: "m", mode: "text-to-image", count: 2.9 }).count, 2);
});
