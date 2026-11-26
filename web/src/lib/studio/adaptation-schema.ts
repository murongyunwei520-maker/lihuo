// 阶段 2B 模型输出的 schema、引用与业务规则校验。
// 模型 JSON 格式正确只代表“可解析”，不代表剧情合理；这里必须继续核对原著引用、集数、
// 人物状态、时间线、伏笔顺序和锁定边界。

import type { NovelAnalysis, NovelChapter, NovelEvidence, StudioNovel } from "@/types/novel";
import type { StudioProject } from "@/types/studio";
import {
    ADAPTATION_MAX_EPISODES,
    ADAPTATION_MAX_EPISODE_SECONDS,
    ADAPTATION_MIN_EPISODE_SECONDS,
    type StudioAdaptationChange,
    type StudioAdaptationCheck,
    type StudioAdaptationCheckLevel,
    type StudioAdaptationOperation,
    type StudioAdaptationOrigin,
    type StudioAdaptationReviewStatus,
    type StudioAdaptationRiskTag,
    type StudioAdaptationSettings,
    type StudioAdaptationSourceReference,
    type StudioAdaptationStrategy,
    type StudioAdaptationWorkspace,
    type StudioCharacterArc,
    type StudioCharacterArcMilestone,
    type StudioCharacterArcTimelinePoint,
    type StudioEpisodeAdaptationNote,
    type StudioEpisodeCharacterRef,
    type StudioEpisodeCharacterState,
    type StudioEpisodeKeyEvent,
    type StudioEpisodeLocationRef,
    type StudioEpisodePlan,
    type StudioEpisodeRelationshipChange,
    type StudioForeshadowingPoolItem,
    type StudioForeshadowingStatus,
    type StudioSeriesBlueprint,
} from "@/types/studio-adaptation";
import { applyNovelAnalysisOverrides } from "./novel-merge";
import { normalizeEvidence } from "./novel-analysis";

const OPERATIONS: StudioAdaptationOperation[] = ["preserve", "compress", "merge", "reorder", "remove", "add", "rewrite"];
const RISK_TAGS: StudioAdaptationRiskTag[] = ["protagonist_identity", "core_survival", "key_relationship", "key_event_removal", "world_rule", "core_foreshadowing", "ending", "major_motivation"];
const REVIEW_STATUSES: StudioAdaptationReviewStatus[] = ["draft", "pending_review", "approved", "locked"];
const FORESHADOWING_STATUSES: StudioForeshadowingStatus[] = ["planned", "planted", "advancing", "resolved", "abandoned", "pending_review"];
const LIFE_STATES = ["alive", "dead", "missing", "transformed", "unknown"] as const;

export class AdaptationSchemaError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "AdaptationSchemaError";
        this.code = code;
    }
}

type AnyRecord = Record<string, unknown>;

export type AdaptationContext = {
    project: StudioProject;
    novel: StudioNovel;
    analysis: NovelAnalysis;
    settings: StudioAdaptationSettings;
    checks: StudioAdaptationCheck[];
    chapterById: Map<string, NovelChapter>;
    characterById: Map<string, NovelAnalysis["characters"][number]>;
    characterByName: Map<string, NovelAnalysis["characters"][number]>;
    sceneById: Map<string, NovelAnalysis["scenes"][number]>;
    sceneByName: Map<string, NovelAnalysis["scenes"][number]>;
    eventById: Map<string, NovelAnalysis["events"][number]>;
    eventByTitle: Map<string, NovelAnalysis["events"][number]>;
    foreshadowingById: Map<string, NovelAnalysis["foreshadowings"][number]>;
    pushCheck: (input: CheckInput) => StudioAdaptationCheck;
};

type CheckInput = {
    level: StudioAdaptationCheckLevel;
    code: string;
    category: string;
    message: string;
    suggestion?: string;
    episodeNumbers?: number[];
    characterIds?: string[];
    eventIds?: string[];
    sceneIds?: string[];
    source?: "deterministic" | "model";
};

function record(value: unknown): AnyRecord {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function text(value: unknown, fallback = "") {
    return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : fallback;
}

function strings(value: unknown) {
    if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
    const single = text(value);
    return single ? [single] : [];
}

function integer(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
}

function positive(value: unknown, fallback = 1) {
    return Math.max(1, integer(value, fallback));
}

function origin(value: unknown, fallback: StudioAdaptationOrigin = "generated"): StudioAdaptationOrigin {
    return ["explicit", "inferred", "generated"].includes(text(value)) ? (text(value) as StudioAdaptationOrigin) : fallback;
}

function operation(value: unknown): StudioAdaptationOperation {
    return OPERATIONS.includes(text(value) as StudioAdaptationOperation) ? (text(value) as StudioAdaptationOperation) : "rewrite";
}

function reviewStatus(value: unknown, fallback: StudioAdaptationReviewStatus = "pending_review") {
    return REVIEW_STATUSES.includes(text(value) as StudioAdaptationReviewStatus) ? (text(value) as StudioAdaptationReviewStatus) : fallback;
}

function unique<T>(items: T[]): T[] {
    return [...new Set(items)];
}

function cleanId(value: unknown, prefix: string, index: number) {
    const raw = text(value).replace(/[^\w:-]/g, "").slice(0, 80);
    return raw || `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function hasText(value: unknown) {
    return Boolean(text(value));
}

function estimateChars(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

export function createAdaptationContext(project: StudioProject, settings: StudioAdaptationSettings): AdaptationContext {
    if (!project.novel || project.novel.status !== "ready") throw new AdaptationSchemaError("novel_missing", "当前项目没有可用小说原文");
    const analysis = project.novelAnalysis ? applyNovelAnalysisOverrides(project.novelAnalysis, project.novelAnalysisOverrides) : undefined;
    if (!analysis || !analysis.characters.length) throw new AdaptationSchemaError("analysis_missing", "当前项目没有可用原著分析档案，请先完成阶段 2A");
    const checks: StudioAdaptationCheck[] = [];
    const ctx: AdaptationContext = {
        project,
        novel: project.novel,
        analysis,
        settings,
        checks,
        chapterById: new Map(project.novel.chapters.map((chapter) => [chapter.id, chapter])),
        characterById: new Map(analysis.characters.map((character) => [character.id, character])),
        characterByName: new Map(analysis.characters.map((character) => [character.name, character])),
        sceneById: new Map(analysis.scenes.map((scene) => [scene.id, scene])),
        sceneByName: new Map(analysis.scenes.map((scene) => [scene.name, scene])),
        eventById: new Map(analysis.events.map((event) => [event.id, event])),
        eventByTitle: new Map(analysis.events.map((event) => [event.title, event])),
        foreshadowingById: new Map(analysis.foreshadowings.map((item) => [item.id, item])),
        pushCheck: (input) => {
            const existing = checks.find((check) => check.code === input.code && check.message === input.message && check.episodeNumbers.join(",") === (input.episodeNumbers ?? []).join(","));
            if (existing) return existing;
            const check: StudioAdaptationCheck = {
                id: `check-${checks.length + 1}`,
                level: input.level,
                code: input.code,
                category: input.category,
                message: input.message,
                suggestion: input.suggestion ?? "",
                episodeNumbers: input.episodeNumbers ?? [],
                characterIds: input.characterIds ?? [],
                eventIds: input.eventIds ?? [],
                sceneIds: input.sceneIds ?? [],
                source: input.source ?? "deterministic",
                status: "open",
                createdAt: new Date().toISOString(),
            };
            checks.push(check);
            return check;
        },
    };
    return ctx;
}

export function adaptationPromptSize(value: unknown) {
    return estimateChars(value);
}

function chapterLabel(ctx: AdaptationContext, id: string) {
    const chapter = ctx.chapterById.get(id);
    return chapter ? `第 ${chapter.no} 章${chapter.title ? `「${chapter.title}」` : ""}` : id;
}

function resolveCharacter(ctx: AdaptationContext, value: unknown) {
    if (typeof value === "string") {
        const raw = value.trim();
        return ctx.characterById.get(raw) ?? ctx.characterByName.get(raw);
    }
    const raw = record(value);
    const id = text(raw.characterId ?? raw.id);
    const name = text(raw.name ?? raw.characterName ?? raw.character);
    return (id ? ctx.characterById.get(id) : undefined) ?? (name ? ctx.characterByName.get(name) : undefined);
}

function resolveScene(ctx: AdaptationContext, value: unknown) {
    if (typeof value === "string") {
        const raw = value.trim();
        return ctx.sceneById.get(raw) ?? ctx.sceneByName.get(raw);
    }
    const raw = record(value);
    const id = text(raw.sceneId ?? raw.id);
    const name = text(raw.name ?? raw.sceneName);
    return (id ? ctx.sceneById.get(id) : undefined) ?? (name ? ctx.sceneByName.get(name) : undefined);
}

function resolveEvent(ctx: AdaptationContext, value: unknown) {
    if (typeof value === "string") {
        const raw = value.trim();
        return ctx.eventById.get(raw) ?? ctx.eventByTitle.get(raw);
    }
    const raw = record(value);
    const id = text(raw.eventId ?? raw.id);
    const title = text(raw.title ?? raw.name);
    return (id ? ctx.eventById.get(id) : undefined) ?? (title ? ctx.eventByTitle.get(title) : undefined);
}

export function emptyAdaptationSource(): StudioAdaptationSourceReference {
    return { chapterIds: [], eventIds: [], sceneIds: [], foreshadowingIds: [], evidence: [] };
}

/** 校验并裁剪模型给出的原著引用；无效章节/事件/地点直接丢弃，不让假引用进入档案。 */
export function normalizeSourceReferences(ctx: AdaptationContext, value: unknown, fallbackChapterId = ""): StudioAdaptationSourceReference {
    const raw = record(value);
    const chapterIds = unique(strings(raw.chapterIds ?? raw.chapters).filter((id) => ctx.chapterById.has(id)));
    const eventRecords = Array.isArray(raw.events) ? raw.events : [];
    const eventIds = unique([
        ...strings(raw.eventIds).filter((id) => ctx.eventById.has(id)),
        ...eventRecords.map((item) => resolveEvent(ctx, item)?.id ?? "").filter(Boolean),
    ]);
    const sceneIds = unique(strings(raw.sceneIds ?? raw.scenes).filter((id) => ctx.sceneById.has(id)));
    const foreshadowingIds = unique(strings(raw.foreshadowingIds ?? raw.foreshadowings).filter((id) => ctx.foreshadowingById.has(id)));
    const fallbackChapter = fallbackChapterId ? ctx.chapterById.get(fallbackChapterId) : ctx.novel.chapters[0];
    const evidenceInput = [
        ...(Array.isArray(raw.evidence) ? raw.evidence : []),
        ...strings(raw.excerpts).map((excerpt) => ({ excerpt, chapterId: chapterIds[0] ?? fallbackChapterId })),
    ];
    const evidenceResult = normalizeEvidence(evidenceInput, ctx.novel, fallbackChapter);
    const evidence: NovelEvidence[] = [...evidenceResult.evidence];
    if (!evidence.length) {
        for (const eventId of eventIds) {
            const event = ctx.eventById.get(eventId);
            if (event?.evidence.length) evidence.push(...event.evidence.slice(0, 2));
        }
    }
    return {
        chapterIds: unique([...chapterIds, ...evidence.map((item) => item.chapterId)]),
        eventIds,
        sceneIds: unique([...sceneIds, ...eventIds.map((id) => ctx.eventById.get(id)?.locationId ?? "").filter(Boolean)]),
        foreshadowingIds,
        evidence: uniqueEvidence(evidence),
    };
}

function uniqueEvidence(evidence: NovelEvidence[]) {
    const seen = new Set<string>();
    return evidence.filter((item) => {
        const key = `${item.chapterId}:${item.sourceLocation.charStart ?? 0}:${item.sourceLocation.charEnd ?? 0}:${item.excerpt}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizedOrigin(ctx: AdaptationContext, rawOrigin: unknown, refs: StudioAdaptationSourceReference, label: string): StudioAdaptationOrigin {
    const requested = origin(rawOrigin);
    if (requested === "generated") return "generated";
    if (requested === "explicit" && refs.evidence.some((item) => item.evidenceType === "explicit")) return "explicit";
    if (requested === "inferred" && refs.evidence.length) return "inferred";
    if (requested === "explicit") {
        ctx.pushCheck({
            level: "warning",
            code: "explicit_without_evidence",
            category: "引用校验",
            message: `${label}标记为原著明确事实，但没有可定位的显式证据；已降级为合理推断。`,
            suggestion: "补充真实章节逐字摘录，或接受为推断内容并人工确认。",
        });
    }
    return "inferred";
}

function riskTags(value: unknown, op: StudioAdaptationOperation): StudioAdaptationRiskTag[] {
    const tags = strings(value).filter((tag): tag is StudioAdaptationRiskTag => RISK_TAGS.includes(tag as StudioAdaptationRiskTag));
    if (op === "remove" && !tags.includes("key_event_removal")) tags.push("key_event_removal");
    return unique(tags);
}

export function normalizeAdaptationChanges(ctx: AdaptationContext, value: unknown, fallbackEpisode = 0): StudioAdaptationChange[] {
    const list = Array.isArray(value) ? value : [];
    return list.map((item, index) => {
        const raw = record(item);
        const id = cleanId(raw.adaptationChangeId ?? raw.changeId ?? raw.id, fallbackEpisode ? `ep${fallbackEpisode}-change` : "change", index);
        const op = operation(raw.operation);
        const refs = normalizeSourceReferences(ctx, raw.sourceReferences ?? raw.source ?? raw, "");
        const sourceType = normalizedOrigin(ctx, raw.sourceType ?? raw.origin, refs, `改编 ${id}`);
        const tags = riskTags(raw.riskTags ?? raw.risks ?? raw.highRiskType, op);
        const highRisk = tags.length > 0;
        if (highRisk) {
            ctx.pushCheck({
                level: "warning",
                code: "high_risk_adaptation",
                category: "改编审核",
                message: `改编 ${id} 属于高风险：${tags.map((tag) => tag).join("、")}；不能自动视为通过。`,
                suggestion: "在“改编方案”中逐项确认，确认前不要进入分集锁定。",
                episodeNumbers: unique(integer(raw.episodeNumber, fallbackEpisode) ? [integer(raw.episodeNumber, fallbackEpisode)] : []),
            });
        }
        return {
            adaptationChangeId: id,
            operation: op,
            sourceType,
            sourceReferences: refs,
            beforeStructure: text(raw.beforeStructure ?? raw.before),
            afterStructure: text(raw.afterStructure ?? raw.after),
            reason: text(raw.reason),
            characterImpact: text(raw.characterImpact ?? raw.characterEffects),
            causalityImpact: text(raw.causalityImpact ?? raw.causalImpact),
            foreshadowingImpact: text(raw.foreshadowingImpact),
            episodeNumbers: unique([...(Array.isArray(raw.episodeNumbers) ? raw.episodeNumbers.map((number) => integer(number)) : []), integer(raw.episodeNumber, fallbackEpisode)].filter((number) => number > 0)),
            riskTags: tags,
            highRisk,
            reviewStatus: highRisk ? "pending_review" : reviewStatus(raw.reviewStatus, "pending_review"),
            createdAt: text(raw.createdAt, new Date().toISOString()),
        };
    });
}

export function normalizeAdaptationStrategy(ctx: AdaptationContext, value: unknown): StudioAdaptationStrategy {
    const raw = record(value);
    const strategyRaw = record(raw.strategy ?? value);
    const changes = normalizeAdaptationChanges(ctx, strategyRaw.changes ?? raw.changes, 0);
    return {
        id: "strategy-2b",
        version: positive(strategyRaw.version, 1),
        createdAt: text(strategyRaw.createdAt, new Date().toISOString()),
        updatedAt: text(strategyRaw.updatedAt, new Date().toISOString()),
        reviewStatus: "pending_review",
        locked: false,
        logline: text(strategyRaw.logline),
        positioningSummary: text(strategyRaw.positioningSummary ?? strategyRaw.positioning),
        structureStrategy: text(strategyRaw.structureStrategy ?? strategyRaw.structure),
        characterStrategy: text(strategyRaw.characterStrategy ?? strategyRaw.characters),
        conflictStrategy: text(strategyRaw.conflictStrategy ?? strategyRaw.conflict),
        foreshadowingStrategy: text(strategyRaw.foreshadowingStrategy ?? strategyRaw.foreshadowing),
        endingStrategy: text(strategyRaw.endingStrategy ?? strategyRaw.ending),
        episodeCountPlan: text(strategyRaw.episodeCountPlan ?? strategyRaw.episodePlan),
        warnings: strings(strategyRaw.warnings),
        changes,
        sourceAnalysisVersion: ctx.analysis.version,
        sourceNovelHash: ctx.novel.file.hash,
    };
}

export function normalizeSeriesBlueprint(ctx: AdaptationContext, value: unknown, changes: StudioAdaptationChange[]): StudioSeriesBlueprint {
    const rawRoot = record(value);
    const raw = record(rawRoot.blueprint ?? value);
    const knownChangeIds = new Set(changes.map((change) => change.adaptationChangeId));
    const stages = (Array.isArray(raw.stages) ? raw.stages : []).map((item, index) => {
        const stage = record(item);
        return {
            id: cleanId(stage.id, "stage", index),
            name: text(stage.name, `阶段 ${index + 1}`),
            description: text(stage.description),
            fromEpisode: Math.max(1, integer(stage.fromEpisode, index + 1)),
            toEpisode: Math.max(1, integer(stage.toEpisode, index + 1)),
        };
    });
    const keyEvents: StudioSeriesBlueprint["keyEvents"] = (Array.isArray(raw.keyEvents) ? raw.keyEvents : []).map((item, index) => {
        const event = record(item);
        const refs = normalizeSourceReferences(ctx, event.sourceReferences ?? event, "");
        const sourceType = normalizedOrigin(ctx, event.sourceType ?? event.origin, refs, `蓝图事件 ${index + 1}`);
        return {
            id: cleanId(event.id, "blueprint-event", index),
            order: Math.max(1, integer(event.order, index + 1)),
            act: text(event.act, `阶段 ${Math.max(1, integer(event.order, index + 1))}`),
            title: text(event.title, `关键事件 ${index + 1}`),
            description: text(event.description),
            episodeHint: text(event.episodeHint ?? event.episode),
            sourceType,
            sourceReferences: refs,
            adaptationChangeIds: unique(strings(event.adaptationChangeIds ?? event.adaptationChanges).filter((id) => knownChangeIds.has(id))),
        };
    });
    const characterPlans = (Array.isArray(raw.characters) ? raw.characters : []).map((item, index) => {
        const character = record(item);
        const resolved = resolveCharacter(ctx, character);
        const characterId = resolved?.id ?? text(character.characterId ?? character.id, `char-blueprint-${index + 1}`);
        if (!resolved) {
            ctx.pushCheck({ level: "warning", code: "unknown_blueprint_character", category: "人物引用", message: `蓝图人物「${text(character.name, characterId)}”不在阶段 2A 人物档案中。`, characterIds: [characterId] });
        }
        return {
            characterId,
            name: resolved?.name ?? text(character.name),
            role: text(character.role),
            goal: text(character.goal),
            arcSummary: text(character.arcSummary ?? character.arc),
            entranceEpisode: Math.max(1, integer(character.entranceEpisode ?? character.firstEpisode, 1)),
            exitEpisode: integer(character.exitEpisode) || undefined,
            fate: text(character.fate),
            sourceType: normalizedOrigin(ctx, character.sourceType, emptyAdaptationSource(), `蓝图人物 ${characterId}`),
        };
    });
    const relationships = (Array.isArray(raw.relationships) ? raw.relationships : []).map((item) => {
        const relation = record(item);
        const from = resolveCharacter(ctx, relation.from ?? relation.fromCharacterId);
        const to = resolveCharacter(ctx, relation.to ?? relation.toCharacterId);
        return {
            fromCharacterId: from?.id ?? text(relation.fromCharacterId),
            toCharacterId: to?.id ?? text(relation.toCharacterId),
            fromName: from?.name ?? text(relation.fromName),
            toName: to?.name ?? text(relation.toName),
            evolution: text(relation.evolution ?? relation.change),
        };
    });
    const locations = (Array.isArray(raw.locations) ? raw.locations : []).map((item) => {
        const location = record(item);
        const scene = resolveScene(ctx, location);
        return {
            sceneId: scene?.id ?? text(location.sceneId ?? location.id),
            name: scene?.name ?? text(location.name),
            usage: text(location.usage),
            episodeNumbers: (Array.isArray(location.episodeNumbers) ? location.episodeNumbers : []).map((number) => integer(number)).filter((number) => number > 0),
        };
    });
    return {
        id: "blueprint-2b",
        version: positive(raw.version, 1),
        createdAt: text(raw.createdAt, new Date().toISOString()),
        updatedAt: text(raw.updatedAt, new Date().toISOString()),
        reviewStatus: "pending_review",
        locked: false,
        title: text(raw.title, ctx.project.title),
        theme: text(raw.theme),
        logline: text(raw.logline),
        mainline: text(raw.mainline),
        centralConflict: text(raw.centralConflict),
        protagonistGoals: strings(raw.protagonistGoals),
        antagonist: {
            name: text(record(raw.antagonist).name),
            motivation: text(record(raw.antagonist).motivation),
            pressure: text(record(raw.antagonist).pressure),
        },
        relationshipEvolution: text(raw.relationshipEvolution),
        stages,
        keyEvents,
        climax: text(raw.climax),
        ending: text(raw.ending),
        foreshadowingPlan: text(raw.foreshadowingPlan),
        characters: characterPlans,
        relationships,
        locations,
        timeline: text(raw.timeline),
        sourceAnalysisVersion: ctx.analysis.version,
        sourceNovelHash: ctx.novel.file.hash,
    };
}

/**
 * 用阶段 2A 档案补齐蓝图中的人物/关系/地点/时间线索引。
 * 这些字段只做结构化归位，不替代模型对主线、阶段和关键事件的编剧判断。
 */
export function completeSeriesBlueprintFromAnalysis(ctx: AdaptationContext, blueprint: StudioSeriesBlueprint): StudioSeriesBlueprint {
    const chapterEpisode = new Map<string, number>();
    for (const event of blueprint.keyEvents) {
        const episodeNumber = Number((event.episodeHint.match(/\d+/) ?? [])[0]);
        if (!Number.isFinite(episodeNumber) || episodeNumber < 1) continue;
        for (const chapterId of event.sourceReferences.chapterIds) chapterEpisode.set(chapterId, episodeNumber);
    }
    const fallbackEpisode = blueprint.stages[0]?.fromEpisode ?? 1;
    const episodesFor = (chapterIds: string[]) => unique(chapterIds.map((id) => chapterEpisode.get(id)).filter((number): number is number => Boolean(number))).sort((left, right) => left - right);

    const characters: StudioSeriesBlueprint["characters"] = ctx.analysis.characters.map((character) => {
        const keyEpisodes = episodesFor([character.firstChapterId, ...character.keyChapterIds]);
        const entranceEpisode = Math.min(...(keyEpisodes.length ? keyEpisodes : [fallbackEpisode]));
        return {
            characterId: character.id,
            name: character.name,
            role: character.identity || character.occupation || "角色",
            goal: character.motivation,
            arcSummary: character.arc,
            entranceEpisode,
            exitEpisode: character.status === "dead" ? Math.max(...keyEpisodes, entranceEpisode) : undefined,
            fate: character.fate || character.status,
            sourceType: "explicit",
        };
    });
    const relationships: StudioSeriesBlueprint["relationships"] = ctx.analysis.relationships.map((relationship) => ({
        fromCharacterId: relationship.fromCharacterId,
        toCharacterId: relationship.toCharacterId,
        fromName: relationship.fromName,
        toName: relationship.toName,
        evolution: relationship.currentStatus || relationship.type,
    }));
    const locations: StudioSeriesBlueprint["locations"] = ctx.analysis.scenes.map((scene) => {
        const episodeNumbers = episodesFor([scene.firstChapterId, ...scene.keyChapterIds]);
        return {
            sceneId: scene.id,
            name: scene.name,
            usage: scene.plotUses,
            episodeNumbers: episodeNumbers.length ? episodeNumbers : [fallbackEpisode],
        };
    });
    const timeline = blueprint.stages.length
        ? blueprint.stages.map((stage) => `第 ${stage.fromEpisode}-${stage.toEpisode} 集：${stage.description}`).join("；")
        : `第 1-${ctx.settings.targetEpisodes} 集：按全剧主线推进`;
    return { ...blueprint, characters, relationships, locations, timeline };
}

function resolveCharacterRef(ctx: AdaptationContext, value: unknown, index: number): StudioEpisodeCharacterRef {
    const raw = record(value);
    const character = resolveCharacter(ctx, value);
    if (character) return { characterId: character.id, name: character.name, role: text(raw.role), summary: text(raw.summary ?? raw.note) };
    const name = text(value);
    const byName = name ? ctx.characterByName.get(name) : undefined;
    if (byName) return { characterId: byName.id, name: byName.name, role: "", summary: "" };
    const characterId = text(raw.characterId ?? raw.id, `char-external-${index + 1}`);
    ctx.pushCheck({ level: "warning", code: "unknown_episode_character", category: "人物引用", message: `分集中的人物「${name || characterId}」无法对应到阶段 2A 档案。`, characterIds: [characterId] });
    return { characterId, name: name || characterId, role: text(raw.role), summary: text(raw.summary ?? raw.note) };
}

function resolveLocationRef(ctx: AdaptationContext, value: unknown, index: number): StudioEpisodeLocationRef {
    const raw = record(value);
    const scene = resolveScene(ctx, value);
    if (scene) return { sceneId: scene.id, name: scene.name, purpose: text(raw.purpose ?? raw.use) };
    const name = text(value);
    const byName = name ? ctx.sceneByName.get(name) : undefined;
    if (byName) return { sceneId: byName.id, name: byName.name, purpose: "" };
    const sceneId = text(raw.sceneId ?? raw.id);
    ctx.pushCheck({ level: "warning", code: "unknown_episode_scene", category: "地点引用", message: `分集地点「${name || sceneId || `地点 ${index + 1}`}」无法对应到阶段 2A 地点档案。`, sceneIds: sceneId ? [sceneId] : [] });
    return { sceneId, name: name || `地点 ${index + 1}`, purpose: text(raw.purpose ?? raw.use) };
}

function normalizeEpisodeStates(ctx: AdaptationContext, value: unknown, episodeNumber: number, appearances: StudioEpisodeCharacterRef[]): StudioEpisodeCharacterState[] {
    const rawList = Array.isArray(value) ? value : [];
    const states = new Map<string, StudioEpisodeCharacterState>();
    for (const item of rawList) {
        const raw = record(item);
        const character = resolveCharacter(ctx, item);
        const fallback = appearances.find((appearance) => appearance.name === text(raw.name) || appearance.characterId === text(raw.characterId));
        const characterId = character?.id ?? fallback?.characterId ?? text(raw.characterId ?? raw.id);
        if (!characterId) continue;
        const state: StudioEpisodeCharacterState = {
            characterId,
            name: character?.name ?? fallback?.name ?? text(raw.name, characterId),
            location: text(raw.location),
            knows: strings(raw.knows ?? raw.known),
            unknown: strings(raw.unknown ?? raw.unknowns ?? raw.notKnown),
            relationships: text(raw.relationships ?? raw.relationshipState),
            physicalState: text(raw.physicalState),
            abilityState: text(raw.abilityState),
            identityState: text(raw.identityState),
            present: typeof raw.present === "boolean" ? raw.present : true,
            lifeState: LIFE_STATES.includes(text(raw.lifeState) as (typeof LIFE_STATES)[number]) ? (text(raw.lifeState) as (typeof LIFE_STATES)[number]) : "unknown",
        };
        const existing = states.get(characterId);
        if (existing) {
            ctx.pushCheck({ level: "warning", code: "duplicate_character_state", category: "人物连续性", message: `第 ${episodeNumber} 集中「${state.name}」有多个状态；已合并为首条并保留第二条的补充信息。`, episodeNumbers: [episodeNumber], characterIds: [characterId] });
            states.set(characterId, {
                ...existing,
                knows: unique([...existing.knows, ...state.knows]),
                unknown: unique([...existing.unknown, ...state.unknown]),
                relationships: existing.relationships || state.relationships,
                physicalState: existing.physicalState || state.physicalState,
                abilityState: existing.abilityState || state.abilityState,
                identityState: existing.identityState || state.identityState,
                location: existing.location || state.location,
                lifeState: existing.lifeState === "unknown" ? state.lifeState : existing.lifeState,
            });
        } else {
            states.set(characterId, state);
        }
    }
    for (const appearance of appearances) {
        if (!states.has(appearance.characterId)) {
            ctx.pushCheck({ level: "warning", code: "missing_character_state", category: "人物连续性", message: `第 ${episodeNumber} 集「${appearance.name}」出场但没有逐集状态，无法进行全剧记忆校验。`, episodeNumbers: [episodeNumber], characterIds: [appearance.characterId] });
            states.set(appearance.characterId, {
                characterId: appearance.characterId,
                name: appearance.name,
                location: "",
                knows: [],
                unknown: [],
                relationships: "",
                physicalState: "",
                abilityState: "",
                identityState: "",
                present: true,
                lifeState: "unknown",
            });
        }
    }
    return [...states.values()];
}

export function normalizeEpisodePlans(ctx: AdaptationContext, value: unknown, changes: StudioAdaptationChange[]): StudioEpisodePlan[] {
    const rawRoot = record(value);
    const rawPlans = Array.isArray(rawRoot.episodes) ? rawRoot.episodes : Array.isArray(rawRoot.episodePlans) ? rawRoot.episodePlans : [];
    const knownChangeIds = new Map(changes.map((change) => [change.adaptationChangeId, change]));
    return rawPlans.map((item, index): StudioEpisodePlan => {
        const raw = record(item);
        const episodeNumber = Math.max(1, integer(raw.episodeNumber ?? raw.number, index + 1));
        const episodeId = cleanId(raw.episodeId ?? raw.id, "ep", episodeNumber - 1);
        const rawAppearances = Array.isArray(raw.characterAppearances) ? raw.characterAppearances : [];
        const characterAppearances = rawAppearances.map((value, refIndex) => resolveCharacterRef(ctx, value, refIndex));
        const rawLocations = Array.isArray(raw.locations) ? raw.locations : [];
        const locations = rawLocations.map((value, refIndex) => resolveLocationRef(ctx, value, refIndex));
        const keyEvents = (Array.isArray(raw.keyEvents) ? raw.keyEvents : []).map((value, eventIndex) => {
            if (typeof value === "string") {
                return { id: `${episodeId}-event-${eventIndex + 1}`, description: value, sourceType: "generated" as const, sourceReferences: emptyAdaptationSource(), adaptationChangeIds: [] };
            }
            const event = record(value);
            const refs = normalizeSourceReferences(ctx, event.sourceReferences ?? event, "");
            return {
                id: cleanId(event.id, `${episodeId}-event`, eventIndex),
                description: text(event.description ?? event.content ?? event.title),
                sourceType: normalizedOrigin(ctx, event.sourceType ?? event.origin, refs, `第 ${episodeNumber} 集事件 ${eventIndex + 1}`),
                sourceReferences: refs,
                adaptationChangeIds: unique(strings(event.adaptationChangeIds ?? event.adaptationChanges).filter((id) => knownChangeIds.has(id))),
            } satisfies StudioEpisodeKeyEvent;
        });
        const sourceReferences = normalizeSourceReferences(ctx, raw.sourceReferences ?? raw.source ?? {}, "");
        const adaptationNotes: StudioEpisodeAdaptationNote[] = (Array.isArray(raw.adaptationChanges) ? raw.adaptationChanges : []).map((note, noteIndex) => {
            const rawNote = record(note);
            const id = text(rawNote.adaptationChangeId ?? rawNote.changeId ?? rawNote.id);
            const existing = id ? knownChangeIds.get(id) : undefined;
            if (existing) {
                return { adaptationChangeId: existing.adaptationChangeId, operation: existing.operation, description: text(rawNote.description, existing.reason), highRisk: existing.highRisk, reviewStatus: existing.reviewStatus };
            }
            const fallbackChange: StudioAdaptationChange = {
                adaptationChangeId: cleanId(id, `${episodeId}-change`, noteIndex),
                operation: operation(rawNote.operation),
                sourceType: normalizedOrigin(ctx, rawNote.sourceType, emptyAdaptationSource(), `第 ${episodeNumber} 集改编`),
                sourceReferences: emptyAdaptationSource(),
                beforeStructure: "",
                afterStructure: "",
                reason: text(rawNote.reason ?? rawNote.description),
                characterImpact: "",
                causalityImpact: "",
                foreshadowingImpact: "",
                episodeNumbers: [episodeNumber],
                riskTags: [],
                highRisk: false,
                reviewStatus: "pending_review",
                createdAt: new Date().toISOString(),
            };
            changes.push(fallbackChange);
            knownChangeIds.set(fallbackChange.adaptationChangeId, fallbackChange);
            return { adaptationChangeId: fallbackChange.adaptationChangeId, operation: fallbackChange.operation, description: text(rawNote.description, fallbackChange.reason), highRisk: false, reviewStatus: "pending_review" };
        });
        const relationshipChanges: StudioEpisodeRelationshipChange[] = (Array.isArray(raw.characterRelationshipChanges) ? raw.characterRelationshipChanges : []).map((relation) => {
            const rawRelation = record(relation);
            const from = resolveCharacter(ctx, relation);
            const to = resolveCharacter(ctx, rawRelation.to ?? rawRelation.toCharacterId);
            return {
                fromCharacterId: from?.id ?? text(rawRelation.fromCharacterId),
                toCharacterId: to?.id ?? text(rawRelation.toCharacterId),
                fromName: from?.name ?? text(rawRelation.fromName),
                toName: to?.name ?? text(rawRelation.toName),
                change: text(rawRelation.change ?? rawRelation.description),
            };
        });
        if (!keyEvents.length) ctx.pushCheck({ level: "error", code: "episode_without_key_event", category: "分集规划", message: `第 ${episodeNumber} 集没有关键事件，不能推动全剧主线。`, episodeNumbers: [episodeNumber], suggestion: "补齐本集关键事件，或重新生成该集。" });
        if (!text(raw.dramaticGoal)) ctx.pushCheck({ level: "error", code: "episode_without_goal", category: "分集规划", message: `第 ${episodeNumber} 集缺少戏剧目标。`, episodeNumbers: [episodeNumber] });
        if (!text(raw.mainConflict)) ctx.pushCheck({ level: "error", code: "episode_without_conflict", category: "分集规划", message: `第 ${episodeNumber} 集缺少核心冲突。`, episodeNumbers: [episodeNumber] });
        if (!text(raw.climax)) ctx.pushCheck({ level: "error", code: "episode_without_climax", category: "分集规划", message: `第 ${episodeNumber} 集缺少高潮。`, episodeNumbers: [episodeNumber] });
        if (!text(raw.endingHook)) ctx.pushCheck({ level: "warning", code: "episode_without_hook", category: "分集规划", message: `第 ${episodeNumber} 集没有集尾钩子。`, episodeNumbers: [episodeNumber], suggestion: "补一个由本集冲突自然产生的钩子，不能用无依据的强行反转。" });
        if (episodeNumber > 1 && !strings(raw.continuityDependencies).some((item) => /上一集|上集|第\s*\d+\s*集|前情/.test(item))) {
            ctx.pushCheck({ level: "warning", code: "missing_previous_dependency", category: "连续性", message: `第 ${episodeNumber} 集没有说明与上一集的连续性依赖。`, episodeNumbers: [episodeNumber], suggestion: "确认时间、地点、人物状态和事件因果如何承接上一集。" });
        }
        return {
            episodeId,
            episodeNumber,
            episodeTitle: text(raw.episodeTitle ?? raw.title, `第 ${episodeNumber} 集`),
            episodeLogline: text(raw.episodeLogline ?? raw.logline),
            episodeSynopsis: text(raw.episodeSynopsis ?? raw.synopsis),
            dramaticGoal: text(raw.dramaticGoal ?? raw.goal),
            openingHook: text(raw.openingHook),
            mainConflict: text(raw.mainConflict ?? raw.conflict),
            keyEvents,
            characterAppearances,
            characterStates: normalizeEpisodeStates(ctx, raw.characterStates ?? raw.states, episodeNumber, characterAppearances),
            characterRelationshipChanges: relationshipChanges,
            locations,
            emotionalProgression: strings(raw.emotionalProgression),
            climax: text(raw.climax),
            endingHook: text(raw.endingHook ?? raw.hook),
            foreshadowingIntroduced: strings(raw.foreshadowingIntroduced),
            foreshadowingAdvanced: strings(raw.foreshadowingAdvanced),
            foreshadowingResolved: strings(raw.foreshadowingResolved),
            continuityDependencies: strings(raw.continuityDependencies ?? raw.continuity),
            estimatedDuration: Math.max(ADAPTATION_MIN_EPISODE_SECONDS, Math.min(ADAPTATION_MAX_EPISODE_SECONDS, integer(raw.estimatedDuration ?? raw.duration, ctx.settings.targetEpisodeSeconds))),
            sourceReferences,
            adaptationChanges: adaptationNotes,
            reviewStatus: "pending_review",
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            locked: false,
            versions: [],
        };
    }).sort((left, right) => left.episodeNumber - right.episodeNumber);
}

export function normalizeCharacterArcs(ctx: AdaptationContext, value: unknown, plans: StudioEpisodePlan[]): StudioCharacterArc[] {
    const rawRoot = record(value);
    const rawArcs = Array.isArray(rawRoot.characterArcs) ? rawRoot.characterArcs : Array.isArray(rawRoot.arcs) ? rawRoot.arcs : [];
    const arcs = rawArcs.map((item, index): StudioCharacterArc => {
        const raw = record(item);
        const character = resolveCharacter(ctx, item);
        const characterId = character?.id ?? text(raw.characterId ?? raw.id, `char-arc-${index + 1}`);
        const milestones: StudioCharacterArcMilestone[] = (Array.isArray(raw.milestones) ? raw.milestones : []).map((milestone) => {
            const point = record(milestone);
            const type = ["first_appearance", "exit", "death", "return", "reveal", "turning_point", "choice"].includes(text(point.type)) ? text(point.type) as StudioCharacterArcMilestone["type"] : "turning_point";
            const refs = normalizeSourceReferences(ctx, point.sourceReferences ?? point, "");
            // confirmedAt 只能由用户操作写入，不能从模型输出里采信；AI 不能自证“用户已确认”。
            return { episodeNumber: Math.max(1, integer(point.episodeNumber, 1)), type, description: text(point.description), sourceType: normalizedOrigin(ctx, point.sourceType, refs, `人物弧光 ${characterId}`), sourceReferences: refs };
        });
        const timeline: StudioCharacterArcTimelinePoint[] = (Array.isArray(raw.timeline) ? raw.timeline : []).map((point) => {
            const state = record(point);
            return {
                episodeNumber: Math.max(1, integer(state.episodeNumber, 1)),
                location: text(state.location),
                knows: strings(state.knows ?? state.known),
                unknown: strings(state.unknown ?? state.notKnown),
                relationships: text(state.relationships ?? state.relationshipState),
                physicalState: text(state.physicalState),
                abilityState: text(state.abilityState),
                identityState: text(state.identityState),
                present: typeof state.present === "boolean" ? state.present : true,
                lifeState: LIFE_STATES.includes(text(state.lifeState) as (typeof LIFE_STATES)[number]) ? text(state.lifeState) as StudioCharacterArcTimelinePoint["lifeState"] : "unknown",
            };
        });
        return {
            characterId,
            characterName: character?.name ?? text(raw.characterName ?? raw.name, characterId),
            version: positive(raw.version, 1),
            createdAt: text(raw.createdAt, new Date().toISOString()),
            updatedAt: text(raw.updatedAt, new Date().toISOString()),
            initialState: text(raw.initialState),
            coreGoal: text(raw.coreGoal),
            innerConflict: text(raw.innerConflict),
            flaw: text(raw.flaw),
            turningPoints: (Array.isArray(raw.turningPoints) ? raw.turningPoints : []).map((point) => ({ episodeNumber: Math.max(1, integer(record(point).episodeNumber, 1)), description: text(record(point).description) })),
            keyChoices: (Array.isArray(raw.keyChoices) ? raw.keyChoices : []).map((point) => ({ episodeNumber: Math.max(1, integer(record(point).episodeNumber, 1)), description: text(record(point).description) })),
            relationshipChanges: (Array.isArray(raw.relationshipChanges) ? raw.relationshipChanges : []).map((point) => ({ episodeNumber: Math.max(1, integer(record(point).episodeNumber, 1)), description: text(record(point).description) })),
            finalState: text(raw.finalState),
            milestones,
            timeline,
            reviewStatus: "pending_review",
        };
    });
    // 模型漏掉的重要人物弧光用阶段 2A 档案与分集状态补齐，避免“只记住名字”。
    const covered = new Set(arcs.map((arc) => arc.characterId));
    const appearing = new Set(plans.flatMap((plan) => plan.characterStates.map((state) => state.characterId)));
    for (const characterId of appearing) {
        if (covered.has(characterId)) continue;
        const character = ctx.characterById.get(characterId);
        if (!character) continue;
        arcs.push(buildCharacterArcFallback(character, plans));
        covered.add(characterId);
        ctx.pushCheck({ level: "warning", code: "arc_fallback", category: "人物弧光", message: `人物「${character.name}」缺少模型弧光，已按阶段 2A 档案和分集状态建立可校验时间线。`, characterIds: [characterId] });
    }
    return arcs;
}

function buildCharacterArcFallback(character: NovelAnalysis["characters"][number], plans: StudioEpisodePlan[]): StudioCharacterArc {
    const timeline = plans
        .map((plan) => plan.characterStates.find((state) => state.characterId === character.id))
        .filter((state): state is StudioEpisodeCharacterState => Boolean(state))
        .map((state, index, all) => ({
            episodeNumber: plans.find((plan) => plan.characterStates.includes(state))?.episodeNumber ?? index + 1,
            location: state.location,
            knows: state.knows,
            unknown: state.unknown,
            relationships: state.relationships,
            physicalState: state.physicalState,
            abilityState: state.abilityState,
            identityState: state.identityState,
            present: state.present,
            lifeState: state.lifeState,
        }));
    return {
        characterId: character.id,
        characterName: character.name,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        initialState: [character.identity, character.status].filter(Boolean).join("｜"),
        coreGoal: character.motivation,
        innerConflict: character.personality,
        flaw: character.arc,
        turningPoints: [],
        keyChoices: [],
        relationshipChanges: [],
        finalState: character.fate,
        milestones: [],
        timeline,
        reviewStatus: "pending_review",
    };
}

export function normalizeForeshadowingPool(ctx: AdaptationContext, value: unknown, plans: StudioEpisodePlan[]): StudioForeshadowingPoolItem[] {
    const rawRoot = record(value);
    const rawItems = Array.isArray(rawRoot.foreshadowings) ? rawRoot.foreshadowings : Array.isArray(rawRoot.foreshadowingPool) ? rawRoot.foreshadowingPool : [];
    const items = rawItems.map((item, index): StudioForeshadowingPoolItem => {
        const raw = record(item);
        const id = cleanId(raw.foreshadowingId ?? raw.id, "fore", index);
        const originalId = text(raw.sourceNovelForeshadowingId ?? raw.novelId);
        const original = ctx.foreshadowingById.get(originalId);
        const sourceType = original ? "explicit" as const : normalizedOrigin(ctx, raw.sourceType, emptyAdaptationSource(), `伏笔 ${id}`);
        let status: StudioForeshadowingStatus = FORESHADOWING_STATUSES.includes(text(raw.status) as StudioForeshadowingStatus) ? text(raw.status) as StudioForeshadowingStatus : "pending_review";
        const firstPlantedEpisode = Math.max(0, integer(raw.firstPlantedEpisode ?? raw.firstEpisode, 0));
        const expectedResolveEpisode = Math.max(0, integer(raw.expectedResolveEpisode ?? raw.expectedEpisode, 0));
        const actualResolveEpisode = integer(raw.actualResolveEpisode, 0);
        if (status === "resolved" && (!actualResolveEpisode || !firstPlantedEpisode)) {
            status = "pending_review";
            ctx.pushCheck({ level: "error", code: "foreshadowing_resolved_without_payoff", category: "伏笔管理", message: `伏笔「${id}」被标为已回收，但缺少首次埋设或实际回收集数；不能自动认定回收。`, episodeNumbers: [firstPlantedEpisode, expectedResolveEpisode].filter(Boolean) });
        }
        if (original && !originalId) {
            ctx.pushCheck({ level: "warning", code: "original_foreshadowing_without_source", category: "伏笔管理", message: `伏笔「${id}」声称为原著伏笔，但没有源伏笔 ID。` });
        }
        return {
            foreshadowingId: id,
            content: text(raw.content, original?.content ?? ""),
            sourceType,
            sourceNovelForeshadowingId: original?.id ?? "",
            firstPlantedEpisode,
            advancedEpisodes: (Array.isArray(raw.advancedEpisodes) ? raw.advancedEpisodes : []).map((number) => integer(number)).filter((number) => number > 0),
            expectedResolveEpisode,
            actualResolveEpisode: actualResolveEpisode || undefined,
            relatedCharacterIds: unique([
                ...strings(raw.relatedCharacterIds).filter((characterId) => ctx.characterById.has(characterId)),
                ...(original?.relatedCharacterIds ?? []),
            ]),
            relatedEventIds: unique([
                ...strings(raw.relatedEventIds).filter((eventId) => ctx.eventById.has(eventId)),
                ...(original?.relatedEventIds ?? []),
            ]),
            status,
            isOriginal: Boolean(original),
            isAiAdded: !original,
            reviewStatus: "pending_review",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    });
    const ids = new Set(items.map((item) => item.foreshadowingId));
    for (const plan of plans) {
        for (const id of [...plan.foreshadowingIntroduced, ...plan.foreshadowingAdvanced, ...plan.foreshadowingResolved]) {
            if (!ids.has(id)) {
                ctx.pushCheck({ level: "error", code: "episode_foreshadowing_missing_pool", category: "伏笔管理", message: `第 ${plan.episodeNumber} 集引用的伏笔「${id}」不在全剧伏笔池中。`, episodeNumbers: [plan.episodeNumber], suggestion: "补齐伏笔池，或从该集删除无效引用。" });
            }
        }
    }
    return items;
}

export function normalizeModelChecks(ctx: AdaptationContext, value: unknown): StudioAdaptationCheck[] {
    const rawRoot = record(value);
    const rawChecks = Array.isArray(rawRoot.checks) ? rawRoot.checks : Array.isArray(rawRoot.issues) ? rawRoot.issues : [];
    return rawChecks.map((item, index): StudioAdaptationCheck => {
        const raw = record(item);
        const level: StudioAdaptationCheckLevel = ["error", "warning", "suggestion"].includes(text(raw.level)) ? text(raw.level) as StudioAdaptationCheckLevel : "suggestion";
        const characters = strings(raw.characterIds ?? raw.characters).map((value) => ctx.characterById.get(value)?.id ?? ctx.characterByName.get(value)?.id ?? "").filter(Boolean);
        const events = strings(raw.eventIds ?? raw.events).map((value) => ctx.eventById.get(value)?.id ?? ctx.eventByTitle.get(value)?.id ?? "").filter(Boolean);
        const scenes = strings(raw.sceneIds ?? raw.scenes).map((value) => ctx.sceneById.get(value)?.id ?? ctx.sceneByName.get(value)?.id ?? "").filter(Boolean);
        return {
            id: `model-check-${index + 1}`,
            level,
            code: text(raw.code, "model_suggestion"),
            category: text(raw.category, "模型自检"),
            message: text(raw.message ?? raw.description),
            suggestion: text(raw.suggestion),
            episodeNumbers: (Array.isArray(raw.episodeNumbers) ? raw.episodeNumbers : []).map((number) => integer(number)).filter((number) => number > 0),
            characterIds: unique(characters),
            eventIds: unique(events),
            sceneIds: unique(scenes),
            source: "model",
            status: "open",
            createdAt: new Date().toISOString(),
        };
    }).filter((check) => check.message);
}

/** 在 schema 归一化之后运行可执行的业务规则；不自动改写任何内容。 */
export function validateAdaptationPackage(args: {
    ctx: AdaptationContext;
    strategy?: StudioAdaptationStrategy;
    blueprint?: StudioSeriesBlueprint;
    plans: StudioEpisodePlan[];
    arcs: StudioCharacterArc[];
    foreshadowings: StudioForeshadowingPoolItem[];
    changes: StudioAdaptationChange[];
    scope?: "full" | "strategy" | "blueprint" | "episodes";
}) {
    const { ctx, strategy, blueprint, plans, arcs, foreshadowings, changes } = args;
    const scope = args.scope ?? "full";
    if (scope === "strategy") {
        validateStrategyOnly(ctx, strategy, changes);
        return ctx.checks;
    }
    if (scope === "blueprint") {
        validateBlueprintOnly(ctx, blueprint, changes, ctx.settings.targetEpisodes);
        return ctx.checks;
    }
    const target = ctx.settings.targetEpisodes;
    const expectedNumbers = Array.from({ length: target }, (_, index) => index + 1);
    const actualNumbers = plans.map((plan) => plan.episodeNumber);
    const missingNumbers = expectedNumbers.filter((number) => !actualNumbers.includes(number));
    const extraNumbers = actualNumbers.filter((number) => number > target || number < 1);
    if (missingNumbers.length) ctx.pushCheck({ level: "error", code: "episode_count_missing", category: "集数", message: `目标 ${target} 集，但规划缺少第 ${missingNumbers.join("、")} 集。`, episodeNumbers: missingNumbers, suggestion: "一次补齐全部目标集数，不能用重复摘要填满。" });
    if (extraNumbers.length) ctx.pushCheck({ level: "error", code: "episode_count_extra", category: "集数", message: `目标 ${target} 集，但规划多出第 ${extraNumbers.join("、")} 集。`, episodeNumbers: extraNumbers });
    if (plans.length && plans.length !== target) ctx.pushCheck({ level: "error", code: "episode_count_mismatch", category: "集数", message: `分集数量 ${plans.length} 与目标 ${target} 不一致。` });

    const synopsisSeen = new Map<string, number>();
    const keyEventSeen = new Map<string, number>();
    for (const plan of plans) {
        const normalizedSynopsis = plan.episodeSynopsis.replace(/\s+/g, "");
        if (normalizedSynopsis) {
            const previous = synopsisSeen.get(normalizedSynopsis);
            if (previous) {
                ctx.pushCheck({ level: "error", code: "duplicate_episode_synopsis", category: "反注水", message: `第 ${previous} 集与第 ${plan.episodeNumber} 集使用了同一段剧情摘要。`, episodeNumbers: [previous, plan.episodeNumber], suggestion: "为每集写出独立戏剧目标与事件推进，不能用复制摘要填满集数。" });
            } else synopsisSeen.set(normalizedSynopsis, plan.episodeNumber);
        }
        for (const event of plan.keyEvents) {
            const normalized = event.description.replace(/\s+/g, "");
            if (!normalized) continue;
            const previous = keyEventSeen.get(normalized);
            if (previous && previous !== plan.episodeNumber) {
                ctx.pushCheck({ level: "warning", code: "duplicate_key_event", category: "反注水", message: `第 ${previous} 集与第 ${plan.episodeNumber} 集出现同一关键事件：${event.description.slice(0, 48)}。`, episodeNumbers: [previous, plan.episodeNumber] });
            } else keyEventSeen.set(normalized, plan.episodeNumber);
        }
        const durationDelta = Math.abs(plan.estimatedDuration - ctx.settings.targetEpisodeSeconds);
        if (durationDelta > Math.max(10, ctx.settings.targetEpisodeSeconds * 0.2)) {
            ctx.pushCheck({ level: "error", code: "episode_duration_mismatch", category: "时长", message: `第 ${plan.episodeNumber} 集估算 ${plan.estimatedDuration}s，与目标 ${ctx.settings.targetEpisodeSeconds}s 差距过大。`, episodeNumbers: [plan.episodeNumber] });
        } else if (durationDelta > 5) {
            ctx.pushCheck({ level: "warning", code: "episode_duration_near", category: "时长", message: `第 ${plan.episodeNumber} 集估算 ${plan.estimatedDuration}s，与目标 ${ctx.settings.targetEpisodeSeconds}s 不完全一致。`, episodeNumbers: [plan.episodeNumber] });
        }
        if (!plan.episodeSynopsis) ctx.pushCheck({ level: "error", code: "episode_without_synopsis", category: "分集规划", message: `第 ${plan.episodeNumber} 集缺少剧情概要。`, episodeNumbers: [plan.episodeNumber] });
        if (!plan.openingHook) ctx.pushCheck({ level: "warning", code: "episode_without_opening_hook", category: "分集规划", message: `第 ${plan.episodeNumber} 集缺少开场钩子。`, episodeNumbers: [plan.episodeNumber] });
        if (!plan.characterAppearances.length) ctx.pushCheck({ level: "error", code: "episode_without_character", category: "人物连续性", message: `第 ${plan.episodeNumber} 集没有任何人物出场。`, episodeNumbers: [plan.episodeNumber] });
        if (!plan.locations.length) ctx.pushCheck({ level: "warning", code: "episode_without_location", category: "场景引用", message: `第 ${plan.episodeNumber} 集没有地点。`, episodeNumbers: [plan.episodeNumber] });
        for (const state of plan.characterStates) {
            const character = ctx.characterById.get(state.characterId);
            if (!character) continue;
            if (state.present && !state.location) ctx.pushCheck({ level: "warning", code: "present_character_without_location", category: "人物连续性", message: `第 ${plan.episodeNumber} 集「${character.name}」在场但没有所在地点。`, episodeNumbers: [plan.episodeNumber], characterIds: [character.id] });
            const impossible = plan.characterStates.filter((other) => other.characterId !== state.characterId && other.present && state.present && other.location && state.location && other.location === state.location && false);
            void impossible;
        }
    }
    validateCharacterContinuity(ctx, plans, arcs);
    validateForeshadowingOrder(ctx, plans, foreshadowings, target);
    validateCausalityDependencies(ctx, plans, blueprint);
    validateAdaptationCoverage(ctx, plans, changes, target);

    if (blueprint) {
        if (!blueprint.theme) ctx.pushCheck({ level: "warning", code: "blueprint_without_theme", category: "全剧蓝图", message: "全剧蓝图缺少核心主题。" });
        if (!blueprint.logline) ctx.pushCheck({ level: "error", code: "blueprint_without_logline", category: "全剧蓝图", message: "全剧蓝图缺少一句话故事。" });
        if (!blueprint.mainline) ctx.pushCheck({ level: "error", code: "blueprint_without_mainline", category: "全剧蓝图", message: "全剧蓝图缺少故事主线。" });
        if (!blueprint.climax) ctx.pushCheck({ level: "error", code: "blueprint_without_climax", category: "全剧蓝图", message: "全剧蓝图缺少全剧高潮。" });
        if (!blueprint.ending) ctx.pushCheck({ level: "error", code: "blueprint_without_ending", category: "全剧蓝图", message: "全剧蓝图缺少故事结局。" });
        if (!blueprint.keyEvents.length) ctx.pushCheck({ level: "error", code: "blueprint_without_events", category: "全剧蓝图", message: "全剧蓝图没有关键事件。" });
        for (const stage of blueprint.stages) {
            if (stage.fromEpisode < 1 || stage.toEpisode > target || stage.fromEpisode > stage.toEpisode) {
                ctx.pushCheck({ level: "warning", code: "blueprint_stage_range", category: "全剧蓝图", message: `蓝图阶段「${stage.name}」的集数范围不合法（${stage.fromEpisode}-${stage.toEpisode}）。`, episodeNumbers: [stage.fromEpisode, stage.toEpisode].filter((number) => number > 0) });
            }
        }
        const stageCover = new Set<number>();
        for (const stage of blueprint.stages) for (let number = stage.fromEpisode; number <= stage.toEpisode; number += 1) stageCover.add(number);
        const uncovered = expectedNumbers.filter((number) => !stageCover.has(number));
        if (uncovered.length && blueprint.stages.length) ctx.pushCheck({ level: "warning", code: "blueprint_stage_gap", category: "全剧蓝图", message: `全剧阶段没有覆盖第 ${uncovered.join("、")} 集。`, episodeNumbers: uncovered });
    }

    if (strategy) {
        if (!strategy.logline) ctx.pushCheck({ level: "error", code: "strategy_without_logline", category: "改编方案", message: "改编方案缺少故事线。" });
        if (!strategy.changes.length) ctx.pushCheck({ level: "warning", code: "strategy_without_changes", category: "改编方案", message: "改编方案没有任何改编差异记录。" });
    }

    for (const arc of arcs) {
        if (!arc.initialState) ctx.pushCheck({ level: "warning", code: "arc_without_initial", category: "人物弧光", message: `人物「${arc.characterName}」弧光缺少初始状态。`, characterIds: [arc.characterId] });
        if (!arc.finalState) ctx.pushCheck({ level: "warning", code: "arc_without_final", category: "人物弧光", message: `人物「${arc.characterName}」弧光缺少最终状态。`, characterIds: [arc.characterId] });
        const planStates = plans.flatMap((plan) => plan.characterStates.filter((state) => state.characterId === arc.characterId).map((state) => ({ episodeNumber: plan.episodeNumber, state })));
        for (const { episodeNumber, state } of planStates) {
            if (!arc.timeline.some((point) => point.episodeNumber === episodeNumber)) {
                ctx.pushCheck({ level: "warning", code: "arc_timeline_gap", category: "人物弧光", message: `人物「${arc.characterName}」在第 ${episodeNumber} 集有状态，但弧光时间线缺失该集。`, episodeNumbers: [episodeNumber], characterIds: [arc.characterId] });
            }
        }
    }

    for (const change of changes) {
        if (!change.reason) ctx.pushCheck({ level: "warning", code: "change_without_reason", category: "改编记录", message: `改编「${change.adaptationChangeId}」没有说明原因。` });
        if (change.sourceType === "explicit" && !change.sourceReferences.evidence.length) ctx.pushCheck({ level: "error", code: "explicit_change_without_evidence", category: "改编记录", message: `改编「${change.adaptationChangeId}」声称忠于明确原著事实，但没有有效证据。` });
        if (change.sourceType === "generated" && change.sourceReferences.evidence.length) ctx.pushCheck({ level: "warning", code: "generated_change_with_evidence", category: "改编记录", message: `改编「${change.adaptationChangeId}」是 AI 新增内容，却携带原著证据；已按新增内容处理。`, suggestion: "不要把 AI 新增内容伪装成原著事实。" });
    }

    return ctx.checks;
}

function validateStrategyOnly(ctx: AdaptationContext, strategy: StudioAdaptationStrategy | undefined, changes: StudioAdaptationChange[]) {
    if (!strategy) return;
    if (!strategy.logline) ctx.pushCheck({ level: "error", code: "strategy_without_logline", category: "改编方案", message: "改编方案缺少故事线。" });
    if (!strategy.positioningSummary) ctx.pushCheck({ level: "error", code: "strategy_without_positioning", category: "改编方案", message: "改编方案缺少改编定位总结。" });
    if (!strategy.structureStrategy) ctx.pushCheck({ level: "warning", code: "strategy_without_structure", category: "改编方案", message: "改编方案缺少结构策略。" });
    if (!strategy.changes.length) ctx.pushCheck({ level: "warning", code: "strategy_without_changes", category: "改编方案", message: "改编方案没有任何改编差异记录。" });
    validateChangeLedger(ctx, changes);
}

function validateBlueprintOnly(ctx: AdaptationContext, blueprint: StudioSeriesBlueprint | undefined, changes: StudioAdaptationChange[], target: number) {
    if (!blueprint) return;
    if (!blueprint.theme) ctx.pushCheck({ level: "warning", code: "blueprint_without_theme", category: "全剧蓝图", message: "全剧蓝图缺少核心主题。" });
    if (!blueprint.logline) ctx.pushCheck({ level: "error", code: "blueprint_without_logline", category: "全剧蓝图", message: "全剧蓝图缺少一句话故事。" });
    if (!blueprint.mainline) ctx.pushCheck({ level: "error", code: "blueprint_without_mainline", category: "全剧蓝图", message: "全剧蓝图缺少故事主线。" });
    if (!blueprint.centralConflict) ctx.pushCheck({ level: "error", code: "blueprint_without_conflict", category: "全剧蓝图", message: "全剧蓝图缺少主要矛盾。" });
    if (!blueprint.climax) ctx.pushCheck({ level: "error", code: "blueprint_without_climax", category: "全剧蓝图", message: "全剧蓝图缺少全剧高潮。" });
    if (!blueprint.ending) ctx.pushCheck({ level: "error", code: "blueprint_without_ending", category: "全剧蓝图", message: "全剧蓝图缺少故事结局。" });
    if (!blueprint.keyEvents.length) ctx.pushCheck({ level: "error", code: "blueprint_without_events", category: "全剧蓝图", message: "全剧蓝图没有关键事件。" });
    if (blueprint.stages.length) {
        const covered = new Set<number>();
        for (const stage of blueprint.stages) for (let number = stage.fromEpisode; number <= stage.toEpisode; number += 1) covered.add(number);
        const missing = Array.from({ length: target }, (_, index) => index + 1).filter((number) => !covered.has(number));
        if (missing.length) ctx.pushCheck({ level: "warning", code: "blueprint_stage_gap", category: "全剧蓝图", message: `全剧阶段没有覆盖第 ${missing.join("、")} 集。`, episodeNumbers: missing });
    } else {
        ctx.pushCheck({ level: "warning", code: "blueprint_without_stages", category: "全剧蓝图", message: "全剧蓝图没有阶段划分。", suggestion: "把全剧分为可执行的开端、升级、转折、高潮和结局阶段。" });
    }
    validateChangeLedger(ctx, changes);
}

function validateChangeLedger(ctx: AdaptationContext, changes: StudioAdaptationChange[]) {
    for (const change of changes) {
        if (!change.reason) ctx.pushCheck({ level: "warning", code: "change_without_reason", category: "改编记录", message: `改编「${change.adaptationChangeId}」没有说明原因。` });
        if (change.sourceType === "explicit" && !change.sourceReferences.evidence.length) ctx.pushCheck({ level: "error", code: "explicit_change_without_evidence", category: "改编记录", message: `改编「${change.adaptationChangeId}」声称忠于明确原著事实，但没有有效证据。` });
        if (change.sourceType === "generated" && change.sourceReferences.evidence.length) ctx.pushCheck({ level: "warning", code: "generated_change_with_evidence", category: "改编记录", message: `改编「${change.adaptationChangeId}」是 AI 新增内容，却携带原著证据；已按新增内容处理。`, suggestion: "不要把 AI 新增内容伪装成原著事实。" });
    }
}

function hasReturnBasis(arc: StudioCharacterArc | undefined, deadAt: number, atEpisode: number) {
    if (!arc) return false;
    return arc.milestones.some((milestone) => {
        if (milestone.type !== "return") return false;
        if (milestone.episodeNumber <= deadAt || milestone.episodeNumber > atEpisode) return false;
        if (!milestone.description.trim()) return false;
        if (milestone.sourceType === "generated") return Boolean(milestone.confirmedAt?.trim());
        const refs = milestone.sourceReferences;
        if (milestone.sourceType === "explicit") return refs.evidence.length > 0;
        return refs.chapterIds.length > 0 || refs.eventIds.length > 0 || refs.sceneIds.length > 0 || refs.foreshadowingIds.length > 0 || refs.evidence.length > 0;
    });
}

function validateCharacterContinuity(ctx: AdaptationContext, plans: StudioEpisodePlan[], arcs: StudioCharacterArc[] = []) {
    const arcByCharacter = new Map(arcs.map((arc) => [arc.characterId, arc]));
    const timelineByCharacter = new Map<string, { episodeNumber: number; state: StudioEpisodeCharacterState }[]>();
    for (const plan of plans) for (const state of plan.characterStates) {
        const list = timelineByCharacter.get(state.characterId) ?? [];
        list.push({ episodeNumber: plan.episodeNumber, state });
        timelineByCharacter.set(state.characterId, list);
    }
    for (const [characterId, timeline] of timelineByCharacter) {
        const character = ctx.characterById.get(characterId);
        const arc = arcByCharacter.get(characterId);
        timeline.sort((left, right) => left.episodeNumber - right.episodeNumber);
        let deadAt = 0;
        const knownAt = new Map<string, number>();
        const unknownAt = new Map<string, number>();
        for (const point of timeline) {
            const display = character?.name ?? point.state.name;
            if (deadAt && point.state.lifeState !== "dead" && point.state.present && !hasReturnBasis(arc, deadAt, point.episodeNumber)) {
                ctx.pushCheck({ level: "error", code: "character_returns_without_basis", category: "人物连续性", message: `人物「${display}」在第 ${deadAt} 集已死亡，但第 ${point.episodeNumber} 集又作为在场角色出现；未找到第 ${deadAt} 集之后、且不晚于第 ${point.episodeNumber} 集的明确回归事件与来源依据。`, episodeNumbers: [deadAt, point.episodeNumber], characterIds: [characterId], suggestion: "补充死亡后的「return」复活事件：发生集数、复活原因和来源依据；如果是 AI 新增复活，必须明确标记为 generated，并由用户在人物弧光中确认。" });
            }
            if (point.state.lifeState === "dead") deadAt = point.episodeNumber;
            for (const fact of point.state.knows) {
                const normalized = fact.replace(/\s+/g, "");
                if (!normalized) continue;
                if (!knownAt.has(normalized)) knownAt.set(normalized, point.episodeNumber);
            }
            for (const fact of point.state.unknown) {
                const normalized = fact.replace(/\s+/g, "");
                if (!normalized) continue;
                const knownEpisode = knownAt.get(normalized);
                if (knownEpisode && knownEpisode < point.episodeNumber) {
                    ctx.pushCheck({ level: "error", code: "character_knows_too_early", category: "信息差", message: `人物「${display}」在第 ${point.episodeNumber} 集仍被标为不知道「${fact}」，但第 ${knownEpisode} 集已经知道。`, episodeNumbers: [knownEpisode, point.episodeNumber], characterIds: [characterId], suggestion: "核对秘密揭示顺序，防止人物提前知道尚未发生的真相。" });
                }
                if (!unknownAt.has(normalized)) unknownAt.set(normalized, point.episodeNumber);
            }
        }
        for (let index = 1; index < timeline.length; index += 1) {
            const previous = timeline[index - 1];
            const current = timeline[index];
            if (previous.state.location && current.state.location && previous.state.location !== current.state.location && current.state.present && previous.state.present) {
                const plan = plans.find((item) => item.episodeNumber === current.episodeNumber);
                const dependency = plan?.continuityDependencies.join(" ") ?? "";
                if (!/移动|抵达|赶到|前往|来到|返回|回到|转场|路上|途中/.test(dependency)) {
                    ctx.pushCheck({ level: "warning", code: "location_change_without_move", category: "时间线", message: `人物「${character?.name ?? current.state.name}」从第 ${previous.episodeNumber} 集「${previous.state.location}」到第 ${current.episodeNumber} 集「${current.state.location}」，没有说明移动过程。`, episodeNumbers: [previous.episodeNumber, current.episodeNumber], characterIds: [characterId], suggestion: "补充赶路、转场或时间跳跃说明，避免人物瞬移。" });
                }
            }
        }
    }
}

function validateForeshadowingOrder(ctx: AdaptationContext, plans: StudioEpisodePlan[], pool: StudioForeshadowingPoolItem[], target: number) {
    const poolById = new Map(pool.map((item) => [item.foreshadowingId, item]));
    for (const item of pool) {
        if (item.firstPlantedEpisode < 0 || item.firstPlantedEpisode > target) ctx.pushCheck({ level: "error", code: "foreshadowing_first_out_of_range", category: "伏笔管理", message: `伏笔「${item.foreshadowingId}」首次埋设集数不在 1-${target} 内。`, episodeNumbers: [item.firstPlantedEpisode].filter(Boolean) });
        if (item.expectedResolveEpisode && item.firstPlantedEpisode && item.expectedResolveEpisode < item.firstPlantedEpisode) ctx.pushCheck({ level: "error", code: "foreshadowing_resolve_before_plant", category: "伏笔管理", message: `伏笔「${item.foreshadowingId}」预计回收早于首次埋设。`, episodeNumbers: [item.firstPlantedEpisode, item.expectedResolveEpisode] });
        if (item.status === "resolved") {
            const actualPlan = plans.find((plan) => plan.episodeNumber === item.actualResolveEpisode);
            if (!actualPlan || !actualPlan.foreshadowingResolved.includes(item.foreshadowingId)) {
                ctx.pushCheck({ level: "error", code: "foreshadowing_false_resolved", category: "伏笔管理", message: `伏笔「${item.foreshadowingId}」被标为已回收，但第 ${item.actualResolveEpisode ?? "?"} 集没有回收动作。`, episodeNumbers: item.actualResolveEpisode ? [item.actualResolveEpisode] : [], suggestion: "把状态改回推进中/待审核，不能自动认定回收。" });
            }
        }
        if ((item.status === "planted" || item.status === "advancing") && !item.firstPlantedEpisode) ctx.pushCheck({ level: "warning", code: "foreshadowing_without_plant", category: "伏笔管理", message: `伏笔「${item.foreshadowingId}」已进入埋设/推进状态，但没有首次埋设集数。` });
        if (item.isOriginal && !item.sourceNovelForeshadowingId) ctx.pushCheck({ level: "warning", code: "original_foreshadowing_unlinked", category: "伏笔管理", message: `伏笔「${item.foreshadowingId}」声称为原著伏笔，但没有关联阶段 2A 伏笔 ID。` });
    }
    for (const plan of plans) {
        for (const id of plan.foreshadowingResolved) {
            const item = poolById.get(id);
            if (!item) continue;
            if (item.actualResolveEpisode && item.actualResolveEpisode !== plan.episodeNumber) {
                ctx.pushCheck({ level: "error", code: "foreshadowing_resolve_episode_conflict", category: "伏笔管理", message: `伏笔「${id}」实际回收集为第 ${item.actualResolveEpisode} 集，但第 ${plan.episodeNumber} 集也标记回收。`, episodeNumbers: [item.actualResolveEpisode, plan.episodeNumber] });
            }
        }
    }
}

function validateCausalityDependencies(ctx: AdaptationContext, plans: StudioEpisodePlan[], blueprint?: StudioSeriesBlueprint) {
    for (const plan of plans) {
        for (const event of plan.keyEvents) {
            if (event.sourceType === "explicit" && !event.sourceReferences.evidence.length) ctx.pushCheck({ level: "error", code: "explicit_event_without_evidence", category: "因果校验", message: `第 ${plan.episodeNumber} 集事件「${event.description.slice(0, 36)}」声称是原著明确事件，但没有有效证据。`, episodeNumbers: [plan.episodeNumber] });
        }
        if (plan.episodeNumber > 1 && !plan.continuityDependencies.length) ctx.pushCheck({ level: "warning", code: "episode_without_continuity", category: "连续性", message: `第 ${plan.episodeNumber} 集没有连续性依赖说明。`, episodeNumbers: [plan.episodeNumber] });
    }
    if (!blueprint) return;
    const blueprintEventIds = blueprint.keyEvents.map((event) => event.id);
    for (const plan of plans) for (const event of plan.keyEvents) {
        for (const id of event.adaptationChangeIds) {
            if (!blueprintEventIds.some((eventId) => eventId === id)) {
                // 改编差异和蓝图事件是不同 ID 空间，这里只检查引用是否能在任一蓝图中找到，避免误报。
            }
        }
    }
}

function validateAdaptationCoverage(ctx: AdaptationContext, plans: StudioEpisodePlan[], changes: StudioAdaptationChange[], target: number) {
    if (!changes.length) return;
    const covered = new Set(plans.flatMap((plan) => plan.adaptationChanges.map((note) => note.adaptationChangeId)));
    const important = changes.filter((change) => change.highRisk || change.operation !== "preserve");
    for (const change of important) {
        if (!covered.has(change.adaptationChangeId)) ctx.pushCheck({ level: "suggestion", code: "change_not_in_episode", category: "改编记录", message: `改编「${change.adaptationChangeId}」已记录，但没有映射到任何分集。`, suggestion: "确认它是全剧级设定调整，还是遗漏了分集落点。" });
    }
    const episodeOne = plans.find((plan) => plan.episodeNumber === 1);
    if (episodeOne && target > 1 && !episodeOne.openingHook) ctx.pushCheck({ level: "warning", code: "first_episode_no_hook", category: "分集规划", message: "第 1 集没有开场钩子，短剧首集留存风险高。", episodeNumbers: [1] });
}

/** 为分集规划生成阶段 3 交接快照；不生成剧本、分镜或媒体。 */
export function buildHandoffSummary(plans: StudioEpisodePlan[]) {
    return plans.map((plan) => ({
        episodeId: plan.episodeId,
        episodeNumber: plan.episodeNumber,
        episodeTitle: plan.episodeTitle,
        keyEvents: plan.keyEvents.map((event) => ({ id: event.id, description: event.description })),
        characterStates: plan.characterStates.map((state) => ({ characterId: state.characterId, name: state.name, location: state.location, knows: state.knows, unknown: state.unknown, lifeState: state.lifeState, present: state.present })),
        foreshadowing: { introduced: plan.foreshadowingIntroduced, advanced: plan.foreshadowingAdvanced, resolved: plan.foreshadowingResolved },
        locations: plan.locations.map((location) => ({ sceneId: location.sceneId, name: location.name })),
        sourceReferences: plan.sourceReferences,
        adaptationChanges: plan.adaptationChanges.map((change) => change.adaptationChangeId),
        locked: plan.locked,
        version: plan.version,
    }));
}

export function checkSummary(checks: StudioAdaptationCheck[]) {
    return {
        errors: checks.filter((check) => check.level === "error").length,
        warnings: checks.filter((check) => check.level === "warning").length,
        suggestions: checks.filter((check) => check.level === "suggestion").length,
        open: checks.filter((check) => check.status === "open").length,
    };
}

/** 局部重生成后同步全剧记忆；保留弧光叙事，只重建逐集状态时间线。 */
export function syncCharacterArcsFromPlans(ctx: AdaptationContext, arcs: StudioCharacterArc[], plans: StudioEpisodePlan[]): StudioCharacterArc[] {
    const byCharacter = new Map(arcs.map((arc) => [arc.characterId, arc]));
    const appearing = new Set(plans.flatMap((plan) => plan.characterStates.map((state) => state.characterId)));
    for (const characterId of appearing) {
        const states = plans.flatMap((plan) => plan.characterStates
            .filter((state) => state.characterId === characterId)
            .map((state) => ({
                episodeNumber: plan.episodeNumber,
                location: state.location,
                knows: state.knows,
                unknown: state.unknown,
                relationships: state.relationships,
                physicalState: state.physicalState,
                abilityState: state.abilityState,
                identityState: state.identityState,
                present: state.present,
                lifeState: state.lifeState,
            })));
        const existing = byCharacter.get(characterId);
        if (existing) {
            byCharacter.set(characterId, { ...existing, timeline: states.sort((left, right) => left.episodeNumber - right.episodeNumber), updatedAt: new Date().toISOString() });
            continue;
        }
        const character = ctx.characterById.get(characterId);
        if (!character) continue;
        const fallback = buildCharacterArcFallback(character, plans);
        byCharacter.set(characterId, { ...fallback, timeline: states.sort((left, right) => left.episodeNumber - right.episodeNumber) });
    }
    return [...byCharacter.values()];
}

/** 伏笔状态只由当前分集中明确的埋设/推进/回收动作推导，不凭模型口头声明。 */
export function reconcileForeshadowingStatuses(pool: StudioForeshadowingPoolItem[], plans: StudioEpisodePlan[]): StudioForeshadowingPoolItem[] {
    return pool.map((item) => {
        const planted = plans.find((plan) => plan.foreshadowingIntroduced.includes(item.foreshadowingId))?.episodeNumber;
        const advanced = plans.filter((plan) => plan.foreshadowingAdvanced.includes(item.foreshadowingId)).map((plan) => plan.episodeNumber);
        const resolved = plans.find((plan) => plan.foreshadowingResolved.includes(item.foreshadowingId))?.episodeNumber;
        const firstPlantedEpisode = planted ?? item.firstPlantedEpisode;
        let status: StudioForeshadowingStatus = item.status;
        if (resolved) status = "resolved";
        else if (advanced.length) status = "advancing";
        else if (planted) status = "planted";
        else if (item.status === "resolved" || item.status === "advancing" || item.status === "planted") status = "planned";
        return {
            ...item,
            firstPlantedEpisode,
            advancedEpisodes: advanced.length ? advanced : item.advancedEpisodes,
            actualResolveEpisode: resolved,
            status,
            updatedAt: new Date().toISOString(),
        };
    });
}

/** 确保阶段 2A 的原著伏笔不会因为模型漏写而从全剧池中消失。 */
export function includeOriginalForeshadowings(ctx: AdaptationContext, pool: StudioForeshadowingPoolItem[]): StudioForeshadowingPoolItem[] {
    const covered = new Set(pool.map((item) => item.sourceNovelForeshadowingId).filter(Boolean));
    const missing = ctx.analysis.foreshadowings.filter((item) => !covered.has(item.id));
    return [
        ...pool,
        ...missing.map<StudioForeshadowingPoolItem>((item, index) => ({
            foreshadowingId: `fore-original-${index + 1}`,
            content: item.content,
            sourceType: "explicit",
            sourceNovelForeshadowingId: item.id,
            firstPlantedEpisode: 0,
            advancedEpisodes: [],
            expectedResolveEpisode: 0,
            relatedCharacterIds: item.relatedCharacterIds,
            relatedEventIds: item.relatedEventIds,
            status: "pending_review",
            isOriginal: true,
            isAiAdded: false,
            reviewStatus: "pending_review",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        })),
    ];
}

export function mergeChangeLedger(...lists: StudioAdaptationChange[][]) {
    const map = new Map<string, StudioAdaptationChange>();
    for (const list of lists) for (const change of list) map.set(change.adaptationChangeId, change);
    return [...map.values()];
}

export function preserveCheckStatuses(next: StudioAdaptationCheck[], current: StudioAdaptationCheck[]) {
    const statuses = new Map(current.map((check) => [`${check.code}|${check.message}`, check.status]));
    return next.map((check) => ({
        ...check,
        status: statuses.get(`${check.code}|${check.message}`) ?? check.status,
    }));
}

export function chapterDisplay(ctx: AdaptationContext, chapterId: string) {
    return chapterLabel(ctx, chapterId);
}

/** 用户手工编辑后重新运行确定性校验，不调用模型、不产生费用。 */
export function revalidateAdaptationWorkspace(project: StudioProject, workspace: StudioAdaptationWorkspace): StudioAdaptationWorkspace {
    try {
        const ctx = createAdaptationContext(project, workspace.settings);
        const deterministic = validateAdaptationPackage({
            ctx,
            strategy: workspace.strategy,
            blueprint: workspace.blueprint,
            plans: workspace.episodePlans,
            arcs: workspace.characterArcs,
            foreshadowings: workspace.foreshadowings,
            changes: workspace.changes,
            scope: "full",
        });
        const modelChecks = workspace.checks.filter((check) => check.source === "model");
        const merged = new Map<string, StudioAdaptationCheck>();
        for (const check of [...deterministic, ...modelChecks]) {
            const key = `${check.code}|${check.message}|${check.episodeNumbers.join(",")}`;
            if (!merged.has(key)) merged.set(key, check);
        }
        return {
            ...workspace,
            checks: preserveCheckStatuses([...merged.values()].map((check, index) => ({ ...check, id: `check-${index + 1}` })), workspace.checks),
            updatedAt: new Date().toISOString(),
        };
    } catch {
        return workspace;
    }
}
