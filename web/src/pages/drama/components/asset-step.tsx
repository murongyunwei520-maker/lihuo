import { useEffect, useMemo, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { ArrowRight, Image as ImageIcon, LoaderCircle, Plus } from "lucide-react";

import { Panel, StepShell } from "./step-shell";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildAssetPrompt } from "@/lib/drama/asset-prompt";
import { ASSET_KIND_LABEL, frameGradient } from "@/lib/drama/schema";
import { ASSET_QUALITY_OPTIONS, SETTING_OPTIONS } from "@/lib/drama/settings";
import { requestGeneration } from "@/services/api/image";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { allChannels, decodeChannelModel, modelOptionName, selectableModelsByCapability } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { useDramaTasks } from "@/stores/use-drama-tasks";
import type { DramaAsset, DramaAssetKind, DramaMediaVersion } from "@/types/drama";
import type { StepProps } from "../steps/step-props";

const ASSET_KINDS: DramaAssetKind[] = ["character", "scene", "costume", "prop", "effect", "other"];

/** 设定之后的资产生成：模型 / 比例 / 画质可选，逐张出图并写回 DramaAsset。 */
export function AssetStep({ sequence, settings, config, patch, patchSetting, go, selectAsset, selectedAssetId }: StepProps) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState<string | null>(null);
    const startTask = useDramaTasks((state) => state.start);
    const finishTask = useDramaTasks((state) => state.finish);
    const failTask = useDramaTasks((state) => state.fail);
    const [urls, setUrls] = useState<Record<string, string>>({});

    // 批量循环里 props 是旧快照，读写都以 store 最新数据为准。
    const latestAssets = () => useDramaStore.getState().sequences.find((item) => item.id === sequence.id)?.assets ?? sequence.assets;
    const patchAsset = (assetId: string, part: Partial<DramaAsset>) => patch({ assets: latestAssets().map((item) => (item.id === assetId ? { ...item, ...part } : item)) });

    const modelOptions = useMemo(() => {
        const values = selectableModelsByCapability(config, "image");
        return allChannels(config)
            .map((channel) => ({
                label: `${channel.name}`,
                options: values.filter((value) => decodeChannelModel(value)?.channelId === channel.id).map((value) => ({ value, label: modelOptionName(value) })),
            }))
            .filter((group) => group.options.length > 0);
    }, [config]);

    useEffect(() => {
        let alive = true;
        const pending = sequence.assets.filter((asset) => asset.refs[0] && !urls[asset.id]);
        if (!pending.length) return;
        Promise.all(pending.map(async (asset) => [asset.id, await resolveMediaUrl(asset.refs[0], "")] as const)).then((pairs) => {
            if (!alive) return;
            setUrls((prev) => ({ ...prev, ...Object.fromEntries(pairs.filter(([, url]) => Boolean(url))) }));
        });
        return () => {
            alive = false;
        };
    }, [sequence.assets, urls]);

    const generateOne = async (asset: DramaAsset, quiet = false) => {
        let taskId = "";
        let signal: AbortSignal | undefined;
        try {
            const base = buildGenerationConfig(config, undefined, "image");
            const generationConfig = {
                ...base,
                model: settings.imageModel || base.model,
                ...(settings.ratio !== "自动" ? { size: settings.ratio } : {}),
                ...(settings.assetQuality !== "自动" ? { quality: settings.assetQuality } : {}),
            };
            // 统一资产提示词：项目视觉 + 摄影参数 + 类型模板 + 材质 + 画幅 + 负面词。
            const prompt = buildAssetPrompt(sequence, asset, settings);
            const task = startTask({ sequenceId: sequence.id, kind: "asset", label: `${asset.name} · 资产图`, model: generationConfig.model, prompt });
            taskId = task.id;
            signal = task.signal;
            const items = await requestGeneration(generationConfig, prompt, { signal: task.signal });
            const dataUrl = items[0]?.dataUrl;
            if (!dataUrl) throw new Error("模型没有返回图片");
            const blob = await (await fetch(dataUrl)).blob();
            const file = await uploadMediaFile(blob, "drama-asset");
            const version: DramaMediaVersion = {
                storageKey: file.storageKey,
                model: generationConfig.model,
                prompt,
                parameters: { ratio: settings.ratio, quality: settings.assetQuality, kind: asset.kind },
                createdAt: new Date().toISOString(),
            };
            const latest = latestAssets().find((item) => item.id === asset.id) ?? asset;
            finishTask(taskId, file.storageKey);
            patchAsset(asset.id, { refs: [file.storageKey], versions: [version, ...(latest.versions ?? [])].slice(0, 8), model: generationConfig.model });
            if (!quiet) message.success(`${asset.name} 已生成`);
            return true;
        } catch (error) {
            const reason = error instanceof Error ? error.message : "生成失败";
            if (taskId && !signal?.aborted) failTask(taskId, reason);
            if (!quiet) message.error(reason);
            return false;
        }
    };

    const runAll = async () => {
        if (busy) return;
        const pending = latestAssets().filter((asset) => !asset.refs.length);
        if (!pending.length) {
            message.info("所有资产都有图了");
            return;
        }
        setBusy("all");
        let failed = 0;
        try {
            for (const asset of pending) {
                // 单张失败不打断整批。
                if (!(await generateOne(asset, true))) failed += 1;
            }
        } finally {
            setBusy(null);
        }
        message[failed ? "warning" : "success"](failed ? `批量完成：${pending.length - failed} 成功 / ${failed} 失败` : `批量生成完成 · ${pending.length} 张`);
    };

    const addAsset = (kind: DramaAssetKind) => {
        const assets = latestAssets();
        patch({ assets: [...assets, { id: `asset-${Date.now()}`, name: `新${ASSET_KIND_LABEL[kind]} ${assets.filter((item) => item.kind === kind).length + 1}`, kind, description: "", refs: [] }] });
    };

    const ready = sequence.assets.filter((asset) => asset.refs.length > 0).length;
    const groups = ASSET_KINDS.map((kind) => ({ kind, list: sequence.assets.filter((asset) => asset.kind === kind) })).filter((group) => group.list.length > 0);

    return (
        <StepShell
            title="资产生成"
            subtitle={`${ready} / ${sequence.assets.length} 个资产已有参考图。生成过的资产会被后续出图、配音、视频反复引用。`}
            actions={
                <>
                    <Select className="min-w-48" value={settings.imageModel || ""} onChange={(value) => patchSetting("imageModel", value)} options={[{ label: "模型：自动（跟随画布默认）", value: "" }, ...modelOptions]} popupMatchSelectWidth={false} />
                    <Select className="w-32" value={settings.ratio} onChange={(value) => patchSetting("ratio", value)} options={SETTING_OPTIONS.ratio.map((value) => ({ value, label: `比例 ${value}` }))} />
                    <Select className="w-32" value={settings.assetQuality} onChange={(value) => patchSetting("assetQuality", value)} options={ASSET_QUALITY_OPTIONS.map((value) => ({ value, label: `画质 ${value}` }))} />
                    <Button type="primary" loading={busy === "all"} disabled={busy !== null} onClick={() => void runAll()}>
                        全部生成
                    </Button>
                </>
            }
            footer={
                <>
                    <Button onClick={() => go(3)}>上一步</Button>
                    <span className="drama-sub">生成的图会作为参考资产随镜头提交；批量一次一张，避免并发打满。</span>
                    <Button className="ml-auto" type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(5)} disabled={!sequence.shots.length}>
                        下一步 · 分镜设计
                    </Button>
                </>
            }
        >
            {sequence.assets.length === 0 ? (
                <div className="drama-empty-block">
                    <p className="text-sm">还没有资产。先回「剧本拆解」拆出人物与场景，或直接在下面新建。</p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {ASSET_KINDS.map((kind) => (
                            <Button key={kind} icon={<Plus className="size-4" />} onClick={() => addAsset(kind)}>
                                新建{ASSET_KIND_LABEL[kind]}
                            </Button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {ASSET_KINDS.map((kind) => (
                            <Button key={kind} size="small" icon={<Plus className="size-3.5" />} onClick={() => addAsset(kind)}>
                                {ASSET_KIND_LABEL[kind]}
                            </Button>
                        ))}
                    </div>
                    {groups.map((group) => (
                        <Panel key={group.kind} title={ASSET_KIND_LABEL[group.kind]} hint={`${group.list.length} 个`}>
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                                {group.list.map((asset) => {
                                    const url = urls[asset.id];
                                    const running = busy === asset.id;
                                    return (
                                        <div key={asset.id} className={`drama-asset-card ${selectedAssetId === asset.id ? "is-active" : ""}`} onClick={() => selectAsset(asset.id)}>
                                            <div className="relative aspect-[3/4] overflow-hidden rounded-md" style={{ background: frameGradient(asset.name) }}>
                                                {url ? <img src={url} alt={asset.name} className="size-full object-cover" /> : <span className="absolute inset-0 grid place-items-center px-2 text-center text-[13px] text-white/70">待生成</span>}
                                                {running ? (
                                                    <div className="absolute inset-0 grid place-items-center bg-black/40">
                                                        <LoaderCircle className="size-5 animate-spin text-white" />
                                                    </div>
                                                ) : null}
                                            </div>
                                            <Input
                                                value={asset.name}
                                                variant="borderless"
                                                className="px-1"
                                                onChange={(event) => patchAsset(asset.id, { name: event.target.value })}
                                                onClick={(event) => event.stopPropagation()}
                                            />
                                            <div className="flex items-center justify-between px-1 text-[12px] text-stone-400">
                                                <span>{asset.refs.length ? "已生成" : "未生成"}</span>
                                                <span>{asset.versions?.length ?? 0} 版</span>
                                            </div>
                                            <Button
                                                size="small"
                                                block
                                                icon={running ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
                                                disabled={busy !== null}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setBusy(asset.id);
                                                    void generateOne(asset).finally(() => setBusy(null));
                                                }}
                                            >
                                                {asset.refs.length ? "重新生成" : "生成"}
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        </Panel>
                    ))}
                </div>
            )}
        </StepShell>
    );
}
