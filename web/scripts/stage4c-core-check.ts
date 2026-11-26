// Stage 4C 确定性测试：连续性规则、空间 / 轴线 / 人物 / 道具 / 场景 / 动作、信息不足、
// 版本绑定与 stale、范围增量、去重。不调用模型，不读取真实项目数据。
import assert from "node:assert/strict";

import type {
    StudioProductionShot,
    StudioShotGroup,
    StudioStoryboardDocument,
    StudioStoryboardReview,
    StudioStoryboardReviewIssue,
} from "../src/types/studio-production";
import {
    STUDIO_CONTINUITY_RULES,
    buildContinuityCheck,
    runContinuityCheckAsync,
} from "../src/lib/studio/continuity-engine";
import {
    buildAllStoryboardReviewIssues,
    createEmptyStoryboardReview,
    normalizeStoryboardReview,
    planStoryboardReviewRefresh,
    reviewStats,
} from "../src/lib/studio/review-engine";

const now = "2026-11-25T08:00:00.000Z";

function group(overrides: Partial<StudioShotGroup> = {}): StudioShotGroup {
    return {
        shotGroupId: "grp-1",
        episodeId: "ep-1",
        sceneId: "sc-1",
        groupNumber: 1,
        sceneTitle: "码头对峙",
        sharedLayout: "双人中景",
        characterStartPositions: [
            { characterId: "char-a", name: "林舟", position: "画面左侧", orientation: "向右", eyeline: "看向右侧" },
            { characterId: "char-b", name: "沈砚", position: "画面右侧", orientation: "向左", eyeline: "看向左侧" },
        ],
        cameraAxis: "A-B 轴线",
        propStates: "林舟右手持刀",
        timeOfDay: "夜",
        lighting: "冷光",
        weather: "小雨",
        continuityRules: [],
        shotIds: [],
        reviewedByUser: false,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function shot(shotId: string, shotNumber: number, overrides: Partial<StudioProductionShot> = {}): StudioProductionShot {
    return {
        shotId,
        episodeId: "ep-1",
        sceneId: "sc-1",
        shotGroupId: "grp-1",
        shotNumber,
        duration: 5,
        shotSize: "中景",
        cameraPosition: "轴线左侧",
        cameraAngle: "平视",
        lens: "35mm",
        cameraMovement: "固定",
        composition: "双人左右站位",
        foreground: "雨水",
        midground: "两名人物",
        background: "仓库",
        characterBlocking: "林舟在左，沈砚在右",
        eyeline: "林舟看向右，沈砚看向左",
        action: "两人对峙",
        facialExpression: "紧绷",
        emotion: "警惕",
        dialogue: [],
        voiceOver: "",
        soundEffects: "雨声",
        backgroundMusic: "",
        lighting: "冷光",
        environment: "夜雨码头",
        continuityRules: [],
        characterBindings: [
            { characterId: "char-a", name: "林舟", outfitId: "outfit-a" },
            { characterId: "char-b", name: "沈砚", outfitId: "outfit-b" },
        ],
        outfitBindings: [
            { characterId: "char-a", outfitId: "outfit-a", description: "黑色雨衣" },
            { characterId: "char-b", outfitId: "outfit-b", description: "灰色风衣" },
        ],
        sceneBindings: { locationId: "loc-dock", locationVariantId: "variant-night" },
        propBindings: [{ propId: "prop-knife", name: "短刀", state: "出鞘" }],
        sourceReferences: {} as StudioProductionShot["sourceReferences"],
        sourceScriptSceneId: "sc-1",
        imagePrompt: "码头夜雨双人对峙",
        videoPrompt: "缓慢推近",
        keyframeRefs: [],
        status: "approved",
        version: 13,
        locked: false,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function doc(shots: StudioProductionShot[], groups: StudioShotGroup[], storyboardVersion = 3): StudioStoryboardDocument {
    return {
        id: "sb-1",
        episodeId: "ep-1",
        episodeNumber: 1,
        sourceScriptId: "script-1",
        sourceScriptVersion: 2,
        sourceEpisodePlanId: "plan-1",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-1",
        storyboardVersion,
        status: "approved",
        groups: groups.map((item) => ({ ...item, shotIds: shots.filter((candidate) => candidate.shotGroupId === item.shotGroupId).map((candidate) => candidate.shotId) })),
        shots,
        checks: [],
        createdAt: now,
        updatedAt: now,
    };
}

const rules = new Set<string>();
for (const rule of STUDIO_CONTINUITY_RULES) {
    assert.ok(rule.id.startsWith("continuity."), `rule id prefix: ${rule.id}`);
    assert.ok(!rules.has(rule.id), `duplicate rule id: ${rule.id}`);
    rules.add(rule.id);
    assert.ok(rule.fields.length > 0, `rule fields: ${rule.id}`);
    assert.ok(["error", "warning", "suggestion"].includes(rule.defaultSeverity), `rule severity: ${rule.id}`);
}

function findingsOf(report: ReturnType<typeof buildContinuityCheck>, ruleId: string) {
    return report.findings.filter((finding) => finding.ruleId === ruleId);
}

function assertFinding(report: ReturnType<typeof buildContinuityCheck>, ruleId: string, severity: "error" | "warning" | "suggestion", shotIds: string[]) {
    const matched = findingsOf(report, ruleId);
    assert.ok(matched.length > 0, `missing ${ruleId}; got ${report.findings.map((item) => item.ruleId).join(", ")}`);
    const finding = matched[0];
    assert.equal(finding.severity, severity, `${ruleId} severity`);
    assert.deepEqual(finding.shotIds, shotIds, `${ruleId} shotIds`);
    assert.ok(finding.evidence.length > 0, `${ruleId} evidence`);
    assert.ok(finding.reason.length > 0, `${ruleId} reason`);
    assert.ok(finding.suggestion.length > 0, `${ruleId} suggestion`);
    assert.ok(finding.fieldPath.length > 0, `${ruleId} fieldPath`);
}

// G1 正常双人对话 / 正反打：显式位置、朝向、视线、轴线一致，不误报。
const dialogueShots = [
    shot("s1", 1, {
        continuity: {
            space: {
                characters: [
                    { characterId: "char-a", screenSide: "left", facing: "right", eyelineTargetId: "char-b" },
                    { characterId: "char-b", screenSide: "right", facing: "left", eyelineTargetId: "char-a" },
                ],
                cameraSide: "axis_left",
            },
            characters: [
                { characterId: "char-a", outfitId: "outfit-a", injured: false },
                { characterId: "char-b", outfitId: "outfit-b", injured: false },
            ],
            props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: true }],
            environment: { timeOfDay: "夜", weather: "小雨", lighting: "冷光" },
            action: { phase: "start", actorId: "char-a", targetId: "char-b" },
        },
    }),
    shot("s2", 2, {
        continuity: {
            space: {
                characters: [
                    { characterId: "char-b", screenSide: "right", facing: "left", eyelineTargetId: "char-a" },
                    { characterId: "char-a", screenSide: "left", facing: "right", eyelineTargetId: "char-b" },
                ],
                cameraSide: "axis_left",
            },
            characters: [
                { characterId: "char-a", outfitId: "outfit-a", injured: false },
                { characterId: "char-b", outfitId: "outfit-b", injured: false },
            ],
            props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: true }],
            environment: { timeOfDay: "夜", weather: "小雨", lighting: "冷光" },
            action: { phase: "process", actorId: "char-b", targetId: "char-a" },
        },
    }),
];
const dialogue = buildContinuityCheck({ document: doc(dialogueShots, [group()]) });
assert.equal(dialogue.findings.length, 0, `normal dialogue false positive: ${dialogue.findings.map((item) => item.ruleId).join(", ")}`);
assert.equal(dialogue.counts.insufficient, 0);
assert.equal(dialogue.checkedPairs, 1);

// G2 无解释位置跳变（同一角色从左变右）=> Error + 高置信度 + 证据镜头。
const jumpShots = [
    shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }], cameraSide: "axis_left" } } }),
    shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "right" }, { characterId: "char-b", screenSide: "left" }], cameraSide: "axis_left" } } }),
];
const jump = buildContinuityCheck({ document: doc(jumpShots, [group()]) });
assertFinding(jump, "continuity.position_jump", "error", ["s1", "s2"]);
assert.equal(findingsOf(jump, "continuity.position_jump")[0].confidence, "high");

// G3 明确转身 => 不应报运动方向反转；明确 orbit => 不应报轴线跨越。
const turnShots = [
    shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left", facing: "right" }], cameraSide: "axis_left", movementCharacterId: "char-a", movementDirection: "left_to_right" } } }),
    shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left", facing: "left" }], cameraSide: "axis_right", movementCharacterId: "char-a", movementDirection: "right_to_left", orbit: true }, exceptions: [{ type: "turn", reason: "镜头内明确转身" }, { type: "orbit", reason: "环绕镜头" }] } }),
];
const turn = buildContinuityCheck({ document: doc(turnShots, [group()]) });
assert.equal(findingsOf(turn, "continuity.movement_reversal").length, 0, "turn should suppress movement reversal");
assert.equal(findingsOf(turn, "continuity.axis_cross").length, 0, "orbit should suppress axis cross");

// G4 视线方向不匹配 => 同一镜头组 Error。
const eyelineShots = [
    shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left", eyelineTargetId: "char-b" }, { characterId: "char-b", screenSide: "right" }] } } }),
    shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "right", facing: "right", eyelineTargetId: "char-b" }, { characterId: "char-b", screenSide: "left", facing: "right" }] } } }),
];
const eyeline = buildContinuityCheck({ document: doc(eyelineShots, [group()]) });
assertFinding(eyeline, "continuity.eyeline_mismatch", "error", ["s1", "s2"]);

// G5 相机跨越 180 度轴线，无 cross_axis 例外 => 同组 Error。
const axisShots = [
    shot("s1", 1, { continuity: { space: { cameraSide: "axis_left" } } }),
    shot("s2", 2, { continuity: { space: { cameraSide: "axis_right" } } }),
];
const axis = buildContinuityCheck({ document: doc(axisShots, [group()]) });
assertFinding(axis, "continuity.axis_cross", "error", ["s1", "s2"]);

// G6 无解释换装 / 合理换装。
const outfitShots = [
    shot("s1", 1, { continuity: { characters: [{ characterId: "char-a", outfitId: "outfit-a" }] } }),
    shot("s2", 2, { continuity: { characters: [{ characterId: "char-a", outfitId: "outfit-b" }] } }),
];
const outfit = buildContinuityCheck({ document: doc(outfitShots, [group()]) });
assertFinding(outfit, "continuity.character_outfit_change", "warning", ["s1", "s2"]);
const outfitAllowed = buildContinuityCheck({ document: doc([outfitShots[0], { ...outfitShots[1], continuity: { ...outfitShots[1].continuity, exceptions: [{ type: "costume_change", reason: "剧情换装" }] } }], [group()]) });
assert.equal(findingsOf(outfitAllowed, "continuity.character_outfit_change").length, 0);

// G7 伤势消失 / 治疗例外。
const injuryShots = [
    shot("s1", 1, { continuity: { characters: [{ characterId: "char-a", injured: true }] } }),
    shot("s2", 2, { continuity: { characters: [{ characterId: "char-a", injured: false }] } }),
];
const injury = buildContinuityCheck({ document: doc(injuryShots, [group()]) });
assertFinding(injury, "continuity.character_injury_change", "warning", ["s1", "s2"]);
const healed = buildContinuityCheck({ document: doc([injuryShots[0], { ...injuryShots[1], continuity: { ...injuryShots[1].continuity, exceptions: [{ type: "heal", reason: "治疗后" }] } }], [group()]) });
assert.equal(findingsOf(healed, "continuity.character_injury_change").length, 0);

// G8 同名不同人物 ID => Error；同 ID 换服装变体不算身份变化。
const identityShots = [
    shot("s1", 1, { characterBindings: [{ characterId: "char-a", name: "林舟", outfitId: "outfit-a" }] }),
    shot("s2", 2, { characterBindings: [{ characterId: "char-x", name: "林舟", outfitId: "outfit-a" }] }),
];
const identity = buildContinuityCheck({ document: doc(identityShots, [group()]) });
assertFinding(identity, "continuity.character_identity_conflict", "error", ["s1", "s2"]);

// G9 道具：无解释换手 / 换手动作允许；持有人交接允许；无解释消失。
const propShots = [
    shot("s1", 1, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: true }] } }),
    shot("s2", 2, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "left", visible: true }] } }),
];
const hand = buildContinuityCheck({ document: doc(propShots, [group()]) });
assertFinding(hand, "continuity.prop_hand_change", "warning", ["s1", "s2"]);
const handAllowed = buildContinuityCheck({ document: doc([propShots[0], { ...propShots[1], action: "林舟换手握住短刀", continuity: { ...propShots[1].continuity, props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "left", visible: true, transferredTo: "char-a" }] } }], [group()]) });
assert.equal(findingsOf(handAllowed, "continuity.prop_hand_change").length, 0);

const holderShots = [
    shot("s1", 1, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: true }] } }),
    shot("s2", 2, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-b", hand: "right", visible: true }] } }),
];
const holder = buildContinuityCheck({ document: doc(holderShots, [group()]) });
assertFinding(holder, "continuity.prop_holder_change", "error", ["s1", "s2"]);
const holderAllowed = buildContinuityCheck({ document: doc([holderShots[0], { ...holderShots[1], action: "林舟把短刀交给沈砚", continuity: { ...holderShots[1].continuity, props: [{ propId: "prop-knife", holderCharacterId: "char-b", hand: "right", visible: true, transferredTo: "char-b" }] } }], [group()]) });
assert.equal(findingsOf(holderAllowed, "continuity.prop_holder_change").length, 0);

const propGoneShots = [
    shot("s1", 1, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: true }] } }),
    shot("s2", 2, { continuity: { props: [] }, propBindings: [] }),
];
const propGone = buildContinuityCheck({ document: doc(propGoneShots, [group()]) });
assertFinding(propGone, "continuity.prop_disappear", "warning", ["s1", "s2"]);

// G10 场景时间：同组昼夜变化 Error；time_jump 例外允许；天气变化 Warning。
const timeShots = [
    shot("s1", 1, { continuity: { environment: { timeOfDay: "日", weather: "晴" } } }),
    shot("s2", 2, { continuity: { environment: { timeOfDay: "夜", weather: "雨" } } }),
];
const time = buildContinuityCheck({ document: doc(timeShots, [group()]) });
assertFinding(time, "continuity.scene_time_change", "error", ["s1", "s2"]);
assertFinding(time, "continuity.scene_weather_change", "warning", ["s1", "s2"]);
const timeJump = buildContinuityCheck({ document: doc([timeShots[0], { ...timeShots[1], continuity: { ...timeShots[1].continuity, exceptions: [{ type: "time_jump", reason: "数小时后" }] } }], [group()]) });
assert.equal(findingsOf(timeJump, "continuity.scene_time_change").length, 0);

// G11 环境破坏恢复 => Warning。
const envShots = [
    shot("s1", 1, { continuity: { environment: { damage: "墙体倒塌" } } }),
    shot("s2", 2, { continuity: { environment: { damage: "墙体完好" } } }),
];
const env = buildContinuityCheck({ document: doc(envShots, [group()]) });
assertFinding(env, "continuity.scene_environment_reset", "warning", ["s1", "s2"]);

// G12 动作承接：当前 result 有显式结构，但前一镜头没有 contact/process/start，也无例外 => Warning。
const actionShots = [
    shot("s1", 1, { continuity: { action: { phase: "unknown", actorId: "char-a" } } }),
    shot("s2", 2, { continuity: { action: { phase: "result", actorId: "char-b", targetId: "char-a" } } }),
];
const action = buildContinuityCheck({ document: doc(actionShots, [group()]) });
assertFinding(action, "continuity.action_cause_missing", "warning", ["s1", "s2"]);
const actionAllowed = buildContinuityCheck({ document: doc([actionShots[0], { ...actionShots[1], continuity: { ...actionShots[1].continuity, exceptions: [{ type: "match_cut", reason: "动作匹配剪辑" }] } }], [group()]) });
assert.equal(findingsOf(actionAllowed, "continuity.action_cause_missing").length, 0);

// G13 受力方向与反应方向不匹配 => Warning。
const forceShots = [
    shot("s1", 1, { continuity: { action: { phase: "contact", forceDirection: "left_to_right" } } }),
    shot("s2", 2, { continuity: { action: { phase: "reaction", reactionDirection: "right_to_left" } } }),
];
const force = buildContinuityCheck({ document: doc(forceShots, [group()]) });
assertFinding(force, "continuity.action_force_mismatch", "warning", ["s1", "s2"]);

// G14 旧数据缺空间 / 道具字段：不伪造，不误判，输出信息不足。
const legacyShots = [
    shot("s1", 1, { characterBlocking: "两人在码头对峙", continuity: undefined }),
    shot("s2", 2, { characterBlocking: "两人仍在码头", continuity: undefined }),
];
const legacy = buildContinuityCheck({ document: doc(legacyShots, [group()]) });
assert.equal(legacy.findings.length, 0, `legacy false positive: ${legacy.findings.map((item) => item.ruleId).join(", ")}`);
assert.ok(legacy.counts.insufficient > 0, "legacy should report insufficient evidence");
assert.ok(legacy.gaps.some((gap) => gap.ruleId === "continuity.position_jump"));

// G15 范围：单镜头只检查关联对，镜头组 / 场景 / 全集范围可区分。
const scopeShots = [shot("s1", 1), shot("s2", 2), shot("s3", 3)];
const scopeDoc = doc(scopeShots, [group()]);
const scopeShot = buildContinuityCheck({ document: scopeDoc, scope: { type: "shot", id: "s1" } });
assert.equal(scopeShot.checkedPairs, 1);
const scopeGroup = buildContinuityCheck({ document: scopeDoc, scope: { type: "group", id: "grp-1" } });
assert.equal(scopeGroup.checkedPairs, 2);
const scopeEpisode = buildContinuityCheck({ document: scopeDoc, scope: { type: "episode" } });
assert.equal(scopeEpisode.checkedPairs, 2);

// G16 异步入口：正常完成；取消返回 cancelled 且不落问题。
let progressDone = false;
const asyncResult = await runContinuityCheckAsync({ document: scopeDoc, scope: { type: "episode" }, batchSize: 1, onProgress: (progress) => { if (progress.phase === "done") progressDone = true; } });
assert.equal(asyncResult.cancelled, false);
assert.equal(asyncResult.report.checkedPairs, 2);
assert.equal(progressDone, true);
const controller = new AbortController();
controller.abort();
const cancelledResult = await runContinuityCheckAsync({ document: scopeDoc, signal: controller.signal });
assert.equal(cancelledResult.cancelled, true);
assert.equal(cancelledResult.report.checkedPairs, 0);

// G17 审核集成：连续性问题进入现有 storyboardReview.issues，带版本、规则、证据、置信度。
const integratedDoc = doc(jumpShots, [group()]);
const integrated = buildAllStoryboardReviewIssues({ document: integratedDoc, review: undefined, now });
const continuityIssues = integrated.issues.filter((issue) => issue.ruleId === "continuity.position_jump");
assert.equal(continuityIssues.length, 2);
const issue = continuityIssues[0];
assert.equal(issue.level, "error");
assert.equal(issue.confidence, "high");
assert.deepEqual(issue.shotIds, ["s1", "s2"]);
assert.equal(issue.storyboardVersion, integratedDoc.storyboardVersion);
assert.equal(issue.continuityScope, "group");
assert.ok(issue.evidence && issue.suggestion);
assert.equal(integrated.issues.filter((candidate) => candidate.id === issue.id).length, 1, "issue dedup");

// G18 版本变化：旧连续性问题保留但连续 stale，不再计入 open；不相关问题尽量保留。
const oldDoc = doc(jumpShots, [group()], 3);
const oldIssues = buildAllStoryboardReviewIssues({ document: oldDoc, review: undefined, now }).issues;
const accepted = oldIssues.map((candidate) => candidate.ruleId === "continuity.position_jump" ? { ...candidate, status: "accepted" as const } : candidate);
const previousReview: StudioStoryboardReview = normalizeStoryboardReview({
    ...createEmptyStoryboardReview("ep-1", "sb-1", 3, now),
    issues: accepted,
    lastCheckedAt: now,
    updatedAt: now,
});
const fixedShots = [
    shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }], cameraSide: "axis_left" } } }),
    shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }], cameraSide: "axis_left" } } }),
];
const fixedDoc = doc(fixedShots, [group()], 4);
const refreshed = planStoryboardReviewRefresh({ document: fixedDoc, review: previousReview, now });
const staleIssue = refreshed.issues?.find((candidate) => candidate.id === issue.id);
assert.ok(staleIssue, "old continuity issue should be kept");
assert.equal(staleIssue?.continuityStale, true);
assert.equal(staleIssue?.status, "accepted", "history status preserved");
const staleStats = reviewStats(fixedDoc, refreshed, refreshed.issues ?? []);
assert.equal(staleStats.errors, 0, "stale continuity issue not counted as open error");
assert.equal(refreshed.continuityRuns?.length, 1);
assert.equal(refreshed.continuityRuns?.[0].storyboardVersion, 4);

// G19 定向 scope：重查 group-2 不清除 group-1 的旧连续性问题。
const groupOne = group({ shotGroupId: "grp-1", groupNumber: 1, shotIds: [] });
const groupTwo = group({ shotGroupId: "grp-2", groupNumber: 2, shotIds: [] });
const scopedShots = [
    shot("g1s1", 1, { shotGroupId: "grp-1", continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }] } } }),
    shot("g1s2", 2, { shotGroupId: "grp-1", continuity: { space: { characters: [{ characterId: "char-a", screenSide: "right" }, { characterId: "char-b", screenSide: "left" }] } } }),
    shot("g2s1", 3, { shotGroupId: "grp-2", continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }] } } }),
    shot("g2s2", 4, { shotGroupId: "grp-2", continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }] } } }),
];
const scopedDoc = doc(scopedShots, [groupOne, groupTwo], 5);
const scopedOld = buildAllStoryboardReviewIssues({ document: scopedDoc, review: undefined, now }).issues;
const scopedReview = normalizeStoryboardReview({
    ...createEmptyStoryboardReview("ep-1", "sb-1", 5, now),
    issues: scopedOld,
    lastCheckedAt: now,
    updatedAt: now,
});
const scopedRefresh = planStoryboardReviewRefresh({ document: scopedDoc, review: scopedReview, scope: { type: "group", id: "grp-2" }, now });
const groupOneIssue = scopedOld.find((candidate) => candidate.ruleId === "continuity.position_jump" && candidate.shotIds?.includes("g1s1"));
assert.ok(groupOneIssue);
const kept = scopedRefresh.issues?.find((candidate) => candidate.id === groupOneIssue.id);
assert.ok(kept);
assert.equal(Boolean(kept?.continuityStale), false, "unrelated group issue should not be stale");
assert.equal(scopedRefresh.continuityRuns?.at(-1)?.scope.type, "group");
assert.equal(scopedRefresh.continuityRuns?.at(-1)?.scope.id, "grp-2");

// G20 明确跨轴 / 建立镜头：explicit cross_axis 与 establishing 都不得误报轴线或位置跳变。
const crossShots = [
    shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }], cameraSide: "axis_left" } } }),
    shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }], cameraSide: "axis_right" }, exceptions: [{ type: "cross_axis", reason: "明确跨轴" }] } }),
];
const crossAllowed = buildContinuityCheck({ document: doc(crossShots, [group()]) });
assert.equal(findingsOf(crossAllowed, "continuity.axis_cross").length, 0, "explicit cross_axis should suppress axis finding");

const establishingShots = [
    shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }], cameraSide: "axis_left" } } }),
    shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "right" }, { characterId: "char-b", screenSide: "left" }], cameraSide: "axis_right", establishing: true }, exceptions: [{ type: "establishing", reason: "建立镜头重新定位" }] } }),
];
const establishingAllowed = buildContinuityCheck({ document: doc(establishingShots, [group()]) });
assert.equal(findingsOf(establishingAllowed, "continuity.position_jump").length, 0, "establishing should suppress position jump");
assert.equal(findingsOf(establishingAllowed, "continuity.axis_cross").length, 0, "establishing should suppress axis finding");

// G21 正常天气变化：environment_change 例外允许，不报天气连续性。
const weatherShots = [
    shot("s1", 1, { continuity: { environment: { timeOfDay: "夜", weather: "小雨", lighting: "冷光" } } }),
    shot("s2", 2, { continuity: { environment: { timeOfDay: "夜", weather: "晴", lighting: "月光" }, exceptions: [{ type: "environment_change", reason: "剧情中雨停" }] } }),
];
const weatherAllowed = buildContinuityCheck({ document: doc(weatherShots, [group()]) });
assert.equal(findingsOf(weatherAllowed, "continuity.scene_weather_change").length, 0, "environment_change should allow weather change");

// G22 正常掉落 / 拾起：prop_drop 与 prop_pickup 例外允许，不报道具消失。
const dropShots = [
    shot("s1", 1, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: true }] } }),
    shot("s2", 2, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: false, dropped: true }], exceptions: [{ type: "prop_drop", reason: "短刀落地" }] } }),
];
const dropAllowed = buildContinuityCheck({ document: doc(dropShots, [group()]) });
assert.equal(findingsOf(dropAllowed, "continuity.prop_disappear").length, 0, "prop_drop should allow disappearance");
const pickupShots = [
    shot("s1", 1, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: false, dropped: true }] } }),
    shot("s2", 2, { continuity: { props: [{ propId: "prop-knife", holderCharacterId: "char-a", hand: "right", visible: true, pickedUp: true }], exceptions: [{ type: "prop_pickup", reason: "拾起短刀" }] } }),
];
const pickupAllowed = buildContinuityCheck({ document: doc(pickupShots, [group()]) });
assert.equal(findingsOf(pickupAllowed, "continuity.prop_disappear").length, 0, "prop_pickup should allow reappearance");

// G23 合理跳切 / 慢动作：jump_cut 与 slow_motion 例外允许动作结果先行。
const baseActionShots = [
    shot("s1", 1, { continuity: { action: { phase: "start", actorId: "char-a", targetId: "char-b" } } }),
    shot("s2", 2, { continuity: { action: { phase: "result", actorId: "char-b", targetId: "char-a" } } }),
];
const jumpCutShots = [baseActionShots[0], { ...baseActionShots[1], continuity: { ...baseActionShots[1].continuity, exceptions: [{ type: "jump_cut" as const, reason: "合理跳切" }] } }];
const jumpCutAllowed = buildContinuityCheck({ document: doc(jumpCutShots, [group()]) });
assert.equal(findingsOf(jumpCutAllowed, "continuity.action_cause_missing").length, 0, "jump_cut should suppress action cause");
const slowMotionShots = [baseActionShots[0], { ...baseActionShots[1], continuity: { ...baseActionShots[1].continuity, exceptions: [{ type: "slow_motion" as const, reason: "慢动作强调" }] } }];
const slowMotionAllowed = buildContinuityCheck({ document: doc(slowMotionShots, [group()]) });
assert.equal(findingsOf(slowMotionAllowed, "continuity.action_cause_missing").length, 0, "slow_motion should suppress action cause");

// G24 正常动作承接：起势 → 接触 → 反应，不报缺少原因。
const continuationShots = [
    shot("s1", 1, { continuity: { action: { phase: "start", actorId: "char-a", targetId: "char-b" } } }),
    shot("s2", 2, { continuity: { action: { phase: "contact", actorId: "char-a", targetId: "char-b" } } }),
    shot("s3", 3, { continuity: { action: { phase: "reaction", actorId: "char-b", targetId: "char-a" } } }),
];
const continuation = buildContinuityCheck({ document: doc(continuationShots, [group()]) });
assert.equal(findingsOf(continuation, "continuity.action_cause_missing").length, 0, "normal action continuation should pass");

// G25 正常正反打：A 画面左侧看向 B，B 画面右侧看向 A，同侧轴线，不报视线或轴线。
const reverseShots = [
    shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left", facing: "right", eyelineTargetId: "char-b" }], cameraSide: "axis_left" } } }),
    shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-b", screenSide: "right", facing: "left", eyelineTargetId: "char-a" }], cameraSide: "axis_left" } } }),
];
const reverse = buildContinuityCheck({ document: doc(reverseShots, [group()]) });
assert.equal(findingsOf(reverse, "continuity.eyeline_mismatch").length, 0, "normal reverse shot should not report eyeline");
assert.equal(findingsOf(reverse, "continuity.axis_cross").length, 0, "normal reverse shot should not report axis");

// G26 多人群像：三人稳定左右 / 中间站位，不把群像误判为位置跳变。
const crowdShots = [
    shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "center" }, { characterId: "char-c", screenSide: "right" }], cameraSide: "axis_left" } } }),
    shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "center" }, { characterId: "char-c", screenSide: "right" }], cameraSide: "axis_left" } } }),
];
const crowd = buildContinuityCheck({ document: doc(crowdShots, [group()]) });
assert.equal(findingsOf(crowd, "continuity.position_jump").length, 0, "stable crowd blocking should not report jump");

console.log(`stage4c-core-check: ${STUDIO_CONTINUITY_RULES.length} rules, 26 groups passed`);
