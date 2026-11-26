import { useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Tag, Tooltip } from "antd";
import { ArrowRight, Download, ImagePlus, Mic, Palette, Save, Trash2, Upload, UserRound, Wand2 } from "lucide-react";

import { audioVoiceOptions } from "@/lib/audio-generation";
import { APERTURE_OPTIONS, ASSET_QUALITY_OPTIONS, FILL_LIGHT_OPTIONS, KEY_LIGHT_OPTIONS, LENS_OPTIONS, SHOT_DURATION_OPTIONS, STYLE_OPTIONS, VIDEO_QUALITY_OPTIONS } from "@/lib/drama/settings";
import { affectedByAsset, affectedByVoice } from "@/lib/studio/deps";
import { downloadStudioMedia } from "@/lib/studio/export";
import { buildAssetPrompt } from "@/lib/studio/prompt";
import { runAssetImage, uploadAssetReference } from "@/lib/studio/actions";
import { mediaRatioOptions, videoRatioOptions } from "@/lib/media-size";
import { uploadMediaFile } from "@/services/file-storage";
import { useConfigStore } from "@/stores/use-config-store";
import { assetUsage, useStudioStore } from "@/stores/use-studio-store";
import { STUDIO_ASSET_KIND_LABEL, type StudioAsset, type StudioAssetKind, type StudioProject, type StudioWorkspace } from "@/types/studio";

import { StudioEmpty, StudioField, StudioMediaPreview, StudioModelSelect, StudioPanel, StudioStat, StudioVersionStrip } from "./ui";

// 资产中心：人物 / 场景 / 服装 / 道具 + 视觉风格。正式参考图有版本，改动会标记引用镜头但不自动重生成。

const KINDS: { value: StudioAssetKind; label: string }[] = [
    { value: "character", label: "人物" },
    { value: "scene", label: "场景" },
    { value: "costume", label: "服装" },
    { value: "prop", label: "道具" },
];

export function StudioAssetsWorkspace({ project, onGoWorkspace }: { project: StudioProject; onGoWorkspace: (workspace: StudioWorkspace) => void }) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const createAsset = useStudioStore((state) => state.createAsset);
    const updateAsset = useStudioStore((state) => state.updateAsset);
    const deleteAsset = useStudioStore((state) => state.deleteAsset);
    const chooseAssetVersion = useStudioStore((state) => state.chooseAssetVersion);
    const bindVoice = useStudioStore((state) => state.bindVoice);
    const updateSettings = useStudioStore((state) => state.updateSettings);
    const updateVisualStyle = useStudioStore((state) => state.updateVisualStyle);
    const [kind, setKind] = useState<StudioAssetKind>("character");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [showArchived, setShowArchived] = useState(false);
    const [busy, setBusy] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const voiceFileRef = useRef<HTMLInputElement>(null);
    const [styleOpen, setStyleOpen] = useState(false);

    const assets = useMemo(() => project.assets.filter((asset) => asset.kind === kind && (showArchived || !asset.archived)), [project.assets, kind, showArchived]);
    const asset = assets.find((item) => item.id === selectedId) ?? assets[0] ?? null;
    const impacts = asset ? affectedByAsset(project, asset.id) : [];
    const usage = asset ? assetUsage(project, asset.id) : 0;
    const voiceImpacts = asset ? affectedByVoice(project, asset) : [];

    const patch = (value: Partial<StudioAsset>) => {
        if (asset) updateAsset(project.id, asset.id, value);
    };

    const create = () => {
        if (!name.trim()) {
            message.warning("先填写资产名称");
            return;
        }
        const id = createAsset(project.id, kind, name);
        setCreating(false);
        setName("");
        if (id) setSelectedId(id);
        message.success("资产已创建，补充设定后生成正式参考图");
    };

    const generate = async () => {
        if (!asset) return;
        setBusy(asset.id);
        const result = await runAssetImage(project.id, asset.id);
        setBusy("");
        if (result.ok) message.success(asset.officialRef ? "已生成候选参考图：到版本区设为正式" : "正式参考图已生成");
        else message.error(result.error ?? "生成失败");
    };

    const uploadRef = async (file: File) => {
        if (!asset) return;
        setBusy(asset.id);
        const result = await uploadAssetReference(project.id, asset.id, file);
        setBusy("");
        if (result.ok) message.success("参考图已上传");
        else message.error(result.error ?? "上传失败");
    };

    const uploadVoiceSample = async (file: File) => {
        if (!asset) return;
        try {
            const uploaded = await uploadMediaFile(file, "studio-voice-sample");
            patch({ audioSampleRef: uploaded.storageKey });
            message.success("音色样本已保存");
        } catch {
            message.error("上传失败");
        }
    };

    return (
        <div className="studio-assets">
            <div className="studio-workspace-head">
                <div>
                    <h2>资产中心</h2>
                    <p>项目级人物、场景、服装与道具，全部集共享。正式参考图决定下游画面的一致性。</p>
                </div>
                <div className="studio-button-row">
                    <Segmented value={kind} onChange={(value) => { setKind(value as StudioAssetKind); setSelectedId(null); }} options={KINDS} />
                    <Button icon={<Palette className="size-4" />} onClick={() => setStyleOpen((open) => !open)}>
                        视觉风格与默认
                    </Button>
                </div>
            </div>

            {styleOpen ? (
                <div className="studio-style-grid">
                    <StudioPanel title="项目视觉规范" extra={<Tag bordered={false}>会写进所有提示词</Tag>}>
                        <div className="studio-form-grid">
                            <div className="studio-form-row">
                                <StudioField label="主风格">
                                    <Input value={project.visualStyle.mainStyle} onChange={(event) => updateVisualStyle(project.id, { mainStyle: event.target.value })} />
                                </StudioField>
                                <StudioField label="渲染方式">
                                    <Input value={project.visualStyle.renderMode} onChange={(event) => updateVisualStyle(project.id, { renderMode: event.target.value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="色彩">
                                    <Input value={project.visualStyle.palette} onChange={(event) => updateVisualStyle(project.id, { palette: event.target.value })} />
                                </StudioField>
                                <StudioField label="摄影">
                                    <Input value={project.visualStyle.photography} onChange={(event) => updateVisualStyle(project.id, { photography: event.target.value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="光照">
                                    <Input value={project.visualStyle.lighting} onChange={(event) => updateVisualStyle(project.id, { lighting: event.target.value })} />
                                </StudioField>
                                <StudioField label="材质">
                                    <Input value={project.visualStyle.material} onChange={(event) => updateVisualStyle(project.id, { material: event.target.value })} />
                                </StudioField>
                            </div>
                            <StudioField label="一致性要求">
                                <Input.TextArea rows={2} value={project.visualStyle.consistency} onChange={(event) => updateVisualStyle(project.id, { consistency: event.target.value })} />
                            </StudioField>
                            <StudioField label="负面提示词">
                                <Input.TextArea rows={2} value={project.visualStyle.negative} onChange={(event) => updateVisualStyle(project.id, { negative: event.target.value })} />
                            </StudioField>
                        </div>
                    </StudioPanel>
                    <StudioPanel title="生产默认（全项目继承）" extra={<Tag bordered={false}>单镜可覆盖</Tag>}>
                        <div className="studio-form-grid">
                            <div className="studio-form-row">
                                <StudioField label="文本模型">
                                    <StudioModelSelect config={config} capability="text" value={project.settings.textModel} onChange={(value) => updateSettings(project.id, { textModel: value })} />
                                </StudioField>
                                <StudioField label="图片模型">
                                    <StudioModelSelect config={config} capability="image" value={project.settings.imageModel} onChange={(value) => updateSettings(project.id, { imageModel: value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="视频模型">
                                    <StudioModelSelect config={config} capability="video" value={project.settings.videoModel} onChange={(value) => updateSettings(project.id, { videoModel: value })} />
                                </StudioField>
                                <StudioField label="音频模型">
                                    <StudioModelSelect config={config} capability="audio" value={project.settings.audioModel} onChange={(value) => updateSettings(project.id, { audioModel: value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="图片比例">
                                    <Select value={project.settings.imageRatio} options={[{ value: "自动", label: "自动" }, ...mediaRatioOptions.filter((item) => item.value !== "auto").map((item) => ({ value: item.value, label: item.value }))]} onChange={(value) => updateSettings(project.id, { imageRatio: value })} />
                                </StudioField>
                                <StudioField label="图片画质">
                                    <Select value={project.settings.imageQuality} options={ASSET_QUALITY_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateSettings(project.id, { imageQuality: value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="视频比例">
                                    <Select value={project.settings.videoRatio} options={[{ value: "自动", label: "自动" }, ...videoRatioOptions.filter((item) => item.value !== "auto").map((item) => ({ value: item.value, label: item.value }))]} onChange={(value) => updateSettings(project.id, { videoRatio: value })} />
                                </StudioField>
                                <StudioField label="视频画质">
                                    <Select value={project.settings.videoQuality} options={VIDEO_QUALITY_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateSettings(project.id, { videoQuality: value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="单镜时长">
                                    <Select value={project.settings.videoSeconds} options={SHOT_DURATION_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateSettings(project.id, { videoSeconds: value })} />
                                </StudioField>
                                <StudioField label="旁白音色">
                                    <Select value={project.settings.narratorVoice} options={[{ value: "", label: "未绑定" }, ...audioVoiceOptions]} onChange={(value) => updateSettings(project.id, { narratorVoice: value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="默认焦段">
                                    <Select value={project.settings.lens} options={LENS_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateSettings(project.id, { lens: value })} />
                                </StudioField>
                                <StudioField label="默认光圈">
                                    <Select value={project.settings.aperture} options={APERTURE_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateSettings(project.id, { aperture: value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="主光">
                                    <Select value={project.settings.keyLight} options={KEY_LIGHT_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateSettings(project.id, { keyLight: value })} />
                                </StudioField>
                                <StudioField label="补光">
                                    <Select value={project.settings.fillLight} options={FILL_LIGHT_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateSettings(project.id, { fillLight: value })} />
                                </StudioField>
                            </div>
                            <div className="studio-form-row">
                                <StudioField label="目标时长（秒）">
                                    <InputNumber value={project.settings.targetSeconds} min={15} max={600} onChange={(value) => updateSettings(project.id, { targetSeconds: Number(value) || 60 })} />
                                </StudioField>
                                <StudioField label="风格预设">
                                    <Select value={project.settings.style} options={STYLE_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateSettings(project.id, { style: value })} />
                                </StudioField>
                            </div>
                        </div>
                    </StudioPanel>
                </div>
            ) : null}

            <div className="studio-assets-body">
                <aside className="studio-asset-list">
                    <div className="studio-asset-list__head">
                        <strong>{STUDIO_ASSET_KIND_LABEL[kind]}资产 · {assets.length}</strong>
                        <Button size="small" type="primary" icon={<ImagePlus className="size-3.5" />} onClick={() => setCreating(true)}>
                            新建
                        </Button>
                    </div>
                    <div className="studio-asset-list__scroll">
                        {assets.map((item) => (
                            <button key={item.id} type="button" className={`studio-asset-item${asset?.id === item.id ? " is-active" : ""}`} onClick={() => setSelectedId(item.id)}>
                                <span className="studio-asset-item__thumb">
                                    <StudioMediaPreview storageKey={item.officialRef} kind="image" />
                                </span>
                                <span className="studio-asset-item__meta">
                                    <strong>{item.name}</strong>
                                    <small>{item.kind === "character" ? item.role || "未填身份" : item.description || "未填设定"}</small>
                                    <em>{assetUsage(project, item.id)} 镜使用</em>
                                </span>
                            </button>
                        ))}
                        {!assets.length ? <StudioEmpty title={`还没有${STUDIO_ASSET_KIND_LABEL[kind]}资产`} description="从资产库新建，或在导演中心拆镜时自动提取。" action={<Button onClick={() => setCreating(true)}>新建{STUDIO_ASSET_KIND_LABEL[kind]}</Button>} /> : null}
                    </div>
                    <div className="studio-asset-list__foot">
                        <Button size="small" type="text" onClick={() => setShowArchived((value) => !value)}>
                            {showArchived ? "隐藏归档" : "显示归档"}
                        </Button>
                    </div>
                </aside>

                {asset ? (
                    <div className="studio-asset-detail">
                        <div className="studio-asset-hero">
                            <div className="studio-asset-hero__media">
                                <StudioMediaPreview storageKey={asset.officialRef} kind="image" />
                                {busy === asset.id ? <div className="studio-asset-hero__mask">生成中…</div> : null}
                            </div>
                            <div className="studio-asset-hero__info">
                                <div className="studio-asset-hero__title">
                                    <Input value={asset.name} onChange={(event) => patch({ name: event.target.value })} variant="borderless" className="studio-asset-name" />
                                    <Tag bordered={false}>{STUDIO_ASSET_KIND_LABEL[asset.kind]}</Tag>
                                    {impacts.length ? <Tag color="warning" bordered={false}>{impacts.length} 个镜头受影响</Tag> : null}
                                </div>
                                <div className="studio-asset-stats">
                                    <StudioStat label="引用镜头" value={usage} />
                                    <StudioStat label="候选版本" value={asset.versions.length} />
                                    <StudioStat label="正式参考" value={asset.officialRef ? "已设置" : "未设置"} />
                                    {asset.kind === "character" ? <StudioStat label="绑定音色" value={asset.voiceId ? audioVoiceOptions.find((item) => item.value === asset.voiceId)?.label ?? asset.voiceId : "未绑定"} /> : null}
                                </div>
                                <div className="studio-button-row">
                                    <Button type="primary" icon={<Wand2 className="size-4" />} loading={busy === asset.id} onClick={() => void generate()}>
                                        {asset.officialRef ? "生成候选参考图" : "生成正式参考图"}
                                    </Button>
                                    <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
                                        上传参考图
                                    </Button>
                                    <Button icon={<Download className="size-4" />} disabled={!asset.officialRef} onClick={() => void downloadStudioMedia(asset.officialRef, `资产_${asset.name}`, "image").catch((error) => message.error(error instanceof Error ? error.message : "导出失败"))}>
                                        下载正式参考图
                                    </Button>
                                    <Popconfirm title="删除这个资产？" description={usage ? `还有 ${usage} 个镜头引用它，需要先解除绑定。` : "删除后无法恢复。"} onConfirm={() => {
                                        const result = deleteAsset(project.id, asset.id);
                                        if (result.ok) { message.success("资产已删除"); setSelectedId(null); }
                                        else message.error(result.reason ?? "删除失败");
                                    }} okText="删除">
                                        <Button danger type="text" icon={<Trash2 className="size-4" />} />
                                    </Popconfirm>
                                    <Tooltip title={asset.archived ? "取消归档" : "归档资产：不参与新镜头选择"}>
                                        <Button type="text" onClick={() => patch({ archived: !asset.archived })}>
                                            {asset.archived ? "恢复" : "归档"}
                                        </Button>
                                    </Tooltip>
                                </div>
                                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void uploadRef(file);
                                    event.target.value = "";
                                }} />
                            </div>
                        </div>

                        <div className="studio-asset-editor">
                            <StudioPanel
                                title="设定"
                                extra={<Button size="small" icon={<Save className="size-3.5" />} onClick={() => message.success("设定会实时保存")}>已自动保存</Button>}
                            >
                                <div className="studio-form-grid">
                                    {asset.kind === "character" ? (
                                        <>
                                            <div className="studio-form-row">
                                                <StudioField label="身份 / 角色定位"><Input value={asset.role} onChange={(event) => patch({ role: event.target.value })} placeholder="主角 / 反派 / 师父" /></StudioField>
                                                <StudioField label="年龄感"><Input value={asset.age} onChange={(event) => patch({ age: event.target.value })} placeholder="20 岁出头" /></StudioField>
                                            </div>
                                            <StudioField label="人物设定"><Input.TextArea rows={3} value={asset.description} onChange={(event) => patch({ description: event.target.value })} placeholder="身份、性格、目标和不能改的识别点" /></StudioField>
                                            <div className="studio-form-row">
                                                <StudioField label="面部特征"><Input value={asset.face} onChange={(event) => patch({ face: event.target.value })} placeholder="脸型、眉眼、痣、疤痕" /></StudioField>
                                                <StudioField label="发型"><Input value={asset.hair} onChange={(event) => patch({ hair: event.target.value })} /></StudioField>
                                            </div>
                                            <div className="studio-form-row">
                                                <StudioField label="身材"><Input value={asset.body} onChange={(event) => patch({ body: event.target.value })} /></StudioField>
                                                <StudioField label="常穿服装"><Input value={asset.costume} onChange={(event) => patch({ costume: event.target.value })} /></StudioField>
                                            </div>
                                            <div className="studio-form-row">
                                                <StudioField label="绑定音色">
                                                    <Select
                                                        showSearch
                                                        value={asset.voiceId ?? ""}
                                                        options={[{ value: "", label: "未绑定" }, ...audioVoiceOptions]}
                                                        onChange={(value) => {
                                                            bindVoice(project.id, asset.id, value);
                                                            const count = affectedByVoice(project, { ...asset, voiceId: value }).length;
                                                            message.success(count ? `音色已保存：${count} 条已有对白需要重新生成才能听到新音色` : "音色已保存");
                                                        }}
                                                    />
                                                </StudioField>
                                                <StudioField label="音色样本">
                                                    <div className="studio-inline-row">
                                                        <Button size="small" icon={<Mic className="size-3.5" />} onClick={() => voiceFileRef.current?.click()}>上传样本</Button>
                                                        {asset.audioSampleRef ? <StudioMediaPreview storageKey={asset.audioSampleRef} kind="audio" /> : <span className="studio-muted">未上传</span>}
                                                    </div>
                                                </StudioField>
                                            </div>
                                            <input ref={voiceFileRef} type="file" accept="audio/*" hidden onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                if (file) void uploadVoiceSample(file);
                                                event.target.value = "";
                                            }} />
                                        </>
                                    ) : null}

                                    {asset.kind === "scene" ? (
                                        <>
                                            <StudioField label="场景设定"><Input.TextArea rows={3} value={asset.description} onChange={(event) => patch({ description: event.target.value })} placeholder="空间结构、陈设、气氛、时代感" /></StudioField>
                                            <div className="studio-form-row">
                                                <StudioField label="空间布局"><Input value={asset.layout} onChange={(event) => patch({ layout: event.target.value })} placeholder="纵深、出入口、主体位置" /></StudioField>
                                                <StudioField label="环境"><Input value={asset.environment} onChange={(event) => patch({ environment: event.target.value })} /></StudioField>
                                            </div>
                                            <div className="studio-form-row">
                                                <StudioField label="时间"><Input value={asset.timeOfDay} onChange={(event) => patch({ timeOfDay: event.target.value })} placeholder="日 / 夜 / 黄昏" /></StudioField>
                                                <StudioField label="天气"><Input value={asset.weather} onChange={(event) => patch({ weather: event.target.value })} /></StudioField>
                                            </div>
                                            <div className="studio-form-row">
                                                <StudioField label="光线"><Input value={asset.lighting} onChange={(event) => patch({ lighting: event.target.value })} /></StudioField>
                                                <StudioField label="材质"><Input value={asset.material} onChange={(event) => patch({ material: event.target.value })} /></StudioField>
                                            </div>
                                        </>
                                    ) : null}

                                    {asset.kind === "costume" || asset.kind === "prop" ? (
                                        <>
                                            <StudioField label="设定"><Input.TextArea rows={3} value={asset.description} onChange={(event) => patch({ description: event.target.value })} placeholder="版型、材质、颜色、结构、尺寸比例" /></StudioField>
                                            <div className="studio-form-row">
                                                <StudioField label="材质"><Input value={asset.material} onChange={(event) => patch({ material: event.target.value })} /></StudioField>
                                                <StudioField label="角色 / 归属"><Input value={asset.role} onChange={(event) => patch({ role: event.target.value })} /></StudioField>
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            </StudioPanel>

                            <StudioPanel title="参考图版本" extra={<span className="studio-muted">点选设为正式版会标记下游镜头，不会自动重生成</span>}>
                                <StudioVersionStrip
                                    versions={asset.versions}
                                    kind="image"
                                    currentKey={asset.officialRef}
                                    emptyText="生成或上传第一张参考图"
                                    onChoose={(version) => {
                                        const count = chooseAssetVersion(project.id, asset.id, version.id);
                                        message.success(count ? `已设为正式版：${count} 个引用镜头已标记，需人工确认` : "已设为正式版");
                                    }}
                                />
                                {impacts.length ? (
                                    <div className="studio-impact-box">
                                        <strong>受本次资产修改影响的镜头</strong>
                                        <ul>
                                            {impacts.map((impact) => (
                                                <li key={`${impact.episodeId}-${impact.shotId}`}>
                                                    <button type="button" onClick={() => onGoWorkspace("picture")}>
                                                        {impact.episodeTitle} · 镜 {impact.shotNo}
                                                    </button>
                                                    <span>{impact.media.map((media) => (media === "image" ? "首帧" : "视频")).join(" / ")} · {impact.reason}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <Button size="small" icon={<ArrowRight className="size-3.5" />} onClick={() => onGoWorkspace("picture")}>到画面中心逐镜确认</Button>
                                    </div>
                                ) : null}
                                {voiceImpacts.length ? (
                                    <p className="studio-muted">音色变化影响 {voiceImpacts.length} 条已有对白；重新生成后才会使用新音色。</p>
                                ) : null}
                            </StudioPanel>

                            <details className="studio-prompt-preview">
                                <summary>查看当前资产提示词</summary>
                                <pre>{buildAssetPrompt(project, asset)}</pre>
                            </details>
                        </div>
                    </div>
                ) : (
                    <div className="studio-asset-detail studio-asset-detail--empty">
                        <StudioEmpty icon={<UserRound className="size-9" />} title="选择一个资产" description="左侧选择资产查看设定、参考图和受影响镜头。" />
                    </div>
                )}
            </div>

            <Modal title={`新建${STUDIO_ASSET_KIND_LABEL[kind]}`} open={creating} onCancel={() => setCreating(false)} onOk={create} okText="创建" width={420}>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "character" ? "角色名，例如：沈青梧" : kind === "scene" ? "场景名，例如：青云宗山门" : "名称"} autoFocus onPressEnter={create} />
                <p className="studio-form-hint">创建后补充设定，再生成正式参考图；同一项目所有集共享这个资产。</p>
            </Modal>
        </div>
    );
}


