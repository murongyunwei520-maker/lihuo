import { Tag, Tooltip } from "antd";
import { AlertTriangle, CircleDot, Info, Lock, LockOpen } from "lucide-react";

import type { StudioShotGroup, StudioStoryboardDocument, StudioStoryboardReviewIssue, StudioStoryboardReviewStatus, StudioStoryboardReadinessStatus, StudioProductionShot } from "@/types/studio-production";
import { STORYBOARD_REVIEW_STATUS_LABEL } from "@/lib/studio/review-engine";

export const durationText = (value: number) => `${Number.isFinite(value) ? Math.round(value * 10) / 10 : 0}s`;

export function statusColor(status: StudioStoryboardReviewStatus) {
    if (status === "approved") return "success";
    if (status === "needs_revision") return "warning";
    if (status === "rejected") return "error";
    if (status === "stale") return "warning";
    return "processing";
}

export function ShotStatusTag({ status }: { status: StudioStoryboardReviewStatus }) {
    return <Tag bordered={false} color={statusColor(status)}>{STORYBOARD_REVIEW_STATUS_LABEL[status]}</Tag>;
}

export function LockBadge({ locked, short = false }: { locked: boolean; short?: boolean }) {
    if (!locked) return <span className="stage4b-lock is-open"><LockOpen className="size-3.5" />{short ? "" : "未锁定"}</span>;
    return (
        <Tooltip title="已锁定：仅限制修改；解锁请进入审片或选中后批量解锁">
            <span className="stage4b-lock is-locked"><Lock className="size-3.5" />{short ? "" : "已锁定"}</span>
        </Tooltip>
    );
}

export function readinessColor(status: StudioStoryboardReadinessStatus) {
    if (status === "ready_for_video") return "is-ready";
    if (status === "blocked") return "is-blocked";
    return "is-not-ready";
}

export function issueIcon(level: StudioStoryboardReviewIssue["level"]) {
    if (level === "error") return <AlertTriangle className="size-3.5" />;
    if (level === "warning") return <CircleDot className="size-3.5" />;
    return <Info className="size-3.5" />;
}

export function sceneTitleOf(document: StudioStoryboardDocument | undefined, shot: StudioProductionShot) {
    if (!document) return shot.sceneId;
    return document.groups.find((group) => group.sceneId === shot.sceneId)?.sceneTitle || shot.sceneId;
}

export function groupOf(document: StudioStoryboardDocument | undefined, shot: StudioProductionShot) {
    return document?.groups.find((group) => group.shotGroupId === shot.shotGroupId);
}

/** 生成器允许每个场景各自从 1 开始编号镜头组，审片工作台按整集顺序展示唯一编号。 */
export function groupNo(document: StudioStoryboardDocument | undefined, group: StudioShotGroup) {
    const index = document?.groups.findIndex((item) => item.shotGroupId === group.shotGroupId) ?? -1;
    return index >= 0 ? index + 1 : group.groupNumber;
}

export function groupNoLabel(document: StudioStoryboardDocument | undefined, group: StudioShotGroup) {
    return `G${String(groupNo(document, group)).padStart(2, "0")}`;
}

export function groupLabel(document: StudioStoryboardDocument | undefined, shot: StudioProductionShot) {
    const group = groupOf(document, shot);
    return group ? `${groupNoLabel(document, group)} · ${group.shotIds.length} 镜` : "无镜头组";
}

export function shotLabel(shot: StudioProductionShot) {
    return `镜头 ${String(shot.shotNumber).padStart(2, "0")}`;
}

export const REVIEW_STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "pending", label: "待审核" },
    { value: "approved", label: "已通过" },
    { value: "needs_revision", label: "需要修改" },
    { value: "rejected", label: "不通过" },
    { value: "stale", label: "待重新审核" },
];

export const REVIEW_SKIP_LABEL: Record<string, string> = {
    missing: "镜头不存在",
    locked: "镜头已锁定",
    stale: "镜头待重新审核",
    unchanged: "状态未变化",
    version_conflict: "版本冲突，缺少可验证签名",
    not_stale: "镜头不是 stale",
    document_locked: "整份分镜已锁定，不能逐镜解锁",
};

export function sortShots(shots: StudioProductionShot[], sort: string) {
    const next = [...shots];
    if (sort === "duration_desc") return next.sort((left, right) => (right.duration || 0) - (left.duration || 0) || left.shotNumber - right.shotNumber);
    if (sort === "duration_asc") return next.sort((left, right) => (left.duration || 0) - (right.duration || 0) || left.shotNumber - right.shotNumber);
    if (sort === "number_desc") return next.sort((left, right) => right.shotNumber - left.shotNumber);
    return next.sort((left, right) => left.shotNumber - right.shotNumber);
}
