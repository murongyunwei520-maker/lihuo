import { create } from "zustand";
import { persist } from "zustand/middleware";

import { storageKey } from "@/constant/app";

// 当前手动指定的豆包账号。智能模式只做推荐，真正的选择永远由用户确认后写进这里。
type DoubaoAccountStore = {
    currentAccountId: string | null;
    setCurrentAccount: (id: string | null) => void;
};

export const useDoubaoAccountStore = create<DoubaoAccountStore>()(
    persist(
        (set) => ({
            currentAccountId: null,
            setCurrentAccount: (id) => set({ currentAccountId: id }),
        }),
        { name: storageKey("doubao_account_store") },
    ),
);
