// 仅用于测试编排逻辑的假 dbb CLI：严格按 doubao-brain 的 --json 契约输出。
// 真实运行时由 DBB_CLI 指回 vendor/doubao-brain/dbb/cli.mjs。
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0];
const stateDir = process.env.DBB_STATE_DIR || path.join(process.cwd(), ".fake-state");
const loggedInFile = path.join(stateDir, "fake-logged-in.json");
fs.mkdirSync(stateDir, { recursive: true });

function emit(value, code = 0) {
    process.stdout.write(JSON.stringify(value));
    process.exit(code);
}

function flag(name) {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
}

if (command === "doctor") {
    const loggedIn = fs.existsSync(loggedInFile);
    emit({
        ok: true,
        checks: [
            { name: "node", ok: true, detail: process.version },
            { name: "deps", ok: true, detail: "fake" },
            { name: "browser", ok: true, detail: "fake-browser" },
            { name: "login", ok: loggedIn, detail: loggedIn ? "fake@doubao" : "" },
        ],
        deep: { cookies: { login: loggedIn ? ["sessionid"] : [] } },
    });
}

if (command === "login") {
    process.stderr.write("  打开浏览器等待扫码…\n");
    await new Promise((r) => setTimeout(r, 1200));
    fs.writeFileSync(loggedInFile, "1");
    emit({ ok: true, loginState: "logged-in", url: "https://www.doubao.com/chat/" });
}

if (command === "logout") {
    fs.rmSync(loggedInFile, { force: true });
    emit({ ok: true, loggedOut: true });
}

if (command === "list-models") {
    emit({ ok: true, current: "快速", options: ["快速", "2.1 Turbo"], capabilities: ["对话", "视频生成", "图像生成", "帮我写作"] });
}

if (command === "ask") {
    const prompt = flag("prompt") || "";
    const capability = flag("capability") || "对话";
    const attach = flag("attach") || "";
    process.stderr.write("  切换能力…\n");
    await new Promise((r) => setTimeout(r, 500));
    process.stderr.write("  豆包要求确认参数（预计等待 10 分钟），自动回复「确认」…\n");
    await new Promise((r) => setTimeout(r, 800));

    if (capability !== "视频生成") {
        emit({ ok: true, text: "只支持视频生成", files: [], mode: "chat" });
    }

    const downloads = path.join(stateDir, "downloads", "fake-workspace");
    fs.mkdirSync(downloads, { recursive: true });
    const file = path.join(downloads, `video-${Date.now()}.mp4`);
    // 写一个极小的 mp4 头，仅用于验证下载链路（不是真实视频）
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(2048)]));

    emit({
        ok: true,
        requestId: "fake",
        threadUrl: "https://www.doubao.com/chat/fake",
        modes: { model: "快速", requested: null, capability: "视频生成", capabilityRequested: capability },
        text: `已生成视频。prompt=${prompt} attach=${attach}`,
        files: [{ file, bytes: fs.statSync(file).size, kind: "video", contentType: "video/mp4" }],
        artifacts: { videos: 1, images: 0 },
        confirmRounds: 1,
        mode: "artifact",
        elapsedMs: 2600,
    });
}

emit({ ok: false, reason: "INVALID_ARGUMENTS", message: `fake cli: unknown command ${command}` }, 2);
