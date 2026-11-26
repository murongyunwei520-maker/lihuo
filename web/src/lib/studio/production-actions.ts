// 阶段 3 业务动作：真实项目模型调用、草稿写回、版本快照、锁定保护和旧 StudioShot 兼容投影。
// 所有失败都在写入前抛出；模型截断/缺字段不会留下半成品。

import { simpleHash } from "./novel-chapters";
import { adaptationHandoff } from "./adaptation-workspace";
import { createAsset, nowIso } from "./factory";
import { generateScriptDialogueDraft, generateScriptDraft, generateStoryboardSceneDraft, generateStoryboardShotDraft } from "./production-ai";
import {
    canReplaceSceneStoryboard,
    canReplaceShot,
    createProductionJob,
    emptyCounts,
    handoffIssuesForEpisode,
    productionAdmission,
    productionHandoffSnapshot,
    scriptToPlainText,
    validateScriptDocument,
    validateStoryboardDocument,
} from "./production-engine";
import { acquireStoryboardWriteLock, hasStoryboardVersionConflict, releaseStoryboardWriteLock, storyboardVersionConflictMessage, type StoryboardWriteLock } from "./production-locks";
import {
    ALL_SCRIPT_MANUAL_MODULES,
    clearScriptManualEditModules,
    clearStoryboardStale,
    ensureScriptSceneVersions,
    guardEpisodeScriptWrite,
    guardSceneScriptWrite,
    markScriptManualEdit,
    markStoryboardStaleForScriptChange,
    planScriptQueue,
    planScriptRestore,
    recordStoryboardSceneSourceVersion,
    recordStoryboardSourceVersion,
    scriptBackupPresent,
    scriptContentChanged,
    scriptContentHash,
    scriptManualEditModules,
    scriptSceneEditModules,
    scriptSkipFor,
    withNextScriptSceneVersions,
} from "./production-protection";
import { scriptDialogueRegeneratePrompt, scriptPrompt, scriptSceneRegeneratePrompt, storyboardScenePrompt, storyboardShotPrompt, STAGE3_SCRIPT_PROMPT_VERSION, STAGE3_STORYBOARD_PROMPT_VERSION } from "./production-prompts";
import { mergeDialogueIntoScript, mergeSceneIntoScript, normalizeDialogueReplacement, normalizeScriptDocument, normalizeSingleScriptScene, normalizeShotReplacement, normalizeStoryboardScene, replaceSceneInStoryboard, replaceShotInStoryboard } from "./production-schema";
import { createStoryboardSnapshot, planStoryboardDraftApply, planStoryboardDraftFromSnapshot, planStoryboardSnapshotApply, storyboardContentHash, validateStoryboardDraftDocument } from "./storyboard-snapshots";
import { validateStoryboardAssetReferences } from "./storyboard-asset-validation";
import { commitFormalStoryboardWrite, type FormalStoryboardWriteResult } from "./storyboard-write-protocol";
import { commitStoryboardSnapshotDiscard, type StudioStateStore } from "@/lib/studio-store-persistence";
import { projectTextModelSummary, type NovelTextModelRuntimeOverride } from "./novel-model";
import { dramaModelOption, dramaModelParams } from "./model-profile";
import { applyProductionJobReview, selectResumableJobs, selectRetryableJobs, selectReviewJobs } from "./production-workspace";
import { findEpisode, findProject, useStudioStore } from "@/stores/use-studio-store";
import { useStudioTasks } from "@/stores/use-studio-tasks";
import type { StudioAdaptationHandoff, StudioEpisodePlan } from "@/types/studio-adaptation";
import type {
    StudioProductionAssetIndex,
    StudioProductionCheck,
    StudioProductionJob,
    StudioProductionJobKind,
    StudioProductionJobRemoteState,
    StudioProductionJobReviewDecision,
    StudioProductionJobStatus,
    StudioProductionRawScript,
    StudioProductionRawScriptScene,
    StudioProductionSkipReason,
    StudioProductionSkipRecord,
    StudioProductionModelTrace,
    StudioProductionReviewStatus,
    StudioEpisodeProduction,
    StudioScriptDocument,
    StudioScriptManualEditModule,
    StudioScriptScene,
    StudioScriptVersion,
    StudioStoryboardDocument,
    StudioStoryboardDraft,
    StudioStoryboardVersion,
} from "@/types/studio-production";
import type { StudioEpisode, StudioProject, StudioScene, StudioShot, StudioTaskStatus } from "@/types/studio";

export type Stage3ActionResult = {
    ok: boolean;
    error?: string;
    blocked?: boolean;
    requiresConfirmation?: "episode_overwrite" | "scene_overwrite" | "dialogue_overwrite" | "draft_conflict";
    skipped?: StudioProductionSkipRecord[];
    skipReason?: StudioProductionSkipReason;
    backupSnapshotId?: string;
    newVersion?: number;
    draftId?: string;
    reusedDraft?: boolean;
    unchanged?: boolean;
    taskId?: string;
    taskStatus?: StudioTaskStatus | StudioProductionJobStatus;
    remoteState?: StudioProductionJobRemoteState;
    modelLabel?: string;
    trace?: StudioProductionModelTrace;
    counts?: { error: number; warning: number; suggestion: number };
    requeued?: number;
    held?: number;
    conflict?: { baseVersion: number; currentVersion: number; preservedVersionId?: string };
};

const acting = new Set<string>();
const queueControllers = new Map<string, { paused: boolean; stopped: boolean; activeTaskId?: string; activeJobId?: string }>();

function actionKey(projectId: string, episodeId: string, kind: string) {
    return `${projectId}:${episodeId}:${kind}`;
}

function stamp() {
    return new Date().toISOString();
}

function safeMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function currentHandoff(project: StudioProject): StudioAdaptationHandoff | undefined {
    if (!project.adaptation) return undefined;
    return adaptationHandoff(project.adaptation, project.id, project.novelAnalysis?.version ?? 0);
}

function planFor(handoff: StudioAdaptationHandoff | undefined, episodeNumber: number) {
    return handoff?.episodePlans.find((plan) => plan.episodeNumber === episodeNumber);
}

function previousScript(project: StudioProject, episodeNumber: number) {
    return project.episodes.find((item) => item.no === episodeNumber - 1)?.production?.script;
}

export function buildProductionAssetIndex(project: StudioProject, plan: StudioEpisodePlan): StudioProductionAssetIndex {
    const characters: StudioProductionAssetIndex["characters"] = [];
    const locations: StudioProductionAssetIndex["locations"] = [];
    const props: StudioProductionAssetIndex["props"] = [];
    const addCharacter = (item: { characterId: string; name: string; role?: string; look?: string; costume?: string }) => {
        if (!item.characterId || !item.name) return;
        if (!characters.some((current) => current.characterId === item.characterId || current.name === item.name)) {
            characters.push({ characterId: item.characterId, name: item.name, role: item.role ?? "", look: item.look ?? "", costume: item.costume ?? "" });
        }
    };
    plan.characterAppearances.forEach((item) => addCharacter({ characterId: item.characterId, name: item.name, role: item.role, look: item.summary }));
    plan.characterStates.forEach((item) => addCharacter({ characterId: item.characterId, name: item.name, role: "", look: item.physicalState }));
    project.assets.filter((asset) => asset.kind === "character").forEach((asset) => addCharacter({ characterId: asset.id, name: asset.name, role: asset.role, look: asset.description, costume: asset.costume }));
    const addLocation = (item: { locationId: string; name: string; description: string; variantIds?: string[] }) => {
        if (!item.locationId || !item.name) return;
        if (!locations.some((current) => current.locationId === item.locationId || current.name === item.name)) {
            locations.push({ locationId: item.locationId, name: item.name, description: item.description, variantIds: item.variantIds ?? [] });
        }
    };
    plan.locations.forEach((item) => addLocation({ locationId: item.sceneId, name: item.name, description: item.purpose }));
    project.assets.filter((asset) => asset.kind === "scene").forEach((asset) => addLocation({ locationId: asset.id, name: asset.name, description: asset.description }));
    project.assets.filter((asset) => asset.kind === "prop").forEach((asset) => {
        if (!props.some((item) => item.propId === asset.id || item.name === asset.name)) {
            props.push({ propId: asset.id, name: asset.name, state: asset.description, important: false });
        }
    });
    return { characters, locations, props };
}

/** 为剧本中第一次出现的人物/地点/道具建立草稿资产；只建资产壳，不生成图片。 */
function ensureProductionAssets(projectId: string, doc: StudioScriptDocument) {
    const project = findProject(projectId);
    if (!project) return;
    const additions = [...project.assets];
    let changed = false;
    const has = (kind: "character" | "scene" | "prop", id: string, name: string) => additions.some((asset) => asset.kind === kind && (asset.id === id || asset.name === name));
    const add = (kind: "character" | "scene" | "prop", id: string, name: string, description: string) => {
        if (!name || has(kind, id, name)) return;
        const asset = createAsset(kind, name);
        asset.id = id || asset.id;
        asset.description = description;
        if (kind === "scene") {
            asset.layout = description;
            asset.environment = description;
        }
        additions.push(asset);
        changed = true;
    };
    for (const binding of doc.characterBindings) add("character", binding.characterId, binding.name, binding.look || "阶段 3 剧本中提取的人物草稿资产，待补设定与参考图");
    for (const binding of doc.locationBindings) add("scene", binding.locationId, binding.name, binding.description || "阶段 3 剧本中提取的场景草稿资产，待补空间与参考图");
    for (const binding of doc.propBindings) add("prop", binding.propId, binding.name, binding.state || "阶段 3 剧本中提取的道具草稿资产，待补设定");
    if (!changed) return;
    useStudioStore.setState((state) => ({
        projects: state.projects.map((item) => (item.id === projectId ? { ...item, assets: additions, updatedAt: nowIso() } : item)),
    }));
}

function createScriptSnapshot(existing: StudioScriptDocument, reason: string, sourceTaskId?: string): StudioScriptVersion {
    const createdAt = stamp();
    const snapshotId = `scs-${simpleHash(`${existing.id}:${existing.scriptVersion}:${reason}:${createdAt}:${Math.random()}`)}`;
    return {
        id: `script-version-${snapshotId}`,
        snapshotId,
        version: existing.scriptVersion,
        reason,
        createdAt,
        document: existing,
        sourceTaskId,
        contentHash: scriptContentHash(existing),
    };
}

/** 覆盖前同步落一张当前正式剧本快照；写入后立即回读确认，失败就不允许调用模型。 */
function persistScriptBackup(projectId: string, episodeId: string, existing: StudioScriptDocument, reason: string, sourceTaskId?: string): { ok: true; snapshot: StudioScriptVersion } | { ok: false; error: string } {
    const snapshot = createScriptSnapshot(existing, reason, sourceTaskId);
    try {
        useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (current) => ({
            ...current,
            scriptVersions: [snapshot, ...current.scriptVersions].slice(0, 20),
            updatedAt: nowIso(),
        }));
    } catch (error) {
        return { ok: false, error: `剧本备份写入失败，已阻止覆盖：${error instanceof Error ? error.message : "存储不可用"}` };
    }
    const saved = findEpisode(projectId, episodeId)?.production?.scriptVersions.find((version) => version.snapshotId === snapshot.snapshotId);
    if (!saved || !scriptBackupPresent(findEpisode(projectId, episodeId)?.production?.scriptVersions ?? [], snapshot.snapshotId)) return { ok: false, error: "剧本备份快照未能持久化，已阻止覆盖" };
    return { ok: true, snapshot };
}

function createStoryboardBackup(existing: StudioStoryboardDocument, reason: string, sourceTaskId?: string): StudioStoryboardVersion {
    return createStoryboardSnapshot({
        document: existing,
        snapshotType: "backup",
        basedOnVersion: existing.storyboardVersion,
        reason,
        sourceTaskId,
    });
}

function mergeChecks(existing: StudioProductionCheck[], incoming: StudioProductionCheck[]) {
    const byId = new Map(existing.map((check) => [check.id, check]));
    for (const check of incoming) {
        const previous = byId.get(check.id);
        if (previous && previous.status !== "open") byId.set(check.id, { ...check, status: previous.status });
        else byId.set(check.id, check);
    }
    return [...byId.values()];
}

function mergeSkips(existing: StudioProductionSkipRecord[], incoming: StudioProductionSkipRecord[]) {
    const byId = new Map(existing.map((record) => [record.id, record]));
    for (const record of incoming) byId.set(record.id, record);
    return [...byId.values()].slice(-30);
}

export function applyCommittedProduction(projectId: string, episodeId: string, production: StudioEpisodeProduction | undefined) {
    if (!production) return;
    useStudioStore.setState((state) => ({
        projects: state.projects.map((project) => project.id !== projectId
            ? project
            : {
                  ...project,
                  episodes: project.episodes.map((episode) => episode.id === episodeId ? { ...episode, production, updatedAt: nowIso() } : episode),
                  updatedAt: nowIso(),
              }),
    }));
}

function protocolConflict(result: FormalStoryboardWriteResult): Stage3ActionResult["conflict"] {
    return result.conflict ? { ...result.conflict } : undefined;
}

export function syncAfterFormalWrite(projectId: string, episodeId: string, production: StudioEpisodeProduction | undefined) {
    if (!production?.storyboard) return;
    syncLegacyEpisode(projectId, episodeId, production.script, production.storyboard);
}

function syncLegacyEpisode(projectId: string, episodeId: string, script: StudioScriptDocument | undefined, storyboard: StudioStoryboardDocument | undefined) {
    const project = findProject(projectId);
    const episode = project?.episodes.find((item) => item.id === episodeId);
    if (!project || !episode) return;
    const scenes: StudioScene[] = script
        ? script.scenes.map((scene) => ({
              id: scene.sceneId,
              no: String(scene.sceneNumber),
              name: scene.sceneTitle,
              location: `${scene.locationVariantId || scene.locationId} · ${scene.timeOfDay}`.trim(),
              description: scene.environment,
              timeOfDay: scene.timeOfDay,
              weather: "",
              assetId: scene.locationId,
          }))
        : episode.scenes;
    const shots: StudioShot[] = storyboard && script
        ? storyboard.shots.map((shot) => {
              const scene = script.scenes.find((item) => item.sceneId === shot.sceneId);
              const existing = episode.shots.find((item) => item.id === shot.shotId);
              return {
                  ...(existing ?? {
                      id: shot.shotId,
                      episodeId,
                      sceneId: shot.sceneId,
                      no: String(shot.shotNumber).padStart(2, "0"),
                      sceneName: scene?.sceneTitle ?? "",
                      description: [shot.foreground, shot.midground, shot.background].filter(Boolean).join(" / "),
                      characterNames: shot.characterBindings.map((binding) => binding.name),
                      assetIds: [],
                      action: shot.action,
                      expression: shot.facialExpression,
                      position: shot.characterBlocking,
                      orientation: shot.eyeline,
                      environment: shot.environment,
                      size: shot.shotSize,
                      camera: [shot.cameraPosition, shot.cameraAngle].filter(Boolean).join(" · "),
                      lens: shot.lens,
                      movement: shot.cameraMovement,
                      composition: shot.composition,
                      lighting: shot.lighting,
                      effects: shot.soundEffects,
                      line: shot.dialogue.map((line) => `${line.speaker}：${line.text}`).join("\n"),
                      speaker: shot.dialogue[0]?.speaker ?? "",
                      narration: shot.voiceOver,
                      ambience: shot.soundEffects,
                      sfx: shot.soundEffects,
                      seconds: shot.duration,
                      imageStatus: "idle" as const,
                      videoStatus: "idle" as const,
                      audioStatus: "idle" as const,
                      narrationStatus: "idle" as const,
                      sfxStatus: "idle" as const,
                      imageVersions: [],
                      videoVersions: [],
                      audioVersions: [],
                      narrationVersions: [],
                      sfxVersions: [],
                  } satisfies StudioShot),
                  id: shot.shotId,
                  sceneId: shot.sceneId,
                  no: String(shot.shotNumber).padStart(2, "0"),
                  sceneName: scene?.sceneTitle ?? "",
                  description: [shot.foreground, shot.midground, shot.background].filter(Boolean).join(" / "),
                  characterNames: shot.characterBindings.map((binding) => binding.name),
                  action: shot.action,
                  expression: shot.facialExpression,
                  position: shot.characterBlocking,
                  orientation: shot.eyeline,
                  environment: shot.environment,
                  size: shot.shotSize,
                  camera: [shot.cameraPosition, shot.cameraAngle].filter(Boolean).join(" · "),
                  lens: shot.lens,
                  movement: shot.cameraMovement,
                  composition: shot.composition,
                  lighting: shot.lighting,
                  effects: shot.soundEffects,
                  line: shot.dialogue.map((line) => `${line.speaker}：${line.text}`).join("\n"),
                  speaker: shot.dialogue[0]?.speaker ?? "",
                  narration: shot.voiceOver,
                  ambience: shot.soundEffects,
                  sfx: shot.soundEffects,
                  seconds: shot.duration,
                  locked: shot.locked,
                  imagePrompt: shot.imagePrompt,
                  videoPrompt: shot.videoPrompt,
                  imageStatus: existing?.imageStatus ?? "idle",
                  videoStatus: existing?.videoStatus ?? "idle",
                  audioStatus: existing?.audioStatus ?? "idle",
                  narrationStatus: existing?.narrationStatus ?? "idle",
                  sfxStatus: existing?.sfxStatus ?? "idle",
                  imageRef: existing?.imageRef,
                  videoRef: existing?.videoRef,
                  audioRef: existing?.audioRef,
                  narrationRef: existing?.narrationRef,
                  sfxRef: existing?.sfxRef,
              };
          })
        : episode.shots;
    useStudioStore.setState((state) => ({
        projects: state.projects.map((item) =>
            item.id !== projectId
                ? item
                : {
                      ...item,
                      episodes: item.episodes.map((entry) =>
                          entry.id === episodeId
                              ? {
                                    ...entry,
                                    scenes,
                                    shots,
                                    script: script ? { ...entry.script, text: scriptToPlainText(script), source: "generated", confirmedAt: undefined } : entry.script,
                                    updatedAt: nowIso(),
                                }
                              : entry,
                      ),
                      updatedAt: nowIso(),
                  },
        ),
    }));
}

function taskInput(project: StudioProject, episode: StudioEpisode, promptVersion: string, label: string, model?: NovelTextModelRuntimeOverride) {
    const summary = projectTextModelSummary(project);
    const option = model ? dramaModelOption(model.selection) : summary.option;
    const selection = model?.selection ?? summary.selection;
    const modelSnapshot: Record<string, string> = { label: option ?? "" };
    if (selection) {
        modelSnapshot.channelId = selection.channelId;
        modelSnapshot.modelId = selection.modelId;
    }
    return {
        kind: "text" as const,
        label,
        projectId: project.id,
        episodeId: episode.id,
        model: option,
        promptVersion,
        modelSnapshot,
        prompt: `Stage 3 ${label}`,
        params: {
            operation: "stage3",
            promptVersion,
            capability: "text",
            ...(model?.params ?? {}),
        },
    };
}

function executionModel(job: StudioProductionJob): NovelTextModelRuntimeOverride {
    return {
        selection: { channelId: job.model.channelId, modelId: job.model.modelId },
        params: { ...job.modelParams },
        label: job.model.label,
    };
}

function isPreflightFailure(message: string) {
    return /无法读取 Bridge 账号列表|项目还没有选择文本模型|没有可用的模型配置|冻结的文本模型|项目选择的账号|尚未选择.*账号|未登录或登录状态异常|额度已被平台拒绝|已锁定，先解锁|2B handoff 不完整/.test(message);
}

function isUnknownFailure(message: string, taskStatus?: StudioTaskStatus | StudioProductionJobStatus) {
    return taskStatus === "canceled" || taskStatus === "cancelled" || taskStatus === "cancelling" || taskStatus === "unknown" || /Failed to fetch|NetworkError|fetch failed|timeout|timed out|aborted|AbortError|已停止|已取消|结果未知|中断/.test(message);
}

function queueOutcome(result: Stage3ActionResult): {
    status: "succeeded" | "failed" | "cancelled";
    remoteState: StudioProductionJobRemoteState;
    needsReview: boolean;
    retryable: boolean;
    label: string;
    skipReason?: string;
} {
    if (result.ok) return { status: "succeeded", remoteState: "completed", needsReview: false, retryable: false, label: "已完成" };
    if (result.skipped?.length && result.skipReason) {
        return {
            status: "cancelled",
            remoteState: "not_submitted",
            needsReview: false,
            retryable: false,
            label: `已跳过：${result.skipped[0]!.detail}`,
            skipReason: result.skipped[0]!.detail,
        };
    }
    const message = result.error ?? "任务失败";
    if (result.remoteState === "completed") {
        return { status: "failed", remoteState: "completed", needsReview: true, retryable: false, label: "结果已保留，需人工核对" };
    }
    if (result.blocked || isPreflightFailure(message)) {
        return { status: "failed", remoteState: "not_submitted", needsReview: true, retryable: false, label: "未提交，需处理后再试" };
    }
    if (!result.taskId) {
        return { status: "failed", remoteState: "not_submitted", needsReview: true, retryable: false, label: "未提交，需人工确认" };
    }
    if (isUnknownFailure(message, result.taskStatus)) {
        return { status: "failed", remoteState: "unknown", needsReview: true, retryable: false, label: "远端结果未知，需核对" };
    }
    return { status: "failed", remoteState: "failed", needsReview: false, retryable: true, label: "失败，可重试" };
}

function mergeModelTrace(previous: StudioProductionModelTrace | undefined, next: StudioProductionModelTrace): StudioProductionModelTrace {
    if (!previous) return { ...next, calls: 1 };
    return {
        ...next,
        calls: previous.calls + next.calls,
        inputChars: previous.inputChars + next.inputChars,
        outputChars: previous.outputChars + next.outputChars,
        startedAt: previous.startedAt,
        finishedAt: next.finishedAt,
    };
}

function projectContext(project: StudioProject, handoff: StudioAdaptationHandoff, plan: StudioEpisodePlan, episode: StudioEpisode, issues = handoffIssuesForEpisode(handoff, plan.episodeNumber)) {
    return {
        project,
        handoff,
        plan,
        targetSeconds: episode.targetSeconds || handoff.settings.targetEpisodeSeconds,
        previousPlan: handoff.episodePlans.find((item) => item.episodeNumber === plan.episodeNumber - 1),
        previousScript: previousScript(project, plan.episodeNumber),
        issues,
    };
}

function finish(projectId: string, episodeId: string, kind: string) {
    acting.delete(actionKey(projectId, episodeId, kind));
}

/** 将 2B 分集规划落成正式 StudioEpisode 壳；不复制规划字段，不创建第二套项目根。 */
export function ensureStage3Episodes(projectId: string) {
    const project = findProject(projectId);
    if (!project) return { ok: false, error: "项目不存在" };
    const handoff = currentHandoff(project);
    if (!handoff) return { ok: false, error: "2B handoff 不完整" };
    const missing = handoff.episodePlans.filter((plan) => !project.episodes.some((episode) => episode.no === plan.episodeNumber));
    if (!missing.length) return { ok: true, created: 0 };
    const createdIds: string[] = [];
    for (const plan of missing) {
        const store = useStudioStore.getState();
        const id = store.createEpisode(projectId, plan.episodeTitle, plan.estimatedDuration > 0 ? plan.estimatedDuration : project.settings.targetSeconds);
        if (!id) continue;
        createdIds.push(id);
        useStudioStore.getState().updateEpisode(projectId, id, {
            no: plan.episodeNumber,
            title: plan.episodeTitle,
            targetSeconds: plan.estimatedDuration > 0 ? plan.estimatedDuration : project.settings.targetSeconds,
            coreEvent: plan.dramaticGoal,
            mainConflict: plan.mainConflict,
            continuity: plan.continuityDependencies.join("\n"),
            hook: plan.endingHook,
        });
    }
    return { ok: true, created: createdIds.length, episodeIds: createdIds };
}

/** 单集剧本生成：一次只生成当前集结构化草稿；不写分镜。 */
export async function runEpisodeScript(
    projectId: string,
    episodeId: string,
    options: {
        sceneId?: string;
        module?: "scene" | "dialogue";
        instruction?: string;
        allowOverwriteExisting?: boolean;
        allowOverwriteManual?: boolean;
        model?: NovelTextModelRuntimeOverride;
        onTaskStarted?: (taskId: string) => void;
    } = {},
): Promise<Stage3ActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    if (!project || !episode) return { ok: false, error: "项目或分集不存在" };
    const handoff = currentHandoff(project);
    const plan = planFor(handoff, episode.no);
    if (!handoff || !plan) return { ok: false, error: "2B handoff 不完整：缺少全剧蓝图或当前集分集规划", blocked: true };
    const admission = productionAdmission(handoff, episode.no);
    if (!admission.draftAllowed) return { ok: false, error: admission.blocking.join("；"), blocked: true };
    const currentScript = episode.production?.script;
    const module = options.module ?? "scene";
    const guard = options.sceneId
        ? guardSceneScriptWrite(currentScript, options.sceneId, module, { allowOverwriteManual: options.allowOverwriteManual })
        : guardEpisodeScriptWrite(currentScript, { allowOverwriteExisting: options.allowOverwriteExisting });
    if (!guard.ok) {
        const reason: StudioProductionSkipReason | undefined = guard.code === "locked" ? "locked" : guard.code === "manual_edited" ? "manual_edited" : guard.code === "existing_script" && currentScript ? "existing_script" : undefined;
        return {
            ok: false,
            error: guard.error,
            blocked: true,
            requiresConfirmation: guard.requiresConfirmation ? (options.sceneId ? (module === "dialogue" ? "dialogue_overwrite" : "scene_overwrite") : "episode_overwrite") : undefined,
            skipReason: !options.sceneId ? reason : undefined,
            skipped: !options.sceneId && reason ? [scriptSkipFor(episode, currentScript, reason)] : undefined,
        };
    }
    const key = actionKey(projectId, episodeId, "script");
    if (acting.has(key)) return { ok: false, error: "本集剧本正在生成，不能重复提交", blocked: true };

    let backupSnapshot: StudioScriptVersion | undefined;
    if (currentScript && guard.backupRequired) {
        const backupReason = options.sceneId
            ? module === "dialogue" ? "对白局部重生成前快照" : "局部重生成前快照"
            : "覆盖已有剧本前快照";
        const backup = persistScriptBackup(projectId, episodeId, currentScript, backupReason);
        if (!backup.ok) return { ok: false, error: backup.error, blocked: true };
        backupSnapshot = backup.snapshot;
    }
    acting.add(key);

    const context = projectContext(project, handoff, plan, episode, handoffIssuesForEpisode(handoff, plan.episodeNumber));
    const assetIndex = buildProductionAssetIndex(project, plan);
    const scene = options.sceneId ? currentScript?.scenes.find((item) => item.sceneId === options.sceneId) : undefined;
    if (options.sceneId && !scene) {
        acting.delete(key);
        return { ok: false, error: "指定的场景不存在" };
    }
    const prompt = options.sceneId && scene
        ? module === "dialogue"
            ? scriptDialogueRegeneratePrompt(context, scene, options.instruction ?? "")
            : scriptSceneRegeneratePrompt(context, scene, options.instruction ?? "")
        : scriptPrompt(context);
    const label = options.sceneId
        ? module === "dialogue"
            ? `剧本对白局部重生成 · 第 ${episode.no} 集 / ${scene?.sceneTitle ?? "场景"}`
            : `剧本局部重生成 · 第 ${episode.no} 集 / ${scene?.sceneTitle ?? "场景"}`
        : `分集剧本 · 第 ${episode.no} 集`;
    const baseScriptVersion = currentScript?.scriptVersion ?? 0;
    let trace: StudioProductionModelTrace | undefined;
    const { id, promise } = useStudioTasks.getState().start(taskInput(project, episode, prompt.promptVersion, label, options.model), async (ctx) => {
        ctx.log("读取 2B handoff；只发送当前集必要上下文");
        ctx.setProgress(10);
        const result = module === "dialogue" && options.sceneId
            ? await generateScriptDialogueDraft(project, prompt, { signal: ctx.signal, onProgress: ctx.setProgress, model: options.model })
            : await generateScriptDraft(project, prompt, { signal: ctx.signal, onProgress: ctx.setProgress, model: options.model });
        trace = result.trace;
        const latest = findProject(projectId);
        if (!latest) throw new Error("项目已被删除");
        const latestEpisode = latest.episodes.find((item) => item.id === episodeId);
        if (!latestEpisode) throw new Error("分集已被删除");
        const previous = latestEpisode.production?.script;
        if (previous && previous.status === "locked") throw new Error("剧本已被其他操作锁定，本次结果未写入");
        if ((previous?.scriptVersion ?? 0) !== baseScriptVersion) throw new Error("剧本已被其他操作更新，本次结果未写入正式剧本");
        const previousStoryboard = latestEpisode.production?.storyboard;
        let document: StudioScriptDocument;
        if (module === "dialogue" && options.sceneId && scene && previous) {
            const latestScene = previous.scenes.find((item) => item.sceneId === options.sceneId);
            if (!latestScene) throw new Error("目标场景已不存在");
            const rawDialogue = (result.document as { dialogueBlocks?: StudioProductionRawScriptScene["dialogueBlocks"] }).dialogueBlocks;
            if (!Array.isArray(rawDialogue) || !rawDialogue.length) throw new Error("模型没有返回目标场对白，未写入剧本");
            const dialogueBlocks = normalizeDialogueReplacement(
                {
                    sceneTitle: latestScene.sceneTitle,
                    locationName: latestScene.locationId,
                    locationVariant: latestScene.locationVariantId,
                    timeOfDay: latestScene.timeOfDay,
                    environment: latestScene.environment,
                    charactersPresent: latestScene.charactersPresent,
                    props: latestScene.props,
                    scenePurpose: latestScene.scenePurpose,
                    conflict: latestScene.conflict,
                    action: latestScene.action,
                    dialogueBlocks: rawDialogue,
                    transitionIn: latestScene.transitionIn,
                    transitionOut: latestScene.transitionOut,
                    continuityNotes: latestScene.continuityNotes,
                },
                {
                    projectId,
                    episodeId,
                    episodeNumber: episode.no,
                    targetSeconds: context.targetSeconds,
                    plan,
                    blueprintVersion: handoff.blueprintVersion,
                    handoffSnapshotId: handoff.snapshotId,
                    assetIndex,
                    changes: handoff.changes,
                    existing: previous,
                },
                latestScene,
            );
            const knownNames = previous.characterBindings.map((binding) => binding.name);
            const unknown = dialogueBlocks.find((block) => !knownNames.includes(block.speaker));
            if (unknown) throw new Error(`对白出现未绑定人物「${unknown.speaker}」，未写入剧本`);
            document = mergeDialogueIntoScript(previous, options.sceneId, dialogueBlocks);
            document = withNextScriptSceneVersions(previous, document);
            // 只有用户确认覆盖后才会走到这里；只清除本次被替换的对白模块标记。
            document = clearScriptManualEditModules(document, options.sceneId, ["dialogue"]);
        } else if (options.sceneId && scene && previous) {
            const rawScript = result.document as StudioProductionRawScript;
            if (!rawScript.scenes.length) throw new Error("模型没有返回可解析场景");
            const latestScene = previous.scenes.find((item) => item.sceneId === options.sceneId);
            if (!latestScene) throw new Error("目标场景已不存在");
            const rawScene = rawScript.scenes[0];
            if (!rawScene) throw new Error("模型没有返回局部场景");
            const normalizedScene = normalizeSingleScriptScene(rawScene, {
                projectId,
                episodeId,
                episodeNumber: episode.no,
                targetSeconds: context.targetSeconds,
                plan,
                blueprintVersion: handoff.blueprintVersion,
                handoffSnapshotId: handoff.snapshotId,
                assetIndex,
                changes: handoff.changes,
                existing: previous,
            }, latestScene.sceneNumber, latestScene.sceneId);
            document = mergeSceneIntoScript(previous, normalizedScene);
            document = withNextScriptSceneVersions(previous, document);
            // 已通过人工覆盖确认或本来无人工标记；只清除本场的人工模块，不动其他场景。
            document = clearScriptManualEditModules(document, options.sceneId, ALL_SCRIPT_MANUAL_MODULES);
        } else {
            const rawScript = result.document as StudioProductionRawScript;
            if (!rawScript.scenes.length) throw new Error("模型没有返回可解析场景");
            document = normalizeScriptDocument(rawScript, {
                projectId,
                episodeId,
                episodeNumber: episode.no,
                targetSeconds: context.targetSeconds,
                plan,
                blueprintVersion: handoff.blueprintVersion,
                handoffSnapshotId: handoff.snapshotId,
                assetIndex,
                changes: handoff.changes,
                existing: previous,
            });
            document = withNextScriptSceneVersions(previous, document);
            if (previous) document = { ...document, manualEditedSceneIds: [], manualEditedModules: undefined, manualEditedAt: undefined };
        }
        document = ensureScriptSceneVersions(document);
        const checks = validateScriptDocument(document, { targetSeconds: context.targetSeconds, assetIndex });
        ensureProductionAssets(projectId, document);
        const staleResult = previousStoryboard && previous ? markStoryboardStaleForScriptChange(previousStoryboard, previous, document) : undefined;
        useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (current) => ({
            ...current,
            script: document,
            storyboard: staleResult?.document ?? current.storyboard,
            checks: mergeChecks(current.checks.filter((check) => check.category !== "剧本结构" && check.category !== "时长" && check.category !== "剧本对白"), checks),
            updatedAt: nowIso(),
        }));
        syncLegacyEpisode(projectId, episodeId, document, staleResult?.document ?? previousStoryboard);
        ctx.setProgress(100);
        const counts = emptyCounts(checks);
        const staleNote = staleResult?.changedSceneIds.length ? `；${staleResult.changedSceneIds.length} 个场景分镜已标记待检查` : "";
        return { note: `草稿 v${document.scriptVersion}；${document.scenes.length} 场；检查 ${counts.error}/${counts.warning}/${counts.suggestion}${staleNote}` };
    });
    options.onTaskStarted?.(id);
    let outcome;
    try {
        outcome = await promise;
    } finally {
        finish(projectId, episodeId, "script");
    }
    const latest = findEpisode(projectId, episodeId)?.production;
    return {
        ok: outcome.status === "succeeded",
        error: outcome.error,
        taskId: id,
        taskStatus: outcome.status,
        modelLabel: trace?.model.label ?? label,
        trace,
        backupSnapshotId: backupSnapshot?.snapshotId,
        newVersion: latest?.script?.scriptVersion,
        counts: latest ? emptyCounts(latest.checks) : undefined,
    };
}

/** 当前集单场景分镜生成；一个场景一组或多组，不允许整集一把梭。 */
export async function runStoryboardScene(projectId: string, episodeId: string, sceneId: string, options: { model?: NovelTextModelRuntimeOverride; onTaskStarted?: (taskId: string) => void } = {}): Promise<Stage3ActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    if (!project || !episode) return { ok: false, error: "项目或分集不存在" };
    const handoff = currentHandoff(project);
    const plan = planFor(handoff, episode.no);
    const script = episode.production?.script;
    if (!handoff || !plan) return { ok: false, error: "2B handoff 不完整", blocked: true };
    if (!script) return { ok: false, error: "先生成正式剧本，再生成分镜", blocked: true };
    if (script.status === "locked") return { ok: false, error: "剧本已锁定，先解锁再生成分镜", blocked: true };
    const scene = script.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return { ok: false, error: "场景不存在" };
    if (episode.production?.storyboard?.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再生成", blocked: true };
    const guard = canReplaceSceneStoryboard(episode.production?.storyboard, sceneId);
    if (!guard.ok) return { ok: false, error: guard.reason ?? "场景锁定", blocked: true };
    const lockResult = acquireStoryboardWriteLock({ projectId, episodeId, operation: "scene", targetId: sceneId });
    if (!lockResult.ok) return { ok: false, error: lockResult.error, blocked: true };
    const baseStoryboard = episode.production?.storyboard;
    const baseVersion = baseStoryboard?.storyboardVersion ?? 0;
    const baseScriptVersion = script.scriptVersion;
    const context = projectContext(project, handoff, plan, episode, handoffIssuesForEpisode(handoff, plan.episodeNumber));
    const prompt = storyboardScenePrompt(context, script, scene);
    const assetIndex = buildProductionAssetIndex(project, plan);
    let trace: StudioProductionModelTrace | undefined;
    let conflict: Stage3ActionResult["conflict"];
    try {
        const { id, promise } = useStudioTasks.getState().start(taskInput(project, episode, prompt.promptVersion, `分镜 · 第 ${episode.no} 集 / ${scene.sceneTitle}`, options.model), async (ctx) => {
            ctx.log("读取正式剧本场景；只发送当前场景与必要连续性上下文");
            ctx.setProgress(10);
            const result = await generateStoryboardSceneDraft(project, prompt, { signal: ctx.signal, onProgress: ctx.setProgress, model: options.model });
            trace = result.trace;
            const latest = findEpisode(projectId, episodeId);
            if (!latest) throw new Error("分集已被删除");
            const latestScript = latest.production?.script;
            const latestStoryboard = latest.production?.storyboard;
            if (!latestScript) throw new Error("正式剧本已不存在");
            const currentVersion = latestStoryboard?.storyboardVersion ?? 0;
            const conflictNormalized = normalizeStoryboardScene(result.document, {
                projectId,
                episodeId,
                episodeNumber: episode.no,
                script,
                scene,
                assetIndex,
                plan,
                changes: handoff.changes,
                existing: baseStoryboard,
                groupNumberBase: baseStoryboard?.groups.filter((group) => group.sceneId === sceneId).length ?? 0,
            });
            const generated = replaceSceneInStoryboard(baseStoryboard, {
                episodeId,
                episodeNumber: episode.no,
                script,
                sceneId,
                groups: conflictNormalized.groups,
                shots: conflictNormalized.shots,
                reason: "并发冲突保留",
            });
            const commit = await commitFormalStoryboardWrite({
                projectId,
                episodeId,
                operationType: "scene_replace",
                operationId: `sbs-scene-${simpleHash(`${projectId}:${episodeId}:${sceneId}:${baseVersion}:${id}`)}`,
                expectedVersion: baseVersion,
                scope: { kind: "scene", sceneId },
                candidateDocument: generated,
                fallbackProjects: useStudioStore.getState().projects,
                apply: ({ production, current: latestDoc }) => {
                    if (!latestDoc) return { ok: false, error: "当前分集还没有正式分镜" };
                    const currentScript = production.script;
                    if (!currentScript) return { ok: false, error: "正式剧本已不存在" };
                    const lockedShot = latestDoc.shots.find((shot) => shot.locked && shot.sceneId === sceneId);
                    if (currentScript.scriptVersion !== baseScriptVersion || currentScript.status === "locked" || latestDoc.status === "locked" || lockedShot) {
                        return {
                            ok: false,
                            conflict: true,
                            error: `${storyboardVersionConflictMessage(baseVersion, baseVersion)}${lockedShot ? `；镜头 ${lockedShot.shotId} 已锁定` : ""}${latestDoc.status === "locked" ? "；分镜已锁定" : ""}${currentScript.scriptVersion !== baseScriptVersion ? "；剧本版本已变化" : ""}`,
                            preserve: generated,
                        };
                    }
                    const normalized = normalizeStoryboardScene(result.document, {
                        projectId,
                        episodeId,
                        episodeNumber: production.script?.episodeNumber ?? episode.no,
                        script: currentScript,
                        scene,
                        assetIndex,
                        plan,
                        changes: handoff.changes,
                        existing: latestDoc,
                        groupNumberBase: latestDoc.groups.filter((group) => group.sceneId === sceneId).length,
                    });
                    let document = replaceSceneInStoryboard(latestDoc, {
                        episodeId,
                        episodeNumber: episode.no,
                        script: currentScript,
                        sceneId,
                        groups: normalized.groups,
                        shots: normalized.shots,
                        reason: "场景分镜生成",
                    });
                    document = recordStoryboardSceneSourceVersion(clearStoryboardStale(document, currentScript, { sceneId }), currentScript, sceneId);
                    const checks = validateStoryboardDocument(document, currentScript);
                    const backup = createStoryboardBackup(latestDoc, "场景分镜生成前快照", id);
                    const formal = createStoryboardSnapshot({
                        document,
                        snapshotType: "formal",
                        basedOnVersion: document.storyboardVersion,
                        reason: `场景分镜正式提交 v${document.storyboardVersion}`,
                        sourceTaskId: id,
                    });
                    const scriptChecks = production.checks.filter((check) => check.category === "剧本结构" || check.category === "时长" || check.category === "剧本对白");
                    return {
                        ok: true,
                        production: {
                            ...production,
                            storyboard: document,
                            storyboardVersions: [backup, formal, ...production.storyboardVersions].slice(0, 20),
                            checks: mergeChecks([...scriptChecks, ...checks], checks),
                            updatedAt: nowIso(),
                        },
                        document,
                        backup,
                        result: { counts: emptyCounts(checks), groups: normalized.groups.length, shots: normalized.shots.length },
                    };
                },
            });
            applyCommittedProduction(projectId, episodeId, commit.production);
            if (!commit.ok) {
                conflict = protocolConflict(commit);
                throw new Error(commit.error ?? "场景分镜写入失败");
            }
            if (commit.production) syncAfterFormalWrite(projectId, episodeId, commit.production);
            const commitResult = commit.result as { counts?: { error: number; warning: number; suggestion: number }; groups?: number; shots?: number } | undefined;
            ctx.setProgress(100);
            return { note: `分镜草稿 v${commit.newVersion}；${commitResult?.groups ?? 0} 组 / ${commitResult?.shots ?? 0} 镜；检查 ${commitResult?.counts?.error ?? 0}/${commitResult?.counts?.warning ?? 0}/${commitResult?.counts?.suggestion ?? 0}` };
        });
        options.onTaskStarted?.(id);
        const outcome = await promise;
        return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id, taskStatus: outcome.status, trace, remoteState: conflict ? "completed" : undefined, conflict };
    } finally {
        releaseStoryboardWriteLock(lockResult.lock);
    }
}

/** 按场景串行生成整集分镜；每个场景一次模型调用，全部成功后才一次性写入。 */
export async function runEpisodeStoryboard(projectId: string, episodeId: string, options: { model?: NovelTextModelRuntimeOverride; onTaskStarted?: (taskId: string) => void } = {}): Promise<Stage3ActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    if (!project || !episode) return { ok: false, error: "项目或分集不存在" };
    const handoff = currentHandoff(project);
    const plan = planFor(handoff, episode.no);
    const script = episode.production?.script;
    if (!handoff || !plan) return { ok: false, error: "2B handoff 不完整", blocked: true };
    if (!script) return { ok: false, error: "先生成正式剧本，再生成分镜", blocked: true };
    if (!script.scenes.length) return { ok: false, error: "剧本没有场景", blocked: true };
    if (script.status === "locked") return { ok: false, error: "剧本已锁定，先解锁再生成分镜", blocked: true };
    if (episode.production?.storyboard?.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再生成", blocked: true };
    const lockedShot = episode.production?.storyboard?.shots.find((shot) => shot.locked);
    if (lockedShot) return { ok: false, error: `镜头 ${lockedShot.shotId} 已锁定；整集生成不会覆盖锁定镜头，请逐场生成或先解锁`, blocked: true };
    const lockResult = acquireStoryboardWriteLock({ projectId, episodeId, operation: "episode" });
    if (!lockResult.ok) return { ok: false, error: lockResult.error, blocked: true };
    const baseStoryboard = episode.production?.storyboard;
    const baseVersion = baseStoryboard?.storyboardVersion ?? 0;
    const baseScriptVersion = script.scriptVersion;
    const context = projectContext(project, handoff, plan, episode, handoffIssuesForEpisode(handoff, plan.episodeNumber));
    const assetIndex = buildProductionAssetIndex(project, plan);
    let trace: StudioProductionModelTrace | undefined;
    let conflict: Stage3ActionResult["conflict"];
    try {
        const { id, promise } = useStudioTasks.getState().start(taskInput(project, episode, STAGE3_STORYBOARD_PROMPT_VERSION, `分镜 · 第 ${episode.no} 集 / 全集按场队列`, options.model), async (ctx) => {
            let working = baseStoryboard;
            for (let index = 0; index < script.scenes.length; index += 1) {
                const scene = script.scenes[index];
                ctx.log(`第 ${index + 1}/${script.scenes.length} 场：${scene.sceneTitle}；单场生成，避免整集结构化输出截断`);
                ctx.setProgress(8 + Math.round((index / script.scenes.length) * 82));
                const prompt = storyboardScenePrompt(context, script, scene);
                const result = await generateStoryboardSceneDraft(project, prompt, {
                    signal: ctx.signal,
                    onProgress: (value) => ctx.setProgress(Math.min(90, 8 + Math.round((index / script.scenes.length) * 82) + Math.round(value * 0.08))),
                    model: options.model,
                });
                trace = mergeModelTrace(trace, result.trace);
                const normalized = normalizeStoryboardScene(result.document, {
                    projectId,
                    episodeId,
                    episodeNumber: episode.no,
                    script,
                    scene,
                    assetIndex,
                    plan,
                    changes: handoff.changes,
                    existing: working,
                    groupNumberBase: working?.groups.filter((group) => group.sceneId === scene.sceneId).length ?? 0,
                });
                if (normalized.calibration.adjusted) {
                    ctx.log(`镜头时长校准：${normalized.calibration.rawSeconds}s → ${normalized.calibration.targetSeconds}s（第 ${index + 1} 场预算），镜头和剧情未删减`);
                }
                working = replaceSceneInStoryboard(working, {
                    episodeId,
                    episodeNumber: episode.no,
                    script,
                    sceneId: scene.sceneId,
                    groups: normalized.groups,
                    shots: normalized.shots,
                    reason: "整集按场生成",
                    incrementVersion: false,
                });
            }
            if (!working) throw new Error("分镜生成失败，没有可写入的草稿");
            const latest = findEpisode(projectId, episodeId);
            if (!latest) throw new Error("分集已被删除");
            const latestScript = latest.production?.script;
            if (!latestScript) throw new Error("正式剧本已不存在");
            const generated = working;
            const commit = await commitFormalStoryboardWrite({
                projectId,
                episodeId,
                operationType: "episode_replace",
                operationId: `sbs-episode-${simpleHash(`${projectId}:${episodeId}:${baseVersion}:${id}`)}`,
                expectedVersion: baseVersion,
                scope: { kind: "episode" },
                candidateDocument: generated,
                fallbackProjects: useStudioStore.getState().projects,
                apply: ({ production, current: latestDoc }) => {
                    if (!latestDoc) return { ok: false, error: "当前分集还没有正式分镜" };
                    const currentScript = production.script;
                    if (!currentScript) return { ok: false, error: "正式剧本已不存在" };
                    const lockedNow = latestDoc.shots.find((shot) => shot.locked);
                    if (currentScript.scriptVersion !== baseScriptVersion || currentScript.status === "locked" || latestDoc.status === "locked" || lockedNow) {
                        return {
                            ok: false,
                            conflict: true,
                            error: `整集分镜写入前状态已变化${lockedNow ? `；镜头 ${lockedNow.shotId} 已锁定` : ""}${latestDoc.status === "locked" ? "；分镜已锁定" : ""}${currentScript.scriptVersion !== baseScriptVersion ? "；剧本版本已变化" : ""}`,
                            preserve: generated,
                        };
                    }
                    const committedVersion = latestDoc.storyboardVersion + 1;
                    const document = recordStoryboardSourceVersion(clearStoryboardStale({ ...working, storyboardVersion: committedVersion }, currentScript, { all: true }), currentScript);
                    const checks = validateStoryboardDocument(document, currentScript);
                    const backup = createStoryboardBackup(latestDoc, "整集分镜生成前快照", id);
                    const formal = createStoryboardSnapshot({
                        document,
                        snapshotType: "formal",
                        basedOnVersion: document.storyboardVersion,
                        reason: `整集分镜正式提交 v${document.storyboardVersion}`,
                        sourceTaskId: id,
                    });
                    const scriptChecks = production.checks.filter((check) => check.category === "剧本结构" || check.category === "时长" || check.category === "剧本对白");
                    return {
                        ok: true,
                        production: {
                            ...production,
                            storyboard: document,
                            storyboardVersions: [backup, formal, ...production.storyboardVersions].slice(0, 20),
                            checks: mergeChecks([...scriptChecks, ...checks], checks),
                            updatedAt: nowIso(),
                        },
                        document,
                        backup,
                        result: { counts: emptyCounts(checks), scenes: script.scenes.length },
                    };
                },
            });
            applyCommittedProduction(projectId, episodeId, commit.production);
            if (!commit.ok) {
                conflict = protocolConflict(commit);
                throw new Error(commit.error ?? "整集分镜写入失败");
            }
            if (commit.production) syncAfterFormalWrite(projectId, episodeId, commit.production);
            const commitResult = commit.result as { counts?: { error: number; warning: number; suggestion: number }; scenes?: number } | undefined;
            ctx.setProgress(100);
            return { note: `整集分镜 v${commit.newVersion}；按 ${commitResult?.scenes ?? script.scenes.length} 场生成，检查 ${commitResult?.counts?.error ?? 0}/${commitResult?.counts?.warning ?? 0}/${commitResult?.counts?.suggestion ?? 0}` };
        });
        options.onTaskStarted?.(id);
        const outcome = await promise;
        return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id, taskStatus: outcome.status, trace, remoteState: conflict ? "completed" : undefined, conflict };
    } finally {
        releaseStoryboardWriteLock(lockResult.lock);
    }
}

/** 单镜头局部重生成；锁定镜头直接拦截。 */
export async function runStoryboardShot(projectId: string, episodeId: string, shotId: string, options: { model?: NovelTextModelRuntimeOverride; onTaskStarted?: (taskId: string) => void } = {}): Promise<Stage3ActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    if (!project || !episode) return { ok: false, error: "项目或分集不存在" };
    const handoff = currentHandoff(project);
    const plan = planFor(handoff, episode.no);
    const script = episode.production?.script;
    const storyboard = episode.production?.storyboard;
    const shot = storyboard?.shots.find((item) => item.shotId === shotId);
    if (!handoff || !plan) return { ok: false, error: "2B handoff 不完整", blocked: true };
    if (!script || !storyboard || !shot) return { ok: false, error: "分镜或镜头不存在", blocked: true };
    if (script.status === "locked") return { ok: false, error: "剧本已锁定，先解锁再生成分镜", blocked: true };
    if (storyboard.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再生成", blocked: true };
    const guard = canReplaceShot(storyboard, shotId);
    if (!guard.ok) return { ok: false, error: guard.reason ?? "镜头锁定", blocked: true };
    if (shot.manualEditedAt) return { ok: false, error: "镜头含人工编辑，Stage 4D 默认不允许局部重新生成覆盖", blocked: true };
    const scene = script.scenes.find((item) => item.sceneId === shot.sceneId);
    if (!scene) return { ok: false, error: "镜头对应的剧本场景不存在" };
    const lockResult = acquireStoryboardWriteLock({ projectId, episodeId, operation: "shot", targetId: shotId });
    if (!lockResult.ok) return { ok: false, error: lockResult.error, blocked: true };
    const baseVersion = storyboard.storyboardVersion;
    const baseScriptVersion = script.scriptVersion;
    const context = projectContext(project, handoff, plan, episode, handoffIssuesForEpisode(handoff, plan.episodeNumber));
    const prompt = storyboardShotPrompt(context, script, scene, shot);
    let trace: StudioProductionModelTrace | undefined;
    let conflict: Stage3ActionResult["conflict"];
    try {
        const { id, promise } = useStudioTasks.getState().start(taskInput(project, episode, prompt.promptVersion, `分镜单镜 · 第 ${episode.no} 集 / 镜 ${shot.shotNumber}`, options.model), async (ctx) => {
            ctx.log("保留镜头组空间与轴线，只重写当前镜头");
            ctx.setProgress(10);
            const result = await generateStoryboardShotDraft(project, prompt, { signal: ctx.signal, onProgress: ctx.setProgress, model: options.model });
            trace = result.trace;
            const latest = findEpisode(projectId, episodeId);
            const latestStoryboard = latest?.production?.storyboard;
            const latestScript = latest?.production?.script;
            if (!latestStoryboard || !latestScript) throw new Error("分镜或剧本已不存在");
            const conflictShot = normalizeShotReplacement(result.document, shot, script, scene);
            const generated = replaceShotInStoryboard(storyboard, conflictShot, "并发冲突保留");
            const commit = await commitFormalStoryboardWrite({
                projectId,
                episodeId,
                operationType: "shot_replace",
                operationId: `sbs-shot-${simpleHash(`${projectId}:${episodeId}:${shotId}:${baseVersion}:${id}`)}`,
                expectedVersion: baseVersion,
                scope: { kind: "shot", shotId },
                candidateDocument: generated,
                fallbackProjects: useStudioStore.getState().projects,
                apply: ({ production, current: currentDoc }) => {
                    if (!currentDoc) return { ok: false, error: "当前分集还没有正式分镜" };
                    const currentScript = production.script;
                    if (!currentScript) return { ok: false, error: "正式剧本已不存在" };
                    const latestShot = currentDoc.shots.find((item) => item.shotId === shotId);
                    if (!latestShot || latestShot.locked || latestShot.manualEditedAt || currentDoc.status === "locked" || currentScript.scriptVersion !== baseScriptVersion || currentScript.status === "locked") {
                        return {
                            ok: false,
                            conflict: true,
                            error: `单镜写入前状态已变化${!latestShot ? "；目标镜头已不存在" : latestShot.locked ? "；目标镜头已锁定" : latestShot.manualEditedAt ? "；目标镜头含人工编辑" : ""}${currentDoc.status === "locked" ? "；分镜已锁定" : ""}${currentScript.scriptVersion !== baseScriptVersion ? "；剧本版本已变化" : ""}`,
                            preserve: generated,
                        };
                    }
                    const nextShot = normalizeShotReplacement(result.document, latestShot, currentScript, scene);
                    let document = replaceShotInStoryboard(currentDoc, nextShot, "单镜头重生成");
                    document = clearStoryboardStale(document, currentScript, { shotId });
                    const checks = validateStoryboardDocument(document, currentScript);
                    const backup = createStoryboardBackup(currentDoc, "单镜头重生成前快照", id);
                    const formal = createStoryboardSnapshot({
                        document,
                        snapshotType: "formal",
                        basedOnVersion: document.storyboardVersion,
                        reason: `单镜头正式提交 v${document.storyboardVersion}`,
                        sourceTaskId: id,
                    });
                    const scriptChecks = production.checks.filter((check) => check.category === "剧本结构" || check.category === "时长" || check.category === "剧本对白");
                    return {
                        ok: true,
                        production: {
                            ...production,
                            storyboard: document,
                            storyboardVersions: [backup, formal, ...production.storyboardVersions].slice(0, 20),
                            checks: mergeChecks([...scriptChecks, ...checks], checks),
                            updatedAt: nowIso(),
                        },
                        document,
                        backup,
                        result: { counts: emptyCounts(checks) },
                    };
                },
            });
            applyCommittedProduction(projectId, episodeId, commit.production);
            if (!commit.ok) {
                conflict = protocolConflict(commit);
                throw new Error(commit.error ?? "单镜分镜写入失败");
            }
            if (commit.production) syncAfterFormalWrite(projectId, episodeId, commit.production);
            ctx.setProgress(100);
            return { note: `镜头 ${shot.shotNumber} 已重生成；锁定状态保留` };
        });
        options.onTaskStarted?.(id);
        const outcome = await promise;
        return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id, taskStatus: outcome.status, trace, remoteState: conflict ? "completed" : undefined, conflict };
    } finally {
        releaseStoryboardWriteLock(lockResult.lock);
    }
}

export function setScriptLocked(projectId: string, episodeId: string, locked: boolean) {
    useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (current) => {
        if (!current.script) return current;
        return { ...current, script: { ...current.script, status: locked ? "locked" : "draft", updatedAt: nowIso() }, updatedAt: nowIso() };
    });
}

export async function setStoryboardLocked(projectId: string, episodeId: string, locked: boolean, store?: StudioStateStore) {
    const episode = findEpisode(projectId, episodeId);
    const current = episode?.production?.storyboard;
    if (!episode || !current) return { ok: false, error: "当前分集还没有正式分镜" };
    if ((current.status === "locked") === locked) return { ok: true, newVersion: current.storyboardVersion, unchanged: true };
    const operationId = `sbl-${simpleHash(`${projectId}:${episodeId}:${current.storyboardVersion}:${locked}:${Date.now()}`)}`;
    const result = await commitFormalStoryboardWrite({
        projectId,
        episodeId,
        operationId,
        operationType: locked ? "document_lock" : "document_unlock",
        expectedVersion: current.storyboardVersion,
        scope: { kind: "document" },
        actor: "local-user",
        store,
        fallbackProjects: useStudioStore.getState().projects,
        apply: ({ production, current: latest }) => {
            if (!latest) return { ok: false, error: "当前分集还没有正式分镜" };
            const document: StudioStoryboardDocument = { ...latest, status: locked ? "locked" : "draft", storyboardVersion: latest.storyboardVersion + 1, updatedAt: nowIso() };
            const formal = createStoryboardSnapshot({
                document,
                snapshotType: "formal",
                basedOnVersion: document.storyboardVersion,
                reason: `${locked ? "锁定" : "解锁"}整份分镜正式提交 v${document.storyboardVersion}`,
            });
            return {
                ok: true,
                production: {
                    ...production,
                    storyboard: document,
                    storyboardVersions: [formal, ...production.storyboardVersions].slice(0, 20),
                    updatedAt: nowIso(),
                },
                document,
                requireBackup: false,
            };
        },
    });
    applyCommittedProduction(projectId, episodeId, result.production);
    if (result.production) syncAfterFormalWrite(projectId, episodeId, result.production);
    return { ok: result.ok, error: result.error, newVersion: result.newVersion, conflict: protocolConflict(result) };
}

export function setShotLocked(projectId: string, episodeId: string, shotId: string, locked: boolean) {
    useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (current) => {
        if (!current.storyboard) return current;
        if (current.storyboard.status === "locked") return current;
        return {
            ...current,
            storyboard: {
                ...current.storyboard,
                shots: current.storyboard.shots.map((shot) => (shot.shotId === shotId ? { ...shot, locked, updatedAt: nowIso() } : shot)),
                updatedAt: nowIso(),
            },
            updatedAt: nowIso(),
        };
    });
}

export function setShotGroupReviewed(projectId: string, episodeId: string, shotGroupId: string, reviewedByUser: boolean) {
    useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (current) => {
        if (!current.storyboard) return current;
        return {
            ...current,
            storyboard: {
                ...current.storyboard,
                groups: current.storyboard.groups.map((group) => (group.shotGroupId === shotGroupId ? { ...group, reviewedByUser, updatedAt: nowIso() } : group)),
                updatedAt: nowIso(),
            },
            updatedAt: nowIso(),
        };
    });
}

export function restoreScriptVersion(projectId: string, episodeId: string, versionId: string): Stage3ActionResult {
    const episode = findEpisode(projectId, episodeId);
    const production = episode?.production;
    const version = production?.scriptVersions.find((item) => item.id === versionId || item.snapshotId === versionId);
    if (!episode || !production || !version) return { ok: false, error: "剧本历史版本不存在" };
    if (!production.script) return { ok: false, error: "当前正式剧本不存在" };
    if (production.script.status === "locked") return { ok: false, error: "剧本已锁定，先解锁再恢复", blocked: true };
    const plan = planScriptRestore(production.script, version);
    const backup = plan.backup;
    let staleStoryboard: StudioStoryboardDocument | undefined;
    if (production.storyboard) {
        staleStoryboard = markStoryboardStaleForScriptChange(production.storyboard, production.script, plan.restored).document;
    }
    const before = production;
    useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (value) => ({
        ...value,
        script: plan.restored,
        storyboard: staleStoryboard ?? value.storyboard,
        scriptVersions: [...(backup ? [backup] : []), ...value.scriptVersions].slice(0, 20),
        updatedAt: nowIso(),
    }));
    const after = findEpisode(projectId, episodeId)?.production;
    const backupSaved = !backup || after?.scriptVersions.some((item) => item.snapshotId === backup.snapshotId);
    if (!after?.script || after.script.scriptVersion !== plan.newVersion || !backupSaved) {
        useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, () => before);
        return { ok: false, error: "恢复未完成，当前正式剧本保持不变" };
    }
    syncLegacyEpisode(projectId, episodeId, after.script, after.storyboard);
    return { ok: true, backupSnapshotId: backup?.snapshotId, newVersion: after.script.scriptVersion };
}

export async function discardStoryboardSnapshot(projectId: string, episodeId: string, snapshotId: string): Promise<Stage3ActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    const snapshot = episode?.production?.storyboardVersions.find((item) => item.snapshotId === snapshotId || item.id === snapshotId);
    if (!project) return { ok: false, error: "项目不存在" };
    if (!episode) return { ok: false, error: "分集不存在" };
    if (!snapshot) return { ok: false, error: "快照不存在" };
    if (snapshot.snapshotType === "formal") return { ok: false, error: "正式快照不能丢弃；它是正式版本的审计记录" };
    const result = await commitStoryboardSnapshotDiscard({
        projectId,
        episodeId,
        snapshotId: snapshot.snapshotId,
        expectedProjectUpdatedAt: project.updatedAt,
        expectedEpisodeUpdatedAt: episode.updatedAt,
    });
    if (!result.ok || !result.projects) return { ok: false, error: result.error ?? "删除快照失败" };
    useStudioStore.setState({ projects: result.projects });
    return { ok: true };
}

/**
 * 将快照作为一次新的正式变更写回：先备份当前正式版本，正式版本 +1，记录 restoredFromSnapshotId。
 * expectedVersion 必须等于当前正式版本；不一致就拒绝，避免用旧冲突结果覆盖最新内容。
 */
export async function applyStoryboardSnapshot(
    projectId: string,
    episodeId: string,
    snapshotId: string,
    options: { expectedVersion: number; mode: "apply" | "copy"; store?: StudioStateStore },
): Promise<Stage3ActionResult> {
    if (options.mode === "copy") return copyStoryboardSnapshotToDraft(projectId, episodeId, snapshotId);
    const episode = findEpisode(projectId, episodeId);
    const production = episode?.production;
    const currentDoc = production?.storyboard;
    const snapshot = production?.storyboardVersions.find((item) => item.snapshotId === snapshotId || item.id === snapshotId);
    if (!episode || !production || !currentDoc) return { ok: false, error: "当前分镜不存在，不能应用快照" };
    if (!snapshot) return { ok: false, error: "快照不存在" };
    if (currentDoc.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再应用", blocked: true };
    if (currentDoc.shots.some((shot) => shot.locked)) return { ok: false, error: "当前分镜仍有锁定镜头，整集应用会覆盖内容，请先解锁", blocked: true };
    const operationId = `sba-${simpleHash(`${projectId}:${episodeId}:${snapshot.snapshotId}:${options.expectedVersion}:${Date.now()}`)}`;
    const result = await commitFormalStoryboardWrite({
        projectId,
        episodeId,
        operationId,
        operationType: "snapshot_apply",
        expectedVersion: options.expectedVersion,
        scope: { kind: "episode" },
        sourceSnapshotId: snapshot.snapshotId,
        candidateDocument: snapshot.document,
        store: options.store,
        fallbackProjects: useStudioStore.getState().projects,
        apply: ({ production: currentProduction, project: currentProject, current: latest, currentVersion }) => {
            if (!latest) return { ok: false, error: "当前分镜不存在，不能应用快照" };
            if (latest.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再应用" };
            if (latest.shots.some((shot) => shot.locked)) return { ok: false, error: "当前分镜仍有锁定镜头，整集应用会覆盖内容，请先解锁" };
            const currentSnapshot = currentProduction.storyboardVersions.find((item) => item.snapshotId === snapshot.snapshotId || item.id === snapshot.snapshotId);
            if (!currentSnapshot) return { ok: false, error: "快照不存在" };
            const plan = planStoryboardSnapshotApply({
                current: latest,
                snapshot: currentSnapshot,
                script: currentProduction.script,
                expectedVersion: currentVersion,
                mode: "apply",
            });
            if (!plan.ok) return { ok: false, error: plan.error };
            const assetCheck = validateStoryboardAssetReferences(plan.restored, currentProject.assets);
            if (!assetCheck.ok) return { ok: false, error: assetCheck.error };
            const checks = currentProduction.script ? validateStoryboardDocument(plan.restored, currentProduction.script) : [];
            const scriptChecks = currentProduction.checks.filter((check) => check.category === "剧本结构" || check.category === "时长" || check.category === "剧本对白");
            return {
                ok: true,
                production: {
                    ...currentProduction,
                    storyboard: plan.restored,
                    storyboardVersions: [plan.backup, plan.formal, ...currentProduction.storyboardVersions].slice(0, 20),
                    checks: mergeChecks([...scriptChecks, ...checks], checks),
                    updatedAt: nowIso(),
                },
                document: plan.restored,
                backup: plan.backup,
                result: { newVersion: plan.newVersion },
            };
        },
    });
    applyCommittedProduction(projectId, episodeId, result.production);
    if (result.production) syncAfterFormalWrite(projectId, episodeId, result.production);
    return {
        ok: result.ok,
        error: result.error,
        blocked: Boolean(result.conflict),
        backupSnapshotId: result.backupSnapshotId,
        newVersion: result.newVersion,
        conflict: protocolConflict(result),
    };
}

export async function restoreStoryboardVersion(projectId: string, episodeId: string, versionId: string): Promise<Stage3ActionResult> {
    const current = findEpisode(projectId, episodeId)?.production?.storyboard;
    if (!current) return { ok: false, error: "当前分镜不存在" };
    return applyStoryboardSnapshot(projectId, episodeId, versionId, { expectedVersion: current.storyboardVersion, mode: "apply" });
}

/** 快照复制为独立草稿：只新增 storyboardDrafts，不改正式分镜、正式版本号或原快照。 */
export function copyStoryboardSnapshotToDraft(projectId: string, episodeId: string, snapshotId: string): Stage3ActionResult {
    const episode = findEpisode(projectId, episodeId);
    const production = episode?.production;
    const snapshot = production?.storyboardVersions.find((item) => item.snapshotId === snapshotId || item.id === snapshotId);
    if (!episode || !production || !snapshot) return { ok: false, error: "快照不存在，不能复制草稿" };
    const plan = planStoryboardDraftFromSnapshot({ snapshot, existing: production.storyboardDrafts ?? [], episodeId });
    if (plan.reused) return { ok: true, draftId: plan.draft.draftId, reusedDraft: true, newVersion: production.storyboard?.storyboardVersion };
    const before = production;
    try {
        useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (current) => ({
            ...current,
            storyboardDrafts: [plan.draft, ...(current.storyboardDrafts ?? [])].slice(0, 20),
            updatedAt: nowIso(),
        }));
    } catch (error) {
        return { ok: false, error: `草稿保存失败，正式分镜未改变：${error instanceof Error ? error.message : "存储不可用"}`, blocked: true };
    }
    const after = findEpisode(projectId, episodeId)?.production;
    const saved = after?.storyboardDrafts?.some((draft) => draft.draftId === plan.draft.draftId);
    if (!saved || after?.storyboard?.storyboardVersion !== before.storyboard?.storyboardVersion) {
        useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, () => before);
        return { ok: false, error: "草稿保存未通过回读校验，正式分镜未改变", blocked: true };
    }
    return { ok: true, draftId: plan.draft.draftId, newVersion: after?.storyboard?.storyboardVersion };
}

/** 保存独立草稿：只改草稿内容与 draftVersion，不触碰正式 storyboard / storyboardVersion。 */
export function saveStoryboardDraft(projectId: string, episodeId: string, draftId: string, document: StudioStoryboardDocument): Stage3ActionResult {
    const episode = findEpisode(projectId, episodeId);
    const production = episode?.production;
    const draft = production?.storyboardDrafts?.find((item) => item.draftId === draftId);
    if (!episode || !production || !draft) return { ok: false, error: "分镜草稿不存在" };
    if (draft.status !== "active") return { ok: false, error: "草稿已归档，不能继续编辑" };
    const next: StudioStoryboardDocument = {
        ...document,
        id: draft.storyboard.id,
        episodeId: draft.storyboard.episodeId,
        storyboardVersion: draft.storyboard.storyboardVersion,
        appliedDraftId: undefined,
        updatedAt: nowIso(),
    };
    const valid = validateStoryboardDraftDocument(next, { sceneIds: production.script?.scenes.map((scene) => scene.sceneId) });
    if (!valid.ok) return { ok: false, error: valid.error ?? "草稿内容校验失败" };
    if (storyboardContentHash(next) === storyboardContentHash(draft.storyboard)) return { ok: true, unchanged: true, newVersion: draft.draftVersion };
    const before = production;
    try {
        useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (current) => ({
            ...current,
            storyboardDrafts: (current.storyboardDrafts ?? []).map((item) => item.draftId === draftId
                ? {
                      ...item,
                      storyboard: next,
                      draftVersion: item.draftVersion + 1,
                      appliedStoryboardVersion: undefined,
                      appliedAt: undefined,
                      updatedAt: nowIso(),
                  }
                : item),
            updatedAt: nowIso(),
        }));
    } catch (error) {
        return { ok: false, error: `草稿保存失败，正式分镜未改变：${error instanceof Error ? error.message : "存储不可用"}`, blocked: true };
    }
    const after = findEpisode(projectId, episodeId)?.production;
    const saved = after?.storyboardDrafts?.some((item) => item.draftId === draftId && item.draftVersion === draft.draftVersion + 1);
    if (!saved || after?.storyboard?.storyboardVersion !== before.storyboard?.storyboardVersion) {
        useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, () => before);
        return { ok: false, error: "草稿保存未通过回读校验，正式分镜未改变", blocked: true };
    }
    return { ok: true, newVersion: draft.draftVersion + 1 };
}

/** 删除独立草稿：不影响正式分镜和历史快照。 */
export function deleteStoryboardDraft(projectId: string, episodeId: string, draftId: string): Stage3ActionResult {
    const episode = findEpisode(projectId, episodeId);
    const production = episode?.production;
    const draft = production?.storyboardDrafts?.find((item) => item.draftId === draftId);
    if (!episode || !production || !draft) return { ok: false, error: "分镜草稿不存在" };
    const before = production;
    useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, (current) => ({
        ...current,
        storyboardDrafts: (current.storyboardDrafts ?? []).filter((item) => item.draftId !== draftId),
        updatedAt: nowIso(),
    }));
    const after = findEpisode(projectId, episodeId)?.production;
    const removed = !after?.storyboardDrafts?.some((item) => item.draftId === draftId);
    if (!removed || after?.storyboard?.storyboardVersion !== before.storyboard?.storyboardVersion) {
        useStudioStore.getState().updateEpisodeProduction(projectId, episodeId, () => before);
        return { ok: false, error: "草稿删除未完成，正式分镜未改变", blocked: true };
    }
    return { ok: true };
}

/** 草稿应用为正式版本：版本校验、来源版本确认、备份、正式快照、回读校验。 */
export async function applyStoryboardDraft(
    projectId: string,
    episodeId: string,
    draftId: string,
    options: { expectedVersion: number; allowStaleDraft?: boolean; store?: StudioStateStore },
): Promise<Stage3ActionResult> {
    const episode = findEpisode(projectId, episodeId);
    const production = episode?.production;
    const currentDoc = production?.storyboard;
    const draft = production?.storyboardDrafts?.find((item) => item.draftId === draftId);
    if (!episode || !production || !currentDoc || !draft) return { ok: false, error: "当前分镜或草稿不存在" };
    if (currentDoc.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再应用", blocked: true };
    if (draft.status !== "active") return { ok: false, error: "草稿已归档，不能应用", blocked: true };
    if (draft.sourceStoryboardVersion !== currentDoc.storyboardVersion && !options.allowStaleDraft) {
        return {
            ok: false,
            error: `草稿基于正式 v${draft.sourceStoryboardVersion}，当前已是 v${currentDoc.storyboardVersion}；请确认仍应用该草稿`,
            blocked: true,
            requiresConfirmation: "draft_conflict",
        };
    }
    const operationId = `sbd-a-${simpleHash(`${projectId}:${episodeId}:${draftId}:${options.expectedVersion}:${Date.now()}`)}`;
    const result = await commitFormalStoryboardWrite({
        projectId,
        episodeId,
        operationId,
        operationType: "draft_apply",
        expectedVersion: options.expectedVersion,
        store: options.store,
        scope: { kind: "episode" },
        sourceSnapshotId: draft.sourceSnapshotId,
        candidateDocument: draft.storyboard,
        fallbackProjects: useStudioStore.getState().projects,
        apply: ({ production: currentProduction, current: latest, currentVersion }) => {
            if (!latest) return { ok: false, error: "当前分镜不存在" };
            if (latest.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再应用" };
            const currentDraft = currentProduction.storyboardDrafts.find((item) => item.draftId === draftId);
            if (!currentDraft || currentDraft.status !== "active") return { ok: false, error: "草稿不存在或已归档" };
            const plan = planStoryboardDraftApply({
                current: latest,
                draft: currentDraft,
                script: currentProduction.script,
                expectedVersion: currentVersion,
                allowStaleDraft: options.allowStaleDraft,
                sceneIds: currentProduction.script?.scenes.map((scene) => scene.sceneId),
            });
            if (!plan.ok) return { ok: false, error: plan.error, conflict: plan.conflict };
            const checks = currentProduction.script ? validateStoryboardDocument(plan.restored, currentProduction.script) : [];
            const scriptChecks = currentProduction.checks.filter((check) => check.category === "剧本结构" || check.category === "时长" || check.category === "剧本对白");
            return {
                ok: true,
                production: {
                    ...currentProduction,
                    storyboard: plan.restored,
                    storyboardVersions: [plan.backup, plan.formal, ...currentProduction.storyboardVersions].slice(0, 20),
                    checks: mergeChecks([...scriptChecks, ...checks], checks),
                    storyboardDrafts: currentProduction.storyboardDrafts.map((item) => item.draftId === draftId
                        ? { ...item, appliedStoryboardVersion: plan.newVersion, appliedAt: nowIso(), updatedAt: nowIso() }
                        : item),
                    updatedAt: nowIso(),
                },
                document: plan.restored,
                backup: plan.backup,
                result: { newVersion: plan.newVersion, checks: emptyCounts(checks) },
            };
        },
    });
    applyCommittedProduction(projectId, episodeId, result.production);
    if (result.production) syncAfterFormalWrite(projectId, episodeId, result.production);
    const enhanced = result.result as { checks?: { error: number; warning: number; suggestion: number } } | undefined;
    return {
        ok: result.ok,
        error: result.error,
        blocked: Boolean(result.conflict) || result.error === "草稿已归档，不能应用" || Boolean(result.error?.includes("请确认仍应用")),
        requiresConfirmation: result.error?.includes("请确认仍应用") ? "draft_conflict" : undefined,
        draftId: result.ok ? draftId : undefined,
        backupSnapshotId: result.backupSnapshotId,
        newVersion: result.newVersion,
        counts: enhanced?.checks,
        conflict: protocolConflict(result),
    };
}

function editedSceneModules(previous: StudioScriptDocument, next: StudioScriptDocument): Record<string, StudioScriptManualEditModule[]> {
    const modules: Record<string, StudioScriptManualEditModule[]> = {};
    for (const scene of next.scenes) {
        const changed = scriptSceneEditModules(previous.scenes.find((item) => item.sceneId === scene.sceneId), scene);
        if (changed.length) modules[scene.sceneId] = changed;
    }
    return modules;
}

/**
 * 正式剧本手工写入的唯一提交路径：
 * 校验锁定/版本 → 判断真实变化 → 备份并回读 → 写入 → +1 版本 → 更新 stale → 回读校验。
 * 失败时恢复写入前 production；内容未变化时不做无意义备份或递增。
 */
function commitScriptManualWrite(input: {
    projectId: string;
    episodeId: string;
    candidate: StudioScriptDocument;
    reason: string;
    editedScenes?: Record<string, StudioScriptManualEditModule[]>;
    documentEdited?: boolean;
}): Stage3ActionResult {
    const project = findProject(input.projectId);
    const episode = findEpisode(input.projectId, input.episodeId);
    const before = episode?.production;
    const current = before?.script;
    if (!project || !episode || !before || !current) return { ok: false, error: "还没有正式剧本" };
    if (current.status === "locked") return { ok: false, error: "剧本已锁定，先解锁", blocked: true };
    const candidate: StudioScriptDocument = {
        ...input.candidate,
        id: current.id,
        episodeId: current.episodeId,
        episodeNumber: current.episodeNumber,
        scriptVersion: current.scriptVersion,
        status: current.status,
        createdAt: current.createdAt,
        manualEditedSceneIds: current.manualEditedSceneIds,
        manualEditedModules: current.manualEditedModules,
        manualEditedAt: current.manualEditedAt,
        sceneVersions: current.sceneVersions,
        restoredFromSnapshotId: current.restoredFromSnapshotId,
    };
    if (!scriptContentChanged(current, candidate)) {
        return { ok: true, unchanged: true, newVersion: current.scriptVersion };
    }
    const editedAt = nowIso();
    let document = withNextScriptSceneVersions(current, {
        ...candidate,
        scriptVersion: current.scriptVersion + 1,
        status: "draft" as StudioProductionReviewStatus,
        updatedAt: editedAt,
    });
    const sceneModules = input.editedScenes ?? editedSceneModules(current, document);
    const sceneIds = Object.keys(sceneModules);
    if (sceneIds.length) document = markScriptManualEdit(document, sceneIds, editedAt, sceneModules);
    if (input.documentEdited || !sceneIds.length) document = markScriptManualEdit(document, [], editedAt);
    document = ensureScriptSceneVersions(document);

    const backup = persistScriptBackup(input.projectId, input.episodeId, current, input.reason);
    if (!backup.ok) return { ok: false, error: backup.error, blocked: true };
    const handoff = currentHandoff(project);
    const plan = planFor(handoff, episode.no);
    const assetIndex = handoff && plan ? buildProductionAssetIndex(project, plan) : undefined;
    const checks = validateScriptDocument(document, { targetSeconds: document.durationTarget, assetIndex });
    ensureProductionAssets(input.projectId, document);
    const storyboard = before.storyboard
        ? markStoryboardStaleForScriptChange(before.storyboard, current, document).document
        : undefined;
    try {
        useStudioStore.getState().updateEpisodeProduction(input.projectId, input.episodeId, (value) => ({
            ...value,
            script: document,
            storyboard: storyboard ?? value.storyboard,
            checks: mergeChecks(value.checks.filter((check) => check.category !== "剧本结构" && check.category !== "时长" && check.category !== "剧本对白"), checks),
            updatedAt: nowIso(),
        }));
    } catch (error) {
        useStudioStore.getState().updateEpisodeProduction(input.projectId, input.episodeId, () => before);
        return { ok: false, error: `剧本写入失败，已恢复修改前版本：${error instanceof Error ? error.message : "存储不可用"}`, blocked: true };
    }
    const after = findEpisode(input.projectId, input.episodeId)?.production;
    const saved = after?.script?.scriptVersion === document.scriptVersion
        && after.script && scriptContentHash(after.script) === scriptContentHash(document)
        && scriptBackupPresent(after.scriptVersions, backup.snapshot.snapshotId);
    if (!saved) {
        useStudioStore.getState().updateEpisodeProduction(input.projectId, input.episodeId, () => before);
        return { ok: false, error: "剧本写入未通过回读校验，当前正式剧本保持不变", blocked: true };
    }
    syncLegacyEpisode(input.projectId, input.episodeId, after!.script, after.storyboard);
    return {
        ok: true,
        newVersion: document.scriptVersion,
        backupSnapshotId: backup.snapshot.snapshotId,
        counts: emptyCounts(checks),
    };
}

export function updateScriptManual(projectId: string, episodeId: string, patch: Partial<StudioScriptDocument>): Stage3ActionResult {
    const current = findEpisode(projectId, episodeId)?.production?.script;
    if (!current) return { ok: false, error: "还没有剧本" };
    const candidate = { ...current, ...patch, scriptVersion: current.scriptVersion };
    return commitScriptManualWrite({
        projectId,
        episodeId,
        candidate,
        reason: "手工修改剧本前快照",
        editedScenes: editedSceneModules(current, candidate),
        documentEdited: true,
    });
}

/** 手工保存单场：统一走备份、版本 +1、场景版本和局部 stale；内容未变时直接返回。 */
export function saveScriptSceneEdit(projectId: string, episodeId: string, scene: StudioScriptScene): Stage3ActionResult {
    const current = findEpisode(projectId, episodeId)?.production?.script;
    if (!current) return { ok: false, error: "还没有剧本" };
    const candidate = mergeSceneIntoScript(current, scene);
    const previous = current.scenes.find((item) => item.sceneId === scene.sceneId);
    const modules = scriptSceneEditModules(previous, scene);
    return commitScriptManualWrite({
        projectId,
        episodeId,
        candidate,
        reason: "手工修改单场前快照",
        editedScenes: modules.length ? { [scene.sceneId]: modules } : {},
    });
}

export function saveScriptMeta(projectId: string, episodeId: string, patch: { title?: string; logline?: string; synopsis?: string }): Stage3ActionResult {
    const current = findEpisode(projectId, episodeId)?.production?.script;
    if (!current) return { ok: false, error: "还没有剧本" };
    const candidate = { ...current, ...patch, scriptVersion: current.scriptVersion };
    return commitScriptManualWrite({
        projectId,
        episodeId,
        candidate,
        reason: "手工修改剧本信息前快照",
        documentEdited: true,
    });
}

/** 手工修改单镜：保留镜头组与稳定 shotId，记录旧版，重新跑分镜检查。 */
export async function saveStoryboardShotEdit(projectId: string, episodeId: string, shotId: string, patch: Partial<StudioDetailShot>, store?: StudioStateStore): Promise<Stage3ActionResult> {
    const episode = findEpisode(projectId, episodeId);
    const current = episode?.production?.storyboard;
    const script = episode?.production?.script;
    if (!episode || !current || !script) return { ok: false, error: "还没有分镜或剧本" };
    const shot = current.shots.find((item) => item.shotId === shotId);
    if (!shot) return { ok: false, error: "镜头不存在" };
    if (current.status === "locked") return { ok: false, error: "分镜已锁定，先解锁", blocked: true };
    if (shot.locked) return { ok: false, error: "镜头已锁定，先解锁" };
    const operationId = `sbs-e-${simpleHash(`${projectId}:${episodeId}:${shotId}:${current.storyboardVersion}:${Date.now()}`)}`;
    const result = await commitFormalStoryboardWrite({
        projectId,
        episodeId,
        operationId,
        operationType: "shot_edit",
        expectedVersion: current.storyboardVersion,
        scope: { kind: "shot", shotId },
        store,
        fallbackProjects: useStudioStore.getState().projects,
        apply: ({ production, current: latest }) => {
            if (!latest) return { ok: false, error: "还没有分镜" };
            if (latest.status === "locked") return { ok: false, error: "分镜已锁定，先解锁" };
            const currentScript = production.script;
            if (!currentScript) return { ok: false, error: "还没有剧本" };
            const latestShot = latest.shots.find((item) => item.shotId === shotId);
            if (!latestShot) return { ok: false, error: "镜头不存在" };
            if (latestShot.locked) return { ok: false, error: "镜头已锁定，先解锁" };
            const manualFields = [...new Set([...(latestShot.manualEditedFields ?? []), ...Object.keys(patch).filter((key) => !["shotId", "episodeId", "sceneId", "shotGroupId", "createdAt", "updatedAt"].includes(key))])];
            const nextShot = { ...latestShot, ...patch, shotId: latestShot.shotId, manualEditedAt: nowIso(), manualEditedFields: manualFields, updatedAt: nowIso() };
            const document: StudioStoryboardDocument = {
                ...latest,
                shots: latest.shots.map((item) => (item.shotId === shotId ? nextShot : item)),
                storyboardVersion: latest.storyboardVersion + 1,
                updatedAt: nowIso(),
            };
            const checks = validateStoryboardDocument(document, currentScript);
            const backup = createStoryboardBackup(latest, "手工修改单镜前快照");
            const formal = createStoryboardSnapshot({ document, snapshotType: "formal", basedOnVersion: document.storyboardVersion, reason: `手工修改单镜正式提交 v${document.storyboardVersion}` });
            return {
                ok: true,
                production: {
                    ...production,
                    storyboard: document,
                    storyboardVersions: [backup, formal, ...production.storyboardVersions].slice(0, 20),
                    checks: mergeChecks(production.checks.filter((check) => check.category === "剧本结构" || check.category === "时长" || check.category === "剧本对白"), checks),
                    updatedAt: nowIso(),
                },
                document,
                backup,
                result: { counts: emptyCounts(checks) },
            };
        },
    });
    applyCommittedProduction(projectId, episodeId, result.production);
    if (result.production) syncAfterFormalWrite(projectId, episodeId, result.production);
    const enhanced = result.result as { counts?: { error: number; warning: number; suggestion: number } } | undefined;
    return { ok: result.ok, error: result.error, counts: enhanced?.counts, conflict: protocolConflict(result), backupSnapshotId: result.backupSnapshotId, newVersion: result.newVersion };
}

export async function updateStoryboardShotManual(projectId: string, episodeId: string, shotId: string, patch: Partial<StudioDetailShot>) {
    return saveStoryboardShotEdit(projectId, episodeId, shotId, patch);
}

type StudioDetailShot = NonNullable<StudioStoryboardDocument["shots"]>[number];

/** 加入有序队列：剧本每集一个 job，分镜每场景一个 job；同一目标已有活动/排队任务时不重复入队。 */
export function enqueueProductionJobs(projectId: string, kind: StudioProductionJobKind, episodeIds: string[], sceneIds: string[] = []): Stage3ActionResult {
    const project = findProject(projectId);
    if (!project) return { ok: false, error: "项目不存在" };
    const handoff = currentHandoff(project);
    if (!handoff) return { ok: false, error: "2B handoff 不完整，不能入队", blocked: true };
    const summary = projectTextModelSummary(project);
    if (!summary.selection) return { ok: false, error: "项目还没有选择文本模型", blocked: true };
    const params = dramaModelParams(project.modelProfiles, "text", summary.selection);
    const jobs: StudioProductionJob[] = [];
    let skips: StudioProductionSkipRecord[] = [];
    const candidates = kind === "script"
        ? episodeIds
              .map((episodeId) => {
                  const episode = project.episodes.find((item) => item.id === episodeId);
                  const plan = episode ? planFor(handoff, episode.no) : undefined;
                  if (!episode) return undefined;
                  return {
                      episodeId,
                      episodeNumber: episode.no,
                      episodeTitle: episode.title,
                      script: episode.production?.script,
                      hasPlan: Boolean(plan),
                      draftAllowed: productionAdmission(handoff, episode.no).draftAllowed,
                      plan,
                  };
              })
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [];
    const scriptPlan = kind === "script" ? planScriptQueue(candidates) : undefined;
    const planByEpisode = new Map(candidates.map((candidate) => [candidate.episodeId, candidate.plan]));
    if (scriptPlan) skips = scriptPlan.skips;
    for (const candidate of scriptPlan ? scriptPlan.queue : []) {
        const plan = planByEpisode.get(candidate.episodeId);
        if (!plan) continue;
        jobs.push(
            createProductionJob({
                kind: "script",
                episodeIds: [candidate.episodeId],
                episodeNumbers: [candidate.episodeNumber],
                model: { channelId: summary.selection.channelId, modelId: summary.selection.modelId, label: summary.label },
                modelParams: params,
                promptVersion: STAGE3_SCRIPT_PROMPT_VERSION,
                sourceHandoffId: handoff.snapshotId,
                sourceBlueprintVersion: handoff.blueprintVersion,
                sourcePlanVersions: [plan.version],
                targetEpisodeId: candidate.episodeId,
                targetModule: "episode",
            }),
        );
    }
    if (kind !== "script") {
        for (const episodeId of episodeIds) {
            const episode = project.episodes.find((item) => item.id === episodeId);
            const plan = episode ? planFor(handoff, episode.no) : undefined;
            if (!episode || !plan) continue;
            const script = episode.production?.script;
            if (!script) continue;
            const targetScenes = sceneIds.length ? script.scenes.filter((scene) => sceneIds.includes(scene.sceneId)) : script.scenes;
            for (const scene of targetScenes) {
                jobs.push(
                    createProductionJob({
                        kind,
                        episodeIds: [episodeId],
                        episodeNumbers: [episode.no],
                        model: { channelId: summary.selection.channelId, modelId: summary.selection.modelId, label: summary.label },
                        modelParams: params,
                        promptVersion: STAGE3_STORYBOARD_PROMPT_VERSION,
                        sourceHandoffId: handoff.snapshotId,
                        sourceBlueprintVersion: handoff.blueprintVersion,
                        sourcePlanVersions: [plan.version],
                        targetEpisodeId: episodeId,
                        targetSceneId: scene.sceneId,
                        targetModule: "scene",
                    }),
                );
            }
        }
    }
    const counts = { error: handoff.checks.filter((check) => check.level === "error").length, warning: handoff.checks.filter((check) => check.level === "warning").length, suggestion: handoff.checks.filter((check) => check.level === "suggestion").length };
    if (!jobs.length) {
        if (skips.length) {
            useStudioStore.getState().updateProduction(projectId, (current) => ({
                ...current,
                handoff: productionHandoffSnapshot(handoff),
                skips: mergeSkips(current.skips, skips),
                updatedAt: nowIso(),
            }));
            return { ok: true, skipped: skips, counts, requeued: 0 };
        }
        return { ok: false, error: kind === "script" ? "没有可入队的集：先检查 2B 准入与目标集" : "没有可入队的场景：先生成正式剧本", blocked: true, counts };
    }
    const activeTargets = new Set(
        (project.production?.jobs ?? [])
            .filter((job) => ["pending", "queued", "submitting", "running", "cancelling", "interrupted", "unknown"].includes(job.status) || job.needsReview === true)
            .map((job) => `${job.kind}:${job.targetEpisodeId}:${job.targetSceneId ?? ""}`),
    );
    const fresh = jobs.filter((job) => !activeTargets.has(`${job.kind}:${job.targetEpisodeId}:${job.targetSceneId ?? ""}`));
    if (!fresh.length) {
        useStudioStore.getState().updateProduction(projectId, (current) => ({
            ...current,
            handoff: productionHandoffSnapshot(handoff),
            skips: mergeSkips(current.skips, skips),
            updatedAt: nowIso(),
        }));
        return { ok: false, error: "相同目标已在队列中，不能重复提交", blocked: true, skipped: skips, counts };
    }
    useStudioStore.getState().updateProduction(projectId, (current) => ({
        ...current,
        handoff: productionHandoffSnapshot(handoff),
        jobs: [...current.jobs, ...fresh.map((job) => ({ ...job, status: "queued" as const, currentLabel: "排队中" }))].slice(-30),
        skips: mergeSkips(current.skips, skips),
        updatedAt: nowIso(),
    }));
    void processProductionQueue(projectId);
    return { ok: true, counts, skipped: skips.length ? skips : undefined, requeued: fresh.length };
}

export function updateProductionJob(projectId: string, jobId: string, patch: Partial<StudioProductionJob>) {
    useStudioStore.getState().updateProduction(projectId, (current) => ({
        ...current,
        jobs: current.jobs.map((job) => (job.id === jobId ? { ...job, ...patch, updatedAt: nowIso() } : job)),
        activeJobId: patch.status && ["running", "submitting", "cancelling"].includes(patch.status) ? jobId : current.activeJobId === jobId && ["succeeded", "failed", "cancelled", "interrupted", "unknown"].includes(patch.status ?? "") ? undefined : current.activeJobId,
        updatedAt: nowIso(),
    }));
}

export function pauseProductionQueue(projectId: string) {
    const controller = queueControllers.get(projectId);
    if (controller) controller.paused = true;
    useStudioStore.getState().updateProduction(projectId, (current) => ({
        ...current,
        jobs: current.jobs.map((job) => (job.status === "queued" || job.status === "pending" ? { ...job, currentLabel: "已暂停，等待继续", updatedAt: nowIso() } : job)),
        updatedAt: nowIso(),
    }));
}

export function stopProductionQueue(projectId: string): Stage3ActionResult {
    const controller = queueControllers.get(projectId);
    const activeJobId = controller?.activeJobId;
    if (controller) {
        controller.stopped = true;
        if (controller.activeTaskId) useStudioTasks.getState().cancel(controller.activeTaskId, { outcome: "unknown", error: "已停止等待；远端请求结果未知，请到项目队列核对" });
    }
    useStudioStore.getState().updateProduction(projectId, (current) => {
        const jobs = current.jobs.map((job) => {
            if (!["pending", "queued", "submitting", "running", "cancelling"].includes(job.status)) return job;
            const isActive = job.id === activeJobId || job.status === "running" || job.status === "submitting" || job.status === "cancelling";
            if (isActive) {
                return {
                    ...job,
                    status: "interrupted" as const,
                    remoteState: "unknown" as const,
                    needsReview: true,
                    retryable: false,
                    currentLabel: "请求结果未知，已转入核对",
                    finishedAt: undefined,
                    updatedAt: nowIso(),
                };
            }
            return {
                ...job,
                status: "cancelled" as const,
                remoteState: "not_submitted" as const,
                needsReview: false,
                retryable: false,
                currentLabel: "已取消，未提交",
                finishedAt: nowIso(),
                updatedAt: nowIso(),
            };
        });
        return { ...current, jobs, activeJobId: undefined, updatedAt: nowIso() };
    });
    return { ok: true };
}

export function resumeProductionQueue(projectId: string): Stage3ActionResult {
    const production = findProject(projectId)?.production;
    if (!production) return { ok: false, error: "项目不存在" };
    const controller = queueControllers.get(projectId);
    if (controller && !controller.stopped) {
        if (!controller.paused) return { ok: false, error: "队列正在运行", blocked: true };
        controller.paused = false;
    }
    const resumable = selectResumableJobs(production.jobs);
    const held = selectReviewJobs(production.jobs).length;
    if (!resumable.length) return { ok: false, error: held ? `有 ${held} 个任务结果未知，需要先人工核对` : "没有可继续的排队任务", blocked: true, held };
    const ids = new Set(resumable.map((job) => job.id));
    useStudioStore.getState().updateProduction(projectId, (current) => ({
        ...current,
        jobs: current.jobs.map((job) =>
            ids.has(job.id)
                ? { ...job, status: "queued" as const, remoteState: "not_submitted" as const, needsReview: false, retryable: true, progress: 0, error: undefined, currentLabel: "等待继续", finishedAt: undefined, updatedAt: nowIso() }
                : job,
        ),
        updatedAt: nowIso(),
    }));
    if (!controller || controller.stopped) void processProductionQueue(projectId);
    return { ok: true, requeued: ids.size, held };
}

export function retryProductionJobs(projectId: string): Stage3ActionResult {
    const production = findProject(projectId)?.production;
    if (!production) return { ok: false, error: "项目不存在" };
    const controller = queueControllers.get(projectId);
    if (controller && !controller.stopped) return { ok: false, error: "队列正在运行，请先暂停或停止，再重试失败任务", blocked: true, held: selectReviewJobs(production.jobs).length };
    const retryable = selectRetryableJobs(production.jobs);
    const held = selectReviewJobs(production.jobs).length;
    if (!retryable.length) return { ok: false, error: held ? `没有可安全重试的任务；有 ${held} 个结果未知任务需要人工核对` : "没有可安全重试的失败任务", blocked: true, held };
    const ids = new Set(retryable.map((job) => job.id));
    useStudioStore.getState().updateProduction(projectId, (current) => ({
        ...current,
        jobs: current.jobs.map((job) =>
            ids.has(job.id)
                ? { ...job, status: "queued" as const, remoteState: "not_submitted" as const, needsReview: false, retryable: true, progress: 0, error: undefined, currentLabel: "等待重试", taskId: undefined, trace: undefined, startedAt: undefined, finishedAt: undefined, updatedAt: nowIso() }
                : job,
        ),
        updatedAt: nowIso(),
    }));
    void processProductionQueue(projectId);
    return { ok: true, requeued: ids.size, held };
}

/** 人工核对未知/中断任务；只有 retry 会重新入队，adopt-existing 视为已写入，不重发。 */
export function confirmProductionJobResult(projectId: string, jobId: string, decision: StudioProductionJobReviewDecision): Stage3ActionResult {
    const project = findProject(projectId);
    const job = project?.production?.jobs.find((item) => item.id === jobId);
    if (!job) return { ok: false, error: "任务不存在" };
    if (!["failed", "interrupted", "unknown", "cancelling"].includes(job.status)) {
        return { ok: false, error: `任务当前状态为 ${job.status}，不需要结果核对` };
    }
    const next = applyProductionJobReview(job, decision);
    updateProductionJob(projectId, jobId, next);
    if (job.taskId) {
        useStudioTasks.getState().updateTask(job.taskId, {
            status: decision === "adopt-existing" ? "succeeded" : "failed",
            error: decision === "adopt-existing" ? undefined : decision === "retry" ? "已确认未提交，已重新排队" : "人工确认失败，不重试",
            finishedAt: nowIso(),
        });
    }
    if (decision === "retry") void processProductionQueue(projectId);
    return { ok: true, taskStatus: next.status, requeued: decision === "retry" ? 1 : 0 };
}

/** 串行处理当前项目队列；每集/每场完成后才启动下一项。 */
export async function processProductionQueue(projectId: string) {
    const active = queueControllers.get(projectId);
    if (active && !active.stopped) return;
    const controller = { paused: false, stopped: false, activeTaskId: undefined as string | undefined, activeJobId: undefined as string | undefined };
    queueControllers.set(projectId, controller);
    const project = findProject(projectId);
    if (!project) {
        queueControllers.delete(projectId);
        return;
    }
    const jobs = project.production?.jobs.filter((job) => job.status === "queued").slice(0, 20) ?? [];
    for (const job of jobs) {
        if (controller.stopped) break;
        if (controller.paused) break;
        const current = findProject(projectId)?.production?.jobs.find((item) => item.id === job.id);
        if (!current || current.status !== "queued") continue;
        controller.activeJobId = current.id;
        updateProductionJob(projectId, current.id, { status: "running", progress: 5, currentLabel: "准备当前任务", startedAt: nowIso(), remoteState: "not_submitted" });
        const latestProject = findProject(projectId);
        if (!latestProject) break;
        const targetEpisode = latestProject.episodes.find((episode) => episode.id === current.targetEpisodeId || (current.episodeIds.length === 1 && episode.id === current.episodeIds[0]));
        if (!targetEpisode) {
            updateProductionJob(projectId, current.id, {
                status: "failed",
                progress: 0,
                currentLabel: "目标分集不存在",
                error: "目标分集不存在",
                remoteState: "not_submitted",
                needsReview: true,
                retryable: false,
                finishedAt: nowIso(),
            });
            controller.activeJobId = undefined;
            continue;
        }
        const model = executionModel(current);
        const onTaskStarted = (taskId: string) => {
            controller.activeTaskId = taskId;
            updateProductionJob(projectId, current.id, { status: "submitting", progress: 10, currentLabel: "已提交项目文本模型", taskId, remoteState: "submitted" });
        };
        let result: Stage3ActionResult;
        try {
            if (current.kind === "script") {
                result = await runEpisodeScript(projectId, targetEpisode.id, {
                    sceneId: current.targetSceneId,
                    instruction: current.targetModule === "scene" ? "按当前场重写" : undefined,
                    model,
                    onTaskStarted,
                });
            } else if (current.targetSceneId) {
                result = await runStoryboardScene(projectId, targetEpisode.id, current.targetSceneId, { model, onTaskStarted });
            } else {
                result = { ok: false, error: "分镜队列缺少目标场景", blocked: true };
            }
        } catch (error) {
            result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        controller.activeTaskId = undefined;
        const latestJob = findProject(projectId)?.production?.jobs.find((item) => item.id === current.id);
        if (latestJob && !["running", "submitting"].includes(latestJob.status)) {
            // 停止/刷新/人工核对已经把任务改成 interrupted/unknown/cancelled；不能用迟到结果覆盖核对状态。
            controller.activeJobId = undefined;
            continue;
        }
        const outcome = queueOutcome(result);
        const actualTrace = result.trace;
        updateProductionJob(projectId, current.id, {
            status: outcome.status,
            progress: result.ok ? 100 : 0,
            currentLabel: outcome.label,
            error: result.ok || outcome.status === "cancelled" ? undefined : result.error,
            skipReason: outcome.skipReason,
            remoteState: outcome.remoteState,
            needsReview: outcome.needsReview,
            retryable: outcome.retryable,
            finishedAt: result.ok || outcome.status === "cancelled" || outcome.remoteState === "failed" ? nowIso() : undefined,
            taskId: result.taskId,
            trace: actualTrace,
            model: actualTrace?.model ?? current.model,
            modelParams: actualTrace?.modelParams ?? current.modelParams,
            inputChars: actualTrace?.inputChars ?? current.inputChars,
            outputChars: actualTrace?.outputChars ?? current.outputChars,
            calls: actualTrace?.calls ?? current.calls,
        });
        controller.activeJobId = undefined;
    }
    if (controller.paused) {
        useStudioStore.getState().updateProduction(projectId, (current) => ({
            ...current,
            jobs: current.jobs.map((job) => (job.status === "queued" ? { ...job, currentLabel: "已暂停，等待继续", updatedAt: nowIso() } : job)),
            activeJobId: undefined,
            updatedAt: nowIso(),
        }));
    }
    if (queueControllers.get(projectId) === controller) queueControllers.delete(projectId);
}
