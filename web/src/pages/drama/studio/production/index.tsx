import { useEffect, useMemo, useState } from "react";
import { App, Button, Modal, Tag, Tooltip } from "antd";
import { Clapperboard, FileText, Layers3, Pause, Play, RotateCcw, Square, SlidersHorizontal, TriangleAlert } from "lucide-react";

import { adaptationHandoff, adaptationReviewProgress } from "@/lib/studio/adaptation-workspace";
import { novelTextModelRuntime, type NovelTextModelRuntime } from "@/lib/studio/novel-model";
import { confirmProductionJobResult, pauseProductionQueue, resumeProductionQueue, retryProductionJobs, stopProductionQueue, ensureStage3Episodes } from "@/lib/studio/production-actions";
import { selectReviewJobs } from "@/lib/studio/production-workspace";
import type { StudioAdaptationHandoff, StudioEpisodePlan } from "@/types/studio-adaptation";
import type { StudioEpisode, StudioProject } from "@/types/studio";
import type { StudioProductionJob } from "@/types/studio-production";

import { EmptyStage3, JobStatusTag, ModelBadge, ReviewTag } from "./shared";
import { ScriptTab } from "./script-tab";
import { StoryboardTab } from "./storyboard-tab";

type Stage3WorkspaceProps = {
    project: StudioProject;
    episode?: StudioEpisode;
    view: Stage3View;
    onViewChange: (view: Stage3View) => void;
    onOpenEpisode: (episodeId: string) => void;
    onOpenSettings: () => void;
    onOpenPreviousStep: () => void;
};

type Stage3View = "script" | "storyboard";

function trackedJobs(jobs: StudioProductionJob[]) {
    return jobs.filter((job) => !["succeeded", "cancelled"].includes(job.status) || job.needsReview === true);
}

export function Stage3Workspace({ project, episode, view, onViewChange, onOpenEpisode, onOpenSettings, onOpenPreviousStep }: Stage3WorkspaceProps) {
    const { message } = App.useApp();
    const [runtime, setRuntime] = useState<NovelTextModelRuntime | null>(null);
    const [runtimeError, setRuntimeError] = useState("");
    const [reviewOpen, setReviewOpen] = useState(false);
    const handoff = useMemo(() => (project.adaptation ? adaptationHandoff(project.adaptation, project.id, project.novelAnalysis?.version ?? 0) : undefined), [project.adaptation, project.id, project.novelAnalysis?.version]);
    const modelProfileKey = useMemo(() => JSON.stringify(project.modelProfiles), [project.modelProfiles]);

    useEffect(() => {
        let alive = true;
        setRuntime(null);
        setRuntimeError("");
        void novelTextModelRuntime(project)
            .then((value) => { if (alive) setRuntime(value); })
            .catch((error: unknown) => { if (alive) setRuntimeError(error instanceof Error ? error.message : String(error)); });
        return () => { alive = false; };
    }, [project.id, project.settings.textModel, modelProfileKey]);

    if (!project.adaptation) {
        return <EmptyStage3 title="还没有短剧改编数据" description="Stage 3 必须消费 Stage 2B handoff，不会重新读原著自行猜一套规划。先完成全剧蓝图与分集规划。" action={<Button onClick={onOpenPreviousStep}>回到第二阶段</Button>} />;
    }

    if (!handoff) {
        return <EmptyStage3 title="Stage 2B handoff 不完整" description="缺少全剧蓝图或分集规划。Stage 3 不会绕过 2B 自行规划，也不会生成正式剧本。" action={<Button onClick={onOpenPreviousStep}>回到 2B 检查</Button>} />;
    }

    const aligned = handoff.episodePlans
        .map((plan) => ({ plan, episode: project.episodes.find((item) => item.no === plan.episodeNumber) }))
        .filter((item): item is { plan: StudioEpisodePlan; episode: StudioEpisode } => Boolean(item.episode));

    const materializeEpisodes = () => {
        const result = ensureStage3Episodes(project.id);
        if (result.ok) message.success(`已按 2B 分集规划建立 ${result.created ?? 0} 个 StudioEpisode 承载壳；2B 数据未被修改`);
        else message.error(result.error ?? "建立分集承载失败");
    };

    const active = aligned.find((item) => item.episode.id === episode?.id)?.episode ?? aligned[0]?.episode;
    if (!active) {
        return (
            <EmptyStage3
                title="2B 分集规划还没有正式 StudioEpisode 承载"
                description={`当前 handoff 已有 ${handoff.episodePlans.length} 集规划，但项目分集为 ${project.episodes.length}。Stage 3 不创建第二套项目根，只按规划编号补建 StudioEpisode 壳，再承载正式剧本和分镜。`}
                action={<div className="stage3-empty-actions"><Button type="primary" onClick={materializeEpisodes}>按 2B 规划建立 {handoff.episodePlans.length} 个分集</Button><Button onClick={onOpenPreviousStep}>回 2B 核对</Button></div>}
            />
        );
    }

    const review = adaptationReviewProgress(project.adaptation);
    const allJobs = project.production?.jobs ?? [];
    const jobs = trackedJobs(allJobs);
    const running = jobs.find((job) => job.status === "running" || job.status === "submitting");
    const failed = allJobs.filter((job) => ["failed", "interrupted", "unknown", "cancelling"].includes(job.status));
    const reviewJobs = selectReviewJobs(allJobs);
    const scripted = aligned.filter((item) => item.episode.production?.script).length;
    const storyboarded = aligned.filter((item) => item.episode.production?.storyboard).length;

    const continueQueue = () => {
        const result = resumeProductionQueue(project.id);
        if (result.ok) message.success(`已恢复 ${result.requeued ?? 0} 个排队任务${result.held ? `；${result.held} 个结果未知任务需要核对` : ""}`);
        else message.warning(result.error ?? "没有可继续的任务");
        if (result.held) setReviewOpen(true);
    };

    const retryQueue = () => {
        const result = retryProductionJobs(project.id);
        if (result.ok) message.success(`已重新排队 ${result.requeued ?? 0} 个确认可重试的任务`);
        else message.warning(result.error ?? "没有可重试的任务");
        if (result.held) setReviewOpen(true);
    };

    const stopQueue = () => {
        const hadRunning = Boolean(running);
        stopProductionQueue(project.id);
        message.warning(hadRunning ? "已停止；当前请求结果未知，已转入核对，不会自动重发" : "已取消排队任务；未提交的任务不会计费");
        if (hadRunning) setReviewOpen(true);
    };

    const reviewAction = (jobId: string, decision: "adopt-existing" | "retry" | "mark-failed") => {
        const result = confirmProductionJobResult(project.id, jobId, decision);
        if (!result.ok) {
            message.error(result.error ?? "核对失败");
            return;
        }
        if (decision === "retry") message.success("已按人工确认重新排队；新请求会重新记录 taskId 和真实模型 trace");
        else if (decision === "adopt-existing") message.success("已标记为结果已写入；不会重复发送请求");
        else message.info("已标记为失败且不重试");
    };

    return (
        <div className="stage3-workspace">
            <header className="stage3-workspace__head">
                <div className="stage3-workspace__identity">
                    <span className="stage3-step-number">03</span>
                    <div>
                        <span className="stage3-kicker">SCRIPT &amp; STORYBOARD PRODUCTION</span>
                        <h1>分集剧本与分镜</h1>
                        <p>消费 2B handoff，逐集写正式剧本，再按场景 → 镜头组 → 单镜头生成结构化分镜。这里只产出草稿、版本和连续性检查。</p>
                    </div>
                </div>
                <div className="stage3-workspace__status">
                    <div><span>2B 审核</span><strong>{review.approved}/{review.total}</strong></div>
                    <div><span>已出剧本</span><strong>{scripted}/{aligned.length}</strong></div>
                    <div><span>已出分镜</span><strong>{storyboarded}/{aligned.length}</strong></div>
                    <div><span>任务失败</span><strong className={failed.length ? "is-warn" : ""}>{failed.length}</strong></div>
                </div>
                <div className="stage3-workspace__tools">
                    <ModelBadge label={runtime?.label ?? (runtimeError ? "读取失败" : "读取中…")} params={runtime?.params ?? {}} />
                    <Button size="small" icon={<SlidersHorizontal className="size-3.5" />} onClick={onOpenSettings}>模型设置</Button>
                    <Tooltip title={runtimeError || "调用前会校验项目级豆包 / Dola 账号，不回退全局池"}><Tag bordered={false} color={runtimeError ? "error" : "success"}>{runtimeError ? "账号待修复" : "项目账号隔离"}</Tag></Tooltip>
                </div>
            </header>

            <div className="stage3-handed-off">
                <div>
                    <Layers3 className="size-4" />
                    <span>来源 handoff</span>
                    <code>{handoff.snapshotId}</code>
                    <small>蓝图 v{handoff.blueprintVersion} · 分集版本 v{handoff.packageVersion} · 分析 v{handoff.analysisVersion}</small>
                </div>
                <div className="stage3-handed-off__flags">
                    <Tag bordered={false}>error {handoff.checks.filter((check) => check.level === "error").length}</Tag>
                    <Tag bordered={false} color="warning">warning {handoff.checks.filter((check) => check.level === "warning").length}</Tag>
                    <Tag bordered={false}>suggestion {handoff.checks.filter((check) => check.level === "suggestion").length}</Tag>
                    <Tag bordered={false}>待处理 {handoff.checks.filter((check) => check.status === "open").length}</Tag>
                    <Tag bordered={false} color="warning">锁定集 {handoff.lockedEpisodeNumbers.join(" / ") || "无"}</Tag>
                </div>
                <span className="stage3-handed-off__note"><TriangleAlert className="size-3.5" /> 2B 待处理问题只读带入；Stage 3 生成转场不会自动把它们改成已解决。</span>
            </div>

            <div className="stage3-tabs-row">
                <div className="stage3-tabs" role="tablist">
                    <button type="button" className={view === "script" ? "is-active" : ""} onClick={() => onViewChange("script")}>
                        <FileText className="size-4" /> 分集剧本 <Tag bordered={false}>{scripted}</Tag>
                    </button>
                    <button type="button" className={view === "storyboard" ? "is-active" : ""} onClick={() => onViewChange("storyboard")}>
                        <Clapperboard className="size-4" /> 分镜设计 <Tag bordered={false}>{storyboarded}</Tag>
                    </button>
                </div>
                {jobs.length ? (
                    <div className="stage3-queue-strip">
                        {running ? <><JobStatusTag status={running.status} /><strong>{running.currentLabel}</strong><span>{running.progress}%</span></> : <span>{jobs.length} 个任务待处理 / 可恢复</span>}
                        <div className="stage3-queue-actions">
                            <Button size="small" icon={<Pause className="size-3.5" />} onClick={() => { pauseProductionQueue(project.id); message.info("当前任务结束后暂停，剩余任务保持排队"); }}>暂停</Button>
                            <Button size="small" icon={<Play className="size-3.5" />} onClick={continueQueue}>继续</Button>
                            <Button size="small" danger icon={<Square className="size-3.5" />} onClick={stopQueue}>停止</Button>
                            <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={retryQueue}>重试</Button>
                            {reviewJobs.length ? <Button size="small" type="primary" ghost onClick={() => setReviewOpen(true)}>核对 {reviewJobs.length}</Button> : null}
                        </div>
                    </div>
                ) : null}
            </div>

            {view === "script" ? (
                <ScriptTab project={project} episode={active} handoff={handoff} runtime={runtime} onOpenEpisode={onOpenEpisode} onOpenSettings={onOpenSettings} />
            ) : (
                <StoryboardTab project={project} episode={active} handoff={handoff} runtime={runtime} onOpenEpisode={onOpenEpisode} />
            )}

            <Modal
                open={reviewOpen}
                onCancel={() => setReviewOpen(false)}
                footer={null}
                width={720}
                title="核对未确定任务"
                destroyOnHidden
            >
                <p className="stage3-review-note">这些任务的远端请求可能已经发出或已计费。系统不会自动重发；请先核对结果，再选择处理方式。</p>
                {reviewJobs.length ? (
                    <div className="stage3-review-list">
                        {reviewJobs.map((job) => (
                            <article key={job.id} className="stage3-review-item">
                                <header>
                                    <div>
                                        <JobStatusTag status={job.status} />
                                        <strong>{job.currentLabel || job.id}</strong>
                                    </div>
                                    <code>{job.id}</code>
                                </header>
                                <div className="stage3-review-meta">
                                    <span>{job.kind === "script" ? "分集剧本" : "分镜"} · 第 {job.episodeNumbers.join(" / ")} 集</span>
                                    <span>真实模型 {job.trace?.model.label ?? `${job.model.channelId}::${job.model.modelId}`}</span>
                                    <span>远端 {job.remoteState ?? "unknown"} · task {job.taskId ?? "无 taskId"}</span>
                                </div>
                                {job.error ? <p className="stage3-review-error">{job.error}</p> : null}
                                <div className="stage3-review-actions">
                                    <Button size="small" onClick={() => reviewAction(job.id, "adopt-existing")}>结果已写入，标记完成</Button>
                                    <Button size="small" type="primary" onClick={() => reviewAction(job.id, "retry")}>确认未提交 / 可重试，重新排队</Button>
                                    <Button size="small" danger onClick={() => reviewAction(job.id, "mark-failed")}>确认失败，不重试</Button>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <div className="stage3-check-empty">当前没有需要人工核对的任务。</div>
                )}
            </Modal>
        </div>
    );
}
