import { nanoid } from "nanoid";

import type { DramaAsset, DramaAssetKind, DramaShot } from "@/types/drama";

import { castKey } from "./script";

// 镜头与资产的绑定：把名字解析成稳定 assetId，显示名只用于匹配入口。
// 单独成文件，避免调用方为了绑定而依赖拆镜的 AI / 配置链路。

function keyOf(name: string) {
    return name.trim().replace(/\s+/g, "").replace(/[·・]/g, "").toLowerCase();
}

/** 只保留文字与数字，用来判断「这一镜有没有提到这个道具」。 */
function textKey(text: string) {
    return text
        .toLowerCase()
        .replace(/[\s\u3000·・]+/g, "")
        .replace(/[。！？!?，,、；;：:「」『』“”"'（）()\[\]【】…—\-]+/g, "");
}

/** 场景 / 人物之外，道具、服装、特效靠名字出现在画面描述里来绑定。 */
function mentions(shot: DramaShot, name: string) {
    const needle = textKey(name);
    if (!needle) return false;
    const haystack = textKey([shot.prompt, shot.action, shot.line, shot.expression, shot.scene, shot.location].filter(Boolean).join(" "));
    return haystack.includes(needle);
}

export function bindAssets(shots: DramaShot[], existing: DramaAsset[], declared?: { characters?: string[]; scenes?: string[] }) {
    const assets = [...existing];
    const byKey = new Map(assets.map((asset) => [keyOf(asset.name), asset]));

    const ensure = (name: string, kind: DramaAssetKind): DramaAsset | null => {
        const key = keyOf(name);
        if (!key) return null;
        const found = byKey.get(key);
        if (found) return found;
        const asset: DramaAsset = { id: `asset-${nanoid(8)}`, name: name.trim(), kind, description: "", refs: [] };
        assets.push(asset);
        byKey.set(key, asset);
        return asset;
    };

    // 模型显式声明的角色 / 场景优先建卡，顺序稳定，避免每次拆镜都换 id。
    for (const name of declared?.characters ?? []) ensure(name, "character");
    for (const name of declared?.scenes ?? []) ensure(name, "scene");
    for (const shot of shots) {
        for (const name of shot.characters ?? []) ensure(name, "character");
        if (shot.speaker && shot.speaker !== "旁白") ensure(shot.speaker, "character");
        if (shot.scene) ensure(shot.scene, "scene");
        // 模型点名要绑的道具 / 服装 / 特效：不是人物就按道具建卡，方便用户直接去出参考图。
        for (const name of shot.assetNames ?? []) {
            if ((shot.characters ?? []).some((item) => castKey(item) === castKey(name))) continue;
            if (!byKey.has(keyOf(name))) ensure(name, "prop");
        }
    }

    let bound = 0;
    const next = shots.map((shot) => {
        const ids = new Set<string>();
        for (const name of shot.characters ?? []) {
            const asset = byKey.get(keyOf(name));
            if (asset) ids.add(asset.id);
        }
        if (shot.speaker && shot.speaker !== "旁白") {
            const asset = byKey.get(keyOf(shot.speaker));
            if (asset) ids.add(asset.id);
        }
        if (shot.scene) {
            const asset = byKey.get(keyOf(shot.scene));
            if (asset) ids.add(asset.id);
        }
        for (const name of shot.assetNames ?? []) {
            const asset = byKey.get(keyOf(name));
            if (asset) ids.add(asset.id);
        }
        // 道具 / 服装 / 特效即使没被模型点名，只要名字出现在这一镜的内容里也绑上：
        // 「她拿起手机」这类镜头就能自动带上手机的参考图。
        for (const asset of assets) {
            if (ids.has(asset.id)) continue;
            if (asset.kind === "prop" || asset.kind === "costume" || asset.kind === "effect") {
                if (mentions(shot, asset.name)) ids.add(asset.id);
            }
        }
        if (ids.size) bound += 1;
        return { ...shot, assetIds: [...ids] };
    });

    return { shots: next, assets, bound };
}
