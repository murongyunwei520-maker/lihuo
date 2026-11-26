import type { DramaMediaState, DramaSequence, DramaShot } from "@/types/drama";

import { shotNumber } from "./schema";

// 剧本与镜头的版本对齐。
// 剧本改过之后镜头要跟着重建，但用户已经生成的画面 / 配音 / 视频不能凭空消失：
// 能对上的继承，对不上的保留旧图但标成「内容已改」，由用户决定重不做。

/** 归一化：去空白与标点，避免一个逗号就让整镜对不上。 */
function normalize(text: string | undefined) {
    return (text ?? "")
        .toLowerCase()
        .replace(/[\s\u3000]+/g, "")
        .replace(/[。！？!?，,、；;：:「」『』“”"'（）()\[\]【】…—\-]/g, "");
}

function sceneKey(shot: DramaShot) {
    return normalize(shot.scene) || "__no-scene";
}

/** 同一场 + 同一句台词视为同一镜；无台词镜头退回动作 / 画面描述。 */
function contentKey(shot: DramaShot) {
    const line = normalize(shot.line);
    if (line) return `${sceneKey(shot)}|L|${line}`;
    return `${sceneKey(shot)}|A|${normalize(shot.action) || normalize(shot.prompt)}`;
}

/**
 * 剧本指纹：只用于判断「这批镜头是按哪版剧本拆的」，不做加密。
 * 空白（含换行 / 缩进）全部忽略，只改排版不算剧本变更。
 */
export function scriptFingerprint(text: string | undefined) {
    const input = (text ?? "").replace(/\s+/g, "");
    let hash = 5381;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
    }
    return `${input.length.toString(36)}-${hash.toString(36)}`;
}

/** 剧本改过、但镜头还是旧的那一批。没有快照的老数据不判脏，避免一进来就报警。 */
export function isScriptStale(sequence: DramaSequence | null | undefined): boolean {
    if (!sequence) return false;
    const text = sequence.script?.text ?? "";
    if (!text.trim() || !sequence.shots.length) return false;
    if (!sequence.split) return false;
    return sequence.split.scriptHash !== scriptFingerprint(text);
}

export type MergeStats = {
    /** 内容完全对上，原样继承。 */
    reused: number;
    /** 同场景但内容变了：继承旧图 / 旧视频，并标记待重做。 */
    edited: number;
    added: number;
    removed: number;
};

function carriedGeneration(prev: DramaShot, stale: boolean, keepAudio: boolean) {
    const flag = (state: DramaMediaState | undefined) => (state ? { ...state, ...(stale ? { stale: true } : {}) } : undefined);
    const image = flag(prev.generation?.image);
    const video = flag(prev.generation?.video);
    const audio = keepAudio ? flag(prev.generation?.audio) : undefined;
    if (!image && !video && !audio) return undefined;
    return { image, video, audio };
}

/**
 * 把旧镜头上的生成结果搬到新镜头。
 * - 内容没变（same）：连景别 / 运镜 / 时长都沿用，用户的手改不会被 AI 重拆覆盖。
 * - 内容变了（edited）：只留画面与视频，标成 stale；台词变了旧配音就是错的，直接丢掉。
 */
function carryMedia(prev: DramaShot, next: DramaShot, mode: "same" | "edited"): DramaShot {
    const lineChanged = normalize(prev.line) !== normalize(next.line) || (prev.speaker ?? "") !== (next.speaker ?? "");
    const stale = mode === "edited";
    const keepIfSet = <K extends keyof DramaShot>(key: K) => (prev[key] ? { [key]: prev[key] } : {});

    return {
        ...next,
        // 沿用旧 id：检查器选中、任务栏跳转、画布节点引用都不会断。
        id: prev.id,
        status: prev.status,
        progress: undefined,
        ...(mode === "same" ? { size: prev.size, move: prev.move, light: prev.light, seconds: prev.seconds } : {}),
        ...keepIfSet("camera"),
        ...keepIfSet("composition"),
        ...keepIfSet("expression"),
        imageRef: prev.imageRef,
        imageVersions: prev.imageVersions,
        imagePrompt: prev.imagePrompt,
        videoRef: prev.videoRef,
        videoVersions: prev.videoVersions,
        videoPrompt: prev.videoPrompt,
        audioRef: lineChanged ? undefined : prev.audioRef,
        audioVersions: lineChanged ? undefined : prev.audioVersions,
        audioOffsetMs: lineChanged ? undefined : prev.audioOffsetMs,
        approved: stale ? undefined : prev.approved,
        nodeId: prev.nodeId,
        generation: carriedGeneration(prev, stale, !lineChanged),
    };
}

/**
 * 重新拆镜时把旧镜头的生成结果合并进来，按顺序重排镜号。
 * 两轮匹配：先按「场景 + 台词」精确对上，再在同一场景内按顺序配对（AI 重拆会改写画面描述）。
 */
export function mergeSplitShots(prev: DramaShot[], next: DramaShot[]): { shots: DramaShot[]; stats: MergeStats } {
    const stats: MergeStats = { reused: 0, edited: 0, added: 0, removed: 0 };
    if (!next.length) return { shots: [], stats: { ...stats, removed: prev.length } };
    if (!prev.length) return { shots: next.map((shot, index) => ({ ...shot, no: shotNumber(index) })), stats: { ...stats, added: next.length } };

    const pools = new Map<string, DramaShot[]>();
    for (const shot of prev) {
        const key = contentKey(shot);
        pools.set(key, [...(pools.get(key) ?? []), shot]);
    }

    const used = new Set<string>();
    const merged: (DramaShot | null)[] = next.map((shot) => {
        const hit = pools.get(contentKey(shot))?.find((item) => !used.has(item.id));
        if (!hit) return null;
        used.add(hit.id);
        stats.reused += 1;
        return carryMedia(hit, shot, "same");
    });

    // 第二轮的场景池：只放第一轮没被用掉的旧镜头，按原顺序排。
    const leftovers = new Map<string, DramaShot[]>();
    for (const shot of prev) {
        if (used.has(shot.id)) continue;
        const key = sceneKey(shot);
        leftovers.set(key, [...(leftovers.get(key) ?? []), shot]);
    }
    const pendingByScene = new Map<string, number[]>();
    next.forEach((shot, index) => {
        if (merged[index]) return;
        const key = sceneKey(shot);
        pendingByScene.set(key, [...(pendingByScene.get(key) ?? []), index]);
    });
    pendingByScene.forEach((indexes, key) => {
        const pool = leftovers.get(key) ?? [];
        indexes.forEach((index, order) => {
            const hit = pool[order];
            if (!hit || used.has(hit.id)) return;
            used.add(hit.id);
            stats.edited += 1;
            merged[index] = carryMedia(hit, next[index], "edited");
        });
    });

    const shots = next.map((shot, index) => {
        const kept = merged[index];
        return kept ? { ...kept, no: shotNumber(index) } : { ...shot, no: shotNumber(index) };
    });
    stats.removed = prev.filter((shot) => !used.has(shot.id)).length;
    stats.added = next.length - stats.reused - stats.edited;
    return { shots, stats };
}

/** 下游还有哪些媒体的内容对不上新剧本，给提示文案用。 */
export function staleMediaCount(sequence: DramaSequence | null | undefined) {
    const shots = sequence?.shots ?? [];
    const count = (kind: "image" | "audio" | "video", has: (shot: DramaShot) => boolean) =>
        shots.filter((shot) => shot.generation?.[kind]?.stale && has(shot)).length;
    return {
        image: count("image", (shot) => Boolean(shot.imageRef)),
        audio: count("audio", (shot) => Boolean(shot.audioRef)),
        video: count("video", (shot) => Boolean(shot.videoRef)),
    };
}
