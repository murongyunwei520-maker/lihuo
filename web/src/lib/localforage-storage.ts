import { STORAGE_NAMESPACE, storageKey } from "@/constant/app";
import {
    assertNoStaleFormalWrite,
    assertNoStaleProjectMetadata,
    createIndexedDbStudioStateStore,
    STUDIO_STORE_KEY,
} from "@/lib/studio-store-persistence";
import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: STORAGE_NAMESPACE,
    storeName: "app_state",
});

let studioStoreReadFailed = false;

function studioStoreReadError(error: unknown) {
    studioStoreReadFailed = true;
    const reason = error instanceof Error ? error.message : "本地工作区读取失败";
    try {
        window.dispatchEvent(new CustomEvent("lihuo:studio-store-read-blocked", { detail: { reason } }));
    } catch {
        // 事件只用于诊断；读取仍然必须拒绝回退。
    }
    return error instanceof Error ? error : new Error(reason);
}

/**
 * studio_store 只能读 IndexedDB 权威副本；读取失败必须 fail-closed，
 * 不能回退 localStorage 旧数据，也不能让空项目继续走迁移 / 整仓写入。
 */
export function isStudioStoreReadFailed() {
    return studioStoreReadFailed;
}

/**
 * 常规 Zustand 整仓写入的第二道闸门：不能把正式 storyboardVersion 写回旧值。
 * 最终原子 compare-and-write 在 storyboard-write-protocol 的 IndexedDB 事务内。
 */
async function guardedStudioStoreWrite(value: string) {
    if (studioStoreReadFailed) throw new Error("工作区读取失败，已暂停写入；请先重新读取");
    const store = createIndexedDbStudioStateStore();
    await store.transact((currentRaw) => {
        if (currentRaw === value) return { result: null };
        assertNoStaleFormalWrite(currentRaw, value);
        assertNoStaleProjectMetadata(currentRaw, value);
        return {
            nextRaw: value,
            result: null,
            verify: (readBack) => {
                if (!readBack) throw new Error("工作区写入后回读为空，已阻止提交");
                assertNoStaleFormalWrite(currentRaw, readBack);
            },
        };
    });
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        if (name === STUDIO_STORE_KEY) {
            try {
                const value = await createIndexedDbStudioStateStore().readRaw();
                studioStoreReadFailed = false;
                return value;
            } catch (error) {
                throw studioStoreReadError(error);
            }
        }
        try {
            const value = (await localforage.getItem<string>(name)) || null;
            return value;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        if (name === STUDIO_STORE_KEY) {
            try {
                await guardedStudioStoreWrite(value);
                return;
            } catch (error) {
                // studio_store 必须 fail-closed：IndexedDB 不可用时不能降级写 localforage / localStorage，
                // 否则会绕过正式分镜事务与同版本守卫。
                try {
                    window.dispatchEvent(new CustomEvent("lihuo:studio-store-write-blocked", {
                        detail: { reason: error instanceof Error ? error.message : "正式分镜写入被拒绝" },
                    }));
                } catch {
                    // 事件只用于提示；写入仍然必须拒绝。
                }
                throw error;
            }
        }
        try {
            await localforage.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
