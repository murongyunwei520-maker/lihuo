import { getDb } from "../db.ts";
import { getPrice, setPrice, type ModelPrice } from "./billing.ts";

/**
 * Model Registry
 * ------------------------------------------------------------
 * 网关（/v1/models）只回答"有什么"，Registry 回答"怎么用、多少钱、能不能用"。
 *
 * 两条硬规则：
 * 1. 不同能力只允许出现该能力真正支持的参数（白名单校验），禁止所有模型套同一套参数
 * 2. 上架（enabled=true）必须已配置价格，否则拒绝——避免用户调用时才撞 400
 */

export type Capability = "text" | "image" | "video" | "audio" | "embedding";

export const CAPABILITIES: Capability[] = ["text", "image", "video", "audio", "embedding"];

/** 各能力允许的参数白名单 */
export const PARAMETER_WHITELIST: Record<Capability, string[]> = {
  text: ["temperature", "top_p", "max_tokens", "stream", "stop", "frequency_penalty", "presence_penalty", "seed", "response_format", "reasoning_effort"],
  image: ["size", "quality", "style", "n", "background", "output_format"],
  video: ["duration", "resolution", "aspect_ratio", "seed", "reference_images", "fps"],
  audio: ["voice", "format", "speed", "language"],
  embedding: ["dimensions", "encoding_format"],
};

/** 各能力的默认参数（新建时可省略，由这里补齐） */
export const DEFAULT_PARAMETERS: Record<Capability, Record<string, unknown>> = {
  text: { temperature: 0.7, top_p: 1 },
  image: { size: "1024x1024", n: 1 },
  video: { duration: 5, aspect_ratio: "16:9" },
  audio: { format: "mp3" },
  embedding: {},
};

export interface ModelRecord {
  modelId: string;
  displayName: string;
  provider: string;
  description: string;
  capability: Capability;
  contextLength: number | null;
  maxOutputTokens: number | null;
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  supportedParameters: string[];
  defaultParameters: Record<string, unknown>;
  enabled: boolean;
  price: ModelPrice | null;
  createdAt: number;
  updatedAt: number;
}

export class RegistryError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MODEL_ID_RE = /^[A-Za-z0-9._:\-/]{1,128}$/;
const now = () => Math.floor(Date.now() / 1000);

interface Row {
  model_id: string;
  display_name: string;
  provider: string;
  description: string;
  capability: string;
  context_length: number | null;
  max_output_tokens: number | null;
  streaming: number;
  tool_calling: number;
  vision: number;
  supported_parameters: string;
  default_parameters: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toRecord(r: Row): ModelRecord {
  return {
    modelId: r.model_id,
    displayName: r.display_name,
    provider: r.provider,
    description: r.description,
    capability: r.capability as Capability,
    contextLength: r.context_length,
    maxOutputTokens: r.max_output_tokens,
    streaming: r.streaming === 1,
    toolCalling: r.tool_calling === 1,
    vision: r.vision === 1,
    supportedParameters: parseJson<string[]>(r.supported_parameters, []),
    defaultParameters: parseJson<Record<string, unknown>>(r.default_parameters, {}),
    enabled: r.enabled === 1,
    price: getPrice(r.model_id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listModels(opts: { includeDisabled?: boolean } = {}): ModelRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM models ${opts.includeDisabled ? "" : "WHERE enabled = 1"} ORDER BY capability, model_id`,
    )
    .all() as Row[];
  return rows.map(toRecord);
}

export function getModel(modelId: string): ModelRecord | null {
  const row = getDb().prepare(`SELECT * FROM models WHERE model_id = ?`).get(modelId) as Row | undefined;
  return row ? toRecord(row) : null;
}

function validateParameters(capability: Capability, params: string[]): void {
  const allowed = PARAMETER_WHITELIST[capability];
  const bad = params.filter((p) => !allowed.includes(p));
  if (bad.length) {
    throw new RegistryError(
      "unsupported_parameter",
      `能力 ${capability} 不支持这些参数：${bad.join(", ")}。允许：${allowed.join(", ")}`,
    );
  }
}

export interface UpsertInput {
  modelId: string;
  displayName?: string;
  provider?: string;
  description?: string;
  capability?: Capability;
  contextLength?: number | null;
  maxOutputTokens?: number | null;
  streaming?: boolean;
  toolCalling?: boolean;
  vision?: boolean;
  supportedParameters?: string[];
  defaultParameters?: Record<string, unknown>;
  enabled?: boolean;
  /** 可选：同时写入价格，避免"上架了但没定价" */
  price?: { inCentsPer1k: number; outCentsPer1k: number };
}

export function createModel(input: UpsertInput): ModelRecord {
  if (!MODEL_ID_RE.test(input.modelId ?? "")) {
    throw new RegistryError("invalid_model_id", "modelId 只能包含字母、数字、点、下划线、冒号、斜杠、短横线，长度 1-128");
  }
  if (getModel(input.modelId)) {
    throw new RegistryError("model_exists", `模型 ${input.modelId} 已存在`, 409);
  }
  return writeModel(input, true);
}

export function updateModel(modelId: string, input: Omit<UpsertInput, "modelId">): ModelRecord {
  if (!getModel(modelId)) {
    throw new RegistryError("model_not_found", `模型 ${modelId} 不存在`, 404);
  }
  return writeModel({ ...input, modelId }, false);
}

function writeModel(input: UpsertInput, isCreate: boolean): ModelRecord {
  const db = getDb();
  const existing = isCreate ? null : getModel(input.modelId);

  const capability: Capability = input.capability ?? existing?.capability ?? "text";
  if (!CAPABILITIES.includes(capability)) {
    throw new RegistryError("invalid_capability", `capability 只能是 ${CAPABILITIES.join(" / ")}`);
  }

  const supportedParameters =
    input.supportedParameters ?? existing?.supportedParameters ?? PARAMETER_WHITELIST[capability];
  validateParameters(capability, supportedParameters);

  const defaultParameters = {
    ...(DEFAULT_PARAMETERS[capability] ?? {}),
    ...(existing?.defaultParameters ?? {}),
    ...(input.defaultParameters ?? {}),
  };
  // 默认值里出现不支持的参数，说明调用方理解错了能力，直接报错
  validateParameters(capability, Object.keys(defaultParameters));

  const enabled = input.enabled ?? existing?.enabled ?? false;
  const price = input.price;

  // 校验价格字段（若提供）
  if (price) {
    if (!Number.isInteger(price.inCentsPer1k) || price.inCentsPer1k < 0) {
      throw new RegistryError("invalid_price", "输入价格必须是非负整数（分/1K）");
    }
    if (!Number.isInteger(price.outCentsPer1k) || price.outCentsPer1k < 0) {
      throw new RegistryError("invalid_price", "输出价格必须是非负整数（分/1K）");
    }
  }

  // 上架必须有价格：价格来自本次入参或已有配置
  const effectivePrice = price ?? existing?.price ?? null;
  if (enabled) {
    if (!effectivePrice) {
      throw new RegistryError(
        "price_required",
        `上架模型 ${input.modelId} 前必须配置价格（可用 price 字段一并提交）`,
      );
    }
    if (effectivePrice.inCentsPer1k === 0 && effectivePrice.outCentsPer1k === 0) {
      throw new RegistryError("price_required", `模型 ${input.modelId} 的输入与输出价格不能同时为 0`);
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    if (isCreate) {
      db.prepare(
        `INSERT INTO models
           (model_id, display_name, provider, description, capability, context_length, max_output_tokens,
            streaming, tool_calling, vision, supported_parameters, default_parameters, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.modelId,
        input.displayName ?? input.modelId,
        input.provider ?? "",
        input.description ?? "",
        capability,
        input.contextLength ?? null,
        input.maxOutputTokens ?? null,
        (input.streaming ?? true) ? 1 : 0,
        (input.toolCalling ?? false) ? 1 : 0,
        (input.vision ?? false) ? 1 : 0,
        JSON.stringify(supportedParameters),
        JSON.stringify(defaultParameters),
        enabled ? 1 : 0,
        now(),
        now(),
      );
    } else {
      db.prepare(
        `UPDATE models SET
           display_name = ?, provider = ?, description = ?, capability = ?, context_length = ?,
           max_output_tokens = ?, streaming = ?, tool_calling = ?, vision = ?,
           supported_parameters = ?, default_parameters = ?, enabled = ?, updated_at = ?
         WHERE model_id = ?`,
      ).run(
        input.displayName ?? existing!.displayName,
        input.provider ?? existing!.provider,
        input.description ?? existing!.description,
        capability,
        input.contextLength === undefined ? existing!.contextLength : input.contextLength,
        input.maxOutputTokens === undefined ? existing!.maxOutputTokens : input.maxOutputTokens,
        (input.streaming ?? existing!.streaming) ? 1 : 0,
        (input.toolCalling ?? existing!.toolCalling) ? 1 : 0,
        (input.vision ?? existing!.vision) ? 1 : 0,
        JSON.stringify(supportedParameters),
        JSON.stringify(defaultParameters),
        enabled ? 1 : 0,
        now(),
        input.modelId,
      );
    }

    if (price) {
      setPrice({
        model: input.modelId,
        inCentsPer1k: price.inCentsPer1k,
        outCentsPer1k: price.outCentsPer1k,
        enabled: true,
      });
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return getModel(input.modelId)!;
}

export function deleteModel(modelId: string): void {
  if (!getModel(modelId)) throw new RegistryError("model_not_found", `模型 ${modelId} 不存在`, 404);
  // 只删元数据；价格与历史流水保留，便于追溯
  getDb().prepare(`DELETE FROM models WHERE model_id = ?`).run(modelId);
}
