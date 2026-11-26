import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Modal, Tooltip } from "antd";
import { ChevronLeft, Loader2, Plus, RefreshCw, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { fetchQrStatus, listAccounts, openAccountWindow, qrImageUrl, startQrLogin, type BridgeProvider, type DoubaoAccount } from "@/services/api/doubao-bridge";
import { useCanvasLayoutStore } from "@/stores/use-canvas-layout-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useDoubaoAccountStore } from "@/stores/use-doubao-account-store";

// 账号池：豆包和 Dola 的号都放在这里，按站点分组并各自带颜色标识。
// 只负责「看状态 + 手动切换 + 登录」，生成逻辑仍在各节点里。
//
// 之前是「左侧豆包池 + 右侧 Dola 池」两个实例各 20 秒轮询，而它们共享同一个 currentAccountId：
// 一边发现当前号不属于自己就把选择清空、另一边又立刻选回自己的号，两个面板互相打架，
// 于是刷新按钮的 loading 图标和选中态一直在闪。现在合并成一个实例、一次轮询，就不会再抖了。
const PROVIDER_META: Record<BridgeProvider, { name: string; dot: string; chip: string; ring: string }> = {
    doubao: {
        name: "豆包",
        dot: "bg-[#6b57a8]",
        chip: "bg-[#6b57a8]/12 text-[#6b57a8] dark:bg-[#c4b8ef]/15 dark:text-[#c4b8ef]",
        ring: "ring-[#6b57a8]/45",
    },
    dola: {
        name: "Dola",
        dot: "bg-[#2f8f83]",
        chip: "bg-[#2f8f83]/12 text-[#2f8f83] dark:bg-[#5fd0c2]/15 dark:text-[#5fd0c2]",
        ring: "ring-[#2f8f83]/45",
    },
};

const providerOf = (account: DoubaoAccount): BridgeProvider => account.provider ?? "doubao";

/** 只比较影响界面的字段，数据没变就不 setState，避免每次轮询都重绘。 */
function signature(accounts: DoubaoAccount[]) {
    return JSON.stringify(
        accounts.map((account) => [
            account.id,
            account.name,
            providerOf(account),
            account.state.loggedIn,
            account.state.busy,
            account.state.quotaBlock?.capability || "",
            account.state.quotaBlock?.at || "",
            (account.state.quotaBlocks || []).map((block) => block.capability || "").join(","),
        ]),
    );
}

export function CanvasDoubaoAccountsPanel({ embedded = false }: { provider?: BridgeProvider; embedded?: boolean } = {}) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const currentAccountId = useDoubaoAccountStore((state) => state.currentAccountId);
    const setCurrentAccount = useDoubaoAccountStore((state) => state.setCurrentAccount);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const collapsed = !useCanvasLayoutStore((state) => state.accountsOpen);
    const setAccountsOpen = useCanvasLayoutStore((state) => state.setAccountsOpen);
    const [accounts, setAccounts] = useState<DoubaoAccount[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [qrAccount, setQrAccount] = useState<DoubaoAccount | null>(null);
    const [qrBust, setQrBust] = useState(() => Date.now());
    const [qrState, setQrState] = useState("starting");
    // 桥接给的状态文案（例如「正在打开 dola.com…」「请用手机 Dola App 扫码」），Dola 首次取码较慢时很有用
    const [qrMessage, setQrMessage] = useState("");
    const lastSignature = useRef("");

    // 号池里点账号是用户的明确选择：同时写当前账号和全局配置，所有生成入口都读同一个选择。
    const selectAccount = (accountId: string | null) => {
        setCurrentAccount(accountId);
        updateConfig("doubaoAccountId", accountId || "");
    };

    const refresh = useCallback(
        async (manual = false) => {
            if (manual) setRefreshing(true);
            try {
                const next = await listAccounts();
                setError("");
                // 选中号只在「真的不存在了」才清空：不要按站点各管一段，否则两个面板会互相把对方清掉
                const { currentAccountId: selected, setCurrentAccount: setSelected } = useDoubaoAccountStore.getState();
                if (selected && !next.some((item) => item.id === selected)) {
                    setSelected(null);
                    useConfigStore.getState().updateConfig("doubaoAccountId", "");
                } else if (selected) {
                    // 当前账号与生成配置必须指向同一个号，否则画布会用旧配置去跑新选中的号
                    useConfigStore.getState().updateConfig("doubaoAccountId", selected);
                }
                if (!selected) {
                    // 只有一个已登录账号时才自动选中；有多个时保持未选择，避免「擅自用第一个号」。
                    const loggedIn = next.filter((item) => item.state.loggedIn === true);
                    if (loggedIn.length === 1) {
                        setSelected(loggedIn[0].id);
                        useConfigStore.getState().updateConfig("doubaoAccountId", loggedIn[0].id);
                    }
                }
                const nextSignature = signature(next);
                if (nextSignature !== lastSignature.current) {
                    lastSignature.current = nextSignature;
                    setAccounts(next);
                }
            } catch {
                setError("桥接未运行");
            } finally {
                if (manual) setRefreshing(false);
                setInitialLoading(false);
            }
        },
        [],
    );

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
                    setQrMessage(status.message || "");
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

    const groups = (["doubao", "dola"] as BridgeProvider[])
        .map((provider) => ({ provider, meta: PROVIDER_META[provider], items: accounts.filter((account) => providerOf(account) === provider) }))
        .filter((group) => group.items.length > 0);

    if (collapsed) {
        return null;
    }

    return (
        <aside className="flex w-[200px] shrink-0 flex-col border-r border-black/5 dark:border-white/10">
            {embedded ? null : (
                <div className="flex h-9 items-center gap-1.5 px-2.5">
                    <UsersRound className="size-3.5 text-[#6b57a8] dark:text-[#c4b8ef]" />
                    <span className="text-[12px] font-medium">账号池</span>
                    <span className="text-[10px] text-slate-400 dark:text-white/30">{accounts.length}</span>
                    <button type="button" onClick={() => void refresh(true)} className="ml-auto cursor-pointer rounded p-1 text-slate-400 hover:bg-black/5 dark:hover:bg-white/10" title="刷新">
                        {refreshing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    </button>
                    <button type="button" onClick={() => setAccountsOpen(false)} className="cursor-pointer rounded p-1 text-slate-400 hover:bg-black/5 dark:hover:bg-white/10" title="收起">
                        <ChevronLeft className="size-3" />
                    </button>
                </div>
            )}

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-2">
                {error ? <p className="px-1 py-2 text-[11px] text-red-500">{error}</p> : null}
                {!accounts.length && !error ? (
                    <p className="px-1 py-2 text-[11px] text-slate-400 dark:text-white/30">{initialLoading ? "正在读取账号…" : "还没有账号，先在「豆包账号」页添加"}</p>
                ) : null}
                {groups.map((group) => (
                    <div key={group.provider} className="space-y-1">
                        {/* 分组标题：两种站点一眼分开 */}
                        <div className="flex items-center gap-1.5 px-1.5 pt-1 pb-0.5">
                            <span className={`size-1.5 rounded-full ${group.meta.dot}`} />
                            <span className="text-[10px] font-medium tracking-wide text-slate-500 dark:text-white/45">{group.meta.name}</span>
                            <span className="text-[10px] text-slate-400 dark:text-white/25">{group.items.length}</span>
                        </div>
                        {group.items.map((account) => {
                            const active = account.id === currentAccountId;
                            const loggedIn = account.state.loggedIn;
                            // 一个号可能同时「视频生成 + 图像生成」额度不足：全部列出来
                            const quotaList = account.state.quotaBlocks?.length
                                ? account.state.quotaBlocks
                                : account.state.quotaBlock
                                  ? [account.state.quotaBlock]
                                  : [];
                            const quotaCaps = quotaList
                                .map((block) => block.capability || "")
                                .filter(Boolean)
                                .join("、");
                            return (
                                <div
                                    key={account.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                        // 点账号 = 选中它 + 打开（或前置）它自己那个窗口（豆包打开 doubao.com，Dola 打开 dola.com）
                                        selectAccount(account.id);
                                        void openAccountWindow(account.id)
                                            .then((result) => {
                                                if (result.reused) message.info(`「${account.name}」的窗口已在运行，已为你前置`);
                                            })
                                            .catch((error) => message.warning(error instanceof Error ? error.message : `打开${group.meta.name}窗口失败`));
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            selectAccount(account.id);
                                        }
                                    }}
                                    className={`w-full cursor-pointer rounded-lg border-l-2 px-2 py-1.5 text-left transition ${
                                        quotaList.length
                                            ? "border-l-red-500 bg-red-500/[0.08] ring-1 ring-red-400/60 hover:bg-red-500/[0.12]"
                                            : active
                                              ? `border-l-[#6b57a8] bg-[#6b57a8]/12 ring-1 ${group.meta.ring}`
                                              : `border-l-transparent hover:bg-black/5 dark:hover:bg-white/[0.06]`
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span className={`size-1.5 shrink-0 rounded-full ${quotaList.length ? "bg-red-500" : loggedIn === true ? "bg-emerald-400" : loggedIn === false ? "bg-slate-400/60" : "bg-amber-400/70"}`} />
                                        <span className={`min-w-0 flex-1 truncate text-[12px] font-medium ${quotaList.length ? "text-red-600 dark:text-red-400" : ""}`}>{account.name}</span>
                                        <span className={`shrink-0 rounded px-1 py-px text-[9px] font-medium ${group.meta.chip}`}>{group.meta.name}</span>
                                        {active ? <span className="text-[9px] text-[#6b57a8] dark:text-[#c4b8ef]">当前</span> : null}
                                    </div>
                                    <div className="mt-0.5 flex min-w-0 items-center gap-1 pl-3 text-[10px] text-slate-400 dark:text-white/30">
                                        <span className="shrink-0">{loggedIn === true ? "已登录" : loggedIn === false ? "未登录" : "登录态未知"}</span>
                                        {account.state.busy ? <span className="shrink-0 text-amber-500">· 忙</span> : null}
                                        {quotaList.length ? (
                                            <Tooltip title={quotaList.map((block) => block.message).join("\n")}>
                                                <span className="min-w-0 truncate font-medium text-red-500">{quotaCaps ? `${quotaCaps}额度不足` : "额度不足"}</span>
                                            </Tooltip>
                                        ) : null}
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
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

            <div className="border-t border-black/5 p-1.5 dark:border-white/10">
                <Button size="small" type="text" block icon={<Plus className="size-3.5" />} onClick={() => navigate("/doubao")} className="!justify-start !text-[11px]">
                    添加 / 管理账号
                </Button>
            </div>

            <Modal open={Boolean(qrAccount)} onCancel={() => setQrAccount(null)} footer={null} width={360} centered title={`登录${qrAccount ? PROVIDER_META[providerOf(qrAccount)].name : "账号"} · ${qrAccount?.name ?? ""}`}>
                <div className="flex flex-col items-center gap-2 py-1">
                    <div className="grid size-[208px] place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 dark:border-white/10">
                        {qrAccount ? <img src={qrImageUrl(qrAccount.id, qrBust)} alt="登录二维码" className="size-full object-contain" /> : null}
                    </div>
                    <p className="text-[12px] text-slate-500 dark:text-white/55">{qrState === "logged_in" ? "登录成功" : qrMessage || `用手机${qrAccount ? PROVIDER_META[providerOf(qrAccount)].name : ""} App 扫码，过期会自动换码`}</p>
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
