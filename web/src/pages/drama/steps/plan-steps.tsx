import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { ArrowRight, Clapperboard, FileUp, LoaderCircle, Sparkles, Wand2 } from "lucide-react";

import { DramaParamSelect } from "../components/drama-param-select";
import { Panel, StepShell } from "../components/step-shell";
import { generateOutline, generateScript } from "@/lib/drama/ai";
import { frameGradient } from "@/lib/drama/schema";
import { makeScript, readScriptFile, SCRIPT_ACCEPT } from "@/lib/drama/script";
import { SETTING_OPTIONS, episodeCountOf } from "@/lib/drama/settings";
import { DRAMA_TEMPLATES } from "@/lib/drama/templates";
import { audioVoiceOptions } from "@/lib/audio-generation";
import type { DramaAsset, DramaBible, DramaScript } from "@/types/drama";
import type { StepProps } from "./step-props";

const GENRES = ["都市情感", "悬疑推理", "古装权谋", "甜宠逆袭", "科幻未来", "奇幻冒险", "校园青春", "家庭伦理"];
const BIBLE_FIELDS: { key: keyof DramaBible; title: string; placeholder: string }[] = [
    { key: "world", title: "世界观", placeholder: "时代、地域、规则与禁忌。例如：近未来沿海城市，记忆可被交易。" },
    { key: "background", title: "故事背景", placeholder: "故事开始前发生了什么，主角为什么被卷进来。" },
    { key: "relations", title: "人物关系", placeholder: "谁和谁是什么关系，谁在利用谁。" },
    { key: "visual", title: "画面视觉规范", placeholder: "色调、光线、镜头质感、服化道基准。" },
];

function savedLabel(updatedAt: string) {
    const diff = Date.now() - new Date(updatedAt).getTime();
    if (diff < 60_000) return "已自动保存";
    return `已保存 · ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

/** 01 输入灵感：创意、题材、方向、背景、要求与已有文档。 */
export function InspirationStep({ sequence, patch, go }: StepProps) {
    const { message } = App.useApp();
    const script = sequence.script;
    const fileRef = useRef<HTMLInputElement>(null);
    const patchScript = (part: Partial<DramaScript>) => patch({ script: { text: "", source: "none", ...script, ...part } });

    const upload = async (file: File) => {
        try {
            const text = await readScriptFile(file);
            patch({ script: makeScript(text, "upload", { fileName: file.name, premise: script?.premise }) });
            message.success("故事文档已导入，可到「生成剧本」继续改");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导入失败");
        }
        return false;
    };

    return (
        <StepShell
            title="输入灵感"
            subtitle="先把故事说清楚：一句创意、题材、核心方向与创作要求。这些会直接进入剧本提示词。"
            actions={<span className="drama-sub">{savedLabel(sequence.updatedAt)}</span>}
            footer={
                <>
                    <span className="drama-sub">下一步用这些信息写大纲与分集剧本。</span>
                    <Button className="ml-auto" type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(1)} disabled={!script?.premise?.trim()}>
                        下一步 · 生成剧本
                    </Button>
                </>
            }
        >
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-4">
                    <Panel title="故事创意" hint="一句到一段都行">
                        <Input.TextArea
                            autoSize={{ minRows: 5, maxRows: 9 }}
                            value={script?.premise ?? ""}
                            placeholder="例如：雨夜里，她接到一通不该来的电话。电话那头是三天前已经下葬的人。"
                            onChange={(event) => patchScript({ premise: event.target.value })}
                        />
                    </Panel>

                    <Panel title="创作约束" hint="可留空，留空就交给模型发挥">
                        <div className="grid gap-3 md:grid-cols-2">
                            <div>
                                <div className="drama-label">题材</div>
                                <DramaParamSelect
                                    label=""
                                    value={script?.genre?.trim() ? script.genre : "未选择"}
                                    options={["未选择", ...GENRES]}
                                    onChange={(value) => patchScript({ genre: value === "未选择" ? "" : value })}
                                    customPlaceholder="输入题材"
                                />
                            </div>
                            <div>
                                <div className="drama-label">创作要求</div>
                                <Input value={script?.requirement ?? ""} placeholder="例如：每集结尾留钩子，不写血腥画面" onChange={(event) => patchScript({ requirement: event.target.value })} />
                            </div>
                        </div>
                        <div className="mt-3">
                            <div className="drama-label">核心剧情方向</div>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={script?.direction ?? ""} placeholder="故事要往哪里走、转折点是什么" onChange={(event) => patchScript({ direction: event.target.value })} />
                        </div>
                        <div className="mt-3">
                            <div className="drama-label">故事背景</div>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={script?.background ?? ""} placeholder="时代、地点、前史" onChange={(event) => patchScript({ background: event.target.value })} />
                        </div>
                    </Panel>
                </div>

                <div className="space-y-4">
                    <Panel title="从模板开始" hint="填入创意，可继续改">
                        <div className="grid gap-2">
                            {DRAMA_TEMPLATES.map((template) => (
                                <button
                                    key={template.id}
                                    type="button"
                                    className="drama-template"
                                    onClick={() => patchScript({ premise: template.premise, genre: template.title.replace("短剧", "") })}
                                >
                                    <span className="drama-template__cover" style={{ background: frameGradient(template.id) }} />
                                    <span className="min-w-0 flex-1 text-left">
                                        <span className="block text-sm font-medium">{template.title}</span>
                                        <span className="block truncate text-[13px] text-stone-500 dark:text-stone-400">{template.subtitle}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </Panel>

                    <Panel title="已有故事文档" hint=".txt / .md，≤200KB">
                        <input ref={fileRef} type="file" accept={SCRIPT_ACCEPT.join(",")} className="hidden" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
                        <Button block icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>
                            上传文档
                        </Button>
                        <p className="drama-sub mt-2">
                            {script?.source === "upload" && script.fileName ? `已导入：${script.fileName}` : "导入后可在「生成剧本」里直接改，或让 AI 续写。"}
                        </p>
                    </Panel>
                </div>
            </div>
        </StepShell>
    );
}

/** 02 生成剧本：先大纲，再分集剧本；支持续写、上传与自动保存。 */
export function ScriptStep({ sequence, settings, config, patch, go }: StepProps) {
    const { message } = App.useApp();
    const script = sequence.script;
    const [draft, setDraft] = useState(script?.text ?? "");
    const [outline, setOutline] = useState(script?.outline ?? "");
    const [busy, setBusy] = useState<"outline" | "script" | "continue" | null>(null);
    const [stream, setStream] = useState("");
    const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraft(script?.text ?? "");
        setOutline(script?.outline ?? "");
    }, [sequence.id]);

    // 输入后 800ms 落库，切换步骤不会丢内容。
    useEffect(() => {
        if (draft === (script?.text ?? "")) return;
        setSaveState("saving");
        const timer = setTimeout(() => {
            patch({ script: { text: draft, source: script?.source ?? "paste", ...script, outline } });
            setSaveState("saved");
        }, 800);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft]);

    const brief = {
        premise: script?.premise ?? "",
        genre: script?.genre,
        direction: script?.direction,
        background: script?.background,
        requirement: script?.requirement,
        outline,
    };

    const run = async (mode: "outline" | "script" | "continue") => {
        if (!brief.premise.trim()) {
            message.warning("先在「输入灵感」写一句创意");
            return;
        }
        setBusy(mode);
        setStream("");
        try {
            if (mode === "outline") {
                const text = await generateOutline({ config, ...brief, model: settings.textModel, settings, onDelta: setStream });
                setOutline(text);
                patch({ script: { text: draft, source: script?.source ?? "none", ...script, outline: text } });
                message.success("大纲已生成");
            } else {
                const text = await generateScript({
                    config,
                    ...brief,
                    requirement: mode === "continue" ? `在已有剧本之后续写一场戏，不要重复已有内容。已有剧本：\n${draft.slice(-1200)}` : brief.requirement,
                    model: settings.textModel,
                    settings,
                    onDelta: setStream,
                });
                const next = mode === "continue" ? `${draft.trim()}\n\n${text}`.trim() : text;
                setDraft(next);
                patch({ script: { text: next, source: "generated", ...script, outline, premise: brief.premise } });
                setSaveState("saved");
                message.success(mode === "continue" ? "已续写" : "剧本已生成");
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : "生成失败";
            setStream(`生成失败：${reason}`);
            message.error(reason);
        } finally {
            setBusy(null);
        }
    };

    const episodes = episodeCountOf(settings);
    const sceneCount = useMemo(() => script?.text.split(/\n/).filter((line) => /^场景[:：]/.test(line.trim())).length ?? 0, [script?.text]);

    return (
        <StepShell
            title="生成剧本"
            subtitle={`${script?.text.trim().length ?? 0} 字 · ${sceneCount} 场 · 计划 ${episodes} 集 · ${saveState === "saving" ? "保存中…" : savedLabel(sequence.updatedAt)}`}
            actions={
                <>
                    <Button icon={busy === "outline" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={busy !== null} onClick={() => void run("outline")}>
                        生成大纲
                    </Button>
                    <Button type="primary" icon={busy === "script" ? <LoaderCircle className="size-4 animate-spin" /> : <Wand2 className="size-4" />} disabled={busy !== null} onClick={() => void run("script")}>
                        {script?.text.trim() ? "重写剧本" : "生成剧本"}
                    </Button>
                    <Button disabled={busy !== null || !draft.trim()} onClick={() => void run("continue")}>
                        续写
                    </Button>
                </>
            }
            footer={
                <>
                    <Button onClick={() => go(0)}>上一步</Button>
                    <input ref={fileRef} type="file" accept={SCRIPT_ACCEPT.join(",")} className="hidden" onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const text = await readScriptFile(file);
                        setDraft(text);
                        patch({ script: makeScript(text, "upload", { fileName: file.name, outline }) });
                    }} />
                    <Button icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>
                        上传替换
                    </Button>
                    <span className="drama-sub ml-auto">生成与续写都会调用文本模型，消耗额度。</span>
                    <Button type="primary" icon={<ArrowRight className="size-4" />} onClick={() => go(2)} disabled={!draft.trim()}>
                        下一步 · 确认设定
                    </Button>
                </>
            }
        >
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <Panel title="分集剧本" hint="直接编辑，离开自动保存">
                    <Input.TextArea
                        className="drama-script-editor"
                        autoSize={{ minRows: 18, maxRows: 40 }}
                        value={draft}
                        placeholder={"场景：街口 · 雨夜\n林晚撑着伞走过积水，霓虹在雨里晕开。\n「雨下了一整夜。」"}
                        onChange={(event) => setDraft(event.target.value)}
                    />
                    {stream ? <pre className="drama-stream mt-2">{stream}</pre> : null}
                </Panel>

                <div className="space-y-4">
                    <Panel title="故事大纲" hint="产生硬约束">
                        <Input.TextArea autoSize={{ minRows: 10, maxRows: 22 }} value={outline} placeholder="点上方「生成大纲」，或自己写：一句话故事 / 主要人物 / 分集大纲" onChange={(event) => setOutline(event.target.value)} onBlur={() => patch({ script: { text: draft, source: script?.source ?? "none", ...script, outline } })} />
                    </Panel>
                    <Panel title="分集结构" hint={`${episodes} 集 · 每集约 ${sequence.targetSeconds}s`}>
                        <div className="grid grid-cols-2 gap-2">
                            {Array.from({ length: Math.min(episodes, 8) }).map((_, index) => (
                                <div key={index} className="drama-episode">
                                    <span className="text-[12px] text-stone-400">第 {index + 1} 集</span>
                                    <span className="text-[13px]">{index === 0 ? "当前编辑" : "待拆解"}</span>
                                </div>
                            ))}
                        </div>
                        {episodes > 8 ? <p className="drama-sub mt-2">还有 {episodes - 8} 集，拆解后逐集展开。</p> : null}
                    </Panel>
                </div>
            </div>
        </StepShell>
    );
}

/** 03 确认设定：世界观、人物、视觉规范与生成参数。 */
export function SettingsStep({ sequence, settings, patch, patchSetting, go }: StepProps) {
    const bible: DramaBible = sequence.bible ?? { world: "", background: "", relations: "", visual: "" };
    const patchBible = (part: Partial<DramaBible>) => patch({ bible: { ...bible, ...part } });
    const characters = sequence.assets.filter((asset) => asset.kind === "character");
    const scenes = sequence.assets.filter((asset) => asset.kind === "scene");
    const items = sequence.assets.filter((asset) => asset.kind === "prop" || asset.kind === "costume" || asset.kind === "effect");
    const patchVoice = (name: string, voice: string) => patch({ voices: { ...(sequence.voices ?? {}), [name]: voice } });
    const patchAsset = (id: string, part: Partial<DramaAsset>) => patch({ assets: sequence.assets.map((asset) => (asset.id === id ? { ...asset, ...part } : asset)) });

    return (
        <StepShell
            title="确认设定"
            subtitle="世界观、人物与视觉规范会写进后续所有提示词；人物名是跨镜头的唯一标识，不要随意改。"
            actions={<span className="drama-sub">{savedLabel(sequence.updatedAt)}</span>}
            footer={
                <>
                    <Button onClick={() => go(1)}>上一步</Button>
                    <span className="drama-sub ml-auto">
                        人物 {characters.length} · 场景 {scenes.length} · 服装道具 {items.length}
                    </span>
                    <Button type="primary" icon={<Clapperboard className="size-4" />} onClick={() => go(3)}>
                        确认设定 · 拆解剧本
                    </Button>
                </>
            }
        >
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        {BIBLE_FIELDS.map((field) => (
                            <Panel key={field.key} title={field.title}>
                                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} value={bible[field.key]} placeholder={field.placeholder} onChange={(event) => patchBible({ [field.key]: event.target.value })} />
                            </Panel>
                        ))}
                    </div>

                    <Panel title="人物设定" hint="同名人物在拆镜、出图、配音里共用这一条">
                        {characters.length === 0 ? (
                            <p className="drama-empty">还没有人物。剧本拆解后会自动生成，也可以点右侧「新建」。</p>
                        ) : (
                            <div className="space-y-2">
                                {characters.map((asset) => (
                                    <div key={asset.id} className="grid items-center gap-2 rounded-lg border border-[var(--studio-border-soft)] p-2 md:grid-cols-[120px_minmax(0,1fr)_140px]">
                                        <Input value={asset.name} onChange={(event) => patchAsset(asset.id, { name: event.target.value })} />
                                        <Input value={asset.description} placeholder="身份 / 性格 / 外观 / 服装" onChange={(event) => patchAsset(asset.id, { description: event.target.value })} />
                                        <Select
                                            value={sequence.voices?.[asset.id] ?? ""}
                                            onChange={(value) => patchVoice(asset.id, value)}
                                            options={[{ value: "", label: "音色：自动" }, ...audioVoiceOptions.map((item) => ({ value: item.value, label: `音色：${item.label}` }))]}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>

                <Panel title="视觉与生成参数" hint="与画布共用渠道">
                    <div className="grid grid-cols-2 gap-3">
                        <DramaParamSelect label="风格" value={settings.style} options={SETTING_OPTIONS.style} onChange={(value) => patchSetting("style", value)} customPlaceholder="输入风格或提示词前缀" />
                        <DramaParamSelect label="比例" value={settings.ratio} options={SETTING_OPTIONS.ratio} onChange={(value) => patchSetting("ratio", value)} customPlaceholder="输入比例，如 2:3" />
                        <DramaParamSelect label="集数" value={settings.episodes} options={SETTING_OPTIONS.episodes} onChange={(value) => patchSetting("episodes", value)} customPlaceholder="输入集数，如 12" />
                        <DramaParamSelect label="目标时长" value={settings.targetDuration} options={SETTING_OPTIONS.targetDuration} onChange={(value) => patchSetting("targetDuration", value)} customPlaceholder="输入秒数，如 75" />
                        <DramaParamSelect label="单镜时长" value={settings.shotDuration} options={SETTING_OPTIONS.shotDuration} onChange={(value) => patchSetting("shotDuration", value)} customPlaceholder="输入 4–15 之间的秒数" />
                        <DramaParamSelect label="选角" value={settings.casting} options={SETTING_OPTIONS.casting} onChange={(value) => patchSetting("casting", value)} customPlaceholder="输入选角方式" />
                    </div>
                    <p className="drama-sub mt-3">全剧 {episodeCountOf(settings)} 集 · 单集目标 {sequence.targetSeconds}s · 每个下拉都可「+ 自定义…」</p>
                </Panel>
            </div>
        </StepShell>
    );
}
