import type { NovelAnalysis, NovelAnalysisChunk, NovelAnalysisRun, NovelChapterChunk, NovelChapterDigest, StudioNovel } from "@/types/novel";

import { NOVEL_RUN_STATUS_LABEL } from "@/types/novel";
import { buildNovelChunks } from "./novel-chapters";
import { chapterPrompt, crosscheckPrompt, globalPrompt, normalizeChapterExtract, normalizeCrosscheck, normalizeGlobalSynthesis } from "./novel-analysis";
import { buildCompactDigest, estimateNovelAnalysisCalls, finalizeNovelAnalysis, mergeChapterDigests } from "./novel-merge";
import { requestNovelText, type NovelTextModelRuntime } from "./novel-model";

// 分析任务只做一层编排：浏览器是执行端，持久化的是任务状态和分块结果。
// 刷新后没有服务端任务可恢复，因此上层会把 running/submitting 标成 interrupted，用户确认后再继续。

export class NovelAnalysisRunError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "NovelAnalysisRunError";
        this.code = code;
    }
}

const ACTIVE_RUN_STATUSES = new Set(["pending", "queued", "submitting", "running", "cancelling"]);

export function isActiveAnalysisRun(run: NovelAnalysisRun | undefined) {
    return Boolean(run && ACTIVE_RUN_STATUSES.has(run.status));
}

export function createNovelAnalysisRun(args: {
    novel: StudioNovel;
    runtime: NovelTextModelRuntime;
    existingVersion?: number;
}): NovelAnalysisRun {
    const chunks = buildNovelChunks(args.novel.chapters).map<NovelAnalysisChunk>((chunk, index) => ({
        id: chunk.id,
        index,
        chapterIds: chunk.chapterIds,
        status: "pending",
        attempts: 0,
    }));
    const now = new Date().toISOString();
    return {
        id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        novelId: args.novel.id,
        novelHash: args.novel.file.hash,
        status: "queued",
        phase: "prepare",
        progress: 0,
        chunksTotal: chunks.length,
        chunksDone: 0,
        currentLabel: `已准备 ${chunks.length} 个分块；预计 ${estimateNovelAnalysisCalls(chunks.length)} 次模型调用`,
        model: { channelId: args.runtime.selection.channelId, modelId: args.runtime.selection.modelId, label: args.runtime.label },
        modelParams: args.runtime.params,
        startedAt: now,
        updatedAt: now,
        chunks,
    };
}

function chapterChunkFromRun(chunk: NovelAnalysisChunk, allChunks: NovelChapterChunk[]): NovelChapterChunk {
    const source = allChunks.find((item) => item.id === chunk.id) ?? allChunks[chunk.index];
    if (!source) throw new NovelAnalysisRunError("chunk_missing", "分析分块与当前原文不一致，请重新分析");
    return source;
}

export function parseModelJson(text: string): Record<string, unknown> {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new NovelAnalysisRunError("invalid_json", "模型返回中没有 JSON 对象");
    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON 根节点不是对象");
        return parsed as Record<string, unknown>;
    } catch (error) {
        throw new NovelAnalysisRunError("invalid_json", `模型返回不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
}

function requestOptions(runtime: NovelTextModelRuntime, chunk = false) {
    return {
        ...(typeof runtime.params.temperature === "number" ? { temperature: runtime.params.temperature } : {}),
        ...(typeof runtime.params.maxTokens === "number" ? { maxTokens: chunk ? Math.max(1024, Number(runtime.params.maxTokens)) : Math.max(2048, Number(runtime.params.maxTokens)) } : {}),
    };
}

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
    return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && (error.name === "AbortError" || /aborted|cancelled|取消/i.test(error.message)));
}

function updateRun(run: NovelAnalysisRun, patch: Partial<NovelAnalysisRun>, onRun: (run: NovelAnalysisRun) => void) {
    const next = { ...run, ...patch, updatedAt: new Date().toISOString() };
    onRun(next);
    return next;
}

function markChunk(run: NovelAnalysisRun, chunkIndex: number, patch: Partial<NovelAnalysisChunk>) {
    const chunks = run.chunks.map((chunk, index) => (index === chunkIndex ? { ...chunk, ...patch } : chunk));
    const done = chunks.filter((chunk) => chunk.status === "succeeded").length;
    return { chunks, chunksDone: done, progress: Math.round((done / Math.max(chunks.length, 1)) * 75) };
}

export type NovelAnalysisCallbacks = {
    onRun: (run: NovelAnalysisRun) => void;
    onAnalysis: (analysis: NovelAnalysis) => void;
};

export async function executeNovelAnalysis(args: {
    novel: StudioNovel;
    run: NovelAnalysisRun;
    runtime: NovelTextModelRuntime;
    version: number;
    signal?: AbortSignal;
    callbacks: NovelAnalysisCallbacks;
}): Promise<{ run: NovelAnalysisRun; analysis?: NovelAnalysis }> {
    let run = args.run;
    let calls = 0;
    const onRun = args.callbacks.onRun;
    if (run.novelHash !== args.novel.file.hash || run.novelId !== args.novel.id) throw new NovelAnalysisRunError("run_mismatch", "分析任务与当前小说不一致，请重新分析");
    if (!run.chunks.length) throw new NovelAnalysisRunError("empty_novel", "当前小说没有可分析章节");
    const allChunks = buildNovelChunks(args.novel.chapters);

    run = updateRun(run, { status: "submitting", phase: "prepare", error: undefined, currentLabel: "正在提交项目文本模型…", finishedAt: undefined }, onRun);
    if (args.signal?.aborted) {
        run = updateRun(run, { status: "cancelled", error: "请求在提交前取消", finishedAt: new Date().toISOString() }, onRun);
        return { run };
    }
    run = updateRun(run, { status: "running", phase: "chapter", currentLabel: "开始逐章分析…" }, onRun);

    const chunkDigests: NovelChapterDigest[] = [];
    for (let index = 0; index < run.chunks.length; index += 1) {
        if (args.signal?.aborted) {
            run = updateRun(run, { status: "cancelled", phase: "chapter", error: "用户取消分析", finishedAt: new Date().toISOString() }, onRun);
            return { run };
        }
        const existing = run.chunks[index];
        if (existing.status === "succeeded" && existing.digest) {
            chunkDigests.push(existing.digest);
            continue;
        }
        const chunk = chapterChunkFromRun(existing, allChunks);
        run = updateRun(
            run,
            {
                status: "running",
                phase: "chapter",
                currentLabel: `分析第 ${index + 1}/${run.chunksTotal} 块（${NOVEL_RUN_STATUS_LABEL.running}）…`,
                ...markChunk(run, index, { status: "running", attempts: existing.attempts + 1, error: undefined, startedAt: new Date().toISOString() }),
            },
            onRun,
        );
        try {
            calls += 1;
            const previous = chunkDigests.slice(-2).map((digest) => digest.summary).filter(Boolean);
            const result = await requestNovelText(args.runtime, chapterPrompt(args.novel, chunk, previous), { ...requestOptions(args.runtime, true), signal: args.signal });
            const parsed = parseModelJson(result);
            const digest = normalizeChapterExtract(parsed, args.novel, chunk);
            chunkDigests.push(digest);
            run = updateRun(
                run,
                {
                    currentLabel: `第 ${index + 1}/${run.chunksTotal} 块完成`,
                    ...markChunk(run, index, { status: "succeeded", digest, finishedAt: new Date().toISOString() }),
                },
                onRun,
            );
        } catch (error) {
            const aborted = isAbortError(error);
            const status = aborted ? "cancelled" : "failed";
            run = updateRun(
                run,
                {
                    status,
                    phase: "chapter",
                    currentLabel: aborted ? "分析已取消" : `第 ${index + 1} 块失败`,
                    error: errorText(error),
                    finishedAt: new Date().toISOString(),
                    ...markChunk(run, index, { status: aborted ? "cancelled" : "failed", error: errorText(error), finishedAt: new Date().toISOString() }),
                },
                onRun,
            );
            if (aborted) return { run };
            break;
        }
    }

    const succeededChunks = run.chunks.filter((chunk) => chunk.status === "succeeded" && chunk.digest);
    for (const chunk of succeededChunks) if (!chunkDigests.some((digest) => digest.chapterIds.join("|") === chunk.digest?.chapterIds.join("|"))) chunkDigests.push(chunk.digest!);
    if (!chunkDigests.length) {
        if (run.status !== "cancelled") {
            run = updateRun(run, { status: "failed", error: run.error ?? "所有章节分块均失败，没有可汇总的数据", finishedAt: new Date().toISOString() }, onRun);
        }
        return { run };
    }

    const failedChunks = run.chunks.filter((chunk) => chunk.status !== "succeeded").length;
    const aggregate = mergeChapterDigests(args.novel, chunkDigests);
    let synthesis: ReturnType<typeof normalizeGlobalSynthesis>;
    let crosscheckWarnings: string[] = [];
    let phaseError = "";
    try {
        run = updateRun(run, { status: "running", phase: "merge", progress: 80, currentLabel: "全局汇总中…", error: undefined }, onRun);
        if (args.signal?.aborted) throw new DOMException("用户取消分析", "AbortError");
        calls += 1;
        const result = await requestNovelText(args.runtime, globalPrompt(args.novel, buildCompactDigest(aggregate, args.novel, 12000)), { ...requestOptions(args.runtime), signal: args.signal });
        synthesis = normalizeGlobalSynthesis(parseModelJson(result), args.novel.file.name.replace(/\.(txt|docx|pdf)$/i, ""));
    } catch (error) {
        phaseError = `全局汇总失败：${errorText(error)}`;
        synthesis = normalizeGlobalSynthesis({}, args.novel.file.name.replace(/\.(txt|docx|pdf)$/i, ""));
        if (isAbortError(error)) {
            run = updateRun(run, { status: "cancelled", error: "用户取消分析", finishedAt: new Date().toISOString() }, onRun);
            return { run };
        }
    }

    try {
        run = updateRun(run, { phase: "crosscheck", progress: 90, currentLabel: "跨章节一致性校验中…" }, onRun);
        if (args.signal?.aborted) throw new DOMException("用户取消分析", "AbortError");
        calls += 1;
        const result = await requestNovelText(args.runtime, crosscheckPrompt(args.novel, buildCompactDigest(aggregate, args.novel, 12000)), { ...requestOptions(args.runtime), signal: args.signal });
        crosscheckWarnings = normalizeCrosscheck(parseModelJson(result)).warnings;
    } catch (error) {
        if (isAbortError(error)) {
            run = updateRun(run, { status: "cancelled", error: "用户取消分析", finishedAt: new Date().toISOString() }, onRun);
            return { run };
        }
        crosscheckWarnings = [`跨章节校验失败：${errorText(error)}`];
    }

    run = updateRun(run, { phase: "finalize", progress: 96, currentLabel: "写入结构化分析…" }, onRun);
    const success = failedChunks === 0 && !phaseError && !crosscheckWarnings.some((warning) => warning.startsWith("跨章节校验失败"));
    const analysis = finalizeNovelAnalysis({
        novel: args.novel,
        runId: run.id,
        version: args.version,
        model: run.model,
        modelParams: run.modelParams,
        aggregate,
        synthesis,
        crosscheckWarnings,
        chunks: run.chunks,
        calls,
        success,
        extraWarnings: [phaseError].filter(Boolean),
    });
    args.callbacks.onAnalysis(analysis);
    run = updateRun(
        run,
        {
            status: success ? "succeeded" : "failed",
            phase: "finalize",
            progress: 100,
            currentLabel: success ? "分析完成" : "分析部分完成，可查看已成功分块的结果",
            error: phaseError || (failedChunks ? `${failedChunks} 个分块失败；请重试失败分块` : undefined),
            finishedAt: new Date().toISOString(),
            resultVersion: args.version,
            chunksDone: run.chunks.filter((chunk) => chunk.status === "succeeded").length,
        },
        onRun,
    );
    return { run, analysis };
}

/** 只重置失败/未完成分块；成功分块和已存 digest 保留，避免重复调用。 */
export function prepareRetryRun(run: NovelAnalysisRun, runtime: NovelTextModelRuntime): NovelAnalysisRun {
    return {
        ...run,
        status: "queued",
        phase: "prepare",
        progress: 0,
        error: undefined,
        finishedAt: undefined,
        currentLabel: "已保留成功分块，准备重试失败/未完成分块…",
        model: { channelId: runtime.selection.channelId, modelId: runtime.selection.modelId, label: runtime.label },
        modelParams: runtime.params,
        chunks: run.chunks.map((chunk) => (chunk.status === "succeeded" && chunk.digest ? chunk : { ...chunk, status: "pending", error: undefined, startedAt: undefined, finishedAt: undefined })),
    };
}
