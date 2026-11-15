import { useState } from "react";
import { App, Button, Input, InputNumber, Select } from "antd";
import { ArrowRight, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";

import { Panel, StepShell } from "../components/step-shell";
import { splitScript } from "@/lib/drama/split";
import { SHOT_MAX_SECONDS, SHOT_MIN_SECONDS, SHOT_MOVES, SHOT_SIZES, shotNumber } from "@/lib/drama/schema";
import { createEmptyShot } from "@/lib/drama/sample";
import { deriveScenes } from "@/lib/drama/workflow";
import type { DramaShot } from "@/types/drama";
import type { StepProps } from "./step-props";

/** 04 剧本拆解：项目 → 场景 → 镜头，可直接改，也可重跑 AI 拆解。 */
export function BreakdownStep({ sequence, settings, config, patch, go, selectShot }: StepProps) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    const [stream, setStream] = useState("");
    const scenes = deriveScenes(sequence);

    const patchShots = (updater: (shots: DramaShot[]) => DramaShot[]) => patch({ shots: updater(sequence.shots) });
    const patchShot = (id: string, part: Partial<DramaShot>) => patchShots((shots) => shots.map((shot) => (shot.id === id ? { ...shot, ...part } : shot)));

    const runSplit = async () => {
        const text = sequence.script?.text?.trim();
        if (!text) {
            message.warning("剧本还是空的，先回「生成剧本」");
            return;
        }
        setBusy(true);
        setStream("");
        try {
            const result = await splitScript({ config, settings, text, assets: sequence.assets, onDelta: setStream });
            patch({ shots: result.shots, assets: result.assets });
            selectShot(result.shots[0]?.id ?? null);
            if (result.error) message.info(`${result.error}，已按段落规则拆分，可手动调整`);
            else message.success(`已拆成 ${result.shots.length} 个镜头`);
        } finally {
            setBusy(false);
            setStream("");
        }
    };

    const addScene = () => {
        const next = createEmptyShot(sequence.shots.length);
        next.scene = `新场景 ${scenes.length + 1}`;
        patchShots((shots) => [...shots, next]);
        selectShot(next.id);
    };

    const removeShot = (id: string) => {
        patch({ shots: sequence.shots.filter((shot) => shot.id !== id).map((shot, index) => ({ ...shot, no: shotNumber(index) })) });
    };

    const renameScene = (from: string, to: string) => {
        patchShots((shots) => shots.map((shot) => (shot.scene === from ? { ...shot, scene: to } : shot)));
    };

    return (
        <StepShell
            title="剧本拆解"
            subtitle={`${scenes.length} 个场景 · ${sequence.shots.length} 个镜头 · ${sequence.assets.length} 个资产`}
            actions={
                <>
                    <Button onClick={addScene} icon={<Plus className="size-4" />}>
                        添加场景
                    </Button>
                    <Button type="primary" icon={busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={busy} onClick={() => void runSplit()}>
                        {sequence.shots.length ? "重新拆解" : "拆解剧本"}
                    </Button>
                </>
            }
            footer={
                <>
                    <Button onClick={() => go(2)}>上一步</Button>
                    <span className="drama-sub ml-auto">拆解结果可手改；人物 / 场景名会作为资产标识，改名前想清楚。</span>
                    <Button type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(4)} disabled={!sequence.shots.length}>
                        下一步 · 资产生成
                    </Button>
                </>
            }
        >
            {sequence.shots.length === 0 ? (
                <div className="drama-empty-block">
                    <p className="text-sm">还没有镜头。点右上角「拆解剧本」，会自动识别场景、人物与对白。</p>
                    <p className="drama-sub mt-1">没配文本模型时会按段落规则拆分，之后再手动修。</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {stream ? <pre className="drama-stream">{stream}</pre> : null}
                    {scenes.map((scene) => (
                        <Panel key={scene.id} title={`场景 ${scene.no}`} hint={`${scene.shots.length} 镜 · ${scene.seconds}s`}>
                            <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                <Input value={scene.name} onChange={(event) => renameScene(scene.name, event.target.value)} />
                                <Input placeholder="地点 / 时间，例如：老城区街口 · 深夜 · 雨" defaultValue={scene.location} onBlur={(event) => {
                                    const next = event.target.value;
                                    patchShots((shots) => shots.map((shot) => (shot.scene === scene.name ? { ...shot, location: next } : shot)));
                                }} />
                                <div className="flex items-center gap-1.5">
                                    {scene.characters.map((name) => (
                                        <span key={name} className="drama-chip">{name}</span>
                                    ))}
                                    {scene.props.map((name) => (
                                        <span key={name} className="drama-chip is-muted">{name}</span>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                {scene.shots.map((shot) => (
                                    <div key={shot.id} className="drama-shot-row" onClick={() => selectShot(shot.id)}>
                                        <span className="w-8 shrink-0 text-[13px] tabular-nums text-stone-400">{shot.no}</span>
                                        <Input variant="borderless" className="min-w-0 flex-1" value={shot.line} placeholder="台词 / 本镜内容" onClick={(event) => event.stopPropagation()} onChange={(event) => patchShot(shot.id, { line: event.target.value })} />
                                        <Select className="w-24 shrink-0" value={shot.size} onChange={(value) => patchShot(shot.id, { size: value })} options={SHOT_SIZES.map((value) => ({ value, label: value }))} onClick={(event) => event.stopPropagation()} />
                                        <Select className="w-24 shrink-0" value={shot.move} onChange={(value) => patchShot(shot.id, { move: value })} options={SHOT_MOVES.map((value) => ({ value, label: value }))} onClick={(event) => event.stopPropagation()} />
                                        <InputNumber className="w-20 shrink-0" min={SHOT_MIN_SECONDS} max={SHOT_MAX_SECONDS} value={shot.seconds} onChange={(value) => typeof value === "number" && patchShot(shot.id, { seconds: value })} onClick={(event) => event.stopPropagation()} />
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-4" />} onClick={(event) => { event.stopPropagation(); removeShot(shot.id); }} />
                                    </div>
                                ))}
                            </div>
                        </Panel>
                    ))}
                </div>
            )}
        </StepShell>
    );
}
