import { useEffect, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Select } from "antd";
import { ArrowLeft, Download, GripVertical, LoaderCircle, Pause, Play, SkipBack, SkipForward, Trash2 } from "lucide-react";

import { StepShell } from "../components/step-shell";
import { useMediaUrls } from "../use-media-urls";
import { frameGradient, shotNumber } from "@/lib/drama/schema";
import { cn } from "@/lib/utils";
import { useDramaStore } from "@/stores/use-drama-store";
import type { DramaShot } from "@/types/drama";
import type { StepProps } from "./step-props";

const RATIOS: Record<string, [number, number]> = { "9:16": [9, 16], "16:9": [16, 9], "1:1": [1, 1] };
const QUALITIES: Record<string, number> = { "720P": 720, "1080P": 1080 };
const FPS_OPTIONS = ["24", "25", "30"];

/**
 * 10 分镜合成与成片导出：按镜头顺序播放 → 录制合成 → 下载成片。
 * 合成用的是 canvas + MediaRecorder 的重编码流水线，不是把几段视频当成一个文件。
 */
export function ComposeStep({ sequence, patch, go, selectShot, selectedShotId }: StepProps) {
    const { message } = App.useApp();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [ratio, setRatio] = useState(sequence.settings?.videoRatio && sequence.settings.videoRatio !== "自动" ? sequence.settings.videoRatio : "9:16");
    const [quality, setQuality] = useState("1080P");
    const [fps, setFps] = useState("30");
    const [fileName, setFileName] = useState(sequence.title || "短剧成片");
    const [dragId, setDragId] = useState<string | null>(null);

    const shots = sequence.shots;
    const keys = shots.flatMap((shot) => [shot.videoRef ?? "", shot.audioRef ?? "", shot.imageRef ?? ""]);
    const urls = useMediaUrls(keys);

    const selected = shots.find((shot) => shot.id === selectedShotId) ?? shots[0] ?? null;
    const missingVideo = shots.filter((shot) => !shot.videoRef).length;
    const missingAudio = shots.filter((shot) => shot.line.trim() && !shot.audioRef).length;
    const approved = shots.filter((shot) => shot.approved).length;
    const total = shots.reduce((sum, shot) => sum + shot.seconds, 0);

    // 播放当前剧集：逐个播放视频轨，按偏移叠声音轨。
    useEffect(() => {
        if (!playing || !selected) return;
        let cancelled = false;
        const element = videoRef.current;
        if (!element) return;
        let audio: HTMLAudioElement | null = null;
        let timer: ReturnType<typeof setTimeout>;
        const index = shots.findIndex((shot) => shot.id === selected.id);

        const advance = () => {
            if (cancelled) return;
            const next = shots[index + 1];
            if (next) selectShot(next.id);
            else setPlaying(false);
        };

        element.currentTime = 0;
        void element.play().catch(() => undefined);
        if (selected.audioRef && urls[selected.audioRef]) {
            audio = new Audio(urls[selected.audioRef]);
            const offset = Math.max(0, selected.audioOffsetMs ?? 0);
            timer = setTimeout(() => void audio?.play().catch(() => undefined), offset);
        }
        element.onended = advance;
        const fallback = setTimeout(advance, Math.max(1500, selected.seconds * 1000 + 400));

        return () => {
            cancelled = true;
            element.onended = null;
            clearTimeout(timer);
            clearTimeout(fallback);
            audio?.pause();
            element.pause();
        };
    }, [playing, selected?.id, shots, urls, selectShot, selected?.audioRef, selected?.audioOffsetMs, selected?.seconds]);

    const move = (id: string, targetId: string) => {
        if (id === targetId) return;
        const next = [...shots];
        const from = next.findIndex((shot) => shot.id === id);
        const to = next.findIndex((shot) => shot.id === targetId);
        if (from < 0 || to < 0) return;
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        patch({ shots: next.map((shot, index) => ({ ...shot, no: shotNumber(index) })) });
    };

    const patchShot = (id: string, part: Partial<DramaShot>) => patch({ shots: shots.map((shot) => (shot.id === id ? { ...shot, ...part } : shot)) });

    const recordingSupported = typeof MediaRecorder !== "undefined" && typeof document.createElement("canvas").captureStream === "function";

    const exportEpisode = async () => {
        if (!recordingSupported) {
            message.error("当前浏览器不支持 canvas 录制，请换 Chrome / Edge 最新版");
            return;
        }
        const ready = shots.filter((shot) => shot.videoRef);
        if (!ready.length) {
            message.warning("还没有任何镜头视频，先在「视频生成」出片");
            return;
        }
        setExporting(true);
        setProgress(0);
        try {
            const [rw, rh] = RATIOS[ratio] ?? RATIOS["9:16"];
            const height = QUALITIES[quality] ?? 1080;
            const width = Math.round((height * rw) / rh / 2) * 2;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("无法创建画布上下文");

            const stream = canvas.captureStream(Number(fps) || 30);
            const audioContext = new AudioContext();
            const destination = audioContext.createMediaStreamDestination();
            for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);

            const mimeType = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
            const chunks: BlobPart[] = [];
            recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
            const stopped = new Promise<void>((resolve) => {
                recorder.onstop = () => resolve();
            });
            recorder.start(500);

            const drawFrame = (source: HTMLVideoElement, sourceWidth: number, sourceHeight: number) => {
                const scale = Math.max(width / sourceWidth, height / sourceHeight);
                const drawWidth = sourceWidth * scale;
                const drawHeight = sourceHeight * scale;
                ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
            };

            for (let index = 0; index < shots.length; index += 1) {
                const shot = shots[index];
                const videoUrl = urls[shot.videoRef ?? ""];
                if (!videoUrl) continue;
                const video = document.createElement("video");
                video.src = videoUrl;
                video.muted = true;
                video.crossOrigin = "anonymous";
                await new Promise<void>((resolve) => {
                    video.onloadeddata = () => resolve();
                    video.onerror = () => resolve();
                });
                audioContext.createMediaElementSource(video).connect(destination);

                let audio: HTMLAudioElement | null = null;
                if (shot.audioRef && urls[shot.audioRef]) {
                    audio = new Audio(urls[shot.audioRef]);
                    audio.crossOrigin = "anonymous";
                    const node = audioContext.createMediaElementSource(audio);
                    node.connect(destination);
                    const offset = Math.max(0, shot.audioOffsetMs ?? 0);
                    setTimeout(() => void audio?.play().catch(() => undefined), offset);
                }
                await video.play().catch(() => undefined);

                await new Promise<void>((resolve) => {
                    const started = performance.now();
                    const limit = shot.seconds * 1000;
                    const tick = () => {
                        drawFrame(video, video.videoWidth || width, video.videoHeight || height);
                        if (performance.now() - started >= limit || video.ended) {
                            video.pause();
                            audio?.pause();
                            resolve();
                            return;
                        }
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                });

                setProgress(Math.round(((index + 1) / shots.length) * 100));
            }

            recorder.stop();
            await stopped;
            stream.getTracks().forEach((track) => track.stop());
            await audioContext.close();

            const blob = new Blob(chunks, { type: mimeType || "video/webm" });
            const extension = (mimeType || "video/webm").includes("mp4") ? "mp4" : "webm";
            const anchor = document.createElement("a");
            anchor.href = URL.createObjectURL(blob);
            anchor.download = `${fileName || "短剧成片"}.${extension}`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(anchor.href), 4000);
            patch({ exportedAt: new Date().toISOString() });
            message.success(`已导出 ${(blob.size / 1024 / 1024).toFixed(1)}MB ${extension.toUpperCase()} 成片`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败");
        } finally {
            setExporting(false);
        }
    };

    return (
        <StepShell
            title="分镜合成与成片导出"
            subtitle={`${shots.length} 镜 · ${total}s · 已出视频 ${shots.length - missingVideo} 镜 · 已审 ${approved} 镜`}
            actions={
                <>
                    <Button icon={<Play className="size-4" />} disabled={!selected?.videoRef || exporting} onClick={() => setPlaying((value) => !value)}>
                        {playing ? "停止连播" : "播放本集"}
                    </Button>
                    <Button type="primary" icon={exporting ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />} disabled={exporting || !shots.length} onClick={() => void exportEpisode()}>
                        {exporting ? `合成中 ${progress}%` : "导出成片"}
                    </Button>
                </>
            }
            footer={
                <>
                    <Button onClick={() => go(8)}>上一步</Button>
                    <span className="drama-sub">导出会把选中的正式版视频按顺序重编码成一条文件；WebM/MP4 取决于浏览器。</span>
                </>
            }
        >
            <div className="grid gap-4 xl:grid-cols-[264px_minmax(0,1fr)_236px]">
                {/* 镜头列表 */}
                <div className="drama-card flex max-h-[70vh] flex-col overflow-hidden">
                    <div className="drama-h3 mb-2">镜头顺序</div>
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                        {shots.map((shot, index) => (
                            <div
                                key={shot.id}
                                draggable
                                onDragStart={() => setDragId(shot.id)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => {
                                    if (dragId) move(dragId, shot.id);
                                    setDragId(null);
                                }}
                                onClick={() => selectShot(shot.id)}
                                className={cn("drama-compose-row", selectedShotId === shot.id && "is-active")}
                            >
                                <GripVertical className="size-4 shrink-0 cursor-grab text-stone-400" />
                                <div className="relative h-12 w-8 shrink-0 overflow-hidden rounded" style={{ background: frameGradient(shot.scene || shot.no) }}>
                                    {urls[shot.imageRef ?? ""] ? <img src={urls[shot.imageRef ?? ""]} alt="" className="size-full object-cover" /> : null}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px]">镜 {shot.no} · {shot.scene || "未填场景"}</div>
                                    <div className="flex items-center gap-2 text-[12px] text-stone-400">
                                        <span>{shot.seconds}s</span>
                                        <span className={shot.videoRef ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>{shot.videoRef ? "视频" : "缺视频"}</span>
                                        <span className={shot.audioRef ? "text-emerald-600 dark:text-emerald-400" : shot.line.trim() ? "text-amber-600 dark:text-amber-400" : "text-stone-400"}>{shot.audioRef ? "声音" : shot.line.trim() ? "缺声音" : "无台词"}</span>
                                    </div>
                                </div>
                                <span className="text-[12px] text-stone-400">{index + 1}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 预览 */}
                <div className="flex min-w-0 flex-col">
                    <div className="drama-preview">
                        {selected?.videoRef && urls[selected.videoRef] ? (
                            <video ref={videoRef} src={urls[selected.videoRef]} controls className="size-full object-contain" onEnded={() => setPlaying(false)} />
                        ) : selected?.imageRef && urls[selected.imageRef] ? (
                            <img src={urls[selected.imageRef]} alt="" className="size-full object-contain opacity-70" />
                        ) : (
                            <div className="grid size-full place-items-center text-[13px] text-white/60">这一镜还没有视频</div>
                        )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                        <Button size="small" icon={<SkipBack className="size-4" />} onClick={() => {
                            const index = shots.findIndex((shot) => shot.id === selected?.id);
                            if (index > 0) selectShot(shots[index - 1].id);
                        }}>
                            上一镜
                        </Button>
                        <Button size="small" icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={() => setPlaying((value) => !value)}>
                            {playing ? "暂停" : "播放"}
                        </Button>
                        <Button size="small" icon={<SkipForward className="size-4" />} onClick={() => {
                            const index = shots.findIndex((shot) => shot.id === selected?.id);
                            if (index >= 0 && index < shots.length - 1) selectShot(shots[index + 1].id);
                        }}>
                            下一镜
                        </Button>
                        <span className="ml-auto text-[13px] text-stone-500 dark:text-stone-400">
                            {selected ? `镜 ${selected.no} · ${selected.seconds}s` : ""}
                        </span>
                    </div>

                    <div className="drama-card mt-3">
                        <div className="drama-h3 mb-2">声音匹配</div>
                        {selected ? (
                            <div className="flex flex-wrap items-center gap-3 text-[13px]">
                                <span className="text-stone-500 dark:text-stone-400">台词</span>
                                <span className="min-w-0 flex-1 truncate">{selected.line || "无台词"}</span>
                                <span className="text-stone-500 dark:text-stone-400">音轨</span>
                                <span className={selected.audioRef ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{selected.audioRef ? "已挂载" : "未挂载"}</span>
                                <span className="text-stone-500 dark:text-stone-400">起始偏移</span>
                                <InputNumber size="small" className="w-20" min={0} max={selected.seconds * 1000} step={100} value={selected.audioOffsetMs ?? 0} onChange={(value) => typeof value === "number" && patchShot(selected.id, { audioOffsetMs: value })} />
                                <span className="text-stone-400">ms</span>
                                <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} onClick={() => patchShot(selected.id, { audioRef: undefined })}>
                                    清除音轨
                                </Button>
                                <Button size="small" onClick={() => patchShot(selected.id, { approved: !selected.approved })}>
                                    {selected.approved ? "取消已审" : "标记已审"}
                                </Button>
                            </div>
                        ) : (
                            <p className="drama-sub">选中镜头后调整音轨。</p>
                        )}
                    </div>
                </div>

                {/* 导出设置 */}
                <div className="space-y-3">
                    <div className="drama-card">
                        <div className="drama-h3 mb-2">导出设置</div>
                        <div className="space-y-2">
                            <label className="drama-field">
                                <span>文件名</span>
                                <Input value={fileName} onChange={(event) => setFileName(event.target.value)} />
                            </label>
                            <label className="drama-field">
                                <span>比例</span>
                                <Select value={ratio} onChange={setRatio} options={Object.keys(RATIOS).map((value) => ({ value, label: value }))} />
                            </label>
                            <label className="drama-field">
                                <span>分辨率</span>
                                <Select value={quality} onChange={setQuality} options={Object.keys(QUALITIES).map((value) => ({ value, label: value }))} />
                            </label>
                            <label className="drama-field">
                                <span>帧率</span>
                                <Select value={fps} onChange={setFps} options={FPS_OPTIONS.map((value) => ({ value, label: `${value} fps` }))} />
                            </label>
                        </div>
                        {exporting ? (
                            <div className="mt-3">
                                <div className="drama-progress">
                                    <span style={{ width: `${progress}%` }} />
                                </div>
                                <p className="drama-sub mt-1">正在按顺序重编码，{progress}%</p>
                            </div>
                        ) : null}
                    </div>

                    <div className="drama-card text-[13px] leading-6">
                        <div className="drama-h3 mb-1.5">成片检查</div>
                        <div className={missingVideo ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}>{missingVideo ? `${missingVideo} 镜缺视频` : "视频齐全"}</div>
                        <div className={missingAudio ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>{missingAudio ? `${missingAudio} 镜缺声音` : "声音齐全"}</div>
                        <div className="text-stone-500 dark:text-stone-400">总时长 {total}s · 按顺序 {shots.length} 段</div>
                        {!recordingSupported ? <div className="mt-1 text-red-500">当前浏览器不支持录制导出</div> : null}
                    </div>

                    <Button block type="text" icon={<ArrowLeft className="size-4" />} onClick={() => go(6)}>
                        回「逐镜出图」补镜头
                    </Button>
                </div>
            </div>
        </StepShell>
    );
}
