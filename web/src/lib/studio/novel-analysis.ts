import type { NovelChapter, NovelChapterChunk, NovelChapterDigest, NovelCharacter, NovelCharacterStatus, NovelEvidence, NovelEvidenceType, NovelSourceLocation, StudioNovel } from "@/types/novel";

import { simpleHash } from "./novel-chapters";
import type { AiTextMessage } from "./novel-model";

// 章节分析只产出一个受控 JSON 片段。所有人物、关系、事件、伏笔都必须带章节和短证据；
// 关系没有证据时直接不采用，避免“同框即亲属/恋爱/敌对”的伪关系。

const EVIDENCE_TYPES = new Set<NovelEvidenceType>(["explicit", "inferred", "generated"]);
const MAX_EXCERPT = 220;
const MAX_EVIDENCE_PER_ENTITY = 3;

const SYSTEM_CHARTER =
    "你是严谨的中文小说原著分析员。只根据用户提供的章节原文提取事实，不补写剧情，不把推测当事实。\n" +
    "每条人物、关系、世界观、地点、事件、伏笔都必须带 evidence；evidence 必须引用原文中的短句。\n" +
    "evidenceType 只能是 explicit（原文明确写出）、inferred（原文有依据的推断）、generated（AI 补充）。\n" +
    "无法确定的信息填空字符串或空数组，不要编造姓名、年龄、亲属关系、门派、结局或回收章节。\n" +
    "关系证据不足时不要输出该关系；同框、对话、互相称呼不等于亲属、恋爱或敌对关系。\n" +
    "只输出一个 JSON 对象，不要 Markdown 围栏，不要解释。";

const CHAPTER_SCHEMA =
    '{"summary":"本章片段摘要","characters":[{"name":"姓名","aliases":["别名"],"identity":"身份","age":"原著明确时填写","personality":"性格","appearance":"原著明确的外貌","abilities":"能力","occupation":"职业/职位","status":"alive|dead|missing|transformed|unknown","motivation":"动机","arc":"成长或转变","firstChapterNo":1,"keyChapterNos":[1],"fate":"生死/失踪/身份变化","evidence":[{"chapterNo":1,"excerpt":"原文短句","evidenceType":"explicit|inferred|generated","confidence":0.8}]}],' +
    '"relationships":[{"from":"人物A","to":"人物B","type":"关系类型","currentStatus":"当前状态","changes":[{"chapterNo":1,"description":"变化"}],"evidence":[{"chapterNo":1,"excerpt":"原文短句","evidenceType":"explicit","confidence":0.8}]}],' +
    '"world":[{"category":"rule|power|society|organization|geography|item|ability|history|constraint","name":"名称","description":"设定","evidence":[...]}],' +
    '"scenes":[{"name":"地点名","type":"地点类型","space":"空间特征","region":"区域","organization":"所属组织","plotUses":"剧情用途","stateChanges":[{"chapterNo":1,"description":"变化"}],"variants":[{"timeOfDay":"日/夜","weather":"天气","condition":"完好/损毁等","description":"变体","evidence":[...]}]}],' +
    '"events":[{"title":"事件标题","content":"发生了什么","chapterNo":1,"participants":["人物名"],"location":"地点名","preconditions":["前置条件"],"results":["直接结果"],"impacts":["后续影响"],"causedBy":["前置事件标题"],"leadsTo":["后续事件标题"],"evidence":[...]}],' +
    '"foreshadowings":[{"content":"伏笔内容","chapterNo":1,"relatedCharacters":["人物名"],"relatedEvents":["事件标题"],"expectedPayoffChapterNo":0,"expectedPayoffEvidenceType":"explicit|inferred|","actualPayoffChapterNo":0,"status":"open|paid_off|unknown","evidence":[...]}],' +
    '"warnings":["本片段无法确定或可能矛盾的点"]}';

function asString(value: unknown) {
    return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function asStrings(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(asString).filter(Boolean);
    const text = asString(value);
    return text ? text.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean) : [];
}

function asNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.map(asRecord) : [];
}

function clampConfidence(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0.05, Math.min(1, number)) : fallback;
}

function findChapter(novel: StudioNovel, value: unknown) {
    const no = asNumber(value);
    if (no) return novel.chapters.find((chapter) => chapter.no === no);
    const id = asString(value);
    return id ? novel.chapters.find((chapter) => chapter.id === id) : undefined;
}

function chapterForRecord(novel: StudioNovel, record: Record<string, unknown>, fallback?: NovelChapter) {
    const locators = [record.chapterNo, record.chapterId, record.chapter, record.firstChapterNo];
    const found =
        findChapter(novel, record.chapterNo) ??
        findChapter(novel, record.chapterId) ??
        findChapter(novel, record.chapter) ??
        findChapter(novel, record.firstChapterNo);
    if (found) return found;
    // 模型明确给了章节定位但不存在时必须丢弃；只有完全没给定位时才允许用当前分块的 fallback。
    const hasLocator = locators.some((item) => item !== undefined && item !== null && String(item).trim() !== "");
    return hasLocator ? undefined : fallback;
}

function searchableText(text: string) {
    const chars: string[] = [];
    const positions: number[] = [];
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (/\s/u.test(char)) continue;
        chars.push(char);
        positions.push(index);
    }
    return { text: chars.join(""), positions };
}

function sourceLocation(chapter: NovelChapter, charStart: number, charEnd: number): NovelSourceLocation {
    // 模型给的页码不进入位置：只有解析器从页文本算出的章节页范围可信。
    return {
        ...(chapter.pageStart ? { page: chapter.pageStart } : {}),
        ...(chapter.pageEnd ? { pageEnd: chapter.pageEnd } : {}),
        charStart: chapter.charStart + charStart,
        charEnd: chapter.charStart + charEnd,
        label: chapter.title || `第 ${chapter.no} 章`,
    };
}

export function normalizeEvidence(
    value: unknown,
    novel: StudioNovel,
    fallbackChapter?: NovelChapter,
): { evidence: NovelEvidence[]; warnings: string[] } {
    const warnings: string[] = [];
    const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
    const evidence: NovelEvidence[] = [];
    for (const item of list) {
        if (evidence.length >= MAX_EVIDENCE_PER_ENTITY) break;
        const record = asRecord(item);
        const chapter = chapterForRecord(novel, record, fallbackChapter);
        if (!chapter) {
            warnings.push("证据引用了不存在的章节，已丢弃");
            continue;
        }
        const rawExcerpt = asString(record.excerpt ?? record.quote ?? record.text ?? record.sourceExcerpt).slice(0, MAX_EXCERPT);
        const query = searchableText(rawExcerpt).text;
        if (!query) {
            warnings.push(`「${chapter.title || `第 ${chapter.no} 章`}」存在空证据摘录，已丢弃`);
            continue;
        }
        const target = searchableText(chapter.text);
        const matchIndex = target.text.indexOf(query);
        if (matchIndex < 0) {
            warnings.push(`证据摘录未在「${chapter.title || `第 ${chapter.no} 章`}」中匹配，已丢弃：${rawExcerpt.slice(0, 32)}…`);
            continue;
        }
        const start = target.positions[matchIndex];
        const end = target.positions[matchIndex + query.length - 1] + 1;
        const sourceExcerpt = chapter.text.slice(start, end);
        const typeText = asString(record.evidenceType ?? record.type);
        const evidenceType: NovelEvidenceType = EVIDENCE_TYPES.has(typeText as NovelEvidenceType) ? (typeText as NovelEvidenceType) : "inferred";
        evidence.push({
            chapterId: chapter.id,
            chapterTitle: chapter.title || `第 ${chapter.no} 章`,
            excerpt: sourceExcerpt,
            sourceLocation: sourceLocation(chapter, start, end),
            confidence: clampConfidence(record.confidence, evidenceType === "explicit" ? 0.75 : evidenceType === "inferred" ? 0.45 : 0.2),
            evidenceType,
        });
    }
    return { evidence, warnings };
}

function firstChapterFromEvidence(evidence: NovelEvidence[], fallback?: NovelChapter) {
    return evidence[0]?.chapterId ?? fallback?.id ?? "";
}

function keyChapterIds(novel: StudioNovel, record: Record<string, unknown>, evidence: NovelEvidence[]) {
    const nos = [...asStrings(record.keyChapterNos), ...asStrings(record.keyChapters)].map(Number).filter(Boolean);
    const ids = nos.map((no) => novel.chapters.find((chapter) => chapter.no === no)?.id).filter((id): id is string => Boolean(id));
    return [...new Set([...ids, ...evidence.map((item) => item.chapterId)])];
}

function normalizeCharacter(record: Record<string, unknown>, novel: StudioNovel, fallback: NovelChapter, warnings: string[]): NovelCharacter | null {
    const name = asString(record.name ?? record.character);
    if (!name) return null;
    const evidenceResult = normalizeEvidence(record.evidence, novel, fallback);
    warnings.push(...evidenceResult.warnings);
    if (!evidenceResult.evidence.length) warnings.push(`人物「${name}」没有可用证据，已保留为空证据条目供人工核对`);
    const statusText = asString(record.status);
    const status: NovelCharacterStatus = ["alive", "dead", "missing", "transformed"].includes(statusText) ? (statusText as NovelCharacterStatus) : "unknown";
    return {
        id: `char-${simpleHash(name.normalize("NFKC"))}`,
        name,
        aliases: [...new Set(asStrings(record.aliases))],
        identity: asString(record.identity),
        age: asString(record.age),
        personality: asString(record.personality),
        appearance: asString(record.appearance),
        abilities: asString(record.abilities),
        occupation: asString(record.occupation),
        status,
        motivation: asString(record.motivation),
        arc: asString(record.arc),
        firstChapterId: evidenceResult.evidence[0]?.chapterId || chapterForRecord(novel, record, fallback)?.id || firstChapterFromEvidence(evidenceResult.evidence, fallback),
        keyChapterIds: keyChapterIds(novel, record, evidenceResult.evidence),
        fate: asString(record.fate),
        evidence: evidenceResult.evidence,
    };
}

function normalizeRelationship(record: Record<string, unknown>, novel: StudioNovel, characters: Map<string, string>, fallback: NovelChapter, warnings: string[]) {
    const from = asString(record.from ?? record.fromName ?? record.characterA);
    const to = asString(record.to ?? record.toName ?? record.characterB);
    const type = asString(record.type ?? record.relationType) || "未明确";
    if (!from || !to) return null;
    const fromId = characters.get(from.normalize("NFKC")) ?? `char-${simpleHash(from.normalize("NFKC"))}`;
    const toId = characters.get(to.normalize("NFKC")) ?? `char-${simpleHash(to.normalize("NFKC"))}`;
    const evidenceResult = normalizeEvidence(record.evidence, novel, fallback);
    warnings.push(...evidenceResult.warnings);
    if (!evidenceResult.evidence.length) {
        warnings.push(`人物关系「${from} → ${to}」缺少证据，已丢弃（不凭同框或对话推断关系）`);
        return null;
    }
    const changes = asRecords(record.changes).map((change) => {
        const chapter = findChapter(novel, change.chapterNo) ?? findChapter(novel, change.chapterId) ?? fallback;
        return { chapterId: chapter?.id ?? "", description: asString(change.description) };
    }).filter((change) => change.description);
    return {
        id: `rel-${simpleHash(`${from.normalize("NFKC")}|${to.normalize("NFKC")}|${type}`)}`,
        fromCharacterId: fromId,
        toCharacterId: toId,
        fromName: from,
        toName: to,
        type,
        changes,
        currentStatus: asString(record.currentStatus ?? record.status),
        keyChapterIds: keyChapterIds(novel, record, evidenceResult.evidence),
        evidence: evidenceResult.evidence,
    };
}

const WORLD_CATEGORIES = new Set(["rule", "power", "society", "organization", "geography", "item", "ability", "history", "constraint"]);

function normalizeWorldEntry(record: Record<string, unknown>, novel: StudioNovel, fallback: NovelChapter, warnings: string[]) {
    const name = asString(record.name);
    const categoryText = asString(record.category);
    if (!name || !WORLD_CATEGORIES.has(categoryText)) return null;
    const evidenceResult = normalizeEvidence(record.evidence, novel, fallback);
    warnings.push(...evidenceResult.warnings);
    if (!evidenceResult.evidence.length) warnings.push(`世界观条目「${name}」没有证据`);
    return {
        id: `world-${simpleHash(`${categoryText}|${name.normalize("NFKC")}`)}`,
        category: categoryText as "rule" | "power" | "society" | "organization" | "geography" | "item" | "ability" | "history" | "constraint",
        name,
        description: asString(record.description),
        evidence: evidenceResult.evidence,
    };
}

function normalizeScene(record: Record<string, unknown>, novel: StudioNovel, fallback: NovelChapter, warnings: string[]) {
    const name = asString(record.name);
    if (!name) return null;
    const evidenceResult = normalizeEvidence(record.evidence, novel, fallback);
    warnings.push(...evidenceResult.warnings);
    const stateChanges = asRecords(record.stateChanges).map((item) => {
        const chapter = findChapter(novel, item.chapterNo) ?? findChapter(novel, item.chapterId) ?? fallback;
        return { chapterId: chapter?.id ?? "", description: asString(item.description) };
    }).filter((item) => item.description);
    const variants = asRecords(record.variants).map((item, index) => {
        const variantEvidence = normalizeEvidence(item.evidence, novel, fallback);
        warnings.push(...variantEvidence.warnings);
        return {
            id: `variant-${simpleHash(`${name.normalize("NFKC")}|${index}|${asString(item.timeOfDay)}|${asString(item.weather)}`)}`,
            timeOfDay: asString(item.timeOfDay),
            weather: asString(item.weather),
            condition: asString(item.condition),
            description: asString(item.description),
            evidence: variantEvidence.evidence,
        };
    });
    // 地点证据通常写在昼夜/天气等变体里；顶层证据为空时不能把整条地点判成无证据。
    const allEvidence = [...evidenceResult.evidence, ...variants.flatMap((variant) => variant.evidence)];
    const evidence = [...new Map(allEvidence.map((item) => [`${item.chapterId}|${item.excerpt}`, item])).values()].sort(
        (left, right) => novel.chapters.findIndex((chapter) => chapter.id === left.chapterId) - novel.chapters.findIndex((chapter) => chapter.id === right.chapterId),
    );
    if (!evidence.length) warnings.push(`地点「${name}」没有证据`);
    return {
        id: `scene-${simpleHash(name.normalize("NFKC"))}`,
        name,
        type: asString(record.type),
        space: asString(record.space),
        region: asString(record.region),
        organization: asString(record.organization),
        firstChapterId: firstChapterFromEvidence(evidence, fallback),
        keyChapterIds: keyChapterIds(novel, record, evidence),
        plotUses: asString(record.plotUses ?? record.purpose),
        stateChanges,
        variants,
        evidence,
    };
}

function normalizeEvent(record: Record<string, unknown>, novel: StudioNovel, fallback: NovelChapter, sceneNames: Map<string, string>, warnings: string[]) {
    const title = asString(record.title ?? record.name);
    const chapter = chapterForRecord(novel, record, fallback);
    if (!title || !chapter) return null;
    const evidenceResult = normalizeEvidence(record.evidence, novel, fallback);
    warnings.push(...evidenceResult.warnings);
    if (!evidenceResult.evidence.length) warnings.push(`事件「${title}」没有证据`);
    const location = asString(record.location ?? record.locationName);
    return {
        id: `event-${simpleHash(`${title.normalize("NFKC")}|${chapter.id}`)}`,
        title,
        content: asString(record.content ?? record.description),
        chapterId: chapter.id,
        participantIds: [],
        participantNames: [...new Set(asStrings(record.participants ?? record.characters))],
        locationId: sceneNames.get(location.normalize("NFKC")) ?? "",
        locationName: location,
        preconditions: asStrings(record.preconditions),
        results: asStrings(record.results),
        impacts: asStrings(record.impacts),
        causeEventTitles: asStrings(record.causedBy ?? record.causeEvents),
        consequenceEventTitles: asStrings(record.leadsTo ?? record.consequenceEvents),
        causeEventIds: [],
        consequenceEventIds: [],
        foreshadowingIds: [],
        evidence: evidenceResult.evidence,
    };
}

function normalizeForeshadowing(record: Record<string, unknown>, novel: StudioNovel, fallback: NovelChapter, warnings: string[], characters: Map<string, string>, eventTitles: Map<string, string>) {
    const content = asString(record.content ?? record.description);
    if (!content) return null;
    const chapter = chapterForRecord(novel, record, fallback) ?? fallback;
    const evidenceResult = normalizeEvidence(record.evidence, novel, fallback);
    warnings.push(...evidenceResult.warnings);
    if (!evidenceResult.evidence.length) warnings.push(`伏笔「${content.slice(0, 24)}」没有证据`);
    const expectedNo = asNumber(record.expectedPayoffChapterNo ?? record.expectedChapterNo);
    const actualNo = asNumber(record.actualPayoffChapterNo ?? record.payoffChapterNo);
    const expectedChapter = expectedNo ? findChapter(novel, expectedNo) : undefined;
    const actualChapter = actualNo ? findChapter(novel, actualNo) : undefined;
    let expectedType = asString(record.expectedPayoffEvidenceType);
    if (expectedType !== "explicit" && expectedType !== "inferred") expectedType = "";
    if (expectedType === "explicit" && !evidenceResult.evidence.some((item) => item.evidenceType === "explicit")) expectedType = expectedType ? "inferred" : "";
    const statusText = asString(record.status);
    const status = actualChapter || statusText === "paid_off" ? "paid_off" : statusText === "open" ? "open" : "unknown";
    return {
        id: `foreshadow-${simpleHash(content.normalize("NFKC"))}`,
        content,
        firstChapterId: chapter.id,
        relatedCharacterIds: [...new Set(asStrings(record.relatedCharacters ?? record.relatedCharacterNames).map((name) => characters.get(name.normalize("NFKC"))).filter((id): id is string => Boolean(id)))],
        relatedEventIds: [...new Set(asStrings(record.relatedEvents ?? record.relatedEventTitles).map((title) => eventTitles.get(title.normalize("NFKC"))).filter((id): id is string => Boolean(id)))],
        expectedPayoffChapterId: expectedChapter?.id ?? "",
        expectedPayoffEvidenceType: expectedType as "" | "explicit" | "inferred",
        actualPayoffChapterId: actualChapter?.id ?? "",
        status: status as "open" | "paid_off" | "unknown",
        evidence: evidenceResult.evidence,
    };
}

export function normalizeChapterExtract(value: Record<string, unknown>, novel: StudioNovel, chunk: NovelChapterChunk): NovelChapterDigest {
    const warnings: string[] = asStrings(value.warnings);
    const fallback = novel.chapters.find((chapter) => chapter.id === chunk.chapterIds[0]) ?? novel.chapters[0];
    const characterIds = new Map<string, string>();
    const characterList = asRecords(value.characters).map((record) => {
        const character = normalizeCharacter(record, novel, fallback, warnings);
        if (character) characterIds.set(character.name.normalize("NFKC"), character.id);
        return character;
    }).filter((character): character is NonNullable<typeof character> => Boolean(character));
    const sceneNames = new Map<string, string>();
    const scenes = asRecords(value.scenes).map((record) => {
        const scene = normalizeScene(record, novel, fallback, warnings);
        if (scene) sceneNames.set(scene.name.normalize("NFKC"), scene.id);
        return scene;
    }).filter((scene): scene is NonNullable<typeof scene> => Boolean(scene));
    const relationships = asRecords(value.relationships).map((record) => normalizeRelationship(record, novel, characterIds, fallback, warnings)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const worldEntries = asRecords(value.world).map((record) => normalizeWorldEntry(record, novel, fallback, warnings)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const events = asRecords(value.events).map((record) => normalizeEvent(record, novel, fallback, sceneNames, warnings)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const eventTitles = new Map(events.map((event) => [event.title.normalize("NFKC"), event.id]));
    const foreshadowings = asRecords(value.foreshadowings).map((record) => normalizeForeshadowing(record, novel, fallback, warnings, characterIds, eventTitles)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    return {
        chapterIds: chunk.chapterIds,
        summary: asString(value.summary),
        characters: characterList,
        relationships,
        worldEntries,
        scenes,
        events,
        foreshadowings,
        warnings,
    };
}

export function chapterPrompt(novel: StudioNovel, chunk: NovelChapterChunk, previousSummaries: string[] = []): AiTextMessage[] {
    const chapters = chunk.chapterIds.map((id) => novel.chapters.find((chapter) => chapter.id === id)).filter((chapter): chapter is NovelChapter => Boolean(chapter));
    const labels = chapters.map((chapter) => `第 ${chapter.no} 章《${chapter.title || "无标题"}》`).join("、");
    return [
        { role: "system", content: `${SYSTEM_CHARTER}\n\n本片段只允许提取以下范围：${labels}。\nJSON 结构：${CHAPTER_SCHEMA}` },
        {
            role: "user",
            content: [
                previousSummaries.length ? `前文摘要（只用于保持称谓一致，不得当成本片段的证据）：\n${previousSummaries.slice(-2).join("\n")}` : "",
                "原文片段：",
                chunk.text,
                "请输出 JSON。所有证据 chapterNo 必须属于上面的章节范围；不要输出范围外的人物或事件。",
            ].filter(Boolean).join("\n\n"),
        },
    ];
}

export const GLOBAL_SCHEMA =
    '{"profile":{"title":"小说名","author":"作者，未明确为空","genre":"题材","worldType":"世界观类型","era":"时代","mainLocations":["主要地点"],"mainline":"主线概述","coreConflict":"核心矛盾"},"world":{"summary":"世界观总述","rules":["世界规则"],"powerSystem":"力量体系","socialStructure":"社会结构"},"causalLinks":[{"cause":"前置事件标题","effect":"后续事件标题","evidence":[...]}],"warnings":["跨章节矛盾或不确定点"]}';

export function globalPrompt(novel: StudioNovel, compactDigest: string): AiTextMessage[] {
    return [
        {
            role: "system",
            content:
                "你是小说全局汇总员。下面是从全书分块提取、已经带证据的压缩档案。\n" +
                "只汇总，不新增书中没有的人物、事件、组织或关系；不得把推断写成原著事实。\n" +
                "profile 只填能从原著确认的信息，不确定填空字符串。causalLinks 只能使用压缩档案中已有的事件标题。\n" +
                `只输出 JSON：${GLOBAL_SCHEMA}`,
        },
        { role: "user", content: `小说：${novel.file.name}\n总章节：${novel.chapterCount}\n\n压缩档案：\n${compactDigest}` },
    ];
}

export const CROSSCHECK_SCHEMA = '{"issues":[{"level":"error|warning|info","message":"具体矛盾或不确定点","chapterNos":[1],"entityIds":["id"]}],"warnings":["无法判断的点"]}';

export function crosscheckPrompt(novel: StudioNovel, compactDigest: string): AiTextMessage[] {
    return [
        {
            role: "system",
            content:
                "你是短剧原著连续性审校员。检查人物首次出场与关系变化、事件因果顺序、地点状态、伏笔回收是否矛盾。\n" +
                "只报告能从给定档案看出的矛盾；没有证据不要猜。不要改写或新增剧情。\n" +
                `只输出 JSON：${CROSSCHECK_SCHEMA}`,
        },
        { role: "user", content: `小说：${novel.file.name}\n\n待审校档案：\n${compactDigest}` },
    ];
}

export function normalizeGlobalSynthesis(value: Record<string, unknown>, fallbackTitle: string) {
    const profileRecord = asRecord(value.profile);
    const worldRecord = asRecord(value.world);
    const causalLinks = asRecords(value.causalLinks)
        .map((record) => ({ cause: asString(record.cause), effect: asString(record.effect) }))
        .filter((link) => link.cause && link.effect);
    return {
        profile: {
            title: asString(profileRecord.title) || fallbackTitle,
            author: asString(profileRecord.author),
            genre: asString(profileRecord.genre),
            worldType: asString(profileRecord.worldType),
            era: asString(profileRecord.era),
            mainLocations: asStrings(profileRecord.mainLocations),
            mainline: asString(profileRecord.mainline),
            coreConflict: asString(profileRecord.coreConflict),
        },
        world: {
            summary: asString(worldRecord.summary),
            rules: asStrings(worldRecord.rules),
            powerSystem: asString(worldRecord.powerSystem),
            socialStructure: asString(worldRecord.socialStructure),
        },
        causalLinks,
        warnings: asStrings(value.warnings),
    };
}

export function normalizeCrosscheck(value: Record<string, unknown>) {
    const issues = asRecords(value.issues).map((record) => {
        const level = asString(record.level);
        const message = asString(record.message);
        return message ? `${level === "error" ? "错误" : level === "info" ? "提示" : "警告"}：${message}` : "";
    }).filter(Boolean);
    return { issues, warnings: [...issues, ...asStrings(value.warnings)] };
}
