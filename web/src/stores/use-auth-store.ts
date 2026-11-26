import { create } from "zustand";

import { byokApi } from "@/services/api/byok";
import { listModels, login as apiLogin, logout as apiLogout, me, register as apiRegister, type SessionUser } from "@/services/api/lihuo-server";
import { useConfigStore } from "@/stores/use-config-store";

/**
 * 会话状态
 * ------------------------------------------------------------
 * 凭据只在 HttpOnly Cookie 里，前端不接触 token。
 * 登录成功后顺手把云端模型同步进配置 store，供所有模型选择器使用。
 */

export type AuthStatus = "unknown" | "guest" | "authenticated";

type AuthStore = {
    status: AuthStatus;
    user: SessionUser | null;
    refreshing: boolean;
    /** 个人资料更新后同步到本地会话，避免整页刷新 */
    applyUser: (user: SessionUser) => void;
    refresh: () => Promise<void>;
    signIn: (username: string, password: string) => Promise<void>;
    signUp: (input: { username: string; password: string; email: string; inviteCode?: string }) => Promise<void>;
    signOut: () => Promise<void>;
};

async function syncCloudModels(): Promise<void> {
    try {
        const [{ items }, byok] = await Promise.all([
            listModels(),
            byokApi.channels().catch(() => ({ items: [], providers: [], maxChannels: 0 })),
        ]);
        useConfigStore.getState().syncCloudModels(
            items
                .filter((item) => item.capability !== "embedding")
                .map((item) => ({ modelId: item.modelId, capability: item.capability as "image" | "video" | "text" | "audio", enabled: item.enabled })),
            byok.items.map((channel) => ({
                id: channel.id,
                name: channel.name,
                isDefault: channel.isDefault,
                models: channel.models.map((model) => ({
                    modelId: model.modelId,
                    capability: model.capability,
                    enabled: model.enabled,
                    displayName: model.displayName,
                    source: model.source,
                    providerType: model.providerType,
                    protocol: model.protocol,
                })),
            })),
        );
    } catch {
        // 模型拉取失败不影响登录本身，界面上会表现为「没有可选模型」
    }
}

export const useAuthStore = create<AuthStore>((set) => ({
    status: "unknown",
    user: null,
    refreshing: false,

    applyUser: (user) => set({ status: "authenticated", user }),

    refresh: async () => {
        set({ refreshing: true });
        try {
            const user = await me();
            set({ status: "authenticated", user });
            await syncCloudModels();
        } catch {
            set({ status: "guest", user: null });
        } finally {
            set({ refreshing: false });
        }
    },

    signIn: async (username, password) => {
        const user = await apiLogin(username, password);
        set({ status: "authenticated", user });
        await syncCloudModels();
    },

    signUp: async (input) => {
        const user = await apiRegister(input);
        set({ status: "authenticated", user });
        await syncCloudModels();
    },

    signOut: async () => {
        try {
            await apiLogout();
        } finally {
            set({ status: "guest", user: null });
        }
    },
}));

/** 供非 React 环境（服务层）判断登录态 */
export function currentUser(): SessionUser | null {
    return useAuthStore.getState().user;
}
