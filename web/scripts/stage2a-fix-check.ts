import assert from "node:assert/strict";

import type { DoubaoAccount } from "../src/services/api/doubao-bridge";
import type { NovelChapter, NovelChapterChunk, StudioNovel } from "../src/types/novel";
import { buildNovelChunks, makeStudioNovel, splitNovelChapters, splitPdfPages } from "../src/lib/studio/novel-chapters";
import { normalizeChapterExtract, normalizeEvidence } from "../src/lib/studio/novel-analysis";
import { finalizeNovelAnalysis, mergeChapterDigests } from "../src/lib/studio/novel-merge";
import { applyProjectBridgeAccount, validateProjectBridgeAccount } from "../src/lib/studio/project-bridge-account";

const source = [
    "第一章 雾港",
    "林舟提灯走进雾港，码头只剩一盏灯。",
    "沈鸢站在旧钟楼下，她把一枚铜钥匙交给林舟。",
    "",
    "第二章 旧钟楼",
    "林舟与沈鸢在旧钟楼下约定，天亮前找回失踪的船。",
    "钟楼管理人说出旧事：十年前也有一艘船没有回来。",
].join("\n");

const split = splitNovelChapters(source, "txt");
assert.equal(split.chapters.length, 2);
const novel: StudioNovel = makeStudioNovel({
    fileHash: "stage2a-fix-check",
    format: "txt",
    name: "fix-check.txt",
    mimeType: "text/plain",
    bytes: source.length,
    encoding: "utf-8",
    preamble: split.preamble,
    chapters: split.chapters,
    warnings: split.warnings,
});
const firstChapter = novel.chapters[0];
const secondChapter = novel.chapters[1];
const chunk0: NovelChapterChunk = { id: "fix-chunk-0", index: 0, chapterIds: [firstChapter.id], text: firstChapter.text, charCount: firstChapter.text.length };

/* ---------- P1 证据校验：有效摘录与真实字符区间 ---------- */
const correct = normalizeEvidence(
    [{ chapterNo: 1, excerpt: "林舟提灯走进雾港", evidenceType: "explicit", confidence: 0.92, sourceLocation: { page: 99, label: "模型伪造页码" } }],
    novel,
);
assert.equal(correct.evidence.length, 1, "正确摘录必须保留");
const correctEvidence = correct.evidence[0];
const localStart = firstChapter.text.indexOf("林舟提灯走进雾港");
assert.ok(localStart >= 0);
assert.equal(correctEvidence.chapterId, firstChapter.id);
assert.equal(correctEvidence.excerpt, "林舟提灯走进雾港");
assert.equal(correctEvidence.sourceLocation.charStart, firstChapter.charStart + localStart, "charStart 必须对应原文真实位置");
assert.equal(correctEvidence.sourceLocation.charEnd, firstChapter.charStart + localStart + 8, "charEnd 必须对应原文真实位置");
assert.equal(correctEvidence.sourceLocation.page, undefined, "模型给的页码不能当成准确原文位置");
assert.equal(correctEvidence.evidenceType, "explicit");

const whitespace = normalizeEvidence([{ chapterNo: 1, excerpt: "  林舟提灯\n\n走进雾港  ", evidenceType: "explicit" }], novel);
assert.equal(whitespace.evidence.length, 1, "仅空格/换行不同的摘录应通过规范化匹配");
assert.equal(whitespace.evidence[0].excerpt, "林舟提灯走进雾港", "保存的必须是原文真实摘录");
assert.equal(whitespace.evidence[0].sourceLocation.charStart, correctEvidence.sourceLocation.charStart);
assert.equal(whitespace.evidence[0].sourceLocation.charEnd, correctEvidence.sourceLocation.charEnd);

const wrong = normalizeEvidence([{ chapterNo: 1, excerpt: "林舟踢开旧钟楼的门", evidenceType: "explicit" }], novel);
assert.equal(wrong.evidence.length, 0, "错误摘录必须丢弃");
assert.ok(wrong.warnings.some((item) => item.includes("未在")));

const empty = normalizeEvidence([{ chapterNo: 1, excerpt: "  \n\t ", evidenceType: "explicit" }], novel);
assert.equal(empty.evidence.length, 0, "空摘录不得成为证据对象");
assert.ok(empty.warnings.some((item) => item.includes("空证据摘录")));

const badChapter = normalizeEvidence([{ chapterId: "chapter-does-not-exist", excerpt: "林舟提灯走进雾港", evidenceType: "explicit" }], novel);
assert.equal(badChapter.evidence.length, 0, "错误章节 ID 不得回退到当前章节");
assert.ok(badChapter.warnings.some((item) => item.includes("不存在的章节")));

const crossChapter = normalizeEvidence([{ chapterNo: 1, excerpt: "她把一枚铜钥匙交给林舟。第二章 旧钟楼", evidenceType: "explicit" }], novel);
assert.equal(crossChapter.evidence.length, 0, "跨章节摘录不能挂到单个章节");

/* ---------- P1 无效证据不得让关系通过，也不得进入统计 ---------- */
const invalidExtract = normalizeChapterExtract(
    {
        summary: "只有无效证据的片段。",
        characters: [{ name: "空证据人物", evidence: [{ chapterNo: 1, excerpt: "这句原文不存在", evidenceType: "explicit" }] }],
        relationships: [{ from: "空证据人物", to: "林舟", type: "朋友", evidence: [{ chapterNo: 1, excerpt: "这句原文也不存在", evidenceType: "explicit" }] }],
        world: [{ category: "rule", name: "无据规则", description: "不应计入", evidence: [{ chapterNo: 1, excerpt: "", evidenceType: "inferred" }] }],
        scenes: [{ name: "无据地点", type: "地点", evidence: [{ chapterNo: 1, excerpt: "不存在的场景句", evidenceType: "explicit" }] }],
        events: [{ title: "无据事件", chapterNo: 1, evidence: [{ chapterNo: 1, excerpt: "不存在的事件句", evidenceType: "explicit" }] }],
        foreshadowings: [{ content: "无据伏笔", chapterNo: 1, evidence: [{ chapterNo: 1, excerpt: "不存在的伏笔句", evidenceType: "explicit" }] }],
    },
    novel,
    chunk0,
);
assert.equal(invalidExtract.characters.length, 1, "人物可以保留为空证据待审核条目");
assert.equal(invalidExtract.characters[0].evidence.length, 0);
assert.equal(invalidExtract.relationships.length, 0, "无效证据不能让关系通过校验");
assert.ok(invalidExtract.worldEntries.every((item) => item.evidence.length === 0));
assert.ok(invalidExtract.scenes.every((item) => item.evidence.length === 0));
assert.ok(invalidExtract.events.every((item) => item.evidence.length === 0));
assert.ok(invalidExtract.foreshadowings.every((item) => item.evidence.length === 0));

const invalidAnalysis = finalizeNovelAnalysis({
    novel,
    runId: "fix-invalid",
    version: 1,
    model: { channelId: "builtin-doubao", modelId: "test", label: "测试模型" },
    modelParams: {},
    aggregate: mergeChapterDigests(novel, [invalidExtract]),
    synthesis: {
        profile: { title: "空证据样本", author: "", genre: "", worldType: "", era: "", mainLocations: [], mainline: "", coreConflict: "" },
        world: { summary: "", rules: [], powerSystem: "", socialStructure: "" },
        causalLinks: [],
        warnings: [],
    },
    crosscheckWarnings: [],
    chunks: [{ ...chunk0, status: "succeeded", attempts: 1, digest: invalidExtract }],
    calls: 1,
    success: true,
});
assert.equal(invalidAnalysis.stats.evidenceCount, 0, "无效证据不得进入有效分析档案统计");
assert.equal(invalidAnalysis.stats.explicitCount, 0);
assert.equal(invalidAnalysis.relationships.length, 0);

/* ---------- P2 重叠分块：自然边界、有限上下文、去重 ---------- */
const longChapter = splitNovelChapters(`第一章 长段\n${"潮声穿过空港，灯火在雾里摇晃。".repeat(700)}`, "txt").chapters[0];
const longChunks = buildNovelChunks([longChapter], 8000);
assert.ok(longChunks.length >= 2);
assert.ok(longChunks.every((chunk) => chunk.charCount <= 8000), "分块不得超过 8000 字上限");
assert.ok(longChunks[0].text.trimEnd().endsWith("。"), "超长段落应优先在句号等自然边界切分");
assert.ok(longChunks[1].text.includes(longChunks[0].text.slice(-60)), "相邻分块应保留有限上下文重叠");

const duplicateA = normalizeChapterExtract(
    {
        summary: "重叠片段 A。",
        characters: [{ name: "林舟", evidence: [{ chapterNo: 1, excerpt: "林舟提灯走进雾港", evidenceType: "explicit" }] }],
        events: [{ title: "交付铜钥匙", chapterNo: 1, evidence: [{ chapterNo: 1, excerpt: "她把一枚铜钥匙交给林舟", evidenceType: "explicit" }] }],
    },
    novel,
    chunk0,
);
const duplicateB = normalizeChapterExtract(
    {
        summary: "重叠片段 B。",
        characters: [{ name: "林舟", evidence: [{ chapterNo: 1, excerpt: "林舟提灯走进雾港", evidenceType: "explicit" }] }],
        events: [{ title: "交付铜钥匙", chapterNo: 1, evidence: [{ chapterNo: 1, excerpt: "她把一枚铜钥匙交给林舟", evidenceType: "explicit" }] }],
    },
    novel,
    chunk0,
);
const merged = mergeChapterDigests(novel, [duplicateA, duplicateB]);
assert.equal(merged.events.filter((item) => item.title === "交付铜钥匙").length, 1, "重叠分块不能产生重复事件");
assert.equal(merged.characters.find((item) => item.name === "林舟")?.evidence.length, 1, "同一原文区间的证据只能保留一条");

/* ---------- P2 PDF 空白页过滤后的页码 ---------- */
const pdfSplit = splitPdfPages([
    { page: 1, text: "第一章 起点\n第一页正文。" },
    { page: 2, text: "   \n\t " },
    { page: 3, text: "第二页继续。\n第二章 转折\n后续正文继续。" },
]);
assert.equal(pdfSplit.chapters.length, 2);
assert.equal(pdfSplit.chapters[0].pageStart, 1, "第一章应从第 1 页开始");
assert.equal(pdfSplit.chapters[0].pageEnd, 3, "第一章跨到第 3 页时不能被空白页偏移");
assert.equal(pdfSplit.chapters[1].pageStart, 3, "空白第 2 页被过滤后，第二章仍应定位到第 3 页");
assert.equal(pdfSplit.chapters[1].pageEnd, 3);
assert.equal(pdfSplit.chapters[1].charStart, pdfSplit.chapters[0].charStart + pdfSplit.chapters[0].text.length);

/* ---------- P1 项目账号隔离 ---------- */
function account(id: string, provider: "doubao" | "dola", loggedIn: boolean | null, error: DoubaoAccount["state"]["error"] = null, quota = false): DoubaoAccount {
    return {
        id,
        name: id,
        provider,
        providerName: provider === "dola" ? "Dola" : "豆包",
        createdAt: "",
        lastLoginAt: null,
        state: {
            busy: false,
            loginRunning: false,
            loggedIn,
            checkedAt: null,
            models: null,
            capabilities: null,
            error,
            quotaBlocks: quota ? [{ capability: "对话", message: "额度不足" }] : [],
        },
    };
}
const modelId = "builtin-doubao::对话";
const globalAccount = account("global-doubao", "doubao", true);
const projectAccount = account("project-doubao", "doubao", true);
const projectDola = account("project-dola", "dola", true);
const loggedOut = account("project-out", "doubao", false);
const abnormal = account("project-error", "doubao", true, { message: "登录态失效" });

const noProject = validateProjectBridgeAccount(modelId, "", [globalAccount]);
assert.equal(noProject.ok, false, "项目账号为空时必须阻止");
if (!noProject.ok) assert.match(noProject.error, /不会继承全局账号池/);
assert.throws(() => applyProjectBridgeAccount({ doubaoAccountId: globalAccount.id }, noProject), /不会继承全局账号池/, "全局账号存在也不能回退");

const valid = validateProjectBridgeAccount(modelId, projectAccount.id, [globalAccount, projectAccount]);
assert.equal(valid.ok, true, "项目账号有效时应通过");
let appliedAccountId = "";
if (valid.ok) {
    assert.equal(valid.accountId, projectAccount.id);
    assert.equal(valid.quota, "unknown", "额度必须明确为未知");
    assert.ok(valid.warnings.some((item) => item.includes("未知")));
    const applied = applyProjectBridgeAccount({ doubaoAccountId: globalAccount.id }, valid);
    appliedAccountId = applied.doubaoAccountId ?? "";
    assert.equal(applied.doubaoAccountId, projectAccount.id, "请求配置只能使用项目账号");
    assert.notEqual(applied.doubaoAccountId, globalAccount.id);
}
const originalConfig = { doubaoAccountId: globalAccount.id };
applyProjectBridgeAccount(originalConfig, valid);
assert.equal(originalConfig.doubaoAccountId, globalAccount.id, "不得修改传入的全局配置对象");

const notLogged = validateProjectBridgeAccount(modelId, loggedOut.id, [loggedOut]);
assert.equal(notLogged.ok, false);
if (!notLogged.ok) assert.match(notLogged.error, /未登录/);

const providerMismatch = validateProjectBridgeAccount(modelId, projectDola.id, [projectDola]);
assert.equal(providerMismatch.ok, false);
if (!providerMismatch.ok) assert.match(providerMismatch.error, /不一致/);

const errorAccount = validateProjectBridgeAccount(modelId, abnormal.id, [abnormal]);
assert.equal(errorAccount.ok, false);
if (!errorAccount.ok) assert.match(errorAccount.error, /状态异常/);

const quotaAccount = account("project-quota", "doubao", true, null, true);
const quotaBlocked = validateProjectBridgeAccount(modelId, quotaAccount.id, [quotaAccount]);
assert.equal(quotaBlocked.ok, false);
if (!quotaBlocked.ok) assert.match(quotaBlocked.error, /额度不足/);

console.log(JSON.stringify({
    ok: true,
    evidence: {
        valid: correct.evidence.length,
        whitespace: whitespace.evidence.length,
        wrong: wrong.evidence.length,
        empty: empty.evidence.length,
        badChapter: badChapter.evidence.length,
        crossChapter: crossChapter.evidence.length,
        invalidArchiveEvidence: invalidAnalysis.stats.evidenceCount,
    },
    chunks: { count: longChunks.length, maxChars: Math.max(...longChunks.map((chunk) => chunk.charCount)) },
    pdf: pdfSplit.chapters.map((chapter) => ({ pageStart: chapter.pageStart, pageEnd: chapter.pageEnd })),
    account: {
        noProjectRejected: !noProject.ok,
        validProject: valid.ok,
        requestAccountId: appliedAccountId,
        notLogged: notLogged.ok,
        providerMismatch: providerMismatch.ok,
        abnormal: errorAccount.ok,
        quotaBlocked: quotaBlocked.ok,
        globalAccountUntouched: originalConfig.doubaoAccountId === globalAccount.id,
    },
}, null, 2));
