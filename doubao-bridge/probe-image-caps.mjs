// 读豆包面板真实参数（诊断脚本）。结果写 <state>/<caps>.json。
import fs from "node:fs";
import path from "node:path";

import { launchProfileContext, loadDbbBrowser } from "./lib/doubao-context.mjs";

const stateDir = path.resolve(process.argv[2]);
process.env.DBB_STATE_DIR = stateDir;
const { DBB_ROOT } = await import("./lib/doubao-context.mjs");
const site = await import(new URL("src/site.mjs", "file:///" + DBB_ROOT.replace(/\\/g, "/") + "/").href);
const { ctx } = await launchProfileContext(stateDir, { offscreen: true });

const readMenus = (page) =>
    page.evaluate(() => {
        const items = [...document.querySelectorAll('[role="menuitem"], [role="option"], [class*="menu"] [class*="item"], [class*="dropdown"] [class*="item"]')]
            .map((el) => (el.innerText || "").trim().split("\n")[0].slice(0, 40))
            .filter(Boolean);
        return [...new Set(items)];
    });

let result = { ok: false, error: "not started" };
try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto("https://www.doubao.com/chat/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    const switched = await site.setCapability(page, "图像生成");
    if (!switched?.ok) throw new Error(`切换图像生成失败：${JSON.stringify(switched)}`);
    await page.waitForTimeout(2500);

    // 模型
    const modelBox = await page.evaluate(() => {
        const vh = window.innerHeight;
        const el = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")].find((node) => {
            const t = (node.innerText || "").trim().replace(/\s+/g, " ");
            const r = node.getBoundingClientRect();
            return t.startsWith("模型 ") && r.y > vh * 0.55 && r.width > 60;
        });
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.innerText || "").trim().replace(/\s+/g, " ") };
    });
    let modelOptions = [];
    if (modelBox) {
        await page.mouse.click(modelBox.x, modelBox.y);
        await page.waitForTimeout(1200);
        modelOptions = (await readMenus(page)).filter((t) => /^Seedream|^Seedance|^豆包/i.test(t));
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
    }

    // 比例
    const ratioBox = await page.evaluate(() => {
        const vh = window.innerHeight;
        const el = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")].find((node) => {
            const t = (node.innerText || "").trim().replace(/\s+/g, " ");
            const r = node.getBoundingClientRect();
            return t.startsWith("比例") && r.y > vh * 0.55 && r.width > 60;
        });
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.innerText || "").trim().replace(/\s+/g, " ") };
    });
    let ratioOptions = [];
    if (ratioBox) {
        await page.mouse.click(ratioBox.x, ratioBox.y);
        await page.waitForTimeout(1400);
        // 比例浮层是自定义组件，直接从打开的浮层里抓「数字:数字」文本最稳
        ratioOptions = await page.evaluate(() => {
            const seen = new Set();
            const boxes = [...document.querySelectorAll("div")].filter((el) => {
                const r = el.getBoundingClientRect();
                return r.y > window.innerHeight * 0.3 && r.width > 160 && r.height > 70;
            });
            for (const box of boxes.slice(-6)) {
                for (const el of box.querySelectorAll("button, [role='radio'], [role='option'], div, span")) {
                    const text = (el.innerText || "").trim();
                    if (/^(\d+:\d+|自动)$/.test(text)) seen.add(text);
                }
            }
            return [...seen];
        });
        await page.keyboard.press("Escape");
    }

    result = {
        ok: true,
        capability: "图像生成",
        model: { current: (modelBox?.text || "").replace(/^模型\s*/, "") || null, options: modelOptions },
        ratio: { current: (ratioBox?.text || "").replace(/^比例\s*/, "") || null, options: ratioOptions },
        readAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(stateDir, "image-caps.json"), JSON.stringify(result, null, 2));
} catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
} finally {
    await ctx.close().catch(() => undefined);
}
console.log(JSON.stringify(result));
