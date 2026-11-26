import localforage from "localforage";
import { STORAGE_NAMESPACE } from "@/constant/app";

import { getMediaUrl, signMediaUpload, commitMediaUpload } from "./api/lihuo-server";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";

/**
 * 云端媒体（P0-4 / P0-5）
 * ------------------------------------------------------------
 * 云端模式下图片/视频/音频不再只存在 IndexedDB：
 *   sign（拿直传地址）→ 浏览器 PUT → commit（核对大小写库）→ 用后端 key 作为 storageKey
 * 节点里只保留 key，不再内联 base64，payload 才能保持在几十 KB。
 *
 * 本地模式完全不受影响：所有函数会直接返回 false / 回退。
 */

const keyMapStore = localforage.createInstance({ name: STORAGE_NAMESPACE, storeName: "cloud_media_keys" });
// 只读旧数据用：避免与 image-storage 相互 import
const legacyImages = localforage.createInstance({ name: STORAGE_NAMESPACE, storeName: "image_files" });
const legacyMedia = localforage.createInstance({ name: STORAGE_NAMESPACE, storeName: "media_files" });
const objectUrls = new Map<string, string>();
const pendingUrls = new Map<string, Promise<string>>();
const keyMemo = new Map<string, string>();

export function cloudMediaActive(): boolean {
    return useConfigStore.getState().config.channelMode === "cloud" && useAuthStore.getState().status === "authenticated";
}

/** 只判断是否配置了云端：读图时登录态可能还没确定，先试云端、失败再回退本地 */
export function cloudMediaConfigured(): boolean {
    return useConfigStore.getState().config.channelMode === "cloud";
}

/** 直传并登记：返回后端 media key 与可直接渲染的本地 object URL */
export async function uploadBlob(blob: Blob, fallbackMime = "application/octet-stream"): Promise<{ key: string; url: string }> {
    const mime = blob.type || fallbackMime;
    const signed = await signMediaUpload({ mime, bytes: blob.size });
    const res = await fetch(signed.uploadUrl, {
        method: signed.method || "PUT",
        headers: { "content-type": mime, ...(signed.headers || {}) },
        body: blob,
    });
    if (!res.ok) throw new Error(`媒体上传失败（${res.status}）`);

    await commitMediaUpload({ key: signed.key, bytes: blob.size, mime });
    const url = URL.createObjectURL(blob);
    objectUrls.set(signed.key, url);
    // 本地留一份缓存：断网时还能显示，也便于缩略图复用
    await legacyImages.setItem(signed.key, blob).catch(() => undefined);
    return { key: signed.key, url };
}

export async function resolveCloudUrl(key: string): Promise<string> {
    const cached = objectUrls.get(key);
    if (cached) return cached;
    const pending = pendingUrls.get(key);
    if (pending) return pending;

    const task = (async () => {
        try {
            const signed = await getMediaUrl(key);
            const res = await fetch(signed.url);
            if (!res.ok) return "";
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            objectUrls.set(key, url);
            return url;
        } catch {
            return "";
        } finally {
            pendingUrls.delete(key);
        }
    })();
    pendingUrls.set(key, task);
    return task;
}

export async function getCloudBlob(key: string): Promise<Blob | null> {
    try {
        const signed = await getMediaUrl(key);
        const res = await fetch(signed.url);
        if (!res.ok) return null;
        return await res.blob();
    } catch {
        return null;
    }
}

/* --------------------------- 老 key 上云 --------------------------- */

async function rememberKey(localKey: string, cloudKey: string): Promise<void> {
    keyMemo.set(localKey, cloudKey);
    await keyMapStore.setItem(localKey, cloudKey).catch(() => undefined);
}

async function recallKey(localKey: string): Promise<string | undefined> {
    const memo = keyMemo.get(localKey);
    if (memo) return memo;
    const stored = await keyMapStore.getItem<string>(localKey).catch(() => null);
    if (stored) keyMemo.set(localKey, stored);
    return stored ?? undefined;
}

/**
 * 把一个本地 key 迁到云端：本地有 blob 就上传，没有就当作已经是云端 key。
 * 重复调用有映射表兜底，不会重复上传。
 */
export async function ensureCloudKey(key: string): Promise<string> {
    if (!cloudMediaActive() || !key.includes(":")) return key;
    const known = await recallKey(key);
    if (known) return known;
    const blob = (await legacyImages.getItem<Blob>(key).catch(() => null)) || (await legacyMedia.getItem<Blob>(key).catch(() => null));
    if (!blob) return key; // 本地没有，视为云端 key
    const { key: cloudKey } = await uploadBlob(blob);
    await rememberKey(key, cloudKey);
    return cloudKey;
}

/**
 * 保存前把 payload 洗一遍：
 * - 内联 `data:` 图片 → 上传，改成 storageKey
 * - 本地 storageKey → 云端 key（上传后替换）
 * - 去掉 `blob:` 之类的临时地址，渲染时会按 key 重新解析
 */
export async function prepareForCloud<T>(input: T): Promise<T> {
    if (!cloudMediaActive()) return input;

    const walk = async (value: unknown): Promise<unknown> => {
        if (Array.isArray(value)) return Promise.all(value.map((item) => walk(item)));

        if (value && typeof value === "object") {
            const record = value as Record<string, unknown>;

            // 内联图片：上传后只留 key
            const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
            if (dataUrl.startsWith("data:") && dataUrl.length > 256) {
                try {
                    const blob = await (await fetch(dataUrl)).blob();
                    const uploaded = await uploadBlob(blob);
                    const next: Record<string, unknown> = { ...record, storageKey: uploaded.key, dataUrl: "" };
                    for (const [key, item] of Object.entries(next)) next[key] = await walk(item);
                    return next;
                } catch {
                    /* 上传失败就保留原样，让后端去拒绝 */
                }
            }

            const next: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(record)) next[key] = await walk(item);

            if (typeof next.storageKey === "string" && next.storageKey.includes(":")) {
                next.storageKey = await ensureCloudKey(next.storageKey);
            }
            // 临时地址没有持久意义，交给 storageKey 重新解析
            if (typeof next.content === "string" && (next.content.startsWith("blob:") || next.content.startsWith("data:"))) {
                next.content = "";
            }
            if (typeof next.url === "string" && next.url.startsWith("blob:")) next.url = "";

            return next;
        }

        return value;
    };

    return (await walk(input)) as T;
}
