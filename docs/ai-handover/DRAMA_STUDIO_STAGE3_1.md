# 离火 AI 短剧工作室 · Stage 3.1 收尾修复与专项验收

> 日期：2026-11-23
> 范围：只处理 Stage 3 的队列可靠性、模型快照一致性和分镜并发覆盖风险；不进入 Stage 4 / 5，不生成图片 / 视频，不修改五步导航，不修改 Bridge、全局 `AiConfig`、无限画布核心，不提交、不推送。

## 1. 结论与边界

Stage 3.1 的核心代码、确定性测试、`typecheck` 和 `build` 已完成。真实浏览器回归覆盖了刷新恢复、人工核对、暂停 / 继续 / 停止、冻结模型真实请求、任务中心一致性、单场替换、锁定镜头、手工编辑与模型生成冲突保留。

需要明确的验收边界：

- 项目 A / B 的原始 live 浏览器数据已不在当前 BU profile。本轮项目 A 使用 `阶段2A验收·雾港夜航(4).json` 导出快照恢复，项目 B 使用隔离夹具，项目 C 使用项目 A 副本。**不能把本轮结果写成“原始 live 项目 A / B 已全量通过”**。
- 项目 A 快照中的 `ep-GHduqaBp` 剧本 `v1`（4 场 / 58.3s）、分镜 `v13`（4 组 / 8 镜）、`0 error / 7 warning / 1 suggestion / 待处理 8` 在测试后保持原样；第 3 集仍锁定。测试在 A 快照上新增了第 2 集 `script v1`，这是夹具内测试产物，不代表原始 live 项目 A 已生成第 2 集。
- 整集生成期间触发单镜 / 单场、单场期间同场单镜、两个不同场景同时提交，**没有执行真实并发生成**；当前只有确定性互斥测试覆盖。真实并发生成会消耗多次 Bridge 模型调用，本轮没有把它写成已通过。
- 旧 V2 项目、无限画布回归、高风险提案拒绝、`generated` 复活确认本轮未重跑。
- 本轮没有新增真实模型失败重试次数、超时、并发上限等行为边界；没有修改正式外部后端和 Bridge。

## 2. 修改文件

Stage 3.1 增量 Diff 相对 Stage 3 交付状态，共 **22 个文件，1,189 insertions / 259 deletions**。`DRAMA_STUDIO_STAGE3_1.diff` 不包含本报告和截图，避免把验收材料重复计入代码 Diff。

| 文件 | 变更 | 作用 |
| --- | --- | --- |
| `web/src/types/studio-production.ts` | +14 | 任务远端状态、人工核对决策、冻结模型与 trace 字段 |
| `web/src/types/studio.ts` | +1 / -1 | 任务中心状态增加 `unknown` |
| `web/src/lib/studio/production-workspace.ts` | +169 / -13 | 刷新收口、可继续 / 可重试 / 核对选择、人工决策 |
| `web/src/lib/studio/production-locks.ts` | +72（新增） | 同项目同分集整集 / 单场 / 单镜互斥锁与版本冲突判定 |
| `web/src/lib/studio/model-profile.ts` | +9 / -4 | `effectiveProjectConfig` 支持冻结模型覆盖 |
| `web/src/lib/studio/novel-model.ts` | +34 / -14 | 冻结模型运行时校验、项目账号隔离、不可用直接失败 |
| `web/src/lib/studio/production-ai.ts` | +4 / -2 | 生成调用透传冻结模型，trace 记录实际模型与 capability |
| `web/src/lib/studio/production-engine.ts` | +5 | 新建任务写入 `capability`、`modelFrozenAt`、初始 `remoteState` |
| `web/src/lib/studio/production-actions.ts` | +529 / -196 | 队列状态机、人工核对、冻结执行、分镜锁与冲突保留 |
| `web/src/pages/drama/studio/production/index.tsx` | +86 / -10 | 核对入口 / Modal、继续 / 重试 / 停止提示、待处理统计 |
| `web/src/pages/drama/studio/production/shared.tsx` | +3 / -3 | `interrupted / unknown / cancelling` 状态文案 |
| `web/src/pages/drama/studio/ui.tsx` | +1 | `unknown` 状态颜色与文案 |
| `web/src/pages/drama/studio.css` | +16 | 核对弹窗与 `is-unknown` 样式 |
| `web/src/stores/use-studio-tasks.ts` | +14 / -8 | 任务中心 `cancel` 支持 unknown，迟到成功不覆盖未知 |
| `web/scripts/stage3_1-core-check.ts` | +195（新增） | Stage 3.1 确定性测试 |
| `web/scripts/stage3-core-check.ts` | +5 / -2 | 刷新语义适配 |
| `CHANGELOG.md` | +3 | Stage 3.1 变更记录 |
| `docs/ai-handover/ARCHITECTURE.md` | +3 / -3 | 队列状态、冻结模型、分镜锁架构说明 |
| `docs/ai-handover/ENTRY_POINTS.md` | +4 / -1 | Stage 3.1 报告与新增文件入口 |
| `docs/ai-handover/KNOWN_ISSUES.md` | +8 | Stage 3.1 遗留边界 |
| `docs/content/docs/progress/pending-test.mdx` | +11 | 待用户复核项 |
| `docs/content/docs/progress/todo.mdx` | +3 / -2 | Stage 3.1 验收状态与后续边界 |

浏览器临时夹具 `web/public/stage3_1-project-a-fixture.json`、`web/public/stage3_1-fixtures.json` 已删除。截图保留在 `docs/ai-handover/` 供报告引用，不进入代码 Diff。

## 3. P1：任务中断与重复提交

### 3.1 状态模型

`StudioProductionJobRemoteState` 明确为 `not_submitted | submitted | unknown | completed | failed | cancelled`。`StudioProductionJob` 增加 `remoteState`、`needsReview`、`retryable`、`taskId`、`trace`、`modelFrozenAt`、`capability`。

刷新恢复不再把所有活动状态一律压成 `interrupted`：

| 刷新前状态 | 刷新后 | 远端状态 | 人工核对 | 可继续/重试 |
| --- | --- | --- | --- | --- |
| `pending / queued` | `interrupted` | `not_submitted` | 否 | 可继续（未提交） |
| `submitting / running / cancelling` | `interrupted` | `unknown` | 是 | 否 |
| `unknown` | `unknown` | `unknown` | 是 | 否 |
| `succeeded` | `succeeded` | `completed` | 否 | 否 |
| 旧版 `failed` 且无远端状态 | `failed` | `unknown` | 是 | 否 |
| `cancelled` | `cancelled` | `cancelled` | 否 | 否 |

`selectResumableJobs()` 只接纳 `pending / queued`，或 `interrupted` 且明确 `not_submitted` 且 `needsReview !== true`。`selectRetryableJobs()` 只接纳 `failed + retryable === true + needsReview !== true + remoteState` 为 `failed / not_submitted`。`interrupted / unknown` 永远不会自动进入 `queued`。

### 3.2 继续、重试、停止和人工核对

- `resumeProductionQueue()` 只恢复可继续任务；有运行中的 controller 时只解除 paused，不替换循环；返回 `requeued / held`，有 `held` 时 UI 自动打开核对弹窗。
- `retryProductionJobs()` 只重排明确可重试的失败任务；运行中拒绝重试，并返回待核对数量。
- `stopProductionQueue()` 不再把运行中任务伪装成已取消：运行中 / 提交中 / 取消中进入 `interrupted + unknown + needsReview`；排队 / pending 进入 `cancelled + not_submitted`。任务中心的当前任务同步为 `unknown`，文案「已停止等待；远端请求结果未知，请到项目队列核对」。
- `confirmProductionJobResult()` 只处理 `failed / interrupted / unknown / cancelling`。三条决策：
  - `adopt-existing` → `succeeded / completed`，视为结果已写入，不重发。
  - `retry` → `queued / not_submitted`，清空 taskId / trace，明确重新入队，并启动队列。
  - `mark-failed` → `failed / failed`，不重试。
- `processProductionQueue()` 在结果写回前再次确认 latest job 仍是当前 running/submitting；如果已被停止、核对或取消，迟到结果被跳过，不覆盖 unknown 核对状态。controller 只在仍是当前 controller 时删除，避免误删新循环。
- 任务中心 `cancel(id, { outcome: "unknown" })` 先 abort，再把任务状态保留为 `unknown`；`uncertain` 集合阻止迟到的 success 覆盖未知状态。`StudioStatus` 增加「结果未知」警告色。

### 3.3 浏览器验证

1. **刷新恢复**：项目 A 快照加入 3 个历史 Bridge 失败 job + 1 个 queued 冻结 job 后刷新，队列显示 5 个任务待处理；queued 被收口为 `interrupted / not_submitted`，没有自动提交；打开「核对 3」看到 3 个历史 job 均为 `remoteState unknown`、无 taskId、真实模型 `builtin-doubao::对话`，未点击任何决策。
2. **停止一致性**：项目 A 快照加入两个第 3 集 queued job，点继续后 0.4s 点停止。`stage3-job-stage31-stop3-1` 为 `interrupted / remoteState unknown / needsReview true`，taskId `task-jAG_wMIMQ0`；`stop3-2` 为 `cancelled / not_submitted`。任务中心第一条显示 **「结果未知」**，不再是「已取消」。这是 Stage 3.1 补充修复后的真实通过。
3. **unknown 点继续不重发**：unknown job 存在时点继续，队列无 queued，job 仍为 `interrupted / unknown / needsReview`，没有产生新 taskId。
4. **明确确认后重新入队**：核对 Modal 对 `stage3-job-stage31-stop3-1` 点「确认未提交 / 可重试，重新排队」，job 立刻变 running，Bridge busy；最终因 JSON 截断失败，taskId `task-7L-GbOixSk`，证明人工门禁生效，未自动重发。
5. **暂停 / 继续 / 停止**：加入第 3 集 B job + 第 1 集后继 job，继续后第 3 集运行中暂停，当前任务继续到失败，第 1 集仍 `queued`「已暂停，等待继续」；点继续后第 1 集实际启动并失败（错误「提示词没有出现在会话里…」），但 `ep1 script v1 / storyboard v13` 未被覆盖。

任务中心截图：

![任务中心结果未知](stage3_1-task-center-unknown.png)

核对弹窗截图：

![Stage 3.1 核对弹窗](stage3_1-review-modal.png)

## 4. P1：队列模型配置快照

### 4.1 入队冻结与执行

入队时 `createProductionJob()` 写入：

- `model.channelId / model.modelId / model.label`
- `modelParams`（包括温度、maxTokens、项目账号 `accountId`）
- `capability: "text"`
- `promptVersion`
- `modelFrozenAt`
- `remoteState: "not_submitted"`

执行时 `processProductionQueue()` 用 `executionModel(current)` 从 job 构造 `NovelTextModelRuntimeOverride`，传给 `runEpisodeScript` / `runStoryboardScene` / `runStoryboardShot` 和 `ProductionCallOptions.model`。`novelTextModelRuntime(project, override)` 只使用冻结 selection / params：

- 用 `selectableModelsByCapability(globalConfig, "text")` 校验冻结模型是否仍可用；不可用直接抛错「队列冻结的文本模型 … 已不可用；已阻止本次请求，不会静默切换到其他模型」。
- 内置豆包 / Dola 用冻结 `params.accountId` 走 `validateProjectBridgeAccount`，再 `applyProjectBridgeAccount`，保持项目账号隔离。
- override 时不读取当前项目 profile 作为模型或参数来源。
- `taskInput()` 用真实冻结模型构造任务中心记录，而不是 UI 当前选择。
- `trace()` 的 model / modelParams 来自实际 runtime，并记录 `capability: "text"`、`promptVersion`、输入输出字符、调用次数。

### 4.2 真实请求一致性

项目 A 快照中，项目当前模型切到 `builtin-dola::对话`（Dola1 `db-mwc3ti1b-2ic3g`），队列里保留一个冻结在 `builtin-doubao::对话` 的 queued 剧本 job：

- job：`stage3-job-stage31-freeze-a`
- 冻结模型：`builtin-doubao::对话`
- 冻结参数：`{temperature:0.4,maxTokens:4096,accountId:"db-mvxvft3x-a9tky"}`
- 真实请求：Bridge「豆包1」busy=true，而不是项目当前模型 Dola
- 结果：`succeeded / completed`，taskId `task-4zx_Nzvqbz`
- trace：`{model:"builtin-doubao::对话", modelParams:{temperature:0.4,maxTokens:4096,accountId:"db-mvxvft3x-a9tky"}, capability:"text", promptVersion:"stage3-script-v1", inputChars:3162, outputChars:3106, calls:1}`
- 产物：第 2 集 `script v1 / 4 场 / draft`
- 任务中心：第 2 集「已完成 / builtin-doubao::对话 / 草稿 v1；4 场；检查 0/0/0」

模型 B 真实请求：同一项目当前模型为 Dola 后入队第 3 集，job 为 `failed / remoteState failed / retryable true`，taskId `task-7L-GbOixSk`，错误「模型返回 JSON 截断或不完整；未写入半成品」。任务中心显示 `builtin-dola::对话`，没有静默回退豆包，也没有写半成品。

另一条 B 真实请求（taskId 未完整保留）失败为「提示词没有出现在会话里…」；该失败没有产生半成品，也没有自动切换模型。

结论：队列任务的实际请求模型 / 参数、trace、任务中心三者一致；项目当前模型切换不会污染已入队任务。**直接点「生成本集 / 单场 / 单镜」仍按当前项目模型，本轮没有把冻结扩展到所有直接调用。**

## 5. P1：分镜并发写入保护

### 5.1 互斥锁与版本校验

新增 `production-locks.ts`：

- `acquireStoryboardWriteLock()` 以 `projectId + episodeId` 为键；同一分集已有整集、单场或单镜锁时，后续入口都被拒绝，并给出当前锁的 operation / targetId。
- 同一分集不同场景不能并发提交；不同 episode 互不影响。
- `setStoryboardLocked()` / `setShotLocked()` 和 `saveStoryboardShotEdit()` / `updateStoryboardShotManual()` 都会 bump `storyboardVersion`，让生成任务的基础版本失效。
- 整集 / 单场 / 单镜入口都在模型调用前捕获基础 `storyboardVersion` 和 `scriptVersion`，commit 前检查：
  - `latest.storyboard.storyboardVersion !== baseVersion`
  - `latest.storyboard.status === "locked"`
  - 目标场景存在锁定镜头
  - `latest.script.scriptVersion !== baseScriptVersion` 或剧本已锁定
- 冲突时**不写当前文档**。本次模型结果先在基础分镜上归一化，再 `replaceSceneInStoryboard(baseStoryboard, reason: "并发冲突保留")` 生成历史快照，写入 `storyboardVersions`，追加 `storyboard_write_conflict` warning check，返回错误并保留版本 id。
- 单镜入口只替换目标镜头；单场入口只替换目标场景组与镜头；整集入口重排全片镜号但保留锁定镜头。局部重生成不会改其他场景。

### 5.2 浏览器验证与真实冲突

1. **锁定镜头 + 单场**：隔离项目 C `proj-stage31-concurrency`（项目 A 副本）锁定 `shot-1yqjpid` 后，点第 1 场「重生成整场」被拦截，提示「场景已有 1 个锁定镜头；需要先确认解锁或显式覆盖，不能静默重生成」，Bridge 未 busy；第 2 场生成成功，storyboard `v14 → v15`，仍 4 组 / 8 镜，锁定镜头仍是 `shot-1yqjpid / 中近景 / 极慢向前推镜`。
2. **锁定单镜**：点锁定镜头单镜重生成，提示「该镜头已锁定，不能重生成；先解锁」，Bridge 未 busy。
3. **手工编辑与模型生成冲突**：C 项目从 v15 起触发第 2 场单镜生成（shot #3），同时人工编辑同场 shot #4 并保存。当前 storyboard 升到 `v18`，shot4 action 变为 `三人同时顿住，侧耳捕捉门外动静（并发人工编辑）`；模型返回后生成冲突快照 `storyboardVersions[0]`：
   - `version 18`
   - `reason "并发冲突保留：单镜重生成 / 基础 v17 → 当前 v18"`
   - 模型版 shot3 action：`老周指尖缓慢、克制地抚过日志封皮磨损处，指腹微微顿住`
   - 当前草稿 shot3 action：`老周指尖缓慢抚过日志封皮磨损处（并发人工编辑）`
   - `production.checks` 出现 `warning / 分镜连续性 / 分镜已被其他操作更新（基础 v17 → 当前 v18）；本次模型结果不会覆盖当前草稿`

冲突检查截图：

![分镜并发冲突保留](stage3_1-storyboard-conflict.png)

### 5.3 已知限制

- `production-locks.ts` 的锁只在当前页面进程内有效；跨标签页 / 跨刷新仍依靠 `storyboardVersion` 在 commit 前兜底。两个标签页可以同时发起生成，后提交者会冲突保留，不会静默覆盖，但没有真正的跨标签页互斥。
- 冲突快照可能和当前草稿同版本号（本轮均为 `v18`）。当前靠 `reason` 与 `storyboard_write_conflict` 检查项区分；版本号分配逻辑未改，这是明确遗留项。
- 真实并发生成（整集 + 单镜、单场 + 同场单镜、两个场景同时提交）没有跑；只有确定性互斥测试覆盖。

## 6. 确定性测试与构建

### 6.1 Stage 3.1 核心检查

命令：

```text
cd C:\Users\qq308\Desktop\lihuo\web
npx --yes tsx scripts/stage3_1-core-check.ts
```

退出 0，输出：

```json
{"ok":true,"tests":"stage3_1-core-check","hydration":{"queued":"interrupted/not_submitted","submitting":"interrupted/unknown","unknown":"unknown","succeeded":"completed","legacyFailed":"failed/unknown"},"selection":{"resumable":1,"retryable":1,"review":6},"lock":{"episodeBlocksScene":true,"episodeBlocksShot":true,"sceneBlocksScene":true,"sceneBlocksShot":true,"differentEpisodePasses":true},"frozenModel":{"old":"对话","next":"gpt-5.5"},"storyboard":{"version":6,"lockedShotKept":true,"shots":2}}
```

覆盖：

- 提交前刷新：`queued → interrupted/not_submitted`，可人工继续。
- 提交中刷新：`submitting → interrupted/unknown`，不可自动重发。
- 模型已返回但尚未写入项目时刷新：`running + submitted → interrupted/unknown`，必须核对。
- unknown 点击继续：不会进入 `selectResumableJobs` 结果。
- interrupted/unknown 点击重试：不会进入 `selectRetryableJobs` 结果。
- 明确确认后重新入队：`retry` 清空旧 taskId / trace，状态回 `queued`。
- 已成功任务不会被再次执行：`succeeded` 不进入可继续集合。
- `selectResumableJobs` / `selectRetryableJobs` / `selectReviewJobs`。
- 三种人工核对决策。
- 分集级锁拦截单场 / 单镜，场景级锁拦截同场单镜，不同分集可通过。
- 冻结模型 A/B，参数与模型互不污染。
- 场景替换保留锁定镜头与镜号连续。

### 6.2 Stage 3 回归检查

```text
npx --yes tsx scripts/stage3-core-check.ts
```

退出 0，输出：

```json
{"ok":true,"tests":"stage3-core-check","fixture":{"projectId":"proj-UORILWcK","snapshotId":"handoff-14rfeou","openChecks":8},"admission":{"episode1Formal":true,"episode2Formal":false},"script":{"scenes":2,"characters":3,"props":2,"durationSeconds":39.4},"storyboard":{"groups":1,"shots":2},"checks":{"scriptError":0,"storyboardError":0},"persistence":{"status":["interrupted","unknown"],"remoteState":["unknown","unknown"],"activeJobId":null}}
```

### 6.3 类型检查与构建

```text
npm run typecheck
```

退出 0，无 TypeScript 错误。

```text
npm run build
```

退出 0：`8296 modules transformed`、`✓ built in 46.09s`。仍有既有动态 / 静态导入警告和 >500kB chunk 警告，本轮未处理。

### 6.4 Diff 校验

`DRAMA_STUDIO_STAGE3_1.diff`：

- 22 个文件头，1,189 insertions / 259 deletions。
- SHA256 `FCA7524BFB78CF7BE27EF9E4C3C1F40F6ECE2837173E03739F50912C6A535D1A`。
- 在重建的 Stage 3 基线工作树上 `git apply --check` exit 0，实际 `git apply` exit 0。
- 应用后的 22 个文件与当前工作区忽略行尾差异后逐文件文本一致。
- 在当前工作区 `git apply --check --reverse` exit 0。

## 7. 真实浏览器与真实模型结果汇总

### 7.1 已真实执行

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| A 快照刷新恢复 | queued 转 `interrupted/not_submitted`，3 个 legacy failed 保持 unknown，不自动重发 | 队列待处理 5；核对弹窗 3 条 |
| A 快照停止 | 运行中 `interrupted/unknown`，排队 `cancelled/not_submitted`；任务中心「结果未知」 | taskId `task-jAG_wMIMQ0` |
| A 冻结模型真实请求 | 项目当前 Dola，队列仍用豆包；任务成功；任务中心 / trace 一致 | `task-4zx_Nzvqbz`，3,162→3,106 字符，1 次调用 |
| Dola 模型真实请求 | JSON 截断失败，不回退豆包、不写半成品 | `task-7L-GbOixSk`，任务中心 `builtin-dola::对话` |
| 暂停 / 继续 | 当前任务完成后剩余任务保持 queued；继续后从正确任务恢复 | 第 3 集失败后第 1 集启动 |
| 单场独立生成 | 第 2 场成功，分镜 `v14 → v15`，锁定镜头保留 | C 项目 |
| 锁定镜头保护 | 整场和单镜入口都被拦截，Bridge 未 busy | 提示包含锁定原因 |
| 手工编辑与模型冲突 | 当前草稿保留人工版，模型版进入历史快照和 warning 检查 | C 项目 v18，冲突快照 v18 |
| 任务中心模型一致性 | A 第 2 集 `builtin-doubao::对话`，第 3 集 `builtin-dola::对话` | 任务中心与 job trace/model 对齐 |

### 7.2 项目 A 数据保护检查

测试后从浏览器读取：

```json
{"handoff":{"id":"handoff-14rfeou","checkCount":8,"error":0,"warning":7,"suggestion":1,"locked":[3]},"ep1":{"script":{"v":1,"scenes":4,"status":"draft"},"storyboard":{"v":13,"groups":4,"shots":8},"checks":0},"ep2":{"script":{"v":1,"scenes":4}}}
```

`reviewJobs` 保留：

```json
[["stage3-job-12myyxb","failed","unknown"],["stage3-job-bq0wj","failed","unknown"],["stage3-job-7e90eg","failed","unknown"],["stage3-job-stage31-stop3-1","interrupted","unknown"]]
```

项目 A 的 8 条 2B 待处理没有被任何测试点击接受 / 忽略 / 标记已解决；第 1 集正式剧本和 v13 分镜未被测试覆盖。项目 A 快照中第 2 集新增 `script v1` 是测试产物。

### 7.3 项目 B 隔离

项目 B `proj-iNU-UIPW` 使用隔离夹具，第三步显示「2B handoff 不完整 / 缺少全剧蓝图或分集规划」，不能生成，未看到项目 A 的剧本 / 分镜。该项目数据不是原始 live 项目 B。

## 8. 尚未验证事项

1. 原始 live 项目 A / B 的完整浏览器回归；本轮是导出快照 + 隔离夹具。
2. 整集生成期间触发单镜 / 单场；单场生成期间同场单镜；两个不同场景同时提交。真实并发会消耗多次模型调用，本轮没有执行。
3. 跨标签页 / 跨刷新并发；当前靠 commit 前版本校验，只有单页面互斥锁。
4. 冻结模型「已不可用」分支的真实浏览器触发；当前只有确定性校验覆盖。
5. 核对弹窗的 `adopt-existing` / `mark-failed` 真实点击；本轮真实点击的是 `retry`，另两条由确定性测试覆盖。
6. 真实高风险提案拒绝和 `generated` 复活确认；沿用 Stage 2B 已交付逻辑，本轮未改未重跑。
7. 旧 V2 项目 / 无限画布浏览器回归。
8. `runEpisodeScript` 对已有正式剧本的覆盖策略：当前只有剧本锁定才阻断；全剧排队 UI 会包含已有剧本集，Stage 4 前需要产品策略。
9. 冲突快照与当前草稿同版本号的风险；未改版本号分配。
10. 直接「生成本集 / 单场 / 单镜」仍使用当前项目模型，未扩展到所有直接调用。

## 9. 停止状态

本轮完成后停止，等待用户检查：

- 未开发 Stage 4 / Stage 5。
- 未生成正式图片或视频。
- 未修改五步导航。
- 未修改 Bridge、全局 `AiConfig`、无限画布核心、正式外部后端。
- 未执行 `git reset / checkout / stash / clean`，未自动提交或推送。
- 项目 A 的 8 条待处理仍由用户决定，助手没有代点。
