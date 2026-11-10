// 用已登录的豆包窗口打开指定对话链接，抓正文并截图（只开一个标签页，用完关闭）。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const stateDir = path.resolve(process.argv[2]);
const url = process.argv[3];
process.env.DBB_STATE_DIR = stateDir;
const dbbRoot = path.resolve(import.meta.dirname, "..", "vendor", "doubao-brain", "dbb");
const { depsEntry } = await import(pathToFileURL(path.join(dbbRoot, "src", "browser.mjs")).href);
const pw = await import(pathToFileURL(depsEntry()).href);
const chromium = (pw.default ?? pw).chromium;

const statusFile = path.join(stateDir, "viewer", "status.json");
const viewer = JSON.parse(fs.readFileSync(statusFile, "utf8"));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${viewer.debugPort}`);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(9000);
    const info = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        text: document.body.innerText.replace(/\n{3,}/g, "\n\n").slice(0, 12000),
    }));
    await page.screenshot({ path: "C:/Users/qq308/Documents/deepseek-harness/default-workspace/.tmp/doubao-thread.png", fullPage: false });
    console.log(JSON.stringify(info));
} finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
}
