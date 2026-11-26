#!/usr/bin/env node
// 公网部署前安全检查：确认密钥、豆包账号态、运行期数据库不会进 Git / Docker 构建上下文 / 前端产物。
// 用法：node scripts/security-check.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const warnings = [];

function fail(message) {
    failures.push(message);
}
function warn(message) {
    warnings.push(message);
}
function git(args) {
    return gitIn(ROOT, args);
}
// Git 不一定在 PATH（Windows 常见），不能因为 execFileSync 抛错就跳过全部历史/跟踪文件检查。
const GIT_BINARY = (() => {
    if (process.env.GIT_BINARY) return process.env.GIT_BINARY;
    const candidates = process.platform === "win32" ? ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe", path.join(process.env.LOCALAPPDATA || "", "Programs\\Git\\cmd\\git.exe")] : [];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "git";
})();
function gitIn(cwd, args) {
    try {
        return execFileSync(GIT_BINARY, args, { cwd, encoding: "utf8" }).trim();
    } catch {
        return "";
    }
}
if (fs.existsSync(path.join(ROOT, ".git")) && !git(["rev-parse", "--is-inside-work-tree"])) {
    fail("找不到可用的 Git 可执行文件（或当前目录不是 Git 仓库），无法检查已跟踪文件和历史提交");
}

/* 1. Git 里不能出现账号态 / 环境变量 / 运行期数据 */
const tracked = git(["ls-files"]).split("\n").filter(Boolean);
const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
if (!tracked.length) warn("当前目录不是 Git 仓库或没有已跟踪文件，跳过 Git 敏感文件检查");
const forbiddenTracked = [
    [/^\.doubao-accounts\//, "豆包账号 profile / 登录 Cookie"],
    [/^\.doubao-venv\//, "豆包 Python 运行环境"],
    [/^\.doubao-service\//, "豆包常驻服务数据"],
    [/^\.doubao-session\.json$/, "豆包会话文件"],
    [/^server\/data\//, "后端 SQLite / 引导凭据"],
    [/^data\//, "运行期数据"],
    [/^\.backup\//, "本地备份快照"],
    [/(^|\/)\.env$/, "真实 .env"],
    [/(^|\/)\.env\.[A-Za-z0-9_.-]+$/, "真实 .env.*"],
];
for (const file of tracked) {
    if (/\.env\.example$/.test(file)) continue;
    const hit = forbiddenTracked.find(([pattern]) => pattern.test(file));
    if (hit) fail(`Git 已跟踪敏感文件：${file}（${hit[1]}）`);
}

/* 1b. 这些目录即使当前未跟踪，也必须被 .gitignore 挡住，避免下次误提交 */
const gitignorePath = path.join(ROOT, ".gitignore");
if (!fs.existsSync(gitignorePath)) {
    fail("缺少 .gitignore");
} else {
    const lines = fs
        .readFileSync(gitignorePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
    for (const entry of [".doubao-accounts/", ".doubao-venv/", ".doubao-service/", ".doubao-session.json", ".backup/", ".env*"]) {
        if (!lines.includes(entry)) fail(`.gitignore 缺少「${entry}」，账号态或密钥可能被误提交`);
    }
}

/* 1c. 历史提交同样会随公开仓库一起泄露：敏感路径只要出现过一次就不能算干净 */
const historyPaths = git(["log", "--all", "--pretty=format:", "--name-only"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const historySensitive = [...new Set(historyPaths.filter((file) => /^(\.doubao-accounts\/|\.doubao-venv\/|\.doubao-service\/|\.doubao-session\.json$|server\/data\/|data\/|\.env($|\.))/.test(file) && !/\.env\.example$/.test(file)))].concat(
    [...new Set(historyPaths.filter((file) => /(^|\/)\.env(\.docker|\.local|\.production|\.development)?$/.test(file) && !/\.env\.example$/.test(file)))],
);
if (historySensitive.length) fail(`Git 历史提交里出现过敏感路径（当前删掉也仍可从历史恢复）：${historySensitive.slice(0, 5).join("、")}${historySensitive.length > 5 ? " 等" : ""}`);
if (historyPaths.some((file) => file.startsWith(".backup/"))) warn("Git 历史里提交过 .backup 备份目录；公开仓库前建议清理历史或换一个干净仓库发布");

/* 2. 常见密钥 / 豆包 Cookie 不能出现在源码或前端产物里 */
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".mdx", ".yml", ".yaml", ".sh", ".bat", ".ps1", ".html", ".css", ".toml", ".ini", ".diff", ".patch"]);
const SECRET_PATTERNS = [
    { label: "疑似 OpenAI / New-API 密钥", re: /\bsk-[A-Za-z0-9]{24,}\b/ },
    { label: "疑似 Google API 密钥", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
    { label: "疑似豆包登录 Cookie", re: /(?:passport_csrf_token|odin_tt|sessionid_ss?|sid_guard|sid_tt)=([^;\s"'`]{12,})/ },
    { label: "疑似私钥", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
function scanFiles(files, scope) {
    for (const file of files) {
        const full = path.join(ROOT, file);
        let stat;
        try {
            stat = fs.statSync(full);
        } catch {
            continue;
        }
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
        if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
        let text;
        try {
            text = fs.readFileSync(full, "utf8");
        } catch {
            continue;
        }
        for (const { label, re } of SECRET_PATTERNS) {
            const match = re.exec(text);
            if (!match) continue;
            const line = text.slice(0, match.index).split("\n").length;
            fail(`${scope}发现${label}：${file}:${line}（为避免二次泄露，这里不打印具体值）`);
        }
    }
}
scanFiles(tracked.filter((file) => !file.startsWith("vendor/")), "源码/配置");
// 未跟踪但未被 .gitignore 挡住的文件同样可能被 `git add -A` 带进仓库，一并扫描密钥特征。
scanFiles(untracked.filter((file) => !file.startsWith("vendor/")), "未跟踪文件");
const untrackedImages = untracked.filter((file) => /\.(png|jpg|jpeg|webp|gif)$/i.test(file));
if (untrackedImages.length) warn(`发现 ${untrackedImages.length} 个未跟踪图片（如 UI 截图），提交前请确认画面里没有账号、密钥或登录二维码`);
const distFiles = [];
function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else distFiles.push(path.relative(ROOT, full).replace(/\\/g, "/"));
    }
}
walk(path.join(ROOT, "web", "dist"));
scanFiles(distFiles, "前端产物");

/* 3. Docker 构建上下文必须排除账号态与运行期数据 */
const dockerignorePath = path.join(ROOT, ".dockerignore");
if (!fs.existsSync(dockerignorePath)) {
    fail("缺少 .dockerignore：Docker 构建会把整个目录（含 .doubao-accounts）发给构建器");
} else {
    const lines = fs
        .readFileSync(dockerignorePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
    const required = [".doubao-accounts", ".doubao-venv", ".doubao-service", ".doubao-session.json", ".backup", "server/data", "data", ".env*"];
    for (const entry of required) {
        if (!lines.includes(entry)) fail(`.dockerignore 缺少「${entry}」，构建上下文可能包含敏感文件`);
    }
}
const dockerfilePath = path.join(ROOT, "Dockerfile");
if (fs.existsSync(dockerfilePath)) {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    if (/^\s*(COPY|ADD)\b.*(\.doubao-accounts|\.doubao-venv|\.doubao-session|server\/data|(^|\/)\.env\b)/im.test(dockerfile)) {
        fail("Dockerfile 的 COPY/ADD 引用了账号态或 .env");
    }
}

/* 3b. 实际部署的后端工程（默认 ../lihuo后端）也不能把 .env / data 打进镜像 */
const backendDir = path.resolve(ROOT, "../lihuo后端");
if (fs.existsSync(backendDir)) {
    for (const [name, required] of [
        [".dockerignore", [".env", ".env.docker", "data", "node_modules"]],
        [".gitignore", [".env", "data"]],
    ]) {
        const file = path.join(backendDir, name);
        if (!fs.existsSync(file)) {
            fail(`后端工程缺少 ${name}，构建或提交时可能带上会话密钥 / 运行期数据`);
            continue;
        }
        const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
        for (const entry of required) {
            if (!lines.includes(entry)) fail(`后端工程 ${name} 缺少「${entry}」`);
        }
    }
    // 历史提交比当前工作区更难发现：.env.docker 一旦进过 Git，里面的管理员密码和 STORAGE_SECRET 就视为泄露。
    const backendHistory = gitIn(backendDir, ["log", "--all", "--pretty=format:", "--name-only"])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const leakedEnvHistory = [...new Set(backendHistory.filter((file) => /^(\.env|\.env\.docker|data\/)/.test(file) && !/\.env\.example$/.test(file)))];
    if (leakedEnvHistory.length) {
        fail(`后端 Git 历史提交过 ${leakedEnvHistory.join("、")}：请轮换 LIHUO_ADMIN_PASSWORD / STORAGE_SECRET / LIHUO_INVITE_CODE，并清理该仓库历史后再公开`);
    }
}

/* 3c. 本地豆包桥接持有登录态：文件 / 二维码接口不允许 CORS 通配，且只能监听回环地址 */
const bridgeServer = path.join(ROOT, "doubao-bridge", "server.mjs");
if (fs.existsSync(bridgeServer)) {
    const source = fs.readFileSync(bridgeServer, "utf8");
    if (/access-control-allow-origin["'`]?\s*[:,]\s*["'`]\*/.test(source)) fail("doubao-bridge 仍对文件/二维码接口返回 CORS *，任意网页可读取账号登录态截图");
    if (!/LOOPBACK_HOSTS\.has/.test(source) || !/process\.exit\(1\)/.test(source)) fail("doubao-bridge 缺少回环地址监听限制");
}

/* 4. 前端默认不能直连本地桥接以外的上游密钥入口（只做提示，不阻断） */
if (fs.existsSync(path.join(ROOT, "web", "dist"))) {
    // 产物里如果出现 bridge 地址是正常的（本地功能）；出现账号目录路径才是异常。
    const distLeak = distFiles.find((file) => {
        if (!/\.(js|html|json|css)$/i.test(file)) return false;
        try {
            return /(?:passport_csrf_token|sessionid_ss?|sid_guard|odin_tt)=[A-Za-z0-9%._-]{12,}|\.doubao-accounts\/[A-Za-z0-9_-]+\/(?:state|uploads)/.test(fs.readFileSync(path.join(ROOT, file), "utf8"));
        } catch {
            return false;
        }
    });
    if (distLeak) fail(`前端产物里出现登录 Cookie 或账号 profile 特征：${distLeak}`);
}

/* 输出 */
console.log("离火公网部署安全检查");
console.log(`检查文件：${tracked.length} 个已跟踪文件、${untracked.length} 个未跟踪文件；前端产物：${distFiles.length} 个文件`);
if (warnings.length) {
    console.log("\n警告：");
    for (const item of warnings) console.log(`  - ${item}`);
}
if (failures.length) {
    console.log("\n未通过：");
    for (const item of failures) console.log(`  - ${item}`);
    console.log("\n请先处理以上问题，再构建 / 推送镜像。");
    process.exit(1);
}
console.log("\n通过：未发现被跟踪的密钥/账号态，Docker 构建上下文已排除敏感目录。");
