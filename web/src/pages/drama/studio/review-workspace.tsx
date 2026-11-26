import { useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Empty, Input, Modal, Segmented, Select, Tooltip } from "antd";
import {
    AlertTriangle,
    ArrowRight,
    Bot,
    Check,
    CircleCheck,
    CircleDot,
    Info,
    LayoutGrid,
    List,
    Lock,
    RefreshCw,
    ScanSearch,
    Search,
    ShieldAlert,
    ShieldCheck,
} from "lucide-react";

import type { StudioEpisode, StudioProject } from "@/types/studio";
import type {
    StudioContinuityCheckReport,
    StudioProductionShot,
    StudioStoryboardDocument,
    StudioStoryboardReviewIssue,
    StudioStoryboardReviewStatus,
    StudioStoryboardReadinessStatus,
} from "@/types/studio-production";
import {
    analyzeStoryboardReview,
    auditsForShot,
    STORYBOARD_READINESS_LABEL,
    STORYBOARD_REVIEW_ACTION_LABEL,
    type StudioStoryboardReviewAnalysis,
} from "@/lib/studio/review-engine";
import {
    refreshStoryboardReviewAction,
    reReviewStoryboardShotsAction,
    setStoryboardShotLocksAction,
    setStoryboardShotReviewAction,
    type Stage4ReviewActionResult,
    type Stage4ShotLockResult,
} from "@/lib/studio/review-actions";
import type { StudioContinuityScope } from "@/lib/studio/continuity-engine";
import { ReviewGrid } from "./review-grid";
import { ReviewList } from "./review-list";
import {
    REVIEW_SKIP_LABEL,
    REVIEW_STATUS_OPTIONS,
    durationText,
    groupNoLabel,
    issueIcon,
    readinessColor,
    sceneTitleOf,
    ShotStatusTag,
    shotLabel,
    sortShots,
} from "./review-shared";
import { ReviewShotDrawer } from "./review-shot-drawer";
import { ContinuityPanel } from "./continuity-panel";
import { AiReviewPanel } from "./ai-review-panel";
import { runStoryboardAiReviewAction } from "@/lib/studio/stage4d-actions";

type Stage4EpisodeSummary = {
    episode: StudioEpisode;
    hasStoryboard: boolean;
    document?: StudioStoryboardDocument;
    analysis?: StudioStoryboardReviewAnalysis;
};

type ReviewView = "grid" | "list";

type BatchReport = {
    title: string;
    success: string[];
    skipped: { shot: string; reason: string }[];
    failed: { shot: string; message: string }[];
    version?: number;
};

type BatchOperation = {
    title: string;
    status?: "pending" | "approved" | "needs_revision" | "rejected";
    action?: "approve" | "needs_revision" | "reject" | "reset";
    locked?: boolean;
    reReview?: boolean;
};

function ReadinessIcon({ status }: { status: StudioStoryboardReadinessStatus }) {
    if (status === "ready_for_video") return <ShieldCheck className="size-4" />;
    if (status === "blocked") return <ShieldAlert className="size-4" />;
    return <CircleDot className="size-4" />;
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
    return (
        <div className={`stage4-stat ${tone ? `is-${tone}` : ""}`}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function SummaryRow({ item, active, onSelect }: { item: Stage4EpisodeSummary; active: boolean; onSelect: () => void }) {
    const stats = item.analysis?.stats;
    const readiness = item.analysis?.readiness.status;
    const progress = stats?.total ? Math.round((stats.approved / stats.total) * 100) : 0;
    return (
        <button type="button" className={`stage4-episode ${active ? "is-active" : ""}`} onClick={onSelect}>
            <span className="stage4-episode__no">{String(item.episode.no).padStart(2, "0")}</span>
            <span className="stage4-episode__main">
                <strong>{item.episode.title}</strong>
                <small>
                    {item.document ? `正式 v${item.document.storyboardVersion}` : "未生成正式分镜"}
                    {item.document ? ` · ${stats?.total ?? 0} 镜 · ${stats?.groups ?? 0} 组${stats?.locked ? ` · 锁 ${stats.locked}` : ""}` : ""}
                </small>
                {item.document ? <span className="stage4-episode__bar"><i style={{ width: `${progress}%` }} /></span> : null}
            </span>
            <span className={`stage4-episode__state ${readiness ? readinessColor(readiness) : "is-blocked"}`}>
                {readiness ? STORYBOARD_READINESS_LABEL[readiness] : "未就绪"}
            </span>
        </button>
    );
}

function statusAction(status: "pending" | "approved" | "needs_revision" | "rejected") {
    return status === "approved" ? "approve" : status === "needs_revision" ? "needs_revision" : status === "rejected" ? "reject" : "reset";
}

function BatchReportModal({ report, onClose }: { report?: BatchReport; onClose: () => void }) {
    return (
        <Modal open={Boolean(report)} title={report ? `${report.title} · 操作报告` : "操作报告"} onCancel={onClose} footer={null} width={560}>
            {report ? (
                <div className="stage4b-report">
                    <div className="stage4b-report__summary">
                        <span className="is-ok"><CircleCheck className="size-3.5" /> 成功 {report.success.length}</span>
                        <span className="is-skip">跳过 {report.skipped.length}</span>
                        <span className="is-fail">失败 {report.failed.length}</span>
                        {report.version !== undefined ? <small>正式分镜 v{report.version} 未改变</small> : null}
                    </div>
                    {report.success.length ? <div className="stage4b-report__group"><strong>已写入</strong>{report.success.map((shot) => <span key={shot}>{shot}</span>)}</div> : null}
                    {report.skipped.length ? (
                        <div className="stage4b-report__group">
                            <strong>跳过</strong>
                            {report.skipped.map((item) => <span key={`${item.shot}-${item.reason}`}>{item.shot} · {REVIEW_SKIP_LABEL[item.reason] || item.reason}</span>)}
                        </div>
                    ) : null}
                    {report.failed.length ? (
                        <div className="stage4b-report__group is-failed">
                            <strong>失败</strong>
                            {report.failed.map((item) => <span key={`${item.shot}-${item.message}`}>{item.shot} · {item.message}</span>)}
                        </div>
                    ) : null}
                    {!report.success.length && !report.skipped.length && !report.failed.length ? <div className="stage4b-muted">没有可处理的镜头。</div> : null}
                </div>
            ) : null}
        </Modal>
    );
}

export function Stage4ReviewWorkspace({
    project,
    episode,
    onOpenEpisode,
    onGoStoryboard,
}: {
    project: StudioProject;
    episode: StudioEpisode;
    onOpenEpisode: (episodeId: string) => void;
    onGoStoryboard: () => void;
}) {
    const { message, modal } = App.useApp();
    const [view, setView] = useState<ReviewView>("grid");
    const [search, setSearch] = useState("");
    const [sceneFilter, setSceneFilter] = useState("all");
    const [groupFilter, setGroupFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [lockFilter, setLockFilter] = useState("all");
    const [levelFilter, setLevelFilter] = useState("all");
    const [sort, setSort] = useState("number_asc");
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [drawerShotId, setDrawerShotId] = useState<string>();
    const [auditShotId, setAuditShotId] = useState<string>();
    const [report, setReport] = useState<BatchReport>();
    const [continuityOpen, setContinuityOpen] = useState(false);
    const [aiOpen, setAiOpen] = useState(false);
    const [aiRunning, setAiRunning] = useState(false);

    const summaries = useMemo(
        () =>
            project.episodes.map((item): Stage4EpisodeSummary => {
                const document = item.production?.storyboard;
                if (!document) return { episode: item, hasStoryboard: false };
                return {
                    episode: item,
                    hasStoryboard: true,
                    document,
                    analysis: analyzeStoryboardReview({
                        document,
                        script: item.production?.script,
                        review: item.production?.storyboardReview,
                    }),
                };
            }),
        [project],
    );

    const current = summaries.find((item) => item.episode.id === episode.id) ?? summaries[0];
    const document = current?.document;
    const documentLocked = document?.status === "locked";
    const analysis = current?.analysis;
    const review = analysis?.review;
    const stats = analysis?.stats;
    const issues = analysis?.issues ?? [];
    const readiness = analysis?.readiness;
    const currentEpisode = current?.episode ?? episode;

    useEffect(() => {
        setSelected(new Set());
        setDrawerShotId(undefined);
        setAuditShotId(undefined);
        setContinuityOpen(false);
        setAiOpen(false);
    }, [currentEpisode.id]);

    useEffect(() => {
        if (!document) return;
        setSelected((previous) => {
            const next = new Set([...previous].filter((shotId) => document.shots.some((shot) => shot.shotId === shotId)));
            return next.size === previous.size ? previous : next;
        });
        if (drawerShotId && !document.shots.some((shot) => shot.shotId === drawerShotId)) setDrawerShotId(undefined);
    }, [document, drawerShotId]);

    const filteredShots = useMemo(() => {
        if (!document) return [];
        const query = search.trim().toLowerCase();
        const openFor = (shotId: string) => issues.filter((issue) => issue.shotId === shotId && issue.status === "open" && !issue.continuityStale);
        return sortShots(document.shots.filter((shot) => {
            const status = analysis?.statuses[shot.shotId] ?? "pending";
            const locked = shot.locked || document.status === "locked";
            if (sceneFilter !== "all" && shot.sceneId !== sceneFilter) return false;
            if (groupFilter !== "all" && shot.shotGroupId !== groupFilter) return false;
            if (statusFilter !== "all" && status !== statusFilter) return false;
            if (lockFilter === "locked" && !locked) return false;
            if (lockFilter === "unlocked" && locked) return false;
            const shotIssues = openFor(shot.shotId);
            if (levelFilter !== "all" && !shotIssues.some((issue) => issue.level === levelFilter)) return false;
            if (!query) return true;
            const group = document.groups.find((item) => item.shotGroupId === shot.shotGroupId);
            const text = `${shot.shotNumber} ${sceneTitleOf(document, shot)} ${group?.sceneTitle || ""} ${shot.shotSize} ${shot.cameraPosition} ${shot.cameraMovement} ${shot.action} ${shot.characterBlocking} ${shot.dialogue.map((line) => line.text).join(" ")}`.toLowerCase();
            return text.includes(query);
        }), sort);
    }, [analysis?.statuses, document, groupFilter, issues, levelFilter, lockFilter, sceneFilter, search, sort, statusFilter]);

    const sceneOptions = document
        ? [...new Set(document.shots.map((shot) => shot.sceneId))].map((sceneId) => ({
              value: sceneId,
              label: document.groups.find((group) => group.sceneId === sceneId)?.sceneTitle || sceneId,
          }))
        : [];
    const groupOptions = document
        ? document.groups.map((group) => ({
              value: group.shotGroupId,
              label: `${groupNoLabel(document, group)} · ${group.sceneTitle} · ${group.shotIds.length} 镜`,
          }))
        : [];

    const selectedShotIds = [...selected];
    const selectedStaleIds = selectedShotIds.filter((shotId) => analysis?.statuses[shotId] === "stale");
    const selectedLocked = selectedShotIds.filter((shotId) => {
        const shot = document?.shots.find((item) => item.shotId === shotId);
        return shot && (shot.locked || document?.status === "locked");
    }).length;
    const visibleAllSelected = filteredShots.length > 0 && filteredShots.every((shot) => selected.has(shot.shotId));
    const visibleSomeSelected = filteredShots.some((shot) => selected.has(shot.shotId));

    function toggleSelection(shotId: string) {
        setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(shotId)) next.delete(shotId);
            else next.add(shotId);
            return next;
        });
    }

    function toggleVisibleSelection() {
        setSelected((previous) => {
            const next = new Set(previous);
            const all = filteredShots.length > 0 && filteredShots.every((shot) => previous.has(shot.shotId));
            if (all) filteredShots.forEach((shot) => next.delete(shot.shotId));
            else filteredShots.forEach((shot) => next.add(shot.shotId));
            return next;
        });
    }

    const selectedShotIssues = auditShotId ? issues.filter((issue) => issue.shotId === auditShotId && issue.status === "open" && !issue.continuityStale) : [];
    const audits = auditShotId && review ? auditsForShot(review, auditShotId) : [];
    const auditShot = auditShotId ? document?.shots.find((shot) => shot.shotId === auditShotId) : undefined;
    const drawerShot = drawerShotId ? document?.shots.find((shot) => shot.shotId === drawerShotId) : undefined;
    const versions = currentEpisode.production?.storyboardVersions;

    function reasonMessage(reason?: string) {
        return REVIEW_SKIP_LABEL[reason ?? ""] || "镜头未写入";
    }

    async function applyStatus(shotId: string, status: "pending" | "approved" | "needs_revision" | "rejected", note = "") {
        if (!document) return;
        setBusy(true);
        const result = await setStoryboardShotReviewAction({
            projectId: project.id,
            episodeId: currentEpisode.id,
            shotIds: [shotId],
            status,
            action: statusAction(status),
            note,
            expectedVersion: document.storyboardVersion,
        });
        setBusy(false);
        if (!result.ok) {
            message.error(result.error || "审核提交失败");
            return;
        }
        if (!result.updated?.length) {
            message.warning(`没有写入：${reasonMessage(result.skipped?.[0]?.reason)}`);
            return;
        }
        const shot = document.shots.find((item) => item.shotId === shotId);
        message.success(`${shot ? shotLabel(shot) : shotId} 已标记为「${REVIEW_STATUS_OPTIONS.find((option) => option.value === status)?.label || status}」；已写入本地数据库；正式分镜 v${document.storyboardVersion} 未改变`);
    }

    async function saveNote(shotId: string, note: string) {
        if (!document) return;
        const status = (analysis?.review.shots[shotId]?.status ?? "pending") as "pending" | "approved" | "needs_revision" | "rejected";
        if (analysis?.statuses[shotId] === "stale") {
            message.warning("stale 镜头需要先重新审核，不能只保存备注");
            return;
        }
        setBusy(true);
        const result = await setStoryboardShotReviewAction({
            projectId: project.id,
            episodeId: currentEpisode.id,
            shotIds: [shotId],
            status,
            action: "note",
            note,
            expectedVersion: document.storyboardVersion,
        });
        setBusy(false);
        if (!result.ok) message.error(result.error || "备注保存失败");
        else if (!result.updated?.length) message.warning(`没有保存：${reasonMessage(result.skipped?.[0]?.reason)}`);
        else message.success("审核备注已写入本地数据库；审核结论未改变");
    }

    async function reReview(shotId: string, note = "") {
        if (!document) return;
        setBusy(true);
        const result = await reReviewStoryboardShotsAction({
            projectId: project.id,
            episodeId: currentEpisode.id,
            shotIds: [shotId],
            expectedVersion: document.storyboardVersion,
            note,
        });
        setBusy(false);
        if (!result.ok) {
            message.error(result.error || "重新审核失败");
            return;
        }
        if (!result.updated?.length) {
            message.warning(`没有重新审核：${reasonMessage(result.skipped?.[0]?.reason)}`);
            return;
        }
        const shot = document.shots.find((item) => item.shotId === shotId);
        message.success(`已为${shot ? shotLabel(shot) : shotId}创建绑定 v${document.storyboardVersion} 的待审记录并写入本地数据库；旧审核历史保留`);
    }

    async function doLock(shotIds: string[], locked: boolean) {
        if (!document) return;
        setBusy(true);
        const result: Stage4ShotLockResult = await setStoryboardShotLocksAction({
            projectId: project.id,
            episodeId: currentEpisode.id,
            shotIds,
            locked,
            expectedVersion: document.storyboardVersion,
        });
        setBusy(false);
        if (!result.ok) {
            message.error(result.error || "锁定操作失败");
            return;
        }
        if (!result.updated?.length) {
            message.warning(`没有写入：${reasonMessage(result.skipped?.[0]?.reason)}`);
            return;
        }
        const actionLabel = locked ? "锁定" : "解锁";
        message.success(`已${actionLabel} ${result.updated.length} 个镜头并写入本地数据库；审核状态未改变`);
    }

    function requestLock(shotIds: string[], locked: boolean) {
        if (document?.status === "locked") {
            message.warning("整份分镜已锁定，逐镜解锁入口不可用；请先在第三步使用整份解锁流程");
            return;
        }
        modal.confirm({
            title: locked ? (shotIds.length > 1 ? `批量锁定 ${shotIds.length} 个镜头？` : "锁定这个镜头？") : (shotIds.length > 1 ? `批量解锁 ${shotIds.length} 个镜头？` : "解锁这个镜头？"),
            content: locked
                ? "锁定只禁止后续修改，不会自动通过审核，也不会改变已有审核结论。"
                : "解锁只恢复可修改状态，不会改变 pending / approved / needs_revision / rejected 审核结论。",
            okText: locked ? "确认锁定" : "确认解锁",
            cancelText: "取消",
            onOk: () => doLock(shotIds, locked),
        });
    }

    function openBatchConfirm(operation: BatchOperation) {
        const count = selectedShotIds.length;
        if (!count) {
            message.warning("先选择镜头");
            return;
        }
        const total = document?.shots.length ?? 0;
        modal.confirm({
            title: `${operation.title} · ${count} 个镜头`,
            content: (
                <div className="stage4b-confirm">
                    <p>本次选中 {count} / {total} 镜{selectedLocked ? (operation.locked === false ? `，其中 ${selectedLocked} 镜已锁定，将解除锁定；其余未锁定镜头不会重复解锁` : `，其中 ${selectedLocked} 镜已锁定会跳过`) : ""}；操作只会处理合法镜头，允许部分成功。</p>
                    <p>不会修改正式分镜内容或 storyboardVersion；审核结论写入会追加审核历史，锁定只改 locked。</p>
                </div>
            ),
            okText: operation.title,
            cancelText: "取消",
            onOk: () => runBatch(operation),
        });
    }

    function buildReport(title: string, ids: string[], result: Stage4ReviewActionResult | Stage4ShotLockResult, version?: number): BatchReport {
        const shotName = (shotId: string) => {
            const shot = document?.shots.find((item) => item.shotId === shotId);
            return shot ? shotLabel(shot) : shotId;
        };
        const success = result.ok ? (result.updated ?? []).map(shotName) : [];
        const skipped = result.skipped?.map((item) => ({ shot: shotName(item.shotId), reason: item.reason })) ?? [];
        const failed = "failed" in result && result.failed?.length
            ? result.failed.map((item) => ({ shot: shotName(item.shotId), message: item.message }))
            : result.ok
              ? []
              : ids.map((shotId) => ({ shot: shotName(shotId), message: result.error || "操作失败" }));
        return { title, success, skipped, failed, version };
    }

    async function runBatch(operation: BatchOperation) {
        if (!document) return;
        const ids = operation.reReview ? selectedStaleIds : selectedShotIds;
        if (!ids.length) {
            message.warning(operation.reReview ? "选中的镜头里没有 stale 镜头" : "先选择镜头");
            return;
        }
        setBusy(true);
        let result: Stage4ReviewActionResult | Stage4ShotLockResult;
        if (operation.reReview) {
            result = await reReviewStoryboardShotsAction({
                projectId: project.id,
                episodeId: currentEpisode.id,
                shotIds: ids,
                expectedVersion: document.storyboardVersion,
            });
        } else if (typeof operation.locked === "boolean") {
            result = await setStoryboardShotLocksAction({
                projectId: project.id,
                episodeId: currentEpisode.id,
                shotIds: ids,
                locked: operation.locked,
                expectedVersion: document.storyboardVersion,
            });
        } else {
            result = await setStoryboardShotReviewAction({
                projectId: project.id,
                episodeId: currentEpisode.id,
                shotIds: ids,
                status: operation.status ?? "pending",
                action: operation.action ?? "reset",
                expectedVersion: document.storyboardVersion,
            });
        }
        setBusy(false);
        setReport(buildReport(operation.title, ids, result, document.storyboardVersion));
        setSelected(new Set());
    }

    function batchButton(operation: BatchOperation) {
        openBatchConfirm(operation);
    }

    async function recheck() {
        if (!document) return;
        setBusy(true);
        const result = await refreshStoryboardReviewAction(project.id, currentEpisode.id, document.storyboardVersion);
        setBusy(false);
        if (!result.ok) {
            message.error(result.error || "重新检查失败");
            return;
        }
        message.success("确定性检查已写入本地数据库，正式分镜未被修改；stale 不会因刷新被消除");
    }

    async function commitContinuity(scope: StudioContinuityScope, report: StudioContinuityCheckReport) {
        if (!document) return { ok: false as const, error: "当前分集还没有正式分镜" };
        return refreshStoryboardReviewAction(project.id, currentEpisode.id, document.storyboardVersion, scope, report);
    }

    async function runAiReview(scopeType: "shot" | "selection" | "episode", shotIds: string[]) {
        if (!document) return;
        if (!shotIds.length) {
            message.warning("先选择要审核的镜头");
            return;
        }
        setAiOpen(true);
        setAiRunning(true);
        const result = await runStoryboardAiReviewAction({
            projectId: project.id,
            episodeId: currentEpisode.id,
            scopeType,
            shotIds,
        });
        setAiRunning(false);
        if (!result.ok) {
            message.error(result.error || "AI 审核失败");
            return;
        }
        if (result.conflict) message.warning("AI 审核完成；审核期间正式分镜已变化，结果已保留为旧版本记录，不冒充当前审核");
        else message.success(`AI 审核完成：${result.run?.findings.length ?? 0} 条问题，${result.proposals?.length ?? 0} 条调整提案；审核记录已写入本地数据库`);
    }

    if (!current) {
        return <div className="stage4-empty">当前项目还没有分集，无法审片。</div>;
    }

    return (
        <div className="stage4-review stage4b-review">
            <header className="stage4-review__head">
                <div>
                    <span className="stage4-kicker">04 · STORYBOARD REVIEW DESK</span>
                    <h1>分镜审核与调整</h1>
                    <p>九宫格、列表和单镜审片共享同一份正式分镜。AI 审核只生成审核记录与提案；提案必须逐项确认后才会写入正式分镜。</p>
                </div>
                <div className="stage4-review__actions">
                    <Button icon={<Bot className="size-3.5" />} onClick={() => setAiOpen(true)} disabled={!document}>AI 审核</Button>
                    <Button icon={<ScanSearch className="size-3.5" />} onClick={() => setContinuityOpen(true)} disabled={!document}>连续性检查</Button>
                    <Button icon={<RefreshCw className="size-3.5" />} onClick={recheck} loading={busy} disabled={!document}>重新检查</Button>
                    <Button type="primary" icon={<ArrowRight className="size-3.5" />} onClick={onGoStoryboard}>去分镜设计</Button>
                </div>
            </header>

            <div className="stage4-layout">
                <aside className="stage4-episodes">
                    <header><span>全剧分镜总览</span><small>{project.episodes.length} 集</small></header>
                    <div className="stage4-episodes__list">
                        {summaries.map((item) => (
                            <SummaryRow key={item.episode.id} item={item} active={item.episode.id === currentEpisode.id} onSelect={() => onOpenEpisode(item.episode.id)} />
                        ))}
                    </div>
                    <footer>
                        <span><Lock className="size-3.5" /> 锁定只限制修改，不改变审核结论</span>
                        <span><Bot className="size-3.5" /> AI 只做审核与提案，应用前校验版本、人工编辑与备份快照</span>
                        <span><CircleDot className="size-3.5" /> 审核历史与正式分镜独立保存</span>
                    </footer>
                </aside>

                <main className="stage4-detail stage4b-workspace">
                    <header className="stage4-detail__head">
                        <div>
                            <span className="stage4-kicker">第 {String(currentEpisode.no).padStart(2, "0")} 集 · 分镜审片工作台</span>
                            <h2>{currentEpisode.title}</h2>
                            <p>
                                {document ? (
                                    <>
                                        正式分镜 <b>v{document.storyboardVersion}</b>
                                        {currentEpisode.production?.script ? ` · 剧本 v${currentEpisode.production.script.scriptVersion}` : ""}
                                        {` · 审核记录 ${review?.audits.length ?? 0} 条`}
                                        {` · 锁定 ${stats?.locked ?? 0} 镜`}
                                    </>
                                ) : "本集还没有正式分镜，请先回到第三步生成。"}
                            </p>
                        </div>
                        {readiness ? (
                            <div className={`stage4-readiness ${readinessColor(readiness.status)}`}>
                                <ReadinessIcon status={readiness.status} />
                                <div><strong>{STORYBOARD_READINESS_LABEL[readiness.status]}</strong><span>{readiness.reasons[0] || "未发现阻塞项"}</span></div>
                            </div>
                        ) : null}
                    </header>

                    {!document ? (
                        <Empty description="本集还没有正式分镜" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                            <Button type="primary" onClick={onGoStoryboard}>去生成分镜</Button>
                        </Empty>
                    ) : (
                        <div className="stage4b-scroll">
                            <div className="stage4-stat-grid">
                                <StatCard label="镜头" value={stats?.total ?? 0} />
                                <StatCard label="已通过" value={stats?.approved ?? 0} tone="ok" />
                                <StatCard label="待审核" value={stats?.pending ?? 0} tone="pending" />
                                <StatCard label="需修改" value={stats?.needsRevision ?? 0} tone="warning" />
                                <StatCard label="驳回" value={stats?.rejected ?? 0} tone="error" />
                                <StatCard label="待重新审核" value={stats?.stale ?? 0} tone="warning" />
                                <StatCard label="锁定" value={stats?.locked ?? 0} />
                                <StatCard label="总时长" value={durationText(stats?.duration ?? 0)} />
                            </div>

                            <div className="stage4-issue-strip">
                                <div className="stage4-issue-strip__title"><ScanSearch className="size-4" /><strong>确定性检查</strong><small>Error / Warning / Suggestion 来自当前正式数据</small></div>
                                <div className="stage4-issue-strip__counts">
                                    <button type="button" className={`is-error ${levelFilter === "error" ? "is-active" : ""}`} onClick={() => setLevelFilter(levelFilter === "error" ? "all" : "error")}><AlertTriangle className="size-3.5" /> {stats?.errors ?? 0} Error</button>
                                    <button type="button" className={`is-warning ${levelFilter === "warning" ? "is-active" : ""}`} onClick={() => setLevelFilter(levelFilter === "warning" ? "all" : "warning")}><CircleDot className="size-3.5" /> {stats?.warnings ?? 0} Warning</button>
                                    <button type="button" className={`is-suggestion ${levelFilter === "suggestion" ? "is-active" : ""}`} onClick={() => setLevelFilter(levelFilter === "suggestion" ? "all" : "suggestion")}><Info className="size-3.5" /> {stats?.suggestions ?? 0} Suggestion</button>
                                </div>
                                <div className="stage4-issue-strip__list">
                                    {issues.filter((issue) => issue.status === "open" && !issue.continuityStale).slice(0, 3).map((issue) => (
                                        <span key={issue.id} className={`stage4-issue-pill is-${issue.level}`}>{issueIcon(issue.level)} {issue.message}</span>
                                    ))}
                                    {!issues.some((issue) => issue.status === "open" && !issue.continuityStale) ? <span className="stage4-issue-empty">没有未处理的检查问题</span> : null}
                                </div>
                            </div>

                            <div className="stage4b-toolbar">
                                <div className="stage4b-toolbar__top">
                                    <Input allowClear prefix={<Search className="size-3.5" />} placeholder="搜镜号、场景、景别、动作、台词" value={search} onChange={(event) => setSearch(event.target.value)} />
                                    <Segmented
                                        size="small"
                                        value={view}
                                        onChange={(value) => setView(value as ReviewView)}
                                        options={[
                                            { value: "grid", label: <span className="stage4b-view-option"><LayoutGrid className="size-3.5" />九宫格</span> },
                                            { value: "list", label: <span className="stage4b-view-option"><List className="size-3.5" />列表</span> },
                                        ]}
                                    />
                                    <Select
                                        size="small"
                                        value={sort}
                                        onChange={setSort}
                                        className="stage4b-sort"
                                        options={[
                                            { value: "number_asc", label: "镜号升序" },
                                            { value: "number_desc", label: "镜号降序" },
                                            { value: "duration_asc", label: "时长从短到长" },
                                            { value: "duration_desc", label: "时长从长到短" },
                                        ]}
                                    />
                                    <Tooltip title="全选当前筛选结果">
                                        <Checkbox checked={visibleAllSelected} indeterminate={!visibleAllSelected && visibleSomeSelected} onChange={() => toggleVisibleSelection()}>
                                            全选当前
                                        </Checkbox>
                                    </Tooltip>
                                    <span className="stage4b-count">{filteredShots.length} / {document.shots.length} 镜</span>
                                </div>
                                <div className="stage4b-toolbar__filters">
                                    <Select value={sceneFilter} onChange={setSceneFilter} options={[{ value: "all", label: "全部场景" }, ...sceneOptions]} />
                                    <Select value={groupFilter} onChange={setGroupFilter} options={[{ value: "all", label: "全部镜头组" }, ...groupOptions]} />
                                    <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部审核状态" }, ...REVIEW_STATUS_OPTIONS]} />
                                    <Select value={lockFilter} onChange={setLockFilter} options={[
                                        { value: "all", label: "全部锁定状态" },
                                        { value: "locked", label: "已锁定" },
                                        { value: "unlocked", label: "未锁定" },
                                    ]} />
                                    <Select value={levelFilter} onChange={setLevelFilter} options={[
                                        { value: "all", label: "全部检查等级" },
                                        { value: "error", label: "Error" },
                                        { value: "warning", label: "Warning" },
                                        { value: "suggestion", label: "Suggestion" },
                                    ]} />
                                </div>
                            </div>

                            {selectedShotIds.length ? (
                                <div className="stage4b-batch-bar">
                                    <span className="stage4b-batch-bar__count"><Check className="size-3.5" /> 已选 {selectedShotIds.length} 镜{selectedLocked ? ` · 锁定 ${selectedLocked}` : ""}</span>
                                    <div className="stage4b-batch-bar__actions">
                                        <Button size="small" type="primary" onClick={() => batchButton({ title: "批量通过", status: "approved", action: "approve" })}>批量通过</Button>
                                        <Button size="small" onClick={() => batchButton({ title: "批量标记需要修改", status: "needs_revision", action: "needs_revision" })}>批量需修改</Button>
                                        <Button size="small" danger onClick={() => batchButton({ title: "批量驳回", status: "rejected", action: "reject" })}>批量驳回</Button>
                                        {selectedStaleIds.length ? <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => batchButton({ title: "批量重新审核 stale", reReview: true })}>重新审核 stale</Button> : null}
                                        <Button size="small" icon={<Bot className="size-3.5" />} loading={aiRunning} onClick={() => runAiReview(selectedShotIds.length === 1 ? "shot" : "selection", selectedShotIds)}>AI 审核选中</Button>
                                        <Button size="small" disabled={documentLocked} onClick={() => batchButton({ title: "批量锁定", locked: true })}>批量锁定</Button>
                                        <Button size="small" disabled={documentLocked} onClick={() => batchButton({ title: "批量解锁", locked: false })}>批量解锁</Button>
                                        <Button size="small" type="text" onClick={() => setSelected(new Set())}>清空选择</Button>
                                    </div>
                                </div>
                            ) : null}

                            {view === "grid" ? (
                                <ReviewGrid
                                    document={document}
                                    shots={filteredShots}
                                    statuses={analysis?.statuses ?? {}}
                                    issues={issues}
                                    selected={selected}
                                    busy={busy}
                                    onToggleSelection={toggleSelection}
                                    onOpen={setDrawerShotId}
                                    onStatus={(shotId, status) => applyStatus(shotId, status)}
                                    onOpenAudit={setAuditShotId}
                                    onLockRequest={(shotId, locked) => requestLock([shotId], locked)}
                                    onReReview={(shotId) => reReview(shotId)}
                                />
                            ) : (
                                <ReviewList
                                    document={document}
                                    shots={filteredShots}
                                    statuses={analysis?.statuses ?? {}}
                                    issues={issues}
                                    selected={selected}
                                    busy={busy}
                                    sort={sort}
                                    onSort={setSort}
                                    onToggleSelection={toggleSelection}
                                    onOpen={setDrawerShotId}
                                    onStatus={(shotId, status) => applyStatus(shotId, status)}
                                    onOpenAudit={setAuditShotId}
                                    onLockRequest={(shotId, locked) => requestLock([shotId], locked)}
                                    onReReview={(shotId) => reReview(shotId)}
                                />
                            )}
                        </div>
                    )}
                </main>
            </div>

            <ContinuityPanel
                open={continuityOpen}
                document={document}
                script={currentEpisode.production?.script}
                analysis={analysis}
                busy={busy}
                onClose={() => setContinuityOpen(false)}
                onCommit={commitContinuity}
                onLocate={setDrawerShotId}
            />

            <AiReviewPanel
                open={aiOpen}
                projectId={project.id}
                episodeId={currentEpisode.id}
                document={document}
                review={analysis?.review}
                selectedShotIds={selectedShotIds}
                running={aiRunning}
                onClose={() => setAiOpen(false)}
                onRun={runAiReview}
            />

            <Modal
                open={Boolean(auditShotId)}
                title={auditShot ? `${shotLabel(auditShot)} · 审核历史` : "审核历史"}
                onCancel={() => setAuditShotId(undefined)}
                footer={null}
                width={620}
            >
                {audits.length ? (
                    <div className="stage4-audit-list">
                        {audits.map((audit) => (
                            <div key={audit.id} className="stage4-audit-item">
                                <ShotStatusTag status={audit.fromStatus} />
                                <ArrowRight className="size-3.5" />
                                <ShotStatusTag status={audit.toStatus} />
                                <span>{audit.note || "无备注"}</span>
                                <small>{audit.actor === "local-user" ? "本地用户" : audit.actor} · {STORYBOARD_REVIEW_ACTION_LABEL[audit.action]} · v{audit.storyboardVersion} · {new Date(audit.createdAt).toLocaleString()}</small>
                            </div>
                        ))}
                    </div>
                ) : <div className="stage4-audit-empty">这个镜头还没有审核记录。</div>}
                {selectedShotIssues.length ? (
                    <div className="stage4-audit-issues">
                        <strong>当前检查</strong>
                        {selectedShotIssues.map((issue) => <span key={issue.id} className={`is-${issue.level}`}>{issueIcon(issue.level)} {issue.message}</span>)}
                    </div>
                ) : null}
            </Modal>

            <ReviewShotDrawer
                open={Boolean(drawerShotId)}
                document={document}
                analysis={analysis}
                shot={drawerShot}
                versions={versions}
                busy={busy}
                onClose={() => setDrawerShotId(undefined)}
                onOpenShot={setDrawerShotId}
                onStatus={(status, note) => drawerShot && applyStatus(drawerShot.shotId, status, note)}
                onSaveNote={(note) => drawerShot && saveNote(drawerShot.shotId, note)}
                onReReview={(note) => drawerShot && reReview(drawerShot.shotId, note)}
                onLockRequest={(locked) => drawerShot && requestLock([drawerShot.shotId], locked)}
            />

            <BatchReportModal report={report} onClose={() => setReport(undefined)} />
        </div>
    );
}
