/**
 * 离火后端客户端
 * ------------------------------------------------------------
 * 前端与模型服务的唯一通道。所有请求都带 Cookie 会话，
 * **不持有、不传输任何上游 API Key**。
 *
 * 环境变量：VITE_LIHUO_SERVER_URL，默认 http://127.0.0.1:3100
 */

export const LIHUO_SERVER_URL =
    (import.meta.env.VITE_LIHUO_SERVER_URL as string | undefined)?.replace(/\/+$/, "") || "http://127.0.0.1:3100";

export class ServerApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = "ServerApiError";
        this.code = code;
        this.status = status;
    }
}

export interface SessionUser {
    id: number;
    username: string;
    role: "admin" | "user";
    status: "active" | "banned";
    quotaCents: number;
}

export interface RegistryModel {
    modelId: string;
    displayName: string;
    provider: string;
    description: string;
    capability: "text" | "image" | "video" | "audio" | "embedding";
    contextLength: number | null;
    maxOutputTokens: number | null;
    streaming: boolean;
    toolCalling: boolean;
    vision: boolean;
    supportedParameters: string[];
    defaultParameters: Record<string, unknown>;
    enabled: boolean;
    price: { inCentsPer1k: number; outCentsPer1k: number } | null;
    available: boolean;
    usable: boolean;
}

export interface ChatResult {
    content: string;
    model: string;
    requestId: string | null;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
    costCents: number;
    balanceCents: number;
    latencyMs?: number;
    replayed?: boolean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    let res: Response;
    try {
        res = await fetch(`${LIHUO_SERVER_URL}${path}`, {
            ...init,
            headers,
            credentials: "include", // 会话 Cookie
        });
    } catch (e) {
        throw new ServerApiError("network_error", `无法连接离火后端（${LIHUO_SERVER_URL}）：${(e as Error).message}`, 0);
    }

    const text = await res.text();
    let body: unknown = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        /* 非 JSON */
    }

    const payload = body as { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null;

    if (!res.ok || !payload?.ok) {
        throw new ServerApiError(
            payload?.error?.code ?? `http_${res.status}`,
            payload?.error?.message ?? text ?? res.statusText,
            res.status,
        );
    }
    return payload.data as T;
}

/* ------------------------------ 会话 ------------------------------ */

export function login(username: string, password: string): Promise<SessionUser> {
    return request<SessionUser>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
    });
}

export function logout(): Promise<{ loggedOut: boolean }> {
    return request("/api/auth/logout", { method: "POST" });
}

export function me(): Promise<SessionUser> {
    return request<SessionUser>("/api/me");
}

/* ------------------------------ 模型 ------------------------------ */

export function listModels(): Promise<{ items: RegistryModel[]; gatewayError: string | null }> {
    return request("/api/models");
}

/* ------------------------------ 对话 ------------------------------ */

export interface ChatPayload {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
    traceId?: string;
}

export function chat(payload: ChatPayload, idempotencyKey?: string): Promise<ChatResult> {
    return request<ChatResult>("/api/chat", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    });
}

export interface Usage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface StreamHandlers {
    onDelta: (delta: string) => void;
    onDone: (result: {
        requestId: string | null;
        usage: Usage | null;
        costCents: number;
        balanceCents: number;
    }) => void;
}

/**
 * 流式对话
 * 后端返回的帧：{delta} … {done:true, requestId, usage, costCents} … [DONE]
 */
export async function chatStream(
    payload: ChatPayload,
    handlers: StreamHandlers,
    signal?: AbortSignal,
): Promise<void> {
    let res: Response;
    try {
        res = await fetch(`${LIHUO_SERVER_URL}/api/chat/stream`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify(payload),
            signal,
        });
    } catch (e) {
        if ((e as Error).name === "AbortError") return;
        throw new ServerApiError("network_error", `无法连接离火后端：${(e as Error).message}`, 0);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        let code = `http_${res.status}`;
        let message = text;
        try {
            const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
            code = body.error?.code ?? code;
            message = body.error?.message ?? message;
        } catch {
            /* 非 JSON */
        }
        throw new ServerApiError(code, message || res.statusText, res.status);
    }
    if (!res.body) throw new ServerApiError("empty_stream", "流式响应没有内容", 500);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let idx: number;
            while ((idx = buffer.indexOf("\n\n")) >= 0) {
                const frame = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);

                for (const line of frame.split("\n")) {
                    if (!line.startsWith("data:")) continue;
                    const raw = line.slice(5).trim();
                    if (!raw) continue;
                    if (raw === "[DONE]") return;

                    let evt: Record<string, unknown>;
                    try {
                        evt = JSON.parse(raw) as Record<string, unknown>;
                    } catch {
                        continue;
                    }
                    if (typeof evt.delta === "string" && evt.delta) {
                        handlers.onDelta(evt.delta);
                    }
                    if (evt.done === true) {
                        handlers.onDone({
                            requestId: (evt.requestId as string | null) ?? null,
                            usage: (evt.usage as Usage | null) ?? null,
                            costCents: Number(evt.costCents ?? 0),
                            balanceCents: Number(evt.balanceCents ?? 0),
                        });
                    }
                }
            }
        }
    } finally {
        // 提前 return 时也要断开上游，避免后端继续生成
        try {
            await reader.cancel();
        } catch {
            /* 已关闭 */
        }
    }
}

/* ------------------------------ 生成代理 ------------------------------ */

export type GenerationEndpoint = "image-generations" | "image-edits" | "audio-speech" | "embeddings";

export interface GenerationPrice {
    model: string;
    centsPerCall: number;
    enabled: boolean;
}

/** 账单信息由后端放在响应头，不混入上游响应体 */
export interface GenerationBilling {
    costCents: number;
    balanceCents: number;
    requestId: string | null;
    model: string;
}

export interface GenerationJsonResult<T> {
    data: T;
    billing: GenerationBilling;
}

export interface GenerationBlobResult {
    blob: Blob;
    contentType: string;
    billing: GenerationBilling;
}

/**
 * 生成代理成功时后端**原样透传上游响应体**（不是 { ok, data } 包装），
 * 所以不能复用 request()。这里只做「连不上 / 非 2xx」的归一化。
 */
async function requestRaw(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    let res: Response;
    try {
        res = await fetch(`${LIHUO_SERVER_URL}${path}`, {
            ...init,
            headers,
            credentials: "include",
        });
    } catch (e) {
        throw new ServerApiError("network_error", `无法连接离火后端（${LIHUO_SERVER_URL}）：${(e as Error).message}`, 0);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        let code = `http_${res.status}`;
        let message = text;
        try {
            const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
            code = body.error?.code ?? code;
            message = body.error?.message ?? message;
        } catch {
            /* 非 JSON，保留原文 */
        }
        throw new ServerApiError(code, message || res.statusText, res.status);
    }
    return res;
}

function billingOf(res: Response): GenerationBilling {
    return {
        costCents: Number(res.headers.get("X-Lihuo-Cost-Cents") ?? 0),
        balanceCents: Number(res.headers.get("X-Lihuo-Balance-Cents") ?? 0),
        requestId: res.headers.get("X-Lihuo-Request-Id") || null,
        model: res.headers.get("X-Lihuo-Model") ?? "",
    };
}

export interface GenerateOptions {
    /** 同一键只扣费一次；后端对重放返回 409 */
    idempotencyKey?: string;
    signal?: AbortSignal;
}

/** JSON 类生成（生图 / 向量），data 是上游原始结构 */
export async function generate<T = unknown>(
    endpoint: GenerationEndpoint,
    payload: Record<string, unknown>,
    opts: GenerateOptions = {},
): Promise<GenerationJsonResult<T>> {
    const res = await requestRaw(`/api/generate/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
        signal: opts.signal,
    });
    const text = await res.text();
    let data: T;
    try {
        data = (text ? JSON.parse(text) : null) as T;
    } catch {
        throw new ServerApiError("invalid_response", "生成结果不是合法 JSON，二进制端点请改用 generateBlob()", res.status);
    }
    return { data, billing: billingOf(res) };
}

/** 二进制生成（语音），原样给 Blob，由调用方决定下载或播放 */
export async function generateBlob(
    endpoint: GenerationEndpoint,
    payload: Record<string, unknown>,
    opts: GenerateOptions = {},
): Promise<GenerationBlobResult> {
    const res = await requestRaw(`/api/generate/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
        signal: opts.signal,
    });
    return {
        blob: await res.blob(),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        billing: billingOf(res),
    };
}

export function getGenerationPrices(): Promise<{ items: GenerationPrice[] }> {
    return request("/api/generation-prices");
}

/* ------------------------------ 管理端 ------------------------------ */

export interface AdminUser {
    id: number;
    username: string;
    role: "admin" | "user";
    status: "active" | "banned";
    quotaCents: number;
    createdAt: number;
    updatedAt: number;
}

export interface UsageRecord {
    id: number;
    model: string;
    status: string;
    costCents: number;
    promptTokens: number;
    completionTokens: number;
    gatewayQuota: number | null;
    gatewayRequestId: string | null;
    isStream: boolean;
    createdAt: number;
}

export interface AuditLog {
    id: number;
    userId: number | null;
    username: string | null;
    action: string;
    target: string | null;
    detail: unknown;
    ip: string | null;
    createdAt: number;
}

export interface AdminModelList {
    gatewayError: string | null;
    capabilities: string[];
    parameterWhitelist: Record<string, string[]>;
    items: RegistryModel[];
    unregistered: string[];
}

export interface ModelPrice {
    model: string;
    inCentsPer1k: number;
    outCentsPer1k: number;
    enabled: boolean;
}

export interface ModelWrite {
    modelId?: string;
    displayName?: string;
    provider?: string;
    description?: string;
    capability?: RegistryModel["capability"];
    enabled?: boolean;
    streaming?: boolean;
    toolCalling?: boolean;
    vision?: boolean;
    contextLength?: number | null;
    maxOutputTokens?: number | null;
    price?: { inCentsPer1k: number; outCentsPer1k: number };
}

export interface GatewayHealth {
    ok?: boolean;
    version?: string;
    latencyMs?: number;
    [key: string]: unknown;
}

/**
 * 管理端接口。前端只做展示与交互，权限由后端 requireAdmin 强制校验；
 * 即使绕过这个客户端直接调 /api/admin/*，没有管理员会话也会被 401/403 拦下。
 */
export const adminApi = {
    users(): Promise<{ total: number; items: AdminUser[] }> {
        return request("/api/admin/users");
    },
    createUser(payload: {
        username: string;
        password: string;
        role: "admin" | "user";
        quotaCents: number;
    }): Promise<{ id: number; username: string; role: string; quotaCents: number }> {
        return request("/api/admin/users", { method: "POST", body: JSON.stringify(payload) });
    },
    updateUser(
        id: number,
        payload: {
            status?: "active" | "banned";
            role?: "admin" | "user";
            quotaCents?: number;
            password?: string;
        },
    ): Promise<{ id: number; changed: Record<string, unknown> }> {
        return request(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    models(): Promise<AdminModelList> {
        return request("/api/admin/models?includeDisabled=true");
    },
    createModel(payload: ModelWrite): Promise<RegistryModel> {
        return request("/api/admin/models", { method: "POST", body: JSON.stringify(payload) });
    },
    updateModel(modelId: string, payload: ModelWrite): Promise<RegistryModel> {
        return request(`/api/admin/models/${encodeURIComponent(modelId)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    },
    deleteModel(modelId: string): Promise<{ deleted: string }> {
        return request(`/api/admin/models/${encodeURIComponent(modelId)}`, { method: "DELETE" });
    },
    prices(): Promise<{ items: ModelPrice[] }> {
        return request("/api/model-prices");
    },
    generationPrices(): Promise<{ items: GenerationPrice[] }> {
        return request("/api/generation-prices");
    },
    setGenerationPrice(model: string, payload: { centsPerCall: number; enabled?: boolean }): Promise<GenerationPrice> {
        return request(`/api/admin/generation-prices/${encodeURIComponent(model)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
        });
    },
    usage(limit = 100): Promise<{ items: UsageRecord[] }> {
        return request(`/api/admin/usage?limit=${limit}`);
    },
    audit(limit = 100): Promise<{ total: number; items: AuditLog[] }> {
        return request(`/api/admin/audit-logs?limit=${limit}`);
    },
    gatewayHealth(): Promise<GatewayHealth> {
        return request("/api/gateway/health");
    },
};
