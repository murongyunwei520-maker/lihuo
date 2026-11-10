// 只读诊断：用账号自己的 profile 打开豆包，判断登录态是否仍然有效。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const stateDir = path.resolve(process.argv[2]);
process.env.DBB_STATE_DIR = stateDir;
const dbbRoot = path.resolve(import.meta.dirname, "..", "vendor", "doubao-brain", "dbb");
const { depsEntry, findBrowser } = await import(pathToFileURL(path.join(dbbRoot, "src", "browser.mjs")).href);
const found = findBrowser();
const pw = await import(pathToFileURL(depsEntry()).href);
const chromium = (pw.default ?? pw).chromium;

const SESSION_RE = /^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|sid_ucp_v1)$/;
const ctx = await chromium.launchPersistentContext(path.join(stateDir, "profile"), {
    executablePath: found?.executablePath,
    headless: false,
    viewport: null,
    locale: "zh-CN",
    args: ["--window-position=-2400,-2400", "--window-size=1440,940", "--no-first-run"],
});
const result = {};
try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto("https://www.doubao.com/chat/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);
    const cookies = await ctx.cookies();
    const session = cookies.filter((c) => SESSION_RE.test(c.name)).map((c) => c.name);
    const ui = await page.evaluate(() => {
        const loginBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "登录");
        return {
            url: location.href,
            hasLoginButton: Boolean(loginBtn),
            bodyHead: document.body.innerText.replace(/\s+/g, " ").slice(0, 160),
        };
    });
    result.ok = true;
    result.session = session;
    result.ui = ui;
    result.loggedIn = session.length > 0 && !ui.hasLoginButton;
    await page.screenshot({ path: path.join("C:/Users/qq308/Documents/deepseek-harness/default-workspace/.tmp", "login-state.png") });
} catch (error) {
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
} finally {
    await ctx.close().catch(() => undefined);
}
console.log(JSON.stringify(result));
