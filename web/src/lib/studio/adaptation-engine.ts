// 阶段 2B 改编引擎：分阶段模型调用、引用校验、业务校验、提案与局部重生成。
// 引擎不直接写 Zustand；它把生成状态和提案返回给第一步工作区，由 store 持久化。

import type { StudioProject } from "@/types/studio";
import type {
    StudioAdaptationChange,
    StudioAdaptationCheck,
    StudioAdaptationGeneration,
    StudioAdaptationGenerationKind,
    StudioAdaptationProposal,
    StudioAdaptationSettings,
    StudioAdaptationStrategy,
    StudioAdaptationWorkspace,
    StudioCharacterArc,
    StudioEpisodePlan,
    StudioForeshadowingPoolItem,
    StudioSeriesBlueprint,
} from "@/types/studio-adaptation";
import { applyNovelAnalysisOverrides } from "./novel-merge";
import { requestNovelText, novelTextModelRuntime, type NovelTextModelRuntime } from "./novel-model";
import { buildAdaptationSourceDigest, adaptationBatchSize, estimateAdaptationCalls, episodeBatchPrompt, formatAdaptationSettings, blueprintPrompt, strategyPrompt, synthesisPrompt, regenerationPrompt, episodeModulePrompt } from "./adaptation-prompts";
import {
    AdaptationSchemaError,
    checkSummary,
    completeSeriesBlueprintFromAnalysis,
    createAdaptationContext,
    includeOriginalForeshadowings,
    mergeChangeLedger,
    normalizeAdaptationChanges,
    normalizeAdaptationStrategy,
    normalizeCharacterArcs,
    normalizeEpisodePlans,
    normalizeForeshadowingPool,
    normalizeModelChecks,
    normalizeSeriesBlueprint,
    preserveCheckStatuses,
    reconcileForeshadowingStatuses,
    syncCharacterArcsFromPlans,
    validateAdaptationPackage,
    type AdaptationContext,
} from "./adaptation-schema";
import { diffAgainstCurrent, lockedEpisodeNumbers } from "./adaptation-workspace";

export type AdaptationEpisodeModule = "synopsis" | "conflict" | "characters" | "hooks" | "foreshadowing";

export const ADAPTATION_MODULE_LABEL: Record<AdaptationEpisodeModule, string> = {
    synopsis: "剧情概要 / 戏剧目标",
    conflict: "核心冲突 / 高潮",
    characters: "人物出场 / 状态 / 关系",
    hooks: "开场钩子 / 集尾钩子",
    foreshadowing: "伏笔埋设 / 推进 / 回收",
};

export type AdaptationGenerationRequest = {
    kind: StudioAdaptationGenerationKind;
    targetNumbers?: number[];
    module?: AdaptationEpisodeModule;
    reason?: string;
};

export type AdaptationGenerationResult = {
    generation: StudioAdaptationGeneration;
    proposal?: StudioAdaptationProposal;
    error?: string;
};

const activeByProject = new Map<string, string>();

export function isAdaptationGenerationRunning(projectId: string) {
    return activeByProject.has(projectId);
}

function nowIso() {
    return new Date().toISOString();
}

function randomId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function hashText(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function isAbortError(error: unknown) {
    return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && (error.name === "AbortError" || /aborted|cancelled|取消/i.test(error.message)));
}

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function createGeneration(args: {
    projectId: string;
    kind: StudioAdaptationGenerationKind;
    settings: StudioAdaptationSettings;
    inputVersion: number;
    targetNumbers: number[];
    lockedNumbers: number[];
    analysisVersion: number;
}): StudioAdaptationGeneration {
    const now = nowIso();
    return {
        id: randomId("agen"),
        kind: args.kind,
        stage: "prepare",
        status: "running",
        progress: 0,
        currentLabel: "准备项目级文本模型与原著上下文…",
        model: { channelId: "", modelId: "", label: "" },
        modelParams: {},
        inputVersion: args.inputVersion,
        sourceAnalysisVersion: args.analysisVersion,
        settingsSnapshot: { ...args.settings },
        targetEpisodeNumbers: args.targetNumbers,
        lockedEpisodeNumbers: args.lockedNumbers,
        calls: 0,
        inputChars: 0,
        promptHash: "",
        createdAt: now,
        startedAt: now,
        updatedAt: now,
    };
}

function updateGeneration(generation: StudioAdaptationGeneration, patch: Partial<StudioAdaptationGeneration>, onGeneration: (generation: StudioAdaptationGeneration) => void) {
    const next = { ...generation, ...patch, updatedAt: nowIso() };
    onGeneration(next);
    return next;
}

function serialize(value: unknown) {
    try {
        return JSON.stringify(value);
    } catch {
        return "";
    }
}

function planSummary(plan: StudioEpisodePlan) {
    return [
        `第${plan.episodeNumber}集《${plan.episodeTitle}》：${plan.episodeLogline || plan.episodeSynopsis.slice(0, 80)}`,
        `目标：${plan.dramaticGoal}｜冲突：${plan.mainConflict}`,
        `高潮：${plan.climax}｜钩子：${plan.endingHook}`,
        `人物：${plan.characterAppearances.map((character) => `${character.name}@${plan.characterStates.find((state) => state.characterId === character.characterId)?.location ?? "?"}`).join("、")}`,
        `伏笔：埋${plan.foreshadowingIntroduced.join(",") || "无"}；推${plan.foreshadowingAdvanced.join(",") || "无"}；收${plan.foreshadowingResolved.join(",") || "无"}`,
        `依赖：${plan.continuityDependencies.join("；") || "无"}`,
    ].join("；");
}

function plansSummary(plans: StudioEpisodePlan[], maxChars = 16000) {
    const lines = plans.map(planSummary);
    let text = lines.join("\n");
    if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…（后续集摘要截断）`;
    return text;
}

function previousSummaries(plans: StudioEpisodePlan[], beforeNumber: number) {
    return plans.filter((plan) => plan.episodeNumber < beforeNumber).map(planSummary).join("\n");
}

function adjacentSummaries(plans: StudioEpisodePlan[], targetNumbers: number[]) {
    const numbers = new Set<number>();
    for (const number of targetNumbers) {
        numbers.add(number - 1);
        numbers.add(number);
        numbers.add(number + 1);
    }
    return plans.filter((plan) => numbers.has(plan.episodeNumber)).map(planSummary).join("\n");
}

function poolForPrompt(pool: StudioForeshadowingPoolItem[]) {
    return JSON.stringify(pool.map((item) => ({
        foreshadowingId: item.foreshadowingId,
        content: item.content,
        sourceType: item.sourceType,
        sourceNovelForeshadowingId: item.sourceNovelForeshadowingId,
        firstPlantedEpisode: item.firstPlantedEpisode,
        expectedResolveEpisode: item.expectedResolveEpisode,
        relatedCharacterIds: item.relatedCharacterIds,
        relatedEventIds: item.relatedEventIds,
        status: item.status,
    })));
}

function changesForPrompt(changes: StudioAdaptationChange[]) {
    return JSON.stringify(changes.map((change) => ({
        adaptationChangeId: change.adaptationChangeId,
        operation: change.operation,
        sourceType: change.sourceType,
        beforeStructure: change.beforeStructure,
        afterStructure: change.afterStructure,
        reason: change.reason,
        characterImpact: change.characterImpact,
        causalityImpact: change.causalityImpact,
        foreshadowingImpact: change.foreshadowingImpact,
        riskTags: change.riskTags,
        highRisk: change.highRisk,
    })));
}

function mergeRawPool(...lists: unknown[][]): StudioForeshadowingPoolItem[] {
    const map = new Map<string, StudioForeshadowingPoolItem>();
    for (const list of lists) {
        for (const value of list) {
            if (!value || typeof value !== "object") continue;
            const record = value as Partial<StudioForeshadowingPoolItem>;
            const id = typeof record.foreshadowingId === "string" ? record.foreshadowingId : "";
            if (id) map.set(id, record as StudioForeshadowingPoolItem);
        }
    }
    return [...map.values()];
}

function mergeChecks(...lists: StudioAdaptationCheck[][]) {
    const map = new Map<string, StudioAdaptationCheck>();
    for (const list of lists) {
        for (const check of list) {
            const key = `${check.code}|${check.message}|${check.episodeNumbers.join(",")}`;
            const existing = map.get(key);
            if (!existing || existing.status === "open") map.set(key, check);
        }
    }
    return [...map.values()].map((check, index) => ({ ...check, id: `check-${index + 1}` }));
}

function requestOptions(runtime: NovelTextModelRuntime) {
    return {
        ...(typeof runtime.params.temperature === "number" ? { temperature: runtime.params.temperature } : {}),
        ...(typeof runtime.params.maxTokens === "number" ? { maxTokens: Math.max(512, Math.min(8192, Number(runtime.params.maxTokens))) } : {}),
    };
}

function ensureEpisodeBatch(plans: StudioEpisodePlan[], targetNumbers: number[], allowedNumbers: number[] = targetNumbers) {
    const found = new Map(plans.map((plan) => [plan.episodeNumber, plan]));
    if (found.size !== plans.length) throw new AdaptationSchemaError("episode_batch_duplicate", "模型返回了重复集数；本次生成失败，未写入半成品规划。");
    const missing = targetNumbers.filter((number) => !found.has(number));
    if (missing.length) {
        throw new AdaptationSchemaError("episode_batch_incomplete", `模型没有返回第 ${missing.join("、")} 集；本次生成失败，未写入半成品规划。`);
    }
    const extra = plans.filter((plan) => !allowedNumbers.includes(plan.episodeNumber)).map((plan) => plan.episodeNumber);
    if (extra.length) throw new AdaptationSchemaError("episode_batch_extra", `模型返回了未请求的第 ${extra.join("、")} 集；为避免越界写入，本次生成失败。`);
}

function validateNeighborDependencies(ctx: AdaptationContext, beforePlans: StudioEpisodePlan[], afterPlans: StudioEpisodePlan[], changedNumbers: number[]) {
    const beforeByNumber = new Map(beforePlans.map((plan) => [plan.episodeNumber, plan]));
    const afterByNumber = new Map(afterPlans.map((plan) => [plan.episodeNumber, plan]));
    for (const number of changedNumbers) {
        const current = afterByNumber.get(number);
        const previous = afterByNumber.get(number - 1);
        const next = afterByNumber.get(number + 1);
        const old = beforeByNumber.get(number);
        if (!current) continue;
        if (previous && !current.continuityDependencies.some((dependency) => dependency.includes(String(number - 1)) || /上一集|上集|前情/.test(dependency))) {
            ctx.pushCheck({ level: "warning", code: "regen_missing_previous_dependency", category: "局部重生成", message: `第 ${number} 集重生成后没有说明如何承接第 ${number - 1} 集。`, episodeNumbers: [number - 1, number], suggestion: "检查上一集结尾与当前集开场是否仍然连续。" });
        }
        if (next) {
            const hasDependency = next.continuityDependencies.some((dependency) => dependency.includes(String(number)) || /上一集|上集|前情/.test(dependency));
            if (!hasDependency) {
                ctx.pushCheck({ level: "warning", code: "regen_next_dependency", category: "局部重生成", message: `第 ${next.episodeNumber} 集可能仍依赖修改前的第 ${number} 集，但没有写明依赖关系。`, episodeNumbers: [number, next.episodeNumber], suggestion: "检查下一集的时间、人物状态、关键事件引用；必要时连续重生成下一集。" });
            }
        }
        if (old && current) {
            const oldHook = old.endingHook.replace(/\s+/g, "");
            const newHook = current.endingHook.replace(/\s+/g, "");
            if (oldHook && newHook && oldHook !== newHook && next && !next.continuityDependencies.length) {
                ctx.pushCheck({ level: "suggestion", code: "regen_hook_changed_next", category: "局部重生成", message: `第 ${number} 集集尾钩子变化，第 ${number + 1} 集没有连续性说明。`, episodeNumbers: [number, number + 1] });
            }
        }
    }
}

function mergeEpisodePlans(existing: StudioEpisodePlan[], generated: StudioEpisodePlan[], lockedNumbers: number[]) {
    const map = new Map(existing.map((plan) => [plan.episodeNumber, plan]));
    for (const plan of generated) {
        if (lockedNumbers.includes(plan.episodeNumber)) continue;
        const old = map.get(plan.episodeNumber);
        map.set(plan.episodeNumber, {
            ...plan,
            version: old?.version ?? 1,
            versions: old?.versions ?? [],
            locked: false,
            reviewStatus: "pending_review",
        });
    }
    return [...map.values()].sort((left, right) => left.episodeNumber - right.episodeNumber);
}

function mergeModule(existing: StudioEpisodePlan, candidate: StudioEpisodePlan, module: AdaptationEpisodeModule): StudioEpisodePlan {
    if (module === "synopsis") return { ...existing, episodeLogline: candidate.episodeLogline, episodeSynopsis: candidate.episodeSynopsis, dramaticGoal: candidate.dramaticGoal };
    if (module === "conflict") return { ...existing, mainConflict: candidate.mainConflict, climax: candidate.climax };
    if (module === "characters") return { ...existing, characterAppearances: candidate.characterAppearances, characterStates: candidate.characterStates, characterRelationshipChanges: candidate.characterRelationshipChanges };
    if (module === "hooks") return { ...existing, openingHook: candidate.openingHook, endingHook: candidate.endingHook };
    return { ...existing, foreshadowingIntroduced: candidate.foreshadowingIntroduced, foreshadowingAdvanced: candidate.foreshadowingAdvanced, foreshadowingResolved: candidate.foreshadowingResolved };
}

function buildProposal(args: {
    existing: StudioAdaptationWorkspace;
    kind: StudioAdaptationGenerationKind;
    title: string;
    reason: string;
    targetNumbers: number[];
    strategy?: StudioAdaptationStrategy;
    blueprint?: StudioSeriesBlueprint;
    plans?: StudioEpisodePlan[];
    arcs?: StudioCharacterArc[];
    pool?: StudioForeshadowingPoolItem[];
    changes?: StudioAdaptationChange[];
    checks?: StudioAdaptationCheck[];
}): StudioAdaptationProposal {
    const proposal: StudioAdaptationProposal = {
        id: randomId("proposal"),
        kind: args.kind,
        title: args.title,
        reason: args.reason,
        status: "pending",
        baseVersion: args.existing.versionNumber,
        targetEpisodeNumbers: args.targetNumbers,
        createdAt: nowIso(),
        strategy: args.strategy,
        blueprint: args.blueprint,
        episodePlans: args.plans,
        characterArcs: args.arcs,
        foreshadowings: args.pool,
        changes: args.changes,
        checks: args.checks,
        diff: { strategyChanged: false, blueprintChanged: false, episodesAdded: [], episodesRemoved: [], episodesChanged: [], notes: [], items: [] },
    };
    return { ...proposal, diff: diffAgainstCurrent(args.existing, proposal) };
}

function strategyBasics(ctx: AdaptationContext, strategy: StudioAdaptationStrategy | undefined, changes: StudioAdaptationChange[]) {
    if (!strategy) return;
    if (!strategy.logline) ctx.pushCheck({ level: "error", code: "strategy_without_logline", category: "改编方案", message: "改编方案缺少故事线。" });
    if (!strategy.positioningSummary) ctx.pushCheck({ level: "error", code: "strategy_without_positioning", category: "改编方案", message: "改编方案缺少改编定位总结。" });
    if (!strategy.changes.length) ctx.pushCheck({ level: "warning", code: "strategy_without_changes", category: "改编方案", message: "改编方案没有任何改编差异记录。", suggestion: "至少记录核心结构、人物、冲突与结局的改编决策。" });
    for (const change of changes) {
        if (change.highRisk && change.reviewStatus !== "pending_review") {
            ctx.pushCheck({ level: "warning", code: "high_risk_review_state", category: "改编审核", message: `高风险改编「${change.adaptationChangeId}」没有保持待审核状态。`, suggestion: "高风险改编必须由用户确认。" });
        }
        if (!change.reason) ctx.pushCheck({ level: "warning", code: "change_without_reason", category: "改编记录", message: `改编「${change.adaptationChangeId}」没有说明原因。` });
    }
}

function blueprintBasics(ctx: AdaptationContext, blueprint: StudioSeriesBlueprint | undefined) {
    if (!blueprint) return;
    if (!blueprint.logline) ctx.pushCheck({ level: "error", code: "blueprint_without_logline", category: "全剧蓝图", message: "全剧蓝图缺少一句话故事。" });
    if (!blueprint.mainline) ctx.pushCheck({ level: "error", code: "blueprint_without_mainline", category: "全剧蓝图", message: "全剧蓝图缺少故事主线。" });
    if (!blueprint.climax) ctx.pushCheck({ level: "error", code: "blueprint_without_climax", category: "全剧蓝图", message: "全剧蓝图缺少全剧高潮。" });
    if (!blueprint.ending) ctx.pushCheck({ level: "error", code: "blueprint_without_ending", category: "全剧蓝图", message: "全剧蓝图缺少故事结局。" });
    if (!blueprint.keyEvents.length) ctx.pushCheck({ level: "error", code: "blueprint_without_events", category: "全剧蓝图", message: "全剧蓝图没有关键事件。" });
}

function baseChecks(ctx: AdaptationContext, model: StudioAdaptationCheck[], current: StudioAdaptationCheck[]) {
    return preserveCheckStatuses(mergeChecks(ctx.checks, model), current);
}

export async function runAdaptationGeneration(args: {
    project: StudioProject;
    existing: StudioAdaptationWorkspace;
    settings: StudioAdaptationSettings;
    request: AdaptationGenerationRequest;
    signal?: AbortSignal;
    onGeneration: (generation: StudioAdaptationGeneration) => void;
}): Promise<AdaptationGenerationResult> {
    const { project, existing, settings, request, signal, onGeneration } = args;
    if (activeByProject.has(project.id)) throw new AdaptationSchemaError("duplicate_generation", "当前项目已有改编生成任务在运行，不能重复提交");
    const inputVersion = existing.versionNumber;
    const targetAll = Array.from({ length: settings.targetEpisodes }, (_, index) => index + 1);
    const lockedNumbers = lockedEpisodeNumbers(existing);
    let requested = request.kind === "strategy" || request.kind === "blueprint" ? [] : request.kind === "full" ? targetAll : (request.targetNumbers ?? targetAll);
    requested = uniqueNumbers(requested).filter((number) => number >= 1 && number <= settings.targetEpisodes);
    if (request.kind === "episode_regenerate" && requested.length !== 1) throw new AdaptationSchemaError("regen_scope", "单集指定模块重生成必须只选择一集");
    if (request.kind === "episode_regenerate" && !request.module) throw new AdaptationSchemaError("regen_module", "单集指定模块重生成必须选择模块");
    if (request.kind === "full" && existing.strategy?.locked) throw new AdaptationSchemaError("strategy_locked", "改编方案已锁定；请使用“生成全剧蓝图”或“生成分集规划”继续");
    if (request.kind === "full" && existing.blueprint?.locked) throw new AdaptationSchemaError("blueprint_locked", "全剧蓝图已锁定；请使用“生成分集规划”继续");
    if (request.kind === "strategy" && existing.strategy?.locked) throw new AdaptationSchemaError("strategy_locked", "改编方案已锁定，不能重新生成；请先解锁或只做局部编辑");
    if (request.kind === "blueprint" && existing.blueprint?.locked) throw new AdaptationSchemaError("blueprint_locked", "全剧蓝图已锁定，不能重新生成；请先解锁");
    if (request.kind === "blueprint" && !existing.strategy) throw new AdaptationSchemaError("strategy_missing", "先生成并确认改编方案，再生成全剧蓝图");
    if ((request.kind === "episodes" || request.kind === "episode_regenerate") && !existing.blueprint) throw new AdaptationSchemaError("blueprint_missing", "先生成并确认全剧蓝图，再生成分集规划");
    if (request.kind === "episode_regenerate") {
        const targetPlan = existing.episodePlans.find((plan) => plan.episodeNumber === requested[0]);
        if (!targetPlan) throw new AdaptationSchemaError("episode_missing", "当前项目没有这一集规划");
        if (targetPlan.locked) throw new AdaptationSchemaError("episode_locked", "该集已锁定，不能局部重生成；请先解锁");
    }
    const unlocked = requested.filter((number) => !lockedNumbers.includes(number));
    if ((request.kind === "episodes" || request.kind === "full" || request.kind === "episode_regenerate") && !unlocked.length) throw new AdaptationSchemaError("all_locked", "目标集数全部已锁定，没有可生成范围");
    let generation = createGeneration({
        projectId: project.id,
        kind: request.kind,
        settings,
        inputVersion,
        targetNumbers: request.kind === "strategy" || request.kind === "blueprint" ? [] : unlocked,
        lockedNumbers,
        analysisVersion: project.novelAnalysis?.version ?? 0,
    });
    activeByProject.set(project.id, generation.id);
    onGeneration(generation);
    let promptHash = "";
    let inputChars = 0;
    let calls = 0;
    const promptParts: string[] = [];

    async function ask(prompt: string, stage: StudioAdaptationGeneration["stage"], progress: number, label: string) {
        if (signal?.aborted) throw new DOMException("用户取消生成", "AbortError");
        generation = updateGeneration(generation, { stage, status: "running", progress, currentLabel: label }, onGeneration);
        promptParts.push(prompt);
        inputChars += prompt.length;
        promptHash = hashText(promptHash + prompt);
        calls += 1;
        generation = updateGeneration(generation, { calls, inputChars, promptHash }, onGeneration);
        const result = await requestNovelText(runtime, [{ role: "user", content: prompt }], { ...requestOptions(runtime), signal });
        return JSON.parse(JSON.stringify(parseJson(result)));
    }

    let runtime: NovelTextModelRuntime;
    try {
        runtime = await novelTextModelRuntime(project);
        generation = updateGeneration(generation, {
            model: { channelId: runtime.selection.channelId, modelId: runtime.selection.modelId, label: runtime.label },
            modelParams: runtime.params,
            currentLabel: `项目模型：${runtime.label}`,
        }, onGeneration);
        const ctx = createAdaptationContext(project, settings);
        let checks: StudioAdaptationCheck[] = [];
        let proposal: StudioAdaptationProposal | undefined;
        let changes = existing.changes;
        let pool = existing.foreshadowings;
        let arcs = existing.characterArcs;
        let finalStrategy = existing.strategy;
        let finalBlueprint = existing.blueprint;
        let plans = existing.episodePlans;

        if (request.kind === "strategy" || request.kind === "full") {
            generation = updateGeneration(generation, { stage: "strategy", progress: 8, currentLabel: "阅读原著档案并生成改编方案…" }, onGeneration);
            const digest = buildAdaptationSourceDigest(project, 24000);
            if (!digest) throw new AdaptationSchemaError("analysis_missing", "无法装配原著上下文");
            const raw = await ask(strategyPrompt({ digest, settings, reason: request.reason }), "strategy", 10, "生成改编定位与改编方案…");
            const strategy = normalizeAdaptationStrategy(ctx, raw);
            const initialRaw = Array.isArray(raw.foreshadowings) ? raw.foreshadowings : Array.isArray((raw as Record<string, unknown>).foreshadowingPool) ? (raw as Record<string, unknown>).foreshadowingPool as unknown[] : [];
            const initialPool = normalizeForeshadowingPool(ctx, { foreshadowings: initialRaw }, []);
            pool = reconcileForeshadowingStatuses(includeOriginalForeshadowings(ctx, initialPool), []);
            changes = mergeChangeLedger(existing.changes, strategy.changes);
            finalStrategy = strategy;
            strategyBasics(ctx, strategy, changes);
            finalStrategy = { ...strategy, changes };
            checks = baseChecks(ctx, normalizeModelChecks(ctx, raw), existing.checks);
            generation = updateGeneration(generation, { progress: 30, currentLabel: "改编方案已生成，等待审核" }, onGeneration);
            if (request.kind === "strategy") {
                proposal = buildProposal({ existing, kind: "strategy", title: "改编方案提案", reason: request.reason ?? "生成改编方案", targetNumbers: [], strategy: finalStrategy, pool, changes, checks });
            }
        }

        if (request.kind === "blueprint" || request.kind === "full") {
            if (!finalStrategy) throw new AdaptationSchemaError("strategy_missing", "缺少改编方案，无法生成全剧蓝图");
            generation = updateGeneration(generation, { stage: "blueprint", progress: 34, currentLabel: "生成全剧故事蓝图…" }, onGeneration);
            const digest = buildAdaptationSourceDigest(project, 22000);
            const core = await ask(blueprintPrompt({
                digest,
                settings,
                strategy: serialize(finalStrategy),
                changes: changesForPrompt(changes),
                foreshadowings: poolForPrompt(pool),
                reason: request.reason,
            }), "blueprint", 36, "生成全剧故事蓝图…");
            const blueprint = completeSeriesBlueprintFromAnalysis(ctx, normalizeSeriesBlueprint(ctx, core, changes));
            const blueprintChanges = normalizeAdaptationChanges(ctx, (core as Record<string, unknown>).changes, 0);
            changes = mergeChangeLedger(changes, blueprintChanges);
            finalBlueprint = { ...blueprint, version: (existing.blueprint?.version ?? 0) + 1 };
            blueprintBasics(ctx, finalBlueprint);
            checks = baseChecks(ctx, normalizeModelChecks(ctx, core), existing.checks);
            generation = updateGeneration(generation, { progress: 48, currentLabel: "全剧蓝图已生成，等待审核" }, onGeneration);
            if (request.kind === "blueprint") {
                proposal = buildProposal({ existing, kind: "blueprint", title: "全剧蓝图提案", reason: request.reason ?? "生成全剧蓝图", targetNumbers: [], blueprint: finalBlueprint, pool, changes, checks });
            }
        }

        if (request.kind === "full" || request.kind === "episodes") {
            if (!finalStrategy || !finalBlueprint) throw new AdaptationSchemaError("blueprint_missing", "缺少改编方案或全剧蓝图，无法规划分集");
            const digest = buildAdaptationSourceDigest(project, 18000);
            const batchSize = adaptationBatchSize(settings.targetEpisodes);
            const generated: StudioEpisodePlan[] = [];
            const rawPoolByBatch: unknown[][] = [];
            const rawChecksByBatch: StudioAdaptationCheck[][] = [];
            const numbers = request.kind === "full" ? targetAll : unlocked;
            const batches = Math.ceil(numbers.length / batchSize);
            for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
                const targetNumbers = numbers.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
                const progress = 50 + Math.round((batchIndex / Math.max(1, batches)) * 35);
                const raw = await ask(episodeBatchPrompt({
                    digest,
                    settings,
                    strategy: serialize(finalStrategy),
                    blueprint: serialize(finalBlueprint),
                    changes: changesForPrompt(changes),
                    foreshadowings: poolForPrompt(pool),
                    targetNumbers,
                    previousSummaries: previousSummaries(request.kind === "full" ? generated : [...existing.episodePlans, ...generated], targetNumbers[0]),
                    totalEpisodes: settings.targetEpisodes,
                    reason: request.reason,
                }), "episodes", progress, `规划第 ${targetNumbers[0]}-${targetNumbers[targetNumbers.length - 1]} 集…`);
                const batchPlans = normalizeEpisodePlans(ctx, raw, changes);
                ensureEpisodeBatch(batchPlans, targetNumbers, numbers);
                generated.push(...batchPlans.filter((plan) => numbers.includes(plan.episodeNumber)));
                const rawChanges = normalizeAdaptationChanges(ctx, (raw as Record<string, unknown>).changes, targetNumbers[0]);
                changes = mergeChangeLedger(changes, rawChanges, changes);
                if (Array.isArray((raw as Record<string, unknown>).foreshadowings)) rawPoolByBatch.push((raw as Record<string, unknown>).foreshadowings as unknown[]);
                rawChecksByBatch.push(normalizeModelChecks(ctx, raw));
                if (numbers.every((number) => generated.some((plan) => plan.episodeNumber === number))) break;
            }
            ensureEpisodeBatch(generated, numbers, numbers);
            plans = mergeEpisodePlans(existing.episodePlans, generated, lockedNumbers);
            const combinedPoolRaw = mergeRawPool(pool, ...rawPoolByBatch);
            let nextPool = normalizeForeshadowingPool(ctx, { foreshadowings: combinedPoolRaw }, plans);
            nextPool = reconcileForeshadowingStatuses(includeOriginalForeshadowings(ctx, nextPool), plans);

            generation = updateGeneration(generation, { stage: "synthesis", progress: 88, currentLabel: "生成人物弧光与全剧伏笔状态…" }, onGeneration);
            const synthesis = await ask(synthesisPrompt({
                digest: buildAdaptationSourceDigest(project, 12000),
                settings,
                strategy: serialize(finalStrategy),
                blueprint: serialize(finalBlueprint),
                plansSummary: plansSummary(plans, 16000),
                currentPool: poolForPrompt(nextPool),
            }), "synthesis", 90, "生成人物弧光与全剧伏笔状态…");
            const synthesisPoolRaw = Array.isArray((synthesis as Record<string, unknown>).foreshadowings) ? (synthesis as Record<string, unknown>).foreshadowings as unknown[] : [];
            nextPool = normalizeForeshadowingPool(ctx, { foreshadowings: mergeRawPool(nextPool, synthesisPoolRaw) }, plans);
            nextPool = reconcileForeshadowingStatuses(includeOriginalForeshadowings(ctx, nextPool), plans);
            const modelArcs = normalizeCharacterArcs(ctx, synthesis, plans);
            arcs = syncCharacterArcsFromPlans(ctx, modelArcs, plans);
            changes = mergeChangeLedger(changes, normalizeAdaptationChanges(ctx, (synthesis as Record<string, unknown>).changes, 0));
            checks = baseChecks(ctx, [...rawChecksByBatch.flat(), ...normalizeModelChecks(ctx, synthesis)], existing.checks);
            const validated = validateAdaptationPackage({ ctx, strategy: finalStrategy, blueprint: finalBlueprint, plans, arcs, foreshadowings: nextPool, changes, scope: "full" });
            checks = preserveCheckStatuses(mergeChecks(validated, checks), existing.checks);
            const summary = checkSummary(checks);
            generation = updateGeneration(generation, { progress: 96, currentLabel: `校验完成：${summary.errors} error / ${summary.warnings} warning / ${summary.suggestions} suggestion` }, onGeneration);
            proposal = buildProposal({
                existing,
                kind: request.kind,
                title: request.kind === "full" ? "全剧改编与分集规划提案" : "全剧分集规划提案",
                reason: request.reason ?? (request.kind === "full" ? "生成全剧改编与分集规划" : "生成全剧分集规划"),
                targetNumbers: numbers,
                strategy: finalStrategy,
                blueprint: finalBlueprint,
                plans: request.kind === "full" ? plans : generated,
                arcs,
                pool: nextPool,
                changes,
                checks,
            });
        }

        if (request.kind === "episode_regenerate") {
            const targetPlan = existing.episodePlans.find((plan) => plan.episodeNumber === unlocked[0]);
            if (!targetPlan) throw new AdaptationSchemaError("episode_missing", "目标集不存在");
            const digest = buildAdaptationSourceDigest(project, 14000);
            let raw: Record<string, unknown>;
            const module = request.module;
            if (module) {
                raw = await ask(episodeModulePrompt({
                    digest,
                    settings,
                    blueprint: serialize(existing.blueprint),
                    plan: serialize(targetPlan),
                    module,
                    label: ADAPTATION_MODULE_LABEL[module],
                    reason: request.reason,
                }), "regenerate", 70, `重生成第 ${targetPlan.episodeNumber} 集${ADAPTATION_MODULE_LABEL[module]}…`);
                const candidateRaw = (raw.episode ?? raw) as Record<string, unknown>;
                const mergedRaw = { ...targetPlan, ...candidateRaw, episodeNumber: targetPlan.episodeNumber, episodeId: targetPlan.episodeId };
                const candidate = normalizeEpisodePlans(ctx, { episodes: [mergedRaw] }, changes)[0];
                if (!candidate) throw new AdaptationSchemaError("episode_module_empty", "模型没有返回可用分集");
                plans = existing.episodePlans.map((plan) => plan.episodeNumber === targetPlan.episodeNumber ? { ...mergeModule(targetPlan, candidate, module), updatedAt: nowIso(), reviewStatus: "pending_review" } : plan);
            } else {
                raw = await ask(regenerationPrompt({
                    digest,
                    settings,
                    blueprint: serialize(existing.blueprint),
                    changes: changesForPrompt(changes),
                    currentPool: poolForPrompt(existing.foreshadowings),
                    targetPlans: serialize([targetPlan]),
                    targetNumbers: [targetPlan.episodeNumber],
                    lockedNumbers,
                    adjacentSummaries: adjacentSummaries(existing.episodePlans, [targetPlan.episodeNumber]),
                    totalEpisodes: settings.targetEpisodes,
                    reason: request.reason,
                }), "regenerate", 70, `重新生成第 ${targetPlan.episodeNumber} 集…`);
                const candidatePlans = normalizeEpisodePlans(ctx, raw, changes);
                ensureEpisodeBatch(candidatePlans, [targetPlan.episodeNumber]);
                plans = mergeEpisodePlans(existing.episodePlans, candidatePlans, lockedNumbers);
            }
            changes = mergeChangeLedger(changes, normalizeAdaptationChanges(ctx, raw.changes, targetPlan.episodeNumber));
            let nextPool = normalizeForeshadowingPool(ctx, { foreshadowings: mergeRawPool(existing.foreshadowings, Array.isArray(raw.foreshadowings) ? raw.foreshadowings as unknown[] : []) }, plans);
            nextPool = reconcileForeshadowingStatuses(includeOriginalForeshadowings(ctx, nextPool), plans);
            arcs = syncCharacterArcsFromPlans(ctx, existing.characterArcs, plans);
            checks = baseChecks(ctx, normalizeModelChecks(ctx, raw), existing.checks);
            const validated = validateAdaptationPackage({ ctx, strategy: finalStrategy, blueprint: finalBlueprint, plans, arcs, foreshadowings: nextPool, changes, scope: "episodes" });
            validateNeighborDependencies(ctx, existing.episodePlans, plans, [targetPlan.episodeNumber]);
            checks = preserveCheckStatuses(mergeChecks(validated, ctx.checks, checks), existing.checks);
            const changedPlans = plans.filter((plan) => unlocked.includes(plan.episodeNumber));
            proposal = buildProposal({
                existing,
                kind: "episode_regenerate",
                title: `第 ${targetPlan.episodeNumber} 集${request.module ? `「${ADAPTATION_MODULE_LABEL[request.module]}」` : ""}局部重生成提案`,
                reason: request.reason ?? "局部重生成",
                targetNumbers: [targetPlan.episodeNumber],
                plans: changedPlans,
                arcs,
                pool: nextPool,
                changes,
                checks,
            });
        }

        if (request.kind === "strategy" && !proposal) throw new AdaptationSchemaError("strategy_empty", "模型没有返回可用改编方案");
        if (request.kind === "blueprint" && !proposal) throw new AdaptationSchemaError("blueprint_empty", "模型没有返回可用全剧蓝图");
        if ((request.kind === "full" || request.kind === "episodes") && !proposal) throw new AdaptationSchemaError("episode_empty", "模型没有返回可用分集规划");
        if (request.kind === "episode_regenerate" && !proposal) throw new AdaptationSchemaError("regen_empty", "模型没有返回可用局部修改");
        if (!proposal) throw new AdaptationSchemaError("proposal_missing", "模型没有返回可用结果");

        const proposalId = proposal.id;
        generation = updateGeneration(generation, {
            status: "succeeded",
            stage: "done",
            progress: 100,
            outputVersion: existing.versionNumber + 1,
            outputProposalId: proposalId,
            currentLabel: "生成完成，等待用户审核确认",
            finishedAt: nowIso(),
        }, onGeneration);
        return { generation, proposal };
    } catch (error) {
        const aborted = isAbortError(error) || Boolean(signal?.aborted);
        const status = aborted ? "canceled" as const : "failed" as const;
        generation = updateGeneration(generation, {
            status,
            stage: generation.stage,
            currentLabel: aborted ? "生成已取消" : "生成失败",
            error: aborted ? "用户取消生成" : errorText(error),
            finishedAt: nowIso(),
        }, onGeneration);
        return { generation, error: aborted ? "用户取消生成" : errorText(error) };
    } finally {
        activeByProject.delete(project.id);
    }
}

export function estimateAdaptationGenerationCalls(settings: StudioAdaptationSettings, request: AdaptationGenerationRequest) {
    const target = request.kind === "full" || request.kind === "episodes" ? settings.targetEpisodes : request.targetNumbers?.length ?? 0;
    return estimateAdaptationCalls(settings, request.kind, target);
}

export function describeAdaptationGeneration(kind: StudioAdaptationGenerationKind) {
    const labels: Record<StudioAdaptationGenerationKind, string> = {
        full: "全剧改编与分集规划",
        strategy: "改编方案",
        blueprint: "全剧蓝图",
        episodes: "全剧分集规划",
        episode_regenerate: "局部重生成",
    };
    return labels[kind];
}

function uniqueNumbers(numbers: number[]) {
    return [...new Set(numbers.map((number) => Math.max(1, Math.round(number))).filter(Number.isFinite))].sort((left, right) => left - right);
}

function parseJson(text: string) {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = cleaned.indexOf("{");
    if (start < 0) throw new AdaptationSchemaError("invalid_json", "模型返回没有 JSON 对象");
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < cleaned.length; index += 1) {
        const char = cleaned[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === "\"") inString = false;
            continue;
        }
        if (char === "\"") inString = true;
        else if (char === "{") depth += 1;
        else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                end = index;
                break;
            }
        }
    }
    if (end < 0) throw new AdaptationSchemaError("json_truncated", `模型输出在 JSON 对象结束前被截断（已收到 ${cleaned.length} 字符）；请减少单批集数或提高单次最大输出 tokens 后重试。`);
    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON 根节点不是对象");
        return parsed as Record<string, unknown>;
    } catch (error) {
        throw new AdaptationSchemaError("invalid_json", `模型返回不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
}
