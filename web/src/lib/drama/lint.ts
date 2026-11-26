import type { DramaSequence, DramaShot } from "@/types/drama";

import { LIGHT_LABEL, SHOT_MAX_SECONDS, SHOT_MIN_SECONDS } from "./schema";

// 检查器：纯静态校验，不发请求、不消耗额度。
// 所有规则只看序列自身的数据，所以改一个镜头的时长或参考资产，结论会立刻跟着变。

export type DramaIssueLevel = "error" | "warning" | "info" | "ok";

export type DramaIssue = {
    id: string;
    level: DramaIssueLevel;
    /** 点击后跳转的镜头；预算类问题没有具体镜头。 */
    shotId?: string;
    title: string;
    detail: string;
};

export function totalSeconds(sequence: DramaSequence): number {
    return sequence.shots.reduce((sum, shot) => sum + shot.seconds, 0);
}

function hasCharacterRef(sequence: DramaSequence, shot: DramaShot): boolean {
    return shot.assetIds.some((id) => sequence.assets.find((asset) => asset.id === id)?.kind === "character");
}

export function lintSequence(sequence: DramaSequence): DramaIssue[] {
    const issues: DramaIssue[] = [];
    const total = totalSeconds(sequence);
    const over = total - sequence.targetSeconds;

    issues.push(
        over > 0
            ? { id: "budget", level: "error", title: `本集 ${total}s，超出目标 ${sequence.targetSeconds}s 共 ${over}s`, detail: "压掉一个空镜，或把目标时长调到实际值" }
            : { id: "budget", level: "ok", title: `本集 ${total}s，在目标 ${sequence.targetSeconds}s 以内`, detail: over === 0 ? "刚好卡线，没有余量" : "" },
    );

    sequence.shots.forEach((shot) => {
        if (!shot.line.trim() && shot.seconds > SHOT_MIN_SECONDS) {
            issues.push({ id: `silent-${shot.id}`, level: "info", shotId: shot.id, title: `镜 ${shot.no} 是无台词空镜，${shot.seconds}s 偏长`, detail: `建议压到 ${SHOT_MIN_SECONDS}s` });
        }
        if (shot.seconds >= SHOT_MAX_SECONDS - 3) {
            issues.push({ id: `long-${shot.id}`, level: "warning", shotId: shot.id, title: `镜 ${shot.no} 时长 ${shot.seconds}s，接近单镜上限 ${SHOT_MAX_SECONDS}s`, detail: "长镜头建议拆成两镜，节奏更稳" });
        }
        if (/特写|近景/.test(shot.size) && !hasCharacterRef(sequence, shot)) {
            issues.push({ id: `ref-${shot.id}`, level: "warning", shotId: shot.id, title: `镜 ${shot.no} 是${shot.size}，但没挂角色参考`, detail: "同集已有该角色时，脸型容易不一致" });
        }
        // 剧本改过之后，旧素材还挂在这一镜上：不拦住，但要明确告诉用户哪些已经对不上了。
        const stale = [
            shot.generation?.image?.stale && shot.imageRef ? "画面" : "",
            shot.generation?.audio?.stale && shot.audioRef ? "配音" : "",
            shot.generation?.video?.stale && shot.videoRef ? "视频" : "",
        ].filter(Boolean);
        if (stale.length) {
            issues.push({ id: `stale-${shot.id}`, level: "warning", shotId: shot.id, title: `镜 ${shot.no} 剧本内容改过，${stale.join(" / ")}还是旧的`, detail: "重新生成后会自动清掉标记；也可以先确认内容再决定要不要重做" });
        }
    });

    // 穿帮检查：同场景同景别的镜头按出现顺序比较光位。
    // 不能只比物理相邻两镜——中间插了别的镜头，观众照样能看出同一场景的光方向跳变。
    const lastBySceneSize = new Map<string, DramaShot>();
    for (const current of sequence.shots) {
        if (!current.scene.trim()) continue;
        const key = `${current.scene}|${current.size}`;
        const previous = lastBySceneSize.get(key);
        if (previous && previous.light !== "none" && current.light !== "none" && previous.light !== current.light) {
            issues.push({
                id: `light-${current.id}`,
                level: "warning",
                shotId: current.id,
                title: `镜 ${current.no} 与镜 ${previous.no} 同场景同景别，光位相反`,
                detail: `${LIGHT_LABEL[previous.light]} → ${LIGHT_LABEL[current.light]}，连播会看出方向跳变`,
            });
        }
        lastBySceneSize.set(key, current);
    }

    return issues;
}
