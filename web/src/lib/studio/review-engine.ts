// Stage 4B 分镜审核纯函数：审核状态、锁定派生、审核记录、stale 复核、确定性检查与第五步 readiness。
// 只读 StudioStoryboardDocument / StudioScriptDocument；不修改正式分镜，不调用模型。

import type {
    StudioContinuityCheckReport,
    StudioContinuityFinding,
    StudioContinuityRun,
    StudioAiAdjustmentProposal,
    StudioAiProposalApplication,
    StudioAiReviewRun,
    StudioProductionCheckLevel,
    StudioProductionCheckStatus,
    StudioShotGroup,
    StudioStoryboardAuditRecord,
    StudioStoryboardDocument,
    StudioStoryboardReadiness,
    StudioStoryboardReadinessStatus,
    StudioStoryboardReview,
    StudioStoryboardReviewAction,
    StudioStoryboardReviewIssue,
    StudioStoryboardReviewStatus,
    StudioStoryboardShotReview,
    StudioStoryboardShotStatus,
    StudioStoryboardVersion,
    StudioProductionShot,
    StudioScriptDocument,
} from "@/types/studio-production";
import { simpleHash } from "./novel-chapters";
import { buildContinuityCheck, type StudioContinuityScope } from "./continuity-engine";
import { normalizeAiEvidenceType } from "./review-evidence";

const nowIso = () => new Date().toISOString();

export const STORYBOARD_REVIEW_STATUS_LABEL: Record<StudioStoryboardReviewStatus, string> = {
    pending: "待审核",
    approved: "已通过",
    needs_revision: "需要修改",
    rejected: "不通过",
    stale: "待重新审核",
};

export const STORYBOARD_REVIEW_ACTION_LABEL: Record<StudioStoryboardReviewAction, string> = {
    approve: "通过",
    needs_revision: "标记需要修改",
    reject: "驳回",
    reset: "重置待审",
    note: "审核备注",
    recheck: "重新检查",
    re_review: "重新审核",
};

export const STORYBOARD_READINESS_LABEL: Record<StudioStoryboardReadinessStatus, string> = {
    not_ready: "尚未就绪",
    ready_for_video: "可进入视频生成",
    blocked: "已阻塞",
};

export type StudioStoryboardReviewStats = {
    total: number;
    approved: number;
    pending: number;
    needsRevision: number;
    rejected: number;
    locked: number;
    stale: number;
    reviewed: number;
    scenes: number;
    groups: number;
    duration: number;
    errors: number;
    warnings: number;
    suggestions: number;
};

export type StudioStoryboardReviewAnalysis = {
    review: StudioStoryboardReview;
    statuses: Record<string, StudioStoryboardReviewStatus>;
    issues: StudioStoryboardReviewIssue[];
    readiness: StudioStoryboardReadiness;
    stats: StudioStoryboardReviewStats;
    continuity: StudioContinuityCheckReport;
};

export type StudioStoryboardReviewSkip = {
    shotId: string;
    reason: "missing" | "locked" | "stale" | "unchanged" | "version_conflict" | "not_stale";
    detail?: string;
};

export type StudioStoryboardReviewPlan =
    | { ok: false; error: string; conflict?: boolean }
    | { ok: true; review: StudioStoryboardReview; statuses: Record<string, StudioStoryboardReviewStatus>; updated: string[]; skipped: StudioStoryboardReviewSkip[] };

export type StudioStoryboardReReviewPlan = StudioStoryboardReviewPlan;

export type StudioStoryboardReviewFailure = {
    shotId: string;
    reason: "version_conflict" | "policy";
    message: string;
};

export type StudioStoryboardLockSkip = {
    shotId: string;
    reason: "missing" | "unchanged" | "document_locked";
};

export type StudioStoryboardShotDiffField = {
    key: string;
    label: string;
    before: string;
    after: string;
};

export type StudioStoryboardShotDiff = {
    stale: boolean;
    reason: "upstream" | "content" | "version" | null;
    previousVersion?: number;
    currentVersion: number;
    fields: StudioStoryboardShotDiffField[];
    unavailable: boolean;
    message: string;
};

const REVIEW_CONTENT_KEYS = [
    "shotId",
    "episodeId",
    "sceneId",
    "shotGroupId",
    "shotNumber",
    "duration",
    "shotSize",
    "cameraPosition",
    "cameraAngle",
    "lens",
    "cameraMovement",
    "composition",
    "foreground",
    "midground",
    "background",
    "characterBlocking",
    "eyeline",
    "action",
    "facialExpression",
    "emotion",
    "dialogue",
    "voiceOver",
    "soundEffects",
    "backgroundMusic",
    "lighting",
    "environment",
    "continuityRules",
    "characterBindings",
    "outfitBindings",
    "sceneBindings",
    "propBindings",
    "sourceReferences",
    "sourceScriptSceneId",
    "imagePrompt",
    "videoPrompt",
] as const;

function reviewContentProjection(shot: StudioProductionShot) {
    const value: Record<string, unknown> = {};
    for (const key of REVIEW_CONTENT_KEYS) value[key] = shot[key];
    return value;
}

/** 审核内容签名：忽略 locked / status / version / 时间戳，只覆盖镜头可见内容。 */
export function shotReviewContentHash(shot: StudioProductionShot) {
    return simpleHash(JSON.stringify(reviewContentProjection(shot)));
}

export function copyShotReviewSnapshot(shot: StudioProductionShot): StudioProductionShot {
    return {
        ...shot,
        dialogue: shot.dialogue.map((line) => ({ ...line })),
        continuityRules: [...shot.continuityRules],
        characterBindings: shot.characterBindings.map((binding) => ({ ...binding })),
        outfitBindings: shot.outfitBindings.map((binding) => ({ ...binding })),
        sceneBindings: { ...shot.sceneBindings },
        propBindings: shot.propBindings.map((binding) => ({ ...binding })),
        sourceReferences: { ...shot.sourceReferences },
        keyframeRefs: [...shot.keyframeRefs],
    };
}

/** 锁定只限制编辑，不是审核状态；整份分镜锁定会让所有镜头进入受保护状态。 */
export function isShotLocked(document: StudioStoryboardDocument, shot: StudioProductionShot) {
    return document.status === "locked" || shot.locked;
}

export function storyboardStaleAckKey(document: StudioStoryboardDocument) {
    const stale = document.stale;
    if (!stale) return "";
    return `${stale.scriptVersion}|${stale.markedAt}|${stale.reason}|${stale.shotIds.join(",")}`;
}

function isUpstreamStale(document: StudioStoryboardDocument, shot: StudioProductionShot, record?: StudioStoryboardShotReview) {
    if (!document.stale?.shotIds.includes(shot.shotId)) return false;
    return record?.staleAckKey !== storyboardStaleAckKey(document);
}

/**
 * stale 的唯一派生入口；locked 不参与判断。
 * 正式版本一旦变化，绑定旧版本的审核记录全部 stale；内容哈希只用于解释差异，不能覆盖版本过期。
 */
export function describeShotReviewStale(
    document: StudioStoryboardDocument,
    review: StudioStoryboardReview | undefined,
    shot: StudioProductionShot,
): "upstream" | "content" | "version" | null {
    const record = review?.shots[shot.shotId];
    if (isUpstreamStale(document, shot, record)) return "upstream";
    if (!record) return null;
    if (record.storyboardVersion !== document.storyboardVersion) return "version";
    if (record.shotContentHash && record.shotContentHash !== shotReviewContentHash(shot)) return "content";
    return null;
}

/** 该镜头是否 stale；与 locked 完全独立，允许出现 stale + locked。 */
export function effectiveShotReviewStatus(
    document: StudioStoryboardDocument,
    review: StudioStoryboardReview | undefined,
    shot: StudioProductionShot,
): StudioStoryboardReviewStatus {
    if (describeShotReviewStale(document, review, shot)) return "stale";
    return review?.shots[shot.shotId]?.status ?? "pending";
}

function estimateDialogueSeconds(text: string) {
    if (!text.trim()) return 0;
    // 中文对白按每秒约 4.2 字估算，只用于提示，不替代配音实测。
    return Math.round((text.replace(/\s/g, "").length / 4.2) * 10) / 10;
}

type StoryboardIssueInput = Omit<StudioStoryboardReviewIssue, "id" | "source" | "status" | "createdAt" | "updatedAt"> & { identity?: string };

/** 问题 ID 只由检查码和归属目标决定，保证刷新后能继承 accepted / ignored 状态。 */
function makeIssue(input: StoryboardIssueInput & { now: string; previous?: StudioStoryboardReviewIssue[] }): StudioStoryboardReviewIssue {
    const target = input.shotId || input.shotGroupId || input.sceneId || "episode";
    const identity = input.identity || target;
    const id = `review-${input.episodeNumber}-${input.code}-${identity}`;
    const previous = input.previous?.find((issue) => issue.id === id);
    const { identity: _identity, ...rest } = input;
    return {
        ...rest,
        id,
        source: "deterministic",
        status: previous?.status ?? "open",
        createdAt: previous?.createdAt ?? input.now,
        updatedAt: input.now,
    };
}

function auditRecordId(seed: string) {
    return `review-audit-${simpleHash(seed)}`;
}

/** Stage 4A 确定性检查：结构、引用、镜头组一致性、关键字段与时长；4C 再扩展连续性与轴线。 */
export function buildStoryboardReviewIssues(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    review?: StudioStoryboardReview;
    previous?: StudioStoryboardReviewIssue[];
    now?: string;
}): StudioStoryboardReviewIssue[] {
    const { document, script, review } = input;
    const now = input.now ?? nowIso();
    const issues: StudioStoryboardReviewIssue[] = [];
    const push = (issue: StoryboardIssueInput) => issues.push(makeIssue({ ...issue, now, previous: input.previous }));
    const base = { episodeNumber: document.episodeNumber, category: "分镜结构" as const };
    const groups = Array.isArray(document.groups) ? document.groups : [];
    const shots = Array.isArray(document.shots) ? document.shots : [];
    const sceneIds = new Set(script?.scenes.map((scene) => scene.sceneId) ?? []);
    const characterIds = new Set(script?.characterBindings.map((binding) => binding.characterId) ?? []);
    const propIds = new Set(script?.propBindings.map((binding) => binding.propId) ?? []);
    const groupIds = new Set<string>();
    const groupById = new Map<string, StudioShotGroup>();
    const shotIds = new Set<string>();
    const shotById = new Map<string, StudioProductionShot>();
    const shotMembership = new Map<string, string[]>();

    if (!shots.length) {
        push({ ...base, level: "error", code: "storyboard_without_shot", message: "分镜没有任何镜头，无法进入视频生成。", suggestion: "先回到第三步生成至少一个镜头组。" });
    }

    for (const group of groups) {
        if (!group.shotGroupId) {
            push({ ...base, level: "error", code: "group_without_id", message: "存在没有 shotGroupId 的镜头组。", suggestion: "重新生成镜头组，保证稳定 ID。" });
            continue;
        }
        if (groupIds.has(group.shotGroupId)) {
            push({ ...base, level: "error", code: "group_duplicate_id", shotGroupId: group.shotGroupId, message: `镜头组 ID「${group.shotGroupId}」重复。`, suggestion: "合并或重命名重复镜头组，不能保留两个同 ID 组。" });
        }
        groupIds.add(group.shotGroupId);
        groupById.set(group.shotGroupId, group);
        if (script && !sceneIds.has(group.sceneId)) {
            push({ ...base, level: "error", code: "group_unknown_scene", sceneId: group.sceneId, shotGroupId: group.shotGroupId, message: `镜头组 ${group.groupNumber} 引用了不存在的剧本场景。`, suggestion: "重新从当前正式剧本生成镜头组。" });
        }
        if (!group.cameraAxis.trim()) {
            push({ ...base, level: "error", code: "group_without_axis", sceneId: group.sceneId, shotGroupId: group.shotGroupId, message: `镜头组 ${group.groupNumber} 没有摄影机轴线。`, suggestion: "补轴线，或显式设计一次轴线转换。" });
        }
        if (!group.sharedLayout.trim()) {
            push({ ...base, level: "warning", code: "group_without_layout", sceneId: group.sceneId, shotGroupId: group.shotGroupId, message: `镜头组 ${group.groupNumber} 没有共享空间布局。`, suggestion: "补人物初始位置、空间关系和道具状态。" });
        }
        if (group.characterStartPositions.length && !group.sharedLayout.trim()) {
            push({ ...base, level: "warning", code: "group_positions_without_layout", sceneId: group.sceneId, shotGroupId: group.shotGroupId, message: `镜头组 ${group.groupNumber} 有人物起点，但没有共享布局。`, suggestion: "把人物起点写进共享布局，避免组内空间漂移。" });
        }
        if (!group.shotIds.length) {
            push({ ...base, level: "warning", code: "group_without_shot_refs", sceneId: group.sceneId, shotGroupId: group.shotGroupId, message: `镜头组 ${group.groupNumber} 没有登记任何镜头。`, suggestion: "补 shotIds 或重新生成该组镜头。" });
        }
        const seenInGroup = new Set<string>();
        for (const shotId of group.shotIds) {
            if (seenInGroup.has(shotId)) {
                push({ ...base, level: "error", code: "group_duplicate_shot_ref", sceneId: group.sceneId, shotGroupId: group.shotGroupId, shotId, message: `镜头组 ${group.groupNumber} 重复引用镜头「${shotId}」。`, suggestion: "删除重复引用，保证组内镜头唯一。" });
            }
            seenInGroup.add(shotId);
            shotMembership.set(shotId, [...(shotMembership.get(shotId) ?? []), group.shotGroupId]);
        }
    }

    for (const shot of shots) {
        if (!shot.shotId) {
            push({ ...base, level: "error", code: "shot_without_id", message: "存在没有 shotId 的镜头。", suggestion: "重新生成稳定镜头 ID。" });
            continue;
        }
        if (shotIds.has(shot.shotId)) {
            push({ ...base, level: "error", code: "shot_duplicate_id", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ID「${shot.shotId}」重复。`, suggestion: "修复或重生成稳定 shotId。" });
        }
        shotIds.add(shot.shotId);
        shotById.set(shot.shotId, shot);
        const group = groupById.get(shot.shotGroupId);
        const memberships = shotMembership.get(shot.shotId) ?? [];
        if (!shot.shotGroupId || !group) {
            push({ ...base, level: "error", code: "shot_unknown_group", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 没有有效镜头组。`, suggestion: "先建立 ShotGroup，再生成单镜头。" });
        } else {
            if (!group.shotIds.includes(shot.shotId)) {
                push({ ...base, level: "error", code: "shot_not_in_group", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 没有登记在所属镜头组 shotIds 中。`, suggestion: "补镜头组引用，保持双向一致。" });
            }
            if (shot.sceneId !== group.sceneId) {
                push({ ...base, level: "error", code: "shot_scene_mismatch", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的场景与镜头组场景不一致。`, suggestion: "把镜头移回正确场景或重建镜头组。" });
            }
        }
        if (memberships.length > 1) {
            push({ ...base, level: "error", code: "shot_shared_by_groups", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 同时被 ${memberships.length} 个镜头组引用。`, suggestion: "每个镜头只能属于一个镜头组，删除多余引用。" });
        }
        if (script && !sceneIds.has(shot.sceneId)) {
            push({ ...base, level: "error", code: "shot_unknown_scene", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 引用了不存在的剧本场景。`, suggestion: "重新从当前剧本场景生成此镜头。" });
        }
        if (!Number.isFinite(shot.duration) || shot.duration <= 0) {
            push({ ...base, level: "error", code: "shot_duration_invalid", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的时长缺失或非法（${String(shot.duration)}）。`, suggestion: "补 1–15 秒的有效镜头时长。" });
        } else if (shot.duration > 30) {
            push({ ...base, level: "warning", category: "时长", code: "shot_duration_long", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 时长 ${shot.duration}s，超出常规短剧单镜范围。`, suggestion: "拆分动作或确认是否为长镜头设计。" });
        }
        if (!shot.shotSize.trim() || !shot.cameraPosition.trim() || !shot.cameraMovement.trim()) {
            push({ ...base, level: "warning", category: "镜头语言", code: "shot_language_incomplete", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的景别、机位或运镜不完整。`, suggestion: "补齐镜头语言；运镜必须服务叙事。" });
        }
        if (!shot.action.trim()) {
            push({ ...base, level: "warning", category: "表演", code: "shot_action_empty", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 没有动作描述。`, suggestion: "补动作起势、接触或结果，便于表演和生成。" });
        }
        if (!shot.characterBlocking.trim() && shot.characterBindings.length) {
            push({ ...base, level: "warning", category: "连续性", code: "shot_without_blocking", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 有出场人物但没有人物调度。`, suggestion: "补人物位置、朝向与视线起点。" });
        }
        if (!shot.imagePrompt.trim() || !shot.videoPrompt.trim()) {
            push({ ...base, level: "warning", category: "生成提示", code: "shot_prompt_empty", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的图片或视频提示词不完整。`, suggestion: "补结构化提示词；生成前不要把空白提示词交给模型。" });
        }
        for (const binding of shot.characterBindings) {
            if (script && !characterIds.has(binding.characterId)) {
                push({ ...base, level: "warning", category: "资产引用", code: "shot_unknown_character", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的人物「${binding.name}」不在剧本人物绑定中。`, suggestion: "核对人物资产 ID，避免重复主体身份。" });
            }
        }
        for (const binding of shot.propBindings) {
            if (script && !propIds.has(binding.propId)) {
                push({ ...base, level: "warning", category: "资产引用", code: "shot_unknown_prop", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的道具「${binding.name}」不在剧本道具绑定中。`, suggestion: "核对 propId 与道具持有状态。" });
            }
        }
        for (const line of shot.dialogue) {
            if (!line.characterId) {
                push({ ...base, level: "error", category: "对白", code: "shot_dialogue_without_character", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的对白没有绑定 characterId。`, suggestion: "把说话人映射到稳定人物资产。" });
            } else if (!shot.characterBindings.some((binding) => binding.characterId === line.characterId)) {
                push({ ...base, level: "warning", category: "对白", code: "shot_speaker_not_in_frame", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的说话人「${line.speaker}」不在画面人物中。`, suggestion: "补入声源人物，或明确改为画外音。" });
            }
            const speech = estimateDialogueSeconds(line.text);
            if (speech > 0 && shot.duration > 0 && speech > shot.duration * 1.25) {
                push({ ...base, level: "warning", category: "时长", code: "shot_dialogue_too_long", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 对白估算 ${speech}s，明显超出镜头 ${shot.duration}s。`, suggestion: "删减台词、拆镜或确认更快语速。" });
            }
        }
        if (isUpstreamStale(document, shot, review?.shots[shot.shotId])) {
            push({ ...base, level: "warning", category: "上游变化", code: "shot_stale_upstream", sceneId: shot.sceneId, shotGroupId: shot.shotGroupId, shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 上游剧本已变化，需要重新检查。`, suggestion: document.stale?.reason || "重新核对当前剧本场景后再审核。" });
        }
    }

    const duplicateNumbers = new Map<number, string[]>();
    for (const shot of shots) {
        duplicateNumbers.set(shot.shotNumber, [...(duplicateNumbers.get(shot.shotNumber) ?? []), shot.shotId]);
    }
    for (const [shotNumber, ids] of duplicateNumbers) {
        if (shotNumber && ids.length > 1) {
            push({ ...base, level: "warning", code: "shot_duplicate_number", shotId: ids[0], message: `镜号 ${shotNumber} 被 ${ids.length} 个镜头重复使用。`, suggestion: "保证同一集镜号唯一，方便审片和生成定位。" });
        }
    }

    if (script) {
        const target = script.durationEstimate.totalSeconds || script.durationTarget;
        const total = Math.round(shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0) * 10) / 10;
        if (target > 0) {
            const ratio = total / target;
            const level: StudioProductionCheckLevel | "ok" = ratio > 1.35 || ratio < 0.55 ? "error" : ratio > 1.15 || ratio < 0.8 ? "warning" : "ok";
            if (level !== "ok") {
                push({
                    ...base,
                    level,
                    category: "时长",
                    code: level === "error" ? "storyboard_duration_out_of_range" : "storyboard_duration_near",
                    message: `分镜总时长 ${total}s，剧本目标 ${target}s，偏差 ${Math.round((total - target) * 10) / 10}s。`,
                    suggestion: "按场景预算校准镜头时长；压缩必须由用户确认，不能自动删核心动作。",
                });
            }
        }
    }

    for (const group of groups) {
        const groupShots = group.shotIds.map((shotId) => shotById.get(shotId)).filter((shot): shot is StudioProductionShot => Boolean(shot));
        for (const shotId of group.shotIds) {
            if (shotById.has(shotId)) continue;
            push({ ...base, level: "error", category: "分镜结构", code: "group_missing_shot", sceneId: group.sceneId, shotGroupId: group.shotGroupId, shotId, message: `镜头组 ${group.groupNumber} 引用了不存在的镜头「${shotId}」。`, suggestion: "删除失效引用，或重新生成该镜头。" });
        }
        if (groupShots.length > 1) {
            const adjacent = [...groupShots].sort((left, right) => left.shotNumber - right.shotNumber);
            for (let index = 1; index < adjacent.length; index += 1) {
                const previous = adjacent[index - 1];
                const current = adjacent[index];
                if (previous.characterBlocking && current.characterBlocking && !current.continuityRules.length) {
                    push({
                        ...base,
                        level: "suggestion",
                        category: "连续性",
                        code: "shot_continuity_not_declared",
                        sceneId: current.sceneId,
                        shotGroupId: group.shotGroupId,
                        shotId: current.shotId,
                        message: `镜头 ${previous.shotNumber} → ${current.shotNumber} 没有声明连续性规则。`,
                        suggestion: "补站位、视线、动作或道具连续性约束。",
                    });
                }
            }
        }
    }

    return issues;
}

/**
 * 4C：结构检查 + 连续性检查合并入口。
 * 连续性旧结果在重新检查后不再冒充当前：被重检覆盖但未复现的旧项标记 continuityStale；
 * 未落在本次 scope 内的旧项原样保留，等待下次相关范围检查。
 */
export function buildAllStoryboardReviewIssues(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    review?: StudioStoryboardReview;
    previous?: StudioStoryboardReviewIssue[];
    scope?: StudioContinuityScope;
    /** 已经由异步连续性检查生成的结果；提供时不得再次计算。 */
    continuity?: StudioContinuityCheckReport;
    now?: string;
}): { issues: StudioStoryboardReviewIssue[]; continuity: StudioContinuityCheckReport } {
    const { document, script, review } = input;
    const now = input.now ?? nowIso();
    const scope = input.scope ?? input.continuity?.scope ?? { type: "episode" };
    const previous = input.previous ?? [];
    if (input.continuity && input.continuity.storyboardVersion !== document.storyboardVersion) {
        throw new Error(`连续性检查基于 v${input.continuity.storyboardVersion}，当前正式分镜已是 v${document.storyboardVersion}；拒绝绑定旧结果`);
    }
    if (input.continuity && input.continuity.episodeId !== document.episodeId) {
        throw new Error("连续性检查所属分集与当前正式分镜不一致；拒绝绑定旧结果");
    }
    if (input.continuity && (input.continuity.scope.type !== scope.type || input.continuity.scope.id !== scope.id)) {
        throw new Error("连续性检查范围与当前提交范围不一致；拒绝绑定旧结果");
    }
    const structural = buildStoryboardReviewIssues({ document, script, review, previous, now });
    const continuity = input.continuity ?? buildContinuityCheck({ document, script, scope });
    const currentContinuity = continuity.findings.map((finding) => continuityFindingIssue(finding, document, previous, now));
    const currentIds = new Set(currentContinuity.map((issue) => issue.id));
    const preserved: StudioStoryboardReviewIssue[] = [];
    for (const issue of previous) {
        if (!issue.ruleId?.startsWith("continuity.") || currentIds.has(issue.id)) continue;
        if (scope.type !== "episode" && !continuityIssueInScope(issue, scope)) {
            preserved.push(issue);
            continue;
        }
        preserved.push({ ...issue, continuityStale: true, updatedAt: now });
    }
    return {
        issues: [...structural, ...currentContinuity, ...preserved],
        continuity,
    };
}

function continuityIssueInScope(issue: StudioStoryboardReviewIssue, scope: StudioContinuityScope) {
    if (scope.type === "episode" || !scope.id) return true;
    if (scope.type === "shot") return Boolean(issue.shotIds?.includes(scope.id) || issue.shotId === scope.id);
    if (scope.type === "group") return issue.shotGroupId === scope.id;
    return issue.sceneId === scope.id;
}

function continuityFindingIssue(
    finding: StudioContinuityFinding,
    document: StudioStoryboardDocument,
    previous: StudioStoryboardReviewIssue[],
    now: string,
): StudioStoryboardReviewIssue {
    const target = finding.shotIds.join(">");
    const identity = `${target}-${simpleHash(`${finding.ruleId}|${finding.fieldPath}`)}`;
    return makeIssue({
        episodeNumber: document.episodeNumber,
        category: "连续性",
        level: finding.severity,
        code: finding.ruleId,
        ruleId: finding.ruleId,
        message: finding.reason,
        suggestion: finding.suggestion,
        sceneId: finding.sceneId,
        shotGroupId: finding.shotGroupId,
        shotId: finding.shotIds.at(-1),
        shotIds: finding.shotIds,
        confidence: finding.confidence,
        fieldPath: finding.fieldPath,
        evidence: finding.evidence,
        storyboardVersion: document.storyboardVersion,
        continuityScope: finding.scope,
        identity,
        now,
        previous,
    });
}

function continuityRun(scope: StudioContinuityScope, document: StudioStoryboardDocument, report: StudioContinuityCheckReport, issueIds: string[], now: string): StudioContinuityRun {
    return {
        id: `continuity-run-${report.checkId}`,
        scope: { type: scope.type, id: scope.id },
        storyboardVersion: document.storyboardVersion,
        checkedAt: now,
        checkedShots: report.checkedShots,
        checkedPairs: report.checkedPairs,
        affectedShotIds: report.affectedShotIds,
        issueIds,
        counts: report.counts,
    };
}

export function buildStoryboardReviewReadiness(input: {
    document: StudioStoryboardDocument;
    review: StudioStoryboardReview;
    issues: StudioStoryboardReviewIssue[];
    now?: string;
}): StudioStoryboardReadiness {
    const now = input.now ?? nowIso();
    const openIssues = input.issues.filter((issue) => issue.status === "open" && !issue.continuityStale);
    const errors = openIssues.filter((issue) => issue.level === "error");
    const warnings = openIssues.filter((issue) => issue.level === "warning");
    const statuses = input.document.shots.map((shot) => effectiveShotReviewStatus(input.document, input.review, shot));
    const pending = statuses.filter((status) => status === "pending").length;
    const needsRevision = statuses.filter((status) => status === "needs_revision").length;
    const rejected = statuses.filter((status) => status === "rejected").length;
    const stale = statuses.filter((status) => status === "stale").length;
    const locked = input.document.shots.filter((shot) => isShotLocked(input.document, shot)).length;
    const noShots = input.document.shots.length === 0;
    const blocking: string[] = [];
    const reasons: string[] = [];
    if (noShots) blocking.push("还没有可审核的镜头");
    if (errors.length) blocking.push(`${errors.length} 条 Error 未解决`);
    if (rejected) blocking.push(`${rejected} 个镜头被驳回`);
    if (pending) reasons.push(`${pending} 个镜头待审核`);
    if (needsRevision) reasons.push(`${needsRevision} 个镜头需要修改`);
    if (stale) reasons.push(`${stale} 个镜头需要重新审核`);
    if (warnings.length) reasons.push(`${warnings.length} 条 Warning 待处理`);
    if (locked) reasons.push(`${locked} 个镜头已锁定；锁定只限制修改，不改变审核结论`);
    let status: StudioStoryboardReadinessStatus;
    if (blocking.length) status = "blocked";
    else if (pending || needsRevision || stale || warnings.length) status = "not_ready";
    else status = "ready_for_video";
    return {
        status,
        reasons: [...blocking, ...reasons],
        blocking,
        storyboardVersion: input.document.storyboardVersion,
        checkedAt: now,
    };
}

export type StoryboardReviewContext = {
    projectId?: string;
    episodeId?: string;
    episodeNumber?: number;
};

export type StoryboardReviewNormalizeOptions = {
    /** 仅受保护的正式写入 / 审核写入使用；把派生冲突一并落盘。读取时必须保持 false。 */
    persistDerivedConflicts?: boolean;
    operationId?: string;
};

/**
 * 领域记录自包含：把项目 / 分集 / 集数补到审核记录、问题、历史、AI run、提案与修改项。
 * 只补缺失字段，不覆盖已有归属，不据此修正内容。
 */
export function stampStoryboardReviewContext(review: StudioStoryboardReview, context: StoryboardReviewContext): StudioStoryboardReview {
    const projectId = review.projectId ?? context.projectId;
    const episodeId = context.episodeId ?? review.episodeId;
    const episodeNumber = review.episodeNumber ?? context.episodeNumber;
    return {
        ...review,
        projectId,
        episodeId,
        episodeNumber,
        issues: review.issues.map((issue) => ({
            ...issue,
            projectId: issue.projectId ?? projectId,
            episodeId: issue.episodeId ?? episodeId,
        })),
        audits: review.audits.map((audit) => ({
            ...audit,
            projectId: audit.projectId ?? projectId,
        })),
        aiReviewRuns: review.aiReviewRuns?.map((run) => ({
            ...run,
            projectId: run.projectId ?? projectId,
            episodeNumber: run.episodeNumber ?? episodeNumber,
        })),
        proposals: review.proposals?.map((proposal) => ({
            ...proposal,
            projectId: proposal.projectId ?? projectId,
            episodeNumber: proposal.episodeNumber ?? episodeNumber,
        })),
    };
}

export function createEmptyStoryboardReview(episodeId: string, storyboardVersion = 0, now = nowIso(), context?: StoryboardReviewContext): StudioStoryboardReview {
    return {
        version: 1,
        projectId: context?.projectId,
        episodeId,
        episodeNumber: context?.episodeNumber,
        storyboardVersion,
        shots: {},
        issues: [],
        audits: [],
        readiness: { status: "not_ready", reasons: [], blocking: [], storyboardVersion, checkedAt: now },
        updatedAt: now,
    };
}

function normalizeAuditStatus(value: unknown): StudioStoryboardReviewStatus {
    if (value === "locked") return "pending";
    if (value === "approved" || value === "needs_revision" || value === "rejected" || value === "stale" || value === "pending") return value;
    return "pending";
}

/** 旧项目没有 storyboardReview 时返回 undefined；有正式分镜才建立空审核壳，避免给每集制造空数据。 */
export function normalizeStoryboardReview(
    value: StudioStoryboardReview | undefined,
    storyboard: StudioStoryboardDocument | undefined,
    now = nowIso(),
    context?: StoryboardReviewContext,
    options?: StoryboardReviewNormalizeOptions,
): StudioStoryboardReview | undefined {
    if (!value) return storyboard ? createEmptyStoryboardReview(storyboard.episodeId, storyboard.storyboardVersion, now, { projectId: context?.projectId, episodeNumber: context?.episodeNumber ?? storyboard.episodeNumber }) : undefined;
    const persistDerivedConflicts = options?.persistDerivedConflicts === true;
    const statuses = value.shots && typeof value.shots === "object" ? value.shots : {};
    const shots: Record<string, StudioStoryboardShotReview> = {};
    for (const [shotId, record] of Object.entries(statuses)) {
        if (!record || typeof record !== "object") continue;
        const rawStatus = (record.status as string);
        const status = rawStatus === "locked" || rawStatus === "stale" ? "pending" : rawStatus;
        if (!["pending", "approved", "needs_revision", "rejected"].includes(status)) continue;
        const storyboardVersion = Number.isFinite(record.storyboardVersion) ? record.storyboardVersion : -1;
        const currentShot = storyboard?.shots.find((shot) => shot.shotId === shotId);
        const sameVersion = !!currentShot && !!storyboard && storyboardVersion === storyboard.storyboardVersion;
        const reviewedShot = record.reviewedShot && typeof record.reviewedShot === "object" && record.reviewedShot.shotId === shotId
            ? record.reviewedShot
            : sameVersion && currentShot
              ? copyShotReviewSnapshot(currentShot)
              : undefined;
        shots[shotId] = {
            shotId,
            status: status as StudioStoryboardShotStatus,
            note: typeof record.note === "string" ? record.note : "",
            storyboardVersion,
            reviewedAt: typeof record.reviewedAt === "string" ? record.reviewedAt : now,
            reviewedBy: typeof record.reviewedBy === "string" ? record.reviewedBy : "local-user",
            shotContentHash:
                typeof record.shotContentHash === "string" && record.shotContentHash
                    ? record.shotContentHash
                    : sameVersion
                      ? shotReviewContentHash(currentShot)
                      : undefined,
            reviewedShot,
            staleAckKey: typeof record.staleAckKey === "string" && record.staleAckKey ? record.staleAckKey : undefined,
        };
    }
    const audits: StudioStoryboardAuditRecord[] = Array.isArray(value.audits)
        ? value.audits
              .filter((audit) => audit && typeof audit.id === "string")
              .map((audit) => ({
                  ...audit,
                  fromStatus: normalizeAuditStatus(audit.fromStatus),
                  toStatus: normalizeAuditStatus(audit.toStatus),
              }))
        : [];
    const continuityRuns: StudioContinuityRun[] = Array.isArray(value.continuityRuns)
        ? value.continuityRuns
              .filter((run) => run && typeof run.id === "string" && Number.isFinite(run.storyboardVersion))
              .map((run) => ({
                  ...run,
                  scope: run.scope && typeof run.scope.type === "string" ? run.scope : { type: "episode" as const },
                  checkedShots: Number.isFinite(run.checkedShots) ? run.checkedShots : 0,
                  checkedPairs: Number.isFinite(run.checkedPairs) ? run.checkedPairs : 0,
                  affectedShotIds: Array.isArray(run.affectedShotIds) ? run.affectedShotIds : [],
                  issueIds: Array.isArray(run.issueIds) ? run.issueIds : [],
                  counts: run.counts ?? { error: 0, warning: 0, suggestion: 0, insufficient: 0 },
              }))
              .slice(0, 20)
        : [];
    const aiReviewRuns: StudioAiReviewRun[] = Array.isArray(value.aiReviewRuns)
        ? value.aiReviewRuns
              .filter((run) => run && typeof run.runId === "string" && Number.isFinite(run.storyboardVersion))
              .map((run) => ({
                  ...run,
                  scope: run.scope && Array.isArray(run.scope.shotIds) ? run.scope : { type: "episode" as const, shotIds: [] },
                  findings: Array.isArray(run.findings) ? run.findings : [],
                  summary: typeof run.summary === "string" ? run.summary : "",
                  status: ["completed", "failed", "cancelled"].includes(run.status) ? run.status : "failed",
                  createdAt: typeof run.createdAt === "string" ? run.createdAt : now,
                  updatedAt: typeof run.updatedAt === "string" ? run.updatedAt : now,
              }))
              .slice(0, 50)
        : [];
    const currentStoryboardVersion = storyboard?.storyboardVersion ?? (Number.isFinite(value.storyboardVersion) ? value.storyboardVersion : 0);
    const proposals: StudioAiAdjustmentProposal[] = Array.isArray(value.proposals)
        ? value.proposals
              .filter((proposal) => proposal && typeof proposal.proposalId === "string")
              .map((proposal) => {
                  const changes = (Array.isArray(proposal.changes) ? proposal.changes : []).map((change) => {
                      const evidenceType = normalizeAiEvidenceType(change.evidenceType);
                      return {
                          ...change,
                          evidence: typeof change.evidence === "string" ? change.evidence : "",
                          evidenceType,
                          confidence: change.confidence ?? proposal.confidence ?? "low",
                          speculative: change.speculative === true || evidenceType === "inference" || evidenceType === "unknown",
                          sourceShotIds: Array.isArray(change.sourceShotIds) ? change.sourceShotIds.filter((id): id is string => typeof id === "string") : undefined,
                          sourceChapterId: typeof change.sourceChapterId === "string" ? change.sourceChapterId : undefined,
                          sourceVersion: typeof change.sourceVersion === "string" ? change.sourceVersion : undefined,
                          sourceStatus: change.sourceStatus === "confirmed" ? "confirmed" as const : "unconfirmed" as const,
                      };
                  });
                  const decision = proposal.decision ?? { status: "pending" as const, acceptedChangeIds: [], rejectedChangeIds: [] };
                  if (decision.status === "pending" && proposal.storyboardVersion !== currentStoryboardVersion) {
                      const conflictAt = persistDerivedConflicts ? now : decision.decidedAt ?? proposal.updatedAt ?? now;
                      return {
                          ...proposal,
                          changes,
                          decision: {
                              ...decision,
                              status: "conflict" as const,
                              acceptedChangeIds: [],
                              rejectedChangeIds: changes.map((change) => change.changeId),
                              note: `提案基于 v${proposal.storyboardVersion}，当前正式分镜已是 v${currentStoryboardVersion}；系统自动标记版本冲突，未应用、未 rebase。`,
                              decidedAt: conflictAt,
                              decidedBy: "system:version-guard",
                              autoConflict: true,
                          },
                      };
                  }
                  return { ...proposal, changes, decision };
              })
              .slice(0, 100)
        : [];
    const proposalApplications: StudioAiProposalApplication[] = Array.isArray(value.proposalApplications)
        ? value.proposalApplications
              .filter((application) => application && typeof application.applicationId === "string")
              .slice(0, 50)
        : [];
    const autoConflictProposals = proposals.filter((proposal) => proposal.decision.autoConflict === true);
    const conflictProposalIds = new Set(autoConflictProposals.map((proposal) => proposal.proposalId));
    // 读取时派生出的冲突 application 不是持久化事实；受保护写入时才把 derived 记录替换为 persisted。
    const retainedApplications = persistDerivedConflicts
        ? proposalApplications.filter((application) => !(application.derived === true && conflictProposalIds.has(application.proposalId)))
        : proposalApplications;
    const autoConflictApplications: StudioAiProposalApplication[] = autoConflictProposals
        .filter((proposal) => !retainedApplications.some((application) => application.proposalId === proposal.proposalId && application.status === "conflict"))
        .map((proposal) => ({
            applicationId: `ai-auto-conflict-${proposal.proposalId}`,
            proposalId: proposal.proposalId,
            runId: proposal.runId,
            status: "conflict" as const,
            acceptedChangeIds: [],
            beforeVersion: proposal.storyboardVersion,
            operationId: options?.operationId,
            error: proposal.decision.note ?? "提案绑定旧版本，系统自动标记冲突",
            persisted: persistDerivedConflicts,
            derived: !persistDerivedConflicts,
            appliedAt: now,
        }));
    const normalized: StudioStoryboardReview = {
        version: 1,
        projectId: typeof value.projectId === "string" ? value.projectId : context?.projectId,
        episodeId: typeof value.episodeId === "string" ? value.episodeId : storyboard?.episodeId ?? "",
        episodeNumber: Number.isFinite(value.episodeNumber) ? value.episodeNumber : context?.episodeNumber ?? storyboard?.episodeNumber,
        storyboardVersion: Number.isFinite(value.storyboardVersion) ? value.storyboardVersion : storyboard?.storyboardVersion ?? 0,
        shots,
        issues: Array.isArray(value.issues) ? value.issues.filter((issue) => issue && typeof issue.id === "string") : [],
        audits,
        readiness:
            value.readiness && typeof value.readiness === "object" && ["not_ready", "ready_for_video", "blocked"].includes(value.readiness.status)
                ? { ...value.readiness, reasons: Array.isArray(value.readiness.reasons) ? value.readiness.reasons : [], blocking: Array.isArray(value.readiness.blocking) ? value.readiness.blocking : [] }
                : { status: "not_ready", reasons: [], blocking: [], storyboardVersion: storyboard?.storyboardVersion ?? 0, checkedAt: now },
        lastCheckedAt: typeof value.lastCheckedAt === "string" ? value.lastCheckedAt : undefined,
        continuityRuns,
        aiReviewRuns,
        proposals,
        proposalApplications: [...autoConflictApplications, ...retainedApplications].slice(0, 50),
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    };
    return stampStoryboardReviewContext(normalized, {
        projectId: context?.projectId,
        episodeId: storyboard?.episodeId ?? value.episodeId,
        episodeNumber: context?.episodeNumber ?? storyboard?.episodeNumber,
    });
}

export function reviewStats(
    document: StudioStoryboardDocument,
    review: StudioStoryboardReview | undefined,
    issues: StudioStoryboardReviewIssue[],
): StudioStoryboardReviewStats {
    const statuses = document.shots.map((shot) => effectiveShotReviewStatus(document, review, shot));
    const locked = document.shots.filter((shot) => isShotLocked(document, shot)).length;
    const open = issues.filter((issue) => issue.status === "open" && !issue.continuityStale);
    return {
        total: document.shots.length,
        approved: statuses.filter((status) => status === "approved").length,
        pending: statuses.filter((status) => status === "pending").length,
        needsRevision: statuses.filter((status) => status === "needs_revision").length,
        rejected: statuses.filter((status) => status === "rejected").length,
        locked,
        stale: statuses.filter((status) => status === "stale").length,
        reviewed: statuses.filter((status) => status === "approved").length,
        scenes: new Set(document.shots.map((shot) => shot.sceneId)).size,
        groups: document.groups.length,
        duration: Math.round(document.shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0) * 10) / 10,
        errors: open.filter((issue) => issue.level === "error").length,
        warnings: open.filter((issue) => issue.level === "warning").length,
        suggestions: open.filter((issue) => issue.level === "suggestion").length,
    };
}

/** 页面读取时实时计算，不自动写正式分镜；只有 refresh / 审核动作才落库。 */
export function analyzeStoryboardReview(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    review?: StudioStoryboardReview;
    scope?: StudioContinuityScope;
    now?: string;
}): StudioStoryboardReviewAnalysis {
    const now = input.now ?? nowIso();
    const normalized = normalizeStoryboardReview(input.review, input.document, now) ?? createEmptyStoryboardReview(input.document.episodeId, input.document.storyboardVersion, now);
    const built = buildAllStoryboardReviewIssues({
        document: input.document,
        script: input.script,
        review: normalized,
        previous: normalized.issues,
        scope: input.scope,
        now,
    });
    const issues = built.issues;
    const readiness = buildStoryboardReviewReadiness({ document: input.document, review: normalized, issues, now });
    const statuses: Record<string, StudioStoryboardReviewStatus> = {};
    for (const shot of input.document.shots) statuses[shot.shotId] = effectiveShotReviewStatus(input.document, normalized, shot);
    const review: StudioStoryboardReview = {
        ...normalized,
        storyboardVersion: input.document.storyboardVersion,
        issues,
        readiness,
        updatedAt: normalized.updatedAt,
    };
    const stamped = stampStoryboardReviewContext(review, { projectId: normalized.projectId, episodeId: input.document.episodeId, episodeNumber: input.document.episodeNumber });
    return { review: stamped, statuses, issues: stamped.issues, readiness, stats: reviewStats(input.document, stamped, stamped.issues), continuity: built.continuity };
}

export type StudioStoryboardLockPlan =
    | { ok: false; error: string; conflict?: boolean }
    | { ok: true; updates: Record<string, boolean>; updated: string[]; skipped: StudioStoryboardLockSkip[] };

/** 批量锁定 / 解锁：只计算镜头 locked 字段，不触碰审核记录、正式版本或镜头内容。 */
export function planStoryboardShotLocks(input: {
    document: StudioStoryboardDocument;
    shotIds: string[];
    locked: boolean;
    expectedVersion: number;
}): StudioStoryboardLockPlan {
    if (input.document.storyboardVersion !== input.expectedVersion) {
        return { ok: false, conflict: true, error: `当前正式分镜已变为 v${input.document.storyboardVersion}，原锁定操作基于 v${input.expectedVersion}，请刷新后再提交` };
    }
    const shotById = new Map(input.document.shots.map((shot) => [shot.shotId, shot]));
    const updates: Record<string, boolean> = {};
    const updated: string[] = [];
    const skipped: StudioStoryboardLockSkip[] = [];
    for (const shotId of [...new Set(input.shotIds)]) {
        const shot = shotById.get(shotId);
        if (!shot) {
            skipped.push({ shotId, reason: "missing" });
            continue;
        }
        if (input.document.status === "locked") {
            skipped.push({ shotId, reason: input.locked ? "unchanged" : "document_locked" });
            continue;
        }
        if (shot.locked === input.locked) {
            skipped.push({ shotId, reason: "unchanged" });
            continue;
        }
        updates[shotId] = input.locked;
        updated.push(shotId);
    }
    return { ok: true, updates, updated, skipped };
}

/** 批量审核纯计划：锁定、stale、缺失镜头跳过；合法镜头继续，返回部分成功结果。
 * `partialOnVersionChange` 只把整批版本冲突降级为逐镜失败，不得让基于旧版本的记录写入新版本。
 */
export function planStoryboardReviewStatus(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    review?: StudioStoryboardReview;
    shotIds: string[];
    status: StudioStoryboardShotStatus;
    action: StudioStoryboardReviewAction;
    note?: string;
    reviewer?: string;
    expectedVersion: number;
    partialOnVersionChange?: boolean;
    now?: string;
}): StudioStoryboardReviewPlan {
    const now = input.now ?? nowIso();
    const versionChanged = input.document.storyboardVersion !== input.expectedVersion;
    if (versionChanged && !input.partialOnVersionChange) {
        return { ok: false, conflict: true, error: `当前正式分镜已变为 v${input.document.storyboardVersion}，原审核基于 v${input.expectedVersion}，请刷新后再提交` };
    }
    if (!input.document.shots.length) return { ok: false, error: "当前分集没有可审核镜头" };
    const normalized = normalizeStoryboardReview(input.review, input.document, now) ?? createEmptyStoryboardReview(input.document.episodeId, input.document.storyboardVersion, now);
    const shotById = new Map(input.document.shots.map((shot) => [shot.shotId, shot]));
    const shots = { ...normalized.shots };
    const audits = [...normalized.audits];
    const updated: string[] = [];
    const skipped: StudioStoryboardReviewSkip[] = [];
    const reviewer = input.reviewer?.trim() || "local-user";
    const note = input.note?.trim() ?? "";
    const staleKey = storyboardStaleAckKey(input.document);

    for (const shotId of [...new Set(input.shotIds)]) {
        const shot = shotById.get(shotId);
        if (!shot) {
            skipped.push({ shotId, reason: "missing" });
            continue;
        }
        if (isShotLocked(input.document, shot)) {
            skipped.push({ shotId, reason: "locked" });
            continue;
        }
        const existing = normalized.shots[shotId];
        if (versionChanged && (!existing || existing.storyboardVersion !== input.document.storyboardVersion)) {
            skipped.push({
                shotId,
                reason: "version_conflict",
                detail: existing ? `审核绑定 v${existing.storyboardVersion}，当前为 v${input.document.storyboardVersion}；旧版本记录不得写入当前版本` : "没有绑定当前正式版本的审核记录",
            });
            continue;
        }
        const current = effectiveShotReviewStatus(input.document, normalized, shot);
        if (current === "stale") {
            skipped.push({ shotId, reason: "stale" });
            continue;
        }
        if (current === input.status && !note) {
            skipped.push({ shotId, reason: "unchanged" });
            continue;
        }
        const next: StudioStoryboardShotReview = {
            shotId,
            status: input.status,
            note: note || existing?.note || "",
            storyboardVersion: input.document.storyboardVersion,
            reviewedAt: now,
            reviewedBy: reviewer,
            shotContentHash: shotReviewContentHash(shot),
            reviewedShot: copyShotReviewSnapshot(shot),
            staleAckKey:
                input.document.stale?.shotIds.includes(shotId) && existing?.staleAckKey === staleKey
                    ? existing.staleAckKey
                    : undefined,
        };
        shots[shotId] = next;
        updated.push(shotId);
        audits.push({
            id: auditRecordId(`${shotId}:${input.action}:${input.status}:${input.document.storyboardVersion}:${now}:${audits.length}`),
            projectId: normalized.projectId,
            episodeId: input.document.episodeId,
            shotId,
            action: input.action,
            fromStatus: current,
            toStatus: input.status,
            note,
            actor: reviewer,
            storyboardVersion: input.document.storyboardVersion,
            createdAt: now,
        });
    }

    const nextReviewBase: StudioStoryboardReview = {
        ...normalized,
        episodeId: input.document.episodeId,
        storyboardVersion: input.document.storyboardVersion,
        shots,
        audits,
        updatedAt: now,
        lastCheckedAt: now,
    };
    const built = buildAllStoryboardReviewIssues({ document: input.document, script: input.script, review: nextReviewBase, previous: normalized.issues, now });
    const issues = built.issues;
    const readiness = buildStoryboardReviewReadiness({ document: input.document, review: nextReviewBase, issues, now });
    const review: StudioStoryboardReview = { ...nextReviewBase, issues, readiness };
    const stamped = stampStoryboardReviewContext(review, { projectId: normalized.projectId, episodeId: input.document.episodeId, episodeNumber: input.document.episodeNumber });
    const statuses: Record<string, StudioStoryboardReviewStatus> = {};
    for (const shot of input.document.shots) statuses[shot.shotId] = effectiveShotReviewStatus(input.document, stamped, shot);
    return { ok: true, review: stamped, statuses, updated, skipped };
}

/**
 * stale 明确复核：只创建绑定当前正式版本的新 pending 记录，不自动通过，不改旧 audit。
 * 上游 stale 需要保存 ack key，后续剧本再次变化时该 ack 自动失效。
 */
export function planStoryboardReviewReReview(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    review?: StudioStoryboardReview;
    shotIds: string[];
    expectedVersion: number;
    note?: string;
    reviewer?: string;
    now?: string;
}): StudioStoryboardReReviewPlan {
    const now = input.now ?? nowIso();
    if (input.document.storyboardVersion !== input.expectedVersion) {
        return { ok: false, conflict: true, error: `当前正式分镜已变为 v${input.document.storyboardVersion}，原复核基于 v${input.expectedVersion}，请刷新后再提交` };
    }
    if (!input.document.shots.length) return { ok: false, error: "当前分集没有可审核镜头" };
    const normalized = normalizeStoryboardReview(input.review, input.document, now) ?? createEmptyStoryboardReview(input.document.episodeId, input.document.storyboardVersion, now);
    const shotById = new Map(input.document.shots.map((shot) => [shot.shotId, shot]));
    const shots = { ...normalized.shots };
    const audits = [...normalized.audits];
    const updated: string[] = [];
    const skipped: StudioStoryboardReviewSkip[] = [];
    const reviewer = input.reviewer?.trim() || "local-user";
    const staleKey = storyboardStaleAckKey(input.document);

    for (const shotId of [...new Set(input.shotIds)]) {
        const shot = shotById.get(shotId);
        if (!shot) {
            skipped.push({ shotId, reason: "missing" });
            continue;
        }
        if (isShotLocked(input.document, shot)) {
            skipped.push({ shotId, reason: "locked" });
            continue;
        }
        const existing = normalized.shots[shotId];
        const staleReason = describeShotReviewStale(input.document, normalized, shot);
        if (!staleReason) {
            skipped.push({ shotId, reason: "not_stale" });
            continue;
        }
        const next: StudioStoryboardShotReview = {
            shotId,
            status: "pending",
            note: existing?.note ?? "",
            storyboardVersion: input.document.storyboardVersion,
            reviewedAt: now,
            reviewedBy: reviewer,
            shotContentHash: shotReviewContentHash(shot),
            reviewedShot: copyShotReviewSnapshot(shot),
            staleAckKey: input.document.stale?.shotIds.includes(shotId) ? staleKey : undefined,
        };
        shots[shotId] = next;
        updated.push(shotId);
        audits.push({
            id: auditRecordId(`${shotId}:re_review:${input.document.storyboardVersion}:${now}:${audits.length}`),
            projectId: normalized.projectId,
            episodeId: input.document.episodeId,
            shotId,
            action: "re_review",
            fromStatus: "stale",
            toStatus: "pending",
            note: input.note?.trim() || "已复核当前正式分镜，等待审核",
            actor: reviewer,
            storyboardVersion: input.document.storyboardVersion,
            createdAt: now,
        });
    }

    const nextReviewBase: StudioStoryboardReview = {
        ...normalized,
        episodeId: input.document.episodeId,
        storyboardVersion: input.document.storyboardVersion,
        shots,
        audits,
        updatedAt: now,
        lastCheckedAt: now,
    };
    const built = buildAllStoryboardReviewIssues({ document: input.document, script: input.script, review: nextReviewBase, previous: normalized.issues, now });
    const issues = built.issues;
    const readiness = buildStoryboardReviewReadiness({ document: input.document, review: nextReviewBase, issues, now });
    const review: StudioStoryboardReview = { ...nextReviewBase, issues, readiness };
    const stamped = stampStoryboardReviewContext(review, { projectId: normalized.projectId, episodeId: input.document.episodeId, episodeNumber: input.document.episodeNumber });
    const statuses: Record<string, StudioStoryboardReviewStatus> = {};
    for (const shot of input.document.shots) statuses[shot.shotId] = effectiveShotReviewStatus(input.document, stamped, shot);
    return { ok: true, review: stamped, statuses, updated, skipped };
}

type ShotDiffReader = {
    key: string;
    label: string;
    read: (shot: StudioProductionShot) => string;
};

const SHOT_DIFF_READERS: ShotDiffReader[] = [
    { key: "duration", label: "时长", read: (shot) => `${Number(shot.duration) || 0}s` },
    { key: "shotSize", label: "景别", read: (shot) => shot.shotSize },
    { key: "camera", label: "机位 / 角度 / 镜头", read: (shot) => [shot.cameraPosition, shot.cameraAngle, shot.lens].filter(Boolean).join(" · ") },
    { key: "cameraMovement", label: "运镜", read: (shot) => shot.cameraMovement },
    { key: "composition", label: "构图 / 层次", read: (shot) => [shot.composition, shot.foreground, shot.midground, shot.background].filter(Boolean).join("；") },
    { key: "characterBlocking", label: "人物站位", read: (shot) => shot.characterBlocking },
    { key: "eyeline", label: "人物视线", read: (shot) => shot.eyeline },
    { key: "action", label: "动作", read: (shot) => shot.action },
    { key: "performance", label: "表情 / 情绪", read: (shot) => [shot.facialExpression, shot.emotion].filter(Boolean).join("；") },
    { key: "dialogue", label: "台词", read: (shot) => shot.dialogue.map((line) => `${line.speaker}：${line.text}`).join(" / ") },
    { key: "environment", label: "环境", read: (shot) => shot.environment },
    { key: "lighting", label: "光照", read: (shot) => shot.lighting },
    { key: "propStates", label: "道具状态", read: (shot) => shot.propBindings.map((binding) => `${binding.name}（${binding.state}）`).join("；") },
    { key: "continuityRules", label: "连续性约束", read: (shot) => shot.continuityRules.join("；") },
    { key: "sound", label: "声音设计", read: (shot) => [shot.voiceOver, shot.soundEffects, shot.backgroundMusic].filter(Boolean).join("；") },
];

function versionShot(versions: StudioStoryboardVersion[] | undefined, version: number, shotId: string) {
    if (!versions?.length) return undefined;
    const ordered = [
        ...versions.filter((item) => item.snapshotType === "formal"),
        ...versions.filter((item) => item.snapshotType === "backup"),
        ...versions.filter((item) => item.snapshotType === "conflict"),
    ];
    for (const item of ordered) {
        if (item.version !== version && item.document.storyboardVersion !== version) continue;
        const shot = item.document.shots.find((candidate) => candidate.shotId === shotId);
        if (shot) return shot;
    }
    return undefined;
}

/** stale 审片差异：优先使用审核时快照，否则查找历史快照；找不到就明确不可比较。 */
export function buildShotStaleDiff(input: {
    document: StudioStoryboardDocument;
    review?: StudioStoryboardReview;
    shot: StudioProductionShot;
    versions?: StudioStoryboardVersion[];
}): StudioStoryboardShotDiff {
    const record = input.review?.shots[input.shot.shotId];
    const reason = describeShotReviewStale(input.document, input.review, input.shot);
    const currentVersion = input.document.storyboardVersion;
    const previousVersion = record?.storyboardVersion;
    if (!reason) {
        return { stale: false, reason: null, previousVersion, currentVersion, fields: [], unavailable: false, message: "当前镜头与最近审核记录一致。" };
    }
    let previousShot: StudioProductionShot | undefined;
    if (record?.reviewedShot && record.reviewedShot.shotId === input.shot.shotId) previousShot = record.reviewedShot;
    if (!previousShot && previousVersion !== undefined) previousShot = versionShot(input.versions, previousVersion, input.shot.shotId);
    if (!previousShot && record && previousVersion === currentVersion) previousShot = input.shot;
    if (!previousShot) {
        return {
            stale: true,
            reason,
            previousVersion,
            currentVersion,
            fields: [],
            unavailable: true,
            message: previousVersion === undefined
                ? "没有可比较的旧审核记录；请打开当前镜头并明确重新审核。"
                : `无法完整比较历史内容：没有找到审核版本 v${previousVersion} 的镜头快照。`,
        };
    }
    const fields = SHOT_DIFF_READERS.map((reader) => ({
        key: reader.key,
        label: reader.label,
        before: reader.read(previousShot).trim(),
        after: reader.read(input.shot).trim(),
    })).filter((field) => field.before !== field.after);
    const message = fields.length
        ? `${fields.length} 个字段与上次审核时不同。`
        : reason === "upstream"
          ? "镜头字段未变化；上游剧本已变化，需要确认当前上下文后再重新审核。"
          : "镜头内容签名或版本绑定不一致，但未发现可展示的字段差异。";
    return { stale: true, reason, previousVersion, currentVersion, fields, unavailable: false, message };
}

/** 重新检查不改审核结论，只刷新 issues / readiness 和当前分镜版本绑定。 */
export function planStoryboardReviewRefresh(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    review?: StudioStoryboardReview;
    scope?: StudioContinuityScope;
    /** 异步检查的同一份结果；提供时不得再次运行完整检查。 */
    continuity?: StudioContinuityCheckReport;
    now?: string;
}): StudioStoryboardReview {
    const now = input.now ?? nowIso();
    const scope = input.scope ?? input.continuity?.scope ?? { type: "episode" };
    const normalized = normalizeStoryboardReview(input.review, input.document, now) ?? createEmptyStoryboardReview(input.document.episodeId, input.document.storyboardVersion, now);
    const shots = { ...normalized.shots };
    for (const shot of input.document.shots) {
        const record = shots[shot.shotId];
        if (!record || record.storyboardVersion !== input.document.storyboardVersion || record.shotContentHash) continue;
        shots[shot.shotId] = {
            ...record,
            shotContentHash: shotReviewContentHash(shot),
            reviewedShot: record.reviewedShot ?? copyShotReviewSnapshot(shot),
        };
    }
    const checked: StudioStoryboardReview = { ...normalized, shots };
    const built = buildAllStoryboardReviewIssues({ document: input.document, script: input.script, review: checked, previous: normalized.issues, scope, continuity: input.continuity, now });
    const continuityIssueIds = built.issues.filter((issue) => issue.ruleId?.startsWith("continuity.") && !issue.continuityStale).map((issue) => issue.id);
    const run = continuityRun(scope, input.document, built.continuity, continuityIssueIds, now);
    const existingRun = checked.continuityRuns?.some((item) => item.id === run.id);
    const continuityRuns = existingRun ? checked.continuityRuns : [run, ...(checked.continuityRuns ?? [])].slice(0, 20);
    const base: StudioStoryboardReview = {
        ...checked,
        storyboardVersion: input.document.storyboardVersion,
        issues: built.issues,
        continuityRuns,
        updatedAt: now,
        lastCheckedAt: now,
    };
    const stamped = stampStoryboardReviewContext(base, { projectId: normalized.projectId, episodeId: input.document.episodeId, episodeNumber: input.document.episodeNumber });
    return { ...stamped, readiness: buildStoryboardReviewReadiness({ document: input.document, review: stamped, issues: stamped.issues, now }) };
}

export function auditsForShot(review: StudioStoryboardReview | undefined, shotId: string): StudioStoryboardAuditRecord[] {
    return (review?.audits ?? []).filter((audit) => audit.shotId === shotId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function openIssuesForShot(issues: StudioStoryboardReviewIssue[], shotId: string): StudioStoryboardReviewIssue[] {
    return issues.filter((issue) => issue.shotId === shotId && issue.status === "open" && !issue.continuityStale);
}

export function issuesByLevel(issues: StudioStoryboardReviewIssue[], level: StudioProductionCheckLevel): StudioStoryboardReviewIssue[] {
    return issues.filter((issue) => issue.level === level && issue.status === "open" && !issue.continuityStale);
}

export type StudioStoryboardIssueStatus = StudioProductionCheckStatus;
