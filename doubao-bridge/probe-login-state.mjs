// 只读诊断：用账号自己的 profile 打开豆包，判断登录态是否仍然有效（屏幕外窗口）。
import path from "node:path";

import { launchProfileContext } from "./lib/doubao-context.mjs";

const stateDir = path.resolve(process.argv[2]);
process.env.DBB_STATE_DIR = stateDir;

const SESSION_RE = /^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|sid_ucp_v1)$/;
const { ctx } = await launchProfileContext(stateDir, { offscreen: true });
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
} catch (error) {
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
} finally {
    await ctx.close().catch(() => undefined);
}
console.log(JSON.stringify(result));
