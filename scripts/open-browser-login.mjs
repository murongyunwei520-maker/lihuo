/**
 * 用系统浏览器（Edge）打开离火并完成登录。
 * - 独立 user-data-dir：不影响用户已开的窗口
 * - 会话 Cookie 由后端真实登录获得，再通过 CDP 写进浏览器
 * - 结束后保留窗口，供用户直接操作
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = join(process.env.LOCALAPPDATA || process.env.TEMP || ".", "lihuo-browser-profile");
const PORT = 9333;
const APP = "http://127.0.0.1:3000";
const API = "http://127.0.0.1:3100";
const USER = process.env.LIHUO_USER || "admin";
const PASS = process.env.LIHUO_PASS || "Lihuo-Docker-2026";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}: ${await res.text()}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  const pair = raw.map((c) => c.split(";")[0]).find((c) => c.startsWith("lihuo_session="));
  if (!pair) throw new Error("没有拿到会话 Cookie");
  const value = pair.slice("lihuo_session=".length);
  const body = await res.json();
  return { value, user: body.data };
}

async function main() {
  const { value, user } = await login();
  console.log(`[1] 登录成功：${user.username}（${user.role}），余额 ${user.quotaCents} 分`);

  // 通过系统 shell 的 start 启动：进程归属资源管理器，不会随本脚本退出被回收
  const launch =
    `start "" "${EDGE}" --remote-debugging-port=${PORT} --user-data-dir="${PROFILE}" ` +
    `--no-first-run --no-default-browser-check "${APP}/login"`;
  spawn("cmd.exe", ["/c", launch], { detached: true, stdio: "ignore", windowsVerbatimArguments: true }).unref();
  console.log(`[2] 已启动浏览器（profile: ${PROFILE}）`);

  let target = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.url.startsWith(APP)) || list.find((t) => t.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {
      /* 浏览器还没起来 */
    }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error("没连上浏览器调试端口");
  console.log(`[3] 已连接页面：${target.url}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  await send("Network.enable");
  await send("Page.enable");
  await send("Network.setCookie", {
    name: "lihuo_session",
    value,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  });
  console.log("[4] 已写入会话 Cookie");

  await send("Page.navigate", { url: `${APP}/canvas` });
  await sleep(3500);

  const check = await send("Runtime.evaluate", {
    expression: `(async () => {
      const me = await fetch("${API}/api/me", { credentials: "include" }).then(r => r.json()).catch(e => ({ error: String(e) }));
      return JSON.stringify({ path: location.pathname, me: me?.data?.username || null, code: me?.error?.code || null });
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log("[5] 页面状态：", check.result.value);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = join(process.cwd(), "lihuo-logged-in.png");
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log(`[6] 截图：${file}`);

  ws.close();
  console.log("[7] 浏览器保持打开，可直接操作");

  // 保持本进程存活：浏览器作为其子进程时，进程退出会连窗口一起被回收
  if (process.argv.includes("--keep")) {
    console.log("[8] 常驻模式：窗口会保持到你主动关闭（或停止该后台任务）");
    setInterval(() => {}, 1 << 30);
  }
}

main().catch((err) => {
  console.error("失败：", err.message);
  process.exit(1);
});
