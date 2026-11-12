// 模型参数 Schema 类型定义
// 参数值的唯一权威来源是全局 AiConfig，参数通过 configKey 绑定到对应配置字段。

import { inferVideoRatio } from "@/lib/media-size";
import type { AiConfig } from "./use-config-store";

/** 参数类型 */
export type ParameterType =
    | "select"
    | "number"
    | "slider"
    | "boolean"
    | "text"
    | "textarea"
    | "group";

/** 条件显示规则（声明式，可序列化，不用函数） */
export type ConditionalShowRule = {
    /** 依赖的参数 key */
    dependsOn: string;
    /** 匹配的值，满足则显示 */
    equals?: unknown;
    /** 多值匹配，任一满足则显示 */
    in?: unknown[];
};

/** 单个参数 Schema 定义 */
export type ParameterSchema = {
    /** 参数 key，存入 params 对象 */
    key: string;
    /** 参数类型 */
    type: ParameterType;
    /** 显示标签 */
    label: string;
    /** 默认值 */
    defaultValue?: unknown;
    /** 是否必填 */
    required?: boolean;
    /** number/slider 最小值 */
    min?: number;
    /** number/slider 最大值 */
    max?: number;
    /** number/slider 步长 */
    step?: number;
    /** select 的选项 */
    options?: { value: string; label: string }[];
    /** 参数分组名 */
    group?: string;
    /** 参数说明 */
    description?: string;
    /** 条件显示规则（不满足则隐藏） */
    showIf?: ConditionalShowRule;
    /** API 字段映射（UI key → API 字段名） */
    apiField?: string;
    /** 绑定的全局配置字段：参数值直接读写 AiConfig 对应字段，不再另存一份 */
    configKey?: keyof AiConfig;
};

/** 模型支持的特性 */
export type ModelSupportedFeatures = {
    /** 是否支持参考图输入 */
    referenceImage?: boolean;
    /** 是否支持参考视频输入 */
    referenceVideo?: boolean;
    /** 是否支持音频生成 */
    generateAudio?: boolean;
    /** 是否支持水印控制 */
    watermark?: boolean;
    /** 是否支持自定义比例 */
    customRatio?: boolean;
    /** 是否支持自定义时长 */
    customDuration?: boolean;
};

/** 扩展的 ModelDefinition（在 ChannelModel 基础上扩展） */
export type ModelDefinition = {
    /** 稳定模型 ID（channelId::modelName 格式） */
    modelId: string;
    /** 模型名称 */
    name: string;
    /** 能力类型 */
    capability: "image" | "video" | "text" | "audio";
    /** 参数 Schema 列表 */
    parameterSchema?: ParameterSchema[];
    /** 默认参数值（按 key 索引） */
    defaults?: Record<string, unknown>;
    /** Schema 版本号，用于后续迁移 */
    schemaVersion?: number;
    /** 模型支持的特性 */
    supportedFeatures?: ModelSupportedFeatures;
    /** 自定义脚本（兼容旧 ChannelModel） */
    script?: string;
};

/** Provider 配置（存在节点 metadata.providerConfig） */
export type ProviderConfig = {
    /** 账号选择模式（豆包专用） */
    accountSelectionMode?: "manual" | "auto";
    /** 手动选择的账号 ID（豆包专用） */
    accountId?: string;
    /** 自动分配后实际使用的账号 ID */
    selectedAccountId?: string;
    /** 其他 Provider 的配置可以扩展在这里 */
    [key: string]: unknown;
};

/** 模型参数缓存（按 modelId 保存，切换模型后恢复） */
export type ModelParamsCache = {
    [modelId: string]: Record<string, unknown>;
};

/**
 * 从旧 ChannelModel 升级为 ModelDefinition
 * 旧模型没有 Schema 时返回 null，走旧面板
 */
export function upgradeChannelModel(
    channelId: string,
    model: { name: string; capability: string; script?: string },
): ModelDefinition | null {
    const modelId = `${channelId}::${model.name}`;

    // 只有显式定义了 Schema 的模型才返回完整 Definition
    // 其他模型返回 null，走旧逻辑
    const schema = getModelSchema(modelId);
    if (!schema) return null;

    return {
        modelId,
        name: model.name,
        capability: model.capability as ModelDefinition["capability"],
        parameterSchema: schema.parameterSchema,
        defaults: schema.defaults,
        schemaVersion: schema.schemaVersion || 1,
        supportedFeatures: schema.supportedFeatures,
        script: model.script,
    };
}

/**
 * 按 modelId 查预定义 Schema
 * 这里是硬编码的内置模型 Schema，后续可以扩展成可配置
 */
function getModelSchema(modelId: string): {
    parameterSchema: ParameterSchema[];
    defaults: Record<string, unknown>;
    supportedFeatures?: ModelSupportedFeatures;
    schemaVersion?: number;
} | null {
    // ========== 豆包视频模型通用 Schema ==========
    // 所有内置（builtin-doubao / builtin-dola）的视频模型都用这套 Schema
    // 取值范围来自豆包网页端真实能力（账号态 state/video-caps.json）：
    // 比例 = 自动/1:1/3:4/4:3/16:9/9:16/21:9，时长 = 4~15s
    if ((modelId.startsWith("builtin-doubao::") || modelId.startsWith("builtin-dola::")) && (modelId.includes("Seedance") || modelId.includes("视频"))) {
        return {
            parameterSchema: [
                {
                    key: "ratio",
                    type: "select",
                    label: "画面比例",
                    defaultValue: "auto",
                    options: [
                        { value: "auto", label: "自动" },
                        { value: "1:1", label: "1:1（方形）" },
                        { value: "3:4", label: "3:4（竖版）" },
                        { value: "4:3", label: "4:3（横版）" },
                        { value: "16:9", label: "16:9（横屏）" },
                        { value: "9:16", label: "9:16（竖屏）" },
                        { value: "21:9", label: "21:9（宽银幕）" },
                    ],
                    group: "画面",
                    configKey: "size",
                },
                {
                    key: "duration",
                    type: "slider",
                    label: "时长（秒）",
                    defaultValue: 6,
                    min: 4,
                    max: 15,
                    step: 1,
                    group: "画面",
                    configKey: "videoSeconds",
                },
            ],
            defaults: { ratio: "auto", duration: 6 },
            supportedFeatures: {
                referenceImage: true,
                referenceVideo: false,
                generateAudio: false,
                watermark: false,
                customRatio: true,
                customDuration: true,
            },
        };
    }

    // 豆包 Seedance 2.5 视频模型（精确匹配也走上面的通用规则，这里只是示例）
    // if (modelId === "builtin-doubao::Seedance 2.5") { ... }

    // 豆包 Seedream 5.0 图片模型（Dola 同名模型同样适用）
    if (modelId === "builtin-doubao::Seedream 5.0" || modelId === "builtin-dola::Seedream 5.0") {
        return {
            parameterSchema: [
                {
                    key: "ratio",
                    type: "select",
                    label: "画面比例",
                    defaultValue: "1:1",
                    options: [
                        { value: "1:1", label: "1:1（方形）" },
                        { value: "16:9", label: "16:9（横屏）" },
                        { value: "9:16", label: "9:16（竖屏）" },
                    ],
                    group: "画面",
                },
            ],
            defaults: { ratio: "1:1" },
            supportedFeatures: {
                referenceImage: true,
                customRatio: true,
            },
        };
    }

    // OpenAI gpt-image-1 图片模型示例
    if (modelId.endsWith("::gpt-image-1")) {
        return {
            parameterSchema: [
                {
                    key: "size",
                    type: "select",
                    label: "尺寸",
                    defaultValue: "1024x1024",
                    options: [
                        { value: "1024x1024", label: "1024×1024" },
                        { value: "1792x1024", label: "1792×1024" },
                        { value: "1024x1792", label: "1024×1792" },
                    ],
                    group: "画面",
                },
                {
                    key: "quality",
                    type: "select",
                    label: "质量",
                    defaultValue: "standard",
                    options: [
                        { value: "standard", label: "标准" },
                        { value: "hd", label: "高清" },
                    ],
                    group: "画面",
                },
            ],
            defaults: { size: "1024x1024", quality: "standard" },
            supportedFeatures: {
                referenceImage: false,
                customRatio: false,
            },
        };
    }

    // 其他模型没有预定义 Schema → 返回 null，走旧面板
    return null;
}

/**
 * 校验参数值是否符合 Schema 要求
 * 返回合法的参数，不合法的用默认值覆盖
 */
export function validateParamsAgainstSchema(
    params: Record<string, unknown>,
    schema: ParameterSchema[],
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of schema) {
        let value: unknown = params[field.key];

        // 没值时用默认值
        if (value === undefined || value === null) {
            value = field.defaultValue;
        }

        // 必填校验
        if (field.required && (value === undefined || value === "")) {
            // 必填但没值，用默认值
            value = field.defaultValue;
        }

        // 数值范围校验
        if ((field.type === "number" || field.type === "slider") && typeof value === "number") {
            let next: number = value;
            if (field.min !== undefined && next < field.min) next = field.min;
            if (field.max !== undefined && next > field.max) next = field.max;
            value = next;
        }

        // select 选项校验
        if (field.type === "select" && field.options) {
            const valid = field.options.some((opt) => opt.value === value);
            if (!valid) value = field.defaultValue;
        }

        result[field.key] = value;
    }
    return result;
}

/**
 * 从旧节点 metadata 迁移参数到新 params 对象
 * 不删除旧字段，只是映射到新结构
 */
export function migrateLegacyParams(metadata: Record<string, unknown>): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // 旧字段映射到新 params
    if (metadata.ratio !== undefined) params.ratio = metadata.ratio;
    if (metadata.duration !== undefined) params.duration = metadata.duration;
    if (metadata.videoSeconds !== undefined) params.duration = Number(metadata.videoSeconds);
    if (metadata.videoSize !== undefined) params.size = metadata.videoSize;
    if (metadata.videoMode !== undefined) params.mode = metadata.videoMode;
    if (metadata.vquality !== undefined) params.quality = metadata.vquality;

    return params;
}

/**
 * 统一参数读取函数
 * 按 providerId + modelId 读取有效参数，兼容旧字段迁移
 */
export function getModelParams(options: {
    providerId: string;
    modelName: string;
    metadata: Record<string, unknown>;
    schema: ParameterSchema[] | undefined;
}): {
    params: Record<string, unknown>;
    migrated: boolean;
} {
    const { providerId, modelName, metadata, schema } = options;
    const modelId = `${providerId}::${modelName}`;

    // 1. 先从 paramsCache 读
    const paramsCache = (metadata.paramsCache && typeof metadata.paramsCache === "object")
        ? metadata.paramsCache as Record<string, Record<string, unknown>>
        : {};
    const cached = paramsCache[modelId];

    // 2. 缓存里有 → 直接用（Schema 校验在外面做）
    if (cached && Object.keys(cached).length > 0) {
        return { params: cached, migrated: false };
    }

    // 3. 缓存里没有 → 从旧字段迁移
    const legacyParams = migrateLegacyParams(metadata);
    if (Object.keys(legacyParams).length > 0) {
        return { params: legacyParams, migrated: true };
    }

    // 4. 都没有 → 用 Schema 默认值
    if (schema) {
        const defaults: Record<string, unknown> = {};
        for (const field of schema) {
            if (field.defaultValue !== undefined) {
                defaults[field.key] = field.defaultValue;
            }
        }
        return { params: defaults, migrated: false };
    }

    // 5. 连 Schema 都没有 → 返回空对象
    return { params: {}, migrated: false };
}

/**
 * 视频参数 Schema
 * 豆包模型按网页端真实能力给出比例/时长；其他模型走 OpenAI 兼容 / Gemini 协议，
 * 暴露音频与水印两个真实进入请求体的开关。
 */
const GENERIC_VIDEO_PARAM_SCHEMA: ParameterSchema[] = [
    { key: "generate_audio", type: "boolean", label: "生成音频", group: "更多参数", configKey: "videoGenerateAudio" },
    { key: "watermark", type: "boolean", label: "添加水印", group: "更多参数", configKey: "videoWatermark" },
];

export function resolveVideoParamSchema(modelValue: string | undefined): ParameterSchema[] {
    // 内置站点（豆包 / Dola）共用同一套参数 Schema
    if (modelValue && (modelValue.startsWith("builtin-doubao::") || modelValue.startsWith("builtin-dola::"))) {
        return getModelSchema(modelValue)?.parameterSchema ?? [];
    }
    return GENERIC_VIDEO_PARAM_SCHEMA;
}

/** 按 configKey 从全局配置读出参数值（布尔类配置以 "true"/"false" 字符串存储） */
export function readSchemaConfigValues(config: AiConfig, schema: ParameterSchema[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const field of schema) {
        if (!field.configKey) continue;
        const raw = config[field.configKey];
        if (field.type === "boolean") values[field.key] = String(raw) === "true";
        else if (field.type === "number" || field.type === "slider") values[field.key] = Number(raw);
        else values[field.key] = String(raw ?? "");
    }
    return values;
}

/** 把单个参数值转成要写回全局配置的补丁（AiConfig 中这些字段统一按字符串存） */
export function schemaParamPatch(field: ParameterSchema, value: unknown): Partial<AiConfig> {
    if (!field.configKey) return {};
    const patch: Record<string, string> = { [field.configKey]: field.type === "boolean" ? (value ? "true" : "false") : String(value) };
    return patch as unknown as Partial<AiConfig>;
}

/**
 * 读出真正要提交给视频供应商的 ratio / duration
 * 时长按当前模型 Schema 的取值范围收敛；「自动」比例原样交给豆包网页端，
 * 不再折算成 16:9（豆包面板上的选项文案就是「自动」，Runner 按文案点选）。
 */
export function readVideoRequestParams(config: AiConfig): { ratio: string; duration?: number } {
    const schema = resolveVideoParamSchema(config.videoModel || config.model);
    const durationField = schema.find((field) => field.configKey === "videoSeconds");
    const min = durationField?.min ?? 4;
    const max = durationField?.max ?? 30;
    const raw = Number(config.videoSeconds);
    const duration = Number.isFinite(raw) && raw > 0 ? Math.max(min, Math.min(max, Math.round(raw))) : undefined;
    const ratio = inferVideoRatio(config.size || "auto");
    return { ratio: ratio === "auto" ? "自动" : ratio, duration };
}
