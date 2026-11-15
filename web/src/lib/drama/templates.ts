export type DramaTemplate = {
    id: string;
    title: string;
    subtitle: string;
    premise: string;
    style: string;
    cover: string;
};

export const DRAMA_TEMPLATES: DramaTemplate[] = [
    {
        id: "xianxia",
        title: "仙侠短剧",
        subtitle: "云海仙门 · 命运抉择",
        premise: "仙门大考前夜，一名被逐出师门的少女在云海尽头发现失踪多年的师尊留下的传讯。她必须在天明之前穿过三重幻境，查明当年真相，并决定是否拯救曾经背弃自己的仙门。",
        style: "3D 次世代",
        cover: "/studio/backgrounds/lihuo-fantasy-bg.webp",
    },
    {
        id: "urban",
        title: "都市剧情",
        subtitle: "雨夜重逢 · 克制对白",
        premise: "深夜最后一班地铁停运后，一位刚离职的建筑设计师在空荡站台遇见十年前不告而别的挚友。一封没有寄出的信，让两人重新审视当年共同放弃的梦想。",
        style: "写实电影",
        cover: "/gallery/mist-clouds.svg",
    },
    {
        id: "romance",
        title: "爱情故事",
        subtitle: "双向暗恋 · 细腻日常",
        premise: "老街花店即将结业，店主决定每天为陌生客人免费留下一束花。连续第七天，她收到一张只有时间的卡片，赴约的人竟是多年默默帮她守住花店的旧同学。",
        style: "胶片复古",
        cover: "/gallery/ink-sparks.svg",
    },
    {
        id: "fantasy",
        title: "奇幻冒险",
        subtitle: "秘境探索 · 群像叙事",
        premise: "一座只在月食时出现的浮空图书馆突然坠落，年轻修复师与失去记忆的守书人必须赶在黎明前找回散落城中的七页星图，否则整座城将从所有人的记忆里消失。",
        style: "日系插画",
        cover: "/gallery/abyss-phoenix.svg",
    },
];
