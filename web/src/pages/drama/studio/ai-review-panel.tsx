// Stage 4D：审核结果与调整提案工作台。AI 只产出审核记录和提案，所有正式写入都在用户点击后发生。

import { useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Tag, Tooltip } from "antd";
import { AlertTriangle, Bot, Check, CircleDot, Info, ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";

import { applyAiProposalAction, markAiProposalConflictAction, rejectAiProposalAction } from "@/lib/studio/stage4d-actions";
import { proposalChangeEvidenceError } from "@/lib/studio/stage4d-engine";
import { aiEvidenceTypeLabel, normalizeAiEvidenceType } from "@/lib/studio/review-evidence";
import type {
    StudioAiAdjustmentProposal,
    StudioAiReviewFinding,
    StudioAiReviewRun,
    StudioProductionShot,
    StudioStoryboardDocument,
    StudioStoryboardReview,
} from "@/types/studio-production";
import { shotLabel } from "./review-shared";

const LEVEL_LABEL: Record<string, string> = { error: "Error", warning: "Warning", suggestion: "Suggestion" };
const EMPTY_PROPOSALS: StudioAiAdjustmentProposal[] = [];
const DECISION_LABEL: Record<string, string> = {
    pending: "待决策",
    accepted: "已全部接受",
    partial: "已局部接受",
    rejected: "已拒绝",
    conflict: "版本冲突",
    failed: "应用失败",
};

function currentRun(runs: StudioAiReviewRun[] | undefined, version: number) {
    return runs?.filter((run) => run.storyboardVersion === version).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function FindingCard({ finding, document }: { finding: StudioAiReviewFinding; document: StudioStoryboardDocument }) {
    const shots = finding.shotIds.map((shotId) => document.shots.find((shot) => shot.shotId === shotId)).filter((shot): shot is StudioProductionShot => Boolean(shot));
    const evidenceType = normalizeAiEvidenceType(finding.evidenceType);
    return (
        <div className={`stage4d-finding is-${finding.level}`}>
            <div className="stage4d-finding__head">
                <Tag color={finding.level === "error" ? "error" : finding.level === "warning" ? "warning" : "blue"}>{LEVEL_LABEL[finding.level] ?? finding.level}</Tag>
                <strong>{finding.category}</strong>
                <Tag color={evidenceType === "explicit" ? "success" : evidenceType === "unknown" ? "warning" : evidenceType === "suggestion" ? "blue" : "default"}>{aiEvidenceTypeLabel(finding.evidenceType)}</Tag>
                <small>{finding.confidence === "high" ? "高置信" : finding.confidence === "medium" ? "中置信" : "低置信"}</small>
            </div>
            <p>{finding.message}</p>
            <div className="stage4d-finding__meta">
                <span>{shots.map((shot) => shotLabel(shot)).join("、") || "未定位镜头"}</span>
                {finding.fieldPath ? <span>{finding.fieldPath}</span> : null}
            </div>
            <div className="stage4d-finding__reason"><b>原因</b>{finding.reason}</div>
            <div className="stage4d-finding__reason"><b>建议</b>{finding.suggestion}</div>
            <div className="stage4d-finding__evidence"><b>证据</b>{finding.evidence || "未记录证据"}<em>{aiEvidenceTypeLabel(finding.evidenceType)}</em></div>
        </div>
    );
}

function ProposalCard({
    proposal,
    document,
    selected,
    busy,
    onToggle,
    onSelectAll,
    onApply,
    onReject,
    onMarkConflict,
}: {
    proposal: StudioAiAdjustmentProposal;
    document: StudioStoryboardDocument;
    selected: string[];
    busy: boolean;
    onToggle: (changeId: string, checked: boolean) => void;
    onSelectAll: () => void;
    onApply: () => void;
    onReject: () => void;
    onMarkConflict: () => void;
}) {
    const current = proposal.storyboardVersion === document.storyboardVersion;
    const pending = proposal.decision.status === "pending";
    return (
        <div className={`stage4d-proposal ${current ? "" : "is-stale"} ${pending ? "" : "is-decided"}`}>
            <div className="stage4d-proposal__head">
                <div>
                    <strong>{proposal.title}</strong>
                    <small>基于 v{proposal.storyboardVersion}{current ? "" : ` · 当前 v${document.storyboardVersion}`} · {proposal.changes.length} 项修改</small>
                </div>
                <Tag color={proposal.decision.status === "accepted" || proposal.decision.status === "partial" ? "success" : proposal.decision.status === "conflict" || proposal.decision.status === "failed" ? "error" : proposal.decision.status === "rejected" ? "default" : "gold"}>{DECISION_LABEL[proposal.decision.status] ?? proposal.decision.status}</Tag>
            </div>
            <p className="stage4d-proposal__rationale">{proposal.rationale}</p>
            {!current ? <div className="stage4d-warning"><AlertTriangle className="size-3.5" /> 提案绑定的版本已过期。应用会因版本冲突被拒绝；可点击「标记版本冲突」保留决策记录，不会修改正式分镜。</div> : null}
            <div className="stage4d-changes">
                {proposal.changes.map((change) => {
                    const shot = document.shots.find((item) => item.shotId === change.shotId);
                    const evidenceError = proposalChangeEvidenceError(change);
                    return (
                        <label key={change.changeId} className={`stage4d-change ${current && pending ? "" : "is-readonly"}`}>
                            <Checkbox
                                checked={selected.includes(change.changeId)}
                                disabled={!current || !pending || busy || Boolean(evidenceError)}
                                onChange={(event) => onToggle(change.changeId, event.target.checked)}
                            />
                            <span className="stage4d-change__body">
                                <span className="stage4d-change__where">{shot ? shotLabel(shot) : change.shotId} · {change.fieldLabel}{change.speculative ? " · 推断修改" : ""}</span>
                                <span className="stage4d-change__diff"><del>{change.before || "（空）"}</del><ins>{change.after}</ins></span>
                                <span className="stage4d-change__why">{change.reason}</span>
                                <span className="stage4d-change__impact">影响：{change.impact}</span>
                                <span className="stage4d-change__impact">
                                    证据（{aiEvidenceTypeLabel(change.evidenceType)} · {change.confidence === "high" ? "高置信" : change.confidence === "medium" ? "中置信" : "低置信"}）：{change.evidence || "未记录证据"}
                                    {change.sourceShotIds?.length ? ` · 来源镜头 ${change.sourceShotIds.join("、")}` : ""}
                                    {change.sourceChapterId ? ` · 章节 ${change.sourceChapterId}` : ""}
                                    {change.sourceVersion ? ` · 来源版本 ${change.sourceVersion}` : ""}
                                    {evidenceError ? ` · ${evidenceError}` : ""}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </div>
            {pending ? (
                <div className="stage4d-proposal__actions">
                    {current ? (
                        <>
                            <Button size="small" type="primary" icon={<ShieldCheck className="size-3.5" />} disabled={!selected.length || busy} onClick={onApply}>
                                应用选中修改（{selected.length}/{proposal.changes.length}）
                            </Button>
                            <Button size="small" type="link" disabled={busy || selected.length === proposal.changes.length} onClick={onSelectAll}>全选修改</Button>
                        </>
                    ) : (
                        <Button size="small" icon={<AlertTriangle className="size-3.5" />} disabled={busy} onClick={onMarkConflict}>标记版本冲突</Button>
                    )}
                    <Button size="small" danger icon={<X className="size-3.5" />} disabled={busy} onClick={onReject}>拒绝提案</Button>
                </div>
            ) : proposal.decision.note ? <div className="stage4d-decision-note">{proposal.decision.note}</div> : null}
        </div>
    );
}

export function AiReviewPanel({
    open,
    projectId,
    episodeId,
    document,
    review,
    selectedShotIds,
    running,
    onClose,
    onRun,
}: {
    open: boolean;
    projectId: string;
    episodeId: string;
    document?: StudioStoryboardDocument;
    review?: StudioStoryboardReview;
    selectedShotIds: string[];
    running: boolean;
    onClose: () => void;
    onRun: (scopeType: "shot" | "selection" | "episode", shotIds: string[]) => void;
}) {
    const { message, modal } = App.useApp();
    const [selectedChanges, setSelectedChanges] = useState<Record<string, string[]>>({});
    const [applying, setApplying] = useState<string>();
    const [marking, setMarking] = useState<string>();
    const proposals = review?.proposals ?? EMPTY_PROPOSALS;
    const latest = document ? currentRun(review?.aiReviewRuns, document.storyboardVersion) : undefined;
    const historical = document ? (review?.aiReviewRuns ?? []).filter((run) => run.runId !== latest?.runId).slice(0, 5) : [];
    const applications = (review?.proposalApplications ?? []).slice(0, 8);
    const pending = proposals.filter((proposal) => proposal.decision.status === "pending");

    useEffect(() => {
        if (!open || !document) return;
        setSelectedChanges((previous) => {
            const next: Record<string, string[]> = {};
            for (const proposal of proposals) {
                if (proposal.decision.status !== "pending" || proposal.storyboardVersion !== document.storyboardVersion) continue;
                const previousSelection = previous[proposal.proposalId] ?? [];
                next[proposal.proposalId] = previousSelection.filter((id) => proposal.changes.some((change) => change.changeId === id && !proposalChangeEvidenceError(change)));
            }
            return next;
        });
    }, [document, open, proposals]);

    const counts = useMemo(() => ({
        error: latest?.findings.filter((finding) => finding.level === "error").length ?? 0,
        warning: latest?.findings.filter((finding) => finding.level === "warning").length ?? 0,
        suggestion: latest?.findings.filter((finding) => finding.level === "suggestion").length ?? 0,
    }), [latest]);

    function toggle(proposalId: string, changeId: string, checked: boolean) {
        setSelectedChanges((previous) => {
            const current = previous[proposalId] ?? [];
            return { ...previous, [proposalId]: checked ? [...current, changeId] : current.filter((id) => id !== changeId) };
        });
    }

    function selectAll(proposal: StudioAiAdjustmentProposal) {
        setSelectedChanges((previous) => ({
            ...previous,
            [proposal.proposalId]: proposal.changes.filter((change) => !proposalChangeEvidenceError(change)).map((change) => change.changeId),
        }));
    }

    function apply(proposal: StudioAiAdjustmentProposal) {
        if (!document) return;
        const ids = (selectedChanges[proposal.proposalId] ?? []).filter((id) => {
            const change = proposal.changes.find((item) => item.changeId === id);
            return change && !proposalChangeEvidenceError(change);
        });
        if (!ids.length) {
            message.warning("没有可应用的修改项：请选择证据有效的修改，或重新审核");
            return;
        }
        const otherPending = pending.filter((item) => item.proposalId !== proposal.proposalId).length;
        modal.confirm({
            title: `应用 ${ids.length} 项修改？`,
            content: `已选中 ${ids.length} / ${proposal.changes.length} 项；正式分镜将从 v${document.storyboardVersion} 写入 v${document.storyboardVersion + 1}。应用前先保存备份，再重跑连续性检查。${otherPending ? `其他 ${otherPending} 条待决策提案不会自动合并，仍基于旧版本的提案需要单独标记版本冲突或拒绝。` : "未选中的修改保持原样。"}`,
            okText: "保存备份并应用",
            cancelText: "取消",
            onOk: async () => {
                setApplying(proposal.proposalId);
                const result = await applyAiProposalAction({ projectId, episodeId, proposalId: proposal.proposalId, acceptedChangeIds: ids });
                setApplying(undefined);
                if (!result.ok) {
                    const detail = result.details?.length ? `：${result.details.join("；")}` : "";
                    if (result.conflict) message.error(`${result.error || "提案版本冲突，未覆盖当前分镜"}${detail}`);
                    else message.error(`${result.error || "提案应用失败"}${detail}`);
                    return;
                }
                message.success(`已应用 ${result.appliedChangeIds?.length ?? ids.length} 项修改，正式分镜 v${result.newVersion}；已保存应用前备份并重跑连续性检查`);
                if (result.unverifiedAssetDetails?.length) {
                    message.warning(`有 ${result.unverifiedAssetDetails.length} 项资产变体无法独立验证，未按有效处理：${result.unverifiedAssetDetails[0]}`);
                }
            },
        });
    }

    function markConflict(proposal: StudioAiAdjustmentProposal) {
        if (!document) return;
        modal.confirm({
            title: "标记为版本冲突？",
            content: `提案基于 v${proposal.storyboardVersion}，当前正式分镜是 v${document.storyboardVersion}。确认后只写入冲突决策与应用记录，不修改正式分镜、不重新应用任何修改、不自动 rebase。`,
            okText: "确认标记冲突",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setMarking(proposal.proposalId);
                const result = await markAiProposalConflictAction({ projectId, episodeId, proposalId: proposal.proposalId });
                setMarking(undefined);
                if (!result.ok) {
                    message.error(result.error || "版本冲突记录保存失败");
                    return;
                }
                message.success("已标记版本冲突并写入本地数据库；正式分镜未改变");
            },
        });
    }

    function reject(proposal: StudioAiAdjustmentProposal) {
        modal.confirm({
            title: "拒绝这条提案？",
            content: "拒绝只记录决策，不会修改正式分镜；已拒绝提案的修改项不会自动应用。",
            okText: "确认拒绝",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                const result = await rejectAiProposalAction({ projectId, episodeId, proposalId: proposal.proposalId });
                if (!result.ok) {
                    message.error(result.error || "提案拒绝保存失败");
                    return;
                }
                message.success("提案已拒绝并写入本地数据库");
            },
        });
    }

    return (
        <Drawer open={open} onClose={onClose} width={760} title={<span className="stage4d-drawer-title"><Bot className="size-4" /> AI 分镜审核与调整提案</span>} destroyOnClose>
            <div className="stage4d-panel">
                {!document ? (
                    <Empty description="本集还没有正式分镜" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                    <>
                        <div className="stage4d-panel__intro">
                            <div>
                                <strong>AI 只生成审核记录与提案，不直接改写正式分镜。</strong>
                                <p>审核会读取当前正式镜头和 4C 连续性检查结果。所有提案必须由你逐项确认，应用前再次校验版本、依赖、人工编辑与修改前内容。</p>
                            </div>
                            <div className="stage4d-panel__run">
                                <Button size="small" type="primary" icon={<Sparkles className="size-3.5" />} loading={running} disabled={!document} onClick={() => onRun("episode", document.shots.map((shot) => shot.shotId))}>整集审核</Button>
                                <Button size="small" icon={<Bot className="size-3.5" />} loading={running} disabled={!document || !selectedShotIds.length} onClick={() => onRun(selectedShotIds.length === 1 ? "shot" : "selection", selectedShotIds)}>审核选中（{selectedShotIds.length}）</Button>
                            </div>
                        </div>

                        {latest ? (
                            <>
                                <div className="stage4d-run-head">
                                    <div>
                                        <span className="stage4-kicker">当前版本 v{document.storyboardVersion} 的 AI 审核</span>
                                        <h3>{latest.summary}</h3>
                                        <small>范围 {latest.scope.type === "episode" ? "整集" : `${latest.scope.shotIds.length} 镜`} · 连续性检查 {latest.continuityCheckId} · {new Date(latest.createdAt).toLocaleString()}</small>
                                    </div>
                                    <div className="stage4d-run-counts">
                                        <span className="is-error"><AlertTriangle className="size-3.5" /> {counts.error}</span>
                                        <span className="is-warning"><CircleDot className="size-3.5" /> {counts.warning}</span>
                                        <span className="is-suggestion"><Info className="size-3.5" /> {counts.suggestion}</span>
                                    </div>
                                </div>
                                {latest.status === "failed" ? <div className="stage4d-error"><ShieldAlert className="size-3.5" /> 本次审核失败：{latest.error || "模型未返回可用结果"}。失败记录已保留。</div> : null}
                                {latest.warnings?.length ? <div className="stage4d-warning"><AlertTriangle className="size-3.5" /> 审核结果有 {latest.warnings.length} 条被过滤/降级：{latest.warnings.slice(0, 4).join("；")}</div> : null}
                                <div className="stage4d-findings">
                                    {latest.findings.length ? latest.findings.map((finding) => <FindingCard key={finding.id} finding={finding} document={document} />) : <div className="stage4d-empty-line">本次 AI 审核没有产生问题项。</div>}
                                </div>
                            </>
                        ) : (
                            <div className="stage4d-empty-line">当前正式版本还没有 AI 审核记录。可整集审核，或选择镜头后审核选中。</div>
                        )}

                        <div className="stage4d-section-head">
                            <div><strong>调整提案</strong><small>待决策 {pending.length} 条；已应用不会覆盖其他提案，未选中的修改保持原样。</small></div>
                        </div>
                        {pending.length ? pending.map((proposal) => (
                            <ProposalCard
                                key={proposal.proposalId}
                                proposal={proposal}
                                document={document}
                                selected={selectedChanges[proposal.proposalId] ?? []}
                                busy={applying === proposal.proposalId || marking === proposal.proposalId}
                                onToggle={(changeId, checked) => toggle(proposal.proposalId, changeId, checked)}
                                onSelectAll={() => selectAll(proposal)}
                                onApply={() => apply(proposal)}
                                onReject={() => reject(proposal)}
                                onMarkConflict={() => markConflict(proposal)}
                            />
                        )) : <div className="stage4d-empty-line">没有待决策提案。</div>}

                        {proposals.some((proposal) => proposal.decision.status !== "pending") ? (
                            <details className="stage4d-history" open>
                                <summary>已决策 / 冲突 / 失败提案（{proposals.filter((proposal) => proposal.decision.status !== "pending").length}）</summary>
                                {proposals.filter((proposal) => proposal.decision.status !== "pending").map((proposal) => (
                                    <ProposalCard
                                        key={proposal.proposalId}
                                        proposal={proposal}
                                        document={document}
                                        selected={[]}
                                        busy={false}
                                        onToggle={() => undefined}
                                        onSelectAll={() => undefined}
                                        onApply={() => undefined}
                                        onReject={() => undefined}
                                        onMarkConflict={() => undefined}
                                    />
                                ))}
                            </details>
                        ) : null}

                        {applications.length ? (
                            <div className="stage4d-applications">
                                <strong>提案应用记录</strong>
                                {applications.map((application) => (
                                    <div key={application.applicationId} className={`stage4d-application is-${application.status}`}>
                                        <Tag color={application.status === "applied" ? "success" : "error"}>{application.status === "applied" ? "已应用" : application.status === "conflict" ? "版本冲突" : "失败"}</Tag>
                                        <span>{application.applicationId}</span>
                                        <span>v{application.beforeVersion}{application.afterVersion ? ` → v${application.afterVersion}` : ""}</span>
                                        <span>{application.acceptedChangeIds.length} 项</span>
                                        {application.error ? <small>{application.error}</small> : null}
                                        <Tooltip title={application.derived ? "读取时按版本规则派生，尚未写入 IndexedDB；不是持久化事实" : "该记录是否经过 IndexedDB 事务回读确认"}><small>{application.derived ? "内存派生 · 待保存" : application.persisted ? "已持久化确认" : "未确认持久化"}</small></Tooltip>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {historical.length ? (
                            <details className="stage4d-history">
                                <summary>历史 AI 审核记录（{historical.length}）— 不冒充当前审核</summary>
                                {historical.map((run) => (
                                    <div key={run.runId} className="stage4d-history-run">
                                        <span>v{run.storyboardVersion} · {run.status === "failed" ? "失败" : "完成"}</span>
                                        <strong>{run.summary}</strong>
                                        <small>{new Date(run.createdAt).toLocaleString()} · {run.findings.length} 个问题</small>
                                    </div>
                                ))}
                            </details>
                        ) : null}

                        <div className="stage4d-panel__foot">
                            <Check className="size-3.5" /> 审核记录、提案与决策独立保存；应用失败、版本冲突和拒绝都保留记录。正式分镜变化后旧审核仍标记为旧版本。
                        </div>
                    </>
                )}
            </div>
        </Drawer>
    );
}
