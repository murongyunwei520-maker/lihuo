import { Bot, KeyRound, Menu } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-[72px] shrink-0 border-b border-slate-200/70 bg-[#f6f4fa]/85 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0a0810]/85">
                    <div className="mx-auto flex h-full max-w-[1280px] items-center gap-5 px-6">
                        <Link to="/" className="flex shrink-0 items-center gap-2.5">
                            <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[linear-gradient(135deg,#c4b8ef,#9b8ad0)] text-[#120e1f] shadow-[0_2px_12px_rgba(185,172,232,0.35)]">
                                <span
                                    className="size-4 bg-current"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                            </span>
                            <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-slate-950 dark:text-white">{t("meta.title")}</span>
                        </Link>

                        <button
                            type="button"
                            className="inline-flex size-8 shrink-0 items-center justify-center text-slate-600 transition hover:text-slate-950 md:hidden dark:text-white/60 dark:hover:text-white"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label={t("topNav.openMenu")}
                            title={t("topNav.menu")}
                        >
                            <Menu className="size-5" />
                        </button>

                        <nav className="hide-scrollbar hidden min-w-0 flex-1 items-center overflow-x-auto md:flex">
                            <div className="flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-white/70 p-1 backdrop-blur dark:border-white/10 dark:bg-white/[0.04]">
                                {navigationTools.map((tool) => {
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            className={cn(
                                                "relative flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] leading-none transition",
                                                active
                                                    ? "!bg-[#c4b8ef] font-medium !text-[#120e1f] shadow-[0_2px_10px_rgba(185,172,232,0.35)]"
                                                    : "!text-slate-600 hover:!bg-slate-100 hover:!text-slate-950 dark:!text-white/60 dark:hover:!bg-white/[0.08] dark:hover:!text-white",
                                            )}
                                        >
                                            <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </nav>

                        <div className="ml-auto flex h-9 shrink-0 items-center justify-end gap-1.5 whitespace-nowrap">
                            {/* 接口配置是高频动作，放在导航最显眼的位置 */}
                            <Button
                                size="small"
                                onClick={() => openConfigDialog(false, "channels")}
                                icon={<KeyRound className="size-3.5" />}
                                className="!h-8 !rounded-full !border !border-[#6b57a8]/25 !bg-[#6b57a8]/[0.06] !px-3 !text-[12px] !font-medium !text-[#584693] hover:!border-[#6b57a8]/45 hover:!bg-[#6b57a8]/[0.12] dark:!border-[#b9ace8]/30 dark:!bg-[#b9ace8]/[0.10] dark:!text-[#cdc2f2] dark:hover:!border-[#b9ace8]/50 dark:hover:!bg-[#b9ace8]/[0.18]"
                            >
                                <span className="hidden sm:inline">配置 API</span>
                            </Button>
                            <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                            </Tooltip>
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
