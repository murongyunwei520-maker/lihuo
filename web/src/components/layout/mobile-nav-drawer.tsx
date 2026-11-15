import { Drawer } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useSidebarItems } from "@/components/layout/app-sidebar";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    onClose: () => void;
};

export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const items = useSidebarItems();

    return (
        <Drawer title={<span className="lihuo-signature text-lg text-[#6b57a8] dark:text-[#b9ace8]">lihuo</span>} placement="left" width={260} open={open} onClose={onClose}>
            <div className="space-y-1">
                {items.map((item) => {
                    const Icon = item.icon;
                    const className = cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                        item.active
                            ? "bg-[linear-gradient(100deg,rgba(139,124,200,0.2),rgba(127,212,232,0.14))] font-medium text-[#4b3f72] dark:text-[#d4cbf2]"
                            : "text-stone-600 hover:bg-[rgba(139,124,200,0.08)] hover:text-[#4b3f72] dark:text-stone-300 dark:hover:bg-white/[0.06] dark:hover:text-[#d4cbf2]",
                    );
                    const inner = (
                        <>
                            <Icon className="size-5" />
                            <span>{t(`navigation.${item.key}`)}</span>
                        </>
                    );
                    return item.to ? (
                        <Link key={item.key} to={item.to} onClick={onClose} className={className}>
                            {inner}
                        </Link>
                    ) : (
                        <button
                            key={item.key}
                            type="button"
                            className={className}
                            onClick={() => {
                                item.onClick?.();
                                onClose();
                            }}
                        >
                            {inner}
                        </button>
                    );
                })}
            </div>
        </Drawer>
    );
}
