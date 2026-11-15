import type { IncomingMessage, ServerResponse } from "node:http";

import { getDb } from "../db.ts";
import { GatewayError } from "../gateway/gateway.interface.ts";
import { fail, isObject, ok, readJson } from "../http/respond.ts";
import type { SessionUser } from "../security/session.ts";
import { BillingError, refund, reserve, settle, userBalance } from "./billing.ts";
import { getRawClient } from "./gateway.ts";
import { getModel, type Capability } from "./registry.ts";

/**
 * 生成代理（v1）
 * ------------------------------------------------------------
 * 画布的生图 / 语音 / 向量请求经由本模块转发，前端不再持有上游 API Key。
 *
 * 与 /api/chat 的三点不同：
 * 1. 上游响应体原样透传（可能是图片 JSON，也可能是 mp3 二进制），
 *    离火的账单信息放响应头，不改动上游数据结构。
 * 2. 计费按「次」而非 token，价格来自 generation_prices。
 * 3. 路径不直接透传：用端点别名白名单映射到固定上游路径，杜绝路径注入。
 *
 * 顺序与对话一致：校验 → 预扣 → 转发 → 结算 /（失败）退款。
 */

const now = () => Math.floor(Date.now() / 1000);

/* --------------------------- 端点白名单 --------------------------- */

interface EndpointSpec {
  /** 固定的上游路径，不接受客户端传入 */
  upstream: string;
  capability: Capability;
  /** 业务必填字段（不属于能力参数白名单） */
  required: string[];
  /** 该端点专属的额外允许字段 */
  extra: string[];
}

const ENDPOINTS: Record<string, EndpointSpec> = {
  "image-generations": {
    upstream: "/v1/images/generations",
    capability: "image",
    required: ["prompt"],
    extra: ["response_format"],
  },
  "image-edits": {
    upstream: "/v1/images/edits",
    capability: "image",
    required: ["image"],
    extra: ["mask", "prompt", "response_format"],
  },
  "audio-speech": {
    upstream: "/v1/audio/speech",
    capability: "audio",
    required: ["input"],
    extra: ["instructions"],
  },
  embeddings: {
    upstream: "/v1/embeddings",
    capability: "embedding",
    required: ["input"],
    extra: [],
  },
};

export const GENERATION_ENDPOINTS = Object.keys(ENDPOINTS);

/* --------------------------- 按次定价 --------------------------- */

export interface GenerationPrice {
  model: string;
  centsPerCall: number;
  enabled: boolean;
}

export function getGenerationPrice(model: string): GenerationPrice | null {
  const row = getDb()
    .prepare(`SELECT model, cents_per_call, enabled FROM generation_prices WHERE model = ?`)
    .get(model) as { model: string; cents_per_call: number; enabled: number } | undefined;
  if (!row) return null;
  return { model: row.model, centsPerCall: row.cents_per_call, enabled: row.enabled === 1 };
}

export function listGenerationPrices(): GenerationPrice[] {
  const rows = getDb()
    .prepare(`SELECT model, cents_per_call, enabled FROM generation_prices ORDER BY model`)
    .all() as Array<{ model: string; cents_per_call: number; enabled: number }>;
  return rows.map((r) => ({ model: r.model, centsPerCall: r.cents_per_call, enabled: r.enabled === 1 }));
}

export function setGenerationPrice(input: { model: string; centsPerCall: number; enabled?: boolean }): GenerationPrice {
  getDb()
    .prepare(
      `INSERT INTO generation_prices (model, cents_per_call, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(model) DO UPDATE SET
         cents_per_call = excluded.cents_per_call,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .run(input.model, input.centsPerCall, input.enabled === false ? 0 : 1, now());
  return getGenerationPrice(input.model)!;
}

export async function listGenerationPricesHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  return ok(res, { items: listGenerationPrices() });
}

export async function putGenerationPriceHandler(
  ctx: { params: Record<string, string> },
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const model = decodeURIComponent(ctx.params.model);
  const body = await readJson(req);
  if (!isObject(body)) return fail(res, 400, "invalid_body", "请求体格式不正确");

  const cents = Number(body.centsPerCall);
  if (!Number.isInteger(cents) || cents < 0) {
    return fail(res, 400, "invalid_price", "centsPerCall 必须是非负整数（分/次）");
  }
  return ok(res, setGenerationPrice({ model, centsPerCall: cents, enabled: body.enabled !== false }));
}

/* --------------------------- 请求校验 --------------------------- */

interface Plan {
  spec: EndpointSpec;
  model: string;
  cents: number;
  upstreamBody: Record<string, unknown>;
  traceId: string | null;
}

function buildPlan(endpoint: string, body: unknown): Plan {
  const spec = ENDPOINTS[endpoint];
  if (!spec) {
    throw new BillingError("unknown_endpoint", `不支持的生成端点：${endpoint}`, 404);
  }
  if (!isObject(body)) throw new BillingError("invalid_body", "请求体格式不正确");

  const model = String(body.model ?? "").trim();
  if (!model) throw new BillingError("model_required", "缺少 model");

  const reg = getModel(model);
  if (!reg) throw new BillingError("model_not_registered", `模型 ${model} 未在模型中心注册`, 400);
  if (!reg.enabled) throw new BillingError("model_disabled", `模型 ${model} 已下架`, 403);
  if (reg.capability !== spec.capability) {
    throw new BillingError(
      "capability_mismatch",
      `模型 ${model} 的能力是 ${reg.capability}，端点 ${endpoint} 需要 ${spec.capability}`,
      400,
    );
  }
  // 与 /api/chat 一致：上架模型必须已配置价格
  if (!reg.price || !reg.price.enabled) {
    throw new BillingError("model_not_priced", `模型 ${model} 未配置价格`, 400);
  }
  const perCall = getGenerationPrice(model);
  if (!perCall || !perCall.enabled) {
    throw new BillingError("model_not_priced", `模型 ${model} 未配置按次价格，请先联系管理员`, 400);
  }

  // 参数白名单：只接受该模型声明支持的参数 + 本端点业务必填/专属字段
  const allowed = new Set(["model", "traceId", ...spec.required, ...spec.extra, ...reg.supportedParameters]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new BillingError("unsupported_parameter", `模型 ${model} 不支持参数：${unknown.join(", ")}`, 400);
  }
  for (const key of spec.required) {
    const value = body[key];
    if (value === undefined || value === null || value === "") {
      throw new BillingError("missing_field", `${endpoint} 缺少必填字段 ${key}`, 400);
    }
  }

  const upstreamBody: Record<string, unknown> = { ...body, model };
  delete upstreamBody.traceId;

  return {
    spec,
    model,
    cents: perCall.centsPerCall,
    upstreamBody,
    traceId: body.traceId ? String(body.traceId) : null,
  };
}

function idempotencyKey(req: IncomingMessage): string | null {
  const raw = req.headers["idempotency-key"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  return v.length > 128 ? v.slice(0, 128) : v;
}

function handleBillingError(res: ServerResponse, err: unknown): boolean {
  if (err instanceof BillingError) {
    fail(res, err.status, err.code, err.message);
    return true;
  }
  return false;
}

/* --------------------------- 生成代理 --------------------------- */

export async function generate(
  ctx: { params: Record<string, string> },
  req: IncomingMessage,
  res: ServerResponse,
  user: SessionUser,
): Promise<void> {
  let plan: Plan;
  try {
    plan = buildPlan(ctx.params.endpoint, await readJson(req));
  } catch (e) {
    if (handleBillingError(res, e)) return;
    throw e;
  }

  let reserved;
  try {
    reserved = reserve({
      userId: user.id,
      model: plan.model,
      cents: plan.cents,
      idempotencyKey: idempotencyKey(req),
      traceId: plan.traceId,
      isStream: false,
    });
  } catch (e) {
    if (handleBillingError(res, e)) return;
    throw e;
  }

  // 生成结果可能是大 JSON 或二进制，不落库、不支持重放；防重复扣费的目的已达到
  if (reserved.replayed) {
    return fail(res, 409, "idempotent_replay", "该幂等键已完成，生成请求不可重放；请更换幂等键重新发起");
  }

  // 客户端断开 → 中止上游，避免「点了取消还在扣费」
  const ac = new AbortController();
  let clientGone = false;
  req.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      ac.abort();
    }
  });

  try {
    const upstream = await getRawClient().relay(
      plan.spec.upstream,
      { method: "POST", body: JSON.stringify(plan.upstreamBody) },
      ac.signal,
    );

    const buf = Buffer.from(await upstream.arrayBuffer());
    const requestId =
      upstream.headers.get("x-oneapi-request-id") ?? upstream.headers.get("x-request-id") ?? null;
    const contentType =
      upstream.headers.get("content-type") ?? "application/json; charset=utf-8";

    settle(reserved.recordId, {
      costCents: plan.cents,
      promptTokens: 0,
      completionTokens: 0,
      gatewayQuota: null,
      gatewayRequestId: requestId,
      content: null,
    });

    // 上游响应体原样返回；离火的账单信息只放在响应头，不污染数据结构
    res.writeHead(upstream.status, {
      "content-type": contentType,
      "content-length": buf.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "X-Lihuo-Cost-Cents": String(plan.cents),
      "X-Lihuo-Balance-Cents": String(userBalance(user.id)),
      "X-Lihuo-Request-Id": requestId ?? "",
      "X-Lihuo-Model": plan.model,
    });
    res.end(buf);
  } catch (e) {
    refund(
      reserved.recordId,
      clientGone ? "client_aborted" : ((e as Error)?.message ?? "generate failed"),
    );
    if (res.headersSent) {
      try {
        res.end();
      } catch {
        /* 连接已断，忽略 */
      }
      return;
    }
    if (e instanceof GatewayError) {
      res.setHeader("X-Lihuo-Gateway-Request-Id", e.requestId ?? "");
      const status = e.httpStatus >= 400 && e.httpStatus < 600 ? e.httpStatus : 502;
      return fail(res, status, e.code, e.message);
    }
    return fail(res, 502, "gateway_error", (e as Error)?.message ?? "生成失败");
  }
}
