import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../db.ts";
import { config } from "../config.ts";

/**
 * 会话：不透明随机 token + 数据库存储哈希
 * ------------------------------------------------------------
 * 不用 JWT 的原因：会话需要能即时吊销（封禁用户、改密码），
 * 无状态 token 做不到"立刻失效"，除非再引入黑名单。
 */

export interface SessionUser {
  id: number;
  username: string;
  role: "admin" | "user";
  status: "active" | "banned";
  quotaCents: number;
}

export interface SessionRecord {
  sessionId: string;
  userId: number;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createSession(userId: number, ip: string | null, ua: string | null): string {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const expires = now + config.sessionTtlHours * 3600;

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomBytes(16).toString("hex"), userId, sha256(token), now, expires, ip, ua);

  return token;
}

export function resolveSession(token: string | null): SessionUser | null {
  if (!token) return null;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare(
      `SELECT s.id AS sid, s.expires_at, u.id, u.username, u.role, u.status, u.quota_cents
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), now) as
    | { sid: string; expires_at: number; id: number; username: string; role: string; status: string; quota_cents: number }
    | undefined;

  if (!row) return null;
  // 被禁用的账号，会话立即失效（不靠前端判断）
  if (row.status !== "active") return null;

  // 滑动续期：剩余不足一半时延长
  const ttl = config.sessionTtlHours * 3600;
  if (row.expires_at - now < ttl / 2) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(now + ttl, row.sid);
  }

  return {
    id: row.id,
    username: row.username,
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "banned" ? "banned" : "active",
    quotaCents: row.quota_cents,
  };
}

export function revokeSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** 封禁/改密后清空该用户全部会话 */
export function revokeAllSessions(userId: number): void {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function cleanupExpiredSessions(): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  // 登录尝试记录只保留最近一天
  getDb().prepare("DELETE FROM login_attempts WHERE created_at < ?").run(now - 86400);
}
