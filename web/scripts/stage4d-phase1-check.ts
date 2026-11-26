// Stage 4D 第一阶段验收：Prompt 覆盖范围、证据四分类、unknown 不可应用、
// 空证据不补事实、旧 pending 自动 conflict 且重复归一化不重复写应用记录。
// 不调用真实模型；使用本地 JSON 文本模拟模型输出。

import assert from "node:assert/strict";

import type { StudioProject } from "../src/types/studio";
import type {
    StudioAiAdjustmentProposal,
    StudioAiProposalChange,
    StudioContinuityCheckReport,
    StudioProductionShot,
    StudioScriptDocument,
    StudioShotGroup,
    StudioStoryboardDocument,
    StudioStoryboardReview,
} from "../src/types/studio-production";
import { createEmptyStoryboardReview, normalizeStoryboardReview } from "../src/lib/studio/review-engine";
import { proposalChangeEvidenceError, validateProposalChange } from "../src/lib/studio/stage4d-engine";
import { buildStoryboardReviewEvidenceCorpus, buildStoryboardReviewPrompt, parseStoryboardAiReview } from "../src/lib/studio/review-ai";

const now = "2026-11-26T12:00:00.000Z";

function group(): StudioShotGroup {
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
        weather: "雨",
        continuityRules: [],
        shotIds: ["s1", "s2"],
        reviewedByUser: false,
        createdAt: now,
        updatedAt: now,
    };
}

function shot(shotId: string, number: number): StudioProductionShot {
    return {
        shotId,
        episodeId: "ep-1",
        sceneId: "sc-1",
        shotGroupId: "grp-1",
        shotNumber: number,
        duration: 5,
        shotSize: "中景",
        cameraPosition: "轴线左侧",
        cameraAngle: "平视",
        lens: "35mm",
        cameraMovement: "固定",
        composition: "双人左右站位",
        foreground: "雨",
        midground: "两人",
        background: "仓库",
        characterBlocking: "林舟在左，沈砚在右",
        eyeline: "对视",
        action: "两人对峙",
        facialExpression: "紧绷",
        emotion: "警觉",
        dialogue: [],
        voiceOver: "",
        soundEffects: "雨声",
        backgroundMusic: "",
        lighting: "冷光",
        environment: "夜雨码头",
        continuityRules: [],
        characterBindings: [{ characterId: "char-a", name: "林舟", outfitId: "outfit-a" }],
        outfitBindings: [{ characterId: "char-a", outfitId: "outfit-a", description: "黑色雨衣" }],
        sceneBindings: { locationId: "loc-dock", locationVariantId: "variant-night" },
        propBindings: [{ propId: "prop-knife", name: "短刀", state: "出鞘" }],
        sourceReferences: {} as never,
        sourceScriptSceneId: "sc-1",
        imagePrompt: "夜雨码头，两人对峙",
        videoPrompt: "固定镜头，两人对峙",
        keyframeRefs: [],
        status: "draft",
        version: 1,
        locked: false,
        createdAt: now,
        updatedAt: now,
    };
}

function document(version = 3): StudioStoryboardDocument {
    return {
        id: "sb-1",
        episodeId: "ep-1",
        episodeNumber: 1,
        sourceScriptId: "script-1",
        sourceScriptVersion: 2,
        sourceEpisodePlanId: "plan-1",
        sourceBlueprintVersion: 1,
        sourceHandoffId: "handoff-1",
        storyboardVersion: version,
        status: "draft",
        groups: [group()],
        shots: [shot("s1", 1), shot("s2", 2)],
        checks: [],
        sourceSceneVersions: { "sc-1": 2 },
        createdAt: now,
        updatedAt: now,
    };
}

function script(): StudioScriptDocument {
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
        scenes: [{
            sceneId: "sc-1", sceneNumber: 1, sceneTitle: "码头对峙", locationId: "loc-dock", locationVariantId: "variant-night",
            timeOfDay: "夜", weather: "雨", environment: "夜雨码头", charactersPresent: ["char-a"],
            props: [], scenePurpose: "建立对峙", conflict: "两人对峙", action: "两人对峙", dialogueBlocks: [],
            transitionIn: "淡入", transitionOut: "切出", continuityNotes: "",
            summary: "两人在码头对峙。", content: "林舟与沈砚在夜雨码头对峙。", dialogue: [], sourceText: "林舟与沈砚在夜雨码头对峙。",
            characterIds: ["char-a"], locationIds: ["loc-dock"], propIds: [], manualEdited: false,
        }],
        characterBindings: [{ characterId: "char-a", name: "林舟", role: "主角", costume: "", look: "", sceneIds: ["sc-1"] }],
        locationBindings: [],
        propBindings: [],
        sourceReferences: {} as StudioScriptDocument["sourceReferences"],
        continuityDependencies: [],
        adaptationChanges: [],
        createdAt: now,
        updatedAt: now,
    };
}

function continuity(): StudioContinuityCheckReport {
    return {
        checkId: "check-1",
        scope: { type: "episode" },
        checkedPairs: 1,
        findings: [],
        gaps: [],
        counts: { error: 0, warning: 0, suggestion: 0 },
        createdAt: now,
        updatedAt: now,
    } as unknown as StudioContinuityCheckReport;
}

function project(): StudioProject {
    return { id: "proj-1", title: "雾港夜航", assets: [], episodes: [], updatedAt: now } as unknown as StudioProject;
}

function proposal(version = 3): StudioAiAdjustmentProposal {
    const change: StudioAiProposalChange = {
        changeId: "change-1",
        shotId: "s1",
        fieldPath: "action",
        fieldLabel: "动作",
        before: "两人对峙",
        after: "两人同时拔刀对峙",
        reason: "让动作有明确阶段",
        impact: "仅影响当前镜头动作",
        evidence: "两人对峙",
        evidenceType: "explicit",
        confidence: "high",
        speculative: false,
        sourceShotIds: ["s1"],
        sourceChapterId: "ch-1",
        sourceVersion: "script-v2",
    };
    return {
        proposalId: "proposal-1",
        runId: "run-1",
        projectId: "proj-1",
        episodeId: "ep-1",
        episodeNumber: 1,
        storyboardVersion: version,
        sourceScriptVersion: 2,
        sourceScriptId: "script-1",
        title: "动作补全",
        rationale: "补足动作阶段",
        confidence: "high",
        changes: [change],
        decision: { status: "pending", acceptedChangeIds: [], rejectedChangeIds: [] },
        createdAt: now,
        updatedAt: now,
    };
}

// 1. Prompt 覆盖景别 / 机位 / 运镜 / 外观 / 服装 / 变体，并携带绑定上下文。
{
    const doc = document();
    const prompt = buildStoryboardReviewPrompt({
        project: project(),
        document: doc,
        script: script(),
        shots: doc.shots,
        scopeType: "episode",
        continuity: continuity(),
    });
    for (const phrase of ["景别合理性", "机位", "运镜与动作/空间匹配", "运镜连续性", "角色外观一致性", "服装连续性", "服装变体与场景/时间/状态匹配"]) {
        assert.equal(prompt.system.includes(phrase), true, `Prompt 缺检查项：${phrase}`);
    }
    assert.equal(prompt.system.includes("unknown"), true);
    assert.equal(prompt.system.includes("独立 evidence"), true);
    assert.equal(prompt.user.includes("outfitBindings"), true, "实际模型输入必须携带服装绑定");
    assert.equal(prompt.user.includes("sceneBindings"), true, "实际模型输入必须携带场景绑定");
}

// 2. 证据四分类：explicit / inference / suggestion / unknown；空证据不得补成事实。
{
    const parsed = parseStoryboardAiReview({
        runId: "run-1",
        projectId: "proj-1",
        text: JSON.stringify({
            summary: "证据分类",
            findings: [                { level: "warning", category: "动作", message: "动作有断层", shotIds: ["s1"], evidence: "两人对峙", evidenceType: "shot_text", confidence: "high" },
                { level: "warning", category: "场景", message: "场景有夜雨", shotIds: ["s1"], evidence: "夜雨码头", evidenceType: "script_text", confidence: "high" },
                { level: "suggestion", category: "对白", message: "建议", shotIds: ["s1"], evidence: "模型建议加停顿", evidenceType: "suggestion", confidence: "low" },
                { level: "warning", category: "其他", message: "推断", shotIds: ["s1"], evidence: "可能是镜头太慢", evidenceType: "inference", confidence: "low" },
                { level: "warning", category: "其他", message: "没有证据", shotIds: ["s1"], evidence: "", evidenceType: "inference", confidence: "low" },
                { level: "warning", category: "其他", message: "证据不足", shotIds: ["s1"], evidence: "无法判断", evidenceType: "unknown", confidence: "low" },
            ],
            proposals: [{
                title: "动作补全",
                rationale: "补足动作阶段",
                confidence: "high",
                changes: [
                    { shotId: "s1", fieldPath: "action", before: "两人对峙", after: "两人同时拔刀对峙", reason: "补阶段", impact: "当前镜头", evidence: "两人对峙", evidenceType: "explicit", confidence: "high", sourceShotIds: ["s1"], sourceChapterId: "ch-1", sourceVersion: "v2" },
                    { shotId: "s1", fieldPath: "emotion", before: "警觉", after: "紧张", reason: "情绪升级", impact: "当前镜头", evidence: "", evidenceType: "unknown", confidence: "low" },
                    { shotId: "s1", fieldPath: "facialExpression", before: "紧绷", after: "惊愕", reason: "表情变化", impact: "当前镜头", evidence: "不存在的证据", evidenceType: "explicit", confidence: "low" },
                ],
            }],
        }),
        document: document(),
        script: script(),
        scopeType: "episode",
        scopeShotIds: ["s1", "s2"],
        allowedFindingShotIds: ["s1", "s2"],
        allowedProposalShotIds: ["s1"],
        continuity: continuity(),
    });
    assert.equal(parsed.findings[0].evidenceType, "explicit");
    assert.equal(parsed.findings[1].evidenceType, "explicit");
    assert.equal(parsed.findings[2].evidenceType, "suggestion");
    assert.equal(parsed.findings[3].evidenceType, "inference");
    assert.equal(parsed.findings[3].speculative, true);
    assert.equal(parsed.findings[4].evidenceType, "unknown", "空证据不得补成 inference");
    assert.equal(parsed.findings[4].speculative, true);
    assert.equal(parsed.findings[4].reason.includes("unknown"), true);
    assert.equal(parsed.findings[5].evidenceType, "unknown");

    const changes = parsed.proposals[0].changes;
    assert.equal(parsed.proposals[0].projectId, "proj-1");
    assert.equal(parsed.proposals[0].episodeNumber, 1);
    assert.equal(changes[0].evidence, "两人对峙");
    assert.equal(changes[0].evidenceType, "explicit");
    assert.equal(changes[0].confidence, "high");
    assert.deepEqual(changes[0].sourceShotIds, ["s1"]);
    assert.equal(changes[0].sourceChapterId, "ch-1");
    assert.equal(changes[0].sourceVersion, "v2");
    assert.equal(changes[1].evidenceType, "unknown");
    assert.equal(proposalChangeEvidenceError(changes[1])?.includes("unknown"), true);
    assert.equal(changes[2].evidenceType, "inference", "声称 explicit 但输入中找不到，必须降级");
    assert.equal(changes[2].speculative, true);
    const shot1 = document().shots[0];
    assert.equal(validateProposalChange(shot1, changes[1]).ok, false, "unknown 修改项必须阻断");
    assert.equal(validateProposalChange(shot1, changes[0]).ok, true);
}

// 3. 旧 pending 提案在正式版本变化后自动 conflict；归一化重复执行不重复写应用记录。
{
    const review = createEmptyStoryboardReview("ep-1", 3, now, { projectId: "proj-1", episodeNumber: 1 });
    review.proposals = [proposal(3)];
    const oldChange = { ...review.proposals[0].changes[0], evidence: "", evidenceType: "unknown" as const };
    review.proposals[0].changes = [oldChange];
    const docV4 = document(4);
    const normalized = normalizeStoryboardReview(review, docV4, now)!;
    assert.equal(normalized.proposals?.[0].decision.status, "conflict");
    assert.equal(normalized.proposals?.[0].decision.acceptedChangeIds.length, 0);
    assert.deepEqual(normalized.proposals?.[0].decision.rejectedChangeIds, ["change-1"]);
    assert.equal(normalized.proposals?.[0].decision.autoConflict, true);
    assert.equal(normalized.proposals?.[0].decision.decidedBy, "system:version-guard");
    assert.equal(normalized.proposalApplications?.filter((item) => item.proposalId === "proposal-1" && item.status === "conflict").length, 1);
    assert.equal(normalized.proposals?.[0].changes[0].evidenceType, "unknown", "旧提案缺证据不得被补成事实");
    assert.equal(proposalChangeEvidenceError(normalized.proposals![0].changes[0])?.includes("unknown"), true);

    const again = normalizeStoryboardReview(normalized, docV4, now)!;
    assert.equal(again.proposals?.[0].decision.status, "conflict", "刷新/重开不能恢复 pending");
    assert.equal(again.proposalApplications?.filter((item) => item.proposalId === "proposal-1" && item.status === "conflict").length, 1, "重复归一化不得重复记录冲突");
}

// 4. 证据范围：实际发送镜头 + 相邻上下文只进入 corpus；未发送场景证据不得被当作 explicit。
{
    const doc = document();
    const corpus = buildStoryboardReviewEvidenceCorpus({
        document: doc,
        script: script(),
        scopeType: "shot",
        scopeShotIds: ["s1"],
        shotIds: ["s1", "s2"],
        continuity: continuity(),
    });
    assert.equal(corpus.shot_text.includes("两人对峙"), true);
    assert.equal(corpus.script_text.includes("夜雨码头"), true);
    const parsed = parseStoryboardAiReview({
        runId: "run-scope",
        text: JSON.stringify({ findings: [{ level: "warning", category: "场景", message: "未发送", evidence: "地下仓库", evidenceType: "script_text" }], proposals: [] }),
        document: doc,
        script: script(),
        scopeType: "shot",
        scopeShotIds: ["s1"],
        allowedFindingShotIds: ["s1", "s2"],
        allowedProposalShotIds: ["s1"],
        continuity: continuity(),
    });
    assert.equal(parsed.findings[0].evidenceType, "inference", "未实际发送的证据必须降级");
}

console.log("stage4d-phase1-check: prompt/evidence/unknown/auto-conflict 4 groups passed");
