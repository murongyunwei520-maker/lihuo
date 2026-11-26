// 豆包账号池 + 视频生成桥接服务。
// 作用：把 ops120/doubao-brain 的 CLI（dbb）包装成本地 HTTP 服务，供离火前端调用。
// 账号隔离：每个账号独立的 DBB_STATE_DIR（浏览器 profile / 登录态 / 下载目录互不干扰）。
// 真实优先：所有能力、登录态、产物都来自 dbb 的真实执行结果，读不到就如实返回 unknown。
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { normalizeAppliedParams, resolveRequestedParams } from "./lib/request-params.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const CLI = process.env.DBB_CLI || path.join(REPO, "vendor", "doubao-brain", "dbb", "cli.mjs");
const ACCOUNTS_ROOT = process.env.DOUBAO_ACCOUNTS_DIR || path.join(REPO, ".doubao-accounts");
// 产物索引：桥接一重启，内存里的 jobs 就没了，画布上已经渲染过的节点再取
// /api/jobs/<id>/files/0 会 404 —— 浏览器对 404 的 mp4 只报「不支持的音频/视频格式」，
// 用户看到的就是「生成的视频是黑屏 / 打不开」。索引落盘后重启也能播。
const FILE_INDEX_DIR = path.join(ACCOUNTS_ROOT, "_files");
function jobIdSafe(value) {
    return /^[A-Za-z0-9._-]{1,80}$/.test(String(value || ""));
}
function persistJobFiles(jobId, files) {
    if (!jobIdSafe(jobId)) return;
    try {
        fs.mkdirSync(FILE_INDEX_DIR, { recursive: true });
        fs.writeFileSync(path.join(FILE_INDEX_DIR, `${jobId}.json`), JSON.stringify(files || [], null, 1), "utf8");
    } catch {
        /* 写不进去不影响本次任务 */
    }
}
function readJobFiles(jobId) {
    if (!jobIdSafe(jobId)) return null;
    try {
        return JSON.parse(fs.readFileSync(path.join(FILE_INDEX_DIR, `${jobId}.json`), "utf8"));
    } catch {
        return null;
    }
}

// 桥接重启后内存里的任务全没了，但磁盘上还留着每个任务的 spec（state/jobs/<id>.json）
// 和产物目录（state/downloads/manual/<id>/）。画布上老节点指向的正是这些任务，
// 以前这里直接 404，前端就弹「任务不存在」、视频节点也变成黑屏。
// 现在按 jobId 从磁盘把任务「重建」出来，老节点照常能看、能播。
const recoveredJobs = new Map();
function recoverJob(jobId) {
    if (!jobIdSafe(jobId)) return null;
    if (recoveredJobs.has(jobId)) return recoveredJobs.get(jobId);
    let accounts = [];
    try {
        accounts = readAccounts();
    } catch {
        accounts = [];
    }
    for (const account of accounts) {
        const stateDir = path.join(ACCOUNTS_ROOT, account.id, "state");
        const specFile = path.join(stateDir, "jobs", `${jobId}.json`);
        const dir = path.join(stateDir, "downloads", "manual", jobId);
        if (!fs.existsSync(specFile) && !fs.existsSync(dir)) continue;
        let spec = {};
        try {
            spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
        } catch {
            spec = {};
        }
        let names = [];
        try {
            names = fs.readdirSync(dir).filter((name) => /\.(mp4|webm|mov|png|jpe?g|webp)$/i.test(name));
        } catch {
            names = [];
        }
        // 视频转码后目录里会多一个 -h264.mp4：优先用它，别把原始 HEVC 那份排到 0 号
        names.sort((a, b) => {
            const score = (name) => (/-h264\.mp4$/i.test(name) ? 0 : /\.mp4$/i.test(name) ? 1 : 2);
            return score(a) - score(b) || a.localeCompare(b);
        });
        const files = names.map((name, index) => {
            const filePath = path.join(dir, name);
            let bytes = null;
            try {
                bytes = fs.statSync(filePath).size;
            } catch {
                bytes = null;
            }
            const ext = path.extname(name).toLowerCase();
            const kind = /mp4|webm|mov/.test(ext) ? "video" : "image";
            const contentType = kind === "video" ? "video/mp4" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
            return { index, path: filePath, name, bytes, kind, contentType };
        });
        const job = {
            id: jobId,
            nodeId: spec.nodeId || null,
            accountId: account.id,
            accountName: account.name,
            provider: account.provider || "doubao",
            prompt: spec.prompt || "",
            capability: spec.capability || "",
            mode: spec.mode || "",
            modelName: spec.model || null,
            requestedParams: spec.requestedParams || null,
            appliedParams: spec.appliedParams || null,
            unsupportedParams: spec.unsupportedParams || null,
            actualParams: null,
            status: files.length ? "succeeded" : "failed",
            createdAt: spec.createdAt || new Date().toISOString(),
            finishedAt: null,
            elapsedMs: null,
            progress: files.length ? "桥接重启后从磁盘恢复" : "产物已不在磁盘上",
            files,
            text: "",
            error: files.length ? null : { reason: "GONE", message: "桥接重启后，这个任务的产物已不在磁盘上" },
        };
        recoveredJobs.set(jobId, job);
        return job;
    }
    return null;
}
// 站点配置：豆包（国内）与 Dola（国际版）走同一套账号池 / 任务 / 执行器，只是站点地址和能力文案不同
const PROVIDERS = {
    doubao: {
        id: "doubao",
        name: "豆包",
        siteUrl: process.env.DBB_SITE_URL || "https://www.doubao.com/chat/",
        referer: "https://www.doubao.com/",
        cookieDomain: ".doubao.com",
        // 能力栏文案：Dola 用同一套中文标签时不用改，改成英文界面时用环境变量覆盖
        capabilities: {
            image: process.env.DBB_CAP_IMAGE || "图像生成",
            video: process.env.DBB_CAP_VIDEO || "视频生成",
            text: process.env.DBB_CAP_TEXT || "对话",
        },
    },
    dola: {
        id: "dola",
        name: "Dola",
        siteUrl: process.env.DOLA_SITE_URL || "https://www.dola.com/chat/",
        referer: "https://www.dola.com/",
        cookieDomain: ".dola.com",
        capabilities: {
            image: process.env.DOLA_CAP_IMAGE || "图像生成",
            video: process.env.DOLA_CAP_VIDEO || "视频生成",
            text: process.env.DOLA_CAP_TEXT || "对话",
        },
    },
};
const DEFAULT_PROVIDER = "doubao";
const providerOf = (account) => PROVIDERS[account?.provider] || PROVIDERS[DEFAULT_PROVIDER];

/* ----------------------- 网页端真实参数收敛 ----------------------- */
// 画布上可以选 21:9 / 9:21 / 像素尺寸，但豆包网页面板只提供下面这些比例。
// 不收敛就会点不到按钮、静默沿用页面上的旧比例——用户看到的就是「比例没传给豆包」。
const IMAGE_RATIOS = ["9:16", "2:3", "3:4", "1:1", "4:3", "3:2", "16:9"];
const VIDEO_RATIOS = ["3:4", "4:3", "9:16", "16:9", "1:1", "21:9"];
const RATIO_ASPECT = {
    "1:1": 1,
    "2:3": 2 / 3,
    "3:2": 3 / 2,
    "3:4": 3 / 4,
    "4:3": 4 / 3,
    "9:16": 9 / 16,
    "16:9": 16 / 9,
    "9:21": 9 / 21,
    "21:9": 21 / 9,
};
function normalizeRatio(value, kind, provider) {
    const raw = String(value || "").trim();
    const autoLabel = provider === "dola" ? "Auto" : "自动";
    if (!raw || /^(auto|自动)$/i.test(raw)) return autoLabel;
    const options = kind === "video" ? VIDEO_RATIOS : IMAGE_RATIOS;
    if (options.includes(raw)) return raw;
    const pixels = raw.match(/^(\d+)x(\d+)$/i);
    const aspect = pixels ? Number(pixels[1]) / Number(pixels[2]) : (() => {
        const hit = raw.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
        return hit ? Number(hit[1]) / Number(hit[2]) : null;
    })();
    if (!aspect) return autoLabel;
    let best = autoLabel;
    let diff = Number.POSITIVE_INFINITY;
    for (const option of options) {
        const current = Math.abs((RATIO_ASPECT[option] || 1) - aspect);
        if (current < diff) {
            best = option;
            diff = current;
        }
    }
    return best;
}
function normalizeDuration(value) {
    const seconds = Math.round(Number(value));
    return Number.isFinite(seconds) && seconds > 0 ? Math.max(4, Math.min(15, seconds)) : null;
}
const PORT = Number(process.env.DOUBAO_BRIDGE_PORT || 9091);
const HOST = process.env.DOUBAO_BRIDGE_HOST || "127.0.0.1";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);
// 桥接持有豆包登录态，只能在loopback上跑。想远程用请走 SSH 隧道，不要把端口暴露到公网/局域网。
if (!LOOPBACK_HOSTS.has(String(HOST).toLowerCase())) {
    console.error(`[doubao-bridge] 拒绝监听 ${HOST}:桥接持有账号登录态，只允许 127.0.0.1 / localhost / ::1。`);
    process.exit(1);
}
// 浏览器来源白名单：本地开发/预览默认端口；GitHub Pages 静态站可直接连本机桥接；额外来源用 DOUBAO_BRIDGE_ALLOWED_ORIGINS 显式追加。
const ALLOWED_ORIGINS = new Set(
    (process.env.DOUBAO_BRIDGE_ALLOWED_ORIGINS || "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173,https://murongyunwei520-maker.github.io")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
);
function isLoopbackAddress(value) {
    const ip = String(value || "").replace(/^::ffff:/i, "");
    return ip === "127.0.0.1" || ip === "::1" || ip === "0:0:0:0:0:0:0:1";
}
function hostHeaderAllowed(req) {
    const raw = String(req.headers.host || "").toLowerCase();
    const name = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.split(":")[0];
    return LOOPBACK_HOSTS.has(name);
}
// 文件 / 二维码接口不要回 *：只把请求页面的 Origin 放行给已校验过的白名单。
// <img>/<video> 这类无 Origin 的加载不需要 CORS 头，仍然能正常显示。
function fileCorsHeaders(req) {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    return origin && ALLOWED_ORIGINS.has(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
}

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
// Dola 等站点用「站点自己的登录弹窗」取二维码（豆包 passport 接口拿不到别的站点的码）
const LOGIN_QR_BROWSER_SCRIPT = path.join(HERE, "qr-helper-browser.mjs");
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

/** 干掉一个 Runner 及其子进程（Windows 用 taskkill /T，Unix 先按进程组再退回单进程）。 */
function killProcessTree(pid) {
    const id = Number(pid);
    if (!Number.isFinite(id) || id <= 0) return;
    if (process.platform === "win32") {
        try {
            spawn("taskkill", ["/PID", String(id), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
        } catch {
            /* ignore */
        }
        return;
    }
    try {
        process.kill(-id, "SIGKILL");
    } catch {
        try {
            process.kill(id, "SIGKILL");
        } catch {
            /* ignore */
        }
    }
}

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
    const child = spawn(process.execPath, [VIEWER_SCRIPT, p.state, account.id, String(port), providerOf(account).siteUrl, providerOf(account).name], {
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
        const list = Array.isArray(data.accounts) ? data.accounts : [];
        // 老数据没有 provider 字段，统一按豆包算
        return list.map((item) => ({ ...item, provider: PROVIDERS[item.provider] ? item.provider : DEFAULT_PROVIDER }));
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
        "x-content-type-options": "nosniff",
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

const runningByAccount = new Map(); // accountId -> 当前并发任务数（健康检查用）
const activeJobs = new Map(); // accountId -> 正在跑的任务数（并发槽位）
// 同账号真正并发：默认同时最多跑 3 个，超出直接拒绝而不是排队；可用 DOUBAO_MAX_PARALLEL 调整
const MAX_JOBS_PER_ACCOUNT = Math.max(1, Number(process.env.DOUBAO_MAX_PARALLEL || 3));
// 豆包因套餐/额度拒绝创作的说法：命中就记在账号上，号池直接标红
const QUOTA_REFUSAL_RE = /升级正式订阅|体验套餐|体验额度|免费体验|不可用于创作|次数已用完|额度不足|额度已用尽|无可用额度|配额|余额不足|订阅|套餐|insufficient|quota|credit|subscription|upgrade|out of (credits|quota)|(reached|hit) (your|the) (daily )?limit|limit (has been )?reached/i;
let roundRobinCursor = 0; // 轮询分配的当前位置

/** 占一个并发槽位；满员返回 null（调用方直接拒绝，不排队）。返回的函数负责释放，重复调用安全。 */
function acquireJobSlot(accountId) {
    const used = activeJobs.get(accountId) || 0;
    if (used >= MAX_JOBS_PER_ACCOUNT) return null;
    activeJobs.set(accountId, used + 1);
    runningByAccount.set(accountId, (runningByAccount.get(accountId) || 0) + 1);
    runtimeOf(accountId).busy = true;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const active = (activeJobs.get(accountId) || 1) - 1;
        if (active > 0) activeJobs.set(accountId, active);
        else activeJobs.delete(accountId);
        const running = (runningByAccount.get(accountId) || 1) - 1;
        if (running > 0) runningByAccount.set(accountId, running);
        else runningByAccount.delete(accountId);
        runtimeOf(accountId).busy = active > 0;
    };
}

// 同一个账号的窗口准备过程要合并：并发任务同时发现窗口没开会各自开一次，profile 只能被一个 Edge 占用
const viewerPreparing = new Map(); // accountId -> Promise
function ensureViewerOnce(account) {
    const pending = viewerPreparing.get(account.id);
    if (pending) return pending;
    const promise = ensureViewer(account).finally(() => viewerPreparing.delete(account.id));
    viewerPreparing.set(account.id, promise);
    return promise;
}

/** 账号调度：manual / auto。 */
/** 额度标记只在「被打上的那一天」有效：豆包 / Dola 的免费额度每天 0 点重置。 */
function quotaBlockIsFresh(block) {
    if (!block?.at) return false;
    const at = new Date(block.at);
    if (Number.isNaN(at.getTime())) return false;
    const now = new Date();
    return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
}

/** 只保留今天的额度标记（跨过 0 点后旧标记自动失效）。 */
function freshQuotaBlocks(blocks) {
    const result = {};
    for (const [capability, block] of Object.entries(blocks || {})) {
        if (quotaBlockIsFresh(block)) result[capability] = block;
    }
    return result;
}

/** 这个账号在这个能力上是不是被豆包判过额度不足（只看今天的标记）。 */
function quotaBlockedFor(accountId, capability) {
    if (!capability) return false;
    return Boolean(freshQuotaBlocks(runtimeOf(accountId).quotaBlocks)[capability]);
}

function isLoggedIn(account) {
    const rt = runtimeOf(account.id);
    return rt.lastDoctor ? Boolean(rt.lastDoctor.loggedIn) : checkLoginStrict(account.id);
}

function pickAccountByMode(mode, preferredAccountId, capability = "", provider = "") {
    const allAccounts = readAccounts();
    // 模型决定站点：豆包模型只能配豆包账号，Dola 模型只能配 Dola 账号（两套账号体系不互通）
    const all = provider ? allAccounts.filter((item) => (item.provider || DEFAULT_PROVIDER) === provider) : allAccounts;
    const siteName = provider ? PROVIDERS[provider]?.name || provider : "";
    if (!all.length) {
        return { ok: false, reason: "NO_ACCOUNT_FOR_PROVIDER", message: `号池里还没有${siteName}账号，请先在账号池添加并扫码登录` };
    }
    if (preferredAccountId && !all.some((item) => item.id === preferredAccountId)) {
        const mismatched = allAccounts.find((item) => item.id === preferredAccountId);
        if (mismatched) {
            return {
                ok: false,
                reason: "ACCOUNT_PROVIDER_MISMATCH",
                message: `「${mismatched.name}」是${providerOf(mismatched).name}账号，不能用于${siteName}模型；请换成${siteName}账号`,
            };
        }
    }

    // manual 模式：必须用户明确选了账号；但选的号在该能力上额度不足时，按号池顺序顺延到下一个可用号
    if (mode === "manual") {
        if (!preferredAccountId) {
            return { ok: false, reason: "ACCOUNT_REQUIRED", message: "手动模式必须选择账号" };
        }
        const index = all.findIndex((a) => a.id === preferredAccountId);
        if (index < 0) {
            return { ok: false, reason: "ACCOUNT_NOT_FOUND", message: `账号不存在: ${preferredAccountId}` };
        }
        const account = all[index];
        if (!isLoggedIn(account)) {
            return { ok: false, reason: "ACCOUNT_NOT_LOGGED_IN", message: `账号 ${account.name} 未登录` };
        }
        if (quotaBlockedFor(account.id, capability)) {
            // 手动选号是用户的明确决定：额度不足就如实报错，绝不静默换号（换号会消耗另一个账号的额度）。
            return {
                ok: false,
                reason: "ACCOUNT_QUOTA_BLOCKED",
                message: `「${account.name}」${capability}额度不足，请手动换号；桥接不会自动切换账号`,
            };
        }
        return { ok: true, account, reason: "MANUAL_SELECTED" };
    }

    // auto 模式：在「已登录 + 该能力没被判额度不足」的号里按号池顺序轮询
    if (mode === "auto") {
        const candidates = all.filter((a) => isLoggedIn(a));
        if (!candidates.length) {
            return { ok: false, reason: "NO_LOGGED_IN_ACCOUNT", message: `没有已登录的${siteName}账号` };
        }
        const usable = candidates.filter((a) => !quotaBlockedFor(a.id, capability));
        if (!usable.length) {
            return { ok: false, reason: "ACCOUNT_QUOTA_UNKNOWN", message: `所有已登录${siteName}账号的${capability || "该能力"}额度都不足，请升级订阅或换号` };
        }
        const account = usable[roundRobinCursor++ % usable.length];
        return { ok: true, account, reason: "AUTO_SELECTED", message: `按号池顺序轮询到「${account.name}」` };
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
    // 同一个执行器要能跑豆包和 Dola：站点地址 / cookie 域名 / 能力文案都从账号所属站点取
    const site = providerOf(findAccount(accountId));
    return {
        ...process.env,
        DBB_STATE_DIR: p.state,
        DBB_SITE_URL: site.siteUrl,
        DBB_SITE_REFERER: site.referer,
        DBB_COOKIE_DOMAIN: site.cookieDomain,
        DBB_CAP_IMAGE: site.capabilities.image,
        DBB_CAP_VIDEO: site.capabilities.video,
        DBB_CAP_TEXT: site.capabilities.text,
    };
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
    // 「模型：…」来自豆包回答里的参数确认原文；「模型已设为 …」来自执行器的点选日志。
    // 新版面板不再回「参数确认」这一段，只有点选日志，所以两种都要认。
    const model = pick(/模型[：:]\s*([^\n，,。]+)/) || pick(/模型已设为\s*([^\n，,。]+)/);
    const ratio = pick(/比例[：:]\s*([^\n，,。]+)/) || pick(/比例已设为\s*([^\n，,。]+)/);
    const duration = pick(/时长[：:]\s*(\d+)\s*秒/) || pick(/时长已设为\s*(\d+)\s*s/);
    const resolution = pick(/分辨率[：:]\s*([^\n，,。]+)/);
    if (!model && !ratio && !duration && !resolution) return null;
    return { model, ratio, duration: duration ? Number(duration) : null, resolution, source: "豆包参数确认原文" };
}

/* --------------------------------- 账号状态 --------------------------------- */

const accountRuntime = new Map(); // accountId -> { busy, loginRunning, lastDoctor, lastError }

function runtimeOf(id) {
    if (!accountRuntime.has(id)) {
        // 额度不足标记落盘过：重启桥接后照样能把号标红，而不是等下一次被拒才显示
        const stored = readAccounts().find((item) => item.id === id);
        accountRuntime.set(id, { busy: false, loginRunning: false, lastDoctor: null, lastError: null, quotaBlocks: freshQuotaBlocks(stored?.quotaBlocks) });
    }
    return accountRuntime.get(id);
}

/** 跨天之后把昨天的额度标记清掉（内存 + accounts.json），号池里就不再标红。 */
function pruneStaleQuotaBlocks() {
    let dirty = false;
    const accounts = readAccounts().map((item) => {
        const kept = freshQuotaBlocks(item.quotaBlocks);
        if (Object.keys(kept).length === Object.keys(item.quotaBlocks || {}).length) return item;
        dirty = true;
        return { ...item, quotaBlocks: kept };
    });
    if (dirty) writeAccounts(accounts);
    for (const [id, rt] of accountRuntime) {
        const kept = freshQuotaBlocks(rt.quotaBlocks);
        if (Object.keys(kept).length !== Object.keys(rt.quotaBlocks || {}).length) rt.quotaBlocks = kept;
    }
}

/** 把某能力上的额度标记写进 accounts.json（block 为空表示清除）。 */
function persistQuotaBlock(accountId, capability, block) {
    const accounts = readAccounts().map((item) => {
        if (item.id !== accountId) return item;
        const quotaBlocks = { ...(item.quotaBlocks || {}) };
        if (block) quotaBlocks[capability] = block;
        else delete quotaBlocks[capability];
        return { ...item, quotaBlocks };
    });
    writeAccounts(accounts);
}

function publicAccount(account) {
    const rt = runtimeOf(account.id);
    // 桥接重启后没有内存态：直接读磁盘上的会话 cookie 判断，不用开浏览器，也不显示「未知」
    const strict = rt.lastDoctor ? Boolean(rt.lastDoctor.loggedIn) : checkLoginStrict(account.id);
    return {
        id: account.id,
        name: account.name,
        provider: account.provider || DEFAULT_PROVIDER,
        providerName: providerOf(account).name,
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
            // 上一次因套餐/额度被豆包拒绝的能力（同能力成功一次就清掉）
            // 一个号可能同时卡住多个能力：数组给前端展示，quotaBlock 仍保留最近的一条
            quotaBlocks: Object.values(freshQuotaBlocks(rt.quotaBlocks)).sort((a, b) => String(b.at).localeCompare(String(a.at))),
            quotaBlock: Object.values(freshQuotaBlocks(rt.quotaBlocks)).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null,
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
    const site = providerOf(account);
    writeWindowStatus(account.id, { state: "starting", message: `正在打开${site.name}登录窗口…` });
    const child = spawn(process.execPath, [WINDOW_LOGIN_SCRIPT, p.state, account.id, site.siteUrl, site.name], {
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
function cookiesToStorageState(cookies, domain = ".doubao.com") {
    return {
        cookies: Object.entries(cookies).map(([name, value]) => ({
            name,
            value: String(value),
            domain,
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: true,
            sameSite: "Lax",
        })),
        origins: [],
    };
}

/**
 * 拉起二维码助手。
 * - 豆包：走 passport 接口（qr-helper.py），拿到的 cookies 注入账号 profile。
 * - Dola 等其它站点：账号体系独立，只能用**该站点登录弹窗里的二维码**（qr-helper-browser.mjs），
 *   它直接跑在账号自己的 profile 上，扫完登录态天然落盘，不需要再做注入。
 */
function startQrHelper(account) {
    const site = providerOf(account);
    const p = ensureAccountDirs(account.id);
    const dir = path.join(p.state, "login-qr");
    fs.mkdirSync(dir, { recursive: true });
    const imgFile = path.join(dir, "qr.png");
    // 扫码拿到的 cookies 先落临时文件；只有注入并在浏览器里验证通过，才写真正的 storage-state.json
    const cookiesFile = path.join(dir, "cookies.json");
    const viaBrowser = site.id !== DEFAULT_PROVIDER;
    writeQrStatus(account.id, { state: "starting", message: `正在向${site.name}申请二维码…` });

    if (viaBrowser) {
        ensureDeps(account.id);
    }
    const child = viaBrowser
        ? spawn(process.execPath, [LOGIN_QR_BROWSER_SCRIPT, p.state, site.siteUrl, site.cookieDomain || ""], {
              cwd: p.work,
              env: { ...process.env, DBB_STATE_DIR: p.state },
              windowsHide: true,
          })
        : spawn(PYTHON_BIN, [LOGIN_QR_SCRIPT], {
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
            writeQrStatus(account.id, { state: "waiting", message: `请用手机${site.name} App 扫码并在手机上确认` });
            return;
        }
        if (payload.type === "status") {
            const current = readQrStatus(account.id);
            if (current.state !== "waiting") writeQrStatus(account.id, { state: "waiting", message: payload.message || "等待扫码" });
            return;
        }
        if (payload.type === "cookies" && payload.cookies) {
            finished = true;
            // 浏览器助手直接用账号 profile 扫码：登录态已经在里面，并且自己导出了 storage-state.json
            if (viaBrowser) {
                writeQrStatus(account.id, { state: "saving", message: "扫码成功，正在保存登录态…" });
                setTimeout(() => {
                    const loggedIn = checkLoginStrict(account.id);
                    writeQrStatus(account.id, {
                        state: loggedIn ? "logged_in" : "error",
                        message: loggedIn ? "登录成功" : "登录成功但没读到会话 cookie，请重新扫码",
                        cookies: Object.keys(payload.cookies || {}).length,
                    });
                    if (!loggedIn) return;
                    const accounts = readAccounts().map((item) => (item.id === account.id ? { ...item, lastLoginAt: new Date().toISOString() } : item));
                    writeAccounts(accounts);
                    const rt = runtimeOf(account.id);
                    rt.lastDoctor = { ...(rt.lastDoctor || {}), loggedIn: true, checkedAt: new Date().toISOString() };
                }, 800);
                return;
            }
            fs.writeFileSync(cookiesFile, JSON.stringify(cookiesToStorageState(payload.cookies, site.cookieDomain), null, 2));
            writeQrStatus(account.id, { state: "saving", message: "扫码成功，正在写入登录态…" });
            // 写登录态要占 profile：先把该账号已打开的查看窗口收起来，否则注入会失败
            void closeViewer(account.id);
            await new Promise((resolve) => setTimeout(resolve, 1800));
            const inject = spawn(process.execPath, [INJECT_SCRIPT, p.state, cookiesFile, site.siteUrl, site.cookieDomain || ""], {
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

function listJobs(limit = 50, nodeId = null) {
    // 先按 nodeId 过滤再截断 limit：否则同节点稍早的任务会被其他节点的新任务挤出结果集。
    const ids = nodeId ? jobOrder.filter((id) => jobs.get(id)?.nodeId === nodeId).slice(-limit).reverse() : jobOrder.slice(-limit).reverse();
    return ids.map((id) => {
            const job = jobs.get(id);
            if (!job) return null;
            return {
                id: job.id,
                nodeId: job.nodeId || null,
                accountId: job.accountId,
                accountName: job.accountName,
                accountSelectionMessage: job.accountSelectionMessage || null,
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
                appliedParams: job.appliedParams || null,
                unsupportedParams: job.unsupportedParams || null,
                actualParams: job.actualParams || null,
                files: job.files,
                error: job.error,
                text: job.text,
            };
        })
        .filter(Boolean);
}

async function runJob(job) {
    const account = findAccount(job.accountId);
    if (!account) {
        job.status = "failed";
        job.error = { reason: "ACCOUNT_MISSING", message: "账号不存在" };
        job.finishedAt = new Date().toISOString();
        return;
    }

    // 同账号可并行：槽位在创建任务时已经占好，这里直接开跑（不再有账号级串行锁）
    const rt = runtimeOf(account.id);
    try {
        job.status = "running";
        job.startedAt = new Date().toISOString();
        if (job.cancelRequested) {
            job.status = "failed";
            job.error = { reason: "CANCELED", message: "用户取消" };
            job.finishedAt = new Date().toISOString();
            return;
        }
        const siteName = providerOf(account).name;
        job.progress = `正在准备${siteName}窗口…`;

        // 严格一个号一个窗口：窗口准备合并成一次，并发任务共用结果
        const viewerReady = await ensureViewerOnce(account);
        job.progress = viewerReady ? `正在连接${siteName}窗口…` : `${siteName}窗口启动较慢，继续尝试连接…`;

        const p = ensureAccountDirs(account.id);
        ensureDeps(account.id);
        const specDir = path.join(p.state, "jobs");
        fs.mkdirSync(specDir, { recursive: true });
        const specFile = path.join(specDir, `${job.id}.json`);
        const site = providerOf(account);
        const appliedParams = job.appliedParams || resolveRequestedParams(job.requestedParams, job.expectedArtifactKind).appliedParams;
        const ratio = normalizeRatio(appliedParams.ratio, job.expectedArtifactKind === "video" ? "video" : "image", site.id);
        const duration = job.expectedArtifactKind === "video" ? normalizeDuration(appliedParams.duration) : null;
        const count = appliedParams.count ?? null;
        // 记录最终真正交给执行器的参数；网页读回结果在任务结束时写入 actualParams，二者可对照。
        job.appliedParams = {
            ...appliedParams,
            ...(job.modelName ? { model: job.modelName } : {}),
            ...(ratio ? { ratio } : {}),
            ...(duration ? { duration } : {}),
            ...(count !== null ? { count } : {}),
            mode: job.mode,
            attachmentCount: job.attachments.length,
        };
        fs.writeFileSync(
            specFile,
            JSON.stringify({
                capability: job.capability,
                // 站点决定执行器去哪个网页操作：豆包 / Dola 共用同一套执行器
                provider: site.id,
                siteUrl: site.siteUrl,
                referer: site.referer,
                siteCapability: site.capabilities[job.expectedArtifactKind === "text" ? "text" : job.expectedArtifactKind] || job.capability,
                prompt: job.prompt,
                model: job.modelName,
                // 提交前收敛到网页端真实存在的选项；Dola 的「自动」文案是 Auto。
                ratio,
                duration,
                // 画布要几张：产物多了也只回传这么多
                count,
                attachments: job.attachments,
                mode: job.mode,
                expectedArtifactKind: job.expectedArtifactKind || null,
                requestedParams: job.requestedParams,
                appliedParams: job.appliedParams,
                unsupportedParams: job.unsupportedParams,
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
            // 用户取消优先：即使 Runner 随后正常吐了 result，也不能把任务改回 succeeded。
            if (job.cancelRequested) payload = { ok: false, error: { reason: "CANCELED", message: "用户取消" } };
            if (timer) clearTimeout(timer);
            // 只在超时/异常时 kill 子进程，正常完成让它自己退出
            if (killChild) {
                try { child.kill(); } catch { /* ignore */ }
            }
            // 从 runnerProcesses 移除（槽位在 runJob 的 finally 里释放，这里不动计数）
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
                // 落盘索引：桥接重启后画布上的老节点还能拿到同一个文件（否则 404 → 播放器报格式不支持）
                persistJobFiles(job.id, files);
                job.text = payload.text || "";
                // 文本任务没有文件，回答正文就是产物
                const expectsText = job.expectedArtifactKind === "text";
                job.status = files.length || (expectsText && job.text.trim()) ? "succeeded" : "failed";
                if (job.status === "failed") job.error = { reason: "NO_ARTIFACT", message: expectsText ? "豆包没有返回回答内容" : "豆包没有返回可用产物" };
                job.actualParams = parseActualParams(job.stderrLines) || parseActualParams([job.text]);
                // 这个能力这次能出活，说明它的额度是通的：只清掉同能力的额度提示
                if (job.status === "succeeded" && rt.quotaBlocks?.[job.capability]) {
                    delete rt.quotaBlocks[job.capability];
                    persistQuotaBlock(account.id, job.capability, null);
                }
                resultResolve(payload);
            } else {
                job.status = "failed";
                // 执行器 ok:false 时必须带 error；真没带说明是进程自己没了，别把原因说成「生成器异常退出」
                job.error = payload?.error || { reason: "NO_ARTIFACT", message: "生成器没有返回可用产物" };
                // 额度不足（或明确拒绝但文案带额度/订阅字样）：按能力记在账号上，前端号池据此标红
                const quotaHit = job.error.reason === "QUOTA_EXCEEDED" || (job.error.reason === "DOUBAO_REFUSED" && QUOTA_REFUSAL_RE.test(String(job.error.message || "")));
                if (quotaHit) {
                    const block = { capability: job.capability, message: String(job.error.message).slice(0, 200), at: new Date().toISOString() };
                    rt.quotaBlocks = { ...(rt.quotaBlocks || {}), [job.capability]: block };
                    // 落盘：重启桥接后号池仍然标红
                    persistQuotaBlock(account.id, job.capability, block);
                }
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
        // finish() 里已经写好了具体原因（NO_ARTIFACT / TIMEOUT / EXIT_x），不要覆盖成笼统的 RUNNER_ERROR
        if (!job.error) job.error = { reason: "RUNNER_ERROR", message: error instanceof Error ? error.message : String(error) };
        job.finishedAt = new Date().toISOString();
    }
}

function enqueue(job, releaseSlot) {
    // 同账号可并发：槽位在创建任务时已经占好，这里立即开跑，不排队
    return runJob(job)
        .catch(() => undefined)
        .finally(() => releaseSlot?.());
}

/* ---------------------------------- HTTP 路由 -------------------------------- */

const server = http.createServer(async (req, res) => {
    // 防 DNS rebinding：Host 必须是本机回环地址，否则浏览器里的恶意站点可以借域名解析到 127.0.0.1 操控账号。
    if (!hostHeaderAllowed(req)) return send(res, 403, { ok: false, error: "forbidden host" });
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase());
    // 写操作用 Origin 白名单；curl 这类无 Origin 的本地请求按来源 IP 兜底。
    if (origin) {
        if (!ALLOWED_ORIGINS.has(origin)) return send(res, 403, { ok: false, error: "origin not allowed" });
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
        res.setHeader("access-control-allow-headers", "content-type");
    } else if (unsafe && !isLoopbackAddress(req.socket.remoteAddress)) {
        return send(res, 403, { ok: false, error: "forbidden" });
    }
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
                accounts: readAccounts().length,
                running: [...runningByAccount.values()].reduce((sum, value) => sum + value, 0),
            });
        }

        // GET /api/accounts?provider=dola —— 不传 provider 时返回全部（前端要按站点分组展示）
        if (api[0] === "accounts" && api.length === 1 && req.method === "GET") {
            pruneStaleQuotaBlocks();
            const provider = String(url.searchParams.get("provider") || "");
            const list = readAccounts().filter((item) => !provider || item.provider === provider);
            return send(res, 200, { ok: true, providers: Object.values(PROVIDERS).map(({ id, name }) => ({ id, name })), accounts: list.map(publicAccount) });
        }

        // POST /api/accounts
        if (api[0] === "accounts" && api.length === 1 && req.method === "POST") {
            const body = await readJsonBody(req);
            const name = String(body.name || "").trim();
            if (!name) return send(res, 400, { ok: false, error: "账号名称不能为空" });
            const provider = String(body.provider || DEFAULT_PROVIDER);
            if (!PROVIDERS[provider]) return send(res, 400, { ok: false, error: `不支持的站点: ${provider}` });
            const accounts = readAccounts();
            const account = { id: newId(), name, provider, createdAt: new Date().toISOString() };
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

            // POST /api/accounts/:id/qr-login —— 应用内扫码：向该账号所属站点申请二维码，图片回传给前端
            if (action === "qr-login" && req.method === "POST") {
                const existing = qrProcesses.get(account.id);
                if (existing && !existing.killed) {
                    // 再次点击视为「换一张二维码」：结束上一次再重新申请
                    existing.kill();
                    qrProcesses.delete(account.id);
                }
                const site = providerOf(account);
                if (site.id === DEFAULT_PROVIDER && !fs.existsSync(PYTHON_BIN)) {
                    return send(res, 500, { ok: false, error: `找不到 Python：${PYTHON_BIN}（豆包扫码登录依赖 .doubao-venv，请确认它已存在）` });
                }
                // 浏览器扫码要用账号 profile：先把查看窗口收起来，否则 profile 被占用会起不来
                if (site.id !== DEFAULT_PROVIDER) await closeViewer(account.id);
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
                res.writeHead(200, { "content-type": "image/png", "content-length": stat.size, "cache-control": "no-store", ...fileCorsHeaders(req) });
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
            const buffer = await readBody(req, 128 * 1024 * 1024);
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

            // 账号调度：manual 模式必须使用用户明确选定的账号；auto 模式才按顺序轮询。
            // provider 由模型决定（豆包模型 / Dola 模型），保证不会拿豆包账号去跑 Dola 模型。
            const mode = String(body.accountSelectionMode || "manual");
            const capability = String(body.capability || VIDEO_CAPABILITY);
            const provider = String(body.provider || "");
            if (provider && !PROVIDERS[provider]) {
                return send(res, 400, { ok: false, error: { reason: "INVALID_PROVIDER", message: `不支持的站点: ${provider}` } });
            }
            const accountResult = pickAccountByMode(mode, String(body.accountId || ""), capability, provider);
            if (!accountResult.ok) {
                return send(res, 400, { ok: false, error: { reason: accountResult.reason, message: accountResult.message } });
            }
            const account = accountResult.account;
            // 注意：不检查 busy/并发——并发槽位在下面统一占用
            const rawAttachments = (Array.isArray(body.attachments) ? body.attachments : []).map(String).filter(Boolean);
            const attachments = rawAttachments.filter((file) => fs.existsSync(file));
            // 参考素材缺失不能静默丢掉：否则前端以为按参考图/视频提交，实际退化成纯文本生成。
            if (attachments.length !== rawAttachments.length) {
                return send(res, 400, { ok: false, error: { reason: "ATTACHMENT_MISSING", message: "参考素材文件不存在，请重新上传后再生成" } });
            }
            // P0: 新任务必须显式传 expectedArtifactKind，不允许用中文 capability 推断
            const expectedArtifactKind = String(body.expectedArtifactKind || "");
            if (!["image", "video", "text"].includes(expectedArtifactKind)) {
                return send(res, 400, { ok: false, error: { reason: "INVALID_ARTIFACT_KIND", message: "必须指定 expectedArtifactKind (image/video/text)" } });
            }
            const modelName = body.modelName ? String(body.modelName) : null;
            const requestedParams = body.requestedParams && typeof body.requestedParams === "object" ? body.requestedParams : null;
            const split = resolveRequestedParams(requestedParams, expectedArtifactKind);
            const normalized = normalizeAppliedParams(split.appliedParams, expectedArtifactKind);
            const appliedParams = {
                ...normalized.appliedParams,
                ...(modelName ? { model: modelName } : {}),
                ...(attachments.length ? { attachmentCount: attachments.length } : {}),
            };
            const unsupportedParams = [...split.unsupportedParams, ...normalized.unsupportedParams];
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
                // 换号说明（例如「豆包1」视频生成额度不足 → 已按号池顺序改用「豆包2」）
                accountSelectionMessage: accountResult.message || null,
                prompt,
                capability,
                // 本次走哪个站点（豆包 / Dola）：由模型决定，账号必须同站点
                provider: providerOf(account).id,
                providerName: providerOf(account).name,
                mode: String(body.mode || "text-to-video"),
                expectedArtifactKind, // 明确期望产物类型：image / video
                // 用户在节点里选的模型与参数：原样记录，是否被豆包采用由 actualParams（解析原文）说话
                modelName,
                requestedParams,
                // 实际提交给执行器的参数（已按网页端能力收敛）与未提交参数
                appliedParams,
                unsupportedParams,
                actualParams: null,
                attachments,
                status: "queued",
                createdAt: new Date().toISOString(),
                progress: "准备中…",
                stderrLines: [],
                files: [],
                text: "",
                error: null,
            };
            // 并发槽位：满员直接拒绝，不排队堆在内存里抢同一个窗口
            const releaseSlot = acquireJobSlot(account.id);
            if (!releaseSlot) {
                return send(res, 429, {
                    ok: false,
                    error: {
                        reason: "ACCOUNT_BUSY",
                        message: `该账号已有 ${MAX_JOBS_PER_ACCOUNT} 个任务在并行执行，请稍后再试（可用 DOUBAO_MAX_PARALLEL 调整上限）`,
                    },
                });
            }
            jobs.set(job.id, job);
            jobOrder.push(job.id);
            void enqueue(job, releaseSlot);
            return send(res, 200, { ok: true, job: { id: job.id, status: job.status } });
        }

        // GET /api/jobs
        if (api[0] === "jobs" && api.length === 1 && req.method === "GET") {
            const nodeId = url.searchParams.get("nodeId");
            const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || 50) || 50));
            const list = listJobs(limit, nodeId);
            return send(res, 200, { ok: true, jobs: list });
        }

        // POST /api/jobs/:id/cancel —— 真正停掉后台 Runner（前端取消/重新生成时调用）
        if (api[0] === "jobs" && api.length === 3 && api[2] === "cancel" && req.method === "POST") {
            const job = jobs.get(api[1]);
            if (!job) return send(res, 404, { ok: false, error: "任务不存在" });
            if (job.status === "succeeded" || job.status === "failed") return send(res, 200, { ok: true, canceled: false, status: job.status });
            job.cancelRequested = true;
            job.status = "failed";
            job.error = { reason: "CANCELED", message: "用户取消" };
            job.finishedAt = new Date().toISOString();
            killProcessTree(job.runnerPid);
            return send(res, 200, { ok: true, canceled: true, status: job.status });
        }

        // GET /api/jobs/:id
        if (api[0] === "jobs" && api.length === 2 && req.method === "GET") {
            const job = jobs.get(api[1]) || recoverJob(api[1]);
            if (!job) return send(res, 404, { ok: false, error: "任务不存在" });
            const summary = listJobs(1000).find((item) => item.id === job.id);
            return send(res, 200, {
                ok: true,
                job: {
                    ...(summary || {
                        id: job.id,
                        nodeId: job.nodeId ?? null,
                        accountId: job.accountId,
                        accountName: job.accountName,
                        provider: job.provider,
                        prompt: job.prompt,
                        capability: job.capability,
                        mode: job.mode,
                        modelName: job.modelName ?? null,
                        requestedParams: job.requestedParams ?? null,
                        appliedParams: job.appliedParams ?? null,
                        unsupportedParams: job.unsupportedParams ?? null,
                        actualParams: job.actualParams ?? null,
                        status: job.status,
                        createdAt: job.createdAt,
                        finishedAt: job.finishedAt ?? null,
                        elapsedMs: job.elapsedMs ?? null,
                        files: job.files || [],
                        text: job.text || "",
                        error: job.error || null,
                    }),
                    progress: job.progress,
                    stderr: tail((job.stderrLines || []).join("\n"), 12),
                    modes: job.modes || null,
                    confirmRounds: job.confirmRounds ?? null,
                },
            });
        }

        // GET /api/jobs/:id/files/:index —— 下载真实产物（支持 Range：视频边下边播 / 拖进度都要分段）
        if (api[0] === "jobs" && api[2] === "files" && api.length === 4 && req.method === "GET") {
            const job = jobs.get(api[1]) || recoverJob(api[1]);
            const index = Number(api[3]);
            let file = job?.files?.[index];
            // 内存里没有（桥接重启过 / 任务早被淘汰）：退回磁盘索引，再退回按 jobId 扫描下载目录
            if ((!file || !fs.existsSync(file.path)) && Number.isInteger(index)) {
                const persisted = readJobFiles(api[1]);
                const fallback = Array.isArray(persisted) ? persisted[index] : null;
                if (fallback?.path && fs.existsSync(fallback.path)) file = fallback;
                else {
                    const restored = recoverJob(api[1])?.files?.[index];
                    if (restored?.path && fs.existsSync(restored.path)) file = restored;
                }
            }
            if (!file || !fs.existsSync(file.path)) {
                // 别让浏览器把 404 缓存住：文件补上之后画布刷新还能正常播
                res.writeHead(404, { "cache-control": "no-store", ...fileCorsHeaders(req) });
                return res.end("file not found");
            }
            const stat = fs.statSync(file.path);
            const type = file.contentType || "application/octet-stream";
            const disposition = `attachment; filename="${encodeURIComponent(file.name)}"`;
            const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
            if (range && (range[1] || range[2])) {
                let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
                let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
                end = Math.min(end, stat.size - 1);
                if (!Number.isFinite(start) || start > end || start >= stat.size) {
                    res.writeHead(416, { "content-range": `bytes */${stat.size}`, ...fileCorsHeaders(req) });
                    return res.end();
                }
                res.writeHead(206, {
                    "content-type": type,
                    "content-length": end - start + 1,
                    "content-range": `bytes ${start}-${end}/${stat.size}`,
                    "accept-ranges": "bytes",
                    "content-disposition": disposition,
                    ...fileCorsHeaders(req),
                    "access-control-expose-headers": "content-range,content-length",
                });
                fs.createReadStream(file.path, { start, end }).pipe(res);
                return;
            }
            res.writeHead(200, {
                "content-type": type,
                "content-length": stat.size,
                "accept-ranges": "bytes",
                "content-disposition": disposition,
                ...fileCorsHeaders(req),
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
