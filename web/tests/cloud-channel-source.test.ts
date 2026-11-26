import { afterAll, expect, test } from "bun:test";

// Config store 初始化时会访问 localStorage；bun 环境没有 DOM，先补一个最小实现
const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { defaultConfig, useConfigStore, CLOUD_CHANNEL_ID } = await import("../src/stores/use-config-store");
const { isCloudChannelId, resolveCloudTarget } = await import("../src/lib/cloud-channel");

const reset = () => useConfigStore.setState({ config: { ...defaultConfig, channelMode: "cloud" }, cloudChannels: [] });

// 合并后：模型编码决定计费来源，平台与 BYOK 渠道同时进入选择器。

test("platform and byok models are encoded into their own channels", () => {
    reset();
    useConfigStore.getState().syncCloudModels(
        [
            { modelId: "demo-text", capability: "text", enabled: true },
            { modelId: "demo-image", capability: "image", enabled: true },
        ],
        [
            {
                id: "uk_1",
                name: "我的渠道",
                models: [
                    { modelId: "demo-text", capability: "text", enabled: true },
                    { modelId: "demo-video", capability: "video", enabled: true },
                    { modelId: "demo-image", capability: "image", enabled: false },
                ],
            },
        ],
    );

    const config = useConfigStore.getState().config;
    expect(config.channels.map((channel) => channel.id)).toEqual([CLOUD_CHANNEL_ID, "byok:uk_1"]);
    const byokChannel = config.channels[1];
    // 视频模型不进 BYOK 云端渠道；停用的模型也不进
    expect(byokChannel.models.map((model) => model.name)).toEqual(["demo-text"]);
    expect(byokChannel.name).toContain("我的 Key");
    expect(config.models).toContain("lihuo-cloud::demo-text");
    expect(config.models).toContain("byok:uk_1::demo-text");
});

test("selecting a byok model keeps the selection across syncs", () => {
    reset();
    useConfigStore.getState().syncCloudModels(
        [{ modelId: "demo-text", capability: "text", enabled: true }],
        [{ id: "uk_1", name: "我的渠道", models: [{ modelId: "demo-text", capability: "text", enabled: true }] }],
    );
    useConfigStore.getState().updateConfig("textModel", "byok:uk_1::demo-text");

    useConfigStore.getState().syncCloudModels(
        [
            { modelId: "demo-text", capability: "text", enabled: true },
            { modelId: "demo-text-2", capability: "text", enabled: true },
        ],
        [{ id: "uk_1", name: "我的渠道", models: [{ modelId: "demo-text", capability: "text", enabled: true }] }],
    );

    expect(useConfigStore.getState().config.textModel).toBe("byok:uk_1::demo-text");
});

test("removing a byok channel falls back to a platform model of the same capability", () => {
    reset();
    useConfigStore.getState().syncCloudModels(
        [
            { modelId: "demo-text", capability: "text", enabled: true },
            { modelId: "demo-image", capability: "image", enabled: true },
        ],
        [{ id: "uk_1", name: "我的渠道", models: [{ modelId: "demo-text", capability: "text", enabled: true }] }],
    );
    useConfigStore.getState().updateConfig("textModel", "byok:uk_1::demo-text");

    useConfigStore.getState().syncCloudModels(
        [
            { modelId: "demo-text", capability: "text", enabled: true },
            { modelId: "demo-image", capability: "image", enabled: true },
        ],
        [],
    );

    const selected = useConfigStore.getState().config.textModel;
    expect(selected.startsWith(`${CLOUD_CHANNEL_ID}::`)).toBe(true);
});

test("cloud readiness accepts platform and byok channels only", () => {
    const ready = useConfigStore.getState().isAiConfigReady;
    const config = {
        ...defaultConfig,
        channelMode: "cloud" as const,
        channels: [
            { id: CLOUD_CHANNEL_ID, name: "平台额度", baseUrl: "", apiKey: "", apiFormat: "openai" as const, models: [{ name: "demo-text", capability: "text" as const }] },
            { id: "byok:uk_1", name: "我的 Key", baseUrl: "", apiKey: "", apiFormat: "openai" as const, models: [{ name: "demo-text", capability: "text" as const }] },
        ],
    };
    expect(ready(config, "lihuo-cloud::demo-text")).toBe(true);
    expect(ready(config, "byok:uk_1::demo-text")).toBe(true);
    expect(ready(config, "byok:missing::demo-text")).toBe(false);
    expect(ready(config, "local::demo-text")).toBe(false);
});

test("model encoding resolves the billing source", () => {
    expect(resolveCloudTarget("lihuo-cloud::demo-text")).toEqual({ model: "demo-text", keySource: "platform" });
    expect(resolveCloudTarget("byok:uk_1::demo-text")).toEqual({
        model: "demo-text",
        keySource: "byok",
        byokChannelId: "uk_1",
    });
    expect(resolveCloudTarget("local::demo-text")).toBeNull();
    expect(resolveCloudTarget("demo-text")).toBeNull();
    expect(resolveCloudTarget("byok::demo-text")).toBeNull();

    expect(isCloudChannelId("lihuo-cloud")).toBe(true);
    expect(isCloudChannelId("byok:uk_1")).toBe(true);
    expect(isCloudChannelId("local")).toBe(false);
});
