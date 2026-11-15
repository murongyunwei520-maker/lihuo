/**
 * 前端客户端 × 服务端生成代理 联调验证（完全隔离）
 * ------------------------------------------------------------
 * 把 web/src/services/api/lihuo-server.ts 用 esbuild 打包成 Node 可执行的 ESM，
 * 再对「Mock 上游 + 独立后端实例」真实发请求，验证：
 * JSON/二进制生成、响应头账单、错误归一化、幂等、按次定价读写。
 *
 * 不读 server/.env、不用真实上游 Key、不碰主库。
 * 运行：node tests/frontend-client.mjs
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SERVER_DIR = resolve(import.meta.dirname, "..");
const WEB_DIR = resolve(SERVER_DIR, "../web");
const PORT = 3201;
const UPSTREAM_PORT = 3302;
const ADMIN_PASSWORD = "FrontClient!Test2026x";
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb]);

let upstream;
let backend;
let backendLogs = "";
let tempDir;
let cookie = "";

/** Node fetch 不会自动管理 Cookie，这里模拟浏览器的 Cookie Jar */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    const res = await realFetch(url, { ...init, headers });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return res;
};

function bundleClient() {
    tempDir = mkdtempSync(join(tmpdir(), "lihuo-front-client-"));
    const out = join(tempDir, "client.mjs");
    execFileSync(
        process.execPath,
        [
            resolve(WEB_DIR, "node_modules/esbuild/bin/esbuild"),
            resolve(WEB_DIR, "src/services/api/lihuo-server.ts"),
            "--bundle",
            "--platform=node",
            "--format=esm",
            `--outfile=${out}`,
            `--define:import.meta.env=${JSON.stringify({ VITE_LIHUO_SERVER_URL: `http://127.0.0.1:${PORT}` })}`,
        ],
        { cwd: WEB_DIR, stdio: "pipe" },
    );
    return out;
}

function startUpstream() {
    return new Promise((done) => {
        upstream = createServer(async (req, res) => {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            let body = {};
            try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* ignore */ }
            res.setHeader("X-Oneapi-Request-Id", "front-mock-001");
            if (req.url === "/v1/images/generations") {
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ created: 1, data: [{ url: "https://mock.local/a.png" }], model: body.model }));
                return;
            }
            if (req.url === "/v1/audio/speech") {
                res.writeHead(200, { "content-type": "audio/mpeg" });
                res.end(MP3);
                return;
            }
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { message: "unknown mock path" } }));
        });
        upstream.listen(UPSTREAM_PORT, "127.0.0.1", () => done());
    });
}

function startBackend() {
    const env = {
        ...process.env,
        LIHUO_HOST: "127.0.0.1",
        LIHUO_PORT: String(PORT),
        LIHUO_DB_PATH: join(tempDir, "test.db"),
        NEW_API_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
        NEW_API_KEY: "sk-mock-placeholder",
        NEW_API_ADMIN_TOKEN: "",
        LIHUO_ADMIN_USERNAME: "admin",
        LIHUO_ADMIN_PASSWORD: ADMIN_PASSWORD,
        LIHUO_ALLOW_REGISTER: "false",
        LIHUO_COOKIE_SECURE: "false",
        LIHUO_CORS_ORIGINS: `http://127.0.0.1:${PORT}`,
    };
    backend = spawn(
        process.execPath,
        ["--no-warnings", "--experimental-strip-types", "--experimental-sqlite", "src/index.ts"],
        { cwd: SERVER_DIR, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    backend.stdout.on("data", (d) => { backendLogs += d.toString(); });
    backend.stderr.on("data", (d) => { backendLogs += d.toString(); });
}

async function waitReady() {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await realFetch(`http://127.0.0.1:${PORT}/health`)).ok) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`后端未启动，日志：\n${backendLogs}`);
}

const results = [];
async function check(name, fn) {
    await fn();
    results.push(name);
    console.log(`  ok  ${name}`);
}

let client;
try {
    const clientPath = bundleClient();
    await startUpstream();
    startBackend();
    await waitReady();
    client = await import(pathToFileURL(clientPath).href);

    await check("打包后的客户端能登录并拿到会话", async () => {
        const user = await client.login("admin", ADMIN_PASSWORD);
        assert.equal(user.username, "admin");
        assert.equal(user.role, "admin");
        assert.ok(cookie.startsWith("lihuo_session="));
    });

    await check("管理员注册模型并设置按次价格", async () => {
        const users = await client.adminApi.users();
        const admin = users.items.find((u) => u.username === "admin");
        assert.ok(admin);
        await client.adminApi.updateUser(admin.id, { quotaCents: 1000 });

        const img = await client.adminApi.createModel({
            modelId: "img-front", capability: "image", enabled: true,
            price: { inCentsPer1k: 1, outCentsPer1k: 1 },
        });
        assert.equal(img.modelId, "img-front");
        const tts = await client.adminApi.createModel({
            modelId: "tts-front", capability: "audio", enabled: true,
            price: { inCentsPer1k: 1, outCentsPer1k: 1 },
        });
        assert.equal(tts.modelId, "tts-front");
        const p1 = await client.adminApi.setGenerationPrice("img-front", { centsPerCall: 9 });
        assert.equal(p1.centsPerCall, 9);
        const p2 = await client.adminApi.setGenerationPrice("tts-front", { centsPerCall: 4 });
        assert.equal(p2.centsPerCall, 4);
    });

    await check("两个读价入口都返回按次价格表", async () => {
        const a = await client.getGenerationPrices();
        const b = await client.adminApi.generationPrices();
        assert.deepEqual(a.items, b.items);
        assert.ok(a.items.some((i) => i.model === "img-front" && i.centsPerCall === 9));
        assert.ok(a.items.some((i) => i.model === "tts-front" && i.centsPerCall === 4));
    });

    await check("generate() 返回上游原始 JSON + 响应头账单", async () => {
        const r = await client.generate("image-generations", {
            model: "img-front", prompt: "一只猫", size: "1024x1024", traceId: "node-1",
        });
        assert.equal(r.data.data[0].url, "https://mock.local/a.png");
        assert.equal(r.data.model, "img-front");
        assert.equal(r.billing.costCents, 9);
        assert.equal(r.billing.requestId, "front-mock-001");
        assert.equal(r.billing.model, "img-front");
        assert.ok(Number.isInteger(r.billing.balanceCents));
    });

    await check("generateBlob() 原样返回二进制 + 账单", async () => {
        const r = await client.generateBlob("audio-speech", {
            model: "tts-front", input: "你好", voice: "alloy",
        });
        assert.equal(r.blob.size, MP3.length);
        assert.ok(r.contentType.startsWith("audio/mpeg"));
        assert.deepEqual(Buffer.from(await r.blob.arrayBuffer()), MP3);
        assert.equal(r.billing.costCents, 4);
    });

    await check("后端业务错误归一化成 ServerApiError", async () => {
        await assert.rejects(
            () => client.generate("image-generations", { model: "not-registered", prompt: "hi" }),
            (e) => e instanceof client.ServerApiError && e.code === "model_not_registered" && e.status === 400,
        );
    });

    await check("二进制端点误用 generate() 得到明确提示", async () => {
        await assert.rejects(
            () => client.generate("audio-speech", { model: "tts-front", input: "hi", voice: "alloy" }),
            (e) => e instanceof client.ServerApiError && e.code === "invalid_response",
        );
    });

    await check("Idempotency-Key 重放返回 409 且不重复扣费", async () => {
        const opts = { idempotencyKey: "front-once-001" };
        const first = await client.generate("image-generations", { model: "img-front", prompt: "hi" }, opts);
        assert.equal(first.billing.costCents, 9);
        await assert.rejects(
            () => client.generate("image-generations", { model: "img-front", prompt: "hi" }, opts),
            (e) => e instanceof client.ServerApiError && e.code === "idempotent_replay" && e.status === 409,
        );
    });

    await check("停用按次价后生成被拒绝，恢复后可用", async () => {
        await client.adminApi.setGenerationPrice("img-front", { centsPerCall: 9, enabled: false });
        await assert.rejects(
            () => client.generate("image-generations", { model: "img-front", prompt: "hi" }),
            (e) => e instanceof client.ServerApiError && e.code === "model_not_priced",
        );
        await client.adminApi.setGenerationPrice("img-front", { centsPerCall: 9, enabled: true });
        const r = await client.generate("image-generations", { model: "img-front", prompt: "hi" });
        assert.equal(r.billing.costCents, 9);
    });

    console.log(`\nPASS ${results.length}/${results.length}`);
} catch (e) {
    console.error("\nFAILED:", e?.stack ?? e);
    console.error("\n--- backend logs ---\n" + backendLogs);
    process.exitCode = 1;
} finally {
    if (backend && !backend.killed) backend.kill("SIGTERM");
    if (upstream) upstream.close();
    await new Promise((r) => setTimeout(r, 300));
    if (tempDir) {
        try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}
