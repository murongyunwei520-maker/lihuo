import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { isAiConfigReady, type AiConfig } from "@/stores/use-config-store";
import type { DramaAsset, DramaBible, DramaSequence, DramaSettings } from "@/types/drama";

import { deriveBibleDraft, type BibleDraftResult } from "./ai";
import { bindAssets } from "./bind";
import { extractCast, extractScenes } from "./script";
import { DEFAULT_DRAMA_SETTINGS } from "./settings";
import { isScriptStale, scriptFingerprint } from "./sync";

// 03 步的「设定自动补全」：
// 先把前两步已有的信息（灵感 / 约束 / 大纲 / 剧本正文）直接折算成可用的初稿，不花额度；
// 再用文本模型补人物关系、外观与视觉规范。用户要做的只有确认和改。

export const EMPTY_BIBLE: DramaBible = { world: "", background: "", relations: "", visual: "" };

const FIELD_KEYS: (keyof DramaBible)[] = ["world", "background", "relations", "visual", "era", "palette", "material", "negative"];

export type BibleDraft = BibleDraftResult;

function setting(settings: DramaSettings, key: keyof DramaSettings) {
    const value = (settings[key] ?? "").trim();
    return value && value !== "自动" ? value : "";
}

/** 纯规则初稿：只重排前两步已经写下的内容，不编造人物关系。 */
export function ruleBibleDraft(sequence: DramaSequence): BibleDraft {
    const script = sequence.script;
    const settings = { ...DEFAULT_DRAMA_SETTINGS, ...(sequence.settings ?? {}) };
    const premise = script?.premise?.trim() ?? "";
    const background = script?.background?.trim() ?? "";
    const direction = script?.direction?.trim() ?? "";
    const genre = script?.genre?.trim() ?? "";
    const text = script?.text ?? "";
    const style = setting(settings, "style");
    const composition = setting(settings, "composition");
    // 用户直接粘剧本、没写灵感时，用大纲首行 / 剧本首句兜底，别留一个空世界观。
    const firstLine = (source: string) => source.split("\n").map((line) => line.trim()).find((line) => line && !/^场景/.test(line)) ?? "";
    const lead = premise || firstLine(script?.outline ?? "") || firstLine(text);

    return {
        bible: {
            world: [background, genre ? `题材：${genre}` : "", lead].filter(Boolean).join("\n"),
            background: [premise || lead, direction ? `剧情走向：${direction}` : ""].filter(Boolean).join("\n"),
            relations: "",
            visual: [style ? `画风：${style}` : "", composition ? `构图基准：${composition}` : ""].filter(Boolean).join("；"),
            era: "",
            palette: "",
            material: "",
            negative: "",
        },
        characters: extractCast(text).map((name) => ({ name, description: "" })),
        scenes: extractScenes(text).map((scene) => ({ name: scene.name, description: scene.location ? `地点与时间：${scene.location}` : "" })),
    };
}

export function bibleReady(config: AiConfig, settings: DramaSettings) {
    const model = settings.textModel || buildGenerationConfig(config, undefined, "text").model;
    return isAiConfigReady(config, model);
}

/** AI 版：失败时抛错，由调用方保留规则初稿并提示。 */
export async function aiBibleDraft(args: {
    config: AiConfig;
    settings: DramaSettings;
    sequence: DramaSequence;
    onProgress?: (chars: number) => void;
    signal?: AbortSignal;
}): Promise<BibleDraft> {
    const base = ruleBibleDraft(args.sequence);
    return deriveBibleDraft({
        config: args.config,
        settings: args.settings,
        model: args.settings.textModel,
        script: args.sequence.script?.text ?? "",
        cast: base.characters.map((item) => item.name),
        scenes: base.scenes.map((item) => item.name),
        onDelta: (text) => args.onProgress?.(text.length),
        signal: args.signal,
    });
}

/**
 * 合并进序列：
 * - fill：只填空字段，用户已经写过的内容一律保留；
 * - replace：以新稿为准（显式点「重新生成」时才用），新稿为空的字段仍保留旧值。
 * 资产卡按名字复用，已有人物 / 场景不会重复建卡，已有参考图不会丢。
 */
export function mergeBibleDraft(sequence: DramaSequence, draft: BibleDraft, mode: "fill" | "replace"): { bible: DramaBible; assets: DramaAsset[] } {
    const current: DramaBible = { ...EMPTY_BIBLE, ...(sequence.bible ?? {}) };
    const bible = { ...current };
    for (const key of FIELD_KEYS) {
        const next = (draft.bible[key] ?? "").trim();
        if (!next) continue;
        if (mode === "replace" || !(current[key] ?? "").trim()) bible[key] = next;
    }

    const bound = bindAssets(sequence.shots, sequence.assets, {
        characters: draft.characters.map((item) => item.name),
        scenes: draft.scenes.map((item) => item.name),
    });
    const descriptionOf = new Map<string, string>();
    for (const item of [...draft.characters, ...draft.scenes]) {
        if (item.description.trim()) descriptionOf.set(item.name.trim().toLowerCase(), item.description.trim());
    }
    const assets = bound.assets.map((asset) => {
        const next = descriptionOf.get(asset.name.trim().toLowerCase());
        // 只补空描述：用户改过的文案不被覆盖。
        return next && !asset.description.trim() ? { ...asset, description: next } : asset;
    });
    return { bible, assets };
}

/** 设定是不是已经跟不上剧本了（剧本改过、或还没生成过）。 */
export function bibleState(sequence: DramaSequence | null | undefined): "empty" | "stale" | "ready" {
    if (!sequence) return "empty";
    const bible = sequence.bible;
    const filled = Boolean(bible && FIELD_KEYS.some((key) => (bible[key] ?? "").trim()));
    if (!filled) return "empty";
    const text = sequence.script?.text ?? "";
    if (!text.trim()) return "ready";
    if (!sequence.bibleHash) return isScriptStale(sequence) ? "stale" : "ready";
    return sequence.bibleHash === scriptFingerprint(text) ? "ready" : "stale";
}

export function bibleHashOf(sequence: DramaSequence) {
    return scriptFingerprint(sequence.script?.text ?? "");
}
