# 豆包生成链路与公网部署安全审查

日期：2026-11-22
范围：`web` 画布生成链路、`doubao-bridge`、配置持久化、Docker / 部署后端边界。

## 结论

- 豆包 / Dola 的图片、视频参数已从「画布能选」收敛到「网页端真实可点」：比例、自动文案、视频时长都会在提交前和桥接侧双重校验。
- 结果回填已加任务归属与槽位校验：旧任务晚到、刷新续查、单张重试都不会覆盖新卡片。
- 公网部署的当前工作区检查通过：没有已跟踪的 API Key、豆包账号态或运行期数据库；Docker 构建上下文已排除敏感目录。
- **唯一未通过项**：实际部署的后端工程 `../lihuo后端` 的 Git 历史里提交过 `.env.docker`。该文件曾包含 `LIHUO_ADMIN_PASSWORD` 与 `STORAGE_SECRET`，当前删掉文件也仍可从历史恢复。必须轮换这两个值、邀请码，并清理历史（或换干净仓库）后再公开。

## 一、豆包参数为什么传不准

### 根因

1. 画布图片尺寸使用像素值（如 `1024x1024`、`2688x1152`）或 `auto`，原逻辑直接 `inferMediaRatio()` 后发给桥接；`auto` 以英文 `auto` 发到网页，而豆包面板选项是「自动」，执行器点不到。
2. 画布允许 21:9 / 9:21，豆包图片面板真实选项只有「自动、9:16、2:3、3:4、1:1、4:3、3:2、16:9」；执行器找不到就沿用网页上一次比例。
3. 视频比例已收敛，但时长面板默认上限是 30s，豆包 / Dola 网页端只接受 4–15s；Schema 未加载时会提交 30s，桥接再静默改成 15s，用户看到的选择和实际结果不一致。
4. 参数面板仍显示画质、分辨率、像素尺寸、透明底、生成模式等网页端无法传入的项，造成「面板有值、豆包没收到」。

### 修复

- `web/src/constants/doubao-builtin.ts` 新增真实比例集合与 `normalizeBuiltinRatio()`：`auto/Auto/自动` 统一，像素尺寸与非支持比例按最近比例收敛（图片 21:9→16:9、9:21→9:16；视频 9:21→9:16）。
- `web/src/services/api/image.ts` 的豆包生图 / 参考图分支改用收敛函数，只提交 `ratio + count`（模型由桥接任务单独携带），不再提交画质等无效参数。
- `web/src/components/image-settings-panel.tsx` / `video-settings-panel.tsx` 在内置豆包模型下隐藏网页端不存在的参数；图片比例只显示豆包支持项，视频比例过滤到真实集合，时长限制 4–15s。
- `web/src/stores/model-schema.ts` 的 `readVideoRequestParams()` 对内置模型强制 4–15s，并把 `auto` 输出为「自动」。
- `doubao-bridge/server.mjs` 新增 `normalizeRatio()` / `normalizeDuration()`，在生成任务 spec 上再收敛一次；Dola 的自动文案转为 `Auto`。
- `doubao-bridge/run-doubao.mjs` 的自动比例点选兼容「自动 / Auto」，并在点选后读回校验，避免点不到时静默沿用旧比例。

## 二、结果为什么回不到对应卡片

### 根因

1. 前端取消只停止轮询，Runner 继续跑；用户重新生成后，旧任务晚到的图片 / 视频会覆盖同一节点。
2. 图片适配器没有校验桥接返回任务的 `nodeId`；任务也不一定绑定到最终结果卡片。
3. `GET /api/jobs?nodeId=` 原来先截断再按节点过滤，其他节点任务多时查不到本节点记录。
4. 单张重试、视频刷新续查缺少「当前槽位 / taskId 是否仍属于我」的检查。

### 修复

- `doubao-bridge/server.mjs` 新增 `POST /api/jobs/:id/cancel`：标记取消、记录结束时间、用 `taskkill /T`（Windows）或进程组 kill 终止 Runner 进程树；`finish` 时取消优先，取消后不会被结果改回成功。
- `web/src/services/api/doubao-bridge-adapter.ts` 新增 `waitJobWithCancel()`：Abort 时调用取消接口；图片结果校验 `done.nodeId` 与请求节点一致，不一致直接报错，不贴错卡片。
- `web/src/services/api/video.ts` 的视频轮询在 Abort 时取消豆包任务，并在取消返回 failed 后再次检查 abort，避免把「用户取消」当成真实生成失败。
- 图片批量生成请求改为把任务绑定到**最终结果卡片**的 `rootId`，检查器按卡片就能查到对应任务；单张重试同样绑定当前卡片。
- `web/src/pages/canvas/project.tsx` 在写回前检查 `signal.aborted`、槽位 `imageId`、视频 `taskId`；即使结果晚到，也不会覆盖已经被新任务接管的卡片。
- `GET /api/jobs` 改为先按 `nodeId` 过滤再截断。

## 三、账号与取消行为

- 图片 `resolveAccountId()` 不再在当前账号跨站点时静默退到同站点第一个账号；视频创建任务也不再静默换站，改为明确报错并要求用户改选账号。
- 桥接手动选号额度不足时不再按号池顺序自动换号，直接返回 `ACCOUNT_QUOTA_BLOCKED`，避免未经确认消耗另一个账号的额度。
- 前端取消会同步取消桥接任务；桥接取消会终止 Runner 进程树。

## 四、公网部署安全

### 已修复

- `.dockerignore` 排除 `.doubao-accounts`（浏览器 profile + 登录 Cookie）、`.doubao-venv`、`.doubao-service`、`.doubao-session.json`、`.backup`、`server/data`、`vendor`、`web/dist`、`web/.env*` 等。
- `doubao-bridge` 只允许绑定回环地址；非回环 host 直接退出。新增 Host / Origin 白名单，阻断本地 CSRF 与 DNS rebinding；二维码与产物接口不再返回 CORS `*`。
- WebDAV 密码不再写入 localStorage，启动时擦除旧值，配置导出 / 导入时剥离；API Key 仍只存在内存，不落盘、不导出。
- 主仓库 `server/src` 副本：`clientIp` 只在直连对端属于 `LIHUO_TRUST_PROXY` 可信代理时才解析 `X-Forwarded-For`；初始管理员密码不再打印到日志，文件用 `0600` 写入。
- 新增 `scripts/security-check.mjs`：检查已跟踪 / 未跟踪文件、Git 历史敏感路径、源码与前端产物中的 Key / Cookie 特征、Dockerfile COPY/ADD、`.dockerignore` 必备项、实际后端工程的 `.dockerignore` / `.gitignore` 与历史 `.env.docker`。Git 不在 PATH 时会明确失败，不会静默跳过。

### 仍未通过（必须在部署前处理）

`../lihuo后端` 的 Git 历史提交过 `.env.docker`，其中曾写入管理员密码和 `STORAGE_SECRET`。这是历史层泄露，当前工作区无法靠改代码消除：

1. 轮换 `LIHUO_ADMIN_PASSWORD`、`STORAGE_SECRET`、`LIHUO_INVITE_CODE`。
2. 用 `git filter-repo` / BFG 清理后端仓库历史，或直接换一个干净仓库发布；清理后重新跑 `node scripts/security-check.mjs`。
3. 如果该仓库曾经推送过，按已泄露处理，不要只删除当前文件。

## 五、验证结果

- `web`：`npm run typecheck`（`tsc --noEmit`）通过。
- `node --check doubao-bridge/server.mjs`、`run-doubao.mjs`、`scripts/security-check.mjs` 通过。
- doubao-bridge 无账号冒烟测试：健康检查 200；伪造 Host 403；恶意 Origin POST 403；白名单 Origin 返回对应 CORS 头。
- `node scripts/security-check.mjs`：693 个已跟踪文件、97 个未跟踪文件、1050 个前端产物；当前工作区无 Key / 账号态；唯一失败项为上述后端历史 `.env.docker`。
- **未验证**：真实豆包 / Dola 账号的图片、视频生成、取消、同账号并发、刷新恢复、跨节点回填；Windows 下 `taskkill /T` 是否彻底收掉 Edge 子进程；实际 `docker build` 上下文。按项目约束，没有消耗真实账号额度做测试。

## 六、修改 / 新增文件清单

### 新增

- `scripts/security-check.mjs`
- `docs/ai-handover/SECURITY_REVIEW_2026-11-22.md`
- `docs/ai-handover/DOUBAO_SECURITY_FIX_2026-11-22.diff`

### 修改（本次任务）

- `.dockerignore`
- `.gitignore`
- `CHANGELOG.md`
- `SECURITY.md`
- `doubao-bridge/run-doubao.mjs`
- `doubao-bridge/server.mjs`
- `server/src/config.ts`
- `server/src/index.ts`
- `server/src/http/respond.ts`
- `web/src/components/image-settings-panel.tsx`
- `web/src/components/video-settings-panel.tsx`
- `web/src/constants/doubao-builtin.ts`
- `web/src/pages/canvas/project.tsx`
- `web/src/services/api/doubao-bridge-adapter.ts`
- `web/src/services/api/doubao-bridge.ts`
- `web/src/services/api/image.ts`
- `web/src/services/api/video.ts`
- `web/src/services/config-file.ts`
- `web/src/stores/model-schema.ts`
- `web/src/stores/use-config-store.ts`
- `docs/ai-handover/KNOWN_ISSUES.md`
- `docs/content/docs/progress/pending-test.mdx`
- `docs/content/docs/progress/todo.mdx`

## 七、部署前检查清单

- [ ] 轮换后端 `LIHUO_ADMIN_PASSWORD`、`STORAGE_SECRET`、`LIHUO_INVITE_CODE`。
- [ ] 清理后端 Git 历史或换干净仓库；重新跑 `node scripts/security-check.mjs` 至通过。
- [ ] 不要把 `.doubao-accounts/`、`.doubao-venv/`、`.doubao-session.json`、`.env.docker` 上传到服务器或打进镜像。
- [ ] 公网服务器不启动 `doubao-bridge`，不映射 `9091`；需要远程使用时走 SSH 隧道。
- [ ] 生产环境设置 `NODE_ENV=production`、`LIHUO_PUBLIC_ORIGIN=https://...`、`LIHUO_COOKIE_SECURE=true`、可信反代 `LIHUO_TRUST_PROXY`。
- [ ] 上游 API Key 只放后端环境变量 / `.env.docker`，前端不配置 `VITE_*` Key。
