import "./stage2b-local-storage-stub";

import assert from "node:assert/strict";

import type { NovelAnalysis, NovelChapter, NovelEvidence, StudioNovel } from "../src/types/novel";
import type { StudioAdaptationChange, StudioAdaptationProposal, StudioAdaptationStrategy, StudioSeriesBlueprint } from "../src/types/studio-adaptation";
import { makeStudioNovel, simpleHash, splitNovelChapters } from "../src/lib/studio/novel-chapters";
import { createStudioProject } from "../src/lib/studio/factory";
import {
    checkSummary,
    createAdaptationContext,
    includeOriginalForeshadowings,
    normalizeAdaptationChanges,
    normalizeCharacterArcs,
    normalizeEpisodePlans,
    reconcileForeshadowingStatuses,
    syncCharacterArcsFromPlans,
    validateAdaptationPackage,
} from "../src/lib/studio/adaptation-schema";
import {
    AdaptationReviewError,
    adaptationHandoff,
    applyProposalToWorkspace,
    createStudioAdaptationWorkspace,
    diffAgainstCurrent,
    highRiskChangesInProposal,
    normalizeStudioAdaptation,
} from "../src/lib/studio/adaptation-workspace";

const source = [
    "第一章 雾港",
    "林舟提灯走进雾港，码头只剩一盏灯。",
    "沈鸢站在旧钟楼下，她把一枚铜钥匙交给林舟。",
    "",
    "第二章 旧钟楼",
    "林舟与沈鸢在旧钟楼下约定，天亮前找回失踪的船。",
    "钟楼管理人说出旧事：十年前也有一艘船没有回来。",
    "",
    "第三章 长夜",
    "沈鸢在雾里听见钟声，铜钥匙开始发烫。",
].join("\n");

const split = splitNovelChapters(source, "txt");
const novel: StudioNovel = makeStudioNovel({
    fileHash: "stage2b-core",
    format: "txt",
    name: "雾港夜航.txt",
    mimeType: "text/plain",
    bytes: source.length,
    encoding: "utf-8",
    preamble: split.preamble,
    chapters: split.chapters,
    warnings: split.warnings,
});
const [chapter1, chapter2, chapter3] = novel.chapters;

function evidence(chapter: NovelChapter, excerpt: string, type: NovelEvidence["evidenceType"] = "explicit"): NovelEvidence {
    const start = chapter.text.indexOf(excerpt);
    assert.ok(start >= 0, `测试证据必须来自原文：${excerpt}`);
    return {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        excerpt,
        sourceLocation: { charStart: start, charEnd: start + excerpt.length },
        confidence: 0.9,
        evidenceType: type,
    };
}

const linEvidence = evidence(chapter1, "林舟提灯走进雾港");
const shenEvidence = evidence(chapter1, "沈鸢站在旧钟楼下");
const keyEvidence = evidence(chapter1, "她把一枚铜钥匙交给林舟");
const boatEvidence = evidence(chapter2, "天亮前找回失踪的船");

const analysis: NovelAnalysis = {
    id: "analysis-stage2b-core",
    novelId: novel.id,
    novelHash: novel.file.hash,
    version: 1,
    runId: "run-stage2b-core",
    model: { channelId: "builtin-doubao", modelId: "test", label: "确定性测试" },
    modelParams: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "complete",
    profile: {
        title: "雾港夜航",
        author: "佚名",
        genre: "悬疑",
        worldType: "现实",
        era: "近代",
        mainLocations: ["雾港", "旧钟楼"],
        mainline: "寻找失踪的船",
        coreConflict: "旧案与当下",
        totalChapters: 3,
        analyzedChapters: 3,
        completeness: 100,
        evidence: [linEvidence],
    },
    characters: [
        {
            id: `char-${simpleHash("林舟")}`,
            name: "林舟",
            aliases: [],
            identity: "码头少年",
            age: "二十",
            personality: "谨慎",
            appearance: "",
            abilities: "",
            occupation: "船工",
            status: "alive",
            motivation: "找回失踪的船",
            arc: "从回避旧案到主动查案",
            firstChapterId: chapter1.id,
            keyChapterIds: [chapter1.id, chapter2.id],
            fate: "",
            evidence: [linEvidence],
        },
        {
            id: `char-${simpleHash("沈鸢")}`,
            name: "沈鸢",
            aliases: [],
            identity: "钟楼守夜人",
            age: "十九",
            personality: "冷静",
            appearance: "",
            abilities: "",
            occupation: "守夜人",
            status: "alive",
            motivation: "查清铜钥匙的来历",
            arc: "从旁观到共同承担",
            firstChapterId: chapter1.id,
            keyChapterIds: [chapter1.id, chapter3.id],
            fate: "",
            evidence: [shenEvidence],
        },
    ],
    relationships: [
        {
            id: "rel-lin-shen",
            fromCharacterId: `char-${simpleHash("林舟")}`,
            toCharacterId: `char-${simpleHash("沈鸢")}`,
            fromName: "林舟",
            toName: "沈鸢",
            type: "委托关系",
            changes: [{ chapterId: chapter1.id, description: "沈鸢把钥匙交给林舟" }],
            currentStatus: "暂时合作",
            keyChapterIds: [chapter1.id],
            evidence: [keyEvidence],
        },
    ],
    world: {
        summary: "临海雾港，钟声后不能出海",
        rules: ["钟声响起后不能出海"],
        powerSystem: "",
        socialStructure: "船帮控制码头",
        entries: [{ id: "world-rule", category: "rule", name: "钟声禁航", description: "钟声响起后不能出海", evidence: [shenEvidence] }],
        evidence: [shenEvidence],
    },
    scenes: [
        {
            id: "scene-tower",
            name: "旧钟楼",
            type: "钟楼",
            space: "临海石塔",
            region: "雾港",
            organization: "",
            firstChapterId: chapter1.id,
            keyChapterIds: [chapter1.id, chapter2.id],
            plotUses: "交付钥匙与约定寻船",
            stateChanges: [],
            variants: [],
            evidence: [shenEvidence],
        },
    ],
    events: [
        {
            id: "event-key",
            title: "交付铜钥匙",
            content: "沈鸢把铜钥匙交给林舟",
            chapterId: chapter1.id,
            participantIds: [`char-${simpleHash("林舟")}`, `char-${simpleHash("沈鸢")}`],
            participantNames: ["林舟", "沈鸢"],
            locationId: "scene-tower",
            locationName: "旧钟楼",
            preconditions: ["沈鸢持有铜钥匙"],
            results: ["林舟获得钥匙"],
            impacts: [],
            causeEventTitles: [],
            consequenceEventTitles: ["约定寻船"],
            causeEventIds: [],
            consequenceEventIds: [],
            foreshadowingIds: ["fs-key"],
            evidence: [keyEvidence],
        },
        {
            id: "event-boat",
            title: "约定寻船",
            content: "两人约定天亮前找回失踪的船",
            chapterId: chapter2.id,
            participantIds: [`char-${simpleHash("林舟")}`, `char-${simpleHash("沈鸢")}`],
            participantNames: ["林舟", "沈鸢"],
            locationId: "scene-tower",
            locationName: "旧钟楼",
            preconditions: ["拿到铜钥匙"],
            results: ["两人结盟"],
            impacts: [],
            causeEventTitles: ["交付铜钥匙"],
            consequenceEventTitles: [],
            causeEventIds: ["event-key"],
            consequenceEventIds: [],
            foreshadowingIds: [],
            evidence: [boatEvidence],
        },
    ],
    foreshadowings: [
        {
            id: "fs-key",
            content: "铜钥匙为何发烫",
            firstChapterId: chapter1.id,
            relatedCharacterIds: [`char-${simpleHash("林舟")}`, `char-${simpleHash("沈鸢")}`],
            relatedEventIds: ["event-key"],
            expectedPayoffChapterId: chapter3.id,
            expectedPayoffEvidenceType: "inferred",
            actualPayoffChapterId: "",
            status: "open",
            evidence: [keyEvidence],
        },
    ],
    stats: { chapters: 3, chunks: 1, calls: 0, evidenceCount: 4, explicitCount: 4, inferredCount: 0, generatedCount: 0 },
    warnings: [],
};

const project = createStudioProject({ title: "2B 确定性测试", targetSeconds: 60, episodeCount: 0 });
project.novel = novel;
project.novelAnalysis = analysis;
const adaptation = createStudioAdaptationWorkspace(project);
adaptation.settings.targetEpisodes = 3;
adaptation.settings.targetEpisodeSeconds = 60;
adaptation.settings.strength = "balanced";
project.adaptation = adaptation;
assert.equal(project.adaptation.settings.strength, "balanced", "默认改编强度应为平衡改编");

const ctx = createAdaptationContext(project, adaptation.settings);
const episodicChanges = normalizeAdaptationChanges(ctx, [
    {
        adaptationChangeId: "change-remove-1",
        operation: "remove",
        sourceType: "generated",
        reason: "压缩支线",
        beforeStructure: "保留原著钟楼管理人次线",
        afterStructure: "删去管理人次线",
        episodeNumbers: [1, 2, 3],
    },
], 0);
assert.equal(episodicChanges[0].highRisk, true, "删除关键事件必须自动标记高风险");
assert.ok(episodicChanges[0].riskTags.includes("key_event_removal"), "remove 操作必须自动加 key_event_removal");
assert.equal(episodicChanges[0].reviewStatus, "pending_review", "高风险改编不能自动通过");
assert.ok(ctx.checks.some((check) => check.code === "high_risk_adaptation"), "高风险改编必须产生审核提示");

const linCharacterId = `char-${simpleHash("林舟")}`;
const shenCharacterId = `char-${simpleHash("沈鸢")}`;
const rawPlans = {
    episodes: [
        {
            episodeId: "ep-1",
            episodeNumber: 1,
            episodeTitle: "雾里的铜钥匙",
            episodeLogline: "林舟接过钥匙，也接过一桩旧案。",
            episodeSynopsis: "林舟在雾港遇见沈鸢，拿到会发烫的铜钥匙。",
            dramaticGoal: "让林舟接下寻船委托",
            openingHook: "雾里有人跟着提灯的林舟",
            mainConflict: "林舟不愿再碰旧案，但钥匙只认他",
            keyEvents: [
                {
                    id: "ep1-key",
                    description: "沈鸢把铜钥匙交给林舟",
                    sourceType: "explicit",
                    sourceReferences: { chapterIds: [chapter1.id], eventIds: ["event-key", "event-fake"], evidence: [keyEvidence] },
                },
            ],
            characterAppearances: ["林舟", "沈鸢"],
            characterStates: [
                { characterId: linCharacterId, location: "雾港", knows: ["钥匙发烫"], unknown: ["船失踪真相"], relationships: "与沈鸢暂时合作", physicalState: "正常", abilityState: "熟悉码头", identityState: "码头少年", present: true, lifeState: "alive" },
                { characterId: shenCharacterId, location: "旧钟楼", knows: ["钥匙来历"], unknown: ["林舟的旧案"], relationships: "委托林舟", physicalState: "正常", abilityState: "守夜", identityState: "钟楼守夜人", present: true, lifeState: "alive" },
            ],
            locations: ["旧钟楼"],
            emotionalProgression: ["警觉", "迟疑", "接下委托"],
            climax: "钥匙第一次发烫",
            endingHook: "钟声后，码头多了一艘不该出现的船",
            foreshadowingIntroduced: ["fore-original-1"],
            foreshadowingAdvanced: [],
            foreshadowingResolved: [],
            continuityDependencies: [],
            estimatedDuration: 30,
            sourceReferences: { chapterIds: [chapter1.id], eventIds: ["event-key"], evidence: [keyEvidence] },
            adaptationChanges: [],
        },
        {
            episodeId: "ep-2",
            episodeNumber: 2,
            episodeTitle: "旧钟楼下的约定",
            episodeLogline: "两人结盟，旧案却先找上门。",
            episodeSynopsis: "林舟在雾港遇见沈鸢，拿到会发烫的铜钥匙。",
            dramaticGoal: "让两人结盟并发现旧案仍在运行",
            openingHook: "不该出现的船停在雾里",
            mainConflict: "寻船计划与船帮封锁冲突",
            keyEvents: [
                {
                    id: "ep2-key",
                    description: "两人在旧钟楼约定天亮前寻船",
                    sourceType: "explicit",
                    sourceReferences: { chapterIds: [chapter2.id], eventIds: ["event-boat"], evidence: [boatEvidence] },
                },
            ],
            characterAppearances: ["林舟", "沈鸢"],
            characterStates: [
                { characterId: linCharacterId, location: "旧钟楼", knows: ["钥匙发烫", "船失踪"], unknown: ["十年前真相"], relationships: "与沈鸢结盟", physicalState: "受伤", abilityState: "熟悉码头", identityState: "码头少年", present: true, lifeState: "dead" },
                { characterId: shenCharacterId, location: "旧钟楼", knows: ["钥匙来历", "十年前旧事"], unknown: [], relationships: "与林舟结盟", physicalState: "正常", abilityState: "守夜", identityState: "钟楼守夜人", present: true, lifeState: "alive" },
            ],
            locations: ["旧钟楼"],
            emotionalProgression: ["紧张", "结盟", "恐惧"],
            climax: "钟楼管理人说出十年前旧事",
            endingHook: "钥匙指向海面下的一盏灯",
            foreshadowingIntroduced: [],
            foreshadowingAdvanced: ["fore-original-1"],
            foreshadowingResolved: [],
            continuityDependencies: ["承接第 1 集集尾钩子"],
            estimatedDuration: 30,
            sourceReferences: { chapterIds: [chapter2.id], eventIds: ["event-boat"], evidence: [boatEvidence] },
            adaptationChanges: [],
        },
        {
            episodeId: "ep-3",
            episodeNumber: 3,
            episodeTitle: "长夜",
            episodeLogline: "铜钥匙发烫，真相浮出水面。",
            episodeSynopsis: "沈鸢在雾里听见钟声，铜钥匙带两人找到沉船。",
            dramaticGoal: "",
            openingHook: "钟声在雾里响起",
            mainConflict: "船帮阻止两人靠近沉船",
            keyEvents: [
                { id: "ep3-key", description: "铜钥匙指向沉船", sourceType: "explicit", sourceReferences: {} },
            ],
            characterAppearances: ["林舟", "沈鸢"],
            characterStates: [
                { characterId: linCharacterId, location: "旧航道", knows: ["钥匙发烫"], unknown: [], relationships: "与沈鸢结盟", physicalState: "恢复", abilityState: "熟悉码头", identityState: "码头少年", present: true, lifeState: "alive" },
                { characterId: shenCharacterId, location: "旧航道", knows: ["钥匙来历", "十年前旧事"], unknown: [], relationships: "与林舟结盟", physicalState: "正常", abilityState: "守夜", identityState: "钟楼守夜人", present: true, lifeState: "alive" },
            ],
            locations: ["旧钟楼"],
            emotionalProgression: ["恐惧", "决断"],
            climax: "沉船被找到",
            endingHook: "船舱里传来第二把钥匙的响声",
            foreshadowingIntroduced: [],
            foreshadowingAdvanced: [],
            foreshadowingResolved: [],
            continuityDependencies: ["承接第 2 集地点与钥匙状态"],
            estimatedDuration: 30,
            sourceReferences: { chapterIds: [chapter3.id], eventIds: [], evidence: [] },
            adaptationChanges: [],
        },
    ],
};

const plans = normalizeEpisodePlans(ctx, rawPlans, episodicChanges);
assert.equal(plans.length, 3, "必须一次规划全部目标集数");
const firstEvent = plans[0].keyEvents[0];
assert.ok(!firstEvent.sourceReferences.eventIds.includes("event-fake"), "不存在的原著事件 ID 必须被丢弃");
assert.ok(firstEvent.sourceReferences.eventIds.includes("event-key"), "真实原著事件 ID 必须保留");
assert.equal(firstEvent.sourceType, "explicit", "有真实显式证据的事件应保持 explicit");
assert.equal(plans[2].keyEvents[0].sourceType, "inferred", "标记 explicit 但没有证据的 AI 事件必须降级为推断");
assert.ok(ctx.checks.some((check) => check.code === "explicit_without_evidence"), "无证据 explicit 必须产生引用校验提示");
assert.ok(ctx.checks.some((check) => check.code === "episode_without_goal"), "缺戏剧目标必须报 error");

const arcs = syncCharacterArcsFromPlans(ctx, [], plans);
const linArc = arcs.find((arc) => arc.characterId === `char-${simpleHash("林舟")}`);
assert.ok(linArc, "主要人物必须建立全剧弧光");
assert.equal(linArc.timeline.length, 3, "人物时间线必须覆盖每集状态");

const originalPool = includeOriginalForeshadowings(ctx, []);
assert.equal(originalPool.length, 1, "阶段 2A 原著伏笔不能从全剧池中消失");
assert.equal(originalPool[0].foreshadowingId, "fore-original-1");
assert.equal(originalPool[0].isOriginal, true);
const fakeResolvedPool = [{ ...originalPool[0], firstPlantedEpisode: 1, expectedResolveEpisode: 3, actualResolveEpisode: 3, status: "resolved" as const }];
const resolvedCtx = createAdaptationContext(project, adaptation.settings);
const resolvedChecks = validateAdaptationPackage({ ctx: resolvedCtx, strategy: undefined, blueprint: undefined, plans, arcs, foreshadowings: fakeResolvedPool, changes: episodicChanges, scope: "episodes" });
assert.ok(resolvedChecks.some((check) => check.code === "foreshadowing_false_resolved"), "没有实际回收动作的伏笔不能标 resolved");
assert.ok(resolvedChecks.some((check) => check.code === "episode_duration_mismatch"), "单集时长偏离目标必须报出");
const reconciled = reconcileForeshadowingStatuses(fakeResolvedPool, plans);
assert.notEqual(reconciled[0].status, "resolved", "未实际回收的伏笔必须自动退回");
assert.equal(reconciled[0].actualResolveEpisode, undefined, "没有回收动作时不能保留实际回收集");
assert.equal(reconciled[0].firstPlantedEpisode, 1, "埋设集数必须来自分集动作");
assert.equal(reconciled[0].status, "advancing", "有埋设和推进动作的伏笔应进入 advancing");

const fullCtx = createAdaptationContext(project, adaptation.settings);
const fullValidation = validateAdaptationPackage({ ctx: fullCtx, strategy: undefined, blueprint: undefined, plans: plans.map((plan) => plan.episodeNumber === 1 ? { ...plan, episodeTitle: "标题一" } : plan), arcs, foreshadowings: reconciled, changes: episodicChanges, scope: "episodes" });
assert.ok(fullValidation.some((check) => check.code === "character_returns_without_basis"), "人物死亡后无依据回归必须报 error");

const firstOnlyChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans: [plans[0]], arcs, foreshadowings: [], changes: [], scope: "episodes" });
assert.ok(!firstOnlyChecks.some((check) => check.code === "episode_without_continuity"), "第 1 集没有前序集，不应误报连续性缺失");
const plan2WithoutDependencies = { ...plans[1], continuityDependencies: [] };
const missingDependencyChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans: [plans[0], plan2WithoutDependencies], arcs, foreshadowings: [], changes: [], scope: "episodes" });
assert.ok(missingDependencyChecks.some((check) => check.code === "episode_without_continuity" && check.episodeNumbers.includes(2)), "第 2 集没有前序承接说明时仍必须报 warning");

const returnMilestone = {
    episodeNumber: 3,
    type: "return" as const,
    description: "老周在旧航道把落水的林舟救回",
    sourceType: "inferred" as const,
    sourceReferences: { chapterIds: [chapter3.id], eventIds: [], sceneIds: [], foreshadowingIds: [], evidence: [] },
};
const legalReturnArcs = arcs.map((arc) => arc.characterId === linArc.characterId ? { ...arc, milestones: [returnMilestone] } : arc);
const legalReturnChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans, arcs: legalReturnArcs, foreshadowings: reconciled, changes: episodicChanges, scope: "episodes" });
assert.ok(!legalReturnChecks.some((check) => check.code === "character_returns_without_basis"), "死亡后有明确 return 事件、集数与来源依据时不能误报回归无依据");
const earlyReturnArcs = arcs.map((arc) => arc.characterId === linArc.characterId ? { ...arc, milestones: [{ ...returnMilestone, episodeNumber: 1 }] } : arc);
const earlyReturnChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans, arcs: earlyReturnArcs, foreshadowings: reconciled, changes: episodicChanges, scope: "episodes" });
assert.ok(earlyReturnChecks.some((check) => check.code === "character_returns_without_basis"), "复活事件早于死亡集数时仍必须报 error");
const unsourcedReturnArcs = arcs.map((arc) => arc.characterId === linArc.characterId ? { ...arc, milestones: [{ ...returnMilestone, sourceReferences: { chapterIds: [], eventIds: [], sceneIds: [], foreshadowingIds: [], evidence: [] } }] } : arc);
const unsourcedReturnChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans, arcs: unsourcedReturnArcs, foreshadowings: reconciled, changes: episodicChanges, scope: "episodes" });
assert.ok(unsourcedReturnChecks.some((check) => check.code === "character_returns_without_basis"), "return 事件缺少来源依据时仍必须报 error");
const futureReturnArcs = arcs.map((arc) => arc.characterId === linArc.characterId ? { ...arc, milestones: [{ ...returnMilestone, episodeNumber: 4 }] } : arc);
const futureReturnChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans, arcs: futureReturnArcs, foreshadowings: reconciled, changes: episodicChanges, scope: "episodes" });
assert.ok(futureReturnChecks.some((check) => check.code === "character_returns_without_basis"), "复活事件晚于当前出现集时仍必须报 error");
const blankReturnArcs = arcs.map((arc) => arc.characterId === linArc.characterId ? { ...arc, milestones: [{ ...returnMilestone, description: "   " }] } : arc);
const blankReturnChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans, arcs: blankReturnArcs, foreshadowings: reconciled, changes: episodicChanges, scope: "episodes" });
assert.ok(blankReturnChecks.some((check) => check.code === "character_returns_without_basis"), "return 事件没有说明复活原因时仍必须报 error");
const generatedReturnArcs = arcs.map((arc) => arc.characterId === linArc.characterId ? { ...arc, milestones: [{ ...returnMilestone, sourceType: "generated" as const, sourceReferences: { chapterIds: [], eventIds: [], sceneIds: [], foreshadowingIds: [], evidence: [] } }] } : arc);
const generatedReturnChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans, arcs: generatedReturnArcs, foreshadowings: reconciled, changes: episodicChanges, scope: "episodes" });
assert.ok(generatedReturnChecks.some((check) => check.code === "character_returns_without_basis"), "未确认的 generated 复活不能作为回归依据");
const confirmedGeneratedReturnArcs = arcs.map((arc) => arc.characterId === linArc.characterId ? { ...arc, milestones: [{ ...returnMilestone, sourceType: "generated" as const, sourceReferences: { chapterIds: [], eventIds: [], sceneIds: [], foreshadowingIds: [], evidence: [] }, confirmedAt: "2026-11-22T10:00:00.000Z" }] } : arc);
const confirmedGeneratedReturnChecks = validateAdaptationPackage({ ctx: createAdaptationContext(project, adaptation.settings), plans, arcs: confirmedGeneratedReturnArcs, foreshadowings: reconciled, changes: episodicChanges, scope: "episodes" });
assert.ok(!confirmedGeneratedReturnChecks.some((check) => check.code === "character_returns_without_basis"), "用户已确认的 generated 复活可以作为回归依据");
const modelSelfConfirmedArcs = normalizeCharacterArcs(ctx, { characterArcs: [{ characterId: linArc.characterId, milestones: [{ ...returnMilestone, sourceType: "generated", confirmedAt: "2026-11-22T10:00:00.000Z" }] }] }, plans);
assert.equal(modelSelfConfirmedArcs[0]?.milestones[0]?.confirmedAt, undefined, "模型不能自证 generated 复活已获得用户确认");

const fullChecks = checkSummary(fullValidation);
assert.ok(fullChecks.errors >= 2, "剧情自检必须能报出具体逻辑错误，而不只是格式错误");

const lockedPlan = plans[0];
const testBlueprint: StudioSeriesBlueprint = {
    id: "bp-stage2b",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviewStatus: "approved",
    locked: false,
    title: "雾港夜航·全剧蓝图",
    theme: "面对旧案",
    logline: "两个守夜人找回失踪的船",
    mainline: "钥匙—沉船—真相",
    centralConflict: "船帮封锁与真相",
    protagonistGoals: ["找回船"],
    antagonist: { name: "船帮", motivation: "掩盖旧案", pressure: "封锁航道" },
    relationshipEvolution: "从委托到并肩",
    stages: [],
    keyEvents: [],
    climax: "沉船被发现",
    ending: "真相公开",
    foreshadowingPlan: "钥匙发烫指向沉船",
    characters: [],
    relationships: [],
    locations: [],
    timeline: "三夜",
    sourceAnalysisVersion: analysis.version,
    sourceNovelHash: novel.file.hash,
};
const workspace = { ...createStudioAdaptationWorkspace(project), settings: adaptation.settings, blueprint: testBlueprint, versionNumber: 1, episodePlans: [{ ...lockedPlan, locked: true, reviewStatus: "locked" as const, version: 2 }, plans[1], plans[2]], changes: episodicChanges };
const proposal = {
    id: "proposal-stage2b",
    kind: "episode_regenerate" as const,
    title: "第 1 集局部重生成提案",
    reason: "验证锁定保护",
    status: "pending" as const,
    baseVersion: 1,
    targetEpisodeNumbers: [1, 3],
    createdAt: new Date().toISOString(),
    episodePlans: [
        { ...plans[0], episodeTitle: "不应覆盖的标题" },
        { ...plans[2], episodeTitle: "新的第三集标题", version: 1 },
    ],
    changes: episodicChanges,
    checks: [],
    diff: { strategyChanged: false, blueprintChanged: false, episodesAdded: [], episodesRemoved: [], episodesChanged: [], notes: [], items: [] },
};
const acceptedChanges = episodicChanges.map((change) => ({ ...change, reviewStatus: "approved" as const }));
const approvedWorkspace = { ...workspace, changes: acceptedChanges };
const acceptedProposal = { ...proposal, changes: acceptedChanges };
assert.throws(
    () => applyProposalToWorkspace(workspace, proposal, true),
    (error: unknown) => error instanceof AdaptationReviewError && error.changes.length === 1 && error.changes[0].adaptationChangeId === "change-remove-1",
    "核心层必须拦截未审核的高风险改编，不能只依赖 UI",
);
const hiddenHighRisk = { ...proposal, changes: episodicChanges.map((change) => ({ ...change, highRisk: false })) };
const hiddenBlockers = highRiskChangesInProposal(hiddenHighRisk, workspace);
assert.throws(
    () => applyProposalToWorkspace(workspace, hiddenHighRisk, true),
    (error: unknown) => error instanceof AdaptationReviewError && error.changes[0]?.adaptationChangeId === "change-remove-1" && error.changes[0]?.highRisk === true,
    "提案把 highRisk 改成 false 时，核心层必须回到当前工作区的 canonical 高风险标记",
);
const forgedApproval = {
    ...proposal,
    changes: episodicChanges.map((change) => ({ ...change, highRisk: false, riskTags: [], reviewStatus: "approved" as const })),
};
const forgedBlockers = highRiskChangesInProposal(forgedApproval, workspace);
assert.throws(
    () => applyProposalToWorkspace(workspace, forgedApproval, true),
    (error: unknown) => error instanceof AdaptationReviewError && error.changes[0]?.adaptationChangeId === "change-remove-1" && error.changes[0]?.reviewStatus === "pending_review",
    "提案同时伪造 highRisk=false、空 riskTags 和 approved 时，核心层仍必须以当前工作区待审状态拦截",
);
assert.equal(workspace.versionNumber, 1, "接受被拦截时不能提升当前版本号");
assert.equal(workspace.episodePlans.find((plan) => plan.episodeNumber === 3)?.episodeTitle, plans[2].episodeTitle, "接受被拦截时不能改写分集内容");
assert.equal(proposal.status, "pending", "接受被拦截时提案状态必须保持 pending");
assert.equal(proposal.changes?.[0]?.reviewStatus, "pending_review", "接受被拦截时高风险审核状态不能被暗中改写");
const lockedChanges = episodicChanges.map((change) => ({ ...change, reviewStatus: "locked" as const }));
const lockedWorkspace = { ...workspace, changes: lockedChanges };
assert.doesNotThrow(() => applyProposalToWorkspace(lockedWorkspace, { ...proposal, changes: lockedChanges }, true), "已锁定的高风险改编必须允许接受提案");
const strategy: StudioAdaptationStrategy = {
    id: "strategy-stage2b",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviewStatus: "draft",
    locked: false,
    logline: "两个守夜人找回失踪的船",
    positioningSummary: "悬疑短剧",
    structureStrategy: "三集闭环",
    characterStrategy: "双主角",
    conflictStrategy: "船帮封锁",
    foreshadowingStrategy: "钥匙与钟声",
    endingStrategy: "真相公开",
    episodeCountPlan: "3 集",
    warnings: [],
    changes: episodicChanges,
    sourceAnalysisVersion: analysis.version,
    sourceNovelHash: novel.file.hash,
};
const strategyOnlyProposal: StudioAdaptationProposal = { ...proposal, changes: [], strategy };
assert.throws(
    () => applyProposalToWorkspace(workspace, strategyOnlyProposal, true),
    (error: unknown) => error instanceof AdaptationReviewError && error.changes[0]?.adaptationChangeId === "change-remove-1",
    "高风险改编只出现在 strategy.changes 时，核心层也必须拦截",
);
assert.doesNotThrow(() => applyProposalToWorkspace(workspace, proposal, false), "拒绝提案不能被高风险审核门禁阻止");
const forgedStrategy = { ...strategy, changes: episodicChanges.map((change) => ({ ...change, highRisk: false, riskTags: [], reviewStatus: "approved" as const })) };
const forgedStrategyBlockers = highRiskChangesInProposal({ ...proposal, changes: [], strategy: forgedStrategy }, workspace);
assert.throws(
    () => applyProposalToWorkspace(workspace, { ...proposal, changes: [], strategy: forgedStrategy }, true),
    (error: unknown) => error instanceof AdaptationReviewError && error.changes[0]?.adaptationChangeId === "change-remove-1",
    "高风险改编只出现在被篡改的 strategy.changes 时，核心层仍必须拦截",
);
const accepted = applyProposalToWorkspace(approvedWorkspace, acceptedProposal, true);
const proposalDiff = diffAgainstCurrent(workspace, proposal);
assert.deepEqual(proposalDiff.episodesRemoved, [], "只改目标集时，不能把未提交的相邻集误报为移除");
assert.ok(proposalDiff.episodesChanged.includes(3), "差异必须识别第 3 集内容变化");
assert.ok(proposalDiff.items.some((item) => item.label === "第 3 集 · 标题" && item.before !== item.after), "差异必须给出具体变化字段的前后值");
assert.equal(accepted.episodePlans.find((plan) => plan.episodeNumber === 1)?.episodeTitle, lockedPlan.episodeTitle, "锁定的第 1 集不能被提案覆盖");
assert.equal(accepted.episodePlans.find((plan) => plan.episodeNumber === 1)?.locked, true, "锁定状态必须保留");
assert.equal(accepted.episodePlans.find((plan) => plan.episodeNumber === 3)?.episodeTitle, "新的第三集标题", "未锁定集应接受新版本");
const thirdEpisodeVersions = accepted.episodePlans.find((plan) => plan.episodeNumber === 3)?.versions ?? [];
assert.equal(thirdEpisodeVersions.length, 1, "局部修改必须保留旧版本快照");
assert.equal(thirdEpisodeVersions[0].reason, "验证锁定保护", "旧版本必须记录本次修改原因");
assert.equal(accepted.versionNumber, 2, "接受提案必须提升当前版本号");
assert.equal(accepted.history.length, 1, "接受提案前必须保存旧版本快照");
assert.equal(accepted.proposals.find((item) => item.id === proposal.id)?.status, "accepted", "提案状态必须记录为 accepted");

const handoff = adaptationHandoff(accepted, project.id, analysis.version);
assert.ok(handoff, "有蓝图与分集时可形成阶段 3 交接数据");
assert.deepEqual(handoff.lockedEpisodeNumbers, [1], "交接数据必须带锁定集");
assert.equal(handoff.episodePlans.length, 3);
assert.equal(handoff.packageVersion, 2);

const runningGeneration = {
    id: "gen-running",
    kind: "episodes" as const,
    stage: "episodes" as const,
    status: "running" as const,
    progress: 52,
    currentLabel: "规划第 1-3 集…",
    model: { channelId: "builtin-doubao", modelId: "test", label: "测试模型" },
    modelParams: {},
    inputVersion: 1,
    sourceAnalysisVersion: 1,
    settingsSnapshot: adaptation.settings,
    targetEpisodeNumbers: [1, 2, 3],
    lockedEpisodeNumbers: [1],
    calls: 2,
    inputChars: 2200,
    promptHash: "abc",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};
const restored = normalizeStudioAdaptation(project, { ...workspace, generations: [runningGeneration], activeGenerationId: "gen-running" });
assert.equal(restored.generations[0].status, "interrupted", "刷新恢复时运行中任务必须标记 interrupted，不能自动重发");
assert.equal(restored.activeGenerationId, undefined, "恢复后不能保留活动生成锁");
assert.equal(restored.generations[0].calls, 2, "已发生的调用数必须保留");

console.log(JSON.stringify({
    plans: plans.length,
    targetEpisodes: adaptation.settings.targetEpisodes,
    characterArcTimeline: linArc.timeline.length,
    originalForeshadowings: originalPool.length,
    reconciledForeshadowingStatus: reconciled[0].status,
    errors: fullChecks.errors,
    warnings: fullChecks.warnings,
    suggestions: fullChecks.suggestions,
    firstEpisodeContinuityWarning: firstOnlyChecks.some((check) => check.code === "episode_without_continuity"),
    missingEpisodeContinuityWarning: missingDependencyChecks.some((check) => check.code === "episode_without_continuity" && check.episodeNumbers.includes(2)),
    legalReturnBlocked: legalReturnChecks.some((check) => check.code === "character_returns_without_basis"),
    unsourcedReturnBlocked: unsourcedReturnChecks.some((check) => check.code === "character_returns_without_basis"),
    unconfirmedGeneratedReturnBlocked: generatedReturnChecks.some((check) => check.code === "character_returns_without_basis"),
    confirmedGeneratedReturnBlocked: confirmedGeneratedReturnChecks.some((check) => check.code === "character_returns_without_basis"),
    modelSelfConfirmedReturnAccepted: modelSelfConfirmedArcs[0]?.milestones[0]?.confirmedAt !== undefined,
    tamperedHighRiskBlocked: hiddenBlockers.length === 1 && hiddenBlockers[0]?.highRisk === true,
    forgedApprovalBlocked: forgedBlockers.length === 1 && forgedBlockers[0]?.reviewStatus === "pending_review",
    tamperedStrategyBlocked: forgedStrategyBlockers.length === 1 && forgedStrategyBlockers[0]?.reviewStatus === "pending_review",
    lockedEpisodePreserved: accepted.episodePlans.find((plan) => plan.episodeNumber === 1)?.locked === true,
    proposalDiffRemoved: proposalDiff.episodesRemoved.length,
    proposalDiffChanged: proposalDiff.episodesChanged,
    savedVersionReason: thirdEpisodeVersions[0]?.reason ?? "",
    handoffEpisodes: handoff.episodePlans.length,
    handoffLocked: handoff.lockedEpisodeNumbers,
    restoredStatus: restored.generations[0].status,
}, null, 2));
