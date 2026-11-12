import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, InputNumber, Select } from "antd";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Info, Plus, Trash2 } from "lucide-react";

import { lintSequence, totalSeconds, type DramaIssue } from "@/lib/drama/lint";
import { createEmptyShot } from "@/lib/drama/sample";
import {
    ASSET_KIND_LABEL,
    LIGHT_LABEL,
    SHOT_MAX_SECONDS,
    SHOT_MIN_SECONDS,
    SHOT_MOVES,
    SHOT_SIZES,
    SHOT_STATUS_LABEL,
    SHOT_STATUS_TONE,
    frameGradient,
    lightOverlay,
    shotNumber,
} from "@/lib/drama/schema";
import { useDramaStore } from "@/stores/use-drama-store";
import { cn } from "@/lib/utils";
import type { DramaLight, DramaShot, DramaShotStatus } from "@/types/drama";

const LEVEL_TONE: Record<DramaIssue["level"], string> = {
    error: "text-red-600 dark:text-red-400",
    warning: "text-amber-600 dark:text-amber-400",
    info: "text-stone-500 dark:text-stone-400",
    ok: "text-emerald-600 dark:text-emerald-400",
};

function IssueIcon({ level }: { level: DramaIssue["level"] }) {
    const className = "mt-0.5 size-3.5 shrink-0";
    if (level === "ok") return <CheckCircle2 className={cn(className, LEVEL_TONE.ok)} />;
    if (level === "error" || level === "warning") return <AlertTriangle className={cn(className, LEVEL_TONE[level])} />;
    return <Info className={cn(className, LEVEL_TONE.info)} />;
}

export default function DramaPage() {
    const { modal } = App.useApp();
    const hydrated = useDramaStore((state) => state.hydrated);
    const sequences = useDramaStore((state) => state.sequences);
    const createSequence = useDramaStore((state) => state.createSequence);
    const updateSequence = useDramaStore((state) => state.updateSequence);
    const deleteSequence = useDramaStore((state) => state.deleteSequence);

    const [activeId, setActiveId] = useState<string | null>(null);
    const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
    const seededRef = useRef(false);

    // 第一次进来还没有任何序列时，给一份示例内容；用户自己删空后就停在空状态，不再自动补。
    useEffect(() => {
        if (!hydrated) return;
        if (sequences.length === 0) {
            if (seededRef.current) return;
            seededRef.current = true;
            setActiveId(createSequence("第 1 集", { sample: true }));
            return;
        }
        if (!activeId || !sequences.some((item) => item.id === activeId)) setActiveId(sequences[0].id);
    }, [hydrated, sequences, activeId, createSequence]);

    const sequence = useMemo(() => sequences.find((item) => item.id === activeId) ?? null, [sequences, activeId]);
    const shot = useMemo(() => sequence?.shots.find((item) => item.id === selectedShotId) ?? sequence?.shots[0] ?? null, [sequence, selectedShotId]);
    const total = sequence ? totalSeconds(sequence) : 0;
    const issues = useMemo(() => (sequence ? lintSequence(sequence) : []), [sequence]);
    const pendingIssues = issues.filter((issue) => issue.level === "error" || issue.level === "warning").length;

    const patchShots = (updater: (shots: DramaShot[]) => DramaShot[]) => {
        if (!sequence) return;
        updateSequence(sequence.id, { shots: updater(sequence.shots) });
    };

    const patchShot = (shotId: string, patch: Partial<DramaShot>) => {
        patchShots((shots) => shots.map((item) => (item.id === shotId ? { ...item, ...patch } : item)));
    };

    const addShot = () => {
        if (!sequence) return;
        const next = createEmptyShot(sequence.shots.length);
        patchShots((shots) => [...shots, next]);
        setSelectedShotId(next.id);
    };

    const removeShot = (shotId: string) => {
        if (!sequence) return;
        const rest = sequence.shots.filter((item) => item.id !== shotId).map((item, index) => ({ ...item, no: shotNumber(index) }));
        updateSequence(sequence.id, { shots: rest });
        setSelectedShotId(rest[0]?.id ?? null);
    };

    const moveShot = (shotId: string, offset: number) => {
        if (!sequence) return;
        const from = sequence.shots.findIndex((item) => item.id === shotId);
        const to = from + offset;
        if (from < 0 || to < 0 || to >= sequence.shots.length) return;
        const next = [...sequence.shots];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        patchShots(() => next.map((item, index) => ({ ...item, no: shotNumber(index) })));
    };

    const toggleAsset = (assetId: string) => {
        if (!shot) return;
        const has = shot.assetIds.includes(assetId);
        patchShot(shot.id, { assetIds: has ? shot.assetIds.filter((id) => id !== assetId) : [...shot.assetIds, assetId] });
    };

    const addAsset = () => {
        if (!sequence) return;
        updateSequence(sequence.id, {
            assets: [...sequence.assets, { id: `${Date.now()}`, name: `新角色 ${sequence.assets.length + 1}`, kind: "character", description: "", refs: [] }],
        });
    };

    const handleDeleteSequence = () => {
        if (!sequence) return;
        modal.confirm({
            title: `删除「${sequence.title}」？`,
            content: "这一集的镜头和资产会一起删掉，不可恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                deleteSequence(sequence.id);
                setActiveId(null);
                setSelectedShotId(null);
            },
        });
    };

    if (!hydrated) {
        return <div className="flex h-full items-center justify-center bg-background text-sm text-stone-400">正在读取本地数据…</div>;
    }

    if (!sequence) {
        return (
            <div className="flex h-full items-center justify-center bg-background">
                <Button onClick={() => setActiveId(createSequence("第 1 集"))}>新建一集</Button>
            </div>
        );
    }

    const over = total - sequence.targetSeconds;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <header className="flex h-14 shrink-0 items-center gap-2 px-4">
                <Select
                    size="small"
                    value={sequence.id}
                    className="min-w-40"
                    onChange={(value) => {
                        setActiveId(value);
                        setSelectedShotId(null);
                    }}
                    options={sequences.map((item) => ({ value: item.id, label: item.title }))}
                />
                <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={() => setActiveId(createSequence(`第 ${sequences.length + 1} 集`))}>
                    新建一集
                </Button>
                <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} onClick={handleDeleteSequence}>
                    删除
                </Button>
                <div className="ml-auto flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                    <span>目标时长</span>
                    <InputNumber
                        size="small"
                        min={10}
                        max={600}
                        value={sequence.targetSeconds}
                        className="w-20"
                        onChange={(value) => {
                            if (typeof value === "number") updateSequence(sequence.id, { targetSeconds: value });
                        }}
                    />
                    <span>秒</span>
                    <span className={cn("ml-2 font-medium tabular-nums", over > 0 ? "text-red-600 dark:text-red-400" : "text-stone-700 dark:text-stone-200")}>
                        {total}s
                    </span>
                </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)_320px] gap-3 px-3 pb-3">
                <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white dark:bg-stone-950">
                    <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                        <span className="text-xs font-medium">镜头</span>
                        <span className="text-xs text-stone-400">
                            {sequence.shots.length} 个 · {sequence.assets.length} 个资产
                        </span>
                        <Button className="ml-auto" size="small" type="text" icon={<Plus className="size-3.5" />} onClick={addShot}>
                            加镜头
                        </Button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-2">
                        {sequence.shots.length === 0 ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有镜头" className="mt-10" />
                        ) : (
                            sequence.shots.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setSelectedShotId(item.id)}
                                    className={cn(
                                        "mb-1 flex w-full gap-2.5 rounded-lg p-2 text-left transition-colors",
                                        item.id === shot?.id ? "bg-stone-100 dark:bg-stone-800" : "hover:bg-stone-50 dark:hover:bg-stone-900",
                                    )}
                                >
                                    <div className="relative h-[74px] w-[42px] shrink-0 overflow-hidden rounded-md" style={{ background: frameGradient(item.scene || item.no) }}>
                                        <div className="pointer-events-none absolute inset-0" style={{ background: lightOverlay(item.light) }} />
                                        <span className="absolute left-1 top-0.5 text-[10px] tracking-wide text-white/90">{item.no}</span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs text-stone-500 dark:text-stone-400">
                                            {item.size} · {item.move}
                                        </div>
                                        <div className={cn("mt-0.5 line-clamp-2 text-[13px] leading-5", !item.line.trim() && "text-stone-400 dark:text-stone-500")}>
                                            {item.line.trim() || "无台词"}
                                        </div>
                                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-stone-400">
                                            <span className={cn("size-1.5 rounded-full", SHOT_STATUS_TONE[item.status])} />
                                            <span>{SHOT_STATUS_LABEL[item.status]}</span>
                                            <span className="ml-auto tabular-nums">{item.seconds}s</span>
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>

                    <div className="shrink-0 border-t border-stone-100 px-3 py-2.5 dark:border-stone-900">
                        <div className="mb-1.5 flex items-baseline gap-1.5 text-[11px]">
                            <span className="text-stone-400">预算</span>
                            <span className="tabular-nums text-stone-700 dark:text-stone-200">{total}s</span>
                            <span className="text-stone-400">/ {sequence.targetSeconds}s</span>
                            <span className={cn("ml-auto", over > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                                {over > 0 ? `超 ${over}s` : over === 0 ? "刚好" : `余 ${-over}s`}
                            </span>
                        </div>
                        <div className="relative flex h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                            {sequence.shots.map((item) => (
                                <span
                                    key={item.id}
                                    title={`镜 ${item.no} · ${item.seconds}s`}
                                    onClick={() => setSelectedShotId(item.id)}
                                    className={cn(
                                        "cursor-pointer border-r border-white dark:border-stone-950",
                                        item.status === "done" ? "bg-indigo-400" : item.status === "running" ? "bg-amber-400" : "bg-stone-300 dark:bg-stone-600",
                                    )}
                                    style={{ flexGrow: item.seconds }}
                                />
                            ))}
                            <span
                                className="absolute inset-y-0 w-px bg-red-500"
                                style={{ left: `${Math.min(100, (sequence.targetSeconds / Math.max(total, sequence.targetSeconds)) * 100)}%` }}
                            />
                        </div>
                    </div>
                </aside>

                <section className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white dark:bg-stone-950">
                    <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                        <span className="text-xs font-medium">{shot ? `镜 ${shot.no}` : "未选中镜头"}</span>
                        {shot ? (
                            <span className="text-xs text-stone-400">
                                {shot.scene || "未填场景"} · {shot.seconds}s
                            </span>
                        ) : null}
                        {shot ? (
                            <div className="ml-auto flex items-center gap-0.5">
                                <Button size="small" type="text" icon={<ArrowUp className="size-3.5" />} onClick={() => moveShot(shot.id, -1)} />
                                <Button size="small" type="text" icon={<ArrowDown className="size-3.5" />} onClick={() => moveShot(shot.id, 1)} />
                                <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => removeShot(shot.id)} />
                            </div>
                        ) : null}
                    </div>

                    {shot ? (
                        <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] p-4 [background-size:18px_18px] dark:bg-[radial-gradient(rgba(245,245,244,.10)_1px,transparent_1px)]">
                            <div className="flex justify-center gap-4">
                                <div className="w-[236px] shrink-0">
                                    <div className="relative aspect-[9/16] overflow-hidden rounded-lg" style={{ background: frameGradient(shot.scene || shot.no) }}>
                                        <div className="pointer-events-none absolute inset-0" style={{ background: lightOverlay(shot.light) }} />
                                        <div className="absolute inset-3 rounded-sm border border-dashed border-white/25" />
                                        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/35 to-transparent" />
                                        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/45 to-transparent" />
                                        <span className="absolute left-3 top-2.5 text-[11px] tracking-widest text-white/90">镜 {shot.no}</span>
                                        <span className="absolute right-2.5 top-2.5 rounded bg-black/45 px-1.5 py-0.5 text-[10px] text-white/85">{SHOT_STATUS_LABEL[shot.status]}</span>
                                        <div className="absolute inset-x-3 bottom-2.5 flex items-end justify-between">
                                            <span className="text-xs text-white/95">{shot.scene || "未填场景"}</span>
                                            <span className="text-[10px] tracking-wide text-white/70">
                                                {shot.size} · {shot.move}
                                            </span>
                                        </div>
                                        {shot.status === "running" ? (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white">
                                                <span className="text-xs">生成中 {shot.progress ?? 0}%</span>
                                                <span className="h-0.5 w-24 overflow-hidden rounded-full bg-white/25">
                                                    <span className="block h-full bg-white" style={{ width: `${shot.progress ?? 0}%` }} />
                                                </span>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="w-[228px] shrink-0 space-y-3">
                                    <div className="rounded-lg border border-stone-100 p-3 dark:border-stone-900">
                                        <div className="mb-1 text-[11px] tracking-widest text-stone-400">镜头</div>
                                        <label className="flex items-center gap-2 py-1 text-xs">
                                            <span className="w-9 text-stone-500 dark:text-stone-400">场景</span>
                                            <Input size="small" value={shot.scene} placeholder="街口 · 雨夜" onChange={(event) => patchShot(shot.id, { scene: event.target.value })} />
                                        </label>
                                        <label className="flex items-center gap-2 py-1 text-xs">
                                            <span className="w-9 text-stone-500 dark:text-stone-400">景别</span>
                                            <Select size="small" className="flex-1" value={shot.size} onChange={(value) => patchShot(shot.id, { size: value })} options={SHOT_SIZES.map((value) => ({ value, label: value }))} />
                                        </label>
                                        <label className="flex items-center gap-2 py-1 text-xs">
                                            <span className="w-9 text-stone-500 dark:text-stone-400">运镜</span>
                                            <Select size="small" className="flex-1" value={shot.move} onChange={(value) => patchShot(shot.id, { move: value })} options={SHOT_MOVES.map((value) => ({ value, label: value }))} />
                                        </label>
                                        <label className="flex items-center gap-2 py-1 text-xs">
                                            <span className="w-9 text-stone-500 dark:text-stone-400">光位</span>
                                            <Select
                                                size="small"
                                                className="flex-1"
                                                value={shot.light}
                                                onChange={(value) => patchShot(shot.id, { light: value as DramaLight })}
                                                options={(Object.keys(LIGHT_LABEL) as DramaLight[]).map((value) => ({ value, label: LIGHT_LABEL[value] }))}
                                            />
                                        </label>
                                        <label className="flex items-center gap-2 py-1 text-xs">
                                            <span className="w-9 text-stone-500 dark:text-stone-400">时长</span>
                                            <InputNumber
                                                size="small"
                                                className="w-20"
                                                min={SHOT_MIN_SECONDS}
                                                max={SHOT_MAX_SECONDS}
                                                value={shot.seconds}
                                                onChange={(value) => {
                                                    if (typeof value === "number") patchShot(shot.id, { seconds: value });
                                                }}
                                            />
                                            <span className="whitespace-nowrap text-[10px] text-stone-400">秒 · {SHOT_MIN_SECONDS}–{SHOT_MAX_SECONDS}</span>
                                        </label>
                                        <label className="flex items-center gap-2 py-1 text-xs">
                                            <span className="w-9 text-stone-500 dark:text-stone-400">状态</span>
                                            <Select
                                                size="small"
                                                className="flex-1"
                                                value={shot.status}
                                                onChange={(value: DramaShotStatus) => patchShot(shot.id, { status: value, progress: value === "running" ? (shot.progress ?? 0) : undefined })}
                                                options={(Object.keys(SHOT_STATUS_LABEL) as DramaShotStatus[]).map((value) => ({ value, label: SHOT_STATUS_LABEL[value] }))}
                                            />
                                        </label>
                                    </div>

                                    <div className="rounded-lg border border-stone-100 p-3 dark:border-stone-900">
                                        <div className="mb-1.5 text-[11px] tracking-widest text-stone-400">台词</div>
                                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={shot.line} placeholder="无台词可留空" onChange={(event) => patchShot(shot.id, { line: event.target.value })} />
                                    </div>

                                    <div className="rounded-lg border border-stone-100 p-3 dark:border-stone-900">
                                        <div className="mb-1.5 text-[11px] tracking-widest text-stone-400">参考资产</div>
                                        {sequence.assets.length === 0 ? (
                                            <div className="text-xs text-stone-400">右侧先建一个角色，跨镜头才能对齐脸型。</div>
                                        ) : (
                                            <div className="flex flex-wrap gap-1.5">
                                                {sequence.assets.map((asset) => {
                                                    const active = shot.assetIds.includes(asset.id);
                                                    return (
                                                        <button
                                                            key={asset.id}
                                                            type="button"
                                                            onClick={() => toggleAsset(asset.id)}
                                                            className={cn(
                                                                "rounded-md border px-2 py-1 text-[11px] transition-colors",
                                                                active
                                                                    ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                                                                    : "border-stone-200 text-stone-500 hover:border-stone-300 dark:border-stone-800 dark:text-stone-400",
                                                            )}
                                                        >
                                                            {asset.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <p className="mx-auto mt-4 max-w-[520px] text-center text-[11px] leading-5 text-stone-400">
                                本轮只落了数据模型与分镜表视图：时长、光位、台词、资产引用都可以直接改，检查器会实时跟着变。生成、时间轴、自由画布投影后续接入。
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-1 items-center justify-center">
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="加一个镜头开始" />
                        </div>
                    )}
                </section>

                <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white dark:bg-stone-950">
                    <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                        <span className="text-xs font-medium">资产</span>
                        <span className="text-xs text-stone-400">{sequence.assets.length}</span>
                        <Button className="ml-auto" size="small" type="text" icon={<Plus className="size-3.5" />} onClick={addAsset}>
                            新建
                        </Button>
                    </div>
                    <div className="shrink-0 px-2 pb-1">
                        {sequence.assets.map((asset) => (
                            <div key={asset.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                                <div className="h-9 w-7 shrink-0 rounded" style={{ background: frameGradient(asset.name) }} />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs">{asset.name}</div>
                                    <div className="text-[10px] text-stone-400">{ASSET_KIND_LABEL[asset.kind]}</div>
                                </div>
                                <span className="text-[10px] text-stone-400">
                                    {sequence.shots.filter((item) => item.assetIds.includes(asset.id)).length} 镜
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                        <span className="text-xs font-medium">检查器</span>
                        <span className={cn("text-xs", pendingIssues > 0 ? "text-amber-600 dark:text-amber-400" : "text-stone-400")}>{pendingIssues > 0 ? `${pendingIssues} 待处理` : "全部通过"}</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                        {issues.map((issue) => (
                            <button
                                key={issue.id}
                                type="button"
                                onClick={() => issue.shotId && setSelectedShotId(issue.shotId)}
                                className={cn(
                                    "mb-0.5 flex w-full gap-2 rounded-lg px-1.5 py-2 text-left transition-colors",
                                    issue.shotId ? "hover:bg-stone-50 dark:hover:bg-stone-900" : "cursor-default",
                                )}
                            >
                                <IssueIcon level={issue.level} />
                                <div className="min-w-0">
                                    <div className="text-xs leading-5">{issue.title}</div>
                                    {issue.detail ? <div className="text-[10px] leading-4 text-stone-400">{issue.detail}</div> : null}
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>
            </div>
        </div>
    );
}
