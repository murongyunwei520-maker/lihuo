// 短剧项目：一条有序的镜头流，是「分镜设计 / 逐镜生产 / 成片合成」共用的同一份数据。
// 这里只放结构，约束与文案在 lib/drama/schema.ts，校验规则在 lib/drama/lint.ts。

/** 光位：决定同一场景里连播时会不会出现「光从左边来又从右边来」的穿帮。 */
export type DramaLight = "left" | "right" | "none";

/** 剧本来源：用户自己上传/粘贴，还是让 AI 从灵感生成。 */
export type DramaScriptSource = "upload" | "paste" | "generated" | "none";

/** 剧本：短剧工厂的上游输入，场景、资产、分镜都由它派生。 */
export type DramaScript = {
    /** 剧本文本，纯文本。 */
    text: string;
    source: DramaScriptSource;
    /** 文件名（上传时才有），仅作展示。 */
    fileName?: string;
    /** 一句话灵感（generated 时保留，便于重生成）。 */
    premise?: string;
    /** 题材。 */
    genre?: string;
    /** 核心剧情方向。 */
    direction?: string;
    /** 故事背景 / 世界观雏形，03 步确认设定时继续展开。 */
    background?: string;
    /** 创作要求（节奏、禁忌、平台规范等自由文本）。 */
    requirement?: string;
    /** 故事大纲：分集之前的一页纸。 */
    outline?: string;
};

/** 一次生成的产物记录：同一镜头/资产可以有多版，选中哪版写回主字段。 */
export type DramaMediaVersion = {
    storageKey: string;
    model?: string;
    /** 实际提交给模型的完整提示词，用于复现。 */
    prompt?: string;
    /** 实际提交的原生参数（比例、时长、画质、音色等），只放非敏感值。 */
    parameters?: Record<string, string>;
    createdAt: string;
};

export type DramaShotStatus = "pending" | "running" | "done" | "failed";

/** 已提交到远端的异步任务凭据：刷新后可以接着查，不用重新提交。 */
export type DramaRemoteTask = {
    taskId: string;
    provider: "openai" | "gemini" | "plugin" | "doubao" | "cloud";
    model: string;
    /** 提交时的提示词，续查后写进版本记录。 */
    prompt: string;
    params?: Record<string, string>;
    createdAt: string;
};

/** 单个媒体的生成状态：图片 / 声音 / 视频各自独立，不再共用一个 status。 */
export type DramaMediaState = {
    status: DramaShotStatus;
    error?: string;
    updatedAt?: string;
    /** 剧本改过、这一镜内容变了，但画面/配音/视频还是旧的；重新生成后清掉。 */
    stale?: boolean;
    /** 只有视频这类异步任务会带；有值表示服务器上可能还有结果可取。 */
    remote?: DramaRemoteTask;
};

export type DramaShot = {
    id: string;
    /** 镜号，用于人工核对，例如 "01"。 */
    no: string;
    /** 所属场景名；同一场景的镜头靠这个字段分组，不另建场景表。 */
    scene: string;
    /** 场景地点与环境，拆词后可与场景资产对齐。 */
    location?: string;
    /** 出场人物名（展示用；真实关联以 assetIds 为准）。 */
    characters?: string[];
    /** 模型声明的其它资产名（道具 / 服装 / 特效），用于绑定已有资产卡。 */
    assetNames?: string[];
    size: string;
    /** 机位，例如「平视 / 俯拍」。 */
    camera?: string;
    move: string;
    /** 构图，例如「中心构图」。 */
    composition?: string;
    light: DramaLight;
    /** 秒，取值范围见 SHOT_MIN_SECONDS / SHOT_MAX_SECONDS。 */
    seconds: number;
    /** 台词；空字符串表示无台词。 */
    line: string;
    /** 台词说话人（人物资产 id 或名字）；空表示旁白/未指定。 */
    speaker?: string;
    /** 人物动作。 */
    action?: string;
    /** 面部表情。 */
    expression?: string;
    /** 镜头级摄影覆盖：留空表示跟随项目默认。 */
    lens?: string;
    aperture?: string;
    keyLight?: string;
    fillLight?: string;
    /** 画面描述；与台词分开存，避免编辑画面时产生假对白。 */
    prompt: string;
    /** 提交给图片模型的最终提示词；为空时按项目上下文实时构造。 */
    imagePrompt?: string;
    /** 提交给视频模型的动态提示词（运动 / 起止状态 / 连续性约束）。 */
    videoPrompt?: string;
    /** 声音需求（环境声 / 音效 / 旁白）。 */
    sound?: string;
    /** 情绪 / 备注等自由语义标签。 */
    note?: string;
    /** 图片生成状态（兼容画布节点读的旧字段，等于 generation.image.status）。 */
    status: DramaShotStatus;
    /** 三种媒体各自的生成状态。 */
    generation?: {
        image?: DramaMediaState;
        audio?: DramaMediaState;
        video?: DramaMediaState;
    };
    /** 生成进度 0–100，仅 running 时有意义。 */
    progress?: number;
    /** 引用的资产卡 id，跨镜头一致性靠它对齐。 */
    assetIds: string[];
    /** 关联的画布节点 id；生成结果会落在该节点上。 */
    nodeId?: string;
    /** 当前选用的画面（storageKey）。 */
    imageRef?: string;
    /** 当前选用的配音（storageKey）。 */
    audioRef?: string;
    /** 当前选用的视频（storageKey）。 */
    videoRef?: string;
    /** 历史版本，最新在前；主字段是「正式版」。 */
    imageVersions?: DramaMediaVersion[];
    audioVersions?: DramaMediaVersion[];
    videoVersions?: DramaMediaVersion[];
    /** 这一镜是否已通过人工审核。 */
    approved?: boolean;
    /** 音轨在镜头内的起始偏移（毫秒），成片合成时按它对齐。 */
    audioOffsetMs?: number;
};

export type DramaAssetKind = "character" | "scene" | "costume" | "prop" | "effect" | "other";

export type DramaAsset = {
    id: string;
    name: string;
    kind: DramaAssetKind;
    /** 固定描述，出图时随镜头的 prompt 一起提交。 */
    description: string;
    /** 参考图：storageKey 或公网 URL。人物可放正面/侧面/背面多张。 */
    refs: string[];
    /** 历史版本，最新在前。 */
    versions?: DramaMediaVersion[];
    /** 生成这张资产时用的模型，便于复现。 */
    model?: string;
    /** 人物音色样本（已授权上传的参考音频，storageKey）。注意：只作参考音频，不能克隆音色。 */
    audioRef?: string;
};

/** 项目设定集：世界观、人物关系与视觉规范，03 步确认后供后续提示词引用。 */
export type DramaBible = {
    world: string;
    background: string;
    relations: string;
    visual: string;
    /** 时代与地域（进入所有生成提示词）。 */
    era?: string;
    /** 色彩基调。 */
    palette?: string;
    /** 材质与质感基准。 */
    material?: string;
    /** 负面提示词：全项目统一禁止出现的内容。 */
    negative?: string;
};

/** 项目级生成设置：全部是可下拉选择、可自定义填写的字符串值。 */
export type DramaSettings = {
    /** 选中的文本模型（encodeChannelModel 编码值）；空串 = 跟随画布默认。 */
    textModel: string;
    /** 选中的图片模型（资产图 / 逐镜出图）。 */
    imageModel: string;
    /** 选中的视频模型。 */
    videoModel: string;
    /** 选中的音频模型。 */
    audioModel: string;
    style: string;
    /** 出图比例。 */
    ratio: string;
    /** 视频比例。 */
    videoRatio: string;
    /** 视频时长（秒），4–15s。 */
    videoSeconds: string;
    /** 视频分辨率。 */
    videoQuality: string;
    casting: string;
    episodes: string;
    targetDuration: string;
    shotDuration: string;
    /** 资产图的画质。 */
    assetQuality: string;
    /** 项目级默认摄影规范：镜头可用同名字段覆盖。 */
    lens: string;
    aperture: string;
    keyLight: string;
    fillLight: string;
    composition: string;
};

export type DramaSequence = {
    id: string;
    title: string;
    /** 单集目标时长（秒），分镜表的预算线。 */
    targetSeconds: number;
    shots: DramaShot[];
    assets: DramaAsset[];
    /** 上游剧本；为空表示还没有剧本。 */
    script?: DramaScript;
    /** 拆镜快照：这批镜头是按哪一版剧本拆的；剧本改过之后据此判断下游要同步。 */
    split?: {
        /** 剧本指纹，见 lib/drama/sync.ts 的 scriptFingerprint。 */
        scriptHash: string;
        at: string;
        /** 拆镜方式；老数据补快照时不知道，留空。 */
        mode?: "ai" | "rule";
    };
    /** 设定集（03 步）。 */
    bible?: DramaBible;
    /** 设定是根据哪一版剧本自动补全的（剧本指纹）；与当前剧本不一致时提示可重新生成。 */
    bibleHash?: string;
    /** 人物名 → 音色名（08 步绑定，后续生成对白默认用它）。 */
    voices?: Record<string, string>;
    /** 文档级生成设置；缺省时按 DEFAULT_DRAMA_SETTINGS 展示。 */
    settings?: DramaSettings;
    /** 关联的画布项目 id。 */
    projectId?: string;
    /** 最近一次成片导出的时间与文件说明。 */
    exportedAt?: string;
    createdAt: string;
    updatedAt: string;
};
