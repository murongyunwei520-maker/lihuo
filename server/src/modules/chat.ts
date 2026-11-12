import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BillingError,
  actualCost,
  estimateCost,
  getPrice,
  listPrices,
  listUsage,
  refund,
  reserve,
  settle,
  setPrice,
  userBalance,
  type ModelPrice,
} from "./billing.ts";
import { getModel } from "./registry.ts";
import { fail, isObject, ok, readJson } from "../http/respond.ts";
import { getProvider, gatewayErrorToResponse } from "./gateway.ts";
import type { SessionUser } from "../security/session.ts";
import type { ChatMessage } from "../gateway/gateway.interface.ts";

/**
 * 对话接口 + 计费
 * ------------------------------------------------------------
 * 顺序严格是：查价 → 预扣 → 调网关 → 按真实 usage 结算 →（失败）退款
 * 任何一步失败都不会重复扣费。
 */

interface ParsedChat {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  traceId?: string | null;
}

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 100_000;

function parseChatBody(body: unknown): ParsedChat {
  if (!isObject(body)) throw new BillingError("invalid_body", "请求体格式不正确");

  const model = String(body.model ?? "").trim();
  if (!model) throw new BillingError("model_required", "缺少 model");

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new BillingError("messages_required", "messages 必须是非空数组");
  }
  if (rawMessages.length > MAX_MESSAGES) {
    throw new BillingError("too_many_messages", `messages 不能超过 ${MAX_MESSAGES} 条`);
  }

  const messages: ChatMessage[] = [];
  for (const m of rawMessages) {
    if (!isObject(m)) throw new BillingError("invalid_message", "messages 元素格式不正确");
    const role = String(m.role ?? "");
    if (!["system", "user", "assistant", "tool"].includes(role)) {
      throw new BillingError("invalid_role", `不支持的角色：${role}`);
    }
    const content = String(m.content ?? "");
    if (content.length > MAX_CONTENT_CHARS) {
      throw new BillingError("content_too_long", "单条消息内容过长");
    }
    messages.push({ role: role as ChatMessage["role"], content });
  }

  const temperature = body.temperature === undefined ? undefined : Number(body.temperature);
  if (temperature !== undefined && (Number.isNaN(temperature) || temperature < 0 || temperature > 2)) {
    throw new BillingError("invalid_temperature", "temperature 需在 0~2 之间");
  }

  const maxTokens = body.maxTokens === undefined ? undefined : Number(body.maxTokens);
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens <= 0 || maxTokens > 32768)) {
    throw new BillingError("invalid_max_tokens", "maxTokens 需为 1~32768 的整数");
  }

  return {
    model,
    messages,
    temperature,
    maxTokens,
    traceId: body.traceId ? String(body.traceId) : null,
  };
}

function idempotencyKey(req: IncomingMessage): string | null {
  const raw = req.headers["idempotency-key"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  return v.length > 128 ? v.slice(0, 128) : v;
}

/**
 * 用 Model Registry 校验：模型必须已注册、已上架，且只接受它声明支持的参数。
 * 这是"不同模型只展示自己真正支持的参数"的服务端落地——前端隐藏控件不算。
 */
function assertModelUsable(parsed: ParsedChat): ModelPrice {
  const model = getModel(parsed.model);
  if (!model) {
    throw new BillingError("model_not_registered", `模型 ${parsed.model} 未在模型中心注册`, 400);
  }
  if (!model.enabled) {
    throw new BillingError("model_disabled", `模型 ${parsed.model} 已下架`, 403);
  }

  const used: string[] = [];
  if (parsed.temperature !== undefined) used.push("temperature");
  if (parsed.maxTokens !== undefined) used.push("max_tokens");
  const unsupported = used.filter((p) => !model.supportedParameters.includes(p));
  if (unsupported.length) {
    throw new BillingError(
      "unsupported_parameter",
      `模型 ${parsed.model} 不支持参数：${unsupported.join(", ")}`,
      400,
    );
  }

  const price = getPrice(parsed.model);
  if (!price) {
    throw new BillingError("model_not_priced", `模型 ${parsed.model} 未配置价格`, 400);
  }
  if (!price.enabled) {
    throw new BillingError("model_disabled", `模型 ${parsed.model} 的价格已停用`, 403);
  }
  return price;
}

function handleBillingError(res: ServerResponse, err: unknown): boolean {
  if (err instanceof BillingError) {
    fail(res, err.status, err.code, err.message);
    return true;
  }
  return false;
}

/* ------------------------------ 非流式 ------------------------------ */

export async function chat(req: IncomingMessage, res: ServerResponse, user: SessionUser): Promise<void> {
  let parsed: ParsedChat;
  try {
    parsed = parseChatBody(await readJson(req));
  } catch (e) {
    if (handleBillingError(res, e)) return;
    throw e;
  }

  let price: ModelPrice;
  try {
    price = assertModelUsable(parsed);
  } catch (e) {
    if (handleBillingError(res, e)) return;
    throw e;
  }

  const promptText = parsed.messages.map((m) => m.content).join("\n");
  const est = estimateCost(price, promptText, parsed.maxTokens);

  let reserved;
  try {
    reserved = reserve({
      userId: user.id,
      model: parsed.model,
      cents: est.reservedCents,
      idempotencyKey: idempotencyKey(req),
      traceId: parsed.traceId,
      isStream: false,
    });
  } catch (e) {
    if (handleBillingError(res, e)) return;
    throw e;
  }

  // 幂等重放：不重复调用、不重复扣费
  if (reserved.replayed) {
    return ok(res, {
      replayed: true,
      content: reserved.replayed.content,
      model: parsed.model,
      usage: {
        promptTokens: reserved.replayed.promptTokens,
        completionTokens: reserved.replayed.completionTokens,
      },
      costCents: reserved.replayed.costCents,
      balanceCents: userBalance(user.id),
    });
  }

  try {
    const r = await getProvider().chat({
      model: parsed.model,
      messages: parsed.messages,
      temperature: parsed.temperature,
      maxTokens: parsed.maxTokens,
      lihuoUserId: String(user.id),
      lihuoTraceId: parsed.traceId ?? undefined,
    });

    const cost = r.usage
      ? actualCost(price, r.usage.promptTokens, r.usage.completionTokens)
      : est.reservedCents; // 上游没给 usage：按预扣收，宁可不少收

    settle(reserved.recordId, {
      costCents: cost,
      promptTokens: r.usage?.promptTokens ?? 0,
      completionTokens: r.usage?.completionTokens ?? 0,
      gatewayQuota: r.gatewayQuota,
      gatewayRequestId: r.requestId,
      content: r.content,
    });

    return ok(res, {
      content: r.content,
      model: r.model,
      requestId: r.requestId,
      usage: r.usage,
      costCents: cost,
      balanceCents: userBalance(user.id),
      latencyMs: r.latencyMs,
    });
  } catch (e) {
    refund(reserved.recordId, (e as Error)?.message ?? "gateway failed");
    return gatewayErrorToResponse(res, e);
  }
}

/* ------------------------------- 流式 ------------------------------- */

export async function chatStream(req: IncomingMessage, res: ServerResponse, user: SessionUser): Promise<void> {
  let parsed: ParsedChat;
  try {
    parsed = parseChatBody(await readJson(req));
  } catch (e) {
    if (handleBillingError(res, e)) return;
    throw e;
  }

  let price: ModelPrice;
  try {
    price = assertModelUsable(parsed);
  } catch (e) {
    if (handleBillingError(res, e)) return;
    throw e;
  }

  const promptText = parsed.messages.map((m) => m.content).join("\n");
  const est = estimateCost(price, promptText, parsed.maxTokens);

  let reserved;
  try {
    reserved = reserve({
      userId: user.id,
      model: parsed.model,
      cents: est.reservedCents,
      idempotencyKey: idempotencyKey(req),
      traceId: parsed.traceId,
      isStream: true,
    });
  } catch (e) {
    if (handleBillingError(res, e)) return;
    throw e;
  }

  if (reserved.replayed) {
    return fail(res, 409, "idempotent_replay", "该幂等键已完成，流式请求不可重放");
  }

  // 客户端断开 → 中止上游，避免"点了取消还在扣费"
  const ac = new AbortController();
  let clientGone = false;
  req.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      ac.abort();
    }
  });

  let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
  let requestId: string | null = null;
  let text = "";

  try {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    for await (const chunk of getProvider().streamChat(
      {
        model: parsed.model,
        messages: parsed.messages,
        temperature: parsed.temperature,
        maxTokens: parsed.maxTokens,
        lihuoUserId: String(user.id),
        lihuoTraceId: parsed.traceId ?? undefined,
      },
      ac.signal,
    )) {
      if (chunk.requestId) requestId = chunk.requestId;
      if (chunk.delta) {
        text += chunk.delta;
        res.write(`data: ${JSON.stringify({ delta: chunk.delta })}\n\n`);
      }
      if (chunk.done) {
        usage = chunk.usage ?? null;
        break;
      }
    }

    const cost = usage ? actualCost(price, usage.promptTokens, usage.completionTokens) : est.reservedCents;
    settle(reserved.recordId, {
      costCents: cost,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      gatewayQuota: null,
      gatewayRequestId: requestId,
      content: text,
    });

    res.write(
      `data: ${JSON.stringify({
        done: true,
        requestId,
        usage,
        costCents: cost,
        balanceCents: userBalance(user.id),
      })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    // 客户端主动断开：上游已中止，按未产生用量退款
    refund(reserved.recordId, clientGone ? "client_aborted" : ((e as Error)?.message ?? "stream failed"));
    if (!res.headersSent) {
      return gatewayErrorToResponse(res, e);
    }
    try {
      res.write(`data: ${JSON.stringify({ error: { message: (e as Error)?.message ?? "流式中断" } })}\n\n`);
      res.end();
    } catch {
      /* 连接已断，忽略 */
    }
  }
}

/* --------------------------- 价格与用量 --------------------------- */

export async function getPrices(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  return ok(res, { items: listPrices() });
}

export async function putPrice(ctx: { params: Record<string, string> }, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const model = decodeURIComponent(ctx.params.model);
  const body = await readJson(req);
  if (!isObject(body)) return fail(res, 400, "invalid_body", "请求体格式不正确");

  const inCents = Number(body.inCentsPer1k);
  const outCents = Number(body.outCentsPer1k);
  if (!Number.isInteger(inCents) || inCents < 0) return fail(res, 400, "invalid_price", "输入价格必须是非负整数（分/1K tokens）");
  if (!Number.isInteger(outCents) || outCents < 0) return fail(res, 400, "invalid_price", "输出价格必须是非负整数（分/1K tokens）");

  const saved = setPrice({
    model,
    inCentsPer1k: inCents,
    outCentsPer1k: outCents,
    enabled: body.enabled !== false,
  });
  return ok(res, saved);
}

export async function myUsage(req: IncomingMessage, res: ServerResponse, user: SessionUser): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  return ok(res, { balanceCents: userBalance(user.id), items: listUsage(user.id, limit) });
}

export async function allUsage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  const userId = url.searchParams.get("userId");
  return ok(res, { items: listUsage(userId ? Number(userId) : null, limit) });
}
