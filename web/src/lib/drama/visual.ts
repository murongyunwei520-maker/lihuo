import type { DramaSequence, DramaShot } from "@/types/drama";

import { DEFAULT_DRAMA_SETTINGS } from "./settings";

// 项目级视觉上下文与摄影规范：资产生成、分镜出图、视频生成共用这一份。
// 摄影参数是「项目默认 + 镜头覆盖」两层，不在各个组件里写死。

export type Cinematography = {
    lens: string;
    aperture: string;
    keyLight: string;
    fillLight: string;
    composition: string;
};

const FALLBACK: Cinematography = {
    lens: "35mm 人文",
    aperture: "f/2.8 浅景深",
    keyLight: "左侧主光",
    fillLight: "柔和补光",
    composition: "三分构图",
};

const AUTO = "自动";

function pick(value: string | undefined, fallback: string) {
    const text = (value ?? "").trim();
    return text && text !== AUTO ? text : fallback;
}

/**
 * 镜头 → 实际摄影参数：镜头自己填了就用镜头的，否则用项目默认，最后才落到兜底值。
 * 这样一部剧有统一基准，个别镜头又能单独调，不会所有镜头长一模一样。
 */
export function resolveCinematography(sequence: DramaSequence, shot?: DramaShot | null): Cinematography {
    const settings = { ...DEFAULT_DRAMA_SETTINGS, ...(sequence.settings ?? {}) };
    return {
        lens: pick(shot?.lens, pick(settings.lens, FALLBACK.lens)),
        aperture: pick(shot?.aperture, pick(settings.aperture, FALLBACK.aperture)),
        keyLight: pick(shot?.keyLight, pick(settings.keyLight, FALLBACK.keyLight)),
        fillLight: pick(shot?.fillLight, pick(settings.fillLight, FALLBACK.fillLight)),
        composition: pick(shot?.composition, pick(settings.composition, FALLBACK.composition)),
    };
}

/** 项目的视觉基准（设定集 + 画风 + 色彩 + 材质 + 时代）。 */
export function visualContext(sequence: DramaSequence) {
    const settings = { ...DEFAULT_DRAMA_SETTINGS, ...(sequence.settings ?? {}) };
    const bible = sequence.bible ?? { world: "", background: "", relations: "", visual: "" };
    return {
        style: settings.style !== AUTO ? settings.style : "",
        visual: bible.visual.trim(),
        era: (bible.era ?? "").trim(),
        palette: (bible.palette ?? "").trim(),
        material: (bible.material ?? "").trim(),
        world: bible.world.trim(),
        background: bible.background.trim(),
        negative: (bible.negative ?? "").trim(),
    };
}

/** 拼成「画风：… / 时代：…」这类短句，资产与分镜共用。 */
export function visualContextLines(sequence: DramaSequence): string[] {
    const ctx = visualContext(sequence);
    const lines = [
        ctx.style ? `画风：${ctx.style}` : "",
        ctx.visual ? `视觉规范：${ctx.visual}` : "",
        ctx.era ? `时代与地域：${ctx.era}` : "",
        ctx.palette ? `色彩基调：${ctx.palette}` : "",
        ctx.material ? `材质质感：${ctx.material}` : "",
    ].filter(Boolean);
    return lines;
}

/** 项目级负面提示词 + 本轮额外禁止项，去重后拼成一行。 */
export function negativePrompt(sequence: DramaSequence, extra: string[] = []): string {
    const base = [
        visualContext(sequence).negative,
        "不要出现文字、字幕、水印、logo",
        "不要肢体畸形、多手多指、脸部崩坏",
        ...extra,
    ]
        .map((item) => item.trim())
        .filter(Boolean);
    return [...new Set(base)].join("；");
}

/** 人物外观一致性约束：优先用已绑定的人物资产名，没有绑定时退回拆分时识别的人名。 */
export function consistencyLine(sequence: DramaSequence, shot: DramaShot): string {
    const bound = sequence.assets.filter((asset) => shot.assetIds.includes(asset.id) && asset.kind === "character").map((asset) => asset.name);
    const names = bound.length ? bound : (shot.characters ?? []).filter(Boolean);
    return names.length ? `人物一致性：${names.join("、")} 沿用参考图中的同一张脸、发型与服装，不得换人` : "";
}
