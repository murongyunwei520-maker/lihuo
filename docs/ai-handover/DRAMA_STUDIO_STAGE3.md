# 离火 AI 短剧工作室 · 阶段 3 交付报告

> 阶段：Stage 3「分集剧本与分镜」
> 产品：Lihuo AI 短剧工作室
> 验收项目：项目 A `proj-UORILWcK` / `阶段2A验收·雾港夜航`；隔离项目 B `proj-iNU-UIPW` / `阶段2A隔离验收·粘贴样本`
> 停止边界：本阶段只完成第三步，不进入 Stage 4 审核、不进入 Stage 5 视频生成，不生成真实图片 / 视频，不新增第六步。

## 一、结论

Stage 3 已用现有 `StudioProject` / `StudioEpisode` 承载分集剧本与结构化分镜，并真实消费 Stage 2B 的 `adaptationHandoff()`。第一步的 2B 分集规划仍然是 `StudioEpisodePlan`，Stage 3 没有把规划直接改造成剧本，也没有创建第二套项目根对象。

已实现：

- Stage 2B handoff 按集消费：蓝图版本、分集版本、人物弧光、伏笔、改编账本、证据、锁定集、未处理 checks、审核状态。
- 分集剧本按集生成、局部场景重生成、版本、锁定、刷新恢复；项目 A 第 1 集真实生成 `script v1`。
- 分镜按「场景 → 镜头组 → 单镜头」分层生成；镜头组共享空间 / 轴线 / 人物初始位置 / 道具状态。
- 稳定 `characterId` / `locationId` / `propId` / `sceneId` / `shotGroupId` / `shotId`；人物造型与场景变体不另造新 ID。
- 剧本 / 分镜 / 单镜锁定、版本快照、恢复、局部重生成与失败不写半成品。
- 项目级文本模型与项目豆包账号隔离；不回退全局号池，不修改全局 `AiConfig`，不在项目数据保存 API Key。
- 项目 A 的 `0 error / 7 warning / 1 suggestion / 待处理 8` 只读保留，没有因为 Stage 3 生成转场而自动标记已解决。

已真实跑通：

- 项目 A 第 1 集剧本：4 场，`58.3s / 目标 60s`，`script v1`，检查 `0/0/0`。
- 项目 A 第 1 集分镜：`storyboard v13`，4 个镜头组 / 8 个镜头，总时长 `58.3s`，检查 `0/0/0`，镜号连续 `#1–#8`。
- 单镜重生成：镜 1 真实调用成功，`v12` 作为“单镜头重生成前快照”保留，新镜头仍绑定 `沈鸢 / 林舟`、`铜钥匙`、`scene-lpdm4f`。
- 单镜锁定保护：锁镜后重生成提示“该镜头已锁定，不能重生成；先解锁”，未发起任务。
- 刷新持久化、项目 B 隔离和五步导航回归。

尚未真实验证：

- 真实多集剧本排队 / 暂停 / 继续 / 停止。
- 指定场景独立生成、镜头组级真实重生成。
- 真实高风险提案拒绝 / `generated` 复活确认按钮点击。
- 旧 V2 项目与无限画布浏览器回归。
- 长剧（20 集以上 / 120 集上限）压测与镜头丰富度。

### 1.1 验证状态矩阵

| 能力 | 已实现 | 确定性测试 | 真实浏览器 | 真实模型调用 |
| --- | --- | --- | --- | --- |
| Stage 3 数据结构 / `StudioEpisode` 承载 | 是 | 是 | 是（项目 A 3 集） | 不适用 |
| `adaptationHandoff()` 按集消费与准入 | 是 | 是 | 是（项目 A / B） | 不适用 |
| 2B 8 条待处理只读保留 | 是 | 是 | 是（生成后仍 8 条） | 不适用 |
| 第 1 集整集剧本 | 是 | 是（合成样例，非真实产物） | 是（`script v1`） | 是（项目 A，4 场 / 58.3s） |
| 剧本局部场景重生成 | 是 | 是 | 否 | 否 |
| 剧本锁定 / 历史版本 / 刷新恢复 | 是 | 是 | 是 | 不适用 |
| 整集分镜（场景 → 组 → 镜头） | 是 | 是（合成样例，非真实产物） | 是（`v12` / `v13`） | 是（项目 A，4 组 / 8 镜） |
| 单镜重生成 / 单镜锁定 | 是 | 是 | 是 | 是（镜 1，`v12` → `v13`） |
| 场景独立重生成 / 组级重生成 | 是 | 是 | 否 | 否 |
| 多集串行队列 / 暂停 / 继续 / 停止 | 是 | 是（状态收口） | 否 | 否 |
| 剧本 / 分镜确定性连续性检查 | 是 | 是 | 是（项目 A 0/0/0） | 规则不调用模型 |
| 高风险 / `generated` 复活核心层阻断 | 是 | 是 | 否（未代点） | 不适用 |
| 项目 B 隔离 / 五步导航 | 是 | 否 | 是 | 不适用 |
| 旧 V2 项目 / 无限画布回归 | 保留代码 | 否 | 否 | 不适用 |

确定性测试的剧本 / 分镜输入是测试脚本内构造的合成样例，不是项目 A 浏览器里实际生成的 `script v1` 或 `storyboard v13`；真实产物只通过浏览器、导出快照和真实模型任务验证。

## 二、当前架构与保护边界

### 2.1 既有对象

- `StudioProject`：唯一项目根，继续使用 `storageKey("studio_store")` + localForage。
- `StudioEpisodePlan`：Stage 2B 的全剧分集规划，不是 Stage 3 剧本。
- `StudioEpisode`：既有正式分集对象，Stage 3 在其 `production` 字段下承载剧本和分镜。
- `adaptationHandoff()`：Stage 2B 的交接读取入口，Stage 3 每次真实生成前重新调用，不缓存为第二套全剧规划。

### 2.2 Stage 3 扩展

```text
StudioProject
  ├─ production?: StudioProductionWorkspace
  │    ├─ handoff?: StudioProductionHandoffSnapshot
  │    ├─ jobs[]: StudioProductionJob
  │    └─ activeJobId?
  └─ episodes[]: StudioEpisode
       └─ production?: StudioEpisodeProduction
            ├─ script?: StudioScriptDocument
            ├─ scriptVersions[]: StudioScriptVersion
            ├─ storyboard?: StudioStoryboardDocument
            ├─ storyboardVersions[]: StudioStoryboardVersion
            └─ checks[]: StudioProductionCheck
```

项目 A 原本 `episodes = 0`、`assets = 0`，但 2B 已有 `episodePlans = 3`、蓝图和审核数据。Stage 3 通过 UI 显式按钮「按 2B 规划建立 3 个分集」调用 `ensureStage3Episodes()` 补建正式 `StudioEpisode` 壳，而不是让 Stage 3 自己另外保存一份全剧规划。补建后：

- `ep-GHduqaBp` 第 1 集《雾钟授钥》60s
- `ep-tNU6q0U_` 第 2 集《钟醒归航》60s
- `ep-AFT0ST-h` 第 3 集《夜航归港》60s

这是一个迁移型前提：如果清空或重建项目 A 数据，需要重新建立 `StudioEpisode` 壳；不要假设 2B 规划会自动变成正式分集。

## 三、handoff 实际消费路径

### 3.1 来源

`web/src/lib/studio/production-actions.ts` 的 `currentHandoff(project)`：

```ts
adaptationHandoff(
  project.adaptation,
  project.id,
  project.novelAnalysis?.version ?? 0
)
```

`adaptationHandoff()` 已扩展返回：

- `blueprintId` / `blueprintVersion` / `blueprint`
- `packageVersion`
- `episodePlans[]`
- `characterArcs[]`
- `foreshadowings[]`
- `changes[]`
- `checks[]`
- `settings`
- `blueprintReviewStatus` / `strategyReviewStatus`
- `lockedEpisodeNumbers` / `lockedBlueprint`
- `snapshotId`
- `createdAt`

`snapshotId` 由项目 ID、分析版本、蓝图 ID / 版本、分集版本 / 审核状态 / 锁定状态、check id / level / status 计算稳定哈希。`createdAt` 每次调用会变，但持久化 handoff 快照以 `snapshotId` 作为版本证据。

### 3.2 存储快照

`productionHandoffSnapshot(handoff)` 只存版本与计数，不复制 2B 的整套数据：

- `projectId`
- `analysisVersion`
- `blueprintId` / `blueprintVersion`
- `packageVersion`
- `handoffSnapshotId`
- `episodePlanCount`
- `lockedEpisodeNumbers`
- `checkCount` / `errorCount` / `warningCount` / `suggestionCount`
- `createdAt`

项目 A 当前快照：`handoff-14rfeou`、蓝图 `v1`、分集版本 `v4`、分析 `v3`、8 条待处理。

### 3.3 按集准入

`productionAdmission(handoff, episodeNumber)` 按集计算：

- `draftAllowed`：有对应分集规划时允许生成明确标记的草稿预览；即使有未确认高风险或 `generated` 复活，也不能静默把它当作已审核正式稿。
- `formalAllowed`：分集规划 / 蓝图 / 改编方案均已批准或锁定，且无 error、无未确认高风险改编、无未确认 `generated` 复活时，才允许进入正式后续生产。
- `blocking[]`：2B error、未确认 `generated` 复活。
- `review[]`：待审核规划 / 蓝图 / 方案、未确认高风险改编、2B warning。
- `info[]`：2B suggestion。
- `pendingHighRiskChanges[]`、`unresolvedErrors[]`、`handoffWarnings[]`、`handoffSuggestions[]`。

第 1 集项目 A：`formalAllowed = true`；第 2 集因分集规划 `pending_review` 只能草稿；第 3 集分集规划锁定，但 Stage 3 剧本仍按独立锁定状态管理，不会因为 2B 锁定集而自动覆盖。

### 3.4 未处理事项不会被自动清理

`handoffIssuesForEpisode()` / `handoffIssuesForProject()` 只投影 `status === "open"` 的 2B checks。Stage 3 只读展示，不调用 `accept` / `ignore` / `resolve`，不写回 `project.adaptation.checks`。

项目 A 真实浏览器与导出核对仍为：

- `error 0`
- `warning 7`（全部 `location_change_without_move`）
- `suggestion 1`（`chg-005` 未映射分集）
- `待处理 8`

Stage 3 的剧本场景可以写 `transitionIn / transitionOut / continuityNotes` 提出转场方案，但它不会把 2B warning 状态改为 resolved，也不把模型补写的转场伪装成原著事实。

## 四、数据结构设计

### 4.1 剧本

`StudioScriptDocument`：

- `id` / `episodeId` / `episodeNumber`
- `title` / `logline` / `synopsis`
- `durationTarget` / `durationEstimate`
- `sourceEpisodePlanId` / `sourceBlueprintVersion` / `sourceHandoffId`
- `scriptVersion` / `status`
- `scenes[]`：`StudioScriptScene`
- `characterBindings[]` / `locationBindings[]` / `propBindings[]`
- `sourceReferences` / `continuityDependencies` / `adaptationChanges`
- `createdAt` / `updatedAt`

`StudioScriptScene` 包含 `sceneId`、`sceneNumber`、`sceneTitle`、`locationId`、`locationVariantId`、`timeOfDay`、`environment`、`charactersPresent`、`props`、`scenePurpose`、`conflict`、`action`、`dialogueBlocks`、`transitionIn`、`transitionOut`、`continuityNotes`。

对白块 `StudioScriptDialogueBlock` 含 `dialogueId`、`characterId`、`speaker`、`text`、`delivery`、`emotion`、`subtext`、`linkedAction`、`timing`、可选 `sourceReference`。

人物 / 地点 / 道具绑定：

- `StudioScriptCharacterBinding`：`characterId`、`name`、`role`、`costume`、`look`、`sceneIds`。
- `StudioScriptLocationBinding`：`locationId`、`name`、`variantId`、`timeOfDay`、`weather`、`description`、`sceneIds`。
- `StudioScriptPropBinding`：`propId`、`name`、`holderCharacterId`、`locationId`、`state`、`important`、`sceneIds`。

### 4.2 分镜

`StudioStoryboardDocument` 含 `sourceScriptId` / `sourceScriptVersion` / `sourceEpisodePlanId` / `sourceBlueprintVersion` / `sourceHandoffId`、`storyboardVersion`、`status`、`groups[]`、`shots[]`、`checks[]`。

`StudioShotGroup`：

- `shotGroupId` / `episodeId` / `sceneId` / `groupNumber` / `sceneTitle`
- `sharedLayout`
- `characterStartPositions[]`（`characterId` / `name` / `position` / `orientation` / `eyeline`）
- `cameraAxis`
- `propStates`
- `timeOfDay` / `lighting` / `weather`
- `continuityRules[]`
- `shotIds[]`
- `reviewedByUser`
- `createdAt` / `updatedAt`

`StudioProductionShot` 包含：

- `shotId` / `episodeId` / `sceneId` / `shotGroupId` / `shotNumber` / `duration`
- `shotSize` / `cameraPosition` / `cameraAngle` / `lens` / `cameraMovement`
- `composition` / `foreground` / `midground` / `background`
- `characterBlocking` / `eyeline` / `action` / `facialExpression` / `emotion`
- `dialogue[]` / `voiceOver` / `soundEffects` / `backgroundMusic`
- `lighting` / `environment` / `continuityRules[]`
- `characterBindings[]` / `outfitBindings[]` / `sceneBindings` / `propBindings[]`
- `sourceReferences` / `sourceScriptSceneId`
- `imagePrompt` / `videoPrompt` / `keyframeRefs[]`
- `status` / `version` / `locked` / `createdAt` / `updatedAt`

`keyframeRefs` 在本阶段只作为引用位，不生成关键帧；`imagePrompt` / `videoPrompt` 只保存文本。

### 4.3 检查

`StudioProductionCheck` 区分：

- `source: "deterministic" | "model"`
- `level: "error" | "warning" | "suggestion"`
- `status: "open" | "accepted" | "ignored" | "resolved"`
- `episodeNumber` / `sceneId` / `shotGroupId` / `shotId` / `characterId` / `propId`

本阶段实际生成 checks 以确定性结构 / 引用 / 时长 / 绑定规则为主，没有把模型主观审美判断写成确定性 error。

## 五、剧本生成链路

入口：

- `runEpisodeScript(projectId, episodeId)`：整集或指定场景局部重生成。
- `processProductionQueue(projectId)`：串行处理队列中的剧本 / 分镜任务。

链路：

```text
StudioEpisode
  → currentHandoff(project)
  → planFor(episode.no)
  → productionAdmission(handoff, episode.no)
  → projectContext（只取当前集必要上下文）
  → scriptPrompt / scriptSceneRegeneratePrompt
  → novelTextModelRuntime(project)
  → requestNovelText
  → parseProductionJson
  → normalizeScriptDocument / normalizeSingleScriptScene
  → validateScriptDocument
  → saveScriptVersionIfNeeded
  → StudioEpisodeProduction.script
  → syncLegacyEpisode（旧 StudioEpisode.script/scenes 投影）
```

剧本提示词按集输出 `title / logline / synopsis / scenes[]`；场景内部要求有进入、人物行动、信息揭示、矛盾升级、情绪变化、冲突结果、退出或转场，不对每场强制套同一模板。对白由模型只给说话人名字，归一化时映射到项目稳定 `characterId`。

局部重生成：

- 指定 `sceneId` 时只生成当前场，`normalizeSingleScriptScene` 保留原 `sceneId` / `sceneNumber` 后 `mergeSceneIntoScript`。
- 旧版本先进入 `scriptVersions`，不覆盖锁定剧本。
- 模型失败、空场景、JSON 截断时抛错，不写 `script`。

时长：

- `estimateScriptDuration(scenes, targetSeconds)` 分别估算对白、动作、转场、停顿、环境镜头。
- 对白按 `去空白字符数 / 4.2` 估算，不把中文字符数直接当视频秒数。
- `durationEstimate.deltaSeconds` 保留与目标偏差；`validateScriptDocument()` 在 `>1.15x` / `<0.8x` 产生 warning，`>1.35x` / `<0.55x` 产生 error。
- 用户确认压缩前不自动删除核心剧情；Stage 3 只在检查和建议中提示。

## 六、分镜生成链路

入口：

- `runEpisodeStoryboard(projectId, episodeId)`：按 4 场串行调用，全部成功后才一次性写入整集分镜。
- `runStoryboardScene(projectId, episodeId, sceneId)`：单场独立生成。
- `runStoryboardShot(projectId, episodeId, shotId)`：单镜重生成。
- `processProductionQueue`：队列按集 / 场景串行。

链路：

```text
正式 StudioScriptDocument
  → 当前场 scene
  → storyboardScenePrompt（只发送当前场景与必要连续性上下文）
  → generateStoryboardSceneDraft
  → normalizeStoryboardScene
       ├─ 稳定 shotGroupId / shotId
       ├─ 镜头组共享布局 / 初始站位 / 轴线 / 道具状态
       ├─ 单镜实际入镜人物 / 道具子集
       └─ 时长按场景预算等比校准
  → replaceSceneInStoryboard
       ├─ 检查锁定镜头 / 锁定组
       └─ renumberStoryboardShots：全片镜号 1..N
  → validateStoryboardDocument
  → saveStoryboardVersionIfNeeded
  → StudioEpisodeProduction.storyboard
  → syncLegacyEpisode（旧 StudioShot 兼容投影）
```

单场提示词版本当前为 `stage3-storyboard-v6`，策略是每场 1 个镜头组、正好 2 个镜头（最多 3 个），单镜 `action / characterBlocking / facialExpression` 各不超过 50 个汉字，其余字段一句。目标是把单次 Bridge 结构化输出压到可稳定解析的规模。项目 A 的整集分镜因此得到 4 组 / 8 镜 / 58.3s，镜号 `#1–#8`。

单镜重生成：

- `storyboardShotPrompt` 保留当前镜头组空间与轴线，只重写当前镜头。
- `normalizeShotReplacement` 保留原 `shotId`、`sceneId`、`shotGroupId`、`shotNumber`，新 `version` 加 1。
- `replaceShotInStoryboard` 不重排整集，只替换目标镜头；旧版先入 `storyboardVersions`。
- 单镜锁定后 `canReplaceShot()` 直接阻断；不会因为重生成单镜改变同组其他镜头的站位和道具状态。

场景替换时：

- 同场景旧镜头被移除，其他场景镜头保留，包括锁定镜头。
- 所有镜头按场景顺序全局重排 `shotNumber` 1..N，消除项目 A v8 遗留的 5/6/7 非连续镜号。
- 镜头 `characterBindings` / `propBindings` 由本镜 `charactersPresent` / `props` 子集生成；显式空数组表示“无人物 / 无道具”，字段缺失才回退整场全集，兼容旧模型输出。

## 七、模型调用与成本

- 入口：`web/src/lib/studio/production-ai.ts`。
- 运行时：`novelTextModelRuntime(project)`，使用项目级 `settings.textModel` / `modelProfiles` 和项目级豆包账号。
- 请求：`requestNovelText(runtime, messages, { signal, temperature, maxTokens })`。
- 模型参数从 `dramaModelParams(project.modelProfiles, "text", selection)` 读取，由 `runtime.params` 传入。
- 任务中心记录：模型显示 `builtin-doubao::对话` / UI `对话（豆包）`，任务类型 `text`，参数含 `operation=stage3`、`promptVersion`，支持取消、日志和重试入口。
- 项目 A 的真实任务标注「本地任务 · 未计费」，不代表云端计费成功。
- 不在项目数据保存 API Key；项目模型身份与参数仅保存选择，密钥仍在现有会话 / 桥接账号边界。

上下文分层：

1. 全剧核心约束：蓝图、改编定位、策略。
2. 当前集分集规划。
3. 当前集相关人物状态 / 弧光。
4. 当前集场景 / 道具。
5. 当前集伏笔 / 因果依赖。
6. 当前场 / 镜头组局部上下文。

每次不重发整本原著、全部分集剧本或所有历史分镜。当前实现是“只传当前集 + 当前场景必要约束”，不是完整 RAG 检索；长剧上下文预算仍待压测。

调用记录边界：

- `StudioProductionModelTrace` 数据结构含 `model`、`modelParams`、`promptVersion`、`inputVersion`、`inputChars`、`outputChars`、`calls`、`startedAt`、`finishedAt`。
- 队列任务 `StudioProductionJob` 定义了 `model`、`modelParams`、`promptVersion`、`sourceHandoffId`、`sourceBlueprintVersion`、`sourcePlanVersions`、`inputChars`、`outputChars`、`calls`、`status`、`error`、时间字段；当前队列只写入模型、参数、prompt 版本、来源、状态、错误和时间，`inputChars / outputChars / calls` 尚未从生成函数回填。
- **已知缺口**：直接点「重新生成本集 / 单场 / 单镜」的调用使用全局任务中心与 Stage 3 操作状态记录，`StudioProductionModelTrace` 只在生成函数内构造，没有统一写入项目 `production.jobs`；因此项目级直接动作的 input/output 字符和 capability 字段没有完整落盘。队列任务有模型 / 参数 / prompt / 状态的结构化记录，但字符统计同样未完整回填。此项在“尚未验证 / 已知问题”中保留，不能写成所有模型调用都已持久化。

## 八、版本与持久化

- 存储：`web/src/stores/use-studio-store.ts`，沿用 `storageKey("studio_store")` + localForage。
- `StudioEpisodeProduction.scriptVersions` / `storyboardVersions` 各保留最近 20 个快照。
- `saveScriptVersionIfNeeded()` / `saveStoryboardVersionIfNeeded()` 在覆盖或局部重生成前保存旧文档。
- 剧本 / 分镜 / 单镜各自有 `locked`；锁定后生成被阻断，解锁后才能修改。
- `restoreScriptVersion()` / `restoreStoryboardVersion()` 恢复旧文档，并保持当前来源与版本链。
- 刷新时 `normalizeProductionForHydration()`：
  - `running / queued / submitting / cancelling` 收口为 `interrupted`；
  - `activeJobId` 清空；
  - `unknown` 保持不可自动重发；
  - 读取旧 `StudioStoryboardDocument` 时补齐 `sourceEpisodePlanId / sourceBlueprintVersion / sourceHandoffId`（若旧数据缺失，则从对应 script 的来源字段回填）。

项目 A 第 1 集来源链：

- 剧本：`sourceEpisodePlanId = ep-001`、`sourceBlueprintVersion = 1`、`sourceHandoffId = handoff-14rfeou`、`scriptVersion = 1`。
- 分镜：`sourceScriptId = script-smx4mw`、`sourceScriptVersion = 1`、`sourceEpisodePlanId = ep-001`、`sourceBlueprintVersion = 1`、`sourceHandoffId = handoff-14rfeou`、`storyboardVersion = 13`。
- 历史快照：`v4整集分镜生成前快照`、`v8整集分镜生成前快照`、`v12单镜头重生成前快照`，共 3 个。

## 九、连续性校验机制

### 9.1 剧本层实际规则

- 无场景 / 重复 `sceneId`。
- 场景缺少稳定 `locationId`。
- 场景无人物（提示确认是否纯环境镜头）。
- 场景缺戏剧目的。
- 对白缺 `characterId`、说话人不在 `charactersPresent`、空白对白。
- 场景切换无 `transitionIn`（suggestion）。
- 人物绑定不在项目资产。
- 整集估算时长偏差（warning / error）。
- 道具 / 人物 / 地点引用通过 `assetIndex` 反向检查。

**边界**：人物生死、知情状态、关系变化、伏笔回收、关键事件先后顺序、动机和因果目前主要依赖 Stage 2B 已生成的人物弧光 / 伏笔 / checks 与剧本文本，不存在一套独立的 Stage 3 剧情因果求解器；不能把“结构检查 0 error”写成“剧情完全正确”。

### 9.2 分镜层实际规则

- 无镜头。
- 整集镜头总时长相对剧本估算偏差（`>1.35x/<0.55x` error，`>1.15x/<0.8x` warning）。
- 镜头组引用不存在的场景 / 镜头 / 缺 `cameraAxis` / 缺共享布局。
- 镜头无有效镜头组、未登记在 `shotIds`、引用不存在场景。
- 景别 / 机位 / 运镜不完整。
- 有出场人物但无 `characterBlocking`。
- 动作涉及场景道具但无 `propBindings`。
- 对白缺 `characterId`，或说话人不在 `characterBindings`。
- 同组相邻镜头没有声明 `continuityRules`（suggestion）。
- 重复 `shotId`。

**边界**：`cameraAxis` 是非空文本规则，当前代码不能从自然语言几何上证明“绝不越轴”；人物左右站位、视线方向、接触点等需要 Stage 4 人工审核或后续几何化检查。`0/0/0` 只表示当前确定性规则没有发现明确冲突，不等于空间关系已被证明。

## 十、界面

第三步内部只有两个 Tab，不新增导航步骤：

- **分集剧本**：分集 rail、当前集标题 / logline / synopsis、场景列表、场景编辑 Drawer、剧本版本、锁定、局部重生成、2B 只读事项。
- **分镜设计**：分集 rail、当前集统计、镜头列表 / 场景分组 / 单镜头详情三种查看方式、镜头卡片、单镜编辑、锁定、单镜重生成、整集按场队列、版本历史。
- 顶部显示：2B 审核进度、已出剧本 / 分镜、任务失败数、项目文本模型、模型默认参数、项目账号隔离、handoff 来源、蓝图 / 分集版本、8 条待处理、锁定集。
- 旧 V2 项目没有 `StudioEpisode.production` 时保留原 `StudioScriptWorkspace` / `StudioDirectorWorkspace`，Stage 3 只在有正式分集的项目上出现。

浏览器验收使用 Browser Use target `dd186bb8-eb5b-4f60-a6d1-36a3b97bf988`，页面：

`http://localhost:3000/drama?project=proj-UORILWcK&step=script&view=storyboard&episode=ep-GHduqaBp`

viewport `802×690`。验收截图：

- `docs/ai-handover/stage3-final-storyboard-v13.png`
- `docs/ai-handover/stage3-final-storyboard-shots-v13.png`
- `docs/ai-handover/stage3-final-shot-detail-v13.png`
- `docs/ai-handover/stage3-final-script-v1.png`
- `docs/ai-handover/stage3-final-script-scenes-v1.png`
- `docs/ai-handover/stage3-project-b-isolation.png`

## 十一、测试命令与实际输出

### 11.1 确定性测试

命令：

```powershell
Set-Location 'C:\Users\qq308\Desktop\lihuo\web'
npx --yes tsx scripts/stage3-core-check.ts
```

最近一次实际输出：

```json
{"ok":true,"tests":"stage3-core-check","fixture":{"projectId":"proj-UORILWcK","snapshotId":"handoff-14rfeou","openChecks":8},"admission":{"episode1Formal":true,"episode2Formal":false},"script":{"scenes":2,"characters":3,"props":2,"durationSeconds":39.4},"storyboard":{"groups":1,"shots":2},"checks":{"scriptError":0,"storyboardError":0},"persistence":{"interrupted":["interrupted","interrupted"],"activeJobId":null}}
```

覆盖：

- 项目 A 真实 2B 夹具读取 3 集、`handoff-14rfeou`、锁定第 3 集、8 条 open checks。
- 第 1 集正式准入 true；第 2 集因 pending review 只能草稿。
- 未确认高风险改编 / `generated` 复活阻断正式准入。
- 剧本稳定 `sceneId` / `characterId` / `propId`；同地点昼夜变体不分裂 locationId。
- 剧本结构 / 时长检查。
- 分镜镜头组、稳定 shotId、单镜实际入镜人物 / 道具子集、时长校准、总时长超限。
- 锁定镜头 / 锁定场景保护，场景替换保留其他场景锁定镜头。
- 局部替换后镜号全片连续。
- JSON 截断 / 缺字段 / 空场景。
- 刷新后运行中 / `unknown` 任务收口为 `interrupted`，`activeJobId` 为空，不自动重发。

### 11.2 类型检查

命令：

```powershell
Set-Location 'C:\Users\qq308\Desktop\lihuo\web'
npm run typecheck
```

实际输出：`tsc --noEmit` 退出码 0，无错误。

### 11.3 生产构建

命令：

```powershell
Set-Location 'C:\Users\qq308\Desktop\lihuo\web'
npm run build
```

实际输出：`vite v7.3.6`，`8295 modules transformed`，`✓ built in 37.63s`，退出码 0。存在既有的动态导入 / 大 chunk 警告，不是 Stage 3 错误。

## 十二、浏览器验收记录

### 12.1 项目 A

- 五步导航显示 01–05 + Workflow，未出现第六步。
- 顶部 `2B 审核 4/5`、`已出剧本 1/3`、`已出分镜 1/3`、`任务失败 3`；3 个失败任务是 Bridge 未启动时遗留的剧本任务，不是 Stage 3 当前生成失败。
- `来源 handoff handoff-14rfeou / 蓝图 v1 · 分集版本 v4 · 分析 v3`。
- `error 0 / warning 7 / suggestion 1 / 待处理 8 / 锁定集 3`。
- 项目文本模型 `对话（豆包）`，项目账号隔离；任务中心标注「本地任务 · 未计费」。
- 第 1 集剧本 `script v1`：4 场、`58.3s / 目标 60s -1.7s`、检查 `0/0/0`，场景 01/02 可见对白、潜台词、转场。
- 第 1 集分镜 `v13`：4 组 / 8 镜 / 58s；镜头列表 `#1–#8`，每组 2 镜；详情显示人物 `沈鸢、林舟`、道具 `铜钥匙`、场景 `scene-lpdm4f`。
- 整集分镜真实任务：`2026/11/23 15:45:54` 完成 `v12`，按 4 场生成，检查 `0/0/0`；此前 `v2/v3/v5` 尝试出现 JSON 截断失败，均未写入半成品。
- 单镜真实任务：`2026/11/23 16:05:05` 完成镜 1 重生成，`v12` 快照保留，`v13` 写入；新镜 `中近景 / 极慢向前推镜 / 8s`，人物和道具绑定不变。
- 镜头锁定：UI 显示「该镜头已锁定，不能重生成；先解锁」，任务中心无新增任务；解锁后恢复。
- 剧本锁定：点击「锁定剧本」后重新生成本集没有新增任务；解锁后恢复。
- 刷新后仍保留第 1 集、剧本、`v13`、3 个历史快照、检查 0/0/0、8 条 2B 待处理。

### 12.2 项目 B

页面 `project=proj-iNU-UIPW&step=script` 显示：

- 「Stage 2B handoff 不完整」
- 「缺少全剧蓝图或分集规划。Stage 3 不会绕过 2B 自行规划，也不会生成正式剧本。」
- 没有项目 A 的剧本 / 分镜数据，不能生成。
- 项目 B 仍是 3 章 / 87 字 / 草稿未分析。

## 十三、修改文件清单

Stage 3 代码 / 测试相对 `stage3-baseline` 的实际变更：

修改：

- `web/src/lib/studio/adaptation-workspace.ts`
- `web/src/lib/studio/factory.ts`
- `web/src/pages/drama/index.tsx`
- `web/src/pages/drama/studio.css`
- `web/src/stores/use-studio-store.ts`
- `web/src/types/studio-adaptation.ts`
- `web/src/types/studio.ts`

新增：

- `web/src/lib/studio/production-actions.ts`
- `web/src/lib/studio/production-ai.ts`
- `web/src/lib/studio/production-engine.ts`
- `web/src/lib/studio/production-prompts.ts`
- `web/src/lib/studio/production-schema.ts`
- `web/src/lib/studio/production-workspace.ts`
- `web/src/types/studio-production.ts`
- `web/src/pages/drama/studio/production/index.tsx`
- `web/src/pages/drama/studio/production/script-tab.tsx`
- `web/src/pages/drama/studio/production/shared.tsx`
- `web/src/pages/drama/studio/production/storyboard-tab.tsx`
- `web/scripts/stage3-core-check.ts`
- `web/scripts/fixtures/stage3-project-a-2b.json`

文档同步：

- `docs/ai-handover/DRAMA_STUDIO_STAGE3.md`（本文件）
- `docs/ai-handover/DRAMA_STUDIO_STAGE3.diff`
- `docs/ai-handover/ARCHITECTURE.md`
- `docs/ai-handover/ENTRY_POINTS.md`
- `docs/ai-handover/KNOWN_ISSUES.md`
- `CHANGELOG.md`
- `docs/content/docs/progress/todo.mdx`
- `docs/content/docs/progress/pending-test.mdx`

### 13.1 Diff 文件

`docs/ai-handover/DRAMA_STUDIO_STAGE3.diff`：

- 480,508 bytes。
- 26 个 `diff --git` 文件头：7 个代码修改文件、13 个代码 / 测试新增文件、6 个文档修改文件。
- 统计：`8459 insertions(+), 13 deletions(-)`。
- 生成方式：用 `stage3-baseline` 作为基线，仅复制上述 26 个路径到临时 Git 仓库，提交基线后覆盖当前文件并 `git diff --cached --src-prefix=a/ --dst-prefix=b/`。
- 未包含截图二进制、本报告自身、Diff 自身，也未包含 Stage 1 / 2A / 2B 的既有未提交改动。
- 已用 `git apply --check --reverse` 在临时仓库当前树验证通过（退出码 0），说明 Diff 与当前文件逐字一致、可逆应用。

## 十四、既有 Diff 保护情况

- 未执行 `git reset` / `git checkout` / `git stash` / `git clean`。
- 未自动提交、未推送。
- 未修改 Bridge、`server/` 业务路由、全局 `AiConfig`、无限画布核心、全局豆包 / Dola 账号行为。
- 未删除或覆盖用户既有未提交修改。
- 只对 Stage 3 需要的文件做增加 / 最小修改；代码编译通过。
- 修改前使用 `stage3-baseline` 对比，Stage 3 的 `web/src` + `web/scripts` 变更限定为 7 个修改文件 + 13 个新增文件。
- 项目 A 的 8 条 2B 待处理没有发生状态变化；`applyProposalToWorkspace` / 接受 / 忽略入口没有被 Stage 3 调用。

## 十五、已知问题与尚未验证

1. **真实多集队列未验证**：UI 和 `processProductionQueue()` 支持串行队列、暂停、继续、停止、失败重试，但项目 A 当前只有第 1 集有正式剧本，没有真实跑过 2–3 集排队模型调用。
2. **逐场独立生成 / 镜头组真实重生成未验证**：代码路径存在，确定性测试覆盖场景替换与锁定；真实模型只验证了整集按场串行、单镜重生成。
3. **高风险真实按钮未点击**：确定性测试覆盖未确认高风险 / `generated` 复活阻断正式准入；遵守用户要求，没有在项目 A 代点拒绝或确认。
4. **旧 V2 项目和无限画布未做本轮浏览器回归**：旧 V2 fallback 代码保留；五步导航已验，画布未在本轮打开操作。
5. **长剧 / 长输出未压测**：整集分镜当前每场 2 镜（最多 3）是为了稳定解析的可靠性取舍；8 镜 / 58s 是可用草稿，不等于最终镜头丰富度。20 集以上、120 集上限、长原著上下文仍待验证。
6. **模型 trace 未统一落盘**：直接动作的 `StudioProductionModelTrace` 没有写入 `production.jobs`；队列任务有结构化记录，直接动作依赖全局任务中心。input/output 字符、capability 的完整项目级审计仍需补齐。
7. **模型切换未真实核对**：页面显示项目文本模型，真实任务也使用 `builtin-doubao::对话`；但没有做“切换另一个模型后实际请求也使用新模型”的浏览器调用验证。
8. **几何连续性未求解**：轴线、站位、视线、道具瞬移只能做字段 / 引用 / 声明层面的确定性检查，不能证明真实画面空间关系。
9. **UI 顶部未登录提示**：页面顶部显示「未登录：模型与生成由云端提供，登录后可用」，但项目级本地 Bridge 生成仍可用；这是既有全局登录 / 云端状态提示，不是 Stage 3 新增功能。未确认是否需要在登录态下隐藏。
10. **BU 页面可见性**：浏览器验收 target 的 `document.visibilityState = hidden`，`.studio-workspace-page` 的 200ms 入场动画停在 `opacity: 0`，截图为验证 UI 临时置 `animation: none / opacity: 1`；未改产品代码，真实前台用户不受该截图环境限制。
11. **项目 A 的 3 个失败旧任务**：Bridge 初始未启动时留下的 `stage3-job-12myyxb`（ep1）、`stage3-job-bq0wj`（ep2）、`stage3-job-7e90eg`（ep3）仍在任务中心；它们不是 Stage 3 当前生成产物，没有自动重发。
12. **2B snapshot `createdAt`**：`adaptationHandoff()` 每次重新调用会更新 `createdAt`，但 `snapshotId` 基于内容哈希；版本判断应以 `snapshotId` 为准，不应比较 `createdAt`。

## 十六、停止条件

阶段 3 只完成第三步「分集剧本与分镜」，到此停止：

- 不进入 Stage 4 九宫格 / 镜头列表 / 单镜头审核。
- 不进入 Stage 5 图片转视频 / 文生视频 / 参考图视频 / 音频生成 / 声音资产。
- 不生成角色图、场景图、分镜图、关键帧或视频。
- 不新增第六步，不修改无限画布核心。
- 不提交、不推送。

等待用户检查 `DRAMA_STUDIO_STAGE3.md` 和 `DRAMA_STUDIO_STAGE3.diff`，由用户决定是否进入下一阶段。
