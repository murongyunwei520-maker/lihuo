// 每个账号一个常驻豆包窗口：点击号池里的账号时打开（已开则前置），不新开窗口。
// 由 doubao-bridge 管理生命周期；窗口一直开着，直到用户点关闭或超时。
import fs from "node:fs";
import path from "node:path";

import { launchProfileContext } from "./lib/doubao-context.mjs";

const [stateDirArg, accountIdArg, portArg] = process.argv.slice(2);
if (!stateDirArg) {
    console.error("usage: open-account.mjs <stateDir> [accountId] [debugPort]");
    process.exit(2);
}

const stateDir = path.resolve(stateDirArg);
const debugPort = Number(portArg || 0);
const outDir = path.join(stateDir, "viewer");
fs.mkdirSync(outDir, { recursive: true });
const statusFile = path.join(outDir, "status.json");

process.env.DBB_STATE_DIR = stateDir;

function writeStatus(patch) {
    fs.writeFileSync(statusFile, JSON.stringify({ accountId: accountIdArg || null, pid: process.pid, debugPort, updatedAt: new Date().toISOString(), ...patch }, null, 2));
}

let ctx = null;
try {
    writeStatus({ state: "starting", message: "正在打开豆包…" });
    // 显式指定窗口位置：profile 里可能存着之前「离屏探测」留下的坐标，会把窗口开到屏幕外
    ({ ctx } = await launchProfileContext(stateDir, { position: "60,40", size: "1440,940", debugPort }));
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto("https://www.doubao.com/chat/", { waitUntil: "commit", timeout: 30000 }).catch(() => undefined);
    writeStatus({ state: "open", message: "豆包网页端已打开" });

    // 一直挂着，直到收到关闭信号（用户点关闭 / 关窗 / 超时 2 小时）
    const started = Date.now();
    for (;;) {
        if (page.isClosed()) {
            writeStatus({ state: "closed", message: "窗口被关闭" });
            break;
        }
        let current = {};
        try {
            current = JSON.parse(fs.readFileSync(statusFile, "utf8"));
        } catch {
            current = {};
        }
        if (current.state === "closing") {
            writeStatus({ state: "closed", message: "已关闭" });
            break;
        }
        // 不自动超时关闭：任务要靠这个窗口，关掉会让正在跑的任务失败。
        // 只有用户关窗、或桥接调 /close 才会结束。
        await page.waitForTimeout(2000);
    }
} catch (error) {
    writeStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
} finally {
    if (ctx) await ctx.close().catch(() => undefined);
}
