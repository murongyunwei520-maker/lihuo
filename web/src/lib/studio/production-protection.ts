// Stage 3.2 剧本覆盖保护、场景版本与剧本→分镜 stale 依赖。
// 本文件只做纯计算；写入顺序和备份确认由 production-actions 负责。

import { simpleHash } from "./novel-chapters";
import type {
    StudioProductionSkipReason,
    StudioProductionSkipRecord,
    StudioScriptDocument,
    StudioScriptManualEditModule,
    StudioScriptScene,
    StudioStoryboardDocument,
} from "@/types/studio-production";

const nowIso = () => new Date().toISOString();

export type ScriptQueueCandidate = {
    episodeId: string;
    episodeNumber: number;
    episodeTitle: string;
    script?: StudioScriptDocument;
    hasPlan: boolean;
    draftAllowed: boolean;
};

export type ScriptQueuePlan = {
    queue: ScriptQueueCandidate[];
    skips: StudioProductionSkipRecord[];
};

function skipDetail(reason: StudioProductionSkipReason, script?: StudioScriptDocument) {
    if (reason === "locked") return `剧本 v${script?.scriptVersion ?? 0} 已锁定，普通队列不会覆盖`;
    if (reason === "manual_edited") return `剧本 v${script?.scriptVersion ?? 0} 含人工编辑，需显式确认才能覆盖`;
    if (reason === "existing_script") return `已有正式剧本 v${script?.scriptVersion ?? 0}，默认跳过`;
    if (reason === "admission_blocked") return "2B 准入未允许生成草稿";
    return "缺少当前集分集规划";
}

function skipRecord(candidate: ScriptQueueCandidate, reason: StudioProductionSkipReason): StudioProductionSkipRecord {
    return {
        id: `script-skip-${simpleHash(`${candidate.episodeId}:${reason}`)}`,
        kind: "script",
        episodeId: candidate.episodeId,
        episodeNumber: candidate.episodeNumber,
        episodeTitle: candidate.episodeTitle,
        reason,
        detail: skipDetail(reason, candidate.script),
        createdAt: nowIso(),
    };
}

export function scriptSkipFor(episode: { id: string; no: number; title: string }, script: StudioScriptDocument | undefined, reason: StudioProductionSkipReason): StudioProductionSkipRecord {
    return skipRecord({ episodeId: episode.id, episodeNumber: episode.no, episodeTitle: episode.title, script, hasPlan: true, draftAllowed: true }, reason);
}

/** 全剧剧本队列固定 skip_existing：已有剧本/人工编辑/锁定一律不入队。 */
export function planScriptQueue(candidates: ScriptQueueCandidate[]): ScriptQueuePlan {
    const queue: ScriptQueueCandidate[] = [];
    const skips: StudioProductionSkipRecord[] = [];
    for (const candidate of candidates) {
        if (!candidate.hasPlan) {
            skips.push(skipRecord(candidate, "missing_plan"));
            continue;
        }
        if (!candidate.draftAllowed) {
            skips.push(skipRecord(candidate, "admission_blocked"));
            continue;
        }
        if (!candidate.script) {
            queue.push(candidate);
            continue;
        }
        if (candidate.script.status === "locked") skips.push(skipRecord(candidate, "locked"));
        else if (hasManualScriptEdits(candidate.script)) skips.push(skipRecord(candidate, "manual_edited"));
        else skips.push(skipRecord(candidate, "existing_script"));
    }
    return { queue, skips };
}

export function hasManualScriptEdits(script: StudioScriptDocument) {
    return Boolean(script.manualEditedAt) || (script.manualEditedSceneIds?.length ?? 0) > 0;
}

export const ALL_SCRIPT_MANUAL_MODULES: StudioScriptManualEditModule[] = ["scene", "dialogue", "action", "other"];

/** 旧项目只有场景级标记；缺模块记录时按整场人工编辑，避免旧保护被降级。 */
export function scriptManualEditModules(document: StudioScriptDocument, sceneId: string): StudioScriptManualEditModule[] {
    if (document.manualEditedModules && Object.prototype.hasOwnProperty.call(document.manualEditedModules, sceneId)) {
        return document.manualEditedModules[sceneId] ?? [];
    }
    return document.manualEditedSceneIds?.includes(sceneId) ? [...ALL_SCRIPT_MANUAL_MODULES] : [];
}

/** 迁移旧数据时补模块记录；幂等，不改场景内容，也不把历史快照升级成正式版本。 */
export function ensureScriptManualModules(document: StudioScriptDocument): StudioScriptDocument {
    if (!document.manualEditedSceneIds?.length || document.manualEditedModules) return document;
    const manualEditedModules: Record<string, StudioScriptManualEditModule[]> = {};
    for (const sceneId of document.manualEditedSceneIds) manualEditedModules[sceneId] = [...ALL_SCRIPT_MANUAL_MODULES];
    return { ...document, manualEditedModules };
}

function stableJson(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : stableJson(item)).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function scriptSceneEditModules(previous: StudioScriptScene | undefined, next: StudioScriptScene): StudioScriptManualEditModule[] {
    if (!previous || previous.sceneId !== next.sceneId) return ["scene"];
    const modules: StudioScriptManualEditModule[] = [];
    if (stableJson(previous.dialogueBlocks) !== stableJson(next.dialogueBlocks)) modules.push("dialogue");
    if (previous.action !== next.action) modules.push("action");
    const otherBefore = { ...previous, dialogueBlocks: [], action: "" };
    const otherAfter = { ...next, dialogueBlocks: [], action: "" };
    if (stableJson(otherBefore) !== stableJson(otherAfter)) modules.push("other");
    return modules;
}

export type ScriptWriteGuard =
    | { ok: true; overwrite: boolean; backupRequired: boolean; reason: string }
    | { ok: false; code: "locked" | "existing_script" | "manual_edited" | "scene_missing"; error: string; requiresConfirmation?: boolean };

export function guardEpisodeScriptWrite(script: StudioScriptDocument | undefined, options: { allowOverwriteExisting?: boolean } = {}): ScriptWriteGuard {
    if (!script) return { ok: true, overwrite: false, backupRequired: false, reason: "无已有剧本" };
    if (script.status === "locked") return { ok: false, code: "locked", error: "本集剧本已锁定，先解锁再修改" };
    if (!options.allowOverwriteExisting) {
        const manual = hasManualScriptEdits(script);
        return {
            ok: false,
            code: manual ? "manual_edited" : "existing_script",
            error: `第 ${script.episodeNumber} 集已有${manual ? "人工编辑" : "正式"}剧本 v${script.scriptVersion}；默认不覆盖，请明确确认`,
            requiresConfirmation: true,
        };
    }
    return { ok: true, overwrite: true, backupRequired: true, reason: `用户确认覆盖剧本 v${script.scriptVersion}` };
}

export function guardSceneScriptWrite(
    script: StudioScriptDocument | undefined,
    sceneId: string,
    module: "scene" | "dialogue",
    options: { allowOverwriteManual?: boolean } = {},
): ScriptWriteGuard {
    if (!script) return { ok: false, code: "existing_script", error: "还没有正式剧本，先生成本集" };
    if (script.status === "locked") return { ok: false, code: "locked", error: "本集剧本已锁定，先解锁再修改" };
    const scene = script.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return { ok: false, code: "scene_missing", error: "指定的场景不存在" };
    const editedModules = scriptManualEditModules(script, sceneId);
    const blocksDialogue = editedModules.includes("dialogue");
    const blocks = module === "scene" ? editedModules.length > 0 : blocksDialogue;
    if (blocks && !options.allowOverwriteManual) {
        const scope = module === "dialogue" ? "对白" : "本场";
        return {
            ok: false,
            code: "manual_edited",
            error: `「${scene.sceneTitle}」的${scope}含人工编辑；重生成会覆盖该范围，请先确认`,
            requiresConfirmation: true,
        };
    }
    return {
        ok: true,
        overwrite: false,
        backupRequired: true,
        reason: module === "dialogue" ? "只重生成目标场对白" : "只重生成目标场",
    };
}

function bindingSignature(document: StudioScriptDocument, scene: StudioScriptScene) {
    return {
        characters: document.characterBindings.filter((item) => item.sceneIds.includes(scene.sceneId)),
        location: document.locationBindings.filter((item) => item.sceneIds.includes(scene.sceneId)),
        props: document.propBindings.filter((item) => item.sceneIds.includes(scene.sceneId)),
    };
}

export function scriptSceneSignature(document: StudioScriptDocument, scene: StudioScriptScene) {
    return simpleHash(JSON.stringify({ scene, bindings: bindingSignature(document, scene) }));
}

/** 旧数据缺场景版本时补 1，不做内容升级，也不改快照内容。 */
export function ensureScriptSceneVersions(document: StudioScriptDocument): StudioScriptDocument {
    if (document.sceneVersions && document.scenes.every((scene) => document.sceneVersions?.[scene.sceneId])) return document;
    const sceneVersions: Record<string, number> = { ...(document.sceneVersions ?? {}) };
    for (const scene of document.scenes) if (!sceneVersions[scene.sceneId]) sceneVersions[scene.sceneId] = 1;
    return { ...document, sceneVersions };
}

/** 比较新旧剧本内容，只有签名变化的场景升级；顺序变化也算变化。 */
export function withNextScriptSceneVersions(previous: StudioScriptDocument | undefined, next: StudioScriptDocument): StudioScriptDocument {
    const previousVersions = previous?.sceneVersions ?? {};
    const previousOrder = new Map((previous?.scenes ?? []).map((scene, index) => [scene.sceneId, index]));
    const nextOrder = new Map(next.scenes.map((scene, index) => [scene.sceneId, index]));
    const sceneVersions: Record<string, number> = {};
    for (const scene of next.scenes) {
        const previousScene = previous?.scenes.find((item) => item.sceneId === scene.sceneId);
        const previousVersion = previousVersions[scene.sceneId] ?? (previousScene ? 1 : 0);
        const changed = !previousScene
            || scriptSceneSignature(previous!, previousScene) !== scriptSceneSignature(next, scene)
            || previousOrder.get(scene.sceneId) !== nextOrder.get(scene.sceneId);
        sceneVersions[scene.sceneId] = changed ? Math.max(1, previousVersion + 1) : Math.max(1, previousVersion);
    }
    return { ...next, sceneVersions };
}

export function markScriptManualEdit(
    document: StudioScriptDocument,
    sceneIds: string[],
    editedAt = nowIso(),
    modules?: Record<string, StudioScriptManualEditModule[]>,
): StudioScriptDocument {
    const ids = [...new Set([...(document.manualEditedSceneIds ?? []), ...sceneIds])];
    const nextModules: Record<string, StudioScriptManualEditModule[]> = { ...(document.manualEditedModules ?? {}) };
    for (const sceneId of sceneIds) {
        const existing = scriptManualEditModules(document, sceneId);
        const incoming = modules?.[sceneId] ?? ALL_SCRIPT_MANUAL_MODULES;
        nextModules[sceneId] = [...new Set([...existing, ...incoming])];
    }
    return {
        ...document,
        manualEditedSceneIds: ids,
        manualEditedModules: Object.keys(nextModules).length ? nextModules : undefined,
        manualEditedAt: editedAt,
    };
}

/** 只清除已确认覆盖的模块；保留其他人工模块和修改时间，旧数据先按整场展开。 */
export function clearScriptManualEditModules(
    document: StudioScriptDocument,
    sceneId: string,
    modules: StudioScriptManualEditModule[] = ALL_SCRIPT_MANUAL_MODULES,
): StudioScriptDocument {
    const remaining = scriptManualEditModules(document, sceneId).filter((module) => !modules.includes(module));
    const nextModules: Record<string, StudioScriptManualEditModule[]> = { ...(document.manualEditedModules ?? {}) };
    nextModules[sceneId] = remaining;
    const ids = remaining.length
        ? [...new Set([...(document.manualEditedSceneIds ?? []), sceneId])]
        : (document.manualEditedSceneIds ?? []).filter((id) => id !== sceneId);
    const hasAny = ids.length > 0 || Object.values(nextModules).some((items) => items.length > 0);
    return {
        ...document,
        manualEditedSceneIds: ids,
        manualEditedModules: Object.keys(nextModules).length ? nextModules : undefined,
        manualEditedAt: hasAny ? document.manualEditedAt : undefined,
    };
}

/** 剧本修改后只标记受影响场景及其镜头；旧分镜保留，不自动重生成。 */
export function markStoryboardStaleForScriptChange(
    storyboard: StudioStoryboardDocument,
    previous: StudioScriptDocument | undefined,
    next: StudioScriptDocument,
): { document: StudioStoryboardDocument; changedSceneIds: string[] } {
    const previousIds = new Set(previous?.scenes.map((scene) => scene.sceneId) ?? []);
    const nextIds = new Set(next.scenes.map((scene) => scene.sceneId) ?? []);
    const previousOrder = new Map((previous?.scenes ?? []).map((scene, index) => [scene.sceneId, index]));
    const nextOrder = new Map(next.scenes.map((scene, index) => [scene.sceneId, index]));
    const changed = new Set<string>();
    for (const scene of next.scenes) {
        const before = previous?.scenes.find((item) => item.sceneId === scene.sceneId);
        if (!before) {
            changed.add(scene.sceneId);
            continue;
        }
        if (previous && scriptSceneSignature(previous, before) !== scriptSceneSignature(next, scene)) changed.add(scene.sceneId);
        if (previousOrder.get(scene.sceneId) !== nextOrder.get(scene.sceneId)) changed.add(scene.sceneId);
    }
    for (const sceneId of previousIds) if (!nextIds.has(sceneId)) changed.add(sceneId);
    // 分镜记录的来源场景版本与新剧本不一致时也纳入，兼容旧快照。
    for (const sceneId of nextIds) {
        const used = storyboard.sourceSceneVersions?.[sceneId];
        const current = next.sceneVersions?.[sceneId] ?? 0;
        if (used !== undefined && used !== current) changed.add(sceneId);
    }
    if (!changed.size) return { document: storyboard, changedSceneIds: [] };
    const sceneIds = [...new Set([...(storyboard.stale?.sceneIds ?? []), ...changed])];
    const sceneShotIds = storyboard.shots.filter((shot) => changed.has(shot.sceneId)).map((shot) => shot.shotId);
    const shotIds = [...new Set([...(storyboard.stale?.shotIds ?? []), ...sceneShotIds])];
    return {
        document: {
            ...storyboard,
            stale: {
                sceneIds,
                shotIds,
                scriptVersion: next.scriptVersion,
                reason: `剧本修改影响 ${changed.size} 个场景；旧分镜保留，等待人工检查或局部重生成`,
                markedAt: nowIso(),
            },
            updatedAt: nowIso(),
        },
        changedSceneIds: [...changed],
    };
}

/** 整集/整场/单镜重生成写回后清除对应 stale；单镜只清该镜。 */
export function clearStoryboardStale(document: StudioStoryboardDocument, script: StudioScriptDocument, target: { sceneId?: string; shotId?: string; all?: boolean }): StudioStoryboardDocument {
    if (target.all) {
        return {
            ...document,
            sourceSceneVersions: { ...(script.sceneVersions ?? {}) },
            sourceScriptVersion: script.scriptVersion,
            stale: undefined,
        };
    }
    if (!document.stale) return document;
    const sceneIds = new Set(document.stale.sceneIds);
    const shotIds = new Set(document.stale.shotIds);
    if (target.shotId) shotIds.delete(target.shotId);
    if (target.sceneId && !target.shotId) {
        sceneIds.delete(target.sceneId);
        for (const shot of document.shots.filter((item) => item.sceneId === target.sceneId)) shotIds.delete(shot.shotId);
    }
    if (target.sceneId) {
        const remainingSceneShots = document.shots.filter((shot) => shot.sceneId === target.sceneId && shotIds.has(shot.shotId));
        if (!remainingSceneShots.length) {
            return {
                ...document,
                sourceSceneVersions: { ...(document.sourceSceneVersions ?? {}), [target.sceneId]: script.sceneVersions?.[target.sceneId] ?? 0 },
                sourceScriptVersion: sceneIds.size ? document.sourceScriptVersion : script.scriptVersion,
                stale: sceneIds.size || shotIds.size ? { ...document.stale, sceneIds: [...sceneIds], shotIds: [...shotIds] } : undefined,
            };
        }
    }
    if (!sceneIds.size && !shotIds.size) {
        return { ...document, sourceSceneVersions: { ...(script.sceneVersions ?? {}) }, sourceScriptVersion: script.scriptVersion, stale: undefined };
    }
    return {
        ...document,
        stale: { ...document.stale, sceneIds: [...sceneIds], shotIds: [...shotIds] },
    };
}

export function recordStoryboardSourceVersion(document: StudioStoryboardDocument, script: StudioScriptDocument): StudioStoryboardDocument {
    return {
        ...document,
        sourceScriptId: script.id,
        sourceScriptVersion: script.scriptVersion,
        sourceSceneVersions: { ...(script.sceneVersions ?? {}) },
    };
}

export function recordStoryboardSceneSourceVersion(document: StudioStoryboardDocument, script: StudioScriptDocument, sceneId: string): StudioStoryboardDocument {
    return {
        ...document,
        sourceSceneVersions: { ...(document.sourceSceneVersions ?? {}), [sceneId]: script.sceneVersions?.[sceneId] ?? 0 },
    };
}

export function scriptContentHash(document: StudioScriptDocument) {
    return simpleHash(JSON.stringify({ ...document, updatedAt: "", createdAt: "" }));
}

function scriptContentComparable(document: StudioScriptDocument) {
    return {
        ...document,
        scriptVersion: 0,
        status: "draft",
        sceneVersions: {},
        manualEditedSceneIds: [],
        manualEditedModules: {},
        manualEditedAt: undefined,
        restoredFromSnapshotId: undefined,
        createdAt: "",
        updatedAt: "",
    };
}

/** 只有真实内容变化才允许递增正式剧本版本；人工标记、时间戳和场景版本缓存不算。 */
export function scriptContentChanged(previous: StudioScriptDocument, next: StudioScriptDocument) {
    return stableJson(scriptContentComparable(previous)) !== stableJson(scriptContentComparable(next));
}

export function scriptBackupPresent(versions: { snapshotId?: string }[], snapshotId: string) {
    return versions.some((version) => version.snapshotId === snapshotId);
}

/** 恢复剧本快照只做纯计划；写入由 production-actions 原子完成。 */
export function planScriptRestore(current: StudioScriptDocument, version: { snapshotId: string; document: StudioScriptDocument; id: string }) {
    const now = nowIso();
    const backup = current
        ? {
              id: `script-version-${simpleHash(`${current.id}:${current.scriptVersion}:restore:${now}:${Math.random()}`)}`,
              snapshotId: `scs-restore-${simpleHash(`${current.id}:${current.scriptVersion}:${now}:${Math.random()}`)}`,
              version: current.scriptVersion,
              reason: `恢复 ${version.snapshotId} 前快照`,
              createdAt: now,
              document: current,
              contentHash: scriptContentHash(current),
          }
        : undefined;
    const restored = markScriptManualEdit({
        ...version.document,
        scriptVersion: current.scriptVersion + 1,
        status: "draft" as const,
        restoredFromSnapshotId: version.snapshotId,
        updatedAt: now,
    }, version.document.scenes.map((scene) => scene.sceneId), now);
    return { backup, restored, newVersion: restored.scriptVersion };
}
