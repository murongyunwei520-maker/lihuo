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
