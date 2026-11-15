import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Router } from "./router.ts";
import { fail, ok, parseCookies } from "./respond.ts";
import { config } from "../config.ts";
import { resolveSession, type SessionUser } from "../security/session.ts";
import { login, logout, me, register, sessionToken } from "../modules/auth.ts";
import { createUser, listAuditLogs, listUsers, patchUser } from "../modules/users.ts";
import { gatewayHealth, gatewayModels, gatewayErrorToResponse } from "../modules/gateway.ts";
import { allUsage, chat, chatStream, getPrices, myUsage, putPrice } from "../modules/chat.ts";
import { generate, listGenerationPricesHandler, putGenerationPriceHandler } from "../modules/generate.ts";
import {
  createModelHandler,
  deleteModelHandler,
  listForAdmin,
  listForUser,
  modelDetail,
  updateModelHandler,
} from "../modules/models-api.ts";

/**
 * HTTP 服务
 * ------------------------------------------------------------
 * 权限校验全部在这里的服务端完成，前端隐藏菜单只是 UX，不是安全边界。
 */

const router = new Router();

/** 从请求里解析当前用户（无效则 null） */
function currentUser(req: IncomingMessage): SessionUser | null {
  return resolveSession(sessionToken(req));
}

type Ctx = { params: Record<string, string> };
type AuthedHandler = (ctx: Ctx, req: IncomingMessage, res: ServerResponse, user: SessionUser) => Promise<void> | void;

/** 需要登录 */
function requireUser(handler: AuthedHandler) {
  return async (ctx: Ctx, req: IncomingMessage, res: ServerResponse) => {
    const user = currentUser(req);
    if (!user) return fail(res, 401, "unauthenticated", "未登录或会话已过期");
    return handler(ctx, req, res, user);
  };
}

/** 需要管理员 */
function requireAdmin(handler: AuthedHandler) {
  return async (ctx: Ctx, req: IncomingMessage, res: ServerResponse) => {
    const user = currentUser(req);
    if (!user) return fail(res, 401, "unauthenticated", "未登录或会话已过期");
    if (user.role !== "admin") return fail(res, 403, "forbidden", "需要管理员权限");
    return handler(ctx, req, res, user);
  };
}

/* ------------------------------ 路由表 ------------------------------ */

router.get("/health", (_ctx, _req, res) => {
  return ok(res, { service: "lihuo-server", status: "ok", time: Math.floor(Date.now() / 1000) });
});

router.post("/api/auth/login", (ctx, req, res) => login(req, res));
router.post("/api/auth/logout", (ctx, req, res) => logout(req, res));
router.post("/api/auth/register", (ctx, req, res) => register(req, res));
router.get("/api/me", (ctx, req, res) => me(req, res));

// 管理员：用户管理
router.get("/api/admin/users", requireAdmin((ctx, req, res) => listUsers(req, res)));
router.post("/api/admin/users", requireAdmin((ctx, req, res, user) => createUser(ctx, req, res, user)));
router.patch("/api/admin/users/:id", requireAdmin((ctx, req, res, user) => patchUser(ctx, req, res, user)));
router.get("/api/admin/audit-logs", requireAdmin((ctx, req, res) => listAuditLogs(req, res)));

// 网关：普通用户可用（模型列表），健康检查仅管理员
router.get("/api/gateway/models", requireUser((ctx, _req, res) => gatewayModels(_req, res)));
router.get("/api/gateway/health", requireAdmin((ctx, _req, res) => gatewayHealth(_req, res)));

// 对话与计费
router.post("/api/chat", requireUser((ctx, req, res, user) => chat(req, res, user)));
router.post("/api/chat/stream", requireUser((ctx, req, res, user) => chatStream(req, res, user)));
router.get("/api/usage", requireUser((ctx, req, res, user) => myUsage(req, res, user)));
router.get("/api/model-prices", requireUser((ctx, _req, res) => getPrices(_req, res)));

// 生成代理：上游令牌只在服务端，按次计费，响应体原样透传
router.post("/api/generate/:endpoint", requireUser((ctx, req, res, user) => generate(ctx, req, res, user)));
router.get("/api/generation-prices", requireUser((ctx, _req, res) => listGenerationPricesHandler(_req, res)));
router.put("/api/admin/generation-prices/:model", requireAdmin((ctx, req, res) => putGenerationPriceHandler(ctx, req, res)));

// 管理员：价格与全量用量
router.put("/api/admin/model-prices/:model", requireAdmin((ctx, req, res) => putPrice(ctx, req, res)));
router.get("/api/admin/usage", requireAdmin((ctx, req, res) => allUsage(req, res)));

// 模型注册表
router.get("/api/models", requireUser((ctx, req, res) => listForUser(req, res)));
router.get("/api/models/:modelId", requireUser((ctx, req, res) => modelDetail(ctx, req, res)));
router.get("/api/admin/models", requireAdmin((ctx, req, res) => listForAdmin(req, res)));
router.post("/api/admin/models", requireAdmin((ctx, req, res, user) => createModelHandler(req, res, user)));
router.patch("/api/admin/models/:modelId", requireAdmin((ctx, req, res, user) => updateModelHandler(ctx, req, res, user)));
router.delete("/api/admin/models/:modelId", requireAdmin((ctx, req, res, user) => deleteModelHandler(ctx, req, res, user)));

/* ---------------------------- CORS 与分发 ---------------------------- */

function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && config.corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Lihuo-Cost-Cents, X-Lihuo-Balance-Cents, X-Lihuo-Request-Id, X-Lihuo-Model, X-Lihuo-Gateway-Request-Id",
    );
    res.setHeader("Access-Control-Max-Age", "600");
  }
  return req.method === "OPTIONS";
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "local"}`);
  const path = url.pathname;

  res.on("finish", () => {
    console.log(`[http] ${req.method} ${path} → ${res.statusCode} (${Date.now() - started}ms)`);
  });

  if (applyCors(req, res)) {
    res.writeHead(204);
    res.end();
    return;
  }

  const hit = router.match(req.method ?? "GET", path);
  if (!hit) {
    return fail(res, 404, "not_found", `未找到路由 ${req.method} ${path}`);
  }

  try {
    await hit.handler({ params: hit.params }, req, res);
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    if (e.status && e.code) {
      return fail(res, e.status, e.code, e.message ?? "请求错误");
    }
    console.error("[http] 未处理异常:", err);
    if (!res.headersSent) return fail(res, 500, "internal_error", "服务器内部错误");
  }
}

export function startServer(): Promise<{ close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      console.error("[http] 兜底异常:", err);
      if (!res.headersSent) gatewayErrorToResponse(res, err);
    });
  });

  return new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      console.log(`[server] 监听 http://${config.host}:${config.port}`);
      console.log(`[server] 允许来源: ${config.corsOrigins.join(", ") || "(无)"}`);
      resolve({
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
