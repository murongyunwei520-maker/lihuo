# 离火 AI 短剧工作室 · Stage 3.2 剧本覆盖保护与分镜快照版本机制

> 日期：2026-11-23
> 范围：只完成 Stage 3.2 的剧本覆盖保护、分镜快照身份、版本恢复与剧本→分镜局部 stale；不进入 Stage 4 / 5，不生成图片 / 视频，不改变五步导航，不重构全局任务系统，不修改无限画布核心、Bridge、正式外部后端或全局 `AiConfig`，不提交、不推送。

## 1. 结论与边界

Stage 3.2 代码、确定性测试、`typecheck` 和 `build` 已完成。浏览器在隔离项目 D 上验证了全剧默认跳过、取消覆盖不写、备份失败门禁、冲突快照独立身份、应用冲突为新的正式版本，以及单场剧本修改后只局部标记受影响分镜 stale。

验收边界必须先说清楚：

- 当前 BU profile 中原始项目 A/B 的 IndexedDB 数据已不存在。项目 A 使用 `阶段2A验收·雾港夜航(4).json` 导出快照重建，项目 D 是隔离测试项目。**不能写成原始 live 项目 A/B 全量回归通过。**
- 项目 A 只读：第 1 集剧本 `v1`、分镜 `v13`、4 组 / 8 镜在测试后回读保持；没有在 A 上执行覆盖、应用快照或修改剧本。
- 浏览器只做了 D 上的破坏性操作；没有在 A 上做未经备份的覆盖。
- 本轮没有 purposely 执行真实模型并发生成、真实模型截断、跨标签页并发或原始 live A/B 回归。
- 浏览器验证中发生过一次计划外的真实 Bridge 请求，详见「12. 异常记录与已知风险」；它只写入 D 测试项目，不作为本轮模型验收通过证据。

### 1.1 验证矩阵

| 类别 | 状态 |
| --- | --- |
| 代码实现 | 已实现 |
| Stage 3.2 确定性测试 | 已通过 |
| Stage 3 / 3.1 回归测试 | 已通过 |
| `typecheck` | 已通过（exit 0） |
| `build` | 已通过（exit 0，带 chunk 体积警告） |
| 真实浏览器：默认跳过 / 跳过原因 | 已通过（隔离项目 D） |
| 真实浏览器：覆盖确认 / 取消 | 已通过（隔离项目 D） |
| 真实浏览器：备份失败禁止覆盖 | 已通过（隔离项目 D，注入存储失败） |
| 真实浏览器：冲突快照身份 / 应用为新正式版本 | 已通过（隔离项目 D） |
| 真实浏览器：剧本修改后局部 stale / 刷新保留 | 已通过（隔离项目 D） |
| 真实浏览器：跨标签页并发 | 未验证 |
| 真实浏览器：原始 live 项目 A/B 全量回归 | 未验证 |
| 真实模型调用：正常成功路径 | 未按计划验证；发生 1 次计划外请求，见第 12 节 |
| 真实模型调用：失败 / JSON 截断后旧剧本保留 | 未验证 |
| 真实并发：整集 + 单镜 / 单场 + 同场单镜 / 两场景同时提交 | 未验证 |

## 2. 前置检查与现有实现

### 2.1 检查结果

已检查 Stage 3.1 报告 / Diff、`StudioProject` / `StudioEpisode`、剧本生成与保存链路、全剧剧本排队、局部重生成、锁定、分镜版本、冲突快照、恢复、`storyboardVersion` 与 `storyboard_write_conflict`。

Stage 3.2 前的主要问题是：

1. 全剧剧本队列按集创建 job，已有剧本主要依赖 `locked` 保护；未锁定但已经生成、人工修改过的剧本仍可能被全剧队列覆盖。
2. 覆盖没有强制确认 / 自动备份门禁；备份失败与模型失败之间的顺序没有统一保护。
3. 分镜冲突快照与正式工作区共用 `storyboardVersion`；Stage 3.1 实测正式 v18、冲突快照也记录 v18，只能靠 `reason` 和 `storyboard_write_conflict` 区分。
4. 旧快照没有稳定身份；刷新后没有可重复的 `snapshotId` 依据。
5. 剧本修改后没有局部依赖追踪，无法区分「一个场景对白变了」和「整集分镜全部失效」。

### 2.2 基线说明

仓库包含用户已有修改和未跟踪文件，Stage 3.2 没有执行 `git reset / checkout / stash / clean`，也没有删除任何现有文件。`DRAMA_STUDIO_STAGE3_2.diff` 以 Stage 3.1 交付状态为基线，只包含 Stage 3.2 增量；报告和截图不计入代码 Diff。由于仓库存在大量未提交历史文件，Diff 基线由 Stage 3 / 3.1 已交付补丁重建，并在临时目录生成，不改变工作区。

## 3. 剧本覆盖保护

### 3.1 全剧队列默认 `skip_existing`

新增 `web/src/lib/studio/production-protection.ts` 的 `planScriptQueue()`。判断顺序固定为：

```text
missing_plan
  → admission_blocked
  → locked
  → manual_edited
  → existing_script
  → 无剧本才进入 queue
```

规则：

- 没有剧本的集进入生成队列。
- 已有正式剧本的集默认跳过。
- 已锁定剧本永远跳过普通全剧队列。
- `manualEditedAt` 或有 `manualEditedSceneIds` 的剧本按人工编辑跳过，不再只看 `locked`。
- 跳过原因写入 `StudioProductionSkipRecord`，包含稳定 `id`、集号、标题、`reason`、`detail`、`createdAt`。
- `enqueueProductionJobs()` 持久化 `production.skips[]`，去重并最多保留 30 条；全部跳过时返回 `ok: true + skipped`，不启动队列。
- `processProductionQueue()` 对已有跳过任务写 `cancelled / not_submitted / needsReview: false / skipReason`，不当作失败。

### 3.2 显式覆盖与确认

`guardEpisodeScriptWrite()` 的行为：

- 无剧本：允许。
- 已有剧本且未确认：`requiresConfirmation: true`，`existing_script` 或 `manual_edited`。
- 锁定：永远拒绝，即使调用方传 `allowOverwriteExisting: true`。
- 用户确认：允许覆盖，但 `backupRequired: true`。

剧本页「重新生成本集」先打开覆盖确认 Modal，展示目标集、当前剧本版本、场数、是否存在人工修改、是否锁定、覆盖内容范围、将标记待检查的关联镜头数、是否保留旧版本和备份说明。取消时只关闭 Modal，不调用 `runEpisodeScript()`。

### 3.3 覆盖前备份门禁

`runEpisodeScript()` 在确认覆盖后、模型调用前执行：

1. `persistScriptBackup()` 写入 `scriptVersions[]`，包含 `snapshotId / contentHash / reason / createdAt`。
2. 写入后回读 `findEpisode(...).production.scriptVersions`，用 `scriptBackupPresent()` 确认该 `snapshotId` 真实存在。
3. 任一失败返回 `blocked: true`，不调用模型。
4. 模型成功并通过结构化解析后才写正式剧本；模型失败、空内容或截断不会先清空旧剧本。
5. 写入前再次校验 `baseScriptVersion` 和锁定状态，剧本已被其他操作更新或锁定时不写正式剧本。

### 3.4 剧本局部重生成

`runEpisodeScript()` 支持：

- `module: "scene"`：只替换目标场，保留其他场景、人物 / 地点 / 道具绑定与人工标记。
- `module: "dialogue"`：只替换目标场的 `dialogueBlocks`，保留场动作、环境、出场人物、道具、转场、连续性和其他场景。
- 新增 `scriptDialogueRegeneratePrompt()`、`generateScriptDialogueDraft()`、`normalizeDialogueReplacement()`、`mergeDialogueIntoScript()`。
- 对白中出现未绑定人物时拒绝写入。
- 局部修改通过 `withNextScriptSceneVersions()` 只推进目标场景版本。

## 4. 分镜快照身份与版本分配

### 4.1 数据结构

新增 `web/src/lib/studio/storyboard-snapshots.ts`。`StudioStoryboardVersion` 增加：

| 字段 | 作用 |
| --- | --- |
| `snapshotId` | 快照唯一标识，不得重复 |
| `snapshotType` | `formal` / `conflict` / `backup` |
| `basedOnVersion` | 生成该快照时依据的正式版本 |
| `sourceTaskId` | 关联生成 / 写入任务 |
| `contentHash` | 内容 hash，忽略镜头组 / 镜头的 `createdAt` / `updatedAt` |
| `conflictWithSnapshotId` | 可选，记录与哪份正式快照冲突 |

`storyboardVersion` 仍只表示正式工作区版本。`formal` 快照的 `version = document.storyboardVersion`；`conflict` / `backup` 的 `version = basedOnVersion`。冲突文档如果带有更高的 `storyboardVersion`，创建时会回落到 `basedOnVersion`，不冒充新的正式内容。

### 4.2 版本分配规则

- 正式工作区成功提交变更时递增 `storyboardVersion`，并创建一份 `formal` 快照。
- 同一正式版本不能对应两份不同的正式内容；每次提交链路各自生成唯一 `formal.snapshotId`。
- 冲突快照不递增正式工作区版本号。
- 自动备份不递增正式工作区版本号。
- 冲突快照保留产生时的 `basedOnVersion`，并记录 `conflictWithSnapshotId`（有的话）。
- 所有快照通过 `snapshotId` 区分，不依赖 `storyboardVersion` 唯一性。

### 4.3 冲突处理

用户可以在分镜页：

- 查看冲突快照内容。
- 与当前正式版本比较（场景增减、组数、镜头数、当前 / 依据版本）。
- 保留冲突快照。
- 丢弃冲突 / 备份快照；`formal` 快照不允许删除。
- 将冲突内容复制到新草稿。
- 经确认后应用为新的正式版本。

应用 / 复制都先调用 `planStoryboardSnapshotApply()`：

1. 检查当前分镜是否锁定。
2. `expectedVersion` 必须等于当前正式 `storyboardVersion`。
3. 当前分镜若有锁定镜头，拒绝整集应用。
4. 先创建当前版本的 `backup`。
5. 将快照内容写为 `current + 1` 的新正式版本，记录 `restoredFromSnapshotId`。
6. 按当前剧本重新计算 stale，并生成新的 `formal` 快照。
7. 回读失败时回滚到应用前的 production，不改变当前正式版本。

## 5. 旧数据兼容与恢复

### 5.1 旧快照规范化

`normalizeStoryboardSnapshots()`：

- 只补身份字段，不改旧 `document`、旧 `storyboardVersion`、旧 `reason`、旧 `createdAt`。
- 缺失 `snapshotId` 的旧快照用 `episodeId + id + version + reason + contentHash + index` 生成 `sbs-legacy-*`。
- 同一 ID 冲突时使用内容 + 索引生成稳定后缀。
- 重复读取不新增快照、不重新生成 ID；D 中旧快照刷新后 ID 稳定。
- 旧类型推断：`reason` 含「冲突」→ `conflict`，含「正式提交 / 正式快照」→ `formal`，含「恢复 / 前快照」→ `backup`。
- 旧冲突快照不会自动升级成正式版本。

### 5.2 剧本恢复

`planScriptRestore()` 先为当前正式剧本生成 `backup`，再把待恢复内容写为 `current.scriptVersion + 1` 的新正式版本，记录 `restoredFromSnapshotId`，并把恢复出的场景全部标记为人工编辑资产。`restoreScriptVersion()` 写入后回读；失败回滚，当前正式版本不变。

## 6. 剧本与分镜依赖

`StudioScriptDocument` 增加 `sceneVersions`；`StudioStoryboardDocument` 增加 `sourceSceneVersions` 与 `stale`。

- `ensureScriptSceneVersions()` 给旧剧本补 `sceneVersions = 1`。
- `withNextScriptSceneVersions()` 按场景内容、场景顺序、人物 / 地点 / 道具绑定签名递增；未变场景不升级。
- `recordStoryboardSourceVersion()` / `recordStoryboardSceneSourceVersion()` 记录分镜依据的剧本场景版本。
- `markStoryboardStaleForScriptChange()` 只标记内容变化、删除、顺序变化或来源版本不一致的场景及其镜头；不删除旧分镜，不自动重生成。
- `clearStoryboardStale()` 支持整集 / 整场 / 单镜清理；局部清理只推进目标场景的 `sourceSceneVersions`，不推进其他场景。
- 分镜页显示「待检查」标签和剧本依赖区：依据剧本版本、当前剧本版本、影响场景数 / 镜头数、原因。

D 中把 `scene-9ognjx` 的场景动作改为人工内容后：`script v1 → v2`，`sceneVersions` 只有 `scene-9ognjx` 从 1 变 2；分镜仍 `v14`，`stale.sceneIds = ["scene-9ognjx"]`、`stale.shotIds = 2` 个，8 个镜头全部保留。刷新后从 IndexedDB 回读结果一致。

## 7. 修改文件清单

代码与测试共 14 个文件，约 **1,636 insertions / 179 deletions**（不含文档、报告和截图）；完整增量 Diff 另含 7 个文档文件，合计 21 个文件。

| 文件 | 变更 | 作用 |
| --- | --- | --- |
| `web/src/lib/studio/production-protection.ts` | +300（新增） | 队列 plan、覆盖 guard、场景版本、stale、恢复计划、内容 hash |
| `web/src/lib/studio/storyboard-snapshots.ts` | +171（新增） | 快照唯一身份、类型、旧数据规范化、比较、应用计划 |
| `web/src/lib/studio/production-actions.ts` | +451 / -127 | 备份门禁、队列跳过、单次版本提交、冲突 / 备份 / 正式快照、恢复 / 应用、局部对白 |
| `web/src/lib/studio/production-schema.ts` | +50 / -3 | `incrementVersion`、场景来源版本、对白合并、局部替换 |
| `web/src/lib/studio/production-prompts.ts` | +19 | 对白局部重生成提示词 |
| `web/src/lib/studio/production-ai.ts` | +16 | `generateScriptDialogueDraft()` |
| `web/src/lib/studio/production-workspace.ts` | +45 / -14 | skips / 快照身份 / 场景版本归一化、旧脚本补 hash |
| `web/src/lib/studio/production-engine.ts` | +2 / -7 | 分镜快照改走 `createStoryboardSnapshot` |
| `web/src/types/studio-production.ts` | +52 | 剧本 / 快照 / stale / skip 类型 |
| `web/src/stores/use-studio-store.ts` | +1（3.2 增量） | 默认 `production.skips: []` |
| `web/src/pages/drama/studio/production/script-tab.tsx` | +126 / -14 | 覆盖 Modal、跳过记录、对白重生成、人工 / 锁定标记 |
| `web/src/pages/drama/studio/production/storyboard-tab.tsx` | +99 / -13 | 快照类型 / ID / 版本、比较 Modal、stale、依赖区 |
| `web/src/pages/drama/studio.css` | +25 | 跳过列表、快照 ID / 类型、stale、覆盖 Modal、比较区样式 |
| `web/scripts/stage3_2-core-check.ts` | +279（新增） | Stage 3.2 确定性测试 |

文档更新：`CHANGELOG.md`、`docs/ai-handover/ARCHITECTURE.md`、`docs/ai-handover/CURRENT_STATUS.md`、`docs/ai-handover/ENTRY_POINTS.md`、`docs/ai-handover/KNOWN_ISSUES.md`、`docs/content/docs/progress/pending-test.mdx`、`docs/content/docs/progress/todo.mdx`。

## 8. 测试命令与真实输出

### 8.1 Stage 3.2 确定性测试

```powershell
cd C:\Users\qq308\Desktop\lihuo\web
npx --yes tsx scripts/stage3_2-core-check.ts
```

真实输出（exit 0）：

```json
{"ok":true,"tests":"stage3_2-core-check","scriptProtection":{"queue":1,"skips":5},"sceneVersions":{"changed":{"scene-a":2,"scene-b":1},"swapped":{"scene-b":2,"scene-a":2}},"stale":{"sceneIds":["scene-a"],"shotIds":["shot-a"],"oldShotsKept":2},"snapshots":{"formal":19,"conflict":18,"normalized":["conflict","formal"]},"apply":{"newVersion":20,"backupVersion":19},"scriptRestore":{"newVersion":4,"backupVersion":3}}
```

覆盖的断言包括：

- 队列：已有正式 / 人工 / 锁定 / 缺规划 / 准入未过分别产生 skip，只有无剧本集入队。
- 覆盖 guard：已有 / 人工需确认，锁定永远拒绝，确认后 `backupRequired`。
- 备份：空列表、错误 `snapshotId` 都判定失败；剧本 / 分镜 hash 忽略时间戳。
- 场景版本：只升级改变 / 换序场景；未变场景不升级。
- stale：只标 `scene-a / shot-a`，旧 2 个 shots 保留，局部清理不推进 `scene-b`。
- 对白局部：只替换目标对白，动作、环境、绑定、其他场景和其他人工标记保留。
- 版本：单场 v18 → v19，整集按场构建中间场不占正式版本号。
- 快照：备份 / 正式 / 冲突 snapshotId 唯一；冲突 `version = 18`，正式 `v19`；冲突文档回落 `v18`。
- 旧数据：规范化两次 ID 稳定、长度不增、类型正确、旧文档版本不变；重复同内容旧快照 ID 稳定且互不相同。
- 应用：backup `v19`，newVersion `v20`，formal `v20`，`restoredFromSnapshotId` 正确；expectedVersion 不符、锁定镜头拒绝。
- 剧本恢复：当前 v3 → backup v3，新版本 v4。

### 8.2 Stage 3 / 3.1 回归

```powershell
npx --yes tsx scripts/stage3-core-check.ts
npx --yes tsx scripts/stage3_1-core-check.ts
```

真实输出（exit 0）：

```json
{"ok":true,"tests":"stage3-core-check","fixture":{"projectId":"proj-UORILWcK","snapshotId":"handoff-14rfeou","openChecks":8},"admission":{"episode1Formal":true,"episode2Formal":false},"script":{"scenes":2,"characters":3,"props":2,"durationSeconds":39.4},"storyboard":{"groups":1,"shots":2},"checks":{"scriptError":0,"storyboardError":0},"persistence":{"status":["interrupted","unknown"],"remoteState":["unknown","unknown"],"activeJobId":null}}
{"ok":true,"tests":"stage3_1-core-check","hydration":{"queued":"interrupted/not_submitted","submitting":"interrupted/unknown","unknown":"unknown","succeeded":"completed","legacyFailed":"failed/unknown"},"selection":{"resumable":1,"retryable":1,"review":6},"lock":{"episodeBlocksScene":true,"episodeBlocksShot":true,"sceneBlocksScene":true,"sceneBlocksShot":true,"differentEpisodePasses":true},"frozenModel":{"old":"对话","next":"gpt-5.5"},"storyboard":{"version":6,"lockedShotKept":true,"shots":2}}
```

### 8.3 类型检查与构建

```powershell
cd C:\Users\qq308\Desktop\lihuo\web
npm run typecheck
npm run build
```

真实结果：`tsc --noEmit` exit 0；`vite build` exit 0，`8298 modules transformed`，`✓ built in 1m 33s`。构建仍有既有的动态 / 静态混合导入警告和 chunk 体积警告，不是本轮新增错误。

## 9. 浏览器验收记录

环境：Windows 本地 `localhost:3000`，隔离项目 D `proj-stage32-protection`，第 1 集 `ep-stage32-1`。原始项目 A/B 数据已不在当前 BU profile；A 由导出快照重建，只读。以下记录来自真实页面点击和 IndexedDB `lihuo / app_state / lihuo:studio_store` 回读，不是只用确定性测试代替。

### 9.1 全剧默认跳过

点击「全剧排队」后，顶部 toast：

```text
全剧队列默认跳过已有剧本。跳过 3 集：第 1 集：已有正式剧本 v1，默认跳过；第 2 集：剧本 v1 含人工编辑，需显式确认才能覆盖；第 3 集：剧本 v1 已锁定，普通队列不会覆盖
```

底层状态：`jobs = 0`，`skips = [ep1 existing_script, ep2 manual_edited, ep3 locked]`。确认不是只改 UI 文案。

![D 全剧跳过](stage3_2-d-queue-skip.png)

### 9.2 覆盖确认与取消

点击「重新生成本集」出现覆盖 Modal，显示目标集、`v1 / 4 场`、人工修改否、未锁定、覆盖范围、8 个镜头将标记待检查、备份失败不覆盖。点击「取消覆盖」后 Modal 消失，回读 `scriptVersion = 1`、`scriptVersions = 0`、`jobs = 0`，原剧本不变。

![覆盖确认](stage3_2-d-overwrite-modal.png)

![取消覆盖](stage3_2-d-cancel.png)

### 9.3 备份失败禁止覆盖

浏览器内注入 `updateEpisodeProduction` 存储异常，再调用确认覆盖：

```json
{"ok":false,"error":"剧本备份写入失败，已阻止覆盖：storage unavailable","blocked":true}
```

之后旧剧本仍 `v2`，`scriptVersions = 1`，`jobs = 0`。证明是备份失败后阻止覆盖，不是先覆盖再补备份。

### 9.4 冲突快照独立身份与复习

分镜页初始 `v13`，快照列表显示：

- 冲突：`sbs-5pe320`，`v12`，`conflict`，关联任务 `task-stage32-conflict-b`。
- 正式：`sbs-15hk585`，`v13`，`formal`。
- 自动备份：`sbs-legacy-...`，旧版本。

查看 / 比较 Modal 文本明确写出：冲突快照、唯一 ID、不是正式 `v12`、基于 `v12`、当前正式 `v13`、关联任务、应用前按当前 `v13` 重新校验并递增到 `v14`。截图模态框可能因标签绑定未入镜，文本和 IndexedDB 状态为准。

![分镜快照列表](stage3_2-d-snapshot-list.png)

### 9.5 应用冲突为新的正式版本

点击「应用为正式版本」后 toast：

```text
已应用为新的正式版本 v14；应用前版本已备份
```

页面显示 `v14`，快照数 7。IndexedDB 回读：

- `storyboardVersion = 14`
- `restoredFromSnapshotId = sbs-5pe320`
- 新 `backup = sbs-i2rxly`，`v13`
- 新 `formal = sbs-1lgkrpe`，`v14`
- 冲突 `sbs-5pe320` 仍为 `v12`

![应用后 v14](stage3_2-d-after-apply.png)

### 9.6 剧本局部修改只标记相关分镜

在 D 第 1 集只修改 `scene-9ognjx` 的场景动作，执行真实页面动作 `saveScriptSceneEdit()`：

- 剧本 `v1 → v2`
- `manualEditedSceneIds = ["scene-9ognjx"]`
- `sceneVersions` 只有 `scene-9ognjx` 从 1 变 2
- 分镜仍 `v14`，8 个镜头保留
- `stale.sceneIds = ["scene-9ognjx"]`
- `stale.shotIds = 2` 个（该场镜头）
- 刷新后 IndexedDB 回读完全一致，其他场景镜头不受影响

页面显示「2 镜待检查」和「剧本依赖：依据剧本版本 v1 → 当前 v2，影响 1 个场景 / 2 个镜头；旧分镜保留，未自动重生成」。

![局部 stale](stage3_2-d-stale.png)

### 9.7 项目 A 只读

项目 A `proj-UORILWcK` 第 1 集 `ep-GHduqaBp` 回读为剧本 `v1`、分镜 `v13`、8 镜头 / 4 镜头组；未执行覆盖、应用或剧本修改。该数据是导出快照重建的 A，不是原始 live 数据。

## 10. 已实现 / 已测试 / 未验证的分界

### 已实现

- 全剧队列默认 `skip_existing`，跳过原因持久化。
- 显式覆盖确认、备份回读门禁、模型失败保留旧剧本。
- 局部整场 / 对白重生成只改目标范围。
- 分镜快照独立 `snapshotId`、类型、依据版本、来源任务、内容 hash。
- 冲突 / 备份不占正式版本号；应用 / 恢复生成新正式版本。
- 旧快照稳定规范化；刷新不重生成 ID。
- 剧本→分镜局部 stale。

### 已通过确定性测试

- 队列、guard、备份存在性、场景版本、stale、局部对白、单场 / 整集版本提交、快照唯一性 / 类型 / 版本、旧数据幂等、应用 / 恢复计划、剧本恢复。
- Stage 3 / 3.1 回归。

### 已通过真实浏览器测试

- D 的全剧跳过、跳过原因、覆盖 Modal、取消不写、备份失败门禁、冲突快照独立身份、应用为 v14 新正式版本、单场修改局部 stale、刷新后身份与版本关系不变。
- A 只读回读。

### 已通过真实模型调用

- 未按计划完成。D 上发生过 1 次计划外 Bridge 请求，见第 12 节；它不能当作正常模型成功验收。
- 失败 / 截断路径只做了纯函数和失效模型前置校验，未做真实模型截断。

### 尚未验证

- 跨标签页并发写入。
- 原始 live 项目 A/B 全量回归。
- 旧 V2 项目 / 无限画布回归。
- 真实高风险提案拒绝 / `generated` 复活确认。
- 整集 + 单镜、单场 + 同场单镜、两个场景同时提交的真实并发生成。
- 剧本恢复的浏览器点击（当前只验证纯计划）。
- 冲突快照「复制到新草稿」与「丢弃」的浏览器交互。
- 真实模型失败 / JSON 截断后旧剧本保留。
- schema 校验 error 是否应阻止正式剧本写入的最终用户确认（当前沿用 Stage 3 草稿检查语义）。

## 11. 四个优先检查项

1. **默认跳过是否真的在底层执行**：是。D 点击后 `jobs = 0`，`production.skips[]` 有 3 条，不是只显示 toast。
2. **备份失败是否阻止覆盖**：是。注入存储异常后返回 `剧本备份写入失败，已阻止覆盖`，旧剧本与快照数量不变。
3. **冲突快照是否有独立 ID、刷新是否稳定**：是。`sbs-5pe320` 与正式 `sbs-15hk585`、备份 `sbs-i2rxly` 均不同；刷新后 ID 和 `basedOnVersion` 不变。
4. **恢复是否创建新正式版本**：是。应用冲突快照后 `v13 → v14`，先建 `v13 backup`，并记录 `restoredFromSnapshotId`。

## 12. 异常记录与已知风险

### 12.1 计划外真实 Bridge 请求

在 D 上验证「模型失败保留旧剧本」时，先尝试用 `window.fetch` 拦截 `/api/chat/stream`；但该项目文本模型走内置豆包渠道，不经过该 fetch 分支。该次调用最终返回并写入 D 第 1 集 `script v3`（3 场），同时留下 `scs-4t952d` 覆盖前快照。它只发生在隔离项目 D，未触及项目 A/B；本轮随后停止该路径，改用失效模型 override 做前置失败验证。该请求是计划外的真实调用，不能计入「无真实额度消耗」或「模型验收通过」。

### 12.2 已知风险 / 未定论

- `updateScriptManual()` 仍只标记人工编辑，不递增 `scriptVersion`，也不自动创建快照；与 `saveScriptSceneEdit()` 的正式版本语义尚未统一。
- 剧本覆盖备份的 `sourceTaskId` 目前多为空；分镜生成 / 冲突路径已补 task id，剧本备份尚未有稳定的写入任务 ID。
- `applyStoryboardSnapshot()` 只要当前存在任意锁定镜头就拒绝整集应用，比需求中「应用前重新校验」更严格；是否需要支持只应用未锁定部分，待用户确认。
- 「复制到新草稿」和「应用为正式版本」当前都生成新的正式版本，仅 `reason` 不同；是否符合用户对两种操作的区分，尚未验收。
- 旧分镜缺 `sourceSceneVersions` 时按来源剧本版本决定是否置 0；首次修改可能整集 stale，偏保守，需真实旧数据确认。
- `clearStoryboardStale()` 的单镜清理不推进整集 `sourceScriptVersion`；多镜混合来源状态仍需后续压测确认。
- 任务中心是否展示 `job.skipReason` 未做最终交互核对；当前跳过原因以 `production.skips[]` 和剧本 inspector 的「队列跳过记录」为准。
- 未引入真实并发、超时、重试上限或新的大小限制；没有修改外部后端、Bridge、全局 `AiConfig` 和无限画布核心。
- 未提交、未推送、未创建 tag；未进入 Stage 4 / 5。

## 13. 停止条件

Stage 3.2 到此停止，等待用户检查报告和完整增量 Diff，不自动进入 Stage 4，不生成图片 / 视频，不改变五步导航，不重构全局任务系统，不修改无限画布核心或正式外部后端。
