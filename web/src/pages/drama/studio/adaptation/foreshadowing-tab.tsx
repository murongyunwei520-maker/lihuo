import { App, Button, Input, InputNumber, Modal, Select, Tag } from "antd";
import { Edit3, Network } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { FORESHADOWING_STATUS_LABEL, type StudioAdaptationWorkspace, type StudioForeshadowingPoolItem, type StudioForeshadowingStatus } from "@/types/studio-adaptation";
import { StudioEmpty, StudioPanel } from "../ui";
import { ForeshadowingStatusTag, OriginTag, ReviewTag, adaptationTime } from "./shared";

type PoolEdit = Pick<StudioForeshadowingPoolItem, "content" | "firstPlantedEpisode" | "expectedResolveEpisode" | "status"> & { actualResolveEpisode: number | null };

export function AdaptationForeshadowingTab({ workspace, preview, disabled, onUpdate }: {
    workspace: StudioAdaptationWorkspace;
    preview: boolean;
    disabled: boolean;
    onUpdate: (id: string, patch: PoolEdit) => void;
}) {
    const { message } = App.useApp();
    const [status, setStatus] = useState<StudioForeshadowingStatus | "">("");
    const [originalOnly, setOriginalOnly] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [edit, setEdit] = useState<PoolEdit | null>(null);
    const pool = useMemo(() => workspace.foreshadowings.filter((item) => (!status || item.status === status) && (!originalOnly || item.isOriginal)), [workspace.foreshadowings, status, originalOnly]);
    const selected = workspace.foreshadowings.find((item) => item.foreshadowingId === selectedId) ?? null;

    if (!workspace.foreshadowings.length) {
        return <StudioEmpty icon={<Network className="size-7" />} title="还没有全剧伏笔池" description="全剧分集规划生成后会建立统一伏笔池；原著伏笔不会被无声删除，未回收的伏笔不能标记为已回收。" />;
    }
    return (
        <div className="adaptation-tab-layout">
            <StudioPanel title="全剧伏笔池" extra={<div className="adaptation-inline-actions"><Tag bordered={false}>{workspace.foreshadowings.length} 条</Tag><Select allowClear value={status || undefined} onChange={(value) => setStatus((value as StudioForeshadowingStatus) ?? "")} placeholder="状态筛选" options={(Object.keys(FORESHADOWING_STATUS_LABEL) as StudioForeshadowingStatus[]).map((value) => ({ value, label: FORESHADOWING_STATUS_LABEL[value] }))} /><Button size="small" type={originalOnly ? "primary" : "default"} onClick={() => setOriginalOnly((value) => !value)}>仅原著</Button></div>}>
                <p className="adaptation-note">伏笔状态只由当前分集中的埋设、推进、回收动作推导；planned / planted / advancing / resolved / abandoned / pending_review 必须可追踪。</p>
                <div className="adaptation-foreshadowing-list">
                    {pool.map((item) => (
                        <button key={item.foreshadowingId} type="button" className="adaptation-foreshadowing-card" onClick={() => {
                            setSelectedId(item.foreshadowingId);
                            setEdit({ content: item.content, firstPlantedEpisode: item.firstPlantedEpisode, expectedResolveEpisode: item.expectedResolveEpisode, status: item.status, actualResolveEpisode: item.actualResolveEpisode ?? null });
                        }}>
                            <header><div><strong>{item.content || item.foreshadowingId}</strong><span>{item.foreshadowingId}</span></div><div><ForeshadowingStatusTag status={item.status} /><ReviewTag status={item.reviewStatus} /></div></header>
                            <div className="adaptation-foreshadowing-meta"><OriginTag origin={item.sourceType} /><span>{item.isOriginal ? "原著伏笔" : "AI 新增"}</span><span>埋设第 {item.firstPlantedEpisode || "?"} 集</span><span>推进 {item.advancedEpisodes.join("、") || "无"}</span><span>预计回收第 {item.expectedResolveEpisode || "?"} 集</span><span>实际回收第 {item.actualResolveEpisode || "?"} 集</span></div>
                        </button>
                    ))}
                </div>
            </StudioPanel>

            <Modal open={Boolean(selected)} title={selected ? `编辑伏笔 · ${selected.foreshadowingId}` : ""} width={760} okText="保存并标记待审核" cancelText="取消" destroyOnHidden onCancel={() => setSelectedId(null)} onOk={() => {
                if (!selected || !edit) return;
                onUpdate(selected.foreshadowingId, edit);
                setSelectedId(null);
                message.success("伏笔已保存为待审核");
            }}>
                {selected && edit ? (
                    <div className="adaptation-form-stack">
                        <div className="adaptation-source-summary"><span>来源：{selected.isOriginal ? "原著伏笔" : "AI 新增"}</span>{selected.sourceNovelForeshadowingId ? <span>阶段 2A：{selected.sourceNovelForeshadowingId}</span> : null}<span>最近更新：{adaptationTime(selected.updatedAt)}</span></div>
                        <div className="adaptation-detail-grid">
                            <div className="adaptation-edit-form">
                                <EditField label="伏笔内容"><Input.TextArea rows={4} value={edit.content} onChange={(event) => setEdit({ ...edit, content: event.target.value })} /></EditField>
                                <div className="adaptation-grid-3">
                                    <EditField label="首次埋设"><InputNumber min={0} max={workspace.settings.targetEpisodes} value={edit.firstPlantedEpisode} onChange={(value) => setEdit({ ...edit, firstPlantedEpisode: Number(value) || 0 })} className="w-full" /></EditField>
                                    <EditField label="预计回收"><InputNumber min={0} max={workspace.settings.targetEpisodes} value={edit.expectedResolveEpisode} onChange={(value) => setEdit({ ...edit, expectedResolveEpisode: Number(value) || 0 })} className="w-full" /></EditField>
                                    <EditField label="实际回收"><InputNumber min={0} max={workspace.settings.targetEpisodes} value={edit.actualResolveEpisode ?? undefined} onChange={(value) => setEdit({ ...edit, actualResolveEpisode: value ? Number(value) : null })} className="w-full" /></EditField>
                                </div>
                                <EditField label="伏笔状态"><Select value={edit.status} onChange={(value) => setEdit({ ...edit, status: value as StudioForeshadowingStatus })} options={(Object.keys(FORESHADOWING_STATUS_LABEL) as StudioForeshadowingStatus[]).map((value) => ({ value, label: FORESHADOWING_STATUS_LABEL[value] }))} /></EditField>
                            </div>
                            <div className="adaptation-detail-side">
                                <div className="adaptation-inline-warning"><strong>状态约束</strong><span>未在分集中明确回收的伏笔不能设为 resolved；如果当前分集没有回收动作，保存后校验会报错。</span></div>
                                <div className="adaptation-detail-list"><strong>关联人物</strong>{selected.relatedCharacterIds.length ? selected.relatedCharacterIds.map((id) => <p key={id}>{id}</p>) : <p className="adaptation-muted">未标注</p>}</div>
                                <div className="adaptation-detail-list"><strong>关联事件</strong>{selected.relatedEventIds.length ? selected.relatedEventIds.map((id) => <p key={id}>{id}</p>) : <p className="adaptation-muted">未标注</p>}</div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
    return <label className="adaptation-edit-field"><span>{label}</span>{children}</label>;
}

export type { PoolEdit };
