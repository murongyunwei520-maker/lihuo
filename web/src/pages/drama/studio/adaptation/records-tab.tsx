import { Button, Collapse, Input, Tag } from "antd";
import { Check, Database, History, ListChecks, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";

import { buildHandoffSummary } from "@/lib/studio/adaptation-schema";
import { adaptationHandoff, diffAgainstCurrent } from "@/lib/studio/adaptation-workspace";
import type { StudioAdaptationProposal, StudioAdaptationWorkspace } from "@/types/studio-adaptation";
import { StudioPanel } from "../ui";
import { GenerationTag, OriginTag, OperationTag, ReviewTag, RiskTags, adaptationTime } from "./shared";

export function AdaptationRecordsTab({ workspace, currentWorkspace, pending, preview, disabled, projectId, analysisVersion, onAcceptProposal, onRejectProposal, onApproveChange, onResetChange }: {
    workspace: StudioAdaptationWorkspace;
    currentWorkspace: StudioAdaptationWorkspace;
    pending?: StudioAdaptationProposal;
    preview: boolean;
    disabled: boolean;
    projectId: string;
    analysisVersion: number;
    onAcceptProposal: () => void;
    onRejectProposal: () => void;
    onApproveChange: (id: string) => void;
    onResetChange: (id: string) => void;
}) {
    const [reason, setReason] = useState("");
    const handoff = adaptationHandoff(workspace, projectId, analysisVersion);
    const pendingDiff = pending ? diffAgainstCurrent(currentWorkspace, pending) : null;
    return (
        <div className="adaptation-tab-layout">
            {pending ? (
                <StudioPanel title="待确认提案" extra={<Tag bordered={false} color="warning">不会静默覆盖当前版本</Tag>}>
                    <div className="adaptation-proposal-summary">
                        <div><strong>{pending.title}</strong><p>{pending.reason || "等待用户确认"}</p><span>基础版本 v{pending.baseVersion} · 目标 {pending.targetEpisodeNumbers.length ? `第 ${pending.targetEpisodeNumbers.join("、")} 集` : "全剧层级"}</span></div>
                        <div className="adaptation-inline-actions"><Button type="primary" icon={<Check className="size-4" />} disabled={disabled || !pending} onClick={onAcceptProposal}>接受整份提案</Button><Button icon={<RotateCcw className="size-4" />} disabled={disabled} onClick={onRejectProposal}>拒绝提案</Button></div>
                    </div>
                    {pendingDiff?.notes.length ? <div className="adaptation-diff-notes">{pendingDiff.notes.map((note) => <Tag key={note} bordered={false}>{note}</Tag>)}</div> : null}
                    {pendingDiff?.items.length ? <div className="adaptation-diff-list">{pendingDiff.items.map((item) => <div key={`${item.target}-${item.key}`}><Tag bordered={false}>{item.label}</Tag><span>{item.before || "（空）"}</span><span>→</span><span>{item.after || "（空）"}</span></div>)}</div> : null}
                </StudioPanel>
            ) : null}

            <StudioPanel title="改编差异账本" extra={<div className="adaptation-inline-actions"><Tag bordered={false}>{workspace.changes.length} 条</Tag><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="搜索改编原因…" className="adaptation-record-search" /></div>}>
                {workspace.changes.length ? (
                    <div className="adaptation-record-table">
                        {workspace.changes.filter((change) => !reason || `${change.adaptationChangeId} ${change.reason} ${change.beforeStructure} ${change.afterStructure}`.includes(reason)).map((change) => (
                            <article key={change.adaptationChangeId} className="adaptation-record-row">
                                <div className="adaptation-record-main"><strong>{change.adaptationChangeId}</strong><OperationTag operation={change.operation} /><OriginTag origin={change.sourceType} />{change.highRisk ? <Tag bordered={false} color="error">高风险</Tag> : null}<ReviewTag status={change.reviewStatus} /><p>{change.reason || "未填写原因"}</p><small>{change.beforeStructure} → {change.afterStructure}</small></div>
                                <div className="adaptation-record-side"><RiskTags tags={change.riskTags} /><span>关联集数：{change.episodeNumbers.join("、") || "未标注"}</span><span>{change.sourceReferences.evidence.length} 条证据</span><div>{change.reviewStatus !== "approved" ? <Button size="small" type="text" icon={<Check className="size-3.5" />} disabled={disabled} onClick={() => onApproveChange(change.adaptationChangeId)}>确认</Button> : <Button size="small" type="text" disabled={disabled} onClick={() => onResetChange(change.adaptationChangeId)}>退回</Button>}</div></div>
                            </article>
                        ))}
                    </div>
                ) : <div className="adaptation-empty-hint">没有改编差异记录。原著事实与 AI 新增内容必须在这里可追踪。</div>}
            </StudioPanel>

            <div className="adaptation-records-two">
                <StudioPanel title="版本历史" extra={<Tag bordered={false}>{workspace.history.length} 个确认快照</Tag>}>
                    {workspace.history.length ? <div className="adaptation-history-list">{workspace.history.slice().reverse().map((entry) => <div key={entry.id}><History className="size-4" /><div><strong>v{entry.version} · {entry.reason}</strong><span>{adaptationTime(entry.createdAt)} · {entry.snapshot.episodePlans.length} 集 / {entry.snapshot.characterArcs.length} 人物弧光</span></div></div>)}</div> : <p className="adaptation-muted">还没有已确认的版本快照。用户接受提案后才会写入当前有效版本。</p>}
                </StudioPanel>
                <StudioPanel title="生成任务记录" extra={<Tag bordered={false}>模型 / 参数 / 输入输出</Tag>}>
                    {workspace.generations.length ? <div className="adaptation-generation-list">{workspace.generations.slice(0, 8).map((generation) => <div key={generation.id} className="adaptation-generation-row"><div><strong>{generation.currentLabel || generation.kind}</strong><span>{generation.model.label || "未记录模型"} · {generation.calls} 次调用 · {generation.inputChars.toLocaleString()} 字符</span><small>{adaptationTime(generation.createdAt)} · 输入版本 v{generation.inputVersion}{generation.outputVersion ? ` → v${generation.outputVersion}` : ""}</small></div><GenerationTag status={generation.status} /></div>)}</div> : <p className="adaptation-muted">还没有生成任务。</p>}
                </StudioPanel>
            </div>

            <StudioPanel title="阶段 3 交接数据" extra={<div className="adaptation-inline-actions"><Database className="size-4" /><Tag bordered={false}>{handoff ? "已可生成" : "尚不完整"}</Tag></div>}>
                {handoff ? (
                    <div className="adaptation-handoff">
                        <div className="adaptation-handoff-stats"><div><span>当前包版本</span><strong>v{handoff.packageVersion}</strong></div><div><span>分集规划</span><strong>{handoff.episodePlans.length} 集</strong></div><div><span>人物弧光</span><strong>{handoff.characterArcs.length}</strong></div><div><span>伏笔池</span><strong>{handoff.foreshadowings.length}</strong></div><div><span>锁定集</span><strong>{handoff.lockedEpisodeNumbers.length}</strong></div></div>
                        <p>阶段 3 会读取全剧蓝图引用、当前有效分集版本、关键事件、人物/关系状态、场景引用、伏笔安排、因果依赖、原著证据引用、改编记录与用户锁定状态。</p>
                        <Collapse ghost size="small" items={[{ key: "handoff", label: "查看交接摘要 JSON", children: <pre className="adaptation-json-preview">{JSON.stringify(buildHandoffSummary(handoff.episodePlans), null, 2)}</pre> }]} />
                        <div className="adaptation-inline-warning"><Sparkles className="size-4" /><span>这是阶段 2B 的终点。正式剧本对白、逐镜头分镜、角色/场景图与视频留给阶段 3；本阶段不会自动进入下一步。</span></div>
                    </div>
                ) : <p className="adaptation-muted">需要先确认全剧蓝图和至少一集规划，才能形成阶段 3 交接数据。</p>}
            </StudioPanel>
        </div>
    );
}
