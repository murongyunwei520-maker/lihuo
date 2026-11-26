import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { ArrowRight, CircleAlert, Clapperboard, FileUp, LoaderCircle, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { nanoid } from "nanoid";

import { DramaParamSelect } from "../components/drama-param-select";
import { Panel, StepShell } from "../components/step-shell";
import { generateOutline, generateScript } from "@/lib/drama/ai";
import { aiBibleDraft, bibleHashOf, bibleReady, bibleState, EMPTY_BIBLE, mergeBibleDraft, ruleBibleDraft } from "@/lib/drama/bible";
import { frameGradient } from "@/lib/drama/schema";
import { makeScript, readScriptFile, SCRIPT_ACCEPT } from "@/lib/drama/script";
import { SETTING_OPTIONS, episodeCountOf } from "@/lib/drama/settings";
import { DRAMA_TEMPLATES } from "@/lib/drama/templates";
import { audioVoiceOptions } from "@/lib/audio-generation";
import { useDramaStore } from "@/stores/use-drama-store";
import type { DramaAsset, DramaBible, DramaScript } from "@/types/drama";
import type { StepProps } from "./step-props";

const GENRES = ["都市情感", "悬疑推理", "古装权谋", "甜宠逆袭", "科幻未来", "奇幻冒险", "校园青春", "家庭伦理"];
const BIBLE_FIELDS: { key: keyof DramaBible; title: string; placeholder: string }[] = [
    { key: "world", title: "世界观", placeholder: "时代、地域、规则与禁忌。例如：近未来沿海城市，记忆可被交易。" },
    { key: "background", title: "故事背景", placeholder: "故事开始前发生了什么，主角为什么被卷进来。" },
    { key: "relations", title: "人物关系", placeholder: "谁和谁是什么关系，谁在利用谁。" },
    { key: "visual", title: "画面视觉规范", placeholder: "色调、光线、镜头质感、服化道基准。" },
    { key: "era", title: "时代与地域", placeholder: "民国江南 / 近未来湾区，建筑与器物要符合这个年代。" },
    { key: "palette", title: "色彩基调", placeholder: "冷青灰为主，暖灯作点缀；饱和度偏低。" },
    { key: "material", title: "材质质感", placeholder: "实木、青石、粗麻、雨湿反光；避免塑料感。" },
    { key: "negative", title: "负面提示词", placeholder: "全项目都不希望出现的内容，例如：现代电器、卡通化、过曝。" },
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
            patch({ script: makeScript(text, "upload", { ...script, fileName: file.name }) });
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
            patch({ script: { ...script, text: draft, source: script?.source ?? "paste", outline } });
            setSaveState("saved");
        }, 800);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft]);

    // 防抖还没到就离开这一步时补存一次：否则「改完剧本立刻去拆镜」会拆到旧剧本。
    const draftRef = useRef(draft);
    draftRef.current = draft;
    useEffect(() => {
        return () => {
            const store = useDramaStore.getState();
            const current = store.sequences.find((item) => item.id === sequence.id);
            if (!current || draftRef.current === (current.script?.text ?? "")) return;
            store.updateSequence(sequence.id, { script: { ...current.script, text: draftRef.current, source: current.script?.source ?? "paste" } });
        };
    }, [sequence.id]);

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
                patch({ script: { ...script, text: draft, source: script?.source ?? "none", outline: text } });
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
                patch({ script: { ...script, text: next, source: "generated", outline, premise: brief.premise } });
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
                        patch({ script: makeScript(text, "upload", { ...script, outline, fileName: file.name }) });
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
                        <Input.TextArea autoSize={{ minRows: 10, maxRows: 22 }} value={outline} placeholder="点上方「生成大纲」，或自己写：一句话故事 / 主要人物 / 分集大纲" onChange={(event) => setOutline(event.target.value)} onBlur={() => patch({ script: { ...script, text: draft, source: script?.source ?? "none", outline } })} />
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

/** 03 确认设定：世界观、人物、视觉规范与生成参数。设定由前两步自动补全，用户确认或改。 */
export function SettingsStep({ sequence, settings, config, patch, patchSetting, go }: StepProps) {
    const { message } = App.useApp();
    const bible: DramaBible = sequence.bible ?? EMPTY_BIBLE;
    const state = bibleState(sequence);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState("");
    const [progress, setProgress] = useState(0);
    const autoRanRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const patchBible = (part: Partial<DramaBible>) => patch({ bible: { ...bible, ...part } });
    const characters = sequence.assets.filter((asset) => asset.kind === "character");
    const scenes = sequence.assets.filter((asset) => asset.kind === "scene");
    const items = sequence.assets.filter((asset) => asset.kind === "prop" || asset.kind === "costume" || asset.kind === "effect");
    const patchVoice = (name: string, voice: string) => patch({ voices: { ...(sequence.voices ?? {}), [name]: voice } });
    const patchAsset = (id: string, part: Partial<DramaAsset>) => patch({ assets: sequence.assets.map((asset) => (asset.id === id ? { ...asset, ...part } : asset)) });

    const addCharacter = () => {
        patch({ assets: [...sequence.assets, { id: `asset-${nanoid(8)}`, name: `新人物 ${characters.length + 1}`, kind: "character", description: "", refs: [] }] });
    };

    const removeCharacter = (id: string) => {
        patch({
            assets: sequence.assets.filter((asset) => asset.id !== id),
            shots: sequence.shots.map((shot) => (shot.assetIds.includes(id) ? { ...shot, assetIds: shot.assetIds.filter((item) => item !== id) } : shot)),
        });
    };

    /**
     * 补全设定：先落地规则初稿（不花额度、立刻有内容可确认），
     * 配了文本模型再用它补人物关系与外观；replace 只在用户显式点「重新生成」时用。
     */
    const fill = async (mode: "fill" | "replace") => {
        const text = sequence.script?.text ?? "";
        if (!text.trim()) {
            message.warning("剧本还是空的，先回「生成剧本」");
            return;
        }
        const rule = ruleBibleDraft(sequence);
        const ruleMerged = mergeBibleDraft(sequence, rule, mode);
        patch({ bible: ruleMerged.bible, assets: ruleMerged.assets });

        if (!bibleReady(config, settings)) {
            patch({ bibleHash: bibleHashOf(sequence) });
            setNote("未配置文本模型：已按前两步的信息填好能填的字段，人物关系与外观需要你补。");
            return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        setProgress(0);
        setNote("");
        try {
            const draft = await aiBibleDraft({
                config,
                settings,
                sequence: { ...sequence, bible: ruleMerged.bible, assets: ruleMerged.assets },
                signal: controller.signal,
                onProgress: setProgress,
            });
            // 用 store 最新数据做合并：AI 跑的时候用户可能已经改了设定或人物，不能被旧快照覆盖。
            const latest = useDramaStore.getState().sequences.find((item) => item.id === sequence.id) ?? sequence;
            const merged = mergeBibleDraft(latest, draft, mode);
            patch({ bible: merged.bible, assets: merged.assets, bibleHash: bibleHashOf(latest) });
            setNote(`已根据前两步补全设定：${draft.characters.length} 个人物 · ${draft.scenes.length} 个场景。可直接改，也可以点「重新生成设定」。`);
        } catch (error) {
            if (controller.signal.aborted) {
                if (abortRef.current === controller) setNote("已停止 AI 补全，保留按剧本推算的初稿，可以再点一次「AI 补全设定」。");
                return;
            }
            setNote(`AI 补全失败：${error instanceof Error ? error.message : "未知原因"}。已保留按剧本推算的初稿，可以再点一次「AI 补全」。`);
        } finally {
            // 只有「当前这一次」请求负责收尾：停止后 busy 必须释放，被新请求顶替的旧请求不能把状态关掉。
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
            }
        }
    };

    // 进来的第一件事就是补全：用户只需要确认或修改，不用先点按钮。
    // 只要有剧本、且设定还不是「按这一版剧本生成的」，就补一次（fill 模式不会覆盖用户写过的内容）。
    useEffect(() => {
        if (autoRanRef.current === sequence.id) return;
        if (!(sequence.script?.text ?? "").trim()) return;
        if (state === "ready" && sequence.bibleHash) return;
        autoRanRef.current = sequence.id;
        void fill("fill");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sequence.id]);

    const stateLabel = state === "empty" ? "待补全" : state === "stale" ? "剧本已改，设定是上一版" : "已按前两步补全";

    return (
        <StepShell
            title="确认设定"
            subtitle={`世界观、故事背景与人物由前两步自动补全（${stateLabel}），确认或直接改即可；人物名是跨镜头的唯一标识，不要随意改。`}
            actions={
                <>
                    <span className="drama-sub">{savedLabel(sequence.updatedAt)}</span>
                    {busy ? (
                        <Button onClick={() => abortRef.current?.abort()}>停止</Button>
                    ) : null}
                    <Button
                        type={state === "ready" ? "default" : "primary"}
                        icon={busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                        disabled={busy}
                        onClick={() => void fill(state === "ready" ? "replace" : "fill")}
                    >
                        {busy ? `AI 补全中${progress ? ` · ${progress} 字` : "…"}` : state === "ready" ? "重新生成设定" : "AI 补全设定"}
                    </Button>
                </>
            }
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
            {state === "stale" && !busy ? (
                <div className="drama-notice mb-3">
                    <CircleAlert className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">剧本改过之后设定没有更新，世界观与人物描述可能已经对不上。</span>
                    <Button size="small" type="primary" onClick={() => void fill("replace")}>
                        按新剧本重新生成
                    </Button>
                </div>
            ) : null}

            {note ? <div className="drama-card mb-3 text-[13px] leading-6">{note}</div> : null}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        {BIBLE_FIELDS.map((field) => (
                            <Panel key={field.key} title={field.title}>
                                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} value={bible[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => patchBible({ [field.key]: event.target.value })} />
                            </Panel>
                        ))}
                    </div>

                    <Panel
                        title="人物设定"
                        hint={`${characters.length} 人 · 同名人物在拆镜、出图、配音里共用这一条`}
                        actions={
                            <Button size="small" icon={<Plus className="size-3.5" />} onClick={addCharacter}>
                                新增人物
                            </Button>
                        }
                    >
                        {characters.length === 0 ? (
                            <p className="drama-empty">还没有人物。剧本里有人物表或对白时，上面「AI 补全设定」会自动建卡；也可以点「新增人物」。</p>
                        ) : (
                            <div className="space-y-2">
                                {characters.map((asset) => (
                                    <div key={asset.id} className="grid items-center gap-2 rounded-lg border border-[var(--studio-border-soft)] p-2 md:grid-cols-[120px_minmax(0,1fr)_140px_auto]">
                                        <Input value={asset.name} onChange={(event) => patchAsset(asset.id, { name: event.target.value })} />
                                        <Input value={asset.description} placeholder="身份 / 性格 / 外观 / 服装" onChange={(event) => patchAsset(asset.id, { description: event.target.value })} />
                                        <Select
                                            value={sequence.voices?.[asset.id] ?? ""}
                                            onChange={(value) => patchVoice(asset.id, value)}
                                            options={[{ value: "", label: "音色：自动" }, ...audioVoiceOptions.map((item) => ({ value: item.value, label: `音色：${item.label}` }))]}
                                        />
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} title="删除人物" onClick={() => removeCharacter(asset.id)} />
                                    </div>
                                ))}
                            </div>
                        )}
                        <p className="drama-sub mt-2">
                            {scenes.length ? `已认出的场景：${scenes.map((asset) => asset.name).join("、")}（参考图在「资产生成」里出）` : "剧本里的场景标题会自动建成场景资产，参考图在「资产生成」里出。"}
                        </p>
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

                    <div className="mt-3 border-t border-[var(--studio-border-soft)] pt-3">
                        <div className="drama-label">项目默认摄影（单镜可在右侧检查器覆盖）</div>
                        <div className="grid grid-cols-2 gap-3">
                            <DramaParamSelect label="焦段" value={settings.lens} options={SETTING_OPTIONS.lens} onChange={(value) => patchSetting("lens", value)} customPlaceholder="如 40mm 变形宽银幕" />
                            <DramaParamSelect label="光圈/景深" value={settings.aperture} options={SETTING_OPTIONS.aperture} onChange={(value) => patchSetting("aperture", value)} customPlaceholder="如 f/2 浅景深" />
                            <DramaParamSelect label="主光方向" value={settings.keyLight} options={SETTING_OPTIONS.keyLight} onChange={(value) => patchSetting("keyLight", value)} customPlaceholder="如 右上侧逆光" />
                            <DramaParamSelect label="辅光" value={settings.fillLight} options={SETTING_OPTIONS.fillLight} onChange={(value) => patchSetting("fillLight", value)} customPlaceholder="如 冷调环境补光" />
                            <DramaParamSelect label="默认构图" value={settings.composition} options={SETTING_OPTIONS.composition} onChange={(value) => patchSetting("composition", value)} customPlaceholder="如 框中框构图" />
                        </div>
                    </div>
                </Panel>
            </div>
        </StepShell>
    );
}
