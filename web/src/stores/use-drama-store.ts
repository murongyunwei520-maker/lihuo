import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { storageKey } from "@/constant/app";
import { createEmptySequence, createSampleSequence } from "@/lib/drama/sample";
import { localForageStorage } from "@/lib/localforage-storage";
import type { DramaSequence } from "@/types/drama";

export type SequencePatch = Partial<
    Pick<DramaSequence, "title" | "targetSeconds" | "shots" | "assets" | "script" | "settings" | "projectId" | "bible" | "bibleHash" | "voices" | "exportedAt" | "split">
>;

type DramaStore = {
    hydrated: boolean;
    sequences: DramaSequence[];
    createSequence: (title: string, options?: { sample?: boolean }) => string;
    deleteSequence: (id: string) => void;
    updateSequence: (id: string, patch: SequencePatch) => void;
};

export const useDramaStore = create<DramaStore>()(
    persist(
        (set) => ({
            hydrated: false,
            sequences: [],
            createSequence: (title, options) => {
                const sequence = options?.sample ? createSampleSequence(title) : createEmptySequence(title);
                set((state) => ({ sequences: [sequence, ...state.sequences] }));
                return sequence.id;
            },
            deleteSequence: (id) => set((state) => ({ sequences: state.sequences.filter((sequence) => sequence.id !== id) })),
            updateSequence: (id, patch) =>
                set((state) => ({
                    sequences: state.sequences.map((sequence) => (sequence.id === id ? { ...sequence, ...patch, updatedAt: new Date().toISOString() } : sequence)),
                })),
        }),
        {
            name: storageKey("drama_store"),
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ sequences: state.sequences }),
            // 与画布、素材 store 保持一致：直接对 store 解锁，不依赖回调里的 state。
            // rehydration 出错时 state 会是 undefined，用 state?.setHydrated() 会让页面永远停在「正在读取本地数据」。
            onRehydrateStorage: () => () => {
                useDramaStore.setState({ hydrated: true });
            },
        },
    ),
);

export function useCurrentSequence(id: string | null) {
    return useDramaStore((state) => state.sequences.find((sequence) => sequence.id === id) ?? null);
}
