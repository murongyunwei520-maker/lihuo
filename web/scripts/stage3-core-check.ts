// 阶段 3 核心确定性测试：使用项目 A 的真实 2B 快照，不调用模型、不读写浏览器存储。
// 只验证 handoff、稳定 ID、剧本/分镜结构、连续性与版本保护这些纯函数边界。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { StudioAdaptationHandoff, StudioAdaptationWorkspace, StudioCharacterArc } from "../src/types/studio-adaptation";
import type { StudioProject } from "../src/types/studio";
import type {
    StudioProductionAssetIndex,
    StudioProductionJob,
    StudioProductionRawScript,
    StudioProductionRawStoryboard,
} from "../src/types/studio-production";
import { adaptationHandoff } from "../src/lib/studio/adaptation-workspace";
import { createProductionJob, emptyCounts, estimateSceneDuration, handoffIssuesForEpisode, handoffIssuesForProject, productionAdmission, productionHandoffSnapshot, scriptToPlainText, shotGroupsForScene, shotsForGroup, canReplaceSceneStoryboard, canReplaceShot, validateScriptDocument, validateStoryboardDocument } from "../src/lib/studio/production-engine";
import { normalizeProductionForHydration } from "../src/lib/studio/production-workspace";
import { mergeSceneIntoScript, normalizeScriptDocument, normalizeStoryboardScene, parseProductionJson, replaceSceneInStoryboard, replaceShotInStoryboard } from "../src/lib/studio/production-schema";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/stage3-project-a-2b.json", import.meta.url), "utf8")) as {
    projectId: string;
    analysisVersion: number;
    adaptation: StudioAdaptationWorkspace;
};
const handoff = adaptationHandoff(fixture.adaptation, fixture.projectId, fixture.analysisVersion);
assert.ok(handoff, "项目 A 的真实 2B 数据必须能生成 handoff");
const stage3Handoff: StudioAdaptationHandoff = handoff;

// ---- 3.1 handoff 消费：真实项目 A 的版本、锁定集、7 warning + 1 suggestion ----
assert.equal(stage3Handoff.snapshotId, "handoff-14rfeou", "项目 A 快照标识必须稳定");
assert.equal(stage3Handoff.blueprintVersion, 1);
assert.equal(stage3Handoff.packageVersion, 4, "分集包版本必须来自 2B");
assert.equal(stage3Handoff.analysisVersion, 3);
assert.equal(stage3Handoff.episodePlans.length, 3, "必须读取三集分集规划");
assert.deepEqual(stage3Handoff.lockedEpisodeNumbers, [3], "锁定集必须随 handoff 带入");
assert.deepEqual(stage3Handoff.episodePlans.map((plan) => plan.episodeId), ["ep-001", "ep-002", "ep-003"]);
assert.equal(stage3Handoff.checks.filter((check) => check.status === "open" && check.level === "warning").length, 7);
assert.equal(stage3Handoff.checks.filter((check) => check.status === "open" && check.level === "suggestion").length, 1);
const snapshot = productionHandoffSnapshot(stage3Handoff);
assert.deepEqual(
    { error: snapshot.errorCount, warning: snapshot.warningCount, suggestion: snapshot.suggestionCount, count: snapshot.checkCount },
    { error: 0, warning: 7, suggestion: 1, count: 8 },
    "交接快照必须原样记录 8 条待处理",
);

const openBefore = JSON.stringify(stage3Handoff.checks);
assert.equal(handoffIssuesForProject(stage3Handoff).length, 8);
assert.equal(handoffIssuesForEpisode(stage3Handoff, 1).length, 4, "第 1 集：3 条本集 warning + 1 条全剧 suggestion");
assert.equal(handoffIssuesForEpisode(stage3Handoff, 2).length, 8, "第 2 集：7 条 warning 全部相关 + suggestion");
assert.equal(handoffIssuesForEpisode(stage3Handoff, 2).filter((issue) => issue.level === "warning").length, 7);
assert.ok(handoffIssuesForEpisode(stage3Handoff, 2).every((issue) => issue.status === "open"), "2B 问题不得在投影时变为已解决");
assert.equal(handoffIssuesForEpisode(stage3Handoff, 1).find((issue) => issue.level === "suggestion")?.code, "change_not_in_episode");
assert.equal(adaptationHandoff(fixture.adaptation, fixture.projectId, fixture.analysisVersion)?.checks.length, 8);
assert.equal(JSON.stringify(stage3Handoff.checks), openBefore, "读取 handoff 不得改动 2B 账本");

// 按集准入：第 1 集正式放行不受其他集 pending review 影响；第 2 集只可生成草稿。
const admission1 = productionAdmission(stage3Handoff, 1);
const admission2 = productionAdmission(stage3Handoff, 2);
assert.equal(admission1.sourcePlanId, "ep-001");
assert.equal(admission1.draftAllowed, true);
assert.equal(admission1.formalAllowed, true, "第 1 集规划/蓝图/策略已审核，warning 不阻塞正式生产");
assert.equal(admission2.draftAllowed, true);
assert.equal(admission2.formalAllowed, false, "第 2 集规划仍待审核，只能先出草稿");
assert.ok(admission2.review.some((item) => item.includes("分集规划")), "必须按集显示待审核原因");
assert.equal(admission2.blocking.length, 0, "待审核不是 error，不能写成阻断");
assert.equal(admission1.handoffWarnings.length, 3);
assert.equal(admission1.handoffSuggestions.length, 1);

// 未确认高风险与 AI 新增复活：只允许草稿，不允许正式放行。
const pendingRisk = { ...stage3Handoff.changes[1]!, highRisk: true, reviewStatus: "pending_review" as const, episodeNumbers: [1] };
const highRiskHandoff = { ...stage3Handoff, changes: [...stage3Handoff.changes, pendingRisk] };
const highRiskAdmission = productionAdmission(highRiskHandoff, 1);
assert.equal(highRiskAdmission.draftAllowed, true);
assert.equal(highRiskAdmission.formalAllowed, false);
assert.equal(highRiskAdmission.pendingHighRiskChanges.length, 1);
const generatedArc: StudioCharacterArc = {
    ...stage3Handoff.characterArcs[0]!,
    milestones: [
        ...stage3Handoff.characterArcs[0]!.milestones,
        { episodeNumber: 1, type: "return", description: "模型新增的复活", sourceType: "generated", sourceReferences: { chapterIds: [], eventIds: [], sceneIds: [], foreshadowingIds: [], evidence: [] } },
    ],
};
const generatedHandoff = { ...stage3Handoff, characterArcs: [generatedArc] };
const generatedAdmission = productionAdmission(generatedHandoff, 1);
assert.equal(generatedAdmission.draftAllowed, true);
assert.equal(generatedAdmission.formalAllowed, false);
assert.ok(generatedAdmission.blocking.some((item) => item.includes("AI 复活")), "未确认复活必须阻断正式准入");

const plan1 = stage3Handoff.episodePlans[0]!;
const assetIndex: StudioProductionAssetIndex = {
    characters: plan1.characterAppearances.map((item) => ({ characterId: item.characterId, name: item.name, role: item.role, look: item.summary, costume: "" })),
    locations: plan1.locations.map((item) => ({ locationId: item.sceneId, name: item.name, description: item.purpose, variantIds: [] })),
    props: [
        { propId: "prop-key", name: "铜钥匙", state: "在林舟手中", important: true },
        { propId: "prop-log", name: "航海日志", state: "老周保管", important: true },
    ],
};

const rawScript: StudioProductionRawScript = {
    title: "雾钟授钥",
    logline: "失忆林舟在雾港接过铜钥匙，在旧钟楼得知夜航旧事。",
    synopsis: "沈鸢交付铜钥匙，林舟随她登楼；老周说出十年前夜航失踪，顾北闯入抢夺。",
    scenes: [
        {
            sceneTitle: "雾港码头交钥",
            locationName: "雾港码头",
            locationVariant: "晨雾",
            timeOfDay: "清晨",
            environment: "浓雾压着码头，缆绳敲打木桩，远处钟声只响到第六下。",
            charactersPresent: ["林舟", "沈鸢"],
            props: ["铜钥匙"],
            scenePurpose: "让林舟拿到钥匙，并埋下失忆与夜航的联系。",
            conflict: "林舟不信任沈鸢，沈鸢又必须把钥匙交给他。",
            action: "沈鸢从袖口取出铜钥匙，林舟迟疑着伸手，指尖碰到钥匙时微微一缩；雾里传来船板摩擦声，两人同时回头。",
            dialogueBlocks: [
                { speaker: "沈鸢", text: "你终于来了。这枚钥匙，本来就该在你手里。", delivery: "压低声音", emotion: "克制", subtext: "她知道更多，却不敢一次说完。", linkedAction: "把钥匙递到林舟掌心", timing: "4s" },
                { speaker: "林舟", text: "我不记得这枚钥匙，也不记得你。", delivery: "沙哑", emotion: "警惕", subtext: "他害怕钥匙会揭开自己不愿面对的东西。", linkedAction: "后退半步，仍没有松手", timing: "4s" },
            ],
            transitionIn: "雾中钟声渐弱，码头灯影摇晃。",
            transitionOut: "沈鸢转身向旧钟楼走去，林舟握紧钥匙跟上。",
            continuityNotes: "铜钥匙从沈鸢手中转到林舟手中，后续镜头必须保持这一持有人。",
        },
        {
            sceneTitle: "旧钟楼夜话",
            locationName: "旧钟楼",
            locationVariant: "夜雨",
            timeOfDay: "夜",
            environment: "雨水沿钟楼木梯往下淌，铜钟表面泛着冷光，窗外海雾翻涌。",
            charactersPresent: ["林舟", "沈鸢", "老周"],
            props: ["铜钥匙", "航海日志"],
            scenePurpose: "揭示夜航失踪旧事，并让顾北的威胁进入画面。",
            conflict: "老周要守住旧事，顾北要抢走证据。",
            action: "老周把航海日志按在桌上，林舟伸手去翻；楼梯上突然传来急促脚步，顾北推门而入，沈鸢挡在桌前。",
            dialogueBlocks: [
                { speaker: "老周", text: "十年前的夜航没有沉，它是被第七声钟留在了旧航道。", delivery: "缓慢", emotion: "沉重", linkedAction: "翻开航海日志最后一页", timing: "5s" },
                { speaker: "顾北", text: "旧事就该留在雾里。把钥匙和日志交出来。", delivery: "冷硬", emotion: "威胁", linkedAction: "伸手扣住桌沿", timing: "4s" },
            ],
            transitionIn: "钟楼门被风吹开，雨声灌入。",
            transitionOut: "顾北的人影压近，画面切向被雨水打湿的钟绳。",
            continuityNotes: "顾北从门外进入，必须保留门轴方向与人物初始站位，不能瞬移。",
        },
    ],
};

const scriptContext = {
    projectId: fixture.projectId,
    episodeId: "ep-GHduqaBp",
    episodeNumber: 1,
    targetSeconds: 60,
    plan: plan1,
    blueprintVersion: stage3Handoff.blueprintVersion,
    handoffSnapshotId: stage3Handoff.snapshotId,
    assetIndex,
    changes: stage3Handoff.changes,
};
const script = normalizeScriptDocument(rawScript, scriptContext);
const scriptAgain = normalizeScriptDocument(rawScript, scriptContext);
assert.equal(script.scriptVersion, 1);
assert.equal(script.sourceEpisodePlanId, "ep-001");
assert.equal(script.sourceBlueprintVersion, 1);
assert.equal(script.sourceHandoffId, "handoff-14rfeou");
assert.equal(script.durationTarget, 60);
assert.equal(script.scenes.length, 2);
assert.equal(script.characterBindings.length, 3);
assert.equal(script.locationBindings.length, 2);
assert.equal(script.propBindings.length, 2);
assert.equal(script.scenes[0]!.locationId, "scene-lpdm4f", "地点必须映射 2B 稳定 sceneId");
assert.equal(script.scenes[1]!.locationId, "scene-uefl2d");
assert.ok(script.characterBindings.every((item) => item.characterId.startsWith("char-")), "人物 ID 必须稳定");
assert.ok(script.scenes.every((scene) => scene.dialogueBlocks.every((line) => line.characterId.startsWith("char-"))), "对白必须绑定 characterId");
assert.equal(script.scenes[1]!.dialogueBlocks[1]!.characterId, plan1.characterAppearances.find((item) => item.name === "顾北")!.characterId);
assert.equal(script.scenes[0]!.props[0], "prop-key");
assert.equal(script.scenes[0]!.dialogueBlocks[0]!.sourceReference, undefined);
assert.equal(scriptAgain.scenes[0]!.sceneId, script.scenes[0]!.sceneId, "同一集同一场稳定 sceneId");
assert.equal(scriptAgain.scenes[0]!.dialogueBlocks[0]!.characterId, script.scenes[0]!.dialogueBlocks[0]!.characterId);
assert.equal(scriptAgain.scenes[0]!.props[0], script.scenes[0]!.props[0]);
assert.ok(script.durationEstimate.totalSeconds > 0);
assert.ok(Math.abs(script.durationEstimate.totalSeconds - script.durationEstimate.dialogueSeconds - script.durationEstimate.actionSeconds - script.durationEstimate.transitionSeconds - script.durationEstimate.pauseSeconds - script.durationEstimate.environmentSeconds) < 0.2);
assert.ok(scriptToPlainText(script).includes("【沈鸢】"));

// 同地点昼夜变化：locationId 不变，variantId 必须变化。
const variantScript = normalizeScriptDocument(
    { ...rawScript, scenes: [{ ...rawScript.scenes[1]!, timeOfDay: "日", locationVariant: "白日" }, { ...rawScript.scenes[1]!, timeOfDay: "夜", locationVariant: "夜雨" }] },
    scriptContext,
);
assert.equal(variantScript.locationBindings.length, 2, "同一地点的昼夜是两个变体，但不是两个地点");
assert.ok(variantScript.locationBindings.every((binding) => binding.locationId === "scene-uefl2d"));
assert.notEqual(variantScript.scenes[0]!.locationVariantId, variantScript.scenes[1]!.locationVariantId);
assert.equal(variantScript.scenes[0]!.locationId, variantScript.scenes[1]!.locationId, "昼夜不是两个地点");

// 剧本层校验：正常结构无 error；缺失地点、说话人不在场、时长偏差可定位。
const goodScriptChecks = validateScriptDocument(script, { targetSeconds: 60, assetIndex });
assert.equal(emptyCounts(goodScriptChecks).error, 0, "正常剧本不应有结构 error");
const brokenScript = { ...script, durationTarget: 1, scenes: [{ ...script.scenes[0]!, locationId: "", charactersPresent: [] }, ...script.scenes.slice(1)] };
const brokenChecks = validateScriptDocument(brokenScript, { targetSeconds: 1, assetIndex });
assert.ok(brokenChecks.some((check) => check.code === "script_scene_without_location" && check.sceneId === brokenScript.scenes[0]!.sceneId));
assert.ok(brokenChecks.some((check) => check.code === "script_dialogue_speaker_not_present"));
assert.ok(brokenChecks.some((check) => check.code === "script_duration_out_of_range"));
assert.ok(brokenChecks.every((check) => check.source === "deterministic"), "确定性校验不能冒充模型判断");

// ---- 3.2 分镜：按场景生成、稳定 shotId、人物/道具/对白绑定 ----
const rawStoryboardForScene = (sceneIndex: number): StudioProductionRawStoryboard => ({
    groups: [
        {
            groupNumber: 1,
            sharedLayout: sceneIndex === 0 ? "码头木栈道沿画面纵深延伸，沈鸢在左，林舟在右，货箱在后景。" : "钟楼内桌案居中，老周在左，林舟在右，门在画面后方。",
            characterStartPositions: script.scenes[sceneIndex]!.charactersPresent.map((characterId) => {
                const name = script.characterBindings.find((item) => item.characterId === characterId)?.name ?? characterId;
                return { name, position: `${name}位于画左`, orientation: "面向对方", eyeline: "看向对方眼睛" };
            }),
            cameraAxis: "轴线沿桌案横向，林舟在右、沈鸢在左，所有镜头保持右向左的视线方向。",
            propStates: sceneIndex === 0 ? "铜钥匙在林舟掌心" : "航海日志在桌面，铜钥匙仍在林舟手中",
            timeOfDay: script.scenes[sceneIndex]!.timeOfDay,
            lighting: "冷色侧光，雨雾反光",
            weather: "雾",
            continuityRules: ["不越轴", "人物站位不交换"],
            shots: [
                {
                    duration: 6,
                    shotSize: "远景",
                    cameraPosition: "平视",
                    cameraAngle: "平视",
                    lens: "35mm",
                    cameraMovement: "固定",
                    composition: "对称构图",
                    foreground: "湿木栏",
                    midground: "两名人物",
                    background: "雾港",
                    characterBlocking: "沈鸢在左，林舟在右，相距两步。",
                    eyeline: "林舟看向沈鸢手中的钥匙。",
                    action: "沈鸢递出钥匙。",
                    facialExpression: "眼睑微垂，嘴唇紧抿。",
                    emotion: "克制",
                    dialogue: [],
                    voiceOver: "",
                    soundEffects: "缆绳敲击声",
                    backgroundMusic: "低频钟声",
                    lighting: "晨雾冷光",
                    environment: "码头",
                    continuityRules: ["保持左右站位"],
                    imagePrompt: "雾港码头，晨雾，沈鸢在左递出铜钥匙，林舟在右迟疑伸手，电影感，16:9",
                    videoPrompt: "固定远景，缓慢微推，保持人物左右站位与钥匙位置。",
                },
                {
                    duration: 5,
                    shotSize: "近景",
                    cameraPosition: "过肩",
                    cameraAngle: "平视",
                    lens: "50mm",
                    cameraMovement: "推进",
                    composition: "过肩三分",
                    foreground: "林舟肩线",
                    midground: "沈鸢手部",
                    background: "雾中灯影",
                    characterBlocking: "林舟在右肩前景，沈鸢在左中景，手伸向画面右。",
                    eyeline: "沈鸢看向林舟眼睛，林舟视线落在钥匙。",
                    action: "钥匙即将落入林舟掌心。",
                    facialExpression: "沈鸢眉间收紧，林舟下颌绷紧。",
                    emotion: "紧张",
                    dialogue: [{ speaker: "沈鸢", text: "你终于来了。这枚钥匙，本来就该在你手里。", delivery: "压低声音", emotion: "克制" }],
                    voiceOver: "",
                    soundEffects: "钥匙轻响",
                    backgroundMusic: "无",
                    lighting: "侧逆光",
                    environment: "码头",
                    continuityRules: ["延续上一镜左右站位", "钥匙从沈鸢手移向林舟手"],
                    imagePrompt: "过肩近景，沈鸢把铜钥匙递给林舟，雾港晨雾，16:9",
                    videoPrompt: "过肩缓慢推进，跟随钥匙移动，不越轴。",
                },
            ],
        },
    ],
});
const storyboard1 = normalizeStoryboardScene(rawStoryboardForScene(0), {
    projectId: fixture.projectId,
    episodeId: "ep-GHduqaBp",
    episodeNumber: 1,
    script,
    scene: script.scenes[0]!,
    assetIndex,
    plan: plan1,
    changes: stage3Handoff.changes,
});
const storyboard2 = normalizeStoryboardScene(rawStoryboardForScene(1), {
    projectId: fixture.projectId,
    episodeId: "ep-GHduqaBp",
    episodeNumber: 1,
    script,
    scene: script.scenes[1]!,
    assetIndex,
    plan: plan1,
    changes: stage3Handoff.changes,
    groupNumberBase: 1,
});
const storyboardAgain = normalizeStoryboardScene(rawStoryboardForScene(0), {
    projectId: fixture.projectId,
    episodeId: "ep-GHduqaBp",
    episodeNumber: 1,
    script,
    scene: script.scenes[0]!,
    assetIndex,
    plan: plan1,
    changes: stage3Handoff.changes,
});
assert.equal(storyboard1.groups.length, 1);
assert.equal(storyboard1.shots.length, 2);
assert.equal(storyboard1.groups[0]!.cameraAxis.length > 0, true);
assert.equal(storyboard1.groups[0]!.characterStartPositions.length, 2);
assert.equal(storyboardAgain.groups[0]!.shotGroupId, storyboard1.groups[0]!.shotGroupId);
assert.deepEqual(storyboardAgain.shots.map((shot) => shot.shotId), storyboard1.shots.map((shot) => shot.shotId), "重复生成同一场景必须得到稳定 shotId");
assert.ok(storyboard1.shots.every((shot) => shot.shotId.startsWith("shot-") && shot.sceneId === script.scenes[0]!.sceneId));
assert.ok(storyboard1.shots.every((shot) => shot.sourceScriptSceneId === script.scenes[0]!.sceneId));
assert.equal(storyboard1.shots[1]!.dialogue[0]!.characterId, script.scenes[0]!.charactersPresent[1]);
assert.equal(storyboard1.shots[0]!.propBindings[0]!.propId, "prop-key");
assert.equal(storyboard1.shots[0]!.imagePrompt.length > 0, true);
assert.equal(storyboard1.shots[0]!.videoPrompt.length > 0, true);
const sceneBudget = estimateSceneDuration(script.scenes[0]!);
const calibratedTotal = Math.round(storyboard1.shots.reduce((sum, shot) => sum + shot.duration, 0) * 10) / 10;
assert.ok(Math.abs(calibratedTotal - sceneBudget) <= 0.6, "镜头时长必须校准到本场预算，且不删镜头");
const scopedRaw = rawStoryboardForScene(0);
scopedRaw.groups[0]!.shots[0] = { ...scopedRaw.groups[0]!.shots[0]!, charactersPresent: ["林舟"], props: [] };
const scopedStoryboard = normalizeStoryboardScene(scopedRaw, {
    projectId: fixture.projectId,
    episodeId: "ep-GHduqaBp",
    episodeNumber: 1,
    script,
    scene: script.scenes[0]!,
    assetIndex,
    plan: plan1,
    changes: stage3Handoff.changes,
});
assert.equal(scopedStoryboard.shots[0]!.characterBindings.length, 1, "单镜只绑定实际入镜人物");
assert.equal(scopedStoryboard.shots[0]!.characterBindings[0]!.name, "林舟");
assert.equal(scopedStoryboard.shots[0]!.propBindings.length, 0, "单镜不绑定未入镜道具");

const goodStoryboard = {
    id: "storyboard-ep-GHduqaBp",
    episodeId: "ep-GHduqaBp",
    episodeNumber: 1,
    sourceScriptId: script.id,
    sourceScriptVersion: script.scriptVersion,
    sourceEpisodePlanId: script.sourceEpisodePlanId,
    sourceBlueprintVersion: script.sourceBlueprintVersion,
    sourceHandoffId: script.sourceHandoffId,
    storyboardVersion: 1,
    status: "draft" as const,
    groups: [...storyboard1.groups, ...storyboard2.groups],
    shots: [...storyboard1.shots, ...storyboard2.shots],
    checks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};
const goodStoryboardChecks = validateStoryboardDocument(goodStoryboard, script);
assert.equal(emptyCounts(goodStoryboardChecks).error, 0, "正常分镜不应有结构 error");
const longStoryboard = { ...goodStoryboard, shots: goodStoryboard.shots.map((shot) => ({ ...shot, duration: shot.duration * 20 })) };
assert.ok(validateStoryboardDocument(longStoryboard, script).some((check) => check.code === "storyboard_duration_out_of_range"), "明显超时必须在分镜检查中暴露");
const brokenAxis = { ...goodStoryboard, groups: [{ ...goodStoryboard.groups[0]!, cameraAxis: "" }] };
assert.ok(validateStoryboardDocument(brokenAxis, script).some((check) => check.code === "group_without_axis"));
const brokenShot = { ...goodStoryboard, shots: [{ ...goodStoryboard.shots[0]!, dialogue: [{ characterId: "", speaker: "未知", text: "谁", delivery: "", emotion: "" }] }, ...goodStoryboard.shots.slice(1)] };
assert.ok(validateStoryboardDocument(brokenShot, script).some((check) => check.code === "shot_dialogue_without_character"));
const unknownScene = { ...goodStoryboard, shots: [{ ...goodStoryboard.shots[0]!, sceneId: "scene-does-not-exist" }] };
assert.ok(validateStoryboardDocument(unknownScene, script).some((check) => check.code === "shot_unknown_scene"));

// 锁定保护与版本：锁定镜头/锁定场景不能被静默替换；替换其他场景要保留锁定镜头。
const lockedShot = { ...goodStoryboard.shots[1]!, locked: true };
const lockedStoryboard = { ...goodStoryboard, shots: [goodStoryboard.shots[0]!, lockedShot] };
assert.equal(canReplaceShot(lockedStoryboard, lockedShot.shotId).ok, false);
assert.equal(canReplaceSceneStoryboard(lockedStoryboard, script.scenes[0]!.sceneId).ok, false);
assert.equal(canReplaceSceneStoryboard(lockedStoryboard, script.scenes[0]!.sceneId, true).ok, true, "显式覆盖才允许");
const sceneBShot = { ...goodStoryboard.shots[0]!, shotId: "shot-scene-b", sceneId: "scene-b", shotGroupId: "sg-scene-b", locked: true };
const sceneBDoc = { ...goodStoryboard, shots: [...goodStoryboard.shots, sceneBShot], groups: [...goodStoryboard.groups, { ...goodStoryboard.groups[0]!, shotGroupId: "sg-scene-b", sceneId: "scene-b", shotIds: [sceneBShot.shotId] }] };
const replaced = replaceSceneInStoryboard(sceneBDoc, {
    episodeId: "ep-GHduqaBp",
    episodeNumber: 1,
    script,
    sceneId: script.scenes[0]!.sceneId,
    groups: storyboard1.groups,
    shots: storyboard1.shots,
    reason: "测试局部重生成",
});
assert.equal(replaced.storyboardVersion, 2);
assert.ok(replaced.shots.some((shot) => shot.shotId === "shot-scene-b" && shot.locked), "未受影响场景的锁定镜头必须保留");
assert.equal(replaced.shots.filter((shot) => shot.sceneId === "scene-b").length, 1);
assert.equal(replaced.shots.filter((shot) => shot.sceneId === script.scenes[0]!.sceneId).length, 2);
const replacedNumbers = replaced.shots.map((shot) => shot.shotNumber).sort((left, right) => left - right);
assert.deepEqual(replacedNumbers, replaced.shots.map((_, index) => index + 1), "局部替换后镜号必须全片连续且不重复");
const replacedShot = replaceShotInStoryboard(replaced, { ...replaced.shots.find((shot) => shot.shotId === storyboard1.shots[0]!.shotId)!, action: "新的动作" }, "单镜修改");
assert.equal(replacedShot.storyboardVersion, 3);
assert.equal(replacedShot.shots.find((shot) => shot.shotId === storyboard1.shots[0]!.shotId)!.version, 2);
const merged = mergeSceneIntoScript(script, { ...script.scenes[0]!, action: "压缩后的动作" });
assert.equal(merged.scriptVersion, 2);
assert.equal(merged.scenes[0]!.action, "压缩后的动作");
assert.equal(merged.scenes[1]!.action, script.scenes[1]!.action);

// 输出截断、缺失字段与队列/刷新状态：失败不能产生半成品。
assert.throws(() => parseProductionJson('{"scenes":[{"sceneTitle":"雾港"}', "scenes"), /截断或不完整/);
assert.throws(() => parseProductionJson('{"episode":1}', "scenes"), /缺少 scenes 数组/);
const parsed = parseProductionJson('```json\n{"scenes":[{"sceneTitle":"雾港"}]}\n```', "scenes") as { scenes: { sceneTitle: string }[] };
assert.equal(parsed.scenes.length, 1);
const job = createProductionJob({
    kind: "script",
    episodeIds: ["ep-GHduqaBp", "ep-tNU6q0U_"],
    episodeNumbers: [1, 2],
    model: { channelId: "builtin-doubao", modelId: "对话", label: "确定性测试" },
    modelParams: { temperature: 0.7 },
    promptVersion: "stage3-script-v1",
    sourceHandoffId: stage3Handoff.snapshotId,
    sourceBlueprintVersion: 1,
    sourcePlanVersions: [1, 2],
});
assert.equal(job.status, "pending");
assert.equal(job.calls, 0);
assert.equal(job.sourceHandoffId, "handoff-14rfeou");
const runningJob: StudioProductionJob = { ...job, status: "running", startedAt: new Date().toISOString() };
const interruptedProject = normalizeProductionForHydration({
    production: { version: 1, jobs: [runningJob, { ...job, id: "unknown-job", status: "unknown" }], activeJobId: runningJob.id, updatedAt: new Date().toISOString() },
    episodes: [],
} as unknown as StudioProject);
assert.equal(interruptedProject.production!.jobs[0]!.status, "interrupted");
assert.equal(interruptedProject.production!.jobs[0]!.remoteState, "unknown", "刷新时已提交的请求必须保留远端未知语义");
assert.equal(interruptedProject.production!.jobs[0]!.needsReview, true);
assert.equal(interruptedProject.production!.jobs[1]!.status, "unknown", "远端 unknown 不得在刷新后被改写成 interrupted 或 queued");
assert.equal(interruptedProject.production!.jobs[1]!.needsReview, true);
assert.equal(interruptedProject.production!.activeJobId, undefined, "刷新后不能保留活动锁并自动重发");
assert.equal(shotGroupsForScene(replaced, script.scenes[0]!.sceneId).length, 1);
assert.equal(shotsForGroup(replaced, replaced.groups[0]!).length, 2);

console.log(
    JSON.stringify({
        ok: true,
        tests: "stage3-core-check",
        fixture: { projectId: fixture.projectId, snapshotId: stage3Handoff.snapshotId, openChecks: stage3Handoff.checks.filter((check) => check.status === "open").length },
        admission: { episode1Formal: admission1.formalAllowed, episode2Formal: admission2.formalAllowed },
        script: { scenes: script.scenes.length, characters: script.characterBindings.length, props: script.propBindings.length, durationSeconds: script.durationEstimate.totalSeconds },
        storyboard: { groups: storyboard1.groups.length, shots: storyboard1.shots.length },
        checks: { scriptError: emptyCounts(goodScriptChecks).error, storyboardError: emptyCounts(goodStoryboardChecks).error },
        persistence: { status: interruptedProject.production!.jobs.map((item) => item.status), remoteState: interruptedProject.production!.jobs.map((item) => item.remoteState), activeJobId: interruptedProject.production!.activeJobId ?? null },
    }),
);
