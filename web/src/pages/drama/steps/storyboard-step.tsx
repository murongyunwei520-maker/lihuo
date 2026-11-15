import { useState } from "react";
import { App, Button, Empty, Input, Select } from "antd";
import { ArrowRight, Copy, Plus, Sparkles, Trash2 } from "lucide-react";

import { StepShell } from "../components/step-shell";
import { generateShotDetails } from "@/lib/drama/ai";
import { createEmptyShot } from "@/lib/drama/sample";
import { SHOT_SIZES, frameGradient, lightOverlay, shotNumber } from "@/lib/drama/schema";
import { totalSeconds } from "@/lib/drama/lint";
import { cn } from "@/lib/utils";
import type { DramaShot } from "@/types/drama";
import type { StepProps } from "./step-props";

/** 06 分镜设计：卡片即分镜，选中后在右侧检查器里改细节。 */
export function StoryboardStep({ sequence, settings, config, patch, go, selectShot, selectedShotId }: StepProps) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState<string | null>(null);
    const total = totalSeconds(sequence);

    const patchShots = (updater: (shots: DramaShot[]) => DramaShot[]) => patch({ shots: updater(sequence.shots) });
    const patchShot = (id: string, part: Partial<DramaShot>) => patchShots((shots) => shots.map((shot) => (shot.id === id ? { ...shot, ...part } : shot)));

    const move = (id: string, offset: number) => {
        const from = sequence.shots.findIndex((shot) => shot.id === id);
        const to = from + offset;
        if (from < 0 || to < 0 || to >= sequence.shots.length) return;
        const next = [...sequence.shots];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        patch({ shots: next.map((shot, index) => ({ ...shot, no: shotNumber(index) })) });
    };

    const duplicate = (shot: DramaShot) => {
        const next = { ...shot, id: `shot-${Date.now()}`, imageRef: undefined, videoRef: undefined, audioRef: undefined, imageVersions: [], videoVersions: [], audioVersions: [], status: "pending" as const };
        const index = sequence.shots.findIndex((item) => item.id === shot.id);
        const shots = [...sequence.shots];
        shots.splice(index + 1, 0, next);
        patch({ shots: shots.map((item, position) => ({ ...item, no: shotNumber(position) })) });
    };

    const remove = (id: string) => {
        patch({ shots: sequence.shots.filter((shot) => shot.id !== id).map((shot, index) => ({ ...shot, no: shotNumber(index) })) });
    };

    const add = () => {
        const shot = createEmptyShot(sequence.shots.length);
        patch({ shots: [...sequence.shots, shot] });
        selectShot(shot.id);
    };

    const polish = async (shot: DramaShot) => {
        setBusy(shot.id);
        try {
            const text = await generateShotDetails({ config, settings, shot, assets: sequence.assets.filter((asset) => shot.assetIds.includes(asset.id)), model: settings.textModel });
            patchShot(shot.id, { prompt: text });
            message.success(`镜 ${shot.no} 描述已补全`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setBusy(null);
        }
    };

    const over = total - sequence.targetSeconds;

    return (
        <StepShell
            title="分镜设计"
            subtitle={`${sequence.shots.length} 镜 · ${total}s / 目标 ${sequence.targetSeconds}s${over > 0 ? ` · 超 ${over}s` : ""}`}
            actions={
                <Button type="primary" icon={<Plus className="size-4" />} onClick={add}>
                    新增镜头
                </Button>
            }
            footer={
                <>
                    <Button onClick={() => go(4)}>上一步</Button>
                    <span className="drama-sub">点卡片选中，右侧改景别 / 机位 / 运镜 / 台词 / 提示词。</span>
                    <Button className="ml-auto" type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(6)} disabled={!sequence.shots.length}>
                        下一步 · 逐镜出图
                    </Button>
                </>
            }
        >
            {sequence.shots.length === 0 ? (
                <Empty description="还没有镜头，先回「剧本拆解」" className="mt-16" />
            ) : (
                <>
                    <div className="drama-budget mb-4">
                        {sequence.shots.map((shot) => (
                            <span
                                key={shot.id}
                                title={`镜 ${shot.no} · ${shot.seconds}s`}
                                onClick={() => selectShot(shot.id)}
                                className={cn("drama-budget__bar", shot.status === "done" ? "is-done" : shot.status === "failed" ? "is-failed" : "")}
                                style={{ flexGrow: shot.seconds }}
                            />
                        ))}
                    </div>

                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                        {sequence.shots.map((shot) => (
                            <article key={shot.id} className={cn("drama-shot-card", selectedShotId === shot.id && "is-active")} onClick={() => selectShot(shot.id)}>
                                <div className="relative aspect-[16/9] overflow-hidden rounded-md" style={{ background: frameGradient(shot.scene || shot.no) }}>
                                    <div className="absolute inset-0" style={{ background: lightOverlay(shot.light) }} />
                                    <span className="absolute left-2 top-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[12px] text-white">镜 {shot.no}</span>
                                    <span className="absolute right-2 top-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[12px] text-white">{shot.seconds}s</span>
                                </div>
                                <Input
                                    variant="borderless"
                                    className="mt-1 px-1"
                                    value={shot.scene}
                                    placeholder="场景"
                                    onChange={(event) => patchShot(shot.id, { scene: event.target.value })}
                                    onClick={(event) => event.stopPropagation()}
                                />
                                <Input.TextArea
                                    variant="borderless"
                                    autoSize={{ minRows: 2, maxRows: 4 }}
                                    className="px-1 text-[13px]"
                                    value={shot.line || shot.prompt}
                                    placeholder="台词 / 画面"
                                    onChange={(event) => patchShot(shot.id, shot.line ? { line: event.target.value } : { prompt: event.target.value })}
                                    onClick={(event) => event.stopPropagation()}
                                />
                                <div className="mt-1 flex items-center gap-1">
                                    <Select size="small" className="w-20" value={shot.size} onChange={(value) => patchShot(shot.id, { size: value })} options={SHOT_SIZES.map((value) => ({ value, label: value }))} onClick={(event) => event.stopPropagation()} />
                                    <Button size="small" type="text" title="上移" onClick={(event) => { event.stopPropagation(); move(shot.id, -1); }}>↑</Button>
                                    <Button size="small" type="text" title="下移" onClick={(event) => { event.stopPropagation(); move(shot.id, 1); }}>↓</Button>
                                    <Button size="small" type="text" title="复制" icon={<Copy className="size-3.5" />} onClick={(event) => { event.stopPropagation(); duplicate(shot); }} />
                                    <Button size="small" type="text" title="AI 补全描述" icon={<Sparkles className="size-3.5" />} loading={busy === shot.id} onClick={(event) => { event.stopPropagation(); void polish(shot); }} />
                                    <Button size="small" type="text" danger title="删除" icon={<Trash2 className="size-3.5" />} onClick={(event) => { event.stopPropagation(); remove(shot.id); }} />
                                </div>
                            </article>
                        ))}
                    </div>
                </>
            )}
        </StepShell>
    );
}
