// 诊断脚本：把站点「生成面板」里的按钮文案、模型菜单原文都 dump 出来。
// 比 probe-models.mjs 更笨但更稳：每一步都截图 + 打印所有候选文案，方便肉眼核对。
//
// 用法：node probe-panel.mjs <accountId> [debugPort]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchProfileContext } from "./lib/doubao-context.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const ACCOUNTS_ROOT = process.env.DOUBAO_ACCOUNTS_DIR || path.join(REPO, ".doubao-accounts");
const OUT = path.join(REPO, "_probe");
fs.mkdirSync(OUT, { recursive: true });

const accountId = process.argv[2];
const debugPort = Number(process.argv[3] || 0) || undefined;
if (!accountId) {
    console.error("usage: probe-panel.mjs <accountId> [debugPort]");
    process.exit(2);
}
const accounts = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_ROOT, "accounts.json"), "utf8")).accounts || [];
const account = accounts.find((item) => item.id === accountId);
if (!account) {
    console.error(`账号不存在: ${accountId}`);
    process.exit(2);
}
const siteUrl =
    (account.provider || "doubao") === "dola"
        ? process.env.DOLA_SITE_URL || "https://www.dola.com/chat/"
        : process.env.DBB_SITE_URL || "https://www.doubao.com/chat/";
const stateDir = path.join(ACCOUNTS_ROOT, accountId, "state");
// 账号的 playwright 依赖装在自己的 state/deps 下，必须先指过去，否则报 playwright-core 未安装
process.env.DBB_STATE_DIR = stateDir;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dumpCandidates = (page) =>
    page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll("button,[role=button],[class*='cursor-pointer'],[role=menuitem],[role=option]")) {
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
            if (!text) continue;
            out.push({ text, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), w: Math.round(rect.width), h: Math.round(rect.height) });
        }
        // 去重（同文案留面积最大的）
        const map = new Map();
        for (const item of out) {
            const prev = map.get(item.text);
            if (!prev || item.w * item.h > prev.w * prev.h) map.set(item.text, item);
        }
        return [...map.values()];
    });

const shot = async (page, name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
    return file;
};

const { ctx } = await launchProfileContext(stateDir, { offscreen: true, size: "1440,940", debugPort });
const log = [];
try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 90000 }).catch((err) => log.push(`goto: ${err.message}`));
    // 等能力栏渲染（慢网下 20~40s）
    let ready = false;
    for (let i = 0; i < 25; i += 1) {
        await sleep(2000);
        const texts = await page.evaluate(() => [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer']")].map((el) => (el.innerText || "").trim()).filter(Boolean));
        if (texts.some((t) => /图像生成|图片生成|视频生成|视频/.test(t))) {
            ready = true;
            log.push(`capability ready at ${i * 2}s`);
            break;
        }
    }
    log.push(`ready=${ready}`);
    log.push(`url=${page.url()}`);
    await page.getByText("我知道了", { exact: true }).first().click({ timeout: 2000 }).catch(() => undefined);
    await shot(page, "01-load");
    const before = await dumpCandidates(page).catch(() => []);
    log.push(`candidates(after load)=${JSON.stringify(before.map((c) => c.text))}`);

    // 逐个尝试打开能力面板
    const capLabels = ["图像生成", "视频生成", "图片生成"];
    for (const label of capLabels) {
        const hit = before.find((c) => c.text === label);
        if (!hit) {
            log.push(`not found cap: ${label}`);
            continue;
        }
        await page.mouse.click(hit.x, hit.y);
        await sleep(5000);
        const after = await dumpCandidates(page).catch(() => []);
        log.push(`--- after click ${label} ---`);
        log.push(`candidates=${JSON.stringify(after.map((c) => c.text))}`);
        await shot(page, `02-${label}`);
        // 找模型按钮（文案以「模型」开头，或含 Seedream/Seedance）
        const modelBtn = after
            .filter((c) => /^模型|^model/i.test(c.text) || /Seedream|Seedance/i.test(c.text))
            .filter((c) => c.y > 300)
            .sort((a, b) => b.y - a.y)[0];
        if (modelBtn) {
            log.push(`open model menu via: ${modelBtn.text} @${modelBtn.x},${modelBtn.y}`);
            await page.mouse.click(modelBtn.x, modelBtn.y);
            await sleep(2000);
            const menu = await dumpCandidates(page).catch(() => []);
            log.push(`menu=${JSON.stringify(menu.map((c) => c.text))}`);
            await shot(page, `03-menu-${label}`);
            await page.keyboard.press("Escape").catch(() => undefined);
            await sleep(800);
        } else {
            log.push(`model button not found for ${label}`);
        }
        const back = await dumpCandidates(page).catch(() => []);
        const chat = back.find((c) => c.text === "对话");
        if (chat) {
            await page.mouse.click(chat.x, chat.y);
            await sleep(2500);
        }
    }
} finally {
    fs.writeFileSync(path.join(OUT, "probe.log"), log.join("\n"), "utf8");
    console.log(log.join("\n"));
    await ctx.close().catch(() => undefined);
}
process.exit(0);
