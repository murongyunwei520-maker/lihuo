import { useEffect, useMemo, useState } from "react";
import { App, Button, Drawer, Dropdown, Input, InputNumber, Modal, Tag, Tooltip } from "antd";
import { ChevronDown, Clock3, Edit3, History, Lock, LockOpen, MessageSquareText, Pencil, RefreshCw, ScrollText, Sparkles, WandSparkles } from "lucide-react";

import { adaptationReviewProgress } from "@/lib/studio/adaptation-workspace";
import { emptyCounts, handoffIssuesForEpisode, productionAdmission, scriptDurationLevel } from "@/lib/studio/production-engine";
import { enqueueProductionJobs, restoreScriptVersion, runEpisodeScript, saveScriptMeta, saveScriptSceneEdit, setScriptLocked } from "@/lib/studio/production-actions";
import { hasManualScriptEdits } from "@/lib/studio/production-protection";
import type { NovelTextModelRuntime } from "@/lib/studio/novel-model";
import type { StudioAdaptationHandoff, StudioEpisodePlan } from "@/types/studio-adaptation";
import type { StudioEpisode, StudioProject } from "@/types/studio";
import type { StudioProductionAssetIndex, StudioProductionCheck, StudioProductionJob, StudioProductionReviewStatus, StudioScriptDocument, StudioScriptScene, StudioScriptVersion } from "@/types/studio-production";

import { CheckList, DurationMeter, ReviewTag } from "./shared";

type ScriptTabProps = {
    project: StudioProject;
    episode: StudioEpisode;
    handoff: StudioAdaptationHandoff;
    runtime: NovelTextModelRuntime | null;
    onOpenEpisode: (episodeId: string) => void;
    onOpenSettings: () => void;
};

function countChecks(checks: StudioProductionCheck[]) {
    return emptyCounts(checks);
}

function planFor(handoff: StudioAdaptationHandoff, episodeNumber: number): StudioEpisodePlan | undefined {
    return handoff.episodePlans.find((plan) => plan.episodeNumber === episodeNumber);
}

function productionChecks(episode: StudioEpisode) {
    return episode.production?.checks ?? [];
}

export function ScriptTab({ project, episode, handoff, runtime, onOpenEpisode, onOpenSettings }: ScriptTabProps) {
    const { message } = App.useApp();
    const script = episode.production?.script;
    const plan = planFor(handoff, episode.no);
    const admission = plan ? productionAdmission(handoff, episode.no) : undefined;
    const issues = handoffIssuesForEpisode(handoff, episode.no);
    const checks = productionChecks(episode);
    const counts = countChecks(checks);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<StudioScriptScene | null>(null);
    const [metaEditing, setMetaEditing] = useState(false);
    const [sceneDraft, setSceneDraft] = useState<StudioScriptScene | null>(null);
    const [metaDraft, setMetaDraft] = useState({ title: "", logline: "", synopsis: "" });
    const [pendingOverwrite, setPendingOverwrite] = useState(false);
    const [pendingSceneRegen, setPendingSceneRegen] = useState<StudioScriptScene | null>(null);
    const [pendingDialogueRegen, setPendingDialogueRegen] = useState<StudioScriptScene | null>(null);

    useEffect(() => {
        setEditing(null);
        setSceneDraft(null);
        setMetaEditing(false);
        setPendingOverwrite(false);
        setPendingSceneRegen(null);
        setPendingDialogueRegen(null);
    }, [episode.id]);

    const activeJob = (project.production?.jobs ?? []).find((job) => job.targetEpisodeId === episode.id && ["pending", "queued", "submitting", "running", "cancelling"].includes(job.status));
    const episodeRows = handoff.episodePlans
        .map((item) => ({ plan: item, episode: project.episodes.find((entry) => entry.no === item.episodeNumber) }))
        .filter((item): item is { plan: StudioEpisodePlan; episode: StudioEpisode } => Boolean(item.episode));
    const manualEdited = script ? hasManualScriptEdits(script) : false;
    const affectedShots = episode.production?.storyboard?.shots ?? [];
    const recentSkips = (project.production?.skips ?? []).filter((skip) => skip.kind === "script").slice(-5).reverse();

    const runGenerate = async (allowOverwriteExisting: boolean) => {
        setBusy(true);
        const result = await runEpisodeScript(project.id, episode.id, allowOverwriteExisting ? { allowOverwriteExisting: true } : {});
        setBusy(false);
        setPendingOverwrite(false);
        if (result.ok) {
            message.success(`第 ${episode.no} 集剧本草稿已生成；旧版已${result.backupSnapshotId ? "备份" : "未生成"}，未自动审核或锁定`);
        } else {
            if (result.requiresConfirmation) setPendingOverwrite(true);
            else message.error(result.error ?? "生成失败");
        }
    };

    const startGenerate = () => {
        if (script?.status === "locked") {
            message.warning("本集剧本已锁定，请先在操作菜单中解锁");
            return;
        }
        if (script) {
            setPendingOverwrite(true);
            return;
        }
        void runGenerate(false);
    };

    const queueAll = () => {
        const result = enqueueProductionJobs(project.id, "script", episodeRows.map((row) => row.episode.id));
        if (result.skipped?.length) {
            const detail = result.skipped.map((skip) => `第 ${skip.episodeNumber} 集：${skip.detail}`).join("；");
            message.warning(`全剧队列默认跳过已有剧本。跳过 ${result.skipped.length} 集：${detail}`);
        } else if (result.ok) message.success("已加入有序队列；不会自动接受 2B 的任何待处理问题");
        else message.error(result.error ?? "入队失败");
    };

    const openEditor = (scene: StudioScriptScene) => {
        setEditing(scene);
        setSceneDraft(JSON.parse(JSON.stringify(scene)) as StudioScriptScene);
    };

    const saveScene = () => {
        if (!sceneDraft) return;
        const result = saveScriptSceneEdit(project.id, episode.id, sceneDraft);
        if (result.ok) {
            message.success(result.unchanged ? "本场内容没有变化，未递增剧本版本" : "本场修改已保存；旧版已备份，相关分镜已标记待检查");
            setEditing(null);
        } else message.error(result.error ?? "保存失败");
    };

    const openMetaEditor = () => {
        if (!script) return;
        setMetaDraft({ title: script.title, logline: script.logline, synopsis: script.synopsis });
        setMetaEditing(true);
    };

    const saveMeta = () => {
        const result = saveScriptMeta(project.id, episode.id, metaDraft);
        if (result.ok) {
            message.success(result.unchanged ? "剧本信息没有变化，未递增剧本版本" : "剧本信息已保存；旧版已备份");
            setMetaEditing(false);
        } else message.error(result.error ?? "保存失败");
    };

    const runSceneRegenerate = async (scene: StudioScriptScene, allowOverwriteManual: boolean) => {
        setBusy(true);
        const result = await runEpisodeScript(project.id, episode.id, {
            sceneId: scene.sceneId,
            instruction: "提升本场人物潜台词、可拍动作和转场衔接；不得改变剧情事实。",
            allowOverwriteManual,
        });
        setBusy(false);
        setPendingSceneRegen(null);
        if (result.ok) message.success(`「${scene.sceneTitle}」已局部重生成；其他场景未被改写`);
        else if (result.requiresConfirmation) setPendingSceneRegen(scene);
        else message.error(result.error ?? "局部重生成失败");
    };

    const regenerateScene = (scene: StudioScriptScene) => {
        if (script?.manualEditedSceneIds?.includes(scene.sceneId)) {
            setPendingSceneRegen(scene);
            return;
        }
        void runSceneRegenerate(scene, false);
    };

    const regenerateDialogue = async (scene: StudioScriptScene, allowOverwriteManual: boolean) => {
        setBusy(true);
        const result = await runEpisodeScript(project.id, episode.id, {
            sceneId: scene.sceneId,
            module: "dialogue",
            instruction: "只提升对白潜台词、节奏和人物语言差异；不改变剧情事实与其他场景。",
            allowOverwriteManual,
        });
        setBusy(false);
        setPendingDialogueRegen(null);
        if (result.ok) message.success(`「${scene.sceneTitle}」对白已局部重生成；场景动作与其他场景保留`);
        else if (result.requiresConfirmation) setPendingDialogueRegen(scene);
        else message.error(result.error ?? "对白重生成失败");
    };

    const startDialogueRegenerate = (scene: StudioScriptScene) => {
        if (script?.status === "locked") {
            message.warning("本集剧本已锁定，请先解锁");
            return;
        }
        void regenerateDialogue(scene, false);
    };

    return (
        <div className="stage3-script-layout">
            <aside className="stage3-episode-rail">
                <header>
                    <div>
                        <span className="stage3-kicker">SCRIPT / EPISODES</span>
                        <strong>分集剧本</strong>
                    </div>
                    <Tag bordered={false}>{episodeRows.length} 集</Tag>
                </header>
                <div className="stage3-episode-list">
                    {episodeRows.map(({ plan: rowPlan, episode: rowEpisode }) => {
                        const rowScript = rowEpisode.production?.script;
                        const rowCounts = countChecks(productionChecks(rowEpisode));
                        return (
                            <button
                                key={rowEpisode.id}
                                type="button"
                                className={`stage3-episode-row${rowEpisode.id === episode.id ? " is-active" : ""}`}
                                onClick={() => onOpenEpisode(rowEpisode.id)}
                            >
                                <span className="stage3-episode-row__no">{String(rowEpisode.no).padStart(2, "0")}</span>
                                <div>
                                    <strong>{rowEpisode.title}</strong>
                                    <small>{rowScript ? `${rowScript.scenes.length} 场 · v${rowScript.scriptVersion}` : "尚未生成剧本"}</small>
                                    <span className="stage3-episode-row__meta">
                                        {rowScript?.status === "locked" ? <em><Lock className="size-3" /> 已锁定</em> : null}
                                        {rowScript && hasManualScriptEdits(rowScript) ? <em className="is-warning">人工修改</em> : null}
                                        {rowCounts.error ? <em className="is-error">{rowCounts.error} 错误</em> : null}
                                        {rowCounts.warning ? <em className="is-warning">{rowCounts.warning} 待确认</em> : null}
                                        {!rowScript && plan ? <em>2B 待处理 {handoffIssuesForEpisode(handoff, rowPlan.episodeNumber).length}</em> : null}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="stage3-rail-footer">
                    <span>审核进度</span>
                    <strong>{adaptationReviewProgress(project.adaptation!).approved} / {adaptationReviewProgress(project.adaptation!).total}</strong>
                </div>
            </aside>

            <section className="stage3-document">
                <header className="stage3-document__top">
                    <div>
                        <span className="stage3-kicker">EPISODE {String(episode.no).padStart(2, "0")} · TELEPLAY</span>
                        <div className="stage3-title-line">
                            <h2>{script?.title || episode.title}</h2>
                            {script ? <ReviewTag status={script.status} /> : <Tag bordered={false}>未生成</Tag>}
                            {script ? <Tag bordered={false}>v{script.scriptVersion}</Tag> : null}
                            {manualEdited ? <Tag bordered={false} color="warning">人工修改已保护</Tag> : null}
                            {script?.status === "locked" ? <Tag bordered={false} color="warning">锁定保护</Tag> : null}
                        </div>
                        <p>{script?.logline || plan?.episodeLogline || "等待生成正式分集剧本草稿"}</p>
                    </div>
                    <div className="stage3-document__actions">
                        {script ? (
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        { key: "lock", label: script.status === "locked" ? "解锁剧本" : "锁定剧本", icon: script.status === "locked" ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />, onClick: () => setScriptLocked(project.id, episode.id, script.status !== "locked") },
                                        { key: "meta", label: "编辑标题与概要", icon: <Edit3 className="size-3.5" />, onClick: openMetaEditor },
                                    ],
                                }}
                            >
                                <Button size="small" icon={<ChevronDown className="size-3.5" />}>操作</Button>
                            </Dropdown>
                        ) : null}
                        <Button
                            size="small"
                            type="primary"
                            icon={<Sparkles className="size-3.5" />}
                            loading={busy || Boolean(activeJob)}
                            onClick={() => void startGenerate()}
                            disabled={!admission?.draftAllowed || script?.status === "locked"}
                        >
                            {script ? "重新生成本集" : "生成本集剧本"}
                        </Button>
                        <Button size="small" icon={<WandSparkles className="size-3.5" />} onClick={queueAll} disabled={!episodeRows.length}>
                            全剧排队
                        </Button>
                    </div>
                </header>

                <div className="stage3-document__subbar">
                    <div className="stage3-document__meta">
                        <span>{script ? `${script.scenes.length} 场` : "0 场"} · 目标 {episode.targetSeconds}s</span>
                        {script ? <DurationMeter estimate={script.durationEstimate} target={script.durationTarget} /> : null}
                        {script ? <span className="stage3-source-line">来源规划 {script.sourceEpisodePlanId} · 蓝图 v{script.sourceBlueprintVersion}</span> : null}
                    </div>
                    <span className="stage3-model-inline">{runtime?.label ?? "读取项目文本模型…"}</span>
                </div>

                {!script ? (
                    <div className="stage3-document-empty">
                        <ScrollText className="size-8" />
                        <strong>当前集还没有正式剧本草稿</strong>
                        <p>Stage 3 只消费 2B handoff，不会重新读原著猜一套规划。生成结果默认是草稿，必须由你检查、修改后才能锁定。</p>
                        {admission?.blocking.length ? <div className="stage3-admission is-error">{admission.blocking.map((item) => <div key={item}>{item}</div>)}</div> : null}
                        <div className="stage3-empty-actions">
                            <Button type="primary" icon={<Sparkles className="size-3.5" />} onClick={() => void startGenerate()} loading={busy || Boolean(activeJob)} disabled={!admission?.draftAllowed}>生成本集剧本</Button>
                            <Button icon={<WandSparkles className="size-3.5" />} onClick={queueAll}>全剧排队生成</Button>
                        </div>
                    </div>
                ) : (
                    <div className="stage3-script-body">
                        {script.scenes.map((scene) => (
                            <article className="stage3-scene-card" key={scene.sceneId}>
                                <header>
                                    <span className="stage3-scene-no">{String(scene.sceneNumber).padStart(2, "0")}</span>
                                    <div>
                                        <h3>{scene.sceneTitle}</h3>
                                        <small>{scene.locationVariantId || scene.locationId} · {scene.timeOfDay || "时间未定"} · {scene.environment || "环境未填"}</small>
                                    </div>
                                    <div className="stage3-scene-actions">
                                        <Tooltip title="只重生成对白"><Button size="small" type="text" icon={<MessageSquareText className="size-3.5" />} onClick={() => startDialogueRegenerate(scene)} disabled={busy || script.status === "locked"} /></Tooltip>
                                        <Tooltip title="局部重生成本场"><Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} onClick={() => regenerateScene(scene)} disabled={busy || script.status === "locked"} /></Tooltip>
                                        <Tooltip title="编辑本场"><Button size="small" type="text" icon={<Pencil className="size-3.5" />} onClick={() => openEditor(scene)} disabled={script.status === "locked"} /></Tooltip>
                                    </div>
                                </header>
                                <div className="stage3-scene-purpose"><span>戏剧目的</span>{scene.scenePurpose || "未填写"}</div>
                                <div className="stage3-scene-cols">
                                    <div><span>冲突</span><p>{scene.conflict || "未填写"}</p></div>
                                    <div><span>动作</span><p>{scene.action || "未填写"}</p></div>
                                </div>
                                <div className="stage3-dialogue-list">
                                    {scene.dialogueBlocks.map((block) => (
                                        <div className="stage3-dialogue" key={block.dialogueId}>
                                            <div className="stage3-dialogue__speaker">{block.speaker}</div>
                                            <div className="stage3-dialogue__body">
                                                <p>{block.text}</p>
                                                <small>{[block.emotion, block.delivery, block.subtext].filter(Boolean).join(" · ")}</small>
                                            </div>
                                        </div>
                                    ))}
                                    {!scene.dialogueBlocks.length ? <div className="stage3-dialogue-empty">本场没有对白，依赖动作与环境叙事。</div> : null}
                                </div>
                                <footer>
                                    <span><b>进入</b> {scene.transitionIn || "未填写"}</span>
                                    <span><b>转出</b> {scene.transitionOut || "未填写"}</span>
                                </footer>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            <aside className="stage3-inspector">
                <section>
                    <header><span className="stage3-kicker">ADMISSION</span><strong>准入与来源</strong></header>
                    <div className="stage3-admission-grid">
                        <div><span>草稿</span><b className={admission?.draftAllowed ? "is-ok" : "is-error"}>{admission?.draftAllowed ? "允许" : "阻断"}</b></div>
                        <div><span>正式生产</span><b className={admission?.formalAllowed ? "is-ok" : "is-warn"}>{admission?.formalAllowed ? "允许" : "待处理"}</b></div>
                        <div><span>2B 待处理</span><b>{issues.length}</b></div>
                        <div><span>锁定集</span><b>{handoff.lockedEpisodeNumbers.includes(episode.no) ? "是" : "否"}</b></div>
                    </div>
                    <div className="stage3-source-block">
                        <span>handoff</span>
                        <code>{handoff.snapshotId}</code>
                        <small>蓝图 v{handoff.blueprintVersion} · 包 v{handoff.packageVersion} · 分析 v{handoff.analysisVersion}</small>
                    </div>
                </section>

                <section>
                    <header><span className="stage3-kicker">QUEUE PROTECTION</span><strong>队列跳过记录</strong><Tag bordered={false}>{recentSkips.length}</Tag></header>
                    {recentSkips.length ? (
                        <div className="stage3-skip-list">
                            {recentSkips.map((skip) => (
                                <div key={skip.id} className="stage3-skip-row">
                                    <div><strong>第 {skip.episodeNumber} 集 · {skip.episodeTitle}</strong><span>{skip.detail}</span></div>
                                    <small>{new Date(skip.createdAt).toLocaleTimeString("zh-CN")}</small>
                                </div>
                            ))}
                        </div>
                    ) : <div className="stage3-check-empty">全剧队列默认 skip_existing：已有剧本、人工修改或锁定集不会入队。</div>}
                    <p className="stage3-note">跳过记录保存在项目队列审计中，不只是界面提示；直接重新生成本集必须单独确认。</p>
                </section>

                <section>
                    <header><span className="stage3-kicker">DEPENDENCIES</span><strong>2B 未处理事项</strong><Tag bordered={false}>{issues.length}</Tag></header>
                    {issues.length ? (
                        <div className="stage3-handoff-issues">
                            {issues.map((issue) => (
                                <article key={issue.id} className={`is-${issue.level}`}>
                                    <header><span>{issue.level === "error" ? "错误" : issue.level === "warning" ? "待确认" : "建议"}</span><em>{issue.category}</em></header>
                                    <p>{issue.message}</p>
                                    {issue.suggestion ? <small>{issue.suggestion}</small> : null}
                                </article>
                            ))}
                        </div>
                    ) : <div className="stage3-check-empty">当前集没有未处理的 2B 事项</div>}
                    <p className="stage3-note">这里只读展示 2B 账本。即使剧本补了转场，2B warning 也不会被自动标记为已解决。</p>
                </section>

                <section>
                    <header><span className="stage3-kicker">SCRIPT CHECKS</span><strong>剧本检查</strong><Tag bordered={false}>{counts.error}/{counts.warning}/{counts.suggestion}</Tag></header>
                    <CheckList checks={checks} empty="剧本结构检查通过；仍要人工看对白、动机和时长。" />
                </section>

                <section>
                    <header><span className="stage3-kicker">VERSIONS</span><strong>历史版本</strong><Tag bordered={false}>{episode.production?.scriptVersions.length ?? 0}</Tag></header>
                    {(episode.production?.scriptVersions.length ?? 0) === 0 ? (
                        <div className="stage3-check-empty">覆盖生成或手工修改后，旧版会在这里保留。</div>
                    ) : (
                        <div className="stage3-version-list">
                            {episode.production!.scriptVersions.map((version) => (
                                <div key={version.id} className="stage3-version-row">
                                    <div><strong>v{version.version}</strong><span>{version.reason}</span><small className="stage3-snapshot-id">{version.snapshotId}</small></div>
                                    <div><small>{new Date(version.createdAt).toLocaleString("zh-CN")}</small><Button size="small" type="link" onClick={() => { const result = restoreScriptVersion(project.id, episode.id, version.id); if (result.ok) message.success(`已恢复为新的正式剧本 v${result.newVersion}；恢复前版本已备份`); else message.error(result.error ?? "恢复失败"); }}>恢复</Button></div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {activeJob ? (
                    <section className="stage3-active-job">
                        <header><span className="stage3-kicker">QUEUE</span><strong>队列正在处理</strong></header>
                        <div className="stage3-job-row">
                            <span>{activeJob.currentLabel}</span>
                            <b>{activeJob.progress}%</b>
                        </div>
                        <div className="stage3-progress"><span style={{ width: `${activeJob.progress}%` }} /></div>
                        <small>{activeJob.model.label} · {activeJob.modelParams.temperature !== undefined ? `temperature ${activeJob.modelParams.temperature}` : "项目默认参数"}</small>
                        <div className="stage3-inline-actions">
                            <Button size="small" onClick={() => onOpenSettings()}>模型设置</Button>
                        </div>
                    </section>
                ) : null}
            </aside>

            <Drawer
                open={Boolean(editing && sceneDraft)}
                onClose={() => setEditing(null)}
                title={editing ? `编辑场景 ${editing.sceneNumber} · ${editing.sceneTitle}` : "编辑场景"}
                width={720}
                destroyOnHidden
                extra={<Button type="primary" onClick={saveScene}>保存本场</Button>}
            >
                {sceneDraft ? (
                    <div className="stage3-scene-editor">
                        <label>场景标题<Input value={sceneDraft.sceneTitle} onChange={(event) => setSceneDraft({ ...sceneDraft, sceneTitle: event.target.value })} /></label>
                        <div className="stage3-form-row">
                            <label>时间<Input value={sceneDraft.timeOfDay} onChange={(event) => setSceneDraft({ ...sceneDraft, timeOfDay: event.target.value })} /></label>
                            <label>地点变体<Input value={sceneDraft.locationVariantId} onChange={(event) => setSceneDraft({ ...sceneDraft, locationVariantId: event.target.value })} /></label>
                        </div>
                        <label>环境<Input.TextArea rows={2} value={sceneDraft.environment} onChange={(event) => setSceneDraft({ ...sceneDraft, environment: event.target.value })} /></label>
                        <div className="stage3-form-row">
                            <label>戏剧目的<Input.TextArea rows={2} value={sceneDraft.scenePurpose} onChange={(event) => setSceneDraft({ ...sceneDraft, scenePurpose: event.target.value })} /></label>
                            <label>冲突<Input.TextArea rows={2} value={sceneDraft.conflict} onChange={(event) => setSceneDraft({ ...sceneDraft, conflict: event.target.value })} /></label>
                        </div>
                        <label>动作<Input.TextArea rows={4} value={sceneDraft.action} onChange={(event) => setSceneDraft({ ...sceneDraft, action: event.target.value })} /></label>
                        <div className="stage3-form-row">
                            <label>进入<Input.TextArea rows={2} value={sceneDraft.transitionIn} onChange={(event) => setSceneDraft({ ...sceneDraft, transitionIn: event.target.value })} /></label>
                            <label>转出<Input.TextArea rows={2} value={sceneDraft.transitionOut} onChange={(event) => setSceneDraft({ ...sceneDraft, transitionOut: event.target.value })} /></label>
                        </div>
                        <label>连续性说明<Input.TextArea rows={2} value={sceneDraft.continuityNotes} onChange={(event) => setSceneDraft({ ...sceneDraft, continuityNotes: event.target.value })} /></label>
                        <div className="stage3-dialogue-editor-head"><strong>对白块</strong><Button size="small" onClick={() => setSceneDraft({ ...sceneDraft, dialogueBlocks: [...sceneDraft.dialogueBlocks, { dialogueId: `dlg-edit-${Date.now()}`, characterId: "", speaker: "", text: "", delivery: "", emotion: "", subtext: "", linkedAction: "", timing: "" }] })}>加一条</Button></div>
                        {sceneDraft.dialogueBlocks.map((block, index) => (
                            <div className="stage3-dialogue-editor" key={block.dialogueId}>
                                <div className="stage3-form-row">
                                    <label>说话人<Input value={block.speaker} onChange={(event) => { const next = { ...block, speaker: event.target.value }; setSceneDraft({ ...sceneDraft, dialogueBlocks: sceneDraft.dialogueBlocks.map((item, itemIndex) => (itemIndex === index ? next : item)) }); }} /></label>
                                    <label>情绪<Input value={block.emotion} onChange={(event) => { const next = { ...block, emotion: event.target.value }; setSceneDraft({ ...sceneDraft, dialogueBlocks: sceneDraft.dialogueBlocks.map((item, itemIndex) => (itemIndex === index ? next : item)) }); }} /></label>
                                </div>
                                <label>台词<Input.TextArea rows={2} value={block.text} onChange={(event) => { const next = { ...block, text: event.target.value }; setSceneDraft({ ...sceneDraft, dialogueBlocks: sceneDraft.dialogueBlocks.map((item, itemIndex) => (itemIndex === index ? next : item)) }); }} /></label>
                                <div className="stage3-form-row">
                                    <label>表演<Input value={block.delivery} onChange={(event) => { const next = { ...block, delivery: event.target.value }; setSceneDraft({ ...sceneDraft, dialogueBlocks: sceneDraft.dialogueBlocks.map((item, itemIndex) => (itemIndex === index ? next : item)) }); }} /></label>
                                    <label>伴随动作<Input value={block.linkedAction} onChange={(event) => { const next = { ...block, linkedAction: event.target.value }; setSceneDraft({ ...sceneDraft, dialogueBlocks: sceneDraft.dialogueBlocks.map((item, itemIndex) => (itemIndex === index ? next : item)) }); }} /></label>
                                </div>
                                <label>潜台词<Input value={block.subtext} onChange={(event) => { const next = { ...block, subtext: event.target.value }; setSceneDraft({ ...sceneDraft, dialogueBlocks: sceneDraft.dialogueBlocks.map((item, itemIndex) => (itemIndex === index ? next : item)) }); }} /></label>
                                <Button size="small" danger type="link" onClick={() => setSceneDraft({ ...sceneDraft, dialogueBlocks: sceneDraft.dialogueBlocks.filter((_, itemIndex) => itemIndex !== index) })}>删除这条对白</Button>
                            </div>
                        ))}
                    </div>
                ) : null}
            </Drawer>

            <Drawer open={metaEditing} onClose={() => setMetaEditing(false)} title="编辑剧本信息" width={520} extra={<Button type="primary" onClick={saveMeta}>保存</Button>}>
                <div className="stage3-scene-editor">
                    <label>标题<Input value={metaDraft.title} onChange={(event) => setMetaDraft({ ...metaDraft, title: event.target.value })} /></label>
                    <label>一句话故事<Input.TextArea rows={2} value={metaDraft.logline} onChange={(event) => setMetaDraft({ ...metaDraft, logline: event.target.value })} /></label>
                    <label>本集概要<Input.TextArea rows={6} value={metaDraft.synopsis} onChange={(event) => setMetaDraft({ ...metaDraft, synopsis: event.target.value })} /></label>
                    <div className="stage3-readonly-note"><Clock3 className="size-3.5" /> 修改会生成新的 scriptVersion，旧版本保留。</div>
                </div>
            </Drawer>

            <Modal
                open={pendingOverwrite && Boolean(script)}
                title={`覆盖第 ${episode.no} 集已有剧本？`}
                okText="确认覆盖并先备份"
                cancelText="取消覆盖"
                confirmLoading={busy}
                onOk={() => void runGenerate(true)}
                onCancel={() => setPendingOverwrite(false)}
                destroyOnHidden
            >
                <div className="stage3-overwrite-modal">
                    <div><span>目标集数</span><b>第 {episode.no} 集 · {episode.title}</b></div>
                    <div><span>当前剧本版本</span><b>v{script?.scriptVersion ?? 0} · {script?.scenes.length ?? 0} 场</b></div>
                    <div><span>人工修改</span><b className={manualEdited ? "is-warn" : "is-ok"}>{manualEdited ? `是（${script?.manualEditedSceneIds?.length ?? 0} 场）` : "否"}</b></div>
                    <div><span>锁定状态</span><b className={script?.status === "locked" ? "is-warn" : "is-ok"}>{script?.status === "locked" ? "已锁定（禁止覆盖）" : "未锁定"}</b></div>
                    <div><span>覆盖范围</span><b>整集剧本、场景与对白；旧版自动备份</b></div>
                    <div><span>关联分镜</span><b>{affectedShots.length} 个镜头将被标记待检查，不会自动删除</b></div>
                    <p>全剧队列默认不会覆盖已有剧本。只有这次明确确认才会调用模型；备份快照持久化失败时不会覆盖。</p>
                </div>
            </Modal>

            <Modal
                open={Boolean(pendingSceneRegen)}
                title={pendingSceneRegen ? `覆盖「${pendingSceneRegen.sceneTitle}」的人工修改？` : "覆盖人工修改？"}
                okText="确认覆盖本场"
                cancelText="取消"
                confirmLoading={busy}
                onOk={() => pendingSceneRegen ? void runSceneRegenerate(pendingSceneRegen, true) : setPendingSceneRegen(null)}
                onCancel={() => setPendingSceneRegen(null)}
                destroyOnHidden
            >
                <div className="stage3-overwrite-modal">
                    <div><span>目标场景</span><b>{pendingSceneRegen?.sceneNumber} · {pendingSceneRegen?.sceneTitle}</b></div>
                    <div><span>保护原因</span><b>本场已被人工编辑</b></div>
                    <div><span>覆盖范围</span><b>只替换本场，其他场景与对白保留</b></div>
                    <div><span>旧版处理</span><b>先保存剧本快照，再写入新结果</b></div>
                    <p>如果只想改台词，请使用「只重生成对白」，不要整场替换。</p>
                </div>
            </Modal>
            <Modal
                open={Boolean(pendingDialogueRegen)}
                title={pendingDialogueRegen ? `覆盖「${pendingDialogueRegen.sceneTitle}」的人工对白？` : "覆盖人工对白？"}
                okText="确认只覆盖本场对白"
                cancelText="取消"
                confirmLoading={busy}
                onOk={() => pendingDialogueRegen ? void regenerateDialogue(pendingDialogueRegen, true) : setPendingDialogueRegen(null)}
                onCancel={() => setPendingDialogueRegen(null)}
                destroyOnHidden
            >
                <div className="stage3-overwrite-modal">
                    <div><span>目标场景</span><b>{pendingDialogueRegen?.sceneNumber} · {pendingDialogueRegen?.sceneTitle}</b></div>
                    <div><span>保护原因</span><b>本场对白已被人工编辑</b></div>
                    <div><span>覆盖范围</span><b>只替换本场对白；动作、环境、人物绑定与其他场景保留</b></div>
                    <div><span>旧版处理</span><b>先保存剧本快照，再写入新结果</b></div>
                    <p>取消时不会调用模型，也不会修改正式剧本。确认后若备份或输出校验失败，旧对白保持不变。</p>
                </div>
            </Modal>
        </div>
    );
}
