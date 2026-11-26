// 阶段 2B 提示词与上下文装配。
// 只发送阶段 2A 的结构化档案、必要证据短摘录和上下文摘要，不把整本小说重复塞进每次请求。

import type { NovelAnalysis, StudioNovel } from "@/types/novel";
import type { StudioProject } from "@/types/studio";
import type { StudioAdaptationSettings } from "@/types/studio-adaptation";
import { applyNovelAnalysisOverrides, buildCompactDigest, type NovelAggregate } from "./novel-merge";

export const ADAPTATION_EPISODE_BATCH = 1;
export const ADAPTATION_EPISODE_BATCH_LARGE = 1;

function chapterOrder(novel: StudioNovel) {
    return new Map(novel.chapters.map((chapter, index) => [chapter.id, index]));
}

function evidenceBrief(analysis: NovelAnalysis) {
    return analysis.events.slice(0, 20).map((event) => {
        const first = event.evidence[0];
        return first ? `${event.title}：${first.excerpt.slice(0, 60)}` : "";
    }).filter(Boolean);
}

export function buildAdaptationSourceDigest(project: StudioProject, maxChars = 24000) {
    if (!project.novel || !project.novelAnalysis) return "";
    const analysis = applyNovelAnalysisOverrides(project.novelAnalysis, project.novelAnalysisOverrides);
    const order = chapterOrder(project.novel);
    const chapterNo = (id: string) => project.novel?.chapters[order.get(id) ?? 0]?.no ?? 0;
    const aggregate: NovelAggregate = {
        summaries: [],
        characters: analysis.characters,
        relationships: analysis.relationships,
        worldEntries: analysis.world.entries,
        scenes: analysis.scenes,
        events: analysis.events,
        foreshadowings: analysis.foreshadowings,
        warnings: analysis.warnings,
    };
    const compact = buildCompactDigest(aggregate, project.novel, maxChars);
    const idIndex = [
        "【阶段 2A ID 索引】",
        `人物：${analysis.characters.map((character) => `${character.name}=${character.id}`).join("；") || "无"}`,
        `地点：${analysis.scenes.map((scene) => `${scene.name}=${scene.id}`).join("；") || "无"}`,
        `事件：${analysis.events.map((event) => `${event.title}=${event.id}`).join("；") || "无"}`,
        `原著伏笔：${analysis.foreshadowings.map((item) => `${item.content.slice(0, 24)}=${item.id}`).join("；") || "无"}`,
        `章节：${project.novel.chapters.map((chapter) => `第${chapter.no}章=${chapter.id}`).join("；")}`,
    ].join("\n");
    const profile = [
        "【作品档案】",
        `标题：${analysis.profile.title || project.title}｜类型：${analysis.profile.genre}｜时代：${analysis.profile.era}｜世界：${analysis.profile.worldType}`,
        `主线：${analysis.profile.mainline}`,
        `核心冲突：${analysis.profile.coreConflict}`,
        `世界观规则：${analysis.world.rules.join("；")}`,
        `力量/社会：${analysis.world.powerSystem}｜${analysis.world.socialStructure}`,
    ].join("\n");
    const evidence = [
        "【代表性原文证据】",
        ...evidenceBrief(analysis),
    ].join("\n");
    return [profile, compact, idIndex, evidence].join("\n\n");
}

export function formatAdaptationSettings(settings: StudioAdaptationSettings) {
    return [
        `短剧题材：${settings.genre || "未指定"}`,
        `目标受众：${settings.audience || "未指定"}`,
        `发布平台：${settings.platform || "未指定"}`,
        `目标总集数：${settings.targetEpisodes}`,
        `单集目标时长：${settings.targetEpisodeSeconds} 秒`,
        `整体叙事风格：${settings.narrativeStyle || "未指定"}`,
        `情绪基调：${settings.tone || "未指定"}`,
        `改编强度：${settings.strength}`,
        `结局倾向：${settings.endingDirection || "未指定"}`,
        `特别要求：${settings.requirements || "无"}`,
        `禁止事项：${settings.prohibitions || "无"}`,
    ].join("\n");
}

const JSON_RULES = `你是离火 AI 短剧工作室的总编剧。你不是单集编剧，必须对全剧结构、人物弧光、因果和伏笔负责。
严格遵守：
1. 只输出一个合法 JSON 对象，不要 Markdown，不要解释，不要输出 JSON 之外的文字。
2. 所有人物、地点、事件、原著伏笔必须使用提供的阶段 2A ID；不得自造 ID 冒充原著对象。
3. sourceType 只能是 explicit / inferred / generated。explicit 必须同时给出真实 chapterIds/eventIds 和逐字 evidence 摘录；不能把 AI 新增内容写成 explicit。
4. 每个关键事件必须关联阶段 2A 事件 ID，或明确标记为 generated；每集必须写明 sourceReferences 和 adaptationChanges。
5. 不允许为了爽点改变人物性格、行为逻辑或无故新增能力。所有重要改编必须说明原因、对人物/因果/伏笔的影响。
6. 高风险改编必须使用 riskTags 明确标记：protagonist_identity / core_survival / key_relationship / key_event_removal / world_rule / core_foreshadowing / ending / major_motivation。
7. 不允许机械按章节切分；必须从全剧主线、冲突升级、人物选择和伏笔回收出发安排集数。
8. 不允许复制同一段摘要填满集数；每集必须有独立戏剧目标、核心冲突、高潮和由本集因果自然产生的集尾钩子。
9. 相邻集必须保持时间、地点、人物状态、已知信息、事件因果连续；不能让人物提前知道尚未揭示的秘密。
10. 不要生成正式剧本对白、逐镜头分镜、图片或视频；这里只做分集规划。
11. 输出必须紧凑完整：单条说明尽量不超过 40 字，数组只列必要项；不得为了篇幅省略必填字段，也不得写到一半截断。`;

const SOURCE_REFERENCE_SCHEMA = `"sourceReferences":{"chapterIds":["真实章节 ID"],"eventIds":["真实事件 ID"],"sceneIds":[],"foreshadowingIds":[],"evidence":[{"chapterId":"章节 ID","excerpt":"原文逐字摘录","evidenceType":"explicit"}]}`;

export function strategyPrompt(args: { digest: string; settings: StudioAdaptationSettings; reason?: string }) {
    return `${JSON_RULES}

${formatAdaptationSettings(args.settings)}

${args.digest}

【本次任务】生成独立的短剧改编方案，不要直接写分集剧本。
${args.reason ? `用户额外修改方向：${args.reason}` : ""}

输出 JSON：
{
  "strategy": {
    "logline": "一句话故事",
    "positioningSummary": "改编定位总结，必须体现题材/受众/平台/集数/时长/风格/基调/强度/结局倾向",
    "structureStrategy": "全剧结构策略，说明哪些情节提前、哪些压缩、哪些保留",
    "characterStrategy": "人物策略，说明核心人物弧光和关系变化",
    "conflictStrategy": "冲突升级策略",
    "foreshadowingStrategy": "伏笔与悬念策略",
    "endingStrategy": "结局策略",
    "episodeCountPlan": "如何满足目标集数与单集时长",
    "warnings": ["风险提示"]
  },
  "changes": [{
    "adaptationChangeId": "chg-001",
    "operation": "preserve|compress|merge|reorder|remove|add|rewrite",
    "sourceType": "explicit|inferred|generated",
    "sourceReferences": ${SOURCE_REFERENCE_SCHEMA},
    "beforeStructure": "改编前结构",
    "afterStructure": "改编后结构",
    "reason": "为什么这样改",
    "characterImpact": "对人物影响",
    "causalityImpact": "对事件因果影响",
    "foreshadowingImpact": "对伏笔影响",
    "episodeNumbers": [1],
    "riskTags": ["key_event_removal"],
    "reviewStatus": "pending_review"
  }],
  "foreshadowings": [{
    "foreshadowingId": "fore-001",
    "content": "伏笔内容",
    "sourceType": "explicit|inferred|generated",
    "sourceNovelForeshadowingId": "阶段 2A 伏笔 ID，新增时为空",
    "firstPlantedEpisode": 1,
    "advancedEpisodes": [],
    "expectedResolveEpisode": 6,
    "relatedCharacterIds": [],
    "relatedEventIds": [],
    "status": "planned"
  }],
  "checks": [{"level":"error|warning|suggestion","code":"","category":"","message":"","suggestion":"","episodeNumbers":[],"characterIds":[],"eventIds":[]}]
}`;
}

export function blueprintPrompt(args: {
    digest: string;
    settings: StudioAdaptationSettings;
    strategy: string;
    changes: string;
    foreshadowings: string;
    reason?: string;
}) {
    return `${JSON_RULES}

${formatAdaptationSettings(args.settings)}

改编方案：
${args.strategy}

改编差异账本：
${args.changes}

伏笔池初始规划：
${args.foreshadowings}

${args.digest}

【本次任务】生成全剧故事蓝图。蓝图是后续所有分集共享的最高层剧情依据。
${args.reason ? `用户额外修改方向：${args.reason}` : ""}
必须覆盖全剧过程：stages 至少 ${Math.min(3, args.settings.targetEpisodes)} 个，按阶段划分；keyEvents 必须 ${Math.min(4, args.settings.targetEpisodes)} 条，按时间顺序覆盖全部阶段和每个目标集的核心转折，不能把整部剧压成 1 条事件。每个阶段必须写清对应集数范围，每个关键事件必须写清 episodeHint。

输出 JSON（只生成蓝图核心，不写人物表、地点表和时间线；必须极简完整：每个短字段不超过 25 字，长说明不超过 60 字；蓝图关键事件只写 2A ID，不重复摘录原文证据）：
{
  "blueprint": {
    "title": "剧名",
    "theme": "全剧核心主题（≤20字）",
    "logline": "一句话故事（≤50字）",
    "mainline": "故事主线（≤80字）",
    "centralConflict": "主要矛盾（≤40字）",
    "protagonistGoals": ["每人≤20字"],
    "antagonist": {"name":"主要反派","motivation":"≤25字","pressure":"≤25字"},
    "relationshipEvolution": "主要关系演变（≤50字）",
    "stages": [{"id":"stage-1","name":"阶段名","description":"≤30字","fromEpisode":1,"toEpisode":3}],
    "keyEvents": [{"id":"bp-event-1","order":1,"act":"stage-1","title":"关键事件","description":"≤40字","episodeHint":"第1集","sourceType":"explicit|inferred|generated","sourceReferences":{"chapterIds":["真实章节 ID"],"eventIds":["真实事件 ID"]},"adaptationChangeIds":["chg-001"]}],
    "climax": "全剧高潮（≤40字）",
    "ending": "故事结局（≤40字）",
    "foreshadowingPlan": "伏笔及回收安排（≤60字）",
    "characters": [],
    "relationships": [],
    "locations": [],
    "timeline": ""
  },
  "changes": [同改编方案 changes 结构；可补充全剧层级改编，最多 1 条],
  "checks": [同前，最多 1 条]
}

字段必须闭合完整；characters/relationships/locations/timeline 固定输出空值，由下一步单独生成。`;
}

export function blueprintWorldPrompt(args: { blueprint: string }) {
    return `${JSON_RULES}

${args.blueprint}

【本次任务】只补齐全剧蓝图中的人物出场退场安排、主要关系演变、地点使用安排和故事时间线，不重写已有蓝图核心。
输出必须完整闭合、严格压缩：characters 最多 4 人；relationships 最多 4 条；locations 最多 6 个；所有说明字段尽量不超过 30 字；sourceType 只标 explicit / inferred / generated，不重复摘录原文证据。
输出 JSON：
{
  "characters": [{"characterId":"阶段 2A 人物 ID","name":"姓名","role":"角色","goal":"≤25字","arcSummary":"≤40字","entranceEpisode":1,"exitEpisode":null,"fate":"≤20字","sourceType":"explicit|inferred|generated"}],
  "relationships": [{"fromCharacterId":"","toCharacterId":"","fromName":"","toName":"","evolution":"≤30字"}],
  "locations": [{"sceneId":"","name":"","usage":"≤20字","episodeNumbers":[1]}],
  "timeline": "故事时间线（≤100字）"
}`;
}

export function episodeBatchPrompt(args: {
    digest: string;
    settings: StudioAdaptationSettings;
    strategy: string;
    blueprint: string;
    changes: string;
    foreshadowings: string;
    targetNumbers: number[];
    previousSummaries: string;
    totalEpisodes: number;
    reason?: string;
}) {
    return `${JSON_RULES}

${formatAdaptationSettings(args.settings)}
全剧目标集数：${args.totalEpisodes}；本批只生成第 ${args.targetNumbers.join("、")} 集。

全剧蓝图：
${args.blueprint}

改编方案：
${args.strategy}

当前改编差异账本：
${args.changes}

当前伏笔池（所有 ID 必须来自这里；如需新增，在 changes/foreshadowings 中创建并在分集中使用新 ID）：
${args.foreshadowings}

前序集摘要：
${args.previousSummaries || "无（这是第一批）"}

${args.digest}

${args.reason ? `用户额外修改方向：${args.reason}` : ""}

【本次任务】一次性规划本批全部分集。不能只写摘要，必须可交给阶段 3。
输出必须完整闭合、严格压缩：每集只写 1–3 个关键事件；characterAppearances / characterStates 最多 4 人（只写本集真正推动剧情的角色）；knows / unknown 各最多 3 项；每条 sourceReferences.evidence 最多 1 条、摘录不超过 50 字；所有说明字段尽量不超过 50 字。
每集必须包含：
episodeId、episodeNumber、episodeTitle、episodeLogline、episodeSynopsis、dramaticGoal、openingHook、mainConflict、
keyEvents[]、characterAppearances[]、characterStates[]、characterRelationshipChanges[]、locations[]、
emotionalProgression[]、climax、endingHook、foreshadowingIntroduced[]、foreshadowingAdvanced[]、foreshadowingResolved[]、
continuityDependencies[]、estimatedDuration、sourceReferences、adaptationChanges[]。

characterStates 必须覆盖本集每个出场人物，写清：location、knows[]、unknown[]、relationships、physicalState、abilityState、identityState、present、lifeState。
关键事件格式：
{"id":"ep-001-event-1","description":"≤50字","sourceType":"explicit|inferred|generated","sourceReferences":{"chapterIds":[],"eventIds":[],"sceneIds":[],"foreshadowingIds":[],"evidence":[{"chapterId":"","excerpt":"≤50字逐字摘录","evidenceType":"explicit"}]},"adaptationChangeIds":[]}
分集改编格式：
{"adaptationChangeId":"chg-001","operation":"preserve|compress|merge|reorder|remove|add|rewrite","description":"本集如何执行该改编（≤40字）","highRisk":false}
每集 estimatedDuration 必须接近 ${args.settings.targetEpisodeSeconds} 秒。
不要重复输出完整改编方案或整份蓝图；只引用相关 ID 和必要说明。

输出 JSON：
{
  "episodes": [{
    "episodeId":"ep-001",
    "episodeNumber":1,
    "episodeTitle":"",
    "episodeLogline":"",
    "episodeSynopsis":"",
    "dramaticGoal":"",
    "openingHook":"",
    "mainConflict":"",
    "keyEvents":[],
    "characterAppearances":[{"characterId":"","name":"","role":"","summary":""}],
    "characterStates":[{"characterId":"","name":"","location":"","knows":[],"unknown":[],"relationships":"","physicalState":"","abilityState":"","identityState":"","present":true,"lifeState":"alive|dead|missing|transformed|unknown"}],
    "characterRelationshipChanges":[{"fromCharacterId":"","toCharacterId":"","fromName":"","toName":"","change":""}],
    "locations":[{"sceneId":"","name":"","purpose":""}],
    "emotionalProgression":[],
    "climax":"",
    "endingHook":"",
    "foreshadowingIntroduced":[],
    "foreshadowingAdvanced":[],
    "foreshadowingResolved":[],
    "continuityDependencies":[],
    "estimatedDuration":${args.settings.targetEpisodeSeconds},
    "sourceReferences":${SOURCE_REFERENCE_SCHEMA},
    "adaptationChanges":[]
  }],
  "changes": [],
  "foreshadowings": [],
  "checks": []
}`;
}

export function synthesisPrompt(args: {
    digest: string;
    settings: StudioAdaptationSettings;
    strategy: string;
    blueprint: string;
    plansSummary: string;
    currentPool: string;
}) {
    return `${JSON_RULES}

${formatAdaptationSettings(args.settings)}

${args.digest}

改编方案：
${args.strategy}

全剧蓝图：
${args.blueprint}

当前分集规划摘要：
${args.plansSummary}

当前伏笔池：
${args.currentPool}

【本次任务】为全剧建立人物弧光和统一伏笔状态。不要改写分集剧情，不要生成剧本。
- 为主要人物写初始状态、核心目标、内在矛盾、缺陷、转折、关键选择、关系变化、最终状态和逐集状态时间线。
- 输出必须完整闭合、严格压缩：主要人物最多 4 人；每人 milestones 最多 3 条；所有说明字段尽量不超过 30 字；knows / unknown 各最多 3 项；milestones 的 sourceReferences 只写 2A ID，不重复原文摘录。
- 伏笔池必须保留全部阶段 2A 原著伏笔；不能删除重要原著伏笔。未在分集中明确回收的，不能标成 resolved。
- checks 只报告风险，不要自动改写剧情。

输出 JSON：
{
  "characterArcs": [{
    "characterId":"阶段 2A 人物 ID",
    "characterName":"",
    "initialState":"≤30字","coreGoal":"≤30字","innerConflict":"≤30字","flaw":"≤30字",
    "turningPoints":[{"episodeNumber":1,"description":"≤30字"}],
    "keyChoices":[{"episodeNumber":1,"description":"≤30字"}],
    "relationshipChanges":[{"episodeNumber":1,"description":"≤30字"}],
    "finalState":"≤30字",
    "milestones":[{"episodeNumber":1,"type":"first_appearance|exit|death|return|reveal|turning_point|choice","description":"≤30字","sourceType":"explicit|inferred|generated","sourceReferences":{"chapterIds":[],"eventIds":[],"sceneIds":[],"foreshadowingIds":[],"evidence":[]}}],
    "timeline":[{"episodeNumber":1,"location":"≤30字","knows":[],"unknown":[],"relationships":"≤30字","physicalState":"≤20字","abilityState":"≤20字","identityState":"≤20字","present":true,"lifeState":"alive|dead|missing|transformed|unknown"}]
  }],
  "foreshadowings": [同 strategy 伏笔结构，必须包含全部原著伏笔和 AI 新增伏笔；每条说明≤40字],
  "checks": [同前，最多 3 条]
}`;
}

export function regenerationPrompt(args: {
    digest: string;
    settings: StudioAdaptationSettings;
    blueprint: string;
    changes: string;
    currentPool: string;
    targetPlans: string;
    targetNumbers: number[];
    lockedNumbers: number[];
    adjacentSummaries: string;
    totalEpisodes: number;
    reason?: string;
}) {
    return `${JSON_RULES}

${formatAdaptationSettings(args.settings)}

全剧蓝图：
${args.blueprint}

当前改编差异账本：
${args.changes}

当前伏笔池：
${args.currentPool}

当前目标集旧稿：
${args.targetPlans}

相邻集摘要（不得破坏上下游依赖）：
${args.adjacentSummaries}

${args.digest}

【本次任务】只重新生成第 ${args.targetNumbers.join("、")} 集，不重写其他集。锁定的集数：${args.lockedNumbers.join("、") || "无"}。
${args.reason ? `用户修改方向：${args.reason}` : ""}

输出 JSON：
{
  "episodes":[同 episodeBatchPrompt 的分集完整结构],
  "changes":[同前],
  "foreshadowings":[同前，可只输出新增或状态更新],
  "checks":[同前]
}`;
}

const MODULE_OUTPUT_SCHEMA: Record<string, string> = {
    synopsis: `"episodeLogline":"","episodeSynopsis":"","dramaticGoal":""`,
    conflict: `"mainConflict":"","climax":""`,
    characters: `"characterAppearances":[{"characterId":"","name":"","role":"","summary":""}],"characterStates":[{"characterId":"","name":"","location":"","knows":[],"unknown":[],"relationships":"","physicalState":"","abilityState":"","identityState":"","present":true,"lifeState":"alive|dead|missing|transformed|unknown"}],"characterRelationshipChanges":[{"fromCharacterId":"","toCharacterId":"","fromName":"","toName":"","change":""}]`,
    hooks: `"openingHook":"","endingHook":""`,
    foreshadowing: `"foreshadowingIntroduced":[],"foreshadowingAdvanced":[],"foreshadowingResolved":[]`,
};

export function episodeModulePrompt(args: {
    digest: string;
    settings: StudioAdaptationSettings;
    blueprint: string;
    plan: string;
    module: string;
    label: string;
    reason?: string;
}) {
    return `${JSON_RULES}

${formatAdaptationSettings(args.settings)}

全剧蓝图：
${args.blueprint}

当前集完整规划：
${args.plan}

${args.digest}

【本次任务】只重写该集的“${args.label}”模块，其他字段不得变化，也不要重复输出其他字段。
${args.reason ? `用户修改方向：${args.reason}` : ""}

输出 JSON（只输出模块字段，必须完整闭合）：
{"episode":{${MODULE_OUTPUT_SCHEMA[args.module] ?? MODULE_OUTPUT_SCHEMA.synopsis}},"checks":[]}`;
}

export function estimateAdaptationCalls(settings: StudioAdaptationSettings, kind: "full" | "strategy" | "blueprint" | "episodes" | "episode_regenerate", targetCount = 0) {
    if (kind === "strategy") return 1;
    if (kind === "blueprint") return 1;
    if (kind === "episode_regenerate") return 1;
    const batch = settings.targetEpisodes <= ADAPTATION_EPISODE_BATCH ? ADAPTATION_EPISODE_BATCH : ADAPTATION_EPISODE_BATCH_LARGE;
    const batches = Math.ceil(Math.max(1, targetCount || settings.targetEpisodes) / batch);
    return kind === "episodes" ? 1 + batches : 3 + batches;
}

export function adaptationBatchSize(targetEpisodes: number) {
    return targetEpisodes <= ADAPTATION_EPISODE_BATCH ? ADAPTATION_EPISODE_BATCH : ADAPTATION_EPISODE_BATCH_LARGE;
}
