import { useMemo, useRef, useState } from "react";
import { App, Button, Input, Modal, Popconfirm, Segmented, Select, Tag } from "antd";
import { ArrowRight, AudioLines, Disc3, Download, Mic, Music, RefreshCcw, Sparkles, Trash2, Upload } from "lucide-react";

import { audioVoiceOptions } from "@/lib/audio-generation";
import { runShotAudio, uploadShotSfx } from "@/lib/studio/actions";
import { downloadStudioMedia } from "@/lib/studio/export";
import { uploadMediaFile } from "@/services/file-storage";
import { useConfigStore } from "@/stores/use-config-store";
import { useStudioStore } from "@/stores/use-studio-store";
import type { StudioProject, StudioShot, StudioWorkspace } from "@/types/studio";
import type { StudioEpisode } from "@/types/studio";

import { StudioEmpty, StudioField, StudioMediaPreview, StudioModelSelect, StudioPanel, StudioStat, StudioStatus, StudioVersionStrip } from "./ui";

// 声音中心：人物音色 + 对白 + 旁白 + 音效 + BGM。
// 对白/旁白走真实语音合成；音效与 BGM 当前链路没有音乐模型，只支持导入并记录需求，不伪装成可生成。

const TABS = [
    { value: "voices", label: "角色音色" },
    { value: "dialogue", label: "对白" },
    { value: "narration", label: "旁白" },
    { value: "sfx", label: "音效" },
    { value: "bgm", label: "BGM" },
];

export function StudioSoundWorkspace({ project, episode, onGoWorkspace }: { project: StudioProject; episode: StudioEpisode; onGoWorkspace: (workspace: StudioWorkspace) => void }) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateSettings = useStudioStore((state) => state.updateSettings);
    const updateProject = useStudioStore((state) => state.updateProject);
    const bindVoice = useStudioStore((state) => state.bindVoice);
    const updateShot = useStudioStore((state) => state.updateShot);
    const chooseShotVersion = useStudioStore((state) => state.chooseShotVersion);
    const addBgmTrack = useStudioStore((state) => state.addBgmTrack);
    const updateBgmTrack = useStudioStore((state) => state.updateBgmTrack);
    const removeBgmTrack = useStudioStore((state) => state.removeBgmTrack);
    const [tab, setTab] = useState("voices");
    const [busy, setBusy] = useState("");
    const [bgmModal, setBgmModal] = useState(false);
    const [bgmName, setBgmName] = useState("");
    const [bgmPurpose, setBgmPurpose] = useState("");
    const [bgmMood, setBgmMood] = useState("");
    const [bgmFile, setBgmFile] = useState<File | null>(null);
    const sfxRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const bgmInputRef = useRef<HTMLInputElement>(null);

    const characters = project.assets.filter((asset) => asset.kind === "character" && !asset.archived);
    const lineShots = useMemo(() => episode.shots.filter((shot) => shot.line.trim()), [episode.shots]);
    const narrationShots = useMemo(() => episode.shots.filter((shot) => shot.narration.trim()), [episode.shots]);
    const sfxShots = useMemo(() => episode.shots.filter((shot) => shot.sfx.trim() || shot.ambience.trim() || shot.sfxRef), [episode.shots]);
    const dialogueDone = lineShots.filter((shot) => shot.audioRef).length;
    const narrationDone = narrationShots.filter((shot) => shot.narrationRef).length;
    const totalVoiced = project.assets.filter((asset) => asset.kind === "character" && asset.voiceId).length;

    const generateAudio = async (shot: StudioShot, media: "audio" | "narration") => {
        setBusy(`${shot.id}-${media}`);
        const result = await runShotAudio(project.id, episode.id, shot.id, media);
        setBusy("");
        if (result.ok) message.success(`镜 ${shot.no} ${media === "audio" ? "对白" : "旁白"}已生成`);
        else message.error(result.error ?? "生成失败");
        return result.ok;
    };

    const batchAudio = async (shots: StudioShot[], media: "audio" | "narration") => {
        if (!shots.length) {
            message.info("没有可生成的条目");
            return;
        }
        const results = await Promise.all(shots.map((shot) => generateAudio(shot, media)));
        const ok = results.filter(Boolean).length;
        if (ok) message.success(`完成 ${ok} / ${shots.length} 条`);
        if (ok < shots.length) message.warning(`${shots.length - ok} 条失败，见任务中心`);
    };

    const uploadSfx = async (shot: StudioShot, file: File) => {
        setBusy(`${shot.id}-sfx`);
        const result = await uploadShotSfx(project.id, episode.id, shot.id, file);
        setBusy("");
        if (result.ok) message.success("音效已导入");
        else message.error(result.error ?? "导入失败");
    };

    const createBgm = async () => {
        if (!bgmName.trim() || !bgmFile) {
            message.warning("填写曲名并选择音频文件");
            return;
        }
        try {
            const uploaded = await uploadMediaFile(bgmFile, "studio-bgm");
            addBgmTrack(project.id, { name: bgmName, purpose: bgmPurpose, mood: bgmMood, storageKey: uploaded.storageKey, source: "upload" });
            setBgmModal(false);
            setBgmName("");
            setBgmPurpose("");
            setBgmMood("");
            setBgmFile(null);
            message.success("BGM 已加入项目库");
        } catch {
            message.error("BGM 导入失败");
        }
    };

    return (
        <div className="studio-sound">
            <div className="studio-workspace-head">
                <div>
                    <h2>声音中心</h2>
                    <p>角色音色跨集绑定；对白和旁白直接引用镜头文本，生成结果按版本管理。</p>
                </div>
                <div className="studio-button-row">
                    <StudioModelSelect config={config} capability="audio" value={project.settings.audioModel} onChange={(value) => updateSettings(project.id, { audioModel: value })} />
                    <Select
                        style={{ width: 180 }}
                        value={project.settings.narratorVoice}
                        placeholder="旁白音色"
                        options={[{ value: "", label: "旁白音色：未绑定" }, ...audioVoiceOptions]}
                        onChange={(value) => updateSettings(project.id, { narratorVoice: value })}
                    />
                    <Segmented value={tab} onChange={(value) => setTab(String(value))} options={TABS} />
                </div>
            </div>

            <div className="studio-media-stats">
                <StudioStat label="已绑定音色" value={`${totalVoiced} / ${characters.length}`} />
                <StudioStat label="对白" value={`${dialogueDone} / ${lineShots.length}`} />
                <StudioStat label="旁白" value={`${narrationDone} / ${narrationShots.length}`} />
                <StudioStat label="BGM" value={project.bgmTracks?.length ?? 0} />
            </div>

            {tab === "voices" ? (
                <div className="studio-voice-grid">
                    {characters.map((character) => {
                        const lines = episode.shots.filter((shot) => shot.speaker === character.name && shot.line.trim());
                        const allLines = project.episodes.flatMap((item) => item.shots.filter((shot) => shot.speaker === character.name && shot.line.trim()));
                        return (
                            <article key={character.id} className="studio-voice-card">
                                <div className="studio-voice-card__head">
                                    <div className="studio-voice-card__avatar">
                                        <StudioMediaPreview storageKey={character.officialRef} kind="image" />
                                    </div>
                                    <div>
                                        <strong>{character.name}</strong>
                                        <span>{character.role || "未填身份"}</span>
                                        <small>{allLines.length} 条台词 · 跨 {new Set(project.episodes.filter((item) => item.shots.some((shot) => shot.speaker === character.name)).map((item) => item.id)).size} 集</small>
                                    </div>
                                </div>
                                <StudioField label="绑定音色">
                                    <Select
                                        showSearch
                                        value={character.voiceId ?? ""}
                                        options={[{ value: "", label: "未绑定" }, ...audioVoiceOptions]}
                                        onChange={(value) => {
                                            bindVoice(project.id, character.id, value);
                                            message.success("音色已保存，跨集生效；已有对白需要重新生成才会使用新音色");
                                        }}
                                    />
                                </StudioField>
                                <div className="studio-voice-card__foot">
                                    {character.audioSampleRef ? <StudioMediaPreview storageKey={character.audioSampleRef} kind="audio" /> : <span className="studio-muted">还没有音色样本</span>}
                                    <span className="studio-muted">本集 {lines.length} 条待配</span>
                                </div>
                            </article>
                        );
                    })}
                    {!characters.length ? <StudioEmpty icon={<Mic className="size-9" />} title="还没有人物资产" description="先在资产中心创建人物并绑定音色。" action={<Button onClick={() => onGoWorkspace("assets")}>去资产中心</Button>} /> : null}
                </div>
            ) : null}

            {tab === "dialogue" ? (
                <StudioPanel title={`对白 · ${lineShots.length} 条`} extra={<Button type="primary" icon={<AudioLines className="size-4" />} onClick={() => void batchAudio(lineShots.filter((shot) => !shot.audioRef), "audio")}>批量生成未配音</Button>}>
                    <div className="studio-audio-list">
                        {lineShots.map((shot) => {
                            const character = project.assets.find((asset) => asset.kind === "character" && asset.name === shot.speaker);
                            const voiceLabel = character?.voiceId ? audioVoiceOptions.find((item) => item.value === character.voiceId)?.label ?? character.voiceId : "未绑定音色";
                            return (
                                <article key={shot.id} className="studio-audio-row">
                                    <div className="studio-audio-row__text">
                                        <header><strong>镜 {shot.no}</strong><Tag bordered={false}>{shot.speaker || "缺说话人"}</Tag><span>{voiceLabel}</span><StudioStatus status={shot.audioStatus} /></header>
                                        <p>{shot.line}</p>
                                        {shot.impact?.audio ? <small className="studio-danger">{shot.impact.audio}</small> : null}
                                    </div>
                                    <div className="studio-audio-row__media"><StudioMediaPreview storageKey={shot.audioRef} kind="audio" /></div>
                                    <div className="studio-audio-row__ops">
                                        <Button size="small" type="primary" icon={<Sparkles className="size-3.5" />} loading={busy === `${shot.id}-audio`} onClick={() => void generateAudio(shot, "audio")}>
                                            {shot.audioRef ? "重新配音" : "生成对白"}
                                        </Button>
                                        <StudioVersionStrip versions={shot.audioVersions} kind="audio" currentKey={shot.audioRef} onChoose={(version) => chooseShotVersion(project.id, episode.id, shot.id, "audio", version.id)} />
                                        <Button size="small" icon={<Download className="size-3.5" />} disabled={!shot.audioRef} onClick={() => void downloadStudioMedia(shot.audioRef, `短剧_镜${shot.no}_对白_${project.title}`, "audio").catch((error) => message.error(error instanceof Error ? error.message : "导出失败"))}>下载</Button>
                                    </div>
                                </article>
                            );
                        })}
                        {!lineShots.length ? <StudioEmpty title="这一集没有对白" description="在导演中心给镜头填写台词和说话人。" action={<Button onClick={() => onGoWorkspace("director")}>去导演中心</Button>} /> : null}
                    </div>
                </StudioPanel>
            ) : null}

            {tab === "narration" ? (
                <StudioPanel title={`旁白 · ${narrationShots.length} 条`} extra={<Button type="primary" icon={<AudioLines className="size-4" />} onClick={() => void batchAudio(narrationShots.filter((shot) => !shot.narrationRef), "narration")}>批量生成未配音</Button>}>
                    {!project.settings.narratorVoice ? <p className="studio-blocked">还没有绑定旁白音色：在上方选择后再生成。</p> : null}
                    <div className="studio-audio-list">
                        {narrationShots.map((shot) => (
                            <article key={shot.id} className="studio-audio-row">
                                <div className="studio-audio-row__text">
                                    <header><strong>镜 {shot.no}</strong><span>{audioVoiceOptions.find((item) => item.value === project.settings.narratorVoice)?.label ?? "旁白音色未绑定"}</span><StudioStatus status={shot.narrationStatus} /></header>
                                    <p>{shot.narration}</p>
                                </div>
                                <div className="studio-audio-row__media"><StudioMediaPreview storageKey={shot.narrationRef} kind="narration" /></div>
                                <div className="studio-audio-row__ops">
                                    <Button size="small" type="primary" icon={<Sparkles className="size-3.5" />} loading={busy === `${shot.id}-narration`} onClick={() => void generateAudio(shot, "narration")}>
                                        {shot.narrationRef ? "重新生成" : "生成旁白"}
                                    </Button>
                                    <StudioVersionStrip versions={shot.narrationVersions} kind="narration" currentKey={shot.narrationRef} onChoose={(version) => chooseShotVersion(project.id, episode.id, shot.id, "narration", version.id)} />
                                    <Button size="small" icon={<Download className="size-3.5" />} disabled={!shot.narrationRef} onClick={() => void downloadStudioMedia(shot.narrationRef, `短剧_镜${shot.no}_旁白_${project.title}`, "audio").catch((error) => message.error(error instanceof Error ? error.message : "导出失败"))}>下载</Button>
                                </div>
                            </article>
                        ))}
                        {!narrationShots.length ? <StudioEmpty title="这一集没有旁白" description="在导演中心填写旁白文本。" /> : null}
                    </div>
                </StudioPanel>
            ) : null}

            {tab === "sfx" ? (
                <StudioPanel title="音效与环境声" extra={<Tag color="warning" bordered={false}>当前音频模型为语音合成，不支持生成音效</Tag>}>
                    <p className="studio-form-hint">
                        音效生成需要接入专门的音效/环境声模型。当前版本支持把导演中心写好的音效需求作为清单，并导入外部音效；不会用 TTS 伪造音效。
                    </p>
                    <div className="studio-audio-list">
                        {sfxShots.map((shot) => (
                            <article key={shot.id} className="studio-audio-row">
                                <div className="studio-audio-row__text">
                                    <header><strong>镜 {shot.no}</strong><StudioStatus status={shot.sfxStatus} /></header>
                                    <div className="studio-form-row">
                                        <label><span>环境声</span><Input value={shot.ambience} onChange={(event) => updateShot(project.id, episode.id, shot.id, { ambience: event.target.value })} /></label>
                                        <label><span>音效</span><Input value={shot.sfx} onChange={(event) => updateShot(project.id, episode.id, shot.id, { sfx: event.target.value })} /></label>
                                    </div>
                                </div>
                                <div className="studio-audio-row__media"><StudioMediaPreview storageKey={shot.sfxRef} kind="sfx" /></div>
                                <div className="studio-audio-row__ops">
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => sfxRefs.current[shot.id]?.click()}>导入音效</Button>
                                    <StudioVersionStrip versions={shot.sfxVersions} kind="sfx" currentKey={shot.sfxRef} onChoose={(version) => chooseShotVersion(project.id, episode.id, shot.id, "sfx", version.id)} />
                                    <Button size="small" icon={<Download className="size-3.5" />} disabled={!shot.sfxRef} onClick={() => void downloadStudioMedia(shot.sfxRef, `短剧_镜${shot.no}_音效_${project.title}`, "audio").catch((error) => message.error(error instanceof Error ? error.message : "导出失败"))}>下载</Button>
                                    <input ref={(node) => { sfxRefs.current[shot.id] = node; }} type="file" accept="audio/*" hidden onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) void uploadSfx(shot, file);
                                        event.target.value = "";
                                    }} />
                                </div>
                            </article>
                        ))}
                        {!sfxShots.length ? <StudioEmpty title="还没有音效需求" description="在导演中心填写环境声或音效描述。" /> : null}
                    </div>
                </StudioPanel>
            ) : null}

            {tab === "bgm" ? (
                <div className="studio-bgm">
                    <StudioPanel
                        title="项目 BGM 库"
                        extra={<div className="studio-button-row"><Tag color="warning" bordered={false}>生成需音乐模型</Tag><Button type="primary" icon={<Music className="size-4" />} onClick={() => setBgmModal(true)}>导入 BGM</Button></div>}
                    >
                        <StudioField label="配乐需求（后续接音乐生成模型时直接使用）">
                            <Input.TextArea rows={3} value={project.bgmBrief ?? ""} onChange={(event) => updateProject(project.id, { bgmBrief: event.target.value })} placeholder="例如：赛博江湖主题，合成器 + 古筝，主情绪压迫、第二段转为悲怆。" />
                        </StudioField>
                        <div className="studio-bgm-grid">
                            {(project.bgmTracks ?? []).map((track) => (
                                <article key={track.id} className="studio-bgm-card">
                                    <header><Disc3 className="size-4" /><strong>{track.name}</strong><StudioStatus status="succeeded" text="已导入" /></header>
                                    <div className="studio-form-row">
                                        <label><span>用途</span><Input value={track.purpose} onChange={(event) => updateBgmTrack(project.id, track.id, { purpose: event.target.value })} placeholder="片头 / 情绪段落 / 片尾" /></label>
                                        <label><span>情绪</span><Input value={track.mood} onChange={(event) => updateBgmTrack(project.id, track.id, { mood: event.target.value })} placeholder="压迫 / 温暖 / 悲怆" /></label>
                                    </div>
                                    <StudioMediaPreview storageKey={track.storageKey} kind="audio" />
                                    <div className="studio-button-row">
                                        <Button size="small" icon={<Download className="size-3.5" />} onClick={() => void downloadStudioMedia(track.storageKey, `BGM_${track.name}`, "audio").catch((error) => message.error(error instanceof Error ? error.message : "导出失败"))}>下载 BGM</Button>
                                        <Popconfirm title="移除这首 BGM？" description="只移除项目记录，不删除素材库文件。" onConfirm={() => removeBgmTrack(project.id, track.id)} okText="移除">
                                            <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />}>移除</Button>
                                        </Popconfirm>
                                    </div>
                                </article>
                            ))}
                            {!(project.bgmTracks ?? []).length ? <StudioEmpty icon={<Music className="size-9" />} title="还没有 BGM" description="导入现有配乐，或先记录配乐需求。当前 TTS 链路不能生成音乐。" action={<Button onClick={() => setBgmModal(true)}>导入 BGM</Button>} /> : null}
                        </div>
                    </StudioPanel>
                </div>
            ) : null}

            <div className="studio-director-footer">
                <div><strong>下一步</strong><span>声音完成后，可在任务中心统一检查所有生成状态。</span></div>
                <Button icon={<ArrowRight className="size-4" />} onClick={() => onGoWorkspace("picture")}>回画面中心</Button>
                <Button icon={<RefreshCcw className="size-4" />} onClick={() => onGoWorkspace("video")}>去视频中心</Button>
            </div>

            <Modal title="导入 BGM" open={bgmModal} onCancel={() => setBgmModal(false)} onOk={() => void createBgm()} okText="导入" width={520}>
                <div className="studio-form-grid">
                    <StudioField label="曲名"><Input value={bgmName} onChange={(event) => setBgmName(event.target.value)} /></StudioField>
                    <div className="studio-form-row">
                        <StudioField label="用途"><Input value={bgmPurpose} onChange={(event) => setBgmPurpose(event.target.value)} placeholder="片头 / 情绪段落" /></StudioField>
                        <StudioField label="情绪"><Input value={bgmMood} onChange={(event) => setBgmMood(event.target.value)} placeholder="压迫 / 温暖" /></StudioField>
                    </div>
                    <StudioField label="音频文件">
                        <Button icon={<Upload className="size-4" />} onClick={() => bgmInputRef.current?.click()}>{bgmFile ? bgmFile.name : "选择音频"}</Button>
                        <input ref={bgmInputRef} type="file" accept="audio/*" hidden onChange={(event) => setBgmFile(event.target.files?.[0] ?? null)} />
                    </StudioField>
                </div>
            </Modal>
        </div>
    );
}
