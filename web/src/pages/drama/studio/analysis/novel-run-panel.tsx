import { Alert, Button, Progress, Tag, Tooltip } from "antd";
import { Ban, Play, RefreshCw, Settings2, Sparkles, TriangleAlert } from "lucide-react";

import type { NovelAnalysisRun, StudioNovel } from "@/types/novel";
import { NOVEL_RUN_STATUS_LABEL } from "@/types/novel";
import type { StudioProject } from "@/types/studio";

import { buildNovelChunks } from "@/lib/studio/novel-chapters";
import { estimateNovelAnalysisCalls } from "@/lib/studio/novel-merge";
import { StudioPanel } from "../ui";

export function NovelRunPanel({
    project,
    novel,
    activeRun,
    runs,
    busy,
    onStart,
    onRetry,
    onCancel,
    onOpenSettings,
}: {
    project: StudioProject;
    novel: StudioNovel;
    activeRun?: NovelAnalysisRun;
    runs: NovelAnalysisRun[];
    busy: boolean;
    onStart: () => void;
    onRetry: (run: NovelAnalysisRun) => void;
    onCancel: () => void;
    onOpenSettings: () => void;
}) {
    const chunks = buildNovelChunks(novel.chapters);
    const estimated = estimateNovelAnalysisCalls(chunks.length);
    const latestRun = activeRun ?? runs[0];
    const canRetry = latestRun && ["failed", "cancelled", "interrupted", "unknown"].includes(latestRun.status);
    const hasAnalysis = Boolean(project.novelAnalysis);
    const run = latestRun;
    return (
        <StudioPanel
            title="分析任务"
            extra={<Tag bordered={false} color={activeRun ? "processing" : project.novelAnalysis?.status === "complete" ? "success" : "default"}>{activeRun ? "运行中" : project.novelAnalysis?.status === "complete" ? "已完成" : "未完成"}</Tag>}
        >
            <div className="novel-run">
                <div className="novel-run__estimate">
                    <div><span>分块</span><strong>{chunks.length}</strong></div>
                    <div><span>预计调用</span><strong>{estimated}</strong></div>
                    <div><span>模型</span><strong>{run?.model.label ?? project.novelAnalysis?.model.label ?? "项目文本模型"}</strong></div>
                </div>
                {chunks.length > 24 ? (
                    <Alert
                        type="warning"
                        showIcon
                        icon={<TriangleAlert className="size-4" />}
                        message={`本次将至少调用 ${estimated} 次模型`}
                        description="长篇小说会产生较多请求与额度消耗；任务按分块保存，可取消后继续，但已经完成的调用不会退还。"
                    />
                ) : null}
                {run ? (
                    <div className="novel-run__progress">
                        <div className="novel-run__progress-head">
                            <div>
                                <Tag bordered={false} color={run.status === "failed" ? "error" : run.status === "succeeded" ? "success" : "processing"}>{NOVEL_RUN_STATUS_LABEL[run.status]}</Tag>
                                <strong>{run.currentLabel}</strong>
                            </div>
                            <span>{run.chunksDone}/{run.chunksTotal} 块 · 版本 v{run.resultVersion ?? "—"}</span>
                        </div>
                        <Progress percent={run.progress} status={run.status === "failed" ? "exception" : run.status === "succeeded" ? "success" : "active"} />
                        {run.error ? <Alert type={run.status === "failed" ? "error" : "warning"} showIcon message={run.error} /> : null}
                        <div className="novel-run__chunks">
                            {run.chunks.map((chunk) => (
                                <Tooltip key={chunk.id} title={chunk.error ?? `${chunk.chapterIds.length} 个章节引用`}>
                                    <span className={`novel-run__chunk is-${chunk.status}`}>{chunk.index + 1}</span>
                                </Tooltip>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="novel-run__empty">
                        <Sparkles className="size-6" />
                        <strong>原文已就绪，等待开始分析</strong>
                        <p>将按章节分块提取人物、关系、世界观、地点、事件因果与伏笔；每块带证据，再全局汇总与跨章节校验。</p>
                    </div>
                )}

                <div className="novel-run__actions">
                    {activeRun ? (
                        <Button danger icon={<Ban className="size-4" />} onClick={onCancel} disabled={!activeRun || busy}>取消分析</Button>
                    ) : canRetry ? (
                        <Button type="primary" icon={<RefreshCw className="size-4" />} onClick={() => onRetry(latestRun)} disabled={busy}>继续 / 重试失败分块</Button>
                    ) : (
                        <Button type="primary" icon={<Play className="size-4" />} onClick={onStart} disabled={busy}>{hasAnalysis ? "重新分析" : "开始原著分析"}</Button>
                    )}
                    <Button icon={<Settings2 className="size-4" />} onClick={onOpenSettings}>项目文本模型与参数</Button>
                </div>
                <p className="novel-run__note">
                    刷新或关闭页面后，进行中的浏览器请求无法在服务端恢复；任务会标为“已中断”，并保留成功分块，不会自动重新提交或重复扣费。
                </p>

                {runs.length > 1 ? (
                    <details className="novel-run__history">
                        <summary>历史任务（{runs.length}）</summary>
                        {runs.slice(0, 20).map((item) => (
                            <div key={item.id}>
                                <span>v{item.resultVersion ?? "—"} · {new Date(item.startedAt).toLocaleString()}</span>
                                <Tag bordered={false}>{NOVEL_RUN_STATUS_LABEL[item.status]}</Tag>
                                <small>{item.model.label} · {item.chunksDone}/{item.chunksTotal} 块</small>
                            </div>
                        ))}
                    </details>
                ) : null}
            </div>
        </StudioPanel>
    );
}
