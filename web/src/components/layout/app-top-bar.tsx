import { App, Badge, Dropdown, Popover } from "antd";
import { Bell, LogOut, Settings2, ShieldCheck, Sparkles, UserRound, Wallet } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";

const iconButtonClass = "studio-icon-button inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors";

/** 通知直接读取 Agent 真实事件日志，最近 8 条。 */
export function NotificationCenter() {
    const { t } = useTranslation();
    const eventLogs = useAgentStore((state) => state.eventLogs);
    const recent = eventLogs.slice(-8).reverse();
    const content = (
        <div className="thin-scrollbar max-h-[320px] w-[300px] overflow-y-auto">
            {recent.length === 0 ? (
                <div className="py-6 text-center text-xs text-stone-400 dark:text-stone-500">{t("topNav.noNotifications")}</div>
            ) : (
                <ul className="space-y-1">
                    {recent.map((item) => (
                        <li key={item.id} className="rounded-lg px-2.5 py-2 transition-colors hover:bg-white/20">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-[12px] font-medium text-stone-800 dark:text-stone-200">{item.title}</span>
                                <span className="shrink-0 text-[10px] text-stone-400 dark:text-stone-500">{item.time}</span>
                            </div>
                            {item.text ? <p className="mt-0.5 line-clamp-2 text-[11px] text-stone-500 dark:text-stone-400">{item.text}</p> : null}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );

    return (
        <Popover content={content} trigger="click" placement="bottomRight" arrow={false}>
            <button type="button" className={iconButtonClass} aria-label={t("topNav.notifications")} title={t("topNav.notifications")}>
                <Badge count={recent.length} size="small" overflowCount={9} color="#8b7cc8" offset={[-2, 4]}>
                    <Bell className="size-4" />
                </Badge>
            </button>
        </Popover>
    );
}

/** 头像菜单：账户中心 / 管理后台 / 退出登录。未登录时直接给登录入口。 */
function UserMenu() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const status = useAuthStore((state) => state.status);
    const user = useAuthStore((state) => state.user);
    const signOut = useAuthStore((state) => state.signOut);

    if (status !== "authenticated" || !user) {
        return (
            <Link to="/login" className="studio-user-avatar" aria-label="登录" title="登录">
                <UserRound />
            </Link>
        );
    }

    const name = user.displayName?.trim() || user.username;
    const items = [
        { key: "account", icon: <UserRound className="size-3.5" />, label: "账户中心" },
        { key: "billing", icon: <Wallet className="size-3.5" />, label: `余额 ¥${(user.quotaCents / 100).toFixed(2)}` },
        { key: "points", icon: <Sparkles className="size-3.5" />, label: `积分 ${user.points ?? 0}` },
        ...(user.role === "admin" ? [{ key: "admin", icon: <ShieldCheck className="size-3.5" />, label: "管理后台" }] : []),
        { key: "config", icon: <Settings2 className="size-3.5" />, label: "模型与配置" },
        { type: "divider" as const },
        { key: "logout", icon: <LogOut className="size-3.5" />, label: "退出登录", danger: true },
    ];

    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
                items,
                onClick: async ({ key }) => {
                    if (key === "points") navigate("/points");
                    else if (key === "account" || key === "billing") navigate("/account");
                    else if (key === "admin") navigate("/admin");
                    else if (key === "config") navigate("/config");
                    else if (key === "logout") {
                        await signOut();
                        message.success("已退出登录");
                        navigate("/login", { replace: true });
                    }
                },
            }}
        >
            <button type="button" className="studio-user-avatar cursor-pointer text-[12px] font-semibold" aria-label="账户菜单" title={name}>
                {name.slice(0, 1).toUpperCase()}
            </button>
        </Dropdown>
    );
}

export function AppTopBar() {
    const authStatus = useAuthStore((state) => state.status);
    const cloudMode = useConfigStore((state) => state.config.channelMode === "cloud");

    return (
        <header className="studio-app-topbar z-10 flex h-14 shrink-0 items-center justify-end gap-3 px-4">
            {cloudMode && authStatus !== "authenticated" ? (
                <div className="studio-auth-notice mr-auto">
                    <span>未登录：模型与生成由云端提供，登录后可用</span>
                    <Link to="/login">去登录</Link>
                </div>
            ) : null}
            <div className="flex shrink-0 items-center gap-1">
                <NotificationCenter />
                <UserStatusActions />
                <UserMenu />
            </div>
        </header>
    );
}
