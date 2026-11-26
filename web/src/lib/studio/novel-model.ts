import { modelOptionLabel, selectableModelsByCapability, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { CLOUD_CHANNEL_ID } from "@/lib/cloud-channel";
import { isDoubaoBuiltinModel, type BuiltinProvider } from "@/constants/doubao-builtin";
import { listAccounts, type DoubaoAccount } from "@/services/api/doubao-bridge";
import { listModels } from "@/services/api/lihuo-server";
import type { AiTextMessage } from "@/services/api/image";
import { requestImageQuestion as requestText } from "@/services/api/image";
import type { StudioProject } from "@/types/studio";
import { applyProjectBridgeAccount, validateProjectBridgeAccount } from "./project-bridge-account";
import { dramaModelKey, dramaModelOption, dramaModelParams, dramaModelSelectionFromOption, effectiveProjectConfig, projectModelOption, projectModelSelection } from "./model-profile";

// 小说分析只消费项目级文本模型；不读全局选中模型替代，也不把项目参数写回全局 AiConfig。

export type NovelModelParamKey = "temperature" | "maxTokens";

export type NovelModelParameter = {
    key: NovelModelParamKey;
    label: string;
    type: "number";
    min?: number;
    max?: number;
    step?: number;
    defaultValue: number;
    description: string;
};

export type NovelTextModelRuntime = {
    option: string;
    label: string;
    selection: { channelId: string; modelId: string };
    config: AiConfig;
    params: Record<string, string | number | boolean>;
    supportedParams: NovelModelParameter[];
    warnings: string[];
    /** 仅内置豆包/Dola：本次请求必须且只能使用的项目账号。 */
    bridgeAccount?: { provider: BuiltinProvider; accountId: string; quota: "unknown" };
};

/** 队列入队时冻结的文本模型与参数；执行时只能使用这份快照，缺模型直接失败。 */
export type NovelTextModelRuntimeOverride = {
    selection: { channelId: string; modelId: string };
    params: Record<string, string | number | boolean>;
    label?: string;
};

const PLATFORM_PARAMETER_SCHEMA: Record<NovelModelParamKey, NovelModelParameter> = {
    temperature: {
        key: "temperature",
        label: "温度",
        type: "number",
        min: 0,
        max: 2,
        step: 0.1,
        defaultValue: 0.4,
        description: "越低越稳定；结构化原著分析建议 0.2–0.5。",
    },
    maxTokens: {
        key: "maxTokens",
        label: "单次最大输出 tokens",
        type: "number",
        min: 512,
        max: 8192,
        step: 256,
        defaultValue: 4096,
        description: "限制单块分析的输出长度；太小会导致 JSON 截断。",
    },
};

let registryCache: Promise<Record<string, string[]>> | null = null;

async function supportedParameterMap(): Promise<Record<string, string[]>> {
    if (!registryCache) {
        registryCache = listModels()
            .then(({ items }) => Object.fromEntries(items.map((item) => [item.modelId, item.supportedParameters ?? []])))
            .catch(() => ({}) as Record<string, string[]>);
    }
    return registryCache;
}

function normalizeParamName(value: string) {
    return value.replace(/[_\-\s]/g, "").toLowerCase();
}

function supports(supported: string[], key: NovelModelParamKey) {
    const normalized = supported.map(normalizeParamName);
    if (key === "maxTokens") return normalized.includes("maxtokens") || normalized.includes("maxoutputtokens") || normalized.includes("maxcompletiontokens");
    return normalized.includes("temperature");
}

function clampNumber(value: unknown, schema: NovelModelParameter) {
    const number = Number(value);
    if (!Number.isFinite(number)) return schema.defaultValue;
    return Math.max(schema.min ?? number, Math.min(schema.max ?? number, number));
}

/** 只返回当前模型声明支持的参数；本地/BYOK 模型没有可信声明时不暴露参数控件。 */
export async function novelModelParameters(project: StudioProject, globalConfig: AiConfig): Promise<{ parameters: NovelModelParameter[]; warnings: string[] }> {
    const option = projectModelOption(project, "text", globalConfig);
    const selection = projectModelSelection(project, "text") ?? dramaModelSelectionFromOption(option);
    if (!selection) return { parameters: [], warnings: ["项目没有选择文本模型"] };
    if (selection.channelId !== CLOUD_CHANNEL_ID) {
        return { parameters: [], warnings: ["当前项目文本模型不是平台云端模型，未发现可验证的参数声明；只使用模型默认参数。"] };
    }
    const map = await supportedParameterMap();
    const supported = map[selection.modelId] ?? [];
    if (!supported.length) return { parameters: [], warnings: ["模型注册表没有返回参数声明；为避免制造无效参数，本阶段不显示温度/输出上限控件。"] };
    const parameters = (Object.keys(PLATFORM_PARAMETER_SCHEMA) as NovelModelParamKey[])
        .filter((key) => supports(supported, key))
        .map((key) => PLATFORM_PARAMETER_SCHEMA[key]);
    return { parameters, warnings: parameters.length ? [] : ["当前模型没有声明温度或输出上限参数。"] };
}

export async function novelTextModelRuntime(project: StudioProject, override?: NovelTextModelRuntimeOverride): Promise<NovelTextModelRuntime> {
    const globalConfig = useConfigStore.getState().config;
    const currentOption = projectModelOption(project, "text", globalConfig);
    const currentSelection = projectModelSelection(project, "text") ?? dramaModelSelectionFromOption(currentOption);
    const selection = override?.selection ?? currentSelection;
    const option = override ? dramaModelOption(override.selection) : currentOption;
    if (!option || !selection) throw new Error("项目还没有选择文本模型：请先在项目设置里选择");
    if (override && !selectableModelsByCapability(globalConfig, "text").includes(option)) {
        throw new Error(`队列冻结的文本模型 ${option} 在当前渠道配置中已不可用；已阻止本次请求，不会静默切换到其他模型`);
    }
    const rawParams = override ? { ...override.params } : dramaModelParams(project.modelProfiles, "text", selection);
    const projectConfig: AiConfig = {
        ...effectiveProjectConfig(project, "text", globalConfig, override ? { selection, params: override.params } : undefined),
    };
    let config = projectConfig;
    let bridgeAccount: NovelTextModelRuntime["bridgeAccount"];
    const accountWarnings: string[] = [];
    if (isDoubaoBuiltinModel(option)) {
        let accounts: DoubaoAccount[];
        try {
            accounts = await listAccounts();
        } catch (error) {
            throw new Error(`无法读取 Bridge 账号列表，已阻止本次分析：${error instanceof Error ? error.message : String(error)}`);
        }
        const check = validateProjectBridgeAccount(option, rawParams.accountId, accounts);
        if (!check.ok) throw new Error(check.error);
        config = applyProjectBridgeAccount(projectConfig, check);
        bridgeAccount = { provider: check.provider, accountId: check.accountId, quota: check.quota };
        accountWarnings.push(...check.warnings);
    }
    const parameterState = override
        ? { parameters: [] as NovelModelParameter[], warnings: ["队列使用入队冻结参数；不读取后来改变的项目参数。"] }
        : await novelModelParameters(project, globalConfig);
    const params: Record<string, string | number | boolean> = {};
    if (override) {
        Object.assign(params, override.params);
    } else {
        for (const parameter of parameterState.parameters) {
            const value = rawParams[parameter.key];
            params[parameter.key] = parameter.key === "temperature" ? clampNumber(value ?? parameter.defaultValue, parameter) : Math.round(clampNumber(value ?? parameter.defaultValue, parameter));
        }
    }
    return {
        option,
        label: override?.label || modelOptionLabel(globalConfig, option),
        selection,
        config,
        params,
        supportedParams: parameterState.parameters,
        warnings: [...parameterState.warnings, ...accountWarnings],
        bridgeAccount,
    };
}

export function projectTextModelSummary(project: StudioProject) {
    const globalConfig = useConfigStore.getState().config;
    const option = projectModelOption(project, "text", globalConfig);
    const selection = projectModelSelection(project, "text") ?? dramaModelSelectionFromOption(option);
    return {
        option,
        selection,
        label: option ? modelOptionLabel(globalConfig, option) : "未选择",
        key: selection ? dramaModelKey("text", selection) : "",
    };
}

export async function requestNovelText(
    runtime: NovelTextModelRuntime,
    messages: AiTextMessage[],
    options: { signal?: AbortSignal; temperature?: number; maxTokens?: number } = {},
) {
    if (runtime.bridgeAccount) {
        if (!runtime.config.doubaoAccountId) throw new Error("内置豆包/Dola 文本请求缺少项目账号，已阻止发送");
        if (runtime.config.doubaoAccountId !== runtime.bridgeAccount.accountId) {
            throw new Error("内置豆包/Dola 文本请求的账号与项目选择不一致，已阻止发送");
        }
    }
    return requestText(runtime.config, messages, () => undefined, {
        signal: options.signal,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
    });
}

export type { AiTextMessage };
