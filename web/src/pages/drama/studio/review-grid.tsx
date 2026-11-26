import { Button, Checkbox, Dropdown, Tooltip } from "antd";
import { AlertTriangle, CircleDot, FileText, ImageOff, Lock, RefreshCw } from "lucide-react";

import type {
    StudioProductionShot,
    StudioStoryboardDocument,
    StudioStoryboardReviewIssue,
    StudioStoryboardReviewStatus,
} from "@/types/studio-production";
import { durationText, groupLabel, LockBadge, sceneTitleOf, ShotStatusTag } from "./review-shared";

type ReviewGridProps = {
    document: StudioStoryboardDocument;
    shots: StudioProductionShot[];
    statuses: Record<string, StudioStoryboardReviewStatus>;
    issues: StudioStoryboardReviewIssue[];
    selected: Set<string>;
    busy: boolean;
    onToggleSelection: (shotId: string) => void;
    onOpen: (shotId: string) => void;
    onStatus: (shotId: string, status: "pending" | "approved" | "needs_revision" | "rejected") => void;
    onOpenAudit: (shotId: string) => void;
    onLockRequest: (shotId: string, locked: boolean) => void;
    onReReview: (shotId: string) => void;
};

function shotDialogue(shot: StudioProductionShot) {
    return shot.dialogue.map((line) => `${line.speaker}：${line.text}`).join(" / ");
}

export function ReviewGrid({
    document,
    shots,
    statuses,
    issues,
    selected,
    busy,
    onToggleSelection,
    onOpen,
    onStatus,
    onOpenAudit,
    onLockRequest,
    onReReview,
}: ReviewGridProps) {
    return (
        <div className="stage4b-grid">
            {shots.map((shot) => {
                const status = statuses[shot.shotId] ?? "pending";
                const documentLocked = document.status === "locked";
                const locked = shot.locked || documentLocked;
                const stale = status === "stale";
                const shotIssues = issues.filter((issue) => issue.shotId === shot.shotId && issue.status === "open" && !issue.continuityStale);
                const errors = shotIssues.filter((issue) => issue.level === "error").length;
                const warnings = shotIssues.filter((issue) => issue.level === "warning").length;
                const suggestions = shotIssues.filter((issue) => issue.level === "suggestion").length;
                const characters = shot.characterBindings.map((binding) => binding.name).filter(Boolean).join("、") || "未绑定人物";
                const dialogue = shotDialogue(shot);
                const reviewItems = [
                    { key: "approved", label: "通过", disabled: locked || stale },
                    { key: "needs_revision", label: "标记需要修改", disabled: locked || stale },
                    { key: "rejected", label: "驳回", disabled: locked || stale },
                    { key: "pending", label: "重置待审", disabled: locked || stale },
                ];
                if (stale) reviewItems.unshift({ key: "re_review", label: "重新审核（创建新记录）", disabled: locked });
                reviewItems.push({
                    key: locked ? "unlock" : "lock",
                    label: documentLocked ? "整份分镜已锁定 · 需先解锁整份" : locked ? "解锁（需确认）" : "锁定",
                    disabled: documentLocked,
                });
                return (
                    <article
                        key={shot.shotId}
                        className={`stage4b-grid-card ${selected.has(shot.shotId) ? "is-selected" : ""} ${stale ? "is-stale" : ""}`}
                        onClick={() => onOpen(shot.shotId)}
                    >
                        <div className="stage4b-grid-card__head">
                            <Checkbox
                                checked={selected.has(shot.shotId)}
                                disabled={busy}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => onToggleSelection(shot.shotId)}
                                aria-label={`选择镜头 ${shot.shotNumber}`}
                            />
                            <span className="stage4b-grid-card__no">{String(shot.shotNumber).padStart(2, "0")}</span>
                            <ShotStatusTag status={status} />
                            {stale ? <span className="stage4b-stale-chip">STALE</span> : null}
                            <span className="stage4b-grid-card__lock"><LockBadge locked={locked} short /></span>
                        </div>

                        <div className="stage4b-grid-card__preview">
                            <div className="stage4b-preview-placeholder">
                                <ImageOff className="size-5" />
                                <strong>暂无预览图</strong>
                                <span>{durationText(shot.duration)} · {shot.shotSize || "未写景别"}</span>
                            </div>
                            <div className="stage4b-preview-caption">
                                <span>{sceneTitleOf(document, shot)}</span>
                                <span>{shot.cameraPosition || "未写机位"} · {shot.cameraMovement || "未写运镜"}</span>
                            </div>
                        </div>

                        <div className="stage4b-grid-card__meta">
                            <div><span>景别</span><b>{shot.shotSize || "—"}</b></div>
                            <div><span>机位</span><b>{shot.cameraPosition || "—"}</b></div>
                            <div><span>运镜</span><b>{shot.cameraMovement || "—"}</b></div>
                            <div><span>镜头组</span><b>{groupLabel(document, shot)}</b></div>
                        </div>

                        <div className="stage4b-grid-card__content">
                            <span>{characters}</span>
                            <small>{dialogue || shot.action || "未写台词 / 动作"}</small>
                        </div>

                        <div className="stage4b-grid-card__foot">
                            <div className="stage4b-grid-card__issues" onClick={(event) => event.stopPropagation()}>
                                {errors ? <span className="is-error"><AlertTriangle className="size-3.5" />{errors}</span> : null}
                                {warnings ? <span className="is-warning"><CircleDot className="size-3.5" />{warnings}</span> : null}
                                {suggestions ? <span className="is-suggestion"><span className="stage4b-dot" />{suggestions}</span> : null}
                                {!errors && !warnings && !suggestions ? <span className="is-ok">无检查问题</span> : null}
                            </div>
                            <div className="stage4b-grid-card__actions" onClick={(event) => event.stopPropagation()}>
                                <Button size="small" type="text" onClick={() => onOpen(shot.shotId)}>审片</Button>
                                <Tooltip title="查看审核历史">
                                    <Button size="small" type="text" icon={<FileText className="size-3.5" />} onClick={() => onOpenAudit(shot.shotId)} />
                                </Tooltip>
                                <Dropdown
                                    trigger={["click"]}
                                    menu={{
                                        items: reviewItems,
                                        onClick: ({ key }) => {
                                            if (key === "re_review") onReReview(shot.shotId);
                                            else if (key === "lock") onLockRequest(shot.shotId, true);
                                            else if (key === "unlock") onLockRequest(shot.shotId, false);
                                            else onStatus(shot.shotId, key as "pending" | "approved" | "needs_revision" | "rejected");
                                        },
                                    }}
                                >
                                    <Button size="small" type="text" disabled={busy}>操作</Button>
                                </Dropdown>
                            </div>
                        </div>

                        {locked ? (
                            <div className="stage4b-grid-card__locked-note">
                                <Lock className="size-3.5" /> 已锁定 · 审核结论另存，不随锁定改变
                            </div>
                        ) : null}
                        {stale && !locked ? (
                            <div className="stage4b-grid-card__stale-note">
                                <RefreshCw className="size-3.5" /> 当前正式分镜已变化，需进入审片查看差异并重新审核
                            </div>
                        ) : null}
                    </article>
                );
            })}
            {!shots.length ? <div className="stage4b-grid-empty">没有符合筛选条件的镜头。</div> : null}
        </div>
    );
}
