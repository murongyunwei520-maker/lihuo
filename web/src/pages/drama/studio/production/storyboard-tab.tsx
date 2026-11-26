import { useEffect, useState } from "react";
import { App, Button, Drawer, Input, InputNumber, Modal, Segmented, Tag, Tooltip } from "antd";
import { Camera, ChevronDown, Clapperboard, Columns3, Expand, Film, History, LayoutList, Lock, LockOpen, Pencil, RefreshCw, Rows3, WandSparkles } from "lucide-react";

import { productionAdmission } from "@/lib/studio/production-engine";
import { applyStoryboardDraft, applyStoryboardSnapshot, copyStoryboardSnapshotToDraft, deleteStoryboardDraft, discardStoryboardSnapshot, enqueueProductionJobs, runEpisodeStoryboard, runStoryboardScene, runStoryboardShot, saveStoryboardDraft, saveStoryboardShotEdit, setShotLocked, setStoryboardLocked } from "@/lib/studio/production-actions";
import { snapshotTypeLabel, storyboardSnapshotDiff } from "@/lib/studio/storyboard-snapshots";
import type { NovelTextModelRuntime } from "@/lib/studio/novel-model";
import type { StudioAdaptationHandoff, StudioEpisodePlan } from "@/types/studio-adaptation";
import type { StudioEpisode, StudioProject } from "@/types/studio";
import type { StudioProductionCheck, StudioProductionShot, StudioProductionReviewStatus, StudioShotGroup, StudioStoryboardDocument, StudioStoryboardDraft, StudioStoryboardVersion } from "@/types/studio-production";

import { CheckList, JobStatusTag, ReviewTag } from "./shared";

type StoryboardTabProps = {
    project: StudioProject;
    episode: StudioEpisode;
    handoff: StudioAdaptationHandoff;
    runtime: NovelTextModelRuntime | null;
    onOpenEpisode: (episodeId: string) => void;
};

type StoryboardView = "list" | "groups" | "detail";

function shotChecks(checks: StudioProductionCheck[], shotId?: string) {
    return shotId ? checks.filter((check) => check.shotId === shotId) : checks;
}

function shotStatusLabel(shot: StudioProductionShot) {
    if (shot.locked) return "锁定";
    if (shot.status === "approved") return "通过";
    if (shot.status === "pending_review") return "待审核";
    return "草稿";
}

export function StoryboardTab({ project, episode, handoff, runtime, onOpenEpisode }: StoryboardTabProps) {
    const { message, modal } = App.useApp();
    const script = episode.production?.script;
    const storyboard = episode.production?.storyboard;
    const drafts = episode.production?.storyboardDrafts ?? [];
    const plan = handoff.episodePlans.find((item) => item.episodeNumber === episode.no);
    const admission = plan ? productionAdmission(handoff, episode.no) : undefined;
    const [busy, setBusy] = useState(false);
    const [view, setView] = useState<StoryboardView>("list");
    const [selectedShotId, setSelectedShotId] = useState<string | undefined>();
    const [editingShot, setEditingShot] = useState<StudioProductionShot | null>(null);
    const [shotDraft, setShotDraft] = useState<StudioProductionShot | null>(null);
    const [selectedSceneId, setSelectedSceneId] = useState<string | undefined>();
    const [snapshotOpen, setSnapshotOpen] = useState<StudioStoryboardVersion | null>(null);
    const [draftOpenId, setDraftOpenId] = useState<string | null>(null);
    const [draftDocument, setDraftDocument] = useState<StudioStoryboardDocument | null>(null);
    const [pendingDraftApply, setPendingDraftApply] = useState<StudioStoryboardDraft | null>(null);
    const [pendingDiscard, setPendingDiscard] = useState<StudioStoryboardVersion | null>(null);

    const draftOpen = drafts.find((draft) => draft.draftId === draftOpenId);

    useEffect(() => {
        setView("list");
        setSelectedShotId(storyboard?.shots[0]?.shotId);
        setSelectedSceneId(storyboard?.groups[0]?.sceneId);
        setEditingShot(null);
        setShotDraft(null);
        setSnapshotOpen(null);
        setDraftOpenId(null);
        setDraftDocument(null);
        setPendingDraftApply(null);
        setPendingDiscard(null);
    }, [episode.id]);

    useEffect(() => {
        setDraftDocument(draftOpen ? JSON.parse(JSON.stringify(draftOpen.storyboard)) as StudioStoryboardDocument : null);
    }, [draftOpenId, draftOpen?.updatedAt]);

    useEffect(() => {
        if (!selectedShotId && storyboard?.shots[0]) setSelectedShotId(storyboard.shots[0].shotId);
        if (!selectedSceneId && storyboard?.groups[0]) setSelectedSceneId(storyboard.groups[0].sceneId);
    }, [storyboard?.shots.length, storyboard?.groups.length, selectedShotId, selectedSceneId]);

    const activeJob = (project.production?.jobs ?? []).find((job) => job.targetEpisodeId === episode.id && job.kind === "storyboard" && ["pending", "queued", "submitting", "running", "cancelling"].includes(job.status));
    const selectedShot = storyboard?.shots.find((shot) => shot.shotId === selectedShotId) ?? storyboard?.shots[0];
    const checks = episode.production?.checks ?? [];
    const sceneRows = script?.scenes.map((scene) => ({ scene, groups: storyboard?.groups.filter((group) => group.sceneId === scene.sceneId) ?? [], shots: storyboard?.shots.filter((shot) => shot.sceneId === scene.sceneId) ?? [] })) ?? [];
    const totalDuration = storyboard?.shots.reduce((sum, shot) => sum + shot.duration, 0) ?? 0;
    const episodeRows = handoff.episodePlans.map((item) => ({ plan: item, episode: project.episodes.find((entry) => entry.no === item.episodeNumber) })).filter((item): item is { plan: StudioEpisodePlan; episode: StudioEpisode } => Boolean(item.episode));
    const staleShotIds = storyboard?.stale?.shotIds ?? [];
    const staleSceneIds = storyboard?.stale?.sceneIds ?? [];
    const snapshotDiff = snapshotOpen ? storyboardSnapshotDiff(storyboard, snapshotOpen) : undefined;

    const generateWhole = async () => {
        setBusy(true);
        const result = await runEpisodeStoryboard(project.id, episode.id);
        setBusy(false);
        if (result.ok) message.success("整集分镜草稿已生成；每场单独调用，未生成任何媒体");
        else message.error(result.error ?? "生成失败");
    };

    const generateScene = async (sceneId: string) => {
        setBusy(true);
        const result = await runStoryboardScene(project.id, episode.id, sceneId);
        setBusy(false);
        if (result.ok) message.success("本场分镜已生成；其他场景保持不变");
        else message.error(result.error ?? "生成失败");
    };

    const generateShot = async (shotId: string) => {
        setBusy(true);
        const result = await runStoryboardShot(project.id, episode.id, shotId);
        setBusy(false);
        if (result.ok) message.success("单镜已重生成；镜头组共享状态已检查");
        else message.error(result.error ?? "生成失败");
    };

    const queueScenes = () => {
        if (!script) return;
        const result = enqueueProductionJobs(project.id, "storyboard", [episode.id], script.scenes.map((scene) => scene.sceneId));
        if (result.ok) message.success("已按场景加入分镜队列；不会一次性请求整集镜头");
        else message.error(result.error ?? "入队失败");
    };

    const applySnapshot = async () => {
        if (!snapshotOpen || !storyboard) return;
        setBusy(true);
        const result = await applyStoryboardSnapshot(project.id, episode.id, snapshotOpen.snapshotId, { expectedVersion: storyboard.storyboardVersion, mode: "apply" });
        setBusy(false);
        if (result.ok) {
            setSnapshotOpen(null);
            message.success(`已应用为新的正式版本 v${result.newVersion}；应用前版本已备份`);
        } else message.error(result.error ?? "应用快照失败");
    };

    const copySnapshotToDraft = () => {
        if (!snapshotOpen) return;
        const result = copyStoryboardSnapshotToDraft(project.id, episode.id, snapshotOpen.snapshotId);
        if (result.ok && result.draftId) {
            setSnapshotOpen(null);
            setDraftOpenId(result.draftId);
            message.success(result.reusedDraft ? "该快照已有独立草稿，已打开原草稿；正式分镜未改变" : `已创建独立草稿 ${result.draftId}；正式 v${result.newVersion ?? storyboard?.storyboardVersion ?? 0} 未改变`);
        } else message.error(result.error ?? "复制草稿失败");
    };

    const saveDraft = () => {
        if (!draftOpen || !draftDocument) return;
        const result = saveStoryboardDraft(project.id, episode.id, draftOpen.draftId, draftDocument);
        if (result.ok) message.success(result.unchanged ? "草稿内容没有变化，未递增草稿版本" : `草稿已保存为 v${result.newVersion}；正式分镜未改变`);
        else message.error(result.error ?? "保存草稿失败");
    };

    const removeDraft = (draft: StudioStoryboardDraft) => {
        modal.confirm({
            title: `删除独立草稿 ${draft.draftId}？`,
            content: "只会删除草稿；正式分镜、正式版本号和历史快照都不会改变。",
            okText: "删除草稿",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                const result = deleteStoryboardDraft(project.id, episode.id, draft.draftId);
                if (result.ok) {
                    if (draftOpenId === draft.draftId) setDraftOpenId(null);
                    message.success("草稿已删除；正式分镜未改变");
                } else message.error(result.error ?? "删除草稿失败");
            },
        });
    };

    const applyDraft = async (draft: StudioStoryboardDraft, allowStaleDraft = false) => {
        if (!storyboard) return;
        const result = await applyStoryboardDraft(project.id, episode.id, draft.draftId, { expectedVersion: storyboard.storyboardVersion, allowStaleDraft });
        if (result.ok) {
            setPendingDraftApply(null);
            message.success(`草稿 ${draft.draftId} 已应用为正式 v${result.newVersion}；原正式版本已备份`);
        } else if (result.requiresConfirmation === "draft_conflict") {
            setPendingDraftApply(draft);
        } else message.error(result.error ?? "应用草稿失败");
    };

    const updateDraftShot = (shotId: string, patch: Partial<StudioProductionShot>) => {
        setDraftDocument((current) => current ? {
            ...current,
            shots: current.shots.map((shot) => shot.shotId === shotId ? { ...shot, ...patch, updatedAt: new Date().toISOString() } : shot),
        } : current);
    };

    const discardSnapshot = async () => {
        if (!pendingDiscard || busy) return;
        setBusy(true);
        try {
            const result = await discardStoryboardSnapshot(project.id, episode.id, pendingDiscard.snapshotId);
            if (result.ok) {
                setPendingDiscard(null);
                if (snapshotOpen?.snapshotId === pendingDiscard.snapshotId) setSnapshotOpen(null);
                message.success("快照已丢弃；正式分镜与正式版本未改变");
            } else message.error(result.error ?? "丢弃失败");
        } finally {
            setBusy(false);
        }
    };

    const openShotEditor = (shot: StudioProductionShot) => {
        setEditingShot(shot);
        setShotDraft(JSON.parse(JSON.stringify(shot)) as StudioProductionShot);
    };

    const saveShot = async () => {
        if (!shotDraft) return;
        const result = await saveStoryboardShotEdit(project.id, episode.id, shotDraft.shotId, shotDraft);
        if (result.ok) {
            message.success("镜头修改已保存；旧分镜已进入历史");
            setEditingShot(null);
        } else message.error(result.error ?? "保存失败");
    };

    return (
        <div className="stage3-storyboard-layout">
            <aside className="stage3-episode-rail">
                <header>
                    <div><span className="stage3-kicker">STORYBOARD / EPISODES</span><strong>分镜设计</strong></div>
                    <Tag bordered={false}>{episodeRows.length} 集</Tag>
                </header>
                <div className="stage3-episode-list">
                    {episodeRows.map(({ episode: rowEpisode }) => {
                        const row = rowEpisode.production?.storyboard;
                        return (
                            <button key={rowEpisode.id} type="button" className={`stage3-episode-row${rowEpisode.id === episode.id ? " is-active" : ""}`} onClick={() => onOpenEpisode(rowEpisode.id)}>
                                <span className="stage3-episode-row__no">{String(rowEpisode.no).padStart(2, "0")}</span>
                                <div>
                                    <strong>{rowEpisode.title}</strong>
                                    <small>{row ? `${row.shots.length} 镜 · ${Math.round(row.shots.reduce((sum, shot) => sum + shot.duration, 0))}s` : "尚未生成分镜"}</small>
                                    <span className="stage3-episode-row__meta">
                                        {row?.status === "locked" ? <em><Lock className="size-3" /> 锁定</em> : null}
                                        {row ? <em>{row.groups.length} 组</em> : <em>等待剧本</em>}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="stage3-rail-footer"><span>本集镜头</span><strong>{storyboard?.shots.length ?? 0}</strong></div>
            </aside>

            <section className="stage3-storyboard-main">
                <header className="stage3-document__top">
                    <div>
                        <span className="stage3-kicker">STORYBOARD · EPISODE {String(episode.no).padStart(2, "0")}</span>
                        <div className="stage3-title-line">
                            <h2>{script?.title || episode.title}</h2>
                            {storyboard ? <ReviewTag status={storyboard.status as StudioProductionReviewStatus} /> : <Tag bordered={false}>未生成</Tag>}
                            {storyboard ? <Tag bordered={false}>v{storyboard.storyboardVersion}</Tag> : null}
                            {storyboard?.stale ? <Tag bordered={false} color="warning">{staleShotIds.length} 镜待检查</Tag> : null}
                            <Tag bordered={false}>{storyboard?.groups.length ?? 0} 镜头组 / {storyboard?.shots.length ?? 0} 镜头</Tag>
                            <Tag bordered={false}>{Math.round(totalDuration)}s</Tag>
                        </div>
                        <p>{storyboard ? "以正式剧本为依据的场景 → 镜头组 → 单镜头结构；只保存提示词与生成约束，不生成媒体。" : "生成前先检查正式剧本。分镜不脱离剧本另写剧情。"}</p>
                    </div>
                    <div className="stage3-document__actions">
                        {storyboard ? (
                            <Button size="small" icon={storyboard.status === "locked" ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />} onClick={() => void setStoryboardLocked(project.id, episode.id, storyboard.status !== "locked")}>
                                {storyboard.status === "locked" ? "解锁分镜" : "锁定分镜"}
                            </Button>
                        ) : null}
                        <Button size="small" icon={<WandSparkles className="size-3.5" />} onClick={queueScenes} disabled={!script}>按场排队</Button>
                        <Button size="small" type="primary" icon={<Clapperboard className="size-3.5" />} loading={busy || Boolean(activeJob)} onClick={() => void generateWhole()} disabled={!script || !admission?.draftAllowed || Boolean(storyboard?.shots.some((shot) => shot.locked))}>
                            {storyboard ? "整集重生分镜" : "生成整集分镜"}
                        </Button>
                    </div>
                </header>

                <div className="stage3-storyboard-toolbar">
                    <Segmented
                        size="small"
                        value={view}
                        onChange={(value) => setView(value as StoryboardView)}
                        options={[
                            { value: "list", label: <span className="stage3-seg"><LayoutList className="size-3.5" /> 镜头列表</span> },
                            { value: "groups", label: <span className="stage3-seg"><Columns3 className="size-3.5" /> 场景分组</span> },
                            { value: "detail", label: <span className="stage3-seg"><Expand className="size-3.5" /> 单镜头详情</span> },
                        ]}
                    />
                    <div className="stage3-toolbar-meta">
                        {activeJob ? <><JobStatusTag status={activeJob.status} /><span>{activeJob.currentLabel}</span></> : <span className="stage3-model-inline">{runtime?.label ?? "读取项目文本模型…"}</span>}
                    </div>
                </div>

                {!storyboard ? (
                    <div className="stage3-document-empty">
                        <Film className="size-8" />
                        <strong>当前集还没有结构化分镜</strong>
                        <p>整集分镜会按场景逐个调用模型，最后一次性写入；任何一场失败都不会留下半成品。镜头只保存 imagePrompt / videoPrompt 文本，不执行媒体生成。</p>
                        <Button type="primary" icon={<Clapperboard className="size-3.5" />} onClick={() => void generateWhole()} loading={busy || Boolean(activeJob)} disabled={!script || !admission?.draftAllowed}>生成整集分镜</Button>
                    </div>
                ) : view === "list" ? (
                    <ShotListView
                        storyboard={storyboard}
                        selectedShotId={selectedShot?.shotId}
                        staleShotIds={staleShotIds}
                        onSelect={(shot) => { setSelectedShotId(shot.shotId); setView("detail"); }}
                        onRegenerate={(shot) => void generateShot(shot.shotId)}
                        onLock={(shot) => setShotLocked(project.id, episode.id, shot.shotId, !shot.locked)}
                        busy={busy}
                    />
                ) : view === "groups" ? (
                    <div className="stage3-groups-view">
                        {sceneRows.map(({ scene, groups, shots }) => (
                            <section key={scene.sceneId} className="stage3-group-scene">
                                <header>
                                    <span className="stage3-scene-no">{String(scene.sceneNumber).padStart(2, "0")}</span>
                                    <div><h3>{scene.sceneTitle}{staleSceneIds.includes(scene.sceneId) ? <Tag bordered={false} color="warning">剧本已变更</Tag> : null}</h3><small>{scene.locationId} · {scene.timeOfDay}</small></div>
                                    <div className="stage3-group-scene__acts">
                                        <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void generateScene(scene.sceneId)} disabled={busy}>重生成整场</Button>
                                    </div>
                                </header>
                                {groups.length ? groups.map((group) => (
                                    <div key={group.shotGroupId} className="stage3-group-card">
                                        <header>
                                            <div><strong>{group.shotGroupId}</strong><span>{group.timeOfDay} · {group.lighting || "光照未填"} · {group.weather || "天气未填"}</span></div>
                                            <Tag bordered={false}>{group.shotIds.length} 镜</Tag>
                                        </header>
                                        <div className="stage3-group-shared">
                                            <div><span>共享布局</span><p>{group.sharedLayout || "未填写"}</p></div>
                                            <div><span>摄影机轴线</span><p>{group.cameraAxis || "未填写"}</p></div>
                                            <div><span>道具状态</span><p>{group.propStates || "未填写"}</p></div>
                                        </div>
                                        <div className="stage3-group-shots">
                                            {shots.map((shot) => (
                                                <button key={shot.shotId} type="button" className="stage3-group-shot" onClick={() => { setSelectedShotId(shot.shotId); setView("detail"); }}>
                                                    <div className="stage3-group-shot__index">#{shot.shotNumber}</div>
                                                    <strong>{shot.shotSize} · {shot.cameraAngle}</strong>
                                                    <p>{shot.action || shot.composition || "镜头描述未填写"}</p>
                                                    <span>{shot.duration}s · {shot.cameraMovement || "固定"}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )) : <div className="stage3-check-empty">本场还没有镜头组，生成整场后按轴线与空间建立分组。</div>}
                            </section>
                        ))}
                    </div>
                ) : selectedShot ? (
                    <ShotDetailView
                        shot={selectedShot}
                        group={storyboard.groups.find((group) => group.shotGroupId === selectedShot.shotGroupId)}
                        checks={shotChecks(checks, selectedShot.shotId)}
                        stale={staleShotIds.includes(selectedShot.shotId)}
                        onRegenerate={() => void generateShot(selectedShot.shotId)}
                        onLock={() => setShotLocked(project.id, episode.id, selectedShot.shotId, !selectedShot.locked)}
                        onEdit={() => openShotEditor(selectedShot)}
                        busy={busy}
                    />
                ) : null}
            </section>

            <aside className="stage3-inspector">
                <section>
                    <header><span className="stage3-kicker">STORYBOARD STATE</span><strong>结构统计</strong></header>
                    <div className="stage3-admission-grid">
                        <div><span>镜头组</span><b>{storyboard?.groups.length ?? 0}</b></div>
                        <div><span>镜头</span><b>{storyboard?.shots.length ?? 0}</b></div>
                        <div><span>锁定镜头</span><b>{storyboard?.shots.filter((shot) => shot.locked).length ?? 0}</b></div>
                        <div><span>总时长</span><b>{Math.round(totalDuration)}s</b></div>
                    </div>
                    <div className="stage3-source-block">
                        <span>来源剧本</span>
                        <code>{storyboard?.sourceScriptId ?? "尚未生成"}</code>
                        <small>script v{storyboard?.sourceScriptVersion ?? script?.scriptVersion ?? 0} · storyboard v{storyboard?.storyboardVersion ?? 0}</small>
                        {storyboard ? <small>plan {storyboard.sourceEpisodePlanId || "未记录"} · blueprint v{storyboard.sourceBlueprintVersion || 0} · {storyboard.sourceHandoffId || "handoff 未记录"}</small> : null}
                    </div>
                </section>

                <section>
                    <header><span className="stage3-kicker">CONTINUITY</span><strong>分镜检查</strong><Tag bordered={false}>{checks.filter((check) => check.category !== "剧本结构" && check.category !== "时长" && check.category !== "剧本对白").length}</Tag></header>
                    <CheckList checks={checks.filter((check) => !["剧本结构", "时长", "剧本对白"].includes(check.category))} empty="轴线、站位和道具连续性暂无问题；仍要人工确认真实空间关系。" />
                </section>

                <section>
                    <header><span className="stage3-kicker">SCRIPT DEPENDENCY</span><strong>剧本依赖</strong>{storyboard?.stale ? <Tag bordered={false} color="warning">待检查</Tag> : <Tag bordered={false}>一致</Tag>}</header>
                    <div className="stage3-source-block">
                        <span>依据剧本版本</span>
                        <code>v{storyboard?.sourceScriptVersion ?? 0} → 当前 v{script?.scriptVersion ?? 0}</code>
                        <small>{storyboard?.stale ? `影响 ${staleSceneIds.length} 个场景 / ${staleShotIds.length} 个镜头；旧分镜保留，未自动重生成。` : "当前分镜来源版本与已有剧本一致。"}</small>
                        {storyboard?.stale ? <small>{storyboard.stale.reason}</small> : null}
                    </div>
                </section>

                <section>
                    <header><span className="stage3-kicker">VERSIONS</span><strong>分镜快照</strong><Tag bordered={false}>{episode.production?.storyboardVersions.length ?? 0}</Tag></header>
                    {(episode.production?.storyboardVersions.length ?? 0) === 0 ? <div className="stage3-check-empty">覆盖生成或手工修改后，旧版会保留。</div> : (
                        <div className="stage3-version-list">
                            {episode.production!.storyboardVersions.map((version) => (
                                <div key={version.id} className={`stage3-version-row is-${version.snapshotType}`}>
                                    <div>
                                        <div className="stage3-version-tags">
                                            <strong>{version.snapshotType === "formal" ? `正式 v${version.version}` : `基于 v${version.basedOnVersion}`}</strong>
                                            <Tag bordered={false} color={version.snapshotType === "conflict" ? "error" : version.snapshotType === "formal" ? "success" : "default"}>{snapshotTypeLabel(version.snapshotType)}</Tag>
                                        </div>
                                        <span>{version.reason}</span>
                                        <small className="stage3-snapshot-id">{version.snapshotId}</small>
                                        {version.sourceTaskId ? <small className="stage3-snapshot-id">task {version.sourceTaskId}</small> : null}
                                    </div>
                                    <div>
                                        <small>{new Date(version.createdAt).toLocaleString("zh-CN")}</small>
                                        <Button size="small" type="link" onClick={() => setSnapshotOpen(version)}>查看/比较</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section>
                    <header><span className="stage3-kicker">DRAFTS</span><strong>独立分镜草稿</strong><Tag bordered={false}>{drafts.length}</Tag></header>
                    {drafts.length === 0 ? <div className="stage3-check-empty">从快照「复制到新草稿」可在这里建立独立草稿；不会改动正式分镜。</div> : (
                        <div className="stage3-version-list stage3-draft-list">
                            {drafts.map((draft) => (
                                <div key={draft.draftId} className="stage3-version-row stage3-draft-row">
                                    <div>
                                        <div className="stage3-version-tags">
                                            <strong>{draft.draftId}</strong>
                                            <Tag bordered={false} color={draft.appliedStoryboardVersion ? "success" : "default"}>{draft.appliedStoryboardVersion ? `已应用 v${draft.appliedStoryboardVersion}` : "草稿"}</Tag>
                                        </div>
                                        <span>来源 {draft.sourceSnapshotId || "未记录"} · 基于正式 v{draft.sourceStoryboardVersion}</span>
                                        <small className="stage3-snapshot-id">草稿 v{draft.draftVersion} · {draft.storyboard.groups.length} 组 / {draft.storyboard.shots.length} 镜</small>
                                    </div>
                                    <div className="stage3-draft-actions">
                                        <small>{new Date(draft.updatedAt).toLocaleString("zh-CN")}</small>
                                        <Button size="small" type="link" onClick={() => setDraftOpenId(draft.draftId)}>查看/编辑</Button>
                                        <Button size="small" type="link" disabled={draft.status !== "active"} onClick={() => void applyDraft(draft)}>应用</Button>
                                        <Button size="small" type="link" danger onClick={() => removeDraft(draft)}>删除</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {selectedShot && view !== "detail" ? (
                    <section>
                        <header><span className="stage3-kicker">QUICK LOOK</span><strong>当前镜头</strong></header>
                        <div className="stage3-quick-shot" onClick={() => setView("detail")}>
                            <strong>#{selectedShot.shotNumber} · {selectedShot.shotSize}</strong>
                            <p>{selectedShot.action || selectedShot.composition}</p>
                            <span>{selectedShot.cameraAngle} · {selectedShot.cameraMovement || "固定"} · {selectedShot.duration}s</span>
                        </div>
                    </section>
                ) : null}
            </aside>

            <Modal
                open={Boolean(snapshotOpen)}
                title={snapshotOpen ? `${snapshotTypeLabel(snapshotOpen.snapshotType)} · ${snapshotOpen.snapshotId}` : "分镜快照"}
                width={760}
                onCancel={() => setSnapshotOpen(null)}
                destroyOnHidden
                footer={[
                    <Button key="keep" onClick={() => setSnapshotOpen(null)}>保留快照</Button>,
                    snapshotOpen?.snapshotType !== "formal" ? <Button key="discard" danger onClick={() => setPendingDiscard(snapshotOpen)}>丢弃快照</Button> : null,
                    <Button key="copy" onClick={copySnapshotToDraft} loading={busy}>复制到新草稿</Button>,
                    <Button key="apply" type="primary" onClick={() => void applySnapshot()} loading={busy}>应用为正式版本</Button>,
                ]}
            >
                {snapshotOpen && snapshotDiff ? (
                    <div className="stage3-snapshot-modal">
                        <div className="stage3-overwrite-grid">
                            <div><span>快照类型</span><b>{snapshotTypeLabel(snapshotOpen.snapshotType)}</b></div>
                            <div><span>快照唯一 ID</span><b>{snapshotOpen.snapshotId}</b></div>
                            <div><span>正式版本</span><b>{snapshotOpen.snapshotType === "formal" ? `v${snapshotOpen.version}` : `不是正式 v${snapshotOpen.version}`}</b></div>
                            <div><span>基于版本</span><b>v{snapshotOpen.basedOnVersion}</b></div>
                            <div><span>当前正式版本</span><b>v{snapshotDiff.currentVersion}</b></div>
                            <div><span>正式版本变化</span><b>{snapshotDiff.currentVersion === snapshotOpen.basedOnVersion ? "未变化" : `v${snapshotOpen.basedOnVersion} → v${snapshotDiff.currentVersion}`}</b></div>
                            <div><span>生成时间</span><b>{new Date(snapshotOpen.createdAt).toLocaleString("zh-CN")}</b></div>
                            <div><span>关联任务</span><b>{snapshotOpen.sourceTaskId || "未记录"}</b></div>
                        </div>
                        <div className="stage3-snapshot-compare">
                            <div><span>当前正式</span><strong>{snapshotDiff.currentGroups} 组 / {snapshotDiff.currentShots} 镜</strong></div>
                            <div><span>快照内容</span><strong>{snapshotDiff.snapshotGroups} 组 / {snapshotDiff.snapshotShots} 镜</strong></div>
                        </div>
                        {snapshotDiff.changedScenes.length ? <p className="stage3-note">场景结构差异：{snapshotDiff.changedScenes.join("、")}</p> : <p className="stage3-note">场景结构一致；镜头内容仍需人工比较。</p>}
                        <p className="stage3-note">「复制到新草稿」只创建独立草稿，不占用正式版本号、不修改当前正式分镜；只有「应用为正式版本」会按当前正式 v{snapshotDiff.currentVersion} 重新校验并先备份，再递增到 v{snapshotDiff.currentVersion + 1}。</p>
                        {snapshotOpen.snapshotType === "conflict" ? <div className="stage3-admission is-warn">这是并发冲突快照，不是正式版本；直接应用前请确认当前剧本与分镜没有继续变化。</div> : null}
                    </div>
                ) : null}
            </Modal>

            <Modal
                open={Boolean(pendingDiscard)}
                title="确认丢弃快照？"
                okText="确认丢弃"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                confirmLoading={busy}
                onOk={() => void discardSnapshot()}
                onCancel={() => setPendingDiscard(null)}
                destroyOnHidden
            >
                {pendingDiscard ? (
                    <div className="stage3-overwrite-modal">
                        <div className="stage3-overwrite-grid">
                            <div><span>快照类型</span><b>{snapshotTypeLabel(pendingDiscard.snapshotType)}</b></div>
                            <div><span>快照 ID</span><b>{pendingDiscard.snapshotId}</b></div>
                            <div><span>创建时间</span><b>{new Date(pendingDiscard.createdAt).toLocaleString("zh-CN")}</b></div>
                            <div><span>关联正式分镜版本</span><b>{pendingDiscard.snapshotType === "formal" ? `v${pendingDiscard.version}` : `基于 v${pendingDiscard.basedOnVersion}，不是正式 v${pendingDiscard.version}`}</b></div>
                            <div><span>当前正式版本</span><b>v{storyboard?.storyboardVersion ?? 0}</b></div>
                        </div>
                        <p className="stage3-note">丢弃只删除这条快照记录，不会修改正式分镜内容、正式版本号或其他快照；正式快照不能被丢弃。项目 / 分集 / 快照 / 正式版本校验仍由现有事务执行，本确认不会绕过这些保护。</p>
                    </div>
                ) : null}
            </Modal>

            <Modal
                open={Boolean(pendingDraftApply)}
                title="草稿基于旧正式版本，仍要应用？"
                okText="确认应用草稿"
                cancelText="取消"
                onOk={() => pendingDraftApply ? applyDraft(pendingDraftApply, true) : setPendingDraftApply(null)}
                onCancel={() => setPendingDraftApply(null)}
                destroyOnHidden
            >
                <div className="stage3-overwrite-modal">
                    <div><span>草稿</span><b>{pendingDraftApply?.draftId}</b></div>
                    <div><span>草稿来源版本</span><b>正式 v{pendingDraftApply?.sourceStoryboardVersion}</b></div>
                    <div><span>当前正式版本</span><b>v{storyboard?.storyboardVersion ?? 0}</b></div>
                    <div><span>应用方式</span><b>先备份当前正式版本，再递增为新正式版本</b></div>
                    <p>应用前会再次校验草稿结构；如果当前分镜已锁定或已有锁定镜头，仍会拒绝。</p>
                </div>
            </Modal>

            <Drawer
                open={Boolean(draftOpen && draftDocument)}
                onClose={() => setDraftOpenId(null)}
                title={draftOpen ? `独立草稿 · ${draftOpen.draftId}` : "独立草稿"}
                width={760}
                destroyOnHidden
                extra={<div className="stage3-draft-drawer-actions"><Button onClick={saveDraft}>保存草稿</Button><Button type="primary" disabled={!draftOpen || draftOpen.status !== "active"} onClick={() => draftOpen ? void applyDraft(draftOpen) : undefined}>应用为正式</Button></div>}
            >
                {draftOpen && draftDocument ? (
                    <div className="stage3-scene-editor">
                        <div className="stage3-overwrite-grid">
                            <div><span>来源快照</span><b>{draftOpen.sourceSnapshotId || "未记录"}</b></div>
                            <div><span>来源正式版本</span><b>v{draftOpen.sourceStoryboardVersion}</b></div>
                            <div><span>草稿版本</span><b>v{draftOpen.draftVersion}</b></div>
                            <div><span>当前正式版本</span><b>v{storyboard?.storyboardVersion ?? 0}（不会被本抽屉修改）</b></div>
                            <div><span>应用记录</span><b>{draftOpen.appliedStoryboardVersion ? `已应用为 v${draftOpen.appliedStoryboardVersion}` : "尚未应用"}</b></div>
                            <div><span>内容</span><b>{draftDocument.groups.length} 组 / {draftDocument.shots.length} 镜</b></div>
                        </div>
                        {draftDocument.shots.map((shot) => (
                            <div key={shot.shotId} className="stage3-draft-shot">
                                <header><strong>#{shot.shotNumber} · {shot.shotId}</strong><span>{shot.sceneId} / {shot.shotGroupId}</span></header>
                                <div className="stage3-form-row">
                                    <label>景别<Input value={shot.shotSize} onChange={(event) => updateDraftShot(shot.shotId, { shotSize: event.target.value })} /></label>
                                    <label>运镜<Input value={shot.cameraMovement} onChange={(event) => updateDraftShot(shot.shotId, { cameraMovement: event.target.value })} /></label>
                                    <label>时长<InputNumber min={1} max={15} value={shot.duration} onChange={(value) => updateDraftShot(shot.shotId, { duration: value ?? shot.duration })} /></label>
                                </div>
                                <label>动作<Input.TextArea rows={2} value={shot.action} onChange={(event) => updateDraftShot(shot.shotId, { action: event.target.value })} /></label>
                                <label>imagePrompt<Input.TextArea rows={3} value={shot.imagePrompt} onChange={(event) => updateDraftShot(shot.shotId, { imagePrompt: event.target.value })} /></label>
                            </div>
                        ))}
                        <div className="stage3-readonly-note">草稿内容和 draftVersion 独立保存；正式分镜仍为 v{storyboard?.storyboardVersion ?? 0}，只有点「应用为正式」才会改变正式工作区。</div>
                    </div>
                ) : null}
            </Drawer>

            <Drawer
                open={Boolean(editingShot && shotDraft)}
                onClose={() => setEditingShot(null)}
                title={shotDraft ? `编辑镜头 #${shotDraft.shotNumber}` : "编辑镜头"}
                width={760}
                destroyOnHidden
                extra={<Button type="primary" onClick={() => void saveShot()}>保存镜头</Button>}
            >
                {shotDraft ? (
                    <div className="stage3-scene-editor">
                        <div className="stage3-form-row">
                            <label>景别<Input value={shotDraft.shotSize} onChange={(event) => setShotDraft({ ...shotDraft, shotSize: event.target.value })} /></label>
                            <label>运镜<Input value={shotDraft.cameraMovement} onChange={(event) => setShotDraft({ ...shotDraft, cameraMovement: event.target.value })} /></label>
                            <label>时长<InputNumber min={1} max={15} value={shotDraft.duration} onChange={(value) => setShotDraft({ ...shotDraft, duration: value ?? shotDraft.duration })} /></label>
                        </div>
                        <div className="stage3-form-row">
                            <label>机位<Input value={shotDraft.cameraPosition} onChange={(event) => setShotDraft({ ...shotDraft, cameraPosition: event.target.value })} /></label>
                            <label>角度<Input value={shotDraft.cameraAngle} onChange={(event) => setShotDraft({ ...shotDraft, cameraAngle: event.target.value })} /></label>
                            <label>镜头<Input value={shotDraft.lens} onChange={(event) => setShotDraft({ ...shotDraft, lens: event.target.value })} /></label>
                        </div>
                        <label>构图<Input.TextArea rows={2} value={shotDraft.composition} onChange={(event) => setShotDraft({ ...shotDraft, composition: event.target.value })} /></label>
                        <label>人物调度<Input.TextArea rows={3} value={shotDraft.characterBlocking} onChange={(event) => setShotDraft({ ...shotDraft, characterBlocking: event.target.value })} /></label>
                        <label>动作<Input.TextArea rows={3} value={shotDraft.action} onChange={(event) => setShotDraft({ ...shotDraft, action: event.target.value })} /></label>
                        <label>微表情<Input.TextArea rows={3} value={shotDraft.facialExpression} onChange={(event) => setShotDraft({ ...shotDraft, facialExpression: event.target.value })} /></label>
                        <div className="stage3-form-row">
                            <label>视线<Input value={shotDraft.eyeline} onChange={(event) => setShotDraft({ ...shotDraft, eyeline: event.target.value })} /></label>
                            <label>情绪<Input value={shotDraft.emotion} onChange={(event) => setShotDraft({ ...shotDraft, emotion: event.target.value })} /></label>
                        </div>
                        <label>连续性规则<Input.TextArea rows={2} value={shotDraft.continuityRules.join("\n")} onChange={(event) => setShotDraft({ ...shotDraft, continuityRules: event.target.value.split("\n").filter(Boolean) })} /></label>
                        <label>画面声音<Input.TextArea rows={2} value={shotDraft.soundEffects} onChange={(event) => setShotDraft({ ...shotDraft, soundEffects: event.target.value })} /></label>
                        <label>背景音乐意图<Input value={shotDraft.backgroundMusic} onChange={(event) => setShotDraft({ ...shotDraft, backgroundMusic: event.target.value })} /></label>
                        <label>imagePrompt（只存文本，不生成图片）<Input.TextArea rows={4} value={shotDraft.imagePrompt} onChange={(event) => setShotDraft({ ...shotDraft, imagePrompt: event.target.value })} /></label>
                        <label>videoPrompt（只存文本，不生成视频）<Input.TextArea rows={4} value={shotDraft.videoPrompt} onChange={(event) => setShotDraft({ ...shotDraft, videoPrompt: event.target.value })} /></label>
                        <div className="stage3-readonly-note">镜头 shotId 固定为 {shotDraft.shotId}；修改不会新建另一个镜头。</div>
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}

function ShotListView({ storyboard, selectedShotId, staleShotIds, onSelect, onRegenerate, onLock, busy }: { storyboard: NonNullable<StudioEpisode["production"]>["storyboard"]; selectedShotId?: string; staleShotIds: string[]; onSelect: (shot: StudioProductionShot) => void; onRegenerate: (shot: StudioProductionShot) => void; onLock: (shot: StudioProductionShot) => void; busy: boolean }) {
    if (!storyboard) return null;
    return (
        <div className="stage3-shot-table">
            <div className="stage3-shot-table__head">
                <span>状态</span><span>镜号</span><span>时长</span><span>景别</span><span>机位 / 角度</span><span>运镜</span><span>画面与动作</span><span>对白 / 声音</span><span />
            </div>
            {storyboard.groups.map((group) => (
                <div key={group.shotGroupId}>
                    <div className="stage3-shot-scene-head">
                        <span>{group.sceneId}</span>
                        <strong>{group.timeOfDay} · {group.lighting || "光照未填"}</strong>
                        <em>{group.shotGroupId} · 轴线 {group.cameraAxis || "未填写"}</em>
                    </div>
                    {storyboard.shots.filter((shot) => shot.shotGroupId === group.shotGroupId).map((shot) => (
                        <div key={shot.shotId} className={`stage3-shot-row${selectedShotId === shot.shotId ? " is-active" : ""}${shot.locked ? " is-locked" : ""}${staleShotIds.includes(shot.shotId) ? " is-stale" : ""}`} onClick={() => onSelect(shot)}>
                            <span className={`stage3-shot-status is-${shot.locked ? "locked" : shot.status}`}>{shotStatusLabel(shot)}{staleShotIds.includes(shot.shotId) ? <em className="stage3-stale-mark">待检查</em> : null}</span>
                            <span className="stage3-shot-no">#{shot.shotNumber}</span>
                            <span>{shot.duration}s</span>
                            <span>{shot.shotSize}</span>
                            <span>{shot.cameraPosition}<small>{shot.cameraAngle}</small></span>
                            <span>{shot.cameraMovement || "固定"}</span>
                            <span className="stage3-shot-description">{shot.action || shot.composition || "未填写"}<small>{shot.characterBlocking}</small></span>
                            <span className="stage3-shot-audio">{shot.dialogue.length ? shot.dialogue.map((line) => `${line.speaker}：${line.text}`).join(" / ") : "无对白"}<small>{shot.soundEffects || shot.backgroundMusic || "声音未设计"}</small></span>
                            <span className="stage3-shot-actions" onClick={(event) => event.stopPropagation()}>
                                <Tooltip title="单镜重生成"><Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} onClick={() => onRegenerate(shot)} disabled={busy} /></Tooltip>
                                <Tooltip title={shot.locked ? "解锁镜头" : "锁定镜头"}><Button size="small" type="text" icon={shot.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />} onClick={() => onLock(shot)} /></Tooltip>
                            </span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function ShotDetailView({ shot, group, checks, stale, onRegenerate, onLock, onEdit, busy }: { shot: StudioProductionShot; group?: StudioShotGroup; checks: StudioProductionCheck[]; stale: boolean; onRegenerate: () => void; onLock: () => void; onEdit: () => void; busy: boolean }) {
    return (
        <div className="stage3-shot-detail">
            <div className="stage3-shot-detail__visual">
                <div className="stage3-shot-frame">
                    <div className="stage3-shot-frame__top"><span>{shot.shotSize}</span><span>{shot.cameraAngle}</span><span>{shot.lens || "默认镜头"}</span></div>
                    <div className="stage3-shot-frame__body">
                        <span>{shot.foreground || "前景"}</span>
                        <span>{shot.midground || "中景层"}</span>
                        <span>{shot.background || "背景"}</span>
                    </div>
                    <div className="stage3-shot-frame__bottom">{shot.composition || "构图说明未填写"}</div>
                </div>
                <div className="stage3-shot-detail__actions">
                    <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={onRegenerate} disabled={busy}>单镜重生成</Button>
                    <Button size="small" icon={shot.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />} onClick={onLock}>{shot.locked ? "解锁" : "锁定"}</Button>
                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={onEdit}>编辑</Button>
                </div>
            </div>
            <div className="stage3-shot-detail__info">
                <header>
                    <div><span className="stage3-kicker">SHOT #{shot.shotNumber} · {shot.shotGroupId}</span><h3>{shot.shotSize} · {shot.cameraMovement || "固定"} · {shot.duration}s</h3></div>
                    <div className="stage3-shot-detail__tags">{stale ? <Tag bordered={false} color="warning">剧本已变更 · 待检查</Tag> : null}<ReviewTag status={shot.status} /></div>
                </header>
                <div className="stage3-detail-grid">
                    <div><span>人物调度</span><p>{shot.characterBlocking || "未填写"}</p></div>
                    <div><span>视线</span><p>{shot.eyeline || "未填写"}</p></div>
                    <div><span>动作</span><p>{shot.action || "未填写"}</p></div>
                    <div><span>微表情</span><p>{shot.facialExpression || "未填写"}</p></div>
                    <div><span>构图</span><p>{shot.composition || "未填写"}</p></div>
                    <div><span>光线环境</span><p>{shot.lighting || shot.environment || "未填写"}</p></div>
                    <div><span>人物绑定</span><p>{shot.characterBindings.map((item) => item.name).join("、") || "无"}</p></div>
                    <div><span>道具 / 场景</span><p>{shot.propBindings.map((item) => item.name).join("、") || "无道具"} · {shot.sceneBindings.locationId}</p></div>
                </div>
                <div className="stage3-shot-dialogue">
                    {shot.dialogue.length ? shot.dialogue.map((line, index) => <div key={`${line.speaker}-${index}`}><strong>{line.speaker}</strong><p>{line.text}</p><small>{line.emotion} · {line.delivery}</small></div>) : <span>无对白</span>}
                </div>
                <div className="stage3-shot-audio-block">
                    <div><span>环境声</span><p>{shot.soundEffects || "未填写"}</p></div>
                    <div><span>音乐意图</span><p>{shot.backgroundMusic || "未填写"}</p></div>
                    <div><span>旁白</span><p>{shot.voiceOver || "无"}</p></div>
                </div>
                {group ? <div className="stage3-group-shared stage3-detail-group"><div><span>组共享轴线</span><p>{group.cameraAxis || "未填写"}</p></div><div><span>组共享布局</span><p>{group.sharedLayout || "未填写"}</p></div><div><span>道具状态</span><p>{group.propStates || "未填写"}</p></div></div> : null}
                <div className="stage3-prompt-block">
                    <label>imagePrompt<pre>{shot.imagePrompt || "未填写"}</pre></label>
                    <label>videoPrompt<pre>{shot.videoPrompt || "未填写"}</pre></label>
                </div>
                <div className="stage3-shot-checks"><span>本镜检查</span><CheckList checks={checks} empty="本镜没有未处理检查" /></div>
                <div className="stage3-readonly-note">keyframeRefs {shot.keyframeRefs.length} 个 · 本阶段不生成关键帧或视频。</div>
            </div>
        </div>
    );
}
