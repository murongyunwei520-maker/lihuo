import { App, Button, Drawer, Input, Modal, Select, Tag } from "antd";
import { Edit3, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { StudioAdaptationWorkspace, StudioCharacterArc } from "@/types/studio-adaptation";
import { StudioEmpty, StudioPanel } from "../ui";
import { ReviewTag, TextBlock } from "./shared";

type ArcEdit = Pick<StudioCharacterArc, "initialState" | "coreGoal" | "innerConflict" | "flaw" | "finalState">;

export function AdaptationCharactersTab({ workspace, preview, disabled, onSaveArc, onConfirmMilestone }: {
    workspace: StudioAdaptationWorkspace;
    preview: boolean;
    disabled: boolean;
    onSaveArc: (characterId: string, patch: ArcEdit) => void;
    onConfirmMilestone: (characterId: string, milestoneIndex: number) => void;
}) {
    const { message } = App.useApp();
    const [filter, setFilter] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [edit, setEdit] = useState<ArcEdit | null>(null);
    const arcs = useMemo(() => workspace.characterArcs.filter((arc) => !filter || arc.characterId === filter), [workspace.characterArcs, filter]);
    const selected = workspace.characterArcs.find((arc) => arc.characterId === selectedId) ?? null;

    if (!workspace.characterArcs.length) {
        return <StudioEmpty icon={<Users className="size-7" />} title="还没有人物弧光" description="全剧分集规划生成后，系统会为主要人物建立初始状态、目标、内在矛盾、转折、关键选择和逐集状态时间线。" />;
    }
    return (
        <div className="adaptation-tab-layout">
            <StudioPanel title="人物弧光与全剧记忆" extra={<Select allowClear showSearch value={filter || undefined} onChange={(value) => setFilter(value ?? "")} placeholder="筛选人物" optionFilterProp="label" options={workspace.characterArcs.map((arc) => ({ value: arc.characterId, label: arc.characterName }))} className="adaptation-character-filter" />}>
                <p className="adaptation-note">人物不只有名字：每一集都记录所在地点、知道什么、不知道什么、关系、身体/能力/身份状态和生死状态。</p>
                <div className="adaptation-character-grid">
                    {arcs.map((arc) => (
                        <button key={arc.characterId} type="button" className="adaptation-character-card" onClick={() => setSelectedId(arc.characterId)}>
                            <header><div><strong>{arc.characterName}</strong><span>{arc.timeline.length} 集有状态</span></div><ReviewTag status={arc.reviewStatus} /></header>
                            <TextBlock title="核心目标">{arc.coreGoal}</TextBlock>
                            <TextBlock title="内在矛盾">{arc.innerConflict}</TextBlock>
                            <div className="adaptation-character-mini"><span>初始：{arc.initialState || "未填写"}</span><span>最终：{arc.finalState || "未填写"}</span></div>
                        </button>
                    ))}
                </div>
            </StudioPanel>

            <Drawer
                open={Boolean(selected)}
                width={900}
                destroyOnHidden
                onClose={() => setSelectedId(null)}
                title={selected ? `${selected.characterName} · 全剧人物弧光` : ""}
                extra={selected ? <div className="adaptation-inline-actions"><ReviewTag status={selected.reviewStatus} /><Button size="small" icon={<Edit3 className="size-3.5" />} disabled={disabled || preview} onClick={() => { setEditOpen(true); setEdit({ initialState: selected.initialState, coreGoal: selected.coreGoal, innerConflict: selected.innerConflict, flaw: selected.flaw, finalState: selected.finalState }); }}>编辑弧光</Button></div> : null}
            >
                {selected ? (
                    <div className="adaptation-detail">
                        <div className="adaptation-grid-2">
                            <TextBlock title="初始状态">{selected.initialState}</TextBlock>
                            <TextBlock title="核心目标">{selected.coreGoal}</TextBlock>
                            <TextBlock title="内在矛盾">{selected.innerConflict}</TextBlock>
                            <TextBlock title="人物缺陷">{selected.flaw}</TextBlock>
                            <TextBlock title="最终状态">{selected.finalState}</TextBlock>
                        </div>
                        <div className="adaptation-grid-2">
                            <div className="adaptation-detail-list"><strong>重要转折</strong>{selected.turningPoints.map((point) => <div key={`${point.episodeNumber}-${point.description}`}><span>第 {point.episodeNumber} 集</span><p>{point.description}</p></div>)}{!selected.turningPoints.length ? <p className="adaptation-muted">未标注</p> : null}</div>
                            <div className="adaptation-detail-list"><strong>关键选择</strong>{selected.keyChoices.map((point) => <div key={`${point.episodeNumber}-${point.description}`}><span>第 {point.episodeNumber} 集</span><p>{point.description}</p></div>)}{!selected.keyChoices.length ? <p className="adaptation-muted">未标注</p> : null}</div>
                        </div>
                        <StudioPanel title="逐集状态时间线" extra={<Tag bordered={false}>{selected.timeline.length} 集</Tag>}>
                            <div className="adaptation-timeline">
                                {selected.timeline.map((point) => (
                                    <article key={point.episodeNumber} className="adaptation-timeline-item">
                                        <div className="adaptation-timeline-episode">第 {point.episodeNumber} 集</div>
                                        <div className="adaptation-timeline-copy">
                                            <strong>{point.location || "地点未标"} · {point.present ? "在场" : "不在场"} · {point.lifeState}</strong>
                                            <span>知道：{point.knows.join("；") || "无"}</span>
                                            <span>不知道：{point.unknown.join("；") || "无"}</span>
                                            <span>关系：{point.relationships || "未标"}｜身份：{point.identityState || "未标"}｜能力：{point.abilityState || "未标"}</span>
                                        </div>
                                    </article>
                                ))}
                                {!selected.timeline.length ? <p className="adaptation-muted">没有逐集状态；需要重新生成或补充分集人物状态。</p> : null}
                            </div>
                        </StudioPanel>
                        <div className="adaptation-detail-list"><strong>人物里程碑</strong>{selected.milestones.map((milestone, index) => {
                            const generatedReturn = milestone.type === "return" && milestone.sourceType === "generated";
                            return (
                                <div key={`${milestone.episodeNumber}-${milestone.type}-${index}`}>
                                    <span>第 {milestone.episodeNumber} 集 · {milestone.type}{generatedReturn ? <Tag bordered={false} color={milestone.confirmedAt ? "green" : "gold"}>{milestone.confirmedAt ? "AI 复活已确认" : "AI 复活待确认"}</Tag> : null}</span>
                                    <p>{milestone.description}</p>
                                    {generatedReturn && !milestone.confirmedAt ? (
                                        <div className="adaptation-inline-actions">
                                            <span className="adaptation-muted">AI 新增复活必须由你确认后，才能作为死亡后回归依据。</span>
                                            <Button size="small" type="primary" ghost disabled={disabled || preview} onClick={() => onConfirmMilestone(selected.characterId, index)}>确认 AI 复活</Button>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}{!selected.milestones.length ? <p className="adaptation-muted">未标注首次出场、退场、死亡、回归或身份揭露。</p> : null}</div>
                    </div>
                ) : null}
            </Drawer>

            <Modal open={editOpen} title={selected ? `编辑 ${selected.characterName} 的人物弧光` : "编辑人物弧光"} okText="保存并标记待审核" cancelText="取消" destroyOnHidden onCancel={() => setEditOpen(false)} onOk={() => { if (!selected || !edit) return; onSaveArc(selected.characterId, edit); setEditOpen(false); message.success("人物弧光已保存为待审核"); }}>
                {edit ? <div className="adaptation-edit-form">
                    <EditField label="初始状态"><Input.TextArea rows={3} value={edit.initialState} onChange={(event) => setEdit({ ...edit, initialState: event.target.value })} /></EditField>
                    <EditField label="核心目标"><Input.TextArea rows={2} value={edit.coreGoal} onChange={(event) => setEdit({ ...edit, coreGoal: event.target.value })} /></EditField>
                    <EditField label="内在矛盾"><Input.TextArea rows={2} value={edit.innerConflict} onChange={(event) => setEdit({ ...edit, innerConflict: event.target.value })} /></EditField>
                    <EditField label="人物缺陷"><Input.TextArea rows={2} value={edit.flaw} onChange={(event) => setEdit({ ...edit, flaw: event.target.value })} /></EditField>
                    <EditField label="最终状态"><Input.TextArea rows={3} value={edit.finalState} onChange={(event) => setEdit({ ...edit, finalState: event.target.value })} /></EditField>
                </div> : null}
            </Modal>
        </div>
    );
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
    return <label className="adaptation-edit-field"><span>{label}</span>{children}</label>;
}

export type { ArcEdit };
