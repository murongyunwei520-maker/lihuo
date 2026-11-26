// 豆包生成执行器：真正把「模型 / 比例 / 时长 / 素材」应用到豆包页面，再提交并等产物。
// 与 dbb ask 的区别：dbb 只能发 prompt，这里会先点选面板上的模型与参数。
//
// 用法：node run-doubao.mjs <stateDir> <jobSpec.json>
// 输出：一行 {"type":"result",...} 作为最终结果；过程中写 {"type":"progress","message":...}
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const [stateDirArg, specFileArg] = process.argv.slice(2);
const stateDir = path.resolve(stateDirArg);
const spec = JSON.parse(fs.readFileSync(path.resolve(specFileArg), "utf8"));
process.env.DBB_STATE_DIR = stateDir;

const dbbRoot = path.resolve(import.meta.dirname, "..", "vendor", "doubao-brain", "dbb");
const { depsEntry, findBrowser } = await import(pathToFileURL(path.join(dbbRoot, "src", "browser.mjs")).href);
const site = await import(pathToFileURL(path.join(dbbRoot, "src", "site.mjs")).href);
const found = findBrowser();
const pw = await import(pathToFileURL(depsEntry()).href);
const chromium = (pw.default ?? pw).chromium;

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const progress = (message) => emit({ type: "progress", message: String(message).slice(0, 300) });

// 每个任务一个下载目录：并发跑时文件名只带时间戳+序号，共用目录会互相覆盖
const jobId = path.basename(path.resolve(specFileArg), ".json");
const SITE_URL = spec.siteUrl || "https://www.doubao.com/chat/";
const SITE_REFERER = spec.referer || "https://www.doubao.com/";
// 站点能力栏文案（豆包/Dola 可能不同），执行器只按这个标签去点
const SITE_CAPABILITY = spec.siteCapability || spec.capability;
// 文案里用站点名，别再对 Dola 说「豆包」
const SITE_NAME = spec.siteName || (/dola\.com/i.test(SITE_URL) ? "Dola" : "豆包");
const downloadsDir = path.join(stateDir, "downloads", "manual", jobId);
fs.mkdirSync(downloadsDir, { recursive: true });

async function clickText(page, text, options = {}) {
    const box = await page.evaluate(({ label, bottomOnly }) => {
        const viewportH = window.innerHeight;
        const el = [...document.querySelectorAll("button, [role='button'], [role='tab'], [role='option'], [role='menuitem'], div, span")].find((node) => {
            const t = (node.innerText || "").trim().replace(/\s+/g, " ");
            if (t !== label) return false;
            const rect = node.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 8) return false;
            if (bottomOnly && rect.y < viewportH * 0.55) return false;
            return true;
        });
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    }, { label: text, bottomOnly: options.bottomOnly !== false });
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(options.wait ?? 1200);
    return true;
}

async function openMenuByPrefix(page, prefix) {
    const box = await page.evaluate((p) => {
        const viewportH = window.innerHeight;
        const el = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")].find((node) => {
            const t = (node.innerText || "").trim().replace(/\s+/g, " ");
            const rect = node.getBoundingClientRect();
            return t.startsWith(p) && rect.width > 40 && rect.height > 16 && rect.y > viewportH * 0.55;
        });
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    }, prefix);
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(1200);
    return true;
}

/** 打开模型下拉：触发按钮可能显示「模型 …」也可能只显示当前模型名（Seedream / Seedance / Dreamina）。 */
async function openModelMenu(page) {
    const box = await page.evaluate(() => {
        const vh = window.innerHeight;
        const cands = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")]
            .map((node) => ({ text: (node.innerText || "").trim().replace(/\s+/g, " "), rect: node.getBoundingClientRect() }))
            .filter((item) => item.rect.width >= 40 && item.rect.height >= 16 && item.rect.y > vh * 0.4);
        // 取最靠下的匹配项（输入区在底部；侧边栏的会话标题不会匹配这些关键词）
        const hit = cands
            .sort((a, b) => b.rect.y - a.rect.y)
            .find((item) => /^模型/.test(item.text) || /(Seedream|Seedance|Dreamina|豆包|Dola)/i.test(item.text));
        if (!hit) return null;
        return { x: Math.round(hit.rect.x + hit.rect.width / 2), y: Math.round(hit.rect.y + hit.rect.height / 2), text: hit.text };
    });
    if (!box) return null;
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(1200);
    return box.text;
}

/**
 * 在弹层里点选一项（模型名 / 比例）。
 * 精确文案优先，允许选项文案带后缀（豆包有时在模型名后面挂「推荐 / 新」字样）；
 * 点不到时把弹层里看得见的短文本带回去，方便判断是改版还是没打开。
 */
async function pickOption(page, label) {
    const result = await page.evaluate((target) => {
        const viewportH = window.innerHeight;
        const nodes = [...document.querySelectorAll("button, [role='menuitem'], [role='option'], [role='radio'], div, span")];
        // 比例按钮形如「9:16」，在屏幕下半部；排除输入区触发器本身
        const items = nodes
            .map((node) => {
                const text = (node.innerText || "").trim().replace(/\s+/g, " ");
                const rect = node.getBoundingClientRect();
                return { node, text, rect };
            })
            .filter((item) => item.rect.width > 12 && item.rect.height > 10 && item.rect.y > viewportH * 0.25);
        const exact = items.filter((item) => item.text === target);
        // 前缀命中要卡词边界：「Seedance 2.5」不能匹配到「Seedance 2.5 Flash」（那是另一个模型），
        // 所以 target 后面紧跟的字符必须是空格/中文/符号，不能是字母数字。
        const boundary = items.filter((item) => item.text.length > target.length && item.text.startsWith(target) && !/[A-Za-z0-9]/.test(item.text[target.length] || " "));
        // 面板文案可能比请求名长（带后缀说明），也可能短（别的站点少一个 Pro/后缀）：都算命中
        const extended = items.filter((item) => item.text.length > target.length && item.text.startsWith(target) && !boundary.includes(item));
        const family = items.filter((item) => item.text.length >= 6 && target.startsWith(item.text));
        const hits = [...exact, ...boundary, ...extended, ...family];
        if (!hits.length) {
            const nearby = items.filter((item) => item.text.length > 1 && item.text.length < 24).map((item) => item.text);
            return { box: null, options: [...new Set(nearby)].slice(0, 12) };
        }
        const rank = (item) => (item.text === target ? 0 : boundary.includes(item) ? 1 : item.text.startsWith(target) ? 2 : 3);
        // 完全一致的最优先；词边界命中里取文案最短的（「Seedance 2.5 升级」而不是「Seedance 2.5 Flash 升级」）；
        // 同一档里再取面积最小的，最贴近叶子节点
        hits.sort((a, b) => rank(a) - rank(b) || a.text.length - b.text.length || a.rect.width * a.rect.height - b.rect.width * b.rect.height);
        const { rect, text } = hits[0];
        return { box: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }, text, options: [] };
    }, label);
    if (!result?.box) return { ok: false, options: result?.options || [] };
    await page.mouse.click(result.box.x, result.box.y);
    await page.waitForTimeout(900);
    return { ok: true, text: result.text };
}

/** 给下载加个硬超时：CDN 卡住时不能让整个轮询停在这里（豆包/Dola 的签名地址偶尔会这样）。 */
/**
 * 读 mp4 的视频编码。不同站点给的编码不一样：豆包是 H.264（avc1），
 * Dola 的成片是 HEVC（hvc1）——Chrome / Edge 没装 HEVC 解码器时**只能解出时长、画面全黑**。
 */
function videoCodecOf(file) {
    try {
        const buf = fs.readFileSync(file);
        // 一条轨道一个 stsd：音频轨（mp4a）通常排在前面，所以要把所有 stsd 都看一遍，
        // 只认视频轨的编码，不能拿第一个就下结论。
        const codecs = [];
        let index = buf.indexOf("stsd");
        while (index > 0) {
            const entry = index + 4 + 8;
            codecs.push(buf.toString("ascii", entry + 4, entry + 8));
            index = buf.indexOf("stsd", index + 4);
        }
        if (codecs.some((fourcc) => fourcc === "hvc1" || fourcc === "hev1")) return "hevc";
        if (codecs.some((fourcc) => fourcc === "avc1" || fourcc === "avc3")) return "h264";
        if (codecs.some((fourcc) => fourcc === "av01")) return "av1";
        return codecs[0] || "unknown";
    } catch {
        return "unknown";
    }
}

/** 找可用的 ffmpeg：项目自带 > 环境变量 FFMPEG_PATH > PATH。 */
function findFfmpeg() {
    // 自带的那份（vendor/ffmpeg/ffmpeg.exe）优先：不要求用户自己装，也不依赖 PATH
    const bundled = path.resolve(import.meta.dirname, "..", "vendor", "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(bundled)) return bundled;
    const explicit = process.env.FFMPEG_PATH;
    if (explicit && fs.existsSync(explicit)) return explicit;
    const names = process.platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"];
    for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
        for (const name of names) {
            const candidate = path.join(dir, name);
            try {
                if (fs.statSync(candidate).isFile()) return candidate;
            } catch {
                /* 继续找 */
            }
        }
    }
    return "";
}

/** HEVC 的 mp4 在浏览器里解不了（黑屏）：有 ffmpeg 就转成 H.264，没有就如实告诉上层。 */
function ensurePlayableVideo(file) {
    const codec = videoCodecOf(file);
    if (codec !== "hevc") return { file, codec, note: "ok" };
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return { file, codec, note: "hevc-no-ffmpeg" };
    const output = `${file.replace(/\.mp4$/i, "")}-h264.mp4`;
    const result = spawnSync(
        ffmpeg,
        ["-y", "-loglevel", "error", "-i", file, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output],
        { windowsHide: true, timeout: 240000 },
    );
    if (result.status !== 0 || !fs.existsSync(output)) {
        try {
            fs.rmSync(output, { force: true });
        } catch {
            /* ignore */
        }
        return { file, codec, note: "hevc-transcode-failed" };
    }
    rmQuiet(file);
    return { file: output, codec: "h264", note: "transcoded" };
}

/** 删临时文件：失败就忽略，绝不能因为「删不掉」把任务判失败。 */
function rmQuiet(file) {
    try {
        fs.rmSync(file, { force: true });
    } catch {
        /* 沙箱可能拦截批量删除，留着不影响结果 */
    }
}

function withTimeout(promise, ms, fallback) {
    return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/**
 * 读图片真实像素（PNG / JPEG / WebP）。
 * 生成图给的是 CDN 的缩略版本（384x216 之类），必须按真实宽度判断，
 * 否则画布节点上挂的就是一张糊图——文件大小恰好过 100KB，光看字节数根本拦不住。
 */
function imageSizeOf(file) {
    let buf;
    try {
        buf = fs.readFileSync(file);
    } catch {
        return null;
    }
    if (buf.length < 24) return null;
    // PNG: \x89PNG....IHDR 宽高在 16..24
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG: 扫 SOFn 段
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < buf.length) {
            if (buf[offset] !== 0xff) {
                offset += 1;
                continue;
            }
            const marker = buf[offset + 1];
            const length = buf.readUInt16BE(offset + 2);
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
            }
            offset += 2 + (length || 2);
        }
    }
    // WebP (VP8 / VP8L / VP8X)
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
        const kind = buf.toString("ascii", 12, 16);
        if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
        if (kind === "VP8L") {
            const bits = buf.readUInt32LE(21);
            return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    return null;
}

/**
 * 把 CDN 的缩略模板地址还原成原图地址。
 * 字节系图片地址形如 .../<hash>.png~tplv-a9rns2rl98-image-qvalue.png?lk3s=...
 * 「~tplv-」后面那段是模板（决定尺寸/质量），去掉就是原图；签名参数保留仍然有效。
 */
function originalImageUrl(url) {
    const cut = url.indexOf("~tplv-");
    if (cut < 0) return "";
    const head = url.slice(0, cut);
    const queryAt = url.indexOf("?");
    const query = queryAt >= 0 ? url.slice(queryAt) : "";
    return `${head}${query}`;
}

/** 设置时长：优先用滑杆的 range 输入，退化为按轨道位置点击。 */
async function setDuration(page, seconds) {
    const slider = await page.evaluate((value) => {
        const box = [...document.querySelectorAll("div")].find((el) => {
            const t = el.innerText || "";
            const r = el.getBoundingClientRect();
            return t.includes("时长") && t.includes("s") && r.width > 200 && r.height > 80;
        });
        if (!box) return null;
        const input = box.querySelector('input[type="range"]');
        if (input) {
            const rect = input.getBoundingClientRect();
            return { kind: "input", x: Math.round(rect.x), y: Math.round(rect.y + rect.height / 2), width: Math.round(rect.width), min: Number(input.min || 4), max: Number(input.max || 15), value };
        }
        // 退化：找轨道（细长元素），按比例点击
        const track = [...box.querySelectorAll("div")].find((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 150 && r.height < 24 && r.height > 2;
        });
        if (!track) return null;
        const rect = track.getBoundingClientRect();
        return { kind: "track", x: Math.round(rect.x), y: Math.round(rect.y + rect.height / 2), width: Math.round(rect.width), min: 4, max: 15, value };
    }, seconds);
    if (!slider) return false;
    const ratio = Math.min(1, Math.max(0, (seconds - slider.min) / Math.max(1, slider.max - slider.min)));
    await page.mouse.click(slider.x + Math.round(slider.width * ratio), slider.y);
    await page.waitForTimeout(600);
    return true;
}

/** 把光标点进输入框。新版豆包（2026-11 的技能栏）不聚焦输入框时点技能胶囊是空操作，
 *  必须先聚焦再点，否则「切能力没反应」——这正是画布发任务却跑成普通对话的原因。 */
async function focusComposer(page) {
    const box = await page
        .evaluate(() => {
            const el = document.querySelector('[contenteditable="true"], textarea');
            if (!el || !el.getClientRects().length) return null;
            const rect = el.getBoundingClientRect();
            if (rect.width < 40 || rect.height < 10) return null;
            return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        })
        .catch(() => null);
    if (!box) return false;
    await page.mouse.click(box.x, box.y).catch(() => undefined);
    await page.waitForTimeout(400);
    return true;
}

/** 点击能力栏上的「视频生成 / 图像生成」等入口，返回点到的坐标（点不到返回 null）。 */
async function clickCapability(page, capability, options = {}) {
    // 先聚焦输入框：不聚焦时新版技能栏的胶囊点击会被吞掉（实测点 4 次都没反应）
    if (options.focus !== false) await focusComposer(page);
    const box = await page
        .evaluate((label) => {
            const hits = [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer']")]
                .filter((el) => (el.innerText || "").trim() === label)
                .map((el) => {
                    const rect = el.getBoundingClientRect();
                    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), area: rect.width * rect.height };
                })
                .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && item.area > 0);
            // 取面积最小的那颗：同一文案在外层容器上也会命中
            hits.sort((a, b) => a.area - b.area);
            if (hits[0]) return hits[0];
            // 站点可能是英文界面（Dola）：按关键词兜底
            const alias = /视频|video/i.test(label) ? /视频|video/i : /图像|图片|image|picture|photo/i.test(label) ? /图像|图片|image|picture|photo/i : /对话|chat/i;
            const fallback = [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer']")]
                .filter((el) => alias.test((el.innerText || "").trim()))
                .map((el) => {
                    const rect = el.getBoundingClientRect();
                    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), area: rect.width * rect.height };
                })
                .filter((item) => item.area > 0);
            fallback.sort((a, b) => a.area - b.area);
            return fallback[0] || null;
        }, capability)
        .catch(() => null);
    if (!box) return null;
    await page.mouse.click(box.x, box.y);
    return box;
}

/**
 * 生成面板是否已经出现。两代 UI 都要认：
 *  1) 旧版：输入区上方有「模型 / 比例 / 时长」这类参数控件；
 *  2) 新版（2026-11 技能栏）：技能胶囊直接排在输入框里，点「图像生成 / 视频生成」后
 *     胶囊行就地收起、只剩一个模式胶囊（输入框提示语变成「描述你想要的图片」）。
 *     新版没有「模型」控件，只认参数控件会导致永远判「没进面板」，最后把提示词发到普通对话里。
 */
async function hasGenerationPanel(page, capability) {
    const target = capability || SITE_CAPABILITY;
    return page
        .evaluate((label) => {
            const vh = window.innerHeight;
            const vw = window.innerWidth;
            const nodes = [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer'],div,span")];
            // 1) 旧版参数控件
            const hasParams = nodes.some((el) => {
                const text = (el.innerText || "").trim().replace(/\s+/g, " ");
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0 || rect.y < vh * 0.35 || rect.x < vw * 0.2) return false;
                return /^模型|^model/i.test(text) || /^比例|^ratio|^aspect/i.test(text) || /^(自动|auto|\d+:\d+)\s*·/i.test(text) || /·\s*\d+\s*s$/i.test(text);
            });
            if (hasParams) return true;
            // 2) 新版模式胶囊：底部出现与能力同名的胶囊，且技能栏（PPT 生成 / 帮我写作…）已收起
            const bottomish = (rect) => rect.width > 20 && rect.height > 10 && rect.y > vh * 0.55 && rect.x > vw * 0.2;
            const chip = nodes.some((el) => (el.innerText || "").trim() === label && bottomish(el.getBoundingClientRect()));
            if (!chip) return false;
            const skillBar = nodes.some(
                (el) => /^(PPT 生成|帮我写作|录音转写|AI 表格|更多技能)$/.test((el.innerText || "").trim()) && bottomish(el.getBoundingClientRect()),
            );
            return !skillBar;
        }, target)
        .catch(() => false);
}

/** 对话输入框是否就绪（且没有停在「描述你想要的图片 / 视频」这种生成模式里）。 */
async function hasChatComposer(page) {
    return page
        .evaluate(() => {
            const el = document.querySelector('[contenteditable="true"], textarea');
            if (!el || !el.getClientRects().length) return false;
            return !/描述你想要的(图片|视频)|describe the (image|video)/i.test(document.body.innerText || "");
        })
        .catch(() => false);
}

// 两个站点的「回答」容器类名不一样：豆包是 inner-item，Dola 是 data-testid=message-block-container。
// 统一用这套选择器扫描，避免只认一边——Dola 的视频就是这样一直只看到播放器外壳、扫不到 <video>。
const ANSWER_SELECTOR = '[class*="inner-item"], [data-testid="message-block-container"]';
const ANSWER_HINT = "[data-testid='message_content'], [class*='message-action-bar'], [class*='video-player'], [class*='block-video'], div.grid, [class*='suggest-message']";
// 还在排队/正在生成的回答不算「成片」
const PENDING_ANSWER_RE = /预计等待|生成好后|我将为你生成|正在生成|排队中|estimated|generating|i will (create|generate)|will send it/i;
// 明确拒绝 / 没法生成的说法。注意「消耗每日免费额度」那句是排队消息，不能算拒绝。
const REFUSAL_RE = /升级正式订阅|体验套餐不可用|不可用于创作|次数已用完|额度不足|(生成|创作)(失败|出错)|无法生成|内容不符合|出了点问题|请稍后重试|稍后再试|服务(器)?(异常|繁忙)|系统繁忙|网络异常|upgrade|subscription (is )?required|quota|not available in your (plan|region)|failed to generate|something went wrong|try again later|please try again|server (is )?busy/i;
// 额度/订阅用尽这一类「不是内容问题」的拒绝：命中就把账号标成额度不足，并立刻结束任务。
const QUOTA_RE = /额度|配额|订阅|会员|套餐|升级|余额不足|credit|quota|subscription|upgrade|out of (credits|quota)|(reached|hit) (your|the) (daily )?limit|limit (has been )?reached|insufficient/i;
// 额度用完的**强特征**：Dola 说的是「今日视频生成免费数量用完了…开通 Dola 会员」，
// 一个「额度/配额」字都没有，只靠 QUOTA_RE 永远认不出来 → 一直等到 15 分钟超时。
const QUOTA_STRONG_RE = /(免费|每日|今日|当天|体验|试用)[^。！\n]{0,10}(数量|额度|次数|配额|生成)[^。！\n]{0,10}(用完|用尽|用光|不足|上限|限制)|(数量|额度|次数|配额|余额)[^。！\n]{0,6}(已用完|用完了|用尽|用光|不足)|开通[^。！\n]{0,8}(会员|订阅|套餐)|升级[^。！\n]{0,8}(会员|订阅|套餐)|out of (free )?(credits?|quota|generations?)|(credits?|quota)\s*(is\s*)?(used up|exhausted|reached)|reached (your|the) (daily |free )*(limit|cap)|free (video|image|generation)s? (are )?(used up|run out)/i;
// 弹层类提示额外要求「明确的拒绝语气」：避免把侧栏/横幅里「升级会员」这类营销文案当成生成失败
const DENIAL_RE = /不可用|无法|不能|不足|用完|用尽|达上限|已用完|exceeded|out of|reached|insufficient|required|unavailable|not available|upgrade to continue|limit/i;

/**
 * 扫描回答区，统一给所有调用方用：
 * 返回新增回答条数、最新一条成片回答的正文 / 视频 / 图片，以及「有播放器但还没挂 video」时的点击坐标。
 * 只取最外层容器，避免同一个回答被内外层算两次。
 */
async function scanAnswers(page, { fresh = false, pending = "", probePlayer = false } = {}) {
    return page
        .evaluate(
            ({ selector, hint, onlyFresh, pendingSrc, needPlayer, seenSigs, seenCount }) => {
                const visible = (el) => !!el && el.getClientRects().length > 0;
                // 侧栏会话列表也带 inner-item，不能当成回答
                // 用户自己发的那条也用同一套容器：它不是回答，绝不能拿它的文字判断「额度不足 / 已生成」
                const isAnswer = (el) => {
                    if (el.getAttribute("data-testid") === "send_message") return false;
                    const role = el.getAttribute("data-message-role") || el.querySelector("[data-message-role]")?.getAttribute("data-message-role") || "";
                    return !role || role === "assistant";
                };
                const sigOf = (el) => `${(el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 120)}|${el.querySelectorAll("img,video").length}`;
                const seen = new Set(seenSigs || []);
                const all = [...document.querySelectorAll(selector)].filter((el) => visible(el) && !!el.querySelector(hint) && !el.closest("aside, nav, header") && isAnswer(el));
                const answers = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
                // 新回答 = 属性没被标记 且 不在发送前的指纹基线里（站点重渲染会丢属性，只看属性会误认旧回答）
                let freshOnes = onlyFresh ? answers.filter((el) => el.getAttribute("data-lihuo-seen") !== "1" && !seen.has(sigOf(el))) : answers;
                // 同样的提示词重跑时新旧回答可能完全一致：条数比基线多就把多出来的当新的
                if (onlyFresh && !freshOnes.length && answers.length > (seenCount || 0)) freshOnes = answers.slice(seenCount || 0);
                const pendingRe = new RegExp(pendingSrc || "$^", "i");
                const ready = freshOnes.filter((el) => !pendingRe.test((el.innerText || "").replace(/\s+/g, " ")));
                const scope = ready[ready.length - 1] || null;
                const result = { total: answers.length, fresh: freshOnes.length, pending: freshOnes.length - ready.length, text: "", videos: [], images: [], playerBox: null, needScroll: false };
                if (!scope) return result;
                const body = scope.querySelector("[data-testid='message_content'] div.relative.grid, div.relative.grid") || scope;
                result.text = (body.innerText || "").trim();
                // 地址可能在 src，也可能挂载后才写进 currentSrc
                result.videos = [...scope.querySelectorAll("video")].map((video) => video.currentSrc || video.src || "").filter(Boolean);
                // 图片是**懒加载**的：没滚进视口时 <img> 只有一个 data:image/svg+xml 占位符，
                // 真地址要等滚到可见才写进 src / currentSrc（原来这里直接排掉 data:，等于永远拿不到图）。
                // 卡片上的 <img> 往往只是 384x216 的预览图：把 srcset / 外层链接也带上，
                // 由下载侧按「真实像素」挑最大的一张（否则画布拿到的是缩略图）。
                const details = [...scope.querySelectorAll("img")]
                    .map((img) => {
                        const src = img.currentSrc || img.src || "";
                        const srcset = (img.getAttribute("srcset") || "")
                            .split(",")
                            .map((part) => part.trim())
                            .filter(Boolean)
                            .map((part) => {
                                const [u, w] = part.split(/\s+/);
                                return { url: u || "", w: Number.parseInt(w || "0", 10) || 0 };
                            })
                            .sort((a, b) => b.w - a.w)[0]?.url || "";
                        const link = img.closest("a")?.getAttribute("href") || "";
                        return { url: src, srcset, link, w: img.naturalWidth || 0, h: img.naturalHeight || 0 };
                    })
                    .filter((item) => item.url && !item.url.startsWith("data:"));
                details.sort((a, b) => b.w * b.h - a.w * a.h);
                result.imageDetails = details;
                result.images = details.map((item) => item.url);
                // 占位符模式下把节点滚进视口，下一轮就能拿到真地址
                result.needScroll = !result.images.length && [...scope.querySelectorAll("img")].some((img) => (img.src || "").startsWith("data:"));
                if (needPlayer && !result.videos.length) {
                    const wrap = scope.querySelector("[class*='block-video'], [class*='video-player-wrapper'], [class*='video-player']");
                    if (wrap) {
                        wrap.scrollIntoView({ block: "center", behavior: "instant" });
                        const rect = wrap.getBoundingClientRect();
                        if (rect.width >= 40 && rect.height >= 20) result.playerBox = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
                    }
                }
                return result;
            },
            { selector: ANSWER_SELECTOR, hint: ANSWER_HINT, onlyFresh: Boolean(fresh), pendingSrc: pending, needPlayer: Boolean(probePlayer), seenSigs: baselineSigs, seenCount: baselineCount },
        )
        .catch(() => ({ total: 0, fresh: 0, pending: 0, text: "", videos: [], images: [], playerBox: null }));
}

/** 发送后新出现的消息块文字（不要求有正文）：错误卡片就靠它识别。 */
async function freshMessageTexts(page, limit = 3) {
    return page
        .evaluate(
            ({ selector, max }) => {
                const visible = (el) => !!el && el.getClientRects().length > 0;
                return [...document.querySelectorAll(selector)]
                    .filter((el) => visible(el) && !el.closest("aside, nav, header"))
                    .filter((el) => el.getAttribute("data-testid") !== "send_message" && el.getAttribute("data-message-role") !== "user")
                    .filter((el) => el.getAttribute("data-lihuo-msg-seen") !== "1")
                    .slice(-max)
                    .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim());
            },
            { selector: ANSWER_SELECTOR, max: limit },
        )
        .catch(() => []);
}

/** 读最后一条回答的正文（跳过时间戳和「猜你想问」）。 */
async function readAnswerText(page, onlyFresh = false) {
    return (await scanAnswers(page, { fresh: onlyFresh })).text;
}

/** 只取「发送之后新增的回答」里的产物地址。 */
async function answerArtifacts(page, onlyFresh = true) {
    const scan = await scanAnswers(page, { fresh: onlyFresh, pending: PENDING_ANSWER_RE.source });
    return { videos: scan.videos, images: scan.images, pendingAnswers: scan.pending };
}

/** 等能力入口渲染出来：站点慢的时候首屏可能 20~30 秒才出现（网络差更久）。 */
async function waitForCapability(page, label, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    let lastLog = 0;
    while (Date.now() < deadline) {
        const found = await page
            .evaluate((target) => {
                const visible = (el) => !!el && el.getClientRects().length > 0;
                return [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer'],div,span")].some(
                    (el) => visible(el) && (el.innerText || "").trim() === target,
                );
            }, label)
            .catch(() => false);
        if (found) return true;
        if (Date.now() - lastLog > 15000) {
            lastLog = Date.now();
            progress(`等待「${label}」入口渲染…`);
        }
        await page.waitForTimeout(1500);
    }
    return false;
}

/** 轮询等面板就绪（参数控件加载比入口更慢）。 */
async function waitForPanel(page, check, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check(page).catch(() => false)) return true;
        await page.waitForTimeout(1500);
    }
    return false;
}

/** 数一下「这次新增的回答」有几条（判断请求有没有被受理）。 */
async function freshAnswerCount(page) {
    return (await scanAnswers(page, { fresh: true })).fresh;
}

// 发送前页面上已有的回答快照（指纹 + 条数）。
// 只靠 data-lihuo-seen 属性不可靠：站点是 React 渲染，发送后整条列表会重建，
// 旧回答的标记随之丢失 → 上一个任务的回答被当成这次的新回答（实测把上一张赛博朋克图
// 当成「森林小路」的结果回传了）。所以再加一道「内容指纹 + 条数」的基线。
let baselineSigs = [];
let baselineCount = 0;

/** 给「当前已经存在的回答」打标记，之后只认新增的那几条。 */
async function markAnswers(page) {
    const snapshot = await page
        .evaluate(
            ({ selector, hint }) => {
                const visible = (el) => !!el && el.getClientRects().length > 0;
                // 侧栏会话列表也带 inner-item，不能当成回答
                // 用户自己发的那条也用同一套容器：它不是回答，绝不能拿它的文字判断「额度不足 / 已生成」
                const isAnswer = (el) => {
                    if (el.getAttribute("data-testid") === "send_message") return false;
                    const role = el.getAttribute("data-message-role") || el.querySelector("[data-message-role]")?.getAttribute("data-message-role") || "";
                    return !role || role === "assistant";
                };
                const sigOf = (el) => `${(el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 120)}|${el.querySelectorAll("img,video").length}`;
                // 所有消息块都记一笔：错误卡片（「出了点问题」）没有正文，不会被当成「回答」，
                // 但它同样是这次新出现的，得单独识别出来才能快速失败。
                [...document.querySelectorAll(selector)]
                    .filter((el) => visible(el) && !el.closest("aside, nav, header") && isAnswer(el))
                    .forEach((el) => el.setAttribute("data-lihuo-msg-seen", "1"));
                const all = [...document.querySelectorAll(selector)].filter((el) => visible(el) && !!el.querySelector(hint) && !el.closest("aside, nav, header") && isAnswer(el));
                const answers = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
                answers.forEach((el) => el.setAttribute("data-lihuo-seen", "1"));
                return { count: answers.length, sigs: answers.map(sigOf) };
            },
            { selector: ANSWER_SELECTOR, hint: ANSWER_HINT },
        )
        .catch(() => ({ count: 0, sigs: [] }));
    baselineCount = snapshot.count;
    baselineSigs = snapshot.sigs;
    return snapshot.count;
}

function classifyRefusal(text) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean || clean.length > 400) return null;
    // 「预计等待…消耗每日免费额度」是排队消息，不能当拒绝
    if (PENDING_ANSWER_RE.test(clean)) return null;
    const strongQuota = QUOTA_STRONG_RE.test(clean);
    if (!strongQuota && !REFUSAL_RE.test(clean)) return null;
    return { text: clean, quota: strongQuota || QUOTA_RE.test(clean) };
}

/**
 * 检测「明确不能生成」的提示，返回 { text, quota } 或 null。
 * 除了回答正文，还要看页面上的弹层 / toast：Dola 的额度不足经常是弹窗或顶部提示，
 * 根本不进回答区，只读回答就会一直等到 15 分钟超时（用户看到的「一直在等待」）。
 */
async function detectRefusal(page, onlyFresh) {
    // 1) 最新一条成片回答
    const fromAnswer = classifyRefusal((await scanAnswers(page, { fresh: Boolean(onlyFresh), pending: PENDING_ANSWER_RE.source })).text);
    if (fromAnswer) return fromAnswer;

    // 1.5) 错误卡片（「出了点问题，请稍后重试」）没有正文，走单独的新消息块判断
    for (const text of await freshMessageTexts(page, 3)) {
        const hit = classifyRefusal(text);
        if (hit) return hit;
    }

    // 2) 弹层 / toast：只认「像提示框」的元素，且要在正文区（侧栏/顶栏的营销文案不算）
    const notices = await page
        .evaluate(() => {
            const visible = (el) => !!el && el.getClientRects().length > 0;
            const inChrome = (el) => Boolean(el.closest("aside, nav, header, [class*='sidebar'], [class*='Sidebar']"));
            const looksLikeNotice = (el) => {
                const rect = el.getBoundingClientRect();
                return rect.width >= 120 && rect.width <= 760 && rect.height >= 28 && rect.height <= 460;
            };
            return [...document.querySelectorAll("[role=dialog],[role=alert],[class*='toast'],[class*='Toast'],[class*='modal'],[class*='Modal'],[class*='notification'],[class*='notice']")]
                .filter((el) => visible(el) && !inChrome(el) && looksLikeNotice(el))
                .map((el) => (el.innerText || "").trim())
                .filter(Boolean);
        })
        .catch(() => []);
    for (const text of notices.reverse()) {
        const hit = classifyRefusal(text);
        if (hit && DENIAL_RE.test(hit.text)) return hit;
    }
    return null;
}

/** 暂停页面上所有视频：只为取地址，不要真在后台播起来。 */
async function pauseVideos(page) {
    await page.evaluate(() => document.querySelectorAll("video").forEach((video) => video.pause?.())).catch(() => undefined);
}

/**
 * 回答里的视频播放器必须**真实鼠标点一下**才会挂载（两个站点的 DOM .click() 都不响应），
 * 挂上之后地址才写进 video.currentSrc。已经挂上或还没出播放器时不动。
 */
async function mountAnswerPlayer(page) {
    const { playerBox } = await scanAnswers(page, { fresh: true, pending: PENDING_ANSWER_RE.source, probePlayer: true });
    if (!playerBox) return false;
    await page.mouse.click(playerBox.x, playerBox.y);
    await page.waitForTimeout(1500);
    return true;
}

/** 把最新回答滚进视口：图片懒加载，不滚到可见位置时 <img> 只有 svg 占位符。 */
async function revealAnswerMedia(page) {
    await page
        .evaluate(
            ({ selector, hint }) => {
                const visible = (el) => !!el && el.getClientRects().length > 0;
                const blocks = [...document.querySelectorAll(selector)].filter((el) => visible(el) && !!el.querySelector(hint) && !el.closest("aside, nav, header"));
                const last = blocks[blocks.length - 1];
                if (!last) return;
                const img = [...last.querySelectorAll("img")].find((item) => (item.src || "").startsWith("data:"));
                (img || last).scrollIntoView({ block: "center" });
            },
            { selector: ANSWER_SELECTOR, hint: ANSWER_HINT },
        )
        .catch(() => undefined);
}

/**
 * 拿一个可用的标签页：优先复用窗口里闲置的豆包页（页内用 __lihuoBusy 标记占用），
 * 全都忙时才新开一个，任务结束再关掉——不再每跑一个任务就多一个标签页。
 */
/**
 * 跨进程互斥（同一账号的多个任务各是一个 node 进程）。
 * 「挑一个没被占用的标签页」是典型的 TOCTOU：A、B 同时 evaluate 都看到 __lihuoBusy=false，
 * 然后各自打上标记 → 两个任务挤进同一个标签页，提示词互相覆盖，只发出最后一个，
 * 用户看到的就是「同时点多个任务，结果只生成了一个」。
 * 这里用 O_EXCL 创建锁文件把「挑页 + 占页」这一步串起来，只让一个进程进。
 */
async function withPageLock(fn, timeoutMs = 90000) {
    const lockFile = path.join(stateDir, ".page-lock");
    const deadline = Date.now() + timeoutMs;
    let fd = null;
    while (Date.now() < deadline) {
        try {
            fd = fs.openSync(lockFile, "wx");
            fs.writeSync(fd, String(process.pid));
            break;
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            // 僵尸锁：持有者进程已退出，或锁太旧（>90 秒），直接接管
            try {
                const pid = Number(fs.readFileSync(lockFile, "utf8").trim()) || 0;
                let alive = pid > 0;
                if (alive) {
                    try {
                        process.kill(pid, 0);
                    } catch {
                        alive = false;
                    }
                }
                const stale = Date.now() - fs.statSync(lockFile).mtimeMs > 90000;
                if (!alive || stale) fs.rmSync(lockFile, { force: true });
            } catch {
                /* 锁文件可能刚好被别人删掉，下一轮重试 */
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    if (fd === null) throw new Error("等待标签页分配超时：同一账号并发任务过多，请稍后重试");
    try {
        return await fn();
    } finally {
        try {
            fs.closeSync(fd);
        } catch {
            /* ignore */
        }
        try {
            fs.rmSync(lockFile, { force: true });
        } catch {
            /* ignore */
        }
    }
}

async function acquirePage(ctx) {
    // 不再「复用闲置标签页」：切到新标签页必然要 goto，一旦导航，页面里的 __lihuoBusy 标记
    // 就被清掉了；别的任务这时再看就是「空闲」，于是两个任务挤进同一页，提示词互相覆盖、
    // 只发出最后一个，两个任务拿到同一张图——用户看到的就是「多个任务合并成了一个」。
    // 现在一律一任务一标签页（并发上限本来就只有 3），结束后各自关掉。
    //
    // 顺手清掉历史遗留的空标签页（上一个任务崩了没关的那种），最多留 3 个豆包页。
    const stale = ctx.pages().filter((item) => /doubao\.com|dola\.com/.test(item.url()));
    if (stale.length > 3) {
        for (const old of stale.slice(0, stale.length - 3)) {
            const busy = await old
                .evaluate(() => window.__lihuoBusy === true && Date.now() - (window.__lihuoBusyAt || 0) < 10 * 60 * 1000)
                .catch(() => true);
            if (!busy) await old.close().catch(() => undefined);
        }
    }
    const created = await ctx.newPage();
    await created.evaluate(() => { window.__lihuoBusy = true; window.__lihuoBusyAt = Date.now(); }).catch(() => undefined);
    return { page: created, created: true };
}

/** 心跳：告诉别的任务「我还在用这一页」，避免被当成僵尸占位。 */
async function touchBusy(page) {
    await page.evaluate(() => { window.__lihuoBusyAt = Date.now(); }).catch(() => undefined);
}

// 优先复用已经在跑的 viewer 窗口（号池里点开的那个）：
// 同一个 profile 不能被两个 Edge 同时 launchPersistentContext，否则新进程秒退。
// viewer 启动时带了 --remote-debugging-port，直接 CDP 连过去用它的 context。
async function connectExistingViewer() {
    const statusFile = path.join(stateDir, "viewer", "status.json");
    let st = null;
    try {
        st = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    } catch { return null; }
    // 状态是 error/closed/closing 时，说明 viewer 已经死了，不要去连
    if (st.state && ["error", "closed", "closing"].includes(st.state)) {
        progress(`[DOUBAO_BROWSER] viewer 状态为 ${st.state}（${st.message || ""}），不复用`);
        return null;
    }
    const port = Number(st.debugPort) || 0;
    if (!port) return null;
    try {
        await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    } catch {
        progress(`[DOUBAO_BROWSER] viewer 端口 ${port} 无响应，不复用`);
        return null;
    }
    try {
        progress(`[DOUBAO_BROWSER] CDP 连接已开窗口（端口 ${port}）`);
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const contexts = browser.contexts();
        if (!contexts.length) {
            await browser.close().catch(() => undefined);
            return null;
        }
        return { browser, ctx: contexts[0] };
    } catch (error) {
        progress(`[DOUBAO_BROWSER] CDP 连接失败：${String(error.message || error).slice(0, 120)}`);
        return null;
    }
}

/** 杀掉所有用这个 profile 的 Edge 进程（上一次崩溃残留的）。 */
async function killProfileBrowsers() {
    const profile = path.join(stateDir, "profile");
    const pattern = profile.replace(/'/g, "''").replace(/\\/g, "\\\\");
    await new Promise((resolve) => {
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command",
                `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${pattern}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
            { windowsHide: true, stdio: "ignore" },
        );
        child.on("exit", resolve);
        child.on("error", resolve);
        setTimeout(resolve, 5000);
    });
    // 等端口/文件锁释放
    await new Promise((r) => setTimeout(r, 2000));
}

/** 找一个空闲端口。 */
async function findFreePort() {
    const net = await import("node:net");
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
        srv.on("error", reject);
    });
}

/** 启动一个独立的 Edge 窗口（全新 user-data-dir，带调试端口），然后 CDP 连接。
 *  为什么不用 launchPersistentContext：Edge 157 单实例全局转发，只要系统里有 Edge 在跑就会秒退。
 *  用全新的 user-data-dir + 手动 spawn + --remote-debugging-port 可以绕开。 */
async function launchEdgeManually() {
    // 用账号目录下的一个稳定 profile（不是默认 profile，不碰用户的 Edge）
    const profile = path.join(stateDir, "automation-profile");
    fs.mkdirSync(profile, { recursive: true });
    const port = await findFreePort();
    progress(`[DOUBAO_BROWSER] 启动独立 Edge（端口 ${port}）`);
    const edgeExe = found?.executablePath;
    if (!edgeExe) throw new Error("未找到 Edge 可执行文件");
    const child = spawn(edgeExe, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--window-position=80,60",
        "--window-size=1440,940",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "about:blank",
    ], { windowsHide: false, stdio: "ignore" });
    progress(`[DOUBAO_BROWSER] Edge pid=${child.pid}，等待 CDP 端口…`);
    // 等 CDP 端口可用（最多 20 秒）
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        try {
            await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
            progress(`[DOUBAO_BROWSER] CDP 端口就绪`);
            break;
        } catch {
            if (child.exitCode !== null) throw new Error(`Edge 进程已退出（exitCode=${child.exitCode}）`);
            await new Promise((r) => setTimeout(r, 400));
        }
    }
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const contexts = browser.contexts();
    if (!contexts.length) throw new Error("CDP 连接成功但没有 BrowserContext");
    return { browser, ctx: contexts[0], child, port };
}

let ctx = null;
let cdpBrowser = null;
let manualChild = null;
let reusedViewer = false;
let page = null;
let ownsPage = false; // 这个标签页是本次任务新开的话，结束后关掉
// 顶层 try 里不能用 return：文本任务处理完用 job 这个标签跳出，后面的产物收集整段跳过
job: try {
    progress("[DOUBAO_BROWSER] 开始启动浏览器");
    const existing = await connectExistingViewer();
    if (existing) {
        cdpBrowser = existing.browser;
        ctx = existing.ctx;
        reusedViewer = true;
        progress("[DOUBAO_BROWSER] 复用已开窗口成功");
    } else {
        // 严格禁止新开窗口：连不上已有 viewer 就直接报错
        throw new Error("连不上已开的豆包窗口。请先在左侧账号池点击「打开」启动该账号的浏览器窗口，再点生成。");
    }
    const acquired = await withPageLock(() => acquirePage(ctx));
    page = acquired.page;
    ownsPage = acquired.created;
    progress(acquired.created ? "[DOUBAO_BROWSER] 新开一个标签页执行" : "[DOUBAO_BROWSER] 复用已有标签页执行（不再每个任务开一个新标签页）");
    progress("[DOUBAO_BROWSER] 开始导航豆包页面");
    // 网络偶发超时：重试两次，仍失败才判死
    let navigated = false;
    let navError = null;
    for (let attempt = 1; attempt <= 3 && !navigated; attempt += 1) {
        try {
            await page.goto(SITE_URL, { waitUntil: "commit", timeout: 30000 });
            navigated = true;
        } catch (error) {
            navError = error;
            progress(`[DOUBAO_BROWSER] 页面加载失败（第 ${attempt} 次）：${String(error.message || error).slice(0, 80)}`);
            await page.waitForTimeout(4000);
        }
    }
    if (!navigated) throw navError || new Error("豆包页面加载失败");
    progress(`[DOUBAO_BROWSER] 豆包页面加载成功，当前 URL: ${page.url()}`);
    const expectText = spec.expectedArtifactKind === "text";
    // 等页面可用就继续（原来是死等 12 秒）：输入框和底部能力条都渲染出来即可
    for (let i = 0; i < 30; i += 1) {
        const ready = await page
            .evaluate(() => {
                const hasInput = !!document.querySelector('[contenteditable="true"], textarea');
                const hasChips = [...document.querySelectorAll("button,[role=button]")].some((el) => /^(对话|视频生成|图像生成)$/.test((el.innerText || "").trim()));
                return hasInput && hasChips;
            })
            .catch(() => false);
        if (ready) break;
        await page.waitForTimeout(500);
    }
    progress("[DOUBAO_BROWSER] 页面渲染就绪");

    // 同一账号并发时，豆包会把新标签页都恢复到**同一个会话**（它记着「上次打开的对话」）。
    // 两个任务于是把提示词发进同一个对话，最后都挑到「最新那条带视频的回答」——
    // 素材完全不同的两个节点最后拿到同一个文件（实测 A 的参考图是青色汉服，回传的是 B 的红衣视频）。
    // 所以在发送前先确保处在一个新会话里：页面上已经有消息就点一次「新对话」。
    const existingAnswers = await page
        .evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => !el.closest("aside, nav, header")).length, ANSWER_SELECTOR)
        .catch(() => 0);
    if (existingAnswers > 0) {
        progress(`当前会话里已有 ${existingAnswers} 条消息（可能是别的任务的），先切到新对话…`);
        const clicked = await page
            .evaluate(() => {
                const el = [...document.querySelectorAll("button,[role=button],[class*='cursor-pointer'],div,span")].find((node) => {
                    const text = (node.innerText || "").trim().replace(/\s+/g, " ");
                    const rect = node.getBoundingClientRect();
                    return /^新对话(\s|$)/.test(text) && rect.width > 20 && rect.height > 16 && rect.x < window.innerWidth * 0.4;
                });
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
            })
            .catch(() => null);
        if (clicked) {
            await page.mouse.click(clicked.x, clicked.y);
        } else {
            // 侧栏被收起时用快捷键（豆包：Ctrl+Shift+K）
            await page.keyboard.press("Control+Shift+K").catch(() => undefined);
        }
        await page.waitForTimeout(2500);
        const after = await page
            .evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => !el.closest("aside, nav, header")).length, ANSWER_SELECTOR)
            .catch(() => 0);
        progress(after > 0 ? `⚠️ 新对话没清干净（还剩 ${after} 条），继续执行` : "已切到新对话");
    }

    // 切能力栏：必须用真实鼠标点击。豆包首页那颗「视频生成」是 <button>，DOM 的 .click() 在它的 React 里
    // 是空操作——之前就是这样“切成功了”其实还停在首页，最后把普通对话里的视频当成产物返回。
    // 另外首页上第一次点击偶尔会被吞（窗口刚激活/能力条刚滚进视野），所以没进面板就在同一位置补一次。
    progress(`切换能力：${SITE_CAPABILITY}`);
    // 快速路径：页面已经停在目标能力上就别再点一遍白等
    const panelCheck = (p) => (expectText ? hasChatComposer(p) : hasGenerationPanel(p, SITE_CAPABILITY));
    let panelReady = await panelCheck(page);
    if (panelReady) progress(`已经在「${SITE_CAPABILITY}」，跳过切换`);
    // 入口本身可能还没渲染（网络慢）：先等它出现，别急着点空
    if (!panelReady) {
        const appeared = await waitForCapability(page, SITE_CAPABILITY, 90000);
        if (!appeared) progress(`等了 90 秒仍没看到「${SITE_CAPABILITY}」入口（网络太慢或站点改版）`);
    }
    for (let attempt = 1; attempt <= 6 && !panelReady; attempt += 1) {
        if (attempt === 3) {
            progress("还没进面板，先回到新对话再试…");
            await page
                .getByText("新对话", { exact: false })
                .first()
                .click({ timeout: 5000 })
                .catch(() => undefined);
            await page.waitForTimeout(2500);
            await waitForCapability(page, SITE_CAPABILITY, 30000);
        }
        const box = await clickCapability(page, SITE_CAPABILITY);
        // 对话模式没有「模型/比例」控件，用「输入框在 + 没有生成参数控件」判断
        panelReady = await waitForPanel(page, panelCheck, attempt === 1 ? 20000 : 12000);
        if (!panelReady && box) {
            progress("切能力没反应，同一位置补一次点击…");
            await page.mouse.click(box.x, box.y);
            panelReady = await waitForPanel(page, panelCheck, 15000);
        }
    }
    if (!panelReady) {
        // 站点要求登录才能打开创作面板：这时页面会弹「登录以解锁更多功能 / 扫码登录」，
        // 报「未登录」比报「没进面板」有用得多（Dola 就是这种情况）。
        const needsLogin = await page
            .evaluate(() => /登录以解锁|扫码登录|Log ?in to (unlock|continue)|Sign ?in to (unlock|continue)/i.test(document.body.innerText || ""))
            .catch(() => false);
        if (needsLogin) throw new Error(`${SITE_CAPABILITY}需要登录：该账号在 ${SITE_URL.replace(/\/chat\/?$/, "")} 还没登录，请先在账号池扫码登录`);
        const active = await site.readActiveCapability(page).catch(() => null);
        throw new Error(`${SITE_NAME}没有进入「${SITE_CAPABILITY}」面板（当前能力：${active || "未识别"}），已中止，未提交提示词`);
    }
    progress(expectText ? "对话输入框已就绪" : "生成面板已就绪");

    // 模型
    if (!expectText && spec.model) {
        progress(`选模型：${spec.model}`);
        const trigger = await openModelMenu(page);
        if (trigger) {
            progress(`模型入口：${trigger}`);
            const picked = await pickOption(page, spec.model);
            if (picked.ok) progress(`模型已设为 ${picked.text}`);
            else progress(`模型菜单里没找到「${spec.model}」，可选：${picked.options.join(" / ") || "未识别"}`);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(500);
        } else {
            progress("没找到模型入口，保持当前模型（面板可能已改版）");
        }
    }

    // 比例 / 时长：视频是「自动 · 10s」那种浮层，图片是「比例 自动」按钮
    if (!expectText && (spec.ratio || spec.duration)) {
        const isImage = !/视频|video/i.test(SITE_CAPABILITY);
        const opened = await page.evaluate((imageMode) => {
            const viewportH = window.innerHeight;
            const candidates = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")]
                .map((node) => ({ text: (node.innerText || "").trim().replace(/\s+/g, " "), rect: node.getBoundingClientRect() }))
                .filter((item) => item.rect.width >= 24 && item.rect.height >= 14 && item.rect.width < 420);
            // 取「最靠下」的匹配项：输入区在页面底部，侧边栏文本会被排除
            const byBottom = candidates.sort((a, b) => b.rect.y - a.rect.y);
            const hit = byBottom.find((item) => {
                if (imageMode) return item.text.startsWith("比例") || /^(自动|\d+:\d+)\s*·/.test(item.text) || /^\d+:\d+$/.test(item.text);
                return /·/.test(item.text) && /\d+\s*s|自动/.test(item.text);
            });
            if (!hit) {
                window.__paramCandidates = candidates.slice(0, 12).map((item) => item.text).filter(Boolean);
                return null;
            }
            return { x: Math.round(hit.rect.x + hit.rect.width / 2), y: Math.round(hit.rect.y + hit.rect.height / 2), text: hit.text };
        }, isImage);
        if (opened) {
            progress(`参数入口：${opened.text}`);
            await page.mouse.click(opened.x, opened.y);
            await page.waitForTimeout(1200);
            if (spec.ratio) {
                // 两个站点对「自动」的文案不同（豆包「自动」/ Dola「Auto」），依次尝试，避免静默沿用旧比例。
                const ratioTargets = /^(自动|auto)$/i.test(String(spec.ratio)) ? ["自动", "Auto"] : [String(spec.ratio)];
                let picked = { ok: false, options: [] };
                for (const target of ratioTargets) {
                    picked = await pickOption(page, target);
                    if (picked.ok) break;
                }
                if (picked.ok) progress(`比例已设为 ${picked.text}`);
                else progress(`比例 ${spec.ratio} 未找到，可选：${picked.options.join(" / ") || "未识别"}`);
            }
            if (spec.duration) {
                const ok = await setDuration(page, Number(spec.duration));
                progress(ok ? `时长已设为 ${spec.duration}s` : `时长 ${spec.duration}s 未设置成功`);
            }
            await page.keyboard.press("Escape");
            await page.waitForTimeout(500);
        } else {
            const texts = await page.evaluate(() => window.__paramCandidates || []);
            progress(`找不到参数入口，页面候选：${texts.join(" | ") || "无"}`);
        }
    }

    // —— 读回校验：按整页文本匹配（豆包模型按钮选中后文案会变成模型名，不再带「模型」前缀） ——
    if (!expectText) {
        const panelText = await page.evaluate(() => {
            const vh = window.innerHeight;
            const vw = window.innerWidth;
            return [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer'], span, div")]
                .filter((node) => {
                    const rect = node.getBoundingClientRect();
                    // 只看主内容区（排除左侧号池/会话列表），否则读回全是侧边栏文字
                    return rect.width > 0 && rect.height > 0 && rect.y > vh * 0.3 && rect.x > vw * 0.2;
                })
                .map((node) => (node.innerText || "").trim().replace(/\s+/g, " "))
                .filter((text) => text.length > 0 && text.length < 60)
                .join(" | ");
        });
        progress(`参数读回：${panelText.slice(0, 160) || "—"}`);
        // 面板压根没出来（读回为空）说明还停在首页/普通对话：这时提交提示词只会拿到一段普通回答，
        // 之后页面上任何视频/图片都会被当成“产物”捡走——这就是“返回的视频不对”。宁可失败也不瞎提交。
        if (!panelText.trim()) {
            const active = await site.readActiveCapability(page).catch(() => null);
            throw new Error(`${SITE_NAME}没有进入「${SITE_CAPABILITY}」面板（读回为空，当前能力：${active || "未识别"}），已中止，未提交提示词`);
        }
        const modelOk = !spec.model || panelText.includes(spec.model);
        // 「自动」也要读回校验：如果点不到自动按钮，页面会静默沿用上一次比例。
        const ratioOk = !spec.ratio || (/^(自动|auto)$/i.test(String(spec.ratio)) ? /(自动|auto)/i.test(panelText) : panelText.includes(spec.ratio));
        const durationOk = !spec.duration || panelText.includes(`${spec.duration}s`);
        if (!modelOk || !ratioOk || !durationOk) {
            // 不中断：豆包面板结构可能变化，图片/提示词仍要提交；但把差异写清楚
            progress(`参数可能未完全生效：期望 ${spec.model || "-"} / ${spec.ratio || "-"} / ${spec.duration || "-"}s（继续提交，附素材）`);
        } else {
            progress("参数已按画布选择生效");
        }
    }

    // 素材：画布上连到本节点的图片/视频会以附件形式上传，和提示词一起提交
    if (Array.isArray(spec.attachments) && spec.attachments.length) {
        progress(`上传素材 ${spec.attachments.length} 个…`);
        let count = await page.locator('input[type="file"]').count();
        if (!count) {
            // 视频/图片面板的上传入口有时是「+」或「参考内容」，点开才会出现 file input
            const opened = await page.evaluate(() => {
                const vh = window.innerHeight;
                const el = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer'], div, span")].find((node) => {
                    const t = (node.innerText || "").trim();
                    const r = node.getBoundingClientRect();
                    if (r.width < 16 || r.height < 16 || r.y < vh * 0.55) return false;
                    return t === "+" || t === "参考内容" || t === "上传" || t.includes("参考内容") || t.includes("上传图片");
                });
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
            });
            if (opened) {
                await page.mouse.click(opened.x, opened.y);
                await page.waitForTimeout(1500);
                count = await page.locator('input[type="file"]').count();
            }
        }
        if (!count) {
            progress("⚠ 找不到上传入口，本次只能提交文字（豆包面板可能已改版）");
        } else {
            const input = page.locator('input[type="file"]').first();
            const countAttachments = () =>
                page.evaluate(() => document.querySelectorAll('img[src^="blob:"], img[src^="data:"], [class*="attachment"], [class*="file-item"]').length);
            const beforeUpload = await countAttachments();
            await input.setInputFiles(spec.attachments, { timeout: 60000 });
            // 传完就别死等 5 秒了：素材元素出现就继续（最多等 6 秒）
            let afterUpload = beforeUpload;
            for (let i = 0; i < 12; i += 1) {
                await page.waitForTimeout(500);
                afterUpload = await countAttachments();
                if (afterUpload > beforeUpload) break;
            }
            progress(`素材上传完成：输入区素材元素 ${beforeUpload} → ${afterUpload}`);
            if (afterUpload <= beforeUpload) progress("⚠ 没检测到素材进入输入区，但继续提交（请看豆包窗口确认）");
        }
    }

    // 抓接口响应里的真实产物地址：豆包有些版本只给封面图、不挂 <video>，
    // 光看 DOM 会一直"等待产物"，这里从生成相关接口的响应里取 mp4 链接。
    // 必须过滤掉推荐流（feed/aweme），否则会把别人的视频当成产物。
    const captured = { videos: [], images: [] };
    const captureUrls = (text, at) => {
        const patterns = [
            /https?:\/\/[^"'\s\\]+?\.(?:mp4|mov)(?:\?[^"'\s\\]*)?/gi,
            /https?:\/\/[^"'\s\\]*(?:video\/tos|mime_type=video)[^"'\s\\]*/gi,
        ];
        for (const pattern of patterns) {
            for (const match of text.matchAll(pattern)) {
                const url = match[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
                if (!captured.videos.some((item) => item.url === url)) captured.videos.push({ url, at });
            }
        }
        for (const match of text.matchAll(/https?:\/\/[^"'\s\\]+?\.(?:png|jpe?g|webp)(?:\?[^"'\s\\]*)?/gi)) {
            const url = match[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
            if (!captured.images.some((item) => item.url === url)) captured.images.push({ url, at });
        }
    };
    const isGenerationApi = (url) => /(chat|conversation|message|samantha|video|gen)/i.test(url) && !/(feed|recommend|aweme|material|hot|rank)/i.test(url);
    page.on("response", (response) => {
        try {
            const url = response.url();
            if (!isGenerationApi(url)) return;
            const at = Date.now();
            if (/\.(mp4|mov)(\?|$)/i.test(url)) captured.videos.push({ url, at });
            const type = (response.headers()["content-type"] || "").toLowerCase();
            if (!/json|text/.test(type)) return;
            void response
                .text()
                .then((body) => {
                    if (body.length >= 4_000_000) return;
                    // 只认带产物字段的响应；推荐流/信息流一律跳过，避免把别人的视频当结果
                    if (!/"(video_url|download_url|play_url|main_url|vid)"/.test(body)) return;
                    if (/"(aweme_id|feed|recommend)"/.test(body)) return;
                    captureUrls(body, at);
                })
                .catch(() => undefined);
        } catch {
            /* 响应已销毁等情况直接忽略 */
        }
    });

    // 豆包会恢复上次会话：新标签页里往往已经躺着上一轮的回答和它的视频/图片。
    // 发送前先记下「已有几条回答」「页面上已有哪些视频地址」，之后只认新增的那部分。
    const baselineAnswers = await markAnswers(page);
    const baselineVideos = new Set(
        (await page.evaluate(() => [...document.querySelectorAll("video")].map((v) => v.src || v.currentSrc || "")).catch(() => []))
            .filter(Boolean)
            .map((url) => url.split("?")[0]),
    );
    if (baselineAnswers || baselineVideos.size) progress(`发送前页面已有 ${baselineAnswers} 条回答 / ${baselineVideos.size} 个视频（上一轮留下的），只认这次新出现的`);

    progress("发送提示词…");
    const sentAt = Date.now();
    const injected = await site.injectPrompt(page, spec.prompt);
    if (!injected.ok) throw new Error(`注入提示词失败：${injected.valueLength}/${injected.expected}`);
    const sent = await site.sendPrompt(page);
    if (!sent.ok) throw new Error(`发送失败：${sent.reason || ""}`);

    // 最后一道防线：提示词必须真的出现在这个会话里。
    // 并发时最怕「A 的提示词发进了 B 的对话」，那样后面不管怎么挑产物都是错的；
    // 与其回传别人的视频，不如立刻失败让人重试。
    {
        const needle = spec.prompt.trim().slice(0, 12);
        const echoed = await page
            .evaluate((text) => (document.body.innerText || "").replace(/\s+/g, " ").includes(text), needle)
            .catch(() => true);
        if (!echoed) throw new Error("提示词没有出现在会话里（可能发到了别的对话），已中止，避免回传其它任务的产物");
    }

    // 确认参数：豆包 / Dola 有时先说「确认后我再开始生成视频。」，必须回一句「确认，开始生成」才会真的开始。
    // 这里不能只看一眼就过：实测这句话 10~40 秒才出现，原来固定等 4 秒读一次就 break，
    // 漏掉之后一路干等到 15 分钟超时（日志里 931 秒 / 947 秒那两个失败就是它）。
    // 只有图片/视频任务需要「确认后开始生成」；对话任务没有生成参数，
    // 跑这段会在剧本正文出现「请确认 / 是否继续」时误判，然后往对话里插「确认，开始生成」，把剧本打断。
    if (!expectText) {
        const confirmRe = /确认后.{0,6}(我再|开始|继续)|请.{0,4}确认|是否(开始|继续|确认)|回复.{0,6}确认|点击.{0,8}(开始生成|确认)|如确认|确认无误/i;
        // 已经在排队/生成中的信号：见到就说明不需要再确认，立刻退出等待，别把每个任务都拖慢两分钟
        const startedRe = /预计.{0,6}等待|正在生成|生成中|即将生成|生成好后|会主动发送|已开始生成|排队/i;
        const deadlineAt = Date.now() + 120000;
        let rounds = 0;
        let quietSince = Date.now();
        while (Date.now() < deadlineAt && rounds < 3) {
            await page.waitForTimeout(3000);
            const texts = await freshMessageTexts(page, 3);
            const said = texts.join(" ").trim();
            if (!said) {
                // 40 秒都没等到任何新消息：站点这次不需要确认，走正常等待流程
                if (Date.now() - quietSince > 40000) break;
                continue;
            }
            // 先看「要确认」：这句常和「预计等待…」同一段出现，先判排队就会漏掉确认
            if (confirmRe.test(said)) {
                rounds += 1;
                progress(`站点要求确认：「${said.slice(0, 40)}」→ 回复「确认，开始生成」`);
                await site.injectPrompt(page, "确认，开始生成");
                await site.sendPrompt(page);
                await page.waitForTimeout(2500);
                continue;
            }
            if (startedRe.test(said)) break;
            quietSince = Date.now();
        }
    }

    // 对话任务：等回答不再变长就算完成（豆包没有“生成结束”事件，只能看文本是否稳定）
    if (expectText) {
        progress("等待回答…");
        let last = "";
        let stable = 0;
        let round = 0;
        // 写长剧本（4 场戏 / 几百字）经常超过 5 分钟，原来会在回答写到一半时截止。
        const textDeadline = Date.now() + 8 * 60 * 1000;
        while (Date.now() < textDeadline) {
            await page.waitForTimeout(2500);
            round += 1;
            // 额度不足 / 被拒：对话也一样，立刻失败而不是空等 5 分钟
            const refusal = await detectRefusal(page, true);
            if (refusal) {
                progress(`回答被拒（${refusal.quota ? "额度不足" : "拒绝生成"}）：${refusal.text.slice(0, 60)}`);
                emit({ type: "result", ok: false, error: { reason: refusal.quota ? "QUOTA_EXCEEDED" : "DOUBAO_REFUSED", message: refusal.text.slice(0, 200) } });
                break job;
            }
            let said = (await readAnswerText(page, true)).trim();
            if (!said) {
                // 站点是 React 渲染，发送后整条列表会重建、data-lihuo-seen 标记会丢，
                // 「只认新回答」会被过滤成空，最后明明写完了却报 NO_TEXT。这里回退读最后一条回答。
                said = (await readAnswerText(page, false)).trim();
            }
            if (said && said === last) stable += 1;
            else if (said) stable = 0;
            if (said) last = said;
            if (round % 4 === 0 && said) progress(`正在回答…（已收到 ${said.length} 字）`);
            if (last && stable >= 2) break;
        }
        if (!last) {
            emit({ type: "result", ok: false, error: { reason: "NO_TEXT", message: "豆包没有返回回答内容" } });
        } else {
            progress(`回答完成：${last.length} 字`);
            emit({ type: "result", ok: true, files: [], text: last });
        }
        progress("任务结束");
        break job;
    }

    progress("等待产物…");
    const deadline = Date.now() + 15 * 60 * 1000;
    // P0-4: 明确使用 expectedArtifactKind，不靠 capability/mode 字符串猜测
    const expectVideo = spec.expectedArtifactKind === "video";
    const kind = expectVideo ? "video" : "image";
    const cookieHeader = (await ctx.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    // 统一规则：只有「这次新出现 + 真的下载下来 + 大小合格」的产物才算数，不合格就继续等；
    // 不能拿到页面上的第一个 img/video 就收工——那多半是上一轮会话留下的结果。
    const rejected = new Set();
    const seenBytes = new Set();
    const minBytes = expectVideo ? 50_000 : 100_000;
    // 画布请求的张数（没传就按最多 4 张）
    const wantCount = Math.max(1, Math.min(4, Number(spec.count) || 4));
    let files = [];
    let failure = null;
    let pollRound = 0;
    while (Date.now() < deadline) {
        // 视频每 4 秒看一次（早点回传），图片 8 秒够用
        await page.waitForTimeout(expectVideo ? 4000 : 8000);
        pollRound += 1;
        await touchBusy(page);
        // 图片是懒加载的：每轮先把最新回答滚进视口，否则永远只看到 svg 占位符
        if (!expectVideo) await revealAnswerMedia(page);
        // 视频任务默认**不去点播放按钮**：点开会让豆包页面自动播放视频（用户要求直接回传）。
        // 只有最新回答里已经出现播放器外壳、却还没挂上 <video> 时，才点一次把它挂出来，点完立刻暂停。
        // 视频播放器要先挂载才能拿到地址：真实鼠标点一下，点完立刻暂停（不自动播放）
        if (expectVideo && (await mountAnswerPlayer(page))) {
            progress("点开回答里的播放器取地址（随后立刻暂停）");
            await pauseVideos(page);
        }
        const raw = await site.extractArtifacts(page, { autoScroll: !expectVideo });
        const candidate = site.filterArtifacts(raw);
        const answer = await answerArtifacts(page, true);
        if (pollRound % 12 === 0) progress(`等待中…${answer.pendingAnswers ? `${SITE_NAME}还在生成（回的是「预计等待」那类排队消息）` : ""}（已捕获 ${captured.videos.filter((item) => item.at > sentAt).length} 个视频 / ${captured.images.filter((item) => item.at > sentAt).length} 个图片地址）`);
        // 接口里抓到的图混着推荐流缩略图（~tplv-...-448x448.jpeg 这类）和头像：
        // 只留两个站点自己的图片 CDN，并且排除封面缩略图，别把「别人的封面」当产物下载。
        // 生成中接口里抓到的图多半是示例图/模板图：前 2 分钟只等回答区的真图，
        // 过了 2 分钟仍没等到才用它兜底（否则每轮都在下废图，一次生图要多花好几分钟）。
        const capturedImages = captured.images
            .filter(() => Date.now() - sentAt > 2 * 60 * 1000)
            .filter((entry) => entry.at > sentAt)
            .map((entry) => entry.url)
            .reverse()
            .filter((url) => /tos-cn|byteimg|flow-imagex|dola\.com/i.test(url))
            .filter((url) => !/(avatar|icon|emoji|static|thumb|~\d+x\d+\.(jpe?g|png|webp)$)/i.test(url));

        // 视频只认「最新一条回答里真正成片的那个」：接口里抓到的地址混着侧栏会话、推荐和示例视频，
        // 之前就是这样把别的任务的视频回传到当前节点。图片再叠加接口抓到的图兜底。
        // 视频：只认回答区里真正挂载出来的那个；实在挂不出来（点不开播放器 / 站点改版）时，
        // 8 分钟后退回用「发送之后新抓到的最新视频地址」，避免明明生成好了却一直等到超时。
        const capturedVideos = captured.videos
            .filter((entry) => entry.at > sentAt)
            .map((entry) => entry.url)
            .filter((url) => !baselineVideos.has(url.split("?")[0]));
        // 图片：只认回答区的图 + 接口里新抓到的图；整页扫出来的多半是推荐流缩略图，
        // 等 5 分钟还没有结果时才作为最后的兜底。
        const pageImages = Date.now() - sentAt > 5 * 60 * 1000
            ? candidate.images
                  .filter((item) => /tos-cn|byteimg|flow-imagex/.test(item.url) && !/(avatar|icon|emoji|static|thumb)/i.test(item.url))
                  .map((item) => item.url)
            : [];
        const ranked = expectVideo
            ? [...answer.videos, ...(Date.now() - sentAt > 8 * 60 * 1000 ? [...capturedVideos].reverse() : [])]
            : [...answer.images, ...capturedImages, ...pageImages];
        const pool = [...new Set(ranked)]
            .filter((url) => !rejected.has(expectVideo ? url.split("?")[0] : url))
            .filter((url) => !expectVideo || !baselineVideos.has(url.split("?")[0]))
            // 同一张图常被抓到多条仅签名不同的地址：按基础地址去重，别重复下载 4 次
            .filter((url, index, list) => list.findIndex((other) => other.split("?")[0] === url.split("?")[0]) === index)
            .slice(0, expectVideo ? 1 : 4)
            // 图片：回答区拿到的是 CDN 的缩略模板地址（384x216），先把原图地址排前面一起下，
            // 下载后按真实像素挑最大的那张——不然画布上挂的就是一张糊图。
            .flatMap((url) => {
                if (expectVideo) return [url];
                const original = originalImageUrl(url);
                return original ? [original, url] : [url];
            })
            .slice(0, expectVideo ? 1 : 8);

        if (pool.length) {
            progress(`${expectVideo ? "视频" : "图片"}候选：${pool.map((url) => url.split("?")[0].slice(-42)).join(" | ")}`);
            try {
                fs.writeFileSync(path.join(downloadsDir, "candidates.txt"), pool.join("\n"), "utf8");
            } catch {
                /* 写不进去不影响生成 */
            }
            const downloaded = await withTimeout(site.downloadArtifactsByUrl(pool.map((url) => ({ kind, url })), downloadsDir, cookieHeader, { referer: SITE_REFERER }), 240000, null);
            if (!downloaded) {
                progress("下载超时（4 分钟），继续等下一个候选…");
                await page.waitForTimeout(4000);
                continue;
            }
            const good = [];
            downloaded.forEach((item, index) => {
                const url = pool[index] || "";
                if (item.ok && item.bytes >= minBytes && !seenBytes.has(item.bytes)) {
                    // 图片再过一道像素闸：缩略图（384x216）字节数也可能过 100KB，但挂到画布上就是糊的
                    if (!expectVideo) {
                        const dim = imageSizeOf(item.file);
                        if (dim && dim.width < 768) {
                            progress(`跳过 ${dim.width}x${dim.height} 的小图（缩略图），继续等原图…`);
                            if (url) rejected.add(url);
                            rmQuiet(item.file);
                            return;
                        }
                    }
                    seenBytes.add(item.bytes);
                    good.push({ file: item.file, bytes: item.bytes, kind: item.kind, contentType: item.contentType, dim: expectVideo ? null : imageSizeOf(item.file) });
                    return;
                }
                // 头像/图标/重复产物：记下来不再重复下载，继续等真正的产物
                if (url) rejected.add(expectVideo ? url.split("?")[0] : url);
                if (item.ok) rmQuiet(item.file);
            });
            // 同一轮里下到多张：原图优先（像素大的在前），别把缩略图当结果返回
            if (!expectVideo) good.sort((a, b) => (b.dim?.width || 0) - (a.dim?.width || 0));
            if (good.length) {
                files = good.slice(0, expectVideo ? 1 : wantCount);
                // 多下的图（同一轮里原图 + 缩略图都成功）只留要回传的那几张，其余删掉，别把磁盘堆满
                for (const extra of good.slice(files.length)) rmQuiet(extra.file);
                if (expectVideo && files[0]) {
                    // 编码不是 H.264 的话浏览器会黑屏：能转就转，不能转就明确写在日志里
                    const playable = ensurePlayableVideo(files[0].file);
                    if (playable.note === "transcoded") {
                        progress("视频是 HEVC(H.265) 编码，已转成 H.264（浏览器可直接播放）");
                        files = [{ ...files[0], file: playable.file, name: path.basename(playable.file), bytes: fs.statSync(playable.file).size }];
                    } else if (playable.note === "hevc-no-ffmpeg") {
                        progress("⚠️ 视频是 HEVC(H.265) 编码，当前浏览器无法解码，节点会显示黑屏；安装 ffmpeg 后桥接会自动转码成 H.264");
                    } else if (playable.note === "hevc-transcode-failed") {
                        progress("⚠️ HEVC 转 H.264 失败，仍返回原文件（浏览器可能黑屏）");
                    } else {
                        progress(`视频编码：${playable.codec}`);
                    }
                }
                progress(`产物就绪：${files.length} 个${expectVideo ? "视频" : "图片"}`);
                // 后台页面不要继续播：取到地址就暂停，避免豆包窗口自己放起来
                if (expectVideo) await pauseVideos(page);
                break;
            }
        }

        // 豆包 / Dola 自己说生成不出来（额度不足 / 内容被拒 / 生成失败）就别干等 15 分钟。
        // 除了回答正文，也会看页面上的弹层/toast——Dola 的额度提示常常只以弹窗出现。
        const refusal = await detectRefusal(page, true);
        if (refusal) {
            progress(`生成被拒（${refusal.quota ? "额度不足" : "拒绝生成"}）：${refusal.text.slice(0, 60)}`);
            failure = { reason: refusal.quota ? "QUOTA_EXCEEDED" : "DOUBAO_REFUSED", message: refusal.text.slice(0, 200) };
            break;
        }

        // 发出去 3 分钟连一条新回答都没有：请求基本没被受理（静默拒绝/未登录/额度用完但没弹提示）
        if (Date.now() - sentAt > 3 * 60 * 1000 && (await freshAnswerCount(page)) === 0) {
            progress("3 分钟没有任何新回答，判断请求没有被受理，结束等待");
            failure = { reason: "REQUEST_NOT_ACCEPTED", message: "生成请求没有被受理：提交后页面一直没有出现新的回答，可能是账号额度不足或登录态失效，请检查账号池" };
            break;
        }
    }

    if (failure) {
        emit({ type: "result", ok: false, error: failure });
    } else if (!files.length) {
        const filtered = rejected.size ? `，已过滤 ${rejected.size} 个非产物地址` : "";
        const stale = expectVideo && baselineVideos.size ? `（页面上的 ${baselineVideos.size} 个视频都是上次会话留下的，没有等到新视频）` : "";
        emit({ type: "result", ok: false, error: { reason: "NO_ARTIFACT", message: `等待产物超时（15 分钟未拿到生成结果${filtered}${stale}）` } });
    } else {
        progress(`下载完成：${files.length} 个产物`);
        emit({ type: "result", ok: true, files, text: await site.readLastAnswer(page).catch(() => "") });
    }

    // 浏览器窗口保持打开（由用户自己关），本任务用的标签页在 finally 里收拾
    progress("任务结束");
} catch (error) {
    emit({ type: "result", ok: false, error: { reason: "RUNNER_ERROR", message: error instanceof Error ? error.message : String(error) } });
    progress(`[DOUBAO_BROWSER] 出错：${String(error.message || error).slice(0, 200)}`);
} finally {
    // 不 close 浏览器：这是用户的 Edge，由用户自己关。CDP 连接由进程退出自然断开。
    if (page) {
        await page.evaluate(() => { window.__lihuoBusy = false; }).catch(() => undefined);
        if (ownsPage) await page.close().catch(() => undefined);
    }
}
