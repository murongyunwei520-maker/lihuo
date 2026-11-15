import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { StudioBackdrop } from "@/components/studio/studio-backdrop";
import { cn } from "@/lib/utils";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { useState } from "react";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "@/stores/use-agent-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const { t } = useTranslation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
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
            {!hideChrome ? <AppSidebar /> : null}
            <div className="relative z-[1] flex min-w-0 flex-1 flex-col overflow-hidden">
                {!hideChrome ? (
                    <header className="glass-panel z-10 flex h-14 shrink-0 items-center gap-3 border-x-0 border-t-0 px-4 md:hidden">
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
