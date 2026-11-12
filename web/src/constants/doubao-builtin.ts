// 豆包 / Dola 两个内置 channel：不写入用户配置，运行时合并进 channels 体系。
// 凭证来自 doubao-bridge 账号池，不需要用户填 baseUrl/apiKey。
// 两者走同一套桥接、同一个执行器，只是站点不同（doubao.com / dola.com），
// 所以模型、账号、任务、产物回传的规则完全一致，差别只有「面板文案」和「站点地址」。
import type { ModelChannel, ChannelModel } from "@/stores/use-config-store";

export const DOUBAO_BUILTIN_CHANNEL_ID = "builtin-doubao";
export const DOLA_BUILTIN_CHANNEL_ID = "builtin-dola";

export type BuiltinProvider = "doubao" | "dola";

// 桥接同账号的并行上限（与 doubao-bridge 的 DOUBAO_MAX_PARALLEL 默认值保持一致）。
// 批量生成要按这个数量排队：超过上限的请求会被桥接直接拒绝，而不是排队等待。
export const DOUBAO_MAX_PARALLEL = 3;

// 系统维护的豆包模型清单（后续版本只改这里）。
// 图片/视频的名称必须和豆包面板里的文案一致，否则执行器点选不到（以 video-caps/image-caps 实测为准）。
// 文本走豆包网页端的「对话」能力：那边没有具名模型（只有默认豆包 + 快速/思考开关），
// 所以这里就叫「对话」，执行器只负责把提示词发出去再把回答取回来。
export const DOUBAO_BUILTIN_MODELS: ChannelModel[] = [
    { name: "Seedream 5.0 Pro", capability: "image" },
    { name: "Seedream 5.0 Flash", capability: "image" },
    { name: "Seedream 4.5", capability: "image" },
    { name: "Seedream 4.0", capability: "image" },
    { name: "Seedance 2.5", capability: "video" },
    { name: "Seedance 2.0", capability: "video" },
    { name: "Seedance 2.0 Fast", capability: "video" },
    { name: "Seedance 2.0 Mini", capability: "video" },
    { name: "对话", capability: "text" },
];

// Dola（国际版豆包，dola.com）的模型清单，**按它面板里的真实文案**录入（用 probe-models.mjs 实测）：
//   图像：Seedream 5.0 Pro（专业出图・4 倍消耗）/ Seedream 4.5（日常生成）
//   视频：Dreamina Seedance 2.0 Fast（快速出片选择）/ Dreamina Seedance 1.0（基础视频）
// 注意视频名带「Dreamina 」前缀，和豆包的「Seedance …」不同——执行器按前缀匹配，写错会选不中。
// 面板选项常带后缀说明（如「专业出图・4 倍消耗」），执行器会用前缀/家族容错命中并把实际文案写进日志。
export const DOLA_BUILTIN_MODELS: ChannelModel[] = [
    { name: "Seedream 5.0 Pro", capability: "image" },
    { name: "Seedream 4.5", capability: "image" },
    { name: "Dreamina Seedance 2.0 Fast", capability: "video" },
    { name: "Dreamina Seedance 1.0", capability: "video" },
    { name: "对话", capability: "text" },
];

export function getDoubaoBuiltinChannel(): ModelChannel {
    return {
        id: DOUBAO_BUILTIN_CHANNEL_ID,
        name: "豆包",
        baseUrl: "", // 不直连 OpenAI 格式；走 doubao-bridge
        apiKey: "",
        apiFormat: "openai",
        models: DOUBAO_BUILTIN_MODELS,
    };
}

export function getDolaBuiltinChannel(): ModelChannel {
    return {
        id: DOLA_BUILTIN_CHANNEL_ID,
        name: "Dola",
        baseUrl: "", // 同上：走 doubao-bridge，只是执行器会把站点换成 dola.com
        apiKey: "",
        apiFormat: "openai",
        models: DOLA_BUILTIN_MODELS,
    };
}

/** 模型属于哪个内置站点；不是内置模型时返回 null。 */
export function builtinProviderOf(value: string | undefined | null): BuiltinProvider | null {
    if (!value) return null;
    if (value.startsWith(`${DOUBAO_BUILTIN_CHANNEL_ID}::`)) return "doubao";
    if (value.startsWith(`${DOLA_BUILTIN_CHANNEL_ID}::`)) return "dola";
    return null;
}

/** 走内置桥接（豆包 / Dola）的模型。名字沿用历史，两个站点都算。 */
export function isDoubaoBuiltinModel(value: string | undefined | null): boolean {
    return builtinProviderOf(value) !== null;
}

/** 站点显示名，用于提示文案。 */
export function builtinProviderName(provider: BuiltinProvider | null | undefined): string {
    return provider === "dola" ? "Dola" : "豆包";
}
