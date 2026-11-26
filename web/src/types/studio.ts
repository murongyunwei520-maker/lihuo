// 短剧工坊 V2：项目 / 集 / 资产 / 场景 / 镜头 / 媒体版本 / 任务 的统一数据结构。
// 图片、视频、声音都挂在同一个 shotId 上，工作区只是同一份数据的不同视图。

import type { StudioAdaptationWorkspace } from "./studio-adaptation";
import type { StudioEpisodeProduction, StudioProductionWorkspace } from "./studio-production";
import type { NovelAnalysis, NovelAnalysisOverrides, NovelAnalysisRun, StudioNovel } from "./novel";

export type StudioWorkspace = "projects" | "script" | "assets" | "director" | "picture" | "video" | "sound";

/** 短剧工作室正式五步；projects 是项目首页，不属于生产步骤。 */
export type DramaStep = "analysis" | "assets" | "script" | "review" | "video";

export type DramaStepStatus = "idle" | "pending" | "running" | "waiting_review" | "completed" | "partial" | "failed" | "paused";

export type DramaProjectStatus =
    | "draft"
    | "importing"
    | "analyzing"
    | "analysis_ready"
    | "assets_generating"
    | "assets_review"
    | "scripting"
    | "storyboarding"
    | "keyframes_generating"
    | "storyboard_review"
    | "video_generating"
    | "completed"
    | "paused"
    | "failed";

export type DramaModelCapability = "text" | "image" | "video";

/** 只存渠道与模型身份，不存任何 API Key。 */
export type DramaModelSelection = {
    channelId: string;
    modelId: string;
};

export type DramaModelParamValue = string | number | boolean;

/**
 * 项目级模型方案。参数按 capability + channelId + modelId 隔离；
 * 切换模型时旧模型参数仍留在 paramsByKey 中，切回可恢复。
 */
export type DramaModelProfiles = {
    version: 1;
    selected: Partial<Record<DramaModelCapability, DramaModelSelection>>;
    paramsByKey: Record<string, Record<string, DramaModelParamValue>>;
};

export type DramaWorkflowRun = {
    id: string;
    status: "idle" | "running" | "paused" | "failed" | "completed";
    startedAt?: string;
    updatedAt: string;
    lastError?: string;
};

export type DramaStepStates = Record<DramaStep, DramaStepStatus>;

export const DRAMA_STEP_KEYS: DramaStep[] = ["analysis", "assets", "script", "review", "video"];

export const DRAMA_STEP_LABEL: Record<DramaStep, string> = {
    analysis: "AI 小说分析",
    assets: "角色与场景资产",
    script: "分集剧本与分镜",
    review: "分镜审核与调整",
    video: "视频生成",
};

export const DRAMA_STEP_SHORT_LABEL: Record<DramaStep, string> = {
    analysis: "小说分析",
    assets: "角色场景",
    script: "剧本分镜",
    review: "分镜审核",
    video: "视频生成",
};

export const DRAMA_STEP_NUMBER: Record<DramaStep, string> = {
    analysis: "01",
    assets: "02",
    script: "03",
    review: "04",
    video: "05",
};

export function createDefaultDramaStepStates(): DramaStepStates {
    return { analysis: "idle", assets: "idle", script: "idle", review: "idle", video: "idle" };
}

export const EMPTY_DRAMA_MODEL_PROFILES: DramaModelProfiles = {
    version: 1,
    selected: {},
    paramsByKey: {},
};

export type StudioAssetKind = "character" | "scene" | "costume" | "prop";

export type StudioMediaKind = "image" | "video" | "audio" | "narration" | "sfx";

export type StudioMediaStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "stale";

export type StudioVersionSource = "studio" | "workflow" | "upload" | "migration";

/** 一次生成/上传的产物记录。正式版由 shot.imageRef 等字段指向，候选版只留在 versions 里。 */
export type StudioMediaVersion = {
    id: string;
    storageKey: string;
    model?: string;
    accountId?: string;
    accountName?: string;
    prompt?: string;
    params?: Record<string, string>;
    source: StudioVersionSource;
    /** 生成这条素材时用到的资产正式版快照（assetId → 版本 id），依赖检查靠它判断是否过期。 */
    assetVersionIds?: Record<string, string>;
    /** 对应的全局任务 id，方便从任务中心追到产物。 */
    generationId?: string;
    createdAt: string;
};

export type StudioReferenceFile = {
    id: string;
    name: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
};

export type StudioScriptVersion = {
    id: string;
    text: string;
    createdAt: string;
    note?: string;
};

export type StudioScript = {
    premise: string;
    genre: string;
    type: string;
    audience: string;
    direction: string;
    conflict: string;
    constraints: string;
    referenceFiles: StudioReferenceFile[];
    outline: string;
    outlineVersions: StudioScriptVersion[];
    text: string;
    versions: StudioScriptVersion[];
    source: "none" | "generated" | "paste" | "upload";
    fileName?: string;
    confirmedAt?: string;
};

export type StudioCharacterPlan = {
    name: string;
    role: string;
    description: string;
};

export type StudioStoryBible = {
    logline: string;
    synopsis: string;
    world: string;
    background: string;
    mainPlot: string;
    conflict: string;
    ending: string;
    relations: string;
    characters: StudioCharacterPlan[];
};

export type StudioVisualStyle = {
    mainStyle: string;
    renderMode: string;
    palette: string;
    photography: string;
    lighting: string;
    material: string;
    negative: string;
    consistency: string;
};

export type StudioProjectSettings = {
    textModel: string;
    imageModel: string;
    videoModel: string;
    audioModel: string;
    style: string;
    imageRatio: string;
    imageQuality: string;
    videoRatio: string;
    videoQuality: string;
    videoSeconds: string;
    /** 项目默认豆包视频账号；镜头没有单独指定时继承。 */
    videoAccountId: string;
    targetSeconds: number;
    lens: string;
    aperture: string;
    keyLight: string;
    fillLight: string;
    composition: string;
    narratorVoice: string;
    /** 全局任务中心的同时运行上限。 */
    concurrency: number;
};

export type StudioScene = {
    id: string;
    no: string;
    name: string;
    location: string;
    description: string;
    timeOfDay: string;
    weather: string;
    /** 关联的场景资产 id（场景资产是项目级共享的）。 */
    assetId?: string;
};

export type StudioShot = {
    id: string;
    episodeId: string;
    sceneId: string;
    /** 镜号，例如 "01"。 */
    no: string;
    sceneName: string;
    description: string;
    /** 展示用人物名；真实关联以 assetIds 为准。 */
    characterNames: string[];
    assetIds: string[];
    action: string;
    expression: string;
    position: string;
    orientation: string;
    environment: string;
    size: string;
    camera: string;
    lens: string;
    movement: string;
    composition: string;
    lighting: string;
    effects: string;
    line: string;
    speaker: string;
    narration: string;
    ambience: string;
    sfx: string;
    seconds: number;
    actualSeconds?: number;
    locked?: boolean;
    approved?: boolean;
    /** 各媒体独立状态，不再共用一个 status。 */
    imageStatus: StudioMediaStatus;
    videoStatus: StudioMediaStatus;
    audioStatus: StudioMediaStatus;
    narrationStatus: StudioMediaStatus;
    sfxStatus: StudioMediaStatus;
    /** 正式版本（storageKey）；候选版只存在 versions 里。 */
    imageRef?: string;
    videoRef?: string;
    audioRef?: string;
    narrationRef?: string;
    sfxRef?: string;
    imageVersions: StudioMediaVersion[];
    videoVersions: StudioMediaVersion[];
    audioVersions: StudioMediaVersion[];
    narrationVersions: StudioMediaVersion[];
    sfxVersions: StudioMediaVersion[];
    /** 视频尾帧（仅模型明确支持时提交）。 */
    videoLastFrameRef?: string;
    /** 用户改写的提示词；为空时按项目与镜头上下文实时组装。 */
    imagePrompt?: string;
    videoPrompt?: string;
    /** 单镜头模型覆盖；为空继承项目默认。 */
    imageModel?: string;
    videoModel?: string;
    audioModel?: string;
    imageRatio?: string;
    videoRatio?: string;
    videoSeconds?: string;
    videoQuality?: string;
    /** 本镜明确选择的豆包账号；为空时继承项目默认，再为空才号池自动。 */
    videoAccountId?: string;
    /** 上游资产改动后需要人工确认的标记，不自动删除或重生成。 */
    impact?: Partial<Record<StudioMediaKind, string>>;
    /** 异步视频任务的远端凭据，用于续查。 */
    videoRemote?: {
        taskId: string;
        provider: "openai" | "gemini" | "plugin" | "doubao" | "cloud";
        model: string;
        prompt: string;
        params?: Record<string, string>;
        createdAt: string;
    };
    /** 关联的画布节点 id（Workflow 回传时用）。 */
    workflowNodeId?: string;
};

export type StudioAsset = {
    id: string;
    kind: StudioAssetKind;
    name: string;
    role: string;
    description: string;
    age: string;
    face: string;
    hair: string;
    body: string;
    costume: string;
    /** 场景资产专用。 */
    layout: string;
    environment: string;
    timeOfDay: string;
    weather: string;
    lighting: string;
    material: string;
    /** 正式参考图（storageKey）；候选版在 versions 里。 */
    officialRef?: string;
    versions: StudioMediaVersion[];
    /** 人物音色（audio-speech 预设 voice）；跨集复用。 */
    voiceId?: string;
    audioSampleRef?: string;
    archived?: boolean;
    createdAt: string;
    updatedAt: string;
};

export type StudioMusicTrack = {
    id: string;
    name: string;
    purpose: string;
    mood: string;
    storageKey: string;
    createdAt: string;
    source: "upload";
};

export type StudioEpisode = {
    id: string;
    no: number;
    title: string;
    targetSeconds: number;
    /** 分集规划字段。 */
    coreEvent: string;
    mainConflict: string;
    continuity: string;
    hook: string;
    script: StudioScript;
    scenes: StudioScene[];
    shots: StudioShot[];
    /** 阶段 3 正式剧本与结构化分镜；挂在本集内，不另建项目根对象。 */
    production?: StudioEpisodeProduction;
    /** 关联的 Workflow 画布项目。 */
    workflowProjectId?: string;
    /** 最近一次 AI 连续性检查结果。 */
    continuityReport?: { createdAt: string; issues: { level: "error" | "warning" | "info"; message: string }[] };
    createdAt: string;
    updatedAt: string;
};

export type StudioProject = {
    id: string;
    title: string;
    logline: string;
    genre: string;
    archived?: boolean;
    settings: StudioProjectSettings;
    bible: StudioStoryBible;
    visualStyle: StudioVisualStyle;
    /** 项目级共享资产：同一项目所有集共用，跨集复用人物/场景/服装/道具。 */
    assets: StudioAsset[];
    /** BGM 曲目（当前链路只能导入外部音频，生成需要音乐模型）。 */
    bgmTracks?: StudioMusicTrack[];
    /** 配乐需求说明，方便后续接入音乐生成模型。 */
    bgmBrief?: string;
    episodes: StudioEpisode[];
    /** 固定生产模式：全剧规划，不等于无限并发。 */
    workflowMode: "all";
    /** 工作流自动推进；不代表豆包/Dola 账号自动切换。 */
    automationMode: "auto";
    /** 智能短剧化改编，重要改编可追踪。 */
    adaptationMode: "adapt";
    projectStatus: DramaProjectStatus;
    /** 工作流当前阶段，不是当前打开的页面。 */
    currentStep: DramaStep;
    stepStates: DramaStepStates;
    /** 项目级模型方案；不写入全局 AiConfig，也不保存 API Key。 */
    modelProfiles: DramaModelProfiles;
    /** 阶段 2A 小说原文；原文只在 chapters 中保存一份。 */
    novel?: StudioNovel;
    /** 阶段 2B 总编剧工作区；不替代阶段 3 的 episodes / shots / assets。 */
    adaptation?: StudioAdaptationWorkspace;
    /** 阶段 3 交接快照与有序生成队列；剧本/分镜内容仍在各集 StudioEpisode 内。 */
    production?: StudioProductionWorkspace;
    /** 当前展示的 AI 分析版本；人工修正不写在这里。 */
    novelAnalysis?: NovelAnalysis;
    /** 人工修正独立保存，重新分析不会覆盖。 */
    novelAnalysisOverrides?: NovelAnalysisOverrides;
    /** 小说分析任务记录；包含分块断点，刷新后恢复为 interrupted/unknown。 */
    analysisRuns?: NovelAnalysisRun[];
    analysisRunId?: string;
    /** 第一阶段接入小说文档库后写入；阶段 1 不创建。 */
    novelId?: string;
    workflowRunId?: string;
    workflowRun?: DramaWorkflowRun;
    /** 从旧版序列迁移而来时记录来源 id，便于追溯。 */
    legacySequenceId?: string;
    createdAt: string;
    updatedAt: string;
};

export type StudioTaskKind = "text" | "image" | "video" | "audio" | "analysis" | "agent";

export type StudioTaskStatus = "pending" | "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelling" | "cancelled" | "canceled" | "retrying" | "unknown" | "interrupted";

export type StudioTaskRemote = {
    provider: "openai" | "gemini" | "plugin" | "doubao" | "cloud";
    taskId: string;
    model: string;
};

export type StudioTaskInput = {
    kind: StudioTaskKind;
    label: string;
    projectId?: string;
    episodeId?: string;
    shotId?: string;
    assetId?: string;
    model?: string;
    accountId?: string;
    accountName?: string;
    prompt?: string;
    params?: Record<string, string>;
    /** 提交时冻结的模型配置摘要；只记录可展示的标识，不写入凭据。 */
    modelSnapshot?: Record<string, string>;
    /** 本次提交使用的 Prompt 版本，便于刷新后判断能否安全重试。 */
    promptVersion?: string;
    /** 从历史任务重新执行时指向原任务。 */
    retryOf?: string;
};

export type StudioTaskSubmitState = "not_submitted" | "submitting" | "submitted" | "unknown";

export type StudioTaskCancelRequest = {
    requestedAt: string;
    requestedBy: string;
    /** local_abort 只停止前端等待；manual 是用户人工核验；remote_api 才代表后端确认。 */
    method: "local_abort" | "manual" | "remote_api";
    remoteConfirmed: boolean;
    confirmedAt?: string;
    confirmedBy?: string;
    confirmMethod?: "manual" | "remote_api";
    note?: string;
};

export type StudioTask = StudioTaskInput & {
    id: string;
    status: StudioTaskStatus;
    progress?: number;
    /** 本地/浏览器模式没有服务端账单，0 表示未计费。 */
    costCents?: number;
    error?: string;
    outputKey?: string;
    remote?: StudioTaskRemote;
    note?: string;
    /** 取消是本地等待、人工核验还是远端 API 确认；不得互相冒充。 */
    cancelRequest?: StudioTaskCancelRequest;
    /** 远端提交边界：页面刷新/卸载后据此判断能否安全重试。 */
    submitState?: StudioTaskSubmitState;
    submitStartedAt?: string;
    submitConfirmedAt?: string;
    retryCount: number;
    logs: string[];
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
};

export const STUDIO_ASSET_KIND_LABEL: Record<StudioAssetKind, string> = {
    character: "人物",
    scene: "场景",
    costume: "服装",
    prop: "道具",
};

export const STUDIO_MEDIA_KIND_LABEL: Record<StudioMediaKind, string> = {
    image: "画面",
    video: "视频",
    audio: "对白",
    narration: "旁白",
    sfx: "音效",
};

export const STUDIO_WORKSPACE_LABEL: Record<StudioWorkspace, string> = {
    projects: "项目管理",
    script: "剧本中心",
    assets: "资产中心",
    director: "导演中心",
    picture: "画面中心",
    video: "视频中心",
    sound: "声音中心",
};

export const SHOT_SIZES = ["远景", "全景", "中景", "近景", "特写"];
export const SHOT_MOVES = ["固定", "推", "拉", "摇", "移", "跟拍", "手持"];
export const SHOT_CAMERAS = ["平视", "俯拍", "仰拍", "过肩", "主观视角"];
export const SHOT_COMPOSITIONS = ["中心构图", "三分构图", "对称构图", "留白构图", "前景遮挡", "低角度构图"];
export const SHOT_LIGHTING = ["左侧主光", "右侧主光", "顶光", "逆光轮廓", "窗光", "无主光"];
export const SHOT_LENSES = ["自动", "24mm 广角", "35mm 人文", "50mm 标准", "85mm 中焦", "135mm 长焦", "微距"];

export const DEFAULT_PROJECT_SETTINGS: StudioProjectSettings = {
    textModel: "",
    imageModel: "",
    videoModel: "",
    audioModel: "",
    style: "自动",
    imageRatio: "9:16",
    imageQuality: "自动",
    videoRatio: "9:16",
    videoQuality: "自动",
    videoSeconds: "自动",
    videoAccountId: "",
    targetSeconds: 60,
    lens: "35mm 人文",
    aperture: "f/2.8 浅景深",
    keyLight: "左侧主光",
    fillLight: "柔和补光",
    composition: "三分构图",
    narratorVoice: "",
    concurrency: 3,
};

export const DEFAULT_VISUAL_STYLE: StudioVisualStyle = {
    mainStyle: "写实电影",
    renderMode: "电影级写实渲染",
    palette: "低饱和冷暖对比",
    photography: "35mm 人文视角，浅景深",
    lighting: "自然光为主，方向统一",
    material: "真实材质，保留细微纹理",
    negative: "低清晰度、畸形手部、多余人物、文字水印、塑料质感",
    consistency: "人物五官、发型、服装与参考资产保持一致；同一场景光线方向不变",
};

export const EMPTY_SCRIPT: StudioScript = {
    premise: "",
    genre: "",
    type: "",
    audience: "",
    direction: "",
    conflict: "",
    constraints: "",
    referenceFiles: [],
    outline: "",
    outlineVersions: [],
    text: "",
    versions: [],
    source: "none",
};
