import { create } from "zustand";

import { DEFAULT_CANVAS_LAYOUT, parseCanvasLayoutSnapshot, serializeCanvasLayoutSnapshot, type CanvasLayoutSnapshot } from "@/lib/canvas/canvas-layout-state";

const LAYOUT_KEY = "canvas-layout-v1";
const SIDE_PANEL_OPEN_KEY = "canvas-side-panel-open";

function readSnapshot() {
    if (typeof window === "undefined") return { ...DEFAULT_CANVAS_LAYOUT };
    try {
        return parseCanvasLayoutSnapshot(localStorage.getItem(LAYOUT_KEY));
    } catch {
        return { ...DEFAULT_CANVAS_LAYOUT };
    }
}

function writeSnapshot(snapshot: CanvasLayoutSnapshot) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(LAYOUT_KEY, serializeCanvasLayoutSnapshot(snapshot));
    } catch {
        /* localStorage 不可用时只保留本次会话状态 */
    }
}

/** 是否已经完成首次布局初始化（用于左侧面板在首帧就决定是否展开，避免先开后收的闪烁）。 */
export function isCanvasLayoutInitialized() {
    return readSnapshot().initialized;
}

/** 首次进入画布：四个区域全部收起；只执行一次，后续尊重用户手动选择。 */
export function initializeCanvasLayout() {
    const current = readSnapshot();
    if (current.initialized) return;
    const next: CanvasLayoutSnapshot = { ...DEFAULT_CANVAS_LAYOUT, initialized: true };
    useCanvasLayoutStore.setState(next);
    writeSnapshot(next);
    if (typeof window !== "undefined") {
        try {
            localStorage.setItem(SIDE_PANEL_OPEN_KEY, "0");
        } catch {
            /* ignore */
        }
    }
}

type CanvasLayoutStore = CanvasLayoutSnapshot & {
    setTopBarOpen: (open: boolean) => void;
    setTaskBarOpen: (open: boolean) => void;
    setInspectorOpen: (open: boolean) => void;
    setAccountsOpen: (open: boolean) => void;
    toggleTopBar: () => void;
    toggleTaskBar: () => void;
    toggleInspector: () => void;
    toggleAccounts: () => void;
};

const initial = readSnapshot();

function persistFromState(state: CanvasLayoutStore) {
    writeSnapshot({
        initialized: true,
        topBarOpen: state.topBarOpen,
        taskBarOpen: state.taskBarOpen,
        inspectorOpen: state.inspectorOpen,
        accountsOpen: state.accountsOpen,
    });
}

export const useCanvasLayoutStore = create<CanvasLayoutStore>((set, get) => {
    const commit = (patch: Partial<CanvasLayoutSnapshot>) => {
        set((state) => ({ ...state, ...patch, initialized: true }));
        persistFromState(get());
    };
    return {
        ...initial,
        setTopBarOpen: (open) => commit({ topBarOpen: open }),
        setTaskBarOpen: (open) => commit({ taskBarOpen: open }),
        setInspectorOpen: (open) => commit({ inspectorOpen: open }),
        setAccountsOpen: (open) => commit({ accountsOpen: open }),
        toggleTopBar: () => commit({ topBarOpen: !get().topBarOpen }),
        toggleTaskBar: () => commit({ taskBarOpen: !get().taskBarOpen }),
        toggleInspector: () => commit({ inspectorOpen: !get().inspectorOpen }),
        toggleAccounts: () => commit({ accountsOpen: !get().accountsOpen }),
    };
});
