import { App, Button, Drawer, Input, InputNumber, Select, Tag } from "antd";
import { Check, ChevronRight, Edit3, Filter, Lock, RefreshCw, Sparkles, Unlock } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { NovelAnalysis } from "@/types/novel";
import type { StudioAdaptationWorkspace, StudioEpisodePlan } from "@/types/studio-adaptation";
import { ADAPTATION_MODULE_LABEL, type AdaptationEpisodeModule } from "@/lib/studio/adaptation-engine";
import { StudioEmpty, StudioPanel } from "../ui";
import { OriginTag, ReviewTag, sourceCount, TextBlock, adaptationTime } from "./shared";

type EpisodeEdit = {
    episodeTitle: string;
    episodeLogline: string;
    episodeSynopsis: string;
    dramaticGoal: string;
    openingHook: string;
    mainConflict: string;
    climax: string;
    endingHook: string;
    estimatedDuration: number;
    emotionalProgression: string;
    continuityDependencies: string;
};

export function AdaptationEpisodesTab({ workspace, preview, disabled, analysis, onGenerateEpisodes, onRegenerateRange, onRegenerateModule, onSaveEpisode, onApproveEpisode, onLockEpisode, onUnlockEpisode }: {
    workspace: StudioAdaptationWorkspace;
    preview: boolean;
    disabled: boolean;
    analysis: NovelAnalysis;
    onGenerateEpisodes: () => void;
    onRegenerateRange: (start: number, end: number, reason: string) => void;
    onRegenerateModule: (episodeNumber: number, module: AdaptationEpisodeModule, reason: string) => void;
    onSaveEpisode: (episodeNumber: number, patch: EpisodeEdit) => void;
    onApproveEpisode: (episodeNumber: number) => void;
    onLockEpisode: (episodeNumber: number) => void;
    onUnlockEpisode: (episodeNumber: number) => void;
}) {
    const { message } = App.useApp();
    const [episodeFilter, setEpisodeFilter] = useState<number | null>(null);
    const [characterFilter, setCharacterFilter] = useState("");
    const [eventFilter, setEventFilter] = useState("");
    const [sceneFilter, setSceneFilter] = useState("");
    const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
    const [rangeStart, setRangeStart] = useState(1);
    const [rangeEnd, setRangeEnd] = useState(Math.min(3, workspace.settings.targetEpisodes));
    const [rangeReason, setRangeReason] = useState("");
    const [module, setModule] = useState<AdaptationEpisodeModule>("synopsis");
    const [moduleReason, setModuleReason] = useState("");
    const selected = workspace.episodePlans.find((plan) => plan.episodeNumber === selectedNumber) ?? null;
    const filtered = useMemo(() => workspace.episodePlans.filter((plan) => {
        if (episodeFilter && plan.episodeNumber !== episodeFilter) return false;
        if (characterFilter && !plan.characterAppearances.some((character) => character.characterId === characterFilter)) return false;
        if (eventFilter && !plan.keyEvents.some((event) => event.sourceReferences.eventIds.includes(eventFilter))) return false;
        if (sceneFilter && !plan.locations.some((location) => location.sceneId === sceneFilter)) return false;
        return true;
    }), [workspace.episodePlans, episodeFilter, characterFilter, eventFilter, sceneFilter]);

    if (!workspace.blueprint) {
        return <StudioEmpty icon={<Sparkles className="size-7" />} title="先完成全剧蓝图" description="分集规划必须共享同一份全剧蓝图；蓝图确认后才能一次性规划全部目标集数。" />;
    }
    if (!workspace.episodePlans.length) {
        return (
            <StudioEmpty
                icon={<Sparkles className="size-7" />}
                title="还没有全剧分集规划"
                description={`将按目标集数 ${workspace.settings.targetEpisodes} 集、单集 ${workspace.settings.targetEpisodeSeconds} 秒规划全部集数，不会用重复摘要填满集数。`}
                action={<Button type="primary" icon={<Sparkles className="size-4" />} disabled={disabled} onClick={onGenerateEpisodes}>生成全剧分集规划</Button>}
            />
        );
    }

    return (
        <div className="adaptation-tab-layout">
            <StudioPanel
                title="全剧分集规划"
                extra={<div className="adaptation-inline-actions"><Tag bordered={false}>{workspace.episodePlans.length} / {workspace.settings.targetEpisodes} 集</Tag><Tag bordered={false}>单集目标 {workspace.settings.targetEpisodeSeconds}s</Tag></div>}
            >
                <div className="adaptation-filter-row">
                    <Filter className="size-4" />
                    <InputNumber min={1} max={workspace.settings.targetEpisodes} value={episodeFilter ?? undefined} onChange={setEpisodeFilter} placeholder="集数" className="adaptation-filter-number" />
                    <Select allowClear showSearch value={characterFilter || undefined} onChange={(value) => setCharacterFilter(value ?? "")} placeholder="按人物筛选" optionFilterProp="label" options={analysis.characters.map((character) => ({ value: character.id, label: character.name }))} />
                    <Select allowClear showSearch value={eventFilter || undefined} onChange={(value) => setEventFilter(value ?? "")} placeholder="按原著事件筛选" optionFilterProp="label" options={analysis.events.map((event) => ({ value: event.id, label: event.title }))} />
                    <Select allowClear showSearch value={sceneFilter || undefined} onChange={(value) => setSceneFilter(value ?? "")} placeholder="按地点筛选" optionFilterProp="label" options={analysis.scenes.map((scene) => ({ value: scene.id, label: scene.name }))} />
                    <span className="adaptation-muted">显示 {filtered.length} 集</span>
                </div>
                <div className="adaptation-range-regen">
                    <strong>连续多集重生成</strong>
                    <InputNumber min={1} max={workspace.settings.targetEpisodes} value={rangeStart} onChange={(value) => setRangeStart(Number(value) || 1)} />
                    <ChevronRight className="size-3.5" />
                    <InputNumber min={1} max={workspace.settings.targetEpisodes} value={rangeEnd} onChange={(value) => setRangeEnd(Number(value) || 1)} />
                    <Input value={rangeReason} onChange={(event) => setRangeReason(event.target.value)} placeholder="修改方向（可选）" className="adaptation-reason-input" />
                    <Button icon={<RefreshCw className="size-4" />} disabled={disabled || preview || rangeStart > rangeEnd} onClick={() => { onRegenerateRange(rangeStart, rangeEnd, rangeReason); setRangeReason(""); }}>生成局部提案</Button>
                </div>
                <p className="adaptation-note">这里只生成分集规划，不生成正式剧本对白、镜头分镜或视频。锁定集不会被覆盖；局部修改会检查相邻集依赖。</p>
                <div className="adaptation-episode-list">
                    {filtered.map((plan) => <EpisodeCard key={plan.episodeId} plan={plan} preview={preview} onOpen={() => setSelectedNumber(plan.episodeNumber)} />)}
                </div>
            </StudioPanel>

            <Drawer
                open={Boolean(selected)}
                onClose={() => setSelectedNumber(null)}
                width={960}
                destroyOnHidden
                title={selected ? `第 ${selected.episodeNumber} 集 · ${selected.episodeTitle}` : ""}
                extra={selected ? <div className="adaptation-inline-actions"><ReviewTag status={selected.reviewStatus} />{selected.locked ? <Tag bordered={false} color="purple">已锁定</Tag> : null}</div> : null}
            >
                {selected ? (
                    <EpisodeDetail
                        key={selected.episodeId}
                        plan={selected}
                        workspace={workspace}
                        preview={preview}
                        disabled={disabled}
                        module={module}
                        moduleReason={moduleReason}
                        onModuleChange={setModule}
                        onModuleReasonChange={setModuleReason}
                        onRegenerateModule={() => { onRegenerateModule(selected.episodeNumber, module, moduleReason); setModuleReason(""); }}
                        onSave={(patch) => { onSaveEpisode(selected.episodeNumber, patch); setSelectedNumber(null); message.success("分集规划已保存为待审核；请检查相邻集依赖"); }}
                        onApprove={() => { onApproveEpisode(selected.episodeNumber); message.success("该集规划已通过"); }}
                        onLock={() => { onLockEpisode(selected.episodeNumber); message.success("该集已锁定"); }}
                        onUnlock={() => { onUnlockEpisode(selected.episodeNumber); message.success("该集已解锁"); }}
                    />
                ) : null}
            </Drawer>
        </div>
    );
}

function EpisodeCard({ plan, preview, onOpen }: { plan: StudioEpisodePlan; preview: boolean; onOpen: () => void }) {
    return (
        <button type="button" className="adaptation-episode-card" onClick={onOpen}>
            <div className="adaptation-episode-number">{String(plan.episodeNumber).padStart(2, "0")}</div>
            <div className="adaptation-episode-copy">
                <strong>{plan.episodeTitle}</strong>
                <p>{plan.episodeLogline || plan.episodeSynopsis || "未填写剧情概要"}</p>
                <div className="adaptation-episode-meta"><Tag bordered={false}>{plan.estimatedDuration}s</Tag><span>{plan.characterAppearances.slice(0, 3).map((character) => character.name).join("、") || "未标人物"}</span><span>{plan.locations.map((location) => location.name).slice(0, 2).join("、") || "未标地点"}</span></div>
            </div>
            <div className="adaptation-episode-status"><ReviewTag status={plan.reviewStatus} />{preview ? <Tag bordered={false} color="warning">提案预览</Tag> : null}{plan.locked ? <Lock className="size-3.5" /> : null}</div>
        </button>
    );
}

function EpisodeDetail({ plan, workspace, preview, disabled, module, moduleReason, onModuleChange, onModuleReasonChange, onRegenerateModule, onSave, onApprove, onLock, onUnlock }: {
    plan: StudioEpisodePlan;
    workspace: StudioAdaptationWorkspace;
    preview: boolean;
    disabled: boolean;
    module: AdaptationEpisodeModule;
    moduleReason: string;
    onModuleChange: (module: AdaptationEpisodeModule) => void;
    onModuleReasonChange: (reason: string) => void;
    onRegenerateModule: () => void;
    onSave: (patch: EpisodeEdit) => void;
    onApprove: () => void;
    onLock: () => void;
    onUnlock: () => void;
}) {
    const [edit, setEdit] = useState<EpisodeEdit>({
        episodeTitle: plan.episodeTitle,
        episodeLogline: plan.episodeLogline,
        episodeSynopsis: plan.episodeSynopsis,
        dramaticGoal: plan.dramaticGoal,
        openingHook: plan.openingHook,
        mainConflict: plan.mainConflict,
        climax: plan.climax,
        endingHook: plan.endingHook,
        estimatedDuration: plan.estimatedDuration,
        emotionalProgression: plan.emotionalProgression.join("\n"),
        continuityDependencies: plan.continuityDependencies.join("\n"),
    });
    const update = <K extends keyof EpisodeEdit>(key: K, value: EpisodeEdit[K]) => setEdit((current) => ({ ...current, [key]: value }));
    return (
        <div className="adaptation-detail">
            <div className="adaptation-detail-actions">
                {!plan.locked ? <Button type="primary" icon={<Check className="size-4" />} disabled={disabled || preview || plan.reviewStatus === "approved"} onClick={onApprove}>通过本集</Button> : null}
                {!plan.locked ? <Button icon={<Lock className="size-4" />} disabled={disabled || preview} onClick={onLock}>锁定本集</Button> : <Button icon={<Unlock className="size-4" />} disabled={disabled || preview} onClick={onUnlock}>解锁本集</Button>}
                <Button icon={<RefreshCw className="size-4" />} disabled={disabled || preview || plan.locked} onClick={onRegenerateModule}>重生成指定模块</Button>
                <Select
                    value={module}
                    onChange={(value) => onModuleChange(value as AdaptationEpisodeModule)}
                    options={(Object.keys(ADAPTATION_MODULE_LABEL) as AdaptationEpisodeModule[]).map((value) => ({ value, label: ADAPTATION_MODULE_LABEL[value] }))}
                    disabled={disabled || preview || plan.locked}
                    className="adaptation-module-select"
                />
                <Input value={moduleReason} onChange={(event) => onModuleReasonChange(event.target.value)} placeholder="该模块修改方向（可选）" className="adaptation-reason-input" />
            </div>
            <div className="adaptation-detail-grid">
                <div className="adaptation-edit-form">
                    <EditField label="分集标题"><Input value={edit.episodeTitle} onChange={(event) => update("episodeTitle", event.target.value)} /></EditField>
                    <EditField label="一句话卖点 / logline"><Input value={edit.episodeLogline} onChange={(event) => update("episodeLogline", event.target.value)} /></EditField>
                    <EditField label="剧情概要"><Input.TextArea rows={4} value={edit.episodeSynopsis} onChange={(event) => update("episodeSynopsis", event.target.value)} /></EditField>
                    <EditField label="本集戏剧目标"><Input.TextArea rows={2} value={edit.dramaticGoal} onChange={(event) => update("dramaticGoal", event.target.value)} /></EditField>
                    <EditField label="开场钩子"><Input.TextArea rows={2} value={edit.openingHook} onChange={(event) => update("openingHook", event.target.value)} /></EditField>
                    <EditField label="核心冲突"><Input.TextArea rows={2} value={edit.mainConflict} onChange={(event) => update("mainConflict", event.target.value)} /></EditField>
                    <EditField label="高潮"><Input.TextArea rows={2} value={edit.climax} onChange={(event) => update("climax", event.target.value)} /></EditField>
                    <EditField label="集尾钩子"><Input.TextArea rows={2} value={edit.endingHook} onChange={(event) => update("endingHook", event.target.value)} /></EditField>
                    <EditField label="情绪推进（每行一步）"><Input.TextArea rows={3} value={edit.emotionalProgression} onChange={(event) => update("emotionalProgression", event.target.value)} /></EditField>
                    <EditField label="连续性依赖（每行一条）"><Input.TextArea rows={3} value={edit.continuityDependencies} onChange={(event) => update("continuityDependencies", event.target.value)} /></EditField>
                    <EditField label="估算时长（秒）"><InputNumber min={30} max={180} value={edit.estimatedDuration} onChange={(value) => update("estimatedDuration", Number(value) || 60)} className="w-full" /></EditField>
                    <Button type="primary" icon={<Edit3 className="size-4" />} disabled={disabled || preview || plan.locked} onClick={() => onSave(edit)}>保存本集规划</Button>
                </div>
                <div className="adaptation-detail-side">
                    <div className="adaptation-detail-meta"><span>版本 v{plan.version}</span><span>更新 {adaptationTime(plan.updatedAt)}</span><span>{sourceCount(plan.sourceReferences)}</span></div>
                    <TextBlock title={`历史版本（${plan.versions.length}）`}>
                        {plan.versions.length ? <div className="adaptation-detail-list">{plan.versions.slice().reverse().map((item) => <div key={item.id}><strong>v{item.version} · {item.reason || "局部修改"}</strong><small>{adaptationTime(item.createdAt)} · {item.plan.episodeTitle}</small><small>{item.plan.mainConflict}</small></div>)}</div> : <p className="adaptation-muted">还没有旧版本；首次局部修改会在这里保留修改前快照。</p>}
                    </TextBlock>
                    <TextBlock title="关键事件"><div className="adaptation-detail-list">{plan.keyEvents.map((event) => <div key={event.id}><strong>{event.description}</strong><small><OriginTag origin={event.sourceType} /> {sourceCount(event.sourceReferences)}</small></div>)}</div></TextBlock>
                    <TextBlock title="人物逐集状态">
                        <div className="adaptation-state-list">
                            {plan.characterStates.map((state) => (
                                <div key={state.characterId} className="adaptation-state-row">
                                    <div><strong>{state.name}</strong><span>{state.location || "地点未标"} · {state.present ? "在场" : "不在场"} · {state.lifeState}</span></div>
                                    <small>知道：{state.knows.join("；") || "无"}</small>
                                    <small>不知道：{state.unknown.join("；") || "无"}</small>
                                    <small>关系：{state.relationships || "未标"}｜身体：{state.physicalState || "未标"}｜能力：{state.abilityState || "未标"}</small>
                                </div>
                            ))}
                        </div>
                    </TextBlock>
                    <TextBlock title="伏笔动作"><div className="adaptation-foreshadowing-inline"><span>埋设：{plan.foreshadowingIntroduced.join("、") || "无"}</span><span>推进：{plan.foreshadowingAdvanced.join("、") || "无"}</span><span>回收：{plan.foreshadowingResolved.join("、") || "无"}</span></div></TextBlock>
                    <TextBlock title="本集改编"><div className="adaptation-detail-list">{plan.adaptationChanges.map((change) => <div key={change.adaptationChangeId}><strong>{change.adaptationChangeId} · {change.description}</strong><small>{change.operation} · {change.highRisk ? "高风险" : "一般"} · {change.reviewStatus}</small></div>)}{!plan.adaptationChanges.length ? <p className="adaptation-muted">没有关联改编记录。</p> : null}</div></TextBlock>
                </div>
            </div>
            <p className="adaptation-note">阶段 3 会读取这里的当前有效版本、人物状态、场景引用、伏笔安排、因果依赖和锁定状态；本阶段不会生成剧本对白或镜头。</p>
        </div>
    );
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
    return <label className="adaptation-edit-field"><span>{label}</span>{children}</label>;
}

export type { EpisodeEdit };
