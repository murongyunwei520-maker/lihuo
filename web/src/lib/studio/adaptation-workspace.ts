// 阶段 2B 项目内工作区的默认值、兼容归一化、版本快照与提案应用。
// 所有变化都发生在 StudioProject.adaptation 内，不创建第二个项目根对象。

import {
    ADAPTATION_MAX_EPISODE_SECONDS,
    ADAPTATION_MAX_EPISODES,
    ADAPTATION_MIN_EPISODE_SECONDS,
    type StudioAdaptationCheck,
    type StudioAdaptationChange,
    type StudioAdaptationHandoff,
    type StudioAdaptationHistoryEntry,
    type StudioAdaptationProposal,
    type StudioAdaptationProposalDiffItem,
    type StudioAdaptationSettings,
    type StudioAdaptationSnapshot,
    type StudioAdaptationStrategy,
    type StudioAdaptationWorkspace,
    type StudioCharacterArc,
    type StudioEpisodePlan,
    type StudioEpisodePlanCore,
    type StudioForeshadowingPoolItem,
    type StudioSeriesBlueprint,
} from "@/types/studio-adaptation";
import type { StudioProject } from "@/types/studio";
import { simpleHash } from "./novel-chapters";

const REVIEW_VALUES = ["draft", "pending_review", "approved", "locked"] as const;
const GENERATION_VALUES = ["queued", "running", "succeeded", "failed", "canceled", "interrupted", "unknown"] as const;
const ORIGIN_VALUES = ["explicit", "inferred", "generated"] as const;

const nowIso = () => new Date().toISOString();

/** 工作区核心层的审核门禁错误；UI 层只负责提示，不能作为唯一防线。 */
export class AdaptationReviewError extends Error {
    readonly code = "high_risk_pending";
    readonly changes: StudioAdaptationChange[];

    constructor(changes: StudioAdaptationChange[]) {
        super(`还有 ${changes.length} 条高风险改编未逐条确认，不能接受提案`);
        this.name = "AdaptationReviewError";
        this.changes = changes;
    }
}

function canonicalChanges(current?: StudioAdaptationWorkspace) {
    const map = new Map<string, StudioAdaptationChange>();
    for (const change of [...(current?.strategy?.changes ?? []), ...(current?.changes ?? [])]) {
        map.set(change.adaptationChangeId, change);
    }
    return map;
}

/**
 * 提案自身携带的高风险改编；接受前必须在核心层再次校验。
 * highRisk / riskTags / reviewStatus 都不能只信提案里的副本：提案可被篡改成
 * highRisk=false 或 approved，核心层必须回到当前工作区的 canonical ledger。
 */
export function highRiskChangesInProposal(proposal: StudioAdaptationProposal, current?: StudioAdaptationWorkspace): StudioAdaptationChange[] {
    const canonical = canonicalChanges(current);
    const changes = [...(proposal.changes ?? []), ...(proposal.strategy?.changes ?? [])];
    const blocked = new Map<string, StudioAdaptationChange>();
    for (const change of changes) {
        const existing = canonical.get(change.adaptationChangeId);
        const highRisk = Boolean(change.highRisk || (change.riskTags?.length ?? 0) > 0 || existing?.highRisk || (existing?.riskTags?.length ?? 0) > 0);
        if (!highRisk) continue;
        const reviewStatus = existing?.reviewStatus ?? change.reviewStatus;
        if (reviewStatus === "approved" || reviewStatus === "locked") continue;
        if (!blocked.has(change.adaptationChangeId)) blocked.set(change.adaptationChangeId, { ...change, highRisk: true, reviewStatus });
    }
    return [...blocked.values()];
}


function asText(value: unknown, fallback = "") {
    return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function asInt(value: unknown, fallback = 0) {
    return Math.round(asNumber(value, fallback));
}

function asBool(value: unknown, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
}

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function asStrings(value: unknown): string[] {
    return asArray<unknown>(value).map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function asReview(value: unknown, fallback: StudioAdaptationStrategy["reviewStatus"] = "pending_review") {
    return REVIEW_VALUES.includes(value as (typeof REVIEW_VALUES)[number]) ? (value as StudioAdaptationStrategy["reviewStatus"]) : fallback;
}

function asOrigin(value: unknown, fallback: (typeof ORIGIN_VALUES)[number] = "generated") {
    return ORIGIN_VALUES.includes(value as (typeof ORIGIN_VALUES)[number]) ? (value as (typeof ORIGIN_VALUES)[number]) : fallback;
}

function clampEpisodes(value: unknown, fallback = 12) {
    return Math.max(1, Math.min(ADAPTATION_MAX_EPISODES, asInt(value, fallback)) || fallback);
}

function clampSeconds(value: unknown, fallback = 60) {
    return Math.max(ADAPTATION_MIN_EPISODE_SECONDS, Math.min(ADAPTATION_MAX_EPISODE_SECONDS, asInt(value, fallback)) || fallback);
}

function emptySource() {
    return { chapterIds: [], eventIds: [], sceneIds: [], foreshadowingIds: [], evidence: [] };
}

export function createDefaultAdaptationSettings(project: StudioProject): StudioAdaptationSettings {
    const analysis = project.novelAnalysis;
    return {
        genre: project.genre || analysis?.profile.genre || "",
        audience: "",
        platform: "",
        targetEpisodes: clampEpisodes(project.episodes.length || 12),
        targetEpisodeSeconds: clampSeconds(project.settings.targetSeconds || 60),
        narrativeStyle: "",
        tone: "",
        strength: "balanced",
        endingDirection: "",
        requirements: "",
        prohibitions: "不得为制造爽点改变人物性格、行为逻辑；AI 新增内容不得伪装成原著事实。",
        updatedAt: nowIso(),
    };
}

export function createStudioAdaptationWorkspace(project: StudioProject): StudioAdaptationWorkspace {
    const now = nowIso();
    return {
        version: 1,
        settings: createDefaultAdaptationSettings(project),
        episodePlans: [],
        characterArcs: [],
        foreshadowings: [],
        changes: [],
        checks: [],
        proposals: [],
        history: [],
        generations: [],
        versionNumber: 0,
        createdAt: now,
        updatedAt: now,
    };
}

export function normalizeStudioAdaptation(project: StudioProject, value: StudioAdaptationWorkspace | undefined): StudioAdaptationWorkspace {
    const fallback = createStudioAdaptationWorkspace(project);
    if (!value || typeof value !== "object" || value.version !== 1) return fallback;
    const settings = normalizeSettings(value.settings, fallback.settings);
    const now = nowIso();
    const generations = asArray<StudioAdaptationWorkspace["generations"][number]>(value.generations).map((item, index) => {
        const status = GENERATION_VALUES.includes(item.status) ? item.status : "unknown";
        const interrupted = status === "queued" || status === "running";
        return {
            id: asText(item.id, `gen-${index + 1}`),
            kind: ["full", "strategy", "blueprint", "episodes", "episode_regenerate"].includes(item.kind) ? item.kind : "full",
            stage: ["prepare", "strategy", "blueprint", "episodes", "synthesis", "regenerate", "validate", "done"].includes(item.stage) ? item.stage : "prepare",
            status: interrupted ? "interrupted" as const : status,
            progress: Math.max(0, Math.min(100, asInt(item.progress))),
            currentLabel: interrupted ? "本地生成已中断；未自动重发" : asText(item.currentLabel),
            model: item.model ?? { channelId: "", modelId: "", label: "" },
            modelParams: item.modelParams ?? {},
            inputVersion: asInt(item.inputVersion),
            outputVersion: item.outputVersion,
            sourceAnalysisVersion: asInt(item.sourceAnalysisVersion),
            settingsSnapshot: normalizeSettings(item.settingsSnapshot, settings),
            targetEpisodeNumbers: asArray<number>(item.targetEpisodeNumbers),
            lockedEpisodeNumbers: asArray<number>(item.lockedEpisodeNumbers),
            calls: asInt(item.calls),
            inputChars: asInt(item.inputChars),
            promptHash: asText(item.promptHash),
            outputProposalId: item.outputProposalId,
            error: interrupted ? "页面刷新或持久化恢复时任务仍在运行；为避免重复计费，未自动重发" : item.error,
            createdAt: asText(item.createdAt, now),
            startedAt: item.startedAt,
            updatedAt: asText(item.updatedAt, now),
            finishedAt: interrupted ? now : item.finishedAt,
            cancelRequestedAt: item.cancelRequestedAt,
        };
    });
    return {
        version: 1,
        settings,
        strategy: value.strategy ? normalizeStrategy(value.strategy, project) : undefined,
        blueprint: value.blueprint ? normalizeBlueprint(value.blueprint, project) : undefined,
        episodePlans: asArray<StudioEpisodePlan>(value.episodePlans).map(normalizeEpisodePlan),
        characterArcs: asArray<StudioCharacterArc>(value.characterArcs).map(normalizeCharacterArc),
        foreshadowings: asArray<StudioForeshadowingPoolItem>(value.foreshadowings).map(normalizeForeshadowing),
        changes: asArray<StudioAdaptationWorkspace["changes"][number]>(value.changes).map((change, index) => ({
            ...change,
            adaptationChangeId: asText(change.adaptationChangeId, `change-${index + 1}`),
            sourceReferences: change.sourceReferences ?? emptySource(),
            episodeNumbers: asArray<number>(change.episodeNumbers),
            riskTags: asArray(change.riskTags),
            highRisk: asBool(change.highRisk, asArray(change.riskTags).length > 0),
            reviewStatus: asReview(change.reviewStatus),
            createdAt: asText(change.createdAt, now),
        })),
        checks: asArray<StudioAdaptationCheck>(value.checks).map((check, index) => ({
            ...check,
            id: asText(check.id, `check-${index + 1}`),
            level: ["error", "warning", "suggestion"].includes(check.level) ? check.level : "warning",
            code: asText(check.code, "business_rule"),
            category: asText(check.category, "剧情校验"),
            message: asText(check.message),
            suggestion: asText(check.suggestion),
            episodeNumbers: asArray<number>(check.episodeNumbers),
            characterIds: asArray<string>(check.characterIds),
            eventIds: asArray<string>(check.eventIds),
            sceneIds: asArray<string>(check.sceneIds),
            source: check.source === "model" ? "model" : "deterministic",
            status: ["open", "accepted", "ignored", "resolved"].includes(check.status) ? check.status : "open",
            createdAt: asText(check.createdAt, now),
        })),
        proposals: asArray<StudioAdaptationProposal>(value.proposals)
            .filter((proposal) => proposal && typeof proposal === "object")
            .slice(-8)
            .map((proposal) => ({
                ...proposal,
                status: proposal.status === "accepted" || proposal.status === "rejected" ? proposal.status : "pending",
                episodePlans: proposal.episodePlans?.map(normalizeEpisodePlan),
                characterArcs: proposal.characterArcs?.map(normalizeCharacterArc),
                foreshadowings: proposal.foreshadowings?.map(normalizeForeshadowing),
                checks: proposal.checks?.map((check) => check),
                diff: proposal.diff ?? { strategyChanged: false, blueprintChanged: false, episodesAdded: [], episodesRemoved: [], episodesChanged: [], notes: [], items: [] },
            })),
        history: asArray<StudioAdaptationHistoryEntry>(value.history).slice(-8).map((entry, index) => ({
            id: asText(entry.id, `history-${index + 1}`),
            version: asInt(entry.version),
            createdAt: asText(entry.createdAt, now),
            reason: asText(entry.reason),
            snapshot: {
                strategy: entry.snapshot?.strategy ? normalizeStrategy(entry.snapshot.strategy, project) : undefined,
                blueprint: entry.snapshot?.blueprint ? normalizeBlueprint(entry.snapshot.blueprint, project) : undefined,
                episodePlans: (entry.snapshot?.episodePlans ?? []).map(normalizeEpisodePlan),
                characterArcs: (entry.snapshot?.characterArcs ?? []).map(normalizeCharacterArc),
                foreshadowings: (entry.snapshot?.foreshadowings ?? []).map(normalizeForeshadowing),
                changes: entry.snapshot?.changes ?? [],
                checks: entry.snapshot?.checks ?? [],
            },
        })),
        generations,
        // 恢复时所有运行中生成已改为 interrupted；必须由用户手动重试，不能自动复活。
        activeGenerationId: undefined,
        versionNumber: Math.max(0, asInt(value.versionNumber)),
        createdAt: asText(value.createdAt, now),
        updatedAt: asText(value.updatedAt, now),
    };
}

function normalizeSettings(value: StudioAdaptationSettings | undefined, fallback: StudioAdaptationSettings): StudioAdaptationSettings {
    if (!value || typeof value !== "object") return fallback;
    return {
        genre: asText(value.genre, fallback.genre),
        audience: asText(value.audience),
        platform: asText(value.platform),
        targetEpisodes: clampEpisodes(value.targetEpisodes, fallback.targetEpisodes),
        targetEpisodeSeconds: clampSeconds(value.targetEpisodeSeconds, fallback.targetEpisodeSeconds),
        narrativeStyle: asText(value.narrativeStyle),
        tone: asText(value.tone),
        strength: value.strength === "faithful" || value.strength === "strong" ? value.strength : "balanced",
        endingDirection: asText(value.endingDirection),
        requirements: asText(value.requirements),
        prohibitions: asText(value.prohibitions, fallback.prohibitions),
        updatedAt: asText(value.updatedAt, fallback.updatedAt),
    };
}

function normalizeStrategy(value: StudioAdaptationStrategy, project: StudioProject): StudioAdaptationStrategy {
    return {
        ...value,
        id: asText(value.id, "strategy"),
        version: Math.max(1, asInt(value.version, 1)),
        reviewStatus: asReview(value.reviewStatus),
        locked: asBool(value.locked),
        logline: asText(value.logline),
        positioningSummary: asText(value.positioningSummary),
        structureStrategy: asText(value.structureStrategy),
        characterStrategy: asText(value.characterStrategy),
        conflictStrategy: asText(value.conflictStrategy),
        foreshadowingStrategy: asText(value.foreshadowingStrategy),
        endingStrategy: asText(value.endingStrategy),
        episodeCountPlan: asText(value.episodeCountPlan),
        warnings: asStrings(value.warnings),
        changes: asArray(value.changes),
        sourceAnalysisVersion: asInt(value.sourceAnalysisVersion, project.novelAnalysis?.version ?? 0),
        sourceNovelHash: asText(value.sourceNovelHash, project.novel?.file.hash ?? ""),
        createdAt: asText(value.createdAt, nowIso()),
        updatedAt: asText(value.updatedAt, nowIso()),
    };
}

function normalizeBlueprint(value: StudioSeriesBlueprint, project: StudioProject): StudioSeriesBlueprint {
    return {
        ...value,
        id: asText(value.id, "blueprint"),
        version: Math.max(1, asInt(value.version, 1)),
        reviewStatus: asReview(value.reviewStatus),
        locked: asBool(value.locked),
        theme: asText(value.theme),
        logline: asText(value.logline),
        mainline: asText(value.mainline),
        centralConflict: asText(value.centralConflict),
        protagonistGoals: asStrings(value.protagonistGoals),
        antagonist: value.antagonist ?? { name: "", motivation: "", pressure: "" },
        relationshipEvolution: asText(value.relationshipEvolution),
        stages: asArray(value.stages),
        keyEvents: asArray(value.keyEvents),
        climax: asText(value.climax),
        ending: asText(value.ending),
        foreshadowingPlan: asText(value.foreshadowingPlan),
        characters: asArray(value.characters),
        relationships: asArray(value.relationships),
        locations: asArray(value.locations),
        timeline: asText(value.timeline),
        sourceAnalysisVersion: asInt(value.sourceAnalysisVersion, project.novelAnalysis?.version ?? 0),
        sourceNovelHash: asText(value.sourceNovelHash, project.novel?.file.hash ?? ""),
        createdAt: asText(value.createdAt, nowIso()),
        updatedAt: asText(value.updatedAt, nowIso()),
    };
}

function normalizeEpisodePlanCore(value: StudioEpisodePlan): StudioEpisodePlanCore {
    const number = Math.max(1, asInt(value.episodeNumber, 1));
    return {
        episodeId: asText(value.episodeId, `ep-${String(number).padStart(3, "0")}`),
        episodeNumber: number,
        episodeTitle: asText(value.episodeTitle, `第 ${number} 集`),
        episodeLogline: asText(value.episodeLogline),
        episodeSynopsis: asText(value.episodeSynopsis),
        dramaticGoal: asText(value.dramaticGoal),
        openingHook: asText(value.openingHook),
        mainConflict: asText(value.mainConflict),
        keyEvents: asArray(value.keyEvents),
        characterAppearances: asArray(value.characterAppearances),
        characterStates: asArray(value.characterStates),
        characterRelationshipChanges: asArray(value.characterRelationshipChanges),
        locations: asArray(value.locations),
        emotionalProgression: asStrings(value.emotionalProgression),
        climax: asText(value.climax),
        endingHook: asText(value.endingHook),
        foreshadowingIntroduced: asStrings(value.foreshadowingIntroduced),
        foreshadowingAdvanced: asStrings(value.foreshadowingAdvanced),
        foreshadowingResolved: asStrings(value.foreshadowingResolved),
        continuityDependencies: asStrings(value.continuityDependencies),
        estimatedDuration: clampSeconds(value.estimatedDuration, 60),
        sourceReferences: value.sourceReferences ?? emptySource(),
        adaptationChanges: asArray(value.adaptationChanges),
        reviewStatus: asReview(value.reviewStatus),
        version: Math.max(1, asInt(value.version, 1)),
        createdAt: asText(value.createdAt, nowIso()),
        updatedAt: asText(value.updatedAt, nowIso()),
    };
}

function normalizeEpisodePlan(value: StudioEpisodePlan): StudioEpisodePlan {
    const core = normalizeEpisodePlanCore(value);
    return {
        ...core,
        locked: asBool(value.locked),
        versions: asArray<StudioEpisodePlan["versions"][number]>(value.versions).slice(-5).map((version, index) => ({
            id: asText(version.id, `${core.episodeId}-v${index + 1}`),
            version: Math.max(1, asInt(version.version, index + 1)),
            createdAt: asText(version.createdAt, nowIso()),
            reason: asText(version.reason),
            plan: normalizeEpisodePlanCore(version.plan as StudioEpisodePlan),
        })),
    };
}

function normalizeCharacterArc(value: StudioCharacterArc): StudioCharacterArc {
    return {
        ...value,
        characterId: asText(value.characterId),
        characterName: asText(value.characterName),
        version: Math.max(1, asInt(value.version, 1)),
        initialState: asText(value.initialState),
        coreGoal: asText(value.coreGoal),
        innerConflict: asText(value.innerConflict),
        flaw: asText(value.flaw),
        turningPoints: asArray(value.turningPoints),
        keyChoices: asArray(value.keyChoices),
        relationshipChanges: asArray(value.relationshipChanges),
        finalState: asText(value.finalState),
        milestones: asArray(value.milestones),
        timeline: asArray(value.timeline),
        reviewStatus: asReview(value.reviewStatus),
        createdAt: asText(value.createdAt, nowIso()),
        updatedAt: asText(value.updatedAt, nowIso()),
    };
}

function normalizeForeshadowing(value: StudioForeshadowingPoolItem): StudioForeshadowingPoolItem {
    const status = ["planned", "planted", "advancing", "resolved", "abandoned", "pending_review"].includes(value.status) ? value.status : "pending_review";
    return {
        ...value,
        foreshadowingId: asText(value.foreshadowingId, `fore-${Math.random().toString(36).slice(2, 7)}`),
        content: asText(value.content),
        sourceType: asOrigin(value.sourceType),
        sourceNovelForeshadowingId: asText(value.sourceNovelForeshadowingId),
        firstPlantedEpisode: asInt(value.firstPlantedEpisode),
        advancedEpisodes: asArray<number>(value.advancedEpisodes),
        expectedResolveEpisode: asInt(value.expectedResolveEpisode),
        actualResolveEpisode: typeof value.actualResolveEpisode === "number" ? value.actualResolveEpisode : undefined,
        relatedCharacterIds: asArray<string>(value.relatedCharacterIds),
        relatedEventIds: asArray<string>(value.relatedEventIds),
        status,
        isOriginal: asBool(value.isOriginal),
        isAiAdded: asBool(value.isAiAdded),
        reviewStatus: asReview(value.reviewStatus),
        createdAt: asText(value.createdAt, nowIso()),
        updatedAt: asText(value.updatedAt, nowIso()),
    };
}

export function adaptationSnapshot(value: StudioAdaptationWorkspace): StudioAdaptationSnapshot {
    return {
        strategy: value.strategy,
        blueprint: value.blueprint,
        episodePlans: value.episodePlans.map((plan) => ({ ...plan })),
        characterArcs: value.characterArcs.map((arc) => ({ ...arc })),
        foreshadowings: value.foreshadowings.map((item) => ({ ...item })),
        changes: value.changes.map((item) => ({ ...item })),
        checks: value.checks.map((item) => ({ ...item })),
    };
}

export function createAdaptationHistoryEntry(value: StudioAdaptationWorkspace, reason: string, version = value.versionNumber): StudioAdaptationHistoryEntry {
    return {
        id: `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        version,
        createdAt: nowIso(),
        reason,
        snapshot: adaptationSnapshot(value),
    };
}

export function episodePlanCore(plan: StudioEpisodePlan): StudioEpisodePlanCore {
    const { locked: _locked, versions: _versions, ...core } = plan;
    return core;
}

const EPISODE_DIFF_FIELDS: Array<{ key: keyof StudioEpisodePlan; label: string }> = [
    { key: "episodeTitle", label: "标题" },
    { key: "episodeLogline", label: "logline" },
    { key: "episodeSynopsis", label: "剧情概要" },
    { key: "dramaticGoal", label: "戏剧目标" },
    { key: "openingHook", label: "开场钩子" },
    { key: "mainConflict", label: "核心冲突" },
    { key: "keyEvents", label: "关键事件" },
    { key: "characterAppearances", label: "人物出场" },
    { key: "characterStates", label: "人物状态" },
    { key: "characterRelationshipChanges", label: "关系变化" },
    { key: "locations", label: "地点" },
    { key: "emotionalProgression", label: "情绪推进" },
    { key: "climax", label: "高潮" },
    { key: "endingHook", label: "集尾钩子" },
    { key: "foreshadowingIntroduced", label: "新埋伏笔" },
    { key: "foreshadowingAdvanced", label: "推进伏笔" },
    { key: "foreshadowingResolved", label: "回收伏笔" },
    { key: "continuityDependencies", label: "连续性依赖" },
    { key: "estimatedDuration", label: "时长" },
    { key: "sourceReferences", label: "原著依据" },
    { key: "adaptationChanges", label: "改编记录" },
];

function diffValue(value: unknown) {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) {
        return value.map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
                const record = item as Record<string, unknown>;
                const summary = record.description ?? record.name ?? record.change ?? record.purpose;
                if (typeof summary === "string") return summary;
            }
            return JSON.stringify(item);
        }).filter(Boolean).join("；");
    }
    return JSON.stringify(value);
}

function clipDiff(value: unknown) {
    const text = diffValue(value);
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

export function diffAgainstCurrent(current: StudioAdaptationWorkspace, proposal: StudioAdaptationProposal): StudioAdaptationProposal["diff"] {
    const items: StudioAdaptationProposalDiffItem[] = [];
    const notes: string[] = [];
    const strategyChanged = Boolean(proposal.strategy && JSON.stringify(current.strategy ?? null) !== JSON.stringify(proposal.strategy));
    const blueprintChanged = Boolean(proposal.blueprint && JSON.stringify(current.blueprint ?? null) !== JSON.stringify(proposal.blueprint));
    if (strategyChanged) items.push({ target: "strategy", key: "strategy", label: "改编方案", before: current.strategy?.logline ?? "", after: proposal.strategy?.logline ?? "" });
    if (blueprintChanged) items.push({ target: "blueprint", key: "blueprint", label: "全剧蓝图", before: current.blueprint?.logline ?? "", after: proposal.blueprint?.logline ?? "" });
    const currentByNumber = new Map(current.episodePlans.map((plan) => [plan.episodeNumber, plan]));
    const afterByNumber = new Map((proposal.episodePlans ?? []).map((plan) => [plan.episodeNumber, plan]));
    const scope = new Set(proposal.targetEpisodeNumbers.length ? proposal.targetEpisodeNumbers : [...afterByNumber.keys()]);
    const episodesAdded = [...afterByNumber.keys()].filter((number) => !currentByNumber.has(number)).sort((left, right) => left - right);
    const episodesRemoved = [...currentByNumber.keys()].filter((number) => scope.has(number) && !afterByNumber.has(number)).sort((left, right) => left - right);
    const episodesChanged: number[] = [];
    for (const [number, after] of afterByNumber) {
        const before = currentByNumber.get(number);
        if (!before) continue;
        const changedFields = EPISODE_DIFF_FIELDS.filter((field) => JSON.stringify(before[field.key]) !== JSON.stringify(after[field.key]));
        if (!changedFields.length) continue;
        episodesChanged.push(number);
        for (const field of changedFields) {
            items.push({
                target: "episode",
                key: `${number}-${String(field.key)}`,
                label: `第 ${number} 集 · ${field.label}`,
                before: clipDiff(before[field.key]),
                after: clipDiff(after[field.key]),
            });
        }
    }
    if (episodesAdded.length) notes.push(`新增集数：${episodesAdded.join("、")}`);
    if (episodesRemoved.length) notes.push(`移除集数：${episodesRemoved.join("、")}`);
    if (episodesChanged.length) notes.push(`内容变化：第 ${episodesChanged.join("、")} 集`);
    if (proposal.characterArcs?.length) notes.push(`人物弧光候选 ${proposal.characterArcs.length} 条`);
    if (proposal.foreshadowings?.length) notes.push(`伏笔池候选 ${proposal.foreshadowings.length} 条`);
    if (proposal.checks?.length) notes.push(`校验结果 ${proposal.checks.length} 条`);
    return {
        strategyChanged,
        blueprintChanged,
        episodesAdded,
        episodesRemoved,
        episodesChanged: episodesChanged.sort((left, right) => left - right),
        notes,
        items,
    };
}

export function applyProposalToWorkspace(current: StudioAdaptationWorkspace, proposal: StudioAdaptationProposal, accept: boolean): StudioAdaptationWorkspace {
    const now = nowIso();
    if (accept) {
        const blockers = highRiskChangesInProposal(proposal, current);
        if (blockers.length) throw new AdaptationReviewError(blockers);
    }
    const proposalWithDiff = { ...proposal, status: accept ? "accepted" as const : "rejected" as const, diff: diffAgainstCurrent(current, proposal) };
    if (!accept) {
        return {
            ...current,
            proposals: [...current.proposals.filter((item) => item.id !== proposal.id), proposalWithDiff].slice(-8),
            updatedAt: now,
        };
    }
    const history = [
        ...current.history,
        createAdaptationHistoryEntry(current, `确认${proposal.title}`, current.versionNumber),
    ].slice(-8);
    const strategy = proposal.strategy && !current.strategy?.locked ? proposal.strategy : current.strategy;
    const blueprint = proposal.blueprint && !current.blueprint?.locked ? proposal.blueprint : current.blueprint;
    let plans = current.episodePlans;
    if (proposal.episodePlans?.length) {
        const merged = new Map(current.episodePlans.map((plan) => [plan.episodeNumber, plan]));
        for (const candidate of proposal.episodePlans) {
            const existing = merged.get(candidate.episodeNumber);
            if (existing?.locked) continue;
            const nextVersion = (existing?.version ?? 0) + 1;
            const oldVersions = existing ? [...existing.versions, {
                id: `${candidate.episodeId}-v${existing.version}`,
                version: existing.version,
                createdAt: existing.updatedAt,
                reason: proposal.reason,
                plan: episodePlanCore(existing),
            }].slice(-5) : [];
            merged.set(candidate.episodeNumber, {
                ...candidate,
                version: nextVersion,
                versions: oldVersions,
                locked: false,
                reviewStatus: "pending_review",
                updatedAt: now,
            });
        }
        plans = [...merged.values()].sort((left, right) => left.episodeNumber - right.episodeNumber);
    }
    return {
        ...current,
        strategy,
        blueprint,
        episodePlans: plans,
        characterArcs: proposal.characterArcs ?? current.characterArcs,
        foreshadowings: proposal.foreshadowings ?? current.foreshadowings,
        changes: proposal.changes ?? current.changes,
        checks: proposal.checks ?? current.checks,
        proposals: [...current.proposals.filter((item) => item.id !== proposal.id), proposalWithDiff].slice(-8),
        history,
        versionNumber: current.versionNumber + 1,
        updatedAt: now,
    };
}

export function lockedEpisodeNumbers(value: StudioAdaptationWorkspace) {
    return value.episodePlans.filter((plan) => plan.locked).map((plan) => plan.episodeNumber).sort((left, right) => left - right);
}

export function adaptationReviewProgress(value: StudioAdaptationWorkspace) {
    const strategy = value.strategy ? [value.strategy.reviewStatus] : [];
    const blueprint = value.blueprint ? [value.blueprint.reviewStatus] : [];
    const episodes = value.episodePlans.map((plan) => plan.reviewStatus);
    const approved = [...strategy, ...blueprint, ...episodes].filter((status) => status === "approved" || status === "locked").length;
    const total = strategy.length + blueprint.length + episodes.length;
    return { approved, total, percent: total ? Math.round((approved / total) * 100) : 0 };
}

export function adaptationHandoff(value: StudioAdaptationWorkspace, projectId: string, analysisVersion: number): StudioAdaptationHandoff | undefined {
    if (!value.blueprint || !value.episodePlans.length) return undefined;
    const snapshotBasis = {
        projectId,
        analysisVersion,
        blueprintId: value.blueprint.id,
        blueprintVersion: value.blueprint.version,
        packageVersion: value.versionNumber,
        lockedBlueprint: value.blueprint.locked,
        plans: value.episodePlans.map((plan) => [`${plan.episodeId}:${plan.version}:${plan.reviewStatus}:${plan.locked}`]),
        checks: value.checks.map((check) => [`${check.id}:${check.level}:${check.status}`]),
    };
    const snapshotId = `handoff-${simpleHash(JSON.stringify(snapshotBasis))}`;
    return {
        projectId,
        analysisVersion,
        blueprintId: value.blueprint.id,
        blueprintVersion: value.blueprint.version,
        blueprint: value.blueprint,
        packageVersion: value.versionNumber,
        episodePlans: value.episodePlans,
        characterArcs: value.characterArcs,
        foreshadowings: value.foreshadowings,
        changes: value.changes,
        checks: value.checks,
        settings: value.settings,
        blueprintReviewStatus: value.blueprint.reviewStatus,
        strategyReviewStatus: value.strategy?.reviewStatus ?? "draft",
        lockedEpisodeNumbers: lockedEpisodeNumbers(value),
        lockedBlueprint: value.blueprint.locked,
        snapshotId,
        createdAt: nowIso(),
    };
}
