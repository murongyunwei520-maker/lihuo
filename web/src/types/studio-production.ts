// 阶段 3：分集剧本与结构化分镜。
// 数据挂在既有 StudioEpisode / StudioProject 内，不创建第二套项目根对象。
// 剧本与分镜分开保存、分开生成：分镜必须引用正式剧本场景，不能反向改写剧情。

import type {
    StudioAdaptationCheckLevel,
    StudioAdaptationCheckStatus,
    StudioAdaptationChange,
    StudioAdaptationHandoff,
    StudioAdaptationOrigin,
    StudioAdaptationReviewStatus,
    StudioAdaptationSourceReference,
    StudioAdaptationWorkspace,
} from "./studio-adaptation";

export type StudioProductionReviewStatus = StudioAdaptationReviewStatus;
export type StudioProductionCheckLevel = StudioAdaptationCheckLevel;
export type StudioProductionCheckStatus = StudioAdaptationCheckStatus;
export type StudioProductionCheckSource = "deterministic" | "model";
export type StudioProductionJobKind = "script" | "storyboard";
export type StudioProductionStageTab = "script" | "storyboard";
export type StudioScriptModule = "episode" | "logline" | "synopsis" | "scene" | "dialogue";

/** 任务状态沿用项目现有口径；unknown 只能人工确认，不能自动重发。 */
export type StudioProductionJobStatus =
    | "pending"
    | "queued"
    | "submitting"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelling"
    | "cancelled"
    | "interrupted"
    | "unknown";

/** 远端请求的实际状态；本地 status 不能代替远端结论。 */
export type StudioProductionJobRemoteState = "not_submitted" | "submitted" | "unknown" | "completed" | "failed" | "cancelled";
export type StudioProductionJobReviewDecision = "adopt-existing" | "retry" | "mark-failed";

export type StudioProductionStageView = "shots" | "scenes" | "detail";

/** 剧本对白块：模型只给说话人名字，落库时必须换成稳定 characterId。 */
export type StudioScriptDialogueBlock = {
    dialogueId: string;
    characterId: string;
    speaker: string;
    text: string;
    delivery: string;
    emotion: string;
    subtext: string;
    linkedAction: string;
    timing: string;
    sourceReference?: StudioAdaptationSourceReference;
};

export type StudioScriptScene = {
    sceneId: string;
    sceneNumber: number;
    sceneTitle: string;
    locationId: string;
    locationVariantId: string;
    timeOfDay: string;
    environment: string;
    charactersPresent: string[];
    props: string[];
    scenePurpose: string;
    conflict: string;
    action: string;
    dialogueBlocks: StudioScriptDialogueBlock[];
    transitionIn: string;
    transitionOut: string;
    continuityNotes: string;
};

export type StudioScriptCharacterBinding = {
    characterId: string;
    name: string;
    role: string;
    costume: string;
    look: string;
    sceneIds: string[];
};

export type StudioScriptLocationBinding = {
    locationId: string;
    name: string;
    variantId: string;
    timeOfDay: string;
    weather: string;
    description: string;
    sceneIds: string[];
};

export type StudioScriptPropBinding = {
    propId: string;
    name: string;
    holderCharacterId: string;
    locationId: string;
    state: string;
    important: boolean;
    sceneIds: string[];
};

/** 人工编辑落在哪个模块；旧数据没有该字段时按整场人工编辑处理。 */
export type StudioScriptManualEditModule = "scene" | "dialogue" | "action" | "other";

export type StudioScriptDurationEstimate = {
    dialogueSeconds: number;
    actionSeconds: number;
    transitionSeconds: number;
    pauseSeconds: number;
    environmentSeconds: number;
    totalSeconds: number;
    deltaSeconds: number;
    note: string;
};

export type StudioScriptDocument = {
    id: string;
    episodeId: string;
    episodeNumber: number;
    title: string;
    logline: string;
    synopsis: string;
    durationTarget: number;
    durationEstimate: StudioScriptDurationEstimate;
    sourceEpisodePlanId: string;
    sourceBlueprintVersion: number;
    sourceHandoffId: string;
    scriptVersion: number;
    status: StudioProductionReviewStatus;
    scenes: StudioScriptScene[];
    characterBindings: StudioScriptCharacterBinding[];
    locationBindings: StudioScriptLocationBinding[];
    propBindings: StudioScriptPropBinding[];
    sourceReferences: StudioAdaptationSourceReference;
    continuityDependencies: string[];
    adaptationChanges: StudioAdaptationChange[];
    /** 用户手工改过的场景；用于全剧队列默认跳过与局部重生成保护。 */
    manualEditedSceneIds?: string[];
    /** 场景内实际被人工编辑的模块；旧数据缺省时按整场人工编辑。 */
    manualEditedModules?: Record<string, StudioScriptManualEditModule[]>;
    /** 用户最后一次手工编辑时间；模型生成和恢复不冒充人工编辑。 */
    manualEditedAt?: string;
    /** 场景内容签名版本，用于局部判断分镜依赖是否失效。 */
    sceneVersions?: Record<string, number>;
    /** 恢复/应用快照时记录来源快照身份。 */
    restoredFromSnapshotId?: string;
    createdAt: string;
    updatedAt: string;
};

export type StudioScriptVersion = {
    id: string;
    snapshotId: string;
    version: number;
    reason: string;
    createdAt: string;
    document: StudioScriptDocument;
    sourceTaskId?: string;
    contentHash?: string;
};

export type StudioShotGroupCharacterStart = {
    characterId: string;
    name: string;
    position: string;
    orientation: string;
    eyeline: string;
};

export type StudioShotGroup = {
    shotGroupId: string;
    episodeId: string;
    sceneId: string;
    groupNumber: number;
    sceneTitle: string;
    sharedLayout: string;
    characterStartPositions: StudioShotGroupCharacterStart[];
    cameraAxis: string;
    propStates: string;
    timeOfDay: string;
    lighting: string;
    weather: string;
    continuityRules: string[];
    /** Stage 4C 可选结构化上下文；缺失按信息不足处理。 */
    continuity?: StudioShotGroupContinuityState;
    shotIds: string[];
    reviewedByUser: boolean;
    createdAt: string;
    updatedAt: string;
};

/** Stage 4C：连续性检查可选结构；旧镜头缺字段时只能判为信息不足，不能伪造机位或空间。 */
export type StudioContinuityConfidence = "high" | "medium" | "low";
export type StudioContinuityScopeType = "shot" | "group" | "scene" | "episode";
export type StudioContinuityScreenSide = "left" | "center" | "right" | "off_screen" | "unknown";
export type StudioContinuityDepth = "foreground" | "midground" | "background" | "unknown";
export type StudioContinuityDirection =
    | "left_to_right"
    | "right_to_left"
    | "toward_camera"
    | "away_from_camera"
    | "forward"
    | "backward"
    | "up"
    | "down"
    | "clockwise"
    | "counterclockwise"
    | "toward_target"
    | "turn"
    | "stop"
    | "fall"
    | "rise"
    | "jump"
    | "knockback"
    | "teleport"
    | "static"
    | "unknown";
export type StudioContinuityActionPhase = "start" | "process" | "contact" | "reaction" | "result" | "recovery" | "unknown";
export type StudioContinuityCameraSide = "axis_left" | "axis_right" | "on_axis" | "unknown";
export type StudioContinuityExceptionType =
    | "turn"
    | "stop"
    | "costume_change"
    | "injury"
    | "heal"
    | "time_jump"
    | "scene_transition"
    | "flashback"
    | "dream"
    | "illusion"
    | "cross_axis"
    | "subjective"
    | "establishing"
    | "orbit"
    | "match_cut"
    | "jump_cut"
    | "slow_motion"
    | "omitted_process"
    | "result_first"
    | "prop_handoff"
    | "prop_drop"
    | "prop_pickup"
    | "prop_consume"
    | "environment_change"
    | "other";

export type StudioContinuityException = {
    type: StudioContinuityExceptionType;
    reason: string;
    shotIds?: string[];
};

export type StudioContinuitySpaceCharacter = {
    characterId: string;
    screenSide?: StudioContinuityScreenSide;
    depth?: StudioContinuityDepth;
    distance?: "near" | "mid" | "far" | "unknown";
    facing?: "left" | "right" | "toward_camera" | "away_from_camera" | "unknown";
    /** 从文本“面向 / 转向某人”推导出的朝向目标；旧数据可缺失。 */
    facingTargetId?: string;
    eyelineTargetId?: string;
};

export type StudioContinuityCharacterState = {
    characterId: string;
    outfitId?: string;
    hairstyle?: string;
    accessories?: string[];
    injured?: boolean;
    blood?: boolean;
    /** 武器道具 ID；null 表示明确空手 / 已收起，undefined 表示未记录，不能当作武器消失。 */
    weaponPropId?: string | null;
    posture?: string;
    emotion?: string;
    facing?: StudioContinuitySpaceCharacter["facing"];
    actionPhase?: StudioContinuityActionPhase;
};

export type StudioContinuityPropState = {
    propId: string;
    holderCharacterId?: string;
    hand?: "left" | "right" | "both" | "none" | "unknown";
    state?: string;
    visible?: boolean;
    damaged?: boolean;
    dropped?: boolean;
    pickedUp?: boolean;
    transferredTo?: string;
    used?: boolean;
    form?: string;
};

export type StudioContinuityEnvironmentState = {
    timeOfDay?: string;
    weather?: string;
    lighting?: string;
    ground?: string;
    damage?: string;
    visibility?: string;
    transition?: "continuous" | "cut" | "scene_change" | "time_jump" | "flashback" | "dream" | "illusion" | "unspecified";
};

export type StudioContinuityActionState = {
    phase?: StudioContinuityActionPhase;
    actorId?: string;
    targetId?: string;
    actionType?: string;
    contactPoint?: string;
    forceDirection?: StudioContinuityDirection;
    reactionDirection?: StudioContinuityDirection;
    interrupted?: boolean;
    causeShotId?: string;
};

export type StudioShotContinuityState = {
    space?: {
        characters?: StudioContinuitySpaceCharacter[];
        cameraSide?: StudioContinuityCameraSide;
        movementCharacterId?: string;
        movementDirection?: StudioContinuityDirection;
        establishing?: boolean;
        subjective?: boolean;
        orbit?: boolean;
        crossAxis?: boolean;
    };
    characters?: StudioContinuityCharacterState[];
    props?: StudioContinuityPropState[];
    environment?: StudioContinuityEnvironmentState;
    action?: StudioContinuityActionState;
    exceptions?: StudioContinuityException[];
};

export type StudioShotGroupContinuityState = {
    axis?: {
        orientation?: StudioContinuityDirection;
        cameraSide?: StudioContinuityCameraSide;
        lineOfAction?: string;
    };
    transition?: StudioContinuityEnvironmentState["transition"];
    environment?: StudioContinuityEnvironmentState;
    exceptions?: StudioContinuityException[];
};

export type StudioContinuityRuleDefinition = {
    id: string;
    title: string;
    scope: StudioContinuityScopeType;
    fields: string[];
    defaultSeverity: StudioProductionCheckLevel;
    description: string;
};

export type StudioContinuityGap = {
    ruleId: string;
    shotIds: string[];
    fieldPath: string;
    reason: string;
    scope: StudioContinuityScopeType;
};

export type StudioContinuityFinding = {
    ruleId: string;
    severity: StudioProductionCheckLevel;
    confidence: StudioContinuityConfidence;
    shotIds: string[];
    shotGroupId: string;
    sceneId: string;
    fieldPath: string;
    evidence: string;
    reason: string;
    suggestion: string;
    scope: StudioContinuityScopeType;
    exceptionType?: StudioContinuityExceptionType;
};

export type StudioContinuityCheckReport = {
    /** 检查任务开始时绑定的正式分镜版本；提交前必须再次核对。 */
    storyboardVersion: number;
    episodeId: string;
    scope: { type: StudioContinuityScopeType; id?: string };
    /** 同一次检查的稳定身份；重复提交时用于避免重复写检查历史。 */
    checkId: string;
    checkedShots: number;
    checkedGroups: number;
    checkedScenes: number;
    checkedPairs: number;
    totalPairs: number;
    affectedShotIds: string[];
    counts: {
        error: number;
        warning: number;
        suggestion: number;
        insufficient: number;
    };
    findings: StudioContinuityFinding[];
    gaps: StudioContinuityGap[];
};

export type StudioContinuityRun = {
    id: string;
    scope: { type: StudioContinuityScopeType; id?: string };
    storyboardVersion: number;
    checkedAt: string;
    checkedShots: number;
    checkedPairs: number;
    affectedShotIds: string[];
    issueIds: string[];
    counts: StudioContinuityCheckReport["counts"];
};

export type StudioShotDialogueLine = {
    characterId: string;
    speaker: string;
    text: string;
    delivery: string;
    emotion: string;
};

export type StudioShotCharacterBinding = {
    characterId: string;
    name: string;
    outfitId?: string;
};

export type StudioShotOutfitBinding = {
    characterId: string;
    outfitId: string;
    description: string;
};

export type StudioShotSceneBinding = {
    locationId: string;
    locationVariantId: string;
};

export type StudioShotPropBinding = {
    propId: string;
    name: string;
    state: string;
};

export type StudioProductionShot = {
    shotId: string;
    episodeId: string;
    sceneId: string;
    shotGroupId: string;
    shotNumber: number;
    duration: number;
    shotSize: string;
    cameraPosition: string;
    cameraAngle: string;
    lens: string;
    cameraMovement: string;
    composition: string;
    foreground: string;
    midground: string;
    background: string;
    characterBlocking: string;
    eyeline: string;
    action: string;
    facialExpression: string;
    emotion: string;
    dialogue: StudioShotDialogueLine[];
    voiceOver: string;
    soundEffects: string;
    backgroundMusic: string;
    lighting: string;
    environment: string;
    continuityRules: string[];
    /** Stage 4C 可选结构化上下文；缺失按信息不足处理。 */
    continuity?: StudioShotContinuityState;
    characterBindings: StudioShotCharacterBinding[];
    outfitBindings: StudioShotOutfitBinding[];
    sceneBindings: StudioShotSceneBinding;
    propBindings: StudioShotPropBinding[];
    sourceReferences: StudioAdaptationSourceReference;
    sourceScriptSceneId: string;
    imagePrompt: string;
    videoPrompt: string;
    keyframeRefs: string[];
    status: StudioProductionReviewStatus;
    version: number;
    locked: boolean;
    /** Stage 4D：人工编辑标记；有 manualEditedAt 但缺 manualEditedFields 时按整镜人工编辑保护。 */
    manualEditedAt?: string;
    manualEditedFields?: string[];
    createdAt: string;
    updatedAt: string;
};

export type StudioShotGroupDocument = {
    group: StudioShotGroup;
    shots: StudioProductionShot[];
};

export type StudioStoryboardStale = {
    sceneIds: string[];
    shotIds: string[];
    scriptVersion: number;
    reason: string;
    markedAt: string;
};

export type StudioStoryboardDocument = {
    id: string;
    episodeId: string;
    episodeNumber: number;
    sourceScriptId: string;
    sourceScriptVersion: number;
    sourceEpisodePlanId: string;
    sourceBlueprintVersion: number;
    sourceHandoffId: string;
    storyboardVersion: number;
    status: StudioProductionReviewStatus;
    groups: StudioShotGroup[];
    shots: StudioProductionShot[];
    checks: StudioProductionCheck[];
    /** 生成/刷新该场景镜头时依据的剧本场景版本。 */
    sourceSceneVersions?: Record<string, number>;
    /** 剧本实质修改后受影响的局部镜头；只提示，不自动删除或重生成。 */
    stale?: StudioStoryboardStale;
    /** 恢复/应用快照时记录来源快照身份。 */
    restoredFromSnapshotId?: string;
    /** 从独立草稿应用为正式版本时记录来源草稿。 */
    appliedDraftId?: string;
    createdAt: string;
    updatedAt: string;
};

/**
 * 第四步审核状态与锁定彻底分离。
 * locked 不是审核结论，只由 StudioProductionShot.locked / 整份分镜 status 派生。
 */
export type StudioStoryboardReviewStatus = "pending" | "approved" | "needs_revision" | "rejected" | "stale";

export type StudioStoryboardShotStatus = Exclude<StudioStoryboardReviewStatus, "stale">;

export type StudioStoryboardReviewAction = "approve" | "needs_revision" | "reject" | "reset" | "note" | "recheck" | "re_review";

export type StudioStoryboardReadinessStatus = "not_ready" | "ready_for_video" | "blocked";

export type StudioStoryboardShotReview = {
    shotId: string;
    status: StudioStoryboardShotStatus;
    note: string;
    storyboardVersion: number;
    reviewedAt: string;
    reviewedBy: string;
    /** 审核时的镜头内容签名；锁定 / 时间戳不参与，避免“锁定即 stale”。 */
    shotContentHash?: string;
    /** 审核时镜头的只读快照；旧记录可能缺失，不能伪造字段差异。 */
    reviewedShot?: StudioProductionShot;
    /** 已复核的上游 stale 签名；上游再次变化后签名失效，会重新 stale。 */
    staleAckKey?: string;
};

export type StudioStoryboardAuditRecord = {
    id: string;
    projectId?: string;
    episodeId: string;
    shotId: string;
    action: StudioStoryboardReviewAction;
    fromStatus: StudioStoryboardReviewStatus;
    toStatus: StudioStoryboardReviewStatus;
    note: string;
    actor: string;
    storyboardVersion: number;
    createdAt: string;
};

/** 4A 只落确定性检查结果；模型审查建议在 4D 以独立提案写入，不能混入正式分镜。 */
export type StudioStoryboardReviewIssue = {
    id: string;
    /** 领域记录自包含字段；旧数据可缺，读取时不得据此编造归属。 */
    projectId?: string;
    episodeId?: string;
    level: StudioProductionCheckLevel;
    code: string;
    category: string;
    message: string;
    suggestion: string;
    episodeNumber: number;
    sceneId?: string;
    shotGroupId?: string;
    shotId?: string;
    source: StudioProductionCheckSource;
    status: StudioProductionCheckStatus;
    /** Stage 4C：连续性规则证据；结构检查旧记录可以不填。 */
    ruleId?: string;
    confidence?: StudioContinuityConfidence;
    shotIds?: string[];
    fieldPath?: string;
    evidence?: string;
    storyboardVersion?: number;
    /** 旧版本 / 本次未复现的连续性结果；保留历史，但不再作为当前 open 问题。 */
    continuityStale?: boolean;
    continuityScope?: StudioContinuityScopeType;
    createdAt: string;
    updatedAt: string;
};

export type StudioStoryboardReadiness = {
    status: StudioStoryboardReadinessStatus;
    reasons: string[];
    blocking: string[];
    storyboardVersion: number;
    checkedAt: string;
};

/** 新提案的证据等级；旧数据仍可能保存旧来源字段 shot_text / script_text / continuity_report。 */
export type StudioAiEvidenceType = "explicit" | "inference" | "suggestion" | "unknown";
export type StudioAiReviewEvidenceType = StudioAiEvidenceType | "shot_text" | "script_text" | "continuity_report";

export type StudioAiReviewCategory = "人物" | "场景" | "动作" | "空间关系" | "轴线" | "视线" | "道具" | "情绪" | "对白" | "镜头衔接" | "景别" | "机位" | "运镜" | "角色外观" | "服装连续性" | "其他";

/** Stage 4D：模型审核结果；只作为审核记录，不直接改写正式分镜。 */
export type StudioAiReviewFinding = {
    id: string;
    level: StudioProductionCheckLevel;
    category: StudioAiReviewCategory;
    message: string;
    reason: string;
    suggestion: string;
    shotIds: string[];
    fieldPath?: string;
    evidence: string;
    evidenceType: StudioAiReviewEvidenceType;
    confidence: StudioContinuityConfidence;
    /** 模型自己的推断必须显式标记，不能冒充原著事实或确定事实。 */
    speculative: boolean;
};

export type StudioAiReviewScope = {
    type: "shot" | "selection" | "episode";
    shotIds: string[];
};

export type StudioAiReviewRunStatus = "completed" | "failed" | "cancelled";

export type StudioAiReviewRun = {
    runId: string;
    projectId?: string;
    episodeId: string;
    episodeNumber?: number;
    storyboardVersion: number;
    scope: StudioAiReviewScope;
    continuityCheckId: string;
    status: StudioAiReviewRunStatus;
    summary: string;
    findings: StudioAiReviewFinding[];
    /** 解析阶段被丢弃的非法 finding / proposal 摘要；保留在审核记录中，避免静默吞掉模型输出。 */
    warnings?: string[];
    promptVersion: string;
    modelTrace?: StudioProductionModelTrace;
    error?: string;
    startedAt: string;
    finishedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type StudioAiProposalChange = {
    changeId: string;
    shotId: string;
    fieldPath: string;
    fieldLabel: string;
    before: string;
    after: string;
    reason: string;
    impact: string;
    /** 独立证据正文；不能只把证据留在 finding 上。 */
    evidence: string;
    evidenceType: StudioAiReviewEvidenceType;
    confidence: StudioContinuityConfidence;
    speculative: boolean;
    /** 证据实际来自哪些镜头 / 章节 / 版本；适用时才填，不能伪造。 */
    sourceShotIds?: string[];
    sourceChapterId?: string;
    sourceVersion?: string;
    /** confirmed 仅表示来源经过本次实际输入范围校验；没有来源时保持 unconfirmed。 */
    sourceStatus?: "confirmed" | "unconfirmed";
};

export type StudioAiProposalDecisionStatus = "pending" | "accepted" | "partial" | "rejected" | "conflict" | "failed";

export type StudioAiProposalDecision = {
    status: StudioAiProposalDecisionStatus;
    acceptedChangeIds: string[];
    rejectedChangeIds: string[];
    note?: string;
    decidedAt?: string;
    decidedBy?: string;
    /** true 表示因正式版本变化由系统自动判冲突；不是用户手动标记。 */
    autoConflict?: boolean;
};

export type StudioAiProposalApplicationStatus = "applied" | "failed" | "conflict";

export type StudioAiProposalApplication = {
    applicationId: string;
    proposalId: string;
    runId: string;
    status: StudioAiProposalApplicationStatus;
    acceptedChangeIds: string[];
    beforeVersion: number;
    afterVersion?: number;
    operationId?: string;
    conflictSnapshotId?: string;
    error?: string;
    persisted: boolean;
    /** true 表示读取时按版本规则派生，尚未写入 IndexedDB；不得当作持久化事实。 */
    derived?: boolean;
    appliedAt: string;
};

export type StudioAiAdjustmentProposal = {
    proposalId: string;
    runId: string;
    /** 领域记录自包含字段；旧提案可缺，读取时不得据此编造归属。 */
    projectId?: string;
    episodeId: string;
    episodeNumber?: number;
    /** 生成提案时绑定的正式版本；版本变化后必须提示冲突，禁止静默覆盖。 */
    storyboardVersion: number;
    /** 生成提案时绑定的剧本版本；剧本变化后同样视为依赖冲突。 */
    sourceScriptVersion?: number;
    sourceScriptId?: string;
    title: string;
    rationale: string;
    confidence: StudioContinuityConfidence;
    changes: StudioAiProposalChange[];
    decision: StudioAiProposalDecision;
    createdAt: string;
    updatedAt: string;
};

export type StudioStoryboardReview = {
    version: 1;
    /** 读取/持久化时由 hydration / 审核写入补齐；旧记录可缺。 */
    projectId?: string;
    episodeId: string;
    episodeNumber?: number;
    storyboardVersion: number;
    shots: Record<string, StudioStoryboardShotReview>;
    issues: StudioStoryboardReviewIssue[];
    audits: StudioStoryboardAuditRecord[];
    readiness: StudioStoryboardReadiness;
    lastCheckedAt?: string;
    /** 4C 检查运行摘要；历史最多保留 20 次，不冒充当前结果。 */
    continuityRuns?: StudioContinuityRun[];
    /** Stage 4D：AI 审核记录，按 storyboardVersion 绑定；旧记录保留但不冒充当前审核。 */
    aiReviewRuns?: StudioAiReviewRun[];
    /** Stage 4D：调整提案，正式分镜只在用户应用时改变。 */
    proposals?: StudioAiAdjustmentProposal[];
    /** Stage 4D：提案应用历史；失败和冲突也必须保留。 */
    proposalApplications?: StudioAiProposalApplication[];
    updatedAt: string;
};

export type StudioStoryboardSnapshotType = "formal" | "conflict" | "backup";

export type StudioStoryboardDraftStatus = "active" | "archived";

/** 从快照复制出的独立分镜草稿；不能直接占用正式工作区。 */
export type StudioStoryboardDraft = {
    draftId: string;
    episodeId: string;
    sourceSnapshotId: string;
    sourceStoryboardVersion: number;
    draftVersion: number;
    createdAt: string;
    updatedAt: string;
    createdBy?: string;
    storyboard: StudioStoryboardDocument;
    status: StudioStoryboardDraftStatus;
    appliedStoryboardVersion?: number;
    appliedAt?: string;
};

export type StudioStoryboardVersion = {
    id: string;
    /** 快照自身唯一身份，与正式工作区版本号完全分离。 */
    snapshotId: string;
    /** 生成该快照时对应的正式工作区版本；冲突/备份快照不得冒充新正式版本。 */
    version: number;
    basedOnVersion: number;
    snapshotType: StudioStoryboardSnapshotType;
    reason: string;
    createdAt: string;
    document: StudioStoryboardDocument;
    sourceTaskId?: string;
    contentHash?: string;
    conflictWithSnapshotId?: string;
};

/** Stage 3.2.2：正式分镜写入统一日志；与 storyboardVersion 分开，用于幂等、冲突与审计。 */
export type StudioStoryboardWriteOperationType =
    | "episode_replace"
    | "scene_replace"
    | "shot_replace"
    | "shot_edit"
    | "ai_proposal_apply"
    | "snapshot_apply"
    | "draft_apply"
    | "document_lock"
    | "document_unlock";

export type StudioStoryboardWriteScope = {
    kind: "episode" | "scene" | "shot" | "document";
    sceneId?: string;
    shotId?: string;
};

export type StudioStoryboardWriteJournalEntry = {
    operationId: string;
    projectId: string;
    episodeId: string;
    operationType: StudioStoryboardWriteOperationType;
    scope: StudioStoryboardWriteScope;
    status: "committed" | "conflict" | "failed";
    expectedVersion: number;
    baseVersion: number;
    newVersion?: number;
    sourceSnapshotId?: string;
    conflictSnapshotId?: string;
    actor: string;
    createdAt: string;
    finishedAt: string;
    error?: string;
};

export type StudioProductionCheck = {
    id: string;
    level: StudioProductionCheckLevel;
    code: string;
    category: string;
    message: string;
    suggestion: string;
    episodeNumber: number;
    sceneId?: string;
    shotGroupId?: string;
    shotId?: string;
    characterId?: string;
    propId?: string;
    source: StudioProductionCheckSource;
    status: StudioProductionCheckStatus;
    createdAt: string;
    updatedAt: string;
};

/** 2B 校验问题在 Stage 3 的只读投影；不得通过“生成了转场”自动改成 resolved。 */
export type StudioHandoffIssue = {
    id: string;
    level: StudioProductionCheckLevel;
    code: string;
    category: string;
    message: string;
    suggestion: string;
    episodeNumbers: number[];
    status: StudioAdaptationCheckStatus;
    source: "stage2b";
};

export type StudioProductionAdmission = {
    episodeNumber: number;
    sourcePlanId: string;
    draftAllowed: boolean;
    formalAllowed: boolean;
    blocking: string[];
    review: string[];
    info: string[];
    pendingHighRiskChanges: StudioAdaptationChange[];
    unresolvedErrors: StudioHandoffIssue[];
    handoffWarnings: StudioHandoffIssue[];
    handoffSuggestions: StudioHandoffIssue[];
};

export type StudioProductionSkipReason = "existing_script" | "manual_edited" | "locked" | "admission_blocked" | "missing_plan";

export type StudioProductionSkipRecord = {
    id: string;
    kind: StudioProductionJobKind;
    episodeId: string;
    episodeNumber: number;
    episodeTitle: string;
    reason: StudioProductionSkipReason;
    detail: string;
    createdAt: string;
};

export type StudioProductionJob = {
    id: string;
    kind: StudioProductionJobKind;
    episodeIds: string[];
    episodeNumbers: number[];
    status: StudioProductionJobStatus;
    progress: number;
    currentLabel: string;
    model: { channelId: string; modelId: string; label: string };
    modelParams: Record<string, string | number | boolean>;
    capability?: "text";
    modelFrozenAt?: string;
    promptVersion: string;
    sourceHandoffId: string;
    sourceBlueprintVersion: number;
    sourcePlanVersions: number[];
    targetEpisodeId?: string;
    targetSceneId?: string;
    targetModule?: StudioScriptModule;
    remoteState?: StudioProductionJobRemoteState;
    needsReview?: boolean;
    retryable?: boolean;
    taskId?: string;
    trace?: StudioProductionModelTrace;
    inputChars: number;
    outputChars: number;
    calls: number;
    error?: string;
    /** 队列执行时因保护策略跳过目标的原因；跳过不是模型失败。 */
    skipReason?: string;
    createdAt: string;
    startedAt?: string;
    updatedAt: string;
    finishedAt?: string;
    cancelRequestedAt?: string;
};

export type StudioProductionHandoffSnapshot = {
    projectId: string;
    analysisVersion: number;
    blueprintId: string;
    blueprintVersion: number;
    packageVersion: number;
    handoffSnapshotId: string;
    episodePlanCount: number;
    lockedEpisodeNumbers: number[];
    checkCount: number;
    errorCount: number;
    warningCount: number;
    suggestionCount: number;
    createdAt: string;
};

export type StudioProductionWorkspace = {
    version: 1;
    handoff?: StudioProductionHandoffSnapshot;
    jobs: StudioProductionJob[];
    /** 队列因保护策略跳过的集数；与模型失败分开记录。 */
    skips: StudioProductionSkipRecord[];
    activeJobId?: string;
    updatedAt: string;
};

export type StudioEpisodeProduction = {
    version: 1;
    script?: StudioScriptDocument;
    scriptVersions: StudioScriptVersion[];
    storyboard?: StudioStoryboardDocument;
    storyboardVersions: StudioStoryboardVersion[];
    /** 快照复制出的独立分镜草稿；不参与正式工作区版本。 */
    storyboardDrafts: StudioStoryboardDraft[];
    /** 第四步审核状态、审核记录与确定性检查；与正式分镜内容分离。 */
    storyboardReview?: StudioStoryboardReview;
    /** 正式分镜写入幂等 / 冲突审计；旧项目缺失时不需要迁移。 */
    storyboardWriteOperations?: StudioStoryboardWriteJournalEntry[];
    checks: StudioProductionCheck[];
    updatedAt: string;
};

export type StudioProductionBuildContext = {
    projectId: string;
    analysisVersion: number;
    handoff: StudioAdaptationHandoff;
    workspace: StudioAdaptationWorkspace;
    adaptationHandoffId: string;
};

export type StudioProductionAssetIndex = {
    characters: { characterId: string; name: string; role: string; look: string; costume: string }[];
    locations: { locationId: string; name: string; description: string; variantIds: string[] }[];
    props: { propId: string; name: string; state: string; important: boolean }[];
};

export type StudioProductionRawScriptScene = {
    sceneTitle: string;
    locationName: string;
    locationVariant?: string;
    timeOfDay: string;
    environment: string;
    charactersPresent: string[];
    props: string[];
    scenePurpose: string;
    conflict: string;
    action: string;
    dialogueBlocks: {
        speaker: string;
        text: string;
        delivery?: string;
        emotion?: string;
        subtext?: string;
        linkedAction?: string;
        timing?: string;
    }[];
    transitionIn: string;
    transitionOut: string;
    continuityNotes: string;
};

export type StudioProductionRawScript = {
    title: string;
    logline: string;
    synopsis: string;
    scenes: StudioProductionRawScriptScene[];
};

export type StudioProductionRawShotGroup = {
    groupNumber?: number;
    sharedLayout: string;
    characterStartPositions?: {
        name: string;
        position: string;
        orientation: string;
        eyeline: string;
    }[];
    cameraAxis: string;
    propStates: string;
    timeOfDay: string;
    lighting: string;
    weather: string;
    continuityRules?: string[];
    shots: StudioProductionRawShot[];
};

export type StudioProductionRawShot = {
    shotNumber?: number;
    duration?: number;
    shotSize: string;
    cameraPosition: string;
    cameraAngle: string;
    lens: string;
    cameraMovement: string;
    composition: string;
    foreground: string;
    midground: string;
    background: string;
    characterBlocking: string;
    eyeline: string;
    action: string;
    facialExpression: string;
    emotion: string;
    charactersPresent?: string[];
    props?: string[];
    dialogue?: { speaker: string; text: string; delivery?: string; emotion?: string }[];
    voiceOver: string;
    soundEffects: string;
    backgroundMusic: string;
    lighting: string;
    environment: string;
    continuityRules?: string[];
    imagePrompt: string;
    videoPrompt: string;
};

export type StudioProductionRawStoryboard = {
    groups: StudioProductionRawShotGroup[];
};

/** 模型调用审计：不保存 API Key，只记录项目级模型、参数和版本。 */
export type StudioProductionModelTrace = {
    model: { channelId: string; modelId: string; label: string };
    modelParams: Record<string, string | number | boolean>;
    capability?: "text";
    jobId?: string;
    episodeId?: string;
    promptVersion: string;
    inputVersion: number;
    inputChars: number;
    outputChars: number;
    calls: number;
    startedAt: string;
    finishedAt: string;
};

export type StudioProductionGenerationResult<T> = {
    document: T;
    trace: StudioProductionModelTrace;
    rawText: string;
};

export type StudioProductionOrigin = StudioAdaptationOrigin;
