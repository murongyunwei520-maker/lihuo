/**
 * 离火统一模型网关 · Provider 抽象
 * ------------------------------------------------------------
 * 设计目标：画布与业务代码只依赖本接口，不依赖 New-API。
 * 将来换掉 New-API（或换成自研转发）只需实现一个新 Provider。
 *
 * 归属原则（决策 A1）：
 *   离火持有唯一平台令牌调用网关；
 *   每用户用量由离火侧记账，网关返回 requestId 供对账。
 */

/** 模型能力，与离火 web/src/stores/use-config-store.ts 的 ModelCapability 对齐 */
export type ModelCapability = "text" | "image" | "video" | "audio" | "embedding";

export interface GatewayModel {
  /** 调用时使用的模型名（必须与渠道配置一致） */
  id: string;
  /** 供应商，如 deepseek / openai / google */
  provider: string;
  capabilities: ModelCapability[];
  /** 上下文窗口，未知为 null */
  contextLength: number | null;
  /** 是否支持流式 */
  streaming: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
  /** 离火侧用户标识，仅用于本侧记账，不会透传给上游 */
  lihuoUserId?: string;
  /** 离火侧业务关联标识（如画布节点 id），用于对账与排障 */
  lihuoTraceId?: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  content: string;
  model: string;
  /** 网关返回的 request id，用于与网关日志对账（关键：A1 方案的归因依据） */
  requestId: string | null;
  usage: ChatUsage | null;
  /** 网关侧计费额度（New-API 内部单位），成本核对用，不等于用户账单 */
  gatewayQuota: number | null;
  latencyMs: number;
}

export interface StreamChunk {
  delta: string;
  /** 是否为最后一包 */
  done: boolean;
  /** 网关请求 id（每包都带，取响应头 X-Oneapi-Request-Id），用于对账 */
  requestId?: string | null;
  /** 仅最后一包携带，流式计费依据 */
  usage?: ChatUsage | null;
}

export interface UsageRecord {
  requestId: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  quota: number;
  channelId: number | null;
  createdAt: number;
}

export interface HealthResult {
  ok: boolean;
  version: string | null;
  latencyMs: number;
  raw?: unknown;
}

export interface ChannelTestResult {
  channelId: number;
  ok: boolean;
  message: string;
  latencyMs: number;
}

/** 统一错误，屏蔽 New-API 与上游的差异 */
export class GatewayError extends Error {
  code: string;
  httpStatus: number;
  requestId: string | null;
  retryable: boolean;
  raw: unknown;

  constructor(init: {
    message: string;
    code?: string;
    httpStatus?: number;
    requestId?: string | null;
    retryable?: boolean;
    raw?: unknown;
  }) {
    super(init.message);
    this.name = "GatewayError";
    this.code = init.code ?? "unknown";
    this.httpStatus = init.httpStatus ?? 0;
    this.requestId = init.requestId ?? null;
    this.retryable = init.retryable ?? false;
    this.raw = init.raw;
  }
}

export interface GatewayProvider {
  /** 当前令牌可见的模型列表 */
  getModels(signal?: AbortSignal): Promise<GatewayModel[]>;
  /** 非流式对话 */
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
  /** 流式对话；调用方负责消费到结束或提前 break（break 会中止上游连接） */
  streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown>;
  /** 拉取网关侧用量日志（需要管理凭据） */
  getUsage(params: { sinceSeconds?: number; limit?: number }, signal?: AbortSignal): Promise<UsageRecord[]>;
  /** 渠道连通性测试（需要管理凭据） */
  testChannel(channelId: number, signal?: AbortSignal): Promise<ChannelTestResult>;
  /** 网关健康检查 */
  getHealth(signal?: AbortSignal): Promise<HealthResult>;
}
