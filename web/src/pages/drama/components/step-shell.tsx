import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
    title: string;
    subtitle?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    bodyClassName?: string;
};

/**
 * 每个步骤的统一外壳：标题 + 说明 + 右侧操作 / 可滚动正文 / 底部导航。
 * 只负责排版，不承载任何业务状态。
 */
export function StepShell({ title, subtitle, actions, children, footer, bodyClassName }: Props) {
    return (
        <section className="drama-panel flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 flex-wrap items-start gap-x-4 gap-y-2 border-b border-[var(--studio-border-soft)] px-5 py-3.5">
                {/* 标题给最小宽度：操作按钮多时整行下移，而不是把标题挤成一列字。 */}
                <div className="min-w-[220px] flex-1">
                    <h2 className="drama-h2">{title}</h2>
                    {subtitle ? <p className="drama-sub mt-0.5">{subtitle}</p> : null}
                </div>
                {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
            </header>
            <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>{children}</div>
            {footer ? <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--studio-border-soft)] px-5 py-3">{footer}</footer> : null}
        </section>
    );
}

/** 步骤内的分组卡片：标题 + 说明 + 内容，避免每处重复写边框与内边距。 */
export function Panel({ title, hint, actions, children, className }: { title?: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn("drama-card", className)}>
            {title || actions ? (
                <header className="mb-3 flex flex-wrap items-center gap-2">
                    {title ? <h3 className="drama-h3">{title}</h3> : null}
                    {hint ? <span className="drama-sub">{hint}</span> : null}
                    {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
                </header>
            ) : null}
            {children}
        </section>
    );
}
