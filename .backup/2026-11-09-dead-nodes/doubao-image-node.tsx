import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Select, Tag, Tooltip } from "antd";
import { ImagePlus, Loader2, RefreshCw, Sparkles, Upload, Wand2 } from "lucide-react";

import { createVideoJob, fetchAccountModels, fetchImageCaps, findJobForNode, getJob, jobFileUrl, listAccounts, uploadAttachment, waitJob, type DoubaoAccount, type DoubaoImageCaps, type DoubaoJob } from "@/services/api/doubao-bridge";
import { useDoubaoAccountStore } from "@/stores/use-doubao-account-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export const LIHUO_DOUBAO_IMAGE_TYPE = "lihuo:doubao-image";

type ImageMode = "text-to-image" | "image-to-image" | "image-edit" | "reference";

const MODE_LABEL: Record<ImageMode, string> = {
    "text-to-image": "文生图",
    "image-to-image": "图生图",
    "image-edit": "图片编辑",
    reference: "参考图生成",
};

/** 按比例画示意方块（图片比例含 2:3 / 3:2 等）。 */
function ratioShape(option: string, max = 20) {
    if (option === "自动") return { w: max, h: Math.round(max * 0.62) };
    const [a, b] = option.split(":").map(Number);
    if (!a || !b) return { w: max, h: max };
    const scale = max / Math.max(a, b);
    return { w: Math.round(a * scale), h: Math.round(b * scale) };
}

async function materialFromNode(node: CanvasNodeData): Promise<{ name: string; blob: Blob } | null> {
    const content = node.metadata?.content;
    if (node.type !== "image" || !content) return null;
    try {
        const blob = await (await fetch(content)).blob();
        return { name: `${node.title || "参考图"}.png`, blob };
    } catch {
        return null;
    }
}

export function DoubaoImageContent({ ctx }: { ctx: CanvasNodeContext }) {
    const status = typeof ctx.node.metadata?.status === "string" ? ctx.node.metadata.status : "idle";
    const mode = (ctx.node.metadata?.mode as ImageMode) || "text-to-image";
    const modelName = typeof ctx.node.metadata?.modelName === "string" ? ctx.node.metadata.modelName : "";
    const accountName = typeof ctx.node.metadata?.accountName === "string" ? ctx.node.metadata.accountName : "";
    const progress = typeof ctx.node.metadata?.progress === "string" ? ctx.node.metadata.progress : "";
    const resultUrl = typeof ctx.node.metadata?.resultUrl === "string" ? ctx.node.metadata.resultUrl : "";
    const accountId = typeof ctx.node.metadata?.accountId === "string" ? ctx.node.metadata.accountId : "";
    const models = Array.isArray(ctx.node.metadata?.imageModels) ? (ctx.node.metadata.imageModels as string[]) : [];
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const readModels = async () => {
        if (!accountId) {
            setError("先在面板里选账号");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const info = await fetchAccountModels(accountId);
            ctx.updateMetadata({ imageModels: info.options, modelName: modelName || info.current });
        } catch (err) {
            setError(err instanceof Error ? err.message : "读取失败");
        } finally {
            setLoading(false);
        }
    };

    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

    // 结果兜底：本节点发起过的任务，完成后自动回填到本卡片（面板关了也不丢）
    useEffect(() => {
        if (resultUrl) return;
        const jobId = typeof ctx.node.metadata?.jobId === "string" ? ctx.node.metadata.jobId : "";
        let alive = true;
        const sync = async () => {
            try {
                const found = jobId ? await getJob(jobId).catch(() => null) : await findJobForNode(ctx.node.id);
                if (!alive || !found || found.nodeId !== ctx.node.id) return;
                if (found.id !== jobId) ctx.updateMetadata({ jobId: found.id });
                if (found.status === "running" || found.status === "queued") {
                    ctx.updateMetadata({ status: "loading", progress: found.progress || "生成中…" });
                } else if (found.status === "succeeded" && found.files.length) {
                    const image = found.files.find((file) => String(file.kind).includes("image")) || found.files[0];
                    ctx.updateMetadata({
                        status: "success",
                        jobId: found.id,
                        resultUrl: jobFileUrl(found.id, image.index),
                        progress: `已完成 · ${found.files.length} 张`,
                        modelName: found.modelName || ctx.node.metadata?.modelName || null,
                        accountName: found.accountName,
                    });
                } else if (found.status === "failed") {
                    ctx.updateMetadata({ status: "error", progress: found.error?.message || "生成失败" });
                }
            } catch {
                /* 桥接未运行，下次再试 */
            }
        };
        void sync();
        const timer = window.setInterval(() => void sync(), 5000);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resultUrl, ctx.node.id]);

    return (
        <div data-canvas-no-zoom className="flex size-full flex-col gap-1.5 p-2.5" style={{ color: ctx.theme.node.text }} onMouseDown={stop} onPointerDown={stop} onWheel={stop}>
            <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-lg bg-[#6b57a8]/12 text-[#6b57a8] dark:bg-[#b9ace8]/15 dark:text-[#c4b8ef]">
                    <ImagePlus className="size-3" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">豆包图片 · {MODE_LABEL[mode]}</p>
                    <p className="truncate text-[10px]" style={{ color: ctx.theme.node.muted }}>
                        {accountName || "未选账号"}
                    </p>
                </div>
                {status === "loading" ? <Loader2 className="size-3.5 animate-spin" style={{ color: ctx.theme.node.muted }} /> : null}
            </div>

            <div className="grid grid-cols-2 gap-1">
                <Select
                    size="small"
                    value={mode}
                    onChange={(value) => ctx.updateMetadata({ mode: value })}
                    options={[
                        { value: "text-to-image", label: "文生图" },
                        { value: "image-to-image", label: "图生图" },
                        { value: "image-edit", label: "图片编辑" },
                        { value: "reference", label: "参考图" },
                    ]}
                    className="!text-[11px]"
                />
                <Select
                    size="small"
                    value={modelName || undefined}
                    placeholder={models.length ? "模型" : "先读模型"}
                    disabled={!models.length}
                    onChange={(value) => ctx.updateMetadata({ modelName: value })}
                    options={models.map((option) => ({ value: option, label: option }))}
                    className="!text-[11px]"
                />
            </div>
            <div className="flex items-center gap-1">
                <Button size="small" loading={loading} onClick={() => void readModels()} icon={<RefreshCw className="size-3" />} className="!px-1.5" title="读取豆包图片模型" />
                <Button size="small" onClick={ctx.openPanel} icon={<Wand2 className="size-3" />} className="!px-1.5" title="打开生成面板" />
            </div>

            {resultUrl ? (
                <img src={resultUrl} alt="豆包生成结果" className="min-h-0 w-full flex-1 rounded-md bg-black/20 object-contain" />
            ) : (
                <p className="line-clamp-2 min-h-0 flex-1 text-[10px] leading-4" style={{ color: ctx.theme.node.muted }}>
                    {error || progress || "点左侧按钮读模型，或打开面板生成"}
                </p>
            )}
        </div>
    );
}

export function DoubaoImagePanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { message } = App.useApp();
    const currentAccountId = useDoubaoAccountStore((state) => state.currentAccountId);
    const setCurrentAccount = useDoubaoAccountStore((state) => state.setCurrentAccount);

    const [mode, setMode] = useState<ImageMode>((ctx.node.metadata?.mode as ImageMode) || "text-to-image");
    const [prompt, setPrompt] = useState(String(ctx.node.metadata?.prompt || ""));
    const [accounts, setAccounts] = useState<DoubaoAccount[]>([]);
    const [accountId, setAccountId] = useState(currentAccountId || "");
    const [models, setModels] = useState<string[]>([]);
    const [caps, setCaps] = useState<DoubaoImageCaps | null>((ctx.node.metadata?.imageCaps as DoubaoImageCaps) || null);
    const [capsLoading, setCapsLoading] = useState(false);
    const [capsError, setCapsError] = useState("");
    const [ratio, setRatio] = useState<string>((ctx.node.metadata?.ratio as string) || "");
    const [modelName, setModelName] = useState(String(ctx.node.metadata?.modelName || ""));
    const [capabilities, setCapabilities] = useState<string[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [localFiles, setLocalFiles] = useState<{ key: string; name: string; blob: Blob }[]>([]);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState("");
    const [job, setJob] = useState<DoubaoJob | null>(null);

    // 不用 useMemo：连线状态独立，缓存会漏掉刚连上的图片
    const upstream = ctx.getUpstream().filter((node) => node.type === "image");
    const selectedAccount = accounts.find((account) => account.id === accountId) || null;

    const refresh = useCallback(async () => {
        try {
            const next = await listAccounts();
            setAccounts(next);
            if (!accountId) {
                const preferred = next.find((item) => item.id === currentAccountId) || next.find((item) => item.state.loggedIn) || next[0];
                if (preferred) setAccountId(preferred.id);
            }
        } catch {
            setError("桥接未运行");
        }
    }, [accountId, currentAccountId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // 选好账号自动读一次豆包图片参数（服务端缓存 12 小时）
    useEffect(() => {
        if (!accountId || caps) return;
        setCapsLoading(true);
        void fetchImageCaps(accountId)
            .then((next) => {
                setCaps(next);
                setRatio((prev) => prev || next.ratio.current || "");
                ctx.updateMetadata({ imageCaps: next, ratio: ctx.node.metadata?.ratio ?? next.ratio.current, accountId });
            })
            .catch((err) => setCapsError(err instanceof Error ? err.message : "读取失败"))
            .finally(() => setCapsLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId]);

    const readModels = async () => {
        if (!accountId) {
            setError("先选账号");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const info = await fetchAccountModels(accountId);
            setModels(info.options);
            setCapabilities(info.capabilities);
            if (!modelName && info.current) setModelName(info.current);
        } catch (err) {
            setError(err instanceof Error ? err.message : "读取失败");
        } finally {
            setLoading(false);
        }
    };

    const submit = async () => {
        if (!accountId || !prompt.trim()) return;
        setRunning(true);
        setConfirmOpen(false);
        setProgress("正在上传参考图…");
        try {
            const paths: string[] = [];
            for (const file of localFiles) paths.push(await uploadAttachment(accountId, file.blob, file.name));
            // 提交前重新读连线，确保刚连上的图片也一起提交
            const connected = ctx.getUpstream().filter((node) => node.type === "image");
            for (const node of connected) {
                const material = await materialFromNode(node);
                if (material) paths.push(await uploadAttachment(accountId, material.blob, material.name));
            }
            setProgress("任务已提交，等待豆包生成…");
            const created = await createVideoJob({
                nodeId: ctx.node.id,
                accountId,
                prompt: prompt.trim(),
                attachments: paths,
                mode,
                capability: "图像生成",
                modelName: modelName || caps?.model.current || undefined,
                requestedParams: { model: modelName || caps?.model.current, ratio: ratio || caps?.ratio.current },
            });
            ctx.updateMetadata({ jobId: created.id, status: "loading", prompt: prompt.trim(), mode, accountName: selectedAccount?.name, modelName: modelName || null, progress: "任务已提交" });

            const finished = await waitJob(created.id, (current) => {
                setJob(current);
                setProgress(current.progress || current.status);
                ctx.updateMetadata({ progress: current.progress || current.status });
            });

            if (finished.status === "succeeded" && finished.files.length) {
                const image = finished.files.find((file) => String(file.kind).includes("image")) || finished.files[0];
                // 结果只回本节点，卡片里直接预览
                ctx.updateMetadata({ status: "success", jobId: finished.id, progress: `完成 · ${finished.files.length} 张`, resultUrl: jobFileUrl(finished.id, image.index) });
                message.success(`已生成 ${finished.files.length} 张图片，已回填到本卡片`);
            } else {
                ctx.updateMetadata({ status: "error", progress: finished.error?.message || "生成失败" });
                message.error(finished.error?.message || "生成失败");
            }
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            setProgress(text);
            ctx.updateMetadata({ status: "error", progress: text });
            message.error(text);
        } finally {
            setRunning(false);
        }
    };

    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
    const theme = ctx.theme;
    const canUseImage = capabilities ? capabilities.includes("图像生成") : null;

    return (
        <div data-canvas-no-zoom className="max-h-[72vh] overflow-y-auto rounded-2xl border p-3 shadow-2xl backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onMouseDown={stop} onPointerDown={stop} onWheel={stop}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                    <ImagePlus className="size-3.5" /> 豆包图片生成
                </div>
                <Button size="small" type="text" onClick={onClose}>
                    关闭
                </Button>
            </div>

            {error ? <div className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</div> : null}

            <div className="mb-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-[11px] opacity-60">模式</span>
                    <Select
                        size="small"
                        className="w-full"
                        value={mode}
                        onChange={(value) => setMode(value)}
                        options={[
                            { value: "text-to-image", label: "文生图" },
                            { value: "image-to-image", label: "图生图" },
                            { value: "image-edit", label: "图片编辑" },
                            { value: "reference", label: "参考图生成" },
                        ]}
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-[11px] opacity-60">账号（与视频共用）</span>
                    <Select
                        size="small"
                        className="w-full"
                        value={accountId || undefined}
                        placeholder="选择账号"
                        onChange={(value) => {
                            setAccountId(value);
                            setCurrentAccount(value);
                            setModels([]);
                            setCapabilities(null);
                            const target = accounts.find((account) => account.id === value);
                            ctx.updateMetadata({ accountId: value, accountName: target?.name ?? null });
                        }}
                        options={accounts.map((account) => ({ value: account.id, label: `${account.name}${account.state.loggedIn === true ? "" : "（未登录）"}` }))}
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-[11px] opacity-60">图片模型（读自豆包）</span>
                    <div className="flex gap-1">
                        <Select
                            size="small"
                            className="min-w-0 flex-1"
                            value={modelName || caps?.model.current || undefined}
                            placeholder={caps ? "选择模型" : "读取中…"}
                            onChange={(value) => {
                                setModelName(value);
                                ctx.updateMetadata({ modelName: value });
                            }}
                            options={(caps?.model.options?.length ? caps.model.options : models).map((option) => ({ value: option, label: option }))}
                        />
                        <Tooltip title="刷新豆包图片参数">
                            <Button
                                size="small"
                                loading={capsLoading}
                                icon={<RefreshCw className="size-3.5" />}
                                onClick={() => {
                                    if (!accountId) return;
                                    setCapsLoading(true);
                                    void fetchImageCaps(accountId, true)
                                        .then((next) => {
                                            setCaps(next);
                                            ctx.updateMetadata({ imageCaps: next });
                                        })
                                        .finally(() => setCapsLoading(false));
                                }}
                            />
                        </Tooltip>
                    </div>
                </label>
            </div>

            <div className="mb-2 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.toolbar.border }}>
                <div className="mb-1 flex items-center gap-1.5 text-[11px]">
                    <span className="font-medium">图片参数</span>
                    <span className="opacity-50">读自豆包{caps?.readAt ? ` · ${new Date(caps.readAt).toLocaleDateString()}` : ""}</span>
                </div>
                {caps ? (
                    <>
                        <div className="mb-1 text-[10px] opacity-50">比例</div>
                        <div className="grid grid-cols-8 gap-1">
                            {caps.ratio.options.map((option) => {
                                const active = (ratio || caps.ratio.current) === option;
                                const shape = ratioShape(option);
                                return (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => {
                                            setRatio(option);
                                            ctx.updateMetadata({ ratio: option });
                                        }}
                                        className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-md border py-1 transition ${active ? "border-[#6b57a8]/70 bg-[#6b57a8]/10" : "border-black/10 hover:border-[#6b57a8]/40 dark:border-white/12"}`}
                                    >
                                        <span className={`rounded-[2px] ${option === "自动" ? "border border-dashed" : "border-[1.5px]"} ${active ? "border-[#6b57a8] dark:border-[#c4b8ef]" : "border-slate-400/70"}`} style={{ width: shape.w, height: shape.h }} />
                                        <span className={`text-[9px] leading-none ${active ? "text-[#6b57a8] dark:text-[#c4b8ef]" : "opacity-60"}`}>{option}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg bg-black/[0.04] px-2 py-1 text-[10px] dark:bg-white/[0.05]">
                            <span className="font-medium">{modelName || caps.model.current}</span>
                            <span className="opacity-40">·</span>
                            <span>{ratio || caps.ratio.current}</span>
                            <span className="opacity-40">·</span>
                            <span className="opacity-60">额度无法确认</span>
                        </div>
                    </>
                ) : (
                    <p className="py-2 text-[11px] opacity-60">{capsLoading ? "正在读取豆包图片参数…" : capsError || "选好账号后会自动读取一次（之后走缓存）"}</p>
                )}
            </div>

            <label className="mb-2 block">
                <span className="mb-1 block text-[11px] opacity-60">提示词</span>
                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="例如：赛博朋克风格的城市夜景，霓虹灯反射在湿漉漉的街道上" />
            </label>

            <div className="mb-2">
                <div className="mb-1 flex items-center gap-2 text-[11px] opacity-60">
                    <span>参考图</span>
                    <span className="opacity-70">上游 {upstream.length} 张 · 本地 {localFiles.length} 张</span>
                    <label className="ml-auto cursor-pointer text-[11px] text-[#6b57a8] hover:underline dark:text-[#c4b8ef]">
                        <Upload className="mr-1 inline size-3" />
                        选择文件
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                                const files = Array.from(event.target.files || []);
                                setLocalFiles((prev) => [...prev, ...files.map((file) => ({ key: `${Date.now()}-${file.name}`, name: file.name, blob: file }))]);
                                event.target.value = "";
                            }}
                        />
                    </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {upstream.map((node) => (
                        <Tag key={node.id} className="!m-0">
                            上游 · {node.title || node.type}
                        </Tag>
                    ))}
                    {localFiles.map((item) => (
                        <Tag key={item.key} closable onClose={() => setLocalFiles((prev) => prev.filter((entry) => entry.key !== item.key))} className="!m-0">
                            {item.name}
                        </Tag>
                    ))}
                    {!upstream.length && !localFiles.length ? <span className="text-[11px] opacity-40">文生图可不传参考图</span> : null}
                </div>
            </div>

            <div className="mb-2 rounded-xl border px-2.5 py-2 text-[11px] leading-5" style={{ borderColor: theme.toolbar.border }}>
                <span>比例 / 尺寸 / 张数：以豆包图片面板为准（提交后从豆包回执里读取实际值，不伪造）</span>
                {canUseImage === false ? <div className="mt-1 text-red-500">该账号能力栏没有「图像生成」</div> : null}
                {job ? <div className="mt-1 opacity-70">{job.status} · {progress}</div> : null}
            </div>

            <div className="flex items-center gap-2">
                <Button type="primary" size="small" disabled={!accountId || !prompt.trim() || running || canUseImage === false} loading={running} onClick={() => setConfirmOpen(true)}>
                    {running ? "生成中…" : "生成图片"}
                </Button>
                <span className="text-[11px] opacity-50">{capabilities ? "已读取豆包能力" : "建议先读模型"}</span>
            </div>

            <Modal open={confirmOpen} onCancel={() => setConfirmOpen(false)} onOk={() => void submit()} okText="确认生成" cancelText="取消" title="确认提交豆包图片任务" width={480}>
                <div className="grid grid-cols-[72px_1fr] gap-1 text-[12px] leading-6">
                    <span className="opacity-60">账号</span>
                    <span>{selectedAccount?.name || "未选择"}</span>
                    <span className="opacity-60">模式</span>
                    <span>{MODE_LABEL[mode]}</span>
                    <span className="opacity-60">模型</span>
                    <span>{modelName || "跟随豆包当前模型"}</span>
                    <span className="opacity-60">参考图</span>
                    <span>{upstream.length + localFiles.length || "无"}</span>
                    <span className="opacity-60">额度</span>
                    <span className="text-amber-600">无法确认（豆包网页端未提供可读额度）</span>
                    <span className="opacity-60">提示词</span>
                    <span className="line-clamp-3">{prompt}</span>
                </div>
            </Modal>
        </div>
    );
}
