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
                        "studio-nav-item flex h-11 w-full items-center gap-3 rounded-xl px-3 text-base transition-all duration-200",
                        item.active && "is-active",
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
