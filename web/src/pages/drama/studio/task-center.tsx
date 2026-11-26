import { useMemo, useState } from "react";
import { App, Button, Drawer, Empty, Popconfirm, Segmented, Select, Tag, Tooltip } from "antd";
import { ListChecks, RefreshCcw, Square, Trash2 } from "lucide-react";

import { rerunStudioTask } from "@/lib/studio/actions";
import { useStudioTasks } from "@/stores/use-studio-tasks";
import type { StudioTask, StudioTaskKind } from "@/types/studio";

import { StudioMediaPreview, StudioStatus } from "./ui";

// 全局任务中心：图片/视频/声音/文本任务统一列表，支持取消等待、重试、看参数与产物。
// 取消只停止前端等待；视频远端任务可能仍在运行，界面会明确提示。

const KIND_LABEL: Record<StudioTaskKind, string> = {
    text: "文本",
    image: "图片",
    video: "视频",
    audio: "声音",
    analysis: "分析",
    agent: "Agent",
};

export function StudioTaskCenter({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: string }) {
    const { message } = App.useApp();
    const tasks = useStudioTasks((state) => state.tasks);
    const maxConcurrent = useStudioTasks((state) => state.maxConcurrent);
    const setMaxConcurrent = useStudioTasks((state) => state.setMaxConcurrent);
    const cancel = useStudioTasks((state) => state.cancel);
    const confirmCancelled = useStudioTasks((state) => state.confirmCancelled);
    const remove = useStudioTasks((state) => state.remove);
    const clearFinished = useStudioTasks((state) => state.clearFinished);
    const [scope, setScope] = useState<"all" | "project">("all");
    const [kind, setKind] = useState<"all" | StudioTaskKind>("all");
    const [expanded, setExpanded] = useState<string | null>(null);

    const visible = useMemo(
        () =>
            tasks.filter((task) => (scope === "all" || !projectId || task.projectId === projectId) && (kind === "all" || task.kind === kind)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        [tasks, scope, projectId, kind],
    );
    const running = tasks.filter((task) => task.status === "running" || task.status === "submitting" || task.status === "cancelling").length;
    const queued = tasks.filter((task) => task.status === "queued").length;

    const retry = async (task: StudioTask) => {
        message.loading({ content: "正在重新执行…", key: `task-${task.id}` });
        const result = await rerunStudioTask(task);
        if (result.ok) message.success({ content: result.taskId ? "已提交新任务" : "已重新执行", key: `task-${task.id}` });
        else message.error({ content: result.error ?? "重新执行失败", key: `task-${task.id}` });
    };

    return (
        <Drawer
            title={
                <div className="studio-task-title">
                    <span>
                        <ListChecks className="size-4" /> 全局任务中心
                    </span>
                    <Tag bordered={false}>{running} 运行 / {queued} 排队</Tag>
                </div>
            }
            open={open}
            onClose={onClose}
            width={560}
            className="studio-task-drawer"
            extra={
                <Tooltip title="同时运行的生成任务上限；超出的任务会排队">
                    <Select
                        size="small"
                        value={maxConcurrent}
                        style={{ width: 110 }}
                        onChange={(value) => {
                            setMaxConcurrent(value);
                            message.success("并发上限已更新");
                        }}
                        options={[1, 2, 3, 4, 5, 6].map((value) => ({ value, label: `并发 ${value}` }))}
                    />
                </Tooltip>
            }
        >
            <div className="studio-task-toolbar">
                <Segmented
                    size="small"
                    value={scope}
                    onChange={(value) => setScope(value as "all" | "project")}
                    options={[
                        { value: "all", label: "全部项目" },
                        { value: "project", label: "当前项目" },
                    ]}
                />
                <Select size="small" value={kind} onChange={setKind} style={{ width: 110 }} options={[{ value: "all", label: "全部类型" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))]} />
                <Popconfirm title="清空已结束任务？" description="只清理成功/失败/取消的记录，运行中的任务不受影响。" onConfirm={clearFinished} okText="清理">
                    <Button size="small" danger type="text">
                        清理已结束
                    </Button>
                </Popconfirm>
            </div>

            {!visible.length ? (
                <Empty description="还没有任务。生成画面、视频或配音后，这里会记录真实状态。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
                <div className="studio-task-list">
                    {visible.map((task) => {
                        const active = expanded === task.id;
                        return (
                            <article key={task.id} className={`studio-task-row is-${task.status}${active ? " is-expanded" : ""}`}>
                                <div className="studio-task-row__main">
                                    <div className="studio-task-row__head">
                                        <strong>{task.label}</strong>
                                        <span className="studio-task-row__tags">
                                            <Tag bordered={false}>{KIND_LABEL[task.kind]}</Tag>
                                            <StudioStatus status={task.status} />
                                        </span>
                                    </div>
                                    <div className="studio-task-row__meta">
                                        <span>{new Date(task.createdAt).toLocaleString("zh-CN")}</span>
                                        {task.model ? <span>{task.model}</span> : null}
                                        {task.accountName ? <span>{task.accountName}</span> : null}
                                        <span>{task.costCents ? `¥${(task.costCents / 100).toFixed(2)}` : "本地任务 · 未计费"}</span>
                                    </div>
                                    {task.error ? <p className="studio-task-row__error">{task.error}</p> : null}
                                    {task.note ? <p className="studio-task-row__note">{task.note}</p> : null}
                                    {task.status === "running" || task.status === "cancelling" ? typeof task.progress === "number" ? (
                                        <div className="studio-task-row__progress">
                                            <span style={{ width: `${task.progress}%` }} />
                                        </div>
                                    ) : null : null}
                                    {task.outputKey ? (
                                        <div className="studio-task-row__output">
                                            <StudioMediaPreview storageKey={task.outputKey} kind={task.kind === "video" ? "video" : task.kind === "audio" ? "audio" : "image"} controls />
                                        </div>
                                    ) : null}
                                </div>
                                <div className="studio-task-row__actions">
                                    {task.status === "cancelling" ? (
                                        <Popconfirm
                                            title="确认远端已停止？"
                                            description="当前没有后端取消确认 API。此操作只记录「用户人工核验」，不会冒充 API 确认；只有在你已核对远端任务确实停止后才继续。"
                                            okText="记录人工核验"
                                            cancelText="继续等待"
                                            onConfirm={() => confirmCancelled(task.id, { by: "local-user", method: "manual", note: "用户人工核验：已核对远端停止" })}
                                        >
                                            <Button size="small" icon={<Square className="size-3.5" />}>
                                                确认已取消
                                            </Button>
                                        </Popconfirm>
                                    ) : task.status === "submitting" || task.status === "running" || task.status === "queued" ? (
                                        <Tooltip title="停止前端等待；远程视频任务可能仍在运行">
                                            <Button size="small" icon={<Square className="size-3.5" />} onClick={() => cancel(task.id)}>
                                                取消
                                            </Button>
                                        </Tooltip>
                                    ) : task.status === "unknown" ? (
                                        <Popconfirm
                                            title="远端结果未知，确认重新执行？"
                                            description="当前后端没有任务查询接口，无法确认远端是否已接受或已扣费；重新执行可能产生重复提交。请先在远端核对，再明确决定。"
                                            okText="确认有重复风险，重试"
                                            cancelText="取消"
                                            onConfirm={() => void retry(task)}
                                        >
                                            <Button size="small" danger icon={<RefreshCcw className="size-3.5" />}>
                                                确认重试
                                            </Button>
                                        </Popconfirm>
                                    ) : (
                                        <Button size="small" icon={<RefreshCcw className="size-3.5" />} onClick={() => void retry(task)}>
                                            重新执行
                                        </Button>
                                    )}
                                    <Button size="small" type="text" onClick={() => setExpanded(active ? null : task.id)}>
                                        {active ? "收起" : "详情"}
                                    </Button>
                                    <Popconfirm title="删除这条任务记录？" onConfirm={() => remove(task.id)} okText="删除">
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                                    </Popconfirm>
                                </div>
                                {active ? (
                                    <div className="studio-task-row__details">
                                        {task.prompt ? (
                                            <label>
                                                <span>提交内容</span>
                                                <pre>{task.prompt}</pre>
                                            </label>
                                        ) : null}
                                        {task.params && Object.keys(task.params).length ? (
                                            <label>
                                                <span>实际参数</span>
                                                <pre>{JSON.stringify(task.params, null, 2)}</pre>
                                            </label>
                                        ) : null}
                                        {task.promptVersion || task.modelSnapshot ? (
                                            <label>
                                                <span>提交快照</span>
                                                <pre>{JSON.stringify({ promptVersion: task.promptVersion, model: task.modelSnapshot, submitState: task.submitState, submitStartedAt: task.submitStartedAt, submitConfirmedAt: task.submitConfirmedAt }, null, 2)}</pre>
                                            </label>
                                        ) : null}
                                        {task.remote ? (
                                            <label>
                                                <span>远端任务</span>
                                                <pre>{`${task.remote.provider} · ${task.remote.taskId}\n模型：${task.remote.model}`}</pre>
                                            </label>
                                        ) : null}
                                        {task.cancelRequest ? (
                                            <label>
                                                <span>取消核验</span>
                                                <pre>{JSON.stringify({
                                                    取消请求时间: task.cancelRequest.requestedAt,
                                                    请求人: task.cancelRequest.requestedBy,
                                                    请求方式: task.cancelRequest.method === "local_abort" ? "本地停止等待" : task.cancelRequest.method,
                                                    远端已确认: task.cancelRequest.remoteConfirmed,
                                                    确认人: task.cancelRequest.confirmedBy,
                                                    确认时间: task.cancelRequest.confirmedAt,
                                                    确认方式: task.cancelRequest.confirmMethod === "manual" ? "用户人工核验" : task.cancelRequest.confirmMethod === "remote_api" ? "后端 API" : undefined,
                                                    说明: task.cancelRequest.note,
                                                }, null, 2)}</pre>
                                            </label>
                                        ) : null}
                                        {task.logs.length ? (
                                            <label>
                                                <span>执行日志</span>
                                                <pre>{task.logs.join("\n")}</pre>
                                            </label>
                                        ) : null}
                                    </div>
                                ) : null}
                            </article>
                        );
                    })}
                </div>
            )}
        </Drawer>
    );
}
