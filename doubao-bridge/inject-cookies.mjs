// 把扫码拿到的 cookies 注入该账号的浏览器 profile，并在同一个浏览器里验证登录是否生效，
// 生效后才写 storage-state.json。窗口放在屏幕外，用户看不到。
import fs from "node:fs";
import path from "node:path";

import { launchProfileContext, loadDbbBrowser } from "./lib/doubao-context.mjs";

const [stateDirArg, storageStateArg, siteUrlArg, cookieDomainArg] = process.argv.slice(2);
if (!stateDirArg || !storageStateArg) {
    console.error("usage: inject-cookies.mjs <stateDir> <storageState.json> [siteUrl] [cookieDomain]");
    process.exit(2);
}
// 豆包 / Dola 共用：站点地址与 cookie 域名由调用方按账号所属站点传入
const SITE_URL = siteUrlArg || "https://www.doubao.com/chat/";
const COOKIE_DOMAIN = cookieDomainArg || ".doubao.com";

const stateDir = path.resolve(stateDirArg);
process.env.DBB_STATE_DIR = stateDir;

const SESSION_COOKIE_RE = /^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|sid_ucp_v1)$/;
const state = JSON.parse(fs.readFileSync(path.resolve(storageStateArg), "utf8"));
const cookies = (state.cookies || []).map((cookie) => ({ name: cookie.name, value: cookie.value, domain: COOKIE_DOMAIN, path: "/" }));

const { ctx } = await launchProfileContext(stateDir, { offscreen: true, size: "1280,900" });
const { exportStorageState } = await loadDbbBrowser();
try {
    await ctx.addCookies(cookies);
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(SITE_URL, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(4000);

    const session = (await ctx.cookies()).filter((cookie) => SESSION_COOKIE_RE.test(cookie.name)).map((cookie) => cookie.name);
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
