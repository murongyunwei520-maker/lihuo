import { useEffect, useState } from "react";

import { resolveMediaUrl } from "@/services/file-storage";

/**
 * storageKey → 可播放/可显示 URL。素材库里存的是 key，渲染前才异步换。
 * 传进来的 key 有变化时才重新解析，避免每次渲染都打一遍 IndexedDB。
 */
export function useMediaUrls(keys: string[]) {
    const [urls, setUrls] = useState<Record<string, string>>({});
    const signature = keys.filter(Boolean).join("|");

    useEffect(() => {
        let alive = true;
        const missing = keys.filter((key) => key && !urls[key]);
        if (!missing.length) return;
        void Promise.all(missing.map(async (key) => [key, await resolveMediaUrl(key, "")] as const)).then((pairs) => {
            if (!alive) return;
            setUrls((prev) => ({ ...prev, ...Object.fromEntries(pairs.filter(([, url]) => Boolean(url))) }));
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    return urls;
}
