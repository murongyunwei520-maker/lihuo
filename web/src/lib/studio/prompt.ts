import { STUDIO_ASSET_KIND_LABEL, type StudioAsset, type StudioEpisode, type StudioProject, type StudioShot } from "@/types/studio";

// 提示词自动组装：项目视觉规范 + 人物/场景/服装/道具资产 + 镜头描述 + 摄影参数 + 用户补充。
// 页面只展示结果，允许手动改写；不要在页面里各拼一套。

function clean(value: string | undefined | null) {
    return (value ?? "").trim();
}

export function officialVersionOf(asset: StudioAsset) {
    if (!asset.officialRef) return "";
    const matched = asset.versions.find((version) => version.storageKey === asset.officialRef);
    return matched?.id ?? asset.officialRef;
}

export function assetVersionSnapshot(project: StudioProject, shot: StudioShot, episode?: StudioEpisode): Record<string, string> {
    const snapshot: Record<string, string> = {};
    for (const asset of assetsOfShot(project, shot, episode)) {
        const version = officialVersionOf(asset);
        if (version) snapshot[asset.id] = version;
    }
    return snapshot;
}

const KIND_WEIGHT: Record<StudioAsset["kind"], number> = { character: 0, scene: 1, costume: 2, prop: 3 };

function nameKey(text: string) {
    return text
        .toLowerCase()
        .replace(/[\s\u3000・·]+/g, "")
        .replace(/[。！？!?，,、；;：:「」『』“”"'（）()\[\]【】…—\-]+/g, "");
}

/** 这一镜要带的资产：显式绑定的 + 按出场人物名匹配的 + 场景资产 + 画面描述里提到但没绑定的服装/道具。 */
export function assetsOfShot(project: StudioProject, shot: StudioShot, episode?: StudioEpisode): StudioAsset[] {
    const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
    const bound = shot.assetIds.map((id) => byId.get(id)).filter((asset): asset is StudioAsset => Boolean(asset));
    // AI 拆镜通常只写人物名，不写资产 id；这里按名字补齐，避免提示词和参考图漏掉主角。
    const named = project.assets.filter((asset) => asset.kind === "character" && shot.characterNames.some((name) => nameKey(name) === nameKey(asset.name)));
    const scene = episode ? sceneAssetOf(project, episode, shot) : null;
    const haystack = nameKey([shot.description, shot.action, shot.line, shot.expression, shot.sceneName, shot.environment].filter(Boolean).join(" "));
    const extra = project.assets.filter((asset) => {
        if (shot.assetIds.includes(asset.id)) return false;
        if (asset.kind !== "prop" && asset.kind !== "costume") return false;
        const key = nameKey(asset.name);
        return Boolean(key) && haystack.includes(key);
    });
    const seen = new Set<string>();
    return [...bound, ...named, ...(scene ? [scene] : []), ...extra]
        .filter((asset) => {
            if (seen.has(asset.id)) return false;
            seen.add(asset.id);
            return true;
        })
        .sort((left, right) => KIND_WEIGHT[left.kind] - KIND_WEIGHT[right.kind]);
}

export function sceneAssetOf(project: StudioProject, episode: StudioEpisode, shot: StudioShot): StudioAsset | null {
    const scene = episode.scenes.find((item) => item.id === shot.sceneId);
    if (scene?.assetId) return project.assets.find((asset) => asset.id === scene.assetId) ?? null;
    const name = clean(shot.sceneName);
    if (!name) return null;
    return project.assets.find((asset) => asset.kind === "scene" && clean(asset.name) === name) ?? null;
}

export function referenceKeysForShot(project: StudioProject, shot: StudioShot, episode?: StudioEpisode, max = 6): string[] {
    const keys = assetsOfShot(project, shot, episode)
        .map((asset) => asset.officialRef)
        .filter((key): key is string => Boolean(key));
    return [...new Set(keys)].slice(0, max);
}

function styleLines(project: StudioProject): string[] {
    const style = project.visualStyle;
    return [
        clean(style.mainStyle) ? `画风：${style.mainStyle}` : "",
        clean(style.renderMode) ? `渲染：${style.renderMode}` : "",
        clean(style.palette) ? `色彩：${style.palette}` : "",
        clean(style.photography) ? `摄影：${style.photography}` : "",
        clean(style.lighting) ? `光照：${style.lighting}` : "",
        clean(style.material) ? `材质：${style.material}` : "",
        clean(style.consistency) ? `一致性：${style.consistency}` : "",
    ].filter(Boolean);
}

function assetLine(assets: StudioAsset[]) {
    return assets
        .map((asset) => {
            const detail = [asset.description, asset.face, asset.hair, asset.body, asset.costume, asset.layout, asset.environment, asset.lighting, asset.material].map(clean).filter(Boolean).join("，");
            return detail ? `${STUDIO_ASSET_KIND_LABEL[asset.kind]} ${asset.name}（${detail}）` : `${STUDIO_ASSET_KIND_LABEL[asset.kind]} ${asset.name}`;
        })
        .join("；");
}

/** 资产参考图：人物定妆、场景概念、服装/道具设定各一套构图模板。 */
export function buildAssetPrompt(project: StudioProject, asset: StudioAsset): string {
    const style = styleLines(project);
    const base = [`主体：${STUDIO_ASSET_KIND_LABEL[asset.kind]}「${asset.name}」`];
    if (asset.kind === "character") {
        base.push(
            "画面：人物设定图，正面平视机位，半身到全身，背景简洁低对比",
            [asset.role ? `身份：${asset.role}` : "", asset.age ? `年龄：${asset.age}` : "", asset.face ? `面部特征：${asset.face}` : "", asset.hair ? `发型：${asset.hair}` : "", asset.body ? `身材：${asset.body}` : "", asset.costume ? `服装：${asset.costume}` : "", asset.description ? `设定：${asset.description}` : ""].filter(Boolean).join("；"),
            "要求：正侧面与近远景必须像同一个人，五官、发型、服装结构清晰可辨",
        );
    } else if (asset.kind === "scene") {
        base.push(
            "画面：场景概念图，广角平视机位，空间透视准确，地平线稳定",
            [asset.layout ? `空间布局：${asset.layout}` : "", asset.environment ? `环境：${asset.environment}` : "", asset.timeOfDay ? `时间：${asset.timeOfDay}` : "", asset.weather ? `天气：${asset.weather}` : "", asset.lighting ? `光线：${asset.lighting}` : "", asset.material ? `材质：${asset.material}` : "", asset.description ? `设定：${asset.description}` : ""].filter(Boolean).join("；"),
            "要求：不出现人物或动物，不拼接多视角",
        );
    } else if (asset.kind === "costume") {
        base.push("画面：服装设定图，平铺或人台展示，正面完整不裁切", clean(asset.description) ? `设定：${asset.description}` : "", "要求：版型、面料、颜色、纹样与配件清楚，不出现真人脸部");
    } else {
        base.push("画面：道具设定图，主体居中，正面加局部特写", clean(asset.description) ? `设定：${asset.description}` : "", "要求：材质、尺寸比例、结构接缝清楚，不出现人物");
    }
    return [...base, ...style, `负面提示词：${clean(project.visualStyle.negative) || "低清晰度、畸形、文字水印"}`].filter(Boolean).join("；");
}

/**
 * 镜头首帧提示词：剧情画面为主体，完整带入视觉规范、场景资产、人物资产、景别机位运镜构图光位。
 * 用户改写 shot.imagePrompt 时优先用改写版。
 */
export function buildShotImagePrompt(project: StudioProject, episode: StudioEpisode, shot: StudioShot): string {
    const override = shot.imagePrompt?.trim();
    if (override) return override;
    const assets = assetsOfShot(project, shot);
    const sceneAsset = sceneAssetOf(project, episode, shot);
    const characters = assets.filter((asset) => asset.kind === "character").map((asset) => asset.name);
    const prompt = [
        ...styleLines(project),
        clean(shot.sceneName) ? `场景：${shot.sceneName}${clean(shot.environment) ? ` · ${shot.environment}` : ""}` : "",
        sceneAsset ? `场景设定：${sceneAsset.name}（${[sceneAsset.layout, sceneAsset.environment, sceneAsset.timeOfDay, sceneAsset.weather, sceneAsset.lighting, sceneAsset.material].map(clean).filter(Boolean).join("，")}）` : "",
        characters.length ? `出场人物：${characters.join("、")}` : "",
        `景别：${shot.size}；机位：${shot.camera}${clean(shot.lens) && shot.lens !== "自动" ? `；焦距：${shot.lens}` : ""}；运镜：${shot.movement}`,
        `构图：${shot.composition}；光照：${shot.lighting}`,
        clean(shot.action) ? `人物动作：${shot.action}` : "",
        clean(shot.expression) ? `面部表情：${shot.expression}` : "",
        clean(shot.position) ? `人物位置：${shot.position}` : "",
        clean(shot.orientation) ? `人物朝向：${shot.orientation}` : "",
        clean(shot.effects) ? `特效：${shot.effects}` : "",
        clean(shot.description) ? `画面：${shot.description}` : "",
        assetLine(assets) ? `参考资产：${assetLine(assets)}` : "",
        clean(shot.imageRatio ?? project.settings.imageRatio) && (shot.imageRatio ?? project.settings.imageRatio) !== "自动" ? `画幅：${shot.imageRatio ?? project.settings.imageRatio}` : "",
    ]
        .filter(Boolean)
        .join("；");
    return `${prompt}。负面提示词：${project.visualStyle.negative || "不要出现剧情以外的人物，不要文字水印"}`;
}

/** 镜头视频提示词：描述怎么动，不重复描述静帧。 */
export function buildShotVideoPrompt(project: StudioProject, episode: StudioEpisode, shot: StudioShot): string {
    const override = shot.videoPrompt?.trim();
    if (override) return override;
    const characters = assetsOfShot(project, shot)
        .filter((asset) => asset.kind === "character")
        .map((asset) => asset.name);
    const motion = shot.movement === "固定" ? "镜头固定不动，只有主体与环境在动" : `镜头${shot.movement}`;
    const action = clean(shot.action) || clean(shot.description);
    return [
        `以首帧画面为起点，保持构图、人物位置、服装与光线方向不变`,
        characters.length ? `主体：${characters.join("、")}` : "",
        action ? `动作过程：${action}，动作自然连贯，有明确收尾` : "动作过程：人物保持自然微动作，不要静止成照片",
        clean(shot.expression) ? `表情变化：${shot.expression}` : "",
        motion,
        clean(shot.ambience) ? `环境运动：${shot.ambience}` : "",
        `连续性与一致性：${project.visualStyle.consistency || "人物外观、服装、场景与首帧保持一致"}；光线方向与色温不得跳变`,
        `时长：约 ${shot.seconds} 秒；画幅：${shot.videoRatio ?? project.settings.videoRatio}`,
        `负面提示词：不要换人、换脸、换服装，不要切换场景，不要突然加速`,
    ]
        .filter(Boolean)
        .join("；");
}

/** 对白/旁白的默认音色：优先人物绑定音色，其次项目旁白音色。 */
export function resolveVoice(project: StudioProject, shot: StudioShot, speakerName?: string) {
    const name = clean(speakerName ?? shot.speaker);
    if (name) {
        const character = project.assets.find((asset) => asset.kind === "character" && asset.name === name);
        if (character?.voiceId) return character.voiceId;
    }
    if (shot.audioModel) {
        const first = assetsOfShot(project, shot).find((asset) => asset.kind === "character" && asset.voiceId);
        if (first?.voiceId) return first.voiceId;
    }
    return project.settings.narratorVoice || "";
}
