import type { IncomingMessage, ServerResponse } from "node:http";
import { NewApiProvider } from "../gateway/newapi/newapi.provider.ts";
import { config } from "../config.ts";
import { fail, ok } from "../http/respond.ts";
import { GatewayError } from "../gateway/gateway.interface.ts";

/**
 * 网关代理
 * ------------------------------------------------------------
 * 前端永远不直连 New-API，只能打到这里。
 * 令牌只存在于本进程的环境变量中。
 */

let provider: NewApiProvider | null = null;

export function getProvider(): NewApiProvider {
  if (!provider) {
    provider = new NewApiProvider({
      baseUrl: config.gatewayBaseUrl,
      apiKey: config.gatewayApiKey,
      adminToken: config.gatewayAdminToken || undefined,
    });
  }
  return provider;
}

/** 网关错误 → HTTP 响应，保留 request id 便于排障 */
export function gatewayErrorToResponse(res: ServerResponse, err: unknown): void {
  if (err instanceof GatewayError) {
    const status = err.httpStatus >= 400 && err.httpStatus < 600 ? err.httpStatus : 502;
    res.setHeader("X-Lihuo-Gateway-Request-Id", err.requestId ?? "");
    return fail(res, status, err.code, err.message);
  }
  return fail(res, 502, "gateway_error", (err as Error)?.message ?? "网关调用失败");
}

export async function gatewayHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const h = await getProvider().getHealth();
    return ok(res, h);
  } catch (e) {
    return gatewayErrorToResponse(res, e);
  }
}

export async function gatewayModels(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const models = await getProvider().getModels();
    // 注意：能力与价格不在此返回，由 Model Registry 补齐（下一轮）
    return ok(res, { total: models.length, items: models });
  } catch (e) {
    return gatewayErrorToResponse(res, e);
  }
}
