// Stage 4D：只用项目级文本模型做分镜审核。模型输出不是正式事实，也不是直接可应用的分镜；
// 所有 findings 先按证据降级，所有 proposals 再按字段白名单和 before 对齐。

import type { StudioProject } from "@/types/studio";
import type {
    StudioAiAdjustmentProposal,
    StudioAiProposalChange,
    StudioAiReviewCategory,
    StudioAiReviewEvidenceType,
    StudioAiReviewFinding,
    StudioContinuityCheckReport,
    StudioContinuityConfidence,
    StudioProductionCheckLevel,
    StudioProductionModelTrace,
    StudioProductionShot,
    StudioScriptDocument,
    StudioStoryboardDocument,
    StudioStoryboardReview,
} from "@/types/studio-production";
import type { NovelTextModelRuntimeOverride } from "./novel-model";
import type { ProductionPrompt } from "./production-prompts";
import { parseProductionJson } from "./production-schema";
import { simpleHash } from "./novel-chapters";
import { fieldLabel, normalizeProposalFieldPath, readShotField, shotFieldProtection } from "./stage4d-engine";
import { normalizeAiEvidenceType } from "./review-evidence";

export const STAGE4D_REVIEW_PROMPT_VERSION = "stage4d-storyboard-review-v2";
export const STAGE4D_EDITABLE_FIELDS = "shotSize, cameraPosition, cameraAngle, lens, cameraMovement, composition, foreground, midground, background, characterBlocking, eyeline, action, facialExpression, emotion, voiceOver, soundEffects, backgroundMusic, lighting, environment, imagePrompt, videoPrompt, duration, dialogue[N].text, dialogue[N].delivery, dialogue[N].emotion";

const nowIso = () => new Date().toISOString();

const REVIEW_CATEGORIES: StudioAiReviewCategory[] = ["人物", "场景", "动作", "空间关系", "轴线", "视线", "道具", "情绪", "对白", "镜头衔接", "景别", "机位", "运镜", "角色外观", "服装连续性", "其他"];

type RawFinding = {
    level?: unknown;
    category?: unknown;
    message?: unknown;
    reason?: unknown;
    suggestion?: unknown;
    shotIds?: unknown;
    fieldPath?: unknown;
    evidence?: unknown;
    evidenceType?: unknown;
    confidence?: unknown;
    speculative?: unknown;
};

type RawChange = {
    shotId?: unknown;
    fieldPath?: unknown;
    before?: unknown;
    after?: unknown;
    reason?: unknown;
    impact?: unknown;
    evidence?: unknown;
    evidenceType?: unknown;
    confidence?: unknown;
    speculative?: unknown;
    sourceShotIds?: unknown;
    sourceChapterId?: unknown;
    sourceVersion?: unknown;
};

type RawProposal = {
    title?: unknown;
    rationale?: unknown;
    confidence?: unknown;
    changes?: unknown;
};

type RawReview = {
    summary?: unknown;
    findings?: unknown;
    proposals?: unknown;
};

function str(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function level(value: unknown): StudioProductionCheckLevel {
    return value === "error" || value === "warning" || value === "suggestion" ? value : "suggestion";
}

function confidence(value: unknown): StudioContinuityConfidence {
    return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function category(value: unknown): StudioAiReviewCategory {
    return REVIEW_CATEGORIES.includes(value as StudioAiReviewCategory) ? value as StudioAiReviewCategory : "其他";
}

function evidenceType(value: unknown): StudioAiReviewEvidenceType {
    return normalizeAiEvidenceType(value);
}

function compactShot(shot: StudioProductionShot) {
    return {
        shotId: shot.shotId,
        shotNumber: shot.shotNumber,
        sceneId: shot.sceneId,
        shotGroupId: shot.shotGroupId,
        duration: shot.duration,
        shotSize: shot.shotSize,
        cameraPosition: shot.cameraPosition,
        cameraAngle: shot.cameraAngle,
        lens: shot.lens,
        cameraMovement: shot.cameraMovement,
        composition: shot.composition,
        foreground: shot.foreground,
        midground: shot.midground,
        background: shot.background,
        characterBlocking: shot.characterBlocking,
        eyeline: shot.eyeline,
        action: shot.action,
        facialExpression: shot.facialExpression,
        emotion: shot.emotion,
        dialogue: shot.dialogue,
        voiceOver: shot.voiceOver,
        soundEffects: shot.soundEffects,
        backgroundMusic: shot.backgroundMusic,
        lighting: shot.lighting,
        environment: shot.environment,
        imagePrompt: shot.imagePrompt,
        videoPrompt: shot.videoPrompt,
        characterBindings: shot.characterBindings,
        outfitBindings: shot.outfitBindings,
        sceneBindings: shot.sceneBindings,
        propBindings: shot.propBindings,
        continuity: shot.continuity,
        locked: shot.locked,
        manualEditedAt: shot.manualEditedAt,
        manualEditedFields: shot.manualEditedFields,
    };
}

function compactScene(script: StudioScriptDocument | undefined, sceneId: string) {
    const scene = script?.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return undefined;
    return {
        sceneId: scene.sceneId,
        sceneNumber: scene.sceneNumber,
        sceneTitle: scene.sceneTitle,
        locationId: scene.locationId,
        locationVariantId: scene.locationVariantId,
        timeOfDay: scene.timeOfDay,
        environment: scene.environment,
        charactersPresent: scene.charactersPresent,
        props: scene.props,
        scenePurpose: scene.scenePurpose,
        conflict: scene.conflict,
        action: scene.action,
        dialogueBlocks: scene.dialogueBlocks,
        transitionIn: scene.transitionIn,
        transitionOut: scene.transitionOut,
        continuityNotes: scene.continuityNotes,
    };
}

function relevantContinuity(report: StudioContinuityCheckReport, shotIds: string[]): StudioContinuityCheckReport {
    if (report.scope.type === "episode" && shotIds.length && shotIds.length < report.checkedShots) {
        const findings = report.findings.filter((finding) => finding.shotIds.some((id) => shotIds.includes(id)));
        const gaps = report.gaps.filter((gap) => gap.shotIds.some((id) => shotIds.includes(id)));
        return {
            ...report,
            findings,
            gaps,
            counts: {
                error: findings.filter((item) => item.severity === "error").length,
                warning: findings.filter((item) => item.severity === "warning").length,
                suggestion: findings.filter((item) => item.severity === "suggestion").length,
                insufficient: gaps.length,
            },
        };
    }
    return report;
}

function continuityPromptView(report: StudioContinuityCheckReport) {
    return {
        checkId: report.checkId,
        storyboardVersion: report.storyboardVersion,
        scope: report.scope,
        counts: report.counts,
        findings: report.findings,
        gaps: report.gaps,
    };
}

function promptScenes(document: StudioStoryboardDocument, script: StudioScriptDocument | undefined, shotIds: string[]) {
    const sceneIds = [...new Set(shotIds.map((shotId) => document.shots.find((shot) => shot.shotId === shotId)?.sceneId).filter((id): id is string => Boolean(id)))];
    return sceneIds.map((sceneId) => compactScene(script, sceneId)).filter((scene): scene is NonNullable<typeof scene> => Boolean(scene));
}

/**
 * 审核 Prompt 与证据库共用同一份输入视图，避免“模型收到 A、校验使用 B”。
 * 选中镜头和相邻镜头都按正式分镜顺序取，保证两次构造的 JSON 完全一致。
 */
function createReviewInputView(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    selectedIds: string[];
    contextIds?: string[];
    scopeType: "shot" | "selection" | "episode";
    continuity: StudioContinuityCheckReport;
    review?: StudioStoryboardReview;
}) {
    const selectedIds = input.document.shots
        .filter((shot) => input.selectedIds.includes(shot.shotId))
        .map((shot) => shot.shotId);
    const selectedShots = input.document.shots.filter((shot) => selectedIds.includes(shot.shotId));
    const contextShots = input.document.shots
        .filter((shot) => (input.contextIds ?? []).includes(shot.shotId) && !selectedIds.includes(shot.shotId));
    const scenes = promptScenes(input.document, input.script, selectedIds);
    const continuity = relevantContinuity(input.continuity, input.scopeType === "episode" ? [] : selectedIds);
    const existingIssues = (input.review?.issues ?? [])
        .filter((issue) => issue.status === "open" && (!issue.shotId || selectedIds.includes(issue.shotId) || (issue.shotIds ?? []).some((id) => selectedIds.includes(id))))
        .slice(0, 40)
        .map((issue) => ({ level: issue.level, ruleId: issue.ruleId, shotId: issue.shotId, shotIds: issue.shotIds, message: issue.message, evidence: issue.evidence, suggestion: issue.suggestion }));
    return { selectedIds, selectedShots, contextShots, scenes, continuity, existingIssues };
}

export function buildStoryboardReviewPrompt(input: {
    project: StudioProject;
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    shots: StudioProductionShot[];
    contextShots?: StudioProductionShot[];
    scopeType: "shot" | "selection" | "episode";
    continuity: StudioContinuityCheckReport;
    review?: StudioStoryboardReview;
}): ProductionPrompt {
    const view = createReviewInputView({
        document: input.document,
        script: input.script,
        selectedIds: input.shots.map((shot) => shot.shotId),
        contextIds: (input.contextShots ?? []).map((shot) => shot.shotId),
        scopeType: input.scopeType,
        continuity: input.continuity,
        review: input.review,
    });
    const { selectedIds, selectedShots, contextShots, scenes, continuity, existingIssues } = view;
    const system = [
        "你是短剧分镜审核员，不是编剧。只审核输入中给出的正式分镜、剧本场景和 4C 连续性检查结果。",
        "必须区分「镜头/剧本中可直接核对的事实」与「你的推测」。证据等级只能是 explicit（输入可直接核对）、inference（推测）、suggestion（创作建议）、unknown（证据不足）；推测必须 evidenceType=inference 且 speculative=true，禁止把推测、建议或证据不足写成原著事实。",
        "检查范围必须覆盖：景别合理性、机位、运镜与动作/空间匹配、相邻镜头运镜连续性、角色外观一致性、服装连续性、服装变体与场景/时间/状态匹配、人物一致性、场景、动作、空间关系、轴线、视线、道具、情绪、对白、镜头衔接。",
        "不得只检查字段是否填写；必须判断字段值与剧本场景、相邻镜头、人物/服装/场景/道具绑定和 4C 连续性结果是否一致。字段缺失且无法判断时标 unknown，不能编造。",
        "只输出 JSON 对象，不要 Markdown，不要解释。字段：summary, findings, proposals。",
        "findings 每项：level(error|warning|suggestion), category, message, reason, suggestion, shotIds, fieldPath?, evidence, evidenceType(explicit|inference|suggestion|unknown), confidence(high|medium|low), speculative(boolean)。",
        "proposals 每项：title, rationale, confidence, changes[]。changes 每项：shotId, fieldPath, before, after, reason, impact, evidence, evidenceType, confidence, speculative, sourceShotIds?(证据来源镜头), sourceChapterId?(证据来源章节), sourceVersion?(证据来源版本)。",
        "proposal 只能修改这些字段：" + STAGE4D_EDITABLE_FIELDS + "。不得修改 shotId、sceneId、shotGroupId、characterId、locationId、propId、绑定、版本、locked、manualEdited 标记。",
        "before 必须与输入中的当前值完全一致；after 必须是可直接写入的完整新值；duration 必须在 4–15 秒。无法确定时不要生成 proposal。",
        "已有 locked 或人工编辑保护的字段不得提案。不要为了凑数生成提案；没有明确可改进项就返回空 proposals。",
        "findings 必须给出对应 shotIds；没有证据时 evidenceType=unknown，不得降级成 inference 冒充模型推断。",
        "proposal change 必须有独立 evidence 正文；空证据、unknown 或 evidence 未在输入中出现时不得生成该 change。",
    ].join("\n");
    const user = [
        `项目：${input.project.title}`,
        `分集：第 ${input.document.episodeNumber} 集 / ${input.document.episodeId}`,
        `审核范围：${input.scopeType}；选中镜头：${selectedIds.join("、") || "（无）"}`,
        `正式分镜版本：v${input.document.storyboardVersion}`,
        "",
        "【选中镜头】",
        JSON.stringify(selectedShots.map(compactShot)),
        "",
        "【相邻镜头（仅用于衔接判断）】",
        JSON.stringify(contextShots.map(compactShot)),
        "",
        "【相关剧本场景】",
        JSON.stringify(scenes),
        "",
        "【4C 连续性检查结果】",
        JSON.stringify(continuityPromptView(continuity)),
        "",
        "【已有确定性审核问题】",
        JSON.stringify(existingIssues),
        "",
        "请输出严格 JSON：{\"summary\":\"...\",\"findings\":[...],\"proposals\":[...]}",
    ].join("\n");
    return {
        system,
        user,
        promptVersion: STAGE4D_REVIEW_PROMPT_VERSION,
        inputChars: system.length + user.length,
    };
}

export type ParsedStoryboardAiReview = {
    summary: string;
    findings: StudioAiReviewFinding[];
    proposals: StudioAiAdjustmentProposal[];
    warnings: string[];
};

export function buildStoryboardReviewEvidenceCorpus(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    scopeType: "shot" | "selection" | "episode";
    scopeShotIds: string[];
    shotIds: string[];
    continuity: StudioContinuityCheckReport;
}) {
    const view = createReviewInputView({
        document: input.document,
        script: input.script,
        selectedIds: input.scopeShotIds,
        contextIds: input.shotIds,
        scopeType: input.scopeType,
        continuity: input.continuity,
    });
    const shots = [...view.selectedShots, ...view.contextShots].map(compactShot);
    return {
        shot_text: JSON.stringify(shots),
        script_text: JSON.stringify(view.scenes),
        continuity_report: JSON.stringify(continuityPromptView(view.continuity)),
    };
}

/**
 * 证据校验：explicit 必须能在实际发送的输入中找到；找不到只能降为 inference。
 * unknown 表示证据不足，绝不映射成“低置信度 inference”；suggestion 允许是创作建议，但同样要保留独立正文。
 */
function normalizeEvidence(input: {
    finding: RawFinding;
    corpus: ReturnType<typeof buildStoryboardReviewEvidenceCorpus>;
    fallbackReason: string;
}): { evidence: string; evidenceType: StudioAiReviewEvidenceType; speculative: boolean; reasonSuffix: string } {
    const evidence = str(input.finding.evidence);
    const claimed = evidenceType(input.finding.evidenceType);
    if (!evidence) {
        return { evidence: "", evidenceType: "unknown", speculative: true, reasonSuffix: "；未提供可核对证据（unknown）" };
    }
    if (claimed === "unknown") return { evidence, evidenceType: "unknown", speculative: true, reasonSuffix: "；证据不足（unknown）" };
    if (claimed === "inference") return { evidence, evidenceType: "inference", speculative: true, reasonSuffix: "" };
    if (claimed === "suggestion") return { evidence, evidenceType: "suggestion", speculative: input.finding.speculative === true, reasonSuffix: "" };
    const corpusValues = [input.corpus.shot_text, input.corpus.script_text, input.corpus.continuity_report];
    if (!corpusValues.some((text) => text.includes(evidence))) {
        return { evidence, evidenceType: "inference", speculative: true, reasonSuffix: "；证据未在实际输入中找到，已降级为推断" };
    }
    return { evidence, evidenceType: "explicit", speculative: input.finding.speculative === true, reasonSuffix: input.fallbackReason };
}

export function parseStoryboardAiReview(input: {
    text: string;
    runId: string;
    projectId?: string;
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    scopeType: "shot" | "selection" | "episode";
    scopeShotIds: string[];
    allowedFindingShotIds: string[];
    allowedProposalShotIds: string[];
    continuity: StudioContinuityCheckReport;
    now?: string;
}): ParsedStoryboardAiReview {
    const raw = parseProductionJson<RawReview>(input.text, "");
    const findingsRaw = Array.isArray(raw.findings) ? raw.findings.slice(0, 40) : [];
    const proposalsRaw = Array.isArray(raw.proposals) ? raw.proposals.slice(0, 10) : [];
    const warnings: string[] = [];
    const now = input.now ?? nowIso();
    const corpus = buildStoryboardReviewEvidenceCorpus({
        document: input.document,
        script: input.script,
        scopeType: input.scopeType,
        scopeShotIds: input.scopeShotIds,
        shotIds: input.allowedFindingShotIds,
        continuity: input.continuity,
    });
    const findings: StudioAiReviewFinding[] = [];
    for (const [index, item] of findingsRaw.entries()) {
        if (!item || typeof item !== "object") {
            warnings.push(`findings[${index}] 不是对象，已丢弃`);
            continue;
        }
        const finding = item as RawFinding;
        const message = str(finding.message);
        if (!message) {
            warnings.push(`findings[${index}] 缺少 message，已丢弃`);
            continue;
        }
        const rawShotIds = Array.isArray(finding.shotIds) ? finding.shotIds.filter((id): id is string => typeof id === "string") : [];
        const shotIds = rawShotIds.filter((id) => input.document.shots.some((shot) => shot.shotId === id));
        if (!shotIds.length) {
            const fallback = input.scopeShotIds.length === 1 ? input.scopeShotIds[0] : undefined;
            if (!fallback) {
                warnings.push(`findings[${index}] 没有对应镜头，已丢弃`);
                continue;
            }
            warnings.push(`findings[${index}] 未给出有效镜头，已归到 ${fallback}`);
            shotIds.push(fallback);
        }
        if (shotIds.some((id) => !input.allowedFindingShotIds.includes(id))) {
            warnings.push(`findings[${index}] 引用了审核范围外镜头，已丢弃`);
            continue;
        }
        const evidence = normalizeEvidence({ finding, corpus, fallbackReason: "" });
        const reason = str(finding.reason) || "模型未说明原因";
        findings.push({
            id: `ai-finding-${simpleHash(`${input.runId}:${index}:${message}`)}`,
            level: level(finding.level),
            category: category(finding.category),
            message,
            reason: `${reason}${evidence.reasonSuffix}`,
            suggestion: str(finding.suggestion) || "请人工确认该问题",
            shotIds,
            fieldPath: str(finding.fieldPath) || undefined,
            evidence: evidence.evidence,
            evidenceType: evidence.evidenceType,
            confidence: confidence(finding.confidence),
            speculative: evidence.speculative,
        });
    }
    const proposals: StudioAiAdjustmentProposal[] = [];
    for (const [proposalIndex, item] of proposalsRaw.entries()) {
        if (!item || typeof item !== "object") continue;
        const proposal = item as RawProposal;
        const title = str(proposal.title);
        if (!title) {
            warnings.push(`proposals[${proposalIndex}] 缺少标题，已丢弃`);
            continue;
        }
        const changesRaw = Array.isArray(proposal.changes) ? proposal.changes.slice(0, 8) : [];
        const changes: StudioAiProposalChange[] = [];
        for (const [changeIndex, rawChange] of changesRaw.entries()) {
            if (!rawChange || typeof rawChange !== "object") continue;
            const change = rawChange as RawChange;
            const shotId = str(change.shotId);
            const shot = input.document.shots.find((item) => item.shotId === shotId);
            if (!shot || !input.allowedProposalShotIds.includes(shotId)) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] 镜头不在审核范围，已丢弃`);
                continue;
            }
            const path = normalizeProposalFieldPath(str(change.fieldPath));
            if (!path) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] 字段不在白名单，已丢弃`);
                continue;
            }
            const protection = shotFieldProtection(shot, path);
            if (protection) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] ${protection}，已丢弃`);
                continue;
            }
            const current = readShotField(shot, path);
            if (!current.ok) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] ${current.error}，已丢弃`);
                continue;
            }
            const before = str(change.before);
            const after = str(change.after);
            if (before.replace(/\s+/g, " ").trim() !== current.value.replace(/\s+/g, " ").trim()) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] before 与当前值不一致，已丢弃`);
                continue;
            }
            if (!after || after.replace(/\s+/g, " ").trim() === current.value.replace(/\s+/g, " ").trim()) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] after 为空或与当前值相同，已丢弃`);
                continue;
            }
            if (path === "duration") {
                const duration = Number(after);
                if (!Number.isFinite(duration) || duration < 4 || duration > 15) {
                    warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] 时长不在 4–15 秒，已丢弃`);
                    continue;
                }
            }
            const changeEvidence = normalizeEvidence({
                finding: { evidence: change.evidence, evidenceType: change.evidenceType, speculative: change.speculative },
                corpus,
                fallbackReason: "",
            });
            if (!changeEvidence.evidence) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] 未提供 evidence，保留为 unknown；应用前会被拒绝`);
            } else if (changeEvidence.evidenceType === "unknown") {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] 证据不足（unknown）；应用前会被拒绝`);
            }
            const allowedSourceShotIds = new Set(input.allowedFindingShotIds);
            const requestedSourceShotIds = Array.isArray(change.sourceShotIds)
                ? change.sourceShotIds.filter((id): id is string => typeof id === "string")
                : [];
            const sourceShotIds = [...new Set(requestedSourceShotIds.filter((id) => allowedSourceShotIds.has(id)))];
            const rejectedSourceShotIds = requestedSourceShotIds.filter((id) => !allowedSourceShotIds.has(id));
            if (rejectedSourceShotIds.length) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] sourceShotIds 不在本次实际发送范围，已丢弃：${rejectedSourceShotIds.join(", ")}`);
            }
            const modelSourceVersion = str(change.sourceVersion);
            const actualSourceVersion = String(input.document.storyboardVersion);
            if (modelSourceVersion && modelSourceVersion.replace(/^v/i, "") !== actualSourceVersion) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] sourceVersion 与本次请求快照不一致，已以实际版本 v${actualSourceVersion} 为准`);
            }
            if (str(change.sourceChapterId)) {
                warnings.push(`proposals[${proposalIndex}].changes[${changeIndex}] sourceChapterId 不在本次实际输入范围，已清空`);
            }
            changes.push({
                changeId: `ai-change-${simpleHash(`${input.runId}:${proposalIndex}:${changeIndex}:${shotId}:${path}:${after}`)}`,
                shotId,
                fieldPath: path,
                fieldLabel: fieldLabel(path),
                before: current.value,
                after,
                reason: str(change.reason) || "模型未说明原因",
                impact: str(change.impact) || "仅影响该字段及依赖该镜头的后续检查",
                evidence: changeEvidence.evidence,
                evidenceType: changeEvidence.evidenceType,
                confidence: confidence(change.confidence ?? proposal.confidence),
                speculative: change.speculative === true || changeEvidence.evidenceType === "inference" || changeEvidence.evidenceType === "unknown",
                sourceShotIds: sourceShotIds.length ? sourceShotIds : undefined,
                sourceChapterId: undefined,
                sourceVersion: sourceShotIds.length ? actualSourceVersion : undefined,
                sourceStatus: sourceShotIds.length ? "confirmed" : "unconfirmed",
            });
        }
        if (!changes.length) {
            warnings.push(`proposals[${proposalIndex}]「${title}」没有可安全应用的修改，已丢弃`);
            continue;
        }
        proposals.push({
            proposalId: `ai-proposal-${simpleHash(`${input.runId}:${proposalIndex}:${title}`)}`,
            runId: input.runId,
            projectId: input.projectId,
            episodeId: input.document.episodeId,
            episodeNumber: input.document.episodeNumber,
            storyboardVersion: input.document.storyboardVersion,
            sourceScriptVersion: input.document.sourceScriptVersion,
            sourceScriptId: input.document.sourceScriptId,
            title,
            rationale: str(proposal.rationale) || "模型未说明理由",
            confidence: confidence(proposal.confidence),
            changes,
            decision: { status: "pending", acceptedChangeIds: [], rejectedChangeIds: [] },
            createdAt: now,
            updatedAt: now,
        });
    }
    return {
        summary: str(raw.summary) || "模型未返回审核总结",
        findings,
        proposals,
        warnings: warnings.slice(0, 30),
    };
}

export type StoryboardAiReviewCallResult = {
    parsed: ParsedStoryboardAiReview;
    trace: StudioProductionModelTrace;
    promptVersion: string;
    rawText: string;
};

export async function callStoryboardAiReview(input: {
    project: StudioProject;
    prompt: ProductionPrompt;
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    scopeType: "shot" | "selection" | "episode";
    scopeShotIds: string[];
    allowedFindingShotIds: string[];
    allowedProposalShotIds: string[];
    continuity: StudioContinuityCheckReport;
    runId: string;
    model?: NovelTextModelRuntimeOverride;
    signal?: AbortSignal;
}): Promise<StoryboardAiReviewCallResult> {
    const { generateProjectText } = await import("./production-ai");
    const { text, trace } = await generateProjectText(input.project, input.prompt, { signal: input.signal, model: input.model });
    const parsed = parseStoryboardAiReview({
        text,
        runId: input.runId,
        projectId: input.project.id,
        document: input.document,
        script: input.script,
        scopeType: input.scopeType,
        scopeShotIds: input.scopeShotIds,
        allowedFindingShotIds: input.allowedFindingShotIds,
        allowedProposalShotIds: input.allowedProposalShotIds,
        continuity: input.continuity,
    });
    return { parsed, trace, promptVersion: input.prompt.promptVersion, rawText: text };
}

/** 审核记录只保留可核对的结构化结果，不把原始长文本塞进 IndexedDB；调用 trace 足够审计。 */
export function buildAiReviewRun(input: {
    runId: string;
    projectId?: string;
    document: StudioStoryboardDocument;
    scopeType: "shot" | "selection" | "episode";
    scopeShotIds: string[];
    continuity: StudioContinuityCheckReport;
    parsed?: ParsedStoryboardAiReview;
    trace?: StudioProductionModelTrace;
    promptVersion: string;
    error?: string;
    startedAt: string;
}): import("@/types/studio-production").StudioAiReviewRun {
    const finishedAt = nowIso();
    return {
        runId: input.runId,
        projectId: input.projectId,
        episodeId: input.document.episodeId,
        episodeNumber: input.document.episodeNumber,
        storyboardVersion: input.document.storyboardVersion,
        scope: { type: input.scopeType, shotIds: input.scopeShotIds },
        continuityCheckId: input.continuity.checkId,
        status: input.error ? "failed" : "completed",
        summary: input.parsed?.summary ?? (input.error ? `审核失败：${input.error}` : ""),
        findings: input.parsed?.findings ?? [],
        warnings: input.parsed?.warnings ?? [],
        promptVersion: input.promptVersion,
        modelTrace: input.trace,
        error: input.error,
        startedAt: input.startedAt,
        finishedAt,
        createdAt: finishedAt,
        updatedAt: finishedAt,
    };
}
