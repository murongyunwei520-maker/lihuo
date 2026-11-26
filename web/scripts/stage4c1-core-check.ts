// Stage 4C.1 确定性测试：人物绑定冲突、动作阶段、方向接入、状态比较、
// 异步检查结果复用 / 版本保护、快照丢弃事务保护。不调用模型，不读取真实项目数据。
import assert from "node:assert/strict";

import type {
    StudioProductionShot,
    StudioScriptDocument,
    StudioShotGroup,
    StudioStoryboardDocument,
    StudioStoryboardReview,
    StudioStoryboardVersion,
} from "../src/types/studio-production";
import type { StudioProject } from "../src/types/studio";
import {
    buildContinuityCheck,
    parseActionPhase,
    parseDirection,
    runContinuityCheckAsync,
    STUDIO_CONTINUITY_RULES,
} from "../src/lib/studio/continuity-engine";
import {
    buildAllStoryboardReviewIssues,
    createEmptyStoryboardReview,
    normalizeStoryboardReview,
    planStoryboardReviewRefresh,
} from "../src/lib/studio/review-engine";
import {
    commitStoryboardSnapshotDiscard,
    parseStudioEnvelope,
    serializeStudioEnvelope,
    type StudioStateStore,
} from "../src/lib/studio-store-persistence";

const now = "2026-11-25T11:00:00.000Z";

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

function scriptDocument(bindings: Array<{ characterId: string; name: string }>): StudioScriptDocument {
    return {
        id: "script-1",
        episodeId: "ep-1",
        episodeNumber: 1,
        title: "雾港夜航",
        logline: "",
        synopsis: "",
        durationTarget: 120,
        durationEstimate: { dialogueSeconds: 0, actionSeconds: 0, transitionSeconds: 0, pauseSeconds: 0, environmentSeconds: 0, totalSeconds: 0, deltaSeconds: 0, note: "" },
        sourceEpisodePlanId: "plan-1",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-1",
        scriptVersion: 2,
        status: "approved",
        scenes: [],
        characterBindings: bindings.map((binding) => ({ ...binding, role: "主角", costume: "", look: "", sceneIds: ["sc-1"] })),
        locationBindings: [],
        propBindings: [],
        sourceReferences: {} as StudioScriptDocument["sourceReferences"],
        continuityDependencies: [],
        adaptationChanges: [],
        createdAt: now,
        updatedAt: now,
    };
}

function findingsOf(report: ReturnType<typeof buildContinuityCheck>, ruleId: string) {
    return report.findings.filter((finding) => finding.ruleId === ruleId);
}

function assertFinding(
    report: ReturnType<typeof buildContinuityCheck>,
    ruleId: string,
    severity: "error" | "warning" | "suggestion",
    shotIds: string[],
) {
    const matched = findingsOf(report, ruleId);
    assert.ok(matched.length > 0, `missing ${ruleId}; got ${report.findings.map((item) => item.ruleId).join(", ")}`);
    const finding = matched[0];
    assert.equal(finding.severity, severity, `${ruleId} severity`);
    assert.deepEqual(finding.shotIds, shotIds, `${ruleId} shotIds`);
    assert.equal(finding.ruleId, ruleId, `${ruleId} ruleId`);
    assert.ok(finding.evidence.length > 0, `${ruleId} evidence`);
    assert.ok(finding.reason.length > 0, `${ruleId} reason`);
    assert.ok(finding.suggestion.length > 0, `${ruleId} suggestion`);
    assert.ok(finding.fieldPath.length > 0, `${ruleId} fieldPath`);
    assert.ok(["high", "medium", "low"].includes(finding.confidence), `${ruleId} confidence`);
}

function assertNoFinding(report: ReturnType<typeof buildContinuityCheck>, ruleId: string) {
    assert.equal(findingsOf(report, ruleId).length, 0, `unexpected ${ruleId}`);
}

// ---------------------------------------------------------------------------
// 1. 人物注册表 / 当前镜头绑定（至少 10 组）
// ---------------------------------------------------------------------------
const registry10 = scriptDocument([
    { characterId: "char-a", name: "林舟" },
    { characterId: "char-b", name: "沈砚" },
    { characterId: "char-c", name: "周野" },
    { characterId: "char-d", name: "阿岚" },
    { characterId: "char-e", name: "老陈" },
    { characterId: "char-f", name: "顾棠" },
    { characterId: "char-g", name: "陆沉" },
    { characterId: "char-h", name: "白露" },
    { characterId: "char-i", name: "韩青" },
    { characterId: "char-j", name: "许默" },
]);
const plainGroup = group({ characterStartPositions: [] });

// 1.1 同一人物正常绑定：当前镜头绑定与注册表一致，不产生身份问题。
const normalBinding = buildContinuityCheck({
    document: doc([shot("s1", 1, {
        characterBlocking: "林舟独自站在左侧",
        eyeline: "林舟看向前方",
        action: "林舟握刀警戒",
        composition: "单人构图",
        characterBindings: [{ characterId: "char-a", name: "林舟", outfitId: "outfit-a" }],
    })], [plainGroup]),
    script: registry10,
});
assert.equal(normalBinding.findings.filter((finding) => finding.ruleId === "continuity.character_identity_conflict").length, 0);
assert.equal(normalBinding.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict").length, 0);

// 1.2 同名人物正确 ID：不误报。
const sameNameCorrect = buildContinuityCheck({
    document: doc([shot("s1", 1, { characterBindings: [{ characterId: "char-a", name: "林舟" }] })], [plainGroup]),
    script: registry10,
});
assertNoFinding(sameNameCorrect, "continuity.character_identity_conflict");

// 1.3 同名人物错误 ID：保留原始证据，产生 Error。
const sameNameWrong = buildContinuityCheck({
    document: doc([shot("s1", 1, { characterBindings: [{ characterId: "char-x", name: "林舟" }] })], [plainGroup]),
    script: registry10,
});
assertFinding(sameNameWrong, "continuity.character_identity_conflict", "error", ["s1"]);
const sameNameFinding = findingsOf(sameNameWrong, "continuity.character_identity_conflict")[0];
assert.ok(sameNameFinding.evidence.includes("char-x") && sameNameFinding.evidence.includes("char-a"), "binding evidence keeps both IDs");

// 1.4 同一 ID 不同姓名：Warning，而不是自动把名字改成注册表名字。
const sameIdDifferentName = buildContinuityCheck({
    document: doc([shot("s1", 1, { characterBindings: [{ characterId: "char-a", name: "沈砚" }] })], [plainGroup]),
    script: scriptDocument([{ characterId: "char-a", name: "林舟" }]),
});
assertFinding(sameIdDifferentName, "continuity.character_identity_conflict", "warning", ["s1"]);

// 1.5 全剧 10 人、当前镜头只有 2 人：不得把其余 8 人塞进镜头。
const twoOfTen = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { characterBindings: [
            { characterId: "char-a", name: "林舟" },
            { characterId: "char-b", name: "沈砚" },
        ] }),
        shot("s2", 2, { characterBindings: [
            { characterId: "char-a", name: "林舟" },
            { characterId: "char-b", name: "沈砚" },
        ] }),
    ], [group({ characterStartPositions: [] })]),
    script: registry10,
});
assertNoFinding(twoOfTen, "continuity.character_identity_conflict");
assert.equal(twoOfTen.checkedShots, 2);
assert.ok(twoOfTen.findings.every((finding) => !finding.evidence.includes("周野")), "unrelated registry character must not appear in shot findings");
assert.equal(twoOfTen.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict").length, 0, "unrelated registry characters must not create binding gaps");

// 1.6 当前镜头明确出画：off_screen 不能被当成位置跳变。
const offScreen = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { characterBindings: [{ characterId: "char-a", name: "林舟" }], continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }] } } }),
        shot("s2", 2, { characterBindings: [{ characterId: "char-a", name: "林舟" }], continuity: { space: { characters: [{ characterId: "char-a", screenSide: "off_screen" }] } } }),
    ], [plainGroup]),
});
assertNoFinding(offScreen, "continuity.position_jump");

// 1.7 当前镜头人物绑定缺失：不能等于人物不存在；文本提到注册表人物时记信息不足。
const missingBindings = buildContinuityCheck({
    document: doc([shot("s1", 1, { action: "林舟在码头等待", characterBindings: [], propBindings: [] })], [plainGroup]),
    script: registry10,
});
assert.ok(missingBindings.gaps.some((gap) => gap.ruleId === "continuity.character_identity_conflict" && gap.fieldPath === "characterBindings" && gap.reason.includes("林舟")), "missing binding gap");

// 1.8 旧数据没有人物 ID：不伪造身份，记信息不足。
const legacyNoId = buildContinuityCheck({
    document: doc([shot("s1", 1, { characterBindings: [{ characterId: "", name: "林舟" }] })], [plainGroup]),
});
assert.ok(legacyNoId.gaps.some((gap) => gap.ruleId === "continuity.character_identity_conflict" && gap.fieldPath === "characterBindings[].characterId"), "legacy missing characterId gap");

// 1.9 相似名称：最长匹配，不能把“林月”拆成“林”。
const similarNames = buildContinuityCheck({
    document: doc([shot("s1", 1, {
        characterBlocking: "林月独自站在左侧",
        eyeline: "林月看向前方",
        action: "林月从左向右奔跑",
        composition: "单人构图",
        characterBindings: [],
        propBindings: [],
    })], [plainGroup]),
    script: scriptDocument([{ characterId: "char-lin", name: "林" }, { characterId: "char-yue", name: "林月" }]),
});
assert.ok(similarNames.gaps.some((gap) => gap.reason.includes("林月")), "similar name should match longest");
assert.ok(!similarNames.gaps.some((gap) => gap.reason.includes("「林」")), "short name must not be split out of 林月");

// 1.10 绑定错误不能被归一化隐藏：问题仍带原 ID、shotIds 和证据。
const hiddenNormalization = buildContinuityCheck({
    document: doc([shot("s1", 1, { characterBindings: [{ characterId: "char-x", name: "林舟" }] })], [plainGroup]),
    script: registry10,
});
const hiddenFinding = findingsOf(hiddenNormalization, "continuity.character_identity_conflict")[0];
assert.ok(hiddenFinding);
assert.deepEqual(hiddenFinding.shotIds, ["s1"]);
assert.ok(hiddenFinding.evidence.includes("char-x"));
assert.ok(hiddenFinding.evidence.includes("char-a"));

// 1.11 同一镜头同名两个 ID：错误绑定必须显式出现。
const duplicateNames = buildContinuityCheck({
    document: doc([shot("s1", 1, { characterBindings: [
        { characterId: "char-a", name: "林舟" },
        { characterId: "char-x", name: "林舟" },
    ] })], [plainGroup]),
});
assertFinding(duplicateNames, "continuity.character_identity_conflict", "error", ["s1"]);

// ---------------------------------------------------------------------------
// 2. 动作阶段识别（至少 20 组）
// ---------------------------------------------------------------------------
const phaseCases: Array<[string, ReturnType<typeof parseActionPhase>]> = [
    ["被击中", "reaction"],
    ["被打中", "reaction"],
    ["受击", "reaction"],
    ["挨打", "reaction"],
    ["受到冲击", "reaction"],
    ["被震退", "reaction"],
    ["被击飞", "reaction"],
    ["击中", "contact"],
    ["打中", "contact"],
    ["命中", "contact"],
    ["撞击", "contact"],
    ["接触目标", "contact"],
    ["倒地", "result"],
    ["跪地", "result"],
    ["飞出", "result"],
    ["失去平衡", "result"],
    ["撞上墙壁", "result"],
    ["蓄力", "start"],
    ["抬手", "start"],
    ["握拳", "start"],
    ["举剑", "start"],
    ["瞄准", "start"],
    ["挥拳", "process"],
    ["挥剑", "process"],
    ["奔跑", "process"],
    ["跳跃", "process"],
    ["推动", "process"],
    ["转身", "process"],
    ["起身", "recovery"],
    ["稳住身体", "recovery"],
    ["重新站立", "recovery"],
    ["调整姿势", "recovery"],
];
for (const [text, expected] of phaseCases) {
    assert.equal(parseActionPhase(text), expected, `action phase: ${text}`);
}
assert.equal(parseActionPhase("被击中"), "reaction", "被击中不能归类为 contact");
assert.equal(parseActionPhase("受到冲击"), "reaction", "受到冲击不能归类为 contact");
assert.equal(parseActionPhase("挥拳击中对手"), "contact", "攻击者击中目标应为 contact");
assert.equal(parseActionPhase("对手被击飞"), "result", "对手被击飞应为 result");
assert.equal(parseActionPhase("人物抬手蓄力"), "start", "抬手蓄力应为 start");
assert.equal(parseActionPhase("攻击者击中目标"), "contact", "攻击者击中目标仍为 contact");
assert.equal(parseActionPhase("目标被击中"), "reaction", "目标被击中不能被 contact 吞掉");
assert.equal(parseActionPhase("完全未知的动作"), undefined, "unknown action");

// ---------------------------------------------------------------------------
// 3. 方向解析与引擎接入（至少 15 组）
// ---------------------------------------------------------------------------
const directionCases: Array<[string, string | undefined]> = [
    ["镜头从左向右横移", "left_to_right"],
    ["人物从右向左冲来", "right_to_left"],
    ["人物向镜头逼近", "toward_camera"],
    ["人物远离镜头", "away_from_camera"],
    ["人物向前推进", "forward"],
    ["人物向后撤退", "backward"],
    ["人物向上跃起", "up"],
    ["人物向下坠落", "down"],
    ["镜头顺时针旋转", "clockwise"],
    ["镜头逆时针旋转", "counterclockwise"],
    ["人物向左奔跑", "right_to_left"],
    ["人物向右奔跑", "left_to_right"],
    ["人物转身", "turn"],
    ["人物停住", "stop"],
    ["没有任何方向信息", undefined],
];
for (const [text, expected] of directionCases) {
    assert.equal(parseDirection(text), expected, `direction: ${text}`);
}

const movementShots = [
    shot("s1", 1, { action: "林舟从左向右奔跑" }),
    shot("s2", 2, { action: "林舟继续向左奔跑" }),
];
const reversal = buildContinuityCheck({ document: doc(movementShots, [group()]) });
assertFinding(reversal, "continuity.movement_reversal", "warning", ["s1", "s2"]);

const explicitWins = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { action: "林舟从左向右奔跑", continuity: { space: { movementCharacterId: "char-a", movementDirection: "left_to_right" } } }),
        shot("s2", 2, { action: "林舟继续向左奔跑", continuity: { space: { movementCharacterId: "char-a", movementDirection: "left_to_right" } } }),
    ], [group()]),
});
assertNoFinding(explicitWins, "continuity.movement_reversal");

const towardAway = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { continuity: { space: { movementCharacterId: "char-a", movementDirection: "toward_camera" } } }),
        shot("s2", 2, { continuity: { space: { movementCharacterId: "char-a", movementDirection: "away_from_camera" } } }),
    ], [group()]),
});
assertFinding(towardAway, "continuity.movement_reversal", "warning", ["s1", "s2"]);

const turnAllowed = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { action: "林舟从左向右奔跑" }),
        shot("s2", 2, { action: "林舟转身向左", characterBlocking: "林舟转身向左，沈砚在右", continuity: { exceptions: [{ type: "turn", reason: "明确转身" }] } }),
    ], [group()]),
});
assertNoFinding(turnAllowed, "continuity.movement_reversal");

const orbitAllowed = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { continuity: { space: { movementCharacterId: "char-a", movementDirection: "left_to_right" } } }),
        shot("s2", 2, { continuity: { space: { movementCharacterId: "char-a", movementDirection: "right_to_left" }, exceptions: [{ type: "orbit", reason: "摄影机环绕" }] } }),
    ], [group()]),
});
assertNoFinding(orbitAllowed, "continuity.movement_reversal");

const establishingAllowed = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { action: "林舟从左向右奔跑" }),
        shot("s2", 2, { action: "林舟继续向左奔跑", continuity: { space: { establishing: true }, exceptions: [{ type: "establishing", reason: "建立镜头" }] } }),
    ], [group()]),
});
assertNoFinding(establishingAllowed, "continuity.movement_reversal");

const sceneTransitionAllowed = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { action: "林舟从左向右奔跑" }),
        shot("s2", 2, { action: "林舟继续向左奔跑", continuity: { exceptions: [{ type: "scene_transition", reason: "明确换场" }] } }),
    ], [group()]),
});
assertNoFinding(sceneTransitionAllowed, "continuity.movement_reversal");

const matchCutAllowed = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { action: "林舟从左向右奔跑" }),
        shot("s2", 2, { action: "林舟继续向左奔跑", continuity: { exceptions: [{ type: "match_cut", reason: "动作匹配剪辑" }] } }),
    ], [group()]),
});
assertNoFinding(matchCutAllowed, "continuity.movement_reversal");

const insufficientDirection = buildContinuityCheck({
    document: doc([
        shot("s1", 1, { action: "两人对峙" }),
        shot("s2", 2, { action: "两人仍在对峙" }),
    ], [group()]),
});
assertNoFinding(insufficientDirection, "continuity.movement_reversal");

// ---------------------------------------------------------------------------
// 4. 人物 / 道具 / 环境状态比较（每条正反例）
// ---------------------------------------------------------------------------
function pairWithContinuity(first: Partial<StudioProductionShot>["continuity"], second: Partial<StudioProductionShot>["continuity"]) {
    return buildContinuityCheck({ document: doc([shot("s1", 1, { continuity: first }), shot("s2", 2, { continuity: second })], [plainGroup]) });
}

const hairstyle = pairWithContinuity({ characters: [{ characterId: "char-a", hairstyle: "短发" }] }, { characters: [{ characterId: "char-a", hairstyle: "长发" }] });
assertFinding(hairstyle, "continuity.character_outfit_change", "warning", ["s1", "s2"]);
const hairstyleExempt = pairWithContinuity({ characters: [{ characterId: "char-a", hairstyle: "短发" }] }, { characters: [{ characterId: "char-a", hairstyle: "长发" }], exceptions: [{ type: "time_jump", reason: "多年后" }] });
assertNoFinding(hairstyleExempt, "continuity.character_outfit_change");

const accessories = pairWithContinuity({ characters: [{ characterId: "char-a", accessories: ["耳环"] }] }, { characters: [{ characterId: "char-a", accessories: ["耳环", "披风"] }] });
assertFinding(accessories, "continuity.character_outfit_change", "suggestion", ["s1", "s2"]);
const accessoriesExempt = pairWithContinuity({ characters: [{ characterId: "char-a", accessories: ["耳环"] }] }, { characters: [{ characterId: "char-a", accessories: [] }], exceptions: [{ type: "costume_change", reason: "换装" }] });
assertNoFinding(accessoriesExempt, "continuity.character_outfit_change");

const weapon = pairWithContinuity({ characters: [{ characterId: "char-a", weaponPropId: "prop-knife" }] }, { characters: [{ characterId: "char-a", weaponPropId: "prop-sword" }] });
assertFinding(weapon, "continuity.character_weapon_change", "warning", ["s1", "s2"]);
const sameWeapon = pairWithContinuity({ characters: [{ characterId: "char-a", weaponPropId: "prop-knife" }] }, { characters: [{ characterId: "char-a", weaponPropId: "prop-knife" }] });
assertNoFinding(sameWeapon, "continuity.character_weapon_change");

const posture = pairWithContinuity({ characters: [{ characterId: "char-a", posture: "站立" }] }, { characters: [{ characterId: "char-a", posture: "蹲下" }] });
assertFinding(posture, "continuity.character_state_change", "suggestion", ["s1", "s2"]);
const postureExempt = pairWithContinuity({ characters: [{ characterId: "char-a", posture: "站立" }] }, { characters: [{ characterId: "char-a", posture: "蹲下" }], exceptions: [{ type: "match_cut", reason: "动作匹配" }] });
assertNoFinding(postureExempt, "continuity.character_state_change");

const emotion = pairWithContinuity({ characters: [{ characterId: "char-a", emotion: "冷静" }] }, { characters: [{ characterId: "char-a", emotion: "愤怒" }] });
assertFinding(emotion, "continuity.character_state_change", "suggestion", ["s1", "s2"]);
const emotionExempt = pairWithContinuity({ characters: [{ characterId: "char-a", emotion: "冷静" }] }, { characters: [{ characterId: "char-a", emotion: "愤怒" }], exceptions: [{ type: "jump_cut", reason: "跳切" }] });
assertNoFinding(emotionExempt, "continuity.character_state_change");

const damaged = pairWithContinuity({ props: [{ propId: "prop-knife", damaged: true }] }, { props: [{ propId: "prop-knife", damaged: false }] });
assertFinding(damaged, "continuity.prop_state_change", "warning", ["s1", "s2"]);
const repaired = pairWithContinuity({ props: [{ propId: "prop-knife", damaged: true }] }, { props: [{ propId: "prop-knife", damaged: false }], exceptions: [{ type: "prop_consume", reason: "更换新刀" }] });
assertNoFinding(repaired, "continuity.prop_state_change");

const dropped = pairWithContinuity({ props: [{ propId: "prop-knife", dropped: true }] }, { props: [{ propId: "prop-knife", dropped: false }] });
assertFinding(dropped, "continuity.prop_state_change", "warning", ["s1", "s2"]);
const droppedPickedUp = pairWithContinuity({ props: [{ propId: "prop-knife", dropped: true }] }, { props: [{ propId: "prop-knife", dropped: false, pickedUp: true }] });
assertNoFinding(droppedPickedUp, "continuity.prop_state_change");

const propState = pairWithContinuity({ props: [{ propId: "prop-knife", state: "出鞘" }] }, { props: [{ propId: "prop-knife", state: "归鞘" }] });
assertFinding(propState, "continuity.prop_state_change", "suggestion", ["s1", "s2"]);
const propStateExempt = pairWithContinuity({ props: [{ propId: "prop-knife", state: "出鞘" }] }, { props: [{ propId: "prop-knife", state: "归鞘" }], exceptions: [{ type: "prop_handoff", reason: "交接后收刀" }] });
assertNoFinding(propStateExempt, "continuity.prop_state_change");

const visibility = pairWithContinuity({ environment: { visibility: "清晰" } }, { environment: { visibility: "浓烟" } });
assertFinding(visibility, "continuity.scene_weather_change", "suggestion", ["s1", "s2"]);
const visibilityExempt = pairWithContinuity({ environment: { visibility: "清晰" } }, { environment: { visibility: "浓烟" }, exceptions: [{ type: "environment_change", reason: "烟尘升起" }] });
assertNoFinding(visibilityExempt, "continuity.scene_weather_change");

// ---------------------------------------------------------------------------
// 5. 异步检查 / 预计算报告复用 / 版本保护
// ---------------------------------------------------------------------------
const asyncDoc = doc([shot("s1", 1), shot("s2", 2), shot("s3", 3)], [group()], 4);
let doneProgressCount = 0;
const asyncReport = await runContinuityCheckAsync({ document: asyncDoc, scope: { type: "episode" }, batchSize: 1, onProgress: (progress) => { if (progress.phase === "done") doneProgressCount += 1; } });
assert.equal(asyncReport.cancelled, false);
assert.equal(doneProgressCount, 1);
assert.equal(asyncReport.report.checkedPairs, 2);
assert.equal(asyncReport.report.storyboardVersion, 4);
assert.equal(asyncReport.report.episodeId, "ep-1");
assert.deepEqual(asyncReport.report.scope, { type: "episode" });
assert.ok(asyncReport.report.checkId.length > 0);

const syncSame = buildContinuityCheck({ document: asyncDoc });
assert.equal(syncSame.checkId, asyncReport.report.checkId, "async/sync same document should have stable checkId");

const baseReview = createEmptyStoryboardReview("ep-1", 4, now);
const precomputed = buildAllStoryboardReviewIssues({ document: asyncDoc, review: baseReview, continuity: asyncReport.report, now });
assert.equal(precomputed.continuity, asyncReport.report, "buildAll must return the same precomputed report instance");
assert.equal(precomputed.continuity.checkId, asyncReport.report.checkId, "buildAll must reuse precomputed report");
assert.equal(precomputed.continuity.storyboardVersion, 4);

const firstPlan = planStoryboardReviewRefresh({ document: asyncDoc, review: baseReview, continuity: asyncReport.report, now });
assert.equal(firstPlan.storyboardVersion, 4);
assert.equal(firstPlan.continuityRuns?.length, 1);
assert.equal(firstPlan.continuityRuns?.[0].id, `continuity-run-${asyncReport.report.checkId}`);
assert.equal(firstPlan.readiness.checkedAt, now);
const secondPlan = planStoryboardReviewRefresh({ document: asyncDoc, review: firstPlan, continuity: asyncReport.report, now });
assert.equal(secondPlan.continuityRuns?.length, 1, "same checkId must not create duplicate review history");
assert.equal(secondPlan.continuityRuns?.[0].id, firstPlan.continuityRuns?.[0].id);

assert.throws(() => buildAllStoryboardReviewIssues({ document: asyncDoc, continuity: { ...asyncReport.report, storyboardVersion: 3 }, now }), /v3.*v4/);
assert.throws(() => buildAllStoryboardReviewIssues({ document: asyncDoc, continuity: { ...asyncReport.report, episodeId: "ep-2" }, now }), /分集/);
assert.throws(() => buildAllStoryboardReviewIssues({ document: asyncDoc, scope: { type: "shot", id: "s1" }, continuity: asyncReport.report, now }), /范围/);
assert.throws(() => planStoryboardReviewRefresh({ document: asyncDoc, continuity: { ...asyncReport.report, storyboardVersion: 3 }, now }), /v3.*v4/);

const aborted = new AbortController();
aborted.abort();
const cancelled = await runContinuityCheckAsync({ document: asyncDoc, signal: aborted.signal });
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.report.checkedPairs, 0);
assert.deepEqual(cancelled.report.findings, []);
assert.deepEqual(cancelled.report.gaps, []);

const beforeAsyncJson = JSON.stringify(asyncDoc);
planStoryboardReviewRefresh({ document: asyncDoc, review: baseReview, continuity: asyncReport.report, now });
assert.equal(JSON.stringify(asyncDoc), beforeAsyncJson, "formal storyboard must not be mutated");

// 旧问题在重查后 stale；范围外旧问题保留。
const staleDoc = doc([shot("s1", 1, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "left" }, { characterId: "char-b", screenSide: "right" }] } } }), shot("s2", 2, { continuity: { space: { characters: [{ characterId: "char-a", screenSide: "right" }, { characterId: "char-b", screenSide: "left" }] } } })], [group()], 3);
const staleBase = buildAllStoryboardReviewIssues({ document: staleDoc, review: createEmptyStoryboardReview("ep-1", 3, now), now });
const staleReview = normalizeStoryboardReview({ ...createEmptyStoryboardReview("ep-1", 3, now), issues: staleBase.issues });
const fixedDoc = doc([shot("s1", 1), shot("s2", 2)], [group()], 4);
const fixedReport = buildContinuityCheck({ document: fixedDoc });
const fixedPlan = planStoryboardReviewRefresh({ document: fixedDoc, review: staleReview, continuity: fixedReport, now });
const oldContinuityIssue = staleBase.issues.find((issue) => issue.ruleId === "continuity.position_jump");
assert.ok(oldContinuityIssue, "old continuity issue exists");
const keptIssue = fixedPlan.issues?.find((issue) => issue.id === oldContinuityIssue.id);
assert.ok(keptIssue, "old issue must be kept");
assert.equal(keptIssue?.continuityStale, true, "old issue should be stale");
assert.equal(fixedPlan.issues?.filter((issue) => issue.id === oldContinuityIssue.id).length, 1, "no duplicate old issue");

// ---------------------------------------------------------------------------
// 6. 快照丢弃事务保护（9 组）
// ---------------------------------------------------------------------------
function createStore(initial: StudioProject) {
    let raw = serializeStudioEnvelope({ version: 1, state: { projects: [initial] } });
    const store: StudioStateStore = {
        async transact<T>(plan: (currentRaw: string | null) => { nextRaw?: string; result: T; verify?: (readBack: string | null, expectedRaw: string) => void }): Promise<T> {
            const result = plan(raw);
            if (result.nextRaw !== undefined) {
                const previousRaw = raw;
                raw = result.nextRaw;
                try {
                    result.verify?.(raw, result.nextRaw);
                } catch (error) {
                    raw = previousRaw;
                    throw error;
                }
            }
            return result.result;
        },
        async readRaw() {
            return raw;
        },
    };
    return { store, raw: () => raw };
}

function snapshotFixture() {
    const storyboard = doc([shot("s1", 1)], [group()], 14);
    const formal: StudioStoryboardVersion = {
        id: "ver-formal",
        snapshotId: "snap-formal",
        version: 14,
        basedOnVersion: 14,
        snapshotType: "formal",
        reason: "正式版本",
        createdAt: now,
        document: storyboard,
    };
    const backup: StudioStoryboardVersion = {
        id: "ver-backup",
        snapshotId: "snap-backup",
        version: 14,
        basedOnVersion: 13,
        snapshotType: "backup",
        reason: "应用前备份",
        createdAt: now,
        document: storyboard,
    };
    const conflict: StudioStoryboardVersion = {
        id: "ver-conflict",
        snapshotId: "snap-conflict",
        version: 14,
        basedOnVersion: 14,
        snapshotType: "conflict",
        reason: "并发冲突",
        createdAt: now,
        document: storyboard,
    };
    const episode = {
        id: "ep-1",
        updatedAt: "episode-updated",
        production: {
            storyboard,
            storyboardVersions: [formal, backup, conflict],
            updatedAt: "production-updated",
        },
    };
    const project = {
        id: "proj-1",
        updatedAt: "project-updated",
        episodes: [episode],
    } as unknown as StudioProject;
    return { project, storyboard, formal, backup, conflict };
}

const fixture = snapshotFixture();
const base = { projectId: "proj-1", episodeId: "ep-1", expectedProjectUpdatedAt: "project-updated", expectedEpisodeUpdatedAt: "episode-updated" };

// 6.1 正式快照仍不能丢弃。
{
    const { store, raw } = createStore(fixture.project);
    const beforeRaw = raw();
    const result = await commitStoryboardSnapshotDiscard({ ...base, snapshotId: "snap-formal", store });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /正式快照不能丢弃/);
    assert.equal(raw(), beforeRaw, "formal snapshot rejection must not write");
}

// 6.2 快照不存在拒绝。
{
    const { store } = createStore(fixture.project);
    const result = await commitStoryboardSnapshotDiscard({ ...base, snapshotId: "snap-missing", store });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /快照不存在/);
}

// 6.3 项目版本冲突拒绝。
{
    const { store } = createStore(fixture.project);
    const result = await commitStoryboardSnapshotDiscard({ ...base, expectedProjectUpdatedAt: "stale-project", snapshotId: "snap-backup", store });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /项目已被其他操作更新/);
}

// 6.4 分集版本冲突拒绝。
{
    const { store } = createStore(fixture.project);
    const result = await commitStoryboardSnapshotDiscard({ ...base, expectedEpisodeUpdatedAt: "stale-episode", snapshotId: "snap-backup", store });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /分集已被其他操作更新/);
}

// 6.5 backup 正常丢弃；正式快照、正式版本不变。
{
    const { store, raw } = createStore(fixture.project);
    const result = await commitStoryboardSnapshotDiscard({ ...base, snapshotId: "snap-backup", store });
    assert.equal(result.ok, true);
    assert.ok(result.projects);
    const saved = parseStudioEnvelope(raw())?.state?.projects?.[0] as StudioProject;
    const savedEpisode = saved.episodes.find((item) => item.id === "ep-1")!;
    const savedVersions = savedEpisode.production!.storyboardVersions!;
    assert.equal(savedVersions.some((item) => item.snapshotId === "snap-backup"), false);
    assert.equal(savedVersions.some((item) => item.snapshotId === "snap-formal"), true);
    assert.equal(savedEpisode.production!.storyboard!.storyboardVersion, 14);
}

// 6.6 conflict 正常丢弃。
{
    const { store } = createStore(fixture.project);
    const result = await commitStoryboardSnapshotDiscard({ ...base, snapshotId: "snap-conflict", store });
    assert.equal(result.ok, true);
}

// 6.7 第二次丢弃同一快照拒绝，不产生重复写。
{
    const { store, raw } = createStore(fixture.project);
    assert.equal((await commitStoryboardSnapshotDiscard({ ...base, snapshotId: "snap-backup", store })).ok, true);
    const firstRaw = raw();
    const saved = parseStudioEnvelope(firstRaw)?.state?.projects?.[0] as StudioProject;
    const savedEpisode = saved.episodes[0];
    const again = await commitStoryboardSnapshotDiscard({
        projectId: "proj-1",
        episodeId: "ep-1",
        snapshotId: "snap-backup",
        expectedProjectUpdatedAt: saved.updatedAt,
        expectedEpisodeUpdatedAt: savedEpisode.updatedAt,
        store,
    });
    assert.equal(again.ok, false);
    assert.match(again.error ?? "", /快照不存在/);
    assert.equal(raw(), firstRaw);
}

// 6.8 刷新后仍只有正式 + 剩余备份，备份结果已持久化。
{
    const { store, raw } = createStore(fixture.project);
    await commitStoryboardSnapshotDiscard({ ...base, snapshotId: "snap-conflict", store });
    const saved = parseStudioEnvelope(raw())?.state?.projects?.[0] as StudioProject;
    const savedVersions = saved.episodes[0].production!.storyboardVersions!;
    assert.deepEqual(savedVersions.map((item) => item.snapshotType).sort(), ["backup", "formal"]);
    assert.deepEqual(savedVersions.filter((item) => item.snapshotType === "formal").map((item) => item.snapshotId), ["snap-formal"]);
}

// 6.9 正式分镜内容与版本不变。
{
    const { store, raw } = createStore(fixture.project);
    const beforeStoryboard = JSON.stringify((parseStudioEnvelope(raw())?.state?.projects?.[0] as StudioProject).episodes[0].production!.storyboard);
    await commitStoryboardSnapshotDiscard({ ...base, snapshotId: "snap-backup", store });
    const afterStoryboard = JSON.stringify((parseStudioEnvelope(raw())?.state?.projects?.[0] as StudioProject).episodes[0].production!.storyboard);
    assert.equal(afterStoryboard, beforeStoryboard);
}

// 规则总数必须与 4C.1 声明一致。
assert.equal(STUDIO_CONTINUITY_RULES.length, 19);
assert.equal(new Set(STUDIO_CONTINUITY_RULES.map((rule) => rule.id)).size, 19);

console.log("stage4c1-core-check: 11 identity groups, 32 action-phase cases + 8 assertions, 15 direction texts + 9 engine cases, 18 state cases (9 pairs), 12 async groups, 9 snapshot groups passed");
