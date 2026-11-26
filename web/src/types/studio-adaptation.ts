// 阶段 2B：短剧化改编与全剧分集规划。
// 这些对象是项目内的“总编剧工作区”，不替代阶段 3 的 StudioEpisode / shot / asset。
// 每个关键结论都必须能回到阶段 2A 的章节、事件、人物、地点或伏笔；AI 新增内容单独标记。

import type { NovelEvidence } from "./novel";

export type StudioAdaptationStrength = "faithful" | "balanced" | "strong";
export type StudioAdaptationReviewStatus = "draft" | "pending_review" | "approved" | "locked";
export type StudioAdaptationOrigin = "explicit" | "inferred" | "generated";
export type StudioAdaptationOperation = "preserve" | "compress" | "merge" | "reorder" | "remove" | "add" | "rewrite";
export type StudioAdaptationRiskTag =
    | "protagonist_identity"
    | "core_survival"
    | "key_relationship"
    | "key_event_removal"
    | "world_rule"
    | "core_foreshadowing"
    | "ending"
    | "major_motivation";
export type StudioAdaptationCheckLevel = "error" | "warning" | "suggestion";
export type StudioAdaptationCheckStatus = "open" | "accepted" | "ignored" | "resolved";
export type StudioAdaptationCheckSource = "deterministic" | "model";
export type StudioForeshadowingStatus = "planned" | "planted" | "advancing" | "resolved" | "abandoned" | "pending_review";
export type StudioAdaptationGenerationStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted" | "unknown";
export type StudioAdaptationGenerationKind = "full" | "strategy" | "blueprint" | "episodes" | "episode_regenerate";
export type StudioAdaptationGenerationStage = "prepare" | "strategy" | "blueprint" | "episodes" | "synthesis" | "regenerate" | "validate" | "done";
export type StudioAdaptationLifeState = "alive" | "dead" | "missing" | "transformed" | "unknown";

export const ADAPTATION_STRENGTH_LABEL: Record<StudioAdaptationStrength, string> = {
    faithful: "忠于原著",
    balanced: "平衡改编",
    strong: "强化短剧",
};

export const ADAPTATION_OPERATION_LABEL: Record<StudioAdaptationOperation, string> = {
    preserve: "保留",
    compress: "压缩",
    merge: "合并",
    reorder: "调整顺序",
    remove: "删减",
    add: "新增",
    rewrite: "重写",
};

export const ADAPTATION_ORIGIN_LABEL: Record<StudioAdaptationOrigin, string> = {
    explicit: "原著明确",
    inferred: "合理推断",
    generated: "AI 新增",
};

export const ADAPTATION_RISK_LABEL: Record<StudioAdaptationRiskTag, string> = {
    protagonist_identity: "主角身份改变",
    core_survival: "核心人物死亡或生存状态改变",
    key_relationship: "重要人物关系改变",
    key_event_removal: "关键事件删除",
    world_rule: "世界观规则改变",
    core_foreshadowing: "核心伏笔删除或改变",
    ending: "故事结局改变",
    major_motivation: "主要人物动机重大改变",
};

export const ADAPTATION_REVIEW_LABEL: Record<StudioAdaptationReviewStatus, string> = {
    draft: "草稿",
    pending_review: "待审核",
    approved: "已通过",
    locked: "已锁定",
};

export const ADAPTATION_CHECK_LABEL: Record<StudioAdaptationCheckLevel, string> = {
    error: "必须修复",
    warning: "需要确认",
    suggestion: "优化建议",
};

export const ADAPTATION_GENERATION_LABEL: Record<StudioAdaptationGenerationStatus, string> = {
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已取消",
    interrupted: "已中断",
    unknown: "状态未知",
};

export const FORESHADOWING_STATUS_LABEL: Record<StudioForeshadowingStatus, string> = {
    planned: "已规划",
    planted: "已埋设",
    advancing: "推进中",
    resolved: "已回收",
    abandoned: "已放弃",
    pending_review: "待审核",
};

export const ADAPTATION_MAX_EPISODES = 120;
export const ADAPTATION_MIN_EPISODE_SECONDS = 30;
export const ADAPTATION_MAX_EPISODE_SECONDS = 180;

/** 改编定位。修改后由生成流程消费，不能只是保存不用。 */
export type StudioAdaptationSettings = {
    genre: string;
    audience: string;
    platform: string;
    targetEpisodes: number;
    targetEpisodeSeconds: number;
    narrativeStyle: string;
    tone: string;
    strength: StudioAdaptationStrength;
    endingDirection: string;
    requirements: string;
    prohibitions: string;
    updatedAt: string;
};

/** 原著来源与必要证据。explicit 必须能落在真实章节/事件上。 */
export type StudioAdaptationSourceReference = {
    chapterIds: string[];
    eventIds: string[];
    sceneIds: string[];
    foreshadowingIds: string[];
    evidence: NovelEvidence[];
};

export type StudioAdaptationChange = {
    adaptationChangeId: string;
    operation: StudioAdaptationOperation;
    sourceType: StudioAdaptationOrigin;
    sourceReferences: StudioAdaptationSourceReference;
    beforeStructure: string;
    afterStructure: string;
    reason: string;
    characterImpact: string;
    causalityImpact: string;
    foreshadowingImpact: string;
    episodeNumbers: number[];
    riskTags: StudioAdaptationRiskTag[];
    highRisk: boolean;
    reviewStatus: StudioAdaptationReviewStatus;
    createdAt: string;
};

export type StudioAdaptationStrategy = {
    id: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    reviewStatus: StudioAdaptationReviewStatus;
    locked: boolean;
    logline: string;
    positioningSummary: string;
    structureStrategy: string;
    characterStrategy: string;
    conflictStrategy: string;
    foreshadowingStrategy: string;
    endingStrategy: string;
    episodeCountPlan: string;
    warnings: string[];
    changes: StudioAdaptationChange[];
    sourceAnalysisVersion: number;
    sourceNovelHash: string;
};

export type StudioBlueprintStage = {
    id: string;
    name: string;
    description: string;
    fromEpisode: number;
    toEpisode: number;
};

export type StudioBlueprintEvent = {
    id: string;
    order: number;
    act: string;
    title: string;
    description: string;
    episodeHint: string;
    sourceType: StudioAdaptationOrigin;
    sourceReferences: StudioAdaptationSourceReference;
    adaptationChangeIds: string[];
};

export type StudioBlueprintCharacterPlan = {
    characterId: string;
    name: string;
    role: string;
    goal: string;
    arcSummary: string;
    entranceEpisode: number;
    exitEpisode?: number;
    fate: string;
    sourceType: StudioAdaptationOrigin;
};

export type StudioBlueprintRelationshipPlan = {
    fromCharacterId: string;
    toCharacterId: string;
    fromName: string;
    toName: string;
    evolution: string;
};

export type StudioBlueprintLocationPlan = {
    sceneId: string;
    name: string;
    usage: string;
    episodeNumbers: number[];
};

export type StudioSeriesBlueprint = {
    id: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    reviewStatus: StudioAdaptationReviewStatus;
    locked: boolean;
    title: string;
    theme: string;
    logline: string;
    mainline: string;
    centralConflict: string;
    protagonistGoals: string[];
    antagonist: { name: string; motivation: string; pressure: string };
    relationshipEvolution: string;
    stages: StudioBlueprintStage[];
    keyEvents: StudioBlueprintEvent[];
    climax: string;
    ending: string;
    foreshadowingPlan: string;
    characters: StudioBlueprintCharacterPlan[];
    relationships: StudioBlueprintRelationshipPlan[];
    locations: StudioBlueprintLocationPlan[];
    timeline: string;
    sourceAnalysisVersion: number;
    sourceNovelHash: string;
};

export type StudioEpisodeKeyEvent = {
    id: string;
    description: string;
    sourceType: StudioAdaptationOrigin;
    sourceReferences: StudioAdaptationSourceReference;
    adaptationChangeIds: string[];
};

export type StudioEpisodeCharacterRef = {
    characterId: string;
    name: string;
    role: string;
    summary: string;
};

/** 全剧记忆的核心：每个人在这一集知道什么、不知道什么、在哪、关系与生死状态。 */
export type StudioEpisodeCharacterState = {
    characterId: string;
    name: string;
    location: string;
    knows: string[];
    unknown: string[];
    relationships: string;
    physicalState: string;
    abilityState: string;
    identityState: string;
    present: boolean;
    lifeState: StudioAdaptationLifeState;
};

export type StudioEpisodeRelationshipChange = {
    fromCharacterId: string;
    toCharacterId: string;
    fromName: string;
    toName: string;
    change: string;
};

export type StudioEpisodeLocationRef = {
    sceneId: string;
    name: string;
    purpose: string;
};

export type StudioEpisodeAdaptationNote = {
    adaptationChangeId: string;
    operation: StudioAdaptationOperation;
    description: string;
    highRisk: boolean;
    reviewStatus: StudioAdaptationReviewStatus;
};

export type StudioEpisodePlanCore = {
    episodeId: string;
    episodeNumber: number;
    episodeTitle: string;
    episodeLogline: string;
    episodeSynopsis: string;
    dramaticGoal: string;
    openingHook: string;
    mainConflict: string;
    keyEvents: StudioEpisodeKeyEvent[];
    characterAppearances: StudioEpisodeCharacterRef[];
    characterStates: StudioEpisodeCharacterState[];
    characterRelationshipChanges: StudioEpisodeRelationshipChange[];
    locations: StudioEpisodeLocationRef[];
    emotionalProgression: string[];
    climax: string;
    endingHook: string;
    foreshadowingIntroduced: string[];
    foreshadowingAdvanced: string[];
    foreshadowingResolved: string[];
    continuityDependencies: string[];
    estimatedDuration: number;
    sourceReferences: StudioAdaptationSourceReference;
    adaptationChanges: StudioEpisodeAdaptationNote[];
    reviewStatus: StudioAdaptationReviewStatus;
    version: number;
    createdAt: string;
    updatedAt: string;
};

export type StudioEpisodePlanVersion = {
    id: string;
    version: number;
    createdAt: string;
    reason: string;
    plan: StudioEpisodePlanCore;
};

export type StudioEpisodePlan = StudioEpisodePlanCore & {
    locked: boolean;
    versions: StudioEpisodePlanVersion[];
};

export type StudioCharacterArcMilestone = {
    episodeNumber: number;
    type: "first_appearance" | "exit" | "death" | "return" | "reveal" | "turning_point" | "choice";
    description: string;
    sourceType: StudioAdaptationOrigin;
    sourceReferences: StudioAdaptationSourceReference;
    /** generated 里程碑必须由用户确认后才能作为剧情依据；保存确认时间以便审计。 */
    confirmedAt?: string;
};

export type StudioCharacterArcTimelinePoint = {
    episodeNumber: number;
    location: string;
    knows: string[];
    unknown: string[];
    relationships: string;
    physicalState: string;
    abilityState: string;
    identityState: string;
    present: boolean;
    lifeState: StudioAdaptationLifeState;
};

export type StudioCharacterArc = {
    characterId: string;
    characterName: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    initialState: string;
    coreGoal: string;
    innerConflict: string;
    flaw: string;
    turningPoints: { episodeNumber: number; description: string }[];
    keyChoices: { episodeNumber: number; description: string }[];
    relationshipChanges: { episodeNumber: number; description: string }[];
    finalState: string;
    milestones: StudioCharacterArcMilestone[];
    timeline: StudioCharacterArcTimelinePoint[];
    reviewStatus: StudioAdaptationReviewStatus;
};

export type StudioForeshadowingPoolItem = {
    foreshadowingId: string;
    content: string;
    sourceType: StudioAdaptationOrigin;
    sourceNovelForeshadowingId: string;
    firstPlantedEpisode: number;
    advancedEpisodes: number[];
    expectedResolveEpisode: number;
    actualResolveEpisode?: number;
    relatedCharacterIds: string[];
    relatedEventIds: string[];
    status: StudioForeshadowingStatus;
    isOriginal: boolean;
    isAiAdded: boolean;
    reviewStatus: StudioAdaptationReviewStatus;
    createdAt: string;
    updatedAt: string;
};

export type StudioAdaptationCheck = {
    id: string;
    level: StudioAdaptationCheckLevel;
    code: string;
    category: string;
    message: string;
    suggestion: string;
    episodeNumbers: number[];
    characterIds: string[];
    eventIds: string[];
    sceneIds: string[];
    source: StudioAdaptationCheckSource;
    status: StudioAdaptationCheckStatus;
    createdAt: string;
};

export type StudioAdaptationProposalDiffItem = {
    target: "strategy" | "blueprint" | "episode" | "characterArc" | "foreshadowing" | "check";
    key: string;
    label: string;
    before: string;
    after: string;
};

export type StudioAdaptationProposal = {
    id: string;
    kind: StudioAdaptationGenerationKind;
    title: string;
    reason: string;
    status: "pending" | "accepted" | "rejected";
    baseVersion: number;
    targetEpisodeNumbers: number[];
    createdAt: string;
    strategy?: StudioAdaptationStrategy;
    blueprint?: StudioSeriesBlueprint;
    episodePlans?: StudioEpisodePlan[];
    characterArcs?: StudioCharacterArc[];
    foreshadowings?: StudioForeshadowingPoolItem[];
    changes?: StudioAdaptationChange[];
    checks?: StudioAdaptationCheck[];
    diff: {
        strategyChanged: boolean;
        blueprintChanged: boolean;
        episodesAdded: number[];
        episodesRemoved: number[];
        episodesChanged: number[];
        notes: string[];
        items: StudioAdaptationProposalDiffItem[];
    };
};

export type StudioAdaptationSnapshot = {
    strategy?: StudioAdaptationStrategy;
    blueprint?: StudioSeriesBlueprint;
    episodePlans: StudioEpisodePlan[];
    characterArcs: StudioCharacterArc[];
    foreshadowings: StudioForeshadowingPoolItem[];
    changes: StudioAdaptationChange[];
    checks: StudioAdaptationCheck[];
};

export type StudioAdaptationHistoryEntry = {
    id: string;
    version: number;
    createdAt: string;
    reason: string;
    snapshot: StudioAdaptationSnapshot;
};

export type StudioAdaptationGeneration = {
    id: string;
    kind: StudioAdaptationGenerationKind;
    stage: StudioAdaptationGenerationStage;
    status: StudioAdaptationGenerationStatus;
    progress: number;
    currentLabel: string;
    model: { channelId: string; modelId: string; label: string };
    modelParams: Record<string, string | number | boolean>;
    inputVersion: number;
    outputVersion?: number;
    sourceAnalysisVersion: number;
    settingsSnapshot: StudioAdaptationSettings;
    targetEpisodeNumbers: number[];
    lockedEpisodeNumbers: number[];
    calls: number;
    inputChars: number;
    promptHash: string;
    outputProposalId?: string;
    error?: string;
    createdAt: string;
    startedAt?: string;
    updatedAt: string;
    finishedAt?: string;
    cancelRequestedAt?: string;
};

export type StudioAdaptationWorkspace = {
    version: 1;
    settings: StudioAdaptationSettings;
    strategy?: StudioAdaptationStrategy;
    blueprint?: StudioSeriesBlueprint;
    episodePlans: StudioEpisodePlan[];
    characterArcs: StudioCharacterArc[];
    foreshadowings: StudioForeshadowingPoolItem[];
    changes: StudioAdaptationChange[];
    checks: StudioAdaptationCheck[];
    proposals: StudioAdaptationProposal[];
    history: StudioAdaptationHistoryEntry[];
    generations: StudioAdaptationGeneration[];
    activeGenerationId?: string;
    versionNumber: number;
    createdAt: string;
    updatedAt: string;
};

/** 阶段 3 只读取当前有效版本与锁定状态，不消费 2B 的提案草稿。 */
export type StudioAdaptationHandoff = {
    projectId: string;
    analysisVersion: number;
    blueprintId: string;
    blueprintVersion: number;
    blueprint: StudioSeriesBlueprint;
    packageVersion: number;
    episodePlans: StudioEpisodePlan[];
    characterArcs: StudioCharacterArc[];
    foreshadowings: StudioForeshadowingPoolItem[];
    changes: StudioAdaptationChange[];
    checks: StudioAdaptationCheck[];
    settings: StudioAdaptationSettings;
    blueprintReviewStatus: StudioAdaptationReviewStatus;
    strategyReviewStatus: StudioAdaptationReviewStatus;
    lockedEpisodeNumbers: number[];
    lockedBlueprint: boolean;
    snapshotId: string;
    createdAt: string;
};
