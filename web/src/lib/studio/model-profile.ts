import {
    decodeChannelModel,
    encodeChannelModel,
    modelCapabilityOf,
    resolveModelRequestConfig,
    selectableModelsByCapability,
    type AiConfig,
    type ModelCapability,
} from "@/stores/use-config-store";
import { isCloudChannelId } from "@/lib/cloud-channel";
import { isDoubaoBuiltinModel } from "@/constants/doubao-builtin";
import {
    EMPTY_DRAMA_MODEL_PROFILES,
    type DramaModelCapability,
    type DramaModelProfiles,
    type DramaModelSelection,
    type StudioProject,
    type StudioProjectSettings,
} from "@/types/studio";

// 项目级模型方案：只保存渠道/模型身份与参数，不碰全局 AiConfig，不保存凭证。
// 参数键固定为 capability + channelId + modelId；切模型保留旧模型自己的参数，切回可恢复。

const PARAM_CONFIG_KEYS = [
    "size",
    "quality",
    "count",
    "background",
    "videoSeconds",
    "vquality",
    "videoMode",
    "videoGenerateAudio",
    "videoWatermark",
    "reasoningEffort",
] as const satisfies readonly (keyof AiConfig)[];

export function dramaModelKey(capability: DramaModelCapability, selection: DramaModelSelection) {
    return `${capability}::${selection.channelId}::${selection.modelId}`;
}

export function dramaModelSelectionFromOption(option: string | undefined | null): DramaModelSelection | null {
    const value = (option ?? "").trim();
    if (!value) return null;
    const decoded = decodeChannelModel(value);
    if (decoded) return { channelId: decoded.channelId, modelId: decoded.model };
    return null;
}

export function dramaModelOption(selection: DramaModelSelection | undefined | null) {
    return selection ? encodeChannelModel(selection.channelId, selection.modelId) : "";
}

export function dramaModelParams(profiles: DramaModelProfiles, capability: DramaModelCapability, selection: DramaModelSelection) {
    return profiles.paramsByKey[dramaModelKey(capability, selection)] ?? {};
}

function firstSelectableOption(config: AiConfig, capability: DramaModelCapability) {
    return selectableModelsByCapability(config, capability as ModelCapability)[0] ?? "";
}

function isCapabilityModel(config: AiConfig, option: string, capability: DramaModelCapability) {
    return Boolean(option) && modelCapabilityOf(config, option) === capability;
}

function resolveInitialOption(config: AiConfig, capability: DramaModelCapability, preferred?: string) {
    if (preferred && isCapabilityModel(config, preferred, capability)) return preferred;
    const globalDefault = capability === "text" ? config.textModel : capability === "image" ? config.imageModel : config.videoModel;
    if (isCapabilityModel(config, globalDefault, capability)) return globalDefault;
    return firstSelectableOption(config, capability);
}

/**
 * 新项目默认继承当前全局画布默认模型；仅把模型身份复制进项目，不复制任何配置对象或凭证。
 * 旧项目 settings 里的模型值如果是完整 channel::model 也能继续沿用。
 */
export function buildDefaultDramaModelProfiles(config: AiConfig, settings?: Partial<StudioProjectSettings>): DramaModelProfiles {
    const profiles: DramaModelProfiles = { version: 1, selected: {}, paramsByKey: {} };
    const capabilities: DramaModelCapability[] = ["text", "image", "video"];
    for (const capability of capabilities) {
        const preferred = capability === "text" ? settings?.textModel : capability === "image" ? settings?.imageModel : settings?.videoModel;
        const option = resolveInitialOption(config, capability, preferred);
        const selection = dramaModelSelectionFromOption(option);
        if (selection) profiles.selected[capability] = selection;
    }
    return profiles;
}

export function projectModelSelection(project: StudioProject, capability: DramaModelCapability): DramaModelSelection | null {
    return project.modelProfiles.selected[capability] ?? null;
}

export function projectModelOption(project: StudioProject, capability: DramaModelCapability, config: AiConfig) {
    const selected = projectModelSelection(project, capability);
    if (selected) return dramaModelOption(selected);
    // 兼容阶段 1 之前创建的 V2 项目：旧 settings 可能是完整编码值。
    const legacy = capability === "text" ? project.settings.textModel : capability === "image" ? project.settings.imageModel : project.settings.videoModel;
    return dramaModelSelectionFromOption(legacy) ? legacy : "";
}

/** 只改项目 profile；不调用 updateConfig，也不修改传入的全局 config。 */
export function withProjectModelSelection(profiles: DramaModelProfiles, capability: DramaModelCapability, option: string): DramaModelProfiles {
    const selection = dramaModelSelectionFromOption(option);
    const selected = { ...profiles.selected };
    if (selection) selected[capability] = selection;
    else delete selected[capability];
    return {
        version: 1,
        selected,
        // 旧模型参数必须保留：切回原模型时按 key 恢复。
        paramsByKey: { ...profiles.paramsByKey },
    };
}

export function updateProjectSettingsModels(settings: StudioProjectSettings, profiles: DramaModelProfiles): StudioProjectSettings {
    return {
        ...settings,
        textModel: dramaModelOption(profiles.selected.text),
        imageModel: dramaModelOption(profiles.selected.image),
        videoModel: dramaModelOption(profiles.selected.video),
    };
}

/** 只写项目 profile 的模型参数；key 必须来自当前模型声明的参数。 */
export function withProjectModelParam(
    profiles: DramaModelProfiles,
    capability: DramaModelCapability,
    key: string,
    value: string | number | boolean | undefined,
): DramaModelProfiles {
    const selection = profiles.selected[capability];
    if (!selection) return profiles;
    const modelKey = dramaModelKey(capability, selection);
    const current = profiles.paramsByKey[modelKey] ?? {};
    const next = { ...current };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    return {
        version: 1,
        selected: { ...profiles.selected },
        paramsByKey: { ...profiles.paramsByKey, [modelKey]: next },
    };
}

/**
 * 生成时把项目 profile 合成为“有效配置”副本。全局 AiConfig 始终只读；
 * 阶段 1 只有模型选择，参数容器会在后续阶段按真实 Schema 写入。
 */
export function effectiveProjectConfig(
    project: StudioProject,
    capability: DramaModelCapability,
    globalConfig: AiConfig,
    override?: { selection: DramaModelSelection; params: Record<string, string | number | boolean> },
): AiConfig {
    const option = override ? dramaModelOption(override.selection) : projectModelOption(project, capability, globalConfig);
    const selection = override?.selection ?? projectModelSelection(project, capability) ?? dramaModelSelectionFromOption(option);
    const base = option ? resolveModelRequestConfig(globalConfig, option) : globalConfig;
    const params = override ? override.params : selection ? dramaModelParams(project.modelProfiles, capability, selection) : {};
    const next: AiConfig = { ...base };
    if (option && isDoubaoBuiltinModel(option)) {
        // 内置豆包/Dola 的账号只能由项目显式提供；全局账号即使存在也不进入项目配置副本。
        next.doubaoAccountId = "";
    }
    for (const key of PARAM_CONFIG_KEYS) {
        const value = params[key];
        if (value === undefined) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            // 只映射现有 AiConfig 字段；未知参数留在 profile，后续由模型 Schema 消费。
            (next as Record<string, unknown>)[key] = String(value);
        }
    }
    if (option) {
        // 请求层需要完整 channel::model 编码来识别云端 / BYOK。resolveModelRequestConfig 为了
        // 本地请求把 model 拆成了裸名，这里在项目副本上还原，不修改传入的全局 config。
        next.model = option;
        if (capability === "text") next.textModel = option;
        if (capability === "image") next.imageModel = option;
        if (capability === "video") next.videoModel = option;
        if (selection) next.channelMode = isCloudChannelId(selection.channelId) ? "cloud" : "local";
    }
    return next;
}

export const EMPTY_PROJECT_MODEL_PROFILES = EMPTY_DRAMA_MODEL_PROFILES;
