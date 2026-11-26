import { request } from "./lihuo-server";

/**
 * BYOK 用户渠道
 * ------------------------------------------------------------
 * 一个渠道 = 一个上游连接 + 一把用户 Key + 一组模型映射。
 * 接口只返回脱敏结果（末 4 位），没有任何读取明文的入口；
 * 调用时只提交渠道 ID，密钥本身不出浏览器。
 */

export type ByokProvider = "openai" | "anthropic" | "gemini" | "newapi" | "custom" | "mock";

export interface ByokProviderInfo {
    value: ByokProvider;
    label: string;
    defaultBaseUrl: string;
    baseUrlRequired: boolean;
    editableBaseUrl: boolean;
}

export interface ByokChannelModel {
    id: number;
    modelId: string;
    providerModel: string;
    enabled: boolean;
    source: "platform" | "user";
    displayName: string;
    capability: string;
    providerType?: ByokProvider;
    protocol?: string;
}

export interface ByokChannel {
    id: string;
    kind: "byok";
    name: string;
    providerType: ByokProvider;
    baseUrl: string;
    hasKey: boolean;
    apiKeyHint: string;
    apiKeyVersion: number;
    isDefault: boolean;
    lastTestAt: number | null;
    lastTestOk: boolean | null;
    lastError: string | null;
    lastUsedAt: number | null;
    lastCallStatus: string | null;
    callCount: number;
    failCount: number;
    createdAt: number;
    updatedAt: number;
    models: ByokChannelModel[];
}

export interface ByokChannelList {
    items: ByokChannel[];
    providers: ByokProviderInfo[];
    maxChannels: number;
}

export interface ByokCatalogModel {
    modelId: string;
    source: "platform" | "user";
    displayName: string;
    capability: string;
    streaming: boolean;
    vision: boolean;
    toolCalling: boolean;
    supportsVideo: boolean;
    contextLength: number | null;
    enabled: boolean;
    providerType?: ByokProvider;
    protocol?: string;
}

export interface ByokCatalog {
    providers: ByokProviderInfo[];
    models: ByokCatalogModel[];
}

export interface ByokChannelModelInput {
    modelId: string;
    providerModel: string;
    enabled?: boolean;
    modelSource?: "catalog" | "custom";
}

export interface ByokUserModel {
    id: string;
    source: "user";
    name: string;
    providerType: ByokProvider;
    protocol: "openai" | "anthropic" | "gemini";
    capability: "text" | "image" | "audio";
    supportsStreaming: boolean;
    supportsVision: boolean;
    supportsTools: boolean;
    contextLength: number | null;
    maxOutputTokens: number | null;
    supportedParameters: string[];
    bindingCount: number;
    createdAt: number;
    updatedAt: number;
}

export interface ByokUserModelInput {
    name: string;
    providerType: ByokProvider;
    capability: "text" | "image" | "audio";
    supportsStreaming?: boolean;
    supportsVision?: boolean;
    supportsTools?: boolean;
    contextLength?: number | null;
    maxOutputTokens?: number | null;
    supportedParameters?: string[];
}

export interface ByokTestResult {
    ok: boolean;
    status: number;
    latencyMs: number;
    error: string | null;
    checkedAt: number;
}

export interface ByokQuotaLimits {
    qps: number;
    burst: number;
    maxConcurrent: number;
    dailyRequests: number;
    imageDaily: number;
    imageConcurrent: number;
    audioDaily: number;
    audioConcurrent: number;
    streamConcurrent: number;
    streamIdleTimeoutMs: number;
    streamMaxDurationMs: number;
    requestTimeoutMs: number;
    maxChatRequestBytes: number;
    maxImageRequestBytes: number;
    maxAudioRequestBytes: number;
    maxResponseBytes: number;
}

export interface ByokQuota {
    plan: { id: string; name: string; description?: string; version: number; isDefault?: boolean };
    planId: string | null;
    limits: ByokQuotaLimits;
    usage: {
        requests: number;
        chat: number;
        image: number;
        audio: number;
        stream: number;
        concurrent: number;
        streams: number;
    };
    resetAt: number;
}

export interface ByokUsageRow {
    id: number;
    model: string;
    endpoint: string;
    status: string;
    prompt_tokens: number;
    completion_tokens: number;
    gateway_request_id: string | null;
    error: string | null;
    created_at: number;
}

export const byokApi = {
    providers(): Promise<{ items: ByokProviderInfo[] }> {
        return request("/api/byok/providers");
    },
    catalog(): Promise<ByokCatalog> {
        return request("/api/me/channels/catalog");
    },
    quota(): Promise<ByokQuota> {
        return request("/api/me/byok-quota");
    },
    userModels(): Promise<{ items: ByokUserModel[]; maxModels: number }> {
        return request("/api/me/models");
    },
    createUserModel(payload: ByokUserModelInput): Promise<ByokUserModel> {
        return request("/api/me/models", { method: "POST", body: JSON.stringify(payload) });
    },
    updateUserModel(id: string, payload: Partial<Omit<ByokUserModelInput, "providerType" | "capability">>): Promise<ByokUserModel> {
        return request(`/api/me/models/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    deleteUserModel(id: string): Promise<{ deleted: string }> {
        return request(`/api/me/models/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    channels(): Promise<ByokChannelList> {
        return request("/api/me/channels");
    },
    channel(id: string): Promise<ByokChannel> {
        return request(`/api/me/channels/${encodeURIComponent(id)}`);
    },
    createChannel(payload: {
        name: string;
        providerType: ByokProvider;
        apiKey: string;
        baseUrl?: string;
        models: ByokChannelModelInput[];
        isDefault?: boolean;
    }): Promise<ByokChannel> {
        return request("/api/me/channels", { method: "POST", body: JSON.stringify(payload) });
    },
    updateChannel(id: string, payload: { name?: string; baseUrl?: string; isDefault?: boolean }): Promise<ByokChannel> {
        return request(`/api/me/channels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    rotateChannelKey(id: string, apiKey: string): Promise<ByokChannel> {
        return request(`/api/me/channels/${encodeURIComponent(id)}/key`, { method: "PUT", body: JSON.stringify({ apiKey }) });
    },
    deleteChannel(id: string): Promise<{ deleted: string }> {
        return request(`/api/me/channels/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    testChannel(id: string): Promise<ByokTestResult> {
        return request(`/api/me/channels/${encodeURIComponent(id)}/test`, { method: "POST" });
    },
    updateChannelModels(id: string, models: ByokChannelModelInput[]): Promise<{ items: ByokChannelModel[] }> {
        return request(`/api/me/channels/${encodeURIComponent(id)}/models`, {
            method: "PUT",
            body: JSON.stringify({ models }),
        });
    },
    channelUsage(id: string, limit = 30): Promise<{ items: ByokUsageRow[] }> {
        return request(`/api/me/channels/${encodeURIComponent(id)}/usage?limit=${limit}`);
    },
};
