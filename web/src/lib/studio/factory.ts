import { nanoid } from "nanoid";

import {
    DEFAULT_PROJECT_SETTINGS,
    DEFAULT_VISUAL_STYLE,
    DRAMA_STEP_KEYS,
    EMPTY_DRAMA_MODEL_PROFILES,
    EMPTY_SCRIPT,
    createDefaultDramaStepStates,
    type DramaModelProfiles,
    type DramaStep,
    type StudioAsset,
    type StudioAssetKind,
    type StudioEpisode,
    type StudioProject,
    type StudioProjectSettings,
    type StudioScene,
    type StudioShot,
} from "@/types/studio";
import type { NovelAnalysis, NovelAnalysisOverrides, NovelAnalysisRun, StudioNovel } from "@/types/novel";

import { createStudioAdaptationWorkspace, normalizeStudioAdaptation } from "./adaptation-workspace";
import { createEpisodeProduction, createStudioProductionWorkspace, normalizeEpisodeProduction, normalizeStudioProduction } from "./production-workspace";

// 新短剧工坊的实体工厂：所有默认值只有这一份，store / 迁移 / 测试共用。

export const nowIso = () => new Date().toISOString();

export function createStudioProject(input: {
    title: string;
    logline?: string;
    targetSeconds?: number;
    episodeCount?: number;
    settings?: Partial<StudioProjectSettings>;
    modelProfiles?: DramaModelProfiles;
}): StudioProject {
    const now = nowIso();
    const settings: StudioProjectSettings = { ...DEFAULT_PROJECT_SETTINGS, ...(input.targetSeconds ? { targetSeconds: input.targetSeconds } : {}), ...input.settings };
    // 阶段 1 起分集由第一步分析产生；新建项目不再要求用户预填集数。旧调用仍可显式传入。
    const episodeCount = Math.max(0, Math.min(30, input.episodeCount ?? 0));
    const project: StudioProject = {
        id: `proj-${nanoid(8)}`,
        title: input.title.trim() || "未命名短剧",
        logline: input.logline?.trim() ?? "",
        genre: "",
        settings,
        bible: { logline: input.logline?.trim() ?? "", synopsis: "", world: "", background: "", mainPlot: "", conflict: "", ending: "", relations: "", characters: [] },
        visualStyle: { ...DEFAULT_VISUAL_STYLE },
        assets: [],
        episodes: Array.from({ length: episodeCount }, (_, index) => createEpisode(index + 1, settings.targetSeconds)),
        workflowMode: "all",
        automationMode: "auto",
        adaptationMode: "adapt",
        projectStatus: "draft",
        currentStep: "analysis",
        stepStates: createDefaultDramaStepStates(),
        modelProfiles: input.modelProfiles ?? { ...EMPTY_DRAMA_MODEL_PROFILES, selected: {}, paramsByKey: {} },
        createdAt: now,
        updatedAt: now,
    };
    return { ...project, adaptation: createStudioAdaptationWorkspace(project), production: createStudioProductionWorkspace() };
}

/** 持久化数据补默认字段；不覆盖既有用户内容，也不把旧项目改造成“必须重新分析小说”。 */
export function normalizeStudioProject(project: StudioProject): StudioProject {
    const episodes = Array.isArray(project.episodes) ? project.episodes : [];
    const assets = Array.isArray(project.assets) ? project.assets : [];    const legacyDefaultStep: DramaStep = project.legacySequenceId || episodes.length || assets.length ? "script" : "analysis";
    const modelProfiles = project.modelProfiles && typeof project.modelProfiles === "object" ? normalizeDramaModelProfiles(project.modelProfiles) : { ...EMPTY_DRAMA_MODEL_PROFILES, selected: {}, paramsByKey: {} };
    const currentStep = DRAMA_STEP_KEYS.includes(project.currentStep) ? project.currentStep : legacyDefaultStep;
    const novel = normalizeNovel(project.novel);
    const analysisRuns = normalizeAnalysisRuns(project.analysisRuns);
    return {
        ...project,
        settings: { ...DEFAULT_PROJECT_SETTINGS, ...(project.settings ?? {}) },
        visualStyle: { ...DEFAULT_VISUAL_STYLE, ...(project.visualStyle ?? {}) },
        assets,
        episodes: episodes.map((episode) => ({ ...episode, production: normalizeEpisodeProduction(episode.production) })),
        workflowMode: project.workflowMode ?? "all",
        automationMode: project.automationMode ?? "auto",
        adaptationMode: project.adaptationMode ?? "adapt",
        projectStatus: project.projectStatus ?? "draft",
        currentStep,
        stepStates: { ...createDefaultDramaStepStates(), ...(project.stepStates ?? {}) },
        modelProfiles,
        novel,
        novelId: novel?.id ?? project.novelId,
        adaptation: normalizeStudioAdaptation(project, project.adaptation),
        production: normalizeStudioProduction(project.production),
        novelAnalysis: normalizeNovelAnalysis(project.novelAnalysis),
        novelAnalysisOverrides: normalizeNovelAnalysisOverrides(project.novelAnalysisOverrides),
        analysisRuns,
    };
}

function normalizeNovel(value: StudioNovel | undefined) {
    if (!value || typeof value !== "object" || !Array.isArray(value.chapters)) return undefined;
    return {
        ...value,
        warnings: Array.isArray(value.warnings) ? value.warnings : [],
        chapters: value.chapters.filter((chapter) => chapter && typeof chapter.text === "string"),
        chapterCount: value.chapters.length,
        charCount: Number(value.charCount) || value.chapters.reduce((total, chapter) => total + chapter.text.length, 0),
    };
}

function normalizeNovelAnalysis(value: NovelAnalysis | undefined) {
    if (!value || typeof value !== "object") return undefined;
    return {
        ...value,
        characters: Array.isArray(value.characters) ? value.characters : [],
        relationships: Array.isArray(value.relationships) ? value.relationships : [],
        scenes: Array.isArray(value.scenes) ? value.scenes : [],
        events: Array.isArray(value.events) ? value.events : [],
        foreshadowings: Array.isArray(value.foreshadowings) ? value.foreshadowings : [],
        warnings: Array.isArray(value.warnings) ? value.warnings : [],
    };
}

export function emptyNovelAnalysisOverrides(): NovelAnalysisOverrides {
    return {
        version: 1,
        updatedAt: nowIso(),
        characters: {},
        relationships: {},
        scenes: {},
        events: {},
        foreshadowings: {},
    };
}

function normalizeNovelAnalysisOverrides(value: NovelAnalysisOverrides | undefined) {
    if (!value || typeof value !== "object") return emptyNovelAnalysisOverrides();
    return {
        ...emptyNovelAnalysisOverrides(),
        ...value,
        version: 1 as const,
        characters: value.characters ?? {},
        relationships: value.relationships ?? {},
        scenes: value.scenes ?? {},
        events: value.events ?? {},
        foreshadowings: value.foreshadowings ?? {},
    };
}

function normalizeAnalysisRuns(value: NovelAnalysisRun[] | undefined) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((run) => run && typeof run.id === "string")
        .map((run) => ({
            ...run,
            chunks: Array.isArray(run.chunks) ? run.chunks : [],
            chunksTotal: Number(run.chunksTotal) || run.chunks.length,
            chunksDone: Number(run.chunksDone) || run.chunks.filter((chunk) => chunk.status === "succeeded").length,
            modelParams: run.modelParams ?? {},
        }));
}

function normalizeDramaModelProfiles(value: DramaModelProfiles): DramaModelProfiles {
    return {
        version: 1,
        selected: value.selected && typeof value.selected === "object" ? { ...value.selected } : {},
        paramsByKey: value.paramsByKey && typeof value.paramsByKey === "object" ? { ...value.paramsByKey } : {},
    };
}

export function createEpisode(no: number, targetSeconds: number, title?: string): StudioEpisode {
    const now = nowIso();
    return {
        id: `ep-${nanoid(8)}`,
        no,
        title: title?.trim() || `第 ${no} 集`,
        targetSeconds,
        coreEvent: "",
        mainConflict: "",
        continuity: "",
        hook: "",
        script: { ...EMPTY_SCRIPT, referenceFiles: [], outlineVersions: [], versions: [] },
        scenes: [],
        shots: [],
        production: createEpisodeProduction(),
        createdAt: now,
        updatedAt: now,
    };
}

export function createScene(no: string, name: string, location = ""): StudioScene {
    return { id: `scene-${nanoid(8)}`, no, name: name.trim() || `场景 ${no}`, location, description: "", timeOfDay: "", weather: "" };
}

export function defaultShot(episodeId: string, sceneId: string, no: string): StudioShot {
    return {
        id: `shot-${nanoid(8)}`,
        episodeId,
        sceneId,
        no,
        sceneName: "",
        description: "",
        characterNames: [],
        assetIds: [],
        action: "",
        expression: "",
        position: "",
        orientation: "",
        environment: "",
        size: "中景",
        camera: "平视",
        lens: "自动",
        movement: "固定",
        composition: "三分构图",
        lighting: "左侧主光",
        effects: "",
        line: "",
        speaker: "",
        narration: "",
        ambience: "",
        sfx: "",
        seconds: 5,
        imageStatus: "idle",
        videoStatus: "idle",
        audioStatus: "idle",
        narrationStatus: "idle",
        sfxStatus: "idle",
        imageVersions: [],
        videoVersions: [],
        audioVersions: [],
        narrationVersions: [],
        sfxVersions: [],
    };
}

export function createAsset(kind: StudioAssetKind, name: string): StudioAsset {
    const now = nowIso();
    return {
        id: `asset-${nanoid(8)}`,
        kind,
        name: name.trim() || "未命名资产",
        role: "",
        description: "",
        age: "",
        face: "",
        hair: "",
        body: "",
        costume: "",
        layout: "",
        environment: "",
        timeOfDay: "",
        weather: "",
        lighting: "",
        material: "",
        versions: [],
        createdAt: now,
        updatedAt: now,
    };
}

export function createMediaVersion(input: Omit<StudioAsset["versions"][number], "id" | "createdAt"> & { createdAt?: string }) {
    return { ...input, id: `ver-${nanoid(8)}`, createdAt: input.createdAt ?? nowIso() };
}

export function nextShotNo(shots: StudioShot[]) {
    const used = new Set(shots.map((shot) => shot.no));
    let index = shots.length + 1;
    while (used.has(String(index).padStart(2, "0"))) index += 1;
    return String(index).padStart(2, "0");
}
