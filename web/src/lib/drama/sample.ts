import { nanoid } from "nanoid";

import type { DramaAsset, DramaSequence, DramaShot } from "@/types/drama";

import { DEFAULT_DRAMA_SETTINGS } from "./settings";
import { shotNumber } from "./schema";

// 示例内容：只在第一次打开页面、还没有任何序列时生成一份，方便直接看清结构。
// 真实使用时应从空序列开始，或从剧本拆分而来。

type SampleShot = Omit<DramaShot, "id" | "no" | "assetIds"> & { cast: string[] };

function sampleAssets(): DramaAsset[] {
    return [
        { id: nanoid(), name: "林晚", kind: "character", description: "28 岁，齐肩短发，米色风衣，情绪克制不外放", refs: [] },
        { id: nanoid(), name: "陈默", kind: "character", description: "32 岁，深灰夹克，胡茬，眼神疲惫", refs: [] },
        { id: nanoid(), name: "街口 · 雨夜", kind: "scene", description: "老城区路口，霓虹倒影，地面积水，深夜", refs: [] },
        { id: nanoid(), name: "手机", kind: "prop", description: "旧款手机，屏幕有裂痕", refs: [] },
    ];
}

const SAMPLE_SHOTS: SampleShot[] = [
    { scene: "街口 · 雨夜", size: "全景", move: "固定", light: "left", seconds: 8, line: "雨下了一整夜。", prompt: "", status: "done", cast: ["林晚", "街口 · 雨夜"] },
    { scene: "街口 · 雨夜", size: "中景", move: "推", light: "left", seconds: 9, line: "她撑着伞，忽然回头。", prompt: "", status: "done", cast: ["林晚", "街口 · 雨夜"] },
    { scene: "街口 · 雨夜", size: "近景", move: "固定", light: "none", seconds: 6, line: "", prompt: "手机屏幕亮起，未接来电 12 通", status: "done", cast: ["手机"] },
    { scene: "街口 · 雨夜", size: "特写", move: "手持", light: "left", seconds: 5, line: "（只有雨声）", prompt: "", status: "running", progress: 62, cast: ["林晚"] },
    { scene: "街口 · 雨夜", size: "中景", move: "跟拍", light: "left", seconds: 12, line: "她挤进人群，谁也没看见她。", prompt: "", status: "pending", cast: ["林晚", "街口 · 雨夜"] },
    { scene: "马路 · 夜", size: "全景", move: "摇", light: "right", seconds: 8, line: "一辆出租车停在路口。", prompt: "", status: "pending", cast: ["街口 · 雨夜"] },
    { scene: "车内 · 夜", size: "近景", move: "固定", light: "none", seconds: 7, line: "「上车吧，我等你很久了。」", prompt: "", status: "pending", cast: ["陈默"] },
    { scene: "马路 · 夜", size: "全景", move: "拉", light: "left", seconds: 9, line: "车走了，雨还没停。", prompt: "", status: "pending", cast: ["街口 · 雨夜"] },
];

export function createSampleSequence(title: string): DramaSequence {
    const assets = sampleAssets();
    const assetIdByName = new Map(assets.map((asset) => [asset.name, asset.id]));
    const now = new Date().toISOString();

    return {
        id: nanoid(),
        title,
        targetSeconds: 60,
        settings: { ...DEFAULT_DRAMA_SETTINGS },
        assets,
        shots: SAMPLE_SHOTS.map((shot, index) => {
            const { cast, ...rest } = shot;
            return {
                ...rest,
                id: nanoid(),
                no: shotNumber(index),
                assetIds: cast.map((name) => assetIdByName.get(name)).filter((id): id is string => Boolean(id)),
            };
        }),
        createdAt: now,
        updatedAt: now,
    };
}

export function createEmptyShot(index: number): DramaShot {
    return {
        id: nanoid(),
        no: shotNumber(index),
        scene: "",
        size: "中景",
        move: "固定",
        light: "left",
        seconds: 5,
        line: "",
        prompt: "",
        status: "pending",
        assetIds: [],
    };
}

export function createEmptySequence(title: string): DramaSequence {
    const now = new Date().toISOString();
    return {
        id: nanoid(),
        title,
        targetSeconds: 60,
        settings: { ...DEFAULT_DRAMA_SETTINGS },
        shots: [],
        assets: [],
        createdAt: now,
        updatedAt: now,
    };
}
