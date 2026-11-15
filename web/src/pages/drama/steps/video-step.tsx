import { useMemo, useRef, useState } from "react";
import { App, Button, Select } from "antd";
import { ArrowRight, CircleAlert, LoaderCircle, Video } from "lucide-react";

import { StepShell } from "../components/step-shell";
import { useMediaUrls } from "../use-media-urls";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { shotPrompt } from "@/lib/drama/prompt";
import { SETTING_OPTIONS, VIDEO_QUALITY_OPTIONS, videoSecondsOf } from "@/lib/drama/settings";
import { frameGradient } from "@/lib/drama/schema";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { resolveMediaUrl } from "@/services/file-storage";
import { allChannels, decodeChannelModel, modelOptionName, selectableModelsByCapability } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { cn } from "@/lib/utils";
import type { DramaMediaVersion, DramaShot } from "@/types/drama";
import type { ReferenceImage } from "@/types/image";
import type { StepProps } from "./step-props";

/**
 * 09 视频生成：逐镜图生视频，产物落素材库后写回 shot.videoRef。
 * 走的是画布同一条 video.ts 链路（网关目前没有 video 端点），参数按模型能力给。
 */
export function VideoStep({ sequence, settings, config, patch, patchSetting, go, selectShot, selectedShotId }: StepProps) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState<string | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState<{ shotId: string; text: string } | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const keys = useMemo(() => sequence.shots.flatMap((shot) => [shot.videoRef ?? "", ...(shot.videoVersions ?? []).map((version) => version.storageKey)]), [sequence.shots]);
    const urls = useMediaUrls(keys);

    const modelOptions = useMemo(() => {
        const values = selectableModelsByCapability(config, "video");
        return allChannels(config)
            .map((channel) => ({
                label: channel.name,
                options: values.filter((value) => decodeChannelModel(value)?.channelId === channel.id).map((value) => ({ value, label: modelOptionName(value) })),
            }))
            .filter((group) => group.options.length > 0);
    }, [config]);

    const latestShots = () => useDramaStore.getState().sequences.find((item) => item.id === sequence.id)?.shots ?? sequence.shots;
    const patchShot = (shotId: string, part: Partial<DramaShot>) => patch({ shots: latestShots().map((shot) => (shot.id === shotId ? { ...shot, ...part } : shot)) });

    const generate = async (shot: DramaShot, quiet = false) => {
        if (!quiet) setBusy(shot.id);
        setElapsed(0);
        setError(null);
        const controller = new AbortController();
        abortRef.current = controller;
        const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
        patchShot(shot.id, { status: "running" });
        try {
            const base = buildGenerationConfig(config, undefined, "video");
            const seconds = videoSecondsOf(settings);
            const videoConfig = {
                ...base,
                model: settings.videoModel || base.model,
                videoModel: settings.videoModel || base.videoModel,
                ...(settings.videoRatio !== "自动" ? { size: settings.videoRatio } : {}),
                ...(seconds !== null ? { videoSeconds: String(seconds) } : {}),
                ...(settings.videoQuality !== "自动" ? { vquality: settings.videoQuality } : {}),
            };
            const references: ReferenceImage[] = shot.imageRef
                ? [{ id: `first-${shot.id}`, name: `shot-${shot.no}.png`, type: "image/png", dataUrl: await resolveMediaUrl(shot.imageRef, "") }]
                : [];
            const result = await requestVideoGeneration(videoConfig, shotPrompt(sequence, shot), references, { signal: controller.signal });
            const file = await storeGeneratedVideo(result);
            const version: DramaMediaVersion = { storageKey: file.storageKey, model: videoConfig.model, prompt: shotPrompt(sequence, shot), createdAt: new Date().toISOString() };
            const latest = latestShots().find((item) => item.id === shot.id) ?? shot;
            patchShot(shot.id, { status: "done", videoRef: file.storageKey, videoVersions: [version, ...(latest.videoVersions ?? [])].slice(0, 6) });
            if (!quiet) message.success(`镜 ${shot.no} 视频已生成`);
            return true;
        } catch (caught) {
            const text = caught instanceof Error ? caught.message : "视频生成失败";
            patchShot(shot.id, { status: "failed" });
            setError({ shotId: shot.id, text });
            if (!quiet) message.error(text);
            return false;
        } finally {
            clearInterval(timer);
            abortRef.current = null;
            if (!quiet) setBusy(null);
        }
    };

    const runAll = async () => {
        const pending = latestShots().filter((shot) => !shot.videoRef);
        if (!pending.length) {
            message.info("所有镜头都有视频了");
            return;
        }
        setBusy("all");
        let failed = 0;
        for (const shot of pending) {
            if (!(await generate(shot, true))) failed += 1;
        }
        setBusy(null);
        message[failed ? "warning" : "success"](failed ? `批量生成完成，${failed} 镜失败` : `批量生成完成 · ${pending.length} 镜`);
    };

    const done = sequence.shots.filter((shot) => shot.videoRef).length;
    const missingImage = sequence.shots.filter((shot) => !shot.imageRef).length;

    return (
        <StepShell
            title="视频生成"
            subtitle={`${done}/${sequence.shots.length} 镜已有视频。有画面的镜头走图生视频，没画面的走文生视频。`}
            actions={
                <>
                    <Select className="min-w-44" value={settings.videoModel || ""} onChange={(value) => patchSetting("videoModel", value)} options={[{ label: "视频模型：自动（跟随画布默认）", value: "" }, ...modelOptions]} popupMatchSelectWidth={false} />
                    <Select className="w-32" value={settings.videoRatio} onChange={(value) => patchSetting("videoRatio", value)} options={SETTING_OPTIONS.videoRatio.map((value) => ({ value, label: `比例 ${value}` }))} />
                    <Select className="w-32" value={settings.videoSeconds} onChange={(value) => patchSetting("videoSeconds", value)} options={SETTING_OPTIONS.videoSeconds.map((value) => ({ value, label: value === "自动" ? "时长 自动" : `时长 ${value}` }))} />
                    <Select className="w-32" value={settings.videoQuality} onChange={(value) => patchSetting("videoQuality", value)} options={VIDEO_QUALITY_OPTIONS.map((value) => ({ value, label: `分辨率 ${value}` }))} />
                    <Button type="primary" loading={busy === "all"} disabled={busy !== null} onClick={() => void runAll()}>
                        全部生成
                    </Button>
                </>
            }
            footer={
                <>
                    <Button onClick={() => go(7)}>上一步</Button>
                    {busy && busy !== "all" ? (
                        <Button danger onClick={() => abortRef.current?.abort()}>
                            取消当前任务（已等待 {elapsed}s）
                        </Button>
                    ) : null}
                    <span className="drama-sub">视频是异步任务，单镜最长约 5 分钟；批量串行，一次一镜。</span>
                    <Button className="ml-auto" type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(9)}>
                        下一步 · 合成导出
                    </Button>
                </>
            }
        >
            {missingImage ? (
                <div className="drama-notice mb-3">
                    <CircleAlert className="size-4 shrink-0" />
                    {missingImage} 个镜头还没有画面，建议先回「逐镜出图」，否则只能文生视频，人物一致性会差。
                </div>
            ) : null}

            {sequence.shots.length === 0 ? (
                <div className="drama-empty-block">还没有镜头。</div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                    {sequence.shots.map((shot) => {
                        const running = busy === shot.id || (busy === "all" && shot.status === "running");
                        const videoUrl = urls[shot.videoRef ?? ""];
                        return (
                            <article key={shot.id} className={cn("drama-shot-card", selectedShotId === shot.id && "is-active")} onClick={() => selectShot(shot.id)}>
                                <div className="relative aspect-[9/16] overflow-hidden rounded-md" style={{ background: frameGradient(shot.scene || shot.no) }}>
                                    {videoUrl ? <video src={videoUrl} className="size-full object-cover" muted playsInline controls /> : shot.imageRef && urls[shot.imageRef] ? <img src={urls[shot.imageRef]} alt="" className="size-full object-cover opacity-60" /> : <span className="absolute inset-0 grid place-items-center text-[13px] text-white/70">无首帧</span>}
                                    <span className="absolute left-2 top-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[12px] text-white">镜 {shot.no}</span>
                                    {running ? (
                                        <div className="absolute inset-0 grid place-items-center bg-black/45 text-[13px] text-white">
                                            <span className="flex items-center gap-2">
                                                <LoaderCircle className="size-5 animate-spin" />
                                                {elapsed}s
                                            </span>
                                        </div>
                                    ) : null}
                                </div>

                                {(shot.videoVersions?.length ?? 0) > 1 ? (
                                    <div className="mt-1 flex gap-1 overflow-x-auto pb-1">
                                        {shot.videoVersions?.map((version, index) => (
                                            <button
                                                key={version.storageKey}
                                                type="button"
                                                className={cn("drama-version-thumb", shot.videoRef === version.storageKey && "is-active")}
                                                title="设为正式版本"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    patchShot(shot.id, { videoRef: version.storageKey });
                                                }}
                                            >
                                                <span className="grid size-full place-items-center text-[11px] text-stone-500">v{shot.videoVersions!.length - index}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}

                                {error?.shotId === shot.id ? <div className="mt-1 line-clamp-2 text-[12px] text-red-500">{error.text}</div> : null}

                                <div className="mt-1 flex items-center gap-1">
                                    <span className="text-[12px] text-stone-400">
                                        {shot.videoVersions?.length ?? 0} 版
                                    </span>
                                    <Button
                                        size="small"
                                        className="ml-auto"
                                        icon={running ? <LoaderCircle className="size-3.5 animate-spin" /> : <Video className="size-3.5" />}
                                        disabled={busy !== null}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void generate(shot);
                                        }}
                                    >
                                        {shot.videoRef ? "重生成" : "生成视频"}
                                    </Button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </StepShell>
    );
}
