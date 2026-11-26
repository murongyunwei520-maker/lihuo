import { Alert, App, Button, Progress, Tag, Tabs } from "antd";
import {
    ArrowLeft,
    BookOpenText,
    CheckCircle2,
    Clapperboard,
    FileSearch,
    GitBranch,
    Layers3,
    ListChecks,
    LockKeyhole,
    Network,
    RefreshCw,
    Settings2,
    Sparkles,
    StopCircle,
    TriangleAlert,
    Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { modelOptionLabel, useConfigStore } from "@/stores/use-config-store";
import { useStudioStore } from "@/stores/use-studio-store";
import { DRAMA_STEP_LABEL, type StudioProject } from "@/types/studio";
import type { StudioAdaptationCheckStatus, StudioAdaptationProposal, StudioAdaptationWorkspace, StudioEpisodePlan } from "@/types/studio-adaptation";
import { estimateAdaptationGenerationCalls, runAdaptationGeneration, type AdaptationEpisodeModule, type AdaptationGenerationRequest } from "@/lib/studio/adaptation-engine";
import { revalidateAdaptationWorkspace } from "@/lib/studio/adaptation-schema";
import { adaptationReviewProgress, applyProposalToWorkspace, AdaptationReviewError, createStudioAdaptationWorkspace, episodePlanCore, highRiskChangesInProposal, lockedEpisodeNumbers } from "@/lib/studio/adaptation-workspace";
import { applyNovelAnalysisOverrides } from "@/lib/studio/novel-merge";
import { projectModelOption } from "@/lib/studio/model-profile";
import { StudioEmpty } from "../ui";
import { AdaptationBlueprintTab } from "./blueprint-tab";
import { AdaptationCharactersTab } from "./characters-tab";
import { AdaptationChecksTab } from "./checks-tab";
import { AdaptationEpisodesTab, type EpisodeEdit } from "./episodes-tab";
import { AdaptationForeshadowingTab } from "./foreshadowing-tab";
import { AdaptationRecordsTab } from "./records-tab";
import { AdaptationSettingsTab } from "./settings-tab";
import { AdaptationStrategyTab } from "./strategy-tab";
import { ReviewTag, adaptationTime } from "./shared";

type StrategyEdit = Parameters<typeof AdaptationStrategyTab>[0]["onSave"] extends (patch: infer T) => void ? T : never;
type BlueprintEdit = Parameters<typeof AdaptationBlueprintTab>[0]["onSave"] extends (patch: infer T) => void ? T : never;
type ArcEdit = Parameters<typeof AdaptationCharactersTab>[0]["onSaveArc"] extends (characterId: string, patch: infer T) => void ? T : never;
type PoolEdit = Parameters<typeof AdaptationForeshadowingTab>[0]["onUpdate"] extends (id: string, patch: infer T) => void ? T : never;

const nowIso = () => new Date().toISOString();

/**
 * 阶段 2B：第一步内的 AI 短剧总编剧工作区。
 * 只产出改编方案、全剧蓝图、全剧分集规划、人物弧光、伏笔池与校验；不生成剧本对白、分镜、图片或视频。
 */
export function StudioAdaptationWorkspace({ project, onBack, onOpenSettings }: {
    project: StudioProject;
    onBack: () => void;
    onOpenSettings: () => void;
}) {
    const { message, modal } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateAdaptation = useStudioStore((state) => state.updateAdaptation);
    const [workspace, setWorkspace] = useState<StudioAdaptationWorkspace>(() => project.adaptation ?? createStudioAdaptationWorkspace(project));
    const stateRef = useRef(workspace);
    const controllerRef = useRef<AbortController | null>(null);
    const revalidatedVersionRef = useRef<number | null>(null);
    const [tab, setTab] = useState(() => project.adaptation?.episodePlans.length ? "episodes" : "settings");
    const [busy, setBusy] = useState(false);
    const analysis = project.novelAnalysis ? applyNovelAnalysisOverrides(project.novelAnalysis, project.novelAnalysisOverrides) : undefined;
    const modelLabel = projectModelOption(project, "text", config) ? modelOptionLabel(config, projectModelOption(project, "text", config)!) : "未选择项目文本模型";
    const pendingProposal = useMemo(() => {
        const active = workspace.proposals.find((proposal) => proposal.id === workspace.activeGenerationId && proposal.status === "pending");
        return active ?? workspace.proposals.slice().reverse().find((proposal) => proposal.status === "pending");
    }, [workspace.proposals, workspace.activeGenerationId]);
    const displayWorkspace = pendingProposal ? previewWorkspace(workspace, pendingProposal) : workspace;
    const latestGeneration = workspace.generations.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const runningGeneration = workspace.generations.find((generation) => generation.status === "running");
    const review = reviewProgress(displayWorkspace);
    const targetComplete = displayWorkspace.episodePlans.length === displayWorkspace.settings.targetEpisodes;
    const highRiskPending = pendingProposal ? highRiskChangesInProposal(pendingProposal, workspace) : [];
    const nextAction = nextHeaderAction(displayWorkspace, Boolean(pendingProposal), targetComplete);

    useEffect(() => {
        if (!project.adaptation) {
            const created = createStudioAdaptationWorkspace(project);
            setWorkspace(created);
            stateRef.current = created;
            updateAdaptation(project.id, () => created);
        }
    }, [project.id, project.adaptation, updateAdaptation]);

    useEffect(() => () => controllerRef.current?.abort(), []);

    useEffect(() => {
        const current = stateRef.current;
        if (!current.strategy && !current.blueprint && !current.episodePlans.length) return;
        if (revalidatedVersionRef.current === current.versionNumber) return;
        revalidatedVersionRef.current = current.versionNumber;
        const next = revalidateAdaptationWorkspace(project, current);
        if (JSON.stringify(next.checks) !== JSON.stringify(current.checks)) commit(next);
    }, [project.id, project.novelAnalysis?.version, workspace.versionNumber]);

    function commit(next: StudioAdaptationWorkspace, persist = true) {
        stateRef.current = next;
        setWorkspace(next);
        if (persist) updateAdaptation(project.id, () => next);
    }

    function mutate(mutator: (current: StudioAdaptationWorkspace) => StudioAdaptationWorkspace, validate = true) {
        const current = stateRef.current;
        const candidate = { ...mutator(current), updatedAt: nowIso() };
        const next = validate ? revalidateAdaptationWorkspace(project, candidate) : candidate;
        commit({ ...next, updatedAt: nowIso() });
    }

    function handleGeneration(generation: StudioAdaptationWorkspace["generations"][number]) {
        const current = stateRef.current;
        const exists = current.generations.some((item) => item.id === generation.id);
        const generations = exists ? current.generations.map((item) => item.id === generation.id ? generation : item) : [generation, ...current.generations].slice(0, 20);
        commit({ ...current, generations, activeGenerationId: generation.id }, true);
    }

    async function startGeneration(request: AdaptationGenerationRequest) {
        if (busy || pendingProposal) {
            message.warning(pendingProposal ? "当前有未确认提案；先接受或拒绝提案，再继续生成" : "已有生成任务在运行");
            return;
        }
        if (request.kind === "blueprint" && (!stateRef.current.strategy || !["approved", "locked"].includes(stateRef.current.strategy.reviewStatus))) {
            setTab("strategy");
            message.warning("先确认改编方案，再生成全剧蓝图");
            return;
        }
        if ((request.kind === "episodes" || request.kind === "episode_regenerate") && (!stateRef.current.blueprint || !["approved", "locked"].includes(stateRef.current.blueprint.reviewStatus))) {
            setTab("blueprint");
            message.warning("先确认全剧蓝图，再规划分集");
            return;
        }
        setBusy(true);
        const controller = new AbortController();
        controllerRef.current = controller;
        try {
            const result = await runAdaptationGeneration({
                project,
                existing: stateRef.current,
                settings: stateRef.current.settings,
                request,
                signal: controller.signal,
                onGeneration: handleGeneration,
            });
            const current = stateRef.current;
            let next: StudioAdaptationWorkspace = {
                ...current,
                generations: current.generations.some((item) => item.id === result.generation.id)
                    ? current.generations.map((item) => item.id === result.generation.id ? result.generation : item)
                    : [result.generation, ...current.generations].slice(0, 20),
            };
            if (result.proposal) {
                next = {
                    ...next,
                    proposals: [...next.proposals.filter((item) => item.id !== result.proposal!.id), result.proposal].slice(-8),
                    activeGenerationId: result.proposal.id,
                };
                setTab(result.proposal.kind === "strategy" ? "strategy" : result.proposal.kind === "blueprint" ? "blueprint" : "episodes");
                message.success("生成完成，已进入提案预览；确认后才会成为当前有效版本");
            } else if (result.error) {
                const canceled = result.generation.status === "canceled";
                if (canceled) message.info("生成已取消，未写入任何半成品");
                else message.error(`生成失败：${result.error}`);
            }
            commit({ ...next, updatedAt: nowIso() });
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            controllerRef.current = null;
            setBusy(false);
        }
    }

    function generateNext() {
        if (!analysis) {
            message.warning("还没有可用的原著分析档案");
            return;
        }
        if (!displayWorkspace.strategy) {
            setTab("strategy");
            void startGeneration({ kind: "strategy", reason: "生成短剧改编方案" });
            return;
        }
        if (!["approved", "locked"].includes(displayWorkspace.strategy.reviewStatus)) {
            setTab("strategy");
            message.info("请先在改编方案页逐条审核高风险改编并确认方案");
            return;
        }
        if (!displayWorkspace.blueprint) {
            setTab("blueprint");
            void startGeneration({ kind: "blueprint", reason: "生成全剧故事蓝图" });
            return;
        }
        if (!["approved", "locked"].includes(displayWorkspace.blueprint.reviewStatus)) {
            setTab("blueprint");
            message.info("请先确认全剧蓝图");
            return;
        }
        if (!targetComplete) {
            setTab("episodes");
            void startGeneration({ kind: "episodes", reason: displayWorkspace.episodePlans.length ? "按新目标集数重新规划全部分集" : "一次性规划全部目标集数" });
            return;
        }
        setTab("episodes");
        message.info("全部分集规划已存在，可在分集页局部重生成或调整单集");
    }

    function regenerateAllEpisodes() {
        if (!displayWorkspace.blueprint || !["approved", "locked"].includes(displayWorkspace.blueprint.reviewStatus)) {
            setTab("blueprint");
            message.warning("先确认全剧蓝图");
            return;
        }
        const estimated = estimateAdaptationGenerationCalls(displayWorkspace.settings, { kind: "episodes" });
        modal.confirm({
            title: "重新生成全部分集规划？",
            content: `目标 ${displayWorkspace.settings.targetEpisodes} 集、单集 ${displayWorkspace.settings.targetEpisodeSeconds} 秒，预计 ${estimated} 次项目文本模型调用。已锁定的集不会被覆盖；结果先进入提案预览。`,
            okText: "开始生成",
            cancelText: "取消",
            onOk: () => startGeneration({ kind: "episodes", reason: "用户重新生成全部分集规划" }),
        });
    }

    function acceptProposal() {
        if (!pendingProposal) return;
        if (highRiskPending.length) {
            setTab("strategy");
            message.warning(`还有 ${highRiskPending.length} 条高风险改编未逐条确认；请在改编方案页确认后再接受提案`);
            return;
        }
        try {
            let next = applyProposalToWorkspace(stateRef.current, pendingProposal, true);
            next = { ...revalidateAdaptationWorkspace(project, next), activeGenerationId: undefined, updatedAt: nowIso() };
            commit(next);
            setTab(pendingProposal.kind === "strategy" ? "strategy" : pendingProposal.kind === "blueprint" ? "blueprint" : "episodes");
            message.success(`提案已接受，当前版本 v${next.versionNumber}；可继续逐项审核`);
        } catch (error) {
            if (error instanceof AdaptationReviewError) {
                setTab("strategy");
                message.warning(`核心层拒绝接受：还有 ${error.changes.length} 条高风险改编未逐条确认`);
                return;
            }
            message.error(error instanceof Error ? error.message : "提案接受失败");
        }
    }

    function rejectProposal() {
        if (!pendingProposal) return;
        const next = applyProposalToWorkspace(stateRef.current, pendingProposal, false);
        commit({ ...next, activeGenerationId: undefined, updatedAt: nowIso() });
        message.info("提案已拒绝；当前有效版本没有改变");
    }

    function approveStrategy() {
        const strategy = stateRef.current.strategy;
        if (!strategy) return;
        const pending = strategy.changes.filter((change) => change.highRisk && change.reviewStatus !== "approved" && change.reviewStatus !== "locked");
        if (pending.length) {
            message.warning(`还有 ${pending.length} 条高风险改编未逐条确认，不能通过改编方案`);
            setTab("strategy");
            return;
        }
        mutate((current) => ({
            ...current,
            strategy: current.strategy ? { ...current.strategy, reviewStatus: "approved", updatedAt: nowIso() } : current.strategy,
        }));
        message.success("改编方案已通过；下一步可以生成全剧蓝图");
    }

    function lockStrategy() {
        const strategy = stateRef.current.strategy;
        if (!strategy) return;
        const pending = strategy.changes.filter((change) => change.highRisk && change.reviewStatus !== "approved" && change.reviewStatus !== "locked");
        if (pending.length) {
            message.warning(`还有 ${pending.length} 条高风险改编未确认，不能锁定改编方案`);
            return;
        }
        mutate((current) => ({ ...current, strategy: current.strategy ? { ...current.strategy, locked: true, reviewStatus: "locked", updatedAt: nowIso() } : current.strategy }));
        message.success("改编方案已锁定");
    }

    function unlockStrategy() {
        mutate((current) => ({ ...current, strategy: current.strategy ? { ...current.strategy, locked: false, reviewStatus: "approved", updatedAt: nowIso() } : current.strategy }));
        message.info("改编方案已解锁");
    }

    function saveStrategy(patch: StrategyEdit) {
        mutate((current) => current.strategy ? ({
            ...current,
            strategy: { ...current.strategy, ...patch, version: current.strategy.version + 1, reviewStatus: "pending_review", updatedAt: nowIso() },
        }) : current);
        message.success("改编方案已保存为待审核");
    }

    function approveBlueprint() {
        mutate((current) => ({
            ...current,
            blueprint: current.blueprint ? { ...current.blueprint, reviewStatus: "approved", updatedAt: nowIso() } : current.blueprint,
        }));
        message.success("全剧蓝图已通过；下一步可以一次性规划全部目标集数");
    }

    function lockBlueprint() {
        mutate((current) => ({ ...current, blueprint: current.blueprint ? { ...current.blueprint, locked: true, reviewStatus: "locked", updatedAt: nowIso() } : current.blueprint }));
        message.success("全剧蓝图已锁定");
    }

    function unlockBlueprint() {
        mutate((current) => ({ ...current, blueprint: current.blueprint ? { ...current.blueprint, locked: false, reviewStatus: "approved", updatedAt: nowIso() } : current.blueprint }));
        message.info("全剧蓝图已解锁");
    }

    function saveBlueprint(patch: BlueprintEdit) {
        mutate((current) => current.blueprint ? ({
            ...current,
            blueprint: {
                ...current.blueprint,
                ...patch,
                protagonistGoals: splitLines(patch.protagonistGoals),
                version: current.blueprint.version + 1,
                reviewStatus: "pending_review",
                updatedAt: nowIso(),
            },
        }) : current);
        message.success("全剧蓝图已保存为待审核");
    }

    function saveEpisode(episodeNumber: number, patch: EpisodeEdit) {
        mutate((current) => ({
            ...current,
            episodePlans: current.episodePlans.map((plan) => plan.episodeNumber === episodeNumber ? updateEpisodePlan(plan, patch, "用户手工编辑") : plan),
        }));
    }

    function approveEpisode(episodeNumber: number) {
        const plan = stateRef.current.episodePlans.find((item) => item.episodeNumber === episodeNumber);
        if (!plan) return;
        const blockers = stateRef.current.changes.filter((change) => change.highRisk && change.episodeNumbers.includes(episodeNumber) && change.reviewStatus !== "approved" && change.reviewStatus !== "locked");
        if (blockers.length) {
            setTab("strategy");
            message.warning(`第 ${episodeNumber} 集还有 ${blockers.length} 条高风险改编未确认`);
            return;
        }
        mutate((current) => ({ ...current, episodePlans: current.episodePlans.map((item) => item.episodeNumber === episodeNumber ? { ...item, reviewStatus: "approved", updatedAt: nowIso() } : item) }));
    }

    function lockEpisode(episodeNumber: number) {
        const plan = stateRef.current.episodePlans.find((item) => item.episodeNumber === episodeNumber);
        if (!plan) return;
        const blockers = stateRef.current.changes.filter((change) => change.highRisk && change.episodeNumbers.includes(episodeNumber) && change.reviewStatus !== "approved" && change.reviewStatus !== "locked");
        if (blockers.length) {
            message.warning(`第 ${episodeNumber} 集还有 ${blockers.length} 条高风险改编未确认，不能锁定`);
            return;
        }
        mutate((current) => ({ ...current, episodePlans: current.episodePlans.map((item) => item.episodeNumber === episodeNumber ? { ...item, locked: true, reviewStatus: "locked", updatedAt: nowIso() } : item) }));
    }

    function unlockEpisode(episodeNumber: number) {
        mutate((current) => ({ ...current, episodePlans: current.episodePlans.map((item) => item.episodeNumber === episodeNumber ? { ...item, locked: false, reviewStatus: "approved", updatedAt: nowIso() } : item) }));
    }

    function saveArc(characterId: string, patch: ArcEdit) {
        mutate((current) => ({ ...current, characterArcs: current.characterArcs.map((arc) => arc.characterId === characterId ? { ...arc, ...patch, version: arc.version + 1, reviewStatus: "pending_review", updatedAt: nowIso() } : arc) }));
        message.success("人物弧光已保存");
    }

    function confirmGeneratedReturn(characterId: string, milestoneIndex: number) {
        if (busy || pendingProposal) {
            message.warning("生成中或提案预览中不能确认人物里程碑");
            return;
        }
        const arc = stateRef.current.characterArcs.find((item) => item.characterId === characterId);
        const milestone = arc?.milestones[milestoneIndex];
        if (!arc || !milestone || milestone.type !== "return" || milestone.sourceType !== "generated") return;
        if (milestone.confirmedAt) {
            message.info("该 AI 复活事件已确认");
            return;
        }
        mutate((current) => ({
            ...current,
            characterArcs: current.characterArcs.map((item) => item.characterId === characterId ? {
                ...item,
                milestones: item.milestones.map((point, index) => index === milestoneIndex ? { ...point, confirmedAt: nowIso() } : point),
                version: item.version + 1,
                reviewStatus: "pending_review",
                updatedAt: nowIso(),
            } : item),
        }));
        message.success("已确认 AI 复活；该事件现在才能作为死亡后回归依据");
    }

    function updateForeshadowing(id: string, patch: PoolEdit) {
        mutate((current) => ({ ...current, foreshadowings: current.foreshadowings.map((item) => item.foreshadowingId === id ? { ...item, ...patch, actualResolveEpisode: patch.actualResolveEpisode ?? undefined, reviewStatus: "pending_review", updatedAt: nowIso() } : item) }));
        message.success("伏笔池已更新；未回收伏笔不会被自动标为已回收");
    }

    function approveChange(id: string, approve: boolean) {
        const proposal = pendingProposal;
        if (proposal) {
            const status = approve ? "approved" as const : "pending_review" as const;
            const sourceChanges = [...(proposal.changes ?? []), ...(proposal.strategy?.changes ?? [])];
            const changeMap = new Map(sourceChanges.map((change) => [change.adaptationChangeId, change]));
            const changes = [...changeMap.values()].map((change) => change.adaptationChangeId === id ? { ...change, reviewStatus: status } : change);
            const nextProposal: StudioAdaptationProposal = {
                ...proposal,
                changes,
                strategy: proposal.strategy ? { ...proposal.strategy, changes } : proposal.strategy,
            };
            const current = stateRef.current;
            const next = {
                ...current,
                changes: current.changes.map((change) => change.adaptationChangeId === id ? { ...change, reviewStatus: status } : change),
                strategy: current.strategy ? {
                    ...current.strategy,
                    changes: current.strategy.changes.map((change) => change.adaptationChangeId === id ? { ...change, reviewStatus: status } : change),
                } : current.strategy,
                proposals: current.proposals.map((item) => item.id === proposal.id ? nextProposal : item),
                updatedAt: nowIso(),
            };
            commit(next);
            message.success(approve ? "高风险改编已确认；接受提案前仍会按当前工作区复核" : "改编已退回待审");
            return;
        }
        mutate((current) => ({
            ...current,
            changes: current.changes.map((change) => change.adaptationChangeId === id ? { ...change, reviewStatus: approve ? "approved" as const : "pending_review" as const } : change),
            strategy: current.strategy ? {
                ...current.strategy,
                changes: current.strategy.changes.map((change) => change.adaptationChangeId === id ? { ...change, reviewStatus: approve ? "approved" as const : "pending_review" as const } : change),
            } : current.strategy,
        }));
    }

    function updateCheckStatus(checkId: string, status: StudioAdaptationCheckStatus) {
        if (pendingProposal) {
            const nextProposal = {
                ...pendingProposal,
                checks: (pendingProposal.checks ?? []).map((check) => check.id === checkId ? { ...check, status } : check),
            };
            commit({ ...stateRef.current, proposals: stateRef.current.proposals.map((item) => item.id === pendingProposal.id ? nextProposal : item), updatedAt: nowIso() });
            return;
        }
        mutate((current) => ({ ...current, checks: current.checks.map((check) => check.id === checkId ? { ...check, status } : check) }));
    }

    function regenerateFromCheck(check: StudioAdaptationWorkspace["checks"][number]) {
        const episodeNumber = check.episodeNumbers[0];
        if (!episodeNumber) {
            message.warning("这条校验项没有明确集数，请先手工处理");
            return;
        }
        setTab("episodes");
        void startGeneration({ kind: "episode_regenerate", targetNumbers: [episodeNumber], reason: check.suggestion || check.message });
    }

    if (!analysis) {
        return (
            <div className="studio-analysis studio-analysis--adaptation">
                <header className="studio-analysis__hero">
                    <div>
                        <span className="studio-analysis__eyebrow">01 · {DRAMA_STEP_LABEL.analysis} · 阶段 2B</span>
                        <h2>{project.title}</h2>
                        <p>短剧改编与分集规划必须以真实原著分析档案为依据。</p>
                    </div>
                    <div className="studio-analysis__hero-actions"><Button icon={<ArrowLeft className="size-4" />} onClick={onBack}>返回原著档案</Button></div>
                </header>
                <StudioEmpty icon={<FileSearch className="size-7" />} title="还没有原著分析档案" description="先完成第一步的原著导入与结构化分析，才能生成可追溯的改编方案和分集规划。" action={<Button type="primary" onClick={onBack}>回到原著档案</Button>} />
            </div>
        );
    }

    const tabItems = [
        { key: "settings", label: <TabLabel icon={<Settings2 className="size-3.5" />} label="改编定位" />, children: <AdaptationSettingsTab settings={displayWorkspace.settings} modelLabel={modelLabel} estimatedCalls={estimateAdaptationGenerationCalls(displayWorkspace.settings, { kind: "full" })} hasPlans={displayWorkspace.episodePlans.length > 0} disabled={busy || Boolean(pendingProposal)} onSave={(settings) => { mutate((current) => ({ ...current, settings: { ...settings, updatedAt: nowIso() } })); message.success("改编定位已保存；下一次生成会真实使用集数、时长与改编强度"); }} /> },
        { key: "strategy", label: <TabLabel icon={<GitBranch className="size-3.5" />} label="改编方案" count={displayWorkspace.strategy?.changes.length} />, children: <AdaptationStrategyTab workspace={displayWorkspace} preview={Boolean(pendingProposal)} disabled={busy} onGenerate={() => startGeneration({ kind: "strategy", reason: "重新生成改编方案" })} onSave={saveStrategy} onApprove={approveStrategy} onLock={lockStrategy} onUnlock={unlockStrategy} onApproveChange={(id) => approveChange(id, true)} onResetChange={(id) => approveChange(id, false)} /> },
        { key: "blueprint", label: <TabLabel icon={<Layers3 className="size-3.5" />} label="全剧蓝图" />, children: <AdaptationBlueprintTab workspace={displayWorkspace} preview={Boolean(pendingProposal)} disabled={busy} onGenerate={() => startGeneration({ kind: "blueprint", reason: "重新生成全剧蓝图" })} onSave={saveBlueprint} onApprove={approveBlueprint} onLock={lockBlueprint} onUnlock={unlockBlueprint} /> },
        { key: "episodes", label: <TabLabel icon={<Clapperboard className="size-3.5" />} label="分集规划" count={displayWorkspace.episodePlans.length} />, children: <AdaptationEpisodesTab workspace={displayWorkspace} preview={Boolean(pendingProposal)} disabled={busy} analysis={analysis} onGenerateEpisodes={() => startGeneration({ kind: "episodes", reason: "一次性规划全部目标集数" })} onRegenerateRange={(start, end, reason) => { setTab("episodes"); void startGeneration({ kind: "episode_regenerate", targetNumbers: rangeNumbers(start, end), reason: reason || `重生成第 ${start}-${end} 集` }); }} onRegenerateModule={(episodeNumber, module: AdaptationEpisodeModule, reason) => startGeneration({ kind: "episode_regenerate", targetNumbers: [episodeNumber], module, reason })} onSaveEpisode={saveEpisode} onApproveEpisode={approveEpisode} onLockEpisode={lockEpisode} onUnlockEpisode={unlockEpisode} /> },
        { key: "characters", label: <TabLabel icon={<Users className="size-3.5" />} label="人物弧光" count={displayWorkspace.characterArcs.length} />, children: <AdaptationCharactersTab workspace={displayWorkspace} preview={Boolean(pendingProposal)} disabled={busy} onSaveArc={saveArc} onConfirmMilestone={confirmGeneratedReturn} /> },
        { key: "foreshadowing", label: <TabLabel icon={<Network className="size-3.5" />} label="伏笔管理" count={displayWorkspace.foreshadowings.length} />, children: <AdaptationForeshadowingTab workspace={displayWorkspace} preview={Boolean(pendingProposal)} disabled={busy} onUpdate={updateForeshadowing} /> },
        { key: "checks", label: <TabLabel icon={<ListChecks className="size-3.5" />} label="剧情校验" count={displayWorkspace.checks.filter((check) => check.status === "open").length} />, children: <AdaptationChecksTab workspace={displayWorkspace} analysis={analysis} disabled={busy || Boolean(pendingProposal)} onUpdateStatus={updateCheckStatus} onRegenerateFromCheck={regenerateFromCheck} /> },
        { key: "records", label: <TabLabel icon={<BookOpenText className="size-3.5" />} label="改编记录" />, children: <AdaptationRecordsTab workspace={displayWorkspace} currentWorkspace={workspace} pending={pendingProposal} preview={Boolean(pendingProposal)} disabled={busy} projectId={project.id} analysisVersion={project.novelAnalysis?.version ?? 0} onAcceptProposal={acceptProposal} onRejectProposal={rejectProposal} onApproveChange={(id) => approveChange(id, true)} onResetChange={(id) => approveChange(id, false)} /> },
    ];

    return (
        <div className="studio-analysis studio-analysis--adaptation">
            <header className="studio-analysis__hero studio-adaptation__hero">
                <div>
                    <span className="studio-analysis__eyebrow">01 · {DRAMA_STEP_LABEL.analysis} · 阶段 2B · AI 短剧总编剧</span>
                    <h2>{project.title}</h2>
                    <p>基于原著档案做短剧化改编：改编定位、可追踪改编方案、全剧蓝图、一次性全剧分集规划、全剧记忆、伏笔池与剧情自检。这里不写正式剧本对白，也不生成分镜或媒体。</p>
                </div>
                <div className="studio-analysis__hero-actions">
                    <Button icon={<ArrowLeft className="size-4" />} onClick={onBack}>返回原著档案</Button>
                    <Button icon={<Settings2 className="size-4" />} onClick={onOpenSettings}>项目模型与设置</Button>
                    {runningGeneration ? (
                        <Button danger icon={<StopCircle className="size-4" />} onClick={() => { controllerRef.current?.abort(); message.info("正在取消生成；不会写入半成品"); }}>取消生成</Button>
                    ) : (
                        <>
                            {nextAction.kind === "generate" ? <Button type="primary" icon={<Sparkles className="size-4" />} disabled={busy || Boolean(pendingProposal)} onClick={() => void startGeneration(nextAction.request)}>{nextAction.label}</Button> : null}
                            {nextAction.kind === "focus" ? <Button type="primary" icon={<CheckCircle2 className="size-4" />} onClick={() => setTab(nextAction.tab)}>{nextAction.label}</Button> : null}
                            {nextAction.kind === "regenerate" ? <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={busy || Boolean(pendingProposal)} onClick={regenerateAllEpisodes}>{nextAction.label}</Button> : null}
                        </>
                    )}
                </div>
            </header>

            <div className="studio-analysis__statusline studio-adaptation__statusline">
                <div className="studio-adaptation__summary">
                    <div><span>目标</span><strong>{displayWorkspace.settings.targetEpisodes} 集 × {displayWorkspace.settings.targetEpisodeSeconds}s</strong></div>
                    <div><span>当前分集</span><strong>{displayWorkspace.episodePlans.length} 集</strong></div>
                    <div><span>审核进度</span><strong>{review.approved} / {review.total}</strong></div>
                    <div><span>当前版本</span><strong>v{displayWorkspace.versionNumber}</strong></div>
                    <div><span>锁定</span><strong>{displayWorkspace.blueprint?.locked ? "蓝图" : ""}{lockedEpisodeNumbers(displayWorkspace).length ? ` + ${lockedEpisodeNumbers(displayWorkspace).length} 集` : ""}</strong></div>
                </div>
                <div className="studio-analysis__model-inline"><span>项目文本模型</span><strong>{modelLabel}</strong><Tag bordered={false}>阶段 2B</Tag></div>
                <div className="studio-adaptation__review-bar" aria-label={`审核进度 ${review.percent}%`}><span style={{ width: `${review.percent}%` }} /></div>
            </div>

            {busy || runningGeneration ? <div className="studio-adaptation__running"><div><Sparkles className="size-4" /><strong>{runningGeneration?.currentLabel ?? "正在生成…"}</strong><span>项目模型真实调用，后台不会自动重发</span></div><Progress percent={runningGeneration?.progress ?? 0} status="active" /><span>{runningGeneration?.calls ?? 0} 次调用 · {(runningGeneration?.inputChars ?? 0).toLocaleString()} 字符输入</span></div> : null}

            {pendingProposal ? (
                <Alert
                    type="warning"
                    showIcon
                    className="studio-adaptation__proposal-banner"
                    message={<div className="studio-adaptation__proposal-title"><strong>提案预览：{pendingProposal.title}</strong><span>{pendingProposal.status === "pending" ? "尚未写入当前有效版本" : ""}{pendingProposal.targetEpisodeNumbers.length ? ` · 第 ${pendingProposal.targetEpisodeNumbers.join("、")} 集` : ""}</span></div>}
                    description={<div className="studio-adaptation__proposal-actions"><p>{pendingProposal.reason} · 基础版本 v{pendingProposal.baseVersion}。锁定内容不会覆盖；接受前可逐条确认高风险改编。</p>{highRiskPending.length ? <Tag bordered={false} color="error">{highRiskPending.length} 条高风险待确认</Tag> : <Tag bordered={false} color="success">高风险已确认</Tag>}<Button type="primary" icon={<CheckCircle2 className="size-4" />} onClick={acceptProposal}>接受整份提案</Button><Button icon={<TriangleAlert className="size-4" />} onClick={() => setTab("records")}>查看差异</Button><Button onClick={rejectProposal}>拒绝提案</Button></div>}
                />
            ) : null}

            {latestGeneration && !runningGeneration && latestGeneration.status !== "succeeded" ? (
                <Alert
                    type={latestGeneration.status === "failed" ? "error" : latestGeneration.status === "interrupted" || latestGeneration.status === "unknown" ? "warning" : "info"}
                    showIcon
                    message={`最近生成：${latestGeneration.currentLabel || statusText(latestGeneration.status)}`}
                    description={latestGeneration.error ? `${latestGeneration.error}${latestGeneration.status === "unknown" ? "；状态未知，系统不会自动重发" : ""}` : "任务未产生可用提案，当前有效版本没有改变。"}
                    closable
                />
            ) : null}

            {!pendingProposal && displayWorkspace.checks.filter((check) => check.level === "error" && check.status === "open").length ? <Alert type="error" showIcon message={`剧情校验有 ${displayWorkspace.checks.filter((check) => check.level === "error" && check.status === "open").length} 个 error`} description={<Button size="small" onClick={() => setTab("checks")}>查看具体集数、人物与事件</Button>} /> : null}

            {pendingProposal ? <div className="studio-adaptation__preview-note"><LockKeyhole className="size-4" /><span>当前页面展示的是提案草案，不是当前有效版本。编辑与锁定在提案确认后开放；差异与版本快照见“改编记录”。</span></div> : null}

            <Tabs className="studio-analysis-tabs studio-adaptation-tabs" activeKey={tab} onChange={setTab} items={tabItems} />
            {latestGeneration ? <div className="studio-adaptation__footer"><span>最近生成 {adaptationTime(latestGeneration.createdAt)} · {latestGeneration.model.label || modelLabel} · {latestGeneration.calls} 次调用</span><span>{review.percent}% 已审核 · 阶段 2B 只到完整分集规划</span></div> : null}
        </div>
    );
}

function reviewProgress(workspace: StudioAdaptationWorkspace) {
    const raw = adaptationReviewProgress(workspace);
    const total = 2 + workspace.settings.targetEpisodes;
    const approved = (workspace.strategy && ["approved", "locked"].includes(workspace.strategy.reviewStatus) ? 1 : 0)
        + (workspace.blueprint && ["approved", "locked"].includes(workspace.blueprint.reviewStatus) ? 1 : 0)
        + workspace.episodePlans.filter((plan) => plan.reviewStatus === "approved" || plan.reviewStatus === "locked").length;
    return { approved, total, percent: Math.min(100, Math.round((approved / total) * 100)), rawPercent: raw.percent };
}

function nextHeaderAction(workspace: StudioAdaptationWorkspace, pending: boolean, complete: boolean):
    | { kind: "generate"; label: string; request: AdaptationGenerationRequest }
    | { kind: "focus"; label: string; tab: string }
    | { kind: "regenerate"; label: string } {
    if (pending) return { kind: "focus", label: "回到待确认提案", tab: "records" };
    if (!workspace.strategy) return { kind: "generate", label: "生成改编方案", request: { kind: "strategy", reason: "生成短剧改编方案" } };
    if (!["approved", "locked"].includes(workspace.strategy.reviewStatus)) return { kind: "focus", label: "审核改编方案", tab: "strategy" };
    if (!workspace.blueprint) return { kind: "generate", label: "生成全剧蓝图", request: { kind: "blueprint", reason: "生成全剧故事蓝图" } };
    if (!["approved", "locked"].includes(workspace.blueprint.reviewStatus)) return { kind: "focus", label: "审核全剧蓝图", tab: "blueprint" };
    if (!complete) return { kind: "generate", label: workspace.episodePlans.length ? "补齐全部分集" : "生成全剧分集规划", request: { kind: "episodes", reason: workspace.episodePlans.length ? "按目标集数补齐全部分集" : "一次性规划全部目标集数" } };
    return { kind: "regenerate", label: "重新生成全部分集规划" };
}

function previewWorkspace(current: StudioAdaptationWorkspace, proposal: StudioAdaptationProposal): StudioAdaptationWorkspace {
    const plans = new Map(current.episodePlans.map((plan) => [plan.episodeNumber, plan]));
    for (const candidate of proposal.episodePlans ?? []) {
        if (plans.get(candidate.episodeNumber)?.locked) continue;
        plans.set(candidate.episodeNumber, candidate);
    }
    return {
        ...current,
        strategy: proposal.strategy && !current.strategy?.locked ? proposal.strategy : current.strategy,
        blueprint: proposal.blueprint && !current.blueprint?.locked ? proposal.blueprint : current.blueprint,
        episodePlans: [...plans.values()].sort((left, right) => left.episodeNumber - right.episodeNumber),
        characterArcs: proposal.characterArcs ?? current.characterArcs,
        foreshadowings: proposal.foreshadowings ?? current.foreshadowings,
        changes: proposal.changes ?? proposal.strategy?.changes ?? current.changes,
        checks: proposal.checks ?? current.checks,
        proposals: current.proposals,
        updatedAt: current.updatedAt,
    };
}

function updateEpisodePlan(plan: StudioEpisodePlan, patch: EpisodeEdit, reason: string): StudioEpisodePlan {
    const now = nowIso();
    return {
        ...plan,
        ...patch,
        emotionalProgression: splitLines(patch.emotionalProgression),
        continuityDependencies: splitLines(patch.continuityDependencies),
        version: plan.version + 1,
        versions: [
            ...plan.versions,
            {
                id: `${plan.episodeId}-v${plan.version}-${now}`,
                version: plan.version,
                createdAt: plan.updatedAt,
                reason,
                plan: episodePlanCore(plan),
            },
        ].slice(-5),
        reviewStatus: "pending_review",
        updatedAt: now,
    };
}

function splitLines(value: string) {
    return value.split(/\n|；|;/).map((item) => item.trim()).filter(Boolean);
}

function rangeNumbers(start: number, end: number) {
    const from = Math.max(1, Math.min(start, end));
    const to = Math.max(start, end);
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function statusText(status: string) {
    const labels: Record<string, string> = { failed: "失败", canceled: "已取消", interrupted: "已中断", unknown: "状态未知", succeeded: "已完成", running: "生成中", queued: "排队中" };
    return labels[status] ?? status;
}

function TabLabel({ icon, label, count }: { icon: React.ReactNode; label: string; count?: number }) {
    return <span className="novel-tab-label">{icon}{label}{typeof count === "number" && count > 0 ? <em>{count}</em> : null}</span>;
}
