// Stage 4D 确定性测试：4C.1 四项 P1 回归 + AI 审核解析 + 提案局部应用 + 审核持久化事务。
// 仅覆盖不依赖真实模型 / 真实浏览器的逻辑；真实 IndexedDB、真实模型与真实浏览器验收不在此处冒充。

import assert from "node:assert/strict";

// Node 测试没有浏览器 localStorage；只给模块初始化提供内存实现，不改变任何持久化断言。
const memoryStorage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => { memoryStorage.set(key, String(value)); },
    removeItem: (key) => { memoryStorage.delete(key); },
    clear: () => { memoryStorage.clear(); },
    key: (index) => [...memoryStorage.keys()][index] ?? null,
    get length() { return memoryStorage.size; },
} as Storage;

const { buildContinuityCheck, parseActionPhase, parseDirection } = await import("../src/lib/studio/continuity-engine");
const { createEmptyStoryboardReview, normalizeStoryboardReview } = await import("../src/lib/studio/review-engine");
const {
    fieldLabel,
    normalizeProposalFieldPath,
    planProposalChanges,
    proposalDependencyError,
    shotFieldProtection,
    validateProposalChange,
} = await import("../src/lib/studio/stage4d-engine");
const { buildStoryboardReviewEvidenceCorpus, buildStoryboardReviewPrompt, parseStoryboardAiReview } = await import("../src/lib/studio/review-ai");
const { commitReviewState } = await import("../src/lib/studio/review-persistence");
const {
    parseStudioEnvelope,
    serializeStudioEnvelope,
    storyboardNarrativeHash,
} = await import("../src/lib/studio-store-persistence");
import type { StudioStateStore } from "../src/lib/studio-store-persistence";
import type { StudioProject } from "../src/types/studio";
import type {
    StudioAiAdjustmentProposal,
    StudioAiProposalChange,
    StudioEpisodeProduction,
    StudioProductionShot,
    StudioScriptDocument,
    StudioShotGroup,
    StudioStoryboardDocument,
    StudioStoryboardReview,
} from "../src/types/studio-production";

const now = "2026-11-25T11:00:00.000Z";

function group(overrides: Partial<StudioShotGroup> = {}): StudioShotGroup {
    return {
        shotGroupId: "grp-1",
        episodeId: "ep-1",
        sceneId: "sc-1",
        groupNumber: 1,
        sceneTitle: "码头对峙",
        sharedLayout: "双人中景",
        characterStartPositions: [],
        cameraAxis: "A-B 轴线",
        propStates: "",
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
        scenes: [{ sceneId: "sc-1", sceneNumber: 1, sceneTitle: "码头对峙", locationId: "loc-dock", timeOfDay: "夜", weather: "雨", summary: "两人在码头对峙。", content: "林舟与沈砚在夜雨码头对峙。", dialogue: [], sourceText: "林舟与沈砚在夜雨码头对峙。", characterIds: ["char-a", "char-b"], locationIds: ["loc-dock"], propIds: [], manualEdited: false }],
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

function reviewFixture(): StudioStoryboardReview {
    return createEmptyStoryboardReview("ep-1", 3, now);
}

function productionFixture(storyboard = doc([shot("s1", 1)], [group()])): StudioEpisodeProduction {
    return {
        id: "prod-1",
        episodeId: "ep-1",
        storyboard,
        storyboardReview: reviewFixture(),
        script: scriptDocument([{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "沈砚" }]),
    } as unknown as StudioEpisodeProduction;
}

function projectFixture(storyboard = doc([shot("s1", 1)], [group()])): StudioProject {
    return {
        id: "proj-1",
        title: "雾港夜航",
        episodes: [{ id: "ep-1", title: "第一集", updatedAt: "ep-updated", production: productionFixture(storyboard) }],
        updatedAt: "proj-updated",
    } as unknown as StudioProject;
}

function gapReport(shots: StudioProductionShot[], names: Array<{ characterId: string; name: string }>) {
    return buildContinuityCheck({
        document: doc(shots, [group()]),
        script: scriptDocument(names),
    });
}

// ---------------------------------------------------------------------------
// 1. P1：人物绑定遗漏：必须覆盖同一镜头内所有确认出现的人物
// ---------------------------------------------------------------------------
{
    const partial = gapReport([shot("s1", 1, { action: "林舟在左，沈砚在右", characterBindings: [{ characterId: "char-a", name: "林舟" }] })], [
        { characterId: "char-a", name: "林舟" },
        { characterId: "char-b", name: "沈砚" },
    ]);
    const identityGaps = partial.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict");
    assert.equal(identityGaps.length, 1, "已绑定一人不能吞掉另一人的漏绑");
    assert.match(identityGaps[0].reason, /沈砚/);
    assert.doesNotMatch(identityGaps[0].reason, /林舟/);

    const bothBound = gapReport([shot("s1", 1, {
        action: "林舟与沈砚对峙",
        characterBindings: [
            { characterId: "char-a", name: "林舟" },
            { characterId: "char-b", name: "沈砚" },
        ],
    })], [{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "沈砚" }]);
    assert.equal(bothBound.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict").length, 0, "两人都正确绑定不应产生 gap");

    const threeShots = gapReport([shot("s1", 1, {
        action: "林舟、沈砚、周野同时出现",
        characterBindings: [{ characterId: "char-a", name: "林舟" }],
    })], [
        { characterId: "char-a", name: "林舟" },
        { characterId: "char-b", name: "沈砚" },
        { characterId: "char-c", name: "周野" },
    ]);
    const threeGaps = threeShots.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict");
    assert.equal(threeGaps.length, 2, "同一镜头两个漏绑人物都必须保留");
    assert.match(threeGaps.map((gap) => gap.reason).join("；"), /沈砚/);
    assert.match(threeGaps.map((gap) => gap.reason).join("；"), /周野/);

    const noMention = gapReport([shot("s1", 1, {
        action: "雨水落下",
        characterBlocking: "",
        eyeline: "",
        characterBindings: [],
    })], [
        { characterId: "char-a", name: "林舟" },
        { characterId: "char-b", name: "沈砚" },
        { characterId: "char-c", name: "周野" },
    ]);
    assert.equal(noMention.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict").length, 0, "不能把整集人物注入每个镜头");

    const similar = gapReport([shot("s1", 1, {
        action: "林月从左向右奔跑",
        characterBlocking: "林月独自站在左侧",
        eyeline: "林月看向前方",
        characterBindings: [],
    })], [{ characterId: "char-lin", name: "林" }, { characterId: "char-yue", name: "林月" }]);
    const similarGaps = similar.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict");
    assert.equal(similarGaps.length, 1);
    assert.match(similarGaps[0].reason, /「林月」/);
    assert.doesNotMatch(similarGaps[0].reason, /「林」/);

    // 重名：同名对应两个角色 ID 时，不能把“已绑定一个”当成两个都已完成绑定。
    const duplicateName = gapReport([shot("s1", 1, {
        action: "林舟推门而入",
        characterBindings: [{ characterId: "char-a", name: "林舟" }],
    })], [{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "林舟" }]);
    const duplicateGaps = duplicateName.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict");
    assert.equal(duplicateGaps.length, 1, "同名两个角色 ID 时仍应保留未绑定者的 gap");
    assert.match(duplicateGaps[0].reason, /char-b/);
    assert.doesNotMatch(duplicateGaps[0].reason, /char-a/);

    const duplicateBothBound = gapReport([shot("s1", 1, {
        action: "林舟推门而入",
        characterBindings: [{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "林舟" }],
    })], [{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "林舟" }]);
    assert.equal(duplicateBothBound.gaps.filter((gap) => gap.ruleId === "continuity.character_identity_conflict").length, 0, "同名两个角色都正确绑定时不应产生 gap");
}

// ---------------------------------------------------------------------------
// 2. P1：名称最长匹配 + 多人物动作主体不明确
// ---------------------------------------------------------------------------
{
    const docTwo = doc([shot("s1", 1, {
        action: "林月从左向右奔跑，林在后面",
        characterBindings: [
            { characterId: "char-lin", name: "林" },
            { characterId: "char-yue", name: "林月" },
        ],
    }), shot("s2", 2, {
        action: "林月从右向左奔跑",
        characterBindings: [
            { characterId: "char-lin", name: "林" },
            { characterId: "char-yue", name: "林月" },
        ],
    })], [group()]);
    const longest = buildContinuityCheck({ document: docTwo });
    const movementFindings = longest.findings.filter((finding) => finding.ruleId === "continuity.movement_reversal");
    assert.equal(movementFindings.length, 1, "只应为实际移动的林月记录方向反转");
    assert.match(movementFindings[0].evidence, /林月/);
    assert.doesNotMatch(movementFindings[0].evidence, /林（/);
}

{
    const ambiguous = doc([shot("s1", 1, {
        action: "林和林月同时从左向右奔跑",
        characterBindings: [
            { characterId: "char-lin", name: "林" },
            { characterId: "char-yue", name: "林月" },
        ],
    }), shot("s2", 2, {
        action: "林和林月同时从右向左奔跑",
        characterBindings: [
            { characterId: "char-lin", name: "林" },
            { characterId: "char-yue", name: "林月" },
        ],
    })], [group()]);
    const ambiguousReport = buildContinuityCheck({ document: ambiguous });
    assert.equal(ambiguousReport.findings.filter((finding) => finding.ruleId === "continuity.movement_reversal").length, 0, "多人物动作主体不明确时不得擅自认定执行者");
}

// ---------------------------------------------------------------------------
// 3. P1：动作阶段与方向回归
// ---------------------------------------------------------------------------
{
    assert.equal(parseActionPhase("击中目标"), "contact");
    assert.equal(parseActionPhase("被击中"), "reaction");
    assert.equal(parseActionPhase("受击后踉跄"), "reaction");
    assert.equal(parseActionPhase("闷哼一声"), "reaction");
    assert.equal(parseActionPhase("吃痛后退"), "reaction");
    assert.equal(parseActionPhase("主动后退"), undefined, "主动后退不是受击反应");
    assert.equal(parseActionPhase("普通后退一步"), undefined, "普通后退不是受击反应");
    assert.equal(parseActionPhase("拔刀"), "start");
    assert.equal(parseActionPhase("挥刀劈砍"), "process");
    assert.equal(parseActionPhase("倒地"), "result");

    assert.equal(parseDirection("主动后退"), "backward");
    assert.equal(parseDirection("后退两步"), "backward");
    assert.equal(parseDirection("被击中后踉跄"), "knockback");
    assert.equal(parseDirection("被击退"), "knockback");
    assert.equal(parseDirection("向前一步"), "forward");
}

// ---------------------------------------------------------------------------
// 4. P1：武器保留 / 更换 / 明确消失 / 信息未知
// ---------------------------------------------------------------------------
function weaponDoc(currentWeapon: string | null | undefined, currentAction = "两人对峙") {
    return doc([
        shot("s1", 1, { continuity: { characters: [{ characterId: "char-a", weaponPropId: "prop-sword" }] } }),
        shot("s2", 2, {
            action: currentAction,
            continuity: { characters: [{ characterId: "char-a", ...(currentWeapon === undefined ? {} : { weaponPropId: currentWeapon }) }] },
        }),
    ], [group()]);
}

{
    const retained = buildContinuityCheck({ document: weaponDoc("prop-sword") });
    assert.equal(retained.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0);
    assert.equal(retained.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 0);

    const changed = buildContinuityCheck({ document: weaponDoc("prop-axe") });
    const changedFindings = changed.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change");
    assert.equal(changedFindings.length, 1, "武器 ID 改变应警告");
    assert.match(changedFindings[0].reason, /武器 ID 改变/);

    const explicitEmpty = buildContinuityCheck({ document: weaponDoc(null, "两人对峙") });
    const emptyFindings = explicitEmpty.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change");
    assert.equal(emptyFindings.length, 1, "明确无武器应识别为武器消失");
    assert.match(emptyFindings[0].evidence, /weaponPropId=null/);

    const stowed = buildContinuityCheck({ document: weaponDoc(null, "林舟收剑入鞘") });
    assert.equal(stowed.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0, "有收起动作时不报武器消失");

    const unknown = buildContinuityCheck({ document: weaponDoc(undefined) });
    assert.equal(unknown.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0, "未知不能当成武器消失");
    assert.equal(unknown.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "未知应标为信息不足");

    const noWeaponBefore = doc([
        shot("s1", 1, { continuity: { characters: [{ characterId: "char-a", weaponPropId: null }] } }),
        shot("s2", 2, { continuity: { characters: [{ characterId: "char-a", weaponPropId: "prop-sword" }] } }),
    ], [group()]);
    const appeared = buildContinuityCheck({ document: noWeaponBefore });
    assert.equal(appeared.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0);
    assert.equal(appeared.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "无取得动作时只记信息不足");

    const acquired = (action: string) => buildContinuityCheck({ document: doc([
        shot("s1", 1, { continuity: { characters: [{ characterId: "char-a", weaponPropId: null }] } }),
        shot("s2", 2, { action, continuity: { characters: [{ characterId: "char-a", weaponPropId: "prop-sword" }] } }),
    ], [group()]) });
    for (const action of ["林舟拔刀", "林舟拾起短刀", "林舟接过短刀", "林舟召出长剑"]) {
        const result = acquired(action);
        assert.equal(result.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 0, `有取得动作不应报信息不足：${action}`);
        assert.equal(result.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0, `有取得动作不应报武器异常：${action}`);
    }

    const otherCharacterAcquired = acquired("沈砚拾起武器，林舟获得武器绑定");
    assert.equal(otherCharacterAcquired.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "其他人物取得武器不能消除林舟的信息不足");
    assert.equal(otherCharacterAcquired.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0, "其他人物取得武器只保留信息不足，不报武器异常");

    const ordinaryMovement = acquired("林舟举起手臂");
    assert.equal(ordinaryMovement.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "举起手臂不能证明获得武器");
    const clenchedFist = acquired("林舟握紧拳头");
    assert.equal(clenchedFist.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "握紧拳头不能证明获得武器");

    const explicitDraw = acquired("林舟明确拔刀");
    assert.equal(explicitDraw.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 0, "明确拔刀应视为取得动作");

    const ambiguousSubject = acquired("拾起武器");
    assert.equal(ambiguousSubject.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "主体不明确时保留信息不足");

    const ablativeAcquisition = acquired("林舟从沈砚手中接过短刀");
    assert.equal(ablativeAcquisition.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 0, "从其他人物手中接过武器应视为林舟取得");

    const otherCharacterPossessive = acquired("林舟的短刀被沈砚拾起");
    assert.equal(otherCharacterPossessive.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "沈砚取得林舟的短刀不能消除林舟的信息不足");

    const passiveAcquisition = acquired("短刀被林舟拾起");
    assert.equal(passiveAcquisition.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 0, "被动句中的林舟应是取得动作主体");

    const objectBeforeVerb = acquired("林舟将短刀拾起");
    assert.equal(objectBeforeVerb.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 0, "把字句中的武器对象应被识别");

    const noAcquisition = acquired("两人对峙");
    assert.equal(noAcquisition.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0);
    assert.equal(noAcquisition.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "没有取得动作时仍只记信息不足");

    const emptyToUnknown = doc([
        shot("s1", 1, { continuity: { characters: [{ characterId: "char-a", weaponPropId: null }] } }),
        shot("s2", 2, { action: "两人对峙" }),
    ], [group()]);
    const emptyUnknown = buildContinuityCheck({ document: emptyToUnknown });
    assert.equal(emptyUnknown.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0, "明确空手后未记录不能推断武器消失");
    assert.equal(emptyUnknown.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 1, "明确空手后未记录只报信息不足");

    const bothEmpty = doc([
        shot("s1", 1, { continuity: { characters: [{ characterId: "char-a", weaponPropId: null }] } }),
        shot("s2", 2, { continuity: { characters: [{ characterId: "char-a", weaponPropId: null }] } }),
    ], [group()]);
    const both = buildContinuityCheck({ document: bothEmpty });
    assert.equal(both.findings.filter((finding) => finding.ruleId === "continuity.character_weapon_change").length, 0);
    assert.equal(both.gaps.filter((gap) => gap.ruleId === "continuity.character_weapon_change").length, 0);
}

// ---------------------------------------------------------------------------
// 5. Stage 4D：AI 输出解析 / 证据降级 / 提案白名单与人工保护
// ---------------------------------------------------------------------------
{
    const baseDoc = doc([shot("s1", 1), shot("s2", 2)], [group()]);
    const beforeDocJson = JSON.stringify(baseDoc);
    const continuity = buildContinuityCheck({ document: baseDoc, scope: { type: "shot", id: "s1" } });

    const parsed = parseStoryboardAiReview({
        text: JSON.stringify({
            summary: "整体可用，但动作衔接需要补证据。",
            findings: [
                { level: "warning", category: "动作", message: "动作前后缺少衔接", reason: "两人对峙没有后续动作", suggestion: "补一个过渡动作", shotIds: ["s1"], evidence: "两人对峙", evidenceType: "shot_text", confidence: "high" },
                { level: "suggestion", category: "对白", message: "对白情绪可以更明确", reason: "模型推测", suggestion: "人工确认", shotIds: ["s1"], evidence: "原著第三页没有写", evidenceType: "script_text", confidence: "low" },
            ],
            proposals: [
                {
                    title: "补足对峙动作",
                    rationale: "当前动作只有对峙，缺少镜头内变化。",
                    confidence: "medium",
                    changes: [
                        { shotId: "s1", fieldPath: "action", before: "两人对峙", after: "两人同时拔刀对峙", reason: "让动作有明确阶段", impact: "影响当前镜头动作与后续衔接", evidenceType: "inference", speculative: true },
                    ],
                },
                {
                    title: "非法字段提案",
                    changes: [{ shotId: "s1", fieldPath: "characterBindings[0].characterId", before: "char-a", after: "char-x" }],
                },
            ],
        }),
        runId: "run-1",
        document: baseDoc,
        script: scriptDocument([{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "沈砚" }]),
        scopeType: "shot",
        scopeShotIds: ["s1"],
        allowedFindingShotIds: ["s1", "s2"],
        allowedProposalShotIds: ["s1"],
        continuity,
    });
    assert.equal(parsed.findings.length, 2);
    assert.equal(parsed.findings[0].evidenceType, "explicit");
    assert.equal(parsed.findings[0].speculative, false);
    assert.equal(parsed.findings[1].evidenceType, "inference", "找不到的剧本证据必须降级");
    assert.equal(parsed.findings[1].speculative, true);
    assert.match(parsed.findings[1].reason, /证据未在实际输入中找到/);
    assert.equal(parsed.proposals.length, 1, "非法字段提案必须被丢弃");
    assert.equal(parsed.proposals[0].storyboardVersion, 3);
    assert.equal(parsed.proposals[0].sourceScriptVersion, 2);
    assert.equal(parsed.proposals[0].changes[0].fieldPath, "action");
    assert.equal(parsed.proposals[0].changes[0].speculative, true);
    assert.ok(parsed.warnings.some((warning) => warning.includes("字段不在白名单")));
    assert.equal(JSON.stringify(baseDoc), beforeDocJson, "解析不得改正式分镜");
}

// 证据范围必须与实际 Prompt 输入一致：相邻镜头所在剧本场景未必被发送。
{
    const twoSceneScript = scriptDocument([{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "沈砚" }]);
    const baseScene = twoSceneScript.scenes[0];
    twoSceneScript.scenes.push({
        ...baseScene,
        sceneId: "sc-2",
        sceneNumber: 2,
        sceneTitle: "地下仓库",
        summary: "沈砚进入地下仓库。",
        content: "沈砚独自进入地下仓库，发现密信。",
        sourceText: "沈砚独自进入地下仓库，发现密信。",
        characterIds: ["char-b"],
    });
    const document = doc([
        shot("s1", 1),
        shot("s2", 2, { sceneId: "sc-2", sourceScriptSceneId: "sc-2", action: "沈砚进入仓库" }),
    ], [group()]);
    const continuity = buildContinuityCheck({ document, script: twoSceneScript, scope: { type: "shot", id: "s1" } });
    const parsed = parseStoryboardAiReview({
        text: JSON.stringify({
            summary: "证据范围测试",
            findings: [
                { level: "warning", category: "场景", message: "已发送场景的有效证据", reason: "剧本场景标题已发送", suggestion: "保持", shotIds: ["s1"], evidence: "码头对峙", evidenceType: "script_text" },
                { level: "warning", category: "场景", message: "引用未发送场景", reason: "模型引用未发送内容", suggestion: "人工确认", shotIds: ["s2"], evidence: "地下仓库", evidenceType: "script_text" },
                { level: "warning", category: "动作", message: "镜头文本有效证据", reason: "镜头动作是两人对峙", suggestion: "保持", shotIds: ["s1"], evidence: "两人对峙", evidenceType: "shot_text" },
            ],
            proposals: [],
        }),
        runId: "run-evidence-scope",
        document,
        script: twoSceneScript,
        scopeType: "shot",
        scopeShotIds: ["s1"],
        allowedFindingShotIds: ["s1", "s2"],
        allowedProposalShotIds: ["s1"],
        continuity,
    });
    assert.equal(parsed.findings.length, 3);
    assert.equal(parsed.findings[0].evidenceType, "explicit", "已发送剧本场景的有效证据不能误降级");
    assert.equal(parsed.findings[0].speculative, false);
    assert.equal(parsed.findings[1].evidenceType, "inference", "引用未发送剧本场景必须降级");
    assert.equal(parsed.findings[1].speculative, true);
    assert.match(parsed.findings[1].reason, /证据未在实际输入中找到/);
    assert.equal(parsed.findings[2].evidenceType, "explicit", "已发送镜头文本的有效证据不能误降级");
    assert.equal(parsed.findings[2].speculative, false);
}

// Prompt 与证据库必须使用同一份审核输入视图：单镜 / 选中 / 整集都逐字段比对。
{
    const script = scriptDocument([{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "沈砚" }]);
    const baseScene = script.scenes[0];
    script.scenes.push({
        ...baseScene,
        sceneId: "sc-2",
        sceneNumber: 2,
        sceneTitle: "地下仓库",
        locationId: "loc-warehouse",
        locationVariantId: "variant-dark",
        timeOfDay: "夜",
        environment: "地下仓库",
        charactersPresent: ["char-b"],
        props: [],
        scenePurpose: "发现密信",
        conflict: "沈砚独自行动",
        action: "沈砚进入仓库",
        dialogueBlocks: [],
        transitionIn: "切",
        transitionOut: "切",
        continuityNotes: "",
        summary: "沈砚进入地下仓库。",
        content: "沈砚独自进入地下仓库，发现密信。",
        sourceText: "沈砚独自进入地下仓库，发现密信。",
        characterIds: ["char-b"],
    });
    const document = doc([
        shot("s1", 1),
        shot("s2", 2, { sceneId: "sc-2", sourceScriptSceneId: "sc-2", shotGroupId: "grp-2", action: "沈砚进入仓库" }),
        shot("s3", 3),
    ], [group(), group({ shotGroupId: "grp-2", sceneId: "sc-2", groupNumber: 2 })]);
    const continuity = buildContinuityCheck({ document, script });

    const cases = [
        { scopeType: "shot" as const, selected: ["s2"], context: ["s1", "s3"], expectedSceneIds: ["sc-2"] },
        { scopeType: "selection" as const, selected: ["s1", "s2"], context: ["s3"], expectedSceneIds: ["sc-1", "sc-2"] },
        { scopeType: "episode" as const, selected: ["s1", "s2", "s3"], context: [], expectedSceneIds: ["sc-1", "sc-2"] },
    ];

    for (const item of cases) {
        const selected = document.shots.filter((shotItem) => item.selected.includes(shotItem.shotId));
        const context = document.shots.filter((shotItem) => item.context.includes(shotItem.shotId));
        const allowed = [...new Set([...item.selected, ...item.context])];
        const prompt = buildStoryboardReviewPrompt({
            project: projectFixture(document),
            document,
            script,
            shots: selected,
            contextShots: context,
            scopeType: item.scopeType,
            continuity,
        });
        const corpus = buildStoryboardReviewEvidenceCorpus({
            document,
            script,
            scopeType: item.scopeType,
            scopeShotIds: item.selected,
            shotIds: allowed,
            continuity,
        });

        const section = (title: string, next: string) => {
            const start = prompt.user.indexOf(title);
            const end = prompt.user.indexOf(next, start + title.length);
            assert.ok(start >= 0 && end > start, `Prompt 缺失 ${title}`);
            return JSON.parse(prompt.user.slice(start + title.length, end).trim());
        };
        const promptSelected = section("【选中镜头】\n", "\n\n【相邻镜头（仅用于衔接判断）】");
        const promptContext = section("【相邻镜头（仅用于衔接判断）】\n", "\n\n【相关剧本场景】");
        const promptScenes = section("【相关剧本场景】\n", "\n\n【4C 连续性检查结果】");
        const promptContinuity = section("【4C 连续性检查结果】\n", "\n\n【已有确定性审核问题】");

        assert.deepEqual([...promptSelected, ...promptContext], JSON.parse(corpus.shot_text), `${item.scopeType}: 镜头证据必须与 Prompt 完全一致`);
        assert.deepEqual(promptScenes, JSON.parse(corpus.script_text), `${item.scopeType}: 剧本证据必须与 Prompt 完全一致`);
        assert.deepEqual(promptContinuity, JSON.parse(corpus.continuity_report), `${item.scopeType}: 连续性证据必须与 Prompt 完全一致`);
        assert.deepEqual(promptScenes.map((scene: { sceneId: string }) => scene.sceneId), item.expectedSceneIds, `${item.scopeType}: 只发送选中镜头实际涉及的剧本场景`);
    }
}

{
    const parsedNoShot = parseStoryboardAiReview({
        text: JSON.stringify({ findings: [{ level: "error", category: "镜头衔接", message: "整集节奏问题未给出镜头", evidence: "模型判断", evidenceType: "inference" }], proposals: [] }),
        runId: "run-global-no-shot",
        document: doc([shot("s1", 1), shot("s2", 2)], [group()]),
        scopeType: "episode",
        scopeShotIds: ["s1", "s2"],
        allowedFindingShotIds: ["s1", "s2"],
        allowedProposalShotIds: ["s1", "s2"],
        continuity: buildContinuityCheck({ document: doc([shot("s1", 1), shot("s2", 2)], [group()]) }),
    });
    assert.equal(parsedNoShot.findings.length, 0, "整集审核不得把无镜头问题强行归到第一镜");
    assert.ok(parsedNoShot.warnings.some((warning) => warning.includes("没有对应镜头")));

    const parsedSingleNoShot = parseStoryboardAiReview({
        text: JSON.stringify({ findings: [{ message: "当前镜头问题", evidence: "镜头文本", evidenceType: "shot_text" }], proposals: [] }),
        runId: "run-single-no-shot",
        document: doc([shot("s1", 1)], [group()]),
        scopeType: "shot",
        scopeShotIds: ["s1"],
        allowedFindingShotIds: ["s1"],
        allowedProposalShotIds: ["s1"],
        continuity: buildContinuityCheck({ document: doc([shot("s1", 1)], [group()]), scope: { type: "shot", id: "s1" } }),
    });
    assert.deepEqual(parsedSingleNoShot.findings[0]?.shotIds, ["s1"], "单镜审核可安全归到唯一镜头");
}

{
    const manualDoc = doc([shot("s1", 1, { manualEditedAt: now, manualEditedFields: ["action"] })], [group()]);
    const continuity = buildContinuityCheck({ document: manualDoc, scope: { type: "shot", id: "s1" } });
    const parsed = parseStoryboardAiReview({
        text: JSON.stringify({
            summary: "",
            findings: [],
            proposals: [{ title: "改人工动作", changes: [{ shotId: "s1", fieldPath: "action", before: "两人对峙", after: "两人冲击" }] }],
        }),
        runId: "run-manual",
        document: manualDoc,
        script: scriptDocument([{ characterId: "char-a", name: "林舟" }, { characterId: "char-b", name: "沈砚" }]),
        scopeType: "shot",
        scopeShotIds: ["s1"],
        allowedFindingShotIds: ["s1"],
        allowedProposalShotIds: ["s1"],
        continuity,
    });
    assert.equal(parsed.proposals.length, 0, "人工编辑字段不得生成提案");
    assert.ok(parsed.warnings.some((warning) => warning.includes("人工编辑")));
}

{
    const parsedMismatch = parseStoryboardAiReview({
        text: JSON.stringify({ findings: [], proposals: [{ title: "错 before", changes: [{ shotId: "s1", fieldPath: "action", before: "不存在的值", after: "改后" }] }] }),
        runId: "run-mismatch",
        document: doc([shot("s1", 1)], [group()]),
        scopeType: "shot",
        scopeShotIds: ["s1"],
        allowedFindingShotIds: ["s1"],
        allowedProposalShotIds: ["s1"],
        continuity: buildContinuityCheck({ document: doc([shot("s1", 1)], [group()]), scope: { type: "shot", id: "s1" } }),
    });
    assert.equal(parsedMismatch.proposals.length, 0, "before 不一致的提案不得进入记录");
    assert.ok(parsedMismatch.warnings.some((warning) => warning.includes("before 与当前值不一致")));
}

{
    const strict = parseStoryboardAiReview({
        text: JSON.stringify({ findings: [{ message: "问题", shotIds: ["s3"], evidence: "没有", evidenceType: "continuity_report" }], proposals: [] }),
        runId: "run-outside",
        document: doc([shot("s1", 1), shot("s2", 2), shot("s3", 3)], [group()]),
        scopeType: "selection",
        scopeShotIds: ["s1", "s2"],
        allowedFindingShotIds: ["s1", "s2"],
        allowedProposalShotIds: ["s1", "s2"],
        continuity: buildContinuityCheck({ document: doc([shot("s1", 1), shot("s2", 2), shot("s3", 3)], [group()]), scope: { type: "episode" } }),
    });
    assert.equal(strict.findings.length, 0, "范围外镜头问题不得冒充当前审核");
}

// ---------------------------------------------------------------------------
// 6. 提案局部应用：多提案隔离、整体拒绝、人工 / 锁定保护、版本与依赖
// ---------------------------------------------------------------------------
function change(changeId: string, fieldPath: string, before: string, after: string, shotId = "s1"): StudioAiProposalChange {
    return { changeId, shotId, fieldPath, fieldLabel: fieldLabel(fieldPath), before, after, reason: "测试修改", impact: "仅影响该字段", evidence: "两人对峙", evidenceType: "explicit", confidence: "high", speculative: false };
}

function proposal(changes: StudioAiProposalChange[], overrides: Partial<StudioAiAdjustmentProposal> = {}): StudioAiAdjustmentProposal {
    return {
        proposalId: "prop-1",
        runId: "run-1",
        episodeId: "ep-1",
        storyboardVersion: 3,
        sourceScriptVersion: 2,
        sourceScriptId: "script-1",
        title: "测试提案",
        rationale: "",
        confidence: "high",
        changes,
        decision: { status: "pending", acceptedChangeIds: [], rejectedChangeIds: [] },
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

{
    const base = doc([shot("s1", 1)], [group()]);
    const p = proposal([change("c1", "action", "两人对峙", "两人同时拔刀"), change("c2", "emotion", "警惕", "紧张")]);
    const onlyC1 = planProposalChanges(base, p, ["c1"]);
    assert.equal(onlyC1.ok, true);
    if (onlyC1.ok) {
        assert.equal(onlyC1.applied.length, 1);
        assert.equal(onlyC1.document.shots[0].action, "两人同时拔刀");
        assert.equal(onlyC1.document.shots[0].emotion, "警惕");
    }
    const onlyC2 = planProposalChanges(base, p, ["c2"]);
    assert.equal(onlyC2.ok, true);
    if (onlyC2.ok) {
        assert.equal(onlyC2.document.shots[0].action, "两人对峙");
        assert.equal(onlyC2.document.shots[0].emotion, "紧张");
    }

    const pA = proposal([change("a1", "action", "两人对峙", "两人拔刀")], { proposalId: "p-a" });
    const pB = proposal([change("b1", "emotion", "警惕", "紧张")], { proposalId: "p-b" });
    const afterA = planProposalChanges(base, pA, ["a1"]);
    assert.equal(afterA.ok, true);
    if (afterA.ok) {
        const afterB = planProposalChanges(afterA.document, pB, ["b1"]);
        assert.equal(afterB.ok, true);
        if (afterB.ok) {
            assert.equal(afterB.document.shots[0].action, "两人拔刀");
            assert.equal(afterB.document.shots[0].emotion, "紧张");
        }
    }

    const bad = proposal([change("d1", "action", "两人对峙", "两人拔刀"), change("d2", "action", "错误 before", "两人追逐")]);
    const rejectedAll = planProposalChanges(base, bad, ["d1", "d2"]);
    assert.equal(rejectedAll.ok, false);
    assert.ok("details" in rejectedAll && rejectedAll.details.length > 0);

    const locked = doc([shot("s1", 1, { locked: true })], [group()]);
    assert.equal(planProposalChanges(locked, p, ["c1"]).ok, false, "锁定镜头整体拒绝");
    assert.equal(shotFieldProtection(locked.shots[0], "action"), "镜头已锁定");

    const manual = doc([shot("s1", 1, { manualEditedAt: now, manualEditedFields: ["emotion"] })], [group()]);
    assert.ok(shotFieldProtection(manual.shots[0], "emotion"), "人工编辑字段受保护");
    assert.equal(shotFieldProtection(manual.shots[0], "action"), undefined, "未编辑字段仍可提案");
    assert.equal(planProposalChanges(manual, p, ["c1"]).ok, true);
    assert.equal(planProposalChanges(manual, p, ["c2"]).ok, false);

    const unknown = planProposalChanges(base, p, ["missing"]);
    assert.equal(unknown.ok, false);

    const versionOld = proposal([change("v1", "action", "两人对峙", "两人拔刀")], { storyboardVersion: 2 });
    const versionConflict = planProposalChanges(base, versionOld, ["v1"]);
    assert.equal(versionConflict.ok, false);
    assert.match(versionConflict.error, /v2.*v3/);

    const scriptOld = proposal([change("s1c", "action", "两人对峙", "两人拔刀")], { sourceScriptVersion: 1 });
    const dependency = proposalDependencyError(scriptOld, base, 2);
    assert.match(dependency, /剧本 v1.*v2/);
    assert.equal(planProposalChanges(base, scriptOld, ["s1c"], 2).ok, false);

    const scriptReplaced = proposal([change("s1id", "action", "两人对峙", "两人拔刀")], { sourceScriptId: "script-other" });
    assert.match(proposalDependencyError(scriptReplaced, base, 2) ?? "", /script-other.*script-1/);

    const durationBad = proposal([change("t1", "duration", "5", "16")]);
    assert.equal(planProposalChanges(base, durationBad, ["t1"]).ok, false);
    const durationMin = proposal([change("t2", "duration", "5", "4")]);
    assert.equal(planProposalChanges(base, durationMin, ["t2"]).ok, true);
    const durationMax = proposal([change("t3", "duration", "5", "15")]);
    assert.equal(planProposalChanges(base, durationMax, ["t3"]).ok, true);
}

{
    const base = doc([shot("s1", 1)], [group()]);
    const before = JSON.stringify(base);
    const p = proposal([change("id1", "characterBlocking", "林舟在左，沈砚在右", "林舟在左，沈砚在右但更靠近镜头")]);
    const result = planProposalChanges(base, p, ["id1"]);
    assert.equal(result.ok, true);
    if (result.ok) {
        const next = result.document.shots[0];
        assert.deepEqual(next.characterBindings, base.shots[0].characterBindings, "人物 ID 必须稳定");
        assert.deepEqual(next.sceneBindings, base.shots[0].sceneBindings, "场景 ID 必须稳定");
        assert.deepEqual(next.propBindings, base.shots[0].propBindings, "道具 ID 必须稳定");
        assert.equal(next.shotId, base.shots[0].shotId);
        assert.equal(result.document.storyboardVersion, base.storyboardVersion);
    }
    assert.equal(JSON.stringify(base), before, "纯函数不得改原文档");
}

{
    assert.equal(normalizeProposalFieldPath("shot.action"), "action");
    assert.equal(normalizeProposalFieldPath("dialogue.0.text"), "dialogue[0].text");
    assert.equal(normalizeProposalFieldPath("dialogue[1].emotion"), "dialogue[1].emotion");
    assert.equal(normalizeProposalFieldPath("characterBindings"), undefined);
    assert.equal(fieldLabel("action"), "动作");
}

// ---------------------------------------------------------------------------
// 7. 审核持久化事务：版本冲突、回读失败、锁定允许、叙事内容拒绝
// ---------------------------------------------------------------------------
function createStore(initial: StudioProject, options: { emptyReviewReadBack?: boolean; throwOnTransact?: boolean } = {}) {
    let raw = serializeStudioEnvelope({ version: 1, state: { projects: [initial] } });
    const store: StudioStateStore = {
        async transact<T>(plan: (currentRaw: string | null) => { nextRaw?: string; result: T; verify?: (readBack: string | null, expectedRaw: string) => void }): Promise<T> {
            if (options.throwOnTransact) throw new Error("配额不足：模拟 IndexedDB 写入失败");
            const result = plan(raw);
            if (result.nextRaw !== undefined) {
                const previousRaw = raw;
                raw = result.nextRaw;
                try {
                    if (result.verify) {
                        if (options.emptyReviewReadBack) {
                            const parsed = parseStudioEnvelope(result.nextRaw);
                            const projects = parsed?.state?.projects as StudioProject[] | undefined;
                            if (projects?.[0]?.episodes?.[0]?.production) delete projects[0].episodes[0].production.storyboardReview;
                            result.verify(serializeStudioEnvelope(parsed ?? { version: 1, state: { projects: [] } }), result.nextRaw);
                        } else {
                            result.verify(raw, result.nextRaw);
                        }
                    }
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

{
    const { store, raw } = createStore(projectFixture());
    const beforeRaw = raw();
    const result = await commitReviewState({
        projectId: "proj-1",
        episodeId: "ep-1",
        expectedStoryboardVersion: 3,
        store,
        apply: ({ production, document }) => ({
            ok: true,
            production: { ...production, storyboardReview: { ...production.storyboardReview!, readiness: { ...production.storyboardReview!.readiness, checkedAt: "persisted" } } },
            result: { persisted: true },
            verifySaved: (saved) => {
                if (saved.storyboardReview?.readiness.checkedAt !== "persisted") throw new Error("审核记录未落盘");
            },
        }),
    });
    assert.equal(result.ok, true);
    assert.equal((result.result as { persisted?: boolean } | undefined)?.persisted, true);
    assert.ok(result.projects?.length);
    const saved = parseStudioEnvelope(raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(saved.episodes[0].production?.storyboardReview?.readiness.checkedAt, "persisted");
    assert.notEqual(raw(), beforeRaw);
}

{
    const { store, raw } = createStore(projectFixture());
    const beforeRaw = raw();
    const result = await commitReviewState({
        projectId: "proj-1",
        episodeId: "ep-1",
        expectedStoryboardVersion: 3,
        store,
        apply: ({ production, document }) => ({
            ok: true,
            production: { ...production, storyboard: { ...document, shots: document.shots.map((item) => ({ ...item, locked: true, updatedAt: now })) } },
            result: { persisted: true },
        }),
    });
    assert.equal(result.ok, true, "逐镜锁定属于审核元数据，不应被叙事 hash 拦截");
    const saved = parseStudioEnvelope(raw())?.state?.projects?.[0] as StudioProject;
    assert.equal(saved.episodes[0].production?.storyboard?.shots[0].locked, true);
    assert.equal(saved.episodes[0].production?.storyboard?.storyboardVersion, 3);
}

{
    const { store, raw } = createStore(projectFixture());
    const beforeRaw = raw();
    const result = await commitReviewState({
        projectId: "proj-1",
        episodeId: "ep-1",
        expectedStoryboardVersion: 3,
        store,
        apply: ({ production, document }) => ({
            ok: true,
            production: { ...production, storyboard: { ...document, shots: document.shots.map((item) => ({ ...item, action: "被篡改的动作" })) } },
            result: { persisted: true },
        }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /叙事内容/);
    assert.equal(raw(), beforeRaw, "叙事内容修改必须整体回滚");
}

{
    const { store, raw } = createStore(projectFixture());
    const beforeRaw = raw();
    const result = await commitReviewState({ projectId: "proj-1", episodeId: "ep-1", expectedStoryboardVersion: 2, store, apply: () => ({ ok: false, error: "不应执行" }) });
    assert.equal(result.ok, false);
    assert.equal(result.conflict, true);
    assert.match(result.error, /v3.*v2/);
    assert.equal(raw(), beforeRaw);
}

{
    const { store, raw } = createStore(projectFixture(), { emptyReviewReadBack: true });
    const beforeRaw = raw();
    const result = await commitReviewState({
        projectId: "proj-1",
        episodeId: "ep-1",
        expectedStoryboardVersion: 3,
        store,
        apply: ({ production, document }) => ({
            ok: true,
            production: { ...production, storyboardReview: { ...production.storyboardReview!, readiness: { ...production.storyboardReview!.readiness, checkedAt: "should-rollback" } } },
            result: { persisted: true },
            verifySaved: (saved) => {
                throw new Error("审核记录回读失败");
            },
        }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /回读失败/);
    assert.equal(raw(), beforeRaw, "回读失败必须回滚，不能显示成功");
}

{
    const { store } = createStore(projectFixture(), { throwOnTransact: true });
    const result = await commitReviewState({ projectId: "proj-1", episodeId: "ep-1", expectedStoryboardVersion: 3, store, apply: () => ({ ok: true, production: productionFixture(), result: {} }) });
    assert.equal(result.ok, false);
    assert.equal(result.projects, undefined);
    assert.match(result.error, /配额不足/);
}

{
    const source = projectFixture();
    const review = source.episodes[0].production!.storyboardReview!;
    const value: StudioStoryboardReview = {
        ...review,
        aiReviewRuns: Array.from({ length: 60 }, (_, index) => ({
            runId: `run-${index}`,
            episodeId: "ep-1",
            storyboardVersion: 3,
            scope: { type: "episode", shotIds: ["s1"] },
            continuityCheckId: "check",
            status: "completed",
            summary: "",
            findings: [],
            promptVersion: "v1",
            startedAt: now,
            createdAt: now,
            updatedAt: now,
        })),
        proposals: Array.from({ length: 120 }, (_, index) => proposal([change(`c-${index}`, "action", "两人对峙", "两人拔刀")], { proposalId: `p-${index}` })),
        proposalApplications: Array.from({ length: 60 }, (_, index) => ({
            applicationId: `app-${index}`,
            proposalId: `p-${index}`,
            runId: "run-1",
            status: "applied",
            acceptedChangeIds: [],
            beforeVersion: 3,
            afterVersion: 4,
            persisted: true,
            appliedAt: now,
        })),
    };
    const normalized = normalizeStoryboardReview(value, source.episodes[0].production!.storyboard, now);
    assert.equal(normalized?.aiReviewRuns?.length, 50);
    assert.equal(normalized?.proposals?.length, 100);
    assert.equal(normalized?.proposalApplications?.length, 50);
    assert.equal(normalized?.aiReviewRuns?.[0]?.runId, "run-0", "归一必须保留数组头部的最新审核");
    assert.equal(normalized?.aiReviewRuns?.[49]?.runId, "run-49");
    assert.equal(normalized?.proposals?.[0]?.proposalId, "p-0", "归一必须保留数组头部的最新提案");
    assert.equal(normalized?.proposalApplications?.[0]?.applicationId, "app-0");
}

{
    const before = JSON.stringify(projectFixture().episodes[0].production!.storyboard);
    const baseDoc = doc([shot("s1", 1)], [group()]);
    const hash = storyboardNarrativeHash(baseDoc as unknown as Record<string, unknown>);
    const locked = { ...baseDoc, shots: baseDoc.shots.map((item) => ({ ...item, locked: true })) };
    assert.equal(storyboardNarrativeHash(locked as unknown as Record<string, unknown>), hash, "锁字段不属于叙事内容");
    assert.equal(JSON.stringify(projectFixture().episodes[0].production!.storyboard), before);
}

{
    const base = doc([shot("s1", 1)], [group()]);
    const bad = proposal([change("x", "action", "两人对峙", "两人拔刀")]);
    const validation = validateProposalChange(base.shots[0], bad.changes[0]);
    assert.equal(validation.ok, true);
    assert.equal(planProposalChanges(base, bad, []).ok, false);
}

console.log("stage4d-core-check: 4 P1 regression groups, AI parse groups, proposal isolation/protection groups, persistence groups passed");
