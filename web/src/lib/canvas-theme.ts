export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

// 离火画布配色（雾霭紫）：浅色是雾紫纸面，深色是带紫调的近黑，选区与高亮用淡紫。
export const canvasThemes = {
    light: {
        canvas: {
            background: "#f4f2f9",
            dot: "rgba(80, 66, 110, .20)",
            line: "rgba(80, 66, 110, .09)",
            selectionStroke: "#6b57a8",
            selectionFill: "rgba(107, 87, 168, .10)",
        },
        node: {
            label: "#554b63",
            fill: "#e9e5f2",
            panel: "#ffffff",
            stroke: "#ddd7ea",
            activeStroke: "#6b57a8",
            placeholder: "#9a8fac",
            text: "#1a1526",
            muted: "#655b74",
            faint: "#b3a9c0",
        },
        toolbar: {
            panel: "rgba(255, 255, 255, .96)",
            border: "#ddd7ea",
            item: "#554b63",
            itemHover: "#f1edf8",
            activeBg: "#e2daf3",
            activeText: "#1a1526",
        },
    },
    dark: {
        canvas: {
            background: "#0a0810",
            dot: "rgba(190, 170, 220, .18)",
            line: "rgba(190, 170, 220, .07)",
            selectionStroke: "#b9ace8",
            selectionFill: "rgba(185, 172, 232, .12)",
        },
        node: {
            label: "#b3aabe",
            fill: "#141122",
            panel: "#100d1a",
            stroke: "#241f33",
            activeStroke: "#b9ace8",
            placeholder: "#7a6f8c",
            text: "#ece7f7",
            muted: "#a99fb8",
            faint: "#655b74",
        },
        toolbar: {
            panel: "rgba(16, 13, 26, .96)",
            border: "#241f33",
            item: "#b3aabe",
            itemHover: "#1a1626",
            activeBg: "#2c2440",
            activeText: "#b9ace8",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
