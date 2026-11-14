// 读站点面板里的真实模型清单（诊断脚本，豆包 / Dola 通用）。
//
// 用法：node probe-models.mjs <accountId>
// 输出：{"provider":"dola","image":["Seedream 5.0 Pro", ...],"video":["Seedance 2.0", ...]}
// 同时写 <ACCOUNTS_ROOT>/<provider>-models.json，方便和 web/src/constants/doubao-builtin.ts 对照。
//
// 注意：站点要求登录后才能打开图像/视频面板，所以这个脚本要用**已登录**的账号跑；
// 跑之前先把该账号的窗口关掉（profile 会被占用）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchProfileContext } from "./lib/doubao-context.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const ACCOUNTS_ROOT = process.env.DOUBAO_ACCOUNTS_DIR || path.join(REPO, ".doubao-accounts");

const PROVIDERS = {
    doubao: { name: "豆包", siteUrl: process.env.DBB_SITE_URL || "https://www.doubao.com/chat/", image: process.env.DBB_CAP_IMAGE || "图像生成", video: process.env.DBB_CAP_VIDEO || "视频生成" },
    dola: { name: "Dola", siteUrl: process.env.DOLA_SITE_URL || "https://www.dola.com/chat/", image: process.env.DOLA_CAP_IMAGE || "图像生成", video: process.env.DOLA_CAP_VIDEO || "视频生成" },
};

const accountId = process.argv[2];
if (!accountId) {
    console.error("usage: probe-models.mjs <accountId>");
    process.exit(2);
}
const accounts = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_ROOT, "accounts.json"), "utf8")).accounts || [];
const account = accounts.find((item) => item.id === accountId);
if (!account) {
    console.error(`账号不存在: ${accountId}`);
    process.exit(2);
}
const site = PROVIDERS[account.provider || "doubao"] || PROVIDERS.doubao;
const stateDir = path.join(ACCOUNTS_ROOT, accountId, "state");
process.env.DBB_STATE_DIR = stateDir;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 用真实鼠标点一个文案完全一致的按钮（DOM .click() 在 React 上常常无效）。 */
async function clickText(page, label) {
    const box = await page.evaluate((target) => {
        const hits = [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer']")]
            .filter((el) => (el.innerText || "").trim().replace(/\s+/g, " ") === target)
            .map((el) => {
                const rect = el.getBoundingClientRect();
                return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), area: rect.width * rect.height };
            })
            .filter((item) => item.area > 0);
        hits.sort((a, b) => a.area - b.area);
        return hits[0] || null;
    }, label);
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    return true;
}

const readMenus = (page) =>
    page.evaluate(() => {
        const items = [...document.querySelectorAll("[role='menuitem'],[role='option'],[class*='menu'] [class*='item'],[class*='dropdown'] [class*='item'],[class*='list'] [class*='item']")]
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => (el.innerText || "").trim().replace(/\s+/g, " ").split("\n")[0].slice(0, 40))
            .filter(Boolean);
        return [...new Set(items)];
    });

const { ctx } = await launchProfileContext(stateDir, { offscreen: true, size: "1280,900" });
const result = { provider: account.provider || "doubao", image: [], video: [] };
try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(site.siteUrl, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
    // 能力栏在慢网下要 20~30 秒才渲染：轮询等它出现，别固定等几秒就点
    for (let i = 0; i < 30; i += 1) {
        const ready = await page
            .evaluate((label) => [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer']")].some((el) => el.getClientRects().length > 0 && (el.innerText || "").trim() === label), site.image)
            .catch(() => false);
        if (ready) break;
        await sleep(3000);
    }
    await page.getByText("我知道了", { exact: true }).first().click({ timeout: 2000 }).catch(() => undefined);

    for (const [kind, label] of [["image", site.image], ["video", site.video]]) {
        if (!(await clickText(page, label))) {
            result[`${kind}Error`] = `没找到「${label}」入口（未登录时面板打不开）`;
            continue;
        }
        await sleep(4000);
        // 模型按钮文案形如「模型 Seedream 5.0 Pro」
        const opened = await page.evaluate(() => {
            const viewportH = window.innerHeight;
            const el = [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer']")]
                .filter((node) => {
                    const text = (node.innerText || "").trim().replace(/\s+/g, " ");
                    const rect = node.getBoundingClientRect();
                    return (/^模型|^model/i.test(text) || /·\s*\d+s$/i.test(text)) && rect.y > viewportH * 0.5 && rect.width > 40;
                })
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
                })
                .sort((a, b) => b.y - a.y)[0];
            return el || null;
        });
        if (!opened) {
            result[`${kind}Error`] = "面板里没找到模型按钮";
            continue;
        }
        await page.mouse.click(opened.x, opened.y);
        await sleep(1500);
        result[kind] = (await readMenus(page)).filter((text) => /Seedream|Seedance|豆包|Doubao|Model|模型/i.test(text));
        await page.keyboard.press("Escape");
        await sleep(600);
        // 回对话，准备下一个能力
        await clickText(page, "对话");
        await sleep(2500);
    }
} finally {
    await ctx.close().catch(() => undefined);
}

const outFile = path.join(ACCOUNTS_ROOT, `${result.provider}-models.json`);
fs.writeFileSync(outFile, JSON.stringify({ ...result, accountId, at: new Date().toISOString() }, null, 2));
console.log(JSON.stringify(result, null, 1));
console.log(`已写入 ${outFile}`);
process.exit(0);
