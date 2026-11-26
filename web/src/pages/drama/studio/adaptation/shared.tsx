import { Tag } from "antd";
import type { ReactNode } from "react";

import { ADAPTATION_CHECK_LABEL, ADAPTATION_GENERATION_LABEL, ADAPTATION_OPERATION_LABEL, ADAPTATION_ORIGIN_LABEL, ADAPTATION_REVIEW_LABEL, ADAPTATION_RISK_LABEL, FORESHADOWING_STATUS_LABEL, type StudioAdaptationCheckLevel, type StudioAdaptationGenerationStatus, type StudioAdaptationOperation, type StudioAdaptationOrigin, type StudioAdaptationReviewStatus, type StudioAdaptationRiskTag, type StudioForeshadowingStatus } from "@/types/studio-adaptation";

export const ADAPTATION_ORIGIN_COLOR: Record<StudioAdaptationOrigin, string> = {
    explicit: "blue",
    inferred: "gold",
    generated: "default",
};

export function OriginTag({ origin }: { origin: StudioAdaptationOrigin }) {
    return <Tag bordered={false} color={ADAPTATION_ORIGIN_COLOR[origin]}>{ADAPTATION_ORIGIN_LABEL[origin]}</Tag>;
}

export function ReviewTag({ status }: { status: StudioAdaptationReviewStatus }) {
    const color = status === "locked" ? "purple" : status === "approved" ? "success" : status === "pending_review" ? "warning" : "default";
    return <Tag bordered={false} color={color}>{ADAPTATION_REVIEW_LABEL[status]}</Tag>;
}

export function CheckLevelTag({ level }: { level: StudioAdaptationCheckLevel }) {
    const color = level === "error" ? "error" : level === "warning" ? "warning" : "processing";
    return <Tag bordered={false} color={color}>{ADAPTATION_CHECK_LABEL[level]}</Tag>;
}

export function GenerationTag({ status }: { status: StudioAdaptationGenerationStatus }) {
    const color = status === "succeeded" ? "success" : status === "running" || status === "queued" ? "processing" : status === "failed" ? "error" : status === "unknown" ? "warning" : "default";
    return <Tag bordered={false} color={color}>{ADAPTATION_GENERATION_LABEL[status]}</Tag>;
}

export function OperationTag({ operation }: { operation: StudioAdaptationOperation }) {
    return <Tag bordered={false}>{ADAPTATION_OPERATION_LABEL[operation]}</Tag>;
}

export function RiskTags({ tags }: { tags: StudioAdaptationRiskTag[] }) {
    return tags.length ? <span className="adaptation-risk-tags">{tags.map((tag) => <Tag key={tag} bordered={false} color="error">{ADAPTATION_RISK_LABEL[tag]}</Tag>)}</span> : <span className="adaptation-muted">无</span>;
}

export function ForeshadowingStatusTag({ status }: { status: StudioForeshadowingStatus }) {
    const color = status === "resolved" ? "success" : status === "advancing" ? "processing" : status === "planted" ? "blue" : status === "abandoned" ? "default" : "warning";
    return <Tag bordered={false} color={color}>{FORESHADOWING_STATUS_LABEL[status]}</Tag>;
}

export function adaptationTime(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function TextBlock({ title, children, empty = "未填写" }: { title: ReactNode; children?: ReactNode; empty?: string }) {
    return (
        <section className="adaptation-text-block">
            <span>{title}</span>
            {children ? <div>{children}</div> : <p className="adaptation-muted">{empty}</p>}
        </section>
    );
}

export function EmptyHint({ children }: { children: ReactNode }) {
    return <div className="adaptation-empty-hint">{children}</div>;
}

export function sourceCount(value: { evidence?: unknown[]; chapterIds?: unknown[]; eventIds?: unknown[] } | undefined) {
    if (!value) return "无引用";
    return `${value.chapterIds?.length ?? 0} 章 / ${value.eventIds?.length ?? 0} 事件 / ${value.evidence?.length ?? 0} 证据`;
}
