import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.ts";

/**
 * 数据层：Node 内置 SQLite
 * ------------------------------------------------------------
 * 选择内置模块的原因：零依赖、单文件、可直接备份。
 * 额度一律用整数「分」存储，避免浮点误差。
 *
 * ⚠️ node:sqlite 在 Node 22 仍是实验特性，启动需带 --experimental-sqlite。
 */

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const path = resolve(process.cwd(), config.dbPath);
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',      -- 'admin' | 'user'
      status        TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'banned'
      quota_cents   INTEGER NOT NULL DEFAULT 0,        -- 余额，单位：分
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,               -- 只存哈希，不存明文
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      ip          TEXT,
      user_agent  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS login_attempts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT NOT NULL,
      ip         TEXT,
      ok         INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(username, created_at);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      username   TEXT,
      action     TEXT NOT NULL,
      target     TEXT,
      detail     TEXT,
      ip         TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);

    /* ---------------- 模型注册表 ---------------- */

    -- 模型元数据：能力、参数、上下文。价格单独在 model_prices，两边职责不重叠
    CREATE TABLE IF NOT EXISTS models (
      model_id        TEXT PRIMARY KEY,          -- 调用时使用的模型名
      display_name    TEXT NOT NULL,
      provider        TEXT NOT NULL DEFAULT '',
      description     TEXT NOT NULL DEFAULT '',
      capability      TEXT NOT NULL,             -- text|image|video|audio|embedding
      context_length  INTEGER,
      max_output_tokens INTEGER,
      streaming       INTEGER NOT NULL DEFAULT 1,
      tool_calling    INTEGER NOT NULL DEFAULT 0,
      vision          INTEGER NOT NULL DEFAULT 0,
      supported_parameters TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
      default_parameters   TEXT NOT NULL DEFAULT '{}',  -- JSON 对象
      enabled         INTEGER NOT NULL DEFAULT 0,       -- 是否上架
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_models_enabled ON models(enabled);

    /* ---------------- 计费 ---------------- */

    -- 模型价格：离火自己的定价，与网关价格表解耦（网关只提供成本参考）
    CREATE TABLE IF NOT EXISTS model_prices (
      model             TEXT PRIMARY KEY,
      in_cents_per_1k   INTEGER NOT NULL DEFAULT 0,
      out_cents_per_1k  INTEGER NOT NULL DEFAULT 0,
      enabled           INTEGER NOT NULL DEFAULT 1,
      updated_at        INTEGER NOT NULL
    );

    -- 调用流水：既是账单依据，也是幂等凭据
    CREATE TABLE IF NOT EXISTS usage_records (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id),
      model            TEXT NOT NULL,
      status           TEXT NOT NULL,              -- reserved | settled | refunded
      reserved_cents   INTEGER NOT NULL DEFAULT 0, -- 预扣
      cost_cents       INTEGER NOT NULL DEFAULT 0, -- 实际
      prompt_tokens    INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      gateway_quota    INTEGER,                    -- 网关侧成本（对账用）
      gateway_request_id TEXT,                     -- 与网关日志对账
      trace_id         TEXT,
      idempotency_key  TEXT,
      is_stream        INTEGER NOT NULL DEFAULT 0,
      error            TEXT,
      content          TEXT,
      created_at       INTEGER NOT NULL,
      settled_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_usage_req  ON usage_records(gateway_request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_idem
      ON usage_records(user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
}

/** 仅测试用：内存库 */
export function useMemoryDb(): DatabaseSync {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
