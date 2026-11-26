/**
 * 离火后端客户端
 * ------------------------------------------------------------
 * 前端与模型服务的唯一通道。所有请求都带 Cookie 会话，
 * **不持有、不传输任何上游 API Key**。
 *
 * 环境变量：VITE_LIHUO_SERVER_URL，默认 http://127.0.0.1:3100
 */

const rawServerUrl = import.meta.env.VITE_LIHUO_SERVER_URL as string | undefined;
/** 未配置时走本地；显式配成空串表示同源部署（前端与 /api 同一个域名） */
export const LIHUO_SERVER_URL = rawServerUrl === undefined ? "http://127.0.0.1:3100" : rawServerUrl.replace(/\/+$/, "");



import { normalizeCloudPayload } from "@/lib/cloud-channel";

export class ServerApiError extends Error {
    code: string;
    status: number;
    details: unknown;
    constructor(code: string, message: string, status: number, details?: unknown) {
        super(message);
        this.name = "ServerApiError";
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export interface SessionUser {
    id: number;
    username: string;
    role: "admin" | "user";
    status: "active" | "banned";
    quotaCents: number;
    /** 虚拟积分，独立于额度 */
    points?: number;
    displayName?: string | null;
    email?: string | null;
    emailVerified?: boolean;
    avatarMediaKey?: string | null;
    createdAt?: number;
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
    /** 能力位：有渠道绑定时由渠道取并集，否则用模型自身声明 */
    supportsVision?: boolean;
    supportsTools?: boolean;
    supportsVideo?: boolean;
    channelCount?: number;
    availableChannels?: number;
    capabilitySource?: "channels" | "declared";
    price: { inCentsPer1k: number; outCentsPer1k: number } | null;
    /** 按次价（生图/视频/语音），管理端列表才会返回 */
    generationPrice?: { centsPerCall: number; enabled: boolean } | null;
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

/* ------------------------------ CSRF ------------------------------ */

const CSRF_COOKIE = "lihuo_csrf";
const CSRF_HEADER = "x-csrf-token";

function readCsrfCookie(): string | null {
    if (typeof document === "undefined") return null;
    const hit = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${CSRF_COOKIE}=`));
    return hit ? decodeURIComponent(hit.slice(CSRF_COOKIE.length + 1)) : null;
}

/** 写操作前确保有 CSRF 令牌：优先读 Cookie，缺失时向后端申领一次 */
async function csrfTokenFor(method: string): Promise<string | null> {
    if (method === "GET" || method === "HEAD") return null;
    const existing = readCsrfCookie();
    if (existing) return existing;
    try {
        await fetch(`${LIHUO_SERVER_URL}/api/auth/csrf`, { credentials: "include" });
    } catch {
        return null;
    }
    return readCsrfCookie();
}

/** 统一的带会话请求（CSRF 自动处理）；BYOK 等模块也复用它 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    const csrf = await csrfTokenFor((init.method ?? "GET").toUpperCase());
    if (csrf) headers.set(CSRF_HEADER, csrf);

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

    const payload = body as { ok?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } } | null;

    if (!res.ok || !payload?.ok) {
        throw new ServerApiError(
            payload?.error?.code ?? `http_${res.status}`,
            payload?.error?.message ?? text ?? res.statusText,
            res.status,
            payload?.error?.details,
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

export function register(input: { username: string; password: string; email: string; inviteCode?: string }): Promise<SessionUser> {
    return request<SessionUser>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ ...input, inviteCode: input.inviteCode || undefined }),
    });
}

export function verifyEmail(token: string): Promise<SessionUser> {
    return request<SessionUser>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
}

export function resendVerification(): Promise<{ sent: boolean }> {
    return request("/api/auth/resend-verification", { method: "POST" });
}

export function logout(): Promise<{ loggedOut: boolean }> {
    return request("/api/auth/logout", { method: "POST" });
}

export function me(): Promise<SessionUser> {
    return request<SessionUser>("/api/me");
}

export function forgotPassword(email: string): Promise<{ sent: boolean }> {
    return request("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string): Promise<{ reset: boolean; revokedSessions: number }> {
    return request("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
}

/** 账户概览：余额、今日/本月消费 */
export interface AccountSummary {
    balanceCents: number;
    todayCostCents: number;
    todayCalls: number;
    monthCostCents: number;
}

export function accountSummary(): Promise<AccountSummary> {
    return request("/api/me/summary");
}

/* ------------------------------ 积分 ------------------------------ */

export interface PointLedgerItem {
    id: number;
    kind: string;
    amount: number;
    balance_after: number;
    reason: string;
    created_at: number;
}

export function myPoints(): Promise<{ balance: number }> {
    return request("/api/me/points");
}

export function myPointLedger(limit = 20, offset = 0): Promise<{ items: PointLedgerItem[]; total: number; limit: number; offset: number }> {
    return request(`/api/me/point-ledger?limit=${limit}&offset=${offset}`);
}

/* ------------------------------ 积分套餐与充值 ------------------------------ */

export interface PointPackage {
    id: string;
    name: string;
    subtitle: string;
    priceCents: number;
    points: number;
    bonusPoints: number;
    totalPoints: number;
    badge: string | null;
    highlights: string[];
    recommended: boolean;
    enabled: boolean;
    sortOrder: number;
}

export type PointOrderStatus = "pending" | "paid" | "cancelled" | "refunded";

export interface PointOrder {
    id: string;
    packageId: string;
    packageName: string;
    priceCents: number;
    points: number;
    status: PointOrderStatus;
    paymentMethod: string | null;
    paidAt: number | null;
    remark: string | null;
    createdAt: number;
    username?: string;
}

/** paymentDriver=mock 表示点击即到账；manual 表示下单后由管理员确认 */
export function listPointPackages(): Promise<{ items: PointPackage[]; paymentDriver: "mock" | "manual" }> {
    return request("/api/point-packages");
}

export function createPointOrder(packageId: string): Promise<{ order: PointOrder; paymentDriver: "mock" | "manual" }> {
    return request("/api/point-orders", { method: "POST", body: JSON.stringify({ packageId }) });
}

export function payPointOrder(id: string): Promise<{ order: PointOrder; balance: number }> {
    return request(`/api/point-orders/${encodeURIComponent(id)}/pay`, { method: "POST" });
}

export function cancelPointOrder(id: string): Promise<{ cancelled: string }> {
    return request(`/api/point-orders/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export function myPointOrders(page = 1, limit = 10): Promise<{ items: PointOrder[]; total: number; page: number; limit: number }> {
    return request(`/api/me/point-orders?page=${page}&limit=${limit}`);
}

export interface LedgerItem {
    id: number;
    kind: string;
    amount_cents: number;
    balance_after: number;
    reason: string;
    created_at: number;
}

export function updateProfile(patch: { displayName?: string; email?: string; avatarMediaKey?: string }): Promise<SessionUser> {
    return request<SessionUser>("/api/me", { method: "PATCH", body: JSON.stringify(patch) });
}

export function changePassword(oldPassword: string, newPassword: string): Promise<{ changed: boolean; revokedSessions: number }> {
    return request("/api/me/password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) });
}

export interface LoginSession {
    id: string;
    ip: string | null;
    userAgent: string | null;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
    current: boolean;
}

export function listSessions(): Promise<{ items: LoginSession[] }> {
    return request("/api/me/sessions");
}

export function revokeSession(id: string): Promise<{ revoked: boolean }> {
    return request(`/api/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function revokeOtherSessions(): Promise<{ revoked: number }> {
    return request("/api/me/sessions", { method: "DELETE" });
}

export function deleteAccount(password: string): Promise<{ deleted: boolean; cooldownDays: number }> {
    return request("/api/me", { method: "DELETE", body: JSON.stringify({ password }) });
}

export function listLedger(page = 1, limit = 20): Promise<{ items: LedgerItem[]; total: number; page: number; limit: number }> {
    return request(`/api/me/ledger?page=${page}&limit=${limit}`);
}

/* ------------------------------ 模型 ------------------------------ */

export function listModels(): Promise<{ items: RegistryModel[]; gatewayError?: string | null }> {
    return request("/api/models");
}

/* ------------------------------ 对话 ------------------------------ */

export interface ChatPayload {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
    traceId?: string;
    /** 计费来源：平台额度 / 用户自己的 Key（由模型编码自动推导，也可显式指定） */
    keySource?: "platform" | "byok";
    /** BYOK 渠道 ID（只传 ID，不传密钥） */
    byokChannelId?: string;
}

export function chat(payload: ChatPayload, idempotencyKey?: string): Promise<ChatResult> {
    return request<ChatResult>("/api/chat", {
        method: "POST",
        body: JSON.stringify(normalizeCloudPayload(payload as unknown as Record<string, unknown>)),
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
        const csrf = await csrfTokenFor("POST");
        res = await fetch(`${LIHUO_SERVER_URL}/api/chat/stream`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
                ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
            },
            body: JSON.stringify(normalizeCloudPayload(payload as unknown as Record<string, unknown>)),
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
    const csrf = await csrfTokenFor((init.method ?? "GET").toUpperCase());
    if (csrf) headers.set(CSRF_HEADER, csrf);

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
        body: JSON.stringify(normalizeCloudPayload(payload)),
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
        body: JSON.stringify(normalizeCloudPayload(payload)),
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
    /** 虚拟积分 */
    points: number;
    displayName?: string | null;
    email?: string | null;
    createdAt: number;
    updatedAt?: number;
    lastLoginAt?: number | null;
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

export interface AdminModelRow extends RegistryModel {
    price: { inCentsPer1k: number; outCentsPer1k: number } | null;
    generationPrice: { centsPerCall: number; enabled: boolean } | null;
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

/* ------------------------------ 渠道管理（P1） ------------------------------ */

export type ChannelProvider = "openai" | "anthropic" | "gemini" | "newapi" | "custom" | "mock";
export type ChannelHealthStatus = "unknown" | "healthy" | "degraded" | "unhealthy";

export interface ChannelBinding {
    id: number;
    channelId: string;
    modelId: string;
    providerModel: string;
    enabled: boolean;
    contextLength: number | null;
    maxOutputTokens: number | null;
    supportsStreaming: boolean;
    supportsVision: boolean;
    supportsTools: boolean;
    supportsVideo: boolean;
    upstreamInMicrosPer1k: number;
    upstreamOutMicrosPer1k: number;
    upstreamCallMicros: number;
    paramsOverride: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}

export interface ChannelUsageSummary {
    channelId?: string;
    requests: number;
    success: number;
    failed: number;
    promptTokens?: number;
    completionTokens?: number;
    upstreamCostMicros: number;
    salesCents: number;
    avgLatencyMs: number;
    grossMarginMicros: number;
}

export interface ChannelRow {
    id: string;
    name: string;
    providerType: ChannelProvider;
    baseUrl: string;
    status: "enabled" | "disabled";
    priority: number;
    weight: number;
    maxConcurrency: number;
    timeoutMs: number;
    connectTimeoutMs: number;
    extraHeaders: Record<string, string>;
    providerOptions: Record<string, unknown>;
    healthStatus: ChannelHealthStatus;
    consecutiveFailures: number;
    lastHealthCheckAt: number | null;
    lastError: string | null;
    hasApiKey: boolean;
    apiKeyHint: string;
    apiKeyVersion: number;
    apiKeyUpdatedAt: number | null;
    source: string;
    bindingCount: number;
    createdAt: number;
    updatedAt: number;
    today: ChannelUsageSummary;
    bindings?: ChannelBinding[];
    healthChecks?: Array<{ ok: boolean; status: number | null; latencyMs: number; error: string | null; checkedAt: number }>;
}

export interface RouteDecision {
    id: number;
    request_id: string | null;
    user_id: number | null;
    endpoint: string;
    model_id: string;
    channel_id: string | null;
    provider_model: string | null;
    attempt: number;
    reason: string;
    candidates: Array<{ channelId: string; channelName: string; reason: string; eligible: boolean }>;
    status: string;
    error_code: string | null;
    key_source?: "platform" | "byok";
    byok_key_id?: string | null;
    latency_ms: number;
    created_at: number;
}

export interface ChannelWrite {
    name?: string;
    providerType?: ChannelProvider;
    baseUrl?: string;
    apiKey?: string;
    status?: "enabled" | "disabled";
    priority?: number;
    weight?: number;
    maxConcurrency?: number;
    timeoutMs?: number;
    connectTimeoutMs?: number;
    extraHeaders?: Record<string, string>;
    providerOptions?: Record<string, unknown>;
}

export interface ChannelBindingWrite {
    modelId?: string;
    providerModel?: string;
    enabled?: boolean;
    contextLength?: number | null;
    maxOutputTokens?: number | null;
    supportsStreaming?: boolean;
    supportsVision?: boolean;
    supportsTools?: boolean;
    supportsVideo?: boolean;
    upstreamInMicrosPer1k?: number;
    upstreamOutMicrosPer1k?: number;
    upstreamCallMicros?: number;
    paramsOverride?: Record<string, unknown>;
}


/**
 * 管理端接口。前端只做展示与交互，权限由后端 requireAdmin 强制校验；
 * 即使绕过这个客户端直接调 /api/admin/*，没有管理员会话也会被 401/403 拦下。
 */
export interface AdminQuotaPlan {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    isDefault: boolean;
    version: number;
    qps: number;
    burst: number;
    maxConcurrent: number;
    dailyRequests: number;
    imageDaily: number;
    imageConcurrent: number;
    audioDaily: number;
    audioConcurrent: number;
    streamConcurrent: number;
    streamIdleTimeoutMs: number;
    streamMaxDurationMs: number;
    requestTimeoutMs: number;
    maxChatRequestBytes: number;
    maxImageRequestBytes: number;
    maxAudioRequestBytes: number;
    maxResponseBytes: number;
    createdAt: number;
    updatedAt: number;
}

export interface AdminQuotaUser {
    userId: number;
    planId: string | null;
    plan: AdminQuotaPlan;
    limits: Omit<AdminQuotaPlan, "id" | "name" | "description" | "enabled" | "isDefault" | "version" | "createdAt" | "updatedAt">;
    overrides: Record<string, number>;
    usage: { requests: number; chat: number; image: number; audio: number; stream: number; concurrent: number; streams: number };
    resetAt: number;
}

export const adminApi = {
    quotaPlans(): Promise<{ items: AdminQuotaPlan[] }> {
        return request("/api/admin/byok-quota/plans");
    },
    createQuotaPlan(payload: Partial<AdminQuotaPlan> & { id: string; name: string }): Promise<AdminQuotaPlan> {
        return request("/api/admin/byok-quota/plans", { method: "POST", body: JSON.stringify(payload) });
    },
    updateQuotaPlan(id: string, payload: Partial<AdminQuotaPlan>): Promise<AdminQuotaPlan> {
        return request(`/api/admin/byok-quota/plans/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    deleteQuotaPlan(id: string): Promise<{ deleted: string }> {
        return request(`/api/admin/byok-quota/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    userQuota(id: number): Promise<AdminQuotaUser> {
        return request(`/api/admin/users/${id}/byok-quota`);
    },
    assignUserQuota(id: number, payload: { planId: string | null; overrides?: Record<string, number> }): Promise<AdminQuotaUser> {
        return request(`/api/admin/users/${id}/byok-quota`, { method: "PUT", body: JSON.stringify(payload) });
    },


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
    /** 调积分：虚拟点数，正数发放 / 负数扣减，必须带原因 */
    creditPoints(
        id: number,
        payload: { amount: number; reason: string; kind?: "grant" | "task" | "reward" | "redeem" | "adjust" | "revoke"; refId?: string },
    ): Promise<{ balance: number; transactionId: number }> {
        return request(`/api/admin/users/${id}/points`, { method: "POST", body: JSON.stringify(payload) });
    },
    /** 套餐管理：全部（含下架） */
    pointPackages(): Promise<{ items: PointPackage[] }> {
        return request("/api/admin/point-packages");
    },
    createPointPackage(payload: {
        name: string;
        subtitle?: string;
        priceCents: number;
        points: number;
        bonusPoints?: number;
        badge?: string;
        highlights?: string[];
        recommended?: boolean;
        enabled?: boolean;
        sortOrder?: number;
    }): Promise<PointPackage> {
        return request("/api/admin/point-packages", { method: "POST", body: JSON.stringify(payload) });
    },
    updatePointPackage(id: string, payload: Partial<{
        name: string;
        subtitle: string;
        priceCents: number;
        points: number;
        bonusPoints: number;
        badge: string;
        highlights: string[];
        recommended: boolean;
        enabled: boolean;
        sortOrder: number;
    }>): Promise<PointPackage> {
        return request(`/api/admin/point-packages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    deletePointPackage(id: string): Promise<{ deleted?: string; disabled?: string; reason?: string }> {
        return request(`/api/admin/point-packages/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    pointOrders(query: { status?: string; q?: string; page?: number; limit?: number } = {}): Promise<{
        items: PointOrder[];
        total: number;
        page: number;
        limit: number;
        stats: { revenueCents: number; pendingOrders: number };
    }> {
        const params = new URLSearchParams();
        if (query.status) params.set("status", query.status);
        if (query.q) params.set("q", query.q);
        params.set("page", String(query.page ?? 1));
        params.set("limit", String(query.limit ?? 20));
        return request(`/api/admin/point-orders?${params.toString()}`);
    },
    confirmPointOrder(id: string, remark?: string): Promise<PointOrder> {
        return request(`/api/admin/point-orders/${encodeURIComponent(id)}/confirm`, { method: "POST", body: JSON.stringify({ remark }) });
    },
    refundPointOrder(id: string, reason?: string): Promise<PointOrder> {
        return request(`/api/admin/point-orders/${encodeURIComponent(id)}/refund`, { method: "POST", body: JSON.stringify({ reason }) });
    },
    /** 调额度：唯一入口，必须带原因；后端会写额度流水 */
    creditUser(
        id: number,
        payload: { amountCents: number; reason: string; kind?: "grant" | "recharge" | "redeem" | "refund" | "adjust"; refId?: string },
    ): Promise<{ balanceCents: number; transactionId: number }> {
        return request(`/api/admin/users/${id}/credit`, { method: "POST", body: JSON.stringify(payload) });
    },
    stats(): Promise<{
        users: { total: number; active: number };
        today: { calls: number; costCents: number; refunded: number };
        balanceCents: number;
        tasks: { running: number; failed: number };
    }> {
        return request("/api/admin/stats");
    },

    /* ------------------------------ 渠道管理（P1） ------------------------------ */

    channels(): Promise<{ items: ChannelRow[]; providers: ChannelProvider[]; mockAllowed: boolean }> {
        return request("/api/admin/channels");
    },
    channel(id: string): Promise<ChannelRow> {
        return request(`/api/admin/channels/${encodeURIComponent(id)}`);
    },
    createChannel(payload: ChannelWrite): Promise<ChannelRow> {
        return request("/api/admin/channels", { method: "POST", body: JSON.stringify(payload) });
    },
    updateChannel(id: string, payload: ChannelWrite): Promise<ChannelRow> {
        return request(`/api/admin/channels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    /** 换钥：只写不读，返回新的 hint 与版本 */
    rotateChannelKey(id: string, apiKey: string): Promise<{ id: string; keyVersion: number; apiKeyHint: string }> {
        return request(`/api/admin/channels/${encodeURIComponent(id)}/key`, { method: "PUT", body: JSON.stringify({ apiKey }) });
    },
    deleteChannel(id: string): Promise<{ deleted: string }> {
        return request(`/api/admin/channels/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    testChannel(id: string, modelId?: string): Promise<{
        ok: boolean;
        status: number;
        latencyMs: number;
        billable: boolean;
        modelId: string | null;
        error: string | null;
    }> {
        return request(`/api/admin/channels/${encodeURIComponent(id)}/test`, { method: "POST", body: JSON.stringify({ modelId }) });
    },
    healthCheckChannel(id: string, force = true): Promise<{
        channelId: string;
        ok: boolean;
        status: number;
        latencyMs: number;
        error: string | null;
        checkedAt: number;
        healthStatus: ChannelHealthStatus;
    }> {
        return request(`/api/admin/channels/${encodeURIComponent(id)}/health-check`, { method: "POST", body: JSON.stringify({ force }) });
    },
    channelUsage(id: string, days = 7): Promise<{
        days: number;
        summary: ChannelUsageSummary;
        models: Array<{ modelId: string; requests: number; success: number; failed: number; upstreamCostMicros: number; salesCents: number; promptTokens: number; completionTokens: number }>;
    }> {
        return request(`/api/admin/channels/${encodeURIComponent(id)}/usage?days=${days}`);
    },
    channelUsageOverview(days = 7): Promise<{
        days: number;
        items: Array<ChannelUsageSummary & { channelName: string }>;
        totals: { requests: number; success: number; failed: number; upstreamCostMicros: number; salesCents: number; grossMarginMicros: number };
    }> {
        return request(`/api/admin/channels/usage/overview?days=${days}`);
    },
    bindChannelModel(channelId: string, payload: ChannelBindingWrite & { modelId: string; providerModel: string }): Promise<ChannelBinding> {
        return request(`/api/admin/channels/${encodeURIComponent(channelId)}/models`, { method: "POST", body: JSON.stringify(payload) });
    },
    updateChannelBinding(bindingId: number, payload: ChannelBindingWrite): Promise<ChannelBinding> {
        return request(`/api/admin/channel-models/${bindingId}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    deleteChannelBinding(bindingId: number): Promise<{ deleted: number }> {
        return request(`/api/admin/channel-models/${bindingId}`, { method: "DELETE" });
    },
    routeDecisions(query: { modelId?: string; channelId?: string; limit?: number } = {}): Promise<{ items: RouteDecision[] }> {
        const params = new URLSearchParams();
        if (query.modelId) params.set("modelId", query.modelId);
        if (query.channelId) params.set("channelId", query.channelId);
        params.set("limit", String(query.limit ?? 50));
        return request(`/api/admin/route-decisions?${params.toString()}`);
    },
    /** 后端自身健康（不是网关），用于系统设置页 */
    serverHealth(): Promise<{ service: string; status: string; time: number; gateway: string; storage: string }> {
        return request("/health");
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

/* ------------------------------ 云端生成（P0-2） ------------------------------ */

/** multipart 上传（图生图 / 蒙版编辑）：后端转成上游 multipart 并计费 */
export async function generateForm<T = unknown>(
    endpoint: GenerationEndpoint,
    form: FormData,
    opts: GenerateOptions = {},
): Promise<GenerationJsonResult<T>> {
    const res = await requestRaw(`/api/generate/${endpoint}`, {
        method: "POST",
        body: form,
        headers: opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
        signal: opts.signal,
    });
    const text = await res.text();
    let data: T;
    try {
        data = (text ? JSON.parse(text) : null) as T;
    } catch {
        throw new ServerApiError("invalid_response", "生成结果不是合法 JSON", res.status);
    }
    return { data, billing: billingOf(res) };
}

export interface CloudTaskResult {
    mediaKey?: string;
    mime?: string;
    bytes?: number;
}

export interface CloudTask {
    id: string;
    status: "queued" | "running" | "cancel_requested" | "succeeded" | "failed" | "canceled";
    result: CloudTaskResult | null;
    errorCode: string | null;
}

/** 视频任务：创建后由服务端 worker 轮询上游，前端只查我们的任务状态 */
export function createVideoTask(
    payload: Record<string, unknown>,
    opts: GenerateOptions = {},
): Promise<{ taskId: string; providerTaskId: string | null; status: string }> {
    return request("/api/generate/video-generations", {
        method: "POST",
        body: JSON.stringify(normalizeCloudPayload(payload)),
        headers: opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    });
}

export function getTask(id: string): Promise<CloudTask> {
    return request(`/api/tasks/${encodeURIComponent(id)}`);
}

/** 取消结论：与后端 `applyCancelOutcome` 的结果一一对应（Phase 5 P0-3） */
export interface CloudCancelResult {
    canceled: boolean;
    /** 上游取消结论；不代表费用为零 */
    outcome: "cancelled" | "already_finished" | "unsupported" | "failed" | "unknown";
    /** 上游是否明确确认任务已停 */
    verified: boolean;
    /** 费用结论（独立于取消结论） */
    chargeOutcome?: "no_charge_confirmed" | "partial_charge_confirmed" | "full_charge_confirmed" | "charge_unknown";
    /** refunded=已自动退款；settled=按实际费用结算；review=转人工；unchanged=未动账 */
    moneyStatus?: "refunded" | "settled" | "review" | "unchanged";
    chargedCents?: number | null;
}

export function cancelTask(id: string): Promise<CloudCancelResult> {
    return request(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export function getMediaUrl(key: string): Promise<{ url: string; expiresAt: number; mime: string }> {
    return request(`/api/media/${encodeURIComponent(key)}/url`);
}

/** 直传签名：返回一次性上传地址，字节不经过业务 API */
export function signMediaUpload(input: { mime: string; bytes: number }): Promise<{
    key: string;
    uploadUrl: string;
    method: "PUT";
    headers?: Record<string, string>;
    expiresAt: number;
}> {
    return request("/api/media/sign", { method: "POST", body: JSON.stringify(input) });
}

/** 上传完成后登记：服务端会核对对象真实大小 */
export function commitMediaUpload(input: {
    key: string;
    bytes: number;
    mime: string;
    sha256?: string;
    width?: number;
    height?: number;
    durationMs?: number;
}): Promise<{ key: string; bytes: number; mime: string }> {
    return request("/api/media/commit", { method: "POST", body: JSON.stringify(input) });
}

/* ------------------------------ 项目（P0-3） ------------------------------ */

export interface ProjectSummary {
    id: string;
    title: string;
    revision: number;
    schemaVersion: number;
    nodeCount: number;
    connectionCount: number;
    coverMediaKey: string | null;
    createdAt: number;
    updatedAt: number;
    deletedAt?: number | null;
}

export interface ProjectDetail extends ProjectSummary {
    payload: Record<string, unknown>;
}

export function listProjects(page = 1, limit = 100): Promise<{ items: ProjectSummary[]; total: number; page: number; limit: number }> {
    return request(`/api/projects?page=${page}&limit=${limit}`);
}

export function getProject(id: string): Promise<ProjectDetail> {
    return request(`/api/projects/${encodeURIComponent(id)}`);
}

export function createProjectRemote(input: { id: string; title: string; payload: Record<string, unknown>; schemaVersion?: number }): Promise<{ id: string; revision: number; updatedAt: number }> {
    return request("/api/projects", { method: "POST", body: JSON.stringify(input) });
}

export function saveProjectRemote(
    id: string,
    input: { revision: number; title?: string; payload?: Record<string, unknown>; schemaVersion?: number; coverMediaKey?: string | null },
): Promise<{ id: string; revision: number; updatedAt: number }> {
    return request(`/api/projects/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteProjectRemote(id: string): Promise<{ deleted: string }> {
    return request(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function importProjectsRemote(projects: Array<Record<string, unknown>>, overwrite = false): Promise<{ imported: number; skipped: number }> {
    return request("/api/projects/import", { method: "POST", body: JSON.stringify({ projects, overwrite }) });
}

export interface ProjectVersionSummary {
    id: number;
    revision: number;
    title: string;
    nodeCount: number;
    connectionCount: number;
    label: string | null;
    createdAt: number;
}

export function listProjectVersions(projectId: string): Promise<{ items: ProjectVersionSummary[] }> {
    return request(`/api/projects/${encodeURIComponent(projectId)}/versions`);
}

export function restoreProjectVersion(projectId: string, versionId: number, revision: number): Promise<{ restoredFrom: number; revision: number; updatedAt: number }> {
    return request(`/api/projects/${encodeURIComponent(projectId)}/versions/${versionId}/restore`, {
        method: "POST",
        body: JSON.stringify({ revision }),
    });
}
