// 豆包生成执行器：真正把「模型 / 比例 / 时长 / 素材」应用到豆包页面，再提交并等产物。
// 与 dbb ask 的区别：dbb 只能发 prompt，这里会先点选面板上的模型与参数。
//
// 用法：node run-doubao.mjs <stateDir> <jobSpec.json>
// 输出：一行 {"type":"result",...} 作为最终结果；过程中写 {"type":"progress","message":...}
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

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

const downloadsDir = path.join(stateDir, "downloads", "manual");
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

/** 在弹层里点选一项（模型名 / 比例），点不到返回 false。 */
async function pickOption(page, label) {
    const box = await page.evaluate((target) => {
        const viewportH = window.innerHeight;
        const nodes = [...document.querySelectorAll("button, [role='menuitem'], [role='option'], [role='radio'], div, span")];
        // 比例按钮形如「9:16」，在屏幕下半部；排除输入区触发器本身
        const hits = nodes
            .map((node) => {
                const text = (node.innerText || "").trim().replace(/\s+/g, " ");
                const rect = node.getBoundingClientRect();
                return { node, text, rect };
            })
            .filter((item) => item.text === target && item.rect.width > 12 && item.rect.height > 10 && item.rect.y > viewportH * 0.25);
        if (!hits.length) return null;
        // 取面积最小（最贴近叶子节点）的那个点
        hits.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
        const { rect } = hits[0];
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    }, label);
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(900);
    return true;
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
try {
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
    progress("[DOUBAO_BROWSER] Page 创建成功");
    // 同一个窗口内开一个新标签页 = 新对话；这样同账号并发任务互不干扰，也不新开窗口
    const page = await ctx.newPage();
    progress("[DOUBAO_BROWSER] 在已有窗口内新开标签页（新对话，不新开窗口）");
    progress("[DOUBAO_BROWSER] 开始导航豆包页面");
    await page.goto("https://www.doubao.com/chat/", { waitUntil: "domcontentloaded", timeout: 45000 });
    progress(`[DOUBAO_BROWSER] 豆包页面加载成功，当前 URL: ${page.url()}`);
    // 等页面完全渲染（输入框和功能按钮出现）
    await page.waitForTimeout(12000);
    progress("[DOUBAO_BROWSER] 页面渲染等待完成");

    progress(`切换能力：${spec.capability}`);
    let switched = await site.setCapability(page, spec.capability);
    if (!switched?.ok) {
        // 常见情况：新标签页停在「新工作任务」首页，能力栏还没渲染。
        // 依次尝试：点「新对话」→ 重新导航 → 再切一次。
        progress("能力栏未出现，尝试进入新对话…");
        await page
            .getByText("新对话", { exact: false })
            .first()
            .click({ timeout: 5000 })
            .catch(() => undefined);
        await page.waitForTimeout(4000);
        switched = await site.setCapability(page, spec.capability);
        if (!switched?.ok) {
            progress("仍未出现能力栏，重新加载页面…");
            await page.goto("https://www.doubao.com/chat/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
            await page.waitForTimeout(8000);
            switched = await site.setCapability(page, spec.capability);
        }
    }
    if (!switched?.ok) {
        // 调试：打印页面上包含"视频"或"图像"或"生成"的按钮
        const debugBtns = await page.evaluate(() => {
            return [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer'], div, span")]
                .filter(el => el.getClientRects().length > 0)
                .map(el => (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40))
                .filter(t => t.length > 0 && (t.includes("视频") || t.includes("图像") || t.includes("生成") || t.includes("对话")));
        });
        progress(`[DOUBAO_BROWSER] 相关按钮: ${debugBtns.join(" | ")}`);
        throw new Error(`切换能力失败：${JSON.stringify(switched)}`);
    }
    await page.waitForTimeout(2200);

    // 模型
    if (spec.model) {
        progress(`选模型：${spec.model}`);
        if (await openMenuByPrefix(page, "模型")) {
            const picked = await pickOption(page, spec.model);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(500);
            if (!picked) progress(`模型菜单里没找到「${spec.model}」，保持豆包当前模型`);
        }
    }

    // 比例 / 时长：视频是「自动 · 10s」那种浮层，图片是「比例 自动」按钮
    if (spec.ratio || spec.duration) {
        const isImage = spec.capability === "图像生成";
        const opened = await page.evaluate((imageMode) => {
            const viewportH = window.innerHeight;
            const candidates = [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer']")]
                .map((node) => ({ text: (node.innerText || "").trim().replace(/\s+/g, " "), rect: node.getBoundingClientRect() }))
                .filter((item) => item.rect.width >= 40 && item.rect.height >= 16 && item.rect.y > viewportH * 0.45);
            const hit = candidates.find((item) => {
                if (imageMode) return item.text.startsWith("比例") || /^\d+:\d+\s*·/.test(item.text);
                return /·/.test(item.text) || (/^\d+\s*s$/.test(item.text) === false && /\d+\s*s/.test(item.text));
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
                const ok = await pickOption(page, spec.ratio);
                if (ok) progress(`比例已设为 ${spec.ratio}`);
                else {
                    const available = await page.evaluate(() => [...document.querySelectorAll("button, [role='radio'], [role='option']")].map((el) => (el.innerText || "").trim()).filter((t) => /^\d+:\d+$|^自动$/.test(t)).slice(0, 10));
                    progress(`比例 ${spec.ratio} 未找到，可选：${available.join(" / ") || "未识别"}`);
                }
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
    const panelText = await page.evaluate(() => {
        const vh = window.innerHeight;
        return [...document.querySelectorAll("button, [role='button'], [class*='cursor-pointer'], span, div")]
            .filter((node) => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.y > vh * 0.3;
            })
            .map((node) => (node.innerText || "").trim().replace(/\s+/g, " "))
            .filter((text) => text.length > 0 && text.length < 60)
            .join(" | ");
    });
    progress(`参数读回：${panelText.slice(0, 160) || "—"}`);
    const wantRatio = spec.ratio && spec.ratio !== "自动";
    const modelOk = !spec.model || panelText.includes(spec.model);
    const ratioOk = !wantRatio || panelText.includes(spec.ratio);
    const durationOk = !spec.duration || panelText.includes(`${spec.duration}s`);
    if (!modelOk || !ratioOk || !durationOk) {
        // 不中断：豆包面板结构可能变化，图片/提示词仍要提交；但把差异写清楚
        progress(`参数可能未完全生效：期望 ${spec.model || "-"} / ${spec.ratio || "-"} / ${spec.duration || "-"}s（继续提交，附素材）`);
    } else {
        progress("参数已按画布选择生效");
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
            const beforeUpload = await page.evaluate(() => document.querySelectorAll('img[src^="blob:"], img[src^="data:"], [class*="attachment"], [class*="file-item"]').length);
            await input.setInputFiles(spec.attachments, { timeout: 60000 });
            await page.waitForTimeout(5000);
            const afterUpload = await page.evaluate(() => document.querySelectorAll('img[src^="blob:"], img[src^="data:"], [class*="attachment"], [class*="file-item"]').length);
            progress(`素材上传完成：输入区素材元素 ${beforeUpload} → ${afterUpload}`);
            if (afterUpload <= beforeUpload) progress("⚠ 没检测到素材进入输入区，但继续提交（请看豆包窗口确认）");
        }
    }

    progress("发送提示词…");
    const injected = await site.injectPrompt(page, spec.prompt);
    if (!injected.ok) throw new Error(`注入提示词失败：${injected.valueLength}/${injected.expected}`);
    const sent = await site.sendPrompt(page);
    if (!sent.ok) throw new Error(`发送失败：${sent.reason || ""}`);

    // 确认参数（豆包会列参数要求确认）
    for (let round = 0; round < 3; round += 1) {
        await page.waitForTimeout(4000);
        const said = await site.readLastAnswer(page).catch(() => "");
        if (!/确认/.test(said)) break;
        progress(`豆包要求确认参数（第 ${round + 1} 轮），回复确认…`);
        await site.injectPrompt(page, "确认，开始生成");
        await site.sendPrompt(page);
    }

    progress("等待产物…");
    const deadline = Date.now() + 15 * 60 * 1000;
    let filtered = { videos: [], images: [] };
    // P0-4: 明确使用 expectedArtifactKind，不靠 capability/mode 字符串猜测
    const expectVideo = spec.expectedArtifactKind === "video";
    while (Date.now() < deadline) {
        await page.waitForTimeout(8000);
        const raw = await site.extractArtifacts(page);
        const candidate = site.filterArtifacts(raw);
        if (expectVideo) {
            // 视频任务：必须等到真正的视频，不能因为页面上有图片就结束
            if (candidate.videos.length) {
                filtered = candidate;
                break;
            }
        } else {
            // 图片任务：必须等到图片
            if (candidate.images.length) {
                filtered = candidate;
                break;
            }
        }
    }

    const targets = [
        ...filtered.videos.map((item) => ({ kind: "video", url: item.url, meta: item })),
        ...filtered.images.map((item) => ({ kind: "image", url: item.url, meta: item })),
    ];
    if (!targets.length) {
        emit({ type: "result", ok: false, error: { reason: "NO_ARTIFACT", message: "等待产物超时" } });
    } else {
        progress(`产物就绪：${filtered.videos.length} 视频 / ${filtered.images.length} 图片，开始下载…`);
        const cookieHeader = (await ctx.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
        const downloaded = await site.downloadArtifactsByUrl(targets, downloadsDir, cookieHeader);
        const files = downloaded.filter((item) => item.ok).map((item) => ({ file: item.file, bytes: item.bytes, kind: item.kind, contentType: item.contentType }));
        emit({ type: "result", ok: files.length > 0, files, text: await site.readLastAnswer(page).catch(() => "") });
    }

    // 保持浏览器开着，方便查看（用户要求不关）
    // 复用 viewer 模式下：runner 干完活就退出，viewer 窗口由 open-account.mjs 自己常驻
    progress("任务结束（复用已开窗口，保持打开）");
} catch (error) {
    emit({ type: "result", ok: false, error: { reason: "RUNNER_ERROR", message: error instanceof Error ? error.message : String(error) } });
    // 出错时保留标签页便于排查，但不阻塞进程退出
    progress(`[DOUBAO_BROWSER] 出错：${String(error.message || error).slice(0, 200)}`);
} finally {
    // 不 close 浏览器：这是用户的 Edge，由用户自己关。CDP 连接由进程退出自然断开。
}
