import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { App, Button, InputNumber, Select } from "antd";
import { Clapperboard, Plus, Trash2 } from "lucide-react";

import { AssetStep } from "./components/asset-step";
import { DramaParamSelect } from "./components/drama-param-select";
import { Inspector } from "./components/inspector";
import { TaskBar } from "./components/task-bar";
import { WorkflowNav } from "./components/workflow-nav";
import { BreakdownStep } from "./steps/breakdown-step";
import { ComposeStep } from "./steps/compose-step";
import { ImageStep } from "./steps/image-step";
import { InspirationStep, ScriptStep, SettingsStep } from "./steps/plan-steps";
import { StoryboardStep } from "./steps/storyboard-step";
import { VideoStep } from "./steps/video-step";
import { VoiceStep } from "./steps/voice-step";
import { makeScript } from "@/lib/drama/script";
import { DEFAULT_DRAMA_SETTINGS, targetSecondsOf } from "@/lib/drama/settings";
import { DRAMA_TEMPLATES } from "@/lib/drama/templates";
import { DRAMA_STEPS, stepStates } from "@/lib/drama/workflow";
import { allChannels, decodeChannelModel, modelOptionName, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { useDramaStore } from "@/stores/use-drama-store";
import { lintSequence, totalSeconds } from "@/lib/drama/lint";
import type { DramaAsset, DramaSequence, DramaSettings } from "@/types/drama";
import "./drama.css";

const API_FORMAT_LABEL: Record<string, string> = {
    openai: "OpenAI 兼容",
    gemini: "Gemini 兼容",
    doubao: "豆包",
    ark: "火山方舟",
};

function channelFormatLabel(apiFormat: string) {
    return API_FORMAT_LABEL[apiFormat.toLowerCase()] ?? apiFormat;
}

function savedLabel(updatedAt: string) {
    return `已保存 · ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function DramaPage() {
    const { modal, message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const hydrated = useDramaStore((state) => state.hydrated);
    const sequences = useDramaStore((state) => state.sequences);
    const createSequence = useDramaStore((state) => state.createSequence);
    const updateSequence = useDramaStore((state) => state.updateSequence);
    const deleteSequence = useDramaStore((state) => state.deleteSequence);
    const config = useConfigStore((state) => state.config);

    const requestedStep = Number(searchParams.get("step"));
    const [activeId, setActiveId] = useState<string | null>(searchParams.get("sequence"));
    const [step, setStep] = useState(Number.isInteger(requestedStep) && requestedStep >= 0 && requestedStep < DRAMA_STEPS.length ? requestedStep : 0);
    const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [navCollapsed, setNavCollapsed] = useState(false);
    const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
    const [taskCollapsed, setTaskCollapsed] = useState(true);
    const seededRef = useRef(false);
    const templateHandledRef = useRef<string | null>(null);
    const templateId = searchParams.get("template");

    // 首页模板创建真实序列；深链仍进入对应步骤。
    useEffect(() => {
        if (!hydrated) return;
        if (templateId) {
            const template = DRAMA_TEMPLATES.find((item) => item.id === templateId);
            if (!template || templateHandledRef.current === templateId) return;
            templateHandledRef.current = templateId;
            const id = createSequence(template.title);
            updateSequence(id, {
                script: makeScript(template.premise, "paste", { premise: template.premise }),
                settings: { ...DEFAULT_DRAMA_SETTINGS, style: template.style },
            });
            setActiveId(id);
            setStep(0);
            setSearchParams({ sequence: id, step: "0" }, { replace: true });
            return;
        }
        if (sequences.length === 0) {
            if (seededRef.current) return;
            seededRef.current = true;
            setActiveId(createSequence("第 1 集", { sample: true }));
            return;
        }
        if (!activeId || !sequences.some((item) => item.id === activeId)) setActiveId(sequences[0].id);
    }, [hydrated, sequences, activeId, createSequence, templateId, updateSequence, setSearchParams]);

    const sequence = useMemo(() => sequences.find((item) => item.id === activeId) ?? null, [sequences, activeId]);
    const settings = useMemo<DramaSettings>(() => ({ ...DEFAULT_DRAMA_SETTINGS, ...(sequence?.settings ?? {}) }), [sequence?.settings]);
    const states = useMemo(() => stepStates(sequence), [sequence]);
    const shot = useMemo(() => sequence?.shots.find((item) => item.id === selectedShotId) ?? null, [sequence, selectedShotId]);
    const asset = useMemo(() => sequence?.assets.find((item) => item.id === selectedAssetId) ?? null, [sequence, selectedAssetId]);
    const issues = useMemo(() => (sequence ? lintSequence(sequence) : []), [sequence]);

    const modelGroups = useMemo(() => {
        const values = selectableModelsByCapability(config, "text");
        const groups = allChannels(config)
            .map((channel) => ({
                label: `${channel.name} · ${channelFormatLabel(channel.apiFormat)}`,
                options: values.filter((value) => decodeChannelModel(value)?.channelId === channel.id).map((value) => ({ value, label: modelOptionName(value) })),
            }))
            .filter((group) => group.options.length > 0);
        return [{ label: "默认", options: [{ value: "", label: "自动（跟随画布默认）" }] }, ...groups];
    }, [config]);

    const patch = (part: Parameters<typeof updateSequence>[1]) => {
        if (sequence) updateSequence(sequence.id, part);
    };

    const patchSetting = (key: keyof DramaSettings, rawValue: string) => {
        if (!sequence) return;
        let value = rawValue;
        if ((key === "shotDuration" || key === "videoSeconds") && value !== "自动") {
            const seconds = Number(value.match(/\d+/)?.[0] ?? 5);
            if (seconds < 4 || seconds > 15) {
                message.warning("单镜时长需在 4–15s 之间，已按边界值处理");
                value = `${Math.min(15, Math.max(4, seconds))}s`;
            }
        }
        const next: DramaSettings = { ...settings, [key]: value };
        updateSequence(sequence.id, key === "targetDuration" ? { settings: next, targetSeconds: targetSecondsOf(next) } : { settings: next });
    };

    const go = (next: number) => {
        setStep(Math.max(0, Math.min(DRAMA_STEPS.length - 1, next)));
        if (sequence) setSearchParams({ sequence: sequence.id, step: String(next) }, { replace: true });
    };

    const selectShot = (id: string | null) => {
        setSelectedShotId(id);
        if (id) setSelectedAssetId(null);
    };
    const selectAsset = (id: string | null) => {
        setSelectedAssetId(id);
        if (id) setSelectedShotId(null);
    };

    const handleDelete = () => {
        if (!sequence) return;
        modal.confirm({
            title: `删除「${sequence.title}」？`,
            content: "这一集的剧本、镜头、资产与生成记录会一起删掉，不可恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                deleteSequence(sequence.id);
                setActiveId(null);
                setSelectedShotId(null);
                setSelectedAssetId(null);
            },
        });
    };

    if (!hydrated) {
        return <div className="grid h-full place-items-center text-sm text-stone-400">正在读取本地项目…</div>;
    }

    if (!sequence) {
        return (
            <div className="grid h-full place-items-center gap-3">
                <p className="text-sm text-stone-500">还没有短剧项目</p>
                <Button type="primary" onClick={() => setActiveId(createSequence("第 1 集"))}>
                    新建一集
                </Button>
            </div>
        );
    }

    const total = totalSeconds(sequence);
    const stepProps = {
        sequence,
        settings,
        config,
        patch,
        patchSetting,
        go,
        selectShot,
        selectedShotId,
        selectAsset,
        selectedAssetId,
    };
    const patchShot = (id: string, part: Partial<DramaSequence["shots"][number]>) =>
        patch({ shots: sequence.shots.map((item) => (item.id === id ? { ...item, ...part } : item)) });
    const patchAsset = (id: string, part: Partial<DramaAsset>) => patch({ assets: sequence.assets.map((item) => (item.id === id ? { ...item, ...part } : item)) });

    const body = (() => {
        switch (step) {
            case 0:
                return <InspirationStep {...stepProps} />;
            case 1:
                return <ScriptStep {...stepProps} />;
            case 2:
                return <SettingsStep {...stepProps} />;
            case 3:
                return <BreakdownStep {...stepProps} />;
            case 4:
                return <AssetStep {...stepProps} />;
            case 5:
                return <StoryboardStep {...stepProps} />;
            case 6:
                return <ImageStep {...stepProps} />;
            case 7:
                return <VoiceStep {...stepProps} />;
            case 8:
                return <VideoStep {...stepProps} />;
            default:
                return <ComposeStep {...stepProps} />;
        }
    })();

    const pending = issues.filter((issue) => issue.level === "error" || issue.level === "warning").length;

    return (
        <div className="drama-shell">
            <header className="drama-topbar">
                <Clapperboard className="size-5 shrink-0 text-[rgb(var(--studio-violet))]" />
                <h1 className="drama-title">短剧工坊</h1>
                <Select
                    className="ml-2 min-w-40"
                    value={sequence.id}
                    onChange={(value) => {
                        setActiveId(value);
                        setSelectedShotId(null);
                        setSelectedAssetId(null);
                    }}
                    options={sequences.map((item) => ({ value: item.id, label: item.title }))}
                />
                <Button type="text" icon={<Plus className="size-4" />} onClick={() => setActiveId(createSequence(`第 ${sequences.length + 1} 集`))}>
                    新建一集
                </Button>
                <Button type="text" icon={<Trash2 className="size-4" />} onClick={handleDelete}>
                    删除
                </Button>

                <div className="ml-auto flex flex-wrap items-center gap-3">
                    <div className="w-56">
                        <DramaParamSelect label="分析模型" value={settings.textModel} groups={modelGroups} onChange={(value) => patchSetting("textModel", value)} customPlaceholder="输入模型名" />
                    </div>
                    <label className="flex items-center gap-2 text-[13px] text-stone-500 dark:text-stone-400">
                        目标时长
                        <InputNumber className="w-24" min={10} max={600} value={sequence.targetSeconds} onChange={(value) => typeof value === "number" && patchSetting("targetDuration", `${value}s`)} />
                        秒
                    </label>
                    <span className="text-[13px] text-stone-500 dark:text-stone-400">
                        <span className={total > sequence.targetSeconds ? "text-red-600 dark:text-red-400" : ""}>{total}s</span> / {sequence.targetSeconds}s
                    </span>
                    <span className="hidden text-[13px] text-stone-400 xl:inline">{savedLabel(sequence.updatedAt)}</span>
                    <span className="hidden text-[13px] text-stone-400 xl:inline">{pending ? `${pending} 项待处理` : "检查通过"}</span>
                </div>
            </header>

            <div className="drama-body">
                <WorkflowNav step={step} states={states} collapsed={navCollapsed} onStep={go} onToggleCollapsed={() => setNavCollapsed((value) => !value)} />
                <main className="drama-main">{body}</main>
                <Inspector
                    sequence={sequence}
                    shot={shot}
                    asset={asset}
                    collapsed={inspectorCollapsed}
                    onToggle={() => setInspectorCollapsed((value) => !value)}
                    onPatchShot={patchShot}
                    onPatchAsset={patchAsset}
                    onSelectShot={(id) => selectShot(id)}
                    onClearAsset={() => selectAsset(null)}
                    onJumpStep={go}
                />
            </div>

            <TaskBar sequence={sequence} collapsed={taskCollapsed} onToggle={() => setTaskCollapsed((value) => !value)} onJumpStep={go} onSelectShot={selectShot} />
        </div>
    );
}
