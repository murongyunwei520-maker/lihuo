import { Button, Checkbox, Dropdown, Tooltip } from "antd";
import { AlertTriangle, CircleDot, FileText, Info } from "lucide-react";

import type {
    StudioProductionShot,
    StudioStoryboardDocument,
    StudioStoryboardReviewIssue,
    StudioStoryboardReviewStatus,
} from "@/types/studio-production";
import { durationText, groupLabel, LockBadge, sceneTitleOf, ShotStatusTag } from "./review-shared";

type ReviewListProps = {
    document: StudioStoryboardDocument;
    shots: StudioProductionShot[];
    statuses: Record<string, StudioStoryboardReviewStatus>;
    issues: StudioStoryboardReviewIssue[];
    selected: Set<string>;
    busy: boolean;
    sort: string;
    onSort: (value: string) => void;
    onToggleSelection: (shotId: string) => void;
    onOpen: (shotId: string) => void;
    onStatus: (shotId: string, status: "pending" | "approved" | "needs_revision" | "rejected") => void;
    onOpenAudit: (shotId: string) => void;
    onLockRequest: (shotId: string, locked: boolean) => void;
    onReReview: (shotId: string) => void;
};

export function ReviewList({
    document,
    shots,
    statuses,
    issues,
    selected,
    busy,
    sort,
    onSort,
    onToggleSelection,
    onOpen,
    onStatus,
    onOpenAudit,
    onLockRequest,
    onReReview,
}: ReviewListProps) {
    return (
        <div className="stage4b-list">
            <div className="stage4b-list__head">
                <span />
                <button type="button" className={`stage4b-list__sort ${sort === "number_asc" || sort === "number_desc" ? "is-active" : ""}`} onClick={() => onSort(sort === "number_asc" ? "number_desc" : "number_asc")}>镜号 {sort === "number_desc" ? "↓" : "↑"}</button>
                <span>场景 / 镜头语言 / 人物台词</span>
                <button type="button" className={`stage4b-list__sort ${sort === "duration_asc" || sort === "duration_desc" ? "is-active" : ""}`} onClick={() => onSort(sort === "duration_asc" ? "duration_desc" : "duration_asc")}>时长 {sort === "duration_desc" ? "↓" : "↑"}</button>
                <span>审核</span>
                <span>锁定</span>
                <span>问题</span>
                <span>操作</span>
            </div>
            {shots.map((shot) => {
                const status = statuses[shot.shotId] ?? "pending";
                const documentLocked = document.status === "locked";
                const locked = shot.locked || documentLocked;
                const stale = status === "stale";
                const shotIssues = issues.filter((issue) => issue.shotId === shot.shotId && issue.status === "open" && !issue.continuityStale);
                const errors = shotIssues.filter((issue) => issue.level === "error").length;
                const warnings = shotIssues.filter((issue) => issue.level === "warning").length;
                const suggestions = shotIssues.filter((issue) => issue.level === "suggestion").length;
                const characters = shot.characterBindings.map((binding) => binding.name).filter(Boolean).join("、") || "—";
                const dialogue = shot.dialogue.map((line) => `${line.speaker}：${line.text}`).join(" / ") || "—";
                const reviewItems = [
                    { key: "approved", label: "通过", disabled: locked || stale || busy },
                    { key: "needs_revision", label: "标记需要修改", disabled: locked || stale || busy },
                    { key: "rejected", label: "驳回", disabled: locked || stale || busy },
                    { key: "pending", label: "重置待审", disabled: locked || stale || busy },
                ];
                if (stale) reviewItems.unshift({ key: "re_review", label: "重新审核（创建新记录）", disabled: locked || busy });
                reviewItems.push({
                    key: locked ? "unlock" : "lock",
                    label: documentLocked ? "整份分镜已锁定 · 需先解锁整份" : locked ? "解锁（需确认）" : "锁定",
                    disabled: documentLocked,
                });
                return (
                    <article
                        key={shot.shotId}
                        className={`stage4b-list__row ${selected.has(shot.shotId) ? "is-selected" : ""} ${stale ? "is-stale" : ""}`}
                        onClick={() => onOpen(shot.shotId)}
                    >
                        <div className="stage4b-list__check" onClick={(event) => event.stopPropagation()}>
                            <Checkbox
                                checked={selected.has(shot.shotId)}
                                disabled={busy}
                                onChange={() => onToggleSelection(shot.shotId)}
                                aria-label={`选择镜头 ${shot.shotNumber}`}
                            />
                        </div>
                        <div className="stage4b-list__number">
                            <strong>{String(shot.shotNumber).padStart(2, "0")}</strong>
                            {stale ? <span className="is-stale">STALE</span> : null}
                        </div>
                        <div className="stage4b-list__main">
                            <div className="stage4b-list__scene">
                                <strong>{sceneTitleOf(document, shot)}</strong>
                                <small>{groupLabel(document, shot)}</small>
                            </div>
                            <div className="stage4b-list__language">
                                <span>{shot.shotSize || "缺景别"} · {shot.cameraPosition || "缺机位"} · {shot.cameraMovement || "缺运镜"}</span>
                                <small>{shot.composition || "未写构图"}</small>
                            </div>
                            <div className="stage4b-list__content">
                                <span>{characters}</span>
                                <small>{dialogue}</small>
                                <small className="is-action">{shot.action || "未写动作"}</small>
                            </div>
                        </div>
                        <div className="stage4b-list__duration">{durationText(shot.duration)}</div>
                        <div><ShotStatusTag status={status} /></div>
                        <div><LockBadge locked={locked} short /></div>
                        <div className="stage4b-list__issues">
                            {errors ? <span className="is-error"><AlertTriangle className="size-3.5" />{errors}</span> : null}
                            {warnings ? <span className="is-warning"><CircleDot className="size-3.5" />{warnings}</span> : null}
                            {suggestions ? <span className="is-suggestion"><Info className="size-3.5" />{suggestions}</span> : null}
                            {!errors && !warnings && !suggestions ? <span className="is-ok">无</span> : null}
                        </div>
                        <div className="stage4b-list__actions" onClick={(event) => event.stopPropagation()}>
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
                    </article>
                );
            })}
            {!shots.length ? <div className="stage4b-list-empty">没有符合筛选条件的镜头。</div> : null}
        </div>
    );
}
