import { useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Input, Segmented, Select, Tag, Tooltip } from "antd";
import { ArrowRight, Download, Image as ImageIcon, RefreshCcw, Sparkles, Upload, Wand2, Workflow } from "lucide-react";

import { runShotImage, uploadShotImage } from "@/lib/studio/actions";
import { downloadStudioMedia } from "@/lib/studio/export";
import { buildShotImagePrompt, referenceKeysForShot } from "@/lib/studio/prompt";
import { useConfigStore } from "@/stores/use-config-store";
import { useStudioStore } from "@/stores/use-studio-store";
import { mediaRatioOptions } from "@/lib/media-size";
import type { StudioProject, StudioShot, StudioWorkspace } from "@/types/studio";
import type { StudioEpisode } from "@/types/studio";

import { StudioEmpty, StudioMediaPreview, StudioModelSelect, StudioPanel, StudioStat, StudioStatus, StudioVersionStrip } from "./ui";

// 画面中心：逐镜首帧生产。提示词自动组装、可手改；首次生成自动落正式版，之后的结果进候选，
// 已确认镜头的新生成不会自动覆盖正式图，正式版始终可在版本条里切换。

type Filter = "all" | "missing" | "failed" | "impact";

export function StudioPictureWorkspace({
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
    const chooseShotVersion = useStudioStore((state) => state.chooseShotVersion);
    const setShotStatus = useStudioStore((state) => state.setShotStatus);
    const updateSettings = useStudioStore((state) => state.updateSettings);
    const [filter, setFilter] = useState<Filter>("all");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState("");
    const [batch, setBatch] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const shots = useMemo(() => {
        return episode.shots.filter((shot) => {
            if (filter === "missing") return !shot.imageRef;
            if (filter === "failed") return shot.imageStatus === "failed";
            if (filter === "impact") return Boolean(shot.impact?.image);
            return true;
        });
    }, [episode.shots, filter]);
    const selected = episode.shots.find((shot) => shot.id === selectedId) ?? null;
    const autoPrompt = selected ? buildShotImagePrompt(project, episode, { ...selected, imagePrompt: "" }) : "";
    const official = episode.shots.filter((shot) => shot.imageRef).length;
    const failed = episode.shots.filter((shot) => shot.imageStatus === "failed").length;

    const generate = async (shot: StudioShot, quiet = false) => {
        setBusy(shot.id);
        const result = await runShotImage(project.id, episode.id, shot.id);
        setBusy("");
        if (!quiet) {
            if (result.ok) message.success(`镜 ${shot.no} 首帧完成`);
            else message.error(result.error ?? "生成失败");
        }
        return result.ok;
    };

    const batchGenerate = async (targets: StudioShot[]) => {
        if (!targets.length) {
            message.info("没有需要生成的首帧");
            return;
        }
        setBatch(true);
        const results = await Promise.all(targets.map((shot) => generate(shot, true)));
        setBatch(false);
        const succeeded = results.filter(Boolean).length;
        if (succeeded) message.success(`批量完成 ${succeeded} / ${targets.length} 镜`);
        if (succeeded < targets.length) message.warning(`${targets.length - succeeded} 镜失败，可在任务中心查看原因并重试`);
    };

    const upload = async (file: File) => {
        if (!selected) return;
        setBusy(selected.id);
        const result = await uploadShotImage(project.id, episode.id, selected.id, file);
        setBusy("");
        if (result.ok) message.success("首帧已上传");
        else message.error(result.error ?? "上传失败");
    };

    return (
        <div className="studio-picture">
            <div className="studio-workspace-head">
                <div>
                    <h2>画面中心</h2>
                    <p>每个镜头一张正式首帧。参考资产与摄影参数会自动组装进提示词，也可以手动改写。</p>
                </div>
                <div className="studio-button-row">
                    <StudioModelSelect config={config} capability="image" value={project.settings.imageModel} onChange={(value) => updateSettings(project.id, { imageModel: value })} />
                    <Segmented value={filter} onChange={(value) => setFilter(value as Filter)} options={[{ value: "all", label: `全部 ${episode.shots.length}` }, { value: "missing", label: `缺首帧 ${episode.shots.length - official}` }, { value: "failed", label: `失败 ${failed}` }, { value: "impact", label: "需确认" }]} />
                    <Button type="primary" icon={<Wand2 className="size-4" />} loading={batch} onClick={() => void batchGenerate(episode.shots.filter((shot) => !shot.imageRef))}>
                        批量生成缺失
                    </Button>
                    <Button icon={<RefreshCcw className="size-4" />} disabled={!failed} onClick={() => void batchGenerate(episode.shots.filter((shot) => shot.imageStatus === "failed"))}>
                        重试失败
                    </Button>
                </div>
            </div>

            <div className="studio-media-stats">
                <StudioStat label="正式首帧" value={`${official} / ${episode.shots.length}`} />
                <StudioStat label="候选版本" value={episode.shots.reduce((sum, shot) => sum + shot.imageVersions.length, 0)} />
                <StudioStat label="资产影响" value={episode.shots.filter((shot) => shot.impact?.image).length} hint="不会自动重生成" />
                <StudioStat label="确认镜头" value={episode.shots.filter((shot) => shot.approved || shot.locked).length} />
            </div>

            {!episode.shots.length ? (
                <StudioEmpty icon={<ImageIcon className="size-9" />} title="还没有镜头" description="先去导演中心拆场拆镜，再回画面中心生成首帧。" action={<Button onClick={() => onGoWorkspace("director")}>去导演中心</Button>} />
            ) : !shots.length ? (
                <StudioEmpty icon={<ImageIcon className="size-9" />} title="当前筛选没有镜头" description="切换筛选条件，或批量生成缺失首帧。" />
            ) : (
                <div className="studio-picture-grid">
                    {shots.map((shot) => (
                        <article key={shot.id} className={`studio-picture-card${shot.impact?.image ? " has-impact" : ""}`} onClick={() => setSelectedId(shot.id)}>
                            <div className="studio-picture-card__media">
                                <StudioMediaPreview storageKey={shot.imageRef} kind="image" />
                                <span className="studio-picture-card__no">镜 {shot.no}</span>
                                {busy === shot.id ? <span className="studio-picture-card__mask">生成中…</span> : null}
                                {shot.approved ? <Tag color="success" bordered={false} className="studio-picture-card__badge">已确认</Tag> : null}
                            </div>
                            <header>
                                <strong>{shot.sceneName || "未标场景"}</strong>
                                <StudioStatus status={shot.imageStatus} />
                            </header>
                            <p>{shot.description || shot.action || "未填写画面描述"}</p>
                            <div className="studio-picture-card__meta">
                                <span>{shot.size} · {shot.movement} · {shot.seconds}s</span>
                                <span>{shot.imageVersions.length} 候选</span>
                                {shot.impact?.image ? <Tooltip title={shot.impact.image}><Tag color="warning" bordered={false}>资产已变</Tag></Tooltip> : null}
                            </div>
                            <footer onClick={(event) => event.stopPropagation()}>
                                <Button size="small" type="primary" icon={<Sparkles className="size-3.5" />} loading={busy === shot.id} onClick={() => void generate(shot)}>
                                    {shot.imageRef ? "重新生成" : "生成首帧"}
                                </Button>
                                <Button size="small" onClick={() => setSelectedId(shot.id)}>版本 / 提示词</Button>
                            </footer>
                        </article>
                    ))}
                </div>
            )}

            <Drawer
                title={selected ? `镜 ${selected.no} · 首帧生产` : "首帧生产"}
                open={Boolean(selected)}
                onClose={() => setSelectedId(null)}
                width={600}
                className="studio-media-drawer"
            >
                {selected ? (
                    <div className="studio-media-drawer__body">
                        <div className="studio-media-drawer__preview">
                            <StudioMediaPreview storageKey={selected.imageRef} kind="image" />
                            {selected.impact?.image ? <p className="studio-impact-inline"><span>{selected.impact.image}</span><Button size="small" type="link" onClick={() => useStudioStore.getState().clearImpact(project.id, episode.id, selected.id, "image")}>知道了</Button></p> : null}
                        </div>
                        <div className="studio-media-drawer__stats">
                            <StudioStat label="状态" value={<StudioStatus status={selected.imageStatus} />} />
                            <StudioStat label="正式版" value={selected.imageRef ? "已设置" : "未设置"} />
                            <StudioStat label="参考图" value={referenceKeysForShot(project, selected, episode).length} />
                            <StudioStat label="候选" value={selected.imageVersions.length} />
                        </div>
                        <div className="studio-form-row">
                            <label><span>镜头模型覆盖</span><StudioModelSelect config={config} capability="image" value={selected.imageModel ?? ""} onChange={(value) => updateShot(project.id, episode.id, selected.id, { imageModel: value || undefined })} /></label>
                            <label><span>比例覆盖</span>
                                <Select value={selected.imageRatio ?? project.settings.imageRatio} options={[{ value: "自动", label: "自动" }, ...mediaRatioOptions.filter((item) => item.value !== "auto").map((item) => ({ value: item.value, label: item.value }))]} onChange={(value) => updateShot(project.id, episode.id, selected.id, { imageRatio: value })} />
                            </label>
                        </div>
                        <label className="studio-prompt-editor">
                            <span>提示词（留空则自动组装）</span>
                            <Input.TextArea
                                rows={6}
                                value={selected.imagePrompt ?? ""}
                                placeholder={autoPrompt}
                                onChange={(event) => updateShot(project.id, episode.id, selected.id, { imagePrompt: event.target.value })}
                            />
                        </label>
                        <details className="studio-prompt-preview" open>
                            <summary>自动组装的完整提示词</summary>
                            <pre>{autoPrompt}</pre>
                        </details>
                        <div className="studio-button-row">
                            <Button type="primary" icon={<Sparkles className="size-4" />} loading={busy === selected.id} onClick={() => void generate(selected)}>
                                生成新候选
                            </Button>
                            <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>上传首帧</Button>
                            <Button icon={<Download className="size-4" />} disabled={!selected.imageRef} onClick={() => void downloadStudioMedia(selected.imageRef, `短剧_镜${selected.no}_首帧_${project.title}`, "image").catch((error) => message.error(error instanceof Error ? error.message : "导出失败"))}>下载正式首帧</Button>
                            <Button icon={<Workflow className="size-4" />} onClick={() => onSendToWorkflow(selected.id)}>发送到 Workflow</Button>
                            <Button icon={<ArrowRight className="size-4" />} onClick={() => onGoWorkspace("video")}>去视频中心</Button>
                            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void upload(file);
                                event.target.value = "";
                            }} />
                        </div>
                        <StudioPanel title="候选版本" extra={<span className="studio-muted">点缩略图设为正式首帧</span>}>
                            <StudioVersionStrip
                                versions={selected.imageVersions}
                                kind="image"
                                currentKey={selected.imageRef}
                                emptyText="还没有候选图"
                                onChoose={(version) => {
                                    chooseShotVersion(project.id, episode.id, selected.id, "image", version.id);
                                    message.success("已设为正式首帧");
                                }}
                            />
                        </StudioPanel>
                        <StudioPanel title="本镜参考资产">
                            {selected.assetIds.length ? (
                                <div className="studio-asset-chips">
                                    {selected.assetIds.map((id) => {
                                        const asset = project.assets.find((item) => item.id === id);
                                        return asset ? <Tag key={id} bordered={false} color={asset.officialRef ? "green" : "default"}>{asset.name}</Tag> : null;
                                    })}
                                </div>
                            ) : <p className="studio-muted">未绑定资产：提示词会缺少人物一致性参考。</p>}
                        </StudioPanel>
                        <Button size="small" onClick={() => setShotStatus(project.id, episode.id, selected.id, "image", "idle")}>标记为待生成（不删除版本）</Button>
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}
