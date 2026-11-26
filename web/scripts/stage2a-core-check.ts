import assert from "node:assert/strict";

import type { NovelChapter, NovelChapterChunk, NovelEvidence, StudioNovel } from "../src/types/novel";
import { buildNovelChunks, makeStudioNovel, simpleHash, splitNovelChapters, stripChapterTitle } from "../src/lib/studio/novel-chapters";
import { normalizeChapterExtract } from "../src/lib/studio/novel-analysis";
import { applyNovelAnalysisOverrides, buildCompactDigest, finalizeNovelAnalysis, mergeChapterDigests, overrideCount } from "../src/lib/studio/novel-merge";

const sample = [
    "雾港旧事",
    "作者：佚名",
    "",
    "第一章 雾港",
    "林舟提灯走进雾港，码头只剩一盏灯。",
    "沈鸢站在旧钟楼下，她把一枚铜钥匙交给林舟。",
    "他想起第一章说过的话，却没有停下。",
    "",
    "第二章 旧钟楼",
    "林舟与沈鸢在旧钟楼下约定，天亮前找回失踪的船。",
    "钟楼管理人说出旧事：十年前也有一艘船没有回来。",
    "",
    "第三章 长夜",
    "沈鸢在雾里听见钟声，铜钥匙开始发烫。",
].join("\n");

const split = splitNovelChapters(sample, "txt");
assert.equal(split.chapters.length, 3, "应识别 3 个章节标题");
assert.equal(split.chapters[0].title, "第一章 雾港");
assert.equal(split.chapters[1].no, 2);
assert.match(split.preamble, /作者：佚名/);
assert.ok(split.chapters.every((chapter) => chapter.detectedBy === "heading"));
assert.match(stripChapterTitle(split.chapters[0]), /^林舟提灯/);

const fallback = splitNovelChapters("只有一段没有章节标题的正文。", "paste");
assert.equal(fallback.chapters.length, 1);
assert.equal(fallback.chapters[0].detectedBy, "fallback");
assert.ok(fallback.warnings.some((warning) => warning.includes("没有识别到章节标题")));
assert.throws(() => splitNovelChapters("   \n\n ", "txt"), /没有可解析的正文/);

const longText = `第四章 长夜\n${"潮声穿过空港，灯火在雾里摇晃。".repeat(900)}`;
const longSplit = splitNovelChapters(longText, "txt");
const chunks = buildNovelChunks(longSplit.chapters);
assert.ok(chunks.length >= 2, "长章节应被拆成多个分块");
assert.ok(chunks.every((chunk) => chunk.charCount <= 8300), "分块正文应控制在 8000 字附近");
assert.ok(chunks.every((chunk) => chunk.chapterIds.includes(longSplit.chapters[0].id)));
assert.deepEqual(buildNovelChunks(longSplit.chapters).map((chunk) => chunk.id), chunks.map((chunk) => chunk.id), "分块 id 应稳定");

const novel: StudioNovel = makeStudioNovel({
    fileHash: "stage2a-test",
    format: "txt",
    name: "雾港旧事.txt",
    mimeType: "text/plain",
    bytes: sample.length,
    encoding: "utf-8",
    preamble: split.preamble,
    chapters: split.chapters,
    warnings: split.warnings,
});

function chunkOf(chapter: NovelChapter, index: number): NovelChapterChunk {
    return { id: `manual-chunk-${index}`, index, chapterIds: [chapter.id], text: chapter.text, charCount: chapter.text.length };
}

const first = normalizeChapterExtract(
    {
        summary: "林舟进入雾港并拿到铜钥匙。",
        characters: [
            {
                name: "林舟",
                aliases: ["提灯人"],
                identity: "码头少年",
                personality: "谨慎",
                status: "alive",
                firstChapterNo: 1,
                evidence: [{ chapterNo: 1, excerpt: "林舟提灯走进雾港", evidenceType: "explicit", confidence: 0.93 }],
            },
            { name: "无证据人物", evidence: [] },
        ],
        relationships: [
            {
                from: "林舟",
                to: "沈鸢",
                type: "委托关系",
                currentStatus: "暂时合作",
                changes: [{ chapterNo: 1, description: "沈鸢把铜钥匙交给林舟" }],
                evidence: [{ chapterNo: 1, excerpt: "她把一枚铜钥匙交给林舟", evidenceType: "explicit", confidence: 0.9 }],
            },
            { from: "林舟", to: "钟楼管理人", type: "敌对", evidence: [] },
        ],
        world: [{ category: "organization", name: "雾港船帮", description: "控制码头的船帮", evidence: [{ chapterNo: 1, excerpt: "码头只剩一盏灯", evidenceType: "inferred", confidence: 0.4 }] }],
        scenes: [
            { name: "旧钟楼", type: "钟楼", space: "临海石塔", region: "雾港", plotUses: "约定地点", evidence: [{ chapterNo: 2, excerpt: "旧钟楼下约定", evidenceType: "explicit", confidence: 0.88 }] },
            { name: "旧航道海面", type: "海上航道", variants: [{ timeOfDay: "清晨", evidence: [{ chapterNo: 2, excerpt: "十年前也有一艘船没有回来", evidenceType: "explicit", confidence: 0.8 }] }] },
        ],
        events: [{ title: "交付铜钥匙", content: "沈鸢把钥匙交给林舟", chapterNo: 1, participants: ["林舟", "沈鸢"], location: "旧钟楼", results: ["林舟获得钥匙"], evidence: [{ chapterNo: 1, excerpt: "她把一枚铜钥匙交给林舟", evidenceType: "explicit", confidence: 0.9 }] }],
        foreshadowings: [{ content: "铜钥匙为何发烫", chapterNo: 1, relatedCharacters: ["林舟"], expectedPayoffChapterNo: 3, expectedPayoffEvidenceType: "explicit", status: "open", evidence: [{ chapterNo: 1, excerpt: "她把一枚铜钥匙交给林舟", evidenceType: "inferred", confidence: 0.5 }] }],
    },
    novel,
    chunkOf(split.chapters[0], 0),
);

assert.equal(first.relationships.length, 1, "没有证据的关系必须被丢弃");
assert.ok(first.warnings.some((warning) => warning.includes("缺少证据")));
assert.equal(first.characters.length, 2, "无证据人物保留为空证据条目，等待人工核对");
assert.equal(first.characters[0].id, "char-" + simpleHash("林舟"), "人物 id 应稳定");
assert.equal(first.foreshadowings[0].expectedPayoffEvidenceType, "inferred", "预计回收章节不能被伪装成 explicit");
assert.equal(first.foreshadowings[0].expectedPayoffChapterId, split.chapters[2].id);
assert.equal(first.events[0].causeEventIds.length, 0, "章节内不编造因果事件 id");
assert.ok(first.events[0].participantIds.length === 0, "跨块引用需由合并阶段解析");
const variantScene = first.scenes.find((scene) => scene.name === "旧航道海面");
assert.ok(variantScene, "变体证据只写在 variants 里的地点应保留");
assert.equal(variantScene.evidence.length, 1, "地点顶层证据应聚合变体证据");
assert.equal(variantScene.firstChapterId, split.chapters[1].id, "地点首次出场应按聚合证据取真实章节");

const second = normalizeChapterExtract(
    {
        summary: "钟楼旧事被揭开。",
        characters: [{ name: "林舟", identity: "船帮临时帮手", status: "dead", firstChapterNo: 2, evidence: [{ chapterNo: 2, excerpt: "林舟与沈鸢在旧钟楼下约定", evidenceType: "explicit", confidence: 0.8 }] }],
        relationships: [{ from: "林舟", to: "沈鸢", type: "委托关系", currentStatus: "共同寻船", changes: [{ chapterNo: 2, description: "两人约定寻船" }], evidence: [{ chapterNo: 2, excerpt: "林舟与沈鸢在旧钟楼下约定", evidenceType: "explicit", confidence: 0.8 }] }],
        events: [{ title: "约定寻船", content: "两人约定天亮前找回失踪的船", chapterNo: 2, participants: ["林舟", "沈鸢"], location: "旧钟楼", causedBy: ["交付铜钥匙"], evidence: [{ chapterNo: 2, excerpt: "天亮前找回失踪的船", evidenceType: "explicit", confidence: 0.8 }] }],
        foreshadowings: [{ content: "铜钥匙为何发烫", chapterNo: 3, status: "open", expectedPayoffChapterNo: 3, expectedPayoffEvidenceType: "inferred", evidence: [{ chapterNo: 3, excerpt: "铜钥匙开始发烫", evidenceType: "explicit", confidence: 0.7 }] }],
    },
    novel,
    chunkOf(split.chapters[1], 1),
);

const aggregate = mergeChapterDigests(novel, [first, second]);
assert.equal(aggregate.characters.length, 2, "同名人物应合并，无证据人物仍保留");
assert.equal(aggregate.characters[0].firstChapterId, split.chapters[0].id, "首次出场章节应取更早者");
assert.equal(aggregate.characters[0].status, "dead", "后续明确状态应合并");
assert.equal(aggregate.relationships.length, 1, "同一关系应合并");
assert.equal(aggregate.relationships[0].changes.length, 2);
assert.equal(aggregate.scenes.find((scene) => scene.name === "旧钟楼").firstChapterId, split.chapters[0].id, "地点首次出场应参考同一地点的最早事件");
assert.ok(aggregate.scenes.find((scene) => scene.name === "旧航道海面").evidence.length === 1);
assert.ok(aggregate.events[1].causeEventIds.includes(aggregate.events[0].id), "因果标题应解析为稳定事件 id");

const compact = buildCompactDigest(aggregate, novel, 1400);
for (const heading of ["【人物】", "【关系】", "【世界观】", "【地点】", "【关键事件与因果】", "【伏笔】"]) assert.ok(compact.includes(heading), `压缩档案应保留分区 ${heading}`);
assert.ok(compact.length <= 1400, "压缩档案不应超过预算");
const longAggregate = {
    ...aggregate,
    events: Array.from({ length: 30 }, (_, index) => ({ ...aggregate.events[0], id: `event-long-${index}`, title: `长事件 ${index}`, content: "用于验证分区配额截断的事件内容。".repeat(8) })),
};
const truncatedCompact = buildCompactDigest(longAggregate, novel, 1400);
assert.ok(truncatedCompact.length <= 1400, "超长档案必须严格受预算约束");
assert.ok(truncatedCompact.includes("按分区配额截断"), "超预算时应明确说明截断");
for (const heading of ["【人物】", "【关系】", "【世界观】", "【地点】", "【关键事件与因果】", "【伏笔】"]) assert.ok(truncatedCompact.includes(heading), `截断后仍应保留分区 ${heading}`);

const analysis = finalizeNovelAnalysis({
    novel,
    runId: "run-test",
    version: 1,
    model: { channelId: "builtin-doubao", modelId: "test", label: "测试模型" },
    modelParams: { temperature: 0.3 },
    aggregate,
    synthesis: {
        profile: { title: "雾港旧事", author: "佚名", genre: "悬疑", worldType: "现实", era: "近代", mainLocations: ["雾港"], mainline: "寻找失踪的船", coreConflict: "旧案与当下" },
        world: { summary: "临海雾港", rules: ["钟声响起后不能出海"], powerSystem: "", socialStructure: "船帮控制码头" },
        causalLinks: [{ cause: "交付铜钥匙", effect: "约定寻船" }],
        warnings: [],
    },
    crosscheckWarnings: [],
    chunks: [
        { id: "manual-chunk-0", index: 0, chapterIds: [split.chapters[0].id], status: "succeeded", attempts: 1, digest: first },
        { id: "manual-chunk-1", index: 1, chapterIds: [split.chapters[1].id], status: "succeeded", attempts: 1, digest: second },
    ],
    calls: 2,
    success: true,
});
assert.equal(analysis.profile.totalChapters, 3);
assert.equal(analysis.profile.analyzedChapters, 3, "完整度按实际证据覆盖章节计算");
assert.ok(analysis.stats.evidenceCount > 0);
assert.ok(analysis.events[0].consequenceEventIds.includes(analysis.events[1].id), "全局因果链应写入事件 id");

const overrides = {
    profile: { title: "人工书名" },
    characters: { [first.characters[0].id]: { identity: "人工身份", status: "missing" as const } },
    relationships: {},
    world: {},
    scenes: {},
    events: {},
    foreshadowings: {},
};
const patched = applyNovelAnalysisOverrides(analysis, overrides);
assert.equal(patched.profile.title, "人工书名");
assert.equal(patched.characters[0].identity, "人工身份");
assert.equal(patched.characters[0].status, "missing");
assert.equal(overrideCount(overrides), 2);
assert.equal(analysis.characters[0].identity, "船帮临时帮手", "override 不应修改原始 AI 分析对象");

console.log(JSON.stringify({
    ok: true,
    chapters: split.chapters.length,
    chunks: chunks.length,
    maxChunkChars: Math.max(...chunks.map((chunk) => chunk.charCount)),
    characters: aggregate.characters.length,
    relationships: aggregate.relationships.length,
    events: aggregate.events.length,
    foreshadowings: aggregate.foreshadowings.length,
    evidence: analysis.stats,
    warnings: analysis.warnings.length,
    compactChars: compact.length,
}, null, 2));
