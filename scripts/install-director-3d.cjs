// 安装「3D 导演台节点」：拉 xiaozangao/3d-director-desk 源码 → 构建 → 装进 web/public/director-3d。
// 用法：node scripts/install-director-3d.cjs
// 说明：该项目为 MIT，本脚本只构建它的网页产物，不改源码。
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const workDir = path.join(repoRoot, ".director-3d-build");
const targetDir = path.join(repoRoot, "web", "public", "director-3d");
const zipPath = path.join(workDir, "director-3d.zip");
const zipUrl = "https://codeload.github.com/xiaozangao/3d-director-desk/zip/refs/heads/main";
const mirror = "https://registry.npmmirror.com";
const bundledPnpm = "C:/Users/qq308/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs";

function run(command, args, options = {}) {
    console.log(`\n$ ${command} ${args.join(" ")}`);
    const result = spawnSync(command, args, { stdio: "inherit", cwd: options.cwd, env: { ...process.env, ...options.env } });
    if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

async function download(url, out) {
    console.log(`\n下载 ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(out, buffer);
    console.log(`已保存 ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
}

function resolvePnpm() {
    const probe = spawnSync("pnpm", ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return { command: "pnpm", args: [] };
    if (fs.existsSync(bundledPnpm)) return { command: process.execPath, args: [bundledPnpm] };
    throw new Error("找不到 pnpm，请先安装 Node.js 与 pnpm");
}

(async () => {
    fs.mkdirSync(workDir, { recursive: true });
    await download(zipUrl, zipPath);
    run("tar", ["-xf", zipPath, "-C", workDir]);

    const sourceDir = fs.readdirSync(workDir, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.startsWith("3d-director-desk"));
    if (!sourceDir) throw new Error("解压后找不到 3d-director-desk 目录");
    const projectDir = path.join(workDir, sourceDir.name);

    const pnpm = resolvePnpm();
    // 这个项目依赖较多，用国内镜像会快很多。
    run(pnpm.command, [...pnpm.args, "install", "--node-linker=hoisted", `--registry=${mirror}`], { cwd: projectDir });
    // --base=/director-3d/ 让产物资源指向自己的子路径。
    run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--base=/director-3d/"], { cwd: projectDir });

    const builtDist = path.join(projectDir, "dist");
    if (!fs.existsSync(path.join(builtDist, "index.html"))) throw new Error("构建产物缺少 index.html");
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(builtDist, targetDir, { recursive: true });

    let size = 0;
    for (const file of fs.readdirSync(targetDir, { recursive: true })) {
        const full = path.join(targetDir, String(file));
        if (fs.statSync(full).isFile()) size += fs.statSync(full).size;
    }
    console.log(`\n✓ 3D 导演台已安装到 web/public/director-3d（${(size / 1024 / 1024).toFixed(1)} MB，主要是角色素材）`);
    console.log("  重新构建后，画布新建菜单里的「导演台」节点即可使用。");
})().catch((error) => {
    console.error("\n✗ 安装失败：", error.message);
    process.exit(1);
});
