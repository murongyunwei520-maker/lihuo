import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { isAiConfigReady, type AiConfig } from "@/stores/use-config-store";
import type { DramaAsset, DramaSettings, DramaShot } from "@/types/drama";

import { splitScriptToShots } from "./ai";
import { bindAssets } from "./bind";
import { normalizeAiShots, ruleBasedSplit } from "./script";

type SplitArgs = {
    config: AiConfig;
    settings: DramaSettings;
    text: string;
    /** 已有资产：同名复用，不重复建卡。 */
    assets: DramaAsset[];
    onDelta?: (text: string) => void;
};

export type SplitResult = {
    shots: DramaShot[];
    assets: DramaAsset[];
    mode: "ai" | "rule";
    /** 降级原因；mode 为 ai 时为空。 */
    error?: string;
    /** 成功绑定到资产卡的镜头数，用于向用户回显。 */
    bound: number;
};

/**
 * 剧本 → 镜头。配了文本模型走 AI，未配置或失败时降级为规则拆分。
 * 两条路径都会把人物 / 场景绑定成稳定 assetIds，不只生成资产卡。
 */
export async function splitScript({ config, settings, text, assets, onDelta }: SplitArgs): Promise<SplitResult> {
    const ready = settings.textModel || buildGenerationConfig(config, undefined, "text").model;
    if (!isAiConfigReady(config, ready)) {
        const bound = bindAssets(ruleBasedSplit(text), assets);
        return { shots: bound.shots, assets: bound.assets, mode: "rule", error: "未配置文本模型，已按场景/对白规则拆分", bound: bound.bound };
    }
    try {
        const { shots: raw, characters, scenes } = await splitScriptToShots({ config, script: text, model: settings.textModel, settings, onDelta });
        const shots = normalizeAiShots(raw);
        if (!shots.length) throw new Error("模型没有返回可用的镜头");
        const bound = bindAssets(shots, assets, { characters, scenes });
        return { shots: bound.shots, assets: bound.assets, mode: "ai", bound: bound.bound };
    } catch (error) {
        const bound = bindAssets(ruleBasedSplit(text), assets);
        return {
            shots: bound.shots,
            assets: bound.assets,
            mode: "rule",
            error: error instanceof Error ? error.message : "拆镜失败",
            bound: bound.bound,
        };
    }
}
