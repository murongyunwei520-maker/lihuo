/**
 * 生成代理端到端验证（完全隔离）
 * ------------------------------------------------------------
 * 不读 server/.env、不碰真实上游 Key、不碰主库：
 * 自己起 Mock 上游 + 独立后端实例（独立端口、系统临时目录里的 SQLite）。
 *
 * 运行：node tests/generate-proxy.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SERVER_DIR = resolve(import.meta.dirname, "..");
const PORT = 3199;
const UPSTREAM_PORT = 3301;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "GenProxy!Test2026x";
const TEST_KEY = "sk-mock-placeholder";
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb]);

const seen = [];
let upstream;
let server;
let serverLogs = "";
let tempDir;

function startUpstream() {
  return new Promise((done) => {
    upstream = createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
      seen.push({ path: req.url, auth: req.headers.authorization, body });

      res.setHeader("X-Oneapi-Request-Id", "mock-req-001");
      if (req.url === "/v1/images/generations") {
        if (body.model === "img-fail") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "mock upstream failure", code: "mock_failure" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ created: 1760000000, data: [{ url: "https://mock.local/image.png" }], model: body.model }));
        return;
      }
      if (req.url === "/v1/audio/speech") {
        res.writeHead(200, { "content-type": "audio/mpeg" });
        res.end(MP3);
        return;
      }
      if (req.url === "/v1/embeddings") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unknown mock path" } }));
    });
    upstream.listen(UPSTREAM_PORT, "127.0.0.1", () => done());
  });
}

function startBackend() {
  tempDir = mkdtempSync(join(tmpdir(), "lihuo-gen-proxy-"));
  const env = {
    ...process.env,
    LIHUO_HOST: "127.0.0.1",
    LIHUO_PORT: String(PORT),
    LIHUO_DB_PATH: join(tempDir, "test.db"),
    NEW_API_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
    NEW_API_KEY: TEST_KEY,
    NEW_API_ADMIN_TOKEN: "",
    LIHUO_ADMIN_USERNAME: "admin",
    LIHUO_ADMIN_PASSWORD: ADMIN_PASSWORD,
    LIHUO_ALLOW_REGISTER: "false",
    LIHUO_SESSION_TTL_HOURS: "1",
    LIHUO_COOKIE_SECURE: "false",
    LIHUO_CORS_ORIGINS: `http://127.0.0.1:${PORT}`,
  };
  server = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", "--experimental-sqlite", "src/index.ts"],
    { cwd: SERVER_DIR, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (d) => { serverLogs += d.toString(); });
  server.stderr.on("data", (d) => { serverLogs += d.toString(); });
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`后端未启动，日志：\n${serverLogs}`);
}

async function api(path, opts = {}) {
  const headers = { ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* binary */ }
  return { status: res.status, headers: res.headers, buf, json };
}

const results = [];
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log(`  ok  ${name}`);
}

async function main() {
  await startUpstream();
  startBackend();
  await waitReady();

  const login = await api("/api/auth/login", { method: "POST", body: { username: "admin", password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, `登录失败：${JSON.stringify(login.json)}`);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const users = await api("/api/admin/users", { cookie });
  const adminId = users.json.data.items.find((u) => u.username === "admin").id;
  await api(`/api/admin/users/${adminId}`, { method: "PATCH", body: { quotaCents: 1000 }, cookie });

  const mkModel = async (modelId, capability, enabled = true, withPrice = true) => {
    const r = await api("/api/admin/models", {
      method: "POST",
      cookie,
      body: {
        modelId,
        capability,
        enabled,
        ...(withPrice ? { price: { inCentsPer1k: 1, outCentsPer1k: 1 } } : {}),
      },
    });
    assert.equal(r.status, 201, `创建模型 ${modelId} 失败：${JSON.stringify(r.json)}`);
  };
  const mkPerCall = async (modelId, cents) => {
    const r = await api(`/api/admin/generation-prices/${modelId}`, { method: "PUT", cookie, body: { centsPerCall: cents } });
    assert.equal(r.status, 200, `设置按次价失败：${JSON.stringify(r.json)}`);
  };

  await mkModel("img-test", "image");
  await mkPerCall("img-test", 7);
  await mkModel("img-disabled", "image", false, false);
  await mkModel("text-test", "text");
  await mkModel("img-noprice", "image");
  await mkModel("img-fail", "image");
  await mkPerCall("img-fail", 7);
  await mkModel("tts-test", "audio");
  await mkPerCall("tts-test", 3);

  const gen = (endpoint, body, extra = {}) =>
    api(`/api/generate/${endpoint}`, { method: "POST", cookie, body, ...extra });

  await check("健康检查与登录会话可用", async () => {
    const h = await api("/health");
    assert.equal(h.status, 200);
    assert.equal(h.json.data.status, "ok");
  });

  await check("未登录调用生成接口 → 401", async () => {
    const r = await api("/api/generate/image-generations", { method: "POST", body: { model: "img-test", prompt: "hi" } });
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, "unauthenticated");
  });

  await check("非白名单端点 → 404，且不会打到上游", async () => {
    const before = seen.length;
    const r = await gen("evil-endpoint", { model: "img-test", prompt: "hi" });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "unknown_endpoint");
    assert.equal(seen.length, before);
  });

  await check("未注册模型 → 400", async () => {
    const r = await gen("image-generations", { model: "not-registered", prompt: "hi" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "model_not_registered");
  });

  await check("已下架模型 → 403", async () => {
    const r = await gen("image-generations", { model: "img-disabled", prompt: "hi" });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, "model_disabled");
  });

  await check("能力与端点不匹配 → 400", async () => {
    const r = await gen("image-generations", { model: "text-test", prompt: "hi" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "capability_mismatch");
  });

  await check("未配置按次价格 → 400", async () => {
    const r = await gen("image-generations", { model: "img-noprice", prompt: "hi" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "model_not_priced");
  });

  await check("参数不在模型白名单 → 400", async () => {
    const r = await gen("image-generations", { model: "img-test", prompt: "hi", temperature: 0.5 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "unsupported_parameter");
  });

  await check("缺少端点必填字段 → 400", async () => {
    const r = await gen("image-generations", { model: "img-test" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "missing_field");
  });

  let balanceAfterSuccess;
  await check("成功生成：原样透传响应体 + 账单响应头 + 按次扣费", async () => {
    const before = (await api("/api/usage", { cookie })).json.data.balanceCents;
    const r = await gen("image-generations", { model: "img-test", prompt: "一只猫", size: "1024x1024", traceId: "canvas-node-42" });
    assert.equal(r.status, 200);
    assert.equal(r.json.data[0].url, "https://mock.local/image.png");
    assert.equal(r.json.model, "img-test");
    assert.equal(r.headers.get("x-lihuo-cost-cents"), "7");
    assert.equal(r.headers.get("x-lihuo-request-id"), "mock-req-001");
    assert.equal(r.headers.get("x-lihuo-model"), "img-test");
    balanceAfterSuccess = Number(r.headers.get("x-lihuo-balance-cents"));
    assert.equal(balanceAfterSuccess, before - 7);
  });

  await check("服务端持有令牌：前端请求体不带 Key，上游收到 Bearer", async () => {
    const hit = seen.find((s) => s.path === "/v1/images/generations" && s.body.model === "img-test");
    assert.ok(hit, "Mock 上游未收到请求");
    assert.equal(hit.auth, `Bearer ${TEST_KEY}`);
    assert.ok(!("apiKey" in hit.body));
    assert.ok(!("traceId" in hit.body), "离火侧字段不应透传上游");
    assert.equal(hit.body.size, "1024x1024");
  });

  await check("上游失败 → 透传 5xx 且全额退款", async () => {
    const before = (await api("/api/usage", { cookie })).json.data.balanceCents;
    const r = await gen("image-generations", { model: "img-fail", prompt: "hi" });
    assert.ok(r.status >= 500 && r.status < 600, `应透传上游失败状态，实际 ${r.status}`);
    assert.equal(r.json.error.code, "mock_failure");
    const after = (await api("/api/usage", { cookie })).json.data.balanceCents;
    assert.equal(after, before, "失败不应扣费");
  });

  await check("同一幂等键重放 → 409，不重复扣费", async () => {
    const headers = { "Idempotency-Key": "gen-once-001" };
    const before = (await api("/api/usage", { cookie })).json.data.balanceCents;
    const r1 = await gen("image-generations", { model: "img-test", prompt: "hi" }, { headers });
    assert.equal(r1.status, 200);
    const r2 = await gen("image-generations", { model: "img-test", prompt: "hi" }, { headers });
    assert.equal(r2.status, 409);
    assert.equal(r2.json.error.code, "idempotent_replay");
    const after = (await api("/api/usage", { cookie })).json.data.balanceCents;
    assert.equal(after, before - 7, "只应扣一次");
  });

  await check("二进制响应原样透传（audio/mpeg）", async () => {
    const r = await gen("audio-speech", { model: "tts-test", input: "你好", voice: "alloy" });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("content-type").startsWith("audio/mpeg"));
    assert.deepEqual(r.buf, MP3);
    assert.equal(r.headers.get("x-lihuo-cost-cents"), "3");
  });

  await check("归因：网关 request id 进入用量流水", async () => {
    const usage = await api("/api/admin/usage", { cookie });
    const hits = usage.json.data.items.filter((i) => i.gatewayRequestId === "mock-req-001" && i.status === "settled");
    assert.ok(hits.length >= 2, "用量流水里找不到已结算的网关 request id");
    assert.ok(hits.some((i) => i.costCents === 7), "图片按次价 7 分未入账");
    assert.ok(hits.some((i) => i.costCents === 3), "语音按次价 3 分未入账");
  });

  await check("CORS 预检放行 Idempotency-Key 并暴露账单头", async () => {
    const r = await fetch(`${BASE}/api/generate/image-generations`, {
      method: "OPTIONS",
      headers: {
        Origin: `http://127.0.0.1:${PORT}`,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, idempotency-key",
      },
    });
    assert.equal(r.status, 204);
    assert.ok(r.headers.get("access-control-allow-headers").includes("Idempotency-Key"));
    assert.ok(r.headers.get("access-control-expose-headers").includes("X-Lihuo-Cost-Cents"));
  });

  await check("普通用户可调用生成，但拿不到管理端改价", async () => {
    const created = await api("/api/admin/users", {
      method: "POST", cookie,
      body: { username: "genuser", password: "GenUser!Test2026x", quotaCents: 100 },
    });
    assert.equal(created.status, 201);
    const lg = await api("/api/auth/login", { method: "POST", body: { username: "genuser", password: "GenUser!Test2026x" } });
    const userCookie = lg.headers.get("set-cookie").split(";")[0];
    const okGen = await api("/api/generate/image-generations", {
      method: "POST", cookie: userCookie, body: { model: "img-test", prompt: "hi" },
    });
    assert.equal(okGen.status, 200);
    const denied = await api("/api/admin/generation-prices/img-test", {
      method: "PUT", cookie: userCookie, body: { centsPerCall: 1 },
    });
    assert.equal(denied.status, 403);
  });

  console.log(`\nPASS ${results.length}/${results.length}`);
}

try {
  await main();
} catch (e) {
  console.error("\nFAILED:", e?.stack ?? e);
  console.error("\n--- backend logs ---\n" + serverLogs);
  process.exitCode = 1;
} finally {
  if (server && !server.killed) server.kill("SIGTERM");
  if (upstream) upstream.close();
  // Windows 上后端可能还握着 SQLite 文件句柄，删不掉就留着临时目录，不影响结论
  await new Promise((r) => setTimeout(r, 300));
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
