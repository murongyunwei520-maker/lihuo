// 豆包 / Dola 两个内置 channel：不写入用户配置，运行时合并进 channels 体系。
// 凭证来自 doubao-bridge 账号池，不需要用户填 baseUrl/apiKey。
// 两者走同一套桥接、同一个执行器，只是站点不同（doubao.com / dola.com），
// 所以模型、账号、任务、产物回传的规则完全一致，差别只有「面板文案」和「站点地址」。
import { parseAspectRatio, parsePixelSize } from "@/lib/media-size";
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
    // 2026-11 面板实测（probe-panel-models.mjs 读取的真实下拉文案）：
    //   图像：Seedream 5.5 旗舰生图 / 5.0 Pro 专业出图 / 5.0 Flash 专业快速 / 4.5 日常生成 / 4.0 基础生图
    //   视频：Seedance 2.5 旗舰视频标杆・5 倍消耗 / 2.5 Flash 旗舰高性价比・2 倍消耗 /
    //         2.0 进阶画面表现・2 倍消耗 / 2.0 Fast 快速出片 / 2.0 Mini 日常生成
    // 名字只写模型本体：执行器按「词边界前缀」匹配，面板上的「旗舰生图」「5 倍消耗」这类后缀会自动兼容。
    { name: "Seedream 5.5", capability: "image" },
    { name: "Seedream 5.0 Pro", capability: "image" },
    { name: "Seedream 5.0 Flash", capability: "image" },
    { name: "Seedream 4.5", capability: "image" },
    { name: "Seedream 4.0", capability: "image" },
    { name: "Seedance 2.5", capability: "video" },
    { name: "Seedance 2.5 Flash", capability: "video" },
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

/* ------------------------- 网页端真实可用的画面比例 ------------------------- */
// 以账号态 image-caps.json / video-caps.json 实测为准。
// 画布上允许更多比例（21:9 / 9:21），但提交给豆包前必须收敛到下面这些真实选项，
// 否则执行器点不到对应按钮，会静默沿用网页上一次的比例。
export const DOUBAO_IMAGE_RATIOS = ["自动", "9:16", "2:3", "3:4", "1:1", "4:3", "3:2", "16:9"] as const;
export const DOUBAO_VIDEO_RATIOS = ["自动", "3:4", "4:3", "9:16", "16:9", "1:1", "21:9"] as const;
// 豆包 / Dola 视频面板真实时长范围（4–15s）；画布默认上限更宽，提交前必须收敛。
export const DOUBAO_VIDEO_SECONDS_MIN = 4;
export const DOUBAO_VIDEO_SECONDS_MAX = 15;

const RATIO_ASPECT: Record<string, number> = {
    "1:1": 1,
    "2:3": 2 / 3,
    "3:2": 3 / 2,
    "3:4": 3 / 4,
    "4:3": 4 / 3,
    "9:16": 9 / 16,
    "16:9": 16 / 9,
    "9:21": 9 / 21,
    "21:9": 21 / 9,
};

/** 把任意比例（含像素尺寸、auto/Auto/自动）收敛成网页端真实存在的选项。 */
export function normalizeBuiltinRatio(value: string | undefined | null, kind: "image" | "video" = "image"): string {
    const raw = String(value || "").trim();
    if (!raw || /^(auto|自动)$/i.test(raw)) return "自动";
    const options: readonly string[] = kind === "image" ? DOUBAO_IMAGE_RATIOS : DOUBAO_VIDEO_RATIOS;
    if (options.includes(raw)) return raw;
    const pixels = parsePixelSize(raw) || parseAspectRatio(raw);
    if (!pixels) return "自动";
    const target = pixels.width / pixels.height;
    let best = "自动";
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const option of options) {
        if (option === "自动") continue;
        const diff = Math.abs((RATIO_ASPECT[option] || 1) - target);
        if (diff < bestDiff) {
            best = option;
            bestDiff = diff;
        }
    }
    return best;
}
