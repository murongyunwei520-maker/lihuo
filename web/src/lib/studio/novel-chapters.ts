import type { NovelChapter, NovelChapterChunk, NovelSourceFormat, StudioNovel } from "@/types/novel";

import { NOVEL_CHUNK_CHAR_LIMIT, NOVEL_PARSER_VERSION } from "@/types/novel";

// 章节识别只做保守启发式：标题行必须短且完整命中，正文里的“第一章”句子不会被当作标题。
// 解析失败或没有标题时降级为单章全文，不伪造章节数。

const HEADING_PATTERNS: RegExp[] = [
    /^\s*(第[零〇一二三四五六七八九十百千万两0-9]+[章回节卷部篇])(?:\s*[：:、.\-]?\s*[^\n]{0,48})?\s*$/,
    /^\s*(Chapter\s+[0-9IVXLC]+)(?:\s*[：:.\-]?\s*[^\n]{0,48})?\s*$/i,
    /^\s*(序章|楔子|引子|前言|尾声|后记|终章|番外)(?:\s*[：:、.\-]?\s*[^\n]{0,48})?\s*$/,
    /^\s*【(第[零〇一二三四五六七八九十百千万两0-9]+[章回节卷部篇]|序章|楔子|引子|尾声|终章|番外)(?:\s*[：:、.\-]?\s*[^\n]{0,48})?】\s*$/,
];

function normalizeText(text: string) {
    return text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n");
}

export function simpleHash(input: string): string {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function chapterTitle(line: string) {
    const trimmed = line.trim().replace(/^【|】$/g, "").replace(/\s+/g, " ");
    if (!trimmed || trimmed.length > 72) return "";
    return HEADING_PATTERNS.some((pattern) => pattern.test(trimmed)) ? trimmed : "";
}

function fallbackTitle(index: number, total: number) {
    if (total <= 1) return "全文";
    return `第 ${index + 1} 章`;
}

export function splitNovelChapters(rawText: string, format: NovelSourceFormat): { preamble: string; chapters: NovelChapter[]; warnings: string[] } {
    const text = normalizeText(rawText).trim();
    if (!text) throw new Error("没有可解析的正文：文件为空或没有可提取文本");
    const lines = text.split("\n");
    const headings: { lineIndex: number; title: string; charStart: number }[] = [];
    let cursor = 0;
    lines.forEach((line, lineIndex) => {
        const title = chapterTitle(line);
        if (title) headings.push({ lineIndex, title, charStart: cursor });
        cursor += line.length + 1;
    });

    if (!headings.length) {
        return {
            preamble: "",
            chapters: [
                {
                    id: `chapter-${simpleHash(text.slice(0, 240))}-1`,
                    no: 1,
                    title: format === "paste" ? "粘贴正文" : "全文",
                    text,
                    charStart: 0,
                    charEnd: text.length,
                    paragraphStart: 0,
                    paragraphEnd: lines.length,
                    detectedBy: "fallback",
                },
            ],
            warnings: ["没有识别到章节标题，已按单章全文保存；原文没有被截断。"],
        };
    }

    const warnings: string[] = [];
    const chapterStarts = headings.map((heading, index) => ({
        ...heading,
        charEnd: index + 1 < headings.length ? headings[index + 1].charStart : text.length,
    }));
    const preamble = text.slice(0, chapterStarts[0].charStart).trim();
    const chapters: NovelChapter[] = chapterStarts.map((heading, index) => {
        const segment = text.slice(heading.charStart, heading.charEnd);
        if (!segment.trim()) warnings.push(`${heading.title} 没有正文，已保留空章节记录`);
        return {
            id: `chapter-${simpleHash(`${heading.title}-${heading.charStart}-${segment.slice(0, 80)}`)}`,
            no: index + 1,
            title: heading.title,
            text: segment,
            charStart: heading.charStart,
            charEnd: heading.charEnd,
            paragraphStart: heading.lineIndex,
            paragraphEnd: chapterStarts[index + 1]?.lineIndex ?? lines.length,
            detectedBy: "heading",
        };
    });

    // 防止把简介里的“第一章”误识别成章节后丢掉前置内容；有前置正文时至少保留为 preamble。
    if (preamble.length > 0) warnings.push(`章节标题前保留了 ${preamble.length} 字前置内容`);
    return { preamble, chapters, warnings };
}

/** PDF 页面文本按页保留；章节标题仍按行识别，分页信息写进章节。 */
export function splitPdfPages(pages: { page: number; text: string }[]): { preamble: string; chapters: NovelChapter[]; warnings: string[] } {
    // 过滤空白页后再拼正文，页范围也必须基于同一份“有文本页”序列计算，否则 pageStart/pageEnd 会整体前移。
    const nonEmpty = pages.map((item) => ({ page: item.page, text: item.text.trim() })).filter((item) => item.text.length > 0);
    const joined = nonEmpty.map((item) => item.text).join("\n\n");
    const base = splitNovelChapters(joined, "pdf");
    const pageRanges = nonEmpty.reduce<{ start: number; end: number; page: number }[]>((acc, item) => {
        const start = acc.length ? acc[acc.length - 1].end + 2 : 0;
        const end = start + item.text.length;
        acc.push({ start, end, page: item.page });
        return acc;
    }, []);
    const chapters = base.chapters.map((chapter) => {
        const pageStart = pageRanges.find((range) => chapter.charStart >= range.start && chapter.charStart <= range.end)?.page;
        const pageEnd = [...pageRanges].reverse().find((range) => chapter.charEnd - 1 >= range.start && chapter.charEnd - 1 <= range.end)?.page;
        return { ...chapter, pageStart, pageEnd };
    });
    if (joined.length < 40) base.warnings.push("PDF 可提取文本很少，可能是扫描件或图片型 PDF；不会伪造解析成功。");
    return { ...base, chapters };
}

export function stripChapterTitle(chapter: NovelChapter) {
    const text = chapter.text.trimStart();
    if (chapter.detectedBy !== "heading" || !chapter.title) return text;
    const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
    if (chapterTitle(firstLine) && firstLine.length <= 72) return text.slice(firstLine.length).replace(/^\n/, "");
    return text;
}

const CHUNK_OVERLAP_CHAR_LIMIT = 160;
const CHUNK_HEADER_RESERVE = 120;

function naturalSplitPoint(text: string, start: number, target: number) {
    const window = text.slice(start, target);
    const minimum = Math.floor(window.length * 0.55);
    const blankLines: number[] = [];
    const lineBreaks: number[] = [];
    const sentences: number[] = [];
    const punctuation: number[] = [];
    const spaces: number[] = [];
    const consider = (bucket: number[], index: number, length: number) => {
        if (index >= minimum) bucket.push(index + length);
    };
    const blankLine = window.lastIndexOf("\n\n");
    if (blankLine >= 0) consider(blankLines, blankLine, 2);
    const lineBreak = window.lastIndexOf("\n");
    if (lineBreak >= 0) consider(lineBreaks, lineBreak, 1);
    const sentence = /[。！？!?；;…]+[”’」』）】]?/gu;
    for (const match of window.matchAll(sentence)) consider(sentences, match.index ?? -1, match[0].length);
    const comma = window.lastIndexOf("，") >= 0 ? window.lastIndexOf("，") : window.lastIndexOf(",");
    if (comma >= 0) consider(punctuation, comma, 1);
    const space = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\u3000"));
    if (space >= 0) consider(spaces, space, 1);
    for (const bucket of [blankLines, lineBreaks, sentences, punctuation, spaces]) {
        if (bucket.length) return start + Math.max(...bucket);
    }
    return target;
}

function splitLongChapter(chapter: NovelChapter, maxChars: number): { text: string; part: number }[] {
    const body = stripChapterTitle(chapter);
    if (body.length <= maxChars) return [{ text: body, part: 1 }];
    const overlap = Math.min(CHUNK_OVERLAP_CHAR_LIMIT, Math.max(0, Math.floor(maxChars / 50)));
    const bodyBudget = Math.max(120, maxChars - CHUNK_HEADER_RESERVE - overlap);
    const sections: string[] = [];
    let cursor = 0;
    while (cursor < body.length) {
        const target = Math.min(body.length, cursor + bodyBudget);
        const end = target >= body.length ? body.length : naturalSplitPoint(body, cursor, target);
        sections.push(body.slice(cursor, end).trim());
        if (end >= body.length) break;
        cursor = Math.max(cursor + 1, end - overlap);
    }
    const validSections = sections.filter(Boolean);
    return validSections.map((part, index) => ({
        text: `【${chapter.title || `第 ${chapter.no} 章`} · 第 ${index + 1}/${validSections.length} 部分】\n${part}`,
        part: index + 1,
    }));
}

export function buildNovelChunks(chapters: NovelChapter[], maxChars = NOVEL_CHUNK_CHAR_LIMIT): NovelChapterChunk[] {
    if (!chapters.length) return [];
    const chunks: { chapterIds: string[]; parts: string[]; charCount: number }[] = [];
    let current: { chapterIds: string[]; parts: string[]; charCount: number } | null = null;

    const pushCurrent = () => {
        if (current?.parts.length) chunks.push(current);
        current = null;
    };

    for (const chapter of chapters) {
        const parts = splitLongChapter(chapter, maxChars);
        for (const part of parts) {
            const piece = `【${chapter.title || `第 ${chapter.no} 章`}】\n${part.text}`;
            if (part.text.length >= maxChars) {
                pushCurrent();
                chunks.push({ chapterIds: [chapter.id], parts: [piece], charCount: piece.length });
                continue;
            }
            if (!current) current = { chapterIds: [], parts: [], charCount: 0 };
            if (current.charCount + piece.length > maxChars && current.parts.length) {
                pushCurrent();
                current = { chapterIds: [], parts: [], charCount: 0 };
            }
            if (!current) current = { chapterIds: [], parts: [], charCount: 0 };
            if (!current.chapterIds.includes(chapter.id)) current.chapterIds.push(chapter.id);
            current.parts.push(piece);
            current.charCount += piece.length;
        }
    }
    pushCurrent();

    return chunks.map((chunk, index) => ({
        id: `chunk-${index + 1}-${simpleHash(chunk.parts.join("\n"))}`,
        index,
        chapterIds: chunk.chapterIds,
        text: chunk.parts.join("\n\n"),
        charCount: chunk.charCount,
    }));
}

export function makeStudioNovel(args: {
    fileHash: string;
    format: NovelSourceFormat;
    name: string;
    mimeType: string;
    bytes: number;
    lastModified?: number;
    encoding: string;
    preamble: string;
    chapters: NovelChapter[];
    warnings: string[];
    status?: StudioNovel["status"];
    error?: string;
}): StudioNovel {
    const now = new Date().toISOString();
    const id = `novel-${args.fileHash.slice(0, 12)}`;
    return {
        id,
        file: {
            name: args.name,
            mimeType: args.mimeType,
            bytes: args.bytes,
            lastModified: args.lastModified,
            hash: args.fileHash,
            format: args.format,
        },
        status: args.status ?? "ready",
        encoding: args.encoding,
        parserVersion: NOVEL_PARSER_VERSION,
        importedAt: now,
        updatedAt: now,
        preamble: args.preamble,
        chapters: args.chapters,
        charCount: args.chapters.reduce((total, chapter) => total + chapter.text.length, 0),
        chapterCount: args.chapters.length,
        warnings: args.warnings,
        error: args.error,
    };
}
