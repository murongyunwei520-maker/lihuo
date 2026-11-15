import { Badge, Popover } from "antd";
import { Bell, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAgentStore } from "@/stores/use-agent-store";

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

export function AppTopBar() {
    return (
        <header className="studio-app-topbar z-10 flex h-14 shrink-0 items-center justify-end gap-3 px-4">
            <div className="flex shrink-0 items-center gap-1">
                <NotificationCenter />
                <UserStatusActions />
                <Link to="/config" className="studio-user-avatar" aria-label="用户与配置" title="用户与配置"><UserRound /></Link>
            </div>
        </header>
    );
}
