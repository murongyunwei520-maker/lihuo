// 把扫码拿到的 cookies 注入该账号的浏览器 profile，并在**同一个浏览器里**验证登录是否生效，
// 生效后才写 storage-state.json。窗口放在屏幕外，用户看不到。
//
// 参考 doubao2api/browser_client.py 的 inject_cookies_and_reload：只传 name/value/domain/path，
// addCookies 后 reload，再用页面状态确认，而不是只看 cookie 齐全。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [stateDirArg, storageStateArg] = process.argv.slice(2);
if (!stateDirArg || !storageStateArg) {
    console.error("usage: inject-cookies.mjs <stateDir> <storageState.json>");
    process.exit(2);
}

const stateDir = path.resolve(stateDirArg);
process.env.DBB_STATE_DIR = stateDir;

const dbbRoot = path.resolve(import.meta.dirname, "..", "vendor", "doubao-brain", "dbb");
const { depsEntry, findBrowser, exportStorageState } = await import(pathToFileURL(path.join(dbbRoot, "src", "browser.mjs")).href);
const found = findBrowser();
const pw = await import(pathToFileURL(depsEntry()).href);
const chromium = (pw.default ?? pw).chromium;

const SESSION_COOKIE_RE = /^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|sid_ucp_v1)$/;
const profile = path.join(stateDir, "profile");
fs.mkdirSync(profile, { recursive: true });

const state = JSON.parse(fs.readFileSync(path.resolve(storageStateArg), "utf8"));
const cookies = (state.cookies || []).map((cookie) => ({ name: cookie.name, value: cookie.value, domain: ".doubao.com", path: "/" }));

const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: found?.executablePath,
    headless: false,
    viewport: null,
    locale: "zh-CN",
    args: ["--window-position=-2400,-2400", "--window-size=1280,900", "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
});

try {
    await ctx.addCookies(cookies);
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto("https://www.doubao.com/chat/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);

    const cookiesNow = await ctx.cookies();
    const session = cookiesNow.filter((cookie) => SESSION_COOKIE_RE.test(cookie.name)).map((cookie) => cookie.name);
    // 页面层面再确认一次：登录后右上角不该还有「登录」按钮
    const stillLoggedOut = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "登录")).catch(() => true);

    if (session.length && !stillLoggedOut) {
        const exported = await exportStorageState(ctx, path.join(stateDir, "storage-state.json")).catch(() => null);
        console.log(JSON.stringify({ ok: true, session, storageState: Boolean(exported?.ok) }));
    } else {
        console.log(JSON.stringify({ ok: false, error: session.length ? "页面仍显示未登录" : "没有会话 cookie", session, stillLoggedOut }));
        process.exitCode = 1;
    }
} catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
} finally {
    await ctx.close().catch(() => undefined);
}
