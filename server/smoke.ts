/**
 * 冒烟测试：用真实网关验证 Provider 契约
 * ------------------------------------------------------------
 * 运行：node --experimental-strip-types smoke.ts
 * 环境变量见 .env.example
 *
 * 说明：当前网关还没有配置任何渠道，所以 chat / streamChat 预期
 * 返回 503 model_not_found。这不是失败，而是在验证：
 *   - 路由与鉴权是否通
 *   - 错误是否被正确归一化
 *   - request id 是否能被抠出来（A1 方案归因的关键）
 */

import { GatewayError, NewApiProvider } from "./src/gateway/index.ts";

const BASE = process.env.NEW_API_BASE_URL ?? "http://127.0.0.1:3001";
const KEY = process.env.NEW_API_KEY ?? "";
const ADMIN = process.env.NEW_API_ADMIN_TOKEN ?? "";
const MODEL = process.env.NEW_API_TEST_MODEL ?? "deepseek-chat";

const provider = new NewApiProvider({
  baseUrl: BASE,
  apiKey: KEY,
  adminToken: ADMIN || undefined,
});

let failures = 0;
const ok = (name: string, detail: string) => console.log(`  ✅ ${name} —— ${detail}`);
const info = (name: string, detail: string) => console.log(`  ℹ️  ${name} —— ${detail}`);
const bad = (name: string, detail: string) => {
  failures++;
  console.log(`  ❌ ${name} —— ${detail}`);
};

function line(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(64));
}

async function main() {
  console.log("离火网关冒烟测试");
  console.log(`网关: ${BASE}`);
  console.log(`令牌: ${KEY ? KEY.slice(0, 6) + "…" + KEY.slice(-4) : "(未设置)"}`);

  if (!KEY) {
    console.error("\n缺少 NEW_API_KEY，无法继续。");
    process.exit(2);
  }

  // ---------- 1. 健康检查 ----------
  line("1. getHealth()");
  try {
    const h = await provider.getHealth();
    h.ok
      ? ok("网关可达", `version=${h.version} · ${h.latencyMs}ms`)
      : bad("网关不可用", JSON.stringify(h.raw));
  } catch (e) {
    bad("健康检查异常", (e as Error).message);
  }

  // ---------- 2. 模型列表 ----------
  line("2. getModels()");
  try {
    const models = await provider.getModels();
    if (models.length === 0) {
      info("返回空列表", "令牌可见模型为 0（尚未配置渠道，属预期）");
    } else {
      ok("返回模型", `${models.length} 个 · 例：${models.slice(0, 3).map((m) => m.id).join(", ")}`);
    }
  } catch (e) {
    bad("模型列表失败", e instanceof GatewayError ? `${e.code} ${e.message}` : String(e));
  }

  // ---------- 3. 非流式对话（预期 503） ----------
  line("3. chat() —— 非流式对话");
  try {
    const r = await provider.chat({
      model: MODEL,
      messages: [{ role: "user", content: "你好" }],
      lihuoTraceId: "smoke-nonstream",
    });
    ok("调用成功", `content 长度=${r.content.length} · requestId=${r.requestId}`);
  } catch (e) {
    if (e instanceof GatewayError) {
      info("被正确拦截", `HTTP ${e.httpStatus} · code=${e.code} · retryable=${e.retryable}`);
      e.retryable
        ? bad("重试判定错误", "无可用渠道不应标记为可重试")
        : ok("重试判定正确", "无可用渠道 = 不可重试，不会放大无效请求");
      e.requestId
        ? ok("request id 可提取", e.requestId)
        : bad("request id 缺失", "错误体里没找到 request id，A1 归因会受影响");
    } else {
      bad("非预期异常", String(e));
    }
  }

  // ---------- 4. 流式对话（预期 503） ----------
  line("4. streamChat() —— 流式对话");
  try {
    let chunks = 0;
    let text = "";
    for await (const c of provider.streamChat({
      model: MODEL,
      messages: [{ role: "user", content: "你好" }],
      lihuoTraceId: "smoke-stream",
    })) {
      chunks++;
      text += c.delta;
    }
    ok("流式完成", `${chunks} 包 · 文本长度 ${text.length}`);
  } catch (e) {
    if (e instanceof GatewayError) {
      info("被正确拦截", `HTTP ${e.httpStatus} · code=${e.code}`);
      e.requestId ? ok("request id 可提取", e.requestId) : bad("request id 缺失", "流式路径未拿到 request id");
    } else {
      bad("非预期异常", String(e));
    }
  }

  // ---------- 5. 用量日志 ----------
  line("5. getUsage() —— 需要管理凭据");
  if (!ADMIN) {
    info("跳过", "未设置 NEW_API_ADMIN_TOKEN");
  } else {
    try {
      const rows = await provider.getUsage({ limit: 5 });
      ok("拉取成功", `${rows.length} 条记录`);
      for (const r of rows.slice(0, 3)) {
        console.log(
          `     · ${new Date(r.createdAt * 1000).toLocaleString("zh-CN")} ${r.model} ` +
            `in=${r.promptTokens} out=${r.completionTokens} quota=${r.quota} req=${r.requestId ?? "-"}`,
        );
      }
    } catch (e) {
      bad("用量拉取失败", e instanceof GatewayError ? `${e.code} ${e.message}` : String(e));
    }
  }

  // ---------- 6. 渠道测试 ----------
  line("6. testChannel() —— 需要渠道 id");
  const channelId = Number(process.env.NEW_API_CHANNEL_ID ?? "0");
  if (!ADMIN || !channelId) {
    info("跳过", "需要 NEW_API_ADMIN_TOKEN + NEW_API_CHANNEL_ID");
  } else {
    try {
      const t = await provider.testChannel(channelId);
      t.ok ? ok("渠道可用", `${t.latencyMs}ms`) : bad("渠道异常", t.message);
    } catch (e) {
      bad("渠道测试失败", e instanceof GatewayError ? `${e.code} ${e.message}` : String(e));
    }
  }

  console.log("\n" + "─".repeat(64));
  console.log(failures === 0 ? "结论：契约层验证通过（失败项见上）" : `结论：存在 ${failures} 个问题，见上`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("未捕获异常:", e);
  process.exit(1);
});
