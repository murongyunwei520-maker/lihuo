import type { IncomingMessage, ServerResponse } from "node:http";
import { getDb } from "../db.ts";
import { config } from "../config.ts";
import { hashPassword, validatePassword, validateUsername, verifyPassword } from "../security/password.ts";
import { createSession, revokeSession, resolveSession } from "../security/session.ts";
import { clientIp, fail, isObject, ok, parseCookies, readJson } from "../http/respond.ts";

const COOKIE = "lihuo_session";

export function sessionToken(req: IncomingMessage): string | null {
  return parseCookies(req.headers.cookie)[COOKIE] ?? null;
}

function setSessionCookie(res: ServerResponse, token: string, maxAgeSeconds: number): void {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.cookieSecure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  status: string;
  quota_cents: number;
}

/* ----------------------------- 登录限流 ----------------------------- */

function tooManyAttempts(username: string, ip: string): boolean {
  const db = getDb();
  const since = Math.floor(Date.now() / 1000) - config.loginWindowSeconds;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
       WHERE username = ? AND created_at > ? AND ok = 0`,
    )
    .get(username, since) as { n: number };
  // 同时按 IP 限制，避免只换用户名绕过
  const byIp = db
    .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND created_at > ? AND ok = 0`)
    .get(ip, since) as { n: number };
  return row.n >= config.loginMaxAttempts || byIp.n >= config.loginMaxAttempts * 3;
}

function recordAttempt(username: string, ip: string, okFlag: boolean): void {
  getDb()
    .prepare(`INSERT INTO login_attempts (username, ip, ok, created_at) VALUES (?, ?, ?, ?)`)
    .run(username, ip, okFlag ? 1 : 0, Math.floor(Date.now() / 1000));
}

/* ------------------------------- 接口 ------------------------------- */

export async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (!isObject(body)) return fail(res, 400, "invalid_body", "请求体格式不正确");

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const ip = clientIp(req);

  if (!username || !password) return fail(res, 400, "missing_credentials", "用户名和密码不能为空");
  if (tooManyAttempts(username, ip)) {
    return fail(res, 429, "too_many_attempts", "尝试次数过多，请稍后再试");
  }

  const row = getDb()
    .prepare(`SELECT id, username, password_hash, role, status, quota_cents FROM users WHERE username = ?`)
    .get(username) as UserRow | undefined;

  // 用户不存在与密码错误返回同一提示，避免用户名枚举
  if (!row || !verifyPassword(password, row.password_hash)) {
    recordAttempt(username, ip, false);
    return fail(res, 401, "invalid_credentials", "用户名或密码错误");
  }
  if (row.status !== "active") {
    recordAttempt(username, ip, false);
    return fail(res, 403, "account_disabled", "账号已被禁用");
  }

  recordAttempt(username, ip, true);
  const token = createSession(row.id, ip, String(req.headers["user-agent"] ?? ""));
  setSessionCookie(res, token, config.sessionTtlHours * 3600);

  return ok(res, {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    quotaCents: row.quota_cents,
  });
}

export async function logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = sessionToken(req);
  if (token) revokeSession(token);
  clearSessionCookie(res);
  return ok(res, { loggedOut: true });
}

export async function me(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = resolveSession(sessionToken(req));
  if (!user) return fail(res, 401, "unauthenticated", "未登录或会话已过期");
  return ok(res, user);
}

export async function register(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!config.allowRegister) {
    return fail(res, 403, "register_disabled", "当前未开放注册，请联系管理员创建账号");
  }
  const body = await readJson(req);
  if (!isObject(body)) return fail(res, 400, "invalid_body", "请求体格式不正确");

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  const uErr = validateUsername(username);
  if (uErr) return fail(res, 400, "invalid_username", uErr);
  const pErr = validatePassword(password);
  if (pErr) return fail(res, 400, "weak_password", pErr);

  const db = getDb();
  const exists = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
  if (exists) return fail(res, 409, "username_taken", "用户名已被占用");

  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO users (username, password_hash, role, status, quota_cents, created_at, updated_at)
     VALUES (?, ?, 'user', 'active', 0, ?, ?)`,
  ).run(username, hashPassword(password), now, now);

  return ok(res, { username }, 201);
}
