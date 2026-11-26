import { request } from "./lihuo-server";

/**
 * Provider 治理相关管理端接口（Phase 5 P0-4）。
 *
 * 覆盖：渠道能力验证、渠道能力矩阵、Provider 错误规则、任务补偿记录。
 * 权限全部由后端 `requireAdmin` 强制；前端不展示任何密钥或密文。
 */

export type CapabilityLevel = "verified" | "declared" | "unsupported" | "unknown" | "not_tested";

export interface ChannelCapabilityDetail {
    channelId: string;
    channelName: string;
    providerType: string;
    capability: string;
    level: CapabilityLevel;
    declared: boolean | null;
    latest: {
        id: number;
        status: string;
        evidence: string | null;
        note: string | null;
        verifiedBy: number | null;
        verifiedAt: number;
    } | null;
    history: Array<{
        id: number;
        status: string;
        evidence: string | null;
        note: string | null;
        verifiedBy: number | null;
        verifiedAt: number;
    }>;
}

export interface ContractCapability {
    capability: string;
    label: string;
    adapterSupported: boolean;
    verification: { status: string; evidence: string | null; verifiedAt: number } | null;
    level: CapabilityLevel;
    note: string;
}

export interface ChannelContract {
    providerType: string;
    channelId: string;
    capabilities: ContractCapability[];
    fee: {
        queryable: boolean;
        currency: string | null;
        unit: string | null;
        note: string;
    };
}

export type RuleStatus = "unverified" | "verified" | "disabled";
export type RuleSemantics = "not_accepted" | "unknown";

export interface ErrorRule {
    id: number;
    scope: "provider" | "channel";
    providerType: string;
    channelId: string | null;
    statusMin: number;
    statusMax: number;
    errorType: string | null;
    semantics: RuleSemantics;
    status: RuleStatus;
    evidence: string | null;
    note: string | null;
    version: number;
    verifiedAt: number | null;
    verifiedBy: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface ErrorRuleList {
    items: ErrorRule[];
    total: number;
    summary: Record<string, number>;
    hasVerifiedRejectionRules: boolean;
}

export type CompensationStatus = "pending" | "checking" | "needs_attention" | "resolved" | "exhausted";
export type CompensationKind = "create_unknown" | "persist_unconfirmed" | "cancel_unconfirmed";

export interface CompensationItem {
    id: number;
    kind: CompensationKind;
    status: CompensationStatus;
    userId: number;
    usageRecordId: number | null;
    taskId: string | null;
    model: string;
    providerType: string | null;
    channelId: string | null;
    providerModel: string | null;
    providerTaskId: string | null;
    providerRequestId: string | null;
    idempotencyKey: string | null;
    attempts: number;
    lastError: string | null;
    providerResult: Record<string, unknown> | null;
    nextCheckAt: number | null;
    leaseOwner: string | null;
    leaseUntil: number | null;
    createdAt: number;
    updatedAt: number;
    resolvedAt: number | null;
}

export interface Paged<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
}

export function getChannelCapabilities(channelId: string): Promise<ChannelCapabilityDetail> {
    return request(`/api/admin/channels/${encodeURIComponent(channelId)}/capabilities`);
}

export function verifyChannelCapability(
    channelId: string,
    capability: string,
    input: { status: "verified" | "failed"; evidence: string; note?: string },
): Promise<{ id: number; capability: string; status: string; level: CapabilityLevel }> {
    return request(`/api/admin/channels/${encodeURIComponent(channelId)}/capabilities/${encodeURIComponent(capability)}/verify`, {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export function getChannelContract(channelId: string): Promise<ChannelContract> {
    return request(`/api/admin/channels/${encodeURIComponent(channelId)}/contract`);
}

export function listErrorRules(query: { providerType?: string; channelId?: string; status?: string } = {}): Promise<ErrorRuleList> {
    const qs = new URLSearchParams();
    if (query.providerType) qs.set("providerType", query.providerType);
    if (query.channelId) qs.set("channelId", query.channelId);
    if (query.status) qs.set("status", query.status);
    const suffix = qs.toString();
    return request(`/api/admin/provider-error-rules${suffix ? `?${suffix}` : ""}`);
}

export function createErrorRule(input: {
    scope: "provider" | "channel";
    providerType: string;
    channelId?: string | null;
    statusMin: number;
    statusMax: number;
    errorType?: string | null;
    semantics: RuleSemantics;
    note?: string | null;
}): Promise<{ id: number; created: boolean; status: RuleStatus }> {
    return request("/api/admin/provider-error-rules", { method: "POST", body: JSON.stringify(input) });
}

export function verifyErrorRule(id: number, input: { status: "verified" | "disabled"; evidence?: string }): Promise<{ id: number; status: RuleStatus }> {
    return request(`/api/admin/provider-error-rules/${id}/verify`, { method: "POST", body: JSON.stringify(input) });
}

export function listCompensations(query: { status?: string; kind?: string; page?: number; limit?: number } = {}): Promise<Paged<CompensationItem>> {
    const qs = new URLSearchParams();
    if (query.status) qs.set("status", query.status);
    if (query.kind) qs.set("kind", query.kind);
    if (query.page) qs.set("page", String(query.page));
    if (query.limit) qs.set("limit", String(query.limit));
    const suffix = qs.toString();
    return request(`/api/admin/task-compensations${suffix ? `?${suffix}` : ""}`);
}
