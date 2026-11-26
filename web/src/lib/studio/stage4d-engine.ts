// Stage 4D 纯函数：AI 审核结果只能生成提案；提案只能修改白名单内的镜头字段，
// 不得触碰人物 / 场景 / 道具 ID、绑定、版本、锁定状态。人工编辑字段默认受保护。

import type {
    StudioAiAdjustmentProposal,
    StudioAiProposalChange,
    StudioProductionShot,
    StudioStoryboardDocument,
} from "@/types/studio-production";
import { normalizeAiEvidenceType } from "./review-evidence";

const SHOT_TEXT_FIELDS = [
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
    "voiceOver",
    "soundEffects",
    "backgroundMusic",
    "lighting",
    "environment",
    "imagePrompt",
    "videoPrompt",
] as const;

const FIELD_LABELS: Record<string, string> = {
    shotSize: "景别",
    cameraPosition: "机位",
    cameraAngle: "角度",
    lens: "镜头",
    cameraMovement: "运镜",
    composition: "构图",
    foreground: "前景",
    midground: "中景层",
    background: "背景",
    characterBlocking: "人物调度",
    eyeline: "视线",
    action: "动作",
    facialExpression: "表情",
    emotion: "情绪",
    voiceOver: "旁白",
    soundEffects: "音效",
    backgroundMusic: "配乐",
    lighting: "光线",
    environment: "环境",
    imagePrompt: "画面提示词",
    videoPrompt: "视频提示词",
    duration: "时长",
    "dialogue.text": "对白文本",
    "dialogue.delivery": "对白语气",
    "dialogue.emotion": "对白情绪",
};

export type ShotFieldRead =
    | { ok: true; value: string; label: string; fieldPath: string }
    | { ok: false; error: string };

export function normalizeProposalFieldPath(path: string): string | undefined {
    const trimmed = path.trim().replace(/^shot\./, "");
    const dialogue = trimmed.match(/^dialogue\[(\d+)\]\.(text|delivery|emotion)$/) ?? trimmed.match(/^dialogue\.(\d+)\.(text|delivery|emotion)$/);
    if (dialogue) return `dialogue[${dialogue[1]}].${dialogue[2]}`;
    if (trimmed === "duration") return "duration";
    if ((SHOT_TEXT_FIELDS as readonly string[]).includes(trimmed)) return trimmed;
    return undefined;
}

export function fieldRoot(path: string): string {
    if (path.startsWith("dialogue")) return "dialogue";
    const index = path.indexOf("[");
    return index >= 0 ? path.slice(0, index) : path.split(".")[0];
}

export function fieldLabel(path: string): string {
    if (path.startsWith("dialogue[")) {
        const match = path.match(/^dialogue\[(\d+)\]\.(text|delivery|emotion)$/);
        return match ? `对白 ${Number(match[1]) + 1} · ${FIELD_LABELS[`dialogue.${match[2]}`] ?? match[2]}` : "对白";
    }
    return FIELD_LABELS[path] ?? path;
}

export function readShotField(shot: StudioProductionShot, rawPath: string): ShotFieldRead {
    const path = normalizeProposalFieldPath(rawPath);
    if (!path) return { ok: false, error: `字段路径「${rawPath}」不在 Stage 4D 可编辑白名单内` };
    if (path === "duration") return { ok: true, value: String(shot.duration), label: fieldLabel(path), fieldPath: path };
    if (path.startsWith("dialogue[")) {
        const match = path.match(/^dialogue\[(\d+)\]\.(text|delivery|emotion)$/);
        if (!match) return { ok: false, error: `对白字段路径不合法：${rawPath}` };
        const line = shot.dialogue[Number(match[1])];
        if (!line) return { ok: false, error: `对白 ${Number(match[1]) + 1} 不存在` };
        const value = line[match[2] as "text" | "delivery" | "emotion"];
        return { ok: true, value, label: fieldLabel(path), fieldPath: path };
    }
    const value = shot[path as keyof StudioProductionShot];
    if (typeof value !== "string") return { ok: false, error: `字段「${path}」不是文本字段` };
    return { ok: true, value, label: fieldLabel(path), fieldPath: path };
}

/** 锁定与人工编辑保护：返回原因表示禁止覆盖；返回 undefined 表示可以修改。 */
export function shotFieldProtection(shot: StudioProductionShot, rawPath: string): string | undefined {
    if (shot.locked) return "镜头已锁定";
    if (!shot.manualEditedAt) return undefined;
    const path = normalizeProposalFieldPath(rawPath);
    if (!path) return "字段路径不合法";
    const fields = shot.manualEditedFields;
    if (!fields?.length) return "镜头含未细分的人工编辑，整镜受保护";
    const root = fieldRoot(path);
    if (fields.some((field) => field === "*" || field === path || fieldRoot(field) === root)) {
        return `字段「${fieldLabel(path)}」已有人工编辑，AI 提案不得覆盖`;
    }
    return undefined;
}

function comparable(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

/** 证据缺失或 unknown 时不得应用；旧提案缺独立证据也走同一拒绝路径。 */
export function proposalChangeEvidenceError(change: StudioAiProposalChange): string | undefined {
    if (!change.evidence || !change.evidence.trim()) return "修改项没有独立证据正文，证据等级视为 unknown，不能应用";
    const evidenceType = normalizeAiEvidenceType(change.evidenceType);
    if (evidenceType === "unknown") return "修改项证据不足（unknown），不能应用；请重新审核或人工编辑正式分镜";
    return undefined;
}

export type ProposalChangeValidation =
    | { ok: true; shot: StudioProductionShot; change: StudioAiProposalChange }
    | { ok: false; changeId: string; shotId: string; error: string };

/** 提案生成时已记录 before；应用前必须再次对齐，不能凭猜测写入。 */
export function validateProposalChange(shot: StudioProductionShot, change: StudioAiProposalChange): ProposalChangeValidation {
    const evidenceError = proposalChangeEvidenceError(change);
    if (evidenceError) return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: evidenceError };
    const protectedReason = shotFieldProtection(shot, change.fieldPath);
    if (protectedReason) return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: protectedReason };
    const current = readShotField(shot, change.fieldPath);
    if (!current.ok) return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: current.error };
    if (comparable(current.value) !== comparable(change.before)) {
        return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: `修改前内容与当前镜头不一致：当前「${current.value}」，提案「${change.before}」` };
    }
    const after = change.after.trim();
    if (!after) return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: "修改后内容为空" };
    if (comparable(after) === comparable(current.value)) {
        return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: "修改后内容与当前内容相同" };
    }
    const path = current.fieldPath;
    if (path === "duration") {
        const duration = Number(after);
        if (!Number.isFinite(duration) || duration < 4 || duration > 15) {
            return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: `时长必须在 4–15 秒之间，收到「${after}」` };
        }
        return { ok: true, change, shot: { ...shot, duration, updatedAt: new Date().toISOString() } };
    }
    if (path.startsWith("dialogue[")) {
        const match = path.match(/^dialogue\[(\d+)\]\.(text|delivery|emotion)$/);
        if (!match) return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: "对白字段路径不合法" };
        const index = Number(match[1]);
        if (!shot.dialogue[index]) return { ok: false, changeId: change.changeId, shotId: shot.shotId, error: `对白 ${index + 1} 不存在` };
        const dialogue = shot.dialogue.map((line, lineIndex) => lineIndex === index ? { ...line, [match[2]]: after } : line);
        return { ok: true, change: { ...change, after }, shot: { ...shot, dialogue, updatedAt: new Date().toISOString() } };
    }
    return { ok: true, change: { ...change, after }, shot: { ...shot, [path]: after, updatedAt: new Date().toISOString() } as StudioProductionShot };
}

/** 提案依赖版本：正式分镜与来源剧本都不能在提案生成后被替换。 */
export function proposalDependencyError(
    proposal: StudioAiAdjustmentProposal,
    document: StudioStoryboardDocument,
    scriptVersion?: number,
): string | undefined {
    if (proposal.storyboardVersion !== document.storyboardVersion) {
        return `提案基于 v${proposal.storyboardVersion}，当前分镜是 v${document.storyboardVersion}；禁止静默覆盖`;
    }
    if (proposal.sourceScriptId && document.sourceScriptId !== proposal.sourceScriptId) {
        return `提案基于剧本 ${proposal.sourceScriptId}，当前分镜引用的是 ${document.sourceScriptId}；禁止静默覆盖`;
    }
    if (proposal.sourceScriptVersion !== undefined) {
        if (document.sourceScriptVersion !== proposal.sourceScriptVersion) {
            return `提案基于剧本 v${proposal.sourceScriptVersion}，当前分镜引用的剧本已是 v${document.sourceScriptVersion}；禁止静默覆盖`;
        }
        if (scriptVersion !== undefined && scriptVersion !== proposal.sourceScriptVersion) {
            return `提案基于剧本 v${proposal.sourceScriptVersion}，当前正式剧本已是 v${scriptVersion}；禁止静默覆盖`;
        }
    }
    return undefined;
}

export type ProposalChangePlan =
    | { ok: true; document: StudioStoryboardDocument; applied: StudioAiProposalChange[] }
    | { ok: false; error: string; details: string[] };

/**
 * 只应用所选 changeId；不选中的修改保持原样。多个提案由调用方分别提交，
 * 每次提交都必须重新检查版本与 before，不能用“最新状态”静默覆盖。
 */
export function planProposalChanges(
    document: StudioStoryboardDocument,
    proposal: StudioAiAdjustmentProposal,
    acceptedChangeIds: string[],
    scriptVersion?: number,
): ProposalChangePlan {
    const selectedIds = [...new Set(acceptedChangeIds)];
    if (!selectedIds.length) return { ok: false, error: "没有选择要应用的修改", details: [] };
    const unknown = selectedIds.filter((id) => !proposal.changes.some((change) => change.changeId === id));
    if (unknown.length) return { ok: false, error: "提案不包含所选修改", details: [`未知 changeId：${unknown.join("、")}`] };
    const dependencyError = proposalDependencyError(proposal, document, scriptVersion);
    if (dependencyError) {
        return { ok: false, error: dependencyError, details: ["版本冲突"] };
    }
    const accepted = proposal.changes.filter((change) => selectedIds.includes(change.changeId));
    const seenFields = new Set<string>();
    const updates = new Map<string, StudioProductionShot>();
    const applied: StudioAiProposalChange[] = [];
    const errors: string[] = [];
    for (const change of accepted) {
        const path = normalizeProposalFieldPath(change.fieldPath);
        if (!path) {
            errors.push(`${change.changeId}：字段路径不在白名单`);
            continue;
        }
        const fieldKey = `${change.shotId}:${path}`;
        if (seenFields.has(fieldKey)) {
            errors.push(`${change.changeId}：同一镜头的同一字段在本次提案中重复修改`);
            continue;
        }
        seenFields.add(fieldKey);
        const shot = updates.get(change.shotId) ?? document.shots.find((item) => item.shotId === change.shotId);
        if (!shot) {
            errors.push(`${change.changeId}：镜头 ${change.shotId} 不存在`);
            continue;
        }
        const validation = validateProposalChange(shot, change);
        if (!validation.ok) {
            errors.push(`${change.changeId}：${validation.error}`);
            continue;
        }
        updates.set(change.shotId, validation.shot);
        applied.push({ ...validation.change, fieldPath: path });
    }
    if (errors.length || applied.length !== accepted.length) {
        return { ok: false, error: "部分修改无法安全应用，已整体拒绝本次应用", details: errors };
    }
    const nextDocument: StudioStoryboardDocument = {
        ...document,
        shots: document.shots.map((shot) => updates.get(shot.shotId) ?? shot),
        updatedAt: new Date().toISOString(),
    };
    return { ok: true, document: nextDocument, applied };
}
