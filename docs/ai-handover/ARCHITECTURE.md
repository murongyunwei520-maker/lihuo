# 离火 Lihuo 系统架构

> 本文档描述各子系统的调用关系和数据流。
> 信息来源：源码审查。

## 一、整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    前端（React + Canvas）                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────────┐  │
│  │ 画布节点 │  │ 视频节点 │  │ 图片节点 │  │ 设置面板  │  │
│  └────┬────┘  └────┬────┘  └────┬────┘  └─────┬─────┘  │
│       └────────────┴────────────┴──────────────┘        │
│                          ↓                              │
│              services/api/ (API 调用层)                  │
└───────────────────────────┬─────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ↓                           ↓
    ┌─────────────────┐         ┌─────────────────┐
    │  OpenAI/Gemini  │         │  豆包 Bridge    │
    │  直连 API       │         │  http://:9091   │
    └─────────────────┘         └────────┬────────┘
                                        ↓
                              ┌─────────────────┐
                              │  Runner 子进程   │
                              │  run-doubao.mjs  │
                              └────────┬────────┘
                                        ↓
                              ┌─────────────────┐
                              │  Playwright +    │
                              │  Edge CDP       │
                              │  → 豆包网页      │
                              └─────────────────┘
```

## 二、前端分层（已验证）

### 1. 页面层 `web/src/pages/`
- `canvas/` - 画布主页面
- `image/` - 生图工作台
- `video/` - 视频创作台
- `director/` - 3D 导演台
- `doubao/` - 豆包账号管理

### 2. 组件层 `web/src/components/`
- `canvas/` - 画布核心组件
  - `nodes/builtin-nodes.tsx` - 内置节点注册
  - `nodes/lihuo/` - 自研节点（便签、提示词工坊、导演台）
  - `canvas-video-settings-popover.tsx` - 视频设置弹窗
- `video-settings-panel.tsx` - 视频参数面板
- `DynamicParamsPanel.tsx` - 动态参数面板（开发中）

### 3. 状态层 `web/src/stores/`
- `use-config-store.ts` - 全局配置（Channel/Model 定义）
- `use-doubao-account-store.ts` - 豆包账号池
- `model-schema.ts` - 模型 Schema 类型（开发中）
- `canvas/` - 画布状态管理

### 4. 服务层 `web/src/services/api/`
- `doubao-bridge.ts` - 豆包 Bridge 调用
- `doubao-bridge-adapter.ts` - 豆包适配器
- `image.ts` - 图片生成
- `video.ts` - 视频生成

## 三、豆包生成链路（核心）

### 调用流程（已验证）

```
用户点击生成按钮
  ↓
视频节点 / 视频工作台
  ↓
判断：是豆包内置 channel 吗？
  ├─ 是 → doubao-bridge-adapter.ts
  │       ↓
  │     createVideoJob() → POST http://127.0.0.1:9091/api/jobs
  │       ↓
  │     doubao-bridge/server.mjs
  │       ↓
  │     runJob() → spawn 子进程 run-doubao.mjs
  │       ↓
  │     run-doubao.mjs → Playwright 连接 Edge CDP
  │       ↓
  │     打开豆包网页 → 输入提示词 → 点击生成
  │       ↓
  │     等待视频生成完成 → 提取视频 URL → 下载校验
  │       ↓
  │     stdout 输出最终 JSON
  │       ↓
  │     server.mjs 接收 → 更新 job.status
  │       ↓
  │     前端轮询 waitJob() → 拿到结果 → 回填节点
  │
  └─ 否 → 走 OpenAI 兼容 API → /v1/videos/generations → 轮询
```

### 关键文件（已验证）

| 层 | 文件 | 作用 |
|----|------|------|
| 前端入口 | `web/src/components/canvas/nodes/builtin-nodes.tsx` 的视频卡片 | 通用视频节点；原来的豆包专属节点文件已删除 |
| 参数面板 | `web/src/components/video-settings-panel.tsx` | 按当前模型 Schema 渲染比例/时长 |
| 适配器 | `web/src/services/api/doubao-bridge-adapter.ts` | 豆包参数组装 |
| API 类型 | `web/src/services/api/doubao-bridge.ts` | Bridge 接口类型定义 |
| Bridge 服务 | `doubao-bridge/server.mjs` | 任务队列、账号锁、子进程管理 |
| Runner | `doubao-bridge/run-doubao.mjs` | 浏览器自动化执行 |
| 下载校验 | `vendor/doubao-brain/dbb/src/site.mjs` | 文件大小、magic number、MIME 校验 |

## 四、账号调度与锁机制

### 账号状态（已验证）
- `busy`：正在执行任务
- `logged_in`：已登录
- `quota`：额度状态（全部为 unknown，无真实查询接口）

### 调度模式
- `manual`：用户手动选账号（默认，推荐）
- `auto`：自动分配（暂不可用，额度全部 unknown）

### 账号锁
- 同账号任务串行执行
- MAX_JOBS_PER_ACCOUNT = 1
- 锁在任务结束时释放（成功/失败/超时/取消）

## 五、模型 Schema 系统

### 当前状态
- 类型定义：`web/src/stores/model-schema.ts` ✅
- 动态面板组件：`web/src/components/DynamicParamsPanel.tsx` ✅
- 接入实际面板：✅ `video-settings-panel.tsx` 按当前模型 Schema 渲染比例选项与时长范围，Schema 里没有专门控件的参数交给 `DynamicParamsPanel`
- 提交链路：✅ `video.ts` 豆包分支通过 `readVideoRequestParams(config)` 取 ratio/duration
- 图片侧接入：❌ 未做

### 渲染与提交约定
1. `ParameterSchema.configKey` 把参数绑定到全局 `AiConfig` 字段（如 `size` / `videoSeconds` / `videoGenerateAudio`），参数值只有这一份，不另存缓存。
2. 面板读值用 `readSchemaConfigValues(config, schema)`，写值用 `schemaParamPatch(field, value)` 转成配置补丁。
3. 提交前用 `readVideoRequestParams(config)` 统一收敛（时长按 Schema 的 min/max 夹取，`auto` 比例输出「自动」）。
4. 新增模型参数时只改 Schema，不要在面板里加硬编码分支。

### 参数存储（已复核修正）

参数只有一份权威来源：全局 `AiConfig`（`web/src/stores/use-config-store.ts`）。

| 层 | 字段 | 说明 |
|----|------|------|
| 全局配置 | `size` / `vquality` / `videoSeconds` / `videoMode` / `videoGenerateAudio` / `videoWatermark` | 视频参数真实存放处，随 config 一起持久化 |
| 节点覆盖 | `metadata.size` / `metadata.seconds` / `metadata.vquality` / `metadata.videoMode` | `lib/canvas/canvas-generation-helpers.ts` 的 `buildGenerationConfig()` 用节点值优先覆盖全局值 |
| 请求层 | `requestedParams.ratio` / `requestedParams.duration` | 只在 `services/api/video.ts` → `doubao-bridge-adapter.ts` → Bridge 出现，是出口命名，不是存储字段 |

补充说明：

- `metadata.paramsCache[modelId]` 这套按模型缓存的字段随 `doubao-video-node.tsx` 一起删除，主链路从未使用；现在参数通过 `configKey` 直接读写全局配置。
- 豆包 Bridge 目前只消费 `requestedParams.ratio` 和 `requestedParams.duration`（`server.mjs`），其余参数即使传了也不会生效。

## 六、数据持久化

| 数据 | 存储位置 |
|------|----------|
| 画布项目 | localforage（IndexedDB） |
| 全局配置 | Zustand persist + localStorage |
| 豆包任务 | 内存 Map（Bridge 重启丢失） |
| 生成结果 | 浏览器本地文件系统 / 项目内 assets |

---

**信息验证状态：**
- ✅ 调用链路：源码已验证
- ✅ 文件路径：源码已验证
- ⚠️ 部分细节：详见 KNOWN_ISSUES.md
