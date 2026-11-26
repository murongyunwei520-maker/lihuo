import { useEffect, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Popconfirm, Segmented, Tag, Tooltip } from "antd";
import { CheckCircle2, Copy, Download, FileText, History, ImagePlus, Plus, Save, Sparkles, Trash2, Upload } from "lucide-react";

import { runEpisodePlan, runOutline, runScript } from "@/lib/studio/actions";
import { downloadStudioText } from "@/lib/studio/export";
import { uploadMediaFile } from "@/services/file-storage";
import { useStudioStore } from "@/stores/use-studio-store";
import type { StudioEpisode, StudioProject, StudioWorkspace } from "@/types/studio";

import { StudioEmpty, StudioField, StudioPanel, StudioStat } from "./ui";

// 剧本中心：创意 → 大纲 → 分集 → 剧本。所有 AI 结果都可手改、重新生成、存版本、恢复。

const TABS = [
    { value: "creative", label: "创意与设定" },
    { value: "outline", label: "故事与大纲" },
    { value: "plan", label: "分集规划" },
    { value: "script", label: "剧本正文" },
];

type CreativeDraft = {
    premise: string;
    genre: string;
    type: string;
    audience: string;
    direction: string;
    conflict: string;
    constraints: string;
    logline: string;
    world: string;
    background: string;
    relations: string;
};

function creativeFrom(project: StudioProject, episode: StudioEpisode): CreativeDraft {
    return {
        premise: episode.script.premise,
        genre: episode.script.genre,
        type: episode.script.type,
        audience: episode.script.audience,
        direction: episode.script.direction,
        conflict: episode.script.conflict,
        constraints: episode.script.constraints,
        logline: project.logline,
        world: project.bible.world,
        background: project.bible.background,
        relations: project.bible.relations,
    };
}

export function StudioScriptWorkspace({ project, episode, onOpenEpisode, onGoWorkspace }: { project: StudioProject; episode: StudioEpisode; onOpenEpisode: (episodeId: string) => void; onGoWorkspace: (workspace: StudioWorkspace) => void }) {
    const { message } = App.useApp();
    const updateScript = useStudioStore((state) => state.updateScript);
    const updateBible = useStudioStore((state) => state.updateBible);
    const updateProject = useStudioStore((state) => state.updateProject);
    const saveScriptVersion = useStudioStore((state) => state.saveScriptVersion);
    const restoreScriptVersion = useStudioStore((state) => state.restoreScriptVersion);
    const confirmScript = useStudioStore((state) => state.confirmScript);
    const addReferenceFile = useStudioStore((state) => state.addReferenceFile);
    const createEpisode = useStudioStore((state) => state.createEpisode);
    const duplicateEpisode = useStudioStore((state) => state.duplicateEpisode);
    const deleteEpisode = useStudioStore((state) => state.deleteEpisode);
    const updateEpisode = useStudioStore((state) => state.updateEpisode);
    const [tab, setTab] = useState("creative");
    const [creative, setCreative] = useState(() => creativeFrom(project, episode));
    const [outlineDraft, setOutlineDraft] = useState(episode.script.outline);
    const [scriptDraft, setScriptDraft] = useState(episode.script.text);
    const [busy, setBusy] = useState("");
    const [planCount, setPlanCount] = useState(project.episodes.length);
    const fileRef = useRef<HTMLInputElement>(null);
    const scriptFileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setCreative(creativeFrom(project, episode));
        setOutlineDraft(episode.script.outline);
        setScriptDraft(episode.script.text);
        setPlanCount(project.episodes.length);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [episode.id, episode.script.outline, episode.script.text, project.id]);

    const scriptPatch = () => ({
        premise: creative.premise,
        genre: creative.genre,
        type: creative.type,
        audience: creative.audience,
        direction: creative.direction,
        conflict: creative.conflict,
        constraints: creative.constraints,
    });

    const saveCreative = () => {
        updateScript(project.id, episode.id, scriptPatch());
        updateProject(project.id, { logline: creative.logline });
        updateBible(project.id, { world: creative.world, background: creative.background, relations: creative.relations, logline: creative.logline });
        message.success("创意与设定已保存");
    };

    const generateOutline = async () => {
        updateScript(project.id, episode.id, scriptPatch());
        updateProject(project.id, { logline: creative.logline });
        setBusy("outline");
        const result = await runOutline(project.id, episode.id);
        setBusy("");
        if (result.ok) setTab("outline");
        else message.error(result.error ?? "生成失败");
    };

    const generateScript = async () => {
        updateScript(project.id, episode.id, { outline: outlineDraft });
        setBusy("script");
        const result = await runScript(project.id, episode.id);
        setBusy("");
        if (result.ok) message.success("剧本已生成，可继续局部修改");
        else message.error(result.error ?? "生成失败");
    };

    const saveDraft = (field: "outline" | "text") => {
        if (field === "outline") updateScript(project.id, episode.id, { outline: outlineDraft });
        else updateScript(project.id, episode.id, { text: scriptDraft });
        message.success("已保存");
    };

    const snapshot = (field: "outline" | "text") => {
        if (field === "outline") updateScript(project.id, episode.id, { outline: outlineDraft });
        else updateScript(project.id, episode.id, { text: scriptDraft });
        saveScriptVersion(project.id, episode.id, field, "手动保存版本");
        message.success("已存入历史版本");
    };

    const uploadReference = async (file: File) => {
        try {
            const uploaded = await uploadMediaFile(file, "studio-script-ref");
            addReferenceFile(project.id, episode.id, { id: `ref-${Date.now()}`, name: file.name, storageKey: uploaded.storageKey, mimeType: file.type, bytes: file.size });
            message.success("参考文件已加入");
        } catch {
            message.error("参考文件上传失败");
        }
    };

    const readScriptFile = async (file: File) => {
        const text = await file.text();
        if (!text.trim()) {
            message.warning("文件没有可读取的文本");
            return;
        }
        updateScript(project.id, episode.id, { text, source: "upload", fileName: file.name });
        setScriptDraft(text);
        message.success("剧本已导入，可继续编辑");
    };

    const generatePlan = async () => {
        setBusy("plan");
        const result = await runEpisodePlan(project.id, planCount);
        setBusy("");
        if (result.ok) message.success("分集规划已写入");
        else message.error(result.error ?? "规划失败");
    };

    return (
        <div className="studio-script">
            <div className="studio-workspace-head">
                <div>
                    <h2>剧本中心</h2>
                    <p>从一句灵感走到可拆镜的剧本。AI 只写草稿，确认权始终在你手里。</p>
                </div>
                <Segmented value={tab} onChange={(value) => setTab(String(value))} options={TABS} />
            </div>

            {tab === "creative" ? (
                <div className="studio-script-grid">
                    <StudioPanel title="这一集的创意" extra={<Button type="primary" icon={<Save className="size-4" />} onClick={saveCreative}>保存</Button>}>
                        <div className="studio-form-grid">
                            <StudioField label="一句话灵感" hint="必须有主角、目标与阻力">
                                <Input.TextArea rows={3} value={creative.premise} onChange={(event) => setCreative({ ...creative, premise: event.target.value })} placeholder="例如：被逐出师门的女修，用一枚假丹换回真实身份。" />
                            </StudioField>
                            <div className="studio-form-row">
                                <StudioField label="题材">
                                    <Input value={creative.genre} onChange={(event) => setCreative({ ...creative, genre: event.target.value })} placeholder="都市 / 古装 / 科幻 / 悬疑" />
                                </StudioField>
                                <StudioField label="类型">
                                    <Input value={creative.type} onChange={(event) => setCreative({ ...creative, type: event.target.value })} placeholder="逆袭 / 复仇 / 甜宠 / 群像" />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="受众">
                                    <Input value={creative.audience} onChange={(event) => setCreative({ ...creative, audience: event.target.value })} placeholder="男女频、年龄层" />
                                </StudioField>
                                <StudioField label="创作方向">
                                    <Input value={creative.direction} onChange={(event) => setCreative({ ...creative, direction: event.target.value })} placeholder="节奏、情绪、反转密度" />
                                </StudioField>
                            </div>
                            <StudioField label="核心冲突">
                                <Input value={creative.conflict} onChange={(event) => setCreative({ ...creative, conflict: event.target.value })} placeholder="谁和谁为了什么对抗" />
                            </StudioField>
                            <StudioField label="特殊约束" hint="世界观红线、平台尺度、必须出现的桥段">
                                <Input.TextArea rows={2} value={creative.constraints} onChange={(event) => setCreative({ ...creative, constraints: event.target.value })} />
                            </StudioField>
                            <div className="studio-form-row">
                                <StudioField label="项目一句话">
                                    <Input value={creative.logline} onChange={(event) => setCreative({ ...creative, logline: event.target.value })} />
                                </StudioField>
                                <StudioField label="目标时长">
                                    <InputNumber value={episode.targetSeconds} min={15} max={600} onChange={(value) => updateEpisode(project.id, episode.id, { targetSeconds: Number(value) || 60 })} style={{ width: "100%" }} />
                                </StudioField>
                            </div>
                        </div>
                        <div className="studio-button-row">
                            <Button type="primary" icon={<Sparkles className="size-4" />} loading={busy === "outline"} onClick={() => void generateOutline()}>
                                生成故事大纲
                            </Button>
                            <Button onClick={() => setTab("outline")}>先手动写大纲</Button>
                        </div>
                    </StudioPanel>

                    <div className="studio-script-side">
                        <StudioPanel title="项目设定" extra={<Tag bordered={false}>跨集共享</Tag>}>
                            <StudioField label="世界观">
                                <Input.TextArea rows={3} value={creative.world} onChange={(event) => setCreative({ ...creative, world: event.target.value })} />
                            </StudioField>
                            <StudioField label="故事背景">
                                <Input.TextArea rows={3} value={creative.background} onChange={(event) => setCreative({ ...creative, background: event.target.value })} />
                            </StudioField>
                            <StudioField label="人物关系">
                                <Input.TextArea rows={4} value={creative.relations} onChange={(event) => setCreative({ ...creative, relations: event.target.value })} placeholder="例如：师姐—师妹（表面亲密，实际争夺掌门之位）" />
                            </StudioField>
                            <Button block icon={<Save className="size-4" />} onClick={saveCreative}>
                                同步到项目设定
                            </Button>
                        </StudioPanel>
                        <StudioPanel title="参考文件" extra={<Button size="small" icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>添加</Button>}>
                            {!episode.script.referenceFiles.length ? <div className="studio-version-empty">可上传人物小传、设定集或参考图</div> : (
                                <ul className="studio-file-list">
                                    {episode.script.referenceFiles.map((file) => (
                                        <li key={file.id}>
                                            <FileText className="size-3.5" />
                                            <span>{file.name}</span>
                                            {file.storageKey ? <em>已入库</em> : null}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <input ref={fileRef} type="file" hidden onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void uploadReference(file);
                                event.target.value = "";
                            }} />
                        </StudioPanel>
                    </div>
                </div>
            ) : null}

            {tab === "outline" ? (
                <div className="studio-script-grid">
                    <StudioPanel
                        title="故事大纲"
                        extra={
                            <div className="studio-button-row">
                                <Button icon={<Save className="size-4" />} onClick={() => saveDraft("outline")}>保存</Button>
                                <Button icon={<Download className="size-4" />} onClick={() => {
                                    try {
                                        downloadStudioText(outlineDraft, `大纲_${project.title}_第${episode.no}集`);
                                        message.success("大纲已导出");
                                    } catch (error) {
                                        message.error(error instanceof Error ? error.message : "导出失败");
                                    }
                                }}>导出大纲</Button>
                                <Button icon={<History className="size-4" />} onClick={() => snapshot("outline")}>存为版本</Button>
                                <Button type="primary" icon={<Sparkles className="size-4" />} loading={busy === "outline"} onClick={() => void generateOutline()}>
                                    重新生成
                                </Button>
                            </div>
                        }
                        bodyClassName="studio-panel__body--fill"
                    >
                        <Input.TextArea className="studio-script-textarea" value={outlineDraft} onChange={(event) => setOutlineDraft(event.target.value)} placeholder="一句话故事 / 世界观 / 主要人物 / 故事主线 / 核心冲突 / 结局方向 / 分集大纲" autoSize={{ minRows: 18 }} />
                        <div className="studio-editor-foot">
                            <span>{outlineDraft.length} 字</span>
                            <span>{episode.script.outlineVersions.length} 个历史版本</span>
                        </div>
                    </StudioPanel>
                    <StudioPanel title="大纲版本" bodyClassName="studio-panel__body--scroll">
                        {!episode.script.outlineVersions.length ? <div className="studio-version-empty">保存一次版本后，可在这里恢复</div> : (
                            <ul className="studio-version-list">
                                {episode.script.outlineVersions.map((version) => (
                                    <li key={version.id}>
                                        <header>
                                            <strong>{new Date(version.createdAt).toLocaleString("zh-CN")}</strong>
                                            <span>{version.note ?? "历史版本"}</span>
                                        </header>
                                        <p>{version.text.slice(0, 90)}…</p>
                                        <Button size="small" onClick={() => {
                                            restoreScriptVersion(project.id, episode.id, "outline", version.id);
                                            message.success("已恢复到大纲版本");
                                        }}>
                                            恢复
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="studio-divider" />
                        <StudioButtonBlock onNext={() => setTab("plan")} text="下一步：分集规划" />
                    </StudioPanel>
                </div>
            ) : null}

            {tab === "plan" ? (
                <div className="studio-plan">
                    <StudioPanel
                        title="分集规划"
                        extra={
                            <div className="studio-button-row">
                                <InputNumber size="small" min={1} max={30} value={planCount} onChange={(value) => setPlanCount(Number(value) || 1)} />
                                <Button type="primary" icon={<Sparkles className="size-4" />} loading={busy === "plan"} onClick={() => void generatePlan()}>
                                    AI 规划分集
                                </Button>
                                <Button icon={<Plus className="size-4" />} onClick={() => {
                                    const id = createEpisode(project.id, "", episode.targetSeconds);
                                    if (id) onOpenEpisode(id);
                                }}>
                                    新增一集
                                </Button>
                            </div>
                        }
                    >
                        {!project.episodes.length ? <StudioEmpty title="还没有集数" action={<Button onClick={() => createEpisode(project.id)}>新增一集</Button>} /> : (
                            <div className="studio-episode-list">
                                {project.episodes.map((item) => (
                                    <article key={item.id} className={`studio-episode-row${item.id === episode.id ? " is-active" : ""}`}>
                                        <header>
                                            <button type="button" onClick={() => onOpenEpisode(item.id)}>
                                                第 {item.no} 集 · {item.title}
                                            </button>
                                            <span>{item.shots.length} 镜 / {item.script.text.length} 字</span>
                                            <span className="studio-episode-row__actions">
                                                <Tooltip title="复制这一集">
                                                    <Button size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => {
                                                        const id = duplicateEpisode(project.id, item.id);
                                                        if (id) onOpenEpisode(id);
                                                    }} />
                                                </Tooltip>
                                                <Popconfirm title="删除这一集？" description="剧本、场景与镜头会一起删除；项目级人物资产保留。" onConfirm={async () => {
                                                    const result = await deleteEpisode(project.id, item.id);
                                                    if (result.ok) message.success("已删除");
                                                    else message.error(result.reason ?? "删除失败");
                                                }} okText="删除">
                                                    <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                                                </Popconfirm>
                                            </span>
                                        </header>
                                        <div className="studio-episode-fields">
                                            <label>标题<Input value={item.title} onChange={(event) => updateEpisode(project.id, item.id, { title: event.target.value })} /></label>
                                            <label>目标时长<InputNumber value={item.targetSeconds} min={15} max={600} onChange={(value) => updateEpisode(project.id, item.id, { targetSeconds: Number(value) || 60 })} /></label>
                                            <label className="is-wide">核心事件<Input value={item.coreEvent} onChange={(event) => updateEpisode(project.id, item.id, { coreEvent: event.target.value })} placeholder="这一集发生什么" /></label>
                                            <label className="is-wide">主要冲突<Input value={item.mainConflict} onChange={(event) => updateEpisode(project.id, item.id, { mainConflict: event.target.value })} /></label>
                                            <label className="is-wide">承接上集<Input value={item.continuity} onChange={(event) => updateEpisode(project.id, item.id, { continuity: event.target.value })} /></label>
                                            <label className="is-wide">结尾钩子<Input value={item.hook} onChange={(event) => updateEpisode(project.id, item.id, { hook: event.target.value })} /></label>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </StudioPanel>
                </div>
            ) : null}

            {tab === "script" ? (
                <div className="studio-script-grid">
                    <StudioPanel
                        title={`剧本正文 · ${episode.title}`}
                        extra={
                            <div className="studio-button-row">
                                <Button icon={<Upload className="size-4" />} onClick={() => scriptFileRef.current?.click()}>导入 txt/md</Button>
                                <Button icon={<Download className="size-4" />} onClick={() => {
                                    try {
                                        downloadStudioText(scriptDraft, `剧本_${project.title}_第${episode.no}集`);
                                        message.success("剧本已导出");
                                    } catch (error) {
                                        message.error(error instanceof Error ? error.message : "导出失败");
                                    }
                                }}>导出剧本</Button>
                                <Button icon={<Save className="size-4" />} onClick={() => saveDraft("text")}>保存</Button>
                                <Button icon={<History className="size-4" />} onClick={() => snapshot("text")}>存为版本</Button>
                                <Button type="primary" icon={<Sparkles className="size-4" />} loading={busy === "script"} onClick={() => void generateScript()}>
                                    生成剧本
                                </Button>
                                <Button icon={<CheckCircle2 className="size-4" />} onClick={() => {
                                    updateScript(project.id, episode.id, { text: scriptDraft });
                                    confirmScript(project.id, episode.id);
                                    message.success("剧本已确认，可以进入导演中心拆镜");
                                }}>
                                    {episode.script.confirmedAt ? "重新确认" : "确认剧本"}
                                </Button>
                            </div>
                        }
                        bodyClassName="studio-panel__body--fill"
                    >
                        <div className="studio-script-status">
                            <StudioStat label="字数" value={scriptDraft.length} />
                            <StudioStat label="目标时长" value={`${episode.targetSeconds}s`} />
                            <StudioStat label="场次" value={episode.scenes.length} />
                            <StudioStat label="镜头" value={episode.shots.length} />
                            {episode.script.confirmedAt ? <Tag color="success" bordered={false}>已确认 · {new Date(episode.script.confirmedAt).toLocaleDateString("zh-CN")}</Tag> : <Tag bordered={false}>未确认</Tag>}
                        </div>
                        <Input.TextArea className="studio-script-textarea" value={scriptDraft} onChange={(event) => setScriptDraft(event.target.value)} placeholder="场景：地点 · 时间\n\n人物动作与台词……" autoSize={{ minRows: 20 }} />
                        <input ref={scriptFileRef} type="file" accept=".txt,.md,text/plain" hidden onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void readScriptFile(file);
                            event.target.value = "";
                        }} />
                    </StudioPanel>
                    <div className="studio-script-side">
                        <StudioPanel title="下一步">
                            <div className="studio-next-steps">
                                <button type="button" onClick={() => onGoWorkspace("assets")}>
                                    <strong>资产中心</strong>
                                    <span>提取人物与场景，做正式参考资产</span>
                                </button>
                                <button type="button" onClick={() => onGoWorkspace("director")}>
                                    <strong>导演中心</strong>
                                    <span>拆场拆镜，控制时长与连续性</span>
                                </button>
                                <button type="button" onClick={() => setTab("outline")}>
                                    <strong>回看大纲</strong>
                                    <span>确认故事结构与钩子</span>
                                </button>
                            </div>
                        </StudioPanel>
                        <StudioPanel title="剧本版本" bodyClassName="studio-panel__body--scroll">
                            {!episode.script.versions.length ? <div className="studio-version-empty">还没有历史版本</div> : (
                                <ul className="studio-version-list">
                                    {episode.script.versions.map((version) => (
                                        <li key={version.id}>
                                            <header>
                                                <strong>{new Date(version.createdAt).toLocaleString("zh-CN")}</strong>
                                                <span>{version.note ?? "历史版本"}</span>
                                            </header>
                                            <p>{version.text.slice(0, 90)}…</p>
                                            <Button size="small" onClick={() => {
                                                restoreScriptVersion(project.id, episode.id, "text", version.id);
                                                message.success("已恢复剧本版本");
                                            }}>
                                                恢复
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </StudioPanel>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function StudioButtonBlock({ text, onNext }: { text: string; onNext: () => void }) {
    return (
        <Button block type="dashed" onClick={onNext}>
            {text}
        </Button>
    );
}
