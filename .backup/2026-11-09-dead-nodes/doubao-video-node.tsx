import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Radio, Select, Tag, Tooltip } from "antd";
import { AlertTriangle, CheckCircle2, Film, Loader2, RefreshCw, Sparkles, Upload, Wand2 } from "lucide-react";

import { imageToDataUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { createVideoJob, fetchAccountModels, fetchVideoCaps, findJobForNode, getJob, jobFileUrl, listAccounts, uploadAttachment, waitJob, type DoubaoAccount, type DoubaoJob, type DoubaoVideoCaps } from "@/services/api/doubao-bridge";
import { DoubaoImageRefPicker, RefSummary } from "./doubao-ref-picker";
import { useDoubaoAccountStore } from "@/stores/use-doubao-account-store";
import { upgradeChannelModel, validateParamsAgainstSchema, getModelParams, type ModelDefinition } from "@/stores/model-schema";
import { DynamicParamsPanel } from "@/components/DynamicParamsPanel";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export const LIHUO_DOUBAO_VIDEO_TYPE = "lihuo:doubao-video";

type Mode = "text-to-video" | "image-to-video" | "video-to-video";

const MODE_LABEL: Record<Mode, string> = {
    "text-to-video": "文生视频",
    "image-to-video": "参考图生视频",
    "video-to-video": "参考视频生成",
};

/** 按比例画一个示意小方块，用于参数宫格。 */
function ratioShape(option: string, max = 26) {
    if (option === "自动") return { w: max, h: Math.round(max * 0.62) };
    const [a, b] = option.split(":").map(Number);
    if (!a || !b) return { w: max, h: max };
    const scale = max / Math.max(a, b);
    return { w: Math.round(a * scale), h: Math.round(b * scale) };
}

type Material = { key: string; name: string; source: "upstream" | "local"; blob?: Blob; nodeId?: string };

/** 智能推荐：只做推荐，不自动切换。 */
function recommendAccount(accounts: DoubaoAccount[]) {
    const candidates = accounts
        .filter((account) => account.state.loggedIn === true && !account.state.busy)
        .map((account) => {
            const caps = account.state.capabilities || [];
            const reasons: string[] = [];
            let score = 0;
            if (caps.includes("视频生成")) {
                score += 40;
                reasons.push("能力栏含视频生成");
            }
            if ((account.state.models || []).length) {
                score += 10;
                reasons.push("已读取到可用模型");
            }
            if (account.state.checkedAt) {
                const ageMs = Date.now() - new Date(account.state.checkedAt).getTime();
                if (ageMs < 10 * 60 * 1000) {
                    score += 15;
                    reasons.push("状态刚检测过");
                    } else if (ageMs < 60 * 60 * 1000) {
                    score += 5;
                }
            }
            return { account, score, reasons };
        })
        .sort((a, b) => b.score - a.score);
    return candidates[0] || null;
}

async function materialFromNode(node: CanvasNodeData): Promise<Material | null> {
    const content = node.metadata?.content;
    const storageKey = node.metadata?.storageKey;
    if (node.type === "image") {
        if (!content && !storageKey) return null;
        const dataUrl = await imageToDataUrl({ url: content, storageKey });
        const blob = await (await fetch(dataUrl)).blob();
        return { key: node.id, name: `${node.title || "图片"}.png`, source: "upstream", blob, nodeId: node.id };
    }
    if (node.type === "video") {
        const url = await resolveMediaUrl(storageKey, content);
        if (!url) return null;
        const blob = await (await fetch(url)).blob();
        return { key: node.id, name: `${node.title || "视频"}.mp4`, source: "upstream", blob, nodeId: node.id };
    }
    return null;
}

export function DoubaoVideoContent({ ctx }: { ctx: CanvasNodeContext }) {
    const jobId = typeof ctx.node.metadata?.jobId === "string" ? ctx.node.metadata.jobId : "";
    const status = typeof ctx.node.metadata?.status === "string" ? ctx.node.metadata.status : "idle";
    const mode = (ctx.node.metadata?.mode as Mode) || "text-to-video";
    const progress = typeof ctx.node.metadata?.progress === "string" ? ctx.node.metadata.progress : "";
    const accountName = typeof ctx.node.metadata?.accountName === "string" ? ctx.node.metadata.accountName : "";
    const modelName = typeof ctx.node.metadata?.modelName === "string" ? ctx.node.metadata.modelName : "";
    const ratio = typeof ctx.node.metadata?.ratio === "string" ? ctx.node.metadata.ratio : "";
    const duration = typeof ctx.node.metadata?.duration === "number" ? ctx.node.metadata.duration : 0;
    const resultUrl = typeof ctx.node.metadata?.resultUrl === "string" ? ctx.node.metadata.resultUrl : "";
    const currentAccountId = useDoubaoAccountStore((state) => state.currentAccountId);
    const accountId = typeof ctx.node.metadata?.accountId === "string" && ctx.node.metadata.accountId ? ctx.node.metadata.accountId : currentAccountId || "";
    const [caps, setCaps] = useState<DoubaoVideoCaps | null>((ctx.node.metadata?.videoCaps as DoubaoVideoCaps) || null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const readCaps = async (force = false) => {
        if (!accountId) {
            setError("先在面板里选账号");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const next = await fetchVideoCaps(accountId, force);
            setCaps(next);
            ctx.updateMetadata({ videoCaps: next, modelName: modelName || next.model.current, ratio: ratio || next.ratio.current, duration: duration || next.duration.current, accountId });
        } catch (err) {
            setError(err instanceof Error ? err.message : "读取失败");
        } finally {
            setLoading(false);
        }
    };

    // 只在没有缓存时自动读一次；之后卡片上的选项就是固定可选的
    useEffect(() => {
        if (!caps && accountId) void readCaps();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId]);

    // 结果兜底：面板关掉/刷新也不丢，卡片自己按 nodeId 找回任务并把结果写回本节点
    useEffect(() => {
        if (resultUrl) return;
        let alive = true;
        const sync = async () => {
            try {
                const found = jobId ? await getJob(jobId).catch(() => null) : await findJobForNode(ctx.node.id);
                if (!alive || !found) return;
                if (found.nodeId !== ctx.node.id) return;
                if (found.id !== jobId) ctx.updateMetadata({ jobId: found.id });
                if (found.status === "running" || found.status === "queued") {
                    ctx.updateMetadata({ status: "loading", progress: found.progress || "生成中…" });
                } else if (found.status === "succeeded" && found.files.length) {
                    ctx.updateMetadata({
                        status: "success",
                        jobId: found.id,
                        resultUrl: jobFileUrl(found.id, found.files[0].index),
                        progress: `已完成 · ${(found.files[0].kind === "video" ? "视频" : "文件")}`,
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
    }, [resultUrl, jobId, ctx.node.id]);

    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

    return (
        <div data-canvas-no-zoom className="flex size-full flex-col gap-1.5 p-2.5" style={{ color: ctx.theme.node.text }} onMouseDown={stop} onPointerDown={stop} onWheel={stop}>
            <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-lg bg-[#6b57a8]/12 text-[#6b57a8] dark:bg-[#b9ace8]/15 dark:text-[#c4b8ef]">
                    <Film className="size-3" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">豆包视频 · {MODE_LABEL[mode]}</p>
                    <p className="truncate text-[10px]" style={{ color: ctx.theme.node.muted }}>
                        {accountName || "未选账号"}
                        {jobId ? ` · ${jobId.slice(0, 10)}…` : ""}
                    </p>
                </div>
                {status === "loading" ? <Loader2 className="size-3.5 animate-spin" style={{ color: ctx.theme.node.muted }} /> : null}
            </div>

            <div className="grid grid-cols-2 gap-1">
                <Select
                    size="small"
                    value={modelName || undefined}
                    placeholder={caps ? "模型" : "先读参数"}
                    disabled={!caps}
                    onChange={(value) => ctx.updateMetadata({ modelName: value })}
                    options={(caps?.model.options || []).map((option) => ({ value: option, label: option }))}
                    className="!text-[11px]"
                />
                <Select
                    size="small"
                    value={ratio || undefined}
                    placeholder="比例"
                    disabled={!caps}
                    onChange={(value) => ctx.updateMetadata({ ratio: value })}
                    options={(caps?.ratio.options || []).map((option) => ({ value: option, label: option }))}
                    className="!text-[11px]"
                />
            </div>
            <div className="flex items-center gap-1">
                <Select
                    size="small"
                    value={duration || undefined}
                    placeholder="时长"
                    disabled={!caps}
                    onChange={(value) => ctx.updateMetadata({ duration: value })}
                    options={caps?.duration.min && caps?.duration.max ? Array.from({ length: caps.duration.max - caps.duration.min + 1 }, (_, index) => ({ value: caps.duration.min! + index, label: `${caps.duration.min! + index}s` })) : []}
                    className="min-w-0 flex-1 !text-[11px]"
                />
                <Button size="small" loading={loading} onClick={() => void readCaps()} icon={<RefreshCw className="size-3" />} className="!px-1.5" title="读取豆包视频参数" />
                <Button size="small" onClick={ctx.openPanel} icon={<Wand2 className="size-3" />} className="!px-1.5" title="打开生成面板" />
            </div>

            {resultUrl ? (
                <video src={resultUrl} controls className="min-h-0 w-full flex-1 rounded-md bg-black/30 object-contain" />
            ) : (
                <p className="line-clamp-2 min-h-0 flex-1 text-[10px] leading-4" style={{ color: ctx.theme.node.muted }}>
                    {error || progress || "点右侧按钮读豆包参数，或打开面板生成"}
                </p>
            )}
        </div>
    );
}

export function DoubaoVideoPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { message } = App.useApp();
    const currentAccountId = useDoubaoAccountStore((state) => state.currentAccountId);
    const setCurrentAccount = useDoubaoAccountStore((state) => state.setCurrentAccount);

    const [mode, setMode] = useState<Mode>((ctx.node.metadata?.mode as Mode) || "text-to-video");
    const [prompt, setPrompt] = useState(String(ctx.node.metadata?.prompt || ""));
    const [accounts, setAccounts] = useState<DoubaoAccount[]>([]);
    const [accountsError, setAccountsError] = useState("");
    const [accountId, setAccountId] = useState<string>(currentAccountId || "");
    // 账号分配模式：manual（手动选）/ auto（自动分配）
    const [accountMode, setAccountMode] = useState<"manual" | "auto">(
        (ctx.node.metadata?.accountSelectionMode as "manual" | "auto") || "manual",
    );
    const [localMaterials, setLocalMaterials] = useState<{ key: string; name: string; blob: Blob }[]>([]);
    // 手动勾选的画布图片节点（不依赖拖线，避免连线没被识别）
    const [manualRefIds, setManualRefIds] = useState<string[]>(Array.isArray(ctx.node.metadata?.manualRefNodeIds) ? (ctx.node.metadata.manualRefNodeIds as string[]) : []);
    const [models, setModels] = useState<string[] | null>(null);
    const [capabilities, setCapabilities] = useState<string[] | null>(null);
    const [checkError, setCheckError] = useState("");
    const [checking, setChecking] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [job, setJob] = useState<DoubaoJob | null>(null);
    const [caps, setCaps] = useState<DoubaoVideoCaps | null>((ctx.node.metadata?.videoCaps as DoubaoVideoCaps) || null);
    const [capsLoading, setCapsLoading] = useState(false);
    const [capsError, setCapsError] = useState("");
    const [modelName, setModelName] = useState<string>((ctx.node.metadata?.modelName as string) || "");
    const [ratio, setRatio] = useState<string>((ctx.node.metadata?.ratio as string) || "");
    const [duration, setDuration] = useState<number>((ctx.node.metadata?.duration as number) || 0);

    // ========== 动态参数 Schema 接入（实验性） ==========
    // 当前模型的 ModelDefinition（有 Schema 才返回，没有就 null）
    const modelDef: ModelDefinition | null = useMemo(() => {
        // 如果有 modelName，按具体模型查
        if (modelName) {
            const def = upgradeChannelModel("builtin-doubao", { name: modelName, capability: "video" });
            if (def && def.capability === "video") return def;
        }
        // 没有 modelName 时，用默认的豆包视频 Schema（保证面板能显示）
        const def = upgradeChannelModel("builtin-doubao", { name: "default-video", capability: "video" });
        return def;
    }, [modelName]);

    // 参数缓存：存在 metadata.paramsCache[modelId] 里，按模型独立保存
    const paramsCache = useMemo(() => {
        const raw = ctx.node.metadata?.paramsCache;
        return (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;
    }, [ctx.node.metadata?.paramsCache]);

    // 当前模型的参数值
    const currentParams = useMemo(() => {
        if (!modelDef) return {};
        const modelId = modelDef.modelId;
        // 先从缓存取
        const cached = paramsCache[modelId];
        if (cached && Object.keys(cached).length > 0) {
            return validateParamsAgainstSchema(cached, modelDef.parameterSchema || []);
        }
        // 没有缓存，用默认值
        return modelDef.defaults || {};
    }, [modelDef, paramsCache]);

    // 更新当前模型的参数（写入缓存，不影响其他模型）
    const updateModelParam = useCallback((key: string, value: unknown) => {
        if (!modelDef) return;
        const modelId = modelDef.modelId;
        const nextCache = {
            ...paramsCache,
            [modelId]: {
                ...currentParams,
                [key]: value,
            },
        };
        ctx.updateMetadata({ paramsCache: nextCache });
    }, [modelDef, paramsCache, currentParams, ctx]);
    // ========== 动态参数 Schema 接入结束 ==========

    // 不用 useMemo：连线是另一份状态，缓存会导致「刚连上的图片」读不到
    const upstreamNodes = ctx.getUpstream().filter((node) => node.type === "image" || node.type === "video");
    const selectedAccount = accounts.find((account) => account.id === accountId) || null;
    const recommendation = useMemo(() => recommendAccount(accounts), [accounts]);
    const canUseVideo = capabilities ? capabilities.includes("视频生成") : null;

    const refreshAccounts = useCallback(async () => {
        setAccountsError("");
        try {
            const next = await listAccounts();
            setAccounts(next);
            if (!accountId) {
                const preferred = next.find((account) => account.id === currentAccountId) || next.find((account) => account.state.loggedIn) || next[0];
                if (preferred) setAccountId(preferred.id);
            }
        } catch (error) {
            setAccountsError(error instanceof Error ? error.message : "读取账号失败");
        }
    }, [accountId, currentAccountId]);

    useEffect(() => {
        void refreshAccounts();
    }, [refreshAccounts]);

    // 选好账号就自动读一次豆包参数（服务端有 12 小时缓存，不会每次都开浏览器核验）
    useEffect(() => {
        if (!accountId || caps) return;
        setCapsLoading(true);
        void fetchVideoCaps(accountId)
            .then((next) => {
                setCaps(next);
                setRatio((prev) => prev || next.ratio.current || "");
                setDuration((prev) => prev || next.duration.current || 0);
                ctx.updateMetadata({ videoCaps: next, ratio: ctx.node.metadata?.ratio ?? next.ratio.current, duration: ctx.node.metadata?.duration ?? next.duration.current, accountId });
            })
            .catch((error) => setCapsError(error instanceof Error ? error.message : "读取失败"))
            .finally(() => setCapsLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId]);

    const runCheck = useCallback(async () => {
        if (!accountId) {
            setCheckError("先选择一个账号");
            return;
        }
        setChecking(true);
        setCheckError("");
        try {
            const info = await fetchAccountModels(accountId);
            setModels(info.options);
            setCapabilities(info.capabilities);
        } catch (error) {
            setModels(null);
            setCapabilities(null);
            setCheckError(error instanceof Error ? error.message : "读取失败");
        } finally {
            setChecking(false);
        }
    }, [accountId]);

    const materials: Material[] = useMemo(() => {
        const list: Material[] = upstreamNodes.map((node) => ({ key: node.id, name: `${node.title || node.type}`, source: "upstream" as const, nodeId: node.id }));
        return [...list, ...localMaterials.map((item) => ({ key: item.key, name: item.name, source: "local" as const, blob: item.blob }))];
    }, [upstreamNodes, localMaterials]);

    const submit = useCallback(async () => {
        if ((accountMode === "manual" && !accountId) || !prompt.trim()) return;
        setRunning(true);
        setConfirmOpen(false);
        try {
            // 1) 素材真实上传：上游连线 + 手动勾选 + 本地文件
            const paths: string[] = [];
            const seen = new Set<string>();
            // 提交前重新读一次连线，确保刚连上的图片也会一起提交
            const connected = ctx.getUpstream().filter((node) => node.type === "image" || node.type === "video");
            const manual = manualRefIds.map((id) => ctx.getNode(id)).filter((node): node is NonNullable<typeof node> => Boolean(node));
            for (const node of [...connected, ...manual]) {
                if (seen.has(node.id)) continue;
                seen.add(node.id);
                const material = await materialFromNode(node);
                if (!material?.blob) {
                    message.warning(`「${node.title || node.type}」的素材读不到字节，已跳过`);
                    continue;
                }
                paths.push(await uploadAttachment(accountId, material.blob, material.name));
            }
            message.info(`本次提交参考素材 ${paths.length} 个`);
            for (const item of localMaterials) {
                paths.push(await uploadAttachment(accountId, item.blob, item.name));
            }

            // 2) 提交任务（真实调用 dbb ask --capability 视频生成）
            // 统一参数读取：优先用 paramsCache，没有就从旧字段迁移
            const activeModelName = modelName || caps?.model.current || "";
            const { params: rawParams, migrated } = activeModelName ? getModelParams({
                providerId: "builtin-doubao",
                modelName: activeModelName,
                metadata: ctx.node.metadata || {},
                schema: modelDef?.parameterSchema,
            }) : { params: {}, migrated: false };
            // Schema 校验
            const submittedParams = modelDef?.parameterSchema
                ? validateParamsAgainstSchema(rawParams, modelDef.parameterSchema)
                : rawParams;

            const created = await createVideoJob({
                nodeId: ctx.node.id,
                accountId: accountMode === "manual" ? accountId : undefined,
                accountSelectionMode: accountMode,
                prompt: prompt.trim(),
                attachments: paths,
                mode,
                modelName: activeModelName || undefined,
                expectedArtifactKind: "video",
                requestedParams: {
                    model: activeModelName,
                    ratio: submittedParams.ratio || caps?.ratio.current,
                    duration: submittedParams.duration ?? caps?.duration.current,
                },
            });
            ctx.updateMetadata({
                prompt: prompt.trim(),
                mode,
                jobId: created.id,
                status: "loading",
                progress: "任务已提交，等待豆包处理…",
                accountName: selectedAccount?.name,
                modelName: modelName || caps?.model.current || null,
                submittedParams: caps ? `模型 ${modelName || caps.model.current} · 比例 ${caps.ratio.current} · 时长 ${caps.duration.current}s` : null,
            });

            // 3) 轮询
            const finished = await waitJob(created.id, (current) => {
                setJob(current);
                ctx.updateMetadata({ progress: current.progress || current.status });
            });

            if (finished.status === "succeeded" && finished.files.length) {
                const file = finished.files[0];
                // 结果只回本节点（不再另开节点），卡片里可直接播放
                ctx.updateMetadata({ status: "success", progress: `已完成 · ${Math.round((finished.elapsedMs || 0) / 1000)}s`, resultUrl: jobFileUrl(finished.id, file.index), jobId: finished.id });
                message.success("视频已生成，已回填到本卡片");
            } else {
                ctx.updateMetadata({ status: "error", progress: finished.error?.message || "生成失败" });
                message.error(finished.error?.message || "生成失败");
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            ctx.updateMetadata({ status: "error", progress: text });
            message.error(text);
        } finally {
            setRunning(false);
        }
    }, [accountId, ctx, localMaterials, message, mode, prompt, upstreamNodes]);

    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
    const theme = ctx.theme;

    return (
        <div
            data-canvas-no-zoom
            className="max-h-[72vh] overflow-y-auto rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={stop}
            onPointerDown={stop}
            onWheel={stop}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                    <Film className="size-3.5" /> 豆包视频生成
                </div>
                <Button size="small" type="text" onClick={onClose}>
                    关闭
                </Button>
            </div>

            {accountsError ? <div className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">桥接服务不可用：{accountsError}（双击 open-canvas.bat 会拉起）</div> : null}

            <div className="mb-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-[11px] opacity-60">生成模式</span>
                    <Radio.Group
                        value={mode}
                        size="small"
                        onChange={(event) => setMode(event.target.value as Mode)}
                        options={[
                            { label: "文生视频", value: "text-to-video" },
                            { label: "参考图", value: "image-to-video" },
                            { label: "参考视频", value: "video-to-video" },
                        ]}
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-[11px] opacity-60">账号分配方式</span>
                    <Select
                        size="small"
                        value={accountMode}
                        onChange={(value) => {
                            setAccountMode(value as "manual" | "auto");
                            ctx.updateMetadata({ accountSelectionMode: value });
                        }}
                        options={[
                            { value: "manual", label: "手动选择账号" },
                            { value: "auto", label: "自动分配（额度未知时不可用）" },
                        ]}
                    />
                </label>
                {accountMode === "manual" ? (
                <label className="block">
                    <span className="mb-1 block text-[11px] opacity-60">账号（手动指定）</span>
                    <div className="flex gap-1">
                        <Select
                            size="small"
                            className="min-w-0 flex-1"
                            value={accountId || undefined}
                            placeholder={accounts.length ? "选择账号" : "还没有账号"}
                            onChange={(value) => {
                                setAccountId(value);
                                setCurrentAccount(value);
                                setModels(null);
                                setCapabilities(null);
                                const target = accounts.find((account) => account.id === value);
                                ctx.updateMetadata({ accountId: value, accountName: target?.name ?? null });
                            }}
                            options={accounts.map((account) => ({
                                value: account.id,
                                label: `${account.name}${account.state.loggedIn === true ? "" : account.state.loggedIn === false ? "（未登录）" : "（登录态未知）"}${account.state.busy ? "（忙）" : ""}`,
                            }))}
                        />
                        <Tooltip title="重新读取账号列表">
                            <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void refreshAccounts()} />
                        </Tooltip>
                    </div>
                </label>
                ) : (
                <div className="rounded-lg bg-blue-500/10 px-3 py-2 text-[11px] text-blue-500">
                    自动分配模式：Bridge 自动选择已登录且额度充足的账号。
                    <br />⚠️ 目前额度均为「未知」，自动分配会失败，请切回手动模式。
                </div>
                )}
                <label className="block">
                    <span className="mb-1 block text-[11px] opacity-60">视频模型（读自豆包）</span>
                    <Select
                        size="small"
                        className="w-full"
                        value={modelName || undefined}
                        placeholder={caps ? "跟随豆包当前模型" : "先点「读视频参数」"}
                        disabled={!caps}
                        onChange={(value) => {
                            setModelName(value);
                            ctx.updateMetadata({ modelName: value });
                        }}
                        options={(caps?.model.options || []).map((option) => ({ value: option, label: option }))}
                    />
                </label>
            </div>

            {recommendation && recommendation.account.id !== accountId ? (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#6b57a8]/25 bg-[#6b57a8]/[0.06] px-2.5 py-2 text-[11px]">
                    <Sparkles className="size-3.5 text-[#6b57a8] dark:text-[#c4b8ef]" />
                    <span>
                        智能推荐：<b>{recommendation.account.name}</b>
                        {recommendation.reasons.length ? `（${recommendation.reasons.join("、")}）` : ""}
                    </span>
                    <Button
                        size="small"
                        className="!ml-auto"
                        onClick={() => {
                            setAccountId(recommendation.account.id);
                            setCurrentAccount(recommendation.account.id);
                            setModels(null);
                            setCapabilities(null);
                        }}
                    >
                        采用推荐
                    </Button>
                </div>
            ) : null}

            <label className="mb-2 block">
                <span className="mb-1 block text-[11px] opacity-60">提示词</span>
                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="例如：一只熊猫在竹林里啃竹子，阳光斑驳，镜头缓慢推进" />
            </label>

            <div className="mb-2">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] opacity-60">
                    <span>参考素材</span>
                    <RefSummary linked={upstreamNodes.length} manual={manualRefIds.length} />
                    <span className="opacity-70">本地上传 {localMaterials.length} 个</span>
                    <div className="ml-auto flex items-center gap-1">
                        <DoubaoImageRefPicker
                            nodes={ctx.getNodes()}
                            selectedIds={manualRefIds}
                            onChange={(ids) => {
                                setManualRefIds(ids);
                                ctx.updateMetadata({ manualRefNodeIds: ids });
                            }}
                        />
                        <label className="cursor-pointer text-[11px] text-[#6b57a8] hover:underline dark:text-[#c4b8ef]">
                            <Upload className="mr-1 inline size-3" />
                            选择文件
                            <input
                                type="file"
                                accept="image/*,video/*"
                                multiple
                                className="hidden"
                                onChange={(event) => {
                                    const files = Array.from(event.target.files || []);
                                    setLocalMaterials((prev) => [...prev, ...files.map((file) => ({ key: `${Date.now()}-${file.name}`, name: file.name, blob: file }))]);
                                    event.target.value = "";
                                }}
                            />
                        </label>
                    </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                    {upstreamNodes.map((node) => (
                        <Tag key={`link-${node.id}`} className="!m-0">
                            连线 · {node.title || node.type}
                        </Tag>
                    ))}
                    {manualRefIds.map((id) => {
                        const node = ctx.getNode(id);
                        return (
                            <Tag key={`manual-${id}`} closable onClose={() => {
                                const next = manualRefIds.filter((item) => item !== id);
                                setManualRefIds(next);
                                ctx.updateMetadata({ manualRefNodeIds: next });
                            }} className="!m-0">
                                勾选 · {node?.title || "图片"}
                            </Tag>
                        );
                    })}
                    {localMaterials.map((item) => (
                        <Tag key={item.key} closable onClose={() => setLocalMaterials((prev) => prev.filter((entry) => entry.key !== item.key))} className="!m-0">
                            {item.name}
                        </Tag>
                    ))}
                </div>
            </div>

            <div className="mb-2 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.toolbar.border }}>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px]">
                    <span className="font-medium">视频参数</span>
                    <span className="opacity-50">读自豆包{caps?.readAt ? ` · ${new Date(caps.readAt).toLocaleDateString()}` : ""}</span>
                    <button
                        type="button"
                        className="ml-auto cursor-pointer rounded p-0.5 opacity-50 hover:opacity-100"
                        title="刷新豆包参数"
                        onClick={() => {
                            if (!accountId) {
                                setCapsError("先选账号");
                                return;
                            }
                            setCapsLoading(true);
                            void fetchVideoCaps(accountId, true)
                                .then((next) => {
                                    setCaps(next);
                                    ctx.updateMetadata({ videoCaps: next });
                                })
                                .catch((error) => setCapsError(error instanceof Error ? error.message : "读取失败"))
                                .finally(() => setCapsLoading(false));
                        }}
                    >
                        {capsLoading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    </button>
                </div>

                {caps ? (
                    <>
                        <div className="mb-1 text-[10px] opacity-50">比例</div>
                        <div className="grid grid-cols-7 gap-1">
                            {caps.ratio.options.map((option) => {
                                const active = (ratio || caps.ratio.current) === option;
                                const shape = ratioShape(option, 20);
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

                        <div className="mt-2 grid grid-cols-2 gap-1">
                            <label className="block">
                                <span className="mb-0.5 block text-[10px] opacity-50">模型</span>
                                <Select
                                    size="small"
                                    className="w-full"
                                    value={modelName || caps.model.current || undefined}
                                    onChange={(value) => {
                                        setModelName(value);
                                        ctx.updateMetadata({ modelName: value });
                                    }}
                                    options={caps.model.options.map((option) => ({ value: option, label: option }))}
                                />
                            </label>
                            <label className="block">
                                <span className="mb-0.5 block text-[10px] opacity-50">时长</span>
                                <Select
                                    size="small"
                                    className="w-full"
                                    value={duration || caps.duration.current || undefined}
                                    onChange={(value) => {
                                        setDuration(value);
                                        ctx.updateMetadata({ duration: value });
                                    }}
                                    options={Array.from({ length: (caps.duration.max ?? 15) - (caps.duration.min ?? 4) + 1 }, (_, index) => {
                                        const value = (caps.duration.min ?? 4) + index;
                                        return { value, label: `${value}s` };
                                    })}
                                />
                            </label>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg bg-black/[0.04] px-2 py-1 text-[10px] dark:bg-white/[0.05]">
                            <span className="font-medium">{modelName || caps.model.current}</span>
                            <span className="opacity-40">·</span>
                            <span>{ratio || caps.ratio.current}</span>
                            <span className="opacity-40">·</span>
                            <span>{duration || caps.duration.current}s</span>
                            <span className="opacity-40">·</span>
                            <span className="opacity-60">额度无法确认</span>
                        </div>
                    </>
                ) : (
                    <p className="py-2 text-[11px] opacity-60">{capsLoading ? "正在读取豆包参数…" : capsError || "选好账号后会自动读取一次豆包参数（之后走缓存）"}</p>
                )}

                {/* ========== 动态参数 Schema 面板（实验性） ========== */}
                {modelDef?.parameterSchema && modelDef.parameterSchema.length > 0 && (
                    <div className="mt-3 rounded-lg border border-dashed px-2.5 py-2" style={{ borderColor: theme.toolbar.border }}>
                        <div className="mb-2 text-[10px] font-medium opacity-50">
                            动态参数面板（Schema 驱动 · 实验性）
                        </div>
                        <DynamicParamsPanel
                            schema={modelDef.parameterSchema}
                            values={currentParams}
                            onChange={updateModelParam}
                        />
                    </div>
                )}
                {/* ========== 动态参数面板结束 ========== */}

                {canUseVideo === false ? <div className="mt-1 text-[11px] text-red-500">该账号能力栏没有「视频生成」</div> : null}
                {checkError ? <div className="mt-1 text-[11px] text-red-500">{checkError}</div> : null}
            </div>

            <div className="flex items-center gap-2">
                <Button
                    type="primary"
                    size="small"
                    disabled={(accountMode === "manual" && !accountId) || !prompt.trim() || running || canUseVideo === false}
                    loading={running}
                    onClick={() => setConfirmOpen(true)}
                >
                    {running ? "生成中…" : "生成视频"}
                </Button>
                <span className="text-[11px] opacity-50">{job ? `${job.status} · ${job.progress || ""}` : "提交前会先弹确认窗口"}</span>
            </div>

            <Modal
                open={confirmOpen}
                onCancel={() => setConfirmOpen(false)}
                onOk={() => void submit()}
                okText="确认生成"
                cancelText="取消"
                title="确认提交豆包视频任务"
                width={520}
            >
                <div className="space-y-2 text-[12px] leading-6">
                    <div className="grid grid-cols-[80px_1fr] gap-1">
                        <span className="opacity-60">账号</span>
                        <span>{selectedAccount?.name || "未选择"}{selectedAccount?.state.loggedIn ? "（已登录）" : "（未确认登录）"}</span>
                        <span className="opacity-60">生成模式</span>
                        <span>{MODE_LABEL[mode]}</span>
                        <span className="opacity-60">能力</span>
                        <span>视频生成{capabilities ? (canUseVideo ? "（已验证可用）" : "（当前不可用）") : "（未核验）"}</span>
                        <span className="opacity-60">模型</span>
                        <span>{models?.length ? models.join(" / ") : "未读取（以豆包实际为准）"}</span>
                        <span className="opacity-60">素材</span>
                        <span>{materials.length ? materials.map((item) => item.name).join("、") : "无"}</span>
                        <span className="opacity-60">额度</span>
                        <span className="text-amber-600">无法确认（请在豆包网页端查看剩余额度）</span>
                        <span className="opacity-60">提示词</span>
                        <span className="line-clamp-3">{prompt}</span>
                    </div>
                    <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mr-1 inline size-3" />
                        豆包会在生成前列参数并要求确认，dbb 默认自动回复「确认」；视频通常 3–10 分钟，产物带平台水印。这些都由豆包网页端决定，本系统不改参数、不代你确认额度消耗。
                    </div>
                </div>
            </Modal>
        </div>
    );
}
