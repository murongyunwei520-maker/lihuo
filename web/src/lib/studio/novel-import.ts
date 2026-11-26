import type { NovelImportProgress, NovelSourceFormat, StudioNovel } from "@/types/novel";

import { NOVEL_IMPORT_MAX_BYTES, NOVEL_SOURCE_FORMAT_LABEL } from "@/types/novel";
import { makeStudioNovel, simpleHash, splitNovelChapters, splitPdfPages } from "./novel-chapters";

// 只在小说的导入动作里动态加载 mammoth / pdfjs-dist，应用启动不加载这两个重型依赖。

export class NovelImportError extends Error {
    code: string;
    file?: { name: string; mimeType: string; bytes: number; lastModified?: number; hash: string; format: NovelSourceFormat };
    constructor(code: string, message: string, file?: NovelImportError["file"]) {
        super(message);
        this.name = "NovelImportError";
        this.code = code;
        this.file = file;
    }
}

type Progress = (progress: NovelImportProgress) => void;

function formatOf(file: File): NovelSourceFormat {
    const name = file.name.toLowerCase();
    if (name.endsWith(".txt")) return "txt";
    if (name.endsWith(".docx")) return "docx";
    if (name.endsWith(".pdf")) return "pdf";
    throw new NovelImportError("unsupported_format", `暂不支持「${file.name}」；请选择 TXT、DOCX 或 PDF 文件（旧版 .doc 请先另存为 .docx）`);
}

async function sha256(buffer: ArrayBuffer) {
    if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    }
    // 非加密环境兜底只用于去重提示，不作为安全哈希。
    let fallback = 0;
    for (const byte of new Uint8Array(buffer)) fallback = Math.imul(fallback ^ byte, 16777619);
    return `fallback-${(fallback >>> 0).toString(16)}`;
}

function decodeCount(bytes: Uint8Array, encoding: string) {
    try {
        return new TextDecoder(encoding, { fatal: false }).decode(bytes);
    } catch {
        return "";
    }
}

function replacementRatio(text: string) {
    if (!text) return 1;
    return (text.match(/\uFFFD/g)?.length ?? 0) / text.length;
}

function decodeText(buffer: ArrayBuffer, file: File) {
    const bytes = new Uint8Array(buffer);
    const bom = bytes.slice(0, 4);
    if (bom[0] === 0xef && bom[1] === 0xbb && bom[2] === 0xbf) return { text: decodeCount(bytes, "utf-8").replace(/^\uFEFF/, ""), encoding: "UTF-8 BOM" };
    if (bom[0] === 0xff && bom[1] === 0xfe) return { text: decodeCount(bytes, "utf-16le").replace(/^\uFEFF/, ""), encoding: "UTF-16 LE" };
    if (bom[0] === 0xfe && bom[1] === 0xff) return { text: decodeCount(bytes, "utf-16be").replace(/^\uFEFF/, ""), encoding: "UTF-16 BE" };

    const utf8 = decodeCount(bytes, "utf-8");
    if (replacementRatio(utf8) === 0) return { text: utf8, encoding: "UTF-8" };
    const candidates = [
        { text: utf8, encoding: "UTF-8（含无法识别字节）" },
        { text: decodeCount(bytes, "gb18030"), encoding: "GB18030" },
        { text: decodeCount(bytes, "big5"), encoding: "Big5" },
    ].filter((item) => item.text);
    const best = candidates.reduce((left, right) => (replacementRatio(left.text) <= replacementRatio(right.text) ? left : right));
    if (!best.text.trim()) throw new NovelImportError("decode_failed", `文本解码失败：${file.name} 不是可识别的 UTF-8 / GB18030 / Big5 文本`);
    return best;
}

function validateMagic(buffer: ArrayBuffer, format: NovelSourceFormat, file: File) {
    const bytes = new Uint8Array(buffer);
    if (format === "pdf") {
        // PDF 规范允许 %PDF 出现在文件前 1024 字节内，不要只检查第 1 个字节。
        const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
        if (!head.includes("%PDF")) throw new NovelImportError("invalid_pdf", `${file.name} 不是有效的 PDF（缺少 %PDF 文件头）`);
    }
    if (format === "docx") {
        const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
        if (!zip) throw new NovelImportError("invalid_docx", `${file.name} 不是有效的 DOCX（它不是 ZIP 容器；旧版 .doc 请另存为 .docx）`);
    }
}

async function parseDocx(buffer: ArrayBuffer, file: File, onProgress: Progress) {
    onProgress({ stage: "extracting", percent: 45, message: "正在提取 DOCX 正文…" });
    const mammoth = await import("mammoth");
    let result: Awaited<ReturnType<typeof mammoth.extractRawText>>;
    try {
        result = await mammoth.extractRawText({ arrayBuffer: buffer });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new NovelImportError("invalid_docx", `${file.name} 解析失败：DOCX 压缩包可能已损坏、受密码保护或不是有效的 Word 文档（${detail}）`);
    }
    const warnings = result.messages.filter((item) => item.type === "warning").map((item) => `DOCX 解析提示：${item.message}`);
    if (!result.value.trim()) throw new NovelImportError("empty_document", `${file.name} 没有可提取正文（文档可能为空或图片型内容）`);
    return { text: result.value, warnings };
}

async function parsePdf(buffer: ArrayBuffer, file: File, onProgress: Progress) {
    onProgress({ stage: "extracting", percent: 30, message: "正在加载 PDF 解析器…" });
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false });
    let pdf: Awaited<typeof task.promise>;
    try {
        pdf = await task.promise;
    } catch (error) {
        const name = (error as { name?: string })?.name;
        const message = error instanceof Error ? error.message : String(error);
        if (name === "PasswordException") throw new NovelImportError("pdf_password", `${file.name} 受密码保护；请先解除密码后再导入`);
        throw new NovelImportError("invalid_pdf", `PDF 打开失败：${message}`);
    }
    try {
        const pages: { page: number; text: string }[] = [];
        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
            const page = await pdf.getPage(pageNo);
            const content = await page.getTextContent();
            let line = "";
            const lines: string[] = [];
            for (const item of content.items) {
                if (!("str" in item)) continue;
                line += item.str;
                if (item.hasEOL) {
                    lines.push(line);
                    line = "";
                }
            }
            if (line.trim()) lines.push(line);
            pages.push({ page: pageNo, text: lines.join("\n").trim() });
            onProgress({ stage: "extracting", percent: 30 + Math.round((pageNo / pdf.numPages) * 45), message: `正在读取 PDF 第 ${pageNo}/${pdf.numPages} 页…` });
        }
        const total = pages.reduce((sum, page) => sum + page.text.length, 0);
        if (total < 40) throw new NovelImportError("pdf_no_text", `${file.name} 没有足够的可提取文字，可能是扫描件或图片型 PDF；阶段 2A 不做 OCR，不能伪装解析成功`);
        const emptyPages = pages.filter((page) => !page.text).length;
        const warnings = emptyPages ? [`PDF 有 ${emptyPages} 页没有可提取文本，已从正文过滤；章节页码范围按有文本页重新计算`] : [];
        return { pages, warnings };
    } finally {
        await task.destroy().catch(() => undefined);
    }
}

function withCommonWarnings(novel: StudioNovel, file: File, format: NovelSourceFormat, extra: string[]) {
    const warnings = [...novel.warnings, ...extra];
    if (format === "txt" && /[\uFFFD]/.test(novel.chapters.map((chapter) => chapter.text).join(""))) warnings.push("TXT 解码后仍含无法识别字符，请检查编码或转存为 UTF-8");
    if (file.size > 8 * 1024 * 1024) warnings.push(`文件约 ${(file.size / 1024 / 1024).toFixed(1)} MB，属于长篇；分析前会显示预计调用次数`);
    return { ...novel, warnings };
}

export async function parseNovelFile(file: File, onProgress: Progress = () => undefined): Promise<StudioNovel> {
    const format = formatOf(file);
    if (file.size <= 0) throw new NovelImportError("empty_file", `${file.name} 是空文件`, undefined);
    if (file.size > NOVEL_IMPORT_MAX_BYTES) throw new NovelImportError("file_too_large", `${file.name} 为 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 ${NOVEL_IMPORT_MAX_BYTES / 1024 / 1024} MB 上限`);
    onProgress({ stage: "reading", percent: 5, message: `正在读取 ${NOVEL_SOURCE_FORMAT_LABEL[format]}…` });
    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);
    validateMagic(buffer, format, file);

    let text = "";
    let preamble = "";
    let chapters = [] as StudioNovel["chapters"];
    let warnings: string[] = [];
    let encoding = format === "txt" ? "" : format.toUpperCase();

    if (format === "txt") {
        onProgress({ stage: "decoding", percent: 25, message: "正在识别文本编码…" });
        const decoded = decodeText(buffer, file);
        text = decoded.text;
        encoding = decoded.encoding;
        onProgress({ stage: "chapters", percent: 55, message: "正在识别章节标题…" });
        const split = splitNovelChapters(text, "txt");
        preamble = split.preamble;
        chapters = split.chapters;
        warnings = split.warnings;
    } else if (format === "docx") {
        const docx = await parseDocx(buffer, file, onProgress);
        text = docx.text;
        warnings.push(...docx.warnings);
        onProgress({ stage: "chapters", percent: 65, message: "正在识别 DOCX 章节标题…" });
        const split = splitNovelChapters(text, "docx");
        preamble = split.preamble;
        chapters = split.chapters;
        warnings.push(...split.warnings);
    } else {
        const pdf = await parsePdf(buffer, file, onProgress);
        warnings.push(...pdf.warnings);
        text = pdf.pages.map((page) => page.text).join("\n\n");
        onProgress({ stage: "chapters", percent: 78, message: "正在识别 PDF 章节标题…" });
        const split = splitPdfPages(pdf.pages);
        preamble = split.preamble;
        chapters = split.chapters;
        warnings.push(...split.warnings);
    }

    if (!chapters.length || !text.trim()) throw new NovelImportError("empty_document", `${file.name} 没有可解析正文`);

    const novel = makeStudioNovel({
        fileHash: hash,
        format,
        name: file.name,
        mimeType: file.type || `application/${format}`,
        bytes: file.size,
        lastModified: file.lastModified,
        encoding,
        preamble,
        chapters,
        warnings,
    });
    onProgress({ stage: "saving", percent: 92, message: "正在保存原文与章节结构…" });
    return withCommonWarnings(novel, file, format, []);
}

export function makeFailedNovel(file: File, error: unknown, format?: NovelSourceFormat): StudioNovel {
    const now = new Date().toISOString();
    const resolvedFormat = format ?? (file.name.toLowerCase().endsWith(".pdf") ? "pdf" : file.name.toLowerCase().endsWith(".docx") ? "docx" : "txt");
    return {
        id: `novel-failed-${Date.now().toString(36)}`,
        file: { name: file.name, mimeType: file.type, bytes: file.size, lastModified: file.lastModified, hash: "", format: resolvedFormat },
        status: "failed",
        encoding: "",
        parserVersion: "stage2a-1",
        importedAt: now,
        updatedAt: now,
        preamble: "",
        chapters: [],
        charCount: 0,
        chapterCount: 0,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
    };
}

export function makePastedNovel(text: string): StudioNovel {
    const cleaned = text.replace(/\r\n?/g, "\n").trim();
    if (!cleaned) throw new NovelImportError("empty_paste", "粘贴正文为空");
    const bytes = new TextEncoder().encode(cleaned).length;
    if (bytes > NOVEL_IMPORT_MAX_BYTES) throw new NovelImportError("file_too_large", `粘贴正文超过 ${NOVEL_IMPORT_MAX_BYTES / 1024 / 1024} MB 上限`);
    const split = splitNovelChapters(cleaned, "paste");
    return makeStudioNovel({
        fileHash: `paste-${simpleHash(cleaned)}`,
        format: "paste",
        name: "粘贴正文.txt",
        mimeType: "text/plain",
        bytes,
        encoding: "粘贴文本",
        preamble: split.preamble,
        chapters: split.chapters,
        warnings: split.warnings,
    });
}
