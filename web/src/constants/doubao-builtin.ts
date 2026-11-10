// 豆包内置 channel：不写入用户配置，运行时合并进 channels 体系。
// 凭证来自 doubao-bridge 账号池，不需要用户填 baseUrl/apiKey。
import type { ModelChannel, ChannelModel } from "@/stores/use-config-store";

export const DOUBAO_BUILTIN_CHANNEL_ID = "builtin-doubao";

// 系统维护的豆包模型清单（后续版本只改这里）。
// 实际可用性仍以 bridge 账号登录态和豆包网页端为准。
export const DOUBAO_BUILTIN_MODELS: ChannelModel[] = [
    { name: "Seedream 5.0", capability: "image" },
    { name: "Seedream 5.0 Fast", capability: "image" },
    { name: "Seedance 2.5", capability: "video" },
    { name: "Seedance 2.0", capability: "video" },
    { name: "Seedance 2.0 Fast", capability: "video" },
    { name: "Seedance 2.0 Mini", capability: "video" },
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

export function isDoubaoBuiltinModel(value: string | undefined | null): boolean {
    return Boolean(value && value.startsWith(`${DOUBAO_BUILTIN_CHANNEL_ID}::`));
}
