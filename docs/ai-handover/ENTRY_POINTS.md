# 离火 Lihuo 入口地图（先读这份）

> 目的：任何 AI/开发者接手时，5 分钟内知道「从哪进、改哪里、怎么验证」。
> 这份文档随代码更新；如果发现与代码不一致，以代码为准并回来修这里。

## 一、启动（Windows，一步到位）

```bash
# 双击（会同时起前端静态服务和豆包桥接）
open-canvas.bat

# 或手动起两个进程
node scripts/serve.mjs web/dist 3000     # 前端 :3000
node doubao-bridge/server.mjs            # 豆包桥接 :9091
```

- 画布地址：`http://127.0.0.1:3000/canvas`
- 桥接健康检查：`http://127.0.0.1:9091/api/health`
- 改前端后必须 `cd web && pnpm build`，静态服务直接读 `web/dist`
- **不要**用 `node -e` 临时起静态服务器：没有 SPA 回退，`/canvas` 会 404

## 二、代码入口（按「想改什么」找）

| 想改的东西 | 从哪进 |
| --- | --- |
| 路由 / 页面总表 | `web/src/router.tsx` |
| **短剧工作室阶段 1（五步导航 / 项目模型隔离 / 旧项目兼容）** | `docs/ai-handover/DRAMA_STUDIO_STAGE1.md`、`docs/ai-handover/DRAMA_STUDIO_STAGE1.diff` |
| **短剧工作室阶段 2A（原著导入 / 结构化分析 / 人工修正）** | `docs/ai-handover/DRAMA_STUDIO_STAGE2A.md`、`web/src/pages/drama/studio/analysis-workspace.tsx`、`web/src/lib/studio/novel-*.ts`、`web/src/types/novel.ts` |
| **短剧工作室阶段 2B（改编 / 全剧蓝图 / 全剧分集 / 人物弧光 / 伏笔 / 自检）** | `docs/ai-handover/DRAMA_STUDIO_STAGE2B.md`、`docs/ai-handover/DRAMA_STUDIO_STAGE2B_PREFLIGHT.md`、`web/src/pages/drama/studio/adaptation/index.tsx`、`web/src/lib/studio/adaptation-*.ts`、`web/src/types/studio-adaptation.ts` |
| **短剧工作室阶段 3（分集剧本 / 分镜设计）** | `docs/ai-handover/DRAMA_STUDIO_STAGE3.md`、`web/src/pages/drama/studio/production/`、`web/src/lib/studio/production-*.ts`、`web/src/types/studio-production.ts` |
| **短剧工作室阶段 3.1（队列可靠性 / 模型快照 / 分镜并发）** | `docs/ai-handover/DRAMA_STUDIO_STAGE3_1.md`、`docs/ai-handover/DRAMA_STUDIO_STAGE3_1.diff`、`web/scripts/stage3_1-core-check.ts` |
| **短剧工作室阶段 3.2（剧本覆盖保护 / 快照身份 / 分镜 stale）** | `docs/ai-handover/DRAMA_STUDIO_STAGE3_2.md`、`docs/ai-handover/DRAMA_STUDIO_STAGE3_2.diff`、`web/scripts/stage3_2-core-check.ts` |
| 3 分集剧本 / 分镜生成编排 / 串行队列 / 人工核对 | `web/src/lib/studio/production-actions.ts` |
| 3.2 剧本队列跳过 / 覆盖 guard / 场景版本 / stale 依赖 | `web/src/lib/studio/production-protection.ts` |
| 3.2 分镜快照身份 / 类型 / 旧数据规范化 / 应用恢复计划 | `web/src/lib/studio/storyboard-snapshots.ts` |
| 3 分镜整集 / 单场 / 单镜互斥锁与版本冲突 | `web/src/lib/studio/production-locks.ts` |
| 3 刷新收口 / 可继续 / 可重试 / 核对决策 | `web/src/lib/studio/production-workspace.ts` |
| 3 剧本 / 分镜 schema、稳定 ID、镜号重排 | `web/src/lib/studio/production-schema.ts` |
| 3 handoff 准入 / 时长估算 / 连续性检查 | `web/src/lib/studio/production-engine.ts` |
| 3 项目级文本模型调用与 trace | `web/src/lib/studio/production-ai.ts` |
| 改编方案 / 蓝图 / 分集 / 弧光 / 伏笔 / 自检 UI | `web/src/pages/drama/studio/adaptation/` 下 8 个标签页文件 |
| 2B 生成编排 / 局部重生成 / 提案 | `web/src/lib/studio/adaptation-engine.ts` |
| 2B schema / 引用 / 因果 / 人物连续性校验 | `web/src/lib/studio/adaptation-schema.ts` |
| 2B 持久化 / 版本 / 锁定 / 阶段 3 handoff | `web/src/lib/studio/adaptation-workspace.ts` |
| 小说导入与四格式解析 | `web/src/lib/studio/novel-import.ts` |
| 章节识别 / 8,000 字分块 | `web/src/lib/studio/novel-chapters.ts` |
| 原著结构化提取与证据校验 | `web/src/lib/studio/novel-analysis.ts` |
| 跨块合并 / 因果 / 跨章校验 | `web/src/lib/studio/novel-merge.ts` |
| 分析任务状态机 / 中断恢复 | `web/src/lib/studio/novel-analysis-runner.ts` |
| 项目文本模型与 Bridge 账号 | `web/src/lib/studio/novel-model.ts` |
| **短剧工坊 V2（项目库 + 六区 + Workflow）** | `docs/ai-handover/STUDIO_V2.md` |
| 短剧页面壳 / 项目切换 / 五步导航 | `web/src/pages/drama/index.tsx` |
| 五步与旧 workspace URL 映射 | `web/src/lib/studio/navigation.ts` |
| 短剧唯一数据仓 / 旧数据迁移 | `web/src/stores/use-studio-store.ts` |
| 短剧统一任务中心 | `web/src/stores/use-studio-tasks.ts`、`web/src/pages/drama/studio/task-center.tsx` |
| 短剧真实生成动作 | `web/src/lib/studio/actions.ts` |
| 短剧 V2 专属 Diff 快照 | `docs/ai-handover/STUDIO_V2.diff` |
| 全局入口、Provider、主题 | `web/src/main.tsx`、`web/src/layouts/` |
| **画布主逻辑（最重要）** | `web/src/pages/canvas/project.tsx`（约 3500 行，节点生成/连线/任务都在这） |
| 画布节点注册（自研节点） | `web/src/components/canvas/nodes/lihuo/index.tsx` |
| 画布节点渲染 | `web/src/components/canvas/canvas-node.tsx` |
| 节点内提示词面板（模型选择 + 生成按钮 + 豆包账号下拉） | `web/src/components/canvas/canvas-node-prompt-panel.tsx` |
| 节点生成参数 → 请求配置 | `web/src/lib/canvas/canvas-generation-helpers.ts` 的 `buildGenerationConfig` |
| 视频设置面板（比例/时长/账号） | `web/src/components/video-settings-panel.tsx` |
| 生图设置面板（比例/尺寸/质量） | `web/src/components/image-settings-panel.tsx` |
| 右侧「属性 / 日志」 | `web/src/components/canvas/canvas-inspector-panel.tsx` |
| 左侧豆包号池 | `web/src/components/canvas/canvas-doubao-accounts-panel.tsx` |
| 底部任务队列 | `web/src/components/canvas/canvas-task-bar.tsx` |
| 全局配置 / 模型清单 | `web/src/stores/use-config-store.ts` |
| 豆包内置模型清单 | `web/src/constants/doubao-builtin.ts`（含 **Dola** 渠道与模型清单） |
| 账号池面板（豆包 + Dola） | `web/src/components/canvas/canvas-doubao-accounts-panel.tsx` |
| 站点路由 / 站点文案 | `doubao-bridge/server.mjs` 顶部 `SITES`（`doubao` / `dola`） |
| 模型探测（新站点对文案） | `doubao-bridge/probe-models.mjs` |
| 扫码（站点自己的弹窗） | `doubao-bridge/qr-helper-browser.mjs` |
| 模型参数 Schema | `web/src/stores/model-schema.ts` |
| 生图请求（OpenAI / Gemini / 豆包路由） | `web/src/services/api/image.ts` |
| 视频请求（OpenAI / Gemini / 豆包路由） | `web/src/services/api/video.ts` |
| 豆包 bridge 客户端（前端） | `web/src/services/api/doubao-bridge.ts` |
| 豆包适配层（生图 job 组装） | `web/src/services/api/doubao-bridge-adapter.ts` |
| 豆包桥接服务（HTTP :9091） | `doubao-bridge/server.mjs` |
| 豆包生成执行器（真正点页面） | `doubao-bridge/run-doubao.mjs` |
| 账号唯一窗口 | `doubao-bridge/open-account.mjs` |
| 扫码登录 | `doubao-bridge/qr-helper.py` + `inject-cookies.mjs` |
| 桥接公共浏览器工具 | `doubao-bridge/lib/doubao-context.mjs` |

## 三、当前架构（重要，别再按旧版改）

### 1. 豆包没有专属节点（Dola 也没有）

豆包 / Dola 都已并入**普通「图片 / 视频」节点**的统一模型下拉：

```
节点里选模型 → 选 builtin-doubao::<模型名> 或 builtin-dola::<模型名>
  → 走 service 层路由到 bridge（bridge 再按模型决定站点）
```

- 模型清单：`web/src/constants/doubao-builtin.ts`（名称必须和对应站点面板文案一致，否则执行器点选不到）
- 站点：`DOUBAO_BUILTIN_CHANNEL_ID = "builtin-doubao"` / `DOLA_BUILTIN_CHANNEL_ID = "builtin-dola"`
- **两套账号体系不互通**：豆包模型只能配豆包账号，Dola 模型只能配 Dola 账号
- 生图：`image.ts` 命中内置模型 → `generateImageViaDoubao`（同一适配层跑两个站点）
- 视频：`video.ts` 命中 → `createVideoJob`（必须带 `expectedArtifactKind: "video"`）
- 账号：`config.doubaoAccountId` → 节点 metadata → `buildGenerationConfig`，为空时回退号池「当前账号」
- 并发上限：`DOUBAO_MAX_PARALLEL = 3`（超过会被桥接直接拒绝，不排队）

### 1.1 Dola 与豆包的差别（只有这些）

| 项 | 豆包 | Dola |
| --- | --- | --- |
| 站点 | `www.doubao.com/chat/` | `www.dola.com/chat/` |
| cookie 域 | `.doubao.com` | `.dola.com` |
| 图像模型 | Seedream 5.0 Pro / 5.0 Flash / 4.5 / 4.0 | Seedream 5.0 Pro / 4.5 |
| 视频模型 | Seedance 2.5 / 2.0 / 2.0 Fast / 2.0 Mini | **Dreamina** Seedance 2.0 Fast / 1.0（带前缀！） |
| 能力栏文案 | 图像生成 / 视频生成 / 对话 | 同中文文案（英文界面用 `DOLA_CAP_*` 覆盖） |
| 扫码 | passport 接口出码 | 站点自己的登录弹窗取码（`qr-helper-browser.mjs`） |

### 2. 一个账号只有一个浏览器窗口

```
bridge 确保该账号 viewer 窗口存在（open-account.mjs，带 --remote-debugging-port）
  → runner 用 CDP 连上去，在同一个窗口内 newPage()（新标签 = 新对话）
  → 任务结束不关窗口；失败会关掉自己开的标签页
```

- 端口：`9400 + hash(accountId) % 80`
- viewer 状态：`<state>/viewer/status.json`
- **不要**让 runner 自己 launchPersistentContext（会撞 profile 锁、开出第二个窗口）

### 3. 任务与回填

- 创建任务必须带 `expectedArtifactKind`（`image` / `video`），否则桥接 400
- 画布节点生成必须带 `nodeId`，结果按 nodeId 回填原卡片
- 右侧「属性 / 日志」：有 `metadata.jobId` 查它，没有就按 `nodeId` 反查 `GET /api/jobs?nodeId=`，每 4 秒刷新

### 4. 执行器（run-doubao.mjs）流程

```
确保 viewer 窗口 → CDP 连入 → 新标签页 → 导航（waitUntil: "commit"，3 次重试）
→ 切能力（失败自动：点「新对话」→ 重载 → 再试）
→ 选模型（点「模型」下拉 → 精确文本点选）
→ 开参数浮层 → 选比例 / 设时长 → 读回校验（不一致只警告，不中断）
→ 上传连线素材（隐式 input[type=file]；找不到入口时点「+ / 参考内容」）
→ 发提示词 → 自动确认 → 轮询产物（DOM + 接口抓取双通道）→ 下载 → 去重
```

## 四、改动自检清单

```bash
cd web && npx tsc --noEmit     # 类型
cd web && npx vite build       # 构建（静态服务读 dist）
node --check doubao-bridge/run-doubao.mjs
node --check doubao-bridge/server.mjs
curl -s http://127.0.0.1:9091/api/health
```

## 五、已知坑（踩过，别再踩）

1. **生成过程中刷新页面** → 节点被标记「页面刷新后生成已中断」，任务不会回填
2. **生成过程中关闭豆包窗口** → 任务失败（`Target page, context or browser has been closed`）
3. **豆包页面 `domcontentloaded` 可能永远不触发** → 导航一律用 `waitUntil: "commit"` + 固定等待
4. **模型名写错**（如「Seedream 5.0 Fast」）→ 执行器点不到，会保持豆包默认模型
5. **PowerShell 读写源码**会把中文/引号弄坏 → 改文件用编辑器/`edit` 工具，别用 `Get-Content | Set-Content`
6. **静态服务器必须是 `scripts/serve.mjs`**，临时服务器会让 `/canvas` 404
7. 画布数据存在浏览器 IndexedDB（`lihuo` 命名空间），换浏览器/清缓存会看不到旧画布

## 六、当前进度与待办

见 `CURRENT_STATUS.md`（进度）、`KNOWN_ISSUES.md`（已知问题）、`NEXT_TASKS.md`（下一步）。

## 七、公网后端

要部署到公网、对外提供多用户服务前，必须先读 `BACKEND_PLAN.md`：

- 现有 `server/` 的会话、计费、模型注册表、生成代理都已完成，**不要重写**
- 四个缺口：生成主链路仍由浏览器直连上游（持 Key）、用户数据只在 IndexedDB、项目/素材/媒体接口缺失、依赖本机 sidecar（9091 / 17371 / 23210）
- 账户侧同样只有登录：没有自助改密码、没有登录设备列表、额度只能管理员覆盖 `quota_cents` 且没有账户级额度流水（见方案第七章）
- P0 顺序：生成收口 → 前端删 Key → 项目云存储 → 媒体直传 → payload 去 base64 → 同域部署 → 成本护栏 → 老数据迁移 → 账户自助最小集
- **在 P0-2（前端删 Key）完成前，不要把服务开到公网**
