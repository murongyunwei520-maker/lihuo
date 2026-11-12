import {
  GatewayError,
  type ChannelTestResult,
  type ChatRequest,
  type ChatResult,
  type GatewayModel,
  type GatewayProvider,
  type HealthResult,
  type StreamChunk,
  type UsageRecord,
} from "../gateway.interface.ts";
import { NewApiClient, type NewApiClientOptions } from "./newapi.client.ts";
import { parseSse } from "./newapi.stream.ts";
import type {
  NewApiChatResponse,
  NewApiChannelTestResponse,
  NewApiLogListResponse,
  NewApiModelListResponse,
  NewApiStatusResponse,
} from "./newapi.types.ts";

/**
 * New-API Provider
 * ------------------------------------------------------------
 * 把 New-API 的 HTTP 细节收敛成离火能理解的语义。
 * 换网关时，只要另写一个 Provider，画布和业务代码不用动。
 */
export class NewApiProvider implements GatewayProvider {
  private readonly client: NewApiClient;

  constructor(opts: NewApiClientOptions) {
    this.client = new NewApiClient(opts);
  }

  async getHealth(signal?: AbortSignal): Promise<HealthResult> {
    const started = Date.now();
    const res = await this.client.relay("/api/status", { method: "GET" }, signal);
    const body = (await res.json()) as NewApiStatusResponse;
    return {
      ok: body.success === true,
      version: body.data?.version ?? null,
      latencyMs: Date.now() - started,
      raw: body.data,
    };
  }

  async getModels(signal?: AbortSignal): Promise<GatewayModel[]> {
    const res = await this.client.relay("/v1/models", { method: "GET" }, signal);
    const body = (await res.json()) as NewApiModelListResponse;
    const list = body.data ?? [];

    // 注意：/v1/models 只给出 id 与 owned_by。
    // 能力、上下文、价格必须由离火 Model Registry 提供，这里不猜测，留空。
    return list.map((m) => ({
      id: m.id,
      provider: m.owned_by ?? "unknown",
      capabilities: [],
      contextLength: null,
      streaming: true,
    }));
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const started = Date.now();
    const res = await this.client.relay(
      "/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          top_p: req.topP,
          max_tokens: req.maxTokens,
          stream: false,
        }),
      },
      signal,
    );

    const body = (await res.json()) as NewApiChatResponse;
    const content = body.choices?.[0]?.message?.content ?? "";
    const headerRequestId =
      res.headers.get("x-request-id") ??
      res.headers.get("x-oneapi-request-id") ??
      null;

    return {
      content,
      model: body.model ?? req.model,
      requestId: headerRequestId ?? body.id ?? null,
      usage: body.usage
        ? {
            promptTokens: body.usage.prompt_tokens ?? 0,
            completionTokens: body.usage.completion_tokens ?? 0,
            totalTokens: body.usage.total_tokens ?? 0,
          }
        : null,
      gatewayQuota: null,
      latencyMs: Date.now() - started,
    };
  }

  async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
    const res = await this.client.relay(
      "/v1/chat/completions",
      {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          top_p: req.topP,
          max_tokens: req.maxTokens,
          stream: true,
        }),
      },
      signal,
    );

    if (!res.body) {
      throw new GatewayError({ message: "流式响应没有 body", code: "empty_stream" });
    }

    const headerRequestId =
      res.headers.get("x-request-id") ??
      res.headers.get("x-oneapi-request-id") ??
      null;

    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;

    for await (const evt of parseSse(res.body, signal)) {
      if (evt.data === "[DONE]") {
        yield { delta: "", done: true, requestId: headerRequestId, usage };
        return;
      }
      let chunk: NewApiChatResponse;
      try {
        chunk = JSON.parse(evt.data) as NewApiChatResponse;
      } catch {
        continue; // 心跳/注释帧直接跳过
      }
      // 末包会带 usage（choices 为空），是流式计费的唯一依据
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        };
      }
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        yield { delta, done: false, requestId: headerRequestId };
      }
    }

    // 没有收到 [DONE] 就结束（上游异常断开），补一个收尾包
    yield { delta: "", done: true, requestId: headerRequestId, usage };
  }

  async getUsage(
    params: { sinceSeconds?: number; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<UsageRecord[]> {
    const limit = params.limit ?? 50;
    const res = await this.client.admin(`/api/log/?p=0&page_size=${limit}`, { method: "GET" }, signal);
    const body = (await res.json()) as NewApiLogListResponse;
    const items = Array.isArray(body.data) ? body.data : (body.data?.items ?? []);

    const since = params.sinceSeconds
      ? Math.floor(Date.now() / 1000) - params.sinceSeconds
      : 0;

    return items
      .filter((it) => (it.created_at ?? 0) >= since)
      .map((it) => ({
        requestId: it.request_id ?? null,
        model: it.model_name ?? null,
        promptTokens: it.prompt_tokens ?? 0,
        completionTokens: it.completion_tokens ?? 0,
        quota: it.quota ?? 0,
        channelId: it.channel_id ?? null,
        createdAt: it.created_at ?? 0,
      }));
  }

  async testChannel(channelId: number, signal?: AbortSignal): Promise<ChannelTestResult> {
    const started = Date.now();
    const res = await this.client.admin(`/api/channel/test/${channelId}`, { method: "GET" }, signal);
    const body = (await res.json()) as NewApiChannelTestResponse;
    return {
      channelId,
      ok: body.success === true,
      message: body.message ?? "",
      latencyMs: Date.now() - started,
    };
  }
}
