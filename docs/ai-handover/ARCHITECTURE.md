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
| 短剧项目 / 集 / 资产 / 镜头 / 版本 | localforage（IndexedDB）`storageKey("studio_store")` |
| 短剧全局任务 | localforage（IndexedDB）`storageKey("studio_tasks")` |
| 旧短剧序列（只读迁移源） | localforage（IndexedDB）`storageKey("drama_store")` |
| 全局配置 | Zustand persist + localStorage |
| 豆包任务 | 内存 Map（Bridge 重启丢失） |
| 生成结果 | 浏览器本地文件系统 / 项目内 assets |

## 七、短剧工坊 V2（Studio）

`/drama` 已从旧「十步向导 + 单序列」切换为「项目库 + 六大生产工作区」：

```
项目库 → 剧本中心 → 资产中心 → 导演中心 → 画面中心 → 视频中心 → 声音中心
   └────────────── 同一份 useStudioStore（项目 / 集 / 镜头 / 资产 / 版本）
   └────────────── 同一套 useStudioTasks（图片 / 视频 / 声音 / 文本任务）
   └────────────── Studio ⇄ Workflow（现有画布 lihuo:drama / lihuo:drama-shot）
```

- 旧 `use-drama-store.ts`、`use-drama-tasks.ts`、`types/drama.ts`、`pages/drama/steps/*`、`drama.css` 保留；迁移只读旧 key，不修改旧数据。
- 图片、视频、音频仍复用现有 `services/api/*`、`file-storage`、`use-config-store`，没有第二套模型/账号系统。
- 详细文件地图、数据字段、影响检测、导出边界与验证结果见 [`STUDIO_V2.md`](./STUDIO_V2.md)。

## 八、短剧工作室 Stage 1（五步正式导航）

阶段 1 起，`/drama` 的正式生产导航固定为五步，项目库与 Workflow 画布不计入步骤：

```
项目库
  └─ 01 AI 小说分析（analysis）
  └─ 02 角色与场景资产（assets）
  └─ 03 分集剧本与分镜（script，内部页签 script / storyboard）
  └─ 04 分镜审核与调整（review）
  └─ 05 视频生成（video，内部页签 video / sound）
Workflow 画布（高级编辑入口，不是第六步）
```

- 唯一项目根仍是 `StudioProject`，阶段 1 只做扩展，不另建 `DramaProject`。
- 项目级模型方案存在 `StudioProject.modelProfiles`，键为 `capability::channelId::modelId`；不保存 API Key，不写全局 `AiConfig`。
- 旧 `/drama?workspace=script|director|assets|picture|video|sound|projects` 由 `lib/studio/navigation.ts` 映射到 `step + view`。
- 持久化键仍为 `storageKey("studio_store")`；旧 `storageKey("drama_store")` 只读迁移。`persist.merge` 统一补五步字段，旧项目有内容时默认从 `script` 继续。
- 第三/第五步继续复用旧 V2 剧本、导演、画面、视频、声音工作区；声音只在第五步内部，不新增第六步。
- 正式云端业务后端是仓库外的 `lihuo后端`；仓库 `server/` 保留旧实现，阶段 1 未修改两套后端。
- 完整交付、数据结构、模型隔离、旧项目兼容与验收记录见 [`DRAMA_STUDIO_STAGE1.md`](./DRAMA_STUDIO_STAGE1.md)。

## 九、短剧工作室 Stage 2A（原著结构化分析）

阶段 2A 只完成第一步「AI 小说分析」，不进入分集改编、资产、分镜或视频。

```text
TXT / DOCX / PDF / 粘贴
  → novel-import（编码、魔数、20 MB、扫描 PDF / 损坏文件校验）
  → novel-chapters（章节识别、PDF 页范围、8,000 字分块）
  → novel-analysis-runner（持久化分析任务）
      → novel-model（项目文本模型 + 项目级 Bridge 账号）
      → novel-analysis（分块 JSON 提取、证据逐字校验）
      → novel-merge（跨块合并、因果引用、跨章校验、完整度）
  → NovelAnalysis（AI 结果）+ NovelAnalysisOverrides（人工修正）
```

- 数据根仍是 `StudioProject`，`novel` / `novelAnalysis` / `novelAnalysisOverrides` / `analysisRuns` / `analysisRunId` 都是增量字段；旧项目由 `normalizeStudioProject()` 补空值。
- 证据只保存 `chapterId + 原文短摘录 + 定位 + 类型 + 置信度`，不复制整章；`explicit / inferred / generated` 分开统计，完整度按实际有证据覆盖的章节计算。
- 人工修正存在独立的 `novelAnalysisOverrides`，重新分析只替换 AI 结果，不删除人工覆盖；展示和导出前通过 `applyNovelAnalysisOverrides()` 合并。
- 分析任务是浏览器侧九态任务：`pending / queued / submitting / running / succeeded / failed / cancelling / cancelled / interrupted`；刷新时把未完成任务标成 `interrupted`，保留成功分块，允许手动继续 / 重试，不自动重复提交。
- 地点 `firstChapterId` 由顶层证据、`variants.evidence` 与同地点最早事件共同校正；这样既保留证据追溯，也不会因模型漏写地点证据而把首章回退到分块首章。
- 详细边界、文件清单、真实模型验收与已知问题见 [`DRAMA_STUDIO_STAGE2A.md`](./DRAMA_STUDIO_STAGE2A.md)。

## 十、短剧工作室 Stage 2B（短剧化改编与全剧规划）

阶段 2B 在阶段 2A 的原著档案上做短剧总编剧规划，只到「完整分集规划」，不生成正式剧本、分镜、图片或视频。

```text
StudioProject（唯一项目根）
  └─ adaptation?: StudioAdaptationWorkspace
       ├─ settings：改编定位（集数 / 时长 / 题材 / 受众 / 平台 / 强度 / 结局 / 要求）
       ├─ strategy：改编方案 + changes[]（可追踪改编账本）
       ├─ blueprint：全剧故事蓝图
       ├─ episodePlans[]：独立 StudioEpisodePlan（不是阶段 3 的 StudioEpisode）
       ├─ characterArcs[]：人物弧光 + 逐集状态时间线
       ├─ foreshadowings[]：全剧伏笔池
       ├─ changes[] / checks[]：改编记录 + error / warning / suggestion
       ├─ proposals[] / history[] / generations[]：提案、快照、生成审计
       └─ versionNumber / activeGenerationId
```

- 入口在第一步「AI 小说分析」内部切换，不新增第六步；五步导航仍是 01–05。
- 生成链：`novelTextModelRuntime(project)` + `requestNovelText()`，只使用项目级文本模型和项目级 Bridge 账号，不读写全局 `AiConfig`。
- 改编引擎按 `strategy / blueprint / episodeBatch / synthesis / episode_regenerate / episodeModule` 分阶段调用；不把整本小说无差别重复发送。
- 全剧蓝图只让模型生成核心编剧字段，人物 / 关系 / 地点 / 时间线由 `completeSeriesBlueprintFromAnalysis()` 从 2A 真实档案确定性补齐，避免 Bridge 在 `"characters":` 处稳定截断。
- 所有生成先形成 `StudioAdaptationProposal`；用户接受后才写入当前有效版本。锁定方案 / 蓝图 / 集数不被覆盖；局部重生成检查相邻集承接。
- 刷新恢复把 `queued / running` 改为 `interrupted`，清空 `activeGenerationId`，不自动重发。
- 阶段 3 通过 `adaptationHandoff()` 读取当前有效分集、蓝图、人物弧光、伏笔、改编记录、证据引用和锁定状态；提案草稿不进交接。
- 详细数据契约、校验码、真实验收与风险见 [`DRAMA_STUDIO_STAGE2B.md`](./DRAMA_STUDIO_STAGE2B.md)，开工前置检查见 [`DRAMA_STUDIO_STAGE2B_PREFLIGHT.md`](./DRAMA_STUDIO_STAGE2B_PREFLIGHT.md)。

### 阶段 3 的扩展位置

阶段 3 不新建项目根，也不把 `StudioEpisodePlan` 直接当剧本：

```text
StudioProject（唯一项目根）
  ├─ production?: StudioProductionWorkspace
  │    ├─ handoff：只存 Stage 2B 版本 / 计数快照
  │    ├─ jobs[]：剧本 / 分镜生成任务、暂停 / 继续 / 停止、trace
  │    └─ skips[]：全剧剧本队列的跳过记录（集号、原因、详情、时间）
  └─ episodes[]: StudioEpisode（既有正式分集）
       └─ production?: StudioEpisodeProduction
            ├─ script?: StudioScriptDocument（4 场 / 对白 / 时长 / 来源）
            ├─ scriptVersions[]（人工编辑 / 覆盖 / 恢复快照，含 snapshotId、contentHash）
            ├─ storyboard?: StudioStoryboardDocument（镜头组 + 单镜）
            ├─ storyboardVersions[]（formal / conflict / backup，snapshotId 与正式版本号分离）
            └─ checks[]（deterministic / model，error / warning / suggestion）
```

`adaptationHandoff()` 每次从当前 2B 工作区读取有效蓝图、分集、人物弧光、伏笔、改编账本、证据和 checks；Stage 3 只记录 `handoff-14rfeou` 这类版本快照，不复制 2B 全量数据。分镜必须从正式 `StudioScriptScene` 派生，`shot.sourceScriptSceneId` 与 `characterBindings / sceneBindings / propBindings` 均指向既有 2A/2B 稳定 ID。

剧本链路：`scriptPrompt / scriptSceneRegeneratePrompt` → `novelTextModelRuntime(project, override?)` → `requestNovelText` → `parseProductionJson` → `normalizeScriptDocument` → `validateScriptDocument` → `saveScriptVersionIfNeeded` → `StudioEpisodeProduction.script` → `syncLegacyEpisode` 投影。

分镜链路：`storyboardScenePrompt` → 单场 JSON → `normalizeStoryboardScene`（稳定 shotId、镜头组、单镜实际入镜人物 / 道具子集）→ `replaceSceneInStoryboard`（校验锁定、整集重排镜号）→ `validateStoryboardDocument` → `saveStoryboardVersionIfNeeded` → `StudioEpisodeProduction.storyboard`。Stage 3.1 在整集 / 单场 / 单镜入口先用 `production-locks.ts` 按 `projectId + episodeId` 加互斥锁，并在 commit 前校验 storyboard 版本、分镜 / 镜头锁定和 script 版本；冲突时把模型结果写入历史快照并追加 `storyboard_write_conflict`。

任务队列按集 / 场景串行 `processProductionQueue()`；长结构化输出不整集一次返回，而是每场一次。Stage 3.1 起 `StudioProductionJob` 区分 `not_submitted / submitted / unknown / completed / failed / cancelled` 与 `needsReview / retryable`：刷新时仅排队任务可恢复为可继续，运行中 / 取消中进入人工核对，`unknown` 不自动重发；继续 / 重试只选 `selectResumableJobs / selectRetryableJobs`。队列任务冻结 `model / modelParams / capability / promptVersion`，执行时通过 `executionModel()` 构造 `NovelTextModelRuntimeOverride` 交给 `novelTextModelRuntime`，冻结模型不可用直接失败，不静默切换。模型固定使用项目级文本模型和项目豆包账号，不读取全局 `AiConfig`，不在项目数据保存 API Key。

Stage 3.2 起剧本写入先过 `production-protection.ts`：全剧队列固定 `skip_existing`，已有正式 / 人工编辑 / 锁定剧本只进入 `skips[]`，不创建 job；显式覆盖先 `guardEpisodeScriptWrite()`，锁定永远拒绝，确认后 `persistScriptBackup()` 写入并回读当前正式剧本快照，失败立即阻止模型调用。局部整场 / 对白重生成只合并目标场或 `dialogueBlocks`，其他场景、绑定与人工标记保持不变。剧本内容或场景顺序变化时，`markStoryboardStaleForScriptChange()` 只标记受影响场景及镜头为 `stale`，不删除旧分镜、不自动重生成。

分镜快照身份由 `storyboard-snapshots.ts` 管理：`snapshotId` 是快照唯一键，`storyboardVersion` 只表示正式工作区版本；`formal / conflict / backup` 分别标记正式、冲突和自动备份，`basedOnVersion` 记录生成依据；冲突与备份不递增正式版本号，冲突文档回落为基础版本，不冒充正式内容。应用 / 恢复快照必须先校验 `expectedVersion` 与锁定镜头，备份当前版本后以 `current + 1` 生成新的正式版本，并记录 `restoredFromSnapshotId`；旧快照读取时只补稳定身份字段，刷新不会重新生成 ID。

---

**信息验证状态：**
- ✅ 调用链路：源码已验证
- ✅ 文件路径：源码已验证
- ⚠️ 部分细节：详见 KNOWN_ISSUES.md
