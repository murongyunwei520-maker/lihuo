import { APP_BRAND, storageKey } from "@/constant/app";
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { DOUBAO_BUILTIN_CHANNEL_ID, DOLA_BUILTIN_CHANNEL_ID, getDolaBuiltinChannel, getDoubaoBuiltinChannel } from "@/constants/doubao-builtin";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
    /** 展示名（BYOK 自定义模型用；name 仍是解析用的稳定 ID） */
    label?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "cloud" | "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoMode: string;
    // 豆包内置模型用的账号：空表示跟随左侧号池的「当前账号」
    doubaoAccountId: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    proxyEnabled: boolean;
    proxyUrl: string;
    nodeRegenerateBehavior: "new-node" | "overwrite";
    autoFocusOnSelect: boolean;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "local-proxy" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

/** 登录后从后端同步的 BYOK 渠道摘要（只保留渲染模型选择器所需字段） */
export type CloudByokChannel = {
    id: string;
    name: string;
    isDefault?: boolean;
    models: Array<{
        modelId: string;
        capability: string;
        enabled: boolean;
        displayName?: string;
        source?: "platform" | "user";
        providerType?: string;
        protocol?: string;
    }>;
};

export type ChannelCredentialsImportResult = {
    status: "created" | "updated" | "missing-base-url" | "invalid-base-url";
    channelName?: string;
};

export const CONFIG_STORE_KEY = storageKey("ai_config_store");
/** 云端模式的虚拟渠道：模型清单来自离火后端的注册表 */
export { BYOK_CHANNEL_PREFIX, CLOUD_CHANNEL_ID, cloudChannelSource, isCloudChannelId } from "@/lib/cloud-channel";
import { BYOK_CHANNEL_PREFIX, CLOUD_CHANNEL_ID, isCloudChannelId } from "@/lib/cloud-channel";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
export const LOCAL_PROXY_PACKAGE = "@basketikun/canvas-proxy";
export const DEFAULT_LOCAL_PROXY_URL = "http://127.0.0.1:23210";

export const defaultConfig: AiConfig = {
    channelMode: "cloud",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: i18n.t("config.channels.defaultName"),
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoMode: "frames",
    doubaoAccountId: "",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
    proxyEnabled: false,
    proxyUrl: DEFAULT_LOCAL_PROXY_URL,
    nodeRegenerateBehavior: "new-node",
    autoFocusOnSelect: false,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: APP_BRAND.namespace,
    lastSyncedAt: "",
};

/**
 * 凭证只保留在运行内存中：写盘、读取历史持久化数据、导出配置文件时都先剥离。
 * 浏览器 localStorage 与下载的配置 JSON 因此不会残留上游 API Key。
 */
export function withoutCredentials(config: AiConfig): AiConfig {
    return {
        ...config,
        apiKey: "",
        channels: (Array.isArray(config.channels) ? config.channels : []).map((channel) => ({ ...channel, apiKey: "" })),
    };
}

/** 旧版本曾把 API Key 写进 localStorage；启动时就地擦除，保留其余偏好。 */
function purgePersistedCredentials() {
    if (typeof window === "undefined") return;
    try {
        const raw = window.localStorage.getItem(CONFIG_STORE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { state?: { config?: Partial<AiConfig>; webdav?: Partial<WebdavSyncConfig> } };
        const config = parsed.state?.config;
        const webdav = parsed.state?.webdav;
        const channels = Array.isArray(config?.channels) ? config.channels : [];
        const hasConfigSecret = Boolean(config?.apiKey) || channels.some((channel) => channel.apiKey);
        const hasWebdavSecret = Boolean(webdav?.password);
        if (!hasConfigSecret && !hasWebdavSecret) return;
        const scrubbed = config
            ? {
                  ...config,
                  apiKey: "",
                  channels: channels.map((channel) => ({ ...channel, apiKey: "" })),
              }
            : undefined;
        window.localStorage.setItem(
            CONFIG_STORE_KEY,
            JSON.stringify({
                ...parsed,
                state: {
                    ...parsed.state,
                    ...(scrubbed ? { config: scrubbed } : {}),
                    ...(webdav ? { webdav: { ...webdav, password: "" } } : {}),
                },
            }),
        );
    } catch {
        // 存储损坏或被禁用时忽略；merge 仍会剥离进入内存的凭证
    }
}

type ConfigStore = {
    config: AiConfig;
    cloudChannel: ModelChannel | null;
    /** 云端模式下的全部渠道：平台渠道 + 各 BYOK 渠道 */
    cloudChannels: ModelChannel[];
    /** 切到云端前的本地渠道快照：切回本地模式时恢复，避免丢配置 */
    localChannels: ModelChannel[];
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    syncCloudModels: (
        items: Array<{ modelId: string; capability: ModelCapability | "embedding"; enabled?: boolean }>,
        byokChannels?: CloudByokChannel[],
    ) => void;
    setChannelMode: (mode: "cloud" | "local" | "remote") => void;
    importChannelCredentials: (input: { baseUrl?: string | null; apiKey?: string | null }) => ChannelCredentialsImportResult;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["video", "sora", "veo", "kling", "wan", "hailuo"];

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const pool = allChannels(config);
    const channel = decoded ? pool.find((item) => item.id === decoded.channelId) : pool.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

/** 合并用户配置的 channels 和系统内置 channel（豆包 / Dola）。 */
export function allChannels(config: AiConfig): ModelChannel[] {
    // 豆包与 Dola 都是内置渠道：同一套桥接，模型列表按各自面板文案
    return [...config.channels, getDoubaoBuiltinChannel(), getDolaBuiltinChannel()];
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    for (const model of [currentModel, defaultModel]) {
        if (!model) continue;
        const configuredCapability = modelCapabilityOf(config, model);
        // Keep unavailable selections visible so the readiness check blocks the
        // request. Only a known capability switch may choose another model.
        if (!configuredCapability || configuredCapability === capability) return model;
    }
    return fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return allChannels(config).flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

/**
 * 本机 / 内网地址：本地部署的 OpenAI 兼容服务（vLLM、LM Studio、Ollama、one-api 自建实例）通常不校验 Key。
 * 以前的判定硬要求 apiKey 非空，于是选到这类渠道点生成只会弹「配置与用户偏好」，看起来像"不能用"。
 * 只覆盖回环与私有网段，公网域名仍然要求填 Key（真缺凭证时请求会 401，不该被静默放过去）。
 */
export function isLoopbackBaseUrl(baseUrl: string) {
    try {
        const host = new URL(baseUrl.trim()).hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]" || host.endsWith(".localhost")) return true;
        if (host === "host.docker.internal") return true;
        return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    } catch {
        return false;
    }
}

export function isAiConfigReady(config: AiConfig, model: string) {
    const match = findChannelModel(config, model);
    if (!match) return false;
    // 云端模式：凭证在服务端，平台渠道或 BYOK 渠道都算就绪
    if (config.channelMode === "cloud") return isCloudChannelId(match.channel.id);
    // 内置站点（豆包 / Dola）：凭证来自 bridge 账号池，这里不要求 baseUrl/apiKey。
    // 之前只放过了 builtin-doubao，导致画布上选 Dola 模型时被判定「没配置 API」，直接拦掉、发不出任务。
    if (match.channel.id === DOUBAO_BUILTIN_CHANNEL_ID || match.channel.id === DOLA_BUILTIN_CHANNEL_ID) return true;
    const baseUrl = match.channel.baseUrl.trim();
    if (!baseUrl) return false;
    // 本地服务允许空 Key；远程渠道仍然要求填 Key，避免把"没配好"悄悄放过去变成 401
    return Boolean(match.channel.apiKey.trim()) || isLoopbackBaseUrl(baseUrl);
}

/** 未就绪的具体原因，用来在弹配置对话框前提示一句，避免用户只看到弹窗不知道缺什么。 */
export function describeConfigGap(config: AiConfig, model: string) {
    const match = findChannelModel(config, model);
    if (!match) return model.trim() ? `模型「${modelOptionName(model)}」不在任何渠道里，请重新选一次模型` : "还没选择模型";
    if (config.channelMode === "cloud") return isCloudChannelId(match.channel.id) ? "" : "当前不是云端模型，请重新选择";
    if (match.channel.id === DOUBAO_BUILTIN_CHANNEL_ID || match.channel.id === DOLA_BUILTIN_CHANNEL_ID) return "";
    const baseUrl = match.channel.baseUrl.trim();
    if (!baseUrl) return `渠道「${match.channel.name}」缺 Base URL`;
    if (!match.channel.apiKey.trim() && !isLoopbackBaseUrl(baseUrl)) return `渠道「${match.channel.name}」缺 API Key`;
    return "";
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            cloudChannel: null,
            cloudChannels: [],
            localChannels: [],
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            /**
             * 登录/渠道变更后同步云端模型。
             * 平台渠道只读；BYOK 渠道由用户维护，模型编码进各自渠道，选择模型即选择计费来源。
             */
            syncCloudModels: (items, byokChannels = []) => {
                const platformModels = items
                    .filter((item) => item.enabled !== false && item.capability !== "embedding")
                    .map((item) => ({ name: item.modelId, capability: item.capability as ModelCapability }));
                const platformChannel: ModelChannel = {
                    id: CLOUD_CHANNEL_ID,
                    name: "平台额度",
                    baseUrl: "",
                    apiKey: "",
                    apiFormat: "openai",
                    models: platformModels,
                };

                const byokModelChannels: ModelChannel[] = [];
                for (const channel of byokChannels) {
                    const models = (channel.models ?? [])
                        // BYOK 暂时不支持视频任务；embedding 不进模型选择器；unknown 说明模型已被删除
                        .filter((model) => model.enabled && ["text", "image", "audio"].includes(model.capability))
                        .map((model) => ({
                            name: model.modelId,
                            capability: model.capability as ModelCapability,
                            label: model.displayName && model.displayName !== model.modelId ? model.displayName : undefined,
                        }));
                    if (!models.length) continue;
                    byokModelChannels.push({
                        id: `${BYOK_CHANNEL_PREFIX}${channel.id}`,
                        name: `我的 Key · ${channel.name}`,
                        baseUrl: "",
                        apiKey: "",
                        apiFormat: "openai",
                        models,
                    });
                }

                const channels = [platformChannel, ...byokModelChannels];
                const all = channels.flatMap((channel) =>
                    channel.models.map((model) => ({
                        encoded: encodeChannelModel(channel.id, model.name),
                        name: model.name,
                        capability: model.capability,
                    })),
                );
                const options = all.map((item) => item.encoded);
                const ensure = (current: string, capability: ModelCapability) => {
                    if (current && options.includes(current)) return current;
                    const name = modelOptionName(current);
                    const hit =
                        all.find((item) => item.name === name && item.capability === capability) ??
                        all.find((item) => item.capability === capability && item.encoded.startsWith(`${CLOUD_CHANNEL_ID}::`)) ??
                        all.find((item) => item.capability === capability);
                    return hit?.encoded ?? "";
                };

                set((state) => {
                    const localSnapshot = state.config.channels.filter((channel) => !isCloudChannelId(channel.id));
                    if (state.config.channelMode !== "cloud") {
                        return { cloudChannel: platformChannel, cloudChannels: channels };
                    }
                    return {
                        cloudChannel: platformChannel,
                        cloudChannels: channels,
                        localChannels: localSnapshot.length ? localSnapshot : state.localChannels,
                        config: {
                            ...state.config,
                            channels,
                            models: options,
                            imageModel: ensure(state.config.imageModel, "image"),
                            videoModel: ensure(state.config.videoModel, "video"),
                            textModel: ensure(state.config.textModel, "text"),
                            audioModel: ensure(state.config.audioModel, "audio"),
                        },
                    };
                });
            },
            setChannelMode: (mode) =>
                set((state) => {
                    if (mode !== "cloud") {
                        const local = state.localChannels.length
                            ? state.localChannels
                            : state.config.channels.filter((channel) => !isCloudChannelId(channel.id));
                        const channels = local.length ? local : state.config.channels;
                        const all = channels.flatMap((channel) =>
                            channel.models.map((model) => ({
                                encoded: encodeChannelModel(channel.id, model.name),
                                name: model.name,
                                capability: model.capability,
                            })),
                        );
                        const options = all.map((item) => item.encoded);
                        const ensure = (current: string, capability: ModelCapability) => {
                            if (current && options.includes(current)) return current;
                            const name = modelOptionName(current);
                            const hit =
                                all.find((item) => item.name === name && item.capability === capability) ??
                                all.find((item) => item.capability === capability);
                            return hit?.encoded ?? "";
                        };
                        return {
                            localChannels: local,
                            config: {
                                ...state.config,
                                channelMode: mode,
                                channels,
                                models: options,
                                imageModel: ensure(state.config.imageModel, "image"),
                                videoModel: ensure(state.config.videoModel, "video"),
                                textModel: ensure(state.config.textModel, "text"),
                                audioModel: ensure(state.config.audioModel, "audio"),
                            },
                        };
                    }
                    const channels = state.cloudChannels.length
                        ? state.cloudChannels
                        : state.cloudChannel
                          ? [state.cloudChannel]
                          : [];
                    if (!channels.length) return { config: { ...state.config, channelMode: mode } };
                    const localSnapshot = state.config.channels.filter((channel) => !isCloudChannelId(channel.id));
                    const all = channels.flatMap((channel) =>
                        channel.models.map((model) => ({
                            encoded: encodeChannelModel(channel.id, model.name),
                            name: model.name,
                            capability: model.capability,
                        })),
                    );
                    const options = all.map((item) => item.encoded);
                    const ensure = (current: string, capability: ModelCapability) => {
                        if (current && options.includes(current)) return current;
                        const name = modelOptionName(current);
                        const hit =
                            all.find((item) => item.name === name && item.capability === capability) ??
                            all.find((item) => item.capability === capability && item.encoded.startsWith(`${CLOUD_CHANNEL_ID}::`)) ??
                            all.find((item) => item.capability === capability);
                        return hit?.encoded ?? "";
                    };
                    return {
                        localChannels: localSnapshot.length ? localSnapshot : state.localChannels,
                        config: {
                            ...state.config,
                            channelMode: mode,
                            channels,
                            models: options,
                            imageModel: ensure(state.config.imageModel, "image"),
                            videoModel: ensure(state.config.videoModel, "video"),
                            textModel: ensure(state.config.textModel, "text"),
                            audioModel: ensure(state.config.audioModel, "audio"),
                        },
                    };
                }),
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            importChannelCredentials: (input) => {
                const currentConfig = get().config;
                const result = upsertChannelCredentials(currentConfig, input);
                if (result.config !== currentConfig) set({ config: result.config });
                return { status: result.status, channelName: result.channelName };
            },
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            // 凭证不落盘：只持久化配置结构与偏好
            partialize: (state) => ({
                config: withoutCredentials(state.config),
                // WebDAV 密码同样是凭证：只留在本次会话内存，不写 localStorage。
                webdav: { ...state.webdav, password: "" },
                localChannels: state.localChannels.map((channel) => ({ ...channel, apiKey: "" })),
            }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                // 旧版本落过盘的 Key 不重新带回内存
                const config = withoutCredentials({ ...defaultConfig, ...persistedConfig });
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const persistedLocal = (persistedState as { localChannels?: unknown }).localChannels;
                const localChannels = Array.isArray(persistedLocal)
                    ? (persistedLocal as ModelChannel[]).map((channel) => ({ ...channel, apiKey: "" }))
                    : [];
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    localChannels,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav, password: "" },
                    config: {
                        ...config,
                        channelMode: persistedConfig.channelMode === "local" || persistedConfig.channelMode === "remote" ? persistedConfig.channelMode : "cloud",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        videoMode: config.videoMode === "reference" ? "reference" : "frames",
                        doubaoAccountId: typeof config.doubaoAccountId === "string" ? config.doubaoAccountId : "",
                        canvasImageCount: config.canvasImageCount || "3",
                        proxyEnabled: Boolean(config.proxyEnabled),
                        proxyUrl: config.proxyUrl || DEFAULT_LOCAL_PROXY_URL,
                        nodeRegenerateBehavior: config.nodeRegenerateBehavior === "overwrite" ? "overwrite" : "new-node",
                        autoFocusOnSelect: Boolean(config.autoFocusOnSelect),
                    },
                };
            },
        },
    ),
);

purgePersistedCredentials();

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const label = typeof item === "string" ? undefined : item.label?.trim() || undefined;
        result.push({ name, capability, script, label });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function upsertChannelCredentials(
    config: AiConfig,
    input: { baseUrl?: string | null; apiKey?: string | null },
): ChannelCredentialsImportResult & { config: AiConfig } {
    const rawBaseUrl = input.baseUrl?.trim() || "";
    if (!rawBaseUrl) return { status: "missing-base-url", config };
    if (!isHttpBaseUrl(rawBaseUrl)) return { status: "invalid-base-url", config };

    const baseUrl = normalizeImportedBaseUrl(rawBaseUrl);
    const apiKey = input.apiKey?.trim() || "";
    const matchingIndex = config.channels.findIndex((channel) => normalizedBaseUrlKey(channel.baseUrl) === normalizedBaseUrlKey(baseUrl));

    if (matchingIndex >= 0) {
        const existing = config.channels[matchingIndex];
        if (existing.baseUrl === baseUrl && (!apiKey || existing.apiKey === apiKey)) {
            return { status: "updated", channelName: existing.name, config };
        }
        const updated = { ...existing, baseUrl, ...(apiKey ? { apiKey } : {}) };
        const channels = config.channels.map((channel, index) => (index === matchingIndex ? updated : channel));
        return { status: "updated", channelName: existing.name, config: { ...config, channels } };
    }

    const channel = createModelChannel({
        name: importedChannelName(baseUrl),
        baseUrl,
        apiKey,
        apiFormat: "openai",
        models: [],
    });
    return { status: "created", channelName: channel.name, config: { ...config, channels: [...config.channels, channel] } };
}

function isHttpBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function normalizedBaseUrlKey(baseUrl: string) {
    try {
        return stripTrailingApiVersion(normalizeImportedBaseUrl(baseUrl));
    } catch {
        return stripTrailingApiVersion(baseUrl.trim().replace(/\/+$/, ""));
    }
}

function normalizeImportedBaseUrl(baseUrl: string) {
    const url = new URL(baseUrl.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
}

function stripTrailingApiVersion(baseUrl: string) {
    return baseUrl.replace(/\/v1$/i, "");
}

function importedChannelName(baseUrl: string) {
    const hostname = new URL(baseUrl).hostname;
    return hostname.replace(/^(?:www|api)\./i, "") || i18n.t("config.channels.newName");
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = allChannels(config).find((item) => item.id === decoded.channelId);
    if (!channel) return decoded.model;
    const model = channel.models.find((item) => item.name === decoded.model);
    return `${model?.label || decoded.model}（${channel.name}）`;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    const pool = [...channels, getDoubaoBuiltinChannel()];
    if (decoded) {
        const channel = pool.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = pool.find((item) => item.models.some((entry) => entry.name === model)) || pool[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const pool = allChannels(config);
    const matched = decoded ? pool.find((channel) => channel.id === decoded.channelId) : pool.find((channel) => channel.models.some((item) => item.name === model));
    return matched || pool[0] || createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? i18n.t("config.channels.defaultName") : i18n.t("config.channels.indexedName", { index: index + 1 })),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: i18n.t("config.channels.defaultName"),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return withLocalProxy(`${apiBaseUrl}${path}`);
}

export function normalizeLocalProxyUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Prefix an outgoing request with the local forwarding proxy so the browser is not blocked by CORS. */
export function withLocalProxy(url: string) {
    const { proxyEnabled, proxyUrl } = useConfigStore.getState().config;
    if (!proxyEnabled || !/^https?:\/\//i.test(url)) return url;
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base || url.startsWith(`${base}/`)) return url;
    return `${base}/${url}`;
}
