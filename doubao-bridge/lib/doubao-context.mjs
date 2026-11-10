// 豆包桥接的公共浏览器工具：统一加载 dbb 依赖、启动/连接账号 profile。
// 之前 open-account / window-login / inject-cookies / probe-* 各自复制了一遍样板，这里收敛成一份。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 本文件在 doubao-bridge/lib/，仓库根要往上两级
export const DBB_ROOT = path.resolve(HERE, "..", "..", "vendor", "doubao-brain", "dbb");

/** 加载 dbb 的浏览器模块（findBrowser / depsEntry 等）。 */
export async function loadDbbBrowser() {
    return import(pathToFileURL(path.join(DBB_ROOT, "src", "browser.mjs")).href);
}

/** 加载账号状态目录里安装的 playwright-core，并返回 chromium 与系统浏览器路径。 */
export async function loadChromium() {
    const { depsEntry, findBrowser } = await loadDbbBrowser();
    const pw = await import(pathToFileURL(depsEntry()).href);
    const chromium = (pw.default ?? pw).chromium;
    return { chromium, browser: findBrowser() };
}

/**
 * 用账号 profile 启动有头浏览器。
 * offscreen=true 时把窗口挪到屏幕外（诊断脚本用，不打扰用户）。
 */
export async function launchProfileContext(stateDir, options = {}) {
    const { chromium, browser } = await loadChromium();
    const profile = path.join(stateDir, "profile");
    fs.mkdirSync(profile, { recursive: true });
    const position = options.position || (options.offscreen ? "-2400,-2400" : "80,60");
    const size = options.size || "1440,940";
    const args = [`--window-position=${position}`, `--window-size=${size}`, "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"];
    if (options.debugPort) args.push(`--remote-debugging-port=${options.debugPort}`);
    const ctx = await chromium.launchPersistentContext(profile, {
        executablePath: browser?.executablePath,
        headless: false,
        viewport: null,
        locale: "zh-CN",
        args,
    });
    return { ctx, browser };
}

/** 读该账号查看器（viewer）的调试端口。 */
export function readViewerPort(stateDir) {
    try {
        const status = JSON.parse(fs.readFileSync(path.join(stateDir, "viewer", "status.json"), "utf8"));
        return Number(status.debugPort) || 0;
    } catch {
        return 0;
    }
}

/** 通过 CDP 连上已在运行的那个豆包窗口；连不上返回 null。 */
export async function connectViewer(stateDir) {
    const port = readViewerPort(stateDir);
    if (!port) return null;
    try {
        const { chromium } = await loadChromium();
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const ctx = browser.contexts()[0];
        if (!ctx) {
            await browser.close().catch(() => undefined);
            return null;
        }
        return { browser, ctx, port };
    } catch {
        return null;
    }
}
