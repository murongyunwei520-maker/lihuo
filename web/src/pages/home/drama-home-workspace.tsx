import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Clapperboard, Download, FileUp, Film, ImagePlus, Play, Plus, Save, Sparkles, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { StudioButton } from "@/components/studio/studio-controls";
import { APP_BRAND } from "@/constant/app";
import { totalSeconds } from "@/lib/drama/lint";
import { SHOT_STATUS_LABEL, frameGradient } from "@/lib/drama/schema";
import { makeScript, readScriptFile, SCRIPT_ACCEPT } from "@/lib/drama/script";
import { DEFAULT_DRAMA_SETTINGS, episodeCountOf, SETTING_OPTIONS } from "@/lib/drama/settings";
import { resolveMediaUrl } from "@/services/file-storage";
import { useAgentStore } from "@/stores/use-agent-store";
import { modelOptionName, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import type { DramaAsset, DramaSequence, DramaSettings, DramaShot } from "@/types/drama";
import { DRAMA_STEPS } from "@/lib/drama/workflow";

const STEP_LABELS = DRAMA_STEPS.map((item) => item.label);

function useMedia(ref?: string | null) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let alive = true;
        const direct = ref ? /^(https?|data|blob):|^\//.test(ref) : false;
        setUrl(ref && direct ? ref : "");
        if (ref && !direct) void resolveMediaUrl(ref, "").then((value) => { if (alive) setUrl(value); });
        return () => { alive = false; };
    }, [ref]);
    return url;
}

function ShotThumb({ shot, index, selected, onClick }: { shot: DramaShot; index: number; selected?: boolean; onClick?: () => void }) {
    const url = useMedia(shot.imageRef);
    return (
        <button type="button" className={`drama-home-shot ${selected ? "is-selected" : ""}`} onClick={onClick} title={shot.line || shot.prompt || `镜头 ${shot.no}`}>
            <span className="drama-home-shot__image" style={{ background: frameGradient(shot.scene || shot.id || String(index)) }}>
                {url ? <img src={url} alt={`镜头 ${shot.no}`} /> : <Film aria-hidden="true" />}
                <i>{shot.no}</i>
            </span>
            <span className="drama-home-shot__meta"><b>{shot.seconds}s</b><small>{shot.imageRef ? "已出图" : SHOT_STATUS_LABEL[shot.status]}</small></span>
        </button>
    );
}

function AssetThumb({ asset }: { asset: DramaAsset }) {
    const firstRef = asset.refs[0];
    const url = useMedia(firstRef);
    return (
        <div className="drama-home-asset">
            <span style={{ background: frameGradient(asset.name) }}>{url ? <img src={url} alt={asset.name} /> : <ImagePlus />}</span>
            <strong>{asset.name}</strong>
            <small>{asset.kind === "character" ? "人物" : asset.kind === "scene" ? "场景" : "道具"} · {asset.refs.length} 张参考图</small>
        </div>
    );
}

function modelLabel(value: string) {
    return value ? modelOptionName(value) : "自动";
}

export function DramaHomeWorkspace() {
    const navigate = useNavigate();
    const hydrated = useDramaStore((state) => state.hydrated);
    const sequences = useDramaStore((state) => state.sequences);
    const createSequence = useDramaStore((state) => state.createSequence);
    const updateSequence = useDramaStore((state) => state.updateSequence);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const eventLogs = useAgentStore((state) => state.eventLogs);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [step, setStep] = useState(0);
    const [premise, setPremise] = useState("");
    const [scriptDraft, setScriptDraft] = useState("");
    const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    const sequence = useMemo(() => sequences.find((item) => item.id === activeId) ?? sequences[0] ?? null, [sequences, activeId]);
    const textModels = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const videoModels = useMemo(() => selectableModelsByCapability(config, "video"), [config]);
    const selectedShot = sequence?.shots.find((shot) => shot.id === selectedShotId) ?? sequence?.shots[0] ?? null;
    const settings: DramaSettings = { ...DEFAULT_DRAMA_SETTINGS, ...(sequence?.settings ?? {}) };
    const recentLogs = eventLogs.slice(-4).reverse();
    const videoLog = [...eventLogs].reverse().find((item) => /视频|video/i.test(`${item.title}${item.text}`));
    const imageDone = sequence?.shots.filter((shot) => shot.imageRef).length ?? 0;

    useEffect(() => {
        if (!sequence) return;
        setPremise(sequence.script?.premise || "");
        setScriptDraft(sequence.script?.text || "");
        setSelectedShotId(sequence.shots[0]?.id || null);
        setSaved(false);
    }, [sequence?.id]);

    const updateSettings = (patch: Partial<DramaSettings>) => {
        if (sequence) updateSequence(sequence.id, { settings: { ...settings, ...patch } });
    };

    const save = () => {
        if (!sequence) return;
        const source = sequence.script?.source && sequence.script.source !== "none" ? sequence.script.source : "paste";
        const text = step === 1 ? scriptDraft : sequence.script?.text || scriptDraft;
        updateSequence(sequence.id, { script: makeScript(text, source, { ...sequence.script, premise: premise.trim() }) });
        setSaved(true);
    };

    const openFull = (targetStep = step) => {
        if (!sequence) return;
        save();
        navigate(`/drama?sequence=${encodeURIComponent(sequence.id)}&step=${targetStep}`);
    };

    const createProject = () => {
        const id = createSequence("未命名短剧");
        setActiveId(id);
        setStep(0);
    };

    const uploadScript = async (file?: File) => {
        if (!file || !sequence) return;
        try {
            const text = await readScriptFile(file);
            const nextPremise = text.slice(0, 160);
            setScriptDraft(text);
            setPremise(nextPremise);
            updateSequence(sequence.id, { script: makeScript(text, "upload", { premise: nextPremise }) });
            setStep(1);
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : "无法读取剧本文件");
        } finally {
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const stepDone = (index: number) => {
        if (!sequence) return false;
        if (index === 0) return Boolean(sequence.script?.premise || sequence.script?.text);
        if (index === 1) return Boolean(sequence.script?.text);
        if (index === 2) return sequence.assets.length > 0;
        if (index === 3) return sequence.assets.some((asset) => asset.refs.length > 0);
        if (index === 4 || index === 5) return sequence.shots.length > 0;
        if (index === 6) return sequence.shots.some((shot) => shot.imageRef || shot.audioRef);
        return false;
    };

    const renderEditor = () => {
        if (!sequence) return null;
        if (step === 0) return (
            <div className="drama-home-editor__section">
                <label className="drama-home-field"><span>灵感输入</span><textarea value={premise} onChange={(event) => { setPremise(event.target.value); setSaved(false); }} placeholder="写下故事灵感、人物关系或改编方向……" /></label>
                <div className="drama-home-button-row">
                    <StudioButton icon={<FileUp />} onClick={() => fileRef.current?.click()}>上传剧本</StudioButton>
                    <StudioButton icon={<Upload />} onClick={() => fileRef.current?.click()}>小说改编</StudioButton>
                    <StudioButton icon={<Clapperboard />} onClick={() => setStep(9)}>分镜画布</StudioButton>
                </div>
                <label className="drama-home-inline-field"><span>文本模型</span><select value={settings.textModel} onChange={(event) => updateSettings({ textModel: event.target.value })}><option value="">自动</option>{textModels.map((value) => <option key={value} value={value}>{modelOptionName(value)}</option>)}</select></label>
                <StudioButton variant="primary" icon={<Sparkles />} onClick={() => openFull(0)}>前往完整工坊生成剧本</StudioButton>
            </div>
        );
        if (step === 1) return (
            <div className="drama-home-editor__section drama-home-editor__section--fill">
                <textarea className="drama-home-script" value={scriptDraft} onChange={(event) => { setScriptDraft(event.target.value); setSaved(false); }} placeholder="在此编辑剧本，保存后会写入当前真实项目。" />
                <div className="drama-home-button-row"><StudioButton icon={<Sparkles />} onClick={() => setStep(0)}>重新生成</StudioButton><StudioButton variant="primary" icon={<Save />} onClick={save}>保存剧本</StudioButton></div>
            </div>
        );
        if (step === 2) return (
            <div className="drama-home-editor__section">
                <label className="drama-home-inline-field"><span>故事风格</span><select value={settings.style} onChange={(event) => updateSettings({ style: event.target.value })}>{SETTING_OPTIONS.style.map((value) => <option key={value}>{value}</option>)}</select></label>
                <div className="drama-home-asset-grid">{sequence.assets.slice(0, 3).map((asset) => <div className="drama-home-profile" key={asset.id}><strong>{asset.name}</strong><span>{asset.kind === "character" ? "人物档案" : asset.kind === "scene" ? "场景设定" : "道具设定"}</span><p>{asset.description || "尚未填写设定"}</p><small>{asset.refs.length} 张人物/场景参考图</small></div>)}</div>
                {!sequence.assets.length ? <div className="drama-home-empty">暂无人物或场景设定</div> : null}
                <StudioButton onClick={() => openFull(2)}>管理人物与场景设定</StudioButton>
            </div>
        );
        if (step === 3) return (
            <div className="drama-home-editor__section"><div className="drama-home-asset-grid">{sequence.assets.map((asset) => <AssetThumb key={asset.id} asset={asset} />)}</div>{!sequence.assets.length ? <div className="drama-home-empty">人物图片、场景图片与道具素材将在这里显示</div> : null}<StudioButton variant="primary" icon={<ImagePlus />} onClick={() => openFull(3)}>进入资产生成</StudioButton></div>
        );
        if (step === 4) return (
            <div className="drama-home-editor__section"><div className="drama-home-stat-grid"><div><strong>{episodeCountOf(settings)}</strong><span>规划集数</span></div><div><strong>{sequence.shots.length}</strong><span>已拆镜头</span></div><div><strong>{totalSeconds(sequence)}s</strong><span>镜头总时长</span></div></div><div className="drama-home-scene-list">{[...new Set(sequence.shots.map((shot) => shot.scene).filter(Boolean))].map((scene) => <span key={scene}>{scene}</span>)}</div><StudioButton variant="primary" onClick={() => openFull(4)}>进入分集拆镜与镜头规划</StudioButton></div>
        );
        if (step === 5) return (
            <div className="drama-home-editor__section drama-home-shot-editor"><div className="drama-home-shot-list">{sequence.shots.map((shot) => <button type="button" key={shot.id} className={selectedShot?.id === shot.id ? "is-active" : ""} onClick={() => setSelectedShotId(shot.id)}><b>{shot.no}</b><span>{shot.scene || "未命名场景"}</span><small>{shot.size} · {shot.move}</small></button>)}</div>{selectedShot ? <div className="drama-home-shot-detail"><span>{selectedShot.size} · {selectedShot.move} · {selectedShot.seconds}s</span><p>{selectedShot.line || selectedShot.prompt || "尚未填写画面描述"}</p><StudioButton onClick={() => openFull(5)}>编辑镜头参数</StudioButton></div> : <div className="drama-home-empty">暂无镜头，请先完成分集拆镜</div>}</div>
        );
        if (step === 6) return (
            <div className="drama-home-editor__section">{selectedShot ? <><ShotThumb shot={selectedShot} index={sequence.shots.indexOf(selectedShot)} /><div className="drama-home-status-lines"><span>镜头图片：{selectedShot.imageRef ? "已生成" : "待生成"}</span><span>配音参数与状态：{selectedShot.audioRef ? "已生成音频" : "待配音"}</span><span>画面描述：{selectedShot.prompt || selectedShot.line || "未填写"}</span></div></> : <div className="drama-home-empty">暂无镜头</div>}<StudioButton variant="primary" onClick={() => openFull(6)}>逐镜出图与配音</StudioButton></div>
        );
        if (step === 7) return (
            <div className="drama-home-editor__section"><div className="drama-home-status-lines"><span>带台词镜头：{sequence.shots.filter((shot) => shot.line.trim()).length} 个</span><span>已配音：{sequence.shots.filter((shot) => shot.audioRef).length} 条</span><span>人物音色：{Object.keys(sequence.voices ?? {}).length} 个已绑定</span></div><StudioButton variant="primary" onClick={() => openFull(7)}>进入声音制作</StudioButton></div>
        );
        if (step === 8) return (
            <div className="drama-home-editor__section"><label className="drama-home-inline-field"><span>视频模型</span><select value={config.videoModel} onChange={(event) => updateConfig("videoModel", event.target.value)}><option value="">自动</option>{videoModels.map((value) => <option key={value} value={value}>{modelOptionName(value)}</option>)}</select></label><div className="drama-home-status-lines"><span>任务提交：{videoLog?.title || "暂无视频任务"}</span><span>进度：{videoLog?.text || "提交后显示真实事件进度"}</span><span>已出视频：{sequence.shots.filter((shot) => shot.videoRef).length} / {sequence.shots.length} 镜</span></div><StudioButton variant="primary" onClick={() => openFull(8)}>接模型生成视频</StudioButton></div>
        );
        return (
            <div className="drama-home-editor__section"><div className="drama-home-review">{sequence.shots.slice(0, 3).map((shot, index) => <ShotThumb key={shot.id} shot={shot} index={index} />)}</div><div className="drama-home-status-lines"><span>成片：{sequence.shots.filter((shot) => shot.videoRef).length} / {sequence.shots.length} 镜有视频</span><span>总时长：{totalSeconds(sequence)} 秒 · 上次导出：{sequence.exportedAt ? new Date(sequence.exportedAt).toLocaleString("zh-CN") : "未导出"}</span></div><StudioButton variant="primary" icon={<Download />} onClick={() => openFull(9)}>分镜合成与成片导出</StudioButton></div>
        );
    };

    return (
        <div className="drama-home">
            <header className="drama-home__header">
                <div className="drama-home__brand"><span>{APP_BRAND.nameEn}</span><strong>短剧工坊</strong></div>
                <select className="drama-home__project" value={sequence?.id || ""} onChange={(event) => setActiveId(event.target.value)} disabled={!sequences.length} aria-label="切换短剧项目"><option value="" disabled>选择项目</option>{sequences.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
                <div className="drama-home__actions">
                    <button type="button" onClick={() => openFull(7)} disabled={!sequence} title="播放与连播审片"><Play /><span>播放</span></button>
                    <button type="button" onClick={save} disabled={!sequence} title="保存当前项目">{saved ? <Check /> : <Save />}<span>{saved ? "已保存" : "保存"}</span></button>
                    <button type="button" onClick={() => openFull(7)} disabled={!sequence} title="进入导出设置"><Download /><span>导出</span></button>
                </div>
            </header>

            {!sequence ? (
                <div className="drama-home__welcome"><Clapperboard /><h2>开启你的第一部短剧</h2><p>{hydrated ? "创建真实项目后，这里会显示剧本、分镜与任务状态。" : "正在读取本地项目……"}</p><StudioButton variant="primary" icon={<Plus />} disabled={!hydrated} onClick={createProject}>新建短剧</StudioButton></div>
            ) : (
                <div className="drama-home__workbench">
                    <aside className="drama-home__steps"><div className="drama-home__panel-title">创作流程</div>{STEP_LABELS.map((label, index) => <button type="button" key={label} className={`${step === index ? "is-current" : ""} ${stepDone(index) ? "is-done" : ""}`} onClick={() => setStep(index)}><i>{stepDone(index) ? <Check /> : index + 1}</i><span>{label}</span></button>)}<button type="button" className="drama-home__new" onClick={createProject}><Plus />新建项目</button></aside>
                    <section className="drama-home__editor"><header><div><span>STEP {String(step + 1).padStart(2, "0")}</span><h2>{STEP_LABELS[step]}</h2></div><button type="button" onClick={() => openFull()}>完整编辑<ArrowUpRight /></button></header><div className="drama-home__editor-body">{renderEditor()}</div><div className="drama-home__shot-rail">{sequence.shots.map((shot, index) => <ShotThumb key={shot.id} shot={shot} index={index} selected={selectedShot?.id === shot.id} onClick={() => { setSelectedShotId(shot.id); setStep(5); }} />)}{!sequence.shots.length ? <div className="drama-home-empty">暂无分镜 · 从剧本拆镜后显示真实素材</div> : null}</div></section>
                    <aside className="drama-home__tasks"><div className="drama-home__panel-title">任务状态</div><dl><div><dt>当前模型</dt><dd>{modelLabel(step === 8 ? config.videoModel : settings.textModel)}</dd></div><div><dt>当前任务</dt><dd>{recentLogs[0]?.title || "暂无运行任务"}</dd></div><div><dt>文本生成</dt><dd>{sequence.script?.text ? `已保存 ${sequence.script.text.length} 字` : "待输入"}</dd></div><div><dt>图片生成</dt><dd>{imageDone} / {sequence.shots.length} 张</dd></div><div className="drama-home__progress"><i style={{ width: `${sequence.shots.length ? imageDone / sequence.shots.length * 100 : 0}%` }} /></div><div><dt>视频生成</dt><dd>{videoLog?.title || "暂无视频任务"}</dd></div></dl><div className="drama-home__logs"><strong>任务日志</strong>{uploadError ? <div className="is-error"><span>短剧上传失败</span><p>{uploadError}</p></div> : null}{recentLogs.length ? recentLogs.map((item) => <div key={item.id} className={/失败|错误|error/i.test(`${item.title}${item.text}`) ? "is-error" : ""}><span>{item.title}</span><small>{item.time}</small><p>{item.text}</p></div>) : <p>暂无事件，真实任务日志将在这里显示。</p>}</div></aside>
                </div>
            )}
            <input ref={fileRef} type="file" accept={SCRIPT_ACCEPT.join(",")} className="hidden" onChange={(event) => void uploadScript(event.target.files?.[0])} />
        </div>
    );
}
