// Stage 3 真实模型调用：始终走项目级文本模型与项目账号，不读全局选中模型，不回退号池。
// 每次调用都返回可审计的 trace；调用失败/截断时不返回半成品。

import type { StudioProject } from "@/types/studio";
import type { StudioProductionRawScript, StudioProductionRawShot, StudioProductionRawStoryboard, StudioProductionGenerationResult, StudioProductionModelTrace } from "@/types/studio-production";
import type { NovelTextModelRuntime, NovelTextModelRuntimeOverride } from "./novel-model";
import { novelTextModelRuntime, requestNovelText } from "./novel-model";
import type { ProductionPrompt } from "./production-prompts";
import { parseProductionJson } from "./production-schema";

const nowIso = () => new Date().toISOString();

export type ProductionCallOptions = {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
    model?: NovelTextModelRuntimeOverride;
};

function trace(runtime: NovelTextModelRuntime, prompt: ProductionPrompt, text: string, startedAt: string): StudioProductionModelTrace {
    return {
        model: { channelId: runtime.selection.channelId, modelId: runtime.selection.modelId, label: runtime.label },
        modelParams: { ...runtime.params },
        capability: "text",
        promptVersion: prompt.promptVersion,
        inputVersion: 0,
        inputChars: prompt.inputChars,
        outputChars: text.length,
        calls: 1,
        startedAt,
        finishedAt: nowIso(),
    };
}

async function callProjectText(
    project: StudioProject,
    prompt: ProductionPrompt,
    options: ProductionCallOptions,
): Promise<{ text: string; runtime: NovelTextModelRuntime; trace: StudioProductionModelTrace }> {
    const runtime = await novelTextModelRuntime(project, options.model);
    if (!runtime.config.model && !runtime.config.textModel) throw new Error("项目文本模型没有可用的模型配置");
    const startedAt = nowIso();
    options.onProgress?.(15);
    const text = await requestNovelText(
        runtime,
        [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
        ],
        {
            signal: options.signal,
            temperature: typeof runtime.params.temperature === "number" ? runtime.params.temperature : undefined,
            maxTokens: typeof runtime.params.maxTokens === "number" ? runtime.params.maxTokens : undefined,
        },
    );
    options.onProgress?.(85);
    if (!text.trim()) throw new Error("项目文本模型返回空内容");
    return { text: text.trim(), runtime, trace: trace(runtime, prompt, text, startedAt) };
}

export async function generateProjectText(
    project: StudioProject,
    prompt: ProductionPrompt,
    options: ProductionCallOptions = {},
): Promise<{ text: string; runtime: NovelTextModelRuntime; trace: StudioProductionModelTrace }> {
    return callProjectText(project, prompt, options);
}

export async function generateScriptDraft(
    project: StudioProject,
    prompt: ProductionPrompt,
    options: ProductionCallOptions = {},
): Promise<StudioProductionGenerationResult<StudioProductionRawScript>> {
    const { text, runtime, trace: modelTrace } = await callProjectText(project, prompt, options);
    const raw = parseProductionJson<StudioProductionRawScript>(text, "scenes");
    if (!Array.isArray(raw.scenes) || !raw.scenes.length) throw new Error("模型返回 scenes 为空，未写入剧本");
    modelTrace.inputVersion = prompt.promptVersion.includes("scene") ? project.adaptation?.versionNumber ?? 0 : project.adaptation?.versionNumber ?? 0;
    modelTrace.model = { channelId: runtime.selection.channelId, modelId: runtime.selection.modelId, label: runtime.label };
    options.onProgress?.(100);
    return { document: raw, trace: modelTrace, rawText: text };
}

export type StudioProductionRawDialogueReplacement = {
    dialogueBlocks?: StudioProductionRawScript["scenes"][number]["dialogueBlocks"];
};

export async function generateScriptDialogueDraft(
    project: StudioProject,
    prompt: ProductionPrompt,
    options: ProductionCallOptions = {},
): Promise<StudioProductionGenerationResult<StudioProductionRawDialogueReplacement>> {
    const { text, trace: modelTrace } = await callProjectText(project, prompt, options);
    const raw = parseProductionJson<StudioProductionRawDialogueReplacement>(text, "dialogueBlocks");
    if (!Array.isArray(raw.dialogueBlocks)) throw new Error("模型没有返回 dialogueBlocks，未写入剧本");
    options.onProgress?.(100);
    return { document: raw, trace: modelTrace, rawText: text };
}

export async function generateStoryboardSceneDraft(
    project: StudioProject,
    prompt: ProductionPrompt,
    options: ProductionCallOptions = {},
): Promise<StudioProductionGenerationResult<StudioProductionRawStoryboard>> {
    const { text, trace: modelTrace } = await callProjectText(project, prompt, options);
    const raw = parseProductionJson<StudioProductionRawStoryboard>(text, "groups");
    if (!Array.isArray(raw.groups) || !raw.groups.length) throw new Error("模型返回 groups 为空，未写入分镜");
    options.onProgress?.(100);
    return { document: raw, trace: modelTrace, rawText: text };
}

export async function generateStoryboardShotDraft(
    project: StudioProject,
    prompt: ProductionPrompt,
    options: ProductionCallOptions = {},
): Promise<StudioProductionGenerationResult<StudioProductionRawShot>> {
    const { text, trace: modelTrace } = await callProjectText(project, prompt, options);
    const raw = parseProductionJson<StudioProductionRawShot>(text, "");
    if (!raw.shotSize || !raw.action) throw new Error("模型返回的单个镜头缺少景别或动作，未写入分镜");
    options.onProgress?.(100);
    return { document: raw, trace: modelTrace, rawText: text };
}
