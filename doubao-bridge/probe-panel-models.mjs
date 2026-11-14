// 读豆包「图像生成 / 视频生成」面板里的真实模型清单。
// 通过 CDP 连到已打开的那个豆包窗口（不新开窗口、不动用户正在看的内容），
// 只在新标签页里操作，读完就把标签页关掉。
//
// 用法：node probe-panel-models.mjs <accountId> [图像生成|视频生成]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectViewer } from "./lib/doubao-context.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const ACCOUNTS_ROOT = process.env.DOUBAO_ACCOUNTS_DIR || path.join(REPO, ".doubao-accounts");
const OUT = path.join(REPO, "_probe");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const accountId = process.argv[2];
const capabilities = process.argv[3] ? [process.argv[3]] : ["图像生成", "视频生成"];
const accounts = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_ROOT, "accounts.json"), "utf8")).accounts || [];
const account = accounts.find((item) => item.id === accountId);
if (!account) {
    console.error(`账号不存在: ${accountId}`);
    process.exit(2);
}
const stateDir = path.join(ACCOUNTS_ROOT, accountId, "state");
// 依赖装在账号自己的 state 下，必须先指过去（否则报 playwright-core 未安装 / 连不上窗口）
process.env.DBB_STATE_DIR = stateDir;
const siteUrl = (account.provider || "doubao") === "dola" ? "https://www.dola.com/chat/" : "https://www.doubao.com/chat/";

const connected = await connectViewer(stateDir);
if (!connected) {
    console.error("连不上已打开的豆包窗口：先在左侧账号池点「打开」");
    process.exit(3);
}
const { ctx } = connected;
const page = await ctx.newPage();
const result = {};
try {
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
    for (let i = 0; i < 25; i += 1) {
        await sleep(2000);
        const ok = await page.evaluate(() => [...document.querySelectorAll("div,span,button")].some((n) => (n.innerText || "").trim() === "图像生成"));
        if (ok) break;
    }
    for (const capability of capabilities) {
        // 聚焦输入框 → 点能力胶囊（新版必须先聚焦，否则点击被吞）
        const composer = await page.evaluate(() => {
            const el = document.querySelector('[contenteditable="true"], textarea');
            const r = el?.getBoundingClientRect();
            return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
        });
        if (composer) await page.mouse.click(composer.x, composer.y).catch(() => undefined);
        await sleep(600);
        const pill = await page.evaluate((label) => {
            const vh = window.innerHeight;
            const el = [...document.querySelectorAll("div,span,button,[role=button]")]
                .filter((n) => (n.innerText || "").trim() === label && n.getBoundingClientRect().top > vh * 0.6)
                .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }, capability);
        if (!pill) {
            result[capability] = { error: "没找到能力入口" };
            continue;
        }
        await page.mouse.click(pill.x, pill.y);
        await sleep(7000);
        // 模式里的模型按钮：文案含 Seedream / Seedance / 「模型」
        const trigger = await page.evaluate(() => {
            const vh = window.innerHeight;
            const hits = [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer'],div,span")]
                .filter((el) => {
                    const text = (el.innerText || "").trim().replace(/\s+/g, " ");
                    const r = el.getBoundingClientRect();
                    return r.top > vh * 0.45 && r.width > 40 && r.height > 16 && r.height < 90 && text.length < 40 && /Seedream|Seedance|Dreamina|^模型/i.test(text);
                })
                .map((el) => {
                    const r = el.getBoundingClientRect();
                    return { text: (el.innerText || "").trim().replace(/\s+/g, " "), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), area: r.width * r.height };
                })
                .sort((a, b) => a.area - b.area);
            return hits[0] || null;
        });
        if (!trigger) {
            const bottom = await page.evaluate(() => {
                const vh = window.innerHeight;
                return [...document.querySelectorAll("div,span,button,[role=button]")]
                    .filter((el) => el.children.length <= 1 && el.getBoundingClientRect().top > vh * 0.5 && (el.innerText || "").trim())
                    .map((el) => (el.innerText || "").trim().slice(0, 24));
            });
            result[capability] = { error: "没找到模型按钮", bottom: [...new Set(bottom)] };
            continue;
        }
        await page.mouse.click(trigger.x, trigger.y);
        await sleep(2500);
        const options = await page.evaluate(() => {
            const items = [...document.querySelectorAll("[role='menuitem'],[role='option'],[role='listitem'],li,div[class*='item'],div[class*='option']")]
                .filter((el) => {
                    const r = el.getBoundingClientRect();
                    const text = (el.innerText || "").trim();
                    return r.width > 60 && r.height > 18 && r.height < 120 && text.length > 1 && text.length < 40;
                })
                .map((el) => (el.innerText || "").trim().replace(/\s+/g, " ").split("\n")[0]);
            return [...new Set(items)];
        });
        result[capability] = { trigger: trigger.text, options: options.filter((text) => /Seedream|Seedance|Dreamina|豆包|Dola|Model|模型/i.test(text)) };
        await page.keyboard.press("Escape").catch(() => undefined);
        await sleep(800);
        // 回到对话，准备下一个能力
        const chat = await page.evaluate(() => {
            const vh = window.innerHeight;
            const el = [...document.querySelectorAll("div,span,button,[role=button]")]
                .filter((n) => (n.innerText || "").trim() === "对话" && n.getBoundingClientRect().top > vh * 0.6)
                .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        });
        if (chat) await page.mouse.click(chat.x, chat.y).catch(() => undefined);
        await sleep(3000);
    }
} finally {
    fs.writeFileSync(path.join(OUT, "panel-models.json"), JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 1));
    await page.close().catch(() => undefined);
}
process.exit(0);
