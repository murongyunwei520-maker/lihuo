import { request } from "./lihuo-server";

/**
 * 待人工处理预扣（review）管理端接口
 * ------------------------------------------------------------
 * 对应后端 `src/modules/admin.ts` 的 `/api/admin/usage-reviews`。
 * 权限由后端 requireAdmin 强制校验，前端不做推断。
 */

export type UsageReviewFilterStatus = "review" | "settled" | "refunded" | "all";

export interface UsageReviewItem {
    id: number;
    userId: number;
    username: string | null;
    model: string;
    endpoint: string;
    /** review=待处理；settled/refunded=已人工处理 */
    status: "review" | "settled" | "refunded";
    reservedCents: number;
    costCents: number;
    /** 触发 review 的原因（回收器写入） */
    reviewReason: string | null;
    /** 人工处理原因 */
    reviewNote: string | null;
    reviewedAt: number | null;
    reviewedBy: number | null;
    error: string | null;
    taskId: string | null;
    taskStatus: string | null;
    createdAt: number;
    settledAt: number | null;
}

export interface UsageReviewRecord extends UsageReviewItem {
    promptTokens: number;
    completionTokens: number;
    gatewayRequestId: string | null;
    channelId: string | null;
    providerModel: string | null;
    upstreamCostMicros: number;
    idempotencyKey: string | null;
}

export interface UsageReviewTask {
    id: string;
    status: string;
    errorCode: string | null;
    providerTaskId: string | null;
    providerRequestId: string | null;
    channelId: string | null;
    providerModel: string | null;
    attempts: number;
    leaseUntil: number | null;
    leaseHeartbeatAt: number | null;
    createdAt: number;
    finishedAt: number | null;
}

export interface UsageReviewAudit {
    id: number;
    userId: number | null;
    username: string | null;
    action: string;
    detail: string | null;
    ip: string | null;
    createdAt: number;
}

export interface UsageReviewDetail {
    record: UsageReviewRecord;
    task: UsageReviewTask | null;
    audits: UsageReviewAudit[];
}

export interface UsageReviewPage {
    items: UsageReviewItem[];
    total: number;
    page: number;
    limit: number;
}

export interface UsageReviewQuery {
    status?: UsageReviewFilterStatus;
    userId?: number;
    taskId?: string;
    from?: number;
    to?: number;
    page?: number;
    limit?: number;
}

export function listUsageReviews(query: UsageReviewQuery = {}): Promise<UsageReviewPage> {
    const qs = new URLSearchParams();
    if (query.status) qs.set("status", query.status);
    if (query.userId) qs.set("userId", String(query.userId));
    if (query.taskId) qs.set("taskId", query.taskId);
    if (query.from) qs.set("from", String(query.from));
    if (query.to) qs.set("to", String(query.to));
    if (query.page) qs.set("page", String(query.page));
    if (query.limit) qs.set("limit", String(query.limit));
    const suffix = qs.toString();
    return request(`/api/admin/usage-reviews${suffix ? `?${suffix}` : ""}`);
}

export function getUsageReview(id: number): Promise<UsageReviewDetail> {
    return request(`/api/admin/usage-reviews/${id}`);
}

/** 人工结算：金额必须显式给出（后端不会默认等于预扣） */
export function settleUsageReview(
    id: number,
    input: { costCents: number; note: string },
): Promise<{ balanceCents: number; reservedCents: number; costCents: number; refundedCents: number; chargedExtraCents: number }> {
    return request(`/api/admin/usage-reviews/${id}/settle`, { method: "POST", body: JSON.stringify(input) });
}

/** 人工退款：全额退回预扣 */
export function refundUsageReview(
    id: number,
    input: { note: string },
): Promise<{ refundedCents: number; balanceCents: number }> {
    return request(`/api/admin/usage-reviews/${id}/refund`, { method: "POST", body: JSON.stringify(input) });
}
