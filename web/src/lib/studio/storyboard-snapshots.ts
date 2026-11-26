// Stage 3.2 分镜快照身份：snapshotId 与正式 storyboardVersion 分离。
// 旧快照只补身份字段，不改原 document，刷新后 ID 稳定。

import { nanoid } from "nanoid";

import { simpleHash } from "./novel-chapters";
import { markStoryboardStaleForScriptChange } from "./production-protection";
import type {
    StudioScriptDocument,
    StudioShotGroup,
    StudioStoryboardDocument,
    StudioStoryboardDraft,
    StudioStoryboardSnapshotType,
    StudioStoryboardVersion,
} from "@/types/studio-production";

const nowIso = () => new Date().toISOString();

export function storyboardContentHash(document: StudioStoryboardDocument) {
    return simpleHash(JSON.stringify({
        id: document.id,
        episodeId: document.episodeId,
        episodeNumber: document.episodeNumber,
        groups: document.groups.map((group) => ({
            ...group,
            createdAt: "",
            updatedAt: "",
        })),
        shots: document.shots.map((shot) => ({
            ...shot,
            createdAt: "",
            updatedAt: "",
        })),
        sourceScriptId: document.sourceScriptId,
        sourceScriptVersion: document.sourceScriptVersion,
        sourceSceneVersions: document.sourceSceneVersions,
    }));
}

export function createStoryboardSnapshot(input: {
    document: StudioStoryboardDocument;
    snapshotType: StudioStoryboardSnapshotType;
    basedOnVersion: number;
    reason: string;
    sourceTaskId?: string;
    conflictWithSnapshotId?: string;
    createdAt?: string;
}): StudioStoryboardVersion {
    const createdAt = input.createdAt ?? nowIso();
    const contentHash = storyboardContentHash(input.document);
    const version = input.snapshotType === "formal" ? input.document.storyboardVersion : input.basedOnVersion;
    const document = input.snapshotType === "conflict" && input.document.storyboardVersion !== input.basedOnVersion
        ? { ...input.document, storyboardVersion: input.basedOnVersion }
        : input.document;
    const snapshotId = `sbs-${simpleHash(`${input.document.id}:${input.snapshotType}:${input.basedOnVersion}:${contentHash}:${createdAt}:${nanoid(8)}`)}`;
    return {
        id: `storyboard-version-${snapshotId}`,
        snapshotId,
        version,
        basedOnVersion: input.basedOnVersion,
        snapshotType: input.snapshotType,
        reason: input.reason,
        createdAt,
        document,
        sourceTaskId: input.sourceTaskId,
        contentHash,
        conflictWithSnapshotId: input.conflictWithSnapshotId,
    };
}

function legacySnapshotId(version: StudioStoryboardVersion, episodeId: string, index: number) {
    return `sbs-legacy-${simpleHash(`${episodeId}:${version.id}:${version.version}:${version.reason}:${storyboardContentHash(version.document)}:${index}`)}`;
}

function inferType(version: StudioStoryboardVersion): StudioStoryboardSnapshotType {
    if (version.snapshotType === "formal" || version.snapshotType === "conflict" || version.snapshotType === "backup") return version.snapshotType;
    if (version.reason.includes("冲突")) return "conflict";
    if (version.reason.includes("正式提交") || version.reason.includes("正式快照")) return "formal";
    if (version.reason.includes("恢复") || version.reason.includes("前快照")) return "backup";
    return "backup";
}

/**
 * 旧数据规范化：保留原 id/version/reason/createdAt/document，只补齐身份字段。
 * 同一 episode 内 snapshotId 若冲突，使用内容与索引生成稳定后缀，不会每次刷新变化。
 */
export function normalizeStoryboardSnapshots(value: StudioStoryboardVersion[] | undefined, episodeId: string): StudioStoryboardVersion[] {
    if (!Array.isArray(value)) return [];
    const used = new Set<string>();
    return value
        .filter((version) => version && version.document)
        .map((version, index) => {
            const snapshotType = inferType(version);
            let snapshotId = typeof version.snapshotId === "string" && version.snapshotId.trim() ? version.snapshotId.trim() : legacySnapshotId(version, episodeId, index);
            if (used.has(snapshotId)) snapshotId = `${snapshotId}-${simpleHash(`${index}:${storyboardContentHash(version.document)}`)}`;
            let suffix = 1;
            while (used.has(snapshotId)) snapshotId = `${legacySnapshotId(version, episodeId, index)}-${suffix++}`;
            used.add(snapshotId);
            return {
                ...version,
                snapshotId,
                basedOnVersion: Number(version.basedOnVersion) || version.version || version.document.storyboardVersion || 0,
                snapshotType,
                contentHash: version.contentHash || storyboardContentHash(version.document),
            };
        });
}

export function normalizeStoryboardDrafts(value: StudioStoryboardDraft[] | undefined, episodeId: string): StudioStoryboardDraft[] {
    if (!Array.isArray(value)) return [];
    const used = new Set<string>();
    return value
        .filter((draft) => draft && draft.storyboard)
        .map((draft, index) => {
            const storyboard = {
                ...draft.storyboard,
                groups: Array.isArray(draft.storyboard.groups) ? draft.storyboard.groups : [],
                shots: Array.isArray(draft.storyboard.shots) ? draft.storyboard.shots : [],
                checks: Array.isArray(draft.storyboard.checks) ? draft.storyboard.checks : [],
            };
            const baseId = typeof draft.draftId === "string" && draft.draftId.trim()
                ? draft.draftId.trim()
                : `sbd-legacy-${simpleHash(`${episodeId}:${draft.sourceSnapshotId ?? ""}:${draft.sourceStoryboardVersion ?? 0}:${storyboardContentHash(storyboard)}:${index}`)}`;
            let draftId = baseId;
            let suffix = 1;
            while (used.has(draftId)) draftId = `${baseId}-${suffix++}`;
            used.add(draftId);
            return {
                ...draft,
                draftId,
                episodeId: draft.episodeId || storyboard.episodeId || episodeId,
                sourceSnapshotId: draft.sourceSnapshotId || "",
                sourceStoryboardVersion: Number(draft.sourceStoryboardVersion) || storyboard.storyboardVersion || 0,
                draftVersion: Math.max(1, Number(draft.draftVersion) || 1),
                status: draft.status === "archived" ? ("archived" as const) : ("active" as const),
                storyboard,
                createdAt: draft.createdAt || nowIso(),
                updatedAt: draft.updatedAt || draft.createdAt || nowIso(),
            };
        })
        .slice(0, 20);
}

function cloneStoryboard(document: StudioStoryboardDocument): StudioStoryboardDocument {
    return JSON.parse(JSON.stringify(document)) as StudioStoryboardDocument;
}

/** 从快照复制独立草稿：只读快照，不备份、不递增正式版本，也不改正式工作区。 */
export function planStoryboardDraftFromSnapshot(input: {
    snapshot: StudioStoryboardVersion;
    existing?: StudioStoryboardDraft[];
    episodeId: string;
}): { ok: true; draft: StudioStoryboardDraft; reused: boolean } {
    const sourceStoryboardVersion = input.snapshot.basedOnVersion || input.snapshot.version || input.snapshot.document.storyboardVersion;
    const existing = (input.existing ?? []).find((draft) => draft.sourceSnapshotId === input.snapshot.snapshotId && draft.status === "active");
    if (existing) return { ok: true, draft: existing, reused: true };
    const createdAt = nowIso();
    const storyboard = cloneStoryboard(input.snapshot.document);
    storyboard.status = "draft";
    storyboard.appliedDraftId = undefined;
    storyboard.updatedAt = createdAt;
    return {
        ok: true,
        reused: false,
        draft: {
            draftId: `sbd-${simpleHash(`${input.episodeId}:${input.snapshot.snapshotId}:${sourceStoryboardVersion}:${createdAt}:${nanoid(8)}`)}`,
            episodeId: input.episodeId,
            sourceSnapshotId: input.snapshot.snapshotId,
            sourceStoryboardVersion,
            draftVersion: 1,
            createdAt,
            updatedAt: createdAt,
            createdBy: "local-user",
            storyboard,
            status: "active",
        },
    };
}

export function validateStoryboardDraftDocument(
    document: StudioStoryboardDocument,
    options: { sceneIds?: string[] } = {},
): { ok: boolean; error?: string } {
    if (!document.id || !document.episodeId) return { ok: false, error: "草稿缺少分镜或分集标识" };
    if (!Array.isArray(document.groups) || !Array.isArray(document.shots)) return { ok: false, error: "草稿结构不完整" };
    const sceneIds = options.sceneIds ? new Set(options.sceneIds) : undefined;
    const groupIds = new Set<string>();
    const groupById = new Map<string, StudioShotGroup>();
    const shotIds = new Set<string>();
    for (const group of document.groups) {
        if (!group.shotGroupId) return { ok: false, error: "草稿存在缺少 shotGroupId 的镜头组" };
        if (groupIds.has(group.shotGroupId)) return { ok: false, error: `草稿镜头组 ID 重复：${group.shotGroupId}` };
        if (!Array.isArray(group.shotIds)) return { ok: false, error: `镜头组 ${group.shotGroupId} 缺少 shotIds` };
        if (sceneIds && !sceneIds.has(group.sceneId)) return { ok: false, error: `镜头组 ${group.shotGroupId} 引用了不存在的场景 ${group.sceneId}` };
        groupIds.add(group.shotGroupId);
        groupById.set(group.shotGroupId, group);
    }
    for (const shot of document.shots) {
        if (!shot.shotId || !shot.sceneId || !shot.shotGroupId) return { ok: false, error: "草稿存在缺少 shotId / sceneId / shotGroupId 的镜头" };
        if (shotIds.has(shot.shotId)) return { ok: false, error: `草稿镜头 ID 重复：${shot.shotId}` };
        if (sceneIds && !sceneIds.has(shot.sceneId)) return { ok: false, error: `镜头 ${shot.shotId} 引用了不存在的场景 ${shot.sceneId}` };
        if (!groupById.has(shot.shotGroupId)) return { ok: false, error: `镜头 ${shot.shotId} 引用了不存在的镜头组` };
        shotIds.add(shot.shotId);
    }
    const membership = new Map<string, string>();
    for (const group of document.groups) {
        const seen = new Set<string>();
        for (const shotId of group.shotIds) {
            if (seen.has(shotId)) return { ok: false, error: `镜头组 ${group.shotGroupId} 重复引用镜头 ${shotId}` };
            seen.add(shotId);
            if (!shotIds.has(shotId)) return { ok: false, error: `镜头组 ${group.shotGroupId} 引用了不存在的镜头 ${shotId}` };
            const owner = membership.get(shotId);
            if (owner && owner !== group.shotGroupId) return { ok: false, error: `镜头 ${shotId} 同时被镜头组 ${owner} 与 ${group.shotGroupId} 引用` };
            membership.set(shotId, group.shotGroupId);
        }
    }
    for (const shot of document.shots) {
        const group = groupById.get(shot.shotGroupId);
        if (!group || !group.shotIds.includes(shot.shotId)) return { ok: false, error: `镜头 ${shot.shotId} 未登记在所属镜头组 ${shot.shotGroupId} 的 shotIds 中` };
        if (membership.get(shot.shotId) !== shot.shotGroupId) return { ok: false, error: `镜头 ${shot.shotId} 的 shotGroupId 与镜头组引用不一致` };
    }
    return { ok: true };
}

/** 草稿应用为正式版本：校验来源版本、备份当前正式版本，再生成新正式版本。 */
export function planStoryboardDraftApply(input: {
    current: StudioStoryboardDocument;
    draft: StudioStoryboardDraft;
    script?: StudioScriptDocument;
    expectedVersion: number;
    allowStaleDraft?: boolean;
    sceneIds?: string[];
}): { ok: false; error: string; conflict?: boolean; requiresConfirmation?: boolean } | { ok: true; backup: StudioStoryboardVersion; restored: StudioStoryboardDocument; formal: StudioStoryboardVersion; newVersion: number } {
    if (input.current.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再应用" };
    if (input.current.storyboardVersion !== input.expectedVersion) {
        return { ok: false, error: `当前正式版本已从 v${input.expectedVersion} 变为 v${input.current.storyboardVersion}；请重新比较后再应用` };
    }
    if (input.draft.status !== "active") return { ok: false, error: "草稿已归档，不能再应用" };
    if (input.current.shots.some((shot) => shot.locked)) return { ok: false, error: "当前分镜仍有锁定镜头，整集应用会覆盖内容，请先解锁" };
    if (input.draft.sourceStoryboardVersion !== input.current.storyboardVersion && !input.allowStaleDraft) {
        return {
            ok: false,
            conflict: true,
            requiresConfirmation: true,
            error: `草稿基于正式 v${input.draft.sourceStoryboardVersion}，当前已是 v${input.current.storyboardVersion}；请确认仍应用该草稿`,
        };
    }
    const draftDocument = cloneStoryboard(input.draft.storyboard);
    const valid = validateStoryboardDraftDocument(draftDocument, { sceneIds: input.sceneIds });
    if (!valid.ok) return { ok: false, error: valid.error ?? "草稿内容校验失败" };
    const backup = createStoryboardSnapshot({
        document: input.current,
        snapshotType: "backup",
        basedOnVersion: input.current.storyboardVersion,
        reason: `应用草稿 ${input.draft.draftId} 前快照`,
    });
    const newVersion = input.current.storyboardVersion + 1;
    let restored: StudioStoryboardDocument = {
        ...draftDocument,
        storyboardVersion: newVersion,
        status: "draft",
        appliedDraftId: input.draft.draftId,
        restoredFromSnapshotId: undefined,
        updatedAt: nowIso(),
    };
    if (input.script) restored = markStoryboardStaleForScriptChange(restored, input.script, input.script).document;
    const formal = createStoryboardSnapshot({
        document: restored,
        snapshotType: "formal",
        basedOnVersion: newVersion,
        reason: `应用草稿 ${input.draft.draftId} 为新的正式版本`,
    });
    return { ok: true, backup, restored, formal, newVersion };
}

export function snapshotTypeLabel(type: StudioStoryboardSnapshotType) {
    if (type === "formal") return "正式快照";
    if (type === "conflict") return "冲突快照";
    return "自动备份";
}

/** UI 比较用摘要；不改动任何快照。 */
export function storyboardSnapshotDiff(current: StudioStoryboardDocument | undefined, snapshot: StudioStoryboardVersion) {
    const currentScenes = [...new Set((current?.groups ?? []).map((group) => group.sceneId))];
    const snapshotScenes = [...new Set(snapshot.document.groups.map((group) => group.sceneId))];
    const missing = currentScenes.filter((sceneId) => !snapshotScenes.includes(sceneId));
    const extra = snapshotScenes.filter((sceneId) => !currentScenes.includes(sceneId));
    return {
        currentVersion: current?.storyboardVersion ?? 0,
        snapshotVersion: snapshot.version,
        basedOnVersion: snapshot.basedOnVersion,
        currentShots: current?.shots.length ?? 0,
        snapshotShots: snapshot.document.shots.length,
        changedScenes: [...new Set([...missing, ...extra])],
        currentGroups: current?.groups.length ?? 0,
        snapshotGroups: snapshot.document.groups.length,
    };
}

/** 应用快照的纯计划：先备份，再作为新正式版本。复制到草稿必须走 planStoryboardDraftFromSnapshot。 */
export function planStoryboardSnapshotApply(input: {
    current: StudioStoryboardDocument;
    snapshot: StudioStoryboardVersion;
    script?: StudioScriptDocument;
    expectedVersion: number;
    mode: "apply" | "copy";
}): { ok: false; error: string } | { ok: true; backup: StudioStoryboardVersion; restored: StudioStoryboardDocument; formal: StudioStoryboardVersion; newVersion: number } {
    if (input.mode === "copy") return { ok: false, error: "复制快照必须创建独立草稿，不能修改正式分镜" };
    if (input.current.status === "locked") return { ok: false, error: "分镜已锁定，先解锁再应用" };
    if (input.current.storyboardVersion !== input.expectedVersion) {
        return { ok: false, error: `当前正式版本已从 v${input.expectedVersion} 变为 v${input.current.storyboardVersion}；请重新比较后再应用` };
    }
    if (input.current.shots.some((shot) => shot.locked)) return { ok: false, error: "当前分镜仍有锁定镜头，整集应用会覆盖内容，请先解锁" };
    const backup = createStoryboardSnapshot({
        document: input.current,
        snapshotType: "backup",
        basedOnVersion: input.current.storyboardVersion,
        reason: `应用 ${input.snapshot.snapshotId} 前快照`,
    });
    const newVersion = input.current.storyboardVersion + 1;
    let restored: StudioStoryboardDocument = {
        ...input.snapshot.document,
        storyboardVersion: newVersion,
        status: "draft",
        restoredFromSnapshotId: input.snapshot.snapshotId,
        updatedAt: nowIso(),
    };
    if (input.script) {
        if (!restored.sourceSceneVersions) {
            restored.sourceSceneVersions = Object.fromEntries(input.script.scenes.map((scene) => [scene.sceneId, 0]));
        }
        restored = markStoryboardStaleForScriptChange(restored, input.script, input.script).document;
    }
    const formal = createStoryboardSnapshot({
        document: restored,
        snapshotType: "formal",
        basedOnVersion: newVersion,
        reason: `应用 ${input.snapshot.snapshotId} 为新的正式版本`,
    });
    return { ok: true, backup, restored, formal, newVersion };
}
