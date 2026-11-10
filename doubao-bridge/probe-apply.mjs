// 只读验证：在当前豆包窗口里应用「模型/比例/时长」，并读回实际值；同时探测图片上传入口。
// 不会发送任何生成请求。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const stateDir = path.resolve(process.argv[2]);
const wantModel = process.argv[3] || "";
const wantRatio = process.argv[4] || "";
const wantDuration = Number(process.argv[5] || 0);
process.env.DBB_STATE_DIR = stateDir;

const dbbRoot = path.resolve(import.meta.dirname, "..", "vendor", "doubao-brain", "dbb");
const { depsEntry } = await import(pathToFileURL(path.join(dbbRoot, "src", "browser.mjs")).href);
const site = await import(pathToFileURL(path.join(dbbRoot, "src", "site.mjs")).href);
const pw = await import(pathToFileURL(depsEntry()).href);
const chromium = (pw.default ?? pw).chromium;

const statusFile = path.join(stateDir, "viewer", "status.json");
const viewer = JSON.parse(fs.readFileSync(statusFile, "utf8"));
const port = Number(viewer.debugPort);
const report = { port, steps: [] };
const log = (message, extra = {}) => {
    report.steps.push({ message, ...extra });
    console.log(JSON.stringify({ message, ...extra }));
};

async function clickBox(page, box) {
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(1200);
}

async function findTrigger(page, matcherSource) {
    return page.evaluate((src) => {
        const matcher = new Function("text", `return ${src}`);
        const vh = window.innerHeight;
        const el = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")].find((node) => {
            const t = (node.innerText || "").trim().replace(/\s+/g, " ");
            const r = node.getBoundingClientRect();
            if (r.width < 30 || r.height < 14 || r.y < vh * 0.55) return false;
            return matcher(t);
        });
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.innerText || "").trim().replace(/\s+/g, " ") };
    }, matcherSource);
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const ctx = browser.contexts()[0];
const page = ctx.pages()[ctx.pages().length - 1] || (await ctx.newPage());
try {
    await page.goto("https://www.doubao.com/chat/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const switched = await site.setCapability(page, "视频生成");
    log("能力切换", { result: switched });
    await page.waitForTimeout(2500);

    // 上传入口探测（只看有没有，不上传）
    const uploadInfo = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="file"]')].map((el) => ({ accept: el.getAttribute("accept"), hidden: el.offsetParent === null }));
        const vh = window.innerHeight;
        const triggers = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer'], div, span")]
            .filter((el) => {
                const t = (el.innerText || "").trim();
                const r = el.getBoundingClientRect();
                return r.width > 12 && r.height > 12 && r.y > vh * 0.5 && (t === "+" || t.includes("参考内容") || t.includes("上传") || t.includes("添加图片"));
            })
            .map((el) => (el.innerText || "").trim().slice(0, 12));
        return { inputs, triggers: [...new Set(triggers)].slice(0, 8) };
    });
    log("上传入口", uploadInfo);

    // 模型
    if (wantModel) {
        const trigger = await findTrigger(page, `text.startsWith("模型")`);
        log("模型按钮", { trigger });
        if (trigger) {
            await clickBox(page, trigger);
            const picked = await page.evaluate((target) => {
                const vh = window.innerHeight;
                const hits = [...document.querySelectorAll("button, [role='menuitem'], [role='option'], div, span")]
                    .map((node) => ({ node, text: (node.innerText || "").trim(), rect: node.getBoundingClientRect() }))
                    .filter((item) => item.text === target && item.rect.width > 12 && item.rect.height > 10 && item.rect.y > vh * 0.3);
                if (!hits.length) return false;
                hits.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
                const r = hits[0].rect;
                window.__pick = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
                return true;
            }, wantModel);
            if (picked) {
                const pick = await page.evaluate(() => window.__pick);
                await clickBox(page, pick);
            }
            await page.keyboard.press("Escape");
            await page.waitForTimeout(800);
            const after = await findTrigger(page, `text.startsWith("模型")`);
            log("模型读回", { after: after?.text || null, ok: Boolean(after && after.text.includes(wantModel)) });
        }
    }

    // 比例 + 时长
    if (wantRatio || wantDuration) {
        const trigger = await findTrigger(page, `/·/.test(text) && /\\d+\\s*s|自动/.test(text)`);
        log("参数按钮", { trigger });
        if (trigger) {
            await clickBox(page, trigger);
            const popover = await page.evaluate(() => {
                const vh = window.innerHeight;
                const box = [...document.querySelectorAll("div")].find((el) => {
                    const t = el.innerText || "";
                    const r = el.getBoundingClientRect();
                    return t.includes("比例") && t.includes("时长") && r.width > 200 && r.height > 100 && r.y > vh * 0.25;
                });
                if (!box) return null;
                const ratios = [...box.querySelectorAll("button, [role='radio'], [role='option'], div, span")]
                    .map((el) => ({ text: (el.innerText || "").trim(), rect: el.getBoundingClientRect() }))
                    .filter((item) => /^(\d+:\d+|自动)$/.test(item.text) && item.rect.width > 12 && item.rect.height > 10);
                const seconds = (box.innerText.match(/\d+\s*s/g) || []).map((t) => Number(t.replace(/\s*s/, "")));
                return { ratios: ratios.map((r) => r.text), seconds: [...new Set(seconds)] };
            });
            log("参数浮层", { popover });

            if (wantRatio) {
                const clicked = await page.evaluate((target) => {
                    const vh = window.innerHeight;
                    const hits = [...document.querySelectorAll("button, [role='radio'], [role='option'], div, span")]
                        .map((node) => ({ text: (node.innerText || "").trim(), rect: node.getBoundingClientRect() }))
                        .filter((item) => item.text === target && item.rect.width > 12 && item.rect.height > 10 && item.rect.y > vh * 0.25);
                    if (!hits.length) return false;
                    hits.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
                    const r = hits[0].rect;
                    window.__ratioPick = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
                    return true;
                }, wantRatio);
                if (clicked) {
                    const pick = await page.evaluate(() => window.__ratioPick);
                    await clickBox(page, pick);
                }
                log("比例点击", { clicked });
            }

            if (wantDuration) {
                const slider = await page.evaluate((value) => {
                    const box = [...document.querySelectorAll("div")].find((el) => {
                        const t = el.innerText || "";
                        const r = el.getBoundingClientRect();
                        return t.includes("时长") && t.includes("s") && r.width > 200 && r.height > 80;
                    });
                    if (!box) return null;
                    const input = box.querySelector('input[type="range"]');
                    const track = [...box.querySelectorAll("div")].find((el) => {
                        const r = el.getBoundingClientRect();
                        return r.width > 150 && r.height < 24 && r.height > 2;
                    });
                    const rect = (input || track)?.getBoundingClientRect();
                    if (!rect) return null;
                    return { x: Math.round(rect.x), y: Math.round(rect.y + rect.height / 2), width: Math.round(rect.width), value };
                }, wantDuration);
                if (slider) {
                    const ratio = Math.min(1, Math.max(0, (wantDuration - 4) / 11));
                    await page.mouse.click(slider.x + Math.round(slider.width * ratio), slider.y);
                    await page.waitForTimeout(800);
                }
                log("时长设置", { slider: Boolean(slider) });
            }

            await page.keyboard.press("Escape");
            await page.waitForTimeout(800);
            const after = await findTrigger(page, `/·/.test(text) && /\\d+\\s*s|自动/.test(text)`);
            log("参数读回", { after: after?.text || null });
        }
    }

    report.ok = true;
} catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.message : String(error);
} finally {
    // 只断开 CDP，不关用户的窗口
    await browser.close().catch(() => undefined);
}
console.log("REPORT:" + JSON.stringify(report));
