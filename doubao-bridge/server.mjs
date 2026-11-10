// 豆包账号池 + 视频生成桥接服务。
// 作用：把 ops120/doubao-brain 的 CLI（dbb）包装成本地 HTTP 服务，供离火前端调用。
// 账号隔离：每个账号独立的 DBB_STATE_DIR（浏览器 profile / 登录态 / 下载目录互不干扰）。
// 真实优先：所有能力、登录态、产物都来自 dbb 的真实执行结果，读不到就如实返回 unknown。
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const CLI = process.env.DBB_CLI || path.join(REPO, "vendor", "doubao-brain", "dbb", "cli.mjs");
const ACCOUNTS_ROOT = process.env.DOUBAO_ACCOUNTS_DIR || path.join(REPO, ".doubao-accounts");
const PORT = Number(process.env.DOUBAO_BRIDGE_PORT || 9091);
const HOST = process.env.DOUBAO_BRIDGE_HOST || "127.0.0.1";

const VIDEO_CAPABILITY = "视频生成";
const ASK_TIMEOUT_MS = 900000;
const LOGIN_TIMEOUT_MS = 600000;
// 生成任务默认**有头**运行：你能亲眼看到豆包页面在做什么（也便于出错时排查）。
// 需要静默时可设 DOUBAO_ASK_HEADLESS=1。
const ASK_HEADLESS = process.env.DOUBAO_ASK_HEADLESS === "1";
// 生成结束后保留浏览器窗口，方便查看结果；设 DOUBAO_KEEP_OPEN=0 可关闭该行为。
const KEEP_BROWSER_OPEN = process.env.DOUBAO_KEEP_OPEN !== "0";
const ACCOUNTS_FILE = path.join(ACCOUNTS_ROOT, "accounts.json");
// dbb 每个状态目录都要自己的 playwright-core；预装一份模板，新账号直接复制，免去 npm 安装。
const DEPS_TEMPLATE = path.join(REPO, "vendor", "doubao-brain", "deps-template");
const LOGIN_QR_SCRIPT = path.join(HERE, "qr-helper.py");
const WINDOW_LOGIN_SCRIPT = path.join(HERE, "window-login.mjs");
const RUNNER_SCRIPT = path.join(HERE, "run-doubao.mjs");
const INJECT_SCRIPT = path.join(HERE, "inject-cookies.mjs");
const PYTHON_BIN = process.env.DOUBAO_PYTHON || path.join(REPO, ".doubao-venv", "Scripts", "python.exe");
// 真正的豆包登录 cookie。注意 ttwid / passport_csrf_token 匿名访问就有，不能当登录标志。
const SESSION_COOKIE_RE = /^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|sid_ucp_v1)$/;
const qrProcesses = new Map(); // accountId -> child
const windowProcesses = new Map(); // accountId -> child
const viewerProcesses = new Map(); // accountId -> { child, port }
const runnerProcesses = new Map(); // accountId -> child（生成器进程；结束后浏览器仍开着，需要能收掉）
const VIEWER_SCRIPT = path.join(HERE, "open-account.mjs");

/** 杀掉占用该账号 profile 的所有 Edge 进程（上一个任务遗留的窗口会锁住 profile）。 */
async function killProfileBrowsers(accountId) {
    const p = accountPaths(accountId);
    const profile = path.join(p.state, "profile");
    const pattern = profile.replace(/'/g, "''");
    await new Promise((resolve) => {
        const child = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${pattern}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
            ],
            { windowsHide: true, stdio: "ignore" },
        );
        child.on("exit", resolve);
        child.on("error", resolve);
        setTimeout(resolve, 8000);
    });
}

/** 释放 profile：收掉查看器、上一个生成器、以及所有占用该 profile 的 Edge。 */
async function releaseProfile(accountId) {
    const viewer = viewerProcesses.get(accountId);
    if (viewer) {
        try {
            if (viewer.child && !viewer.child.killed) viewer.child.kill();
            else if (pidAlive(viewer.pid)) process.kill(Number(viewer.pid));
        } catch {
            /* 忽略 */
        }
        viewerProcesses.delete(accountId);
    }
    const runner = runnerProcesses.get(accountId);
    if (runner && !runner.killed) {
        try {
            runner.kill();
        } catch {
            /* 忽略 */
        }
        runnerProcesses.delete(accountId);
    }
    await killProfileBrowsers(accountId);
    // 等端口/文件锁真正释放
    for (let i = 0; i < 10; i += 1) {
        const busy = await new Promise((resolve) => {
            const probe = spawn(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${accountPaths(accountId).state.replace(/'/g, "''")}*' }).Count`],
                { windowsHide: true },
            );
            let out = "";
            probe.stdout.on("data", (chunk) => {
                out += chunk.toString("utf8");
            });
            probe.on("exit", () => resolve(Number(out.trim()) || 0));
            probe.on("error", () => resolve(0));
            setTimeout(() => resolve(0), 5000);
        });
        if (!busy) return true;
        await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return false;
}

/** viewer 的调试端口是否可连（说明那个唯一窗口还活着）。 */
async function viewerAlive(accountId) {
    try {
        await fetch(`http://127.0.0.1:${viewerPort(accountId)}/json/version`, { signal: AbortSignal.timeout(1200) });
        return true;
    } catch {
        return false;
    }
}

/** 严格一个号一个窗口：没开就打开它，然后等调试端口就绪，供 runner 通过 CDP 复用。 */
async function ensureViewer(account) {
    await prepareRunnerLaunch(account.id);
    if (!(await viewerAlive(account.id))) await openViewer(account);
    for (let i = 0; i < 40; i += 1) {
        if (await viewerAlive(account.id)) return true;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
}

/** 启动生成器前的准备：只保证 viewer 窗口存在，绝不动正在跑的其他生成器（同账号可并发）。 */
async function prepareRunnerLaunch(accountId) {
    // viewer 活着就直接复用（runner 会 connectOverCDP），不要杀它
    const port = viewerPort(accountId);
    try {
        await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) });
        return; // 窗口还活着
    } catch {
        // viewer 没开：只有没有正在跑的任务时才清 profile
    }
    if ((activeJobs.get(accountId) || 0) > 0) return;
    await releaseProfile(accountId);
}

/** 每个账号一个固定调试端口，用于把已开的窗口前置。 */
function viewerPort(accountId) {
    let hash = 0;
    for (const char of accountId) hash = (hash * 31 + char.charCodeAt(0)) % 80;
    return 9400 + hash;
}

function readViewerStatus(accountId) {
    const p = accountPaths(accountId);
    const file = path.join(p.state, "viewer", "status.json");
    if (!fs.existsSync(file)) return { state: "idle" };
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return { state: "unknown" };
    }
}

/** 通过 CDP 把已开的豆包窗口提到前台（不新开窗口）。 */
async function focusViewer(accountId) {
    const port = viewerPort(accountId);
    try {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
        const page = (targets || []).find((item) => item.type === "page");
        if (!page?.webSocketDebuggerUrl) return false;
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.addEventListener("open", resolve, { once: true });
            ws.addEventListener("error", reject, { once: true });
            setTimeout(() => reject(new Error("timeout")), 3000);
        });
        let messageId = 0;
        const call = (method, params = {}) =>
            new Promise((resolve) => {
                const mid = ++messageId;
                const onMessage = (event) => {
                    const data = JSON.parse(String(event.data));
                    if (data.id === mid) {
                        ws.removeEventListener("message", onMessage);
                        resolve(data.result ?? null);
                    }
                };
                ws.addEventListener("message", onMessage);
                ws.send(JSON.stringify({ id: mid, method, params }));
                setTimeout(() => {
                    ws.removeEventListener("message", onMessage);
                    resolve(null);
                }, 1500);
            });
        const win = await call("Browser.getWindowForTarget");
        if (win?.windowId) {
            const bounds = await call("Browser.getWindowBounds", { windowId: win.windowId });
            // 最小化或跑到屏幕外时，先还原到屏幕内，否则用户看不到窗口
            const state = bounds?.bounds?.windowState;
            const left = bounds?.bounds?.left ?? 0;
            const top = bounds?.bounds?.top ?? 0;
            if (state !== "normal" || left < -200 || top < -200) {
                await call("Browser.setWindowBounds", { windowId: win.windowId, bounds: { windowState: "normal", left: 60, top: 40, width: 1400, height: 900 } });
            }
        }
        await call("Page.bringToFront");
        ws.close();
        return true;
    } catch {
        return false;
    }
}

/** 进程是否还活着（用于认领桥接重启前已打开的窗口）。 */
function pidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(Number(pid), 0);
        return true;
    } catch {
        return false;
    }
}

/** 打开（或前置）该账号唯一的豆包窗口。 */
async function openViewer(account) {
    const existing = viewerProcesses.get(account.id);
    if (existing && ((existing.child && !existing.child.killed) || pidAlive(existing.pid))) {
        const focused = await focusViewer(account.id);
        return { reused: true, focused, port: existing.port };
    }
    // 桥接重启过：只要该账号的调试端口还能连上，就说明窗口还活着。
    // 直接前置它，绝不再开第二个（第二个会因为 profile 被锁而启动失败）。
    if (await focusViewer(account.id)) {
        const disk = readViewerStatus(account.id);
        viewerProcesses.set(account.id, { child: null, pid: disk.pid, port: viewerPort(account.id) });
        return { reused: true, focused: true, port: viewerPort(account.id) };
    }
    const p = ensureAccountDirs(account.id);
    ensureDeps(account.id);
    // 上一个任务留下的浏览器可能还占着 profile，先释放，否则新窗口起不来
    await releaseProfile(account.id);
    const port = viewerPort(account.id);
    fs.mkdirSync(path.join(p.state, "viewer"), { recursive: true });
    fs.writeFileSync(path.join(p.state, "viewer", "status.json"), JSON.stringify({ state: "starting", updatedAt: new Date().toISOString() }));
    const child = spawn(process.execPath, [VIEWER_SCRIPT, p.state, account.id, String(port)], {
        cwd: p.work,
        env: { ...process.env, DBB_STATE_DIR: p.state },
        windowsHide: false,
    });
    viewerProcesses.set(account.id, { child, pid: child.pid, port });
    child.on("exit", () => viewerProcesses.delete(account.id));
    return { reused: false, port };
}

/** 关闭查看器，给生成任务腾出 profile。 */
async function closeViewer(accountId) {
    const entry = viewerProcesses.get(accountId);
    const p = accountPaths(accountId);
    const statusFile = path.join(p.state, "viewer", "status.json");
    if (entry) {
        try {
            if (fs.existsSync(statusFile)) {
                const status = JSON.parse(fs.readFileSync(statusFile, "utf8"));
                fs.writeFileSync(statusFile, JSON.stringify({ ...status, state: "closing" }));
            }
            if (entry.child && !entry.child.killed) entry.child.kill();
            else if (pidAlive(entry.pid)) process.kill(Number(entry.pid));
        } catch {
            /* 忽略 */
        }
        viewerProcesses.delete(accountId);
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
}

/* --------------------------------- 基础工具 --------------------------------- */

fs.mkdirSync(ACCOUNTS_ROOT, { recursive: true });

function readAccounts() {
    try {
        const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
        return Array.isArray(data.accounts) ? data.accounts : [];
    } catch {
        return [];
    }
}

function writeAccounts(accounts) {
    const tmp = `${ACCOUNTS_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ accounts }, null, 2));
    fs.renameSync(tmp, ACCOUNTS_FILE);
}

function accountPaths(id) {
    const base = path.join(ACCOUNTS_ROOT, id);
    return { base, state: path.join(base, "state"), work: path.join(base, "work"), uploads: path.join(base, "uploads") };
}

function ensureAccountDirs(id) {
    const p = accountPaths(id);
    for (const dir of [p.base, p.state, p.work, p.uploads]) fs.mkdirSync(dir, { recursive: true });
    return p;
}

function newId() {
    return `db-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function send(res, status, body) {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, {
        "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type",
        "cache-control": "no-store",
    });
    res.end(payload);
}

function readBody(req, limit = 512 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error("payload too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

async function readJsonBody(req) {
    const buffer = await readBody(req, 8 * 1024 * 1024);
    if (!buffer.length) return {};
    return JSON.parse(buffer.toString("utf8"));
}

/* -------------------------------- dbb 进程封装 ------------------------------- */

const runningByAccount = new Map(); // accountId -> 当前并发任务数
const activeJobs = new Map(); // accountId -> 正在跑的任务数（用于并发上限判断）
const MAX_JOBS_PER_ACCOUNT = 1; // P0: 同账号串行，先保证稳定，后续再恢复并发
let roundRobinCursor = 0; // 轮询分配的当前位置

// P0-1: 账号级互斥锁，确保同账号任务串行执行
const accountLocks = new Map(); // accountId -> Promise（锁持有者）
async function acquireAccountLock(accountId) {
    while (accountLocks.has(accountId)) {
        await accountLocks.get(accountId);
    }
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    accountLocks.set(accountId, promise);
    return () => {
        accountLocks.delete(accountId);
        release();
    };
}

/** 账号调度：manual / auto。 */
function pickAccountByMode(mode, preferredAccountId) {
    const all = readAccounts();

    // manual 模式：必须用户明确选了账号
    if (mode === "manual") {
        if (!preferredAccountId) {
            return { ok: false, reason: "ACCOUNT_REQUIRED", message: "手动模式必须选择账号" };
        }
        const account = all.find((a) => a.id === preferredAccountId);
        if (!account) {
            return { ok: false, reason: "ACCOUNT_NOT_FOUND", message: `账号不存在: ${preferredAccountId}` };
        }
        const rt = runtimeOf(account.id);
        const loggedIn = rt.lastDoctor ? Boolean(rt.lastDoctor.loggedIn) : checkLoginStrict(account.id);
        if (!loggedIn) {
            return { ok: false, reason: "ACCOUNT_NOT_LOGGED_IN", message: `账号 ${account.name} 未登录` };
        }
        return { ok: true, account, reason: "MANUAL_SELECTED" };
    }

    // auto 模式：自动选账号。额度 unknown 的账号不选。
    if (mode === "auto") {
        // 先筛选：存在 + 已登录
        const candidates = all.filter((a) => {
            const rt = runtimeOf(a.id);
            const loggedIn = rt.lastDoctor ? Boolean(rt.lastDoctor.loggedIn) : checkLoginStrict(a.id);
            return loggedIn;
        });
        if (!candidates.length) {
            return { ok: false, reason: "NO_LOGGED_IN_ACCOUNT", message: "没有已登录的账号" };
        }
        // 额度 unknown 的账号不选（因为现在没有真实额度读取能力）
        // TODO: 等有真实额度查询后，从这里筛选额度 sufficient 的账号
        const quotaOk = candidates.filter((a) => {
            const rt = runtimeOf(a.id);
            const quotaStatus = rt.quotaStatus || "unknown"; // 默认 unknown
            return quotaStatus === "sufficient";
        });
        if (!quotaOk.length) {
            return { ok: false, reason: "ACCOUNT_QUOTA_UNKNOWN", message: "所有账号额度未知，自动分配无法执行，请切换手动模式" };
        }
        // 选第一个额度充足的（后续可以加轮询/最少使用策略）
        return { ok: true, account: quotaOk[0], reason: "AUTO_SELECTED" };
    }

    return { ok: false, reason: "INVALID_ACCOUNT_SELECTION_MODE", message: `不支持的模式: ${mode}` };
}

/** 给账号状态目录补 dbb 依赖（playwright-core）；模板不存在时交给 dbb 自己报错。 */
function ensureDeps(accountId) {
    const p = ensureAccountDirs(accountId);
    const entry = path.join(p.state, "deps", "node_modules", "playwright-core", "index.js");
    if (fs.existsSync(entry)) return;
    const templateModules = path.join(DEPS_TEMPLATE, "node_modules");
    if (!fs.existsSync(path.join(templateModules, "playwright-core"))) return;
    fs.mkdirSync(path.join(p.state, "deps"), { recursive: true });
    fs.cpSync(templateModules, path.join(p.state, "deps", "node_modules"), { recursive: true });
}

function dbbEnv(accountId) {
    const p = ensureAccountDirs(accountId);
    ensureDeps(accountId);
    return { ...process.env, DBB_STATE_DIR: p.state };
}

/**
 * 运行一次 dbb 命令，收集 stdout / stderr。
 * 返回 { code, stdout, stderr, json }；json 为 stdout 解析结果（可能为 null）。
 */
function runDbb(accountId, args, options = {}) {
    const p = ensureAccountDirs(accountId);
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], {
            cwd: options.cwd || p.work,
            env: dbbEnv(accountId),
            windowsHide: false,
        });
        let stdout = "";
        let stderr = "";
        const onLine = options.onStderr;
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            stderr += text;
            if (stderr.length > 200000) stderr = stderr.slice(-200000);
            if (onLine) text.split(/\r?\n/).filter(Boolean).forEach((line) => onLine(line));
        });
        const timer = setTimeout(() => {
            try {
                child.kill();
            } catch {
                /* ignore */
            }
        }, options.timeoutMs || ASK_TIMEOUT_MS);
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, json: null, timedOut: false });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            let json = null;
            const trimmed = stdout.trim();
            if (trimmed) {
                try {
                    json = JSON.parse(trimmed);
                } catch {
                    // dbb 在 --json 下偶尔会在 JSON 前后带提示行，抓最外层对象
                    const start = trimmed.indexOf("{");
                    const end = trimmed.lastIndexOf("}");
                    if (start >= 0 && end > start) {
                        try {
                            json = JSON.parse(trimmed.slice(start, end + 1));
                        } catch {
                            json = null;
                        }
                    }
                }
            }
            resolve({ code, stdout, stderr, json, timedOut: code === null });
        });
    });
}

function tail(text, lines = 20) {
    return String(text || "")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-lines);
}

/** 从豆包的「参数确认」原文里解析实际采用的参数；解析不到就返回 null，不猜。 */
function parseActualParams(lines) {
    const text = (lines || []).join("\n");
    const pick = (re) => {
        const hit = text.match(re);
        return hit ? hit[1].trim() : null;
    };
    const model = pick(/模型[：:]\s*([^\n，,。]+)/);
    const ratio = pick(/比例[：:]\s*([^\n，,。]+)/);
    const duration = pick(/时长[：:]\s*(\d+)\s*秒/);
    const resolution = pick(/分辨率[：:]\s*([^\n，,。]+)/);
    if (!model && !ratio && !duration && !resolution) return null;
    return { model, ratio, duration: duration ? Number(duration) : null, resolution, source: "豆包参数确认原文" };
}

/* --------------------------------- 账号状态 --------------------------------- */

const accountRuntime = new Map(); // accountId -> { busy, loginRunning, lastDoctor, lastError }

function runtimeOf(id) {
    if (!accountRuntime.has(id)) accountRuntime.set(id, { busy: false, loginRunning: false, lastDoctor: null, lastError: null });
    return accountRuntime.get(id);
}

function publicAccount(account) {
    const rt = runtimeOf(account.id);
    // 桥接重启后没有内存态：直接读磁盘上的会话 cookie 判断，不用开浏览器，也不显示「未知」
    const strict = rt.lastDoctor ? Boolean(rt.lastDoctor.loggedIn) : checkLoginStrict(account.id);
    return {
        id: account.id,
        name: account.name,
        createdAt: account.createdAt,
        lastLoginAt: account.lastLoginAt || null,
        state: {
            busy: Boolean(rt.busy),
            loginRunning: Boolean(rt.loginRunning),
            loggedIn: strict,
            checkedAt: rt.lastDoctor?.checkedAt || null,
            models: rt.lastDoctor?.models || null,
            capabilities: rt.lastDoctor?.capabilities || null,
            error: rt.lastError,
        },
    };
}

function findAccount(id) {
    return readAccounts().find((a) => a.id === id) || null;
}

/** 用 doctor --deep 读取真实登录态；读不到就保持 unknown。 */
async function refreshDoctor(accountId) {
    const res = await runDbb(accountId, ["doctor", "--deep", "--json"], { timeoutMs: 120000 });
    const rt = runtimeOf(accountId);
    // dbb 的 login 检查把 ttwid / passport_csrf_token 也算登录，会误报；以我们自己的严格判定为准。
    const strict = checkLoginStrict(accountId);
    let models = null;
    if (res.json?.deep?.model) models = res.json.deep.model;
    rt.lastDoctor = { loggedIn: strict, models, capabilities: res.json?.deep?.capabilities || null, checkedAt: new Date().toISOString() };
    rt.lastError = res.json?.ok === false && res.json?.reason ? { reason: res.json.reason, message: res.json.message } : null;
    return rt.lastDoctor;
}

/** 严格读登录态：只看 storage-state.json 里的真实会话 cookie。文件不存在返回 null（未知）。 */
function checkLoginStrict(accountId) {
    const p = ensureAccountDirs(accountId);
    const file = path.join(p.state, "storage-state.json");
    if (!fs.existsSync(file)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const names = (data.cookies || []).map((cookie) => cookie.name);
        return names.some((name) => SESSION_COOKIE_RE.test(name));
    } catch {
        return null;
    }
}

/** 读窗口登录进度。 */
function readWindowStatus(accountId) {
    const p = accountPaths(accountId);
    const file = path.join(p.state, "login-window", "status.json");
    if (!fs.existsSync(file)) return { state: "idle", message: "尚未打开登录窗口" };
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return { state: "unknown", message: "状态文件读取失败" };
    }
}

function writeWindowStatus(accountId, payload) {
    const p = ensureAccountDirs(accountId);
    const dir = path.join(p.state, "login-window");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ accountId, updatedAt: new Date().toISOString(), ...payload }, null, 2));
}

/** 打开登录窗口：窗口不会自己关，检测到真正的会话 cookie 才保存并关闭。 */
function startWindowLogin(account) {
    const p = ensureAccountDirs(account.id);
    ensureDeps(account.id);
    writeWindowStatus(account.id, { state: "starting", message: "正在打开登录窗口…" });
    const child = spawn(process.execPath, [WINDOW_LOGIN_SCRIPT, p.state, account.id], {
        cwd: p.work,
        env: { ...process.env, DBB_STATE_DIR: p.state },
        windowsHide: false,
    });
    windowProcesses.set(account.id, child);
    child.on("exit", () => {
        windowProcesses.delete(account.id);
        const status = readWindowStatus(account.id);
        if (status.state === "logged_in") {
            const accounts = readAccounts().map((item) => (item.id === account.id ? { ...item, lastLoginAt: new Date().toISOString() } : item));
            writeAccounts(accounts);
            const rt = runtimeOf(account.id);
            rt.lastDoctor = { ...(rt.lastDoctor || {}), loggedIn: true, checkedAt: new Date().toISOString() };
        }
    });
    return child;
}

/** 读扫码进度文件。 */
function readQrStatus(accountId) {
    const p = accountPaths(accountId);
    const file = path.join(p.state, "login-qr", "status.json");
    if (!fs.existsSync(file)) return { state: "idle", message: "尚未开始扫码" };
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return { state: "unknown", message: "状态文件读取失败" };
    }
}

function writeQrStatus(accountId, payload) {
    const p = ensureAccountDirs(accountId);
    const dir = path.join(p.state, "login-qr");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ accountId, updatedAt: new Date().toISOString(), ...payload }, null, 2));
}

/** 把 {name: value} 形式的 cookie 转成 Playwright storageState。 */
function cookiesToStorageState(cookies) {
    return {
        cookies: Object.entries(cookies).map(([name, value]) => ({
            name,
            value: String(value),
            domain: ".doubao.com",
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: true,
            sameSite: "Lax",
        })),
        origins: [],
    };
}

/** 拉起二维码助手：真实二维码来自豆包 passport 接口，扫完拿到 cookies 注入该账号 profile。 */
function startQrHelper(account) {
    const p = ensureAccountDirs(account.id);
    const dir = path.join(p.state, "login-qr");
    fs.mkdirSync(dir, { recursive: true });
    const imgFile = path.join(dir, "qr.png");
    // 扫码拿到的 cookies 先落临时文件；只有注入并在浏览器里验证通过，才写真正的 storage-state.json
    const cookiesFile = path.join(dir, "cookies.json");
    writeQrStatus(account.id, { state: "starting", message: "正在向豆包申请二维码…" });

    const child = spawn(PYTHON_BIN, [LOGIN_QR_SCRIPT], {
        cwd: p.work,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", DBB_STATE_DIR: p.state },
        windowsHide: true,
    });
    qrProcesses.set(account.id, child);

    let buffer = "";
    let finished = false;

    const handleLine = async (line) => {
        let payload;
        try {
            payload = JSON.parse(line);
        } catch {
            return;
        }
        if (payload.type === "qr" && payload.base64) {
            fs.writeFileSync(imgFile, Buffer.from(payload.base64, "base64"));
            writeQrStatus(account.id, { state: "waiting", message: "请用手机豆包 App 扫码并在手机上确认" });
            return;
        }
        if (payload.type === "status") {
            const current = readQrStatus(account.id);
            if (current.state !== "waiting") writeQrStatus(account.id, { state: "waiting", message: payload.message || "等待扫码" });
            return;
        }
        if (payload.type === "cookies" && payload.cookies) {
            finished = true;
            fs.writeFileSync(cookiesFile, JSON.stringify(cookiesToStorageState(payload.cookies), null, 2));
            writeQrStatus(account.id, { state: "saving", message: "扫码成功，正在写入登录态…" });
            // 写登录态要占 profile：先把该账号已打开的查看窗口收起来，否则注入会失败
            void closeViewer(account.id);
            await new Promise((resolve) => setTimeout(resolve, 1800));
            const inject = spawn(process.execPath, [INJECT_SCRIPT, p.state, cookiesFile], {
                cwd: p.work,
                env: { ...process.env, DBB_STATE_DIR: p.state },
                windowsHide: true,
            });
            let injectOut = "";
            inject.stdout.on("data", (chunk) => {
                injectOut += chunk.toString("utf8");
            });
            inject.on("exit", () => {
                const loggedIn = checkLoginStrict(account.id);
                writeQrStatus(account.id, { state: loggedIn ? "logged_in" : "error", message: loggedIn ? "登录成功" : `登录态注入失败：${injectOut.slice(0, 160)}`, cookies: Object.keys(payload.cookies).length });
                if (loggedIn) {
                    const accounts = readAccounts().map((item) => (item.id === account.id ? { ...item, lastLoginAt: new Date().toISOString() } : item));
                    writeAccounts(accounts);
                    const rt = runtimeOf(account.id);
                    rt.lastDoctor = { ...(rt.lastDoctor || {}), loggedIn: true, checkedAt: new Date().toISOString() };
                }
            });
            return;
        }
        if (payload.type === "failed") {
            finished = true;
            writeQrStatus(account.id, { state: "error", message: payload.message || "扫码失败" });
        }
    };

    child.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let index = buffer.indexOf("\n");
        while (index >= 0) {
            handleLine(buffer.slice(0, index)).catch(() => undefined);
            buffer = buffer.slice(index + 1);
            index = buffer.indexOf("\n");
        }
    });
    child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8").trim();
        if (text) writeQrStatus(account.id, { state: readQrStatus(account.id).state === "logged_in" ? "logged_in" : "error", message: text.slice(0, 300) });
    });
    child.on("exit", () => {
        qrProcesses.delete(account.id);
        const status = readQrStatus(account.id);
        if (!finished && status.state !== "logged_in") writeQrStatus(account.id, { state: "closed", message: "扫码进程已退出" });
    });
    return child;
}

/* ---------------------------------- 任务队列 --------------------------------- */

const jobs = new Map();
const jobOrder = [];
let queue = Promise.resolve();

function newJobId() {
    return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function listJobs(limit = 50) {
    return jobOrder
        .slice(-limit)
        .reverse()
        .map((id) => {
            const job = jobs.get(id);
            return {
                id: job.id,
                nodeId: job.nodeId || null,
                accountId: job.accountId,
                accountName: job.accountName,
                prompt: job.prompt,
                capability: job.capability,
                mode: job.mode,
                status: job.status,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                finishedAt: job.finishedAt,
                elapsedMs: job.elapsedMs,
                progress: job.progress,
                modelName: job.modelName || null,
                requestedParams: job.requestedParams || null,
                actualParams: job.actualParams || null,
                files: job.files,
                error: job.error,
                text: job.text,
            };
        });
}

async function runJob(job) {
    const account = findAccount(job.accountId);
    if (!account) {
        job.status = "failed";
        job.error = { reason: "ACCOUNT_MISSING", message: "账号不存在" };
        job.finishedAt = new Date().toISOString();
        return;
    }

    // 获取账号级锁，同账号任务串行执行
    const releaseLock = await acquireAccountLock(account.id);
    const rt = runtimeOf(account.id);

    try {
        job.status = "running";
        job.startedAt = new Date().toISOString();
        job.progress = "正在准备豆包窗口…";

        // 严格一个号一个窗口：先确保那个窗口在（不在就打开）
        const viewerReady = await ensureViewer(account);
        job.progress = viewerReady ? "正在连接豆包窗口…" : "豆包窗口启动较慢，继续尝试连接…";

        const p = ensureAccountDirs(account.id);
        ensureDeps(account.id);
        const specDir = path.join(p.state, "jobs");
        fs.mkdirSync(specDir, { recursive: true });
        const specFile = path.join(specDir, `${job.id}.json`);
        fs.writeFileSync(
            specFile,
            JSON.stringify({
                capability: job.capability,
                prompt: job.prompt,
                model: job.modelName,
                ratio: job.requestedParams?.ratio ?? null,
                duration: job.requestedParams?.duration ?? null,
                attachments: job.attachments,
                mode: job.mode,
                expectedArtifactKind: job.expectedArtifactKind || null,
            }),
        );

        const started = Date.now();
        const child = spawn(process.execPath, [RUNNER_SCRIPT, p.state, specFile], {
            cwd: p.work,
            env: { ...dbbEnv(account.id) },
            windowsHide: false,
        });
        job.runnerPid = child.pid;
        if (!runnerProcesses.has(account.id)) runnerProcesses.set(account.id, new Set());
        runnerProcesses.get(account.id).add(child);

        // 任务结果 Promise：由 stdout 的 result 消息 resolve
        let resultResolve;
        let resultReject;
        const resultPromise = new Promise((resolve, reject) => {
            resultResolve = resolve;
            resultReject = reject;
        });

        let settled = false;
        let timer;
        let timedOut = false; // 标记是否因超时被 kill
        const finish = (payload, killChild = false) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            // 只在超时/异常时 kill 子进程，正常完成让它自己退出
            if (killChild) {
                try { child.kill(); } catch { /* ignore */ }
            }
            // busy 状态根据实际计数计算
            const left = (runningByAccount.get(account.id) || 1) - 1;
            if (left > 0) runningByAccount.set(account.id, left);
            else runningByAccount.delete(account.id);
            const activeLeft = (activeJobs.get(account.id) || 1) - 1;
            if (activeLeft > 0) activeJobs.set(account.id, activeLeft);
            else activeJobs.delete(account.id);
            rt.busy = activeLeft > 0;
            // 从 runnerProcesses 移除
            const set = runnerProcesses.get(account.id);
            if (set) {
                set.delete(child);
                if (!set.size) runnerProcesses.delete(account.id);
            }
            job.elapsedMs = Date.now() - started;
            job.finishedAt = new Date().toISOString();
            if (payload?.ok) {
                const files = (payload.files || []).map((file, index) => ({
                    index,
                    path: file.file,
                    name: path.basename(file.file || `file-${index}`),
                    bytes: file.bytes ?? null,
                    kind: file.kind || "file",
                    contentType: file.contentType || null,
                }));
                job.files = files;
                job.text = payload.text || "";
                job.status = files.length ? "succeeded" : "failed";
                if (!files.length) job.error = { reason: "NO_ARTIFACT", message: "豆包没有返回可用产物" };
                job.actualParams = parseActualParams(job.stderrLines) || parseActualParams([job.text]);
                resultResolve(payload);
            } else {
                job.status = "failed";
                job.error = payload?.error || { reason: "RUNNER_ERROR", message: "生成器异常退出" };
                resultReject(new Error(job.error.message));
            }
        };

        // stdout 分块处理：确保最后一行没有换行符也能被解析
        let buffer = "";
        const handleLine = (line) => {
            let payload;
            try {
                payload = JSON.parse(line);
            } catch {
                return;
            }
            if (payload.type === "progress") {
                job.stderrLines.push(payload.message);
                if (job.stderrLines.length > 40) job.stderrLines.shift();
                job.progress = String(payload.message).slice(0, 160);
            }
            if (payload.type === "result") finish(payload);
        };
        child.stdout.on("data", (chunk) => {
            buffer += chunk.toString("utf8");
            let index = buffer.indexOf("\n");
            while (index >= 0) {
                handleLine(buffer.slice(0, index));
                buffer = buffer.slice(index + 1);
                index = buffer.indexOf("\n");
            }
        });
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8").trim();
            if (!text) return;
            job.stderrLines.push(text);
            if (job.stderrLines.length > 40) job.stderrLines.shift();
            job.progress = text.slice(0, 160);
        });
        child.on("error", (err) => {
            finish({ ok: false, error: { reason: "SPAWN_ERROR", message: `生成器进程错误: ${err.message}` } }, true);
        });
        // 用 close 而不是 exit：close 表示 stdio 流都关闭了，确保最后一段 stdout 被读取
        child.on("close", (code) => {
            // 处理缓冲区里剩下的最后一行（没有换行符的情况）
            if (buffer.trim()) {
                handleLine(buffer.trim());
                buffer = "";
            }
            // 如果还没收到 result，说明进程异常退出或被超时 kill
            if (timedOut) {
                finish({ ok: false, error: { reason: "TIMEOUT", message: "生成超时（20 分钟）" } }, false);
            } else {
                finish({ ok: false, error: { reason: `EXIT_${code}`, message: job.stderrLines.slice(-3).join(" ") || "生成器退出" } }, false);
            }
        });
        // 超时兜底——先标记超时，再温和 kill，宽限 5 秒后强制 kill
        timer = setTimeout(() => {
            timedOut = true;
            try { child.kill(); } catch { /* ignore */ }
            // 宽限 5 秒后还没退出，强制终止
            setTimeout(() => {
                if (!settled) {
                    try { child.kill("SIGKILL"); } catch { /* ignore */ }
                }
            }, 5000);
        }, 20 * 60 * 1000);

        // 等待任务完成
        await resultPromise;
    } catch (error) {
        job.status = "failed";
        job.error = { reason: "RUNNER_ERROR", message: error instanceof Error ? error.message : String(error) };
        job.finishedAt = new Date().toISOString();
    } finally {
        releaseLock();
    }
}

function enqueue(job) {
    // 同账号可并发：不再串行排队，直接开跑（并发上限在 POST /api/jobs 处校验）
    return runJob(job).catch(() => undefined);
}

/* ---------------------------------- HTTP 路由 -------------------------------- */

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, "");
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const api = parts[0] === "api" ? parts.slice(1) : null;
    if (!api) return send(res, 404, { ok: false, error: "not found" });

    try {
        // GET /api/health
        if (api[0] === "health" && req.method === "GET") {
            return send(res, 200, {
                ok: true,
                service: "doubao-bridge",
                cli: CLI,
                cliExists: fs.existsSync(CLI),
                accountsRoot: ACCOUNTS_ROOT,
                accounts: readAccounts().length,
                running: [...runningByAccount.values()].reduce((sum, value) => sum + value, 0),
            });
        }

        // GET /api/accounts
        if (api[0] === "accounts" && api.length === 1 && req.method === "GET") {
            return send(res, 200, { ok: true, accounts: readAccounts().map(publicAccount) });
        }

        // POST /api/accounts
        if (api[0] === "accounts" && api.length === 1 && req.method === "POST") {
            const body = await readJsonBody(req);
            const name = String(body.name || "").trim();
            if (!name) return send(res, 400, { ok: false, error: "账号名称不能为空" });
            const accounts = readAccounts();
            const account = { id: newId(), name, createdAt: new Date().toISOString() };
            ensureAccountDirs(account.id);
            accounts.push(account);
            writeAccounts(accounts);
            return send(res, 200, { ok: true, account: publicAccount(account) });
        }

        if (api[0] === "accounts" && api.length >= 2) {
            const account = findAccount(api[1]);
            if (!account) return send(res, 404, { ok: false, error: "账号不存在" });
            const action = api[2];

            // DELETE /api/accounts/:id
            if (!action && req.method === "DELETE") {
                if (runtimeOf(account.id).busy) return send(res, 409, { ok: false, error: "该账号有任务正在运行，先等它结束" });
                const p = accountPaths(account.id);
                fs.rmSync(p.base, { recursive: true, force: true });
                writeAccounts(readAccounts().filter((a) => a.id !== account.id));
                accountRuntime.delete(account.id);
                return send(res, 200, { ok: true });
            }

            // POST /api/accounts/:id/login —— 兼容路径：dbb 自己的有头登录（窗口里扫码）
            if (action === "login" && req.method === "POST") {
                const rt = runtimeOf(account.id);
                if (rt.loginRunning) return send(res, 409, { ok: false, error: "该账号正在登录中" });
                rt.loginRunning = true;
                const resLogin = await runDbb(account.id, ["login", "--json", "--timeout", String(LOGIN_TIMEOUT_MS)], { timeoutMs: LOGIN_TIMEOUT_MS + 60000 });
                rt.loginRunning = false;
                const json = resLogin.json;
                if (json?.ok) {
                    const accounts = readAccounts().map((a) => (a.id === account.id ? { ...a, lastLoginAt: new Date().toISOString() } : a));
                    writeAccounts(accounts);
                    await refreshDoctor(account.id);
                    return send(res, 200, { ok: true, account: publicAccount(findAccount(account.id)) });
                }
                rt.lastError = { reason: json?.reason || `EXIT_${resLogin.code}`, message: json?.message || tail(resLogin.stderr, 6).join("\n") };
                return send(res, 200, { ok: false, error: rt.lastError });
            }

            // POST /api/accounts/:id/login-helpers/stop —— 由桥接自己停止登录子进程（避免外部杀进程把环境带走）
            if (action === "login-helpers" && api[3] === "stop" && req.method === "POST") {
                const qrChild = qrProcesses.get(account.id);
                const windowChild = windowProcesses.get(account.id);
                if (qrChild && !qrChild.killed) qrChild.kill();
                if (windowChild && !windowChild.killed) windowChild.kill();
                qrProcesses.delete(account.id);
                windowProcesses.delete(account.id);
                writeWindowStatus(account.id, { state: "cancel", message: "已手动停止" });
                writeQrStatus(account.id, { state: "cancel", message: "已手动停止" });
                return send(res, 200, { ok: true, stopped: Boolean(qrChild || windowChild) });
            }

            // POST /api/accounts/:id/open —— 打开/前置该账号唯一的豆包窗口
            if (action === "open" && api.length === 3 && req.method === "POST") {
                if (runtimeOf(account.id).busy) return send(res, 409, { ok: false, error: "该账号正在生成，窗口由生成任务占用" });
                const result = await openViewer(account);
                return send(res, 200, { ok: true, ...result });
            }

            // POST /api/accounts/:id/close —— 关闭该账号的豆包窗口
            if (action === "close" && api.length === 3 && req.method === "POST") {
                await closeViewer(account.id);
                return send(res, 200, { ok: true });
            }

            // POST /api/accounts/:id/release —— 强制释放 profile（卡住时的手动兜底）
            if (action === "release" && api.length === 3 && req.method === "POST") {
                const freed = await releaseProfile(account.id);
                return send(res, 200, { ok: true, freed });
            }

            // GET /api/accounts/:id/open/status
            if (action === "open" && api[3] === "status" && req.method === "GET") {
                const entry = viewerProcesses.get(account.id);
                return send(res, 200, { ok: true, running: Boolean(entry && !entry.child.killed), status: readViewerStatus(account.id) });
            }

            // POST /api/accounts/:id/window-login —— 打开登录窗口，窗口不会自己关
            if (action === "window-login" && api.length === 3 && req.method === "POST") {
                const existing = windowProcesses.get(account.id);
                if (existing && !existing.killed) existing.kill();
                startWindowLogin(account);
                return send(res, 200, { ok: true, started: true });
            }

            // GET /api/accounts/:id/window-login/status
            if (action === "window-login" && api[3] === "status" && req.method === "GET") {
                return send(res, 200, { ok: true, status: readWindowStatus(account.id), loggedIn: checkLoginStrict(account.id) });
            }

            // POST /api/accounts/:id/window-login/cancel —— 只写标记，窗口由助手自己关
            if (action === "window-login" && api[3] === "cancel" && req.method === "POST") {
                writeWindowStatus(account.id, { state: "cancel", message: "取消中…" });
                return send(res, 200, { ok: true });
            }

            // POST /api/accounts/:id/qr-login —— 应用内扫码：后台向豆包申请二维码，图片回传给前端
            if (action === "qr-login" && req.method === "POST") {
                const existing = qrProcesses.get(account.id);
                if (existing && !existing.killed) {
                    // 再次点击视为「换一张二维码」：结束上一次再重新申请
                    existing.kill();
                    qrProcesses.delete(account.id);
                }
                if (!fs.existsSync(PYTHON_BIN)) return send(res, 500, { ok: false, error: `找不到 Python：${PYTHON_BIN}（豆包扫码登录依赖 .doubao-venv，请确认它已存在）` });
                fs.rmSync(path.join(accountPaths(account.id).state, "login-qr", "qr.png"), { force: true });
                startQrHelper(account);
                return send(res, 200, { ok: true, started: true });
            }

            // GET /api/accounts/:id/qr-login/status —— 扫码进度；登录成功后同步账号状态
            if (action === "qr-login" && api[3] === "status" && req.method === "GET") {
                const status = readQrStatus(account.id);
                if (status.state === "logged_in") {
                    const strict = checkLoginStrict(account.id);
                    if (strict) {
                        const accounts = readAccounts().map((item) => (item.id === account.id ? { ...item, lastLoginAt: new Date().toISOString() } : item));
                        writeAccounts(accounts);
                        const rt = runtimeOf(account.id);
                        rt.lastDoctor = { ...(rt.lastDoctor || {}), loggedIn: true, checkedAt: new Date().toISOString() };
                    }
                }
                return send(res, 200, { ok: true, status, loggedIn: checkLoginStrict(account.id) });
            }

            // GET /api/accounts/:id/qr-login.png —— 最新二维码截图
            if (action === "qr-login.png" && req.method === "GET") {
                const p = accountPaths(account.id);
                const file = path.join(p.state, "login-qr", "qr.png");
                if (!fs.existsSync(file)) return send(res, 404, "no qr yet");
                const stat = fs.statSync(file);
                res.writeHead(200, { "content-type": "image/png", "content-length": stat.size, "cache-control": "no-store", "access-control-allow-origin": "*" });
                fs.createReadStream(file).pipe(res);
                return;
            }

            // POST /api/accounts/:id/qr-login/cancel
            if (action === "qr-login" && api[3] === "cancel" && req.method === "POST") {
                const p = accountPaths(account.id);
                const statusFile = path.join(p.state, "login-qr", "status.json");
                fs.mkdirSync(path.dirname(statusFile), { recursive: true });
                fs.writeFileSync(statusFile, JSON.stringify({ state: "cancel", updatedAt: new Date().toISOString() }));
                return send(res, 200, { ok: true });
            }

            // POST /api/accounts/:id/logout
            if (action === "logout" && req.method === "POST") {
                if (runtimeOf(account.id).busy) return send(res, 409, { ok: false, error: "该账号有任务正在运行" });
                const resLogout = await runDbb(account.id, ["logout", "--json"], { timeoutMs: 60000 });
                runtimeOf(account.id).lastDoctor = null;
                return send(res, 200, { ok: Boolean(resLogout.json?.ok), error: resLogout.json?.message || null });
            }

            // GET /api/accounts/:id/doctor
            if (action === "doctor" && req.method === "GET") {
                const doctor = await refreshDoctor(account.id);
                return send(res, 200, { ok: true, doctor });
            }

            // GET /api/accounts/:id/video-caps —— 读取豆包视频生成面板的真实模型与参数
            if (action === "video-caps" && req.method === "GET") {
                if (runtimeOf(account.id).busy) return send(res, 409, { ok: false, error: "该账号正在执行任务，稍后再读取" });
                const p = ensureAccountDirs(account.id);
                const capsFile = path.join(p.state, "video-caps.json");
                const refresh = url.searchParams.get("refresh") === "1";
                // 读一次就缓存：默认直接返回缓存，避免每次进面板都去开浏览器核验
                if (!refresh && fs.existsSync(capsFile)) {
                    try {
                        const cached = JSON.parse(fs.readFileSync(capsFile, "utf8"));
                        const ageMs = Date.now() - new Date(cached.readAt || 0).getTime();
                        if (cached.ok && ageMs < 12 * 60 * 60 * 1000) return send(res, 200, { ok: true, caps: cached, cached: true });
                    } catch {
                        /* 缓存坏了就重读 */
                    }
                }
                ensureDeps(account.id);
                const child = spawn(process.execPath, [path.join(HERE, "probe-video-caps.mjs"), p.state], {
                    cwd: p.work,
                    env: { ...process.env, DBB_STATE_DIR: p.state },
                    windowsHide: true,
                });
                let out = "";
                child.stdout.on("data", (chunk) => {
                    out += chunk.toString("utf8");
                });
                const code = await new Promise((resolve) => child.on("exit", (exitCode) => resolve(exitCode)));
                let parsed = null;
                try {
                    parsed = JSON.parse(out.trim().split("\n").pop() || "null");
                } catch {
                    parsed = null;
                }
                if (parsed?.ok) return send(res, 200, { ok: true, caps: parsed });
                if (fs.existsSync(capsFile)) return send(res, 200, { ok: true, caps: JSON.parse(fs.readFileSync(capsFile, "utf8")), stale: true });
                return send(res, 200, { ok: false, error: parsed?.error || `读取失败（exit ${code}）` });
            }

            // GET /api/accounts/:id/image-caps —— 图片模型/比例（同样缓存 12 小时）
            if (action === "image-caps" && req.method === "GET") {
                if (runtimeOf(account.id).busy) return send(res, 409, { ok: false, error: "该账号正在执行任务，稍后再读取" });
                const p = ensureAccountDirs(account.id);
                const capsFile = path.join(p.state, "image-caps.json");
                const refresh = url.searchParams.get("refresh") === "1";
                if (!refresh && fs.existsSync(capsFile)) {
                    try {
                        const cached = JSON.parse(fs.readFileSync(capsFile, "utf8"));
                        const ageMs = Date.now() - new Date(cached.readAt || 0).getTime();
                        if (cached.ok && ageMs < 12 * 60 * 60 * 1000) return send(res, 200, { ok: true, caps: cached, cached: true });
                    } catch {
                        /* 缓存坏了就重读 */
                    }
                }
                ensureDeps(account.id);
                const child = spawn(process.execPath, [path.join(HERE, "probe-image-caps.mjs"), p.state], {
                    cwd: p.work,
                    env: { ...process.env, DBB_STATE_DIR: p.state },
                    windowsHide: true,
                });
                let out = "";
                child.stdout.on("data", (chunk) => {
                    out += chunk.toString("utf8");
                });
                const code = await new Promise((resolve) => child.on("exit", (exitCode) => resolve(exitCode)));
                let parsed = null;
                try {
                    parsed = JSON.parse(out.trim().split("\n").pop() || "null");
                } catch {
                    parsed = null;
                }
                if (parsed?.ok) return send(res, 200, { ok: true, caps: parsed });
                if (fs.existsSync(capsFile)) return send(res, 200, { ok: true, caps: JSON.parse(fs.readFileSync(capsFile, "utf8")), stale: true });
                return send(res, 200, { ok: false, error: parsed?.error || `读取失败（exit ${code}）` });
            }

            // GET /api/accounts/:id/models —— 读页面真实可用模型与能力栏
            if (action === "models" && req.method === "GET") {
                if (runtimeOf(account.id).busy) return send(res, 409, { ok: false, error: "该账号正在执行任务，稍后再读取" });
                const resModels = await runDbb(account.id, ["list-models", "--json"], { timeoutMs: 180000 });
                if (!resModels.json?.ok) {
                    return send(res, 200, { ok: false, error: { reason: resModels.json?.reason || `EXIT_${resModels.code}`, message: resModels.json?.message || tail(resModels.stderr, 6).join("\n") } });
                }
                const rt = runtimeOf(account.id);
                rt.lastDoctor = { ...(rt.lastDoctor || {}), models: resModels.json.options || null, capabilities: resModels.json.capabilities || null, checkedAt: new Date().toISOString() };
                return send(res, 200, { ok: true, current: resModels.json.current || null, options: resModels.json.options || [], capabilities: resModels.json.capabilities || [] });
            }
        }

        // POST /api/uploads?name=xxx —— 原始字节上传，落到账号目录
        if (api[0] === "uploads" && req.method === "POST") {
            const accountId = url.searchParams.get("accountId") || "";
            const account = findAccount(accountId);
            if (!account) return send(res, 404, { ok: false, error: "账号不存在" });
            const name = path.basename(url.searchParams.get("name") || `upload-${Date.now()}`);
            const buffer = await readBody(req);
            const p = ensureAccountDirs(account.id);
            const target = path.join(p.uploads, `${Date.now()}-${name}`);
            fs.writeFileSync(target, buffer);
            return send(res, 200, { ok: true, path: target, bytes: buffer.length, name });
        }

        // POST /api/jobs
        if (api[0] === "jobs" && api.length === 1 && req.method === "POST") {
            const body = await readJsonBody(req);
            const prompt = String(body.prompt || "").trim();
            if (!prompt) return send(res, 400, { ok: false, error: "提示词不能为空" });

            // 账号调度：验证用户选择的账号，排队由账号锁处理
            const mode = String(body.accountSelectionMode || "manual");
            const accountResult = pickAccountByMode(mode, String(body.accountId || ""));
            if (!accountResult.ok) {
                return send(res, 400, { ok: false, error: { reason: accountResult.reason, message: accountResult.message } });
            }
            const account = accountResult.account;
            // 注意：不检查 busy/并发——同账号任务通过账号锁串行排队，不直接拒绝
            const attachments = (Array.isArray(body.attachments) ? body.attachments : []).map(String).filter((file) => fs.existsSync(file));
            const capability = String(body.capability || VIDEO_CAPABILITY);
            // P0: 新任务必须显式传 expectedArtifactKind，不允许用中文 capability 推断
            const expectedArtifactKind = String(body.expectedArtifactKind || "");
            if (expectedArtifactKind !== "image" && expectedArtifactKind !== "video") {
                return send(res, 400, { ok: false, error: { reason: "INVALID_ARTIFACT_KIND", message: "必须指定 expectedArtifactKind (image/video)" } });
            }
            const job = {
                id: newJobId(),
                // 发起这次生成的画布节点：结果必须回到这个节点
                nodeId: body.nodeId ? String(body.nodeId) : null,
                accountId: account.id,
                accountName: account.name,
                // 账号调度记录
                accountSelectionMode: mode,
                requestedAccountId: body.accountId ? String(body.accountId) : null,
                selectedAccountId: account.id,
                accountSelectionReason: accountResult.reason || null,
                prompt,
                capability,
                mode: String(body.mode || "text-to-video"),
                expectedArtifactKind, // 明确期望产物类型：image / video
                // 用户在节点里选的模型与参数：原样记录，是否被豆包采用由 actualParams（解析原文）说话
                modelName: body.modelName ? String(body.modelName) : null,
                requestedParams: body.requestedParams && typeof body.requestedParams === "object" ? body.requestedParams : null,
                actualParams: null,
                attachments,
                status: "queued",
                createdAt: new Date().toISOString(),
                progress: "排队中…",
                stderrLines: [],
                files: [],
                text: "",
                error: null,
            };
            jobs.set(job.id, job);
            jobOrder.push(job.id);
            void enqueue(job);
            return send(res, 200, { ok: true, job: { id: job.id, status: job.status } });
        }

        // GET /api/jobs
        if (api[0] === "jobs" && api.length === 1 && req.method === "GET") {
            const nodeId = url.searchParams.get("nodeId");
            const list = listJobs(Number(url.searchParams.get("limit") || 50));
            return send(res, 200, { ok: true, jobs: nodeId ? list.filter((job) => job.nodeId === nodeId) : list });
        }

        // GET /api/jobs/:id
        if (api[0] === "jobs" && api.length === 2 && req.method === "GET") {
            const job = jobs.get(api[1]);
            if (!job) return send(res, 404, { ok: false, error: "任务不存在" });
            return send(res, 200, {
                ok: true,
                job: {
                    ...listJobs(1000).find((item) => item.id === job.id),
                    progress: job.progress,
                    stderr: tail(job.stderrLines.join("\n"), 12),
                    modes: job.modes || null,
                    confirmRounds: job.confirmRounds ?? null,
                },
            });
        }

        // GET /api/jobs/:id/files/:index —— 下载真实产物
        if (api[0] === "jobs" && api[2] === "files" && api.length === 4 && req.method === "GET") {
            const job = jobs.get(api[1]);
            const index = Number(api[3]);
            const file = job?.files?.[index];
            if (!file || !fs.existsSync(file.path)) return send(res, 404, "file not found");
            const stat = fs.statSync(file.path);
            res.writeHead(200, {
                "content-type": file.contentType || "application/octet-stream",
                "content-length": stat.size,
                "content-disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
                "access-control-allow-origin": "*",
            });
            fs.createReadStream(file.path).pipe(res);
            return;
        }

        return send(res, 404, { ok: false, error: "unknown endpoint" });
    } catch (error) {
        return send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`[doubao-bridge] listening on http://${HOST}:${PORT}`);
    console.log(`[doubao-bridge] cli: ${CLI}`);
    console.log(`[doubao-bridge] accounts: ${ACCOUNTS_ROOT}`);
});
