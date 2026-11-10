// 灵感图鉴的本地兜底作品：图片随包发布在 web/public/gallery，不依赖外部接口。
// 首页会优先展示提示词库里的图；提示词库不可用时才回落到这里。
export type GalleryItem = {
    id: string;
    title: string;
    prompt: string;
    tag: string;
    src: string;
    width: number;
    height: number;
};

export const GALLERY_TAGS = ["全部", "深林", "雾霭", "墨色", "品牌", "留白"] as const;

export const GALLERY_ITEMS: GalleryItem[] = [
    { id: "abyss-arcs", title: "深林冰环", prompt: "同心冰环在深林蓝里缓慢旋转，像被冻结的声波", tag: "深林", src: "/gallery/abyss-arcs.svg", width: 720, height: 900 },
    { id: "abyss-blades", title: "冷锋", prompt: "冰蓝色的刃状光柱并置，长短错落，像被切割的寒气", tag: "深林", src: "/gallery/abyss-blades.svg", width: 720, height: 720 },
    { id: "abyss-phoenix", title: "朱雀·夜", prompt: "朱雀在冰蓝火环中展翼，翅羽是冷光而不是火焰", tag: "品牌", src: "/gallery/abyss-phoenix.svg", width: 720, height: 1040 },
    { id: "mist-clouds", title: "雾霭云海", prompt: "云纹在雾霭紫底色上起伏，像被夜色压平的云海", tag: "雾霭", src: "/gallery/mist-clouds.svg", width: 720, height: 900 },
    { id: "mist-meander", title: "回纹·雾", prompt: "嵌套回纹由外向内收拢，中心只留一点微光", tag: "雾霭", src: "/gallery/mist-meander.svg", width: 720, height: 720 },
    { id: "ink-sparks", title: "星尘", prompt: "深色底上浮起的冷色星尘，越靠近中心越密", tag: "墨色", src: "/gallery/ink-sparks.svg", width: 720, height: 1040 },
    { id: "ink-blades", title: "墨锋", prompt: "灰蓝与冰蓝的锋面并置，冷色在同一束光里分层", tag: "墨色", src: "/gallery/ink-blades.svg", width: 720, height: 900 },
    { id: "ink-seal", title: "离火印", prompt: "雾霭紫的印章压着「离」字，是整张画布最安静的一笔", tag: "品牌", src: "/gallery/ink-seal.svg", width: 720, height: 720 },
    { id: "moss-arcs", title: "苔痕年轮", prompt: "苔绿色的同心弧层层收拢，像潮湿森林里的年轮", tag: "深林", src: "/gallery/moss-arcs.svg", width: 720, height: 1040 },
    { id: "moss-blades", title: "苔生", prompt: "苔色的刃状光柱向上生长，像被点亮的蕨类", tag: "深林", src: "/gallery/moss-blades.svg", width: 720, height: 900 },
    { id: "fog-clouds", title: "雾白留白", prompt: "雾白纸面上一层极淡的云纹，留白比纹样更重要", tag: "留白", src: "/gallery/fog-clouds.svg", width: 720, height: 720 },
    { id: "fog-meander", title: "窗棂·雾", prompt: "窗棂式回纹压在雾白上，只留一线冷光", tag: "留白", src: "/gallery/fog-meander.svg", width: 720, height: 1040 },
];
