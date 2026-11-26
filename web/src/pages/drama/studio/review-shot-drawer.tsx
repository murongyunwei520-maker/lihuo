import { useEffect, useState } from "react";
import { Button, Drawer, Input, Tag } from "antd";
import { Check, ChevronLeft, ChevronRight, FileText, ImageOff, Info, RefreshCw, Unlock, X } from "lucide-react";

import type {
    StudioProductionShot,
    StudioStoryboardDocument,
    StudioStoryboardReviewStatus,
    StudioStoryboardVersion,
} from "@/types/studio-production";
import { auditsForShot, buildShotStaleDiff, openIssuesForShot, STORYBOARD_REVIEW_ACTION_LABEL, type StudioStoryboardReviewAnalysis } from "@/lib/studio/review-engine";
import { durationText, groupLabel, groupNoLabel, groupOf, issueIcon, LockBadge, sceneTitleOf, ShotStatusTag } from "./review-shared";

type ReviewShotDrawerProps = {
    open: boolean;
    document?: StudioStoryboardDocument;
    analysis?: StudioStoryboardReviewAnalysis;
    shot?: StudioProductionShot;
    versions?: StudioStoryboardVersion[];
    busy: boolean;
    onClose: () => void;
    onOpenShot: (shotId: string) => void;
    onStatus: (status: "pending" | "approved" | "needs_revision" | "rejected", note: string) => void;
    onSaveNote: (note: string) => void;
    onReReview: (note: string) => void;
    onLockRequest: (locked: boolean) => void;
};

function Field({ label, value }: { label: string; value?: string | number | null }) {
    return <div className="stage4b-field"><span>{label}</span><b>{value || "—"}</b></div>;
}

function ShotMiniCard({
    shot,
    status,
    document,
    active,
    onClick,
}: {
    shot: StudioProductionShot;
    status: StudioStoryboardReviewStatus;
    document: StudioStoryboardDocument;
    active?: boolean;
    onClick: () => void;
}) {
    return (
        <button type="button" className={`stage4b-neighbor ${active ? "is-active" : ""}`} onClick={onClick}>
            <span className="stage4b-neighbor__no">{String(shot.shotNumber).padStart(2, "0")}</span>
            <span className="stage4b-neighbor__main">
                <strong>{sceneTitleOf(document, shot)} · {durationText(shot.duration)}</strong>
                <small>{shot.cameraPosition || "缺机位"} · {shot.cameraMovement || "缺运镜"}</small>
                <small>{shot.characterBlocking || "未写站位"}</small>
            </span>
            <ShotStatusTag status={status} />
            {shot.locked || document.status === "locked" ? <span className="stage4b-neighbor__lock"><LockBadge locked short /></span> : null}
        </button>
    );
}

export function ReviewShotDrawer({
    open,
    document,
    analysis,
    shot,
    versions,
    busy,
    onClose,
    onOpenShot,
    onStatus,
    onSaveNote,
    onReReview,
    onLockRequest,
}: ReviewShotDrawerProps) {
    const [note, setNote] = useState("");
    const record = shot ? analysis?.review.shots[shot.shotId] : undefined;
    const status = shot ? analysis?.statuses[shot.shotId] ?? "pending" : "pending";
    const locked = shot ? Boolean(shot.locked || document?.status === "locked") : false;
    const stale = status === "stale";
    const diff = shot && document ? buildShotStaleDiff({ document, review: analysis?.review, shot, versions }) : undefined;
    const group = shot && document ? groupOf(document, shot) : undefined;
    const issues = shot && analysis ? openIssuesForShot(analysis.issues, shot.shotId) : [];
    const audits = shot && analysis?.review ? auditsForShot(analysis.review, shot.shotId) : [];
    const ordered = document ? [...document.shots].sort((left, right) => left.shotNumber - right.shotNumber) : [];
    const index = shot ? ordered.findIndex((item) => item.shotId === shot.shotId) : -1;
    const previousShot = index > 0 ? ordered[index - 1] : undefined;
    const nextShot = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined;
    const neighbors = [
        { label: "前一镜", shot: previousShot },
        { label: "当前", shot },
        { label: "后一镜", shot: nextShot },
    ];
    const staleScopeShots = document && document.stale
        ? document.stale.shotIds.map((shotId) => document.shots.find((item) => item.shotId === shotId)).filter((item): item is StudioProductionShot => Boolean(item))
        : [];
    const staleScopeGroups = document
        ? [...new Map(staleScopeShots.map((item) => [item.shotGroupId, groupOf(document, item)]).filter((entry): entry is [string, NonNullable<ReturnType<typeof groupOf>>] => Boolean(entry[1]))).values()]
        : [];
    const staleReason = diff?.reason === "upstream" ? "上游剧本变化" : diff?.reason === "content" ? "镜头内容变化" : diff?.reason === "version" ? "审核版本失效" : "";

    useEffect(() => {
        setNote(record?.note ?? "");
    }, [open, shot?.shotId, record?.note, record?.reviewedAt]);

    if (!open || !document || !shot) return null;

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={920}
            destroyOnHidden
            className="stage4b-shot-drawer"
            title={(
                <div className="stage4b-drawer-title">
                    <span className="stage4b-kicker">SHOT REVIEW</span>
                    <strong>镜头 {String(shot.shotNumber).padStart(2, "0")} · {sceneTitleOf(document, shot)}</strong>
                    <span>{document.episodeNumber ? `第 ${document.episodeNumber} 集` : document.episodeId} · 正式 v{document.storyboardVersion}</span>
                </div>
            )}
            extra={(
                <div className="stage4b-drawer-extra">
                    <ShotStatusTag status={status} />
                    <LockBadge locked={locked} />
                </div>
            )}
        >
            <div className="stage4b-shot-detail">
                <div className="stage4b-shot-detail__main">
                    <section className="stage4b-shot-visual">
                        <div className="stage4b-shot-preview">
                            <ImageOff className="size-8" />
                            <strong>暂无预览图</strong>
                            <span>本阶段不生成图片 / 不调用不存在的外部图片服务</span>
                        </div>
                        <div className="stage4b-shot-visual__facts">
                            <Field label="镜号" value={String(shot.shotNumber).padStart(2, "0")} />
                            <Field label="所属集数" value={document.episodeNumber ? `第 ${document.episodeNumber} 集` : document.episodeId} />
                            <Field label="场景" value={sceneTitleOf(document, shot)} />
                            <Field label="镜头组" value={group ? groupLabel(document, shot) : "无"} />
                            <Field label="时长" value={durationText(shot.duration)} />
                            <Field label="正式版本" value={`v${document.storyboardVersion}`} />
                            <Field label="审核绑定" value={record ? `v${record.storyboardVersion}` : "尚无记录"} />
                        </div>
                        <div className="stage4b-shot-people">
                            <span>人物</span>
                            <div>{shot.characterBindings.length ? shot.characterBindings.map((binding) => <Tag key={binding.characterId} bordered={false}>{binding.name}</Tag>) : "未绑定"}</div>
                        </div>
                    </section>

                    <section className="stage4b-shot-content">
                        <div className="stage4b-section-title"><strong>镜头信息</strong><small>只读审片，不在 4B 修改正式分镜</small></div>
                        <div className="stage4b-field-grid">
                            <Field label="景别" value={shot.shotSize} />
                            <Field label="机位" value={shot.cameraPosition} />
                            <Field label="角度 / 镜头" value={[shot.cameraAngle, shot.lens].filter(Boolean).join(" · ")} />
                            <Field label="运镜" value={shot.cameraMovement} />
                            <Field label="构图" value={shot.composition} />
                            <Field label="前景 / 中景 / 背景" value={[shot.foreground, shot.midground, shot.background].filter(Boolean).join("；")} />
                        </div>
                        <div className="stage4b-section-title"><strong>表演与动作</strong></div>
                        <div className="stage4b-field-grid">
                            <Field label="人物站位" value={shot.characterBlocking} />
                            <Field label="人物视线" value={shot.eyeline} />
                            <Field label="动作" value={shot.action} />
                            <Field label="表情" value={shot.facialExpression} />
                            <Field label="情绪变化" value={shot.emotion} />
                            <Field label="环境" value={shot.environment} />
                            <Field label="光照" value={shot.lighting} />
                            <Field label="声音设计" value={[shot.voiceOver, shot.soundEffects, shot.backgroundMusic].filter(Boolean).join("；")} />
                        </div>
                        <div className="stage4b-section-title"><strong>台词</strong></div>
                        {shot.dialogue.length ? (
                            <div className="stage4b-dialogue">
                                {shot.dialogue.map((line, lineIndex) => (
                                    <div key={`${line.characterId}-${lineIndex}`}>
                                        <strong>{line.speaker}</strong>
                                        <span>{line.text}</span>
                                        <small>{[line.delivery, line.emotion].filter(Boolean).join(" · ")}</small>
                                    </div>
                                ))}
                            </div>
                        ) : <div className="stage4b-muted">这一镜没有对白。</div>}
                        <div className="stage4b-section-title"><strong>连续性与道具</strong></div>
                        <div className="stage4b-field-grid">
                            <Field label="连续性约束" value={shot.continuityRules.join("；")} />
                            <Field label="人物绑定" value={shot.characterBindings.map((binding) => `${binding.name}（characterId: ${binding.characterId}${binding.outfitId ? `；outfitId: ${binding.outfitId}` : ""}）`).join("；") || "未绑定"} />
                            <Field label="服装绑定" value={shot.outfitBindings.map((binding) => `${binding.characterId} · outfitId: ${binding.outfitId} · ${binding.description}`).join("；") || "未绑定"} />
                            <Field label="场景绑定" value={`locationId: ${shot.sceneBindings.locationId} · locationVariantId: ${shot.sceneBindings.locationVariantId || "默认"}`} />
                            <Field label="道具绑定" value={shot.propBindings.map((binding) => `${binding.name}（propId: ${binding.propId}；状态: ${binding.state}）`).join("；") || "未绑定"} />
                            <Field label="道具状态" value={shot.propBindings.map((binding) => `${binding.name}（${binding.state}）`).join("；")} />
                            <Field label="出处场景" value={shot.sourceScriptSceneId} />
                            <Field label="镜头版本" value={`镜头 v${shot.version}`} />
                        </div>
                    </section>

                    <section className="stage4b-review-panel">
                        <div className="stage4b-section-title"><strong>审核与锁定</strong><small>审核结论与锁定分开保存</small></div>
                        <div className="stage4b-review-state">
                            <div><span>审核状态</span><ShotStatusTag status={status} /></div>
                            <div><span>锁定状态</span><LockBadge locked={locked} /></div>
                            <div><span>审核记录</span><b>{record ? `v${record.storyboardVersion} · ${new Date(record.reviewedAt).toLocaleString()}` : "尚无记录"}</b></div>
                            <div><span>审核者</span><b>{record?.reviewedBy === "local-user" ? "本地用户" : record?.reviewedBy || "—"}</b></div>
                        </div>
                        {stale ? (
                            <div className="stage4b-stale-panel">
                                <div className="stage4b-stale-panel__head"><RefreshCw className="size-4" /><strong>需要重新审核</strong><span>{staleReason || "版本差异"}</span></div>
                                <p>{diff?.message || "当前审核记录与正式分镜不一致。"}</p>
                                <div className="stage4b-version-line">
                                    <span>旧审核 {diff?.previousVersion !== undefined ? `v${diff.previousVersion}` : "未知"}</span>
                                    <span>→</span>
                                    <span>当前正式 v{diff?.currentVersion ?? document.storyboardVersion}</span>
                                </div>
                                {staleScopeShots.length ? (
                                    <div className="stage4b-stale-scope">
                                        <div><span>受影响镜头</span><b>{staleScopeShots.map((item) => String(item.shotNumber).padStart(2, "0")).join("、")}</b></div>
                                        <div><span>受影响镜头组</span><b>{staleScopeGroups.length ? staleScopeGroups.map((item) => groupNoLabel(document, item)).join("、") : "不属于镜头组"}</b></div>
                                    </div>
                                ) : null}
                                {diff?.unavailable ? (
                                    <div className="stage4b-diff-unavailable"><Info className="size-3.5" /> 无法完整比较历史内容，不能编造字段差异。</div>
                                ) : diff?.fields.length ? (
                                    <div className="stage4b-diff-list">
                                        {diff.fields.map((field) => (
                                            <div key={field.key} className="stage4b-diff-row">
                                                <span>{field.label}</span>
                                                <div className="stage4b-diff-value is-before">{field.before || "—"}</div>
                                                <ChevronRight className="size-3.5" />
                                                <div className="stage4b-diff-value is-after">{field.after || "—"}</div>
                                            </div>
                                        ))}
                                    </div>
                                ) : <div className="stage4b-diff-empty">未发现可展示的镜头字段差异。</div>}
                                <Button type="primary" icon={<RefreshCw className="size-3.5" />} disabled={busy || locked} onClick={() => onReReview(note)}>
                                    重新审核当前正式分镜
                                </Button>
                                <small>会创建绑定 v{document.storyboardVersion} 的新待审记录，旧审核历史保留；不会自动通过。</small>
                            </div>
                        ) : null}
                        <div className="stage4b-review-actions">
                            <Button type="primary" icon={<Check className="size-3.5" />} disabled={busy || locked || stale} onClick={() => onStatus("approved", note)}>通过审核</Button>
                            <Button disabled={busy || locked || stale} onClick={() => onStatus("needs_revision", note)}>标记需要修改</Button>
                            <Button danger icon={<X className="size-3.5" />} disabled={busy || locked || stale} onClick={() => onStatus("rejected", note)}>驳回</Button>
                            <Button disabled={busy || locked || stale} onClick={() => onStatus("pending", note)}>重置待审</Button>
                        </div>
                        <div className="stage4b-note">
                            <div className="stage4b-section-title"><strong>审核备注</strong><small>{note.length} / 300</small></div>
                            <Input.TextArea
                                value={note}
                                maxLength={300}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                placeholder="记录这次审核的具体原因；保存或随审核一起写入"
                                onChange={(event) => setNote(event.target.value)}
                            />
                            <Button size="small" icon={<FileText className="size-3.5" />} disabled={busy || locked || stale || !note.trim()} onClick={() => onSaveNote(note)}>仅保存备注</Button>
                        </div>
                        <div className="stage4b-lock-actions">
                            {locked ? (
                                <Button icon={<Unlock className="size-3.5" />} disabled={busy || document.status === "locked"} onClick={() => onLockRequest(false)}>解锁镜头（需确认）</Button>
                            ) : (
                                <Button disabled={busy} onClick={() => onLockRequest(true)}>锁定镜头</Button>
                            )}
                            <small>{locked ? "锁定不影响审核结论；解锁会保留审核记录。" : "锁定只限制后续修改，不自动通过审核。"}</small>
                        </div>
                    </section>
                </div>

                <section className="stage4b-shot-context">
                    <div className="stage4b-section-title"><strong>前后镜头</strong><small>按镜号顺序；镜头组上下文见下方</small></div>
                    <div className="stage4b-neighbor-row">
                        {previousShot ? <ShotMiniCard shot={previousShot} status={analysis?.statuses[previousShot.shotId] ?? "pending"} document={document} onClick={() => onOpenShot(previousShot.shotId)} /> : <div className="stage4b-neighbor-empty"><ChevronLeft className="size-4" /> 没有前一镜</div>}
                        <ShotMiniCard shot={shot} status={status} document={document} active onClick={() => onOpenShot(shot.shotId)} />
                        {nextShot ? <ShotMiniCard shot={nextShot} status={analysis?.statuses[nextShot.shotId] ?? "pending"} document={document} onClick={() => onOpenShot(nextShot.shotId)} /> : <div className="stage4b-neighbor-empty">没有后一镜 <ChevronRight className="size-4" /></div>}
                    </div>
                    <div className="stage4b-neighbor-compare">
                        {neighbors.map((item) => (
                            <div key={item.label} className={`stage4b-neighbor-compare__col ${item.label === "当前" ? "is-active" : ""}`}>
                                <div className="stage4b-neighbor-compare__head">
                                    <strong>{item.label}</strong>
                                    <span>{item.shot ? `镜 ${String(item.shot.shotNumber).padStart(2, "0")}` : "—"}</span>
                                </div>
                                <Field label="人物位置" value={item.shot?.characterBlocking} />
                                <Field label="运动方向" value={item.shot ? [item.shot.cameraMovement, item.shot.action].filter(Boolean).join("；") : "—"} />
                                <Field label="视线关系" value={item.shot?.eyeline} />
                                <Field label="场景状态" value={item.shot ? [sceneTitleOf(document, item.shot), item.shot.environment].filter(Boolean).join(" · ") : "—"} />
                                <Field label="道具状态" value={item.shot?.propBindings.map((binding) => `${binding.name}（${binding.state}）`).join("；")} />
                            </div>
                        ))}
                    </div>
                </section>

                {group ? (
                    <section className="stage4b-group-context">
                        <div className="stage4b-section-title"><strong>镜头组 · {groupNoLabel(document, group)}</strong><small>{group.shotIds.length} 镜 · 组内连续性</small></div>
                        <div className="stage4b-field-grid">
                            <Field label="共享布局" value={group.sharedLayout} />
                            <Field label="摄影机轴线" value={group.cameraAxis} />
                            <Field label="道具状态" value={group.propStates} />
                            <Field label="时间 / 天气" value={[group.timeOfDay, group.weather].filter(Boolean).join(" · ")} />
                            <Field label="光照" value={group.lighting} />
                            <Field label="组内连续性" value={group.continuityRules.join("；")} />
                            <Field label="人物起点" value={group.characterStartPositions.map((position) => `${position.name}：${position.position} / ${position.orientation} / ${position.eyeline}`).join("；")} />
                            <Field label="组内镜头" value={group.shotIds.map((shotId) => document.shots.find((item) => item.shotId === shotId)).filter(Boolean).map((item) => String(item?.shotNumber).padStart(2, "0")).join("、")} />
                        </div>
                        <div className="stage4b-group-members">
                            {group.shotIds.map((shotId) => {
                                const member = document.shots.find((item) => item.shotId === shotId);
                                if (!member) return <span key={shotId} className="is-missing">{shotId} · 已失效</span>;
                                return (
                                    <button key={shotId} type="button" className={`stage4b-group-member ${member.shotId === shot.shotId ? "is-active" : ""}`} onClick={() => onOpenShot(member.shotId)}>
                                        <span>{String(member.shotNumber).padStart(2, "0")}</span>
                                        <small>{member.shotSize || "缺景别"}</small>
                                        <ShotStatusTag status={analysis?.statuses[member.shotId] ?? "pending"} />
                                        {member.locked || document.status === "locked" ? <LockBadge locked short /> : null}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                ) : null}

                <section className="stage4b-detail-lower">
                    <div className="stage4b-issues-panel">
                        <div className="stage4b-section-title"><strong>当前检查</strong><small>{issues.length} 条未处理</small></div>
                        {issues.length ? issues.map((issue) => (
                            <div key={issue.id} className={`stage4b-issue is-${issue.level}`}>
                                {issueIcon(issue.level)}
                                <div><strong>{issue.message}</strong><small>{issue.suggestion}</small></div>
                            </div>
                        )) : <div className="stage4b-muted">这一镜没有未处理的结构检查问题。</div>}
                    </div>
                    <div className="stage4b-history-panel">
                        <div className="stage4b-section-title"><strong>审核历史</strong><small>{audits.length} 条记录</small></div>
                        {audits.length ? (
                            <div className="stage4b-history">
                                {audits.map((audit) => (
                                    <div key={audit.id} className="stage4b-history__item">
                                        <div className="stage4b-history__line">
                                            <ShotStatusTag status={audit.fromStatus} />
                                            <ChevronRight className="size-3.5" />
                                            <ShotStatusTag status={audit.toStatus} />
                                            <span>{STORYBOARD_REVIEW_ACTION_LABEL[audit.action]}</span>
                                        </div>
                                        <small>{audit.actor === "local-user" ? "本地用户" : audit.actor} · v{audit.storyboardVersion} · {new Date(audit.createdAt).toLocaleString()}</small>
                                        {audit.storyboardVersion !== document.storyboardVersion ? <Tag color="warning">旧版本记录 · 不对应当前 v{document.storyboardVersion}</Tag> : <Tag color="success">当前版本记录</Tag>}
                                        <p>{audit.note || "无备注"}</p>
                                    </div>
                                ))}
                            </div>
                        ) : <div className="stage4b-muted">这个镜头还没有审核记录。</div>}
                    </div>
                </section>
            </div>
        </Drawer>
    );
}
