import { Alert, App, Button, Input, Modal, Tabs, Tag, Tooltip } from "antd";
import { BookOpenText, FileText, Settings2, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { modelOptionLabel, useConfigStore } from "@/stores/use-config-store";
import { useStudioStore } from "@/stores/use-studio-store";
import type { NovelAnalysisRun, NovelImportProgress, StudioNovel } from "@/types/novel";
import { NOVEL_RUN_STATUS_LABEL } from "@/types/novel";
import { DRAMA_STEP_LABEL, DRAMA_STEP_NUMBER, type StudioProject } from "@/types/studio";

import { dramaModelParams, projectModelOption, projectModelSelection } from "@/lib/studio/model-profile";
import { createNovelAnalysisRun, executeNovelAnalysis, isActiveAnalysisRun, prepareRetryRun } from "@/lib/studio/novel-analysis-runner";
import { makeFailedNovel, makePastedNovel, parseNovelFile } from "@/lib/studio/novel-import";
import { applyNovelAnalysisOverrides } from "@/lib/studio/novel-merge";
import { novelModelParameters, novelTextModelRuntime, type NovelModelParameter } from "@/lib/studio/novel-model";
import { StudioAdaptationWorkspace } from "./adaptation";
import { NovelImportPanel } from "./analysis/novel-import-panel";
import { NovelReader } from "./analysis/novel-reader";
import { NovelRunPanel } from "./analysis/novel-run-panel";
import { AnalysisEmpty, AnalysisStatsSection, CharactersSection, EventsSection, ForeshadowingSection, OverviewSection, RelationshipsSection, ScenesSection, WorldSection, type OverrideKind } from "./analysis/analysis-results";
import { StudioPanel, StudioStepProgress } from "./ui";

const PROJECT_STATUS_LABEL: Record<string, string> = {
    draft: "草稿",
    importing: "导入中",
    analyzing: "分析中",
    analysis_ready: "分析完成",
    assets_generating: "资产生成中",
    assets_review: "资产待确认",
    scripting: "剧本生成中",
    storyboarding: "分镜生成中",
    keyframes_generating: "关键帧生成中",
    storyboard_review: "分镜待审核",
    video_generating: "视频生成中",
    completed: "已完成",
    paused: "已暂停",
    failed: "失败",
};

/**
 * 阶段 2A 第一步：小说原文、原著结构化分析与人工审核。
 * 这里只做原著事实与证据；短剧化改编、分集规划留给阶段 2B。
 */
export function StudioAnalysisWorkspace({ project, onOpenSettings }: { project: StudioProject; onOpenSettings: () => void }) {
    const { message, modal } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const setNovel = useStudioStore((state) => state.setNovel);
    const deleteNovel = useStudioStore((state) => state.deleteNovel);
    const setNovelAnalysis = useStudioStore((state) => state.setNovelAnalysis);
    const upsertAnalysisRun = useStudioStore((state) => state.upsertAnalysisRun);
    const updateAnalysisRun = useStudioStore((state) => state.updateAnalysisRun);
    const setAnalysisRunId = useStudioStore((state) => state.setAnalysisRunId);
    const setStepState = useStudioStore((state) => state.setStepState);
    const setProjectStatus = useStudioStore((state) => state.setProjectStatus);
    const updateOverrides = useStudioStore((state) => state.updateNovelAnalysisOverrides);
    const [tab, setTab] = useState("reader");
    const [mode, setMode] = useState<"archive" | "adaptation">("archive");
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState<NovelImportProgress | null>(null);
    const [importError, setImportError] = useState("");
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState("");
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState("");
    const [supportedParams, setSupportedParams] = useState<NovelModelParameter[]>([]);
    const [paramWarnings, setParamWarnings] = useState<string[]>([]);
    const abortRef = useRef<AbortController | null>(null);
    const novel = project.novel?.status === "ready" ? project.novel : project.novel;
    const analysis = project.novelAnalysis ? applyNovelAnalysisOverrides(project.novelAnalysis, project.novelAnalysisOverrides) : undefined;
    const activeRun = useMemo(() => {
        const runs = project.analysisRuns ?? [];
        return runs.find((run) => run.id === project.analysisRunId && isActiveAnalysisRun(run)) ?? runs.find((run) => isActiveAnalysisRun(run));
    }, [project.analysisRuns, project.analysisRunId]);
    const latestRun = project.analysisRuns?.[0];
    const textOption = projectModelOption(project, "text", config);
    const textSelection = projectModelSelection(project, "text");
    const textParamValues = textSelection ? dramaModelParams(project.modelProfiles, "text", textSelection) : {};
    // accountId 是内置桥接模型的账号选择，不是温度/输出上限参数，不应触发“无效参数”警告。
    const textParamKeys = Object.keys(textParamValues).filter((key) => key !== "accountId");

    useEffect(() => {
        let cancelled = false;
        void novelModelParameters(project, config).then((result) => {
            if (cancelled) return;
            setSupportedParams(result.parameters);
            setParamWarnings(result.warnings);
        });
        return () => {
            cancelled = true;
        };
    }, [project.id, project.modelProfiles, config]);

    useEffect(() => {
        if (!novel && tab !== "reader") setTab("reader");
    }, [novel, tab]);

    if (mode === "adaptation") {
        return <StudioAdaptationWorkspace project={project} onBack={() => setMode("archive")} onOpenSettings={onOpenSettings} />;
    }

    const saveOverride = (kind: OverrideKind, id: string, patch: Record<string, unknown>) => {
        updateOverrides(project.id, (current) => {
            if (kind === "profile" || kind === "world") return { ...current, [kind]: { ...(current[kind] ?? {}), ...patch } };
            const map = current[kind] as Record<string, Record<string, unknown>>;
            return { ...current, [kind]: { ...map, [id]: { ...(map[id] ?? {}), ...patch } } };
        });
    };

    const resetOverride = (kind: OverrideKind, id: string) => {
        updateOverrides(project.id, (current) => {
            if (kind === "profile" || kind === "world") return { ...current, [kind]: undefined };
            const next = { ...(current[kind] as Record<string, unknown>) };
            delete next[id];
            return { ...current, [kind]: next };
        });
        message.success("已恢复 AI 原始结果");
    };

    async function commitNovel(nextNovel: StudioNovel, sourceLabel: string) {
        if (novel?.status === "ready" && novel.file.hash === nextNovel.file.hash) {
            message.info("这本书已经导入，原文和分析保持不变");
            return false;
        }
        if (novel?.status === "ready" && novel.file.hash !== nextNovel.file.hash) {
            const confirmed = await confirmReplace();
            if (!confirmed) return false;
            setNovel(project.id, nextNovel);
            setStepState(project.id, "analysis", "pending");
            setProjectStatus(project.id, "draft");
            message.success(`已替换为${sourceLabel}；旧分析、任务和人工修正已清空`);
            return true;
        }
        setNovel(project.id, nextNovel);
        setStepState(project.id, "analysis", "pending");
        setProjectStatus(project.id, "draft");
        message.success(`${sourceLabel}已导入，共 ${nextNovel.chapterCount} 章`);
        return true;
    }

    function confirmReplace() {
        return new Promise<boolean>((resolve) => {
            modal.confirm({
                title: "替换当前小说原文？",
                content: "旧原文、旧 AI 分析、分析任务和旧人工修正都会被清空；新原文将从零建立档案。原文与分析都不会被静默覆盖。",
                okText: "确认替换",
                cancelText: "取消",
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });
    }

    const handleFile = async (file: File) => {
        if (importing || busy) return;
        setImporting(true);
        setImportError("");
        setProgress({ stage: "reading", percent: 2, message: `准备读取 ${file.name}…` });
        try {
            const parsed = await parseNovelFile(file, setProgress);
            setProgress({ stage: "done", percent: 100, message: "导入完成" });
            await commitNovel(parsed, "小说文件");
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            setImportError(reason);
            if (!novel || novel.status !== "ready") setNovel(project.id, makeFailedNovel(file, error));
            if (!novel || novel.status !== "ready") setStepState(project.id, "analysis", "failed");
        } finally {
            setImporting(false);
            window.setTimeout(() => setProgress(null), 1200);
        }
    };

    const handlePaste = async () => {
        if (!pasteText.trim()) {
            message.warning("粘贴正文为空");
            return;
        }
        try {
            const parsed = makePastedNovel(pasteText);
            const committed = await commitNovel(parsed, "粘贴正文");
            if (committed) {
                setPasteOpen(false);
                setPasteText("");
            }
        } catch (error) {
            setImportError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleDelete = () => {
        modal.confirm({
            title: "删除小说原文和全部分析？",
            content: "会同时删除该项目的原文、分析版本、分析任务和人工修正。此操作不可撤销，不会影响其他项目。",
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: () => {
                deleteNovel(project.id);
                setTab("reader");
                setImportError("");
                message.success("小说原文与全部分析已删除");
            },
        });
    };

    async function beginAnalysis(retry?: NovelAnalysisRun) {
        if (!novel || novel.status !== "ready") {
            message.warning("先导入可解析的小说原文");
            return;
        }
        if (busy || activeRun) {
            message.warning("当前项目已有分析任务在运行，不能重复提交");
            return;
        }
        if (retry && (retry.novelHash !== novel.file.hash || retry.novelId !== novel.id)) {
            message.error("旧任务与当前原文不一致，请重新分析");
            return;
        }
        setBusy(true);
        setActionError("");
        let createdRun: NovelAnalysisRun | undefined;
        try {
            const runtime = await novelTextModelRuntime(project);
            const version = (project.novelAnalysis?.version ?? 0) + 1;
            const run = retry ? prepareRetryRun(retry, runtime) : createNovelAnalysisRun({ novel, runtime, existingVersion: project.novelAnalysis?.version });
            createdRun = run;
            upsertAnalysisRun(project.id, run);
            setAnalysisRunId(project.id, run.id);
            setStepState(project.id, "analysis", "running");
            setProjectStatus(project.id, "analyzing");
            abortRef.current = new AbortController();
            const result = await executeNovelAnalysis({
                novel,
                run,
                runtime,
                version,
                signal: abortRef.current.signal,
                callbacks: {
                    onRun: (next) => upsertAnalysisRun(project.id, next),
                    onAnalysis: (nextAnalysis) => {
                        setNovelAnalysis(project.id, nextAnalysis);
                        setStepState(project.id, "analysis", nextAnalysis.status === "complete" ? "completed" : "partial");
                        setProjectStatus(project.id, "analysis_ready");
                    },
                },
            });
            if (result.run.status === "cancelled") {
                setStepState(project.id, "analysis", "paused");
                setProjectStatus(project.id, "paused");
                message.info("分析已取消；成功分块已保存，可稍后继续");
            } else if (result.run.status === "failed") {
                setStepState(project.id, "analysis", result.analysis ? "partial" : "failed");
                setProjectStatus(project.id, result.analysis ? "paused" : "failed");
                message.warning(result.run.error ?? "分析未完整完成，可重试失败分块");
            } else {
                setStepState(project.id, "analysis", "completed");
                setProjectStatus(project.id, "analysis_ready");
                message.success("原著分析完成，请审核证据与人工修正");
            }
            if (result.analysis) setTab("overview");
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            setActionError(reason);
            if (createdRun) updateAnalysisRun(project.id, createdRun.id, { status: "failed", error: reason, currentLabel: "分析任务失败", finishedAt: new Date().toISOString() });
            if (project.novelAnalysis) {
                setStepState(project.id, "analysis", project.novelAnalysis.status === "complete" ? "completed" : "partial");
                setProjectStatus(project.id, "paused");
            } else {
                setStepState(project.id, "analysis", "failed");
                setProjectStatus(project.id, "failed");
            }
            message.error(reason);
        } finally {
            setBusy(false);
            abortRef.current = null;
        }
    }

    const handleCancel = () => {
        if (!activeRun) return;
        updateAnalysisRun(project.id, activeRun.id, { status: "cancelling", currentLabel: "正在取消请求…" });
        abortRef.current?.abort();
        message.info("已请求取消；服务端是否停止计费取决于模型接口，未完成的本地请求会立即中断");
    };

    const noNovel = !novel || novel.status === "failed" || !novel.chapters.length;
    const readerContent = (
        <div className="novel-reader-wrap">
            <NovelImportPanel novel={novel} importing={importing} progress={progress} error={importError} onFile={(file) => void handleFile(file)} onPaste={() => setPasteOpen(true)} onDelete={handleDelete} onDismiss={() => setImportError("")} />
            {novel?.status === "ready" && novel.chapters.length ? <NovelReader novel={novel} /> : null}
        </div>
    );

    const sectionProps = analysis && novel ? {
        project,
        novel,
        analysis,
        overrides: project.novelAnalysisOverrides,
        saveOverride,
        resetOverride,
    } : null;

    const tabItems = [
        { key: "reader", label: <TabLabel icon={<FileText className="size-3.5" />} label="原文与章节" count={novel?.chapterCount} />, children: readerContent },
        {
            key: "overview",
            label: <TabLabel icon={<BookOpenText className="size-3.5" />} label="档案总览" />,
            disabled: !analysis,
            children: sectionProps ? <OverviewSection {...sectionProps} onStart={() => void beginAnalysis()} /> : <AnalysisEmpty onStart={novel?.status === "ready" ? () => void beginAnalysis() : undefined} />,
        },
        { key: "characters", label: <TabLabel icon={<BookOpenText className="size-3.5" />} label="人物档案" count={analysis?.characters.length} />, disabled: !analysis, children: sectionProps ? <CharactersSection {...sectionProps} /> : null },
        { key: "relationships", label: <TabLabel icon={<BookOpenText className="size-3.5" />} label="人物关系" count={analysis?.relationships.length} />, disabled: !analysis, children: sectionProps ? <RelationshipsSection {...sectionProps} /> : null },
        { key: "world", label: <TabLabel icon={<BookOpenText className="size-3.5" />} label="世界观" count={analysis?.world.entries.length} />, disabled: !analysis, children: sectionProps ? <WorldSection {...sectionProps} /> : null },
        { key: "scenes", label: <TabLabel icon={<BookOpenText className="size-3.5" />} label="地点场景" count={analysis?.scenes.length} />, disabled: !analysis, children: sectionProps ? <ScenesSection {...sectionProps} /> : null },
        { key: "events", label: <TabLabel icon={<BookOpenText className="size-3.5" />} label="事件与因果" count={analysis?.events.length} />, disabled: !analysis, children: sectionProps ? <EventsSection {...sectionProps} /> : null },
        { key: "foreshadowings", label: <TabLabel icon={<BookOpenText className="size-3.5" />} label="伏笔与悬念" count={analysis?.foreshadowings.length} />, disabled: !analysis, children: sectionProps ? <ForeshadowingSection {...sectionProps} /> : null },
        { key: "tasks", label: <TabLabel icon={<Sparkles className="size-3.5" />} label="分析任务" />, children: <AnalysisTasks project={project} novel={novel} activeRun={activeRun} latestRun={latestRun} sectionProps={sectionProps} supportedParams={supportedParams} paramWarnings={paramWarnings} textModelLabel={textOption ? modelOptionLabel(config, textOption) : "未选择"} textParamKeys={textParamKeys} textParamValues={textParamValues} busy={busy} onStart={() => void beginAnalysis()} onRetry={(run) => void beginAnalysis(run)} onCancel={handleCancel} onOpenSettings={onOpenSettings} onStats={() => setTab("overview")} /> },
    ];

    return (
        <div className="studio-analysis studio-analysis--novel">
            <header className="studio-analysis__hero">
                <div>
                    <span className="studio-analysis__eyebrow">01 · {DRAMA_STEP_LABEL.analysis} · 阶段 2A</span>
                    <h2>{project.title}</h2>
                    <p>导入小说，提取可追溯的原著档案：人物身份、关系、世界观、地点、事件因果与伏笔。短剧化改编和分集规划不在本阶段生成。</p>
                </div>
                <div className="studio-analysis__hero-actions">
                    <Tag bordered={false} color={activeRun ? "processing" : project.novelAnalysis?.status === "complete" ? "success" : "default"}>{PROJECT_STATUS_LABEL[project.projectStatus] ?? project.projectStatus}</Tag>
                    {analysis ? <Button icon={<Sparkles className="size-4" />} onClick={() => setMode("adaptation")}>短剧改编 · 2B</Button> : null}
                    <Button icon={<Settings2 className="size-4" />} onClick={onOpenSettings}>项目模型与设置</Button>
                    {novel?.status === "ready" ? (
                        activeRun ? (
                            <Button danger onClick={handleCancel}>取消分析</Button>
                        ) : (
                            <Button type="primary" icon={<Sparkles className="size-4" />} onClick={() => void beginAnalysis(latestRun && ["failed", "cancelled", "interrupted", "unknown"].includes(latestRun.status) ? latestRun : undefined)} disabled={busy}>
                                {project.novelAnalysis ? "重新分析" : "开始原著分析"}
                            </Button>
                        )
                    ) : null}
                </div>
            </header>

            <div className="studio-analysis__statusline">
                <StudioStepProgress project={project} activeStep="analysis" />
                <div className="studio-analysis__model-inline">
                    <span>项目文本模型</span>
                    <strong>{textOption ? modelOptionLabel(config, textOption) : "未选择"}</strong>
                    {paramWarnings[0] ? <Tooltip title={paramWarnings[0]}><TriangleAlert className="size-3.5" /></Tooltip> : null}
                </div>
            </div>

            {actionError ? <Alert type="error" showIcon message="分析任务未启动" description={actionError} closable onClose={() => setActionError("")} /> : null}
            {project.novelAnalysis && project.novelAnalysis.status === "partial" ? <Alert type="warning" showIcon message="当前是部分完成的分析" description="只展示已成功分块与已提取证据；失败分块可在“分析任务”里继续，不会把缺失章节标成完整。" /> : null}

            <Tabs className="studio-analysis-tabs" activeKey={tab} onChange={setTab} items={tabItems} />
            {noNovel && tab !== "reader" ? <Alert type="info" showIcon message="先导入小说原文" description="URL 与标签状态可以切换，但分析、阅读和审核都以真实原文为前提。" /> : null}

            <Modal open={pasteOpen} title="粘贴小说正文" width={760} okText="导入并解析" cancelText="取消" onOk={() => void handlePaste()} onCancel={() => setPasteOpen(false)} destroyOnHidden>
                <p className="novel-paste-hint">直接粘贴全文（支持章节标题）。阶段 2A 不在这里做改编或分集规划；原文会单独保存，粘贴内容不会覆盖已有分析。</p>
                <Input.TextArea rows={14} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={"第一章 …\n\n正文…"} />
                <small className="novel-muted">{pasteText.length.toLocaleString()} 字 · 单次粘贴上限 20 MB</small>
            </Modal>
        </div>
    );
}

function TabLabel({ icon, label, count }: { icon: ReactNode; label: string; count?: number }) {
    return <span className="novel-tab-label">{icon}{label}{typeof count === "number" && count > 0 ? <em>{count}</em> : null}</span>;
}

function AnalysisTasks({
    project,
    novel,
    activeRun,
    latestRun,
    sectionProps,
    supportedParams,
    paramWarnings,
    textModelLabel,
    textParamKeys,
    textParamValues,
    busy,
    onStart,
    onRetry,
    onCancel,
    onOpenSettings,
    onStats,
}: {
    project: StudioProject;
    novel?: StudioNovel;
    activeRun?: NovelAnalysisRun;
    latestRun?: NovelAnalysisRun;
    sectionProps: Parameters<typeof AnalysisStatsSection>[0] | null;
    supportedParams: NovelModelParameter[];
    paramWarnings: string[];
    textModelLabel: string;
    textParamKeys: string[];
    textParamValues: Record<string, string | number | boolean>;
    busy: boolean;
    onStart: () => void;
    onRetry: (run: NovelAnalysisRun) => void;
    onCancel: () => void;
    onOpenSettings: () => void;
    onStats: () => void;
}) {
    return (
        <div className="novel-tasks-layout">
            {novel?.status === "ready" ? (
                <NovelRunPanel project={project} novel={novel} activeRun={activeRun} runs={project.analysisRuns ?? []} busy={busy} onStart={onStart} onRetry={onRetry} onCancel={onCancel} onOpenSettings={onOpenSettings} />
            ) : (
                <StudioPanel title="分析任务" extra="等待原文">
                    <div className="novel-analysis-empty"><FileText className="size-7" /><strong>先导入小说</strong><p>分析任务不会在空原文上创建，也不会用假数据占位。</p></div>
                </StudioPanel>
            )}
            <StudioPanel title="项目文本模型与参数" extra={<Tag bordered={false}>项目级</Tag>}>
                <div className="novel-model-summary">
                    <span>当前模型</span>
                    <strong>{project.novelAnalysis?.model.label ?? textModelLabel}</strong>
                    <p>模型选择来自本项目 modelProfiles；不会因为切换项目而读取全局选中模型，也不写入全局 AiConfig。</p>
                </div>
                <div className="novel-model-params">
                    {supportedParams.length ? supportedParams.map((parameter) => (
                        <div key={parameter.key}>
                            <span>{parameter.label}</span>
                            <strong>{String(textParamValues[parameter.key] ?? parameter.defaultValue)}</strong>
                            <small>{parameter.description}</small>
                        </div>
                    )) : <p className="novel-muted">{paramWarnings[0] ?? "当前模型未声明可调参数；只使用模型默认参数。"}</p>}
                </div>
                {textParamKeys.length && !supportedParams.length ? <Alert type="warning" showIcon message="项目里保存了参数，但当前模型没有这些参数声明" description="分析请求不会发送未经声明的参数；旧参数仍保留在项目中。" /> : null}
                <Button onClick={onOpenSettings} icon={<Settings2 className="size-4" />}>修改模型 / 参数</Button>
            </StudioPanel>
            {sectionProps ? <AnalysisStatsSection {...sectionProps} /> : null}
            {project.novelAnalysis ? (
                <StudioPanel title="下一步" extra="阶段 2A 边界">
                    <div className="novel-next-note"><strong>原著档案审核完成后，阶段 2A 到此停止。</strong><p>不会自动生成分集剧本、角色图、场景图、分镜或视频；阶段 2B 的短剧化改编与全剧分集规划需要你明确批准后才会开始。</p><Button onClick={onStats}>查看分析总览</Button></div>
                </StudioPanel>
            ) : null}
        </div>
    );
}
