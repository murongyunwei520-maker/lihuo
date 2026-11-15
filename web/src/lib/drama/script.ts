import { nanoid } from "nanoid";

import type { DramaScript, DramaShot } from "@/types/drama";

import { SHOT_MAX_SECONDS, SHOT_MIN_SECONDS, shotNumber } from "./schema";

// 剧本处理：读上传文件、把剧本文本拆成分镜结构。
// AI 拆镜在 ai.ts；这里提供纯规则降级，保证没配 AI 或调用失败时也能落地。

export const SCRIPT_ACCEPT = [".txt", ".md", ".markdown", ".log"];

/** 把上传的剧本文件读成纯文本；只接受小文本文件，避免把大文件读进内存。 */
export async function readScriptFile(file: File): Promise<string> {
    const MAX_BYTES = 200 * 1024; // 200KB 纯文本足够一集短剧剧本
    if (file.size > MAX_BYTES) {
        throw new Error("剧本文件过大，请控制在 200KB 以内，或直接粘贴文本");
    }
    const text = await file.text();
    if (!text.trim()) throw new Error("剧本文件是空的");
    return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
}

/** 按行拆出「场景」与「台词」的粗粒度结构：一行一个镜头，空行分段。 */
function splitLines(text: string): string[] {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

/**
 * 纯规则拆镜：不做语义理解，只把剧本切成「段落 → 镜头」。
 * 每个镜头默认 5s，超过单镜上限的段落提示用户手动拆分。
 * 这是 AI 拆镜不可用时的降级，也用于「没配文本模型」的场景。
 */
export function ruleBasedSplit(scriptText: string): DramaShot[] {
    const lines = splitLines(scriptText);
    if (!lines.length) return [];

    const shots: DramaShot[] = [];
    for (const line of lines) {
        const isDialog = /^["「『（(]?[^」』）)]*[」』）)]?\s*[:：]/.test(line) || /^[^。！？]{0,20}[说|问|道|喊|答]/.test(line);
        const seconds = Math.min(SHOT_MAX_SECONDS, Math.max(SHOT_MIN_SECONDS, line.length > 24 ? 6 : 5));
        shots.push({
            id: nanoid(),
            no: shotNumber(shots.length),
            scene: "",
            size: "中景",
            move: "固定",
            light: "left",
            seconds,
            line: isDialog ? line : "",
            prompt: isDialog ? "" : line,
            status: "pending",
            assetIds: [],
        });
    }
    return shots;
}

/** 把 AI 返回的镜头数组标准化，丢掉缺字段、时长越界的坏数据。 */
export function normalizeAiShots(raw: unknown): DramaShot[] {
    if (!Array.isArray(raw)) return [];
    const shots: DramaShot[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const scene = String(record.scene ?? "").trim();
        const size = String(record.size ?? "中景").trim() || "中景";
        const move = String(record.move ?? "固定").trim() || "固定";
        const light = record.light === "right" ? ("right" as const) : record.light === "none" ? ("none" as const) : ("left" as const);
        const secondsRaw = Number(record.seconds ?? 5);
        const seconds = Number.isFinite(secondsRaw) ? Math.round(secondsRaw) : 5;
        const line = String(record.line ?? "").trim();
        const prompt = String(record.prompt ?? "").trim();
        if (!scene && !line && !prompt) continue;
        shots.push({
            id: nanoid(),
            no: shotNumber(shots.length),
            scene,
            size,
            move,
            light,
            seconds: Math.min(SHOT_MAX_SECONDS, Math.max(SHOT_MIN_SECONDS, seconds)),
            line,
            prompt: prompt || (line ? "" : line),
            note: typeof record.note === "string" ? record.note : undefined,
            status: "pending",
            assetIds: [],
        });
    }
    return shots;
}

export function makeScript(text: string, source: DramaScript["source"], extra?: Partial<DramaScript>): DramaScript {
    return { ...extra, text: text.trim(), source };
}
