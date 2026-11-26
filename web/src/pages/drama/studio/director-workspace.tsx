import { useMemo, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Tag, Tooltip } from "antd";
import { AlertTriangle, ArrowDown, ArrowUp, CheckSquare, Copy, Image, Lock, LockOpen, Merge, Plus, Scissors, Sparkles, SplitSquareHorizontal, Trash2, Wand2 } from "lucide-react";

import { runContinuityReview, runShotFill, runSplitEpisode } from "@/lib/studio/actions";
import { continuityIssues, durationBudget, lintEpisode, suggestDurationAdjustment } from "@/lib/studio/lint";
import { useStudioStore } from "@/stores/use-studio-store";
import { SHOT_CAMERAS, SHOT_COMPOSITIONS, SHOT_LENSES, SHOT_LIGHTING, SHOT_MOVES, SHOT_SIZES, type StudioEpisode, type StudioProject, type StudioShot, type StudioWorkspace } from "@/types/studio";

import { StudioEmpty, StudioMediaPreview, StudioPanel, StudioStat, StudioStatus } from "./ui";

// 导演中心：场次管理 + 镜头表 + 检查器 + 时长预算 + 连续性检查。
// 智能拆镜会替换已有镜头，必须先确认；镜头锁定后不允许 AI 改写。

type ViewMode = "list" | "cards" | "preview";

export function StudioDirectorWorkspace({ project, episode, onGoWorkspace }: { project: StudioProject; episode: StudioEpisode; onGoWorkspace: (workspace: StudioWorkspace) => void }) {
    const { message, modal } = App.useApp();
    const updateShot = useStudioStore((state) => state.updateShot);
    const addShot = useStudioStore((state) => state.addShot);
    const deleteShot = useStudioStore((state) => state.deleteShot);
    const splitShot = useStudioStore((state) => state.splitShot);
    const mergeShots = useStudioStore((state) => state.mergeShots);
    const moveShot = useStudioStore((state) => state.moveShot);
    const lockShot = useStudioStore((state) => state.lockShot);
    const updateEpisode = useStudioStore((state) => state.updateEpisode);
    const updateScene = useStudioStore((state) => state.updateScene);
    const createScene = useStudioStore((state) => state.createScene);
    const [view, setView] = useState<ViewMode>("list");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [reviewIds, setReviewIds] = useState<string[]>([]);
    const [sceneFilter, setSceneFilter] = useState<string | null>(null);
    const [busy, setBusy] = useState("");
    const [sceneModal, setSceneModal] = useState(false);
    const [sceneName, setSceneName] = useState("");
    const [suggestions, setSuggestions] = useState<ReturnType<typeof suggestDurationAdjustment> | null>(null);

    const shots = useMemo(() => episode.shots.filter((shot) => !sceneFilter || shot.sceneId === sceneFilter), [episode.shots, sceneFilter]);
    const shot = episode.shots.find((item) => item.id === selectedId) ?? shots[0] ?? null;
    const budget = durationBudget(episode, episode.targetSeconds);
    const issues = useMemo(() => lintEpisode(project, episode), [project, episode]);
    const selectedIssues = reviewIds.length ? continuityIssues(project, episode, reviewIds) : [];
    const characters = project.assets.filter((asset) => asset.kind === "character" && !asset.archived);

    const patch = (value: Partial<StudioShot>) => {
        if (shot) updateShot(project.id, episode.id, shot.id, value);
    };

    const split = async () => {
        if (episode.shots.length) {
            modal.confirm({
                title: "重新拆场拆镜？",
                content: `这一集已有 ${episode.shots.length} 个镜头，AI 拆镜会替换它们。镜头版本与已生成的图片/视频不会被删除，但会脱离当前镜头结构。`,
                okText: "确认替换",
                okButtonProps: { danger: true },
                onOk: async () => {
                    setBusy("split");
                    const result = await runSplitEpisode(project.id, episode.id, true);
                    setBusy("");
                    if (result.ok) { message.success("拆场拆镜完成"); setSelectedId(null); }
                    else message.error(result.error ?? "拆镜失败");
                },
            });
            return;
        }
        setBusy("split");
        const result = await runSplitEpisode(project.id, episode.id, false);
        setBusy("");
        if (result.ok) message.success("拆场拆镜完成");
        else message.error(result.error ?? "拆镜失败");
    };

    const fill = async () => {
        if (!shot) return;
        setBusy(`fill-${shot.id}`);
        const result = await runShotFill(project.id, episode.id, shot.id);
        setBusy("");
        if (result.ok) message.success("镜头执行信息已补全");
        else message.error(result.error ?? "补全失败");
    };

    const review = async () => {
        const ids = reviewIds.length ? reviewIds : episode.shots.map((item) => item.id);
        if (!ids.length) {
            message.warning("还没有镜头可检查");
            return;
        }
        setBusy("review");
        const result = await runContinuityReview(project.id, episode.id, ids);
        setBusy("");
        if (result.ok) message.success("AI 连续性检查完成，结果已写入本集报告");
        else message.error(result.error ?? "检查失败");
    };

    const applySuggestions = () => {
        if (!suggestions) return;
        suggestions.forEach((item) => updateShot(project.id, episode.id, item.shotId, { seconds: item.to }));
        setSuggestions(null);
        message.success("未锁定镜头的时长已按建议调整");
    };

    const toggleReview = (id: string) => setReviewIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));

    return (
        <div className="studio-director">
            <div className="studio-workspace-head">
                <div>
                    <h2>导演中心</h2>
                    <p>把剧本拆成可执行的场与镜。镜头锁定后，AI 与批量操作都不会改写它。</p>
                </div>
                <div className="studio-button-row">
                    <Segmented value={view} onChange={(value) => setView(value as ViewMode)} options={[{ value: "list", label: "列表" }, { value: "cards", label: "卡片" }, { value: "preview", label: "预演" }]} />
                    <Button type="primary" icon={<SplitSquareHorizontal className="size-4" />} loading={busy === "split"} onClick={() => void split()}>
                        智能拆场拆镜
                    </Button>
                    <Button icon={<Wand2 className="size-4" />} onClick={() => {
                        const next = suggestDurationAdjustment(episode, episode.targetSeconds);
                        if (!next.length) {
                            message.info("当前不需要压缩，或所有可调整镜头都已锁定");
                            return;
                        }
                        setSuggestions(next);
                    }}>
                        时长调整建议
                    </Button>
                </div>
            </div>

            <div className="studio-director-stats">
                <StudioStat label="目标时长" value={`${episode.targetSeconds}s`} hint={<InputNumber size="small" min={15} max={600} value={episode.targetSeconds} onChange={(value) => updateEpisode(project.id, episode.id, { targetSeconds: Number(value) || 60 })} />} />
                <StudioStat label="镜头规划" value={`${budget.planned}s`} hint={<span className={budget.over ? "studio-danger" : "studio-muted"}>{budget.over ? `超出 ${budget.delta}s` : budget.under ? `还差 ${Math.abs(budget.delta)}s` : "刚好达标"}</span>} />
                <StudioStat label="场次 / 镜头" value={`${episode.scenes.length} / ${episode.shots.length}`} />
                <StudioStat label="已锁定" value={episode.shots.filter((item) => item.locked).length} />
                <StudioStat label="连续性问题" value={issues.filter((item) => item.level !== "info").length} hint={<Button size="small" type="link" onClick={() => setReviewIds(episode.shots.map((item) => item.id))}>全选检查</Button>} />
            </div>

            <div className="studio-director-body">
                <aside className="studio-scene-rail">
                    <div className="studio-scene-rail__head">
                        <strong>场次</strong>
                        <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={() => setSceneModal(true)} />
                    </div>
                    <button type="button" className={`studio-scene-item${sceneFilter ? "" : " is-active"}`} onClick={() => setSceneFilter(null)}>
                        <strong>全部镜头</strong><span>{episode.shots.length} 镜</span>
                    </button>
                    {episode.scenes.map((scene) => (
                        <div key={scene.id} role="button" tabIndex={0} className={`studio-scene-item${sceneFilter === scene.id ? " is-active" : ""}`} onClick={() => setSceneFilter(scene.id)} onKeyDown={(event) => { if (event.key === "Enter") setSceneFilter(scene.id); }}>
                            <strong>{scene.no} · {scene.name}</strong>
                            <span>{scene.location || "未填地点"} · {episode.shots.filter((item) => item.sceneId === scene.id).length} 镜</span>
                            <Input
                                size="small"
                                value={scene.name}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => updateScene(project.id, episode.id, scene.id, { name: event.target.value })}
                            />
                        </div>
                    ))}
                    {!episode.scenes.length ? <div className="studio-version-empty">拆镜后自动生成场次</div> : null}
                </aside>

                <div className="studio-director-main">
                    {buildIssuesPanel(issues)}

                    {view === "list" ? (
                        <div className="studio-shot-table">
                            <div className="studio-shot-table__head">
                                <span />
                                <span>镜号</span>
                                <span>场景</span>
                                <span>景别 / 运镜</span>
                                <span>时长</span>
                                <span>台词</span>
                                <span>状态</span>
                                <span />
                            </div>
                            {shots.map((item) => (
                                <div key={item.id} className={`studio-shot-row${shot?.id === item.id ? " is-active" : ""}${item.locked ? " is-locked" : ""}`} onClick={() => setSelectedId(item.id)} role="button" tabIndex={0}>
                                    <span>
                                        <input type="checkbox" checked={reviewIds.includes(item.id)} onChange={() => toggleReview(item.id)} onClick={(event) => event.stopPropagation()} aria-label="加入连续性检查" />
                                    </span>
                                    <span className="studio-shot-no">{item.no}</span>
                                    <span>{item.sceneName || "未标场景"}</span>
                                    <span>{item.size} · {item.movement}</span>
                                    <span>{item.seconds}s</span>
                                    <span className="studio-shot-line">{item.line || item.narration || "—"}</span>
                                    <span className="studio-shot-statuses">
                                        {item.locked ? <Lock className="size-3" /> : null}
                                        {item.impact ? <AlertTriangle className="size-3 text-amber-500" /> : null}
                                        <StudioStatus status={item.imageStatus} text="图" />
                                        <StudioStatus status={item.videoStatus} text="视" />
                                        <StudioStatus status={item.audioStatus} text="声" />
                                    </span>
                                    <span className="studio-shot-row__ops" onClick={(event) => event.stopPropagation()}>
                                        <Tooltip title="上移"><Button size="small" type="text" icon={<ArrowUp className="size-3" />} onClick={() => moveShot(project.id, episode.id, item.id, -1)} /></Tooltip>
                                        <Tooltip title="下移"><Button size="small" type="text" icon={<ArrowDown className="size-3" />} onClick={() => moveShot(project.id, episode.id, item.id, 1)} /></Tooltip>
                                        <Tooltip title={item.locked ? "解锁" : "锁定"}><Button size="small" type="text" icon={item.locked ? <LockOpen className="size-3" /> : <Lock className="size-3" />} onClick={() => lockShot(project.id, episode.id, item.id, !item.locked)} /></Tooltip>
                                        <Tooltip title="拆分"><Button size="small" type="text" icon={<Scissors className="size-3" />} onClick={() => splitShot(project.id, episode.id, item.id)} /></Tooltip>
                                        <Tooltip title="与下一镜合并"><Button size="small" type="text" icon={<Merge className="size-3" />} onClick={() => {
                                            const index = episode.shots.findIndex((entry) => entry.id === item.id);
                                            const next = episode.shots[index + 1];
                                            if (!next) { message.warning("最后一镜不能向下合并"); return; }
                                            const result = mergeShots(project.id, episode.id, item.id, next.id);
                                            if (!result.ok) message.error(result.reason ?? "合并失败");
                                        }} /></Tooltip>
                                        <Popconfirm title="删除这一镜？" onConfirm={() => deleteShot(project.id, episode.id, item.id)} okText="删除">
                                            <Button size="small" type="text" danger icon={<Trash2 className="size-3" />} />
                                        </Popconfirm>
                                    </span>
                                </div>
                            ))}
                            {!shots.length ? <StudioEmpty title="还没有镜头" description="用「智能拆场拆镜」从剧本生成，或手动添加。" action={<Button onClick={() => addShot(project.id, episode.id, episode.scenes[0]?.id)}>添加一镜</Button>} /> : null}
                        </div>
                    ) : null}

                    {view === "cards" ? (
                        <div className="studio-shot-cards">
                            {shots.map((item) => (
                                <article key={item.id} className={`studio-shot-card${shot?.id === item.id ? " is-active" : ""}${item.locked ? " is-locked" : ""}`} onClick={() => setSelectedId(item.id)}>
                                    <div className="studio-shot-card__thumb"><StudioMediaPreview storageKey={item.imageRef} kind="image" /></div>
                                    <header><strong>镜 {item.no}</strong><span>{item.size} · {item.movement} · {item.seconds}s</span></header>
                                    <p>{item.description || item.action || item.line || "未填写画面"}</p>
                                    <footer>
                                        <StudioStatus status={item.imageStatus} text="图" />
                                        <StudioStatus status={item.videoStatus} text="视" />
                                        {item.impact ? <Tag color="warning" bordered={false}>需确认</Tag> : null}
                                    </footer>
                                </article>
                            ))}
                        </div>
                    ) : null}

                    {view === "preview" ? (
                        <div className="studio-preview">
                            <div className="studio-preview__note"><CheckSquare className="size-4" /> 2D 分镜串联预演：按镜号顺序展示正式首帧与人物位置/朝向。3D 白模预演需要导演台节点，当前版本未接入，已记录为待办。</div>
                            <div className="studio-preview__strip">
                                {shots.map((item) => (
                                    <button key={item.id} type="button" className={`studio-preview-frame${shot?.id === item.id ? " is-active" : ""}`} onClick={() => setSelectedId(item.id)}>
                                        <StudioMediaPreview storageKey={item.imageRef} kind="image" />
                                        <span className="studio-preview-frame__meta"><b>镜 {item.no}</b><em>{item.size} · {item.movement} · {item.seconds}s</em></span>
                                        <span className="studio-preview-frame__pos">{item.position || "位置未填"} · {item.orientation || "朝向未填"}</span>
                                    </button>
                                ))}
                            </div>
                            {episode.continuityReport ? (
                                <StudioPanel title={`AI 连续性报告 · ${new Date(episode.continuityReport.createdAt).toLocaleString("zh-CN")}`}>
                                    {episode.continuityReport.issues.length ? (
                                        <ul className="studio-issue-list">
                                            {episode.continuityReport.issues.map((issue, index) => <li key={index} className={`is-${issue.level}`}>{issue.message}</li>)}
                                        </ul>
                                    ) : <p className="studio-muted">AI 没有发现明显问题。</p>}
                                </StudioPanel>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <aside className="studio-shot-inspector">
                    {shot ? (
                        <>
                            <div className="studio-inspector__head">
                                <strong>镜 {shot.no}</strong>
                                <span>{shot.sceneName}</span>
                                <div>
                                    <Button size="small" icon={<Sparkles className="size-3.5" />} loading={busy === `fill-${shot.id}`} disabled={shot.locked} onClick={() => void fill()}>AI 补全</Button>
                                    <Button size="small" icon={<Image className="size-3.5" />} onClick={() => onGoWorkspace("picture")}>画面</Button>
                                </div>
                            </div>
                            {shot.impact ? (
                                <div className="studio-impact-inline">
                                    <AlertTriangle className="size-3.5" />
                                    <span>{Object.values(shot.impact).filter(Boolean).join("；")}</span>
                                    <Button size="small" type="link" onClick={() => useStudioStore.getState().clearImpact(project.id, episode.id, shot.id)}>知道了</Button>
                                </div>
                            ) : null}
                            <div className="studio-inspector__scroll">
                                <div className="studio-form-row">
                                    <label><span>镜号</span><Input value={shot.no} onChange={(event) => patch({ no: event.target.value })} /></label>
                                    <label><span>时长</span><InputNumber min={4} max={15} value={shot.seconds} onChange={(value) => patch({ seconds: Number(value) || 5 })} /></label>
                                </div>
                                <label><span>场景</span>
                                    <Select
                                        value={shot.sceneId}
                                        options={episode.scenes.map((scene) => ({ value: scene.id, label: `${scene.no} · ${scene.name}` }))}
                                        onChange={(value) => {
                                            const scene = episode.scenes.find((item) => item.id === value);
                                            patch({ sceneId: value, sceneName: scene?.name ?? "", environment: scene?.location ?? shot.environment });
                                        }}
                                    />
                                </label>
                                <label><span>画面描述</span><Input.TextArea rows={2} value={shot.description} onChange={(event) => patch({ description: event.target.value })} /></label>
                                <label><span>绑定资产</span>
                                    <Select
                                        mode="multiple"
                                        value={shot.assetIds}
                                        options={project.assets.filter((asset) => !asset.archived).map((asset) => ({ value: asset.id, label: `${asset.name}（${asset.kind === "character" ? "人物" : asset.kind === "scene" ? "场景" : asset.kind === "costume" ? "服装" : "道具"}）` }))}
                                        onChange={(value) => {
                                            const names = value.map((id) => project.assets.find((asset) => asset.id === id)?.name).filter((name): name is string => Boolean(name));
                                            patch({ assetIds: value, characterNames: names });
                                        }}
                                    />
                                </label>
                                <div className="studio-form-row">
                                    <label><span>景别</span><Select value={shot.size} options={SHOT_SIZES.map((value) => ({ value, label: value }))} onChange={(value) => patch({ size: value })} /></label>
                                    <label><span>机位</span><Select value={shot.camera} options={SHOT_CAMERAS.map((value) => ({ value, label: value }))} onChange={(value) => patch({ camera: value })} /></label>
                                </div>
                                <div className="studio-form-row">
                                    <label><span>焦段</span><Select value={shot.lens} options={SHOT_LENSES.map((value) => ({ value, label: value }))} onChange={(value) => patch({ lens: value })} /></label>
                                    <label><span>运镜</span><Select value={shot.movement} options={SHOT_MOVES.map((value) => ({ value, label: value }))} onChange={(value) => patch({ movement: value })} /></label>
                                </div>
                                <div className="studio-form-row">
                                    <label><span>构图</span><Select value={shot.composition} options={SHOT_COMPOSITIONS.map((value) => ({ value, label: value }))} onChange={(value) => patch({ composition: value })} /></label>
                                    <label><span>主光</span><Select value={shot.lighting} options={SHOT_LIGHTING.map((value) => ({ value, label: value }))} onChange={(value) => patch({ lighting: value })} /></label>
                                </div>
                                <label><span>人物动作</span><Input.TextArea rows={2} value={shot.action} onChange={(event) => patch({ action: event.target.value })} /></label>
                                <label><span>表情</span><Input value={shot.expression} onChange={(event) => patch({ expression: event.target.value })} /></label>
                                <div className="studio-form-row">
                                    <label><span>位置</span><Input value={shot.position} onChange={(event) => patch({ position: event.target.value })} /></label>
                                    <label><span>朝向</span><Input value={shot.orientation} onChange={(event) => patch({ orientation: event.target.value })} /></label>
                                </div>
                                <label><span>环境细节</span><Input value={shot.environment} onChange={(event) => patch({ environment: event.target.value })} /></label>
                                <label><span>特效</span><Input value={shot.effects} onChange={(event) => patch({ effects: event.target.value })} /></label>
                                <div className="studio-form-row">
                                    <label><span>说话人</span><Select allowClear value={shot.speaker || undefined} options={characters.map((asset) => ({ value: asset.name, label: asset.name }))} onChange={(value) => patch({ speaker: value ?? "" })} /></label>
                                    <label><span>对白</span><Input value={shot.line} onChange={(event) => patch({ line: event.target.value })} /></label>
                                </div>
                                <label><span>旁白</span><Input.TextArea rows={2} value={shot.narration} onChange={(event) => patch({ narration: event.target.value })} /></label>
                                <div className="studio-form-row">
                                    <label><span>环境声</span><Input value={shot.ambience} onChange={(event) => patch({ ambience: event.target.value })} /></label>
                                    <label><span>音效</span><Input value={shot.sfx} onChange={(event) => patch({ sfx: event.target.value })} /></label>
                                </div>
                                <details>
                                    <summary>画面提示词覆盖</summary>
                                    <Input.TextArea rows={3} value={shot.imagePrompt ?? ""} placeholder="留空=按项目与资产自动组装" onChange={(event) => patch({ imagePrompt: event.target.value })} />
                                    <Input.TextArea rows={3} value={shot.videoPrompt ?? ""} placeholder="留空=按首帧自动组装视频动作" onChange={(event) => patch({ videoPrompt: event.target.value })} />
                                </details>
                                <div className="studio-inspector__foot">
                                    <Button size="small" type={shot.locked ? "default" : "primary"} icon={shot.locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />} onClick={() => lockShot(project.id, episode.id, shot.id, !shot.locked)}>
                                        {shot.locked ? "解锁镜头" : "锁定镜头"}
                                    </Button>
                                    <Button size="small" onClick={() => updateShot(project.id, episode.id, shot.id, { approved: !shot.approved })}>
                                        {shot.approved ? "取消确认" : "确认此镜"}
                                    </Button>
                                    <span className="studio-muted">{shot.imageVersions.length} 图 / {shot.videoVersions.length} 视频</span>
                                </div>
                            </div>
                        </>
                    ) : <StudioEmpty title="选择镜头" description="点击镜头行编辑动作、景别、运镜、时长与声音。" />}
                </aside>
            </div>

            <div className="studio-director-footer">
                <div>
                    <strong>连续性检查</strong>
                    <span>{reviewIds.length ? `已选 ${reviewIds.length} 镜` : "未选择时检查全集"} · 规则检查实时，AI 检查会写入报告</span>
                </div>
                <Button icon={<Sparkles className="size-4" />} loading={busy === "review"} onClick={() => void review()}>AI 检查</Button>
                <Button icon={<CheckSquare className="size-4" />} onClick={() => onGoWorkspace("picture")}>去画面中心</Button>
            </div>

            {selectedIssues.length ? (
                <StudioPanel title={`所选镜头连续性（${selectedIssues.length}）`} className="studio-director-issues">
                    <ul className="studio-issue-list">
                        {selectedIssues.map((issue) => <li key={issue.id} className={`is-${issue.level}`}>{issue.shotNo ? `镜 ${issue.shotNo}：` : ""}{issue.message}</li>)}
                    </ul>
                </StudioPanel>
            ) : null}

            <Modal title="新增场次" open={sceneModal} onCancel={() => setSceneModal(false)} onOk={() => {
                if (!sceneName.trim()) { message.warning("填写场次名称"); return; }
                createScene(project.id, episode.id, sceneName);
                setSceneModal(false);
                setSceneName("");
            }} okText="新增">
                <Input value={sceneName} onChange={(event) => setSceneName(event.target.value)} placeholder="例如：深夜 · 青云宗后山" />
            </Modal>

            <Modal title="按目标时长调整" open={Boolean(suggestions)} onCancel={() => setSuggestions(null)} onOk={applySuggestions} okText="应用建议" width={560}>
                {suggestions ? (
                    <div className="studio-adjust-list">
                        <p>只调整未锁定镜头；锁定镜头保持原时长。应用前可自行再改。</p>
                        {suggestions.map((item) => (
                            <div key={item.shotId}><strong>镜 {item.shotNo}</strong><span>{item.from}s → {item.to}s</span></div>
                        ))}
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}

function buildIssuesPanel(issues: ReturnType<typeof lintEpisode>) {
    if (!issues.length) return null;
    return (
        <div className="studio-issues">
            {issues.slice(0, 4).map((issue) => (
                <span key={issue.id} className={`is-${issue.level}`}>
                    {issue.level === "error" ? <AlertTriangle className="size-3.5" /> : <Copy className="size-3.5" />}
                    {issue.message}
                </span>
            ))}
            {issues.length > 4 ? <span className="studio-muted">还有 {issues.length - 4} 条，见连续性检查</span> : null}
        </div>
    );
}
