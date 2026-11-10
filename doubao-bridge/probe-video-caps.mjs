// 读取豆包「视频生成」面板的真实参数：模型下拉、比例/时长下拉的可选值。
// 用账号自己的 profile（屏幕外窗口），只读不改，不发送任何内容。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const stateDir = path.resolve(process.argv[2]);
process.env.DBB_STATE_DIR = stateDir;
const dbbRoot = path.resolve(import.meta.dirname, "..", "vendor", "doubao-brain", "dbb");
const { depsEntry, findBrowser } = await import(pathToFileURL(path.join(dbbRoot, "src", "browser.mjs")).href);
const site = await import(pathToFileURL(path.join(dbbRoot, "src", "site.mjs")).href);
const found = findBrowser();
const pw = await import(pathToFileURL(depsEntry()).href);
const chromium = (pw.default ?? pw).chromium;

const ctx = await chromium.launchPersistentContext(path.join(stateDir, "profile"), {
    executablePath: found?.executablePath,
    headless: false,
    viewport: null,
    locale: "zh-CN",
    args: ["--window-position=-2400,-2400", "--window-size=1440,960", "--no-first-run", "--no-default-browser-check"],
});

const readMenus = async (page) =>
    page.evaluate(() => {
        const items = [...document.querySelectorAll('[role="menuitem"], [role="option"], [role="listbox"] li, [class*="menu"] [class*="item"], [class*="dropdown"] [class*="item"]')]
            .map((el) => (el.innerText || "").trim().split("\n")[0].slice(0, 40))
            .filter(Boolean);
        return [...new Set(items)];
    });

const clickByTextPrefix = async (page, prefix) => {
    const box = await page.evaluate((p) => {
        const el = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")].find((e) => {
            const t = (e.innerText || "").trim();
            const r = e.getBoundingClientRect();
            return t.startsWith(p) && r.width > 30 && r.height > 16;
        });
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.innerText || "").trim().slice(0, 40) };
    }, prefix);
    if (!box) return null;
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(1200);
    return box.text;
};

let result = { ok: false, error: "not started" };
try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto("https://www.doubao.com/chat/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    const switched = await site.setCapability(page, "视频生成");
    if (!switched?.ok) throw new Error(`切换视频生成失败：${JSON.stringify(switched)}`);
    await page.waitForTimeout(2500);

    const labels = await page.evaluate(() => {
        const hits = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")]
            .map((el) => (el.innerText || "").trim().replace(/\s+/g, " "))
            .filter((t) => t && t.length < 32 && /模型|自动|秒|s$|p$|比例|分辨率|时长/.test(t));
        return [...new Set(hits)].slice(0, 12);
    });

    const modelButton = await clickByTextPrefix(page, "模型");
    const rawModelOptions = modelButton ? await readMenus(page) : [];
    // 菜单里会混进套餐/其它项，只保留真正的模型名
    const modelOptions = rawModelOptions.filter((t) => /^(Seedance|Seedream|豆包|Doubao)/i.test(t));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    // 参数下拉：形如「自动 · 10s」，且在输入区（屏幕下方）
    const paramButton = await page.evaluate(() => {
        const viewportH = window.innerHeight;
        const el = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")].find((e) => {
            const t = (e.innerText || "").trim().replace(/\s+/g, " ");
            const r = e.getBoundingClientRect();
            if (r.width < 40 || r.height < 16) return false;
            if (r.y < viewportH * 0.6) return false;
            return /·/.test(t) && /\d+\s*s|自动|比例|时长/.test(t) && t.length < 30;
        });
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.innerText || "").trim().replace(/\s+/g, " ") };
    });
    let paramOptions = [];
    let ratio = { current: null, options: [] };
    let duration = { current: null, min: null, max: null };
    if (paramButton) {
        await page.mouse.click(paramButton.x, paramButton.y);
        await page.waitForTimeout(1400);
        await page.screenshot({ path: path.join("C:/Users/qq308/Documents/deepseek-harness/default-workspace/.tmp", "video-params-open.png") });
        const popover = await page.evaluate(() => {
            // 找到同时包含「比例」和「时长」的浮层
            const box = [...document.querySelectorAll("div")].find((el) => {
                const t = el.innerText || "";
                const r = el.getBoundingClientRect();
                return t.includes("比例") && t.includes("时长") && r.width > 200 && r.height > 120;
            });
            if (!box) return null;
            const buttons = [...box.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")]
                .map((el) => (el.innerText || "").trim().replace(/\s+/g, " "))
                .filter((t) => t && t.length < 12);
            // 滑杆两端的「4s」「15s」与当前值「10s」
            const sliderLabels = (box.innerText.match(/\d+\s*s/g) || []).map((t) => t.replace(/\s+/g, ""));
            const slider = box.querySelector('input[type="range"], [role="slider"]');
            return {
                buttons: [...new Set(buttons)],
                sliderLabels: [...new Set(sliderLabels)],
                sliderValue: slider?.value ?? slider?.getAttribute("aria-valuenow") ?? null,
                text: box.innerText.replace(/\s+/g, " ").slice(0, 200),
            };
        });
        await page.keyboard.press("Escape");
        if (popover) {
            const ratios = popover.buttons.filter((t) => /^(自动|\d+:\d+)$/.test(t));
            ratio = { current: ratios[0] || null, options: ratios };
            const seconds = popover.sliderLabels.map((t) => Number(t.replace("s", ""))).filter((n) => Number.isFinite(n));
            const min = seconds.length ? Math.min(...seconds) : null;
            const max = seconds.length ? Math.max(...seconds) : null;
            // 中间那个值就是当前时长（滑杆上方显示），两端是可选范围
            const current = seconds.find((n) => n !== min && n !== max) ?? (popover.sliderValue ? Number(popover.sliderValue) : null);
            duration = { current, min, max };
            paramOptions = popover.buttons;
        }
    }

    result = {
        ok: true,
        capability: switched.after,
        labels,
        model: { button: modelButton?.replace(/\s+/g, " "), current: (modelButton || "").replace(/^模型\s*/, ""), options: modelOptions },
        ratio,
        duration,
        params: { button: paramButton?.text || null, options: paramOptions },
        readAt: new Date().toISOString(),
    };
    // 存一份给桥接/面板读取
    fs.writeFileSync(path.join(stateDir, "video-caps.json"), JSON.stringify(result, null, 2));
} catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
} finally {
    await ctx.close().catch(() => undefined);
}

console.log(JSON.stringify(result));
