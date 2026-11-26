import type {
    NovelAnalysis,
    NovelAnalysisChunk,
    NovelAnalysisOverrides,
    NovelCharacter,
    NovelChapterDigest,
    NovelEvent,
    NovelEvidence,
    NovelForeshadowing,
    NovelProfile,
    NovelRelationship,
    NovelScene,
    NovelWorld,
    NovelWorldEntry,
    StudioNovel,
} from "@/types/novel";

// 分块结果是“带证据的片段”，合并阶段只做结构化去重、引用解析和矛盾检查。
// 不在这里生成新剧情；缺失信息保持为空，不能为了完整度补写。

export type NovelAggregate = {
    summaries: { chapterIds: string[]; summary: string }[];
    characters: NovelCharacter[];
    relationships: NovelRelationship[];
    worldEntries: NovelWorldEntry[];
    scenes: NovelScene[];
    events: NovelEvent[];
    foreshadowings: NovelForeshadowing[];
    warnings: string[];
};

function chapterOrder(novel: StudioNovel) {
    return new Map(novel.chapters.map((chapter, index) => [chapter.id, index]));
}

function earliestChapter(left: string, right: string, order: Map<string, number>) {
    if (!left) return right;
    if (!right) return left;
    return (order.get(left) ?? 9999) <= (order.get(right) ?? 9999) ? left : right;
}

function latestText(left: string, right: string) {
    return right.trim() ? right : left;
}

function uniqueStrings(...lists: string[][]) {
    return [...new Set(lists.flat().filter(Boolean))];
}

function evidenceKey(item: NovelEvidence) {
    const start = item.sourceLocation?.charStart;
    const end = item.sourceLocation?.charEnd;
    if (typeof start === "number" && Number.isFinite(start) && typeof end === "number" && Number.isFinite(end)) {
        return `${item.chapterId}|range|${start}|${end}`;
    }
    // 旧数据没有字符区间时才退回规范化摘录，避免同一原文在重叠分块中被重复保留。
    return `${item.chapterId}|text|${item.excerpt.replace(/\s+/gu, "")}`;
}

function mergeEvidence(left: NovelEvidence[] = [], right: NovelEvidence[] = []) {
    const merged: NovelEvidence[] = [];
    for (const item of [...left, ...right]) {
        const key = evidenceKey(item);
        const existing = merged.find((candidate) => evidenceKey(candidate) === key);
        if (existing) {
            existing.confidence = Math.max(existing.confidence, item.confidence);
            if (existing.evidenceType !== "explicit" && item.evidenceType === "explicit") existing.evidenceType = "explicit";
        } else {
            merged.push({ ...item });
        }
    }
    return merged.slice(0, 8);
}

function mergeCharacter(left: NovelCharacter, right: NovelCharacter, order: Map<string, number>): NovelCharacter {
    return {
        ...left,
        aliases: uniqueStrings(left.aliases, right.aliases),
        identity: latestText(left.identity, right.identity),
        age: latestText(left.age, right.age),
        personality: latestText(left.personality, right.personality),
        appearance: latestText(left.appearance, right.appearance),
        abilities: left.abilities.length >= right.abilities.length ? left.abilities : right.abilities,
        occupation: latestText(left.occupation, right.occupation),
        status: right.status !== "unknown" ? right.status : left.status,
        motivation: latestText(left.motivation, right.motivation),
        arc: latestText(left.arc, right.arc),
        firstChapterId: earliestChapter(left.firstChapterId, right.firstChapterId, order),
        keyChapterIds: uniqueStrings(left.keyChapterIds, right.keyChapterIds),
        fate: latestText(left.fate, right.fate),
        evidence: mergeEvidence(left.evidence, right.evidence),
    };
}

function mergeRelationship(left: NovelRelationship, right: NovelRelationship, order: Map<string, number>): NovelRelationship {
    const changes = [...left.changes, ...right.changes].reduce<NovelRelationship["changes"]>((acc, change) => {
        if (change.description && !acc.some((item) => item.chapterId === change.chapterId && item.description === change.description)) acc.push(change);
        return acc;
    }, []);
    return {
        ...left,
        changes,
        currentStatus: right.currentStatus || left.currentStatus,
        keyChapterIds: uniqueStrings(left.keyChapterIds, right.keyChapterIds),
        evidence: mergeEvidence(left.evidence, right.evidence),
    };
}

function mergeWorldEntry(left: NovelWorldEntry, right: NovelWorldEntry): NovelWorldEntry {
    return { ...left, description: left.description.length >= right.description.length ? left.description : right.description, evidence: mergeEvidence(left.evidence, right.evidence) };
}

function mergeScene(left: NovelScene, right: NovelScene, order: Map<string, number>): NovelScene {
    const variants = [...left.variants, ...right.variants].reduce<NovelScene["variants"]>((acc, item) => {
        const key = `${item.timeOfDay}|${item.weather}|${item.condition}|${item.description}`;
        if (!acc.some((candidate) => `${candidate.timeOfDay}|${candidate.weather}|${candidate.condition}|${candidate.description}` === key)) acc.push(item);
        return acc;
    }, []);
    const stateChanges = [...left.stateChanges, ...right.stateChanges].reduce<NovelScene["stateChanges"]>((acc, item) => {
        if (item.description && !acc.some((candidate) => candidate.chapterId === item.chapterId && candidate.description === item.description)) acc.push(item);
        return acc;
    }, []);
    return {
        ...left,
        type: latestText(left.type, right.type),
        space: left.space.length >= right.space.length ? left.space : right.space,
        region: latestText(left.region, right.region),
        organization: latestText(left.organization, right.organization),
        firstChapterId: earliestChapter(left.firstChapterId, right.firstChapterId, order),
        keyChapterIds: uniqueStrings(left.keyChapterIds, right.keyChapterIds),
        plotUses: uniqueStrings([left.plotUses, right.plotUses]).join("；"),
        stateChanges,
        variants,
        evidence: mergeEvidence(left.evidence, right.evidence),
    };
}

function mergeEvent(left: NovelEvent, right: NovelEvent): NovelEvent {
    return {
        ...left,
        content: left.content.length >= right.content.length ? left.content : right.content,
        participantNames: uniqueStrings(left.participantNames, right.participantNames),
        participantIds: uniqueStrings(left.participantIds, right.participantIds),
        locationName: latestText(left.locationName, right.locationName),
        preconditions: uniqueStrings(left.preconditions, right.preconditions),
        results: uniqueStrings(left.results, right.results),
        impacts: uniqueStrings(left.impacts, right.impacts),
        causeEventTitles: uniqueStrings(left.causeEventTitles, right.causeEventTitles),
        consequenceEventTitles: uniqueStrings(left.consequenceEventTitles, right.consequenceEventTitles),
        causeEventIds: uniqueStrings(left.causeEventIds, right.causeEventIds),
        consequenceEventIds: uniqueStrings(left.consequenceEventIds, right.consequenceEventIds),
        foreshadowingIds: uniqueStrings(left.foreshadowingIds, right.foreshadowingIds),
        evidence: mergeEvidence(left.evidence, right.evidence),
    };
}

function mergeForeshadowing(left: NovelForeshadowing, right: NovelForeshadowing, order: Map<string, number>): NovelForeshadowing {
    const status = left.status === "paid_off" || right.status === "paid_off" ? "paid_off" : left.status === "open" || right.status === "open" ? "open" : "unknown";
    return {
        ...left,
        firstChapterId: earliestChapter(left.firstChapterId, right.firstChapterId, order),
        relatedCharacterIds: uniqueStrings(left.relatedCharacterIds, right.relatedCharacterIds),
        relatedEventIds: uniqueStrings(left.relatedEventIds, right.relatedEventIds),
        expectedPayoffChapterId: left.expectedPayoffChapterId || right.expectedPayoffChapterId,
        expectedPayoffEvidenceType: left.expectedPayoffEvidenceType || right.expectedPayoffEvidenceType,
        actualPayoffChapterId: left.actualPayoffChapterId || right.actualPayoffChapterId,
        status,
        evidence: mergeEvidence(left.evidence, right.evidence),
    };
}

export function mergeChapterDigests(novel: StudioNovel, digests: NovelChapterDigest[]): NovelAggregate {
    const order = chapterOrder(novel);
    const aggregate: NovelAggregate = { summaries: [], characters: [], relationships: [], worldEntries: [], scenes: [], events: [], foreshadowings: [], warnings: [] };
    const sorted = [...digests].sort((left, right) => {
        const leftIndex = Math.min(...left.chapterIds.map((id) => order.get(id) ?? 9999));
        const rightIndex = Math.min(...right.chapterIds.map((id) => order.get(id) ?? 9999));
        return leftIndex - rightIndex;
    });
    for (const digest of sorted) {
        if (digest.summary) aggregate.summaries.push({ chapterIds: digest.chapterIds, summary: digest.summary });
        aggregate.warnings.push(...digest.warnings);
        for (const character of digest.characters) {
            const existingIndex = aggregate.characters.findIndex((item) => item.id === character.id);
            if (existingIndex >= 0) aggregate.characters[existingIndex] = mergeCharacter(aggregate.characters[existingIndex], character, order);
            else aggregate.characters.push({ ...character });
        }
        for (const relationship of digest.relationships) {
            const existingIndex = aggregate.relationships.findIndex((item) => item.id === relationship.id);
            if (existingIndex >= 0) aggregate.relationships[existingIndex] = mergeRelationship(aggregate.relationships[existingIndex], relationship, order);
            else aggregate.relationships.push({ ...relationship });
        }
        for (const entry of digest.worldEntries) {
            const existingIndex = aggregate.worldEntries.findIndex((item) => item.id === entry.id);
            if (existingIndex >= 0) aggregate.worldEntries[existingIndex] = mergeWorldEntry(aggregate.worldEntries[existingIndex], entry);
            else aggregate.worldEntries.push({ ...entry });
        }
        for (const scene of digest.scenes) {
            const existingIndex = aggregate.scenes.findIndex((item) => item.id === scene.id);
            if (existingIndex >= 0) aggregate.scenes[existingIndex] = mergeScene(aggregate.scenes[existingIndex], scene, order);
            else aggregate.scenes.push({ ...scene });
        }
        for (const event of digest.events) {
            const existingIndex = aggregate.events.findIndex((item) => item.id === event.id);
            if (existingIndex >= 0) aggregate.events[existingIndex] = mergeEvent(aggregate.events[existingIndex], event);
            else aggregate.events.push({ ...event });
        }
        for (const foreshadowing of digest.foreshadowings) {
            const existingIndex = aggregate.foreshadowings.findIndex((item) => item.id === foreshadowing.id);
            if (existingIndex >= 0) aggregate.foreshadowings[existingIndex] = mergeForeshadowing(aggregate.foreshadowings[existingIndex], foreshadowing, order);
            else aggregate.foreshadowings.push({ ...foreshadowing });
        }
    }
    return resolveAggregateReferences(novel, aggregate);
}

/** 解析人物/地点/事件之间的稳定引用；解析不到的保持空值，不编造对象。 */
export function resolveAggregateReferences(novel: StudioNovel, aggregate: NovelAggregate): NovelAggregate {
    const order = chapterOrder(novel);
    const characterByName = new Map(aggregate.characters.map((character) => [character.name.normalize("NFKC"), character.id]));
    const sceneByName = new Map(aggregate.scenes.map((scene) => [scene.name.normalize("NFKC"), scene.id]));
    const eventByTitle = new Map(aggregate.events.map((event) => [event.title.normalize("NFKC"), event]));
    const warnings = [...aggregate.warnings];

    const events = aggregate.events.map((event) => {
        const participantIds = [...new Set(event.participantNames.map((name) => characterByName.get(name.normalize("NFKC"))).filter((id): id is string => Boolean(id)))];
        const locationId = event.locationId || sceneByName.get(event.locationName.normalize("NFKC")) || "";
        const currentIndex = order.get(event.chapterId) ?? 9999;
        const resolveTitle = (title: string, direction: "before" | "after") => {
            const direct = eventByTitle.get(title.normalize("NFKC"));
            if (direct) return direct.id;
            const candidates = aggregate.events.filter((item) => item.title.includes(title) || title.includes(item.title));
            if (!candidates.length) return "";
            const sorted = candidates.sort((left, right) => {
                const leftIndex = order.get(left.chapterId) ?? 9999;
                const rightIndex = order.get(right.chapterId) ?? 9999;
                if (direction === "before") return (currentIndex - leftIndex) - (currentIndex - rightIndex);
                return (leftIndex - currentIndex) - (rightIndex - currentIndex);
            });
            return sorted[0]?.id ?? "";
        };
        return {
            ...event,
            participantIds,
            locationId,
            causeEventIds: [...new Set(event.causeEventTitles.map((title) => resolveTitle(title, "before")).filter(Boolean))],
            consequenceEventIds: [...new Set(event.consequenceEventTitles.map((title) => resolveTitle(title, "after")).filter(Boolean))],
        };
    });

    const foreshadowings = aggregate.foreshadowings.map((item) => ({
        ...item,
        relatedEventIds: [...new Set(item.relatedEventIds.filter(Boolean))],
    }));

    // 场景的“首次出场”不能只依赖场景自身证据：地点常先在事件里被使用，
    // 而事件证据完整；用同一 locationId 的最早事件校正，避免档案首章回退。
    const indexOf = (chapterId: string) => order.get(chapterId) ?? 9999;
    const scenes = aggregate.scenes.map((scene) => {
        const eventChapters = events.filter((event) => event.locationId === scene.id && event.chapterId).map((event) => event.chapterId);
        const earliest = [...eventChapters, scene.firstChapterId].filter(Boolean).sort((left, right) => indexOf(left) - indexOf(right))[0] || "";
        return {
            ...scene,
            firstChapterId: earliest,
            keyChapterIds: uniqueStrings(scene.keyChapterIds, eventChapters),
        };
    });

    for (const event of events) {
        for (const title of event.causeEventTitles) {
            if (!title) continue;
            const resolved = event.causeEventIds.some((id) => aggregate.events.find((candidate) => candidate.id === id)?.title === title);
            if (!resolved && !aggregate.events.some((candidate) => candidate.title.includes(title) && (order.get(candidate.chapterId) ?? 9999) <= (order.get(event.chapterId) ?? 9999))) {
                warnings.push(`因果链未解析：${event.title} ← ${title}`);
            }
        }
    }
    return { ...aggregate, scenes, events, foreshadowings, warnings };
}

function evidenceLine(evidence: NovelEvidence[]) {
    const first = evidence[0];
    return first ? `${first.chapterTitle}${first.excerpt ? `：${first.excerpt.slice(0, 60)}` : ""}` : "无证据";
}

/** 给全局汇总/审校模型的压缩档案；不传整本原文，也保留章节和证据锚点。 */
export function buildCompactDigest(aggregate: NovelAggregate, novel: StudioNovel, maxChars = 18000) {
    const order = chapterOrder(novel);
    const chapterNo = (id: string) => novel.chapters[order.get(id) ?? 0]?.no ?? 0;
    const sections = [
        {
            title: "【人物】",
            entries: aggregate.characters.map((character) => `- ${character.name}（${character.id}）｜身份：${character.identity || "未明确"}｜状态：${character.status}｜首次第${chapterNo(character.firstChapterId)}章｜动机：${character.motivation || "未明确"}｜证据：${evidenceLine(character.evidence)}`),
        },
        {
            title: "【关系】",
            entries: aggregate.relationships.map((relationship) => `- ${relationship.fromName}→${relationship.toName}｜${relationship.type}｜当前：${relationship.currentStatus || "未明确"}｜变化：${relationship.changes.map((change) => `第${chapterNo(change.chapterId)}章 ${change.description}`).join("；") || "无"}｜证据：${evidenceLine(relationship.evidence)}`),
        },
        {
            title: "【世界观】",
            entries: aggregate.worldEntries.map((entry) => `- [${entry.category}] ${entry.name}：${entry.description.slice(0, 180)}｜证据：${evidenceLine(entry.evidence)}`),
        },
        {
            title: "【地点】",
            entries: aggregate.scenes.map((scene) => `- ${scene.name}（${scene.id}）｜${scene.type}｜${scene.space}｜首次第${chapterNo(scene.firstChapterId)}章｜用途：${scene.plotUses}｜变体：${scene.variants.map((variant) => [variant.timeOfDay, variant.weather, variant.condition].filter(Boolean).join("/")).join("；") || "无"}`),
        },
        {
            title: "【关键事件与因果】",
            entries: aggregate.events.map((event) => `- 第${chapterNo(event.chapterId)}章｜${event.title}（${event.id}）｜${event.content}｜因：${event.causeEventTitles.join("、") || "未明确"}｜果：${event.consequenceEventTitles.join("、") || "未明确"}｜证据：${evidenceLine(event.evidence)}`),
        },
        {
            title: "【伏笔】",
            entries: aggregate.foreshadowings.map((item) => `- ${item.content}｜首次第${chapterNo(item.firstChapterId)}章｜状态：${item.status}｜预计回收：${item.expectedPayoffChapterId ? `第${chapterNo(item.expectedPayoffChapterId)}章（${item.expectedPayoffEvidenceType || "未标注"}）` : "未明确"}｜实际回收：${item.actualPayoffChapterId ? `第${chapterNo(item.actualPayoffChapterId)}章` : "未明确"}｜证据：${evidenceLine(item.evidence)}`),
        },
    ];
    const header = `小说：${novel.file.name}｜章节：${novel.chapterCount}`;
    const compact = (line: string) => (line.length > 280 ? `${line.slice(0, 280)}…` : line);
    const total = header.length + sections.reduce((sum, section) => sum + section.title.length + section.entries.reduce((entrySum, entry) => entrySum + compact(entry).length + 1, 0), 0);
    if (total <= maxChars) return [header, ...sections.flatMap((section) => [section.title, ...section.entries.map(compact)])].join("\n");

    // 先保证每个人物/关系/世界观/地点/事件/伏笔分区至少有一条进入全局汇总，再轮转补足；
    // 避免旧实现直接 slice 把后半本书的事件和伏笔整段截掉。
    const budget = Math.max(1200, maxChars - 80);
    const selected = sections.map((section) => ({ title: section.title, entries: [] as string[], next: 0, truncated: false }));
    let used = header.length;
    for (const section of selected) {
        const first = sections[selected.indexOf(section)].entries[0];
        if (!first) continue;
        const line = compact(first);
        if (used + line.length + 1 <= budget) {
            section.entries.push(line);
            section.next = 1;
            used += line.length + 1;
        } else {
            section.truncated = true;
        }
    }
    let added = true;
    while (added) {
        added = false;
        for (let index = 0; index < selected.length; index += 1) {
            const target = selected[index];
            const source = sections[index];
            const line = source.entries[target.next];
            if (!line) continue;
            const compacted = compact(line);
            if (used + compacted.length + 1 > budget) {
                target.truncated = true;
                continue;
            }
            target.entries.push(compacted);
            target.next += 1;
            used += compacted.length + 1;
            added = true;
        }
    }
    const lines = [header, ...selected.flatMap((section) => [section.title, ...section.entries])];
    const truncated = selected.some((section) => section.truncated);
    if (truncated) lines.push("…（压缩档案按分区配额截断；完整结构化数据仍保存在项目中）");
    return lines.join("\n");
}

function inferTitle(fileName: string) {
    return fileName.replace(/\.(txt|docx|pdf)$/i, "").replace(/[_-]+/g, " ").trim() || "未命名小说";
}

function inferAuthor(preamble: string) {
    const match = preamble.match(/作者\s*[：:]\s*([^\n]{1,40})/);
    return match?.[1]?.trim() ?? "";
}

export function fallbackProfile(novel: StudioNovel, aggregate: NovelAggregate): NovelProfile {
    const analyzed = new Set(aggregate.summaries.flatMap((item) => item.chapterIds)).size;
    return {
        title: inferTitle(novel.file.name),
        author: inferAuthor(novel.preamble),
        genre: "",
        worldType: "",
        era: "",
        mainLocations: aggregate.scenes.slice(0, 12).map((scene) => scene.name),
        mainline: aggregate.summaries.slice(0, 8).map((item) => item.summary).join("；").slice(0, 1200),
        coreConflict: "",
        totalChapters: novel.chapterCount,
        analyzedChapters: analyzed,
        completeness: novel.chapterCount ? Math.round((analyzed / novel.chapterCount) * 100) : 0,
        evidence: [],
    };
}

function traceableEvidence(items: NovelEvidence[]) {
    const seen = new Set<string>();
    const valid: NovelEvidence[] = [];
    for (const item of items) {
        const start = item.sourceLocation?.charStart;
        const end = item.sourceLocation?.charEnd;
        if (!item.chapterId || !item.excerpt.trim() || start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const key = evidenceKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        valid.push(item);
    }
    return valid;
}

function countEvidence(analysis: Pick<NovelAnalysis, "profile" | "characters" | "relationships" | "world" | "scenes" | "events" | "foreshadowings">) {
    // 每个实体先按原文区间去重；不把不同实体引用的同一句话互相抵消，
    // 也不重复统计 world 根节点的派生证据和 scene 已聚合的 variants.evidence。
    const evidence = [
        ...traceableEvidence(analysis.profile.evidence),
        ...analysis.characters.flatMap((item) => traceableEvidence(item.evidence)),
        ...analysis.relationships.flatMap((item) => traceableEvidence(item.evidence)),
        ...analysis.world.entries.flatMap((item) => traceableEvidence(item.evidence)),
        ...analysis.scenes.flatMap((item) => traceableEvidence(item.evidence)),
        ...analysis.events.flatMap((item) => traceableEvidence(item.evidence)),
        ...analysis.foreshadowings.flatMap((item) => traceableEvidence(item.evidence)),
    ];
    return {
        total: evidence.length,
        explicit: evidence.filter((item) => item.evidenceType === "explicit").length,
        inferred: evidence.filter((item) => item.evidenceType === "inferred").length,
        generated: evidence.filter((item) => item.evidenceType === "generated").length,
    };
}

function deterministicIssues(novel: StudioNovel, aggregate: NovelAggregate, synthesisWarnings: string[]) {
    const order = chapterOrder(novel);
    const warnings = [...synthesisWarnings];
    const chapterNo = (id: string) => novel.chapters[order.get(id) ?? 0]?.no ?? 0;
    for (const relationship of aggregate.relationships) {
        for (const change of relationship.changes) {
            if (!change.chapterId) continue;
            const from = aggregate.characters.find((item) => item.id === relationship.fromCharacterId);
            const to = aggregate.characters.find((item) => item.id === relationship.toCharacterId);
            if ((from?.firstChapterId && chapterNo(change.chapterId) < chapterNo(from.firstChapterId)) || (to?.firstChapterId && chapterNo(change.chapterId) < chapterNo(to.firstChapterId))) {
                warnings.push(`关系变化早于人物首次出场：${relationship.fromName}→${relationship.toName} 第${chapterNo(change.chapterId)}章`);
            }
        }
    }
    for (const event of aggregate.events) {
        for (const causeId of event.causeEventIds) {
            const cause = aggregate.events.find((item) => item.id === causeId);
            if (cause && chapterNo(cause.chapterId) > chapterNo(event.chapterId)) warnings.push(`因果顺序可能倒置：${event.title} 的前置事件「${cause.title}」发生在更晚章节`);
        }
    }
    for (const item of aggregate.foreshadowings) {
        if (item.actualPayoffChapterId && chapterNo(item.actualPayoffChapterId) < chapterNo(item.firstChapterId)) warnings.push(`伏笔回收早于埋设：${item.content.slice(0, 28)}`);
    }
    return [...new Set(warnings)];
}

export function finalizeNovelAnalysis(args: {
    novel: StudioNovel;
    runId: string;
    version: number;
    model: NovelAnalysis["model"];
    modelParams: Record<string, string | number | boolean>;
    aggregate: NovelAggregate;
    synthesis: ReturnType<typeof import("./novel-analysis").normalizeGlobalSynthesis>;
    crosscheckWarnings: string[];
    chunks: NovelAnalysisChunk[];
    calls: number;
    success: boolean;
    extraWarnings?: string[];
}): NovelAnalysis {
    const { novel, aggregate, synthesis } = args;
    const fallback = fallbackProfile(novel, aggregate);
    const world: NovelWorld = {
        summary: synthesis.world.summary,
        rules: synthesis.world.rules,
        powerSystem: synthesis.world.powerSystem,
        socialStructure: synthesis.world.socialStructure,
        entries: aggregate.worldEntries,
        evidence: aggregate.worldEntries.flatMap((entry) => entry.evidence).slice(0, 24),
    };
    const events = applyCausalLinks(aggregate.events, synthesis.causalLinks);
    const analysisBase = {
        profile: { ...fallback, ...synthesis.profile, totalChapters: novel.chapterCount, analyzedChapters: fallback.analyzedChapters, completeness: fallback.completeness, evidence: [] },
        characters: aggregate.characters,
        relationships: aggregate.relationships,
        world,
        scenes: aggregate.scenes,
        events,
        foreshadowings: aggregate.foreshadowings,
    };
    const counts = countEvidence(analysisBase);
    const uniqueChapters = new Set([
        ...aggregate.summaries.flatMap((item) => item.chapterIds),
        ...aggregate.characters.flatMap((item) => item.evidence.map((evidence) => evidence.chapterId)),
        ...aggregate.relationships.flatMap((item) => item.evidence.map((evidence) => evidence.chapterId)),
        ...aggregate.scenes.flatMap((item) => item.evidence.map((evidence) => evidence.chapterId)),
        ...aggregate.events.flatMap((item) => item.evidence.map((evidence) => evidence.chapterId)),
        ...aggregate.foreshadowings.flatMap((item) => item.evidence.map((evidence) => evidence.chapterId)),
    ]);
    const analyzedChapters = Math.min(novel.chapterCount, uniqueChapters.size);
    const completeness = novel.chapterCount ? Math.round((analyzedChapters / novel.chapterCount) * 100) : 0;
    const warnings = deterministicIssues(novel, aggregate, [...synthesis.warnings, ...args.crosscheckWarnings, ...(args.extraWarnings ?? [])]);
    const now = new Date().toISOString();
    return {
        id: `analysis-${args.runId}`,
        novelId: novel.id,
        novelHash: novel.file.hash,
        version: args.version,
        runId: args.runId,
        model: args.model,
        modelParams: args.modelParams,
        createdAt: now,
        updatedAt: now,
        status: args.success && args.chunks.every((chunk) => chunk.status === "succeeded") ? "complete" : "partial",
        profile: { ...analysisBase.profile, analyzedChapters, completeness },
        characters: analysisBase.characters,
        relationships: analysisBase.relationships,
        world,
        scenes: analysisBase.scenes,
        events,
        foreshadowings: analysisBase.foreshadowings,
        stats: { chapters: novel.chapterCount, chunks: args.chunks.length, calls: args.calls, evidenceCount: counts.total, explicitCount: counts.explicit, inferredCount: counts.inferred, generatedCount: counts.generated },
        warnings,
    };
}

function applyCausalLinks(events: NovelEvent[], links: { cause: string; effect: string }[]) {
    const byTitle = new Map(events.map((event) => [event.title.normalize("NFKC"), event.id]));
    const result = events.map((event) => ({ ...event, causeEventIds: [...event.causeEventIds], consequenceEventIds: [...event.consequenceEventIds] }));
    for (const link of links) {
        const causeId = byTitle.get(link.cause.normalize("NFKC"));
        const effectId = byTitle.get(link.effect.normalize("NFKC"));
        if (!causeId || !effectId || causeId === effectId) continue;
        const cause = result.find((event) => event.id === causeId);
        const effect = result.find((event) => event.id === effectId);
        if (!cause || !effect) continue;
        if (!cause.consequenceEventIds.includes(effectId)) cause.consequenceEventIds.push(effectId);
        if (!effect.causeEventIds.includes(causeId)) effect.causeEventIds.push(causeId);
    }
    return result;
}

export function applyNovelAnalysisOverrides(analysis: NovelAnalysis, overrides: NovelAnalysisOverrides | undefined): NovelAnalysis {
    if (!overrides) return analysis;
    return {
        ...analysis,
        profile: { ...analysis.profile, ...(overrides.profile ?? {}) },
        characters: analysis.characters.map((character) => ({ ...character, ...(overrides.characters[character.id] ?? {}) })),
        relationships: analysis.relationships.map((relationship) => ({ ...relationship, ...(overrides.relationships[relationship.id] ?? {}) })),
        world: { ...analysis.world, ...(overrides.world ?? {}) },
        scenes: analysis.scenes.map((scene) => ({ ...scene, ...(overrides.scenes[scene.id] ?? {}) })),
        events: analysis.events.map((event) => ({ ...event, ...(overrides.events[event.id] ?? {}) })),
        foreshadowings: analysis.foreshadowings.map((item) => ({ ...item, ...(overrides.foreshadowings[item.id] ?? {}) })),
    };
}

export function overrideCount(overrides: NovelAnalysisOverrides | undefined) {
    if (!overrides) return 0;
    const objectKeys = (value: object | undefined) => (value ? Object.keys(value).length : 0);
    const entityCount = (value: Record<string, Record<string, unknown>> | undefined) => (value ? Object.values(value).filter((item) => item && Object.keys(item).length).length : 0);
    return entityCount(overrides.characters) + entityCount(overrides.relationships) + entityCount(overrides.scenes) + entityCount(overrides.events) + entityCount(overrides.foreshadowings) + objectKeys(overrides.profile) + objectKeys(overrides.world);
}

export function estimateNovelAnalysisCalls(chunks: number) {
    return Math.max(0, chunks) + 2;
}
