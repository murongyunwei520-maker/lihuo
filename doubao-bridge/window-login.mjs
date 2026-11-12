// 豆包登录窗口：打开真实浏览器窗口让用户自己完成登录，窗口一直开着，
// 直到检测到**真正的会话 cookie**（sessionid / sid_tt / uid_tt …）才保存登录态并关闭。
//
// 为什么不用 dbb login：它把 ttwid / passport_csrf_token 当登录标志，匿名访问就成立，
// 于是「还没扫完」就判定成功、导出空会话并关掉窗口 —— 这正是之前窗口自动关闭的原因。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [stateDirArg, accountIdArg, siteUrlArg, siteNameArg] = process.argv.slice(2);
if (!stateDirArg) {
    console.error("usage: window-login.mjs <stateDir> [accountId] [siteUrl] [siteName]");
    process.exit(2);
}
// 豆包 / Dola 共用这一个登录窗口脚本：站点地址由桥接按账号所属站点传入
const SITE_URL = siteUrlArg || "https://www.doubao.com/chat/";
const SITE_NAME = siteNameArg || "豆包";

const stateDir = path.resolve(stateDirArg);
const outDir = path.join(stateDir, "login-window");
fs.mkdirSync(outDir, { recursive: true });
const statusFile = path.join(outDir, "status.json");

process.env.DBB_STATE_DIR = stateDir;

const dbbRoot = path.resolve(import.meta.dirname, "..", "vendor", "doubao-brain", "dbb");
const { launchBrowser, openPage, exportStorageState } = await import(pathToFileURL(path.join(dbbRoot, "src", "browser.mjs")).href);

const SESSION_COOKIE_RE = /^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|sid_ucp_v1|session_key)$/;
const TIMEOUT_MS = 20 * 60 * 1000;

function writeStatus(patch) {
    fs.writeFileSync(statusFile, JSON.stringify({ accountId: accountIdArg || null, pid: process.pid, updatedAt: new Date().toISOString(), ...patch }, null, 2));
}

function readStatus() {
    try {
        return JSON.parse(fs.readFileSync(statusFile, "utf8"));
    } catch {
        return {};
    }
}

let ctx = null;
try {
    writeStatus({ state: "starting", message: `正在打开${SITE_NAME}登录窗口…` });
    ctx = await launchBrowser({ headless: false });
    const page = await openPage(ctx);
    await page.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => undefined);
    writeStatus({ state: "waiting", message: `窗口已打开：请扫码或登录${SITE_NAME}，完成后会自动保存` });

    const started = Date.now();
    for (;;) {
        if (page.isClosed()) {
            writeStatus({ state: "closed", message: "登录窗口被关闭了" });
            break;
        }
        if (readStatus().state === "cancel") {
            writeStatus({ state: "canceled", message: "已取消登录" });
            break;
        }
        const cookies = await ctx.cookies().catch(() => []);
        const session = cookies.filter((cookie) => SESSION_COOKIE_RE.test(cookie.name));
        if (session.length) {
            writeStatus({ state: "saving", message: "已检测到登录，正在保存登录态…", cookies: session.map((cookie) => cookie.name) });
            // 等页面把登录态写完整（有的 cookie 是登录后才下发）
            await page.waitForTimeout(2000);
            const exported = await exportStorageState(ctx, path.join(stateDir, "storage-state.json")).catch(() => null);
            writeStatus({ state: "logged_in", message: "登录成功", cookies: session.map((cookie) => cookie.name), storageState: Boolean(exported?.ok) });
            break;
        }
        if (Date.now() - started > TIMEOUT_MS) {
            writeStatus({ state: "timeout", message: "等待登录超时（窗口已开 20 分钟）" });
            break;
        }
        await page.waitForTimeout(2000);
    }
} catch (error) {
    writeStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
} finally {
    if (ctx) await ctx.close().catch(() => undefined);
}
