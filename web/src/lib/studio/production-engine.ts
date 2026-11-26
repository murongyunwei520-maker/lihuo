// 阶段 3 核心规则：2B handoff 准入、剧本/分镜确定性校验、时长估算与镜头组连续性。
// 这一层不导入 React / store，便于用项目 A 的真实 handoff 做确定性测试。

import { simpleHash } from "./novel-chapters";
import { createStoryboardSnapshot } from "./storyboard-snapshots";
import type { StudioEpisode, StudioProject } from "@/types/studio";
import type { StudioAdaptationCheck, StudioAdaptationHandoff, StudioCharacterArc } from "@/types/studio-adaptation";
import type {
    StudioEpisodeProduction,
    StudioHandoffIssue,
    StudioProductionAdmission,
    StudioProductionAssetIndex,
    StudioProductionCheck,
    StudioProductionHandoffSnapshot,
    StudioProductionJob,
    StudioProductionJobKind,
    StudioProductionRawScript,
    StudioProductionRawStoryboard,
    StudioScriptDocument,
    StudioScriptDurationEstimate,
    StudioScriptScene,
    StudioShotGroup,
    StudioStoryboardDocument,
    StudioStoryboardVersion,
    StudioProductionShot,
} from "@/types/studio-production";

const nowIso = () => new Date().toISOString();

function checkId(key: string) {
    return `stage3-check-${simpleHash(key)}`;
}

function issueFromCheck(check: StudioAdaptationCheck): StudioHandoffIssue {
    return {
        id: `handoff-issue-${check.id}`,
        level: check.level,
        code: check.code,
        category: check.category,
        message: check.message,
        suggestion: check.suggestion ?? "",
        episodeNumbers: Array.isArray(check.episodeNumbers) ? check.episodeNumbers : [],
        status: check.status,
        source: "stage2b",
    };
}

/** 只投影与当前集相关的 2B 问题；全剧级问题（无集数）仍显示，但不把其他集的问题拖进来。 */
export function handoffIssuesForEpisode(handoff: StudioAdaptationHandoff, episodeNumber: number): StudioHandoffIssue[] {
    return handoff.checks
        .filter((check) => check.status === "open")
        .filter((check) => !check.episodeNumbers.length || check.episodeNumbers.includes(episodeNumber))
        .map(issueFromCheck);
}

export function handoffIssuesForProject(handoff: StudioAdaptationHandoff): StudioHandoffIssue[] {
    return handoff.checks.filter((check) => check.status === "open").map(issueFromCheck);
}

/** 交接快照只存版本与计数，不复制 2B 全量数据；当前有效内容始终从 adaptationHandoff 读取。 */
export function productionHandoffSnapshot(handoff: StudioAdaptationHandoff): StudioProductionHandoffSnapshot {
    const checks = handoff.checks.filter((check) => check.status === "open");
    return {
        projectId: handoff.projectId,
        analysisVersion: handoff.analysisVersion,
        blueprintId: handoff.blueprintId,
        blueprintVersion: handoff.blueprintVersion,
        packageVersion: handoff.packageVersion,
        handoffSnapshotId: handoff.snapshotId,
        episodePlanCount: handoff.episodePlans.length,
        lockedEpisodeNumbers: handoff.lockedEpisodeNumbers,
        checkCount: checks.length,
        errorCount: checks.filter((check) => check.level === "error").length,
        warningCount: checks.filter((check) => check.level === "warning").length,
        suggestionCount: checks.filter((check) => check.level === "suggestion").length,
        createdAt: nowIso(),
    };
}

/**
 * 按集准入：draftAllowed 表示可生成“草稿预览”；formalAllowed 表示可进入后续正式生产/锁定。
 * 2B 的 warning 不会因为 Stage 3 补了转场自动消失，仍由 2B 账本保持 open。
 */
export function productionAdmission(handoff: StudioAdaptationHandoff, episodeNumber: number): StudioProductionAdmission {
    const plan = handoff.episodePlans.find((item) => item.episodeNumber === episodeNumber);
    if (!plan) {
        return {
            episodeNumber,
            sourcePlanId: "",
            draftAllowed: false,
            formalAllowed: false,
            blocking: [`第 ${episodeNumber} 集没有对应的 2B 分集规划`],
            review: [],
            info: [],
            pendingHighRiskChanges: [],
            unresolvedErrors: [],
            handoffWarnings: [],
            handoffSuggestions: [],
        };
    }
    const issues = handoffIssuesForEpisode(handoff, episodeNumber);
    const unresolvedErrors = issues.filter((issue) => issue.level === "error");
    const handoffWarnings = issues.filter((issue) => issue.level === "warning");
    const handoffSuggestions = issues.filter((issue) => issue.level === "suggestion");
    const pendingHighRiskChanges = handoff.changes.filter(
        (change) =>
            change.highRisk &&
            change.reviewStatus !== "approved" &&
            change.reviewStatus !== "locked" &&
            (!change.episodeNumbers.length || change.episodeNumbers.includes(episodeNumber)),
    );
    const unconfirmedGeneratedReturns = generatedReturnsWithoutConfirmation(handoff.characterArcs, plan.episodeNumber);
    const planStatusOk = plan.reviewStatus === "approved" || plan.reviewStatus === "locked";
    const blueprintStatusOk = handoff.blueprintReviewStatus === "approved" || handoff.blueprintReviewStatus === "locked" || handoff.lockedBlueprint;
    const strategyStatusOk = handoff.strategyReviewStatus === "approved" || handoff.strategyReviewStatus === "locked";
    const blocking = [
        ...unresolvedErrors.map((issue) => `2B 错误：${issue.message}`),
        ...unconfirmedGeneratedReturns.map((arc) => `人物「${arc.characterName}」的 AI 复活未被用户确认`),
    ];
    const review = [
        ...(planStatusOk ? [] : [`第 ${episodeNumber} 集分集规划仍为${plan.reviewStatus === "draft" ? "草稿" : "待审核"}`]),
        ...(blueprintStatusOk ? [] : [`全剧蓝图仍为${handoff.blueprintReviewStatus === "draft" ? "草稿" : "待审核"}`]),
        ...(strategyStatusOk ? [] : [`改编方案仍为${handoff.strategyReviewStatus === "draft" ? "草稿" : "待审核"}`]),
        ...pendingHighRiskChanges.map((change) => `高风险改编「${change.adaptationChangeId}」未逐条确认`),
        ...handoffWarnings.map((issue) => `2B 警告：${issue.message}`),
    ];
    const info = handoffSuggestions.map((issue) => `2B 建议：${issue.message}`);
    return {
        episodeNumber,
        sourcePlanId: plan.episodeId,
        draftAllowed: true,
        formalAllowed: planStatusOk && blueprintStatusOk && strategyStatusOk && !blocking.length && !pendingHighRiskChanges.length,
        blocking,
        review,
        info,
        pendingHighRiskChanges,
        unresolvedErrors,
        handoffWarnings,
        handoffSuggestions,
    };
}

function generatedReturnsWithoutConfirmation(arcs: StudioCharacterArc[], episodeNumber: number) {
    return arcs.filter((arc) =>
        arc.milestones.some(
            (milestone) =>
                milestone.type === "return" &&
                milestone.sourceType === "generated" &&
                !milestone.confirmedAt &&
                milestone.episodeNumber <= episodeNumber &&
                arc.timeline.some((point) => point.episodeNumber === episodeNumber && point.present),
        ),
    );
}

/** 单场预算：与整集估算同一套口径，用于分镜时长校准，不按镜头数量平均。 */
export function estimateSceneDuration(scene: StudioScriptScene): number {
    let dialogueSeconds = 0;
    let actionSeconds = 0;
    let transitionSeconds = 0;
    let pauseSeconds = 0;
    let environmentSeconds = 0;
    for (const block of scene.dialogueBlocks) {
        dialogueSeconds += block.text.replace(/\s/g, "").length / 4.2;
        pauseSeconds += block.text.includes("……") ? 1.2 : 0.45;
    }
    const actionChars = scene.action.replace(/\s/g, "").length;
    actionSeconds += Math.max(2, Math.min(16, (actionChars / 32) * 4));
    if (scene.transitionIn.trim()) transitionSeconds += 1.1;
    if (scene.transitionOut.trim()) transitionSeconds += 1.4;
    environmentSeconds += Math.max(1, Math.min(4, scene.environment.replace(/\s/g, "").length / 22));
    return Math.round((dialogueSeconds + actionSeconds + transitionSeconds + pauseSeconds + environmentSeconds) * 10) / 10;
}

/** 按对白、动作、转场、停顿和环境镜头估算，不把中文字符数直接当成视频秒数。 */
export function estimateScriptDuration(scenes: StudioScriptScene[], targetSeconds: number): StudioScriptDurationEstimate {
    let dialogueSeconds = 0;
    let actionSeconds = 0;
    let transitionSeconds = 0;
    let pauseSeconds = 0;
    let environmentSeconds = 0;
    for (const scene of scenes) {
        for (const block of scene.dialogueBlocks) {
            dialogueSeconds += block.text.replace(/\s/g, "").length / 4.2;
            pauseSeconds += block.text.includes("……") ? 1.2 : 0.45;
        }
        const actionChars = scene.action.replace(/\s/g, "").length;
        actionSeconds += Math.max(2, Math.min(16, actionChars / 32 * 4));
        if (scene.transitionIn.trim()) transitionSeconds += 1.1;
        if (scene.transitionOut.trim()) transitionSeconds += 1.4;
        environmentSeconds += Math.max(1, Math.min(4, scene.environment.replace(/\s/g, "").length / 22));
    }
    const totalSeconds = Math.round((dialogueSeconds + actionSeconds + transitionSeconds + pauseSeconds + environmentSeconds) * 10) / 10;
    return {
        dialogueSeconds: Math.round(dialogueSeconds * 10) / 10,
        actionSeconds: Math.round(actionSeconds * 10) / 10,
        transitionSeconds: Math.round(transitionSeconds * 10) / 10,
        pauseSeconds: Math.round(pauseSeconds * 10) / 10,
        environmentSeconds: Math.round(environmentSeconds * 10) / 10,
        totalSeconds,
        deltaSeconds: Math.round((totalSeconds - targetSeconds) * 10) / 10,
        note: "按对白字数、动作、转场、停顿和环境镜头估算；不是视频成片时长承诺。",
    };
}

/** 模型常把单镜写成 10–18 秒，导致整集远超目标；这里只校准镜头时长，不删镜头、不改剧情。 */
export function calibrateStoryboardDurations(shots: StudioProductionShot[], sceneBudgetSeconds: number) {
    const rawSeconds = Math.round(shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0) * 10) / 10;
    if (!shots.length || rawSeconds <= 0 || sceneBudgetSeconds <= 0) return { shots, rawSeconds, targetSeconds: sceneBudgetSeconds, factor: 1, adjusted: false };
    const factor = sceneBudgetSeconds / rawSeconds;
    const calibrated = shots.map((shot) => ({
        ...shot,
        duration: Math.max(1, Math.min(12, Math.round((Number(shot.duration) || 1) * factor * 10) / 10)),
    }));
    const total = Math.round(calibrated.reduce((sum, shot) => sum + shot.duration, 0) * 10) / 10;
    const diff = Math.round((sceneBudgetSeconds - total) * 10) / 10;
    const last = calibrated.at(-1);
    if (last && Math.abs(diff) >= 0.1) {
        last.duration = Math.max(1, Math.min(12, Math.round((last.duration + diff) * 10) / 10));
    }
    return {
        shots: calibrated,
        rawSeconds,
        targetSeconds: Math.round(sceneBudgetSeconds * 10) / 10,
        factor: Math.round(factor * 100) / 100,
        adjusted: Math.abs(rawSeconds - sceneBudgetSeconds) > Math.max(1, sceneBudgetSeconds * 0.15),
    };
}

export function scriptDurationLevel(estimate: StudioScriptDurationEstimate, targetSeconds: number): "ok" | "warning" | "error" {
    const ratio = targetSeconds ? estimate.totalSeconds / targetSeconds : 1;
    if (ratio > 1.35 || ratio < 0.55) return "error";
    if (ratio > 1.15 || ratio < 0.8) return "warning";
    return "ok";
}

function makeCheck(input: Omit<StudioProductionCheck, "id" | "status" | "createdAt" | "updatedAt">): StudioProductionCheck {
    const now = nowIso();
    return {
        ...input,
        id: checkId(`${input.code}:${input.episodeNumber}:${input.sceneId ?? ""}:${input.shotGroupId ?? ""}:${input.shotId ?? ""}:${input.message}`),
        status: "open",
        createdAt: now,
        updatedAt: now,
    };
}

/** 剧本层确定性校验：只判断结构、引用与基本连续性，不冒充模型审美判断。 */
export function validateScriptDocument(document: StudioScriptDocument, context: { targetSeconds: number; assetIndex?: StudioProductionAssetIndex }): StudioProductionCheck[] {
    const checks: StudioProductionCheck[] = [];
    const base = { episodeNumber: document.episodeNumber, source: "deterministic" as const, category: "剧本结构" };
    if (!document.scenes.length) {
        checks.push(makeCheck({ ...base, level: "error", code: "script_without_scene", message: "剧本没有任何场景，不能拆镜。", suggestion: "先生成或补写至少一个场景。" }));
    }
    if (!document.logline.trim()) {
        checks.push(makeCheck({ ...base, level: "warning", code: "script_without_logline", message: "剧本缺少一句话故事，后续审核难以判断主线。", suggestion: "补一句包含主角、目标与阻力的 logline。" }));
    }
    if (!document.synopsis.trim()) {
        checks.push(makeCheck({ ...base, level: "warning", code: "script_without_synopsis", message: "剧本缺少本集概要。", suggestion: "补写本集从开场到结尾的剧情概要。" }));
    }
    const sceneIds = new Set<string>();
    for (const scene of document.scenes) {
        if (sceneIds.has(scene.sceneId)) {
            checks.push(makeCheck({ ...base, level: "error", code: "script_duplicate_scene_id", sceneId: scene.sceneId, message: `场景 ID「${scene.sceneId}」重复。`, suggestion: "重新解析场景，保证每场有稳定且唯一的 ID。" }));
        }
        sceneIds.add(scene.sceneId);
        if (!scene.locationId) {
            checks.push(makeCheck({ ...base, level: "error", code: "script_scene_without_location", sceneId: scene.sceneId, message: `场景「${scene.sceneTitle}」没有绑定稳定 locationId。`, suggestion: "先建立场景资产或回到 2B 地点引用，不能留下空地点。" }));
        }
        if (!scene.charactersPresent.length) {
            checks.push(makeCheck({ ...base, level: "warning", code: "script_scene_without_character", sceneId: scene.sceneId, message: `场景「${scene.sceneTitle}」没有人物在场。`, suggestion: "确认是否为纯环境镜头；如果是，明确标注环境叙事目的。" }));
        }
        if (!scene.scenePurpose.trim()) {
            checks.push(makeCheck({ ...base, level: "warning", code: "script_scene_without_purpose", sceneId: scene.sceneId, message: `场景「${scene.sceneTitle}」没有戏剧目的。`, suggestion: "补写这场戏推动信息、关系或冲突的具体作用。" }));
        }
        for (const block of scene.dialogueBlocks) {
            if (!block.characterId) {
                checks.push(makeCheck({ ...base, level: "error", code: "script_dialogue_without_character", sceneId: scene.sceneId, message: `对白「${block.text.slice(0, 12)}」没有绑定 characterId。`, suggestion: "把说话人映射到项目人物资产，不能用纯名字字符串。" }));
            } else if (!scene.charactersPresent.includes(block.characterId)) {
                checks.push(makeCheck({ ...base, level: "warning", code: "script_dialogue_speaker_not_present", sceneId: scene.sceneId, characterId: block.characterId, message: `对白说话人「${block.speaker}」不在本场 charactersPresent 中。`, suggestion: "补入出场人物，或确认是否应为画外音。" }));
            }
            if (!block.text.trim()) {
                checks.push(makeCheck({ ...base, level: "warning", code: "script_empty_dialogue", sceneId: scene.sceneId, message: "存在空白对白块。", suggestion: "删除空白对白，或补全台词。" }));
            }
        }
        if (!scene.transitionIn.trim() && scene.sceneNumber > 1) {
            checks.push(makeCheck({ ...base, level: "suggestion", code: "script_scene_without_transition", sceneId: scene.sceneId, message: `场景「${scene.sceneTitle}」没有写进入方式。`, suggestion: "补一个动作、声音或时间跳跃转场；不要只靠硬切。" }));
        }
    }
    if (context.assetIndex) {
        const characterIds = new Set(context.assetIndex.characters.map((item) => item.characterId));
        for (const binding of document.characterBindings) {
            if (!characterIds.has(binding.characterId)) {
                checks.push(makeCheck({ ...base, level: "warning", code: "script_unknown_character_binding", characterId: binding.characterId, message: `人物绑定「${binding.name}」不在项目人物资产中。`, suggestion: "先建立稳定人物资产，或回到 2B 人物引用核对。" }));
            }
        }
    }
    const estimate = document.durationEstimate.totalSeconds || estimateScriptDuration(document.scenes, context.targetSeconds).totalSeconds;
    const level = scriptDurationLevel({ ...document.durationEstimate, totalSeconds: estimate }, context.targetSeconds);
    if (level !== "ok") {
        checks.push(
            makeCheck({
                ...base,
                level,
                category: "时长",
                code: level === "error" ? "script_duration_out_of_range" : "script_duration_near",
                message: `剧本估算 ${estimate}s，目标 ${context.targetSeconds}s，偏差 ${Math.round((estimate - context.targetSeconds) * 10) / 10}s。`,
                suggestion: "检查对白密度、动作长度和转场；压缩必须由用户确认，不能自动删核心剧情。",
            }),
        );
    }
    return checks;
}

/** 分镜层确定性校验：镜头组空间、轴线、站位、道具、对白绑定缺一不可。 */
export function validateStoryboardDocument(document: StudioStoryboardDocument, script: StudioScriptDocument): StudioProductionCheck[] {
    const checks: StudioProductionCheck[] = [];
    const base = { episodeNumber: document.episodeNumber, source: "deterministic" as const, category: "分镜连续性" };
    const sceneById = new Map(script.scenes.map((scene) => [scene.sceneId, scene]));
    const groupById = new Map(document.groups.map((group) => [group.shotGroupId, group]));
    const shotIds = new Set<string>();
    if (!document.shots.length) {
        checks.push(makeCheck({ ...base, level: "error", code: "storyboard_without_shot", message: "分镜没有任何镜头。", suggestion: "先按场景生成至少一个镜头组。" }));
    } else {
        const totalDuration = Math.round(document.shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0) * 10) / 10;
        const targetDuration = script.durationEstimate.totalSeconds || script.durationTarget;
        const ratio = targetDuration ? totalDuration / targetDuration : 1;
        const durationLevel = ratio > 1.35 || ratio < 0.55 ? "error" : ratio > 1.15 || ratio < 0.8 ? "warning" : "ok";
        if (durationLevel !== "ok") {
            checks.push(
                makeCheck({
                    ...base,
                    level: durationLevel,
                    category: "时长",
                    code: durationLevel === "error" ? "storyboard_duration_out_of_range" : "storyboard_duration_near",
                    message: `分镜镜头时长合计 ${totalDuration}s，剧本估算 ${targetDuration}s，偏差 ${Math.round((totalDuration - targetDuration) * 10) / 10}s。`,
                    suggestion: "按场景预算校准镜头时长，或先压缩剧本；不要为了凑时长删掉核心动作。",
                }),
            );
        }
    }
    for (const group of document.groups) {
        if (!sceneById.has(group.sceneId)) {
            checks.push(makeCheck({ ...base, level: "error", code: "group_unknown_scene", shotGroupId: group.shotGroupId, sceneId: group.sceneId, message: `镜头组「${group.groupNumber}」引用了不存在的剧本场景。`, suggestion: "重新从当前正式剧本生成镜头组。" }));
        }
        if (!group.cameraAxis.trim()) {
            checks.push(makeCheck({ ...base, level: "error", code: "group_without_axis", shotGroupId: group.shotGroupId, message: `镜头组「${group.groupNumber}」没有摄影机轴线。`, suggestion: "补轴线或明确设计一次轴线转换，避免越轴。" }));
        }
        if (!group.sharedLayout.trim()) {
            checks.push(makeCheck({ ...base, level: "warning", code: "group_without_layout", shotGroupId: group.shotGroupId, message: `镜头组「${group.groupNumber}」没有共享空间布局。`, suggestion: "补场景空间、人物初始位置和道具状态。" }));
        }
        for (const shotId of group.shotIds) {
            const shot = document.shots.find((item) => item.shotId === shotId);
            if (!shot) {
                checks.push(makeCheck({ ...base, level: "error", code: "group_missing_shot", shotGroupId: group.shotGroupId, shotId, message: `镜头组引用了不存在的镜头「${shotId}」。`, suggestion: "修复组内 shotIds 或重新生成该组。" }));
            }
        }
    }
    for (const shot of document.shots) {
        if (shotIds.has(shot.shotId)) {
            checks.push(makeCheck({ ...base, level: "error", code: "shot_duplicate_id", shotId: shot.shotId, message: `镜头 ID「${shot.shotId}」重复。`, suggestion: "重生成或修复稳定 shotId。" }));
        }
        shotIds.add(shot.shotId);
        const group = groupById.get(shot.shotGroupId);
        if (!group) {
            checks.push(makeCheck({ ...base, level: "error", code: "shot_unknown_group", shotId: shot.shotId, shotGroupId: shot.shotGroupId, message: `镜头 ${shot.shotNumber} 没有有效镜头组。`, suggestion: "先建立 ShotGroup，再生成单镜头。" }));
        } else if (!group.shotIds.includes(shot.shotId)) {
            checks.push(makeCheck({ ...base, level: "error", code: "shot_not_in_group", shotId: shot.shotId, shotGroupId: shot.shotGroupId, message: `镜头 ${shot.shotNumber} 没有登记在所属镜头组 shotIds 中。`, suggestion: "修正镜头组引用。" }));
        }
        if (!sceneById.has(shot.sceneId)) {
            checks.push(makeCheck({ ...base, level: "error", code: "shot_unknown_scene", shotId: shot.shotId, sceneId: shot.sceneId, message: `镜头 ${shot.shotNumber} 引用了不存在的剧本场景。`, suggestion: "重新从剧本场景生成此镜头。" }));
        }
        if (!shot.shotSize.trim() || !shot.cameraPosition.trim() || !shot.cameraMovement.trim()) {
            checks.push(makeCheck({ ...base, level: "warning", code: "shot_language_incomplete", shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的景别、机位或运镜不完整。`, suggestion: "补齐镜头语言；运镜要服务叙事，不要机械推拉摇移。" }));
        }
        if (!shot.characterBlocking.trim() && shot.characterBindings.length) {
            checks.push(makeCheck({ ...base, level: "warning", code: "shot_without_blocking", shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 有出场人物但没有人物调度。`, suggestion: "补人物位置、朝向、视线和动作起点。" }));
        }
        const scene = sceneById.get(shot.sceneId);
        if (scene && scene.props.length && !shot.propBindings.length) {
            const visibleText = `${shot.action} ${shot.characterBlocking} ${shot.foreground} ${shot.midground}`;
            const touchedProp = scene.props.some((propId) => {
                const name = script.propBindings.find((binding) => binding.propId === propId)?.name;
                return name ? visibleText.includes(name) : false;
            });
            if (touchedProp) {
                checks.push(makeCheck({ ...base, level: "warning", code: "shot_without_prop_binding", shotId: shot.shotId, sceneId: shot.sceneId, message: `镜头 ${shot.shotNumber} 动作涉及场景道具，但没有道具绑定。`, suggestion: "核对道具当前位置和持有人，禁止无原因瞬移。" }));
            }
        }
        for (const line of shot.dialogue) {
            if (!line.characterId) {
                checks.push(makeCheck({ ...base, level: "error", code: "shot_dialogue_without_character", shotId: shot.shotId, message: `镜头 ${shot.shotNumber} 的对白没有绑定 characterId。`, suggestion: "把说话人映射到稳定人物资产。" }));
            } else if (!shot.characterBindings.some((binding) => binding.characterId === line.characterId)) {
                checks.push(makeCheck({ ...base, level: "warning", code: "shot_speaker_not_in_frame", shotId: shot.shotId, characterId: line.characterId, message: `镜头 ${shot.shotNumber} 的说话人「${line.speaker}」不在 characterBindings 中。`, suggestion: "补入声源人物，或明确改为画外音。" }));
            }
        }
    }
    for (const group of document.groups) {
        const shots = group.shotIds.map((shotId) => document.shots.find((item) => item.shotId === shotId)).filter((shot): shot is StudioProductionShot => Boolean(shot));
        if (shots.length > 1) {
            const adjacent = [...shots].sort((left, right) => left.shotNumber - right.shotNumber);
            for (let index = 1; index < adjacent.length; index += 1) {
                const previous = adjacent[index - 1];
                const current = adjacent[index];
                if (previous.characterBlocking && current.characterBlocking && !current.continuityRules.length) {
                    checks.push(makeCheck({ ...base, level: "suggestion", code: "shot_continuity_not_declared", shotGroupId: group.shotGroupId, shotId: current.shotId, message: `镜头 ${previous.shotNumber} → ${current.shotNumber} 没有声明连续性规则。`, suggestion: "补一条站位、视线、动作或道具连续性约束。" }));
                }
            }
        }
    }
    return checks;
}

/** 合并分镜时保护锁定镜头；锁定组或锁定镜头所在场景必须显式确认，不能静默覆盖。 */
export function canReplaceSceneStoryboard(document: StudioStoryboardDocument | undefined, sceneId: string, force = false): { ok: boolean; reason?: string } {
    if (!document) return { ok: true };
    const sceneShots = document.shots.filter((shot) => shot.sceneId === sceneId);
    const lockedShots = sceneShots.filter((shot) => shot.locked);
    const lockedGroups = document.groups.filter((group) => group.sceneId === sceneId && (group.reviewedByUser || sceneShots.some((shot) => shot.locked)));
    if (!force && (lockedShots.length || lockedGroups.length)) {
        return { ok: false, reason: `场景已有 ${lockedShots.length} 个锁定镜头；需要先确认解锁或显式覆盖，不能静默重生成。` };
    }
    return { ok: true };
}

export function canReplaceShot(document: StudioStoryboardDocument | undefined, shotId: string): { ok: boolean; reason?: string } {
    const shot = document?.shots.find((item) => item.shotId === shotId);
    if (shot?.locked) return { ok: false, reason: "该镜头已锁定，不能重生成；先解锁。" };
    return { ok: true };
}

export function createProductionJob(input: {
    kind: StudioProductionJobKind;
    episodeIds: string[];
    episodeNumbers: number[];
    model: StudioProductionJob["model"];
    modelParams: Record<string, string | number | boolean>;
    promptVersion: string;
    sourceHandoffId: string;
    sourceBlueprintVersion: number;
    sourcePlanVersions: number[];
    targetEpisodeId?: string;
    targetSceneId?: string;
    targetModule?: StudioProductionJob["targetModule"];
}): StudioProductionJob {
    const now = nowIso();
    return {
        id: `stage3-job-${simpleHash(`${input.kind}:${input.episodeIds.join(",")}:${now}`)}`,
        kind: input.kind,
        episodeIds: input.episodeIds,
        episodeNumbers: input.episodeNumbers,
        status: "pending",
        progress: 0,
        currentLabel: "待入队",
        model: input.model,
        modelParams: input.modelParams,
        modelFrozenAt: now,
        capability: "text",
        promptVersion: input.promptVersion,
        remoteState: "not_submitted",
        needsReview: false,
        retryable: true,
        sourceHandoffId: input.sourceHandoffId,
        sourceBlueprintVersion: input.sourceBlueprintVersion,
        sourcePlanVersions: input.sourcePlanVersions,
        targetEpisodeId: input.targetEpisodeId,
        targetSceneId: input.targetSceneId,
        targetModule: input.targetModule,
        inputChars: 0,
        outputChars: 0,
        calls: 0,
        createdAt: now,
        updatedAt: now,
    };
}

export function storyboardVersionSnapshot(document: StudioStoryboardDocument, reason: string): StudioStoryboardVersion {
    return createStoryboardSnapshot({ document, snapshotType: "formal", basedOnVersion: document.storyboardVersion, reason });
}

/** 旧 shot 兼容投影：生产数据仍是唯一来源；为旧导演/画面工作区提供只读快照。 */
export function scriptToPlainText(document: StudioScriptDocument): string {
    const lines: string[] = [`第 ${document.episodeNumber} 集 · ${document.title}`, "", `【logline】${document.logline}`, `【本集概要】${document.synopsis}`, ""];
    for (const scene of document.scenes) {
        lines.push(`${scene.sceneNumber}. ${scene.locationVariantId ? `${scene.sceneTitle} · ${scene.locationVariantId}` : scene.sceneTitle} · ${scene.timeOfDay}`);
        if (scene.transitionIn) lines.push(`【进入】${scene.transitionIn}`);
        if (scene.environment) lines.push(`【环境】${scene.environment}`);
        if (scene.action) lines.push(scene.action);
        for (const block of scene.dialogueBlocks) {
            lines.push(`【${block.speaker}】${block.text}`);
            if (block.linkedAction) lines.push(`（${block.linkedAction}）`);
        }
        if (scene.transitionOut) lines.push(`【转出】${scene.transitionOut}`);
        lines.push("");
    }
    return lines.join("\n").trim();
}

export function productionFromProject(project: StudioProject, episode: StudioEpisode): StudioEpisodeProduction {
    return {
        version: 1,
        script: episode.production?.script,
        scriptVersions: episode.production?.scriptVersions ?? [],
        storyboard: episode.production?.storyboard,
        storyboardVersions: episode.production?.storyboardVersions ?? [],
        storyboardDrafts: episode.production?.storyboardDrafts ?? [],
        checks: episode.production?.checks ?? [],
        updatedAt: episode.production?.updatedAt ?? nowIso(),
    };
}

/** 让外部只读查询不会误以为未生成：raw 对象仅有场景时，也必须明确缺失而不是伪造镜头。 */
export function rawScriptHasScenes(raw: StudioProductionRawScript | undefined) {
    return Boolean(raw && Array.isArray(raw.scenes) && raw.scenes.length);
}

export function rawStoryboardHasGroups(raw: StudioProductionRawStoryboard | undefined) {
    return Boolean(raw && Array.isArray(raw.groups) && raw.groups.length);
}

export function shotGroupsForScene(document: StudioStoryboardDocument | undefined, sceneId: string): StudioShotGroup[] {
    return (document?.groups ?? []).filter((group) => group.sceneId === sceneId).sort((left, right) => left.groupNumber - right.groupNumber);
}

export function shotsForGroup(document: StudioStoryboardDocument | undefined, group: StudioShotGroup): StudioProductionShot[] {
    return (document?.shots ?? []).filter((shot) => shot.shotGroupId === group.shotGroupId).sort((left, right) => left.shotNumber - right.shotNumber);
}

/** 场景局部替换后统一镜号，避免历史版本留下的 5/6/7 号在新版本里重复出现在多场。 */
export function renumberStoryboardShots(document: StudioStoryboardDocument): StudioStoryboardDocument {
    const rank = new Map(document.groups.map((group, index) => [group.shotGroupId, index]));
    const shots = [...document.shots].sort((left, right) => (rank.get(left.shotGroupId) ?? 0) - (rank.get(right.shotGroupId) ?? 0) || left.shotNumber - right.shotNumber);
    return { ...document, shots: shots.map((shot, index) => ({ ...shot, shotNumber: index + 1 })) };
}

export function emptyCounts(checks: StudioProductionCheck[]) {
    return {
        error: checks.filter((check) => check.status === "open" && check.level === "error").length,
        warning: checks.filter((check) => check.status === "open" && check.level === "warning").length,
        suggestion: checks.filter((check) => check.status === "open" && check.level === "suggestion").length,
    };
}
