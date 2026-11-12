// 短剧序列：一条有序的镜头流，是「分镜表 / 时间轴 / 自由画布」三个视图的同一份数据。
// 这里只放结构，约束与文案在 lib/drama/schema.ts，校验规则在 lib/drama/lint.ts。

/** 光位：决定同一场景里连播时会不会出现「光从左边来又从右边来」的穿帮。 */
export type DramaLight = "left" | "right" | "none";

export type DramaShotStatus = "pending" | "running" | "done" | "failed";

export type DramaShot = {
    id: string;
    /** 镜号，用于人工核对，例如 "01"。 */
    no: string;
    scene: string;
    size: string;
    move: string;
    light: DramaLight;
    /** 秒，取值范围见 SHOT_MIN_SECONDS / SHOT_MAX_SECONDS。 */
    seconds: number;
    /** 台词；空字符串表示无台词。 */
    line: string;
    /** 画面描述，后续拼成生成提示词。 */
    prompt: string;
    status: DramaShotStatus;
    /** 生成进度 0–100，仅 running 时有意义。 */
    progress?: number;
    /** 引用的资产卡 id，跨镜头一致性靠它对齐。 */
    assetIds: string[];
    /** 关联的画布节点 id；生成结果会落在该节点上。 */
    nodeId?: string;
};

export type DramaAssetKind = "character" | "scene" | "prop";

export type DramaAsset = {
    id: string;
    name: string;
    kind: DramaAssetKind;
    /** 固定描述，出图时随镜头的 prompt 一起提交。 */
    description: string;
    /** 参考图：storageKey 或公网 URL。 */
    refs: string[];
};

export type DramaSequence = {
    id: string;
    title: string;
    /** 单集目标时长（秒），分镜表的预算线。 */
    targetSeconds: number;
    shots: DramaShot[];
    assets: DramaAsset[];
    /** 关联的画布项目 id，暂未接上，先占位。 */
    projectId?: string;
    createdAt: string;
    updatedAt: string;
};
