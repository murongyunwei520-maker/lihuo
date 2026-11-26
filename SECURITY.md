# Security Policy

## Supported Versions

infinite-canvas is in active development. Security fixes are accepted for the
`main` branch and the latest tagged release. Older versions may be handled on a
best-effort basis.

## 公网部署前必做（离火）

- **不要把豆包账号池打进镜像或上传到服务器**。`.doubao-accounts/`、`.doubao-venv/`、`.doubao-session.json` 只属于本机，已在 `.gitignore` 和 `.dockerignore` 排除；构建前运行 `node scripts/security-check.mjs` 复核。
- **doubao-bridge 只允许监听回环地址**。它持有豆包登录态；公网服务器上不要启动，也不要把 `9091` 端口映射出去。需要远程使用时走 SSH 隧道。桥接的二维码 / 产物接口只对白名单 Origin 返回 CORS 头，禁止改回 `*`。
- **上游 API Key 只在服务端 `.env.docker` / 环境变量里**，不要写进前端 `VITE_*`、`config.js`、localStorage 或导出的配置 JSON。前端导出的配置会剥离 API Key 与 WebDAV 密码。
- **真实部署的后端工程（默认 `../lihuo后端`）也要保留 `.dockerignore` / `.gitignore` 里的 `.env*` 与 `data/`**；`docker-compose.stack.yml` 通过 `env_file` 注入密钥，不要把 `.env.docker` 或 `data/` 放进构建上下文。
- **不要把带账号 / 二维码 / Key 的 UI 截图提交到仓库**。`scripts/security-check.mjs` 会扫描未跟踪文件并提示未跟踪图片；提交前人工确认画面中没有敏感信息。
- **HTTPS 部署必须设置 `LIHUO_COOKIE_SECURE=true`**，并配置可信反代的 `LIHUO_TRUST_PROXY`，否则登录限流会按伪造的 `X-Forwarded-For` 统计。
- **首次启动生成的管理员密码只写在 `/data/.bootstrap-admin.txt`**，登录后立即修改密码并删除该文件；不要提交 `server/data/` 或把该文件打进镜像。
- 如果曾经把 `.env`、账号目录或带 Key 的配置提交/推送过，视为已泄露：先轮换 Key、退出豆包账号，再清理历史，不要只删当前文件。后端 `.env.docker` 进过 Git 时，除清理历史外还必须轮换 `LIHUO_ADMIN_PASSWORD`、`STORAGE_SECRET` 和 `LIHUO_INVITE_CODE`，否则旧值仍可从历史恢复。

## Reporting a Vulnerability

Please do not open a public issue with exploit details, credentials, private
API keys, proof-of-concept code, or screenshots that reveal sensitive data.

Preferred reporting channels:

1. Use GitHub private vulnerability reporting or a GitHub Security Advisory for
   this repository, if available.
2. If a private GitHub report is not available, email `1844025705@qq.com` with
   the subject `[infinite-canvas security]`.
3. If neither private channel is available, open a public issue that asks for a
   private contact channel and does not include technical exploit details.

Please include:

- Affected version, commit, branch, or deployment mode.
- Clear reproduction steps.
- Impact and attack scenario.
- Any relevant logs, screenshots, or proof of concept, with secrets removed.
- Whether the issue affects local-only usage, hosted deployments, browser
  storage, WebDAV sync, AI provider configuration, or API proxy behavior.

## Scope

### Canvas node plugins

The canvas supports third-party node plugins loaded from a remote URL. By
design, an installed plugin's code runs directly inside the web app with full
access to the page, including locally stored data such as AI API keys. This is
an intentional trade-off for extensibility, and the installer shows a warning
before installing. Therefore:

- Only install plugins from sources you trust.
- Reports that a *malicious plugin* can access page data or API keys are **out
  of scope** — that is the documented behavior of the trust model.
- Reports **in scope** include: the app loading/executing plugin code without
  the install confirmation, a plugin escaping its declared node type to break
  core app integrity in ways not implied by "runs in the page", or the plugin
  source cache being writable by an unrelated origin.

Examples of in-scope reports:

- Cross-site scripting or token exfiltration in the web app.
- Exposure of locally stored API keys or synced canvas data caused by project
  code.
- Unsafe file handling, import/export behavior, or WebDAV proxy behavior.
- Authentication, authorization, or access-control flaws in project-managed
  features.
- Supply-chain issues that are exploitable through this repository's shipped
  code or default configuration.

Examples that are usually out of scope:

- Vulnerabilities in third-party AI providers, model APIs, hosting platforms,
  or browser extensions outside this repository.
- Compromise of a user's own API key outside the app.
- Denial-of-service reports that require unrealistic traffic volume or physical
  access to the user's device.
- Missing security headers without a demonstrated exploit path.
- Social engineering, phishing, spam, or account recovery requests.
- Dependency reports without a practical impact on this project.

## Disclosure

The maintainers aim to acknowledge valid reports within 7 days and coordinate a
fix before public disclosure. Response and fix timelines are best effort for
this community project.

Please allow time for investigation and remediation before publishing details.
Credit will be given on request unless you prefer to remain anonymous.

