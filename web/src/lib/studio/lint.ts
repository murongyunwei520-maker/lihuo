import { shotUsesAsset } from "./deps";

import type { StudioEpisode, StudioProject, StudioShot } from "@/types/studio";

// 导演中心的时长预算与连续性检查。规则是确定性的，不依赖模型；AI 分析作为补充。

export const SHOT_MIN_SECONDS = 4;
export const SHOT_MAX_SECONDS = 15;

export type StudioIssueLevel = "error" | "warning" | "info";

export type StudioIssue = {
    id: string;
    level: StudioIssueLevel;
    message: string;
    shotId?: string;
    shotNo?: string;
};

export function totalSeconds(episode: StudioEpisode | null | undefined) {
    return (episode?.shots ?? []).reduce((sum, shot) => sum + (Number.isFinite(shot.seconds) ? shot.seconds : 0), 0);
}

export function durationBudget(episode: StudioEpisode | null | undefined, targetSeconds?: number) {
    const target = targetSeconds ?? episode?.targetSeconds ?? 60;
    const planned = totalSeconds(episode);
    const delta = planned - target;
    return { target, planned, delta, over: delta > 0, under: delta < 0 };
}

export function lintEpisode(project: StudioProject, episode: StudioEpisode): StudioIssue[] {
    const issues: StudioIssue[] = [];
    const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
    if (!episode.shots.length) {
        issues.push({ id: "no-shots", level: "info", message: "这一集还没有镜头：先在导演中心拆场拆镜。" });
        return issues;
    }

    const scenes = new Set(episode.scenes.map((scene) => scene.id));
    episode.shots.forEach((shot, index) => {
        const push = (level: StudioIssueLevel, message: string) => issues.push({ id: `${shot.id}-${index}-${message}`, level, message, shotId: shot.id, shotNo: shot.no });
        if (!shot.sceneId || !scenes.has(shot.sceneId) || !shot.sceneName.trim()) push("error", `镜 ${shot.no} 没有归属场景`);
        if (!shot.description.trim() && !shot.action.trim()) push("warning", `镜 ${shot.no} 缺少画面描述与人物动作`);
        if (shot.seconds < SHOT_MIN_SECONDS || shot.seconds > SHOT_MAX_SECONDS) push("error", `镜 ${shot.no} 时长 ${shot.seconds}s 超出 ${SHOT_MIN_SECONDS}–${SHOT_MAX_SECONDS}s`);
        if (shot.line.trim() && !shot.speaker.trim()) push("warning", `镜 ${shot.no} 有台词但没有指定说话人`);
        for (const assetId of shot.assetIds) {
            if (!assetsById.has(assetId)) push("warning", `镜 ${shot.no} 绑定的资产已不存在`);
        }
        for (const asset of project.assets) {
            if (shotUsesAsset(asset, shot) && asset.kind === "character" && !asset.officialRef) {
                push("warning", `镜 ${shot.no} 的人物「${asset.name}」还没有正式参考图`);
            }
        }
        const previous = index > 0 ? episode.shots[index - 1] : null;
        if (previous) {
            if (previous.size === shot.size && previous.sceneId === shot.sceneId) {
                issues.push({ id: `${shot.id}-size`, level: "warning", message: `镜 ${previous.no} 与镜 ${shot.no} 连续同景别（${shot.size}），建议变化景别`, shotId: shot.id, shotNo: shot.no });
            }
            const left = previous.lighting.includes("左");
            const right = previous.lighting.includes("右");
            if (previous.sceneId === shot.sceneId && ((left && shot.lighting.includes("右")) || (right && shot.lighting.includes("左"))) && shot.lighting !== "无主光") {
                issues.push({ id: `${shot.id}-light`, level: "warning", message: `镜 ${previous.no} 与镜 ${shot.no} 主光方向相反，同一场景连播会穿帮`, shotId: shot.id, shotNo: shot.no });
            }
        }
    });

    const budget = durationBudget(episode);
    if (budget.over) {
        issues.push({ id: "budget-over", level: "warning", message: `镜头规划 ${budget.planned}s，超出目标 ${Math.abs(budget.delta)}s。可智能压缩未锁定镜头，或调整台词与场次。` });
    } else if (budget.under && episode.shots.length) {
        issues.push({ id: "budget-under", level: "info", message: `镜头规划 ${budget.planned}s，距目标还差 ${budget.delta < 0 ? Math.abs(budget.delta) : 0}s，可补充镜头或延长关键动作。` });
    }
    return issues;
}

/** 选择一组连续镜头做整体检查：位置、朝向、动作、运动方向、镜头空间关系、切换逻辑、风格与连续性。 */
export function continuityIssues(project: StudioProject, episode: StudioEpisode, shotIds: string[]): StudioIssue[] {
    const shots = episode.shots.filter((shot) => shotIds.includes(shot.id));
    const issues: StudioIssue[] = [];
    if (shots.length < 2) {
        return [{ id: "continuity-more", level: "info", message: "至少选择两个连续镜头才能做连续性检查。" }];
    }
    for (let index = 1; index < shots.length; index += 1) {
        const previous = shots[index - 1];
        const current = shots[index];
        const at = { shotId: current.id, shotNo: current.no };
        if (previous.sceneId !== current.sceneId && previous.sceneName === current.sceneName) {
            issues.push({ id: `scene-${index}`, level: "warning", message: `镜 ${previous.no} 与镜 ${current.no} 同场景名但不同场景分组`, ...at });
        }
        if (!current.position.trim()) issues.push({ id: `position-${index}`, level: "warning", message: `镜 ${current.no} 没有记录人物位置，无法判断空间关系`, ...at });
        if (!current.orientation.trim()) issues.push({ id: `orientation-${index}`, level: "warning", message: `镜 ${current.no} 没有记录人物朝向`, ...at });
        if (previous.sceneId === current.sceneId && previous.orientation.trim() && current.orientation.trim() && previous.orientation.trim() !== current.orientation.trim()) {
            issues.push({ id: `orientation-flip-${index}`, level: "warning", message: `镜 ${previous.no} → 镜 ${current.no} 人物朝向从「${previous.orientation}」变为「${current.orientation}」，确认是否有转身动作承接`, ...at });
        }
        if (previous.sceneId === current.sceneId && previous.movement === "推" && current.movement === "拉") {
            issues.push({ id: `move-${index}`, level: "info", message: `镜 ${previous.no} 推镜后紧接镜 ${current.no} 拉镜，节奏可能突兀`, ...at });
        }
        if (previous.sceneId === current.sceneId && previous.lighting !== current.lighting && current.lighting !== "无主光") {
            issues.push({ id: `light-${index}`, level: "warning", message: `同一场景内主光从「${previous.lighting}」变为「${current.lighting}」`, ...at });
        }
        if (!current.description.trim()) issues.push({ id: `desc-${index}`, level: "warning", message: `镜 ${current.no} 缺少画面描述`, ...at });
    }
    const budget = durationBudget(episode, episode.targetSeconds);
    if (budget.over) issues.push({ id: "continuity-budget", level: "warning", message: `所选镜头所在集超时 ${Math.abs(budget.delta)}s` });
    return issues;
}

/** 超时智能调整：按未锁定镜头等比例压缩，只给建议，用户确认后才写回。 */
export function suggestDurationAdjustment(episode: StudioEpisode, targetSeconds: number) {
    const adjustable = episode.shots.filter((shot) => !shot.locked);
    const planned = totalSeconds(episode);
    if (!adjustable.length || planned <= targetSeconds) return [];
    const lockedSeconds = episode.shots.filter((shot) => shot.locked).reduce((sum, shot) => sum + shot.seconds, 0);
    const available = Math.max(0, targetSeconds - lockedSeconds);
    const adjustableSeconds = adjustable.reduce((sum, shot) => sum + shot.seconds, 0);
    const ratio = adjustableSeconds ? available / adjustableSeconds : 0;
    return adjustable.map((shot) => ({
        shotId: shot.id,
        shotNo: shot.no,
        from: shot.seconds,
        to: Math.min(SHOT_MAX_SECONDS, Math.max(SHOT_MIN_SECONDS, Math.round(shot.seconds * ratio))),
    }));
}
