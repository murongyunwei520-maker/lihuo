import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Select } from "antd";
import { ArrowRight, CircleAlert, LoaderCircle, Upload, Video } from "lucide-react";

import { StepShell } from "../components/step-shell";
import { useMediaUrls } from "../use-media-urls";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { SETTING_OPTIONS, VIDEO_QUALITY_OPTIONS } from "@/lib/drama/settings";
import { frameGradient } from "@/lib/drama/schema";
import { resolveVideoCapability } from "@/lib/drama/video-caps";
import { applyVideoPlan, buildVideoPlan } from "@/lib/drama/video-request";
import { createVideoGenerationTask, storeGeneratedVideo, waitForVideoGenerationTask, type VideoGenerationTask } from "@/services/api/video";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { allChannels, decodeChannelModel, modelOptionName, selectableModelsByCapability } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { useDramaTasks } from "@/stores/use-drama-tasks";
import { cn } from "@/lib/utils";
import type { DramaMediaVersion, DramaRemoteTask, DramaShot } from "@/types/drama";
import type { VideoGenerationResult } from "@/services/api/video";
import type { ReferenceImage } from "@/types/image";
import type { StepProps } from "./step-props";

/**
 * 09 视频生成：逐镜图生视频。
 * 请求内容由 buildVideoPlan 统一折算（Prompt / 时长 / 比例 / 参考图 / 可提交性），
 * 任务登记到 useDramaTasks，取消会真实 abort 请求。
 */
export function VideoStep({ sequence, settings, config, patch, patchSetting, go, selectShot, selectedShotId }: StepProps) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState<string | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState<{ shotId: string; text: string } | null>(null);
    const activeTaskRef = useRef<string | null>(null);
    const frameInputRef = useRef<HTMLInputElement>(null);
    const [frameTarget, setFrameTarget] = useState<string | null>(null);
    const startTask = useDramaTasks((state) => state.start);
    const finishTask = useDramaTasks((state) => state.finish);
    const failTask = useDramaTasks((state) => state.fail);
    const cancelTask = useDramaTasks((state) => state.cancel);

    const keys = useMemo(
        () => sequence.shots.flatMap((shot) => [shot.videoRef ?? "", shot.imageRef ?? "", ...(shot.imageVersions ?? []).map((version) => version.storageKey), ...(shot.videoVersions ?? []).map((version) => version.storageKey)]),
        [sequence.shots],
    );
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

    /** 手动上传首帧：图生视频的第一个参考图由用户直接给，不走「逐镜出图」。 */
    const uploadFirstFrame = async (shot: DramaShot, file: File) => {
        if (!file.type.startsWith("image/")) {
            message.warning("首帧要图片文件（jpg / png / webp）");
            return;
        }
        try {
            const uploaded = await uploadMediaFile(file, "drama-first-frame");
            const version: DramaMediaVersion = {
                storageKey: uploaded.storageKey,
                model: "手动上传",
                prompt: file.name,
                parameters: { source: "upload" },
                createdAt: new Date().toISOString(),
            };
            const latest = latestShots().find((item) => item.id === shot.id) ?? shot;
            patchShot(shot.id, {
                imageRef: uploaded.storageKey,
                status: "done",
                imageVersions: [version, ...(latest.imageVersions ?? [])].slice(0, 8),
                generation: { ...latest.generation, image: { status: "done", stale: false, updatedAt: new Date().toISOString() } },
            });
            message.success(`镜 ${shot.no} 首帧已换成上传的图片`);
        } catch (caught) {
            message.error(caught instanceof Error ? caught.message : "首帧上传失败");
        }
    };

    const pickFrame = (shotId: string) => {
        setFrameTarget(shotId);
        frameInputRef.current?.click();
    };

    const capability = useMemo(() => resolveVideoCapability(settings.videoModel), [settings.videoModel]);

    /** 用远程任务里记录的实际参数重建请求配置，续查与首次提交保持同一套参数。 */
    const configForRemote = (base: ReturnType<typeof buildGenerationConfig>, remote: DramaRemoteTask) => {
        const seconds = remote.params?.seconds;
        const ratio = remote.params?.ratio;
        const quality = remote.params?.quality;
        return {
            ...base,
            model: remote.model,
            videoModel: remote.model,
            ...(seconds ? { videoSeconds: seconds } : {}),
            ...(ratio ? { size: ratio } : {}),
            ...(quality ? { vquality: quality } : {}),
        };
    };

    /** 视频结果落素材库并写回镜头；首次生成与续查共用。 */
    const persistVideo = async (shot: DramaShot, result: VideoGenerationResult, remote: DramaRemoteTask, taskId: string) => {
        const file = await storeGeneratedVideo(result);
        const version: DramaMediaVersion = {
            storageKey: file.storageKey,
            model: remote.model,
            prompt: remote.prompt,
            parameters: { ...(remote.params ?? {}), shotSeconds: String(shot.seconds) },
            createdAt: new Date().toISOString(),
        };
        const latest = latestShots().find((item) => item.id === shot.id) ?? shot;
        patchShot(shot.id, {
            videoRef: file.storageKey,
            videoVersions: [version, ...(latest.videoVersions ?? [])].slice(0, 6),
            generation: { ...latest.generation, video: { status: "done", stale: false, updatedAt: new Date().toISOString() } },
        });
        finishTask(taskId, file.storageKey);
    };

    const resumedRef = useRef<Set<string>>(new Set());
    const [resuming, setResuming] = useState(0);

    /** 续查一个已提交的远程任务：不重新提交，只轮询结果。 */
    const resumeRemote = async (shot: DramaShot) => {
        const remote = shot.generation?.video?.remote;
        if (!remote || resumedRef.current.has(shot.id)) return;
        resumedRef.current.add(shot.id);
        setResuming((value) => value + 1);
        const task = startTask({ sequenceId: sequence.id, shotId: shot.id, kind: "video", label: `续查 · 镜 ${shot.no}`, model: remote.model, prompt: remote.prompt });
        const base = buildGenerationConfig(config, undefined, "video");
        try {
            patchShot(shot.id, { generation: { ...shot.generation, video: { ...shot.generation?.video, status: "running", error: undefined, updatedAt: new Date().toISOString() } } });
            const result = await waitForVideoGenerationTask(configForRemote(base, remote), { id: remote.taskId, provider: remote.provider, model: remote.model } as VideoGenerationTask, { signal: task.signal });
            await persistVideo(shot, result, remote, task.id);
            message.success(`镜 ${shot.no} 远程任务已完成`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : "续查失败";
            if (!task.signal.aborted) {
                // 保留 remote：网络类失败可以再点「续查」，不必重新提交一条新任务。
                patchShot(shot.id, { generation: { ...shot.generation, video: { status: "failed", error: `续查失败：${reason}`, remote, updatedAt: new Date().toISOString() } } });
                failTask(task.id, reason);
            }
        } finally {
            setResuming((value) => Math.max(0, value - 1));
        }
    };

    /** 刷新后自动续查：只捡「有远程凭据且未完成」的镜头，每个镜头只跑一次。 */
    useEffect(() => {
        const latest = useDramaStore.getState().sequences.find((item) => item.id === sequence.id) ?? sequence;
        const targets = latest.shots.filter((shot) => {
            const state = shot.generation?.video;
            return Boolean(state?.remote) && (state?.status === "running" || state?.status === "pending");
        });
        if (!targets.length) return;
        void (async () => {
            for (const shot of targets) await resumeRemote(shot);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sequence.id]);
    const previewShot = sequence.shots.find((shot) => shot.id === selectedShotId) ?? sequence.shots[0] ?? null;
    const previewPlan = useMemo(() => (previewShot ? buildVideoPlan({ sequence, shot: previewShot, settings, capability }) : null), [sequence, previewShot, settings, capability]);

    const generate = async (shot: DramaShot, quiet = false) => {
        const localCapability = resolveVideoCapability(settings.videoModel);
        const plan = buildVideoPlan({ sequence, shot, settings, capability: localCapability });
        if (plan.blocked) {
            if (!quiet) message.warning(plan.blocked);
            return false;
        }

        if (!quiet) setBusy(shot.id);
        setElapsed(0);
        setError(null);
        const task = startTask({
            sequenceId: sequence.id,
            shotId: shot.id,
            kind: "video",
            label: `镜 ${shot.no} · 视频`,
            model: localCapability.model || "画布默认",
            prompt: plan.prompt,
        });
        activeTaskRef.current = task.id;
        const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
        patchShot(shot.id, { generation: { ...shot.generation, video: { status: "running", updatedAt: new Date().toISOString() } } });

        try {
            const base = buildGenerationConfig(config, undefined, "video");
            const videoConfig = applyVideoPlan({ ...base, model: settings.videoModel || base.model, videoModel: settings.videoModel || base.videoModel }, plan);
            const references: ReferenceImage[] = await Promise.all(
                plan.references.map(async (ref, index) => ({
                    id: `ref-${index}`,
                    name: `ref-${index}.png`,
                    type: "image/png",
                    dataUrl: await resolveMediaUrl(ref, ref),
                })),
            );
            // 先建任务再把 remote 凭据写进镜头：刷新后还能续查，不用重新提交。
            const created = await createVideoGenerationTask(videoConfig, plan.prompt, references, { signal: task.signal });
            const remote: DramaRemoteTask = {
                taskId: created.id,
                provider: created.provider,
                model: created.model,
                prompt: plan.prompt,
                params: { ...plan.params, references: String(plan.references.length) },
                createdAt: new Date().toISOString(),
            };
            patchShot(shot.id, { generation: { ...shot.generation, video: { status: "running", remote, updatedAt: new Date().toISOString() } } });
            const result = await waitForVideoGenerationTask(videoConfig, created, { signal: task.signal });
            await persistVideo(shot, result, remote, task.id);
            if (!quiet) message.success(`镜 ${shot.no} 视频已生成${plan.warnings.length ? `（${plan.warnings[0]}）` : ""}`);
            return true;
        } catch (caught) {
            const text = caught instanceof Error ? caught.message : "视频生成失败";
            const latest = latestShots().find((item) => item.id === shot.id) ?? shot;
            // 取消与失败分开记录：取消不改写已有视频，也不标记为失败原因。
            if (task.signal.aborted) {
                // 取消只是不再等结果，远程任务可能还在跑：保留 remote，下次进来能续查。
                patchShot(shot.id, { generation: { ...latest.generation, video: { status: "pending", error: "已取消等待，远程任务可能仍在运行", updatedAt: new Date().toISOString() } } });
            } else {
                patchShot(shot.id, { generation: { ...latest.generation, video: { status: "failed", error: text, updatedAt: new Date().toISOString() } } });
                failTask(task.id, text);
                setError({ shotId: shot.id, text });
                if (!quiet) message.error(text);
            }
            return false;
        } finally {
            clearInterval(timer);
            activeTaskRef.current = null;
            if (!quiet) setBusy(null);
        }
    };

    const runAll = async () => {
        const all = latestShots();
        // 剧本改过、视频还是旧内容的镜头一起重做；没有首帧的仍然跳过。
        const pending = all.filter((shot) => shot.imageRef && (!shot.videoRef || shot.generation?.video?.stale));
        const skipped = all.filter((shot) => !shot.imageRef).length;
        if (!pending.length) {
            message.info(skipped ? `${skipped} 镜缺首帧，先在卡片里上传首帧或去「逐镜出图」出图` : "所有镜头都有视频了");
            return;
        }
        setBusy("all");
        let failed = 0;
        try {
            for (const shot of pending) failed += (await generate(shot, true)) ? 0 : 1;
        } finally {
            setBusy(null);
        }
        const tail = skipped ? ` · ${skipped} 镜缺首帧跳过` : "";
        message[failed ? "warning" : "success"](failed ? `批量完成：${pending.length - failed} 成功 / ${failed} 失败${tail}` : `批量生成完成 · ${pending.length} 镜${tail}`);
    };

    const done = sequence.shots.filter((shot) => shot.videoRef).length;
    const missingImage = sequence.shots.filter((shot) => !shot.imageRef).length;
    const stale = sequence.shots.filter((shot) => shot.videoRef && shot.generation?.video?.stale).length;

    return (
        <StepShell
            title="视频生成"
            subtitle={`${done}/${sequence.shots.length} 镜已有视频${stale ? ` · ${stale} 镜剧本已改待重做` : ""}。首帧取正式版画面（也可以自己上传），时长优先用镜头秒数。`}
            actions={
                <>
                    <Select className="min-w-44" value={settings.videoModel || ""} onChange={(value) => patchSetting("videoModel", value)} options={[{ label: "视频模型：自动（跟随画布默认）", value: "" }, ...modelOptions]} popupMatchSelectWidth={false} />
                    <Select className="w-32" value={settings.videoRatio} onChange={(value) => patchSetting("videoRatio", value)} options={SETTING_OPTIONS.videoRatio.map((value) => ({ value, label: `比例 ${value}` }))} />
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
                        <Button
                            danger
                            onClick={() => {
                                if (activeTaskRef.current) cancelTask(activeTaskRef.current);
                            }}
                        >
                            取消当前任务（已等待 {elapsed}s）
                        </Button>
                    ) : null}
                    <span className="drama-sub">任务会登记到底部任务栏；取消会真实中断请求。</span>
                    <Button className="ml-auto" type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(9)}>
                        下一步 · 合成导出
                    </Button>
                </>
            }
        >
            <input
                ref={frameInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    const target = frameTarget;
                    event.target.value = "";
                    const shot = target ? latestShots().find((item) => item.id === target) : null;
                    if (shot && file) void uploadFirstFrame(shot, file);
                }}
            />

            {resuming ? (
                <div className="drama-notice mb-3">正在续查 {resuming} 个未完成的远程视频任务，完成后会自动写回镜头。</div>
            ) : null}

            {missingImage ? (
                <div className="drama-notice mb-3">
                    <CircleAlert className="size-4 shrink-0" />
                    {missingImage} 个镜头还没有画面：可以在卡片里直接「上传首帧」，或先回「逐镜出图」出图；视频按图生视频提交。
                </div>
            ) : null}

            {previewPlan ? (
                <details className="drama-card mb-3 text-[13px]">
                    <summary className="cursor-pointer font-medium">
                        本次请求预览 · {previewShot?.no} 镜 · {previewPlan.seconds}s · {previewPlan.ratio} · {previewPlan.quality} ·{" "}
                        {previewPlan.referenceMode === "none" ? "无首帧" : `${previewPlan.references.length} 张参考图`}
                        {previewPlan.blocked ? " · 不可提交" : previewPlan.warnings.length ? " · 有调整" : ""}
                    </summary>
                    <div className="mt-2 grid gap-1.5 text-stone-500 dark:text-stone-400">
                        <div>模型：{capability.model || "画布默认"} · {capability.provider === "builtin" ? "内置站点" : "渠道模型"}</div>
                        <div>时长：{previewPlan.seconds}s（分镜写 {previewPlan.requestedSeconds}s）· 比例 {previewPlan.ratio} · 分辨率 {previewPlan.quality}</div>
                        <div>参考图：{previewPlan.references.length} 张 · {previewPlan.referenceMode}</div>
                        <div className="whitespace-pre-wrap text-stone-600 dark:text-stone-300">{previewPlan.prompt}</div>
                        {previewPlan.warnings.map((warning) => (
                            <div key={warning} className="text-amber-600 dark:text-amber-400">· {warning}</div>
                        ))}
                        {previewPlan.blocked ? <div className="text-red-500">· {previewPlan.blocked}</div> : null}
                        {capability.notes.map((note) => (
                            <div key={note} className="text-stone-400">· {note}</div>
                        ))}
                    </div>
                </details>
            ) : null}

            {sequence.shots.length === 0 ? (
                <div className="drama-empty-block">还没有镜头。</div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                    {sequence.shots.map((shot) => {
                        const running = busy === shot.id || (busy === "all" && shot.generation?.video?.status === "running");
                        const videoUrl = urls[shot.videoRef ?? ""];
                        return (
                            <article key={shot.id} className={cn("drama-shot-card", selectedShotId === shot.id && "is-active")} onClick={() => selectShot(shot.id)}>
                                <div className="relative aspect-[9/16] overflow-hidden rounded-md" style={{ background: frameGradient(shot.scene || shot.no) }}>
                                    {videoUrl ? <video src={videoUrl} className="size-full object-cover" muted playsInline controls /> : shot.imageRef && urls[shot.imageRef] ? <img src={urls[shot.imageRef]} alt="" className="size-full object-cover opacity-60" /> : <span className="absolute inset-0 grid place-items-center text-[13px] text-white/70">无首帧</span>}
                                    <span className="absolute left-2 top-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[12px] text-white">镜 {shot.no}</span>
                                    {shot.videoRef && shot.generation?.video?.stale ? <span className="absolute right-2 top-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 text-[12px] text-white">内容已改</span> : null}
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

                                {error?.shotId === shot.id || shot.generation?.video?.error ? (
                                    <div className="mt-1 line-clamp-2 text-[12px] text-red-500">{error?.shotId === shot.id ? error.text : shot.generation?.video?.error}</div>
                                ) : null}

                                {/* 首帧：默认用「逐镜出图」的正式版，也可以换版本或直接上传自己的图。 */}
                                <div className="mt-1 flex items-center gap-1">
                                    <span className="shrink-0 text-[12px] text-stone-400">首帧</span>
                                    {(shot.imageVersions ?? []).slice(0, 3).map((version) => (
                                        <button
                                            key={version.storageKey}
                                            type="button"
                                            title={version.model === "手动上传" ? "手动上传的首帧" : "用这张做首帧"}
                                            className={cn("drama-frame-thumb", shot.imageRef === version.storageKey && "is-active")}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                patchShot(shot.id, { imageRef: version.storageKey });
                                            }}
                                        >
                                            {urls[version.storageKey] ? <img src={urls[version.storageKey]} alt="" className="size-full object-cover" /> : null}
                                        </button>
                                    ))}
                                    <Button
                                        size="small"
                                        type="text"
                                        className="ml-auto shrink-0"
                                        icon={<Upload className="size-3.5" />}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            pickFrame(shot.id);
                                        }}
                                    >
                                        上传首帧
                                    </Button>
                                </div>

                                <div className="mt-1 flex items-center gap-1">
                                    <span className="text-[12px] text-stone-400">{shot.videoVersions?.length ?? 0} 版</span>
                                    {shot.generation?.video?.remote && shot.generation.video.status !== "running" ? (
                                        <Button
                                            size="small"
                                            type="text"
                                            disabled={busy !== null}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void resumeRemote(shot);
                                            }}
                                        >
                                            续查
                                        </Button>
                                    ) : null}
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
