// 离火生产包静态服务器。
// 零依赖：只用 Node 内置模块，直接服务 web/dist，并为前端路由做 index.html 回退。
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "web/dist");
const port = Number(process.argv[3] ?? 3000);
const host = process.argv[4] ?? "127.0.0.1";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
};

function contentType(file) {
    return MIME[extname(file).toLowerCase()] || "application/octet-stream";
}

// 带内容哈希的 assets 可以长期缓存，入口文件必须每次校验。
function cacheControl(file) {
    return file.startsWith(join(root, "assets") + sep) ? "public, max-age=31536000, immutable" : "no-cache";
}

function sendFile(res, file, status = 200) {
    const stat = statSync(file);
    res.writeHead(status, {
        "content-type": contentType(file),
        "content-length": stat.size,
        "cache-control": cacheControl(file),
    });
    createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" });
        res.end();
        return;
    }

    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const relative = pathname.replace(/^[/\\]+/, "");
    let file = resolve(root, relative);

    // 目录穿越保护：解析后的路径必须仍在 dist 里。
    if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
    }

    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");

    if (!existsSync(file) || !statSync(file).isFile()) {
        // 无扩展名的路径交给前端路由，返回 index.html。
        if (extname(relative)) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("not found");
            return;
        }
        file = join(root, "index.html");
        if (!existsSync(file)) {
            res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
            res.end("index.html not found, run a build first");
            return;
        }
    }

    sendFile(res, file);
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`[lihuo] port ${port} is already in use`);
        process.exit(2);
    }
    console.error("[lihuo] server error:", error.message);
    process.exit(1);
});

server.listen(port, host, () => {
    console.log(`[lihuo] serving ${root}`);
    console.log(`[lihuo] open ${`http://${host}:${port}/`}`);
});
