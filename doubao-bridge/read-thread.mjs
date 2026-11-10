// 用已登录的豆包窗口打开指定对话链接，抓正文并截图（只开一个标签页，用完关闭）。
import path from "node:path";

import { connectViewer } from "./lib/doubao-context.mjs";

const stateDir = path.resolve(process.argv[2]);
const url = process.argv[3];
process.env.DBB_STATE_DIR = stateDir;

const viewer = await connectViewer(stateDir);
if (!viewer) {
    console.error(JSON.stringify({ error: "豆包窗口未打开，先在号池里点一下账号" }));
    process.exit(1);
}
const page = await viewer.ctx.newPage();
try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(9000);
    const info = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        text: document.body.innerText.replace(/\n{3,}/g, "\n\n").slice(0, 12000),
    }));
    await page.screenshot({ path: path.join(process.env.TEMP || ".", "doubao-thread.png"), fullPage: false });
    console.log(JSON.stringify(info));
} finally {
    await page.close().catch(() => undefined);
    await viewer.browser.close().catch(() => undefined);
}
