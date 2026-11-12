/**
 * SSE 解析
 * ------------------------------------------------------------
 * 关键点：
 * 1. 按 \n\n 分帧，不能按行直接切（一帧可能跨 chunk）
 * 2. `data: [DONE]` 是结束标记，不是 JSON
 * 3. 上游被取消时要能感知 signal，避免"幽灵扣费"
 */

export interface SseEvent {
  data: string;
}

/** 把字节流切成 SSE 事件 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 兼容 \n\n 与 \r\n\r\n
      let idx: number;
      while ((idx = findFrameEnd(buffer)) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^(\r?\n){2}/, "");

        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload) yield { data: payload };
        }
      }
    }
  } finally {
    // 提前 break 时必须 cancel，否则上游继续生成并扣费
    try {
      await reader.cancel();
    } catch {
      /* 已关闭时忽略 */
    }
    reader.releaseLock();
  }
}

function findFrameEnd(s: string): number {
  const a = s.indexOf("\n\n");
  const b = s.indexOf("\r\n\r\n");
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}
