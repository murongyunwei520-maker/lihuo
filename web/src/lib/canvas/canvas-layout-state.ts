// 画布布局的持久化快照。首次进入画布（没有快照）时四个区域默认收起；
// 一旦用户手动展开/收起，就记录为 initialized 并保留用户选择。
export type CanvasLayoutSnapshot = {
    initialized: boolean;
    topBarOpen: boolean;
    taskBarOpen: boolean;
    inspectorOpen: boolean;
    accountsOpen: boolean;
};

export const DEFAULT_CANVAS_LAYOUT: CanvasLayoutSnapshot = {
    initialized: false,
    topBarOpen: false,
    taskBarOpen: false,
    inspectorOpen: false,
    accountsOpen: false,
};

export function parseCanvasLayoutSnapshot(raw: string | null | undefined): CanvasLayoutSnapshot {
    if (!raw) return { ...DEFAULT_CANVAS_LAYOUT };
    try {
        const value = JSON.parse(raw) as Partial<CanvasLayoutSnapshot> | null;
        if (!value || typeof value !== "object") return { ...DEFAULT_CANVAS_LAYOUT };
        return {
            initialized: value.initialized === true,
            topBarOpen: value.topBarOpen === true,
            taskBarOpen: value.taskBarOpen === true,
            inspectorOpen: value.inspectorOpen === true,
            accountsOpen: value.accountsOpen === true,
        };
    } catch {
        return { ...DEFAULT_CANVAS_LAYOUT };
    }
}

export function serializeCanvasLayoutSnapshot(value: CanvasLayoutSnapshot) {
    return JSON.stringify(value);
}
