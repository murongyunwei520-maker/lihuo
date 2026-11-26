import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { storageKey } from "@/constant/app";
import { localForageStorage } from "@/lib/localforage-storage";
import { commitStudioStructuralDeletion, parseStudioEnvelope } from "@/lib/studio-store-persistence";
import { affectedByAsset, affectedByVoice, shotsUsingAsset } from "@/lib/studio/deps";
import { createAsset, createEpisode, createScene, createStudioProject, defaultShot, emptyNovelAnalysisOverrides, nextShotNo, normalizeStudioProject, nowIso } from "@/lib/studio/factory";
import { createStudioAdaptationWorkspace } from "@/lib/studio/adaptation-workspace";
import { buildDefaultDramaModelProfiles, updateProjectSettingsModels, withProjectModelParam, withProjectModelSelection } from "@/lib/studio/model-profile";
import { migrateLegacySequences } from "@/lib/studio/migrate";
import { normalizeProductionForHydration } from "@/lib/studio/production-workspace";
import { useConfigStore } from "@/stores/use-config-store";
import type { DramaSequence } from "@/types/drama";
import type { NovelAnalysis, NovelAnalysisOverrides, NovelAnalysisRun, StudioNovel } from "@/types/novel";
import type { StudioAdaptationWorkspace } from "@/types/studio-adaptation";
import type { StudioEpisodeProduction, StudioProductionWorkspace } from "@/types/studio-production";
import {
    type DramaModelCapability,
    type DramaStep,
    type DramaStepStatus,
    type StudioAsset,
    type StudioAssetKind,
    type StudioEpisode,
    type StudioMediaKind,
    type StudioMediaStatus,
    type StudioMediaVersion,
    type StudioMusicTrack,
    type StudioProject,
    type StudioProjectSettings,
    type StudioReferenceFile,
    type StudioScene,
    type StudioScript,
    type StudioShot,
    type StudioStoryBible,
    type StudioVisualStyle,
} from "@/types/studio";

// 唯一权威的短剧数据仓：项目（含跨集资产）→ 集（剧本/场景/镜头）→ 媒体版本。
// 六大工作区、画布节点、任务中心都读写这一份 store，不各自维护副本。

type ProjectPatch = Partial<Omit<StudioProject, "id" | "createdAt" | "episodes" | "assets">>;
type EpisodePatch = Partial<Omit<StudioEpisode, "id" | "createdAt" | "scenes" | "shots" | "script">>;
type ShotPatch = Partial<Omit<StudioShot, "id" | "episodeId">>;

type Result = { ok: boolean; reason?: string };

const VERSION_FIELD = {
    image: "imageVersions",
    video: "videoVersions",
    audio: "audioVersions",
    narration: "narrationVersions",
    sfx: "sfxVersions",
} as const satisfies Record<StudioMediaKind, keyof StudioShot>;

const REF_FIELD = {
    image: "imageRef",
    video: "videoRef",
    audio: "audioRef",
    narration: "narrationRef",
    sfx: "sfxRef",
} as const satisfies Record<StudioMediaKind, keyof StudioShot>;

const STATUS_FIELD = {
    image: "imageStatus",
    video: "videoStatus",
    audio: "audioStatus",
    narration: "narrationStatus",
    sfx: "sfxStatus",
} as const satisfies Record<StudioMediaKind, keyof StudioShot>;

function touch(project: StudioProject): StudioProject {
    return { ...project, updatedAt: nowIso() };
}

function mapProject(projects: StudioProject[], id: string, updater: (project: StudioProject) => StudioProject) {
    return projects.map((project) => (project.id === id ? touch(updater(project)) : project));
}

function mapEpisode(project: StudioProject, episodeId: string, updater: (episode: StudioEpisode) => StudioEpisode): StudioProject {
    return {
        ...project,
        episodes: project.episodes.map((episode) => (episode.id === episodeId ? { ...updater(episode), updatedAt: nowIso() } : episode)),
    };
}

function renumber(shots: StudioShot[]): StudioShot[] {
    return shots.map((shot, index) => ({ ...shot, no: String(index + 1).padStart(2, "0") }));
}

function uniqueTitle(project: StudioProject, base: string) {
    const used = new Set(project.episodes.map((episode) => episode.title));
    if (!used.has(base)) return base;
    let index = 2;
    while (used.has(`${base} 副本${index > 2 ? ` ${index}` : ""}`)) index += 1;
    return `${base} 副本${index > 2 ? ` ${index}` : ""}`;
}

/** 刷新/重开页面后，上个页面里的内存请求已经不存在；只标记中断，不自动重提，避免重复扣费。 */
function markInterruptedAnalysisRuns(project: StudioProject): StudioProject {
    const active = new Set(["pending", "queued", "submitting", "running", "cancelling"]);
    const runs = (project.analysisRuns ?? []).map((run) =>
        active.has(run.status)
            ? {
                  ...run,
                  status: "interrupted" as const,
                  error: "页面刷新或关闭后分析任务中断；请先确认当前结果，再手动继续或重试",
                  updatedAt: nowIso(),
                  chunks: run.chunks.map((chunk) => (chunk.status === "running" ? { ...chunk, status: "failed" as const, error: "页面刷新后中断" } : chunk)),
              }
            : run,
    );
    const stillActive = runs.some((run) => run.status === "interrupted");
    return {
        ...project,
        analysisRuns: runs,
        ...(stillActive && project.projectStatus === "analyzing" ? { projectStatus: "paused" as const } : {}),
        ...(stillActive && project.stepStates.analysis === "running" ? { stepStates: { ...project.stepStates, analysis: "paused" as const } } : {}),
    };
}

type StudioStore = {
    hydrated: boolean;
    migrationDone: boolean;
    hydrationError: string | null;
    projects: StudioProject[];

    createProject: (input: { title: string; logline?: string; targetSeconds?: number; episodeCount?: number }) => string;
    updateProject: (projectId: string, patch: ProjectPatch) => void;
    deleteProject: (projectId: string) => Promise<Result>;
    archiveProject: (projectId: string, archived: boolean) => void;

    createEpisode: (projectId: string, title?: string, targetSeconds?: number) => string | null;
    duplicateEpisode: (projectId: string, episodeId: string) => string | null;
    deleteEpisode: (projectId: string, episodeId: string) => Promise<Result>;
    updateEpisode: (projectId: string, episodeId: string, patch: EpisodePatch) => void;
    reorderEpisodes: (projectId: string, episodeIds: string[]) => void;

    updateScript: (projectId: string, episodeId: string, patch: Partial<StudioScript>) => void;
    saveScriptVersion: (projectId: string, episodeId: string, field: "text" | "outline", note?: string) => void;
    restoreScriptVersion: (projectId: string, episodeId: string, field: "text" | "outline", versionId: string) => void;
    addReferenceFile: (projectId: string, episodeId: string, file: StudioReferenceFile) => void;
    confirmScript: (projectId: string, episodeId: string) => void;

    updateBible: (projectId: string, patch: Partial<StudioStoryBible>) => void;
    updateVisualStyle: (projectId: string, patch: Partial<StudioVisualStyle>) => void;
    updateSettings: (projectId: string, patch: Partial<StudioProjectSettings>) => void;
    /** 只改项目模型方案；不触碰全局 AiConfig。 */
    setProjectModel: (projectId: string, capability: DramaModelCapability, option: string) => void;
    setProjectModelParam: (projectId: string, capability: DramaModelCapability, key: string, value: string | number | boolean | undefined) => void;
    setStepState: (projectId: string, step: DramaStep, status: DramaStepStatus) => void;
    setProjectStatus: (projectId: string, status: StudioProject["projectStatus"]) => void;

    setNovel: (projectId: string, novel: StudioNovel | undefined) => void;
    deleteNovel: (projectId: string) => void;
    updateAdaptation: (projectId: string, updater: (current: StudioAdaptationWorkspace) => StudioAdaptationWorkspace) => void;
    updateProduction: (projectId: string, updater: (current: StudioProductionWorkspace) => StudioProductionWorkspace) => void;
    updateEpisodeProduction: (projectId: string, episodeId: string, updater: (current: StudioEpisodeProduction) => StudioEpisodeProduction) => void;
    setNovelAnalysis: (projectId: string, analysis: NovelAnalysis | undefined) => void;
    updateNovelAnalysisOverrides: (projectId: string, updater: (current: NovelAnalysisOverrides) => NovelAnalysisOverrides) => void;
    upsertAnalysisRun: (projectId: string, run: NovelAnalysisRun) => void;
    updateAnalysisRun: (projectId: string, runId: string, patch: Partial<NovelAnalysisRun>) => void;
    setAnalysisRunId: (projectId: string, runId: string | undefined) => void;

    createAsset: (projectId: string, kind: StudioAssetKind, name: string) => string | null;
    updateAsset: (projectId: string, assetId: string, patch: Partial<StudioAsset>) => void;
    deleteAsset: (projectId: string, assetId: string) => Result;
    addAssetVersion: (projectId: string, assetId: string, version: Omit<StudioMediaVersion, "id" | "createdAt">) => string | null;
    chooseAssetVersion: (projectId: string, assetId: string, versionId: string) => number;
    bindVoice: (projectId: string, assetId: string, voiceId: string) => void;

    addBgmTrack: (projectId: string, track: Omit<StudioMusicTrack, "id" | "createdAt">) => void;
    updateBgmTrack: (projectId: string, trackId: string, patch: Partial<StudioMusicTrack>) => void;
    removeBgmTrack: (projectId: string, trackId: string) => void;

    setScenes: (projectId: string, episodeId: string, scenes: StudioScene[]) => void;
    createScene: (projectId: string, episodeId: string, name: string, location?: string) => string | null;
    updateScene: (projectId: string, episodeId: string, sceneId: string, patch: Partial<StudioScene>) => void;

    replaceShots: (projectId: string, episodeId: string, shots: StudioShot[]) => void;
    addShot: (projectId: string, episodeId: string, sceneId?: string) => string | null;
    updateShot: (projectId: string, episodeId: string, shotId: string, patch: ShotPatch) => void;
    deleteShot: (projectId: string, episodeId: string, shotId: string) => void;
    splitShot: (projectId: string, episodeId: string, shotId: string) => string | null;
    mergeShots: (projectId: string, episodeId: string, firstId: string, secondId: string) => Result;
    moveShot: (projectId: string, episodeId: string, shotId: string, direction: -1 | 1) => void;
    lockShot: (projectId: string, episodeId: string, shotId: string, locked: boolean) => void;
    reorderShots: (projectId: string, episodeId: string, shotIds: string[]) => void;

    recordShotVersion: (
        projectId: string,
        episodeId: string,
        shotId: string,
        media: StudioMediaKind,
        version: Omit<StudioMediaVersion, "id" | "createdAt">,
        options?: { makeOfficial?: boolean; status?: StudioMediaStatus },
    ) => StudioMediaVersion | null;
    chooseShotVersion: (projectId: string, episodeId: string, shotId: string, media: StudioMediaKind, versionId: string) => void;
    setShotStatus: (projectId: string, episodeId: string, shotId: string, media: StudioMediaKind, status: StudioMediaStatus, impact?: string) => void;
    setVideoRemote: (projectId: string, episodeId: string, shotId: string, remote: StudioShot["videoRemote"]) => void;
    clearImpact: (projectId: string, episodeId: string, shotId: string, media?: StudioMediaKind) => void;
    refreshAssetImpact: (projectId: string, assetId: string) => number;
};

export const useStudioStore = create<StudioStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            migrationDone: false,
            hydrationError: null,
            projects: [],

            createProject: (input) => {
                const config = useConfigStore.getState().config;
                const modelProfiles = buildDefaultDramaModelProfiles(config);
                const base = createStudioProject(input);
                const project = normalizeStudioProject({
                    ...base,
                    modelProfiles,
                    settings: updateProjectSettingsModels(base.settings, modelProfiles),
                });
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            updateProject: (projectId, patch) => set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, ...patch })) })),
            deleteProject: async (projectId) => {
                const project = get().projects.find((item) => item.id === projectId);
                if (!project) return { ok: false, reason: "项目不存在" };
                const result = await commitStudioStructuralDeletion({
                    projectId,
                    expectedProjectUpdatedAt: project.updatedAt,
                });
                if (!result.ok || !result.projects) return { ok: false, reason: result.error ?? "删除失败" };
                set({ projects: result.projects });
                return { ok: true };
            },
            archiveProject: (projectId, archived) => set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, archived })) })),

            createEpisode: (projectId, title, targetSeconds) => {
                const project = get().projects.find((item) => item.id === projectId);
                if (!project) return null;
                const episode = createEpisode(project.episodes.length + 1, targetSeconds ?? project.settings.targetSeconds, title);
                set((state) => ({ projects: mapProject(state.projects, projectId, (item) => ({ ...item, episodes: [...item.episodes, episode] })) }));
                return episode.id;
            },
            duplicateEpisode: (projectId, episodeId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const source = project?.episodes.find((episode) => episode.id === episodeId);
                if (!project || !source) return null;
                const scenes = source.scenes.map((scene) => ({ ...scene, id: `scene-${nanoid(8)}` }));
                const sceneMap = new Map(source.scenes.map((scene, index) => [scene.id, scenes[index].id]));
                const shots = source.shots.map((shot) => ({
                    ...shot,
                    id: `shot-${nanoid(8)}`,
                    sceneId: sceneMap.get(shot.sceneId) ?? scenes[0]?.id ?? "",
                    impact: undefined,
                }));
                const episode: StudioEpisode = {
                    ...source,
                    id: `ep-${nanoid(8)}`,
                    no: project.episodes.length + 1,
                    title: uniqueTitle(project, source.title),
                    scenes,
                    shots,
                    workflowProjectId: undefined,
                    createdAt: nowIso(),
                    updatedAt: nowIso(),
                };
                set((state) => ({ projects: mapProject(state.projects, projectId, (item) => ({ ...item, episodes: [...item.episodes, episode] })) }));
                return episode.id;
            },
            deleteEpisode: async (projectId, episodeId) => {
                const project = get().projects.find((item) => item.id === projectId);
                if (!project) return { ok: false, reason: "项目不存在" };
                const episode = project.episodes.find((item) => item.id === episodeId);
                if (!episode) return { ok: false, reason: "分集不存在" };
                if (project.episodes.length <= 1) return { ok: false, reason: "项目至少保留一集" };
                const result = await commitStudioStructuralDeletion({
                    projectId,
                    episodeId,
                    expectedProjectUpdatedAt: project.updatedAt,
                    expectedEpisodeUpdatedAt: episode.updatedAt,
                });
                if (!result.ok || !result.projects) return { ok: false, reason: result.error ?? "删除失败" };
                set({ projects: result.projects });
                return { ok: true };
            },
            updateEpisode: (projectId, episodeId, patch) =>
                set((state) => ({ projects: mapProject(state.projects, projectId, (project) => mapEpisode(project, episodeId, (episode) => ({ ...episode, ...patch }))) })),
            reorderEpisodes: (projectId, episodeIds) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        episodes: episodeIds
                            .map((id) => project.episodes.find((episode) => episode.id === id))
                            .filter((episode): episode is StudioEpisode => Boolean(episode))
                            .map((episode, index) => ({ ...episode, no: index + 1 })),
                    })),
                })),

            updateScript: (projectId, episodeId, patch) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => mapEpisode(project, episodeId, (episode) => ({ ...episode, script: { ...episode.script, ...patch } }))),
                })),
            saveScriptVersion: (projectId, episodeId, field, note) => {
                const project = get().projects.find((item) => item.id === projectId);
                const episode = project?.episodes.find((item) => item.id === episodeId);
                if (!episode) return;
                const text = field === "text" ? episode.script.text : episode.script.outline;
                if (!text.trim()) return;
                const version = { id: `script-${nanoid(8)}`, text, createdAt: nowIso(), note };
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (item) =>
                        mapEpisode(item, episodeId, (current) => ({
                            ...current,
                            script:
                                field === "text"
                                    ? { ...current.script, versions: [version, ...current.script.versions].slice(0, 20) }
                                    : { ...current.script, outlineVersions: [version, ...current.script.outlineVersions].slice(0, 20) },
                        })),
                    ),
                }));
            },
            restoreScriptVersion: (projectId, episodeId, field, versionId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const episode = project?.episodes.find((item) => item.id === episodeId);
                const versions = field === "text" ? episode?.script.versions : episode?.script.outlineVersions;
                const version = versions?.find((item) => item.id === versionId);
                if (!version) return;
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (item) =>
                        mapEpisode(item, episodeId, (current) => ({
                            ...current,
                            script: field === "text" ? { ...current.script, text: version.text } : { ...current.script, outline: version.text },
                        })),
                    ),
                }));
            },
            addReferenceFile: (projectId, episodeId, file) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({ ...episode, script: { ...episode.script, referenceFiles: [...episode.script.referenceFiles, file] } })),
                    ),
                })),
            confirmScript: (projectId, episodeId) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => mapEpisode(project, episodeId, (episode) => ({ ...episode, script: { ...episode.script, confirmedAt: nowIso() } }))),
                })),

            updateBible: (projectId, patch) => set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, bible: { ...project.bible, ...patch } })) })),
            updateVisualStyle: (projectId, patch) =>
                set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, visualStyle: { ...project.visualStyle, ...patch } })) })),
            updateSettings: (projectId, patch) =>
                set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, settings: { ...project.settings, ...patch } })) })),
            setProjectModel: (projectId, capability, option) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => {
                        const modelProfiles = withProjectModelSelection(project.modelProfiles, capability, option);
                        return { ...project, modelProfiles, settings: updateProjectSettingsModels(project.settings, modelProfiles) };
                    }),
                })),
            setProjectModelParam: (projectId, capability, key, value) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        modelProfiles: withProjectModelParam(project.modelProfiles, capability, key, value),
                    })),
                })),
            setStepState: (projectId, step, status) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        stepStates: { ...project.stepStates, [step]: status },
                    })),
                })),
            setProjectStatus: (projectId, projectStatus) => set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, projectStatus })) })),

            setNovel: (projectId, novel) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        novel,
                        novelId: novel?.id,
                        // 同一本书重新导入可保留人工修正；换成另一本书时必须清空，避免旧 id 污染新分析。
                        novelAnalysisOverrides: project.novel?.id === novel?.id ? project.novelAnalysisOverrides : emptyNovelAnalysisOverrides(),
                        novelAnalysis: undefined,
                        analysisRuns: [],
                        analysisRunId: undefined,
                        adaptation: createStudioAdaptationWorkspace({ ...project, novel }),
                    })),
                })),
            updateAdaptation: (projectId, updater) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        adaptation: {
                            ...updater(project.adaptation ?? createStudioAdaptationWorkspace(project)),
                            updatedAt: nowIso(),
                        },
                    })),
                })),
            updateProduction: (projectId, updater) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        production: {
                            ...updater(project.production ?? { version: 1, jobs: [], skips: [], updatedAt: nowIso() }),
                            updatedAt: nowIso(),
                        },
                    })),
                })),
            updateEpisodeProduction: (projectId, episodeId, updater) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({
                            ...episode,
                            production: {
                                ...updater(episode.production ?? { version: 1, scriptVersions: [], storyboardVersions: [], storyboardDrafts: [], checks: [], updatedAt: nowIso() }),
                                updatedAt: nowIso(),
                            },
                            updatedAt: nowIso(),
                        })),
                    ),
                })),
            setNovelAnalysis: (projectId, novelAnalysis) =>
                set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, novelAnalysis })) })),
            deleteNovel: (projectId) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        novel: undefined,
                        novelId: undefined,
                        novelAnalysis: undefined,
                        novelAnalysisOverrides: emptyNovelAnalysisOverrides(),
                        analysisRuns: [],
                        analysisRunId: undefined,
                        adaptation: createStudioAdaptationWorkspace(project),
                        projectStatus: "draft",
                        stepStates: { ...project.stepStates, analysis: "idle" },
                    })),
                })),
            updateNovelAnalysisOverrides: (projectId, updater) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        novelAnalysisOverrides: { ...updater(project.novelAnalysisOverrides ?? emptyNovelAnalysisOverrides()), updatedAt: nowIso() },
                    })),
                })),
            upsertAnalysisRun: (projectId, run) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        analysisRuns: [run, ...(project.analysisRuns ?? []).filter((item) => item.id !== run.id)],
                        analysisRunId: run.id,
                    })),
                })),
            updateAnalysisRun: (projectId, runId, patch) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        analysisRuns: (project.analysisRuns ?? []).map((run) => (run.id === runId ? { ...run, ...patch, updatedAt: nowIso() } : run)),
                    })),
                })),
            setAnalysisRunId: (projectId, analysisRunId) => set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, analysisRunId })) })),

            createAsset: (projectId, kind, name) => {
                if (!get().projects.some((item) => item.id === projectId)) return null;
                const asset = createAsset(kind, name);
                set((state) => ({ projects: mapProject(state.projects, projectId, (project) => ({ ...project, assets: [...project.assets, asset] })) }));
                return asset.id;
            },
            updateAsset: (projectId, assetId, patch) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, ...patch, updatedAt: nowIso() } : asset)),
                    })),
                })),
            deleteAsset: (projectId, assetId) => {
                const project = get().projects.find((item) => item.id === projectId);
                if (!project) return { ok: false, reason: "项目不存在" };
                const references = shotsUsingAsset(project, assetId);
                if (references.length) return { ok: false, reason: `还有 ${references.length} 个镜头引用这个资产，先解除绑定再删除` };
                set((state) => ({ projects: mapProject(state.projects, projectId, (item) => ({ ...item, assets: item.assets.filter((asset) => asset.id !== assetId) })) }));
                return { ok: true };
            },
            addAssetVersion: (projectId, assetId, version) => {
                const entry: StudioMediaVersion = { ...version, id: `ver-${nanoid(8)}`, createdAt: nowIso() };
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, versions: [entry, ...asset.versions].slice(0, 20), updatedAt: nowIso() } : asset)),
                    })),
                }));
                return entry.id;
            },
            chooseAssetVersion: (projectId, assetId, versionId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const asset = project?.assets.find((item) => item.id === assetId);
                const version = asset?.versions.find((item) => item.id === versionId);
                if (!project || !asset || !version) return 0;
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (item) => ({
                        ...item,
                        assets: item.assets.map((current) => (current.id === assetId ? { ...current, officialRef: version.storageKey, updatedAt: nowIso() } : current)),
                    })),
                }));
                const latest = get().projects.find((item) => item.id === projectId);
                if (!latest) return 0;
                const impacts = affectedByAsset(latest, assetId);
                for (const impact of impacts) {
                    set((state) => ({
                        projects: mapProject(state.projects, projectId, (item) =>
                            mapEpisode(item, impact.episodeId, (episode) => ({
                                ...episode,
                                shots: episode.shots.map((shot) =>
                                    shot.id === impact.shotId
                                        ? {
                                              ...shot,
                                              impact: {
                                                  ...shot.impact,
                                                  ...(impact.media.includes("image") ? { image: `人物/场景资产已更新：${impact.reason}` } : {}),
                                                  ...(impact.media.includes("video") ? { video: `人物/场景资产已更新：${impact.reason}` } : {}),
                                              },
                                          }
                                        : shot,
                                ),
                            })),
                        ),
                    }));
                }
                return impacts.length;
            },
            bindVoice: (projectId, assetId, voiceId) => {
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, voiceId, updatedAt: nowIso() } : asset)),
                    })),
                }));
            },
            addBgmTrack: (projectId, track) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        bgmTracks: [{ ...track, id: `bgm-${nanoid(8)}`, createdAt: nowIso() }, ...(project.bgmTracks ?? [])],
                    })),
                })),
            updateBgmTrack: (projectId, trackId, patch) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        bgmTracks: (project.bgmTracks ?? []).map((track) => (track.id === trackId ? { ...track, ...patch } : track)),
                    })),
                })),
            removeBgmTrack: (projectId, trackId) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) => ({
                        ...project,
                        bgmTracks: (project.bgmTracks ?? []).filter((track) => track.id !== trackId),
                    })),
                })),

            setScenes: (projectId, episodeId, scenes) =>
                set((state) => ({ projects: mapProject(state.projects, projectId, (project) => mapEpisode(project, episodeId, (episode) => ({ ...episode, scenes }))) })),
            createScene: (projectId, episodeId, name, location) => {
                const project = get().projects.find((item) => item.id === projectId);
                const episode = project?.episodes.find((item) => item.id === episodeId);
                if (!project || !episode) return null;
                const scene = createScene(String(episode.scenes.length + 1).padStart(2, "0"), name, location);
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (item) => mapEpisode(item, episodeId, (current) => ({ ...current, scenes: [...current.scenes, scene] }))),
                }));
                return scene.id;
            },
            updateScene: (projectId, episodeId, sceneId, patch) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({
                            ...episode,
                            scenes: episode.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
                            shots: episode.shots.map((shot) => (shot.sceneId === sceneId && patch.name ? { ...shot, sceneName: patch.name } : shot)),
                        })),
                    ),
                })),

            replaceShots: (projectId, episodeId, shots) =>
                set((state) => ({ projects: mapProject(state.projects, projectId, (project) => mapEpisode(project, episodeId, (episode) => ({ ...episode, shots: renumber(shots) }))) })),
            addShot: (projectId, episodeId, sceneId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const episode = project?.episodes.find((item) => item.id === episodeId);
                if (!project || !episode) return null;
                const scene = episode.scenes.find((item) => item.id === sceneId) ?? episode.scenes[0];
                const shot = defaultShot(episodeId, scene?.id ?? "", nextShotNo(episode.shots));
                shot.sceneName = scene?.name ?? "";
                shot.environment = scene?.location ?? "";
                set((state) => ({ projects: mapProject(state.projects, projectId, (item) => mapEpisode(item, episodeId, (current) => ({ ...current, shots: [...current.shots, shot] }))) }));
                return shot.id;
            },
            updateShot: (projectId, episodeId, shotId, patch) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({ ...episode, shots: episode.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)) })),
                    ),
                })),
            deleteShot: (projectId, episodeId, shotId) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({ ...episode, shots: renumber(episode.shots.filter((shot) => shot.id !== shotId)) })),
                    ),
                })),
            splitShot: (projectId, episodeId, shotId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const episode = project?.episodes.find((item) => item.id === episodeId);
                const shot = episode?.shots.find((item) => item.id === shotId);
                if (!episode || !shot) return null;
                const half = Math.max(4, Math.round(shot.seconds / 2));
                const next: StudioShot = {
                    ...shot,
                    id: `shot-${nanoid(8)}`,
                    seconds: Math.max(4, shot.seconds - half),
                    imageRef: undefined,
                    videoRef: undefined,
                    audioRef: undefined,
                    narrationRef: undefined,
                    sfxRef: undefined,
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
                    impact: undefined,
                    locked: false,
                };
                const index = episode.shots.findIndex((item) => item.id === shotId);
                const shots = [...episode.shots];
                shots[index] = { ...shot, seconds: half, imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt };
                shots.splice(index + 1, 0, next);
                set((state) => ({ projects: mapProject(state.projects, projectId, (item) => mapEpisode(item, episodeId, (current) => ({ ...current, shots: renumber(shots) }))) }));
                return next.id;
            },
            mergeShots: (projectId, episodeId, firstId, secondId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const episode = project?.episodes.find((item) => item.id === episodeId);
                if (!episode) return { ok: false, reason: "集不存在" };
                const firstIndex = episode.shots.findIndex((shot) => shot.id === firstId);
                const secondIndex = episode.shots.findIndex((shot) => shot.id === secondId);
                if (firstIndex < 0 || secondIndex < 0 || Math.abs(firstIndex - secondIndex) !== 1) return { ok: false, reason: "只能合并相邻的两个镜头" };
                const first = episode.shots[Math.min(firstIndex, secondIndex)];
                const second = episode.shots[Math.max(firstIndex, secondIndex)];
                const merged: StudioShot = {
                    ...first,
                    id: `shot-${nanoid(8)}`,
                    seconds: first.seconds + second.seconds,
                    description: [first.description, second.description].filter(Boolean).join("；"),
                    action: [first.action, second.action].filter(Boolean).join("；"),
                    expression: [first.expression, second.expression].filter(Boolean).join("；"),
                    line: [first.line, second.line].filter(Boolean).join("\n"),
                    narration: [first.narration, second.narration].filter(Boolean).join("\n"),
                    ambience: [first.ambience, second.ambience].filter(Boolean).join("；"),
                    sfx: [first.sfx, second.sfx].filter(Boolean).join("；"),
                    characterNames: [...new Set([...first.characterNames, ...second.characterNames])],
                    assetIds: [...new Set([...first.assetIds, ...second.assetIds])],
                    locked: false,
                    impact: undefined,
                };
                const shots = episode.shots.filter((shot) => shot.id !== first.id && shot.id !== second.id);
                shots.splice(Math.min(firstIndex, secondIndex), 0, merged);
                set((state) => ({ projects: mapProject(state.projects, projectId, (item) => mapEpisode(item, episodeId, (current) => ({ ...current, shots: renumber(shots) }))) }));
                return { ok: true };
            },
            moveShot: (projectId, episodeId, shotId, direction) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => {
                            const index = episode.shots.findIndex((shot) => shot.id === shotId);
                            const target = index + direction;
                            if (index < 0 || target < 0 || target >= episode.shots.length) return episode;
                            const shots = [...episode.shots];
                            [shots[index], shots[target]] = [shots[target], shots[index]];
                            return { ...episode, shots: renumber(shots) };
                        }),
                    ),
                })),
            lockShot: (projectId, episodeId, shotId, locked) => get().updateShot(projectId, episodeId, shotId, { locked }),
            reorderShots: (projectId, episodeId, shotIds) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({
                            ...episode,
                            shots: renumber(
                                shotIds
                                    .map((id) => episode.shots.find((shot) => shot.id === id))
                                    .filter((shot): shot is StudioShot => Boolean(shot)),
                            ),
                        })),
                    ),
                })),

            recordShotVersion: (projectId, episodeId, shotId, media, version, options) => {
                const entry: StudioMediaVersion = { ...version, id: `ver-${nanoid(8)}`, createdAt: nowIso() };
                const versionField = VERSION_FIELD[media];
                const refField = REF_FIELD[media];
                const statusField = STATUS_FIELD[media];
                let stored = false;
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({
                            ...episode,
                            shots: episode.shots.map((shot) => {
                                if (shot.id !== shotId) return shot;
                                stored = true;
                                const current = shot[versionField] as StudioMediaVersion[];
                                const makeOfficial = options?.makeOfficial ?? true;
                                return {
                                    ...shot,
                                    [versionField]: [entry, ...current].slice(0, 12),
                                    ...(makeOfficial ? { [refField]: entry.storageKey } : {}),
                                    [statusField]: options?.status ?? (makeOfficial ? "succeeded" : shot[statusField]),
                                    impact: makeOfficial ? { ...shot.impact, [media]: undefined } : shot.impact,
                                };
                            }),
                        })),
                    ),
                }));
                return stored ? entry : null;
            },
            chooseShotVersion: (projectId, episodeId, shotId, media, versionId) => {
                const project = get().projects.find((item) => item.id === projectId);
                const shot = project?.episodes.find((episode) => episode.id === episodeId)?.shots.find((item) => item.id === shotId);
                if (!shot) return;
                const versionField = VERSION_FIELD[media];
                const version = (shot[versionField] as StudioMediaVersion[]).find((item) => item.id === versionId);
                if (!version) return;
                const refField = REF_FIELD[media];
                const statusField = STATUS_FIELD[media];
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (item) =>
                        mapEpisode(item, episodeId, (episode) => ({
                            ...episode,
                            shots: episode.shots.map((current) =>
                                current.id === shotId
                                    ? { ...current, [refField]: version.storageKey, [statusField]: "succeeded" as StudioMediaStatus, impact: { ...current.impact, [media]: undefined } }
                                    : current,
                            ),
                        })),
                    ),
                }));
            },
            setShotStatus: (projectId, episodeId, shotId, media, status, impact) => {
                const statusField = STATUS_FIELD[media];
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({
                            ...episode,
                            shots: episode.shots.map((shot) =>
                                shot.id === shotId ? { ...shot, [statusField]: status, impact: impact ? { ...shot.impact, [media]: impact } : shot.impact } : shot,
                            ),
                        })),
                    ),
                }));
            },
            setVideoRemote: (projectId, episodeId, shotId, remote) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({
                            ...episode,
                            shots: episode.shots.map((shot) => (shot.id === shotId ? { ...shot, videoRemote: remote } : shot)),
                        })),
                    ),
                })),
            clearImpact: (projectId, episodeId, shotId, media) =>
                set((state) => ({
                    projects: mapProject(state.projects, projectId, (project) =>
                        mapEpisode(project, episodeId, (episode) => ({
                            ...episode,
                            shots: episode.shots.map((shot) => (shot.id === shotId ? { ...shot, impact: media ? { ...shot.impact, [media]: undefined } : undefined } : shot)),
                        })),
                    ),
                })),
            refreshAssetImpact: (projectId, assetId) => {
                const project = get().projects.find((item) => item.id === projectId);
                if (!project) return 0;
                const impacts = affectedByAsset(project, assetId);
                for (const impact of impacts) {
                    set((state) => ({
                        projects: mapProject(state.projects, projectId, (item) =>
                            mapEpisode(item, impact.episodeId, (episode) => ({
                                ...episode,
                                shots: episode.shots.map((shot) =>
                                    shot.id === impact.shotId
                                        ? {
                                              ...shot,
                                              impact: {
                                                  ...shot.impact,
                                                  ...(impact.media.includes("image") ? { image: impact.reason } : {}),
                                                  ...(impact.media.includes("video") ? { video: impact.reason } : {}),
                                              },
                                          }
                                        : shot,
                                ),
                            })),
                        ),
                    }));
                }
                return impacts.length;
            },
        }),
        {
            name: storageKey("studio_store"),
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ projects: state.projects, migrationDone: state.migrationDone }),
            // 旧 V2 项目缺五步字段时在这里补齐；不覆盖剧本、资产、镜头、媒体版本等既有内容。
            merge: (persisted, current) => {
                const saved = (persisted ?? {}) as Partial<StudioStore>;
                const projects = Array.isArray(saved.projects) ? saved.projects.map((project) => normalizeProductionForHydration(markInterruptedAnalysisRuns(normalizeStudioProject(project)))) : current.projects;
                return { ...current, ...saved, projects };
            },
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    const message = error instanceof Error ? error.message : "本地工作区读取失败";
                    useStudioStore.setState({ hydrated: true, hydrationError: message });
                    if (typeof window !== "undefined") {
                        try {
                            window.dispatchEvent(new CustomEvent("lihuo:studio-store-read-blocked", { detail: { reason: message } }));
                        } catch {
                            // 状态中已保留错误；事件只用于诊断。
                        }
                    }
                    return;
                }
                useStudioStore.setState({ hydrated: true, hydrationError: null });
                if (!state?.migrationDone) void migrateLegacyStore();
            },
        },
    ),
);

/** 从 IndexedDB 权威状态刷新内存；跨标签页提交和整仓旧版本写入被拒绝时调用。 */
export async function refreshStudioStoreFromPersistence() {
    try {
        const raw = await localForageStorage.getItem(storageKey("studio_store"));
        const envelope = parseStudioEnvelope(raw);
        const saved = envelope?.state ?? {};
        if (!Array.isArray(saved.projects)) {
            useStudioStore.setState({ hydrationError: "本地工作区数据格式无效，已暂停写入；请先备份后修复" });
            return false;
        }
        const projects = saved.projects.map((project) => normalizeProductionForHydration(markInterruptedAnalysisRuns(normalizeStudioProject(project))));
        useStudioStore.setState({ projects, migrationDone: Boolean(saved.migrationDone), hydrationError: null });
        return true;
    } catch (error) {
        useStudioStore.setState({ hydrationError: error instanceof Error ? error.message : "本地工作区读取失败" });
        return false;
    }
}

/** 显式重试保存当前内存状态；仍走整仓守卫，不会用旧内存覆盖其他标签页的新数据。 */
export async function persistStudioStoreNow(): Promise<{ ok: boolean; error?: string }> {
    if (useStudioStore.getState().hydrationError) {
        return { ok: false, error: "工作区读取失败，已暂停写入；请先重新读取" };
    }
    const { projects, migrationDone } = useStudioStore.getState();
    try {
        await localForageStorage.setItem(storageKey("studio_store"), JSON.stringify({ state: { projects, migrationDone }, version: 0 }));
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "工作区保存失败" };
    }
}

let studioSyncInstalled = false;
function installStudioCrossTabSync() {
    if (studioSyncInstalled || typeof window === "undefined") return;
    studioSyncInstalled = true;
    if (typeof BroadcastChannel !== "undefined") {
        try {
            const channel = new BroadcastChannel("lihuo:studio-storyboard");
            channel.onmessage = (event) => {
                const data = event.data as { type?: string; projectId?: string; episodeId?: string; newVersion?: number } | undefined;
                if (!data || (data.type !== "storyboard-committed" && data.type !== "storyboard-conflict")) return;
                const episode = data.projectId && data.episodeId ? findEpisode(data.projectId, data.episodeId) : null;
                const currentVersion = episode?.production?.storyboard?.storyboardVersion ?? 0;
                if (data.type === "storyboard-committed" && data.newVersion !== undefined && currentVersion >= data.newVersion) return;
                void refreshStudioStoreFromPersistence();
            };
        } catch {
            // BroadcastChannel 只做同步提示；不可用时刷新后仍以 IndexedDB 为准。
        }
    }
}
installStudioCrossTabSync();

/** 旧版短剧 store 的持久化键；直接读存储，避免依赖两个 store 的 hydration 顺序。 */
let migrating = false;
async function migrateLegacyStore() {
    if (migrating) return;
    if (!useStudioStore.getState().hydrated) return;
    migrating = true;
    try {
        const raw = await localForageStorage.getItem(storageKey("drama_store"));
        if (!raw) {
            useStudioStore.setState({ migrationDone: true });
            return;
        }
        const parsed = JSON.parse(raw) as { state?: { sequences?: DramaSequence[] } };
        const sequences = parsed.state?.sequences ?? [];
        const migrated = migrateLegacySequences(sequences);
        useStudioStore.setState((state) => {
            const existing = new Set(state.projects.map((project) => project.id));
            return { projects: [...state.projects, ...migrated.filter((project) => !existing.has(project.id))], migrationDone: true };
        });
    } catch {
        // 解析失败不覆盖旧数据，也不把 migrationDone 置 true；页面下次挂载会再尝试，旧 store 始终原样保留。
        useStudioStore.setState({ migrationDone: false });
    } finally {
        migrating = false;
    }
}

/** 页面挂载时兜底调用一次（hydration 回调已触发时不会重复迁移）。 */
export async function ensureStudioMigrated() {
    await waitForStudioHydration();
    const state = useStudioStore.getState();
    if (state.hydrationError) return;
    if (state.migrationDone) return;
    await migrateLegacyStore();
}

/** 迁移会改整个 projects 数组；hydration 未完成时它看到的是空数组，绝不能先落盘。 */
function waitForStudioHydration() {
    if (useStudioStore.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = useStudioStore.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

export function findProject(projectId: string | null | undefined) {
    return useStudioStore.getState().projects.find((project) => project.id === projectId) ?? null;
}

export function findEpisode(projectId: string | null | undefined, episodeId: string | null | undefined) {
    return findProject(projectId)?.episodes.find((episode) => episode.id === episodeId) ?? null;
}

export function findShot(projectId: string | null | undefined, episodeId: string | null | undefined, shotId: string | null | undefined) {
    return findEpisode(projectId, episodeId)?.shots.find((shot) => shot.id === shotId) ?? null;
}

/** 画布旧节点只带 sequenceId；按 legacySequenceId 找回迁移后的项目。 */
export function findProjectByLegacySequence(sequenceId: string) {
    return useStudioStore.getState().projects.find((project) => project.legacySequenceId === sequenceId || project.id === sequenceId) ?? null;
}

/** 资产被多少镜头引用（跨集统计，含按姓名/场景名隐式引用）。 */
export function assetUsage(project: StudioProject, assetId: string) {
    return shotsUsingAsset(project, assetId).length;
}

/** 音色变化影响的对白镜头。 */
export function voiceImpactCount(project: StudioProject, asset: StudioAsset) {
    return affectedByVoice(project, asset).length;
}
