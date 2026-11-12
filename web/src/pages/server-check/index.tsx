import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, LogOut, RefreshCw, Send, Server, ShieldCheck } from "lucide-react";

import {
    LIHUO_SERVER_URL,
    ServerApiError,
    chat,
    chatStream,
    listModels,
    login as apiLogin,
    logout as apiLogout,
    me as apiMe,
    type RegistryModel,
    type SessionUser,
} from "@/services/api/lihuo-server";

/**
 * 后端联调页（仅开发验证用）
 * ------------------------------------------------------------
 * 目的：在不改动画布与现有页面的前提下，验证
 *   登录会话 → 模型目录 → 计费对话（含流式）
 * 这条链路是否真的通。
 *
 * 后续把 /image 等页面切到 liHuoServer 客户端后，本页可保留为诊断工具。
 */

const CAP_LABEL: Record<string, string> = {
    text: "文本",
    image: "图像",
    video: "视频",
    audio: "音频",
    embedding: "向量",
};

export default function ServerCheckPage() {
    const [user, setUser] = useState<SessionUser | null>(null);
    const [booting, setBooting] = useState(true);

    const [username, setUsername] = useState("admin");
    const [password, setPassword] = useState("");
    const [models, setModels] = useState<RegistryModel[]>([]);
    const [gatewayError, setGatewayError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [model, setModel] = useState("");
    const [prompt, setPrompt] = useState("用一句话介绍你自己。");
    const [output, setOutput] = useState("");
    const [busy, setBusy] = useState(false);
    const [meta, setMeta] = useState<string | null>(null);

    const loadModels = useCallback(async () => {
        try {
            const res = await listModels();
            setModels(res.items);
            setGatewayError(res.gatewayError);
            const firstUsable = res.items.find((m) => m.usable && m.capability === "text");
            setModel((prev) => prev || firstUsable?.modelId || res.items[0]?.modelId || "");
        } catch (e) {
            if (e instanceof ServerApiError && e.status === 401) {
                setUser(null);
                return;
            }
            setError(e instanceof Error ? e.message : String(e));
        }
    }, []);

    // 进页面先探一次会话，已登录就直接拉模型
    useEffect(() => {
        (async () => {
            try {
                const u = await apiMe();
                setUser(u);
                await loadModels();
            } catch {
                setUser(null);
            } finally {
                setBooting(false);
            }
        })();
    }, [loadModels]);

    const handleLogin = async () => {
        setError(null);
        setBusy(true);
        try {
            const u = await apiLogin(username.trim(), password);
            setPassword("");
            setUser(u);
            await loadModels();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const handleLogout = async () => {
        await apiLogout().catch(() => undefined);
        setUser(null);
        setModels([]);
        setOutput("");
        setMeta(null);
    };

    const handleChat = async (stream: boolean) => {
        if (!model || !prompt.trim()) return;
        setBusy(true);
        setError(null);
        setOutput("");
        setMeta(null);
        try {
            if (stream) {
                let buf = "";
                await chatStream(
                    { model, messages: [{ role: "user", content: prompt }] },
                    {
                        onDelta: (d) => {
                            buf += d;
                            setOutput(buf);
                        },
                        onDone: (r) => {
                            setMeta(
                                `流式完成 · requestId=${r.requestId ?? "-"} · tokens=${r.usage?.promptTokens ?? "?"}/${r.usage?.completionTokens ?? "?"} · 本次 ${r.costCents} 分 · 余额 ${r.balanceCents} 分`,
                            );
                            setUser((u) => (u ? { ...u, quotaCents: r.balanceCents } : u));
                        },
                    },
                );
            } else {
                const r = await chat({ model, messages: [{ role: "user", content: prompt }] });
                setOutput(r.content);
                setMeta(
                    `非流式 · requestId=${r.requestId ?? "-"} · tokens=${r.usage?.promptTokens ?? "?"}/${r.usage?.completionTokens ?? "?"} · 本次 ${r.costCents} 分 · 余额 ${r.balanceCents} 分${r.replayed ? " · 幂等重放" : ""}`,
                );
                setUser((u) => (u ? { ...u, quotaCents: r.balanceCents } : u));
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-5xl px-6 py-8 text-stone-900 dark:text-stone-100">
            <header className="mb-6 flex flex-wrap items-center gap-3">
                <Link
                    to="/"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 px-3 text-xs text-stone-600 transition hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                    <ArrowLeft className="size-3.5" /> 返回
                </Link>
                <h1 className="text-lg font-semibold">后端联调</h1>
                <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    开发验证页
                </span>
                <div className="ml-auto flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                    <Server className="size-3.5" />
                    {LIHUO_SERVER_URL}
                </div>
            </header>

            {error ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                </div>
            ) : null}

            {booting ? (
                <div className="flex items-center gap-2 text-sm text-stone-500">
                    <Loader2 className="size-4 animate-spin" /> 正在检查会话…
                </div>
            ) : !user ? (
                <section className="max-w-sm rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-medium">
                        <ShieldCheck className="size-4" /> 登录离火账号
                    </h2>
                    <label className="mb-1 block text-xs text-stone-500">用户名</label>
                    <input
                        className="mb-3 h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-950"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                    <label className="mb-1 block text-xs text-stone-500">密码</label>
                    <input
                        type="password"
                        className="mb-4 h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-950"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    />
                    <button
                        onClick={handleLogin}
                        disabled={busy || !username || !password}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-stone-950 text-sm text-white transition hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950"
                    >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : null} 登录
                    </button>
                </section>
            ) : (
                <div className="space-y-4">
                    {/* 用户卡片 */}
                    <section className="flex flex-wrap items-center gap-4 rounded-xl border border-stone-200 bg-white px-5 py-4 dark:border-stone-800 dark:bg-stone-900">
                        <div>
                            <div className="text-sm font-medium">{user.username}</div>
                            <div className="text-xs text-stone-500">
                                {user.role === "admin" ? "管理员" : "普通用户"} · id {user.id}
                            </div>
                        </div>
                        <div className="ml-4">
                            <div className="text-xs text-stone-500">余额</div>
                            <div className="font-mono text-lg tabular-nums">{(user.quotaCents / 100).toFixed(2)} 元</div>
                        </div>
                        <div className="ml-auto flex gap-2">
                            <button
                                onClick={loadModels}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 px-3 text-xs transition hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                            >
                                <RefreshCw className="size-3.5" /> 刷新模型
                            </button>
                            <button
                                onClick={handleLogout}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 px-3 text-xs transition hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                            >
                                <LogOut className="size-3.5" /> 退出
                            </button>
                        </div>
                    </section>

                    {/* 模型目录 */}
                    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                        <div className="flex items-center gap-2 border-b border-stone-200 px-5 py-3 dark:border-stone-800">
                            <h2 className="text-sm font-medium">模型目录</h2>
                            <span className="text-xs text-stone-500">{models.length} 个</span>
                            {gatewayError ? (
                                <span className="ml-auto text-xs text-red-500">网关异常：{gatewayError}</span>
                            ) : null}
                        </div>
                        {models.length === 0 ? (
                            <div className="px-5 py-6 text-sm text-stone-500">
                                还没有模型。请先在离火后端注册模型（或检查网关渠道是否配置）。
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs text-stone-500">
                                        <th className="px-5 py-2 font-normal">模型</th>
                                        <th className="px-3 py-2 font-normal">能力</th>
                                        <th className="px-3 py-2 text-right font-normal">价格（分/1K）</th>
                                        <th className="px-3 py-2 font-normal">可用</th>
                                        <th className="px-5 py-2 font-normal">状态</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {models.map((m) => (
                                        <tr
                                            key={m.modelId}
                                            onClick={() => m.usable && setModel(m.modelId)}
                                            className={`cursor-pointer border-t border-stone-100 transition hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/50 ${
                                                model === m.modelId ? "bg-stone-50 dark:bg-stone-800/50" : ""
                                            }`}
                                        >
                                            <td className="px-5 py-2.5 font-medium">{m.displayName}</td>
                                            <td className="px-3 py-2.5 text-stone-500">{CAP_LABEL[m.capability] ?? m.capability}</td>
                                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-stone-600 dark:text-stone-300">
                                                {m.price ? `${m.price.inCentsPer1k} / ${m.price.outCentsPer1k}` : "—"}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <span className={m.available ? "text-emerald-600" : "text-stone-400"}>
                                                    {m.available ? "是" : "否"}
                                                </span>
                                            </td>
                                            <td className="px-5 py-2.5 text-xs">
                                                {m.usable ? (
                                                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                                        可使用
                                                    </span>
                                                ) : (
                                                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-500 dark:bg-stone-800">
                                                        {!m.enabled ? "未上架" : !m.price ? "未定价" : "上游不可用"}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>

                    {/* 对话测试 */}
                    <section className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
                        <h2 className="mb-3 text-sm font-medium">对话测试</h2>
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-stone-500">模型</span>
                            <select
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                className="h-8 rounded-lg border border-stone-200 bg-white px-2 text-sm dark:border-stone-700 dark:bg-stone-950"
                            >
                                {models.map((m) => (
                                    <option key={m.modelId} value={m.modelId} disabled={!m.usable}>
                                        {m.displayName} {m.usable ? "" : "（不可用）"}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={3}
                            className="mb-3 w-full resize-y rounded-lg border border-stone-200 bg-white p-3 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-950"
                        />
                        <div className="mb-4 flex gap-2">
                            <button
                                onClick={() => handleChat(false)}
                                disabled={busy || !model}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-stone-950 px-3 text-xs text-white transition hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950"
                            >
                                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                                非流式
                            </button>
                            <button
                                onClick={() => handleChat(true)}
                                disabled={busy || !model}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 px-3 text-xs transition hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                            >
                                流式
                            </button>
                        </div>
                        {output ? (
                            <pre className="whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm leading-6 dark:bg-stone-950">
                                {output}
                            </pre>
                        ) : null}
                        {meta ? <div className="mt-2 font-mono text-xs text-stone-500">{meta}</div> : null}
                    </section>
                </div>
            )}
        </div>
    );
}
