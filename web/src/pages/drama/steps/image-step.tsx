import { useMemo, useState } from "react";
import { App, Button, Select } from "antd";
import { ArrowRight, Image as ImageIcon, LoaderCircle, Sparkles } from "lucide-react";

import { StepShell } from "../components/step-shell";
import { useMediaUrls } from "../use-media-urls";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { shotPrompt, shotReferences } from "@/lib/drama/prompt";
import { ASSET_QUALITY_OPTIONS, SETTING_OPTIONS } from "@/lib/drama/settings";
import { frameGradient } from "@/lib/drama/schema";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { uploadMediaFile, resolveMediaUrl } from "@/services/file-storage";
import { allChannels, decodeChannelModel, modelOptionName, selectableModelsByCapability } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { cn } from "@/lib/utils";
import type { DramaMediaVersion, DramaShot } from "@/types/drama";
import type { ReferenceImage } from "@/types/image";
import type { StepProps } from "./step-props";

/** 07 逐镜出图：每镜可多版，选中的那版写回 shot.imageRef。 */
export function ImageStep({ sequence, settings, config, patch, patchSetting, go, selectShot, selectedShotId }: StepProps) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState<string | null>(null);

    const keys = useMemo(
        () => sequence.shots.flatMap((shot) => [shot.imageRef ?? "", ...(shot.imageVersions ?? []).map((version) => version.storageKey)]),
        [sequence.shots],
    );
    const urls = useMediaUrls(keys);

    const modelOptions = useMemo(() => {
        const values = selectableModelsByCapability(config, "image");
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
        patchShot(shot.id, { status: "running" });
        try {
            const base = buildGenerationConfig(config, undefined, "image");
            const generationConfig = {
                ...base,
                model: settings.imageModel || base.model,
                ...(settings.ratio !== "自动" ? { size: settings.ratio } : {}),
                ...(settings.assetQuality !== "自动" ? { quality: settings.assetQuality } : {}),
            };
            const prompt = shotPrompt(sequence, shot);
            const refs = shotReferences(sequence, shot);
            const references = await Promise.all(
                refs.map(async (ref, index): Promise<ReferenceImage> => ({ id: `ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl: await resolveMediaUrl(ref, ref) })),
            );
            const items = references.length ? await requestEdit(generationConfig, prompt, references) : await requestGeneration(generationConfig, prompt);
            const dataUrl = items[0]?.dataUrl;
            if (!dataUrl) throw new Error("模型没有返回图片");
            const blob = await (await fetch(dataUrl)).blob();
            const file = await uploadMediaFile(blob, "drama-shot");
            const version: DramaMediaVersion = { storageKey: file.storageKey, model: generationConfig.model, prompt, createdAt: new Date().toISOString() };
            const latest = latestShots().find((item) => item.id === shot.id) ?? shot;
            patchShot(shot.id, { status: "done", imageRef: file.storageKey, progress: undefined, imageVersions: [version, ...(latest.imageVersions ?? [])].slice(0, 8) });
            if (!quiet) message.success(`镜 ${shot.no} 已出图`);
            return true;
        } catch (error) {
            patchShot(shot.id, { status: "failed" });
            if (!quiet) message.error(error instanceof Error ? error.message : "出图失败");
            return false;
        }
    };

    const runAll = async () => {
        const pending = latestShots().filter((shot) => !shot.imageRef);
        if (!pending.length) {
            message.info("所有镜头都有画面了");
            return;
        }
        setBusy("all");
        let failed = 0;
        for (const shot of pending) {
            if (!(await generate(shot, true))) failed += 1;
        }
        setBusy(null);
        message[failed ? "warning" : "success"](failed ? `批量出图完成，${failed} 镜失败` : `批量出图完成 · ${pending.length} 镜`);
    };

    const done = sequence.shots.filter((shot) => shot.imageRef).length;

    return (
        <StepShell
            title="逐镜出图"
            subtitle={`${done}/${sequence.shots.length} 镜已有画面。每镜保留最近 8 个版本，点缩略图切换正式版。`}
            actions={
                <>
                    <Select className="min-w-48" value={settings.imageModel || ""} onChange={(value) => patchSetting("imageModel", value)} options={[{ label: "模型：自动（跟随画布默认）", value: "" }, ...modelOptions]} popupMatchSelectWidth={false} />
                    <Select className="w-32" value={settings.ratio} onChange={(value) => patchSetting("ratio", value)} options={SETTING_OPTIONS.ratio.map((value) => ({ value, label: `比例 ${value}` }))} />
                    <Select className="w-32" value={settings.assetQuality} onChange={(value) => patchSetting("assetQuality", value)} options={ASSET_QUALITY_OPTIONS.map((value) => ({ value, label: `画质 ${value}` }))} />
                    <Button type="primary" loading={busy === "all"} disabled={busy !== null} onClick={() => void runAll()}>
                        全部出图
                    </Button>
                </>
            }
            footer={
                <>
                    <Button onClick={() => go(5)}>上一步</Button>
                    <span className="drama-sub">挂参考资产的镜头走图生图，没挂的走文生图；批量一次一张。</span>
                    <Button className="ml-auto" type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(7)}>
                        下一步 · 声音制作
                    </Button>
                </>
            }
        >
            {sequence.shots.length === 0 ? (
                <div className="drama-empty-block">还没有镜头，先回「分镜设计」。</div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                    {sequence.shots.map((shot) => {
                        const running = busy === shot.id;
                        return (
                            <article key={shot.id} className={cn("drama-shot-card", selectedShotId === shot.id && "is-active")} onClick={() => selectShot(shot.id)}>
                                <div className="relative aspect-[9/16] overflow-hidden rounded-md" style={{ background: frameGradient(shot.scene || shot.no) }}>
                                    {shot.imageRef && urls[shot.imageRef] ? <img src={urls[shot.imageRef]} alt={`镜 ${shot.no}`} className="size-full object-cover" /> : <span className="absolute inset-0 grid place-items-center text-[13px] text-white/70">未生成</span>}
                                    <span className="absolute left-2 top-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[12px] text-white">镜 {shot.no}</span>
                                    {running ? (
                                        <div className="absolute inset-0 grid place-items-center bg-black/45">
                                            <LoaderCircle className="size-6 animate-spin text-white" />
                                        </div>
                                    ) : null}
                                </div>

                                {(shot.imageVersions?.length ?? 0) > 1 ? (
                                    <div className="mt-1 flex gap-1 overflow-x-auto pb-1">
                                        {shot.imageVersions?.map((version) => (
                                            <button
                                                key={version.storageKey}
                                                type="button"
                                                title="设为正式画面"
                                                className={cn("drama-version-thumb", shot.imageRef === version.storageKey && "is-active")}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    patchShot(shot.id, { imageRef: version.storageKey });
                                                }}
                                            >
                                                {urls[version.storageKey] ? <img src={urls[version.storageKey]} alt="" className="size-full object-cover" /> : null}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}

                                <div className="mt-1 flex items-center gap-1">
                                    <span className="text-[12px] text-stone-400">{shot.seconds}s · {shot.size}</span>
                                    <Button
                                        size="small"
                                        className="ml-auto"
                                        icon={running ? <LoaderCircle className="size-3.5 animate-spin" /> : shot.imageRef ? <Sparkles className="size-3.5" /> : <ImageIcon className="size-3.5" />}
                                        disabled={busy !== null}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void generate(shot);
                                        }}
                                    >
                                        {shot.imageRef ? "重拍" : "出图"}
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
