import { getDb } from "../db.ts";

/**
 * 计费：预扣 → 结算 →（失败）退款
 * ------------------------------------------------------------
 * 权威原则（决策 A1）：用户账单以离火为准。
 * 网关返回的 quota 只作为「成本」记录，用于对账，不直接转成用户账单。
 *
 * 金额一律整数「分」，任何地方不出现浮点。
 */

export interface ModelPrice {
  model: string;
  inCentsPer1k: number;
  outCentsPer1k: number;
  enabled: boolean;
}

export interface ReserveResult {
  recordId: number;
  reservedCents: number;
  replayed?: { content: string | null; costCents: number; promptTokens: number; completionTokens: number };
}

export interface SettleInput {
  costCents: number;
  promptTokens: number;
  completionTokens: number;
  gatewayQuota: number | null;
  gatewayRequestId: string | null;
  content: string | null;
}

const now = () => Math.floor(Date.now() / 1000);

/* ------------------------------- 定价 ------------------------------- */

export function getPrice(model: string): ModelPrice | null {
  const row = getDb()
    .prepare(
      `SELECT model, in_cents_per_1k, out_cents_per_1k, enabled FROM model_prices WHERE model = ?`,
    )
    .get(model) as
    | { model: string; in_cents_per_1k: number; out_cents_per_1k: number; enabled: number }
    | undefined;
  if (!row) return null;
  return {
    model: row.model,
    inCentsPer1k: row.in_cents_per_1k,
    outCentsPer1k: row.out_cents_per_1k,
    enabled: row.enabled === 1,
  };
}

export function setPrice(input: {
  model: string;
  inCentsPer1k: number;
  outCentsPer1k: number;
  enabled?: boolean;
}): ModelPrice {
  const enabled = input.enabled === false ? 0 : 1;
  getDb()
    .prepare(
      `INSERT INTO model_prices (model, in_cents_per_1k, out_cents_per_1k, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(model) DO UPDATE SET
         in_cents_per_1k = excluded.in_cents_per_1k,
         out_cents_per_1k = excluded.out_cents_per_1k,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .run(input.model, input.inCentsPer1k, input.outCentsPer1k, enabled, now());
  return getPrice(input.model)!;
}

export function listPrices(): ModelPrice[] {
  const rows = getDb()
    .prepare(`SELECT model, in_cents_per_1k, out_cents_per_1k, enabled FROM model_prices ORDER BY model`)
    .all() as Array<{ model: string; in_cents_per_1k: number; out_cents_per_1k: number; enabled: number }>;
  return rows.map((r) => ({
    model: r.model,
    inCentsPer1k: r.in_cents_per_1k,
    outCentsPer1k: r.out_cents_per_1k,
    enabled: r.enabled === 1,
  }));
}

/* ------------------------------ 估算 ------------------------------ */

/** 粗估输入 token：按字符数/4，宁可高估一点点也不低估 */
export function estimatePromptTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface CostEstimate {
  estimatedPromptTokens: number;
  reservedCents: number;
}

/**
 * 预扣额度 = 输入预估 + 输出上限
 * 输出上限取请求里的 maxTokens，缺省按 1024 计
 */
export function estimateCost(price: ModelPrice, promptText: string, maxTokens?: number): CostEstimate {
  const promptTokens = estimatePromptTokens(promptText);
  const outCap = Math.max(1, Math.min(maxTokens ?? 1024, 32768));

  const inCents = Math.ceil((promptTokens / 1000) * price.inCentsPer1k);
  const outCents = Math.ceil((outCap / 1000) * price.outCentsPer1k);

  // 有价格但算出来是 0（极短请求 × 极低价）时，至少收 1 分，避免免费刷
  const total = inCents + outCents;
  const floor = price.inCentsPer1k > 0 || price.outCentsPer1k > 0 ? 1 : 0;
  return { estimatedPromptTokens: promptTokens, reservedCents: Math.max(total, floor) };
}

/** 实际费用：按真实 usage 计，向上取整到分 */
export function actualCost(price: ModelPrice, promptTokens: number, completionTokens: number): number {
  const inCents = (promptTokens / 1000) * price.inCentsPer1k;
  const outCents = (completionTokens / 1000) * price.outCentsPer1k;
  const total = inCents + outCents;
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total));
}

/* ------------------------- 预扣 / 结算 / 退款 ------------------------- */

export class BillingError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * 预扣额度并落一条 reserved 流水。
 * 事务内校验余额，避免并发下扣成负数。
 */
export function reserve(input: {
  userId: number;
  model: string;
  cents: number;
  idempotencyKey?: string | null;
  traceId?: string | null;
  isStream: boolean;
}): ReserveResult {
  const db = getDb();

  // 幂等：同一用户同一 key 只处理一次
  if (input.idempotencyKey) {
    const exist = db
      .prepare(
        `SELECT id, reserved_cents, cost_cents, prompt_tokens, completion_tokens, status, content, error
         FROM usage_records WHERE user_id = ? AND idempotency_key = ?`,
      )
      .get(input.userId, input.idempotencyKey) as
      | {
          id: number;
          reserved_cents: number;
          cost_cents: number;
          prompt_tokens: number;
          completion_tokens: number;
          status: string;
          content: string | null;
          error: string | null;
        }
      | undefined;

    if (exist) {
      if (exist.status === "reserved") {
        throw new BillingError("request_in_progress", "同一幂等键的请求正在处理中", 409);
      }
      return {
        recordId: exist.id,
        reservedCents: exist.reserved_cents,
        replayed: {
          content: exist.content,
          costCents: exist.cost_cents,
          promptTokens: exist.prompt_tokens,
          completionTokens: exist.completion_tokens,
        },
      };
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    if (input.cents > 0) {
      const upd = db
        .prepare(`UPDATE users SET quota_cents = quota_cents - ?, updated_at = ? WHERE id = ? AND quota_cents >= ?`)
        .run(input.cents, now(), input.userId, input.cents);
      if (upd.changes === 0) {
        throw new BillingError("insufficient_quota", "额度不足，请充值或联系管理员", 402);
      }
    }

    const info = db
      .prepare(
        `INSERT INTO usage_records
           (user_id, model, status, reserved_cents, cost_cents, gateway_quota, gateway_request_id,
            trace_id, idempotency_key, is_stream, created_at)
         VALUES (?, ?, 'reserved', ?, 0, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        input.userId,
        input.model,
        input.cents,
        input.traceId ?? null,
        input.idempotencyKey ?? null,
        input.isStream ? 1 : 0,
        now(),
      );

    db.exec("COMMIT");
    return { recordId: Number(info.lastInsertRowid), reservedCents: input.cents };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 结算：多退少补，落实际费用 */
export function settle(recordId: number, input: SettleInput): void {
  const db = getDb();
  const rec = db
    .prepare(`SELECT user_id, reserved_cents, status FROM usage_records WHERE id = ?`)
    .get(recordId) as { user_id: number; reserved_cents: number; status: string } | undefined;
  if (!rec || rec.status !== "reserved") return;

  db.exec("BEGIN IMMEDIATE");
  try {
    const diff = rec.reserved_cents - input.costCents;
    if (diff !== 0) {
      // 多退：加回余额；少补：从余额扣（可能扣成 0，不允许负）
      db.prepare(
        `UPDATE users SET quota_cents = MAX(0, quota_cents + ?), updated_at = ? WHERE id = ?`,
      ).run(diff, now(), rec.user_id);
    }
    db.prepare(
      `UPDATE usage_records
       SET status = 'settled', cost_cents = ?, prompt_tokens = ?, completion_tokens = ?,
           gateway_quota = ?, gateway_request_id = ?, content = ?, settled_at = ?
       WHERE id = ?`,
    ).run(
      input.costCents,
      input.promptTokens,
      input.completionTokens,
      input.gatewayQuota,
      input.gatewayRequestId,
      input.content && input.content.length > 65536 ? input.content.slice(0, 65536) : input.content,
      now(),
      recordId,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 失败退款：预扣全额退回 */
export function refund(recordId: number, reason: string): void {
  const db = getDb();
  const rec = db
    .prepare(`SELECT user_id, reserved_cents, status FROM usage_records WHERE id = ?`)
    .get(recordId) as { user_id: number; reserved_cents: number; status: string } | undefined;
  if (!rec || rec.status !== "reserved") return;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (rec.reserved_cents > 0) {
      db.prepare(`UPDATE users SET quota_cents = quota_cents + ?, updated_at = ? WHERE id = ?`).run(
        rec.reserved_cents,
        now(),
        rec.user_id,
      );
    }
    db.prepare(`UPDATE usage_records SET status = 'refunded', error = ?, settled_at = ? WHERE id = ?`).run(
      reason,
      now(),
      recordId,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/* ------------------------------ 查询 ------------------------------ */

export interface UsageRow {
  id: number;
  model: string;
  status: string;
  costCents: number;
  promptTokens: number;
  completionTokens: number;
  gatewayQuota: number | null;
  gatewayRequestId: string | null;
  isStream: boolean;
  createdAt: number;
}

export function listUsage(userId: number | null, limit = 100): UsageRow[] {
  const db = getDb();
  const rows = (
    userId === null
      ? db
          .prepare(
            `SELECT id, model, status, cost_cents, prompt_tokens, completion_tokens,
                    gateway_quota, gateway_request_id, is_stream, created_at
             FROM usage_records ORDER BY id DESC LIMIT ?`,
          )
          .all(limit)
      : db
          .prepare(
            `SELECT id, model, status, cost_cents, prompt_tokens, completion_tokens,
                    gateway_quota, gateway_request_id, is_stream, created_at
             FROM usage_records WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
          )
          .all(userId, limit)
  ) as Array<{
    id: number;
    model: string;
    status: string;
    cost_cents: number;
    prompt_tokens: number;
    completion_tokens: number;
    gateway_quota: number | null;
    gateway_request_id: string | null;
    is_stream: number;
    created_at: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    model: r.model,
    status: r.status,
    costCents: r.cost_cents,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    gatewayQuota: r.gateway_quota,
    gatewayRequestId: r.gateway_request_id,
    isStream: r.is_stream === 1,
    createdAt: r.created_at,
  }));
}

export function userBalance(userId: number): number {
  const row = getDb().prepare(`SELECT quota_cents FROM users WHERE id = ?`).get(userId) as
    | { quota_cents: number }
    | undefined;
  return row?.quota_cents ?? 0;
}
