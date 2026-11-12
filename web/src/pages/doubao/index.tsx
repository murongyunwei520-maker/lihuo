import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Modal, Select, Spin, Tag, Tooltip } from "antd";
import { CheckCircle2, CircleDashed, Loader2, MonitorSmartphone, Plus, QrCode, RefreshCw, Trash2, UserRound } from "lucide-react";

import {
    bridgeHealth,
    cancelQrLogin,
    checkAccount,
    createAccount,
    deleteAccount,
    fetchQrStatus,
    fetchWindowStatus,
    listAccounts,
    listJobs,
    logoutAccount,
    qrImageUrl,
    startQrLogin,
    startWindowLogin,
    cancelWindowLogin,
    type DoubaoAccount,
    type DoubaoJob,
    type DoubaoQrStatus,
    type DoubaoWindowStatus,
    DOUBAO_BRIDGE_URL,
} from "@/services/api/doubao-bridge";
import { useDoubaoAccountStore } from "@/stores/use-doubao-account-store";

// 豆包账号中心：账号池由用户管理，系统只负责读取真实状态与推荐。
export default function DoubaoAccountPage() {
    const { message, modal } = App.useApp();
    const currentAccountId = useDoubaoAccountStore((state) => state.currentAccountId);
    const setCurrentAccount = useDoubaoAccountStore((state) => state.setCurrentAccount);

    const [online, setOnline] = useState<boolean | null>(null);
    const [accounts, setAccounts] = useState<DoubaoAccount[]>([]);
    const [jobs, setJobs] = useState<DoubaoJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [newName, setNewName] = useState("");
    // 账号所属站点：豆包（国内）/ Dola（国际版）
    const [newProvider, setNewProvider] = useState<"doubao" | "dola">("doubao");
    const [qrAccount, setQrAccount] = useState<DoubaoAccount | null>(null);
    const [loginMode, setLoginMode] = useState<"window" | "qr">("qr");
    const [windowStatus, setWindowStatus] = useState<DoubaoWindowStatus>({ state: "starting" });
    const [qrStatus, setQrStatus] = useState<DoubaoQrStatus>({ state: "starting" });
    const [qrBust, setQrBust] = useState(() => Date.now());

    const refresh = useCallback(async () => {
        try {
            await bridgeHealth();
            setOnline(true);
            const [nextAccounts, nextJobs] = await Promise.all([listAccounts(), listJobs(8).catch(() => [])]);
            setAccounts(nextAccounts);
            setJobs(nextJobs);
        } catch {
            setOnline(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => void refresh(), 15000);
        return () => window.clearInterval(timer);
    }, [refresh]);

    // 当前账号失效时清空，避免界面指向不存在的账号。
    useEffect(() => {
        if (!currentAccountId) return;
        if (accounts.length && !accounts.some((account) => account.id === currentAccountId)) setCurrentAccount(null);
    }, [accounts, currentAccountId, setCurrentAccount]);

    const handleAdd = async () => {
        const name = newName.trim();
        if (!name) return;
        try {
            const account = await createAccount(name, newProvider);
            setNewName("");
            setAddOpen(false);
            setAccounts((prev) => [...prev, account]);
            message.success(`已添加「${name}」，点卡片上的「登录」扫码完成授权`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "添加失败");
        }
    };

    const handleLogin = async (account: DoubaoAccount) => {
        setBusyId(account.id);
        setQrAccount(account);
        // 默认就在当前页面出二维码，不开窗口
        setLoginMode("qr");
        setQrStatus({ state: "starting", message: "正在向豆包申请二维码…" });
        setQrBust(Date.now());
        try {
            await startQrLogin(account.id);
            setQrBust(Date.now());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "获取二维码失败");
        } finally {
            setBusyId(null);
        }
    };

    // 窗口登录：窗口不会自己关，只有检测到真正的会话 cookie 才会变成 logged_in
    useEffect(() => {
        if (!qrAccount || loginMode !== "window") return;
        const timer = window.setInterval(() => {
            void fetchWindowStatus(qrAccount.id)
                .then(({ status }) => {
                    setWindowStatus(status);
                    if (status.state === "logged_in") {
                        message.success(`「${qrAccount.name}」登录成功`);
                        setQrAccount(null);
                        void refresh();
                    } else if (["timeout", "closed", "canceled"].includes(status.state)) {
                        setQrAccount(null);
                        message.warning(status.message || "登录未完成");
                        void refresh();
                    }
                })
                .catch(() => undefined);
        }, 2000);
        return () => window.clearInterval(timer);
    }, [qrAccount, loginMode, message, refresh]);

    // 扫码登录：轮询状态 + 自动换码（豆包二维码约 1 分钟过期）
    useEffect(() => {
        if (!qrAccount || loginMode !== "qr") return;
        const timer = window.setInterval(() => {
            void fetchQrStatus(qrAccount.id)
                .then(({ status }) => {
                    setQrStatus(status);
                    setQrBust(Date.now());
                    if (status.state === "logged_in") {
                        message.success(`「${qrAccount.name}」登录成功`);
                        setQrAccount(null);
                        void refresh();
                    } else if (status.state === "error" && /过期/.test(status.message || "")) {
                        // 过期就自动再申请一张，不用手动点
                        void startQrLogin(qrAccount.id).then(() => setQrBust(Date.now()));
                    }
                })
                .catch(() => undefined);
        }, 2000);
        return () => window.clearInterval(timer);
    }, [qrAccount, loginMode, message, refresh]);

    const switchToQr = async () => {
        if (!qrAccount) return;
        setLoginMode("qr");
        setQrStatus({ state: "starting", message: "正在申请二维码…" });
        setQrBust(Date.now());
        await startWindowLoginCancel(qrAccount.id);
        await startQrLogin(qrAccount.id).catch(() => undefined);
        setQrBust(Date.now());
    };

    const startWindowLoginCancel = async (accountId: string) => {
        await cancelWindowLogin(accountId).catch(() => undefined);
    };

    const switchToWindow = async () => {
        if (!qrAccount) return;
        setLoginMode("window");
        setWindowStatus({ state: "starting", message: "正在打开登录窗口…" });
        await cancelQrLogin(qrAccount.id).catch(() => undefined);
        await startWindowLogin(qrAccount.id).catch(() => undefined);
    };

    const closeQr = async () => {
        if (qrAccount) {
            await cancelQrLogin(qrAccount.id).catch(() => undefined);
            await cancelWindowLogin(qrAccount.id).catch(() => undefined);
        }
        setQrAccount(null);
    };

    const handleCheck = async (account: DoubaoAccount) => {
        setBusyId(account.id);
        try {
            const doctor = await checkAccount(account.id);
            setAccounts((prev) => prev.map((item) => (item.id === account.id ? { ...item, state: { ...item.state, loggedIn: doctor.loggedIn, checkedAt: doctor.checkedAt, models: doctor.models } } : item)));
            message.success(doctor.loggedIn ? "已登录" : "未登录（或登录态已过期）");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "检测失败");
        } finally {
            setBusyId(null);
        }
    };

    const handleLogout = (account: DoubaoAccount) => {
        modal.confirm({
            title: `退出「${account.name}」的登录？`,
            content: "会清除该账号独立的浏览器 profile 与登录态，不影响其他账号。",
            okText: "退出登录",
            okButtonProps: { danger: true },
            onOk: async () => {
                await logoutAccount(account.id);
                setAccounts((prev) => prev.map((item) => (item.id === account.id ? { ...item, state: { ...item.state, loggedIn: false, models: null } } : item)));
                message.success("已退出登录");
            },
        });
    };

    const handleDelete = (account: DoubaoAccount) => {
        modal.confirm({
            title: `删除「${account.name}」？`,
            content: "会删除该账号在本地的独立 profile、登录态和下载目录，无法恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                await deleteAccount(account.id);
                setAccounts((prev) => prev.filter((item) => item.id !== account.id));
                if (currentAccountId === account.id) setCurrentAccount(null);
                message.success("已删除");
            },
        });
    };

    const currentAccount = accounts.find((account) => account.id === currentAccountId) || null;

    return (
        <main className="h-full overflow-y-auto bg-[#f6f4fa] text-slate-950 dark:bg-[#0a0810] dark:text-white">
            <div className="mx-auto w-full max-w-[1080px] px-6 py-8">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#6b57a8] dark:text-[#b9ace8]">LIHUO · DOUBAO</p>
                        <h1 className="mt-2 text-2xl font-semibold tracking-tight">离火 · 豆包账号中心</h1>
                    </div>
                    <Tag color={online === null ? "default" : online ? "green" : "red"} className="!m-0">
                        {online === null ? "检测中" : online ? "桥接服务已连接" : "桥接服务未运行"}
                    </Tag>
                </div>

                {online === false ? (
                    <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-[13px] leading-6 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                        <p className="font-medium">本地桥接服务没有运行</p>
                        <p className="mt-1">
                            服务地址 <code className="rounded bg-black/10 px-1">{DOUBAO_BRIDGE_URL}</code>。双击仓库根目录的 <code className="rounded bg-black/10 px-1">open-canvas.bat</code> 会自动拉起它；也可以单独运行{" "}
                            <code className="rounded bg-black/10 px-1">node doubao-bridge/server.mjs</code>。
                        </p>
                    </div>
                ) : null}

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div>
                        <p className="text-[13px] text-slate-500 dark:text-white/45">账号总数</p>
                        <p className="mt-1 text-2xl font-semibold">{accounts.length}</p>
                    </div>
                    <div className="sm:text-right">
                        <p className="text-[13px] text-slate-500 dark:text-white/45">当前使用账号</p>
                        <p className="mt-1 text-lg font-semibold">{currentAccount ? currentAccount.name : "未指定"}</p>
                    </div>
                </div>

                <div className="mt-6 space-y-3">
                    {loading ? (
                        <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white py-16 dark:border-white/10 dark:bg-[#12101c]">
                            <Spin />
                        </div>
                    ) : null}

                    {!loading && !accounts.length ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 py-14 text-center text-[13px] text-slate-500 dark:border-white/15 dark:bg-white/[0.02] dark:text-white/40">
                            还没有账号，先添加一个（可选豆包 / Dola），再点「登录」扫码授权。
                        </div>
                    ) : null}

                    {accounts.map((account) => {
                        const loggedIn = account.state.loggedIn;
                        const busy = busyId === account.id || account.state.loginRunning;
                        const isCurrent = account.id === currentAccountId;
                        return (
                            <div
                                key={account.id}
                                className={`rounded-2xl border bg-white p-4 transition dark:bg-[#12101c] ${isCurrent ? "border-[#6b57a8]/60 shadow-[0_10px_30px_rgba(107,87,168,0.12)]" : "border-slate-200 dark:border-white/10"}`}
                            >
                                <div className="flex flex-wrap items-start gap-3">
                                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#6b57a8]/10 text-[#6b57a8] dark:bg-[#b9ace8]/12 dark:text-[#c4b8ef]">
                                        <UserRound className="size-5" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[15px] font-medium">{account.name}</span>
                                            <span className="font-mono text-[11px] text-slate-400 dark:text-white/30">{account.id}</span>
                                        </div>
                                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                            {loggedIn === true ? (
                                                <Tag color="green" className="!m-0">
                                                    已登录
                                                </Tag>
                                            ) : loggedIn === false ? (
                                                <Tag color="red" className="!m-0">
                                                    未登录
                                                </Tag>
                                            ) : (
                                                <Tag className="!m-0">登录态未知</Tag>
                                            )}
                                            {isCurrent ? (
                                                <Tag color="purple" className="!m-0">
                                                    当前选中
                                                </Tag>
                                            ) : (
                                                <span className="text-[11px] text-slate-400 dark:text-white/30">等待手动选择</span>
                                            )}
                                            {account.state.busy ? (
                                                <Tag color="blue" className="!m-0">
                                                    任务进行中
                                                </Tag>
                                            ) : null}
                                            {(account.state.quotaBlocks?.length || account.state.quotaBlock) ? (
                                                <Tag
                                                    color="red"
                                                    className="!m-0"
                                                    title={(account.state.quotaBlocks?.length ? account.state.quotaBlocks : [account.state.quotaBlock!])
                                                        .map((block) => block.message)
                                                        .join("\n")}
                                                >
                                                    额度不足
                                                </Tag>
                                            ) : null}
                                        </div>
                                        {(account.state.quotaBlocks?.length ? account.state.quotaBlocks : account.state.quotaBlock ? [account.state.quotaBlock] : []).map(
                                            (block) => (
                                                <p key={block.capability || "all"} className="mt-1.5 text-[11px] text-red-500">
                                                    {block.capability ? `${block.capability}：` : ""}
                                                    {block.message}
                                                </p>
                                            ),
                                        )}
                                        {account.state.checkedAt ? (
                                            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/30">
                                                上次检测 {new Date(account.state.checkedAt).toLocaleString()}
                                                {account.state.models?.length ? ` · 可用模型 ${account.state.models.slice(0, 3).join(" / ")}` : ""}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button size="small" loading={busy} icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <CircleDashed className="size-3.5" />} onClick={() => void handleLogin(account)}>
                                            登录
                                        </Button>
                                        <Tooltip title="重新读取真实登录态（会短暂打开浏览器）">
                                            <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void handleCheck(account)}>
                                                检测
                                            </Button>
                                        </Tooltip>
                                        <Button size="small" type={isCurrent ? "primary" : "default"} icon={<CheckCircle2 className="size-3.5" />} onClick={() => setCurrentAccount(isCurrent ? null : account.id)}>
                                            {isCurrent ? "取消选中" : "设为当前"}
                                        </Button>
                                        {loggedIn ? (
                                            <Button size="small" type="text" onClick={() => handleLogout(account)}>
                                                退出
                                            </Button>
                                        ) : null}
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(account)} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="mt-4 flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-left text-[13px] text-slate-500 transition hover:border-[#6b57a8]/50 hover:text-[#6b57a8] dark:border-white/15 dark:text-white/40 dark:hover:border-[#b9ace8]/50 dark:hover:text-[#c4b8ef]"
                >
                    <Plus className="size-4" />
                    添加豆包账号
                </button>

                <p className="mt-3 text-[11px] leading-5 text-slate-400 dark:text-white/30">
                    每个账号使用独立的浏览器 profile 与登录态，互不可见。账号由你管理，智能模式只做推荐，不会自动轮换或失败自动切号。豆包额度需在其网页端查看，本系统读取不到时会标注「无法确认」。
                </p>

                {jobs.length ? (
                    <section className="mt-10">
                        <h2 className="text-sm font-medium">最近任务</h2>
                        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
                            <table className="w-full text-left text-[12px]">
                                <thead className="bg-slate-50 text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                                    <tr>
                                        <th className="px-3 py-2 font-medium">任务</th>
                                        <th className="px-3 py-2 font-medium">账号</th>
                                        <th className="px-3 py-2 font-medium">状态</th>
                                        <th className="px-3 py-2 font-medium">产物</th>
                                        <th className="px-3 py-2 font-medium">时间</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {jobs.map((job) => (
                                        <tr key={job.id} className="border-t border-slate-100 dark:border-white/[0.06]">
                                            <td className="max-w-[280px] truncate px-3 py-2">{job.prompt}</td>
                                            <td className="px-3 py-2">{job.accountName}</td>
                                            <td className="px-3 py-2">
                                                <Tag className="!m-0" color={job.status === "succeeded" ? "green" : job.status === "failed" ? "red" : "blue"}>
                                                    {job.status}
                                                </Tag>
                                            </td>
                                            <td className="px-3 py-2">{job.files.length ? `${job.files.length} 个文件` : "—"}</td>
                                            <td className="px-3 py-2 text-slate-400 dark:text-white/30">{new Date(job.createdAt).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                ) : null}
            </div>

            <Modal title="添加账号" open={addOpen} onCancel={() => setAddOpen(false)} onOk={() => void handleAdd()} okText="添加" destroyOnClose>
                <Select
                    className="mb-3 w-full"
                    value={newProvider}
                    onChange={(value) => setNewProvider(value)}
                    options={[
                        { value: "doubao", label: "豆包（国内 doubao.com）" },
                        { value: "dola", label: "Dola（国际版 dola.com）" },
                    ]}
                />
                <Input placeholder="例如：豆包账号 A" value={newName} onChange={(event) => setNewName(event.target.value)} onPressEnter={() => void handleAdd()} />
                <p className="mt-3 text-[12px] leading-5 text-slate-500 dark:text-white/40">添加后需要点该账号的「登录」，在弹出的页面里扫码完成授权（豆包打开 doubao.com，Dola 打开 dola.com）。</p>
            </Modal>

            <Modal
                open={Boolean(qrAccount)}
                onCancel={() => void closeQr()}
                footer={null}
                width={400}
                centered
                title={
                    <span className="flex items-center gap-2">
                        <QrCode className="size-4" />
                        登录{qrAccount?.providerName || "豆包"} · {qrAccount?.name}
                    </span>
                }
            >
                <div className="flex flex-col items-center gap-3 py-2">
                    <div className="flex w-full gap-1 rounded-lg bg-slate-100 p-1 text-[12px] dark:bg-white/[0.06]">
                        <button
                            type="button"
                            onClick={() => void switchToQr()}
                            className={`flex-1 cursor-pointer rounded-md py-1.5 transition ${loginMode === "qr" ? "bg-white font-medium shadow-sm dark:bg-white/15" : "text-slate-500 dark:text-white/50"}`}
                        >
                            应用内扫码（推荐）
                        </button>
                        <button
                            type="button"
                            onClick={() => void switchToWindow()}
                            className={`flex-1 cursor-pointer rounded-md py-1.5 transition ${loginMode === "window" ? "bg-white font-medium shadow-sm dark:bg-white/15" : "text-slate-500 dark:text-white/50"}`}
                        >
                            窗口登录（备用）
                        </button>
                    </div>

                    {loginMode === "window" ? (
                        <>
                            <div className="grid size-[200px] place-items-center rounded-xl border border-slate-200 bg-white dark:border-white/10">
                                {windowStatus.state === "logged_in" ? <CheckCircle2 className="size-10 text-emerald-500" /> : <MonitorSmartphone className="size-12 text-[#6b57a8] dark:text-[#c4b8ef]" />}
                            </div>
                            <p className="text-center text-[13px] text-slate-600 dark:text-white/70">{windowStatus.message || "正在打开登录窗口…"}</p>
                            <p className="text-center text-[11px] leading-5 text-slate-400 dark:text-white/35">
                                窗口会一直开着，不会自己关。你在窗口里扫码或用工号登录，检测到真实登录态后会自动保存并关闭。
                            </p>
                            <Button size="small" onClick={() => void switchToQr()}>
                                改用二维码
                            </Button>
                        </>
                    ) : (
                        <>
                            <div className="grid size-[240px] place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 dark:border-white/10">
                                {qrAccount && ["starting", "waiting"].includes(qrStatus.state) ? (
                                    <img src={qrImageUrl(qrAccount.id, qrBust)} alt="豆包登录二维码" className="size-full object-contain" />
                                ) : qrStatus.state === "logged_in" ? (
                                    <CheckCircle2 className="size-10 text-emerald-500" />
                                ) : (
                                    <Spin />
                                )}
                            </div>
                            <p className="text-center text-[13px] text-slate-500 dark:text-white/55">{qrStatus.state === "logged_in" ? "登录成功" : qrStatus.message || "正在获取二维码…"}</p>
                            <p className="text-center text-[11px] leading-5 text-slate-400 dark:text-white/35">二维码约 1 分钟过期，过期后会自动换一张。用手机{qrAccount?.providerName || "豆包"} App 扫码并在手机上确认。</p>
                            <div className="flex gap-2">
                                <Button
                                    size="small"
                                    onClick={() => {
                                        if (!qrAccount) return;
                                        void startQrLogin(qrAccount.id).then(() => {
                                            setQrStatus({ state: "starting", message: "正在重新申请二维码…" });
                                            setQrBust(Date.now());
                                        });
                                    }}
                                >
                                    刷新二维码
                                </Button>
                                <Button size="small" onClick={() => void switchToWindow()}>
                                    改用弹窗
                                </Button>
                            </div>
                        </>
                    )}

                    <Button size="small" type="text" onClick={() => void closeQr()}>
                        关闭
                    </Button>
                </div>
            </Modal>
        </main>
    );
}
