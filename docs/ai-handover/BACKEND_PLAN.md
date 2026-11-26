# 离火公网后端建设方案

> 目标：把当前「本地画布 + 浏览器直连上游」改造成「可对公网用户开放的多租户服务」。
> 本文只定方案、边界与验收标准，不写实现。动手前先读 `ENTRY_POINTS.md`，改完按 `AGENTS.md` 更新 `todo.mdx` / `pending-test.mdx`。
> 文中「已有」均指仓库当前代码状态，标注了文件路径，与代码不一致时以代码为准并回来修本文。

---

## 一、结论

后端不需要从零搭。`server/` 已经有最难的那部分：会话鉴权、额度记账（预扣/结算/退款/幂等）、模型注册表、生成代理、审计。这套骨架**不要重写**。

真正挡在公网前面的是五件事，做完才谈得上开放：

1. **生成主链路收口**：浏览器不再持有上游 Key，全部走 `/api/generate/*`
2. **用户数据上云**：项目快照、素材、媒体文件从 IndexedDB 搬到「数据库 + 对象存储」
3. **公共接口补齐**：项目/素材 CRUD、媒体直传签名、异步任务
4. **账户自助**：改密码、设备下线、额度流水——否则每个用户问题都要找管理员
5. **同域部署**：前端与 `/api` 同域名，Cookie 会话才可靠

失败的典型路径：先部署 → 发现 Key 在浏览器里 → 急着收口 → 发现前端三套协议绕不开 → 改成后端重写三套协议 → 卡住。所以顺序很重要。

> 本文已对照两份外部方案（Gemini 的通用画布指南、GPT 的 SaaS 实施方案），取舍过程与拒绝理由见 **附录 A**。

---

## 二、现状盘点

### 2.1 已具备（不要重写）

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| HTTP 服务与路由 | `server/src/http/server.ts`、`router.ts` | 零依赖 `node:http`，`requireUser` / `requireAdmin` 中间件 |
| 会话 | `server/src/security/session.ts` | 不透明 token，库内只存 SHA-256，滑动续期，封禁即时生效 |
| 密码 | `server/src/security/password.ts` | scrypt + 盐，强度校验 |
| 计费 | `server/src/modules/billing.ts` | `reserve` / `settle` / `refund` / `listUsage` / `userBalance`，整数「分」 |
| 幂等 | `usage_records.idempotency_key` 唯一索引 | 同用户同 key 只处理一次 |
| 模型注册表 | `server/src/modules/registry.ts` | 能力白名单、上架必填价、参数校验 |
| 生成代理 | `server/src/modules/generate.ts` | 端点别名白名单、按次计费、原样透传、`X-Lihuo-*` 头 |
| 对话 | `server/src/modules/chat.ts` | 非流式 + SSE，计费一致 |
| 审计 | `server/src/modules/audit.ts` | 管理员敏感操作留痕 |
| 网关抽象 | `server/src/gateway/` | 业务只认 `GatewayProvider`，换网关不动业务 |

### 2.2 五个缺口

**G1 生成主链路仍直连上游（最严重）**

代理只白名单了 4 个端点（`image-generations` / `image-edits` / `audio-speech` / `embeddings`），而前端主力链路仍是浏览器直连：

- `web/src/services/api/model-plugin.ts` 265 / 301 / 511 / 826 行按 `${baseUrl}/v1/...` 拼地址
- `web/src/services/api/image.ts` 476 行 `/responses`、583 行 Gemini `:streamGenerateContent`
- `web/src/stores/use-config-store.ts` 的 `resolveModelRequestConfig` 会把 `apiKey` 交给调用方

后果：公网一上线，任何人开 DevTools 就能从请求头里拿走 Key。**这是"不能开公网"的唯一充分理由。**

**G2 用户数据只在浏览器本地**

- 项目：`stores/canvas/use-canvas-store.ts`，`storageKey("canvas_store")` 落 IndexedDB
- 素材：`stores/use-asset-store.ts`
- 媒体：`services/file-storage.ts`（`media_files`）、`services/image-storage.ts`
- 跨设备：只有 `services/app-sync.ts` 的手动 WebDAV 全量同步

换设备、清缓存、换浏览器 = 数据全丢。WebDAV 是单用户自托管的解法，不是多租户云存储。

**G3 公共接口缺失**

服务端没有项目/素材 CRUD、没有上传、没有静态托管。另外 `http/respond.ts` 的 `readJson` 上限是 **256KB**，而一个画布快照加上助手会话很容易超过，保存接口会直接 400。

**G4 依赖本机 sidecar**

| 服务 | 端口 | 位置 |
| --- | --- | --- |
| 豆包桥接 | 9091 | `doubao-bridge/server.mjs` |
| 本地 Agent | 17371 | `components/agent/local-agent-panel.tsx`、`stores/use-agent-store.ts` |
| local-proxy | 23210 | `stores/use-config-store.ts` 的 `DEFAULT_LOCAL_PROXY_URL` |

公网用户的机器上没有这些进程。v1 按「不可用」处理，UI 上隐藏入口，不要报错吓用户。

**G5 账户只有「登录」，没有「账户管理」**

`auth.ts` 只有 `login` / `logout` / `me` / `register` 四个动作，用户侧能做的仅此而已：

- **没有自助改密码**：用户忘了密码只能找管理员 `PATCH /api/admin/users/:id` 重置
- **`me` 信息太薄**：只返回 `id/username/role/status/quotaCents`，没有邮箱、昵称、注册时间，前端做不出账户页
- **设备不可见**：`sessions` 表已经存了 `ip` / `user_agent` / `expires_at`，但没有「我的登录设备」接口，账号被盗只能干等过期
- **额度不可追溯**：`patchUser` 直接覆盖 `quota_cents`，只有管理员审计里能看到 from/to，**没有账户级额度流水**（`usage_records` 只记消耗）。充值、赠送、兑换、退款无法分类对账，用户也无处查「钱是怎么没的」
- **前端没有账户页**：`web/src/pages/` 下只有 `login` 与 `admin`，`UserLayout` 没有头像菜单入口

这不是「加个设置页」的体验问题：公网用户没法改密码、没法充钱、丢了号没人管。

---

## 三、目标架构

```txt
浏览器（React 画布）
   │  只请求同域 /api，不持任何上游 Key
   ▼
Caddy / Nginx  ── 静态产物 + /api 反向代理（同域，Cookie 才成立）
   ▼
离火后端 server/  ── 唯一持有上游 Key 的一层
   ├── 会话与账户       Cookie · 改密 · 设备 · 额度流水
   ├── 项目与素材 API   整包快照 + revision 乐观锁
   ├── 生成代理         生图 / 视频 / 语音 / 向量
   └── 计费与任务       预扣 → 结算 / 退款，异步任务表
   │
   ├──▶ 数据库           users / projects / assets / media / tasks / usage
   ├──▶ 对象存储         图片 / 视频 / 音频（浏览器直传，后端只签名）
   └──▶ New-API 网关     → 各家模型服务
```

分层职责一句话：**浏览器只负责渲染与交互；后端负责身份、数据、钱和上游凭证。**

---

## 四、数据模型

沿用「金钱用整数分、时间用 unix 秒」的现有约定。项目/素材的主键用 `(user_id, id)` 复合唯一，客户端 nanoid 不保证跨用户唯一。

### users（扩列）

现有 `users` 只有 `id / username / password_hash / role / status / quota_cents / created_at / updated_at`。账户管理需要补：

| 字段 | 说明 |
| --- | --- |
| `email` | 可空 + 唯一（空值不冲突），找回密码与通知要用 |
| `email_verified_at` | 空表示未验证；未验证邮箱不能用于找回密码 |
| `display_name` | 展示名，空则回落 `username` |
| `avatar_media_key` | 指向 `media`，别存 URL（换存储要能整体迁移） |
| `last_login_at` | 管理端做「沉睡用户」运营用 |
| `deleted_at` | 用户主动注销的软删标记，配合冷却期 |

`username` **不允许修改**：它已经出现在审计、额度流水、分享链接里，改名等于让历史记录失联。要改就让用户改 `display_name`。

### credit_transactions

额度流水。`usage_records` 只记「消耗」，这张表记「钱从哪来」，两者相加才等于 `quota_cents`。

| 字段 | 说明 |
| --- | --- |
| `user_id` / `id` | 主键 |
| `kind` | `grant`(管理员赠送) / `recharge`(充值) / `redeem`(兑换码) / `refund`(退回) / `adjust`(修正) |
| `amount_cents` | 正负整数，正为加、负为扣 |
| `balance_after` | 记账快照，对账时不用回放全部历史 |
| `operator_id` | 管理员操作必填，用户自助操作留空 |
| `reason` | 必填（如「新用户注册赠送」「订单 xxx」） |
| `ref_id` | 外部单号 / 兑换码 id，幂等去重 |

约束：`(ref_id)` 唯一（非空时），保证同一订单/兑换码不会重复入账。

**这张表是账户管理里最容易被漏掉、日后最难补的东西。** 现在 `patchUser` 直接覆盖 `quota_cents`，一旦上线运营，任何一次「我明明充了 100 怎么只剩 20」都查不清。

### verification_codes

邮箱验证与找回密码共用。`id` / `target`(邮箱) / `purpose`(`verify_email`|`reset_password`) / `code_hash` / `expires_at` / `consumed_at` / `attempts` / `created_at`。

只存哈希，不存明文；同 `target + purpose` 5 分钟内只允许发一次。

### projects

| 字段 | 说明 |
| --- | --- |
| `user_id` / `id` | 复合唯一；`id` 沿用前端 `CanvasProject.id` |
| `title` | 列表展示 |
| `revision` | 整数，每次成功保存 +1，用于乐观锁 |
| `schema_version` | 画布数据结构版本。公网发布后前端还会升级，没有它就无法识别旧 payload 该迁移还是拒绝 |
| `payload` | `CanvasProject` 的 JSON（不含 base64） |
| `node_count` | 便于做列表统计与配额限额 |
| `cover_media_key` | 列表封面，指向 `media` |
| `created_at` / `updated_at` / `deleted_at` | 软删，对应前端 `deletedProjects` 的墓碑语义 |

索引：`(user_id, updated_at DESC)`、`(user_id, deleted_at)`。

**不拆 `projects` / `canvases` / `canvas_snapshots` 三层**：前端一个 `CanvasProject` 就是一个画布（`nodes` / `connections` / `viewport` / `chatSessions` 全在同一个对象里），拆成三层等于凭空引入 id 映射，每次保存要跨表事务。等真出现「一个项目多个画布」的需求再拆。版本历史见 P2，v1 只保留 `revision` 做冲突检测。

### assets

`user_id` / `id` / `kind`(text|image|video) / `title` / `cover_media_key` / `tags` JSON / `source` / `note` / `metadata` JSON / `created_at` / `updated_at`。

### media

| 字段 | 说明 |
| --- | --- |
| `user_id` / `key` | `key` 即前端 `storageKey`（`image:xxx` / `video:xxx`），复合唯一 |
| `sha256` / `bytes` / `mime` | 去重、配额、计费的依据 |
| `width` / `height` / `duration_ms` | 与前端 `UploadedFile` 字段对齐 |
| `created_at` | 孤儿清理按它判断 |

`sha256` 是跨用户秒传与"删除前确认无引用"的前提，不能省。

安全细则（三条容易漏的）：

- **`key` 必须不可预测**（nanoid / ulid），前缀（`image:` / `video:`）只用于组织，**不能当访问控制边界**
- **上传前校验 MIME 白名单与大小**，`commit` 时再对对象做一次 HEAD，核对真实 `content-length` 与 `content-type`；只信浏览器声明的 `mime` 等于没校验
- **签发下载 URL 前先查所有权**，不能因为对方拿到了 key 就直接签

### tasks（P1）

| 字段 | 说明 |
| --- | --- |
| `id` / `user_id` | 主键 |
| `project_id` / `node_id` | 结果回填要落到具体画布节点，缺了就无法断线恢复 |
| `type` | image / video / audio |
| `model` | 模型 id |
| `status` | `queued` / `running` / `cancel_requested` / `succeeded` / `failed` / `canceled` |
| `provider_task_id` | 上游任务 id，用于轮询与取消 |
| `request` / `result` | JSON，result 里存 media key 而不是二进制 |
| `error_code` / `attempts` | 区分「可重试」与「永久失败」，重试次数有上限 |
| `lease_until` | 任务租约。没有它，进程崩溃后任务会永远停在 `running` |
| `usage_record_id` | 关联计费流水 |
| `created_at` / `started_at` / `finished_at` | 时长与超时判断 |

三个必须说清的点：

1. **`cancel_requested` 是独立状态，不是直接写 `canceled`。** 取消要先请求上游真正停下，再改终态；只改数据库状态会让上游继续跑、继续计费。
2. **`lease_until` 是重启恢复的唯一依据**：worker 启动时把过期租约的任务重新入队，否则一次崩溃就永久卡住。
3. **`usage_record_id` 外键把任务与扣费绑死**，退款才能在任务失败时精确执行，而不是靠猜。

### rate_limits（P1）

`bucket`(login|generate|upload) / `subject`(user_id 或 ip) / `window_start` / `count`，唯一索引 `(bucket, subject, window_start)`。

### shares（P2）

`token` / `user_id` / `project_id` / `snapshot_revision` / `expires_at` / `revoked_at`。分享的是**快照**，不是活项目，否则用户改画布会意外改掉已发出的链接。

---

## 五、接口清单

除生成代理外，响应统一 `{ ok, data }` / `{ ok, error }`（已有约定）。

### 账户

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 公开 | 已有；补邀请码 / 邮箱验证 |
| POST | `/api/auth/password/forgot` | 公开 | 发验证码；无论邮箱是否存在都返回同一句提示 |
| POST | `/api/auth/password/reset` | 公开 | 凭码重置；成功后吊销该用户全部会话 |
| GET | `/api/me` | 登录 | 扩展为 `id/username/displayName/email/emailVerified/avatarUrl/role/status/quotaCents/createdAt` |
| PATCH | `/api/me` | 登录 | 改 `displayName` / `avatarMediaKey`；改邮箱需重新验证 |
| POST | `/api/me/password` | 登录 | 验旧密码 → 改密 → **吊销其他会话，保留当前会话** |
| GET | `/api/me/sessions` | 登录 | 设备列表：当前标记、ip、ua、最后活跃、过期时间 |
| DELETE | `/api/me/sessions/:id` | 登录 | 下线指定设备（不能删当前会话，请走登出） |
| DELETE | `/api/me/sessions` | 登录 | 下线全部其他设备 |
| DELETE | `/api/me` | 登录 | 注销账号：软删 + 冷却期 + 吊销全部会话 |
| GET | `/api/me/ledger` | 登录 | 额度流水（分页），与 `/api/usage` 的消耗流水互补 |
| GET | `/api/me/summary` | 登录 | 余额、今日/本月消费、调用次数，账户首页一次拉完 |

管理端补两个：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/users?q=&status=&page=` | 现在只能全量列表，缺搜索与分页 |
| POST | `/api/admin/users/:id/credit` | 调额度：`amountCents` + `reason`，写 `credit_transactions` + 审计；**替代直接 PATCH `quotaCents`** |

### 项目

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | 列表，**只返回元数据**（id/title/updatedAt/revision/cover），可分页 |
| GET | `/api/projects/:id` | 详情，返回 `payload` |
| PUT | `/api/projects/:id` | 保存；请求体带 `revision`，不匹配返回 `409 revision_conflict` |
| DELETE | `/api/projects/:id` | 软删，写 `deleted_at` |
| POST | `/api/projects/import` | 批量导入（本地数据迁移用），带幂等键 |

### 素材

`GET/POST /api/assets`、`PATCH/DELETE /api/assets/:id`。

### 媒体

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/media/sign` | 入参 `mime`/`bytes`/`sha256`，返回 presigned PUT + `key`；按 bytes 校验配额与大小上限 |
| POST | `/api/media/commit` | 上传成功后确认，校验对象存在并写 `media` 行，返回可读 URL |
| GET | `/api/media/:key/url` | 短期只读签名（私有 bucket 用） |
| DELETE | `/api/media/:key` | 删除；被项目引用时拒绝或只解引用 |

### 生成

在现有 4 个端点基础上补：

| 别名 | 上游 | 说明 |
| --- | --- | --- |
| `video-generations` | `/v1/videos` | 创建任务，返回 provider task id |
| `video-tasks` | `GET /v1/videos/{id}` | 查询状态 |
| `video-content` | `GET /v1/videos/{id}/content` | 取二进制，落对象存储后返回 `key` |

并要求 `image-edits` 支持 multipart（蒙版编辑真实形态）。`generate.ts` 现在只处理 JSON，需要按 `content-type` 分流。

### 任务

`GET /api/tasks/:id`、`GET /api/tasks?status=running`、`POST /api/tasks/:id/cancel`。

### 管理端

`GET /api/admin/stats`：用户数、今日调用量、今日成本、余额总览、失败率。其余管理接口已有。

---

## 六、关键决策与取舍

### D1 项目保存：整包快照 + revision，不上 CRDT

前端现在就存整个 `CanvasProject`（`nodes` / `connections` / `chatSessions` / `viewport`）。上 Yjs / tldraw sync 需要重写画布数据流，收益是多人实时协作——而这是当前产品没有的需求。

- 做法：整包 PUT + `revision` 乐观锁 + 前端 debounce 保存（建议 1.5s）+ 409 提示「已在别处修改」
- 代价：每次全量写。缓解手段：只在 dirty 时写、`Content-Encoding: gzip`、列表接口不带 payload
- 重新评估的信号：单项目 payload 稳定超过 5MB，或出现真实多人协作需求

### D2 媒体：浏览器直传对象存储，后端只签名

- 好处：应用服务器不转发字节（省带宽、省内存、不受请求体上限限制），`server/` 能继续保持零依赖
- 代价：需要处理「上传成功但 commit 没到」的孤儿对象 → 对象存储配 lifecycle 规则（7 天清理未 commit 前缀）+ 定时对账
- 必须用成熟 SDK 签名，不要手写 S3 签名（`AGENTS.md` 基本原则：通用能力优先用成熟库）

### D3 同域部署，不做跨域

`web/src/services/api/lihuo-server.ts` 用 `credentials: "include"`。前后端不同站时，`SameSite=Lax` 的 Cookie 会被浏览器直接拦掉，再叠加第三方 Cookie 策略、预检、`Access-Control-Allow-Credentials`，调试成本远超收益。

- 做法：反代把 `/api/*` 挂到前端同域，`VITE_LIHUO_SERVER_URL` 留空走同源
- 之后 `LIHUO_COOKIE_SECURE=true` 即可，`LIHUO_CORS_ORIGINS` 只留给本地开发

### D4 长任务：表 + 进程内 worker，不上 Redis

视频生成几十秒到几分钟，用户关页面就断。创建即返回 `taskId`，前端轮询（或 SSE），worker 在 server 进程内跑。

- 单实例：`tasks` 表 + 定时拉取足够
- Postgres：可用 `pg-boss`，不引入新组件
- 只有多实例部署才值得上 Redis + BullMQ
- 计费与任务生命周期绑定：预扣 → 成功结算 → 失败/超时/取消全额退款，直接复用 `billing.ts` 的 `refund`

### D5 数据库：SQLite 起步，明确换库阈值

现状：`node:sqlite` 单文件 + WAL，`server/db.ts`。对本项目（每用户每次保存一次快照写）完全够用，备份就是拷文件。

- 继续用 SQLite 的条件：单实例、写 QPS < 20、库 < 5GB
- 必须换掉 `node:sqlite`：它在 Node 22 仍是实验特性（要 `--experimental-sqlite`），生产建议 `better-sqlite3`
- 换 Postgres 的触发点：出现第二个应用实例、需要多实例滚动发布、或写 QPS 上到几十

### D6 协议：后端只认 OpenAI 兼容格式

前端现在支持三种调用格式（`model-plugin.ts` 里 OpenAI / Gemini / 豆包并存）。后端如果照抄三套，维护成本会翻三倍。

- 目标：Gemini / 豆包的差异收敛到 New-API 的渠道适配层，后端只暴露 OpenAI 兼容语义
- **风险（待验证）**：Gemini 原生图片流（`:streamGenerateContent`）经网关转换后可能走不通；上线前用真实渠道验证一次，走不通就单独保留 `gemini-*` 端点，不要硬塞进统一协议
- 顺带收益：生成结果统一 `b64_json → 对象存储 → 返回 key`，前端不必再处理巨型 base64

### D7 沿用现有工程，不重写框架、不提前上中间件

常见的通用建议是「换 NestJS/Fastify + Prisma/Drizzle + Redis/BullMQ + `/api/v1` 前缀」，逐条说明为什么这一版不做：

| 建议 | 本项目的判断 |
| --- | --- |
| 换 Web 框架 | 现有 `node:http` 手写路由已经跑通鉴权、计费、幂等、审计，全量约 15 个端点。换框架的收益是生态便利，代价是把已验证的计费逻辑重写一遍并重新测。**不换**；只在需要 multipart / 限流中间件时局部引入 |
| 换 ORM | 现有 `db.ts` 是裸 SQL，表结构清晰、可读。引入 ORM 会带来迁移工具与生成代码两套心智。**不换**，直到出现多实例需要迁移版本管理 |
| Redis + BullMQ | 单实例、任务量小。用 `tasks` 表 + 进程内 worker 足够，`lease_until` 解决崩溃恢复。**触发条件**：多实例部署或需要跨进程调度时才引入 |
| `/api/v1` 前缀 | 现有前端已固定 `/api/*`，公网首发也没有第二版客户端，版本化是伪需求。**真要版本化**，等服务端与客户端发布节奏分离时并存 `/api/v2`，而不是现在给所有路径加一层 |
| `projects` / `canvases` / `canvas_snapshots` 三层 | 见第四章，一个 `CanvasProject` 就是一个画布，拆开只有成本 |

一句话：**公网首发要的是「少依赖、可验证」，不是「架构图好看」。** 上面每一项都有明确的重新评估触发条件，写在这里是为了避免半年后再讨论一遍。

---

## 七、账户体系

单独成章，因为它是「能不能收钱」的前提，不只是设置页。

### 7.1 账户生命周期

```txt
注册 → 验证邮箱 → 领初始额度 → 使用（消耗流水）
                                   ├── 额度不足 → 充值 / 兑换码（额度流水）
                                   ├── 忘密码 → 邮件验证码 → 重置 → 吊销全部会话
                                   └── 不用了 → 注销（软删 + 冷却期）→ 到期清理
```

三个阶段各有对应的数据与接口，缺一环就会退化成「找管理员手工处理」。

### 7.2 前端页面

在 `web/src/pages/` 下新增 `account/`，挂在 `UserLayout` 内，入口是 `layouts/user-layout.tsx` 的头像菜单（现在没有）：

| 页签 | 内容 | 依赖接口 |
| --- | --- | --- |
| 概览 | 余额、今日/本月消费、调用次数、最近流水 | `/api/me/summary` |
| 资料 | 昵称、邮箱（含验证状态）、头像 | `PATCH /api/me` |
| 安全 | 改密码、登录设备列表、下线设备、注销账号 | `/api/me/password`、`/api/me/sessions` |
| 账单 | 消耗流水 + 额度流水，两条时间线分开看 | `/api/usage`、`/api/me/ledger` |

登录页 `pages/login/index.tsx` 补「忘记密码」，新增 `/register`（未开放注册时隐藏，不要暴露一个 403 表单）。

按 `AGENTS.md`：账户页属于普通用户界面，用 `app-theme.ts` / CSS 变量取色，不要另起一套样式；管理后台的明色 `ConfigProvider` 只用于 `pages/admin/`。

### 7.3 安全规则（都要服务端强制）

| 规则 | 理由 |
| --- | --- |
| 改密码必须验旧密码 | 防止会话被劫持后直接改密锁死账号 |
| 改密后吊销其他会话，保留当前 | 全局吊销会把用户自己踢下线，体验上像 bug |
| 重置密码后吊销全部会话 | 账号可能已泄露，不能留活口 |
| 验证码只存哈希、5 分钟有效、一次性、错 5 次作废 | 与现有会话 token 的处理保持一致 |
| `forgot` 永远返回同一句提示 | 否则接口变成「邮箱是否存在」的探测器 |
| 下线设备用 `session.id` 而非 token | 前端永远拿不到 token（HttpOnly） |
| 管理端调额度必须带 `reason` 并写流水 | 没有流水的余额调整，事后无法对账 |
| 注销是软删 + 冷却期（建议 30 天） | 防误操作；冷却期内登录可撤销 |
| 注销不清空 `usage_records` | 账单要留档，只清 `media` 与 `projects` 的个人数据 |

### 7.4 需要你拍板的三件事

方案不替你定，这三条影响 schema 与成本：

1. **注册靠什么把关？** 推荐：邀请码（P0，零成本）+ 邮箱验证（P1，需要发信服务）。纯开放注册在有生成成本的产品上等于对外开放你的余额。
2. **额度怎么进来？** 推荐 v1 只做「兑换码 + 管理员手动入账」，不接支付。接支付宝/微信需要商户资质与回调验签，是独立工作量；先让流水表跑起来，日后接支付只是多一个 `kind = recharge` 的写入方。
3. **要不要邮箱？** 要找回密码就必须有。若暂时不想配域名邮箱，就明确「密码丢了找管理员」，并在注册页写清楚——比做一个发不出信的找回流程诚实。

---

## 八、实施清单

每条都可独立提 PR。验收标准写成「能复现的动作 + 可观测的结果」。

### 实施进度

后端已按 P0 落地为独立工程 `lihuo-backend`（工作区外，桌面 `lihuo后端/`），46 项端到端自检通过，Docker Compose 可一键启动。

| 项 | 后端 | 前端 |
| --- | --- | --- |
| P0-1 生成端点补齐 | ✅ 同步 4 端点 + 视频异步任务 | — |
| P0-2 前端删 Key | — | ✅ 云端模式默认开启（文本对话待 /api/chat） |
| P0-3 项目云存储 | ✅ 含乐观锁与越权隔离 | ✅ 列表/打开/保存/删除/迁移已接 |
| P0-4 媒体直传 | ✅ local / S3 双驱动 | ✅ 图片/视频/音频已切云端 |
| P0-5 payload 去 base64 | ✅ 服务端拦截内联图片 | ✅ 保存前上传并替换 key |
| P0-6 同域部署 | ✅ 多阶段镜像 + nginx 反代 + 栈编排 | ✅ 已验证同源登录与生成 |
| P0-7 成本护栏 | ✅ 余额 / 并发 / 日上限 | — |
| P0-8 本地数据迁移 | ✅ `/api/projects/import` | ✅ 列表页一次性上传（含媒体上云） |
| P0-9 账户自助最小集 | ✅ 接口齐全 | ✅ /account 页面 + 顶栏用户菜单 |
| P1 积分系统（独立于额度） | ✅ `point_transactions` + 套餐/订单/退款 | ✅ 充值页 + 账户中心 + 管理后台「积分管理」 |

未做的后端项：分享链接（只读快照语义）。项目版本历史已补齐（`project_versions` 表 + 列表/恢复接口 + 画布「历史版本」抽屉）。

### P0（不做完不能开公网）

**P0-1 生成代理补齐端点**
做什么：`generate.ts` 增加 `video-generations` / `video-tasks` / `video-content`；`image-edits` 支持 multipart（按 `content-type` 分流，用 Node 内置 `FormData`）。
涉及：`server/src/modules/generate.ts`、`gateway/newapi/newapi.provider.ts`、`registry.ts`（video 能力参数已存在）。
验收：curl 带 image 能力模型调 `video-generations` 返回任务 id；视频产物下载后写入对象存储并返回 `key`；失败全额退款且流水 `refunded`。

**P0-2 前端切到代理，删除浏览器 Key**
做什么：`image.ts` / `video.ts` / `audio.ts` 的请求全部改走 `lihuo-server.ts` 的 `generate()` / `generateBlob()`；`use-config-store` 的 `apiKey` 与 `channels[].apiKey` 彻底删掉（不是隐藏）；`withLocalProxy` 一并清理。
涉及：`web/src/services/api/*`、`web/src/stores/use-config-store.ts`、`web/src/pages/config/`。
验收：全局搜索 `apiKey` 只剩读取上游网关的只读字段；DevTools 网络面板里任何生成请求都不含 `Authorization: Bearer sk-`；断网时提示改为「服务不可用」而不是「请配置 Key」。

**P0-3 项目云存储**
做什么：`projects` 表 + 5 个接口；列表不带 payload；`revision` 冲突返回 409；项目保存端点单独放宽请求体上限（建议 8–16MB）并支持 gzip。
涉及：`server/src/db.ts`、新增 `server/src/modules/projects.ts`、`server/src/http/server.ts`、`http/respond.ts`（`readJson` 增加端点级上限）。
验收：两个标签页同时改同一项目，后保存者收到 409 且本地未丢失；刷新后项目从服务端恢复；换浏览器登录后能看到全部项目；**用 B 用户 Cookie 请求 A 的项目 id，必须返回 404（不是 403、更不是 200）**。

**P0-4 媒体对象存储直传**
做什么：`media` 表 + `sign` / `commit` / `url` / `delete`；私有 bucket + 短期签名；前端 `file-storage.ts`、`image-storage.ts` 写路径改为「本地缓存 + 后台上传」，读路径优先远程签名 URL。
验收：上传 50MB 视频时应用服务器出口带宽为 0；清空浏览器缓存后作品仍能打开；上传中断不产生脏数据；**伪造 `mime` 上传可执行文件被拒**；**用别人的 key 请求签名 URL 返回 404**。

**P0-5 payload 去 base64**
做什么：`CanvasAssistantImage.dataUrl`、助手引用、素材封面等内联字段改为只存 `mediaKey`；渲染时按需换取签名 URL。
涉及：`web/src/types/canvas.ts`、`stores/canvas/use-canvas-store.ts`、`services/app-sync.ts`（WebDAV 分支同步调整）。
验收：一个有 20 张图的画布，`payload` 体积 < 200KB；保存耗时 < 500ms。

**P0-6 同域部署**
做什么：`Dockerfile` 改多阶段（前端 dist + server 运行镜像）；Caddy/Nginx `location /api` 反代；`VITE_LIHUO_SERVER_URL` 默认空；`LIHUO_COOKIE_SECURE=true`。
验收：`https://域名/api/me` 带 Cookie 正常；登录后刷新不掉登录态；`http://` 访问自动跳 `https://`。

**P0-7 成本护栏**
做什么：余额低于单次最高价直接 400；单用户并发生成上限；全局并发上限；单用户日消费上限；生成接口按用户限流。
涉及：`server/src/modules/generate.ts`、`billing.ts`、新增 `server/src/modules/limits.ts`。
验收：余额不足时请求不落到上游（网关日志无记录）；同用户并发超过上限返回 429 且不扣费。

**P0-8 本地数据迁移**
做什么：一次性「把本机画布和素材上传到云端」入口：读 IndexedDB → 上传媒体 → 建项目；带幂等键，可重复执行。
验收：老用户升级后点一次即可看到全部历史项目；重复点击不产生重复数据。

**P0-9 账户自助最小集**
做什么：`users` 扩列；`PATCH /api/me`、`POST /api/me/password`（验旧密码、保留当前会话）、`GET/DELETE /api/me/sessions`、`GET /api/me/summary`；`credit_transactions` 表与 `POST /api/admin/users/:id/credit`（必须带 `reason`），并把 `patchUser` 直接改 `quotaCents` 的入口关掉；前端 `/account` 页的「概览 / 资料 / 安全 / 账单」四个页签 + `UserLayout` 头像菜单。
涉及：`server/src/db.ts`、新增 `server/src/modules/account.ts`、`users.ts`、`http/server.ts`、`web/src/pages/account/`、`web/src/layouts/user-layout.tsx`、`web/src/services/api/lihuo-server.ts`。
验收：用户能自己改密码且其他设备被踢、当前设备不掉线；设备列表里能看到并下线另一台模拟登录的设备；管理员给 100 元额度后，用户账单页出现一条带原因的入账记录且余额吻合；`PATCH /api/admin/users/:id` 传 `quotaCents` 返回 400 并提示改用 credit 接口。

### P1（上线第一周）

1. **异步任务表 + worker**，含断线恢复与取消；视频任务不再依赖页面存活
2. **注册闭环**：邀请码（P0 即可）+ 邮箱验证 + 找回密码；`LIHUO_ALLOW_REGISTER` 打开前必须先有它
3. **通用限流表**：`login` / `generate` / `upload` 三类桶，替换只覆盖登录的 `login_attempts` 逻辑
4. **管理端统计页**：成本曲线、失败率、余额分布，接 `/api/admin/stats`
5. **备份、日志与监控**：SQLite `VACUUM INTO` 每日快照 + 对象存储版本化；结构化日志（`request_id` / `user_id` / `task_id` / `cost_cents`）；`/health` 之外补关键指标与告警阈值
6. **sidecar 降级**：检测不到 9091 / 17371 时隐藏豆包账号池与本地 Agent 入口
7. **注册/登录页补齐**：`/register`、忘记密码、错误文案归一（不泄露用户是否存在）
8. **管理端用户运营**：搜索分页、额度调整弹窗（带原因）、额度流水查询

### P2（体验与增长）

1. **只读分享链接**（快照语义 + 可撤销 + 有效期）
2. **项目版本与回收站**（`deleted_at` 已有，补恢复与历史回滚）
3. **团队与协作**（真要做再评估 Yjs / tldraw sync，届时数据模型要改，别提前设计）
4. **模板市场**（复用 projects 的 payload 结构，单独的只读集合）

---

## 九、部署与运维

### 拓扑（起步）

推荐规格：**2 核 / 4GB / 40GB SSD，Ubuntu 22.04 LTS**，安全组只放行 `80` / `443`（SSH 限来源 IP）。数据库、Redis、`:3100` 一律不暴露公网。

```txt
caddy      :443  静态产物 + /api 反代 + 自动 HTTPS（Certbot 或 Caddy 自动签发）
lihuo-server      :3100（仅内网）
new-api           :3001（仅内网）
worker（可选）    与 api 同镜像、不同启动参数，跑 tasks 轮询
postgres 或 sqlite 文件卷
```

对象存储用云厂商（R2 / OSS / S3），不自建 MinIO——除非已有运维能力。前端产物可接 CDN，但 `/api` 不要进 CDN 缓存。

**反代两条必须配对**：

- 请求体上限要跟着放宽（`client_max_body_size 16m`），否则项目保存会在反代层被 413 掉，后端根本收不到
- `X-Forwarded-For` / `X-Real-IP` 必须透传，否则限流与风控全部按反代 IP 统计，等于失效

v1 没有 WebSocket。若将来做实时协作，反代需要补 `proxy_http_version 1.1` + `Upgrade` / `Connection` 头，并确认链路各层都不缓冲长连接——先把这条记在这，别到时候查半天为什么握手失败。

### 环境变量（在现有 `server/src/config.ts` 基础上新增）

| 变量 | 说明 |
| --- | --- |
| `LIHUO_PUBLIC_ORIGIN` | 对外域名，用于拼签名与 Cookie 域 |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` | 对象存储 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | 只给后端，不进任何前端产物 |
| `MAX_PROJECT_BYTES` | 项目 payload 上限（默认 8MB） |
| `MAX_UPLOAD_BYTES` | 单文件上限（默认 200MB） |
| `DAILY_COST_CAP_CENTS` | 单用户日消费上限 |
| `LIHUO_COOKIE_SECURE` | 生产必须 `true` |
| `LIHUO_CORS_ORIGINS` | 生产留空（同域），仅本地开发用 |

### 运维底线

- **备份**：数据库每日快照 + 对象存储开版本化；每月做一次真实恢复演练（没演练过的备份不算备份）
- **日志**：现在只有 `console.log` 请求行，生产要落文件或采集。每条至少带 `request_id` / `user_id` / `task_id`（若有）/ `model` / `status` / `latency_ms` / `cost_cents`，否则排查一次「用户说扣了钱但没出图」要翻三个系统
- **错误码**：错误响应带 `request_id` 且不返回堆栈；用户报错时能凭这个 id 直接定位请求
- **对账**：`usage_records.gateway_request_id` 与网关日志定期比对，防止计费漂移
- **成本告警**：日成本、单用户异常消费、单模型调用量突增三类阈值

---

## 十、风险与合规

| 风险 | 说明与应对 |
| --- | --- |
| Key 泄露 | P0-2 完成前不要开公网。收口后仍要定期扫前端产物里是否残留 `sk-` |
| 成本失控 | 没有余额下限和并发上限时，一个脚本就能刷爆。P0-7 是上线前置条件 |
| 内容安全 | 生图/生视频在境内公网需要内容审核责任，至少接入审核接口并留痕 |
| 备案 | 境内主机必须域名备案；生成式 AI 服务另有备案要求，流程有周期，别等上线才办 |
| 大 payload DoS | 项目保存放宽到 MB 级后，必须配按用户限流与总量配额，否则等于开放写盘 |
| 孤儿对象 | 直传必然产生孤儿，靠 lifecycle + 定时对账，不要指望前端一定 commit |
| 老数据丢失 | 迁移入口（P0-8）要在切换前上线，先迁移后关本地写路径 |

---

## 十一、参考

- **同形态项目**：`LobeChat`、`Open WebUI` —— 「AI 应用 + 多用户 + 额度 + 对象存储」最接近的完整参考
- **计费与令牌模型**：`new-api` / `one-api` —— 已在用，渠道与配额设计可直接借鉴
- **协作边界**：`tldraw/sync`、`excalidraw-room` —— 只用来看「真做协作要付什么代价」，v1 不引入
- **库**：`better-sqlite3`、`pg-boss`（Postgres 队列）、`@aws-sdk/client-s3`（签名）

---

## 附录 A　三方方案对照

本文定稿前对照过两份外部方案，记录取舍过程，避免以后重复讨论。

| 代号 | 来源 | 定位 |
| --- | --- | --- |
| **A** | Gemini《无限画布后端架构与公网部署指南》 | 通用画布类 SaaS 的教科书式指南 |
| **B** | GPT《公网 SaaS 后端架构建设建议》 | 面向本仓库的工程实施方案 |
| **C** | 本文 | 基于当前代码事实的落地计划 |

### A.1 总体判断

- **B 的工程质量最高**，方法论（审计先行、模块化单体、服务端权威、渐进迁移）与本文一致，且补了若干本文漏掉的工程细节
- **A 偏通用范式**，对「画布=多人实时协作」的前提假设与本项目不符，但部署实操细节可用
- **C 的独有价值**在于贴着代码找缺口：直连上游的具体行号、256KB 上限、sidecar 端口、`patchUser` 无流水、`dataUrl` 内联导致 payload 膨胀——这些是 A/B 都没看到的本项目特有问题

### A.2 已采纳（并已并入正文）

| 来源 | 条目 | 并入位置 |
| --- | --- | --- |
| B | 画布 `schema_version`，识别旧 payload | 四、projects |
| B | 任务状态机增加 `cancel_requested`，取消要与上游真实能力对应 | 四、tasks |
| B | 任务租约 `lease_until` + 崩溃恢复 + 可重试/永久错误区分 | 四、tasks |
| B | 上传校验真实 MIME 与文件签名，不只信浏览器声明 | 四、media |
| B | 对象 key 不可预测，前缀不作访问控制边界 | 四、media |
| B | 下载签名前先查所有权 | 四、media |
| B | 结构化日志含 `request_id` / `task_id` / `user_id`，错误响应带 `request_id` | 九、运维底线 |
| B | 越权（IDOR）作为验收项：返回 404 而非 403 | 八、P0-3 / P0-4 |
| A | 服务器规格、Ubuntu 版本、安全组只开 80/443 | 九、拓扑 |
| A | 反代 `client_max_body_size` 与 `X-Forwarded-For` 透传 | 九、拓扑 |
| A | WebSocket 升级头配置（作为将来协作的预留备忘） | 九、拓扑 |
| A | 前端产物可上 CDN，但 `/api` 不进 CDN 缓存 | 九、拓扑 |

### A.3 未采纳（及重新评估的条件）

| 来源 | 建议 | 为什么不采纳 | 何时重新考虑 |
| --- | --- | --- | --- |
| A | 新建 `backend/` 目录 | 与现有 `server/` 重复；`server/` 已完成鉴权、计费、模型注册、生成代理、审计 | 不存在该场景 |
| A | 以 Yjs + y-websocket / Socket.io 为核心 | 当前画布无协作者概念、无 WS 连接，唯一的实时链路是本地 Agent 的 SSE；CRDT 会要求重写画布数据流 | 真做多人协作时 |
| A | JWT 登录 | 现有不透明 Cookie 会话可在封禁时**立即**吊销；JWT 只能等过期，或另建黑名单 | 需要给第三方开放 API 时（可用独立 token 体系，不动会话） |
| A | Prisma + 全新建库 | 现有表（users / sessions / usage_records / audit_logs / models / prices）承载了已跑通的计费，重建等于放弃对账能力 | 换 Postgres 且引入迁移工具时 |
| B | Fastify / NestJS 重写 | 手写路由已覆盖全部端点，重写要重测计费与幂等 | 端点数量翻倍或需要插件化中间件时 |
| B | Redis + BullMQ 作为必须项 | 单实例用 `tasks` 表 + 进程内 worker 足够，少一个中间件少一类故障 | 多实例部署 / 跨进程调度 |
| B | `projects` / `canvases` / `canvas_snapshots` 三层 | 一个 `CanvasProject` 就是一个画布，拆开只有 id 映射成本 | 出现「一个项目多个画布」 |
| B | `folders` 素材夹 | 当前 `Asset` 无文件夹概念 | 素材量上到需要分类运营 |
| B | `/api/v1` 前缀 | 现有前端固定 `/api/*`，首发无第二版客户端 | 服务端与客户端发布节奏分离 |
| B | 阶段 0「架构审计」 | 本轮已完成（见第二章），结论是「复用而非重建」 | — |

### A.4 两份文档对项目事实的误判

这几处如果不纠正，照着做会直接走错方向：

1. **A 假设前端在 `frontend/`、后端要新建** —— 实际前端在 `web/`，后端 `server/` 已存在且完成度高于 A 的示例模型
2. **A/B 都假设画布需要实时协同** —— 本项目画布是单用户编辑，协作不在路线图里；把它当核心需求会引入一整套当前用不上的基础设施
3. **A 的 `elements Json` + `isPublic` 模型没有并发控制** —— 多设备同时编辑会互相覆盖，本文用 `revision` 乐观锁解决
4. **B 把 Redis/BullMQ 列为生产必备** —— 对多实例成立，对单实例是负收益
5. **两份文档都没提本项目的三个特有大坑**：`dataUrl` 内联导致 payload 膨胀、`readJson` 的 256KB 上限、豆包 sidecar 无法上云

### A.5 保留的一句话结论

> 架构选型的分歧，多半不是「谁更先进」，而是「对约束的假设不同」。
> 本项目当前的约束是**单实例、单用户画布、已有可用的计费后端**，所以选少的依赖；
> 一旦约束变了（多实例、真协作、对外开放 API），A/B 里被拒绝的条目就该按表逐条重新评估。
