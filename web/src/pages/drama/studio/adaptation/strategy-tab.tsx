import { App, Button, Collapse, Input, Modal, Tag, Tooltip } from "antd";
import { Check, Edit3, Lock, RefreshCw, Sparkles, Unlock } from "lucide-react";
import { useEffect, useState } from "react";

import { ADAPTATION_REVIEW_LABEL, ADAPTATION_STRENGTH_LABEL, type StudioAdaptationChange, type StudioAdaptationReviewStatus, type StudioAdaptationStrategy, type StudioAdaptationWorkspace } from "@/types/studio-adaptation";
import { StudioEmpty, StudioPanel } from "../ui";
import { OriginTag, OperationTag, ReviewTag, RiskTags, adaptationTime, sourceCount, TextBlock } from "./shared";

type StrategyEdit = Pick<StudioAdaptationStrategy, "logline" | "positioningSummary" | "structureStrategy" | "characterStrategy" | "conflictStrategy" | "foreshadowingStrategy" | "endingStrategy" | "episodeCountPlan">;

export function AdaptationStrategyTab({ workspace, preview, disabled, onGenerate, onSave, onApprove, onLock, onUnlock, onApproveChange, onResetChange }: {
    workspace: StudioAdaptationWorkspace;
    preview: boolean;
    disabled: boolean;
    onGenerate: () => void;
    onSave: (patch: StrategyEdit) => void;
    onApprove: () => void;
    onLock: () => void;
    onUnlock: () => void;
    onApproveChange: (id: string) => void;
    onResetChange: (id: string) => void;
}) {
    const { message } = App.useApp();
    const strategy = workspace.strategy;
    const [editOpen, setEditOpen] = useState(false);
    const [edit, setEdit] = useState<StrategyEdit | null>(null);
    useEffect(() => {
        if (!editOpen || !strategy) return;
        setEdit({
            logline: strategy.logline,
            positioningSummary: strategy.positioningSummary,
            structureStrategy: strategy.structureStrategy,
            characterStrategy: strategy.characterStrategy,
            conflictStrategy: strategy.conflictStrategy,
            foreshadowingStrategy: strategy.foreshadowingStrategy,
            endingStrategy: strategy.endingStrategy,
            episodeCountPlan: strategy.episodeCountPlan,
        });
    }, [editOpen, strategy]);

    if (!strategy) {
        return (
            <StudioEmpty
                icon={<Sparkles className="size-7" />}
                title="还没有改编方案"
                description="先让 AI 阅读阶段 2A 的原著档案，生成可追踪的短剧改编方案。改编方案确认后再生成全剧蓝图。"
                action={<Button type="primary" icon={<Sparkles className="size-4" />} disabled={disabled} onClick={onGenerate}>生成改编方案</Button>}
            />
        );
    }
    const highRiskPending = strategy.changes.filter((change) => change.highRisk && change.reviewStatus !== "approved" && change.reviewStatus !== "locked").length;
    return (
        <div className="adaptation-tab-layout">
            <StudioPanel title="改编方案" extra={<div className="adaptation-inline-actions"><ReviewTag status={strategy.reviewStatus} /><Tag bordered={false}>v{strategy.version}</Tag><Button size="small" icon={<Edit3 className="size-3.5" />} disabled={disabled || preview || strategy.locked} onClick={() => setEditOpen(true)}>编辑</Button></div>}>
                <div className="adaptation-strategy-summary">
                    <TextBlock title="故事线">{strategy.logline}</TextBlock>
                    <TextBlock title="定位总结">{strategy.positioningSummary}</TextBlock>
                    <TextBlock title="结构策略">{strategy.structureStrategy}</TextBlock>
                    <TextBlock title="人物策略">{strategy.characterStrategy}</TextBlock>
                    <TextBlock title="冲突策略">{strategy.conflictStrategy}</TextBlock>
                    <TextBlock title="伏笔策略">{strategy.foreshadowingStrategy}</TextBlock>
                    <TextBlock title="结局策略">{strategy.endingStrategy}</TextBlock>
                    <TextBlock title="集数与时长">{strategy.episodeCountPlan}</TextBlock>
                </div>
                <div className="adaptation-meta-line">改编强度：{ADAPTATION_STRENGTH_LABEL[workspace.settings.strength]} · 原著分析 v{strategy.sourceAnalysisVersion} · 更新：{adaptationTime(strategy.updatedAt)}</div>
                {strategy.warnings.length ? <div className="adaptation-inline-warning"><strong>方案风险</strong>{strategy.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}
                {highRiskPending ? <div className="adaptation-inline-warning"><strong>{highRiskPending} 项高风险改编待审核</strong><span>高风险项不会自动视为通过；请逐项确认后再锁定改编方案。</span></div> : null}
                <div className="adaptation-actions-row">
                    {strategy.reviewStatus !== "approved" && !strategy.locked ? <Button type="primary" icon={<Check className="size-4" />} disabled={disabled || preview} onClick={onApprove}>通过改编方案</Button> : null}
                    {!strategy.locked ? <Button icon={<Lock className="size-4" />} disabled={disabled || preview || highRiskPending > 0} onClick={onLock}>锁定改编方案</Button> : <Button icon={<Unlock className="size-4" />} disabled={disabled || preview} onClick={onUnlock}>解锁改编方案</Button>}
                    <Button icon={<RefreshCw className="size-4" />} disabled={disabled || preview || strategy.locked} onClick={onGenerate}>重新生成方案</Button>
                </div>
            </StudioPanel>

            <StudioPanel title="改编差异账本" extra={<Tag bordered={false}>{strategy.changes.length} 项</Tag>}>
                <p className="adaptation-note">原著明确、合理推断和 AI 新增分开标记；每条改编必须说明原因、人物影响、因果影响和伏笔影响。</p>
                {strategy.changes.length ? (
                    <div className="adaptation-change-list">
                        {strategy.changes.map((change) => <ChangeItem key={change.adaptationChangeId} change={change} disabled={disabled || strategy.locked} onApprove={onApproveChange} onReset={onResetChange} />)}
                    </div>
                ) : <div className="adaptation-empty-hint">这份方案没有记录任何改编差异。对原著的结构调整必须写进账本。</div>}
            </StudioPanel>

            <Modal open={editOpen} title="编辑改编方案" width={820} okText="保存并标记待审核" cancelText="取消" destroyOnHidden onCancel={() => setEditOpen(false)} onOk={() => { if (!edit) return; onSave(edit); setEditOpen(false); message.success("改编方案已保存为待审核"); }}>
                {edit ? (
                    <div className="adaptation-edit-form">
                        <EditField label="故事线"><Input.TextArea rows={2} value={edit.logline} onChange={(event) => setEdit({ ...edit, logline: event.target.value })} /></EditField>
                        <EditField label="定位总结"><Input.TextArea rows={3} value={edit.positioningSummary} onChange={(event) => setEdit({ ...edit, positioningSummary: event.target.value })} /></EditField>
                        <EditField label="结构策略"><Input.TextArea rows={3} value={edit.structureStrategy} onChange={(event) => setEdit({ ...edit, structureStrategy: event.target.value })} /></EditField>
                        <EditField label="人物策略"><Input.TextArea rows={3} value={edit.characterStrategy} onChange={(event) => setEdit({ ...edit, characterStrategy: event.target.value })} /></EditField>
                        <EditField label="冲突策略"><Input.TextArea rows={2} value={edit.conflictStrategy} onChange={(event) => setEdit({ ...edit, conflictStrategy: event.target.value })} /></EditField>
                        <EditField label="伏笔策略"><Input.TextArea rows={2} value={edit.foreshadowingStrategy} onChange={(event) => setEdit({ ...edit, foreshadowingStrategy: event.target.value })} /></EditField>
                        <EditField label="结局策略"><Input.TextArea rows={2} value={edit.endingStrategy} onChange={(event) => setEdit({ ...edit, endingStrategy: event.target.value })} /></EditField>
                        <EditField label="集数与时长"><Input.TextArea rows={2} value={edit.episodeCountPlan} onChange={(event) => setEdit({ ...edit, episodeCountPlan: event.target.value })} /></EditField>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}

function ChangeItem({ change, disabled, onApprove, onReset }: { change: StudioAdaptationChange; disabled: boolean; onApprove: (id: string) => void; onReset: (id: string) => void }) {
    return (
        <article className="adaptation-change">
            <header className="adaptation-change__head">
                <div>
                    <strong>{change.adaptationChangeId}</strong>
                    <OperationTag operation={change.operation} />
                    <OriginTag origin={change.sourceType} />
                    {change.highRisk ? <Tag bordered={false} color="error">高风险</Tag> : null}
                    <ReviewTag status={change.reviewStatus} />
                </div>
                <div className="adaptation-change__actions">
                    {change.reviewStatus !== "approved" ? <Button size="small" type="text" icon={<Check className="size-3.5" />} disabled={disabled} onClick={() => onApprove(change.adaptationChangeId)}>确认</Button> : null}
                    {change.reviewStatus === "approved" ? <Button size="small" type="text" disabled={disabled} onClick={() => onReset(change.adaptationChangeId)}>退回待审</Button> : null}
                </div>
            </header>
            <div className="adaptation-change__body">
                <div><span>改编前</span><p>{change.beforeStructure || "未记录"}</p></div>
                <div><span>改编后</span><p>{change.afterStructure || "未记录"}</p></div>
            </div>
            <Collapse
                ghost
                size="small"
                items={[
                    { key: "reason", label: "原因与影响", children: <div className="adaptation-impact-grid"><TextBlock title="原因">{change.reason}</TextBlock><TextBlock title="人物影响">{change.characterImpact}</TextBlock><TextBlock title="因果影响">{change.causalityImpact}</TextBlock><TextBlock title="伏笔影响">{change.foreshadowingImpact}</TextBlock></div> },
                    { key: "source", label: "原著来源与风险", children: <div className="adaptation-source"><span>{sourceCount(change.sourceReferences)}</span><span>关联集数：{change.episodeNumbers.join("、") || "未标注"}</span><span>风险标签：<RiskTags tags={change.riskTags} /></span><div className="adaptation-evidence-list">{(change.sourceReferences.evidence ?? []).slice(0, 3).map((evidence) => <div key={`${evidence.chapterId}-${evidence.sourceLocation.charStart}`}><Tag bordered={false}>第 {evidence.chapterTitle}</Tag><p>{evidence.excerpt}</p></div>)}{!change.sourceReferences.evidence.length ? <p className="adaptation-muted">没有可定位证据。</p> : null}</div></div> },
                ]}
            />
        </article>
    );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="adaptation-edit-field"><span>{label}</span>{children}</label>;
}

export type { StrategyEdit };
