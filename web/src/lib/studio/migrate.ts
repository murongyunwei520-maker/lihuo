import type { DramaAsset, DramaMediaVersion, DramaSequence, DramaShot } from "@/types/drama";
import {
    DEFAULT_PROJECT_SETTINGS,
    DEFAULT_VISUAL_STYLE,
    EMPTY_DRAMA_MODEL_PROFILES,
    createDefaultDramaStepStates,
    type StudioAsset,
    type StudioAssetKind,
    type StudioEpisode,
    type StudioMediaStatus,
    type StudioMediaVersion,
    type StudioProject,
    type StudioScene,
    type StudioShot,
} from "@/types/studio";

import { createMediaVersion, defaultShot, nowIso } from "./factory";

// 旧版「一集一序列」迁移成「项目 + 集」，旧 store 原样保留，不删除、不改写。
// 迁移只做结构映射，不重新生成任何素材，也不覆盖用户已经确认的图片/视频/音频。

const OLD_STATUS_MAP: Record<string, StudioMediaStatus> = {
    pending: "idle",
    running: "idle",
    done: "succeeded",
    failed: "failed",
};

function mediaStatus(sequence: DramaSequence, shot: DramaShot, kind: "image" | "video" | "audio"): StudioMediaStatus {
    const state = shot.generation?.[kind];
    if (state?.stale) return "stale";
    if (state?.status) return OLD_STATUS_MAP[state.status] ?? "idle";
    if (kind === "image") {
        if (shot.imageRef) return "succeeded";
        return OLD_STATUS_MAP[shot.status] ?? "idle";
    }
    if (kind === "video") return shot.videoRef ? "succeeded" : "idle";
    return shot.audioRef ? "succeeded" : "idle";
}

function assetKindOf(asset: DramaAsset): StudioAssetKind {
    if (asset.kind === "character" || asset.kind === "scene" || asset.kind === "costume" || asset.kind === "prop") return asset.kind;
    // 旧版的特效 / 其他统一落到道具资产，避免迁移丢条目。
    return "prop";
}

function versionOf(item: DramaMediaVersion, fallbackModel?: string): StudioMediaVersion {
    return {
        id: `legacy-ver-${item.storageKey}`,
        storageKey: item.storageKey,
        model: item.model ?? fallbackModel,
        prompt: item.prompt,
        params: item.parameters,
        source: "migration",
        createdAt: item.createdAt || nowIso(),
    };
}

function mergeVersions(refs: string[], versions: DramaMediaVersion[] | undefined, fallbackModel?: string): StudioMediaVersion[] {
    const list = (versions ?? []).map((version) => versionOf(version, fallbackModel));
    const keys = new Set(list.map((version) => version.storageKey));
    for (const ref of refs.filter(Boolean)) {
        if (keys.has(ref)) continue;
        list.push(createMediaVersion({ storageKey: ref, model: fallbackModel, source: "migration" }));
        keys.add(ref);
    }
    return list;
}

function migrateAsset(sequence: DramaSequence, asset: DramaAsset): StudioAsset {
    const kind = assetKindOf(asset);
    const versions = mergeVersions(asset.refs, asset.versions, asset.model);
    const official = asset.refs.find(Boolean) ?? versions[0]?.storageKey;
    return {
        id: asset.id,
        kind,
        name: asset.name,
        role: "",
        description: asset.description,
        age: "",
        face: "",
        hair: "",
        body: "",
        costume: kind === "costume" ? asset.description : "",
        layout: "",
        environment: kind === "scene" ? asset.description : "",
        timeOfDay: "",
        weather: "",
        lighting: "",
        material: "",
        officialRef: official,
        versions,
        voiceId: sequence.voices?.[asset.id],
        audioSampleRef: asset.audioRef,
        createdAt: sequence.createdAt,
        updatedAt: sequence.updatedAt,
    };
}

function legacyLight(value: string): string {
    if (value === "left") return "左侧主光";
    if (value === "right") return "右侧主光";
    return "无主光";
}

export function migrateLegacySequence(sequence: DramaSequence): StudioProject {
    const episodes = [migrateEpisode(sequence)];
    const settings = {
        ...DEFAULT_PROJECT_SETTINGS,
        textModel: sequence.settings?.textModel ?? "",
        imageModel: sequence.settings?.imageModel ?? "",
        videoModel: sequence.settings?.videoModel ?? "",
        audioModel: sequence.settings?.audioModel ?? "",
        style: sequence.settings?.style ?? "自动",
        imageRatio: sequence.settings?.ratio ?? DEFAULT_PROJECT_SETTINGS.imageRatio,
        imageQuality: sequence.settings?.assetQuality ?? "自动",
        videoRatio: sequence.settings?.videoRatio ?? DEFAULT_PROJECT_SETTINGS.videoRatio,
        videoQuality: sequence.settings?.videoQuality ?? "自动",
        videoSeconds: sequence.settings?.videoSeconds ?? "自动",
        targetSeconds: sequence.targetSeconds || 60,
        lens: sequence.settings?.lens ?? DEFAULT_PROJECT_SETTINGS.lens,
        aperture: sequence.settings?.aperture ?? DEFAULT_PROJECT_SETTINGS.aperture,
        keyLight: sequence.settings?.keyLight ?? DEFAULT_PROJECT_SETTINGS.keyLight,
        fillLight: sequence.settings?.fillLight ?? DEFAULT_PROJECT_SETTINGS.fillLight,
        composition: sequence.settings?.composition ?? DEFAULT_PROJECT_SETTINGS.composition,
        narratorVoice: sequence.voices?.["narration"] ?? "",
    };
    const bible = sequence.bible;
    return {
        id: `legacy-${sequence.id}`,
        title: sequence.title,
        logline: sequence.script?.premise ?? "",
        genre: sequence.script?.genre ?? "",
        legacySequenceId: sequence.id,
        settings,
        bible: {
            logline: sequence.script?.premise ?? "",
            synopsis: sequence.script?.outline ?? "",
            world: bible?.world ?? "",
            background: bible?.background ?? "",
            mainPlot: sequence.script?.outline ?? "",
            conflict: sequence.script?.direction ?? "",
            ending: "",
            relations: bible?.relations ?? "",
            characters: sequence.assets
                .filter((asset) => asset.kind === "character")
                .map((asset) => ({ name: asset.name, role: "", description: asset.description })),
        },
        visualStyle: {
            ...DEFAULT_VISUAL_STYLE,
            mainStyle: settings.style !== "自动" ? settings.style : DEFAULT_VISUAL_STYLE.mainStyle,
            palette: bible?.palette || DEFAULT_VISUAL_STYLE.palette,
            material: bible?.material || DEFAULT_VISUAL_STYLE.material,
            negative: bible?.negative || DEFAULT_VISUAL_STYLE.negative,
            consistency: bible?.visual || DEFAULT_VISUAL_STYLE.consistency,
        },
        assets: sequence.assets.map((asset) => migrateAsset(sequence, asset)),
        episodes,
        workflowMode: "all",
        automationMode: "auto",
        adaptationMode: "adapt",
        projectStatus: "draft",
        // 旧项目没有小说分析；从原有剧本继续，不强制重走第一步。
        currentStep: "script",
        stepStates: createDefaultDramaStepStates(),
        modelProfiles: { ...EMPTY_DRAMA_MODEL_PROFILES, selected: {}, paramsByKey: {} },
        createdAt: sequence.createdAt,
        updatedAt: sequence.updatedAt,
    };
}

function migrateEpisode(sequence: DramaSequence): StudioEpisode {
    const sceneMap = new Map<string, StudioScene>();
    const shots: StudioShot[] = sequence.shots.map((shot) => {
        const sceneName = shot.scene.trim() || "未标场景";
        let scene = sceneMap.get(sceneName);
        if (!scene) {
            scene = {
                id: `legacy-scene-${sequence.id}-${sceneMap.size + 1}`,
                no: String(sceneMap.size + 1).padStart(2, "0"),
                name: sceneName,
                location: shot.location ?? "",
                description: "",
                timeOfDay: "",
                weather: "",
            };
            sceneMap.set(sceneName, scene);
        }
        const isNarration = shot.speaker === "旁白";
        const base = defaultShot(`legacy-ep-${sequence.id}`, scene.id, shot.no);
        const imageVersions = mergeVersions([shot.imageRef ?? ""].filter(Boolean), shot.imageVersions);
        const videoVersions = mergeVersions([shot.videoRef ?? ""].filter(Boolean), shot.videoVersions);
        const audioVersions = mergeVersions([shot.audioRef ?? ""].filter(Boolean), shot.audioVersions);
        return {
            ...base,
            id: shot.id,
            episodeId: `legacy-ep-${sequence.id}`,
            sceneId: scene.id,
            no: shot.no,
            sceneName: scene.name,
            description: shot.prompt,
            characterNames: shot.characters ?? [],
            assetIds: shot.assetIds ?? [],
            action: shot.action ?? "",
            expression: shot.expression ?? "",
            position: "",
            orientation: "",
            environment: shot.location ?? "",
            size: shot.size,
            camera: shot.camera ?? "平视",
            lens: shot.lens ?? sequence.settings?.lens ?? "自动",
            movement: shot.move,
            composition: shot.composition ?? sequence.settings?.composition ?? "三分构图",
            lighting: legacyLight(shot.light),
            effects: "",
            line: isNarration ? "" : shot.line,
            speaker: isNarration ? "" : shot.speaker ?? "",
            narration: isNarration ? shot.line : "",
            ambience: shot.sound ?? "",
            sfx: "",
            seconds: shot.seconds,
            locked: false,
            approved: shot.approved,
            imageStatus: mediaStatus(sequence, shot, "image"),
            videoStatus: mediaStatus(sequence, shot, "video"),
            audioStatus: mediaStatus(sequence, shot, "audio"),
            narrationStatus: "idle",
            sfxStatus: "idle",
            imageRef: shot.imageRef,
            videoRef: shot.videoRef,
            audioRef: shot.audioRef,
            imageVersions,
            videoVersions,
            audioVersions,
            narrationVersions: [],
            sfxVersions: [],
            imagePrompt: shot.imagePrompt,
            videoPrompt: shot.videoPrompt,
            imageModel: sequence.settings?.imageModel || undefined,
            videoModel: sequence.settings?.videoModel || undefined,
            audioModel: sequence.settings?.audioModel || undefined,
            imageRatio: sequence.settings?.ratio && sequence.settings.ratio !== "自动" ? sequence.settings.ratio : undefined,
            videoRatio: sequence.settings?.videoRatio && sequence.settings.videoRatio !== "自动" ? sequence.settings.videoRatio : undefined,
            videoSeconds: sequence.settings?.videoSeconds && sequence.settings.videoSeconds !== "自动" ? sequence.settings.videoSeconds : undefined,
            videoRemote: shot.generation?.video?.remote
                ? {
                      taskId: shot.generation.video.remote.taskId,
                      provider: shot.generation.video.remote.provider,
                      model: shot.generation.video.remote.model,
                      prompt: shot.generation.video.remote.prompt,
                      params: shot.generation.video.remote.params,
                      createdAt: shot.generation.video.remote.createdAt,
                  }
                : undefined,
            workflowNodeId: shot.nodeId,
        };
    });

    const text = sequence.script?.text ?? "";
    const script = {
        premise: sequence.script?.premise ?? "",
        genre: sequence.script?.genre ?? "",
        type: "",
        audience: "",
        direction: sequence.script?.direction ?? "",
        conflict: "",
        constraints: sequence.script?.requirement ?? "",
        referenceFiles: sequence.script?.fileName ? [{ id: `legacy-file-${sequence.id}`, name: sequence.script.fileName }] : [],
        outline: sequence.script?.outline ?? "",
        outlineVersions: [],
        text,
        versions: text ? [{ id: `legacy-script-${sequence.id}`, text, createdAt: sequence.createdAt, note: "迁移自旧版剧本" }] : [],
        source: sequence.script?.source ?? ((text ? "paste" : "none") as StudioEpisode["script"]["source"]),
        fileName: sequence.script?.fileName,
        confirmedAt: text ? sequence.updatedAt : undefined,
    };

    return {
        id: `legacy-ep-${sequence.id}`,
        no: 1,
        title: sequence.title || "第 1 集",
        targetSeconds: sequence.targetSeconds || 60,
        coreEvent: "",
        mainConflict: "",
        continuity: "",
        hook: "",
        script,
        scenes: [...sceneMap.values()],
        shots,
        workflowProjectId: sequence.projectId,
        createdAt: sequence.createdAt,
        updatedAt: sequence.updatedAt,
    };
}

/** 旧 store 里可能有多条序列，一条序列对应一个新项目。 */
export function migrateLegacySequences(sequences: DramaSequence[] = []): StudioProject[] {
    return sequences.map((sequence) => migrateLegacySequence(sequence));
}
