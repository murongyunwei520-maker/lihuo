import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

import { APP_BRAND } from "@/constant/app";

// 离火品牌色（雾霭紫）：紫作主色，底色是带紫调的近黑与雾紫白。
// 浅色用深紫保证对比度，深色用淡紫保证在暗底上的可读性。
const brand = {
    light: {
        primary: "#6b57a8",
        primaryHover: "#584693",
        primaryText: "#ffffff",
        elevatedBg: "#ffffff",
        itemHoverBg: "rgba(107, 87, 168, 0.08)",
        itemSelectedBg: "rgba(107, 87, 168, 0.14)",
        itemSelectedHoverBg: "rgba(107, 87, 168, 0.20)",
        itemText: "#1a1526",
        tableSelectedBg: "rgba(107, 87, 168, 0.08)",
        tableSelectedHoverBg: "rgba(107, 87, 168, 0.14)",
    },
    dark: {
        primary: "#b9ace8",
        primaryHover: "#cdc2f2",
        primaryText: "#120e1f",
        elevatedBg: "#12101c",
        itemHoverBg: "rgba(185, 172, 232, 0.10)",
        itemSelectedBg: "rgba(185, 172, 232, 0.16)",
        itemSelectedHoverBg: "rgba(185, 172, 232, 0.22)",
        itemText: "#ece7f7",
        tableSelectedBg: "rgba(185, 172, 232, 0.12)",
        tableSelectedHoverBg: "rgba(185, 172, 232, 0.18)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? brand.dark : brand.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: `${APP_BRAND.namespace}-${dark ? "dark" : "light"}` },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            // 链接保持中性色，品牌色只用在按钮与强调元素上；悬停再给品牌反馈。
            colorLink: color.itemText,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgElevated: color.elevatedBg,
            controlItemBgHover: color.itemHoverBg,
            controlItemBgActive: color.itemSelectedBg,
            controlItemBgActiveHover: color.itemSelectedHoverBg,
            borderRadius: 10,
        },
        components: {
            Button: {
                primaryShadow: "none",
                fontWeight: 500,
            },
            Dropdown: {
                colorBgElevated: color.elevatedBg,
                colorText: color.itemText,
                controlItemBgHover: color.itemHoverBg,
                controlItemBgActive: color.itemSelectedBg,
                controlItemBgActiveHover: color.itemSelectedHoverBg,
            },
            Menu: {
                popupBg: color.elevatedBg,
                itemActiveBg: color.itemSelectedBg,
                itemHoverBg: color.itemHoverBg,
                itemSelectedBg: color.itemSelectedBg,
                itemSelectedColor: color.itemText,
                darkPopupBg: brand.dark.elevatedBg,
                darkItemHoverBg: brand.dark.itemHoverBg,
                darkItemSelectedBg: brand.dark.itemSelectedBg,
                darkItemSelectedColor: brand.dark.itemText,
            },
            Select: {
                optionActiveBg: color.itemHoverBg,
                optionSelectedBg: color.itemSelectedBg,
                optionSelectedColor: color.itemText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
