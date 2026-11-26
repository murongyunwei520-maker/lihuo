import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Input, InputNumber, Segmented, Select, Tag, Tooltip } from "antd";
import { AlertTriangle, ArrowRight, Download, Film, Image as ImageIcon, Play, RefreshCcw, Sparkles, Upload, Workflow } from "lucide-react";

import { isDoubaoBuiltinModel } from "@/constants/doubao-builtin";
import { resolveVideoCapability } from "@/lib/drama/video-caps";
import { runShotVideo, resumeShotVideo, uploadShotVideo, uploadVideoLastFrame } from "@/lib/studio/actions";
import { downloadStudioMedia } from "@/lib/studio/export";
import { buildShotVideoPrompt } from "@/lib/studio/prompt";
import { buildStudioVideoPlan, supportsLastFrame } from "@/lib/studio/video-plan";
import { SHOT_DURATION_OPTIONS, VIDEO_QUALITY_OPTIONS } from "@/lib/drama/settings";
import { listAccounts, type DoubaoAccount } from "@/services/api/doubao-bridge";
import { useConfigStore } from "@/stores/use-config-store";
import { useStudioStore } from "@/stores/use-studio-store";
import type { StudioProject, StudioShot, StudioWorkspace } from "@/types/studio";
import type { StudioEpisode } from "@/types/studio";

import { StudioEmpty, StudioMediaPreview, StudioModelSelect, StudioPanel, StudioStat, StudioStatus, StudioVersionStrip } from "./ui";

// 视频中心：首帧 → 视频。模型、账号、比例、时长都按真实能力校验；不支持就拦下，不静默换参数。

type Filter = "all" | "missing" | "failed" | "impact" | "remote";

export function StudioVideoWorkspace({
    project,
    episode,
    onGoWorkspace,
    onSendToWorkflow,
}: {
    project: StudioProject;
    episode: StudioEpisode;
    onGoWorkspace: (workspace: StudioWorkspace) => void;
    onSendToWorkflow: (shotId: string) => void;
}) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateShot = useStudioStore((state) => state.updateShot);
    const updateSettings = useStudioStore((state) => state.updateSettings);
    const chooseShotVersion = useStudioStore((state) => state.chooseShotVersion);
    const [filter, setFilter] = useState<Filter>("all");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState("");
    const [batch, setBatch] = useState(false);
    const [accounts, setAccounts] = useState<DoubaoAccount[]>([]);
    const videoFileRef = useRef<HTMLInputElement>(null);
    const lastFrameRef = useRef<HTMLInputElement>(null);
    const resumedRef = useRef(new Set<string>());

    const shots = useMemo(() => {
        return episode.shots.filter((shot) => {
            if (filter === "missing") return !shot.videoRef;
            if (filter === "failed") return shot.videoStatus === "failed";
            if (filter === "impact") return Boolean(shot.impact?.video);
            if (filter === "remote") return Boolean(shot.videoRemote);
            return true;
        });
    }, [episode.shots, filter]);
    const selected = episode.shots.find((shot) => shot.id === selectedId) ?? null;
    const selectedModel = selected?.videoModel || project.settings.videoModel;
    const capability = resolveVideoCapability(selectedModel);
    const plan = selected ? buildStudioVideoPlan({ project, episode, shot: selected, model: selectedModel }) : null;
    const prompt = selected ? buildShotVideoPrompt(project, episode, { ...selected, videoPrompt: "" }) : "";
    const builtin = isDoubaoBuiltinModel(selectedModel);
    const baseBuiltin = isDoubaoBuiltinModel(project.settings.videoModel);
    const effectiveAccountId = selected?.videoAccountId || project.settings.videoAccountId || "";
    const official = episode.shots.filter((shot) => shot.videoRef).length;

    useEffect(() => {
        if (!builtin && !baseBuiltin) {
            setAccounts([]);
            return;
        }
        void listAccounts("doubao").then(setAccounts).catch(() => setAccounts([]));
    }, [builtin, baseBuiltin, selectedModel]);

    const generate = useCallback(
        async (shot: StudioShot, quiet = false) => {
            setBusy(shot.id);
            const result = await runShotVideo(project.id, episode.id, shot.id);
            setBusy("");
            if (!quiet) {
                if (result.ok) message.success(`镜 ${shot.no} 视频已生成`);
                else message.error(result.error ?? "生成失败");
            }
            return result.ok;
        },
        [episode.id, message, project.id],
    );

    const resume = useCallback(
        async (shot: StudioShot, quiet = false) => {
            setBusy(shot.id);
            const result = await resumeShotVideo(project.id, episode.id, shot.id);
            setBusy("");
            if (!quiet) {
                if (result.ok) message.success(`镜 ${shot.no} 续查完成`);
                else message.error(result.error ?? "续查失败");
            }
            return result.ok;
        },
        [episode.id, message, project.id],
    );

    useEffect(() => {
        const targets = episode.shots.filter((shot) => shot.videoRemote && shot.videoStatus !== "succeeded");
        targets.forEach((shot) => {
            if (resumedRef.current.has(shot.id)) return;
            resumedRef.current.add(shot.id);
            void resume(shot, true);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [episode.id]);

    const batchGenerate = async (targets: StudioShot[]) => {
        if (!targets.length) {
            message.info("没有需要生成的视频");
            return;
        }
        setBatch(true);
        const results = await Promise.all(targets.map((shot) => (shot.videoRemote ? resume(shot, true) : generate(shot, true))));
        setBatch(false);
        const ok = results.filter(Boolean).length;
        if (ok) message.success(`批量完成 ${ok} / ${targets.length} 镜`);
        if (ok < targets.length) message.warning(`${targets.length - ok} 镜未完成，可在任务中心查看`);
    };

    const uploadVideo = async (file: File) => {
        if (!selected) return;
        setBusy(selected.id);
        const result = await uploadShotVideo(project.id, episode.id, selected.id, file);
        setBusy("");
        if (result.ok) message.success("视频已上传");
        else message.error(result.error ?? "上传失败");
    };

    const uploadLast = async (file: File) => {
        if (!selected) return;
        const result = await uploadVideoLastFrame(project.id, episode.id, selected.id, file);
        if (result.ok) message.success("尾帧已保存");
        else message.error(result.error ?? "上传失败");
    };

    const accountMissing = Boolean(effectiveAccountId && builtin && accounts.length && !accounts.some((account) => account.id === effectiveAccountId));

    return (
        <div className="studio-video">
            <div className="studio-workspace-head">
                <div>
                    <h2>视频中心</h2>
                    <p>以正式首帧为起点生成镜头视频。模型能力、账号、比例与时长先校验，再提交。</p>
                </div>
                <div className="studio-button-row">
                    <StudioModelSelect config={config} capability="video" value={project.settings.videoModel} onChange={(value) => updateSettings(project.id, { videoModel: value })} />
                    {baseBuiltin ? (
                        <Select
                            style={{ width: 190 }}
                            allowClear
                            value={project.settings.videoAccountId || undefined}
                            placeholder="默认账号：号池自动"
                            options={accounts.map((account) => ({ value: account.id, label: `${account.name}${account.state.loggedIn === false ? "（未登录）" : ""}`, disabled: account.state.loggedIn === false }))}
                            onChange={(value) => updateSettings(project.id, { videoAccountId: value || "" })}
                        />
                    ) : null}
                    <Segmented value={filter} onChange={(value) => setFilter(value as Filter)} options={[{ value: "all", label: `全部 ${episode.shots.length}` }, { value: "missing", label: `缺视频 ${episode.shots.length - official}` }, { value: "failed", label: "失败" }, { value: "remote", label: "待续查" }, { value: "impact", label: "需确认" }]} />
                    <Button type="primary" icon={<Play className="size-4" />} loading={batch} onClick={() => void batchGenerate(episode.shots.filter((shot) => !shot.videoRef))}>
                        批量生成缺失
                    </Button>
                    <Button icon={<RefreshCcw className="size-4" />} onClick={() => void batchGenerate(episode.shots.filter((shot) => shot.videoStatus === "failed"))}>
                        重试失败
                    </Button>
                </div>
            </div>

            <div className="studio-media-stats">
                <StudioStat label="正式视频" value={`${official} / ${episode.shots.length}`} />
                <StudioStat label="候选版本" value={episode.shots.reduce((sum, shot) => sum + shot.videoVersions.length, 0)} />
                <StudioStat label="待续查" value={episode.shots.filter((shot) => shot.videoRemote).length} hint="远端任务" />
                <StudioStat label="资产影响" value={episode.shots.filter((shot) => shot.impact?.video).length} />
            </div>

            {!episode.shots.length ? (
                <StudioEmpty icon={<Film className="size-9" />} title="还没有镜头" description="先在导演中心拆镜，再生成首帧。" action={<Button onClick={() => onGoWorkspace("director")}>去导演中心</Button>} />
            ) : !shots.length ? (
                <StudioEmpty icon={<Film className="size-9" />} title="当前筛选没有镜头" description="切换筛选条件后再生成。" />
            ) : (
                <div className="studio-video-grid">
                    {shots.map((shot) => (
                        <article key={shot.id} className={`studio-video-card${shot.impact?.video ? " has-impact" : ""}`} onClick={() => setSelectedId(shot.id)}>
                            <div className="studio-video-card__media">
                                <StudioMediaPreview storageKey={shot.videoRef || shot.imageRef} kind={shot.videoRef ? "video" : "image"} controls={Boolean(shot.videoRef)} />
                                <span className="studio-video-card__no">镜 {shot.no}</span>
                                {busy === shot.id ? <span className="studio-video-card__mask">{shot.videoRemote ? "续查中…" : "生成中…"}</span> : null}
                                {!shot.videoRef ? <span className="studio-video-card__hint">{shot.imageRef ? "仅首帧" : "缺首帧"}</span> : null}
                            </div>
                            <header>
                                <strong>{shot.sceneName || "未标场景"}</strong>
                                <StudioStatus status={shot.videoStatus} />
                            </header>
                            <div className="studio-video-card__meta">
                                <span>{shot.videoModel || project.settings.videoModel || "跟随项目"} · {shot.videoRatio || project.settings.videoRatio} · {shot.seconds}s</span>
                                <span>{shot.videoVersions.length} 候选</span>
                                {shot.videoRemote ? <Tag color="processing" bordered={false}>待续查</Tag> : null}
                                {shot.impact?.video ? <Tooltip title={shot.impact.video}><Tag color="warning" bordered={false}>资产已变</Tag></Tooltip> : null}
                            </div>
                            <footer onClick={(event) => event.stopPropagation()}>
                                {shot.videoRemote ? (
                                    <Button size="small" icon={<RefreshCcw className="size-3.5" />} loading={busy === shot.id} onClick={() => void resume(shot)}>续查</Button>
                                ) : (
                                    <Button size="small" type="primary" icon={<Sparkles className="size-3.5" />} loading={busy === shot.id} onClick={() => void generate(shot)}>
                                        {shot.videoRef ? "重新生成" : "生成视频"}
                                    </Button>
                                )}
                                <Button size="small" onClick={() => setSelectedId(shot.id)}>参数 / 版本</Button>
                            </footer>
                        </article>
                    ))}
                </div>
            )}

            <Drawer
                title={selected ? `镜 ${selected.no} · 视频生产` : "视频生产"}
                open={Boolean(selected)}
                onClose={() => setSelectedId(null)}
                width={620}
                className="studio-media-drawer"
            >
                {selected ? (
                    <div className="studio-media-drawer__body">
                        <div className="studio-video-drawer__frames">
                            <div>
                                <span>正式首帧</span>
                                <StudioMediaPreview storageKey={selected.imageRef} kind="image" />
                                {!selected.imageRef ? <Button size="small" onClick={() => onGoWorkspace("picture")}><ImageIcon className="size-3.5" /> 去画面中心</Button> : null}
                            </div>
                            <div>
                                <span>视频结果</span>
                                <StudioMediaPreview storageKey={selected.videoRef} kind="video" controls />
                            </div>
                        </div>
                        {selected.impact?.video ? <p className="studio-impact-inline"><span>{selected.impact.video}</span><Button size="small" type="link" onClick={() => useStudioStore.getState().clearImpact(project.id, episode.id, selected.id, "video")}>知道了</Button></p> : null}
                        {selected.videoRemote ? (
                            <p className="studio-impact-inline"><span>已提交远端任务 {selected.videoRemote.taskId}（{selected.videoRemote.provider}），可续查或等待。</span><Button size="small" type="link" onClick={() => void resume(selected)}>续查</Button></p>
                        ) : null}
                        <div className="studio-form-row">
                            <label><span>镜头模型覆盖</span><StudioModelSelect config={config} capability="video" value={selected.videoModel ?? ""} onChange={(value) => updateShot(project.id, episode.id, selected.id, { videoModel: value || undefined })} /></label>
                            <label><span>画面比例</span>
                                <Select
                                    value={selected.videoRatio ?? project.settings.videoRatio}
                                    options={[...new Set([selected.videoRatio ?? project.settings.videoRatio, "自动", ...capability.ratios])].filter((value) => value === "自动" || capability.ratios.includes(value)).map((value) => ({ value, label: value }))}
                                    onChange={(value) => updateShot(project.id, episode.id, selected.id, { videoRatio: value })}
                                />
                            </label>
                        </div>
                        <div className="studio-form-row">
                            <label><span>单镜画质覆盖</span>
                                <Select
                                    value={selected.videoQuality ?? "自动"}
                                    options={VIDEO_QUALITY_OPTIONS.map((value) => ({ value, label: value }))}
                                    onChange={(value) => updateShot(project.id, episode.id, selected.id, { videoQuality: value === "自动" ? undefined : value })}
                                />
                            </label>
                            <label><span>单镜时长覆盖</span>
                                <Select
                                    value={selected.videoSeconds ?? "自动"}
                                    options={[{ value: "自动", label: `自动（镜头 ${selected.seconds}s）` }, ...SHOT_DURATION_OPTIONS.filter((value) => value !== "自动").map((value) => ({ value, label: `${value}（模型 ${capability.seconds.min}–${capability.seconds.max}s）` }))]}
                                    onChange={(value) => updateShot(project.id, episode.id, selected.id, { videoSeconds: value === "自动" ? undefined : value })}
                                />
                            </label>
                        </div>
                        <div className="studio-form-row">
                            <label><span>计划时长（导演）</span><InputNumber min={4} max={15} value={selected.seconds} onChange={(value) => updateShot(project.id, episode.id, selected.id, { seconds: Number(value) || 5 })} /></label>
                        </div>
                        {builtin ? (
                            <label className="studio-account-field">
                                <span>豆包账号（本镜覆盖优先，否则继承项目默认；不静默切换）</span>
                                <Select
                                    allowClear
                                    value={selected.videoAccountId}
                                    placeholder={project.settings.videoAccountId ? `继承项目：${accounts.find((account) => account.id === project.settings.videoAccountId)?.name ?? project.settings.videoAccountId}` : "号池自动选择"}
                                    options={accounts.map((account) => ({ value: account.id, label: `${account.name}${account.state.loggedIn === false ? "（未登录）" : ""}`, disabled: account.state.loggedIn === false }))}
                                    onChange={(value) => updateShot(project.id, episode.id, selected.id, { videoAccountId: value || undefined })}
                                />
                                {accountMissing ? <p className="studio-danger">所选账号已不可用：生成会被拦下，请重新选择。不会自动切换到其他账号。</p> : null}
                            </label>
                        ) : null}
                        <StudioPanel title="模型能力" extra={<Tag bordered={false}>{capability.provider === "builtin" ? "豆包内置" : capability.provider === "channel" ? "渠道模型" : "未选择模型"}</Tag>}>
                            <div className="studio-capability">
                                <span>比例：{capability.ratios.join(" / ") || "自动"}</span>
                                <span>时长：{capability.seconds.min}–{capability.seconds.max}s</span>
                                <span>首帧：{capability.firstFrame ? "支持" : "未确认"}</span>
                                <span>尾帧：{supportsLastFrame(selectedModel) ? "支持" : "未确认，不提交"}</span>
                            </div>
                            {capability.notes.length ? <ul className="studio-capability__notes">{capability.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
                        </StudioPanel>
                        {plan?.blocked ? <p className="studio-blocked"><AlertTriangle className="size-4" /> {plan.blocked}</p> : null}
                        {plan?.warnings.length ? <ul className="studio-capability__notes">{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
                        <label className="studio-prompt-editor">
                            <span>视频提示词（留空自动组装）</span>
                            <Input.TextArea rows={5} value={selected.videoPrompt ?? ""} placeholder={prompt} onChange={(event) => updateShot(project.id, episode.id, selected.id, { videoPrompt: event.target.value })} />
                        </label>
                        <details className="studio-prompt-preview" open>
                            <summary>实际提交计划</summary>
                            <pre>{plan ? `模型：${plan.model}\n比例：${plan.ratio}\n时长：${plan.seconds}s\n画质：${plan.quality}\n参考图：${plan.references.length} 张\n参数：${JSON.stringify(plan.params, null, 2)}\n\n${plan.prompt}` : ""}</pre>
                        </details>
                        <div className="studio-button-row">
                            <Button type="primary" icon={<Sparkles className="size-4" />} loading={busy === selected.id} disabled={Boolean(plan?.blocked)} onClick={() => void generate(selected)}>
                                提交生成
                            </Button>
                            {selected.videoRemote ? <Button icon={<RefreshCcw className="size-4" />} onClick={() => void resume(selected)}>续查远端</Button> : null}
                            <Button icon={<Upload className="size-4" />} onClick={() => videoFileRef.current?.click()}>上传视频</Button>
                            <Button icon={<Download className="size-4" />} disabled={!selected.videoRef} onClick={() => void downloadStudioMedia(selected.videoRef, `短剧_镜${selected.no}_视频_${project.title}`, "video").catch((error) => message.error(error instanceof Error ? error.message : "导出失败"))}>下载正式视频</Button>
                            <Button icon={<Upload className="size-4" />} onClick={() => lastFrameRef.current?.click()} disabled={!supportsLastFrame(selectedModel)}>上传尾帧</Button>
                            <Button icon={<Workflow className="size-4" />} onClick={() => onSendToWorkflow(selected.id)}>发送到 Workflow</Button>
                            <Button icon={<ArrowRight className="size-4" />} onClick={() => onGoWorkspace("sound")}>去声音中心</Button>
                            <input ref={videoFileRef} type="file" accept="video/*" hidden onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void uploadVideo(file);
                                event.target.value = "";
                            }} />
                            <input ref={lastFrameRef} type="file" accept="image/*" hidden onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void uploadLast(file);
                                event.target.value = "";
                            }} />
                        </div>
                        <StudioPanel title="视频版本" extra={<span className="studio-muted">点缩略图设为正式视频</span>}>
                            <StudioVersionStrip versions={selected.videoVersions} kind="video" currentKey={selected.videoRef} emptyText="还没有候选视频" onChoose={(version) => {
                                chooseShotVersion(project.id, episode.id, selected.id, "video", version.id);
                                message.success("已设为正式视频");
                            }} />
                        </StudioPanel>
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}
