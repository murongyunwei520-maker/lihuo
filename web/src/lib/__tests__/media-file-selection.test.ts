import assert from "node:assert/strict";
import test from "node:test";

import { filterFilesWithOriginalIndex } from "../media-file-selection.ts";

test("过滤非图片文件后仍保留原始 FileList 下标", () => {
    const files = [
        { name: "note.txt", type: "text/plain" },
        { name: "photo-a.png", type: "image/png" },
        { name: "movie.mp4", type: "video/mp4" },
        { name: "photo-b.jpg", type: "image/jpeg" },
    ];
    const picked = filterFilesWithOriginalIndex(files, (file) => file.type.startsWith("image/"));
    assert.deepEqual(picked.map((item) => item.index), [1, 3]);
    assert.deepEqual(picked.map((item) => item.file.name), ["photo-a.png", "photo-b.jpg"]);
});

test("事件文件列表与拖拽文件列表使用同一套原始 index 规则", () => {
    const files = [
        { name: "a.png", type: "image/png" },
        { name: "b.txt", type: "text/plain" },
        { name: "c.mp3", type: "audio/mpeg" },
    ];
    const picked = filterFilesWithOriginalIndex(files, (file) => file.type.startsWith("image/") || file.type.startsWith("audio/"));
    assert.deepEqual(picked.map((item) => item.index), [0, 2]);
});
