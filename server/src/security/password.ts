import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 密码哈希：scrypt + 随机盐
 * 格式：scrypt$N$r$p$<saltHex>$<hashHex>
 * 校验用 timingSafeEqual，避免时序侧信道。
 */

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plain, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 口令强度校验：交给服务端，不依赖前端 */
export function validatePassword(plain: string): string | null {
  if (typeof plain !== "string") return "密码格式不正确";
  if (plain.length < 10) return "密码至少 10 位";
  if (plain.length > 200) return "密码过长";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(plain)).length;
  if (classes < 3) return "密码需包含大写、小写、数字、符号中的至少三类";
  return null;
}

export function validateUsername(name: string): string | null {
  if (typeof name !== "string") return "用户名格式不正确";
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(name)) return "用户名需 3-32 位，仅允许字母、数字、下划线、点、短横线";
  return null;
}
