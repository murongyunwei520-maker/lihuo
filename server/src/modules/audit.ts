import { getDb } from "../db.ts";
import type { SessionUser } from "../security/session.ts";

/**
 * 审计：管理员敏感操作统一从这里写
 * 不记录密码、令牌等敏感明文，只记"改了什么"。
 */
export function writeAudit(
  actor: SessionUser,
  action: string,
  target: string,
  detail: unknown,
  ip: string,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (user_id, username, action, target, detail, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actor.id,
        actor.username,
        action,
        target,
        JSON.stringify(detail ?? null),
        ip,
        Math.floor(Date.now() / 1000),
      );
  } catch (e) {
    // 审计失败不能阻断主流程，但必须留痕到控制台
    console.error("[audit] 写入失败:", action, target, e);
  }
}
