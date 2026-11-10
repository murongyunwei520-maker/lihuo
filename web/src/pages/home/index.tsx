import { ArrowRight, ImagePlus, KeyRound, LayoutDashboard, Maximize2, ShieldCheck, Sparkles, Video, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Image } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { GALLERY_ITEMS } from "@/constant/gallery";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { useConfigStore } from "@/stores/use-config-store";
import { cn } from "@/lib/utils";

// 首页文案按语言就地维护，避免为一段落地页去改动两个巨大的 locale 文件。
const COPY = {
    "zh-CN": {
        heroEyebrow: "LIHUO · 离火",
        heroTitle: "让灵感在离火中成形",
        heroDesc: "无限画布、AI 生图、提示词工坊在同一条创作链路里。拖拽连线组织素材，让每一次生成都成为下一次的起点。",
        primaryCta: "打开画布",
        secondaryCta: "开始生图",
        sealChar: "离",
        sealLabel: "LIHUO",
        artworkCaption: "朱雀 · 本地作品",
        ticker: ["无限画布", "AI 生图", "提示词工坊", "朱雀节点", "视频生成", "本地优先", "连线编排"],
        configTitle: "先配置模型接口，再开始出图",
        configDesc: "点右侧「配置 API」→「渠道」标签，填 Base URL（你的 OpenAI 兼容地址，例如 https://api.openai.com）和 API Key。密钥只存在这台电脑的浏览器里，不会上传。",
        configCta: "去配置",
        features: [
            { title: "无限画布", desc: "拖拽、连线、分组，把散落的素材编成一张图" },
            { title: "AI 生图", desc: "直连你配置的 OpenAI 兼容接口，支持参考图与批量出图" },
            { title: "提示词工坊", desc: "一句想法交给 AI，改写成可直接出图的提示词" },
            { title: "本地优先", desc: "画布、素材与密钥都留在浏览器本地" },
        ],
        entriesEyebrow: "CREATIVE ENTRIES",
        entriesTitle: "从这里开始",
        entries: [
            { title: "我的画布", desc: "无限节点编排，适合连续创作与推演", cta: "进入画布" },
            { title: "生图工作台", desc: "单次出图、参考图编辑与批量对比", cta: "去生图" },
            { title: "视频创作台", desc: "文生视频、首尾帧与全能参考", cta: "去生视频" },
        ],
        galleryEyebrow: "PROMPT GALLERY",
        galleryTitle: "灵感图鉴",
        galleryDesc: "图片优先取自提示词库，点任意一张都能打开大图。",
        galleryFromLibrary: "来自提示词库 · {{count}} 条",
        galleryFallback: "提示词库暂不可用，先展示本地作品（访问 GitHub 需要网络或代理）",
        galleryMore: "去提示词库",
        galleryEmpty: "这个分类下暂时没有作品。",
        tagFallback: "提示词",
        floating: "输入灵感，即刻创作",
    },
    "en-US": {
        heroEyebrow: "LIHUO",
        heroTitle: "Let ideas take shape in Lihuo",
        heroDesc: "Infinite canvas, AI image generation and a prompt workshop in one flow. Drag, connect and organize assets so every generation feeds the next.",
        primaryCta: "Open canvas",
        secondaryCta: "Start generating",
        sealChar: "离",
        sealLabel: "LIHUO",
        artworkCaption: "Phoenix · local artwork",
        ticker: ["INFINITE CANVAS", "AI IMAGE", "PROMPT LAB", "PHOENIX NODES", "VIDEO", "LOCAL FIRST"],
        configTitle: "Connect a model endpoint first",
        configDesc: "Open “API settings” → “Channels”, then fill Base URL (any OpenAI-compatible endpoint, e.g. https://api.openai.com) and API Key. Keys stay in this browser and are never uploaded.",
        configCta: "Set up",
        features: [
            { title: "Infinite canvas", desc: "Drag, connect and group scattered assets into one picture" },
            { title: "AI generation", desc: "Connect any OpenAI-compatible endpoint, with references and batches" },
            { title: "Prompt workshop", desc: "Let AI rewrite a rough idea into a prompt you can use" },
            { title: "Local first", desc: "Canvas, assets and keys stay in your browser" },
        ],
        entriesEyebrow: "CREATIVE ENTRIES",
        entriesTitle: "Start here",
        entries: [
            { title: "My canvas", desc: "Infinite node layout for continuous creation", cta: "Open canvas" },
            { title: "Image workbench", desc: "Single shots, reference edits and batch compare", cta: "Generate" },
            { title: "Video workbench", desc: "Text-to-video, keyframes and full reference", cta: "Create video" },
        ],
        galleryEyebrow: "PROMPT GALLERY",
        galleryTitle: "Inspiration map",
        galleryDesc: "Images come from the prompt library first. Click any of them to open the full image.",
        galleryFromLibrary: "From the prompt library · {{count}}",
        galleryFallback: "Prompt library unavailable, showing local artworks (GitHub needs network or a proxy)",
        galleryMore: "Browse prompts",
        galleryEmpty: "No artwork in this category yet.",
        tagFallback: "Prompt",
        floating: "Type an idea, create now",
    },
} as const;

type GalleryEntry = { id: string; title: string; prompt: string; tag: string; src: string; width?: number; height?: number };

const FEATURE_ICONS = [LayoutDashboard, Sparkles, Wand2, ShieldCheck];
const ENTRY_ICONS = [LayoutDashboard, ImagePlus, Video];
const ENTRY_PATHS = ["/canvas", "/image", "/video"];

export default function IndexPage() {
    const { i18n: i18nInstance } = useTranslation();
    const navigate = useNavigate();
    const copy = COPY[i18nInstance.resolvedLanguage === "en-US" ? "en-US" : "zh-CN"];
    const config = useConfigStore((state) => state.config);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const aiReady = isAiConfigReady(config, config.model);

    const [promptItems, setPromptItems] = useState<Prompt[]>([]);
    const [promptState, setPromptState] = useState<"loading" | "ready" | "unavailable">("loading");
    const [activeTag, setActiveTag] = useState("全部");
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    // 图鉴优先用提示词库的真实作品图；连不上时回落到随包发布的本地图，保证永远有内容。
    useEffect(() => {
        let alive = true;
        void fetchPrompts({ pageSize: 24 })
            .then((data) => {
                if (!alive) return;
                const withCover = data.items.filter((item) => Boolean(item.coverUrl));
                setPromptItems(withCover);
                setPromptState(withCover.length ? "ready" : "unavailable");
            })
            .catch(() => {
                if (alive) setPromptState("unavailable");
            });
        return () => {
            alive = false;
        };
    }, []);

    const entries = useMemo<GalleryEntry[]>(() => {
        if (!promptItems.length) return GALLERY_ITEMS;
        return promptItems.map((item, index) => ({
            id: item.id || `prompt-${index}`,
            title: item.title || copy.tagFallback,
            prompt: item.prompt || "",
            tag: item.tags?.[0] || copy.tagFallback,
            src: item.coverUrl,
        }));
    }, [promptItems, copy.tagFallback]);

    const tags = useMemo(() => ["全部", ...[...new Set(entries.map((entry) => entry.tag))].filter(Boolean).slice(0, 5)], [entries]);
    const effectiveTag = tags.includes(activeTag) ? activeTag : "全部";
    const visible = effectiveTag === "全部" ? entries : entries.filter((entry) => entry.tag === effectiveTag);

    const sourceNote = promptState === "ready" ? copy.galleryFromLibrary.replace("{{count}}", String(promptItems.length)) : copy.galleryFallback;

    return (
        <main className="h-full overflow-y-auto bg-[#f6f4fa] text-slate-950 dark:bg-[#0a0810] dark:text-white">
            <div className="mx-auto w-full max-w-[1280px] px-6 pb-20 pt-6">
                {/* 横幅 */}
                <section className="lihuo-grain relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-[linear-gradient(120deg,#150f24_0%,#08060e_46%,#140f22_100%)] dark:border-white/[0.08]">
                    <div className="pointer-events-none absolute -right-24 -top-24 size-[460px] rounded-full bg-[radial-gradient(circle,rgba(185,172,232,0.26),transparent_62%)]" />
                    <div className="pointer-events-none absolute -left-32 -bottom-36 size-[380px] rounded-full bg-[radial-gradient(circle,rgba(155,138,208,0.22),transparent_65%)]" />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(190,170,220,0.30)_1px,transparent_1px)] [background-size:26px_26px] opacity-[0.16]" />

                    <div className="relative grid gap-10 px-8 py-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center lg:px-14 lg:py-14">
                        <div>
                            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#9b8ad0]">{copy.heroEyebrow}</p>
                            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                                <span className="lihuo-brand-text">{copy.heroTitle}</span>
                            </h1>
                            <p className="mt-5 max-w-xl text-[15px] leading-7 text-white/60">{copy.heroDesc}</p>
                            <div className="mt-8 flex flex-wrap items-center gap-3">
                                <Button
                                    size="large"
                                    className="!h-11 !border-0 !bg-[linear-gradient(100deg,#6b57a8_0%,#b9ace8_100%)] !px-6 !text-[#120e1f] !shadow-[0_10px_30px_rgba(155,138,208,0.28)] hover:!brightness-105"
                                    onClick={() => navigate("/canvas")}
                                    icon={<ArrowRight className="size-4" />}
                                    iconPlacement="end"
                                >
                                    {copy.primaryCta}
                                </Button>
                                <Button size="large" className="!h-11 !border-white/20 !bg-white/[0.06] !px-6 !text-white hover:!border-white/35 hover:!bg-white/[0.12]" onClick={() => navigate("/image")}>
                                    {copy.secondaryCta}
                                </Button>
                            </div>
                        </div>

                        {/* 本地作品 + 雾霭紫朱印 */}
                        <div className="relative hidden lg:block">
                            <figure className="relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
                                <img src="/gallery/abyss-phoenix.svg" alt={copy.artworkCaption} width={720} height={1040} className="h-[286px] w-full object-cover" />
                                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{copy.artworkCaption}</figcaption>
                            </figure>
                            <div className="absolute -bottom-4 -left-4 grid size-16 -rotate-6 place-items-center rounded-[10px] border-2 border-[#eee9ff]/70 bg-[#4b3f72] text-center shadow-[0_12px_28px_rgba(75,63,114,0.45)]">
                                <span className="font-serif text-2xl leading-none text-[#eee9ff]">{copy.sealChar}</span>
                                <span className="mt-0.5 font-mono text-[7px] tracking-[0.28em] text-[#eee9ff]/70">{copy.sealLabel}</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* 没配接口时，把入口顶到最显眼的位置 */}
                {!aiReady ? (
                    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-[#6b57a8]/25 bg-[#6b57a8]/[0.05] p-4 dark:border-[#b9ace8]/25 dark:bg-[#b9ace8]/[0.07]">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#6b57a8]/10 text-[#6b57a8] dark:bg-[#b9ace8]/15 dark:text-[#c4b8ef]">
                            <KeyRound className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{copy.configTitle}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-white/45">{copy.configDesc}</p>
                        </div>
                        <Button className="!h-9 !rounded-full !border-0 !bg-[#6b57a8] !px-4 !text-white hover:!bg-[#584693] dark:!bg-[#b9ace8] dark:!text-[#120e1f] dark:hover:!bg-[#cdc2f2]" onClick={() => openConfigDialog(false, "channels")}>
                            {copy.configCta}
                        </Button>
                    </div>
                ) : null}

                {/* 关键词跑马灯 */}
                <div className="lihuo-marquee mt-4 overflow-hidden rounded-full border border-slate-200/70 bg-white/70 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="lihuo-marquee-track">
                        {[0, 1].map((copyIndex) => (
                            <div key={copyIndex} className="flex shrink-0 items-center" aria-hidden={copyIndex === 1}>
                                {copy.ticker.map((word) => (
                                    <span key={word} className="flex items-center">
                                        <span className="px-5 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-white/45">{word}</span>
                                        <span className="size-1 shrink-0 rounded-full bg-[#b9ace8]" />
                                    </span>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 能力条 */}
                <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {copy.features.map((feature, index) => {
                        const Icon = FEATURE_ICONS[index];
                        return (
                            <div
                                key={feature.title}
                                className="group rounded-2xl border border-slate-200/80 bg-white p-5 transition duration-300 hover:-translate-y-0.5 hover:border-[#b9ace8]/60 hover:shadow-[0_16px_40px_rgba(107,87,168,0.10)] dark:border-white/[0.08] dark:bg-[#12101c] dark:hover:border-[#b9ace8]/35 dark:hover:shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
                            >
                                <span className="grid size-10 place-items-center rounded-xl bg-[#b9ace8]/15 text-[#6b57a8] transition group-hover:bg-[#9b8ad0]/15 group-hover:text-[#6b57a8] dark:bg-[#b9ace8]/10 dark:text-[#c4b8ef] dark:group-hover:text-[#d4cbf2]">
                                    <Icon className="size-[18px]" />
                                </span>
                                <h3 className="mt-4 text-[15px] font-semibold tracking-tight">{feature.title}</h3>
                                <p className="mt-1.5 text-[13px] leading-6 text-slate-500 dark:text-white/45">{feature.desc}</p>
                            </div>
                        );
                    })}
                </section>

                {/* 创作入口 */}
                <section className="mt-16">
                    <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#6b57a8] dark:text-[#9b8ad0]">{copy.entriesEyebrow}</p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight">{copy.entriesTitle}</h2>
                    <div className="mt-6 grid gap-3 md:grid-cols-3">
                        {copy.entries.map((entry, index) => {
                            const Icon = ENTRY_ICONS[index];
                            return (
                                <button
                                    key={entry.title}
                                    type="button"
                                    onClick={() => navigate(ENTRY_PATHS[index])}
                                    className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 text-left transition duration-300 hover:-translate-y-0.5 hover:border-[#b9ace8]/60 hover:shadow-[0_18px_44px_rgba(107,87,168,0.12)] dark:border-white/[0.08] dark:bg-[#12101c] dark:hover:border-[#b9ace8]/35 dark:hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)]"
                                >
                                    <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-[#9b8ad0]/12 opacity-0 transition duration-500 group-hover:opacity-100" />
                                    <div className="flex items-center justify-between">
                                        <span className="grid size-10 place-items-center rounded-xl bg-[#b9ace8]/15 text-[#6b57a8] transition group-hover:bg-[#9b8ad0]/15 group-hover:text-[#6b57a8] dark:bg-[#b9ace8]/10 dark:text-[#c4b8ef] dark:group-hover:text-[#d4cbf2]">
                                            <Icon className="size-[18px]" />
                                        </span>
                                        <span className="font-mono text-[11px] text-slate-300 dark:text-white/20">0{index + 1}</span>
                                    </div>
                                    <h3 className="mt-5 text-lg font-semibold tracking-tight">{entry.title}</h3>
                                    <p className="mt-1.5 text-[13px] leading-6 text-slate-500 dark:text-white/45">{entry.desc}</p>
                                    <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6b57a8] transition group-hover:gap-2.5 dark:text-[#c4b8ef]">
                                        {entry.cta}
                                        <ArrowRight className="size-3.5" />
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* 灵感图鉴：优先提示词库，点击放大 */}
                <section className="mt-16">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#6b57a8] dark:text-[#9b8ad0]">{copy.galleryEyebrow}</p>
                            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{copy.galleryTitle}</h2>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-white/45">{copy.galleryDesc}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-400 dark:text-white/30">{sourceNote}</p>
                        </div>
                        <Button type="link" onClick={() => navigate("/prompts")} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {copy.galleryMore}
                        </Button>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-2">
                        {tags.map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => setActiveTag(tag)}
                                className={cn(
                                    "cursor-pointer rounded-full border px-4 py-1.5 text-[13px] transition",
                                    effectiveTag === tag
                                        ? "border-[#c4b8ef] bg-[#c4b8ef] font-medium text-[#120e1f]"
                                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/55 dark:hover:border-white/25 dark:hover:text-white",
                                )}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>

                    {visible.length ? (
                        <div className="mt-6 columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
                            {visible.map((item, index) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        setPreviewIndex(index);
                                        setPreviewOpen(true);
                                    }}
                                    className="group relative mb-3 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 text-left dark:border-white/[0.08] dark:bg-[#141122]"
                                >
                                    <img
                                        src={item.src}
                                        alt={item.title}
                                        width={item.width}
                                        height={item.height}
                                        loading="lazy"
                                        className="w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                                    />
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4">
                                        <div className="flex items-center gap-2">
                                            <span className="shrink-0 rounded-full bg-[#c4b8ef] px-2 py-0.5 text-[10px] font-medium text-[#120e1f]">{item.tag}</span>
                                            <h3 className="line-clamp-1 text-[13px] font-medium text-white">{item.title}</h3>
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-white/60">{item.prompt}</p>
                                    </div>
                                    <span className="absolute right-3 top-3 rounded-full bg-black/50 p-1.5 text-white opacity-0 backdrop-blur transition duration-300 group-hover:opacity-100">
                                        <Maximize2 className="size-3.5" />
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <p className="mt-10 text-sm text-slate-500 dark:text-white/45">{copy.galleryEmpty}</p>
                    )}
                </section>

                {/* 常驻行动条 */}
                <div className="pointer-events-none sticky bottom-5 z-10 mt-14 flex justify-center">
                    <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-200/80 bg-white/90 py-1.5 pl-5 pr-1.5 shadow-[0_16px_40px_rgba(23,42,58,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#12101c]/90 dark:shadow-[0_16px_40px_rgba(0,0,0,0.6)]">
                        <span className="text-[13px] text-slate-500 dark:text-white/50">{copy.floating}</span>
                        <Button type="primary" shape="circle" className="!size-9 !min-w-9" onClick={() => navigate("/canvas")} icon={<ArrowRight className="size-4" />} aria-label={copy.primaryCta} />
                    </div>
                </div>
            </div>

            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {visible.map((item) => (
                        <Image key={item.id} src={item.src} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
