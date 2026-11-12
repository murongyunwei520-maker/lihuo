import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config, assertConfig } from "./config.ts";
import { getDb, closeDb } from "./db.ts";
import { hashPassword, validatePassword } from "./security/password.ts";
import { cleanupExpiredSessions } from "./security/session.ts";
import { startServer } from "./http/server.ts";

/**
 * 入口
 * ------------------------------------------------------------
 * 启动顺序：校验配置 → 打开数据库 → 引导首个管理员 → 起 HTTP → 定时清理
 */

function bootstrapAdmin(): void {
  const db = getDb();
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  if (n > 0) return;

  let password = config.adminPassword;
  let generated = false;

  if (!password || validatePassword(password)) {
    // 未提供或强度不足 → 生成一个合规的随机密码
    password = randomBytes(12).toString("base64url") + "Aa1!";
    generated = true;
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO users (username, password_hash, role, status, quota_cents, created_at, updated_at)
     VALUES (?, ?, 'admin', 'active', 0, ?, ?)`,
  ).run(config.adminUsername, hashPassword(password!), now, now);

  console.log(`[bootstrap] 已创建初始管理员：${config.adminUsername}`);

  if (generated) {
    const path = resolve(process.cwd(), "data/.bootstrap-admin.txt");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `username=${config.adminUsername}\npassword=${password}\n\n首次登录后请立即修改密码并删除本文件。\n`,
      "utf8",
    );
    console.log(`[bootstrap] 随机密码已写入 ${path}`);
    console.log(`[bootstrap] 密码：${password}  ← 仅本次显示，请立即保存`);
  }
}

async function main(): Promise<void> {
  assertConfig();
  getDb();
  bootstrapAdmin();

  const { close } = await startServer();

  const timer = setInterval(() => {
    try {
      cleanupExpiredSessions();
    } catch (e) {
      console.error("[cleanup] 失败:", e);
    }
  }, 60 * 60 * 1000);
  timer.unref();

  const shutdown = async (signal: string) => {
    console.log(`\n[server] 收到 ${signal}，正在关闭…`);
    clearInterval(timer);
    await close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[server] 启动失败:", e);
  process.exit(1);
});
