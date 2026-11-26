/**
 * 云端渠道编码（纯函数，便于单测）
 * ------------------------------------------------------------
 * 平台渠道：lihuo-cloud::<modelId>
 * BYOK 渠道：byok:<channelId>::<modelId>
 * 本地渠道：<localChannelId>::<modelName>（不进入云端调用）
 */

export const CLOUD_CHANNEL_ID = "lihuo-cloud";
export const BYOK_CHANNEL_PREFIX = "byok:";

export interface CloudTarget {
    model: string;
    keySource: "platform" | "byok";
    byokChannelId?: string;
}

export function isCloudChannelId(channelId: string): boolean {
    return channelId === CLOUD_CHANNEL_ID || channelId.startsWith(BYOK_CHANNEL_PREFIX);
}

export function cloudChannelSource(channelId: string): { keySource: "platform" | "byok"; byokChannelId?: string } {
    return channelId.startsWith(BYOK_CHANNEL_PREFIX)
        ? { keySource: "byok", byokChannelId: channelId.slice(BYOK_CHANNEL_PREFIX.length) }
        : { keySource: "platform" };
}

export function resolveCloudTarget(value: string): CloudTarget | null {
    const raw = String(value || "");
    const index = raw.indexOf("::");
    if (index <= 0) return null;
    const channelId = raw.slice(0, index);
    const model = raw.slice(index + 2);
    if (!model) return null;
    if (channelId === CLOUD_CHANNEL_ID) return { model, keySource: "platform" };
    if (channelId.startsWith(BYOK_CHANNEL_PREFIX)) {
        const byokChannelId = channelId.slice(BYOK_CHANNEL_PREFIX.length);
        return byokChannelId ? { model, keySource: "byok", byokChannelId } : null;
    }
    return null;
}

export function encodeCloudModel(channelId: string, model: string): string {
    return `${channelId}::${model}`;
}

/**
 * 把编码过的模型字段展开成后端请求：只保留 modelId，并补上计费来源。
 * 非云端渠道（本地直连）原样返回，避免误改。
 */
export function normalizeCloudPayload<T extends Record<string, unknown>>(payload: T): T {
    const model = typeof payload.model === "string" ? payload.model : "";
    const index = model.indexOf("::");
    if (index <= 0) return payload;
    const channelId = model.slice(0, index);
    const name = model.slice(index + 2);
    if (!name) return payload;
    if (channelId === CLOUD_CHANNEL_ID) return { ...payload, model: name, keySource: "platform" };
    if (channelId.startsWith(BYOK_CHANNEL_PREFIX)) {
        const byokChannelId = channelId.slice(BYOK_CHANNEL_PREFIX.length);
        return byokChannelId ? { ...payload, model: name, keySource: "byok", byokChannelId } : payload;
    }
    return payload;
}
