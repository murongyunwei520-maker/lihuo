import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { isAiConfigReady, type AiConfig } from "@/stores/use-config-store";
import type { DramaAsset, DramaSettings, DramaShot } from "@/types/drama";

import { splitScriptToShots } from "./ai";
import { normalizeAiShots, ruleBasedSplit } from "./script";

type SplitArgs = {
    config: AiConfig;
    settings: DramaSettings;
    text: string;
    /** 已有资产：同名不重复建卡。 */
    assets: DramaAsset[];
    onDelta?: (text: string) => void;
};

/**
 * 剧本 → 镜头。配了文本模型就走 AI，失败或未配置时降级为规则拆分。
 * 放在 lib 里，是因为「剧本拆解」「分镜设计」两个工作区都要用同一条链路。
 */
export async function splitScript({ config, settings, text, assets, onDelta }: SplitArgs): Promise<{ shots: DramaShot[]; assets: DramaAsset[]; mode: "ai" | "rule"; error?: string }> {
    const model = settings.textModel || buildGenerationConfig(config, undefined, "text").model;
    if (!isAiConfigReady(config, model)) {
        return { shots: ruleBasedSplit(text), assets, mode: "rule", error: "未配置文本模型" };
    }
    try {
        const { shots: raw, characters, scenes } = await splitScriptToShots({ config, script: text, model: settings.textModel, settings, onDelta });
        const shots = normalizeAiShots(raw);
        if (!shots.length) throw new Error("拆镜结果为空");
        return { shots, assets: mergeAssets(assets, characters, scenes), mode: "ai" };
    } catch (error) {
        return {
            shots: ruleBasedSplit(text),
            assets,
            mode: "rule",
            error: error instanceof Error ? error.message : "拆镜失败",
        };
    }
}

function mergeAssets(assets: DramaAsset[], characters: string[], scenes: string[]): DramaAsset[] {
    const existing = new Set(assets.map((asset) => asset.name));
    const next = [...assets];
    for (const [names, kind] of [
        [characters, "character"],
        [scenes, "scene"],
    ] as const) {
        for (const name of names) {
            if (!name.trim() || existing.has(name)) continue;
            existing.add(name);
            next.push({ id: `asset-${Date.now()}-${next.length}`, name, kind, description: "", refs: [] });
        }
    }
    return next;
}
