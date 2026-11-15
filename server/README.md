# 离火统一业务后端（server）

离火的后端服务：用户、权限、额度、计费、模型注册，以及对模型网关的代理调用。

```
离火前端（web/）→ 本服务（server/）→ New-API → 模型服务商
```

**当前进度**

| 模块 | 状态 |
|---|---|
| 网关层（Gateway Provider） | ✅ 完成并验证（含运行时全链路） |
| HTTP 服务入口 | ✅ 完成 |
| 用户 / 会话 / 权限 | ✅ 完成并验证 |
| 审计日志 | ✅ 完成 |
| 额度记账 / 计费 | ✅ 完成并验证（预扣、结算、退款、幂等） |
| Model Registry | ✅ 完成并验证（能力白名单、上架必填价） |
| 前端改造 | ⬜ 下一轮 |

---

## 目录

```
server/
├── src/
│   ├── index.ts                 入口：配置校验 → 建库 → 引导管理员 → 起服务
│   ├── config.ts                全部配置来自环境变量
│   ├── db.ts                    SQLite 建表与迁移
│   ├── http/
│   │   ├── server.ts            路由表 + 权限中间件 + CORS
│   │   ├── router.ts            极简路由匹配
│   │   └── respond.ts           统一响应、Cookie、请求体读取
│   ├── modules/
│   │   ├── auth.ts              注册 / 登录 / 登出 / me
│   │   ├── users.ts             用户管理
│   │   ├── audit.ts             审计写入（管理员敏感操作）
│   │   ├── billing.ts           定价、预扣、结算、退款、流水
│   │   ├── chat.ts              对话接口（含流式）+ 价格与用量路由
│   │   ├── generate.ts          生成代理（端点白名单、按次计费、原样透传）
│   │   ├── registry.ts          Model Registry（能力、参数、上架规则）
│   │   ├── models-api.ts        注册表 HTTP 层（含网关可用性合并）
│   │   └── gateway.ts           网关代理（模型列表、健康）
│   ├── security/
│   │   ├── password.ts          scrypt 哈希 + 强度校验
│   │   └── session.ts           会话签发/校验/吊销（滑动续期）
│   └── gateway/                 网关抽象层（见下）
├── smoke.ts                     网关冒烟测试
├── data/                        SQLite 数据（gitignore）
└── .env.example
```

`src/gateway/` 内部：

| 文件 | 职责 |
|---|---|
| `gateway.interface.ts` | 业务契约，画布与业务只认这个 |
| `newapi/newapi.client.ts` | 传输：凭据、超时、取消、错误归一化 |
| `newapi/newapi.stream.ts` | SSE 解析（分帧、`[DONE]`、取消即断流） |
| `newapi/newapi.provider.ts` | 实现 `GatewayProvider` 的 6 个能力 |

---

## 运行

```bash
cd server
cp .env.example .env      # 至少填 NEW_API_KEY
npm start                 # http://127.0.0.1:3100
```

首次启动会自动创建一个管理员：

- 若 `.env` 里 `LIHUO_ADMIN_PASSWORD` 合规，用它；
- 否则生成随机密码，写入 `data/.bootstrap-admin.txt` 并在控制台打印一次。

**登录后请立即改密码，并删除该文件。**

依赖说明：不需要 `npm install`。运行只用到 Node 内置模块（`node:sqlite`、`node:crypto`、`node:http`）。
类型检查才需要 `npm i -D typescript @types/node`。

---

## 接口

除「生成代理」成功时原样透传上游响应体外，其余响应统一为
`{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`；
生成代理的账单信息放在 `X-Lihuo-*` 响应头。

### 公开

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活检查 |
| POST | `/api/auth/login` | 登录，成功下发 `lihuo_session` Cookie |
| POST | `/api/auth/logout` | 登出，吊销会话 |
| POST | `/api/auth/register` | 自助注册（`LIHUO_ALLOW_REGISTER=true` 才生效） |
| GET | `/api/me` | 当前用户 |

### 登录用户

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/gateway/models` | 网关可见模型列表 |
| GET | `/api/model-prices` | 模型价格表 |
| GET | `/api/generation-prices` | 生成类按次价格表 |
| GET | `/api/models` | 模型目录（仅已上架，含可用性） |
| GET | `/api/models/:modelId` | 模型详情（含能力与参数） |
| POST | `/api/chat` | 对话（非流式），带计费 |
| POST | `/api/chat/stream` | 对话（SSE 流式），带计费 |
| POST | `/api/generate/:endpoint` | 生成代理，服务端持令牌，按次计费 |
| GET | `/api/usage` | 我的调用流水与余额 |

### 管理员

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users` | 创建用户 |
| PATCH | `/api/admin/users/:id` | 改状态/角色/额度/密码 |
| GET | `/api/admin/audit-logs` | 操作审计 |
| GET | `/api/admin/usage` | 全员调用流水（可按 `userId` 过滤） |
| GET | `/api/admin/models` | 全部模型（含未上架）+ 网关未注册列表 |
| POST | `/api/admin/models` | 新建模型（可同时写价格） |
| PATCH | `/api/admin/models/:modelId` | 修改 / 上下架 |
| DELETE | `/api/admin/models/:modelId` | 删除元数据（价格与历史流水保留） |
| PUT | `/api/admin/model-prices/:model` | 单独设置 token 价格 |
| PUT | `/api/admin/generation-prices/:model` | 单独设置按次价格（分/次） |
| GET | `/api/gateway/health` | 网关健康 |

### 生成代理

`POST /api/generate/:endpoint` 由服务端持上游令牌转发，前端不带任何 API Key。
`:endpoint` 只接受别名白名单，不接受路径：

| 别名 | 上游路径 | 能力 |
|---|---|---|
| `image-generations` | `/v1/images/generations` | image |
| `image-edits` | `/v1/images/edits` | image |
| `audio-speech` | `/v1/audio/speech` | audio（二进制透传） |
| `embeddings` | `/v1/embeddings` | embedding |

请求体需带 `model`（已注册、已上架、能力匹配、已配按次价）、端点必填字段，
以及仅含该模型 `supportedParameters` 的可选参数。成功时上游响应体原样返回，
账单信息在 `X-Lihuo-Cost-Cents` / `X-Lihuo-Balance-Cents` /
`X-Lihuo-Request-Id` / `X-Lihuo-Model` 响应头。
失败返回统一错误体并全额退款；`Idempotency-Key` 防重复扣费，重放返回 409。

---

## Model Registry

网关（`/v1/models`）只回答"有什么"，Registry 回答"怎么用、多少钱、能不能用"。
两者合并后才是前端可用的模型目录，字段含 `available`（网关是否有渠道）与 `usable`（上架 + 有价 + 可用）。

### 三条硬规则（都在服务端强制）

1. **能力白名单**：每个能力只允许自己的参数，传错直接 400。
   - text：`temperature / top_p / max_tokens / stream / stop / frequency_penalty / presence_penalty / seed / response_format / reasoning_effort`
   - image：`size / quality / style / n / background / output_format`
   - video：`duration / resolution / aspect_ratio / seed / reference_images / fps`
   - audio：`voice / format / speed / language`
   - embedding：`dimensions / encoding_format`
2. **上架必须有价**：`enabled=true` 且无价格（或输入输出都为 0）→ 400 `price_required`。
   避免"上架了但没定价"，用户调用时才撞 400。
3. **调用入口同样校验**：`/api/chat` 要求模型已注册且已上架，且请求参数在该模型能力白名单内。
   前端隐藏控件不算权限控制。

### 默认参数

新建模型时可省略 `supportedParameters` / `defaultParameters`，按能力自动补齐：

| 能力 | 默认 supported | 默认 default |
|---|---|---|
| text | 见上 | `{temperature:0.7, top_p:1}` |
| image | 见上 | `{size:"1024x1024", n:1}` |
| video | 见上 | `{duration:5, aspect_ratio:"16:9"}` |
| audio | 见上 | `{format:"mp3"}` |

---

## 计费（A1：离火是账单权威）

```
查价 → 预扣 → 调网关 → 按真实 usage 结算 →（失败）全额退款
```

| 环节 | 做法 |
|---|---|
| 定价 | `model_prices` 表，单位「分 / 1K tokens」，输入与输出分开计价 |
| 预扣 | 按 `输入预估 token + 输出上限(maxTokens，默认 1024)` 估算，事务内扣减并校验余额 |
| 结算 | 用网关返回的真实 `usage` 重算，多退少补 |
| 退款 | 网关报错 / 客户端断开 → 预扣全额退回，流水标记 `refunded` |
| 幂等 | 请求头 `Idempotency-Key`，同用户同 key 只处理一次，重放直接返回上次结果、不重复扣费 |
| 未定价 | 直接 400 `model_not_priced`，**不要让用户把请求打到网关才失败** |
| 对账 | 每条流水记录网关 `X-Oneapi-Request-Id`，可与网关日志逐条对应 |

金额全程用整数「分」，不出现浮点。

### 已知取舍

1. **没有硬性余额下限**：预扣按估算值，极长输出可能超出预扣；结算时余额不足会扣到 0（不为负），差额未追缴。
2. **流式中断**：客户端断开即中止上游并全额退款；若上游已产生计费，这部分成本由平台承担。
3. **未实现按分组的差异化定价**（如 VIP 折扣），当前一个模型一个价。

---

## 安全设计（都是服务端强制，不靠前端隐藏）

| 机制 | 实现 |
|---|---|
| 密码存储 | scrypt + 16 字节随机盐，`timingSafeEqual` 比对 |
| 密码强度 | ≥10 位，大写/小写/数字/符号至少三类 |
| 会话 | 不透明随机 token，数据库只存 SHA-256；HttpOnly + SameSite=Lax；滑动续期 |
| 封禁即时生效 | 校验会话时同时查 `users.status`；封禁并吊销该用户全部会话 |
| 管理员接口 | `requireAdmin` 中间件，非管理员 403 |
| 防自锁 | 不能封禁自己、不能降级自己的管理员角色 |
| 用户名枚举 | 用户不存在与密码错误返回同一提示 |
| 登录限流 | 按用户名 + IP 统计失败次数，超阈值 429 |
| 敏感操作留痕 | 创建/修改用户写 `audit_logs`（含操作者、目标、变更前后、IP） |
| 请求体 | 上限 256KB，非 JSON 直接 400 |

---

## 数据

- SQLite 单文件：`data/lihuo.db`（WAL 模式），直接复制即可备份
- 额度用整数「分」存储，避免浮点误差
- 表：`users` / `sessions` / `login_attempts` / `audit_logs`

重置开发数据：停服务后删除 `data/lihuo.db*`，重启会自动重建并重新引导管理员。

---

## 已知限制

1. `node:sqlite` 在 Node 22 仍是实验特性，启动需带 `--experimental-sqlite`（已在 npm scripts 里）
2. 未做额度扣减与计费（下一轮）
3. 未接 Model Registry，模型能力/价格为空
4. `getUsage` 依赖管理凭据，access_token 约 15 分钟过期，尚未做自动刷新
5. 明文 HTTP，仅适合本地；上公网需 HTTPS + `LIHUO_COOKIE_SECURE=true` + 反代

---

## 与 AGENTS.md 的关系

`AGENTS.md` 现写「外部请求由浏览器前端直连，不假设存在项目后端」。
自 `server/` 建立起，该约定对新功能已不适用：前端不得直连上游、不得持有 `sk-`。
建议下一轮统一更新该章节。
