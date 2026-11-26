/** 运行时配置：全部来自环境变量，不在代码里硬编码任何密钥 */

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  port: Number(env("LIHUO_PORT", "3100")),
  host: env("LIHUO_HOST", "127.0.0.1"),

  /** 网关根地址（New-API），不带 /v1 */
  gatewayBaseUrl: env("NEW_API_BASE_URL", "http://127.0.0.1:3001"),
  /** 平台令牌 sk-，仅服务端持有 */
  gatewayApiKey: env("NEW_API_KEY"),
  /** 网关管理凭据（可选） */
  gatewayAdminToken: env("NEW_API_ADMIN_TOKEN"),

  /** SQLite 文件路径 */
  dbPath: env("LIHUO_DB_PATH", "data/lihuo.db"),

  /** 是否允许自助注册（默认关闭，用户由管理员创建） */
  allowRegister: env("LIHUO_ALLOW_REGISTER", "false") === "true",

  /** 首次启动时创建管理员的凭据；留空则自动生成并写入 data/.bootstrap-admin */
  adminUsername: env("LIHUO_ADMIN_USERNAME", "admin"),
  adminPassword: env("LIHUO_ADMIN_PASSWORD"),

  /** 会话有效期（小时） */
  sessionTtlHours: Number(env("LIHUO_SESSION_TTL_HOURS", "168")),

  /** 登录失败限流：窗口内最大尝试次数 */
  loginMaxAttempts: Number(env("LIHUO_LOGIN_MAX_ATTEMPTS", "8")),
  loginWindowSeconds: Number(env("LIHUO_LOGIN_WINDOW_SECONDS", "300")),

  /** 生产环境上 HTTPS 后置为 true */
  cookieSecure: env("LIHUO_COOKIE_SECURE", "false") === "true",

  /** 可信反代地址/IP 段：只有来自这些地址的 X-Forwarded-For 才被信任（留空表示直连） */
  trustProxy: env("LIHUO_TRUST_PROXY", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  /** 允许的前端来源（CORS），逗号分隔；默认允许本地开发端口 */
  corsOrigins: env("LIHUO_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export function assertConfig(): void {
  const problems: string[] = [];
  if (!config.gatewayBaseUrl.startsWith("http")) problems.push("NEW_API_BASE_URL 不是合法 URL");
  if (!config.gatewayApiKey) problems.push("NEW_API_KEY 未设置（网关调用会失败）");
  if (problems.length) {
    console.warn("[config] 警告：\n  - " + problems.join("\n  - "));
  }
  // 公网部署常见错误：已经对外监听，却还发非 Secure 的会话 Cookie
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host) && !config.cookieSecure) {
    console.warn("[config] 警告：服务不是只监听本机，但 LIHUO_COOKIE_SECURE 不是 true；公网 HTTPS 部署必须开启。");
  }
}
