import type { DramaAsset, DramaAssetKind, DramaSequence, DramaSettings } from "@/types/drama";

import { ASSET_KIND_LABEL } from "./schema";
import { DEFAULT_DRAMA_SETTINGS } from "./settings";
import { negativePrompt, resolveCinematography, visualContextLines } from "./visual";

// 资产提示词构造器：人物 / 场景 / 服装 / 道具 / 特效各一套构图模板，
// 但共用同一份项目视觉规范与摄影参数（项目默认，可被镜头覆盖）。

type AssetTemplate = {
    /** 主体定位，决定模型把什么当主角。 */
    subject: string;
    /** 构图与机位要求。 */
    framing: (cinema: ReturnType<typeof resolveCinematography>) => string;
    /** 材质与细节要求。 */
    detail: string;
    /** 这类资产不该出现的东西。 */
    avoid: string[];
};

const TEMPLATES: Record<DramaAssetKind, AssetTemplate> = {
    character: {
        subject: "人物设定图",
        framing: (cinema) => `正面平视机位，半身到全身，${cinema.lens}，${cinema.aperture}，${cinema.composition}，背景简洁低对比，不与人物抢视觉`,
        detail: "面部特征、发型、年龄感、体型比例、服装结构清晰可辨；同一人物的正侧面与近远景必须像同一个人",
        avoid: ["不要出现第二个人物", "不要夸张动态姿势", "不要复杂背景", "不要遮挡面部"],
    },
    scene: {
        subject: "场景概念图",
        framing: (cinema) => `广角平视机位，${cinema.lens}，${cinema.aperture}，${cinema.composition}，空间透视准确、地平线稳定`,
        detail: "空间结构、建筑样式、门窗位置、地面与墙面材质、时间与天气、光源方向都要明确",
        avoid: ["不要出现人物或动物", "不要多视角拼贴", "不要文字招牌"],
    },
    costume: {
        subject: "服装设定图",
        framing: (cinema) => `服装平铺或人台展示，正面完整不裁切，${cinema.lens}，${cinema.aperture}，${cinema.composition}`,
        detail: "版型、面料质感、颜色、纹样、配件与结构层次清楚，可看出厚度与垂感",
        avoid: ["不要出现真人脸部", "不要更换人物身份", "不要堆叠无关配饰"],
    },
    prop: {
        subject: "道具设定图",
        framing: (cinema) => `主体居中，正面加局部特写，${cinema.lens}，${cinema.aperture}，${cinema.composition}`,
        detail: "材质、尺寸比例、结构接缝、磨损与使用痕迹清楚，边缘完整",
        avoid: ["不要出现人物", "不要多余物品干扰", "不要随手摆放在杂乱环境"],
    },
    effect: {
        subject: "特效参考图",
        framing: (cinema) => `效果主体占据画面中心，${cinema.lens}，${cinema.aperture}，${cinema.composition}，背景压暗以突出效果`,
        detail: "形态、颜色、范围、透明度与光效强度明确，边缘衰减自然",
        avoid: ["不要无关人物或场景", "不要多加第二个特效", "不要文字说明"],
    },
    other: {
        subject: "视觉参考图",
        framing: (cinema) => `主体完整清晰，${cinema.lens}，${cinema.aperture}，${cinema.composition}`,
        detail: "材质、结构与关键细节清楚，构图稳定",
        avoid: ["不要多余主体", "不要文字与水印"],
    },
};

/**
 * 资产图提示词：项目视觉规范 + 摄影参数 + 资产描述 + 类型专属构图 + 材质 + 画幅 + 负面词。
 * 摄影参数写进文本（模型能理解的部分），画幅/画质仍走 generationConfig 的原生参数。
 */
export function buildAssetPrompt(sequence: DramaSequence, asset: DramaAsset, settings?: DramaSettings): string {
    const merged = settings ?? { ...DEFAULT_DRAMA_SETTINGS, ...(sequence.settings ?? {}) };
    const cinema = resolveCinematography(sequence);
    const template = TEMPLATES[asset.kind] ?? TEMPLATES.other;
    const lines = [
        ...visualContextLines(sequence),
        `主体：${ASSET_KIND_LABEL[asset.kind]}「${asset.name}」的${template.subject}`,
        asset.description.trim() ? `设定：${asset.description.trim()}` : "",
        `构图与机位：${template.framing(cinema)}`,
        `摄影：${cinema.lens}，${cinema.aperture}，主光 ${cinema.keyLight}，辅光 ${cinema.fillLight}`,
        `细节：${template.detail}`,
        merged.ratio !== "自动" ? `画幅：${merged.ratio}` : "",
    ].filter(Boolean);

    return `${lines.join("；")}。负面提示词：${negativePrompt(sequence, template.avoid)}`;
}
