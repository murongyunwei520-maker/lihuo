import { useEffect, useState } from "react";
import { Bot, Clapperboard, Coins, FileText, Film, Home, ImagePlus, Images, Maximize2, PanelLeftClose, PanelLeftOpen, Settings2, UserRound, UsersRound, Video, type LucideIcon } from "lucide-react";
import { Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { APP_BRAND } from "@/constant/app";
import { useAgentStore } from "@/stores/use-agent-store";

const COLLAPSE_STORAGE_KEY = "lihuo:sidebar_collapsed";

export type SidebarItem = {
    key: string;
    icon: LucideIcon;
    to?: string;
    onClick?: () => void;
    active?: boolean;
};

/** 侧边栏与移动端抽屉共用的导航项，保证入口唯一 */
export function useSidebarItems(): SidebarItem[] {
    const { pathname } = useLocation();
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const togglePanel = useAgentStore((state) => state.togglePanel);

    return [
        { key: "home", icon: Home, to: "/", active: pathname === "/" },
        { key: "canvas", icon: Maximize2, to: "/canvas", active: pathname.startsWith("/canvas") },
        { key: "agent", icon: Bot, onClick: togglePanel, active: panelOpen },
        { key: "image", icon: ImagePlus, to: "/image", active: pathname === "/image" },
        { key: "video", icon: Video, to: "/video", active: pathname === "/video" },
        { key: "drama", icon: Clapperboard, to: "/drama", active: pathname === "/drama" },
        { key: "director", icon: Film, to: "/director", active: pathname === "/director" },
        { key: "doubao", icon: UsersRound, to: "/doubao", active: pathname === "/doubao" },
        { key: "prompts", icon: FileText, to: "/prompts", active: pathname === "/prompts" },
        { key: "assets", icon: Images, to: "/assets", active: pathname === "/assets" },
        { key: "points", icon: Coins, to: "/points", active: pathname === "/points" },
                { key: "account", icon: UserRound, to: "/account", active: pathname === "/account" },
        { key: "config", icon: Settings2, to: "/config", active: pathname === "/config" },
    ];
}

export function AppSidebar() {
    const { t } = useTranslation();
    const items = useSidebarItems();
    const { pathname } = useLocation();
    const [storedCollapsed, setStoredCollapsed] = useState(() => window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    // 短剧工厂自己有一套十步导航，横向空间更值钱：进入时自动收成图标栏。
    // 这里不写进全局偏好，避免把用户在其它页面的展开习惯改掉。
    const autoCollapse = pathname === "/drama";
    const [routeOverride, setRouteOverride] = useState<boolean | null>(null);
    const collapsed = autoCollapse ? (routeOverride ?? true) : storedCollapsed;

    useEffect(() => {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, storedCollapsed ? "1" : "0");
    }, [storedCollapsed]);

    // 离开自动收起的路由后忘掉本次的临时展开，下次进入仍然自动收起。
    useEffect(() => {
        if (!autoCollapse) setRouteOverride(null);
    }, [autoCollapse]);

    const toggleCollapsed = () => {
        if (autoCollapse) setRouteOverride(!collapsed);
        else setStoredCollapsed(!collapsed);
    };

    return (
        <aside
            className={cn(
                "studio-app-sidebar relative z-20 hidden h-full shrink-0 flex-col border-y-0 border-l-0 py-4 transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] md:flex",
                collapsed ? "w-[68px]" : "w-[212px]",
            )}
        >
            {/* 品牌签名：展开时用文字标，收起时只留朱雀标记，避免长单词挤在 68px 里被裁。 */}
            <Link to="/" className={cn("mb-5 flex items-center gap-2", collapsed ? "justify-center px-0" : "px-4")} aria-label={APP_BRAND.name}>
                {collapsed ? (
                    <span
                        aria-hidden
                        className="size-[30px] bg-gradient-to-br from-[#6b57a8] to-[#7fd4e8] dark:from-[#c4b8ef] dark:to-[#7fd4e8]"
                        style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }}
                    />
                ) : (
                    <>
                        <span className="lihuo-signature whitespace-nowrap bg-gradient-to-r from-[#6b57a8] to-[#7fd4e8] bg-clip-text text-[26px] leading-none font-semibold text-transparent dark:from-[#c4b8ef] dark:to-[#7fd4e8]">{APP_BRAND.nameEn}</span>
                        <span className="mt-1 text-[10px] tracking-[0.28em] text-stone-400 uppercase dark:text-stone-500">studio</span>
                    </>
                )}
            </Link>

            <nav className="thin-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5">
                {items.map((item) => {
                    const Icon = item.icon;
                    const label = t(`navigation.${item.key}`);
                    const className = cn(
                        "studio-nav-item group relative flex h-11 w-full items-center gap-3 rounded-xl text-base transition-all duration-200",
                        collapsed ? "justify-center px-0" : "px-3",
                        item.active && "is-active",
                    );
                    const inner = (
                        <>
                            <Icon className="size-[18px] shrink-0 transition-transform duration-150 group-hover:scale-110" />
                            {!collapsed ? <span className="truncate">{label}</span> : null}
                        </>
                    );
                    const tooltipTitle = collapsed ? label : "";
                    const node = item.to ? (
                        <Link key={item.key} to={item.to} className={className} aria-current={item.active ? "page" : undefined}>
                            {inner}
                        </Link>
                    ) : (
                        <button key={item.key} type="button" className={className} onClick={item.onClick} aria-pressed={item.active}>
                            {inner}
                        </button>
                    );
                    return tooltipTitle ? (
                        <Tooltip key={item.key} title={tooltipTitle} placement="right" mouseEnterDelay={0.15}>
                            {node}
                        </Tooltip>
                    ) : (
                        node
                    );
                })}
            </nav>

            <button
                type="button"
                onClick={toggleCollapsed}
                className={cn(
                    "mx-2.5 mt-3 flex h-9 items-center gap-2 rounded-lg text-[12px] text-stone-400 transition hover:bg-black/[0.04] hover:text-stone-700 dark:text-stone-500 dark:hover:bg-white/[0.06] dark:hover:text-stone-200",
                    collapsed ? "justify-center" : "px-3",
                )}
                aria-label={collapsed ? t("topNav.expandSidebar") : t("topNav.collapseSidebar")}
                title={autoCollapse && collapsed ? "展开导航（短剧工厂默认收起）" : collapsed ? t("topNav.expandSidebar") : t("topNav.collapseSidebar")}
            >
                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                {!collapsed ? <span>{t("topNav.collapseSidebar")}</span> : null}
            </button>
        </aside>
    );
}
