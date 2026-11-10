import { useCallback, useEffect, useState } from "react";
import { App, Button, Modal, Tooltip } from "antd";
import { ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { fetchQrStatus, listAccounts, openAccountWindow, qrImageUrl, startQrLogin, type DoubaoAccount } from "@/services/api/doubao-bridge";
import { useDoubaoAccountStore } from "@/stores/use-doubao-account-store";

// 画布左侧的豆包账号池：只负责「看状态 + 手动切换 + 登录」，生成逻辑仍在各节点里。
export function CanvasDoubaoAccountsPanel() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const currentAccountId = useDoubaoAccountStore((state) => state.currentAccountId);
    const setCurrentAccount = useDoubaoAccountStore((state) => state.setCurrentAccount);
    const [accounts, setAccounts] = useState<DoubaoAccount[]>([]);
    const [collapsed, setCollapsed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [qrAccount, setQrAccount] = useState<DoubaoAccount | null>(null);
    const [qrBust, setQrBust] = useState(() => Date.now());
    const [qrState, setQrState] = useState("starting");

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const next = await listAccounts();
            setAccounts(next);
            if (currentAccountId && !next.some((item) => item.id === currentAccountId)) setCurrentAccount(null);
            if (!currentAccountId) {
                const preferred = next.find((item) => item.state.loggedIn === true) || next[0];
                if (preferred) setCurrentAccount(preferred.id);
            }
        } catch {
            setError("桥接未运行");
        } finally {
            setLoading(false);
        }
    }, [currentAccountId, setCurrentAccount]);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => void refresh(), 20000);
        return () => window.clearInterval(timer);
    }, [refresh]);

    useEffect(() => {
        if (!qrAccount) return;
        const timer = window.setInterval(() => {
            void fetchQrStatus(qrAccount.id)
                .then(({ status }) => {
                    setQrState(status.state);
                    setQrBust(Date.now());
                    if (status.state === "logged_in") {
                        message.success(`「${qrAccount.name}」登录成功`);
                        setQrAccount(null);
                        void refresh();
                    } else if (["error", "closed", "timeout"].includes(status.state)) {
                        setQrAccount(null);
                        message.warning(status.message || "扫码未完成");
                    }
                })
                .catch(() => undefined);
        }, 2500);
        return () => window.clearInterval(timer);
    }, [qrAccount, message, refresh]);

    const openLogin = async (account: DoubaoAccount) => {
        setQrAccount(account);
        setQrState("starting");
        setQrBust(Date.now());
        await startQrLogin(account.id).catch(() => message.error("获取二维码失败"));
    };

    if (collapsed) {
        return (
            <aside className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-black/5 py-3 dark:border-white/10">
                <Tooltip title="展开豆包账号池" placement="right">
                    <button type="button" onClick={() => setCollapsed(false)} className="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-400 hover:bg-black/5 dark:hover:bg-white/10">
                        <ChevronRight className="size-4" />
                    </button>
                </Tooltip>
                <div className="mt-1 flex flex-col gap-1.5">
                    {accounts.map((account) => (
                        <button
                            key={account.id}
                            type="button"
                            title={account.name}
                            onClick={() => setCurrentAccount(account.id === currentAccountId ? null : account.id)}
                            className={`grid size-7 cursor-pointer place-items-center rounded-full text-[10px] font-medium ${account.id === currentAccountId ? "bg-[#6b57a8] text-white" : "bg-black/5 text-slate-500 dark:bg-white/10 dark:text-white/60"}`}
                        >
                            {account.name.slice(-1)}
                        </button>
                    ))}
                </div>
            </aside>
        );
    }

    return (
        <aside className="flex w-[188px] shrink-0 flex-col border-r border-black/5 dark:border-white/10">
            <div className="flex h-9 items-center gap-1.5 px-2.5">
                <UsersRound className="size-3.5 text-[#6b57a8] dark:text-[#c4b8ef]" />
                <span className="text-[12px] font-medium">豆包账号池</span>
                <span className="ml-auto text-[10px] text-slate-400 dark:text-white/30">{accounts.length}</span>
                <button type="button" onClick={() => void refresh()} className="cursor-pointer rounded p-1 text-slate-400 hover:bg-black/5 dark:hover:bg-white/10" title="刷新">
                    {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                </button>
                <button type="button" onClick={() => setCollapsed(true)} className="cursor-pointer rounded p-1 text-slate-400 hover:bg-black/5 dark:hover:bg-white/10" title="收起">
                    <ChevronLeft className="size-3" />
                </button>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1.5 pb-2">
                {error ? <p className="px-1 py-2 text-[11px] text-red-500">{error}</p> : null}
                {!accounts.length && !error ? <p className="px-1 py-2 text-[11px] text-slate-400 dark:text-white/30">还没有账号，先在「豆包账号」页添加</p> : null}
                {accounts.map((account) => {
                    const active = account.id === currentAccountId;
                    const loggedIn = account.state.loggedIn;
                    return (
                        <button
                            key={account.id}
                            type="button"
                            onClick={() => {
                                // 点账号 = 选中它 + 打开（或前置）它自己的那一个豆包窗口
                                setCurrentAccount(account.id);
                                void openAccountWindow(account.id)
                                    .then((result) => {
                                        if (result.reused) message.info(`「${account.name}」的豆包窗口已在运行，已为你前置`);
                                    })
                                    .catch((error) => message.warning(error instanceof Error ? error.message : "打开豆包窗口失败"));
                            }}
                            className={`w-full cursor-pointer rounded-lg px-2 py-1.5 text-left transition ${active ? "bg-[#6b57a8]/12 ring-1 ring-[#6b57a8]/45" : "hover:bg-black/5 dark:hover:bg-white/[0.06]"}`}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className={`size-1.5 shrink-0 rounded-full ${loggedIn === true ? "bg-emerald-400" : loggedIn === false ? "bg-slate-400/60" : "bg-amber-400/70"}`} />
                                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{account.name}</span>
                                {active ? <span className="text-[9px] text-[#6b57a8] dark:text-[#c4b8ef]">当前</span> : null}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 pl-3 text-[10px] text-slate-400 dark:text-white/30">
                                <span>{loggedIn === true ? "已登录" : loggedIn === false ? "未登录" : "登录态未知"}</span>
                                {account.state.busy ? <span className="text-amber-500">· 忙</span> : null}
                                {loggedIn !== true ? (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void openLogin(account);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                                event.stopPropagation();
                                                void openLogin(account);
                                            }
                                        }}
                                        className="ml-auto cursor-pointer text-[#6b57a8] hover:underline dark:text-[#c4b8ef]"
                                    >
                                        登录
                                    </span>
                                ) : null}
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="border-t border-black/5 p-1.5 dark:border-white/10">
                <Button size="small" type="text" block icon={<Plus className="size-3.5" />} onClick={() => navigate("/doubao")} className="!justify-start !text-[11px]">
                    添加 / 管理账号
                </Button>
            </div>

            <Modal open={Boolean(qrAccount)} onCancel={() => setQrAccount(null)} footer={null} width={360} centered title={`登录豆包 · ${qrAccount?.name ?? ""}`}>
                <div className="flex flex-col items-center gap-2 py-1">
                    <div className="grid size-[208px] place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 dark:border-white/10">
                        {qrAccount ? <img src={qrImageUrl(qrAccount.id, qrBust)} alt="豆包登录二维码" className="size-full object-contain" /> : null}
                    </div>
                    <p className="text-[12px] text-slate-500 dark:text-white/55">{qrState === "logged_in" ? "登录成功" : "用手机豆包 App 扫码，过期会自动换码"}</p>
                    <Button
                        size="small"
                        onClick={() => {
                            if (!qrAccount) return;
                            void startQrLogin(qrAccount.id).then(() => setQrBust(Date.now()));
                        }}
                    >
                        刷新二维码
                    </Button>
                </div>
            </Modal>
        </aside>
    );
}
