import { useEffect, useState } from "react";
import { Input, InputNumber, Select } from "antd";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Mic, Video } from "lucide-react";

import { shotImagePrompt, shotVideoPrompt } from "@/lib/drama/prompt";
import { ASSET_KIND_LABEL, LIGHT_LABEL, SHOT_CAMERAS, SHOT_COMPOSITIONS, SHOT_MAX_SECONDS, SHOT_MIN_SECONDS, SHOT_MOVES, SHOT_SIZES, frameGradient } from "@/lib/drama/schema";
import { APERTURE_OPTIONS, FILL_LIGHT_OPTIONS, KEY_LIGHT_OPTIONS, LENS_OPTIONS } from "@/lib/drama/settings";
import { resolveCinematography } from "@/lib/drama/visual";
import { cn } from "@/lib/utils";
import { resolveMediaUrl } from "@/services/file-storage";
import type { DramaAsset, DramaAssetKind, DramaLight, DramaSequence, DramaShot } from "@/types/drama";

type Props = {
    sequence: DramaSequence;
    shot: DramaShot | null;
    asset: DramaAsset | null;
    collapsed: boolean;
    onToggle: () => void;
    onPatchShot: (id: string, patch: Partial<DramaShot>) => void;
    onPatchAsset: (id: string, patch: Partial<DramaAsset>) => void;
    onSelectShot: (id: string) => void;
    onClearAsset: () => void;
    onJumpStep: (step: number) => void;
};

const ASSET_KINDS: DramaAssetKind[] = ["character", "scene", "costume", "prop", "effect", "other"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex items-center gap-2 py-1">
            <span className="w-14 shrink-0 text-[13px] text-stone-500 dark:text-stone-400">{label}</span>
            <div className="min-w-0 flex-1">{children}</div>
        </label>
    );
}

/** 右侧上下文检查器：选中镜头看镜头，选中资产看资产，否则看项目概览。 */
export function Inspector({ sequence, shot, asset, collapsed, onToggle, onPatchShot, onPatchAsset, onSelectShot, onClearAsset, onJumpStep }: Props) {
    if (collapsed) {
        return (
            <aside className="drama-inspector is-collapsed">
                <button type="button" className="drama-inspector__toggle" onClick={onToggle} title="展开属性面板">
                    <ChevronLeft className="size-4" />
                </button>
            </aside>
        );
    }

    return (
        <aside className="drama-inspector">
            <header className="drama-inspector__head">
                <span className="drama-h3">{asset ? "资产属性" : shot ? `镜头 ${shot.no}` : "项目概览"}</span>
                <button type="button" className="drama-inspector__toggle" onClick={onToggle} title="收起属性面板">
                    <ChevronRight className="size-4" />
                </button>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4">
                {asset ? (
                    <>
                        <div className="overflow-hidden rounded-lg border border-[var(--studio-border-soft)]">
                            <div className="relative aspect-[3/4]" style={{ background: frameGradient(asset.name) }}>
                                {asset.refs[0] ? <AssetPreviewInner storageKey={asset.refs[0]} /> : <span className="absolute inset-0 grid place-items-center text-[13px] text-white/60">还没有参考图</span>}
                            </div>
                        </div>
                        <Row label="名称">
                            <Input value={asset.name} onChange={(event) => onPatchAsset(asset.id, { name: event.target.value })} />
                        </Row>
                        <Row label="类别">
                            <Select className="w-full" value={asset.kind} onChange={(value) => onPatchAsset(asset.id, { kind: value })} options={ASSET_KINDS.map((kind) => ({ value: kind, label: ASSET_KIND_LABEL[kind] }))} />
                        </Row>
                        <Row label="描述">
                            <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} value={asset.description} placeholder="固定外观描述，出图时随镜头提示词提交" onChange={(event) => onPatchAsset(asset.id, { description: event.target.value })} />
                        </Row>
                        <div className="drama-card text-[13px] leading-6 text-stone-500 dark:text-stone-400">
                            <div>参考图 {asset.refs.length} 张 · 历史版本 {asset.versions?.length ?? 0} 个</div>
                            <div>被 {sequence.shots.filter((item) => item.assetIds.includes(asset.id)).length} 个镜头引用</div>
                            {asset.model ? <div>生成模型：{asset.model}</div> : null}
                            <button type="button" className="mt-2 text-[13px] text-indigo-600 hover:underline dark:text-indigo-300" onClick={onClearAsset}>
                                返回项目概览
                            </button>
                        </div>
                    </>
                ) : shot ? (
                    <>
                        <div className="flex items-center gap-2">
                            <Select className="flex-1" value={shot.id} onChange={onSelectShot} options={sequence.shots.map((item) => ({ value: item.id, label: `镜 ${item.no} · ${item.scene || "未填场景"}` }))} />
                        </div>
                        <div className="drama-card space-y-0.5">
                            <Row label="场景">
                                <Input value={shot.scene} placeholder="街口 · 雨夜" onChange={(event) => onPatchShot(shot.id, { scene: event.target.value })} />
                            </Row>
                            <Row label="景别">
                                <Select className="w-full" value={shot.size} onChange={(value) => onPatchShot(shot.id, { size: value })} options={SHOT_SIZES.map((value) => ({ value, label: value }))} />
                            </Row>
                            <Row label="机位">
                                <Select className="w-full" value={shot.camera ?? SHOT_CAMERAS[0]} onChange={(value) => onPatchShot(shot.id, { camera: value })} options={SHOT_CAMERAS.map((value) => ({ value, label: value }))} />
                            </Row>
                            <Row label="运镜">
                                <Select className="w-full" value={shot.move} onChange={(value) => onPatchShot(shot.id, { move: value })} options={SHOT_MOVES.map((value) => ({ value, label: value }))} />
                            </Row>
                            <Row label="构图">
                                <Select
                                    className="w-full"
                                    value={shot.composition ?? ""}
                                    onChange={(value) => onPatchShot(shot.id, { composition: value || undefined })}
                                    options={[
                                        { value: "", label: `跟随项目（${resolveCinematography(sequence, shot).composition}）` },
                                        ...SHOT_COMPOSITIONS.map((value) => ({ value, label: value })),
                                    ]}
                                />
                            </Row>
                            <Row label="光位">
                                <Select className="w-full" value={shot.light} onChange={(value) => onPatchShot(shot.id, { light: value as DramaLight })} options={(Object.keys(LIGHT_LABEL) as DramaLight[]).map((value) => ({ value, label: LIGHT_LABEL[value] }))} />
                            </Row>
                            <Row label="时长">
                                <InputNumber className="w-full" min={SHOT_MIN_SECONDS} max={SHOT_MAX_SECONDS} value={shot.seconds} onChange={(value) => typeof value === "number" && onPatchShot(shot.id, { seconds: value })} />
                            </Row>
                        </div>

                        <div className="drama-card space-y-0.5">
                            <div className="drama-label">镜头级摄影（留空跟随项目默认）</div>
                            {(() => {
                                const cinema = resolveCinematography(sequence, shot);
                                const override = (label: string, key: "lens" | "aperture" | "keyLight" | "fillLight", options: string[], fallback: string) => (
                                    <Row label={label}>
                                        <Select
                                            className="w-full"
                                            value={shot[key] ?? ""}
                                            onChange={(value) => onPatchShot(shot.id, { [key]: value || undefined })}
                                            options={[{ value: "", label: `跟随项目（${fallback}）` }, ...options.filter((item) => item !== "自动").map((item) => ({ value: item, label: item }))]}
                                        />
                                    </Row>
                                );
                                return (
                                    <>
                                        {override("焦段", "lens", LENS_OPTIONS, cinema.lens)}
                                        {override("光圈", "aperture", APERTURE_OPTIONS, cinema.aperture)}
                                        {override("主光", "keyLight", KEY_LIGHT_OPTIONS, cinema.keyLight)}
                                        {override("辅光", "fillLight", FILL_LIGHT_OPTIONS, cinema.fillLight)}
                                    </>
                                );
                            })()}
                        </div>

                        <div className="drama-card">
                            <div className="drama-label">实际提交的提示词</div>
                            <details className="text-[13px]">
                                <summary className="cursor-pointer text-stone-500 dark:text-stone-400">图片提示词</summary>
                                <p className="mt-1 leading-6 whitespace-pre-wrap text-stone-600 dark:text-stone-300">{shotImagePrompt(sequence, shot)}</p>
                            </details>
                            <details className="mt-2 text-[13px]">
                                <summary className="cursor-pointer text-stone-500 dark:text-stone-400">视频提示词</summary>
                                <p className="mt-1 leading-6 whitespace-pre-wrap text-stone-600 dark:text-stone-300">{shotVideoPrompt(sequence, shot)}</p>
                            </details>
                        </div>

                        <div className="drama-card">
                            <div className="drama-label">台词{shot.speaker ? ` · ${shot.speaker}` : ""}</div>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} value={shot.line} placeholder="无台词可留空；不要在这里写画面" onChange={(event) => onPatchShot(shot.id, { line: event.target.value })} />
                            <div className="drama-label mt-3">人物动作</div>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={shot.action ?? ""} placeholder="这一镜人物在做什么" onChange={(event) => onPatchShot(shot.id, { action: event.target.value })} />
                            <div className="drama-label mt-3">面部表情</div>
                            <Input value={shot.expression ?? ""} placeholder="例如：克制、眼眶泛红" onChange={(event) => onPatchShot(shot.id, { expression: event.target.value })} />
                            <div className="drama-label mt-3">画面描述</div>
                            <Input.TextArea autoSize={{ minRows: 3, maxRows: 7 }} value={shot.prompt} placeholder="这一镜要看到什么" onChange={(event) => onPatchShot(shot.id, { prompt: event.target.value })} />
                            <div className="drama-label mt-3">声音需求</div>
                            <Input value={shot.sound ?? ""} placeholder="环境声 / 音效 / 旁白" onChange={(event) => onPatchShot(shot.id, { sound: event.target.value })} />
                        </div>

                        <div className="drama-card">
                            <div className="drama-label">生成的版本</div>
                            <div className="space-y-2 text-[13px]">
                                <button type="button" className="drama-version-row" onClick={() => onJumpStep(6)}>
                                    <ImageIcon className="size-4 text-stone-400" />
                                    <span className="flex-1 text-left">画面</span>
                                    <span className={cn(shot.imageRef ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400")}>
                                        {shot.imageRef ? (shot.generation?.image?.stale ? "已选用 · 待重做" : "已选用") : "未生成"} · {shot.imageVersions?.length ?? 0} 版
                                    </span>
                                </button>
                                <button type="button" className="drama-version-row" onClick={() => onJumpStep(7)}>
                                    <Mic className="size-4 text-stone-400" />
                                    <span className="flex-1 text-left">声音</span>
                                    <span className={cn(shot.audioRef ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400")}>
                                        {shot.audioRef ? (shot.generation?.audio?.stale ? "已选用 · 待重做" : "已选用") : "未生成"} · {shot.audioVersions?.length ?? 0} 版
                                    </span>
                                </button>
                                <button type="button" className="drama-version-row" onClick={() => onJumpStep(8)}>
                                    <Video className="size-4 text-stone-400" />
                                    <span className="flex-1 text-left">视频</span>
                                    <span className={cn(shot.videoRef ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400")}>
                                        {shot.videoRef ? (shot.generation?.video?.stale ? "已选用 · 待重做" : "已选用") : "未生成"} · {shot.videoVersions?.length ?? 0} 版
                                    </span>
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="drama-card space-y-2 text-[13px] leading-6">
                        <div className="flex justify-between">
                            <span className="text-stone-500 dark:text-stone-400">项目</span>
                            <span className="font-medium">{sequence.title}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500 dark:text-stone-400">镜头</span>
                            <span>{sequence.shots.length}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500 dark:text-stone-400">资产</span>
                            <span>{sequence.assets.length}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500 dark:text-stone-400">总时长</span>
                            <span>
                                {sequence.shots.reduce((sum, item) => sum + item.seconds, 0)}s / {sequence.targetSeconds}s
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500 dark:text-stone-400">已出画面</span>
                            <span>{sequence.shots.filter((item) => item.imageRef).length} 镜</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500 dark:text-stone-400">已出视频</span>
                            <span>{sequence.shots.filter((item) => item.videoRef).length} 镜</span>
                        </div>
                        <p className="pt-1 text-stone-400">点分镜里的镜头，这里会切换成该镜头的属性。</p>
                    </div>
                )}
            </div>
        </aside>
    );
}

/** 单独抽出来，避免检查器里再写一遍 resolveMediaUrl 的异步加载。 */
function AssetPreviewInner({ storageKey }: { storageKey: string }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let alive = true;
        void resolveMediaUrl(storageKey, "").then((next) => {
            if (alive) setUrl(next);
        });
        return () => {
            alive = false;
        };
    }, [storageKey]);
    return url ? <img src={url} alt="" className="size-full object-cover" /> : null;
}
