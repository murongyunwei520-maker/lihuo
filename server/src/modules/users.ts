import type { IncomingMessage, ServerResponse } from "node:http";
import { getDb } from "../db.ts";
import { hashPassword, validatePassword, validateUsername } from "../security/password.ts";
import { revokeAllSessions } from "../security/session.ts";
import { clientIp, fail, isObject, ok, readJson } from "../http/respond.ts";
import type { SessionUser } from "../security/session.ts";
import { writeAudit as audit } from "./audit.ts";

export async function listUsers(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rows = getDb()
    .prepare(
      `SELECT id, username, role, status, quota_cents, created_at, updated_at
       FROM users ORDER BY id ASC`,
    )
    .all() as Array<{
    id: number;
    username: string;
    role: string;
    status: string;
    quota_cents: number;
    created_at: number;
    updated_at: number;
  }>;

  return ok(res, {
    total: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      status: r.status,
      quotaCents: r.quota_cents,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
}

export async function createUser(ctx: { params: Record<string, string> }, req: IncomingMessage, res: ServerResponse, actor: SessionUser): Promise<void> {
  const body = await readJson(req);
  if (!isObject(body)) return fail(res, 400, "invalid_body", "请求体格式不正确");

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const role = body.role === "admin" ? "admin" : "user";
  const quotaCents = Number(body.quotaCents ?? 0);

  const uErr = validateUsername(username);
  if (uErr) return fail(res, 400, "invalid_username", uErr);
  const pErr = validatePassword(password);
  if (pErr) return fail(res, 400, "weak_password", pErr);
  if (!Number.isInteger(quotaCents) || quotaCents < 0) {
    return fail(res, 400, "invalid_quota", "额度必须是非负整数（单位：分）");
  }

  const db = getDb();
  if (db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)) {
    return fail(res, 409, "username_taken", "用户名已被占用");
  }

  const now = Math.floor(Date.now() / 1000);
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, status, quota_cents, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(username, hashPassword(password), role, quotaCents, now, now);

  audit(actor, "user.create", `user:${info.lastInsertRowid}`, { username, role, quotaCents }, clientIp(req));
  return ok(res, { id: Number(info.lastInsertRowid), username, role, quotaCents }, 201);
}

export async function patchUser(
  ctx: { params: Record<string, string> },
  req: IncomingMessage,
  res: ServerResponse,
  actor: SessionUser,
): Promise<void> {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, "invalid_id", "用户 id 不合法");

  const body = await readJson(req);
  if (!isObject(body)) return fail(res, 400, "invalid_body", "请求体格式不正确");

  const db = getDb();
  const target = db.prepare(`SELECT id, username, role, status, quota_cents FROM users WHERE id = ?`).get(id) as
    | { id: number; username: string; role: string; status: string; quota_cents: number }
    | undefined;
  if (!target) return fail(res, 404, "user_not_found", "用户不存在");

  const updates: string[] = [];
  const values: unknown[] = [];
  const changed: Record<string, unknown> = {};

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!["active", "banned"].includes(status)) return fail(res, 400, "invalid_status", "状态只能是 active 或 banned");
    // 不允许把自己封禁，避免把自己锁在门外
    if (id === actor.id && status === "banned") {
      return fail(res, 400, "self_ban", "不能封禁自己");
    }
    updates.push("status = ?");
    values.push(status);
    changed.status = status;
  }

  if (body.role !== undefined) {
    const role = String(body.role);
    if (!["admin", "user"].includes(role)) return fail(res, 400, "invalid_role", "角色只能是 admin 或 user");
    if (id === actor.id && role !== "admin") {
      return fail(res, 400, "self_demote", "不能降级自己的管理员角色");
    }
    updates.push("role = ?");
    values.push(role);
    changed.role = role;
  }

  if (body.quotaCents !== undefined) {
    const quota = Number(body.quotaCents);
    if (!Number.isInteger(quota) || quota < 0) {
      return fail(res, 400, "invalid_quota", "额度必须是非负整数（单位：分）");
    }
    updates.push("quota_cents = ?");
    values.push(quota);
    changed.quotaCents = { from: target.quota_cents, to: quota };
  }

  if (body.password !== undefined) {
    const pwd = String(body.password);
    const pErr = validatePassword(pwd);
    if (pErr) return fail(res, 400, "weak_password", pErr);
    updates.push("password_hash = ?");
    values.push(hashPassword(pwd));
    changed.passwordReset = true;
    // 改密后立即失效该用户所有会话
    revokeAllSessions(id);
  }

  if (updates.length === 0) return fail(res, 400, "no_changes", "没有需要更新的字段");

  updates.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000));
  values.push(id);

  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...(values as never[]));

  // 封禁时踢掉全部会话，不能等会话自然过期
  if (changed.status === "banned") revokeAllSessions(id);

  audit(actor, "user.update", `user:${id}`, changed, clientIp(req));
  return ok(res, { id, changed });
}

export async function listAuditLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const rows = getDb()
    .prepare(
      `SELECT id, user_id, username, action, target, detail, ip, created_at
       FROM audit_logs ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return ok(res, {
    total: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      action: r.action,
      target: r.target,
      detail: r.detail ? JSON.parse(String(r.detail)) : null,
      ip: r.ip,
      createdAt: r.created_at,
    })),
  });
}
