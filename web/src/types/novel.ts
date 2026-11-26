// 阶段 2A：小说原文、结构化分析、证据追溯、人工修正和分析任务。
// 原文只保存一份；人物、事件、分集等分析对象只引用 chapterId 和短摘录，不复制整章正文。

export type NovelSourceFormat = "txt" | "docx" | "pdf" | "paste";
export type NovelImportStatus = "parsing" | "ready" | "failed";
export type NovelEvidenceType = "explicit" | "inferred" | "generated";

export type NovelSourceLocation = {
    page?: number;
    pageEnd?: number;
    paragraph?: number;
    paragraphEnd?: number;
    charStart?: number;
    charEnd?: number;
    label?: string;
};

/** 只保存定位信息，不复制全文。 */
export type NovelEvidence = {
    chapterId: string;
    chapterTitle: string;
    excerpt: string;
    sourceLocation: NovelSourceLocation;
    confidence: number;
    evidenceType: NovelEvidenceType;
};

export type NovelFileInfo = {
    name: string;
    mimeType: string;
    bytes: number;
    lastModified?: number;
    hash: string;
    format: NovelSourceFormat;
};

export type NovelChapter = {
    id: string;
    no: number;
    /** 识别到的章节标题；无标题章节为空。 */
    title: string;
    /** 章节原始片段（含标题行，用于逐字追溯）。 */
    text: string;
    charStart: number;
    charEnd: number;
    pageStart?: number;
    pageEnd?: number;
    paragraphStart?: number;
    paragraphEnd?: number;
    detectedBy: "heading" | "page" | "fallback" | "manual";
};

export type StudioNovel = {
    id: string;
    file: NovelFileInfo;
    status: NovelImportStatus;
    encoding: string;
    parserVersion: string;
    importedAt: string;
    updatedAt: string;
    /** 第一个章节标题之前的原文（例如书名、作者、简介）。 */
    preamble: string;
    chapters: NovelChapter[];
    charCount: number;
    chapterCount: number;
    warnings: string[];
    error?: string;
};

export type NovelProfile = {
    title: string;
    author: string;
    genre: string;
    worldType: string;
    era: string;
    mainLocations: string[];
    mainline: string;
    coreConflict: string;
    totalChapters: number;
    analyzedChapters: number;
    /** 0–100；按实际完成的章节和证据覆盖计算，不伪造 100。 */
    completeness: number;
    evidence: NovelEvidence[];
};

export type NovelCharacterStatus = "alive" | "dead" | "missing" | "transformed" | "unknown";

export type NovelCharacter = {
    id: string;
    name: string;
    aliases: string[];
    identity: string;
    age: string;
    personality: string;
    appearance: string;
    abilities: string;
    occupation: string;
    status: NovelCharacterStatus;
    motivation: string;
    arc: string;
    firstChapterId: string;
    keyChapterIds: string[];
    fate: string;
    evidence: NovelEvidence[];
};

export type NovelRelationshipChange = {
    chapterId: string;
    description: string;
};

export type NovelRelationship = {
    id: string;
    fromCharacterId: string;
    toCharacterId: string;
    fromName: string;
    toName: string;
    type: string;
    changes: NovelRelationshipChange[];
    currentStatus: string;
    keyChapterIds: string[];
    evidence: NovelEvidence[];
};

export type NovelWorldCategory = "rule" | "power" | "society" | "organization" | "geography" | "item" | "ability" | "history" | "constraint";

export type NovelWorldEntry = {
    id: string;
    category: NovelWorldCategory;
    name: string;
    description: string;
    evidence: NovelEvidence[];
};

export type NovelWorld = {
    summary: string;
    rules: string[];
    powerSystem: string;
    socialStructure: string;
    entries: NovelWorldEntry[];
    evidence: NovelEvidence[];
};

export type NovelSceneStateChange = {
    chapterId: string;
    description: string;
};

export type NovelSceneVariant = {
    id: string;
    timeOfDay: string;
    weather: string;
    condition: string;
    description: string;
    evidence: NovelEvidence[];
};

/** 地点身份与昼夜/天气/损毁等变体分开，避免把变体当成不同地点。 */
export type NovelScene = {
    id: string;
    name: string;
    type: string;
    space: string;
    region: string;
    organization: string;
    firstChapterId: string;
    keyChapterIds: string[];
    plotUses: string;
    stateChanges: NovelSceneStateChange[];
    variants: NovelSceneVariant[];
    evidence: NovelEvidence[];
};

export type NovelEvent = {
    id: string;
    title: string;
    content: string;
    chapterId: string;
    participantIds: string[];
    participantNames: string[];
    locationId: string;
    locationName: string;
    preconditions: string[];
    results: string[];
    impacts: string[];
    /** 模型给出的因果标题线索；最终分析会解析成事件 id。 */
    causeEventTitles: string[];
    consequenceEventTitles: string[];
    causeEventIds: string[];
    consequenceEventIds: string[];
    foreshadowingIds: string[];
    evidence: NovelEvidence[];
};

export type NovelForeshadowingStatus = "open" | "paid_off" | "unknown";

export type NovelForeshadowing = {
    id: string;
    content: string;
    firstChapterId: string;
    relatedCharacterIds: string[];
    relatedEventIds: string[];
    expectedPayoffChapterId: string;
    /** expected 是原著明确还是 AI 推断；为空表示未给出。 */
    expectedPayoffEvidenceType: "explicit" | "inferred" | "";
    actualPayoffChapterId: string;
    status: NovelForeshadowingStatus;
    evidence: NovelEvidence[];
};

export type NovelAnalysisStats = {
    chapters: number;
    chunks: number;
    calls: number;
    evidenceCount: number;
    explicitCount: number;
    inferredCount: number;
    generatedCount: number;
};

export type NovelAnalysis = {
    id: string;
    novelId: string;
    novelHash: string;
    version: number;
    runId: string;
    model: { channelId: string; modelId: string; label: string };
    modelParams: Record<string, string | number | boolean>;
    createdAt: string;
    updatedAt: string;
    status: "partial" | "complete";
    profile: NovelProfile;
    characters: NovelCharacter[];
    relationships: NovelRelationship[];
    world: NovelWorld;
    scenes: NovelScene[];
    events: NovelEvent[];
    foreshadowings: NovelForeshadowing[];
    stats: NovelAnalysisStats;
    warnings: string[];
};

/** 人工修正与 AI 结果分开保存；重新分析只替换 AI 结果，不删除这里。 */
export type NovelAnalysisOverrides = {
    version: 1;
    updatedAt: string;
    profile?: Partial<NovelProfile>;
    characters: Record<string, Partial<NovelCharacter>>;
    relationships: Record<string, Partial<NovelRelationship>>;
    world?: Partial<NovelWorld>;
    scenes: Record<string, Partial<NovelScene>>;
    events: Record<string, Partial<NovelEvent>>;
    foreshadowings: Record<string, Partial<NovelForeshadowing>>;
};

export type NovelAnalysisRunStatus =
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

export type NovelAnalysisPhase = "prepare" | "chapter" | "merge" | "crosscheck" | "finalize";

export type NovelChapterDigest = {
    chapterIds: string[];
    summary: string;
    characters: NovelCharacter[];
    relationships: NovelRelationship[];
    worldEntries: NovelWorldEntry[];
    scenes: NovelScene[];
    events: NovelEvent[];
    foreshadowings: NovelForeshadowing[];
    warnings: string[];
};

export type NovelAnalysisChunk = {
    id: string;
    index: number;
    chapterIds: string[];
    status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
    attempts: number;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    digest?: NovelChapterDigest;
};

export type NovelAnalysisRun = {
    id: string;
    novelId: string;
    novelHash: string;
    status: NovelAnalysisRunStatus;
    phase: NovelAnalysisPhase;
    progress: number;
    chunksTotal: number;
    chunksDone: number;
    currentLabel: string;
    model: { channelId: string; modelId: string; label: string };
    modelParams: Record<string, string | number | boolean>;
    startedAt: string;
    updatedAt: string;
    finishedAt?: string;
    error?: string;
    cancelRequestedAt?: string;
    chunks: NovelAnalysisChunk[];
    resultVersion?: number;
};

export type NovelImportProgress = {
    stage: "reading" | "decoding" | "extracting" | "chapters" | "saving" | "done";
    percent: number;
    message: string;
};

export type NovelChapterChunk = {
    id: string;
    chapterIds: string[];
    text: string;
    charCount: number;
};

export const NOVEL_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const NOVEL_CHUNK_CHAR_LIMIT = 8000;
export const NOVEL_ANALYSIS_WARNING_CHUNKS = 24;
export const NOVEL_PARSER_VERSION = "stage2a-1";

export const NOVEL_SOURCE_FORMAT_LABEL: Record<NovelSourceFormat, string> = {
    txt: "TXT",
    docx: "DOCX",
    pdf: "PDF",
    paste: "粘贴正文",
};

export const NOVEL_RUN_STATUS_LABEL: Record<NovelAnalysisRunStatus, string> = {
    pending: "待提交",
    queued: "排队中",
    submitting: "提交中",
    running: "分析中",
    succeeded: "已完成",
    failed: "失败",
    cancelling: "取消中",
    cancelled: "已取消",
    interrupted: "已中断",
    unknown: "状态未知",
};

export const NOVEL_EVIDENCE_TYPE_LABEL: Record<NovelEvidenceType, string> = {
    explicit: "原著明确",
    inferred: "原著推断",
    generated: "AI 新增",
};

export function emptyNovelWorld(): NovelWorld {
    return { summary: "", rules: [], powerSystem: "", socialStructure: "", entries: [], evidence: [] };
}

export function emptyNovelProfile(totalChapters = 0): NovelProfile {
    return {
        title: "",
        author: "",
        genre: "",
        worldType: "",
        era: "",
        mainLocations: [],
        mainline: "",
        coreConflict: "",
        totalChapters,
        analyzedChapters: 0,
        completeness: 0,
        evidence: [],
    };
}

export function emptyNovelOverrides(): NovelAnalysisOverrides {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        characters: {},
        relationships: {},
        scenes: {},
        events: {},
        foreshadowings: {},
    };
}
