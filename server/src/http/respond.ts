import type { IncomingMessage, ServerResponse } from "node:http";

/** 统一响应体：成功 { ok:true, data }，失败 { ok:false, error:{ code, message } } */
export interface ApiError {
  code: string;
  message: string;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(buf);
}

export function ok(res: ServerResponse, data: unknown, status = 200): void {
  sendJson(res, status, { ok: true, data });
}

export function fail(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

/** 读取 JSON 请求体，带大小上限，防止内存打爆 */
export async function readJson(req: IncomingMessage, limitBytes = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) {
      throw Object.assign(new Error("请求体过大"), { code: "payload_too_large", status: 413 });
    }
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("请求体不是合法 JSON"), { code: "invalid_json", status: 400 });
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function clientIp(req: IncomingMessage): string {
  // 生产环境经反代时，应由可信代理覆盖该头；此处仅取第一跳
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return req.socket.remoteAddress ?? "";
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
