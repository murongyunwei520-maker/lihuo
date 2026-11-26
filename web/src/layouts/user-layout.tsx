import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { StudioBackdrop, StudioCharacter } from "@/components/studio/studio-backdrop";
import { cn } from "@/lib/utils";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { useState } from "react";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const { t } = useTranslation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const authStatus = useAuthStore((state) => state.status);
    const authUser = useAuthStore((state) => state.user);
    const cloudMode = useConfigStore((state) => state.config.channelMode === "cloud");
    // 画布项目页保留完整画布；其余用户页共用同一套侧栏、顶栏和仙境背景。
    const canvasProject = /^\/canvas\/[^/]+/.test(pathname);
    const hideChrome = canvasProject;
    const immersive = !canvasProject;

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <div className={cn("flex h-dvh overflow-hidden text-foreground", immersive ? "studio-shell" : "lihuo-aurora-bg bg-background")}>
            {immersive ? <StudioBackdrop /> : null}
            {pathname === "/" ? <div className="studio-home-character"><StudioCharacter /></div> : null}
            {!hideChrome ? <AppSidebar /> : null}
            <div className="relative z-[1] flex min-w-0 flex-1 flex-col overflow-hidden">
                {authUser?.email && !authUser.emailVerified ? (
                    <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200/60 bg-amber-50/80 px-4 py-1.5 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                        <span>邮箱未验证，暂时无法通过邮件找回密码</span>
                        <Link to="/account" className="font-medium underline">
                            去验证
                        </Link>
                    </div>
                ) : null}
                {!hideChrome ? (
                    <header className="studio-mobile-topbar z-10 flex h-14 shrink-0 items-center gap-3 px-4 md:hidden">
                        <button
                            type="button"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition hover:bg-[rgba(139,124,200,0.12)] hover:text-[#4b3f72] dark:text-stone-400 dark:hover:bg-white/[0.08] dark:hover:text-[#d4cbf2]"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label={t("topNav.openMenu")}
                            title={t("topNav.menu")}
                        >
                            <Menu className="size-5" />
                        </button>
                        <span className="lihuo-signature bg-gradient-to-r from-[#6b57a8] to-[#7fd4e8] bg-clip-text text-xl font-semibold text-transparent dark:from-[#c4b8ef] dark:to-[#7fd4e8]">lihuo</span>
                        {cloudMode && authStatus !== "authenticated" ? (
                            <Link to="/login" className="studio-auth-notice ml-auto">未登录 · 去登录</Link>
                        ) : null}
                    </header>
                ) : null}
                {!hideChrome ? (
                    <div className="hidden md:block">
                        <AppTopBar />
                    </div>
                ) : null}
                <div className={cn("min-h-0 flex-1 overflow-hidden", !hideChrome && "studio-workspace-page")}>{children}</div>
            </div>
            <AgentPanel />
            <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </div>
    );
}
