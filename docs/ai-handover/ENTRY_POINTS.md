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
| 豆包内置模型清单 | `web/src/constants/doubao-builtin.ts` |
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

### 1. 豆包没有专属节点

豆包已并入**普通「图片 / 视频」节点**的统一模型下拉：

```
节点里选模型 → 选 builtin-doubao::<模型名> → 走 service 层路由到 bridge
```

- 模型清单：`web/src/constants/doubao-builtin.ts`（名称必须和豆包面板文案一致，否则执行器点选不到）
- 生图：`image.ts` 命中 `isDoubaoBuiltinModel` → `generateImageViaDoubao`
- 视频：`video.ts` 命中 → `createVideoJob`（带 `expectedArtifactKind: "video"`）
- 账号：`config.doubaoAccountId` → 节点 metadata → `buildGenerationConfig`，为空时回退号池「当前账号」

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
