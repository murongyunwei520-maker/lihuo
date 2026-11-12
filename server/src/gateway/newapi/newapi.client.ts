import { GatewayError } from "../gateway.interface.ts";

/**
 * New-API 底层 HTTP 客户端
 * ------------------------------------------------------------
 * 只负责四件事：拼 URL、带凭据、超时/取消、把错误归一化成 GatewayError。
 * 不含任何业务语义。
 */

export interface NewApiClientOptions {
  /** 网关根地址，如 http://127.0.0.1:3001，不带 /v1 */
  baseUrl: string;
  /** 转发用令牌 sk-xxx */
  apiKey: string;
  /** 管理面 access_token（可选，只有 getUsage/testChannel 需要） */
  adminToken?: string;
  /** 管理面需要的用户 id 头，默认 "1" */
  adminUserId?: number;
  /** 单次请求超时（毫秒），默认 120s（长文本生成需要余量） */
  timeoutMs?: number;
}

const REQUEST_ID_RE = /request id:\s*([A-Za-z0-9_-]+)/i;

/** 从错误文本里抠出 request id —— 实测 New-API 把它放在 message 末尾 */
export function extractRequestId(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = REQUEST_ID_RE.exec(text);
  return m ? m[1] : null;
}

export class NewApiClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly adminToken?: string;
  private readonly adminUserId: number;
  private readonly timeoutMs: number;

  constructor(opts: NewApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.adminToken = opts.adminToken;
    this.adminUserId = opts.adminUserId ?? 1;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  /** 转发面：/v1/* */
  async relay(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    return this.request(path, init, signal, this.apiKey);
  }

  /** 管理面：/api/*（需要 adminToken） */
  async admin(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    if (!this.adminToken) {
      throw new GatewayError({
        message: "缺少管理凭据：getUsage/testChannel 需要 adminToken",
        code: "admin_token_missing",
      });
    }
    const headers = new Headers(init.headers);
    headers.set("New-Api-User", String(this.adminUserId));
    return this.request(path, { ...init, headers }, signal, this.adminToken);
  }

  private async request(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    token: string,
  ): Promise<Response> {
    const url = this.baseUrl + path;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
      if (!res.ok) {
        throw await this.toGatewayError(res);
      }
      return res;
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const aborted = ctrl.signal.aborted;
      throw new GatewayError({
        message: aborted ? `请求超时或被取消（${this.timeoutMs}ms）：${path}` : `网络错误：${(err as Error).message}`,
        code: aborted ? "timeout_or_aborted" : "network_error",
        retryable: true,
        raw: err,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** 把 New-API / 上游 / 网关三类错误统一成 GatewayError */
  private async toGatewayError(res: Response): Promise<GatewayError> {
    const text = await res.text().catch(() => "");
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON，保留原文 */
    }

    const code: string = body?.error?.code ?? body?.code ?? `http_${res.status}`;
    const message: string =
      body?.error?.message ?? body?.message ?? (text || res.statusText || "未知错误");

    // 429 里要区分"限流"与"额度耗尽"：额度问题重试无意义
    const quotaExhausted =
      res.status === 402 ||
      /quota|余额|额度不足|insufficient/i.test(message);

    // 「无可用渠道」也返回 503，但它不是瞬时抖动，重试不会有不同结果
    const noChannel = /model_not_found|无可用渠道|no available channel/i.test(
      `${code} ${message}`,
    );

    const retryable =
      !quotaExhausted &&
      !noChannel &&
      (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500);

    return new GatewayError({
      message,
      code,
      httpStatus: res.status,
      requestId: extractRequestId(message) ?? extractRequestId(text),
      retryable,
      raw: body ?? text,
    });
  }
}
