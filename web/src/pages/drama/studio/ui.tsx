import type { ReactNode } from "react";
import { Button, Tag, Tooltip } from "antd";
import { AudioLines, Film, Image as ImageIcon, Loader2, Play } from "lucide-react";

import { cn } from "@/lib/utils";
import { modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { DRAMA_STEP_KEYS, DRAMA_STEP_SHORT_LABEL, type DramaStep, type StudioMediaKind, type StudioMediaStatus, type StudioMediaVersion, type StudioProject, type StudioTaskStatus } from "@/types/studio";

import { useMediaUrls } from "../use-media-urls";

// 六个工作区共用的轻量 UI 件。颜色全部走 CSS 变量 / Ant Design token，不新增硬编码色。

export function StudioPanel({ title, extra, children, className, bodyClassName }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
    return (
        <section className={cn("studio-panel", className)}>
            {title || extra ? (
                <header className="studio-panel__head">
                    <div className="studio-panel__title">{title}</div>
                    {extra ? <div className="studio-panel__extra">{extra}</div> : null}
                </header>
            ) : null}
            <div className={cn("studio-panel__body", bodyClassName)}>{children}</div>
        </section>
    );
}

export function StudioField({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <label className={cn("studio-field", className)}>
            <span className="studio-field__label">
                {label}
                {hint ? <small>{hint}</small> : null}
            </span>
            {children}
        </label>
    );
}

export function StudioEmpty({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
    return (
        <div className="studio-empty">
            {icon ? <div className="studio-empty__icon">{icon}</div> : null}
            <strong>{title}</strong>
            {description ? <p>{description}</p> : null}
            {action}
        </div>
    );
}

const STATUS_META: Record<StudioMediaStatus | StudioTaskStatus, { color: string; label: string }> = {
    idle: { color: "default", label: "未生成" },
    pending: { color: "default", label: "等待中" },
    submitting: { color: "processing", label: "提交中" },
    queued: { color: "processing", label: "排队中" },
    running: { color: "processing", label: "生成中" },
    succeeded: { color: "success", label: "已完成" },
    failed: { color: "error", label: "失败" },
    interrupted: { color: "warning", label: "已中断" },
    unknown: { color: "warning", label: "结果未知" },
    stale: { color: "warning", label: "需确认" },
    canceled: { color: "default", label: "已取消（旧）" },
    cancelling: { color: "warning", label: "取消中（待远端确认）" },
    cancelled: { color: "default", label: "已取消" },
    retrying: { color: "processing", label: "重试中" },
};

export function StudioStatus({ status, text }: { status: StudioMediaStatus | StudioTaskStatus; text?: string }) {
    const meta = STATUS_META[status];
    return (
        <Tag color={meta.color} bordered={false} className={cn("studio-status-tag", `is-${status}`)}>
            {text ?? meta.label}
        </Tag>
    );
}

export function StudioLoading({ text }: { text?: string }) {
    return (
        <span className="studio-inline-loading">
            <Loader2 className="size-4 animate-spin" /> {text ?? "处理中"}
        </span>
    );
}

export function StudioModelSelect(props: { config: AiConfig; capability: "text" | "image" | "video" | "audio"; value?: string; onChange: (value: string) => void; allowAuto?: boolean; disabled?: boolean; className?: string }) {
    const values = selectableModelsByCapability(props.config, props.capability);
    return (
        <select className={cn("studio-select", props.className)} value={props.value ?? ""} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)}>
            {props.allowAuto !== false ? <option value="">跟随项目 / 自动</option> : null}
            {values.map((value) => (
                <option key={value} value={value}>
                    {modelOptionName(value)}
                </option>
            ))}
        </select>
    );
}

/** 候选版本条：图片看缩略图，视频/音频看类型与来源。 */
export function StudioVersionStrip({
    versions,
    kind,
    currentKey,
    onChoose,
    emptyText = "还没有候选版本",
}: {
    versions: StudioMediaVersion[];
    kind: StudioMediaKind;
    currentKey?: string;
    onChoose?: (version: StudioMediaVersion) => void;
    emptyText?: string;
}) {
    const urls = useMediaUrls(versions.map((version) => version.storageKey));
    if (!versions.length) return <div className="studio-version-empty">{emptyText}</div>;
    return (
        <div className="studio-version-strip">
            {versions.map((version) => {
                const active = currentKey === version.storageKey;
                return (
                    <Tooltip key={version.id} title={`${version.source === "workflow" ? "Workflow" : version.source === "upload" ? "上传" : version.source === "migration" ? "迁移" : "Studio"} · ${version.model ?? "未知模型"} · ${new Date(version.createdAt).toLocaleString("zh-CN")}`}>
                        <button type="button" className={cn("studio-version", active && "is-active")} onClick={() => onChoose?.(version)} disabled={!onChoose}>
                            {kind === "image" ? (
                                urls[version.storageKey] ? (
                                    <img src={urls[version.storageKey]} alt="" />
                                ) : (
                                    <ImageIcon className="size-4" />
                                )
                            ) : kind === "video" ? (
                                <Film className="size-4" />
                            ) : kind === "audio" || kind === "narration" ? (
                                <AudioLines className="size-4" />
                            ) : (
                                <Play className="size-4" />
                            )}
                            <span>{version.source === "workflow" ? "画布" : version.source === "upload" ? "上传" : version.source === "migration" ? "旧版" : "Studio"}</span>
                        </button>
                    </Tooltip>
                );
            })}
        </div>
    );
}

export function StudioMediaPreview({ storageKey, kind, className, controls = false }: { storageKey?: string; kind: StudioMediaKind; className?: string; controls?: boolean }) {
    const urls = useMediaUrls(storageKey ? [storageKey] : []);
    const url = storageKey ? urls[storageKey] : "";
    if (!storageKey) {
        return (
            <div className={cn("studio-media-placeholder", className)}>
                {kind === "image" ? <ImageIcon className="size-6" /> : kind === "video" ? <Film className="size-6" /> : <AudioLines className="size-6" />}
                <span>待生成</span>
            </div>
        );
    }
    if (!url) {
        return (
            <div className={cn("studio-media-placeholder", className)}>
                <Loader2 className="size-5 animate-spin" />
                <span>读取素材…</span>
            </div>
        );
    }
    if (kind === "video") {
        return <video className={cn("studio-media", className)} src={url} controls={controls} muted playsInline preload="metadata" />;
    }
    if (kind === "audio" || kind === "narration" || kind === "sfx") {
        return <audio className={cn("studio-audio", className)} src={url} controls />;
    }
    return <img className={cn("studio-media", className)} src={url} alt="" />;
}

export function StudioStat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
    return (
        <div className="studio-stat">
            <span>{label}</span>
            <strong>{value}</strong>
            {hint ? <small>{hint}</small> : null}
        </div>
    );
}

/** 五步真实状态条：只读 project.stepStates，不把“点过导航”当成完成。 */
export function StudioStepProgress({ project, activeStep, compact = false, onSelect }: { project: StudioProject; activeStep?: DramaStep; compact?: boolean; onSelect?: (step: DramaStep) => void }) {
    return (
        <div className={cn("studio-step-progress", compact && "is-compact")}>
            {DRAMA_STEP_KEYS.map((step, index) => {
                const status = project.stepStates[step] ?? "idle";
                const label = DRAMA_STEP_SHORT_LABEL[step];
                const body = (
                    <>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        {!compact ? <small>{label}</small> : null}
                    </>
                );
                const className = cn("studio-step-progress__item", `is-${status}`, activeStep === step && "is-active");
                return onSelect ? (
                    <button key={step} type="button" className={className} title={`${label} · ${status}`} aria-current={activeStep === step ? "step" : undefined} onClick={() => onSelect(step)}>
                        {body}
                    </button>
                ) : (
                    <div key={step} className={className} title={`${label} · ${status}`} aria-current={activeStep === step ? "step" : undefined}>
                        {body}
                    </div>
                );
            })}
        </div>
    );
}

export function StudioAddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
    return (
        <Button type="dashed" size="small" onClick={onClick} disabled={disabled} className="studio-add-button">
            {children}
        </Button>
    );
}
