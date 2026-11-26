// Stage 3 结构化输出解析与稳定 ID 映射。
// 模型只能提供名字与文本；characterId / locationId / propId / shotId 由本地映射稳定生成，不能由模型随意发明。

import { simpleHash } from "./novel-chapters";
import type { StudioAdaptationChange, StudioAdaptationSourceReference, StudioEpisodePlan } from "@/types/studio-adaptation";
import type {
    StudioProductionAssetIndex,
    StudioProductionRawScript,
    StudioProductionRawScriptScene,
    StudioProductionRawStoryboard,
    StudioProductionRawShot,
    StudioProductionRawShotGroup,
    StudioScriptDocument,
    StudioScriptDialogueBlock,
    StudioScriptScene,
    StudioShotDialogueLine,
    StudioShotGroup,
    StudioStoryboardDocument,
    StudioProductionShot,
} from "@/types/studio-production";
import { calibrateStoryboardDurations, estimateSceneDuration, estimateScriptDuration, renumberStoryboardShots } from "./production-engine";

const nowIso = () => new Date().toISOString();

export function parseProductionJson<T>(text: string, rootKey: string): T {
    const cleaned = text.replace(/```(?:json)?/gi, "").replace(/^\uFEFF/, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last <= first) throw new Error("模型没有返回有效 JSON：可能被截断或为空");
    const candidate = cleaned.slice(first, last + 1);
    let parsed: unknown;
    try {
        parsed = JSON.parse(candidate);
    } catch {
        throw new Error("模型返回 JSON 截断或不完整；未写入半成品，请重试当前集/场景");
    }
    if (!parsed || typeof parsed !== "object") throw new Error("模型返回的 JSON 不是对象");
    const record = parsed as Record<string, unknown>;
    if (rootKey && !Array.isArray(record[rootKey])) throw new Error(`模型返回缺少 ${rootKey} 数组`);
    return record as T;
}

function str(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function nameKey(value: string) {
    return value.replace(/\s+/g, "").replace(/[·•:：\-—_]/g, "").toLowerCase();
}

function matchByName<T extends { name: string }>(items: T[], name: string): T | undefined {
    const key = nameKey(name);
    if (!key) return undefined;
    return items.find((item) => nameKey(item.name) === key) ?? items.find((item) => nameKey(item.name).includes(key) || key.includes(nameKey(item.name)));
}

function stableId(prefix: string, ...parts: (string | number)[]) {
    return `${prefix}-${simpleHash(parts.map(String).join("|"))}`;
}

function emptySource(): StudioAdaptationSourceReference {
    return { chapterIds: [], eventIds: [], sceneIds: [], foreshadowingIds: [], evidence: [] };
}

function mergeSource(...sources: (StudioAdaptationSourceReference | undefined)[]): StudioAdaptationSourceReference {
    const out = emptySource();
    for (const source of sources) {
        if (!source) continue;
        out.chapterIds.push(...(source.chapterIds ?? []));
        out.eventIds.push(...(source.eventIds ?? []));
        out.sceneIds.push(...(source.sceneIds ?? []));
        out.foreshadowingIds.push(...(source.foreshadowingIds ?? []));
        out.evidence.push(...(source.evidence ?? []));
    }
    out.chapterIds = [...new Set(out.chapterIds)];
    out.eventIds = [...new Set(out.eventIds)];
    out.sceneIds = [...new Set(out.sceneIds)];
    out.foreshadowingIds = [...new Set(out.foreshadowingIds)];
    return out;
}

function mapCharacter(index: StudioProductionAssetIndex, plan: StudioEpisodePlan, name: string, projectId: string) {
    const exact = matchByName(index.characters, name);
    if (exact) return exact;
    const planRef = plan.characterAppearances.find((item) => nameKey(item.name) === nameKey(name));
    if (planRef) {
        return {
            characterId: planRef.characterId,
            name: planRef.name,
            role: planRef.role,
            look: planRef.summary,
            costume: "",
        };
    }
    const state = plan.characterStates.find((item) => nameKey(item.name) === nameKey(name));
    if (state) {
        return {
            characterId: state.characterId,
            name: state.name,
            role: "",
            look: state.physicalState,
            costume: "",
        };
    }
    return { characterId: stableId("char", projectId, name), name, role: "", look: "", costume: "" };
}

function mapLocation(index: StudioProductionAssetIndex, plan: StudioEpisodePlan, name: string, projectId: string) {
    const exact = matchByName(index.locations, name);
    if (exact) return exact;
    const planRef = plan.locations.find((item) => nameKey(item.name) === nameKey(name));
    if (planRef) {
        return {
            locationId: planRef.sceneId,
            name: planRef.name,
            description: planRef.purpose,
            variantIds: [],
        };
    }
    return { locationId: stableId("loc", projectId, name), name, description: "", variantIds: [] };
}

function mapProp(index: StudioProductionAssetIndex, plan: StudioEpisodePlan, name: string, projectId: string) {
    const exact = matchByName(index.props, name);
    if (exact) return exact;
    return { propId: stableId("prop", projectId, name), name, state: "", important: false };
}

export function normalizeScriptDocument(
    raw: StudioProductionRawScript,
    context: {
        projectId: string;
        episodeId: string;
        episodeNumber: number;
        targetSeconds: number;
        plan: StudioEpisodePlan;
        blueprintVersion: number;
        handoffSnapshotId: string;
        assetIndex: StudioProductionAssetIndex;
        changes: StudioAdaptationChange[];
        existing?: StudioScriptDocument;
        sceneNumberOverride?: number;
        existingSceneId?: string;
    },
): StudioScriptDocument {
    if (!raw || !Array.isArray(raw.scenes) || !raw.scenes.length) throw new Error("模型返回没有场景，未写入剧本");
    const now = nowIso();
    const characterPool: StudioScriptDocument["characterBindings"] = [];
    const locationPool: StudioScriptDocument["locationBindings"] = [];
    const propPool: StudioScriptDocument["propBindings"] = [];
    const scenes: StudioScriptScene[] = raw.scenes.map((rawScene, index) => {
        const location = mapLocation(context.assetIndex, context.plan, rawScene.locationName, context.projectId);
        const variantId = rawScene.locationVariant?.trim() || stableId("variant", location.locationId, rawScene.timeOfDay || "日");
        const sceneNumber = context.sceneNumberOverride ?? index + 1;
        const sceneId = context.existingSceneId ?? context.existing?.scenes.find((scene) => scene.sceneNumber === sceneNumber)?.sceneId ?? stableId("scene", context.episodeId, sceneNumber, rawScene.sceneTitle, location.locationId);
        const characters = (rawScene.charactersPresent ?? []).map((name) => mapCharacter(context.assetIndex, context.plan, name, context.projectId));
        const propMap = new Map<string, ReturnType<typeof mapProp>>();
        for (const name of rawScene.props ?? []) {
            const prop = mapProp(context.assetIndex, context.plan, name, context.projectId);
            propMap.set(prop.propId, prop);
        }
        for (const character of characters) {
            if (!characterPool.some((item) => item.characterId === character.characterId)) {
                characterPool.push({ ...character, sceneIds: [] });
            }
            const entry = characterPool.find((item) => item.characterId === character.characterId)!;
            if (!entry.sceneIds.includes(sceneId)) entry.sceneIds.push(sceneId);
        }
        if (!locationPool.some((item) => item.locationId === location.locationId && item.variantId === variantId)) {
            locationPool.push({
                locationId: location.locationId,
                name: location.name,
                variantId,
                timeOfDay: rawScene.timeOfDay,
                weather: "",
                description: location.description || rawScene.environment,
                sceneIds: [],
            });
        }
        const entry = locationPool.find((item) => item.locationId === location.locationId && item.variantId === variantId)!;
        if (!entry.sceneIds.includes(sceneId)) entry.sceneIds.push(sceneId);
        for (const prop of propMap.values()) {
            let propEntry = propPool.find((item) => item.propId === prop.propId);
            if (!propEntry) {
                propEntry = {
                    propId: prop.propId,
                    name: prop.name,
                    holderCharacterId: characters[0]?.characterId ?? "",
                    locationId: location.locationId,
                    state: prop.state,
                    important: prop.important,
                    sceneIds: [],
                };
                propPool.push(propEntry);
            }
            if (!propEntry.sceneIds.includes(sceneId)) propEntry.sceneIds.push(sceneId);
        }
        const dialogueBlocks: StudioScriptDialogueBlock[] = (rawScene.dialogueBlocks ?? [])
            .filter((block) => str(block.text))
            .map((block, dialogueIndex) => {
                const character = mapCharacter(context.assetIndex, context.plan, block.speaker, context.projectId);
                return {
                    dialogueId: stableId("dlg", sceneId, dialogueIndex, block.speaker, block.text.slice(0, 24)),
                    characterId: character.characterId,
                    speaker: character.name,
                    text: str(block.text),
                    delivery: str(block.delivery),
                    emotion: str(block.emotion),
                    subtext: str(block.subtext),
                    linkedAction: str(block.linkedAction),
                    timing: str(block.timing),
                    sourceReference: undefined,
                };
            });
        return {
            sceneId,
            sceneNumber,
            sceneTitle: str(rawScene.sceneTitle) || `${location.name} · ${str(rawScene.timeOfDay)}`,
            locationId: location.locationId,
            locationVariantId: variantId,
            timeOfDay: str(rawScene.timeOfDay),
            environment: str(rawScene.environment),
            charactersPresent: [...new Set(characters.map((character) => character.characterId))],
            props: [...new Set([...propMap.keys()])],
            scenePurpose: str(rawScene.scenePurpose),
            conflict: str(rawScene.conflict),
            action: str(rawScene.action),
            dialogueBlocks,
            transitionIn: str(rawScene.transitionIn),
            transitionOut: str(rawScene.transitionOut),
            continuityNotes: str(rawScene.continuityNotes),
        };
    });
    const targetSeconds = Number(context.targetSeconds) || 60;
    const estimate = estimateScriptDuration(scenes, targetSeconds);
    return {
        id: context.existing?.id ?? stableId("script", context.episodeId, context.handoffSnapshotId),
        episodeId: context.episodeId,
        episodeNumber: context.episodeNumber,
        title: str(raw.title) || context.plan.episodeTitle,
        logline: str(raw.logline) || context.plan.episodeLogline,
        synopsis: str(raw.synopsis) || context.plan.episodeSynopsis,
        durationTarget: targetSeconds,
        durationEstimate: estimate,
        sourceEpisodePlanId: context.plan.episodeId,
        sourceBlueprintVersion: context.blueprintVersion,
        sourceHandoffId: context.handoffSnapshotId,
        scriptVersion: (context.existing?.scriptVersion ?? 0) + 1,
        status: "draft",
        scenes,
        characterBindings: characterPool,
        locationBindings: locationPool,
        propBindings: propPool,
        sourceReferences: mergeSource(context.plan.sourceReferences),
        continuityDependencies: [...context.plan.continuityDependencies],
        adaptationChanges: context.changes.filter((change) => change.episodeNumbers.includes(context.episodeNumber) || !change.episodeNumbers.length),
        createdAt: context.existing?.createdAt ?? now,
        updatedAt: now,
    };
    // createdAt 由现有文档保留；新文档必须新建时间戳，这里放在上方对象字面量中。
}

function normalizeRawScene(raw: StudioProductionRawScriptScene): StudioProductionRawScriptScene {
    return {
        sceneTitle: str(raw.sceneTitle),
        locationName: str(raw.locationName),
        locationVariant: str(raw.locationVariant),
        timeOfDay: str(raw.timeOfDay),
        environment: str(raw.environment),
        charactersPresent: Array.isArray(raw.charactersPresent) ? raw.charactersPresent.map(String) : [],
        props: Array.isArray(raw.props) ? raw.props.map(String) : [],
        scenePurpose: str(raw.scenePurpose),
        conflict: str(raw.conflict),
        action: str(raw.action),
        dialogueBlocks: Array.isArray(raw.dialogueBlocks) ? raw.dialogueBlocks.map((block) => ({ speaker: str(block.speaker), text: str(block.text), delivery: str(block.delivery), emotion: str(block.emotion), subtext: str(block.subtext), linkedAction: str(block.linkedAction), timing: str(block.timing) })) : [],
        transitionIn: str(raw.transitionIn),
        transitionOut: str(raw.transitionOut),
        continuityNotes: str(raw.continuityNotes),
    };
}

export function normalizeSingleScriptScene(raw: StudioProductionRawScriptScene, context: Parameters<typeof normalizeScriptDocument>[1], sceneNumber: number, existingSceneId?: string): StudioScriptScene {
    const single: StudioProductionRawScript = { title: context.existing?.title ?? "", logline: "", synopsis: "", scenes: [{ ...normalizeRawScene(raw), sceneTitle: raw.sceneTitle || `场景 ${sceneNumber}` }] };
    const doc = normalizeScriptDocument(single, { ...context, sceneNumberOverride: sceneNumber, existingSceneId });
    return doc.scenes[0]!;
}

/** 分镜严格按场景生成：一个场景一组或多组，模型不能给整集镜头后让本地硬切。 */
export function normalizeStoryboardScene(
    raw: StudioProductionRawStoryboard,
    context: {
        projectId: string;
        episodeId: string;
        episodeNumber: number;
        script: StudioScriptDocument;
        scene: StudioScriptScene;
        assetIndex: StudioProductionAssetIndex;
        plan: StudioEpisodePlan;
        changes: StudioAdaptationChange[];
        existing?: StudioStoryboardDocument;
        groupNumberBase?: number;
    },
): { groups: StudioShotGroup[]; shots: StudioProductionShot[]; calibration: ReturnType<typeof calibrateStoryboardDurations> } {
    if (!raw || !Array.isArray(raw.groups) || !raw.groups.length) throw new Error("模型没有返回镜头组，未写入分镜");
    const now = nowIso();
    const groups: StudioShotGroup[] = [];
    const shots: StudioProductionShot[] = [];
    let shotNumber = 0;
    raw.groups.forEach((rawGroup, groupIndex) => {
        const groupNumber = Number(rawGroup.groupNumber) || (context.groupNumberBase ?? 0) + groupIndex + 1;
        const shotGroupId = stableId("sg", context.episodeId, context.scene.sceneId, groupNumber);
        const startCharacters = (rawGroup.characterStartPositions ?? []).map((position) => {
            const character = mapCharacter(context.assetIndex, context.plan, position.name, context.projectId);
            return { characterId: character.characterId, name: character.name, position: str(position.position), orientation: str(position.orientation), eyeline: str(position.eyeline) };
        });
        const rawShots = Array.isArray(rawGroup.shots) ? rawGroup.shots : [];
        const shotIds: string[] = [];
        rawShots.forEach((rawShot, shotIndex) => {
            shotNumber += 1;
            const shotId = stableId("shot", context.episodeId, context.scene.sceneId, groupNumber, shotNumber);
            const characters = context.scene.charactersPresent.map((characterId) => {
                const binding = context.script.characterBindings.find((item) => item.characterId === characterId);
                return { characterId, name: binding?.name ?? characterId, outfitId: undefined };
            });
            const shot = normalizeRawShot(rawShot, {
                shotId,
                shotNumber,
                groupId: shotGroupId,
                episodeId: context.episodeId,
                scene: context.scene,
                script: context.script,
                characters,
                propBindings: context.scene.props.map((propId) => {
                    const binding = context.script.propBindings.find((item) => item.propId === propId);
                    return { propId, name: binding?.name ?? propId, state: binding?.state ?? "" };
                }),
                sourceReferences: mergeSource(context.scene.dialogueBlocks.find((block) => block.sourceReference)?.sourceReference, context.plan.sourceReferences),
            });
            shots.push(shot);
            shotIds.push(shotId);
        });
        groups.push({
            shotGroupId,
            episodeId: context.episodeId,
            sceneId: context.scene.sceneId,
            groupNumber,
            sceneTitle: context.scene.sceneTitle,
            sharedLayout: str(rawGroup.sharedLayout) || context.scene.environment,
            characterStartPositions: startCharacters,
            cameraAxis: str(rawGroup.cameraAxis),
            propStates: str(rawGroup.propStates),
            timeOfDay: str(rawGroup.timeOfDay) || context.scene.timeOfDay,
            lighting: str(rawGroup.lighting),
            weather: str(rawGroup.weather),
            continuityRules: Array.isArray(rawGroup.continuityRules) ? rawGroup.continuityRules.map(String) : [],
            shotIds,
            reviewedByUser: false,
            createdAt: now,
            updatedAt: now,
        });
    });
    const calibration = calibrateStoryboardDurations(shots, estimateSceneDuration(context.scene));
    return { groups, shots: calibration.shots, calibration };
}

function normalizeRawShot(
    raw: StudioProductionRawShot,
    context: {
        shotId: string;
        shotNumber: number;
        groupId: string;
        episodeId: string;
        scene: StudioScriptScene;
        script: StudioScriptDocument;
        characters: { characterId: string; name: string; outfitId?: string }[];
        propBindings: { propId: string; name: string; state: string }[];
        sourceReferences: StudioAdaptationSourceReference;
    },
): StudioProductionShot {
    const now = nowIso();
    const dialogue: StudioShotDialogueLine[] = (raw.dialogue ?? []).map((line) => {
        const binding = context.script.characterBindings.find((item) => nameKey(item.name) === nameKey(line.speaker));
        return {
            characterId: binding?.characterId ?? context.characters.find((item) => nameKey(item.name) === nameKey(line.speaker))?.characterId ?? "",
            speaker: binding?.name ?? str(line.speaker),
            text: str(line.text),
            delivery: str(line.delivery),
            emotion: str(line.emotion),
        };
    });
    const requestedCharacters = Array.isArray(raw.charactersPresent) ? raw.charactersPresent.map((name) => str(name)).filter(Boolean) : null;
    const shotCharacters = requestedCharacters === null
        ? context.characters
        : requestedCharacters.map((name) => context.characters.find((item) => nameKey(item.name) === nameKey(name))).filter((item): item is { characterId: string; name: string; outfitId?: string } => Boolean(item));
    const requestedProps = Array.isArray(raw.props) ? raw.props.map((name) => str(name)).filter(Boolean) : null;
    const shotProps = requestedProps === null
        ? context.propBindings
        : requestedProps.map((name) => context.propBindings.find((item) => nameKey(item.name) === nameKey(name))).filter((item): item is { propId: string; name: string; state: string } => Boolean(item));
    return {
        shotId: context.shotId,
        episodeId: context.episodeId,
        sceneId: context.scene.sceneId,
        shotGroupId: context.groupId,
        shotNumber: context.shotNumber,
        duration: Math.max(1, Math.min(30, Number(raw.duration) || 4)),
        shotSize: str(raw.shotSize),
        cameraPosition: str(raw.cameraPosition),
        cameraAngle: str(raw.cameraAngle),
        lens: str(raw.lens),
        cameraMovement: str(raw.cameraMovement),
        composition: str(raw.composition),
        foreground: str(raw.foreground),
        midground: str(raw.midground),
        background: str(raw.background),
        characterBlocking: str(raw.characterBlocking),
        eyeline: str(raw.eyeline),
        action: str(raw.action),
        facialExpression: str(raw.facialExpression),
        emotion: str(raw.emotion),
        dialogue,
        voiceOver: str(raw.voiceOver),
        soundEffects: str(raw.soundEffects),
        backgroundMusic: str(raw.backgroundMusic),
        lighting: str(raw.lighting),
        environment: str(raw.environment),
        continuityRules: Array.isArray(raw.continuityRules) ? raw.continuityRules.map(String) : [],
        characterBindings: shotCharacters,
        outfitBindings: [],
        sceneBindings: { locationId: context.scene.locationId, locationVariantId: context.scene.locationVariantId },
        propBindings: shotProps,
        sourceReferences: context.sourceReferences,
        sourceScriptSceneId: context.scene.sceneId,
        imagePrompt: str(raw.imagePrompt),
        videoPrompt: str(raw.videoPrompt),
        keyframeRefs: [],
        status: "draft",
        version: 1,
        locked: false,
        createdAt: now,
        updatedAt: now,
    };
}

export function replaceSceneInStoryboard(
    existing: StudioStoryboardDocument | undefined,
    input: {
        episodeId: string;
        episodeNumber: number;
        script: StudioScriptDocument;
        sceneId: string;
        groups: StudioShotGroup[];
        shots: StudioProductionShot[];
        reason: string;
        /** 整集按场生成时先不递增，最后统一提交一次正式版本。 */
        incrementVersion?: boolean;
    },
): StudioStoryboardDocument {
    const now = nowIso();
    const incrementVersion = input.incrementVersion !== false;
    if (!existing) {
        return {
            id: stableId("storyboard", input.episodeId, input.script.id),
            episodeId: input.episodeId,
            episodeNumber: input.episodeNumber,
            sourceScriptId: input.script.id,
            sourceScriptVersion: input.script.scriptVersion,
            sourceEpisodePlanId: input.script.sourceEpisodePlanId,
            sourceBlueprintVersion: input.script.sourceBlueprintVersion,
            sourceHandoffId: input.script.sourceHandoffId,
            storyboardVersion: 1,
            status: "draft",
            groups: input.groups,
            shots: renumberStoryboardShots({ groups: input.groups, shots: input.shots } as StudioStoryboardDocument).shots,
            checks: [],
            sourceSceneVersions: { [input.sceneId]: input.script.sceneVersions?.[input.sceneId] ?? 0 },
            createdAt: now,
            updatedAt: now,
        };
    }
    const groupIds = new Set(input.groups.map((group) => group.shotGroupId));
    const shots = [...existing.shots.filter((shot) => shot.sceneId !== input.sceneId || shot.locked), ...input.shots];
    const groups = [...existing.groups.filter((group) => group.sceneId !== input.sceneId), ...input.groups].map((group) => {
        const shotIds = shots.filter((shot) => shot.shotGroupId === group.shotGroupId).map((shot) => shot.shotId);
        return groupIds.has(group.shotGroupId) || shotIds.length ? { ...group, shotIds } : group;
    });
    const sceneOrder = new Map(input.script.scenes.map((scene, index) => [scene.sceneId, index]));
    const orderedGroups = [...groups].sort((left, right) => (sceneOrder.get(left.sceneId) ?? 999) - (sceneOrder.get(right.sceneId) ?? 999) || left.groupNumber - right.groupNumber);
    return renumberStoryboardShots({
        ...existing,
        sourceScriptId: input.script.id,
        sourceScriptVersion: input.script.scriptVersion,
        sourceEpisodePlanId: input.script.sourceEpisodePlanId,
        sourceBlueprintVersion: input.script.sourceBlueprintVersion,
        sourceHandoffId: input.script.sourceHandoffId,
        storyboardVersion: incrementVersion ? (existing.storyboardVersion ?? 0) + 1 : existing.storyboardVersion,
        groups: orderedGroups,
        shots,
        sourceSceneVersions: { ...(existing.sourceSceneVersions ?? {}), [input.sceneId]: input.script.sceneVersions?.[input.sceneId] ?? 0 },
        updatedAt: now,
    });
}

export function replaceShotInStoryboard(existing: StudioStoryboardDocument, shot: StudioProductionShot, reason: string, incrementVersion = true): StudioStoryboardDocument {
    return {
        ...existing,
        storyboardVersion: incrementVersion ? existing.storyboardVersion + 1 : existing.storyboardVersion,
        shots: existing.shots.map((item) => (item.shotId === shot.shotId ? { ...shot, version: item.version + 1, updatedAt: nowIso() } : item)),
        updatedAt: nowIso(),
        checks: [],
    };
}

export function normalizeShotReplacement(
    raw: StudioProductionRawShot,
    existing: StudioProductionShot,
    script: StudioScriptDocument,
    scene: StudioScriptScene,
): StudioProductionShot {
    const shot = normalizeRawShot(raw, {
        shotId: existing.shotId,
        shotNumber: existing.shotNumber,
        groupId: existing.shotGroupId,
        episodeId: existing.episodeId,
        scene,
        script,
        characters: existing.characterBindings,
        propBindings: existing.propBindings,
        sourceReferences: existing.sourceReferences,
    });
    return {
        ...shot,
        version: existing.version + 1,
        locked: existing.locked,
        status: existing.status,
        createdAt: existing.createdAt,
    };
}

/** 局部重写单场：保留其他场景和已有绑定，只替换目标场景并重算时长。 */
export function mergeSceneIntoScript(existing: StudioScriptDocument, scene: StudioScriptScene): StudioScriptDocument {
    const scenes = existing.scenes.map((item) => (item.sceneId === scene.sceneId ? scene : item));
    const characterBindings = [...existing.characterBindings];
    for (const characterId of scene.charactersPresent) {
        if (!characterBindings.some((binding) => binding.characterId === characterId)) {
            characterBindings.push({ characterId, name: characterId, role: "", costume: "", look: "", sceneIds: [scene.sceneId] });
        }
    }
    const locationBindings = [...existing.locationBindings];
    if (!locationBindings.some((binding) => binding.locationId === scene.locationId && binding.variantId === scene.locationVariantId)) {
        locationBindings.push({
            locationId: scene.locationId,
            name: scene.locationId,
            variantId: scene.locationVariantId,
            timeOfDay: scene.timeOfDay,
            weather: "",
            description: scene.environment,
            sceneIds: [scene.sceneId],
        });
    }
    const propBindings = [...existing.propBindings];
    for (const propId of scene.props) {
        if (!propBindings.some((binding) => binding.propId === propId)) {
            propBindings.push({ propId, name: propId, holderCharacterId: scene.charactersPresent[0] ?? "", locationId: scene.locationId, state: "", important: false, sceneIds: [scene.sceneId] });
        }
    }
    return {
        ...existing,
        scenes,
        characterBindings,
        locationBindings,
        propBindings,
        durationEstimate: estimateScriptDuration(scenes, existing.durationTarget),
        scriptVersion: existing.scriptVersion + 1,
        status: "draft",
        updatedAt: nowIso(),
    };
}

/** 只替换目标场对白，保留该场动作、环境、人物、道具和其他场景。 */
export function mergeDialogueIntoScript(existing: StudioScriptDocument, sceneId: string, dialogueBlocks: StudioScriptDocument["scenes"][number]["dialogueBlocks"]): StudioScriptDocument {
    const scenes = existing.scenes.map((scene) => (scene.sceneId === sceneId ? { ...scene, dialogueBlocks } : scene));
    return {
        ...existing,
        scenes,
        durationEstimate: estimateScriptDuration(scenes, existing.durationTarget),
        scriptVersion: existing.scriptVersion + 1,
        status: "draft",
        updatedAt: nowIso(),
    };
}

export function normalizeDialogueReplacement(
    rawScene: StudioProductionRawScriptScene,
    context: Parameters<typeof normalizeScriptDocument>[1],
    scene: StudioScriptScene,
): StudioScriptScene["dialogueBlocks"] {
    const normalized = normalizeSingleScriptScene(
        {
            sceneTitle: scene.sceneTitle,
            locationName: scene.locationId,
            locationVariant: scene.locationVariantId,
            timeOfDay: scene.timeOfDay,
            environment: scene.environment,
            charactersPresent: scene.charactersPresent,
            props: scene.props,
            scenePurpose: scene.scenePurpose,
            conflict: scene.conflict,
            action: scene.action,
            dialogueBlocks: Array.isArray(rawScene.dialogueBlocks) ? rawScene.dialogueBlocks : [],
            transitionIn: scene.transitionIn,
            transitionOut: scene.transitionOut,
            continuityNotes: scene.continuityNotes,
        },
        context,
        scene.sceneNumber,
        scene.sceneId,
    );
    return normalized.dialogueBlocks;
}


