// 站点扫码登录助手（stdout JSON 行协议）。
//
// 为什么不用 qr-helper.py：那个走的是豆包 passport 接口（doubao2api.QRLogin），
// 拿到的必然是豆包账号的二维码。Dola（国际版）账号体系独立，二维码只能从它自己的登录弹窗里取。
//
// 做法：用**该账号自己的 profile** 离屏打开站点首页 → 点「登录」→ 读弹窗里的二维码（Dola 是
// data:image/png 的 <img>，取不到时退回元素截图）→ 轮询 cookie，拿到真会话后导出 storage-state.json。
// 因为直接用账号 profile，登录态天然落在它的浏览器里，不需要再做 cookie 注入。
//
// 输出行：
//   {"type":"status","state":"waiting","message":"..."}
//   {"type":"qr","base64":"..."}
//   {"type":"cookies","cookies":{...},"storageState":"<path>"}
//   {"type":"failed","message":"..."}
import fs from "node:fs";
import path from "node:path";

import { launchProfileContext, loadDbbBrowser } from "./lib/doubao-context.mjs";

const [stateDirArg, siteUrlArg, cookieDomainArg] = process.argv.slice(2);
if (!stateDirArg || !siteUrlArg) {
    console.error("usage: qr-helper-browser.mjs <stateDir> <siteUrl> [cookieDomain]");
    process.exit(2);
}
const stateDir = path.resolve(stateDirArg);
const siteUrl = siteUrlArg;
process.env.DBB_STATE_DIR = stateDir;

// 真正的会话 cookie：ttwid / passport_csrf_token / odin_tt 匿名访问就有，不能当登录标志。
const SESSION_COOKIE_RE = /^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss|sid_guard|sid_ucp_v1|session_key)$/;
const TIMEOUT_MS = 8 * 60 * 1000;
const HOST_LABEL = (() => {
    try {
        return new URL(siteUrl).hostname.replace(/^www\./, "");
    } catch {
        return "站点";
    }
})();

function emit(payload) {
    process.stdout.write(JSON.stringify(payload) + "\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 关掉 cookie 提示条、地区提示这类挡路弹层（不阻断流程）。 */
async function dismissNotices(page) {
    for (const label of ["我知道了", "OK", "Accept All", "Accept all", "全部接受", "Reject All", "Got it"]) {
        try {
            const box = await page.evaluate((text) => {
                const el = [...document.querySelectorAll("button,[role=button]")].find((node) => (node.innerText || "").trim() === text);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width };
            }, label);
            if (box && box.w > 0) {
                await page.mouse.click(box.x, box.y);
                await sleep(600);
            }
        } catch {
            /* 没有就算了 */
        }
    }
}

/** 点开登录弹窗；已经登录的话返回 false。 */
async function openLoginDialog(page) {
    const box = await page.evaluate(() => {
        const hits = [...document.querySelectorAll("button,[role=button],div")]
            .filter((node) => /^(登录|Log ?in|Sign ?in|登录\/注册)$/i.test((node.innerText || "").trim()))
            .map((node) => {
                const r = node.getBoundingClientRect();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), area: r.width * r.height };
            })
            .filter((item) => item.area > 0);
        hits.sort((a, b) => a.area - b.area);
        return hits[0] || null;
    });
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    await sleep(3000);
    return true;
}

/**
 * 取二维码：优先 data:image 的 <img>（Dola 就是这样），
 * 其次 class 含 qr 的元素截图（canvas 渲染时用）。
 */
async function readQr(page) {
    const dataUrl = await page
        .evaluate(() => {
            const imgs = [...document.querySelectorAll("img")]
                .filter((img) => img.src.startsWith("data:image") && img.getClientRects().length > 0)
                .map((img) => {
                    const r = img.getBoundingClientRect();
                    return { src: img.src, area: r.width * r.height };
                })
                .filter((item) => item.area >= 90 * 90)
                .sort((a, b) => b.area - a.area);
            return imgs[0]?.src || "";
        })
        .catch(() => "");
    if (dataUrl) return { key: dataUrl.length + ":" + dataUrl.slice(-64), base64: dataUrl.split(",")[1] || "" };

    // 兜底：二维码元素截图
    const handle = await page.$("[class*='qrcode'], [class*='qr-code'], [class*='QRCode']").catch(() => null);
    if (handle) {
        try {
            const buffer = await handle.screenshot({ type: "png" });
            return { key: `shot:${buffer.length}`, base64: buffer.toString("base64") };
        } catch {
            return null;
        }
    }
    return null;
}

let ctx = null;
let exited = false;
const finish = async (payload) => {
    if (exited) return;
    exited = true;
    if (payload) emit(payload);
    if (ctx) await ctx.close().catch(() => undefined);
    process.exit(payload?.type === "failed" ? 1 : 0);
};

try {
    emit({ type: "status", state: "starting", message: `正在打开 ${HOST_LABEL}…` });
    ({ ctx } = await launchProfileContext(stateDir, { offscreen: true, size: "1280,900" }));
    const page = ctx.pages()[0] || (await ctx.newPage());

    // 站点在境外，首次打开可能很慢；失败再试一次
    let loaded = false;
    for (let attempt = 1; attempt <= 2 && !loaded; attempt += 1) {
        loaded = await page
            .goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
            .then(() => true)
            .catch(() => false);
        if (!loaded) await sleep(2000);
    }
    if (!loaded) await finish({ type: "failed", message: `打不开 ${siteUrl}（网络或站点不可达）` });

    await sleep(4000);
    await dismissNotices(page);

    // 1) 已经登录了：直接导出
    const existing = (await ctx.cookies()).filter((cookie) => SESSION_COOKIE_RE.test(cookie.name));
    if (existing.length) {
        const { exportStorageState } = await loadDbbBrowser();
        const target = path.join(stateDir, "storage-state.json");
        await exportStorageState(ctx, target).catch(() => undefined);
        emit({ type: "cookies", cookies: Object.fromEntries(existing.map((cookie) => [cookie.name, cookie.value])), storageState: target, alreadyLoggedIn: true });
        await finish(null);
    }

    // 2) 打开登录弹窗，等二维码出现
    emit({ type: "status", state: "waiting", message: `正在向 ${HOST_LABEL} 申请登录二维码…` });
    const opened = await openLoginDialog(page);
    if (!opened) {
        emit({ type: "status", state: "waiting", message: "页面上没有找到「登录」按钮，请在弹出窗口里手动登录" });
    }

    let lastKey = "";
    const started = Date.now();
    // 兜底判定用的基线：有的站点登录后换的是「用户标识」cookie，而不是 sessionid
    const baselineUserId = (await ctx.cookies()).find((cookie) => /^(flow_cur_user_sec_id|flow_user_id|uid_tt|web_id)$/.test(cookie.name))?.value || "";
    /** 已登录？优先看真会话 cookie；否则看「用户标识变了 + 页面不再有登录按钮」。 */
    const findSession = async () => {
        const cookies = await ctx.cookies();
        const session = cookies.filter((cookie) => SESSION_COOKIE_RE.test(cookie.name));
        if (session.length) return session;
        const userId = cookies.find((cookie) => /^(flow_cur_user_sec_id|flow_user_id|uid_tt|web_id)$/.test(cookie.name));
        if (!userId || !baselineUserId || userId.value === baselineUserId) return [];
        const stillLoggedOut = await page
            .evaluate(() => [...document.querySelectorAll("button,[role=button]")].some((node) => /^(登录|Log ?in|Sign ?in)$/i.test((node.innerText || "").trim())))
            .catch(() => true);
        return stillLoggedOut ? [] : [userId];
    };
    while (Date.now() - started < TIMEOUT_MS) {
        // 会话优先：扫完码 cookie 就出现了
        const session = await findSession();
        if (session.length) {
            emit({ type: "status", state: "saving", message: "扫码成功，正在保存登录态…" });
            await sleep(2000);
            const { exportStorageState } = await loadDbbBrowser();
            const target = path.join(stateDir, "storage-state.json");
            const exported = await exportStorageState(ctx, target).catch(() => null);
            if (!exported?.ok) {
                await finish({ type: "failed", message: "登录成功但登录态导出失败" });
            }
            await finish({ type: "cookies", cookies: Object.fromEntries(session.map((cookie) => [cookie.name, cookie.value])), storageState: target });
        }

        const qr = await readQr(page);
        if (qr?.base64 && qr.key !== lastKey) {
            lastKey = qr.key;
            emit({ type: "qr", base64: qr.base64 });
            emit({ type: "status", state: "waiting", message: `请用 ${HOST_LABEL} App 扫码并在手机上确认` });
        } else if (!qr && !opened && Date.now() - started > 15000) {
            // 弹窗没开出来且拿不到二维码：再试一次点击
            await openLoginDialog(page).catch(() => undefined);
        }
        await sleep(1500);
    }
    await finish({ type: "failed", message: "等待扫码超时（8 分钟）" });
} catch (error) {
    await finish({ type: "failed", message: error instanceof Error ? error.message : String(error) });
}
