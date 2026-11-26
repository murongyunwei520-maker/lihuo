import { App, Button, Collapse, Input, Modal, Tag } from "antd";
import { Check, Edit3, Lock, RefreshCw, Sparkles, Unlock } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { StudioAdaptationWorkspace, StudioSeriesBlueprint } from "@/types/studio-adaptation";
import { StudioEmpty, StudioPanel } from "../ui";
import { OriginTag, ReviewTag, sourceCount, TextBlock } from "./shared";

type BlueprintEdit = Pick<StudioSeriesBlueprint, "theme" | "logline" | "mainline" | "centralConflict" | "relationshipEvolution" | "climax" | "ending" | "foreshadowingPlan" | "timeline"> & { protagonistGoals: string };

export function AdaptationBlueprintTab({ workspace, preview, disabled, onGenerate, onSave, onApprove, onLock, onUnlock }: {
    workspace: StudioAdaptationWorkspace;
    preview: boolean;
    disabled: boolean;
    onGenerate: () => void;
    onSave: (patch: BlueprintEdit) => void;
    onApprove: () => void;
    onLock: () => void;
    onUnlock: () => void;
}) {
    const { message } = App.useApp();
    const blueprint = workspace.blueprint;
    const [editOpen, setEditOpen] = useState(false);
    const [edit, setEdit] = useState<BlueprintEdit | null>(null);
    useEffect(() => {
        if (!editOpen || !blueprint) return;
        setEdit({
            theme: blueprint.theme,
            logline: blueprint.logline,
            mainline: blueprint.mainline,
            centralConflict: blueprint.centralConflict,
            relationshipEvolution: blueprint.relationshipEvolution,
            climax: blueprint.climax,
            ending: blueprint.ending,
            foreshadowingPlan: blueprint.foreshadowingPlan,
            timeline: blueprint.timeline,
            protagonistGoals: blueprint.protagonistGoals.join("\n"),
        });
    }, [editOpen, blueprint]);

    if (!blueprint) {
        return <StudioEmpty icon={<Sparkles className="size-7" />} title="还没有全剧蓝图" description="先确认改编方案，再生成覆盖全部集数的故事蓝图。蓝图会锁定主题、关键事件、人物出场退场、伏笔和结局。" action={<Button type="primary" icon={<Sparkles className="size-4" />} disabled={disabled || !workspace.strategy} onClick={onGenerate}>{workspace.strategy ? "生成全剧蓝图" : "先完成改编方案"}</Button>} />;
    }
    const stages = blueprint.stages;
    return (
        <div className="adaptation-tab-layout">
            <StudioPanel title="全剧故事蓝图" extra={<div className="adaptation-inline-actions"><ReviewTag status={blueprint.reviewStatus} /><Tag bordered={false}>v{blueprint.version}</Tag><Button size="small" icon={<Edit3 className="size-3.5" />} disabled={disabled || preview || blueprint.locked} onClick={() => setEditOpen(true)}>编辑</Button></div>}>
                <div className="adaptation-blueprint-hero">
                    <span className="adaptation-eyebrow">THE SERIES BLUEPRINT</span>
                    <h3>{blueprint.title}</h3>
                    <p>{blueprint.logline}</p>
                    <div className="adaptation-tag-row">{blueprint.stages.map((stage) => <Tag key={stage.id} bordered={false}>{stage.name} · {stage.fromEpisode}-{stage.toEpisode}</Tag>)}</div>
                </div>
                <div className="adaptation-grid-2">
                    <TextBlock title="核心主题">{blueprint.theme}</TextBlock>
                    <TextBlock title="一句话故事">{blueprint.logline}</TextBlock>
                    <TextBlock title="故事主线">{blueprint.mainline}</TextBlock>
                    <TextBlock title="主要矛盾">{blueprint.centralConflict}</TextBlock>
                    <TextBlock title="主要反派">{blueprint.antagonist.name}｜{blueprint.antagonist.motivation}｜压力：{blueprint.antagonist.pressure}</TextBlock>
                    <TextBlock title="人物关系演变">{blueprint.relationshipEvolution}</TextBlock>
                    <TextBlock title="全剧高潮">{blueprint.climax}</TextBlock>
                    <TextBlock title="故事结局">{blueprint.ending}</TextBlock>
                    <TextBlock title="伏笔与回收安排">{blueprint.foreshadowingPlan}</TextBlock>
                    <TextBlock title="故事时间线">{blueprint.timeline}</TextBlock>
                </div>
                {blueprint.protagonistGoals.length ? <div className="adaptation-goal-list"><strong>核心人物目标</strong>{blueprint.protagonistGoals.map((goal) => <span key={goal}>{goal}</span>)}</div> : null}
                <div className="adaptation-actions-row">
                    {blueprint.reviewStatus !== "approved" && !blueprint.locked ? <Button type="primary" icon={<Check className="size-4" />} disabled={disabled || preview} onClick={onApprove}>通过全剧蓝图</Button> : null}
                    {!blueprint.locked ? <Button icon={<Lock className="size-4" />} disabled={disabled || preview} onClick={onLock}>锁定全剧蓝图</Button> : <Button icon={<Unlock className="size-4" />} disabled={disabled || preview} onClick={onUnlock}>解锁全剧蓝图</Button>}
                    <Button icon={<RefreshCw className="size-4" />} disabled={disabled || preview || blueprint.locked} onClick={onGenerate}>重新生成蓝图</Button>
                </div>
            </StudioPanel>

            <StudioPanel title="阶段与关键事件" extra={<Tag bordered={false}>{blueprint.keyEvents.length} 个关键事件</Tag>}>
                <div className="adaptation-stage-list">{stages.map((stage) => <div key={stage.id} className="adaptation-stage"><strong>{stage.name}</strong><span>{stage.fromEpisode}-{stage.toEpisode} 集</span><p>{stage.description}</p></div>)}</div>
                <div className="adaptation-blueprint-events">{blueprint.keyEvents.map((event) => (
                    <article key={event.id} className="adaptation-event-row">
                        <div className="adaptation-event-order">{String(event.order).padStart(2, "0")}</div>
                        <div className="adaptation-event-main"><strong>{event.title}</strong><p>{event.description}</p><small>{event.episodeHint || "集数待定"} · {sourceCount(event.sourceReferences)}</small></div>
                        <div className="adaptation-event-tags"><OriginTag origin={event.sourceType} /><span>{event.act}</span></div>
                    </article>
                ))}</div>
            </StudioPanel>

            <Collapse
                ghost
                items={[
                    { key: "characters", label: `人物出场、退场与命运（${blueprint.characters.length}）`, children: <div className="adaptation-table-like">{blueprint.characters.map((character) => <div key={character.characterId} className="adaptation-table-row"><div><strong>{character.name}</strong><span>{character.role} · 第 {character.entranceEpisode} 集出场{character.exitEpisode ? ` · 第 ${character.exitEpisode} 集退场` : ""}</span></div><div><p>{character.arcSummary}</p><small>目标：{character.goal}｜结局：{character.fate || "未定"}</small></div></div>)}</div> },
                    { key: "relationships", label: `主要关系演变（${blueprint.relationships.length}）`, children: <div className="adaptation-table-like">{blueprint.relationships.map((relationship, index) => <div key={`${relationship.fromCharacterId}-${relationship.toCharacterId}-${index}`} className="adaptation-table-row"><strong>{relationship.fromName} → {relationship.toName}</strong><p>{relationship.evolution}</p></div>)}</div> },
                    { key: "locations", label: `主要地点使用安排（${blueprint.locations.length}）`, children: <div className="adaptation-table-like">{blueprint.locations.map((location) => <div key={location.sceneId} className="adaptation-table-row"><strong>{location.name}</strong><p>{location.usage}</p><small>集数：{location.episodeNumbers.join("、") || "未标注"}</small></div>)}</div> },
                ]}
            />

            <Modal open={editOpen} title="编辑全剧蓝图" width={860} okText="保存并标记待审核" cancelText="取消" destroyOnHidden onCancel={() => setEditOpen(false)} onOk={() => { if (!edit) return; onSave(edit); setEditOpen(false); message.success("全剧蓝图已保存为待审核"); }}>
                {edit ? <div className="adaptation-edit-form">
                    <EditField label="核心主题"><Input value={edit.theme} onChange={(event) => setEdit({ ...edit, theme: event.target.value })} /></EditField>
                    <EditField label="一句话故事"><Input.TextArea rows={2} value={edit.logline} onChange={(event) => setEdit({ ...edit, logline: event.target.value })} /></EditField>
                    <EditField label="故事主线"><Input.TextArea rows={3} value={edit.mainline} onChange={(event) => setEdit({ ...edit, mainline: event.target.value })} /></EditField>
                    <EditField label="主要矛盾"><Input.TextArea rows={3} value={edit.centralConflict} onChange={(event) => setEdit({ ...edit, centralConflict: event.target.value })} /></EditField>
                    <EditField label="核心人物目标（每行一条）"><Input.TextArea rows={4} value={edit.protagonistGoals} onChange={(event) => setEdit({ ...edit, protagonistGoals: event.target.value })} /></EditField>
                    <EditField label="人物关系演变"><Input.TextArea rows={3} value={edit.relationshipEvolution} onChange={(event) => setEdit({ ...edit, relationshipEvolution: event.target.value })} /></EditField>
                    <EditField label="全剧高潮"><Input.TextArea rows={3} value={edit.climax} onChange={(event) => setEdit({ ...edit, climax: event.target.value })} /></EditField>
                    <EditField label="故事结局"><Input.TextArea rows={3} value={edit.ending} onChange={(event) => setEdit({ ...edit, ending: event.target.value })} /></EditField>
                    <EditField label="伏笔与回收安排"><Input.TextArea rows={3} value={edit.foreshadowingPlan} onChange={(event) => setEdit({ ...edit, foreshadowingPlan: event.target.value })} /></EditField>
                    <EditField label="故事时间线"><Input.TextArea rows={2} value={edit.timeline} onChange={(event) => setEdit({ ...edit, timeline: event.target.value })} /></EditField>
                </div> : null}
            </Modal>
        </div>
    );
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
    return <label className="adaptation-edit-field"><span>{label}</span>{children}</label>;
}

export type { BlueprintEdit };
