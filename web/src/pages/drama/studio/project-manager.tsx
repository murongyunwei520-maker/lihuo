import { useState } from "react";
import { App, Button, Input, InputNumber, Modal, Popconfirm, Switch, Tag, Tooltip } from "antd";
import { Archive, Clapperboard, FolderOpen, Pencil, Plus, Trash2, Workflow } from "lucide-react";

import { totalSeconds } from "@/lib/studio/lint";
import { defaultStepForProject } from "@/lib/studio/navigation";
import { useStudioStore } from "@/stores/use-studio-store";
import { useStudioTasks } from "@/stores/use-studio-tasks";
import { DRAMA_STEP_LABEL, DRAMA_STEP_SHORT_LABEL, type DramaStep, type StudioProject } from "@/types/studio";

import { StudioEmpty, StudioPanel, StudioStat, StudioStepProgress } from "./ui";

// 项目管理：进入任何工作区之前的总入口。删除会显示关联镜头/资产数量，绝不静默清理。

export function StudioProjectManager({ projects, activeId, onOpen, onWorkflow }: { projects: StudioProject[]; activeId?: string; onOpen: (projectId: string, episodeId: string, step?: DramaStep) => void; onWorkflow?: (projectId: string, episodeId: string) => void }) {
    const { message, modal } = App.useApp();
    const createProject = useStudioStore((state) => state.createProject);
    const updateProject = useStudioStore((state) => state.updateProject);
    const archiveProject = useStudioStore((state) => state.archiveProject);
    const deleteProject = useStudioStore((state) => state.deleteProject);
    const tasks = useStudioTasks((state) => state.tasks);
    const [creating, setCreating] = useState(false);
    const [title, setTitle] = useState("");
    const [logline, setLogline] = useState("");
    const [target, setTarget] = useState(60);
    const [renaming, setRenaming] = useState<StudioProject | null>(null);
    const [renameTitle, setRenameTitle] = useState("");

    const create = () => {
        if (!title.trim()) {
            message.warning("先给项目起个名字");
            return;
        }
        const id = createProject({ title, logline, targetSeconds: target });
        const project = useStudioStore.getState().projects.find((item) => item.id === id);
        setCreating(false);
        setTitle("");
        setLogline("");
        if (project) onOpen(id, project.episodes[0]?.id ?? "", defaultStepForProject(project));
        message.success("项目已创建，已进入 01 AI 小说分析");
    };

    const openRename = (project: StudioProject) => {
        setRenaming(project);
        setRenameTitle(project.title);
    };

    const rename = () => {
        if (!renaming || !renameTitle.trim()) {
            message.warning("项目名称不能为空");
            return;
        }
        updateProject(renaming.id, { title: renameTitle.trim() });
        setRenaming(null);
        message.success("项目已重命名");
    };

    const confirmDelete = (project: StudioProject) => {
        const shots = project.episodes.reduce((sum, episode) => sum + episode.shots.length, 0);
        const assets = project.assets.length;
        const hasWorkflow = project.episodes.some((episode) => episode.workflowProjectId);
        modal.confirm({
            title: `删除《${project.title}》？`,
            content: (
                <div className="space-y-2">
                    <p>这个项目下有 {project.episodes.length} 集、{shots} 个镜头、{assets} 个资产。删除只移除短剧项目数据，不会删除画布项目和素材库文件。</p>
                    {hasWorkflow ? <p className="text-amber-600">项目里还有关联的 Workflow 画布，画布本身不会被删除，但回来后将找不到这个项目。</p> : null}
                    <p className="font-medium">此操作不可撤销。</p>
                </div>
            ),
            okText: "确认删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                const result = await deleteProject(project.id);
                if (result.ok) message.success("项目已删除");
                else message.error(result.reason ?? "删除失败");
            },
        });
    };

    return (
        <div className="studio-project-manager">
            <StudioPanel
                title={
                    <div className="studio-title-row">
                        <div>
                            <strong>项目库</strong>
                            <small>一个项目 = 多集剧本 + 跨集复用的资产 + 统一生产任务</small>
                        </div>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                            新建短剧项目
                        </Button>
                    </div>
                }
            >
                {!projects.length ? (
                    <StudioEmpty icon={<Clapperboard className="size-10" />} title="还没有短剧项目" description="创建项目后直接进入第一步 AI 小说分析；分集由分析规划，人物、场景和服装道具会在整个项目里跨集复用。" action={<Button type="primary" onClick={() => setCreating(true)}>创建第一部短剧</Button>} />
                ) : (
                    <div className="studio-project-grid">
                        {projects.map((project) => {
                            const shots = project.episodes.reduce((sum, episode) => sum + episode.shots.length, 0);
                            const seconds = project.episodes.reduce((sum, episode) => sum + totalSeconds(episode), 0);
                            const currentStep = defaultStepForProject(project);
                            const failedTasks = tasks.filter((task) => task.projectId === project.id && task.status === "failed").length;
                            return (
                                <article key={project.id} className={`studio-project-card${project.id === activeId ? " is-active" : ""}${project.archived ? " is-archived" : ""}`}>
                                    <header>
                                        <div>
                                            <strong>{project.title}</strong>
                                            <small>{project.logline || "还没有一句话故事"}</small>
                                        </div>
                                        {project.legacySequenceId ? <em>旧版迁移</em> : null}
                                    </header>
                                    <div className="studio-project-card__step">
                                        <Tag bordered={false}>{DRAMA_STEP_LABEL[currentStep]}</Tag>
                                        <span>{project.stepStates[currentStep] === "idle" ? "尚未开始" : project.stepStates[currentStep]}</span>
                                    </div>
                                    <StudioStepProgress project={project} activeStep={currentStep} compact />
                                    <div className="studio-project-card__stats">
                                        <StudioStat label="集数" value={project.episodes.length} />
                                        <StudioStat label="镜头" value={shots} />
                                        <StudioStat label="规划时长" value={`${seconds}s`} />
                                        <StudioStat label="资产" value={project.assets.length} />
                                    </div>
                                    <div className="studio-project-card__episodes">
                                        {project.episodes.length ? project.episodes.slice(0, 4).map((episode) => (
                                            <button key={episode.id} type="button" onClick={() => onOpen(project.id, episode.id, currentStep)}>
                                                第 {episode.no} 集 · {episode.title}
                                            </button>
                                        )) : <span>尚未分集 · 等待第一步分析</span>}
                                        {project.episodes.length > 4 ? <span>+{project.episodes.length - 4} 集</span> : null}
                                        {failedTasks ? <span className="studio-project-card__failed">{failedTasks} 个失败任务</span> : null}
                                    </div>
                                    <footer>
                                        <Button type="primary" icon={<FolderOpen className="size-4" />} onClick={() => onOpen(project.id, project.episodes[0]?.id ?? "", currentStep)}>
                                            打开 · {DRAMA_STEP_SHORT_LABEL[currentStep]}
                                        </Button>
                                        <Tooltip title={project.episodes.length ? "在 Workflow 画布中继续编辑" : "先补建一集或完成第一步分析"}>
                                            <Button icon={<Workflow className="size-4" />} disabled={!project.episodes.length} onClick={() => {
                                                const episodeId = project.episodes[0]?.id ?? "";
                                                if (onWorkflow) onWorkflow(project.id, episodeId);
                                                else onOpen(project.id, episodeId, "script");
                                            }}>
                                                Workflow
                                            </Button>
                                        </Tooltip>
                                        <Tooltip title="只修改项目名称，不复制或重置项目数据">
                                            <Button icon={<Pencil className="size-4" />} onClick={() => openRename(project)} />
                                        </Tooltip>
                                        <Popconfirm title={project.archived ? "取消归档？" : "归档项目？归档后仍在项目库，可随时恢复。"} onConfirm={() => archiveProject(project.id, !project.archived)} okText="确认">
                                            <Button icon={<Archive className="size-4" />} />
                                        </Popconfirm>
                                        <Button danger type="text" icon={<Trash2 className="size-4" />} onClick={() => confirmDelete(project)} />
                                    </footer>
                                </article>
                            );
                        })}
                    </div>
                )}
            </StudioPanel>

            <Modal title="新建短剧项目" open={creating} onCancel={() => setCreating(false)} onOk={create} okText="创建并进入第一步" width={560}>
                <div className="studio-form-grid">
                    <label>
                        <span>项目名称</span>
                        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：赛博江湖 · 第一季" maxLength={40} />
                    </label>
                    <label>
                        <span>一句话故事 / 灵感</span>
                        <Input.TextArea value={logline} onChange={(event) => setLogline(event.target.value)} rows={3} placeholder="例如：落魄程序员进入赛博江湖，用一段旧代码救回被夺走的师父。" maxLength={200} />
                    </label>
                    <div className="studio-form-row">
                        <label>
                            <span>单集目标时长（秒）</span>
                            <InputNumber value={target} min={15} max={600} onChange={(value) => setTarget(Number(value) || 60)} style={{ width: "100%" }} />
                        </label>
                        <label>
                            <span>创建后位置</span>
                            <Input value="01 · AI 小说分析" disabled />
                        </label>
                    </div>
                </div>
                <p className="studio-form-hint">
                    <Switch checked disabled size="small" /> 集数不再预先填写：由第一步的小说分析一次性规划。创建后直接进入第一步，全部数据保存在本地项目库。
                </p>
            </Modal>

            <Modal
                title="重命名短剧项目"
                open={Boolean(renaming)}
                onCancel={() => setRenaming(null)}
                onOk={rename}
                okText="保存名称"
                width={420}
                destroyOnHidden
            >
                <label className="studio-form-grid">
                    <span>项目名称</span>
                    <Input value={renameTitle} maxLength={60} onChange={(event) => setRenameTitle(event.target.value)} onPressEnter={rename} />
                </label>
                <p className="studio-form-hint">只修改项目名称；项目内剧本、资产、镜头、任务和旧版迁移标识都不会改变。</p>
            </Modal>
        </div>
    );
}
