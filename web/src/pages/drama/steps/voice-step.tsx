import { useMemo, useRef, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { ArrowRight, LoaderCircle, Mic, Play, Upload as UploadIcon } from "lucide-react";

import { StepShell } from "../components/step-shell";
import { useMediaUrls } from "../use-media-urls";
import { audioVoiceOptions } from "@/lib/audio-generation";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { ASSET_KIND_LABEL } from "@/lib/drama/schema";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { uploadMediaFile } from "@/services/file-storage";
import { allChannels, decodeChannelModel, modelOptionName, selectableModelsByCapability } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { useDramaTasks } from "@/stores/use-drama-tasks";
import type { DramaAsset, DramaMediaVersion, DramaShot } from "@/types/drama";
import type { StepProps } from "./step-props";

/**
 * 08 声音制作：人物绑定音色 → 逐镜出对白。
 * 音色是 audio-speech 的预设 voice（config.audioVoice），上传样本只作为参考音频，不做克隆。
 */
export function VoiceStep({ sequence, settings, config, patch, patchSetting, go, selectShot }: StepProps) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState<string | null>(null);
    const startTask = useDramaTasks((state) => state.start);
    const finishTask = useDramaTasks((state) => state.finish);
    const failTask = useDramaTasks((state) => state.fail);
    const fileRef = useRef<HTMLInputElement>(null);
    const [sampleTarget, setSampleTarget] = useState<string | null>(null);

    const characters = sequence.assets.filter((asset) => asset.kind === "character");
    const voiceOptions = [{ value: "", label: "音色：自动" }, ...audioVoiceOptions.map((item) => ({ value: item.value, label: item.label }))];

    const keys = useMemo(
        () => [...sequence.shots.flatMap((shot) => [shot.audioRef ?? "", ...(shot.audioVersions ?? []).map((version) => version.storageKey)]), ...characters.map((asset) => asset.audioRef ?? "")],
        [sequence.shots, characters],
    );
    const urls = useMediaUrls(keys);

    const modelOptions = useMemo(() => {
        const values = selectableModelsByCapability(config, "audio");
        return allChannels(config)
            .map((channel) => ({
                label: channel.name,
                options: values.filter((value) => decodeChannelModel(value)?.channelId === channel.id).map((value) => ({ value, label: modelOptionName(value) })),
            }))
            .filter((group) => group.options.length > 0);
    }, [config]);

    const latestSequences = () => useDramaStore.getState().sequences.find((item) => item.id === sequence.id) ?? sequence;
    const patchShot = (shotId: string, part: Partial<DramaShot>) => patch({ shots: latestSequences().shots.map((shot) => (shot.id === shotId ? { ...shot, ...part } : shot)) });

    const voiceOfShot = (shot: DramaShot) => {
        // 优先用这句台词的说话人；旁白/未指定时退回该镜第一个已绑定人物。
        // 人物唯一标识用资产 id，不按名字——改名后音色绑定不会丢。
        const charactersOfShot = sequence.assets.filter((asset) => shot.assetIds.includes(asset.id) && asset.kind === "character");
        const speaker = shot.speaker && shot.speaker !== "旁白" ? charactersOfShot.find((asset) => asset.name === shot.speaker) : undefined;
        const ordered = speaker ? [speaker, ...charactersOfShot.filter((asset) => asset.id !== speaker.id)] : charactersOfShot;
        for (const character of ordered) {
            const bound = sequence.voices?.[character.id];
            if (bound) return bound;
        }
        return "";
    };

    const generate = async (shot: DramaShot, quiet = false) => {
        // 无台词镜头不强行生成对白音频。
        if (!shot.line.trim()) return false;
        setBusy(shot.id);
        const startedAt = new Date().toISOString();
        patchShot(shot.id, { generation: { ...shot.generation, audio: { status: "running", updatedAt: startedAt } } });
        let taskId = "";
        let signal: AbortSignal | undefined;
        try {
            const base = buildGenerationConfig(config, undefined, "audio");
            const voice = voiceOfShot(shot);
            const audioConfig = { ...base, model: settings.audioModel || base.model, ...(voice ? { audioVoice: voice } : {}) };
            const task = startTask({ sequenceId: sequence.id, shotId: shot.id, kind: "audio", label: `镜 ${shot.no} · 配音`, model: audioConfig.model, prompt: shot.line.trim() });
            taskId = task.id;
            signal = task.signal;
            const blob = await requestAudioGeneration(audioConfig, shot.line.trim(), { signal: task.signal });
            const file = await storeGeneratedAudio(blob);
            const version: DramaMediaVersion = {
                storageKey: file.storageKey,
                model: audioConfig.model,
                prompt: shot.line.trim(),
                parameters: { voice: voice || "默认", speaker: shot.speaker || "未指定" },
                createdAt: new Date().toISOString(),
            };
            const latest = latestSequences().shots.find((item) => item.id === shot.id) ?? shot;
            finishTask(taskId, file.storageKey);
            patchShot(shot.id, {
                audioRef: file.storageKey,
                audioVersions: [version, ...(latest.audioVersions ?? [])].slice(0, 8),
                generation: { ...latest.generation, audio: { status: "done", stale: false, updatedAt: new Date().toISOString() } },
            });
            if (!quiet) message.success(`镜 ${shot.no} 配音完成`);
            return true;
        } catch (error) {
            const reason = error instanceof Error ? error.message : "配音失败";
            if (taskId && !signal?.aborted) failTask(taskId, reason);
            const latest = latestSequences().shots.find((item) => item.id === shot.id) ?? shot;
            // 失败保留已有 audioRef 与历史版本。
            patchShot(shot.id, { generation: { ...latest.generation, audio: { status: "failed", error: reason, updatedAt: new Date().toISOString() } } });
            if (!quiet) message.error(reason);
            return false;
        } finally {
            setBusy(null);
        }
    };

    const runAll = async () => {
        // 剧本改过、台词不再对得上的配音一起重配，否则「全部配音」会跳过它们。
        const pending = latestSequences().shots.filter((shot) => shot.line.trim() && (!shot.audioRef || shot.generation?.audio?.stale));
        if (!pending.length) {
            message.info("没有需要配音的镜头");
            return;
        }
        setBusy("all");
        let failed = 0;
        for (const shot of pending) {
            if (!(await generate(shot, true))) failed += 1;
        }
        setBusy(null);
        message[failed ? "warning" : "success"](failed ? `批量配音完成，${failed} 镜失败` : `批量配音完成 · ${pending.length} 镜`);
    };

    const patchAsset = (id: string, part: Partial<DramaAsset>) => patch({ assets: sequence.assets.map((asset) => (asset.id === id ? { ...asset, ...part } : asset)) });

    const onSample = async (file: File) => {
        if (!sampleTarget) return;
        try {
            const uploaded = await uploadMediaFile(file, "audio");
            patchAsset(sampleTarget, { audioRef: uploaded.storageKey });
            message.success("音色样本已存进素材库，可作为参考音频随视频提交");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setSampleTarget(null);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const voices = sequence.shots.filter((shot) => shot.line.trim());
    const done = voices.filter((shot) => shot.audioRef).length;
    const stale = voices.filter((shot) => shot.audioRef && shot.generation?.audio?.stale).length;

    return (
        <StepShell
            title="声音制作"
            subtitle={`${done}/${voices.length} 条对白已配音${stale ? ` · ${stale} 条台词已改待重配` : ""}。人物绑定音色后，全片默认沿用，不用每次重选。`}
            actions={
                <>
                    <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(event) => event.target.files?.[0] && void onSample(event.target.files[0])} />
                    <Select className="min-w-44" value={settings.audioModel || ""} onChange={(value) => patchSetting("audioModel", value)} options={[{ label: "音频模型：自动", value: "" }, ...modelOptions]} popupMatchSelectWidth={false} />
                    <Button type="primary" loading={busy === "all"} disabled={busy !== null} onClick={() => void runAll()}>
                        全部配音
                    </Button>
                </>
            }
            footer={
                <>
                    <Button onClick={() => go(6)}>上一步</Button>
                    <span className="drama-sub">TTS 只接受预设音色；上传的样本作为参考音频，不会克隆音色。</span>
                    <Button className="ml-auto" type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(8)}>
                        下一步 · 视频生成
                    </Button>
                </>
            }
        >
            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
                <div className="drama-card h-fit">
                    <div className="drama-h3 mb-2">人物音色</div>
                    {characters.length === 0 ? <p className="drama-sub">还没有人物资产，先在「资产生成」建。</p> : null}
                    <div className="space-y-2">
                        {characters.map((asset) => (
                            <div key={asset.id} className="rounded-lg border border-[var(--studio-border-soft)] p-2">
                                <div className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate text-sm">{asset.name}</span>
                                    <span className="text-[12px] text-stone-400">{ASSET_KIND_LABEL[asset.kind]}</span>
                                </div>
                                <Select
                                    className="mt-1.5 w-full"
                                    value={sequence.voices?.[asset.id] ?? ""}
                                    onChange={(value) => patch({ voices: { ...(sequence.voices ?? {}), [asset.id]: value } })}
                                    options={voiceOptions}
                                />
                                <div className="mt-1.5 flex items-center gap-2">
                                    <Button
                                        size="small"
                                        icon={<UploadIcon className="size-3.5" />}
                                        onClick={() => {
                                            setSampleTarget(asset.id);
                                            fileRef.current?.click();
                                        }}
                                    >
                                        上传样本
                                    </Button>
                                    {asset.audioRef && urls[asset.audioRef] ? <audio controls src={urls[asset.audioRef]} className="h-8 min-w-0 flex-1" /> : <span className="text-[12px] text-stone-400">无样本</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="drama-sub mt-2">样本用于视频生成的参考音频；克隆音色需要上游支持，当前链路没有。</p>
                </div>

                <div className="space-y-2">
                    {voices.length === 0 ? (
                        <div className="drama-empty-block">还没有带台词的镜头。回「分镜设计」补台词后再来配音。</div>
                    ) : (
                        voices.map((shot) => (
                            <div key={shot.id} className="drama-voice-row" onClick={() => selectShot(shot.id)}>
                                <div className="w-10 shrink-0 text-[13px] tabular-nums text-stone-400">{shot.no}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm">{shot.line}</div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[12px] text-stone-400">
                                        <span>{shot.scene || "未填场景"}</span>
                                        <span>·</span>
                                        <span>{voiceOfShot(shot) ? audioVoiceOptions.find((item) => item.value === voiceOfShot(shot))?.label : "音色自动"}</span>
                                        {shot.audioRef && shot.generation?.audio?.stale ? <span className="drama-chip is-warn">内容已改</span> : null}
                                    </div>
                                </div>
                                {urls[shot.audioRef ?? ""] ? <audio controls src={urls[shot.audioRef ?? ""]} className="h-8 w-40 shrink-0" onClick={(event) => event.stopPropagation()} /> : null}
                                <Button
                                    size="small"
                                    icon={busy === shot.id ? <LoaderCircle className="size-3.5 animate-spin" /> : shot.audioRef ? <Play className="size-3.5" /> : <Mic className="size-3.5" />}
                                    disabled={busy !== null}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void generate(shot);
                                    }}
                                >
                                    {shot.audioRef ? "重配" : "配音"}
                                </Button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </StepShell>
    );
}
