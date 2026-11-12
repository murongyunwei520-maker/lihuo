import type { IncomingMessage, ServerResponse } from "node:http";
import { fail, isObject, ok, readJson, clientIp } from "../http/respond.ts";
import type { SessionUser } from "../security/session.ts";
import { writeAudit } from "./audit.ts";
import { getProvider } from "./gateway.ts";
import {
  CAPABILITIES,
  PARAMETER_WHITELIST,
  RegistryError,
  createModel,
  deleteModel,
  getModel,
  listModels,
  updateModel,
  type Capability,
} from "./registry.ts";
import { GatewayError } from "../gateway/gateway.interface.ts";

/**
 * 模型注册表的 HTTP 层
 * ------------------------------------------------------------
 * availability 来自网关 /v1/models（"有什么"），
 * enabled/price 来自 Registry（"能不能用、多少钱"）。
 * 两者合并后才是前端可用的模型目录。
 */

interface Availability {
  ids: Set<string>;
  error: string | null;
}

/** 尽力而为地拿网关可用模型；网关挂了不能让整个目录页 500 */
async function gatewayAvailability(): Promise<Availability> {
  try {
    const models = await getProvider().getModels();
    return { ids: new Set(models.map((m) => m.id)), error: null };
  } catch (e) {
    return { ids: new Set(), error: e instanceof GatewayError ? e.message : String(e) };
  }
}

function toView(m: ReturnType<typeof listModels>[number], available: boolean) {
  return {
    modelId: m.modelId,
    displayName: m.displayName,
    provider: m.provider,
    description: m.description,
    capability: m.capability,
    contextLength: m.contextLength,
    maxOutputTokens: m.maxOutputTokens,
    streaming: m.streaming,
    toolCalling: m.toolCalling,
    vision: m.vision,
    supportedParameters: m.supportedParameters,
    defaultParameters: m.defaultParameters,
    enabled: m.enabled,
    price: m.price
      ? { inCentsPer1k: m.price.inCentsPer1k, outCentsPer1k: m.price.outCentsPer1k }
      : null,
    available,
    usable: m.enabled && !!m.price && available,
  };
}

/** 普通用户：只看到已上架的 */
export async function listForUser(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [avail, items] = await Promise.all([gatewayAvailability(), Promise.resolve(listModels())]);
  return ok(res, {
    gatewayError: avail.error,
    items: items.map((m) => toView(m, avail.ids.has(m.modelId))),
  });
}

/** 管理员：含未上架，并列出"网关有但没注册"的模型 */
export async function listForAdmin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const includeDisabled = url.searchParams.get("includeDisabled") === "true";

  const [avail, items] = await Promise.all([
    gatewayAvailability(),
    Promise.resolve(listModels({ includeDisabled: true })),
  ]);

  const registered = new Set(items.map((m) => m.modelId));
  const unregistered = [...avail.ids].filter((id) => !registered.has(id));

  return ok(res, {
    gatewayError: avail.error,
    capabilities: CAPABILITIES,
    parameterWhitelist: PARAMETER_WHITELIST,
    items: items
      .filter((m) => includeDisabled || m.enabled)
      .map((m) => toView(m, avail.ids.has(m.modelId))),
    unregistered, // 网关可用但注册表里还没有的模型
  });
}

export async function modelDetail(ctx: { params: Record<string, string> }, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  const m = getModel(decodeURIComponent(ctx.params.modelId));
  if (!m) return fail(res, 404, "model_not_found", "模型不存在");
  const avail = await gatewayAvailability();
  return ok(res, toView(m, avail.ids.has(m.modelId)));
}

/* ------------------------------ 写操作 ------------------------------ */

function parseWriteBody(body: unknown): Record<string, unknown> {
  if (!isObject(body)) throw new RegistryError("invalid_body", "请求体格式不正确");
  return body;
}

function handleErr(res: ServerResponse, e: unknown): boolean {
  if (e instanceof RegistryError) {
    fail(res, e.status, e.code, e.message);
    return true;
  }
  return false;
}

export async function createModelHandler(req: IncomingMessage, res: ServerResponse, actor: SessionUser): Promise<void> {
  try {
    const body = parseWriteBody(await readJson(req));
    const created = createModel({
      modelId: String(body.modelId ?? "").trim(),
      displayName: body.displayName ? String(body.displayName) : undefined,
      provider: body.provider ? String(body.provider) : undefined,
      description: body.description ? String(body.description) : undefined,
      capability: body.capability as Capability | undefined,
      contextLength: body.contextLength === undefined ? undefined : Number(body.contextLength),
      maxOutputTokens: body.maxOutputTokens === undefined ? undefined : Number(body.maxOutputTokens),
      streaming: body.streaming as boolean | undefined,
      toolCalling: body.toolCalling as boolean | undefined,
      vision: body.vision as boolean | undefined,
      supportedParameters: Array.isArray(body.supportedParameters)
        ? (body.supportedParameters as string[])
        : undefined,
      defaultParameters: isObject(body.defaultParameters)
        ? (body.defaultParameters as Record<string, unknown>)
        : undefined,
      enabled: body.enabled as boolean | undefined,
      price: isObject(body.price)
        ? {
            inCentsPer1k: Number((body.price as Record<string, unknown>).inCentsPer1k),
            outCentsPer1k: Number((body.price as Record<string, unknown>).outCentsPer1k),
          }
        : undefined,
    });
    writeAudit(actor, "model.create", `model:${created.modelId}`, { enabled: created.enabled, capability: created.capability }, clientIp(req));
    return ok(res, toView(created, false), 201);
  } catch (e) {
    if (handleErr(res, e)) return;
    throw e;
  }
}

export async function updateModelHandler(
  ctx: { params: Record<string, string> },
  req: IncomingMessage,
  res: ServerResponse,
  actor: SessionUser,
): Promise<void> {
  const modelId = decodeURIComponent(ctx.params.modelId);
  try {
    const body = parseWriteBody(await readJson(req));
    const before = getModel(modelId);
    const updated = updateModel(modelId, {
      displayName: body.displayName === undefined ? undefined : String(body.displayName),
      provider: body.provider === undefined ? undefined : String(body.provider),
      description: body.description === undefined ? undefined : String(body.description),
      capability: body.capability as Capability | undefined,
      contextLength: body.contextLength === undefined ? undefined : (body.contextLength as number | null),
      maxOutputTokens: body.maxOutputTokens === undefined ? undefined : (body.maxOutputTokens as number | null),
      streaming: body.streaming as boolean | undefined,
      toolCalling: body.toolCalling as boolean | undefined,
      vision: body.vision as boolean | undefined,
      supportedParameters: Array.isArray(body.supportedParameters)
        ? (body.supportedParameters as string[])
        : undefined,
      defaultParameters: isObject(body.defaultParameters)
        ? (body.defaultParameters as Record<string, unknown>)
        : undefined,
      enabled: body.enabled as boolean | undefined,
      price: isObject(body.price)
        ? {
            inCentsPer1k: Number((body.price as Record<string, unknown>).inCentsPer1k),
            outCentsPer1k: Number((body.price as Record<string, unknown>).outCentsPer1k),
          }
        : undefined,
    });
    writeAudit(
      actor,
      "model.update",
      `model:${modelId}`,
      { before: { enabled: before?.enabled, price: before?.price }, after: { enabled: updated.enabled, price: updated.price } },
      clientIp(req),
    );
    return ok(res, toView(updated, false));
  } catch (e) {
    if (handleErr(res, e)) return;
    throw e;
  }
}

export async function deleteModelHandler(
  ctx: { params: Record<string, string> },
  req: IncomingMessage,
  res: ServerResponse,
  actor: SessionUser,
): Promise<void> {
  const modelId = decodeURIComponent(ctx.params.modelId);
  try {
    deleteModel(modelId);
    writeAudit(actor, "model.delete", `model:${modelId}`, null, clientIp(req));
    return ok(res, { deleted: modelId });
  } catch (e) {
    if (handleErr(res, e)) return;
    throw e;
  }
}
