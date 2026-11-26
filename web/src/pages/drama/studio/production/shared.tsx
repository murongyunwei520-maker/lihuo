import { Tag, Tooltip } from "antd";
import { AlertCircle, CircleCheck, CircleDot, Info } from "lucide-react";

import type { StudioProductionCheck, StudioProductionJobStatus, StudioProductionReviewStatus, StudioScriptDurationEstimate } from "@/types/studio-production";

const REVIEW_META: Record<StudioProductionReviewStatus, { label: string; color: string }> = {
    draft: { label: "草稿", color: "default" },
    pending_review: { label: "待审核", color: "processing" },
    approved: { label: "已通过", color: "success" },
    locked: { label: "已锁定", color: "warning" },
};

export function ReviewTag({ status }: { status?: StudioProductionReviewStatus }) {
    const meta = REVIEW_META[status ?? "draft"];
    return <Tag bordered={false} color={meta.color}>{meta.label}</Tag>;
}

const JOB_META: Record<StudioProductionJobStatus, { label: string; color: string }> = {
    pending: { label: "待入队", color: "default" },
    queued: { label: "排队中", color: "processing" },
    submitting: { label: "已提交", color: "processing" },
    running: { label: "生成中", color: "processing" },
    succeeded: { label: "已完成", color: "success" },
    failed: { label: "失败", color: "error" },
    cancelling: { label: "停止确认中", color: "warning" },
    cancelled: { label: "已取消", color: "default" },
    interrupted: { label: "已中断 · 需核对", color: "warning" },
    unknown: { label: "状态未知 · 需核对", color: "warning" },
};

export function JobStatusTag({ status }: { status: StudioProductionJobStatus }) {
    const meta = JOB_META[status] ?? JOB_META.unknown;
    return <Tag bordered={false} color={meta.color}>{meta.label}</Tag>;
}

export function CheckIcon({ level }: { level: StudioProductionCheck["level"] }) {
    if (level === "error") return <AlertCircle className="size-3.5" />;
    if (level === "warning") return <CircleDot className="size-3.5" />;
    if (level === "suggestion") return <Info className="size-3.5" />;
    return <CircleCheck className="size-3.5" />;
}

export function CheckList({ checks, empty = "没有未处理的 Stage 3 检查" }: { checks: StudioProductionCheck[]; empty?: string }) {
    const open = checks.filter((check) => check.status === "open");
    if (!open.length) return <div className="stage3-check-empty">{empty}</div>;
    return (
        <div className="stage3-check-list">
            {open.slice(0, 30).map((check) => (
                <article key={check.id} className={`stage3-check-item is-${check.level}`}>
                    <header>
                        <span><CheckIcon level={check.level} /> {check.category}</span>
                        <Tag bordered={false}>{check.source === "model" ? "AI 建议" : "规则校验"}</Tag>
                    </header>
                    <p>{check.message}</p>
                    {check.suggestion ? <small>{check.suggestion}</small> : null}
                    {check.sceneId || check.shotId || check.shotGroupId ? <em>{[check.sceneId, check.shotGroupId, check.shotId].filter(Boolean).join(" / ")}</em> : null}
                </article>
            ))}
        </div>
    );
}

export function DurationMeter({ estimate, target }: { estimate?: StudioScriptDurationEstimate; target: number }) {
    if (!estimate) return null;
    const ratio = target ? estimate.totalSeconds / target : 1;
    const level = ratio > 1.35 || ratio < 0.55 ? "error" : ratio > 1.15 || ratio < 0.8 ? "warning" : "ok";
    const delta = Math.round(estimate.deltaSeconds * 10) / 10;
    return (
        <Tooltip title={estimate.note}>
            <div className={`stage3-duration is-${level}`}>
                <div className="stage3-duration__bar"><span style={{ width: `${Math.max(8, Math.min(100, ratio * 100))}%` }} /></div>
                <span>{estimate.totalSeconds}s / 目标 {target}s <em>{delta > 0 ? `+${delta}s` : `${delta}s`}</em></span>
            </div>
        </Tooltip>
    );
}

export function ModelBadge({ label, params }: { label: string; params: Record<string, string | number | boolean> }) {
    const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== "");
    return (
        <div className="stage3-model-badge">
            <span>项目文本模型</span>
            <strong>{label || "未选择"}</strong>
            {entries.length ? <small>{entries.map(([key, value]) => `${key} ${String(value)}`).join(" · ")}</small> : <small>模型默认参数</small>}
        </div>
    );
}

export function EmptyStage3({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
    return (
        <div className="stage3-empty">
            <div className="stage3-empty__mark">03</div>
            <strong>{title}</strong>
            {description ? <p>{description}</p> : null}
            {action}
        </div>
    );
}
