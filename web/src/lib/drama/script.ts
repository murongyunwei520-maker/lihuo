import { nanoid } from "nanoid";

import type { DramaScript, DramaShot } from "@/types/drama";

import { SHOT_MAX_SECONDS, SHOT_MIN_SECONDS, shotNumber } from "./schema";

// 剧本处理：读上传文件、把剧本文本拆成分镜结构。
// AI 拆镜在 ai.ts；这里负责 AI 结果标准化与「规则降级」。
// 规则降级也区分场景标题 / 对白 / 动作 / 旁白，不再一行一镜。

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

function clampSeconds(value: number): number {
    if (!Number.isFinite(value)) return 5;
    return Math.min(SHOT_MAX_SECONDS, Math.max(SHOT_MIN_SECONDS, Math.round(value)));
}

function secondsFor(text: string, min = SHOT_MIN_SECONDS): number {
    return clampSeconds(min + Math.ceil(text.trim().length / 20));
}

const SCENE_HEADER = /^(?:场景\s*[0-9一二三四五六七八九十百]*\s*[:：]?\s*|第\s*[0-9一二三四五六七八九十百]+\s*场\s*[:：]?\s*)/;
const CAST_LINE = /^(?:出场)?人物\s*[:：]\s*(.+)$/;
const NARRATION = /^(旁白|画外音|字幕)\s*[:：]/;
const SPEAKER_LINE = /^([^\s：:，。！？「」『』""']{1,8})\s*[:：]\s*(.+)$/;
const QUOTED = /[「『"“]([^」』"”]{1,120})[」』"”]/;

/** 解析场景标题：兼容「场景一：老宅正堂，夜，内。」与「第 1 场 老宅正堂 夜 内」。 */
function parseSceneHeader(line: string): { name: string; location: string } | null {
    if (!SCENE_HEADER.test(line)) return null;
    const body = line.replace(SCENE_HEADER, "").replace(/[。.]$/, "").trim();
    if (!body) return null;
    const [name, ...rest] = body.split(/[，,]/);
    return { name: name.trim(), location: rest.join("，").trim() };
}

/** 把一段描述切成句子，避免一句里塞多个动作。 */
function sentences(text: string): string[] {
    return text
        .split(/(?<=[。！？!?])/)
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * 纯规则降级：识别场景标题、对白、旁白和动作描述。
 * 一句动作/一段对白成一个镜头，超过单镜上限时按句拆分，并给出合理景别与时长。
 * 这是 AI 不可用时的兜底，质量低于 AI，调用方必须向用户明确说明。
 */
export function ruleBasedSplit(scriptText: string): DramaShot[] {
    const lines = scriptText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) return [];

    const shots: DramaShot[] = [];
    let scene = "";
    let location = "";
    let sceneShotIndex = 0;
    let cast: string[] = [];

    const push = (part: Omit<DramaShot, "id" | "no" | "scene" | "location" | "assetIds" | "status"> & { characters?: string[] }) => {
        // 没显式给人物时，按场次人物表 + 台词/动作里是否出现来推断，避免把所有人物塞进每一镜。
        const text = `${part.action ?? ""}${part.prompt ?? ""}${part.line ?? ""}`;
        const characters = part.characters?.length ? part.characters : cast.filter((name) => name && text.includes(name));
        shots.push({
            id: nanoid(),
            no: shotNumber(shots.length),
            scene,
            location,
            assetIds: [],
            status: "pending",
            ...part,
            characters: characters.length ? characters : undefined,
        });
        sceneShotIndex += 1;
    };

    for (const line of lines) {
        const header = parseSceneHeader(line);
        if (header) {
            scene = header.name;
            location = header.location;
            sceneShotIndex = 0;
            cast = [];
            continue;
        }

        // 「人物：沈砚、沈夫人」是人名表，不是镜头内容。
        const castLine = line.match(CAST_LINE);
        if (castLine) {
            cast = castLine[1]
                .replace(/[。；;]+$/, "")
                .split(/[、,，/／\s]+/)
                .map((name) => name.trim())
                .filter(Boolean);
            continue;
        }

        // 旁白单独成镜，line 存旁白文本，speaker 标成旁白。
        if (NARRATION.test(line)) {
            const text = line.replace(NARRATION, "").trim();
            if (!text) continue;
            push({ size: "全景", move: "固定", light: "left", seconds: secondsFor(text), line: text, speaker: "旁白", prompt: text });
            continue;
        }

        // 对白：引号内是台词，引号前的动作用作这一镜的画面。
        const quoted = line.match(QUOTED);
        if (quoted) {
            const before = line.slice(0, quoted.index ?? 0).replace(/[，,：:\s]+$/, "").trim();
            // 优先用本场人物表匹配说话人；没有人物表时按 2–3 字的人名兜底。
            const castSpeaker = cast.find((name) => before.startsWith(name)) ?? "";
            const speakerMatch = castSpeaker ? null : before.match(/^([^\s，,。]{2,3})(.*)$/);
            const speaker = castSpeaker || speakerMatch?.[1] || "";
            const action = (castSpeaker ? before.slice(castSpeaker.length) : (speakerMatch?.[2] ?? "")).replace(/^[，,：:\s]+/, "").trim();
            push({
                size: sceneShotIndex === 0 ? "中景" : "近景",
                move: "固定",
                light: "left",
                seconds: secondsFor(quoted[1]),
                line: quoted[1].trim(),
                speaker,
                action,
                prompt: "",
                characters: speaker ? [speaker] : [],
            });
            continue;
        }

        // 「沈夫人放下茶盏，说：……」这类没有引号但有冒号的台词。
        const speakerLine = line.match(SPEAKER_LINE);
        if (speakerLine && !/[。！？]$/.test(speakerLine[2])) {
            push({
                size: "近景",
                move: "固定",
                light: "left",
                seconds: secondsFor(speakerLine[2]),
                line: speakerLine[2].trim(),
                speaker: speakerLine[1],
                characters: [speakerLine[1]],
                prompt: "",
            });
            continue;
        }

        // 动作 / 环境描述：按句拆，一句一个主要视觉动作。
        for (const sentence of sentences(line)) {
            push({
                size: sceneShotIndex === 0 ? "全景" : "中景",
                move: "固定",
                light: "left",
                seconds: secondsFor(sentence),
                line: "",
                prompt: sentence,
            });
        }
    }

    return shots;
}

function asText(value: unknown): string {
    return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function asList(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean);
    if (typeof value === "string") return value.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
    return [];
}

/**
 * AI 拆镜结果标准化：字段缺失 / 类型错误 / 空镜 / 越界时长 / 重复镜号都在这里兜住。
 * 解析失败返回空数组，调用方据此降级并提示用户。
 */
export function normalizeAiShots(raw: unknown): DramaShot[] {
    const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { shots?: unknown }).shots) ? (raw as { shots: unknown[] }).shots : [];
    const shots: DramaShot[] = [];
    for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const scene = asText(record.scene);
        const location = asText(record.location);
        const line = asText(record.line);
        const action = asText(record.action);
        const prompt = asText(record.prompt);
        const sound = asText(record.sound);
        // 空镜头：没有任何可拍内容就丢掉，不生成假镜头。
        if (!scene && !line && !action && !prompt) continue;

        const size = asText(record.size) || "中景";
        const light = record.light === "right" ? ("right" as const) : record.light === "none" ? ("none" as const) : ("left" as const);
        const speaker = asText(record.speaker) || (line.startsWith("旁白") ? "旁白" : "");
        const characters = asList(record.characters);
        const assetNames = asList(record.assetNames);

        shots.push({
            id: nanoid(),
            no: shotNumber(shots.length),
            scene,
            location,
            characters: characters.length ? characters : undefined,
            // 道具 / 服装 / 特效名单独存：不能混进 characters，否则会被建成人物卡。
            assetNames: assetNames.length ? assetNames : undefined,
            size,
            camera: asText(record.camera) || undefined,
            move: asText(record.move) || "固定",
            composition: asText(record.composition) || undefined,
            light,
            seconds: clampSeconds(Number(record.seconds ?? NaN) || secondsFor(`${action}${line}${prompt}`)),
            line,
            speaker: speaker || undefined,
            action: action || undefined,
            expression: asText(record.expression) || undefined,
            prompt: prompt || action,
            sound: sound || undefined,
            note: asText(record.note) || undefined,
            status: "pending",
            assetIds: [],
        });
    }
    // 统一重排镜号，避免模型返回重复编号。
    return shots.map((shot, index) => ({ ...shot, no: shotNumber(index) }));
}

export function makeScript(text: string, source: DramaScript["source"], extra?: Partial<DramaScript>): DramaScript {
    return { ...extra, text: text.trim(), source };
}

/** 人物名归一化：去掉多余标点与空白，只用于比对，不用于展示。 */
export function castKey(name: string) {
    return name.trim().replace(/[\s\u3000]+/g, "").replace(/[。；;，,、：:]+$/, "");
}

function pushName(list: string[], name: string) {
    const key = castKey(name);
    if (!key || key.length > 8) return;
    if (!list.some((item) => castKey(item) === key)) list.push(key);
}

/**
 * 从剧本里认出出场人物，供 03 步自动生成人物设定。
 * 顺序：人物表 → 引号对白前的说话人 → 「名字：台词」行；不带引号第一人称叙述不算。
 */
export function extractCast(scriptText: string): string[] {
    const names: string[] = [];
    let cast: string[] = [];
    for (const raw of scriptText.split("\n")) {
        const line = raw.trim();
        if (!line || parseSceneHeader(line)) continue;

        const castLine = line.match(CAST_LINE);
        if (castLine) {
            cast = castLine[1]
                .replace(/[。；;]+$/, "")
                .split(/[、,，/／\s]+/)
                .map((name) => name.trim())
                .filter(Boolean);
            cast.forEach((name) => pushName(names, name));
            continue;
        }
        if (NARRATION.test(line)) continue;

        const quoted = line.match(QUOTED);
        if (quoted) {
            const before = line.slice(0, quoted.index ?? 0).replace(/[，,：:\s]+$/, "").trim();
            const castSpeaker = cast.find((name) => before.startsWith(name));
            const speaker = castSpeaker || before.match(/^([^\s，,。]{2,3})(.*)$/)?.[1] || "";
            if (speaker) pushName(names, speaker);
            continue;
        }
        const speakerLine = line.match(SPEAKER_LINE);
        if (speakerLine && !/[。！？]$/.test(speakerLine[2])) pushName(names, speakerLine[1]);
    }
    return names;
}

/** 从剧本里认出场景标题（名字 + 地点时间），03 步据此先建场景资产卡。 */
export function extractScenes(scriptText: string): { name: string; location: string }[] {
    const scenes: { name: string; location: string }[] = [];
    for (const raw of scriptText.split("\n")) {
        const header = parseSceneHeader(raw.trim());
        if (!header) continue;
        const key = castKey(header.name);
        if (!key || scenes.some((scene) => castKey(scene.name) === key)) continue;
        scenes.push({ name: header.name, location: header.location });
    }
    return scenes;
}
