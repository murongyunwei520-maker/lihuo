# 离火 AI 短剧工作室 · 阶段 3.2.2 FINAL

> 本文是 FINAL 历史记录，后续持久化保护补丁见 `DRAMA_STUDIO_STAGE3_2_2_FINAL1.md`。  
> 正式分镜原子写入、B–F 专项收尾与 A 回归。  
> 验收日期：2026-11-25  
> 代码基线：`main` / `27b67bd09a8aead582868e139c585b7ba4b03b0e`  
> 范围：Stage 3.2.2 B–F，并回补 A；不进入 Stage 4C。  
> 状态：代码与测试完成，等待用户验收；**未提交、未推送**。

## 0. 结论

1. B 正式分镜写入已从“应用层 `expectedVersion` + 写后回读”升级为 **IndexedDB 单事务 compare-and-write**。版本比较、备份 / 正式 / 冲突快照、journal、写入与回读校验在同一个 `app_state` readwrite 事务内完成，失败 `transaction.abort()`。
2. C 的 Mock 覆盖从纯函数升级为 **真实生产入口注入 `StudioStateStore.transact`**，确认 `applyStoryboardSnapshot()`、`setStoryboardLocked()`、`commitFormalStoryboardWrite()` 都经过可观察的事务边界，并覆盖成功 / 读取失败 / 事务抛错 / 快照不存在 / 数据不完整 / 版本冲突分支。
3. D 已完成 9 个备份失败注入场景。所有失败场景正式版本保持 `v1`、正式内容 Hash 保持 `9krk7n`、草稿 Hash 保持 `9krk7n`；正常路径 `v1 → v2`，正式 Hash `9krk7n → ryyoay`。D 是确定性注入，**不是浏览器存储故障注入**。
4. E 已用原始项目 A 的导出副本完成真实浏览器回归：项目入口、分镜显示、历史快照查看、复制为新草稿、旧草稿应用前版本确认、刷新后保持均通过。当前 IndexedDB 没有原始 live 项目 A，**不能写成原始 live 项目 A 回归通过**。
5. F1–F5 已在此前真实双标签页会话完成五类冲突；F6 在环境重连后的新浏览器会话完成“A 写入时 B 刷新”和“刷新后旧版本写入冲突”。两组证据分属两个浏览器 profile，**不能合并成同一会话连续通过**。
6. 4B 的整份锁定 UI 缺口已修复：整份文档 `locked` 时，逐镜审核 / 锁定 / 解锁项与批量锁定 / 解锁入口全部禁用，批量审核仍可用。
7. `stage3_2_2-core-check` 44 例通过（A 8 / B 9 / C 12 / D 9 / E 6）；`typecheck`、production build、`stage4a-core-check` 9 组、`stage4b-core-check` 8 组通过。`DRAMA_STUDIO_STAGE3_2_2.diff` 13 文件，2,056 insertions / 324 deletions，reverse apply 检查通过。
8. 本轮没有调用任何真实模型，没有提交或推送，没有进入 4C。

## 1. 为什么此前不能算完成

核查 `docs/ai-handover` 与源码后确认：

- `DRAMA_STUDIO_STAGE3_2.md` / `.diff`、`STAGE3_2_1.md` / `.diff`、`STAGE4A.md`、`STAGE4B.md` / `.diff` 存在；`DRAMA_STUDIO_STAGE3_2_2.md` 与 `DRAMA_STUDIO_STAGE3_2_2.diff` 此前不存在。
- Stage 3.2.2 的 B–F 在旧报告中仍是未完成项；4B 的 `expectedVersion`、写后回读与“部分成功”只覆盖审核 / 锁定元数据，不能替代正式分镜写入的跨标签页原子性。
- 旧实现即使两个标签页都读到同一个版本，也可能在“检查后、写入前”被另一个标签页插入提交；BroadcastChannel、刷新或 UI 提示不能消除这个窗口。
- 当前浏览器 IndexedDB 只有隔离项目 E，没有原始 live 项目 A；E 只能对导出副本做回归，不能冒充 live A。

本轮因此先补底层协议，再用确定性用例、真实 IndexedDB、真实双标签页和旧项目导出副本分别取证。

## 2. 实现

### 2.1 持久化事务层

新增 `web/src/lib/studio-store-persistence.ts`：

- 常量：`STUDIO_DB_NAME = STORAGE_NAMESPACE`、`STUDIO_DB_STORE = "app_state"`、`STUDIO_STORE_KEY = storageKey("studio_store")`。
- `createIndexedDbStudioStateStore()`：原生 IndexedDB `open`、`readwrite` 事务、`get` / `put`、`put` 后回读、事务内 `verify`、失败 `abort`。
- 事务 API 设计为同步 `plan(currentRaw) => { nextRaw?, result, verify? }`，避免事务内 `await` 非 IDB Promise 导致事务提前失活。
- `parseStudioEnvelope()` / `serializeStudioEnvelope()` 统一 `studio_store` 外层结构。
- `StudioPersistenceUnavailableError` / `StudioStateVerificationError`：区分“IndexedDB 不可用”和“语义校验失败”。
- `readProjectStoryboardVersion()`：供守卫读取每集正式版本。

常规 Zustand 整仓写入的第二道闸门：

- `web/src/lib/localforage-storage.ts` 在写 `STUDIO_STORE_KEY` 时走同一个 IDB 事务，不先 `localforage.setItem`。
- 写前 / 写后调用 `assertNoStaleFormalWrite(currentRaw, nextRaw/readBack)`。
- 非 `studio_store` 键保持原逻辑。
- 失败时抛出并派发 `lihuo:studio-store-write-blocked`，`use-studio-store.ts` 监听后从 IndexedDB 重新 hydrate。

### 2.2 统一正式写入协议

新增 `web/src/lib/studio/storyboard-write-protocol.ts`：

- `commitFormalStoryboardWrite(input)` 是唯一正式分镜写入入口。
- 输入包含 `projectId / episodeId / operationId? / operationType / expectedVersion / scope / sourceSnapshotId? / candidateDocument? / fallbackProjects? / apply / store? / hooks?`。
- 流程：
  1. 获取 Web Lock `lihuo:studio-storyboard-write`（仅跨标签页排队；不支持时退化为进程内 Promise 队列）。
  2. 打开 `app_state` readwrite 事务，读取当前 `studio_store`。
  3. 解析失败直接拒绝；项目 / 分集不存在直接拒绝，不写。
  4. 读取 `storyboardWriteOperations`；同 `operationId` 已存在则返回已有结果（幂等）。
  5. `currentVersion !== expectedVersion` 时构建冲突：当前正式版本不递增、不被覆盖；失败方内容写入独立 `conflict` 快照，带 `basedOnVersion`、当前版本、冲突原因、`conflictWithSnapshotId`、唯一 `snapshotId`。
  6. 调用方未提供 `candidateDocument` 时，基于 `expectedVersion` 对应的 formal 快照重放一次 `apply`，保证冲突快照保存失败方原本要提交的内容，而不是当前最新内容。
  7. 版本匹配时执行 `apply`，校验正式文档版本恰好 `current + 1`、内容 Hash 与提交内容一致、formal 快照存在且 Hash 一致、备份快照存在且是写入前正式内容、`basedOnVersion` 正确、备份进入待提交集合。
  8. `verifyUnchangedScope()`：场景 / 单镜范围外内容 Hash 不变。
  9. journal 写入 committed / conflict，单集最多 30 条。
  10. 序列化后 `put`，同一事务内回读：正式版本、正式内容 Hash、备份、formal、journal、目标集版本、其他分集版本 / 数量全部一致；最后再跑 `assertNoStaleFormalWrite(currentRaw, readBack)`。
  11. 任一步抛错 `abort`，正式数据回滚。
- 成功或冲突后通过 BroadcastChannel `lihuo:studio-storyboard` 发送轻量消息；`use-studio-store.ts` 监听后 refresh。通知只同步 UI，不承担原子性或版本判断。
- 写冲突事件只用于 UI 刷新；最终结果仍以 IndexedDB 回读为准。

### 2.3 同版本整仓守卫

`assertNoStaleFormalWrite(previousRaw, nextRaw)` 处理两类风险：

- 正式版本回退：`nextVersion < previousVersion` 一律拒绝。
- 同版本陈旧整仓写入：比较正式内容 Hash、formal 快照 ID 集合、conflict 快照 ID 集合、journal `operationId` 集合；任一不同即拒绝。

本轮额外修正：

- `formalWriteSignature()` 的正式内容 Hash 改用 `guardStoryboardHash()`。
- `guardStoryboardHash()` 把 `shot.locked`、`group.reviewedByUser` 归一化为常量后再算 Hash。
- 原因：逐镜锁定、整组已复核是**不递增正式版本**的合法元数据；若直接使用完整 `storyboardContentHash`，这些写入会被同版本守卫误判为“陈旧覆盖”，锁定 / 复核无法落盘。
- 常规正文改写（动作、台词、景别、构图、来源版本等）仍会改变该 Hash，陈旧标签页写入仍被拒绝。
- 边界：该守卫不保护“删除备份快照”这类非正式元数据；它只保证正式叙事内容、formal / conflict 快照和 journal 不被同版本覆盖。

### 2.4 正式入口覆盖

| 入口 | operationType | scope | 说明 |
| --- | --- | --- | --- |
| `runEpisodeStoryboard()` | `episode_replace` | `episode` | 整集正式分镜生成 |
| `runStoryboardScene()` | `scene_replace` | `scene` | 单场正式分镜生成 |
| `runStoryboardShot()` | `shot_replace` | `shot` | 单镜正式分镜生成 |
| `saveStoryboardShotEdit()` / `updateStoryboardShotManual()` | `shot_edit` | `shot` | 单镜手工编辑；后者为 wrapper |
| `applyStoryboardSnapshot()` / `restoreStoryboardVersion()` | `snapshot_apply` | `episode` | 应用 / 恢复正式快照 |
| `applyStoryboardDraft()` | `draft_apply` | `episode` | 独立草稿应用为正式版本 |
| `setStoryboardLocked()` | `document_lock` / `document_unlock` | `document` | 整份锁定 / 解锁 |

写入成功后：

- `applyCommittedProduction(projectId, episodeId, production)` 只写回目标集 production。
- `syncAfterFormalWrite(...)` 同步 legacy `StudioEpisode` 的 shots / 剧本引用。
- `protocolConflict(result)` 把协议冲突转成 UI 可识别的 `conflict` / `blocked`。
- `storyboard-tab.tsx` 的 `applySnapshot`、`applyDraft`、`saveShot` 改为 async / await；锁定与应用草稿按钮 `void` 调用，避免未处理 Promise。

### 2.5 4B 整份锁定 UI 修复

- `review-grid.tsx` / `review-list.tsx` 新增 `documentLocked = document.status === "locked"`。
- 逐镜「操作」菜单：
  - 审核 / 锁定 / 解锁项在整份锁定或单镜锁定时禁用。
  - 整份锁定时标签改为“整份分镜已锁定 · 需先解锁整份”，`disabled: documentLocked`。
  - 单镜锁定仍可单独解锁（整份未锁时）。
- `review-workspace.tsx`：
  - 批量锁定 / 解锁 `disabled={documentLocked}`。
  - `requestLock()` 在确认前再次拦截整份锁定，提示走第三步整份解锁流程。
  - 批量通过 / 需修改 / 驳回仍可执行；审核结论与锁定分离不变。
- 底层 `planStoryboardShotLocks()` 已有 `document_locked` 跳过逻辑；本轮修复的是 UI 入口，不是只改文案。

## 3. 写入路径审计

正式分镜内容写入已全部收口到 `commitFormalStoryboardWrite()`；以下路径不属于“新正式分镜版本”，仍保留直接写 Zustand / 草稿 / 元数据，但受整仓守卫保护：

| 路径 | 写什么 | 是否递增正式版本 | 本轮判定 |
| --- | --- | --- | --- |
| `setShotLocked()` | `shot.locked` / `shot.updatedAt` | 否 | 合法元数据；`guardStoryboardHash` 忽略 `locked`，可正常落盘 |
| `setShotGroupReviewed()` | `group.reviewedByUser` / `updatedAt` | 否 | 合法元数据；`guardStoryboardHash` 忽略 `reviewedByUser` |
| `setScriptLocked()` | 剧本 `status` | 否 | 剧本元数据，不触碰分镜 |
| `restoreScriptVersion()` | 剧本 + 局部 stale 标记 | 否（分镜版本不变） | 剧本恢复路径；不是正式分镜内容写入，分镜只加 stale 提示 |
| `copyStoryboardSnapshotToDraft()` | `storyboardDrafts` | 否 | 独立草稿，深拷贝快照；回读确认正式版本未变 |
| `saveStoryboardDraft()` | 草稿文档 / `draftVersion` | 否 | 独立草稿；结构校验 + 回读确认正式版本未变 |
| `deleteStoryboardDraft()` | 删除独立草稿 | 否 | 不影响正式分镜 / 快照 |
| `discardStoryboardSnapshot()` | 删除非正式快照 | 否 | 不触碰正式内容；但删除 conflict 快照会改变同版本 conflict ID 集合，可能被整仓守卫拦截。该函数当前没有前端 UI 调用，列为已知边界，不写成“所有写入均覆盖” |
| `updateProductionJob()` / 队列状态 | 任务队列 | 否 | 不属于分镜写入 |

结论：**正式分镜内容写入已覆盖；元数据 / 草稿直写没有被冒充成正式版本写入。** `discardStoryboardSnapshot()` 的 conflict 删除边界需要在后续决定是否改成专用元数据事务。

## 4. A–F 证据

### 4.1 A：草稿结构校验（8 例）

| 用例 | 结果 |
| --- | --- |
| 合法草稿结构 | 通过 |
| 重复 `shotGroupId` | 拒绝 |
| 重复 `shotId` | 拒绝 |
| `shotGroupId` 与 `group.shotIds` 双向一致 | 拒绝 |
| 同一镜头被多个组引用 | 拒绝 |
| 镜头引用不存在的组 | 拒绝 |
| 组引用不存在的场景 | 拒绝 |
| 非法草稿拒绝应用 | 拒绝，正式分镜不变 |

### 4.2 B：正式写入原子并发（9 例 + 真实 IDB）

确定性用例：

| 用例 | 结果 |
| --- | --- |
| 同版本整集并发 | A committed v2；B conflict，冲突快照 `sbs-qnq0pc`，正式 v2 |
| 整集 vs 单镜并发 | 整集 committed；单镜 conflict |
| 不同场景并发 | 场景 A committed；场景 B conflict |
| 同一场景并发 | 第一个 committed；第二个 conflict |
| `operationId` 幂等 | 重复请求返回已有结果，写入 1 次 |
| 单镜范围外不变 | 新版本 v2，备份 `sbs-1bfmmfv`，范围外 Hash 不变 |
| 旧整仓写入守卫 | 正式版本回退被拒绝 |
| 同版本陈旧整仓写入守卫 | 正式版本相同但 formal / conflict 快照或 journal 被删时拒绝 |
| 同版本锁定元数据可写入 | 只改 `shot.locked` / `group.reviewedByUser` 时允许，不被误判为陈旧覆盖 |

真实 IndexedDB 单次协议写入：

- origin：`http://127.0.0.1:3000`
- 项目：`proj-stage322-protocol`
- `expectedVersion` 13，写入成功 `v13 → v14`
- `operationId`：`op-realidb-single-1795529969545`
- 备份快照：`sbs-1clz19p`，`basedOnVersion=13`
- formal 快照对应 v14
- 写入后回读：正式版本、内容 Hash、备份、formal、journal 一致

### 4.3 C：Mock 覆盖（12 例，含 6 行矩阵）

真实生产入口注入 `StudioStateStore.transact`：

| 生产入口 | Mock 目标 | 参数 / 异常分支 | 结果 |
| --- | --- | --- | --- |
| `applyStoryboardSnapshot` | `StudioStateStore.transact` | `expectedVersion=13`，正常 | ok |
| `applyStoryboardSnapshot` | `StudioStateStore.transact` | `expectedVersion=13`，`transact throws` | fail |
| `applyStoryboardSnapshot` | 无（前置校验） | `snapshotId=sbs-not-exist`，快照不存在 | fail |
| `commitFormalStoryboardWrite` | `StudioStateStore.transact` | `emptyProjects=true`，数据不完整 | fail |
| `setStoryboardLocked` | `StudioStateStore.transact` | `locked=true` | ok |
| `applyStoryboardSnapshot` | `StudioStateStore.transact` | `expectedVersion=12`，版本冲突 | conflict |

其余 C 用例：真实经过注入 store（事务 1 次 / 写入 1 次）、store 读取失败、快照不存在前置拒绝、持久化数据不完整（0 写入）、`setStoryboardLocked` 真实写入、生产入口版本冲突。

结论：C 不是只测纯函数；生产入口确实经过可注入的事务层。

### 4.4 D：备份失败注入（9 例）

所有失败场景写入前：`v1`、正式 Hash `9krk7n`、草稿 Hash `9krk7n`；写入后仍为 `v1` / `9krk7n` / `9krk7n`。

| 注入 | 实际错误 |
| --- | --- |
| `apply` 抛错（备份创建失败） | `注入：备份创建失败` |
| `transact` 抛错（IndexedDB 备份事务失败） | `注入：IndexedDB 事务失败` |
| `serialize` 抛错（备份数据序列化失败） | `注入：序列化失败` |
| `transact` 抛错（备份快照写入中断） | `注入：写入中断` |
| `afterWrite` 抛错（备份写入后回读失败） | `注入：备份回读失败` |
| duplicate `snapshotId` | `备份快照 ID 冲突：sbs-19430jg` |
| `contentHash` 篡改 | `备份快照内容校验失败：sbs-1x38y2h` |
| omit backup | `正式写入缺少备份快照，已阻止提交` |
| 正常备份 → 正式覆盖 → 回读 | `v1 → v2`，Hash `9krk7n → ryyoay` |

边界：D 由 `stage3_2_2-core-check.ts` 的 hooks 注入，不是浏览器网络 / IndexedDB 故障注入；真实浏览器 D 未执行。

### 4.5 E：旧项目 / 历史快照 / 旧草稿（真实浏览器）

数据源：

- 文件：`阶段2A验收·雾港夜航(4).json`
- 大小：1,298,493 bytes
- `format=lihuo-studio-project`、`schemaVersion=2`
- `projectId=proj-UORILWcK`
- 3 集；第 1 集 `ep-GHduqaBp`，正式分镜 v13
- 历史快照 3 个：v12 / v8 / v4
- 无 `storyboardReview`；草稿字段为 null
- 导出时间：2026-11-23 08:15:10

浏览器结果：

- 项目入口可打开；第 1 集分镜正常显示 v13 / 8 镜；审核记录为 0，不伪造。
- 历史快照列表显示 v12 / v8 / v4；可查看。
- “复制到新草稿”不改变正式版本；新草稿有独立 `draftId`。
- 旧草稿应用前出现版本确认 Modal；取消后正式分镜不变。
- 刷新后项目、分镜、快照、草稿保持。
- 截图：`stage3_2_2-old-project-review.png`、`stage3_2_2-old-project-versions.png`、`stage3_2_2-old-project-versions-list.png`、`stage3_2_2-old-draft-conflict.png`。

**边界**：这是导出副本 / 旧 V2 导出回归，不是原始 live 项目 A 的实时 IndexedDB 回归。当前 IndexedDB 只有隔离项目 E。

### 4.6 F：两个真实浏览器标签页

#### F1–F5（此前真实双标签页会话）

| 场景 | A（先写） | B（后写） | 结果 |
| --- | --- | --- | --- |
| F1 同集整集覆盖 | `op-f1-A5-1795530919110`，committed v14，内容 `A-f1 v13` | `op-f1-B5-1795530919110`，conflict，快照 `sbs-101f5i5`，内容 `B-f1 v13` | 延迟回读 journal 与 conflict 仍在 |
| F2 整集 vs 单镜 | `op-f2-A2-1795530978841`，committed v14，`A-f2 整集` | `op-f2-B2-1795530978841`，conflict，快照 `sbs-l1bdau`，`B-f2 单镜` | 正式仍 v14 |
| F3 不同场景 | `op-f3-A-1795531019244`，场景 1 committed v14 | `op-f3-B-1795531019244`，场景 2 conflict，快照 `sbs-ste3nk` | 正式仍 v14 |
| F4 旧快照 vs 正常写入 | `op-f4-A-1795531067444`，committed v14 | B 应用 `sbs-legacy-u0vvf5`（v8），`op-f4-B-1795531067444`，conflict，快照 `sbs-1hi9vuk` | 冲突内容来自旧快照 |
| F5 旧草稿 vs 正常写入 | `op-f5-A-1795531103066`，committed v14 | B 应用 `draft-f5`（来源 v11），`op-f5-B-1795531103066`，conflict，快照 `sbs-577gkw` | 草稿仍 active |

F1–F5 使用两个真实标签页，不是同页模拟；该浏览器 profile 在执行 F6 前已不可用。

#### F6（环境重连后的新浏览器会话）

- 重置 `proj-stage322-f6` 至 v13。
- A 操作：`op-f6-A3-1795567905084`，`startedAt=1795567905086`，`finishedAt=1795567905206`，成功 v14，内容 `A-f6 写入 v13`。
- B 刷新前读取：v13，时间 `1795567880932`。
- B `reloadAt=1795567905171`，落在 A 事务 `1795567905086–1795567905206` 之间，是真实“写入中刷新”。
- B 刷新后回读：
  - raw 可完整 JSON parse，`rawLen=544216`
  - `projects=1`，正式 v14，8 shots
  - `s0` 内容 `A-f6 写入 v13`
  - formal `sbs-rmiw5a`，based 14
  - backup `sbs-1p4h4bv`，based 13
  - journal 有 A committed
- B 刷新后基于 v13 再写：`op-f6-B-stale-1795567956247`，conflict，快照 `sbs-1nq7lgh`，based 13，内容 `B-f6 刷新后旧版本`。
- 最终正式仍 v14；journal 同时有 A committed 与 B conflict。
- F6 截图 `stage3_2_2-f6-reload.png` 因页面入场动画 / 透明度呈背景空页，未作为视觉证据；F6 结论以 IndexedDB 回读数据为准。

**F 的边界**：

- F1–F5 与 F6 是两个浏览器 profile / 会话，不能写成同一会话连续通过。
- 原子性由 IndexedDB 事务决定；BroadcastChannel 只用于刷新 UI，不能当作锁。
- F1 的延迟回读验证了“同版本陈旧整仓写入”不会覆盖 conflict 快照 / journal；该问题的修复见 2.3。

### 4.7 4B 整份锁定真实浏览器

隔离项目 `proj-stage322-locked`：

- 文档 `status=locked`、正式 v13、8 镜。
- 逐镜「操作」菜单 5 项全部 `disabled=true`。
- 全选后批量锁定 / 解锁 `disabled=true`。
- 批量通过 / 需修改 / 驳回仍可用。
- 截图：`stage3_2_2-locked-batch-disabled.png`。

## 5. 质量门

| 检查 | 结果 |
| --- | --- |
| `stage3_2_2-core-check` | `pass=true`，44 cases（A 8 / B 9 / C 12 / D 9 / E 6） |
| 真实 IndexedDB 单次协议写入 | v13 → v14，备份 / formal / journal 回读一致 |
| `npm run typecheck` | 通过（`tsc --noEmit`，exit 0） |
| `npm run build` | 通过，8307 modules，1m20s；仅有既有 chunk 体积警告 |
| `stage4a-core-check` | 9 groups passed |
| `stage4b-core-check` | 8 groups passed |
| Diff reverse apply | `git apply --reverse --check --ignore-space-change` exit 0 |
| F1–F6 | 已执行；会话边界如 4.6 |

### 复跑命令

```powershell
cd C:\Users\qq308\Desktop\lihuo\web
npx esbuild scripts/stage3_2_2-core-check.ts --bundle --platform=node --format=esm "--alias:@=./src" "--define:import.meta.env={}" --outfile=.tmp-stage322-core.mjs
node .tmp-stage322-core.mjs

npm run typecheck
npm run build

npx esbuild scripts/stage4a-core-check.ts --bundle --platform=node --format=esm "--alias:@=./src" "--define:import.meta.env={}" --outfile=.tmp-stage4a-core.mjs
node .tmp-stage4a-core.mjs
npx esbuild scripts/stage4b-core-check.ts --bundle --platform=node --format=esm "--alias:@=./src" "--define:import.meta.env={}" --outfile=.tmp-stage4b-core.mjs
node .tmp-stage4b-core.mjs
```

Diff 校验：

```powershell
cd C:\Users\qq308\Desktop\lihuo
git apply --reverse --check --ignore-space-change docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2.diff
```

## 6. 文件清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `web/src/lib/studio-store-persistence.ts` | IDB 单事务层、回读校验、同版本整仓守卫 |
| `web/src/lib/studio/storyboard-write-protocol.ts` | 统一正式分镜写入协议、Web Locks、冲突快照、journal、BroadcastChannel |
| `web/scripts/stage3_2_2-core-check.ts` | 44 个确定性用例 |

### 修改

| 文件 | 变更 |
| --- | --- |
| `web/src/types/studio-production.ts` | `storyboardWriteOperations` journal 类型与字段 |
| `web/src/lib/localforage-storage.ts` | `studio_store` 写入走 IDB 守卫 |
| `web/src/stores/use-studio-store.ts` | 跨标签页 refresh / blocked 监听 |
| `web/src/lib/studio/production-workspace.ts` | hydration 保留 `storyboardWriteOperations` |
| `web/src/lib/studio/storyboard-snapshots.ts` | 草稿结构校验补 `sceneIds` / scene 引用 |
| `web/src/lib/studio/production-actions.ts` | 正式入口接入协议、可选 store 注入、冲突 / 同步辅助 |
| `web/src/pages/drama/studio/production/storyboard-tab.tsx` | 异步 await |
| `web/src/pages/drama/studio/review-grid.tsx` | 整份锁定逐镜菜单禁用 |
| `web/src/pages/drama/studio/review-list.tsx` | 整份锁定逐镜菜单禁用 |
| `web/src/pages/drama/studio/review-workspace.tsx` | 批量锁定 / 解锁禁用、`requestLock` 拦截 |

### 交付文档 / 证据

- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2_FINAL.md`（本文件）
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2.diff`（170,848 bytes；SHA256 `7DAD6E92D7FFCB420A437E8EFF7FCBBE92A99F6279D7777DA8C147EDD5B974B6`）
- 有效截图：`stage3_2_2-old-project-review.png`、`stage3_2_2-old-project-versions.png`、`stage3_2_2-old-project-versions-list.png`、`stage3_2_2-old-draft-conflict.png`、`stage3_2_2-locked-batch-disabled.png`
- `stage3_2_2-f6-reload.png` 为空背景截图，不作为证据，已清理。

## 7. 已知限制 / 风险

1. **原始 live 项目 A 不可用**：当前 IndexedDB 只有隔离项目 E；E 的结论仅来自原始项目 A 导出副本，不能写成 live A 回归通过。
2. **F 会话分裂**：F1–F5 是此前 profile，F6 是重连后新 profile；两者不能合并成同一浏览器会话。
3. **D 仅确定性注入**：没有在浏览器里制造 IndexedDB / 序列化 / 回读故障；D 的结论是核心事务路径的故障注入，不是端到端存储故障演练。
4. **`discardStoryboardSnapshot()` conflict 删除**：删除非正式快照会改变同版本 conflict ID 签名，可能被整仓守卫拦截；该函数当前没有 UI 调用，未纳入本轮修复，后续应改成专用元数据事务或明确限制。
5. **备份快照删除不在守卫签名内**：`formalWriteSignature` 只覆盖正式内容、formal / conflict 快照、journal；单独删除 backup 快照不会被该守卫识别。
6. **元数据直写仍是最后写入者胜**：逐镜锁定 / 整组已复核不递增版本，两个标签页同时改同一镜的锁定状态时，后写者覆盖；这属于元数据，不是正式叙事内容，未提升为版本冲突。
7. **4B 锁定的真实点击回归**：整份锁定 UI 在隔离项目 `proj-stage322-locked` 验证；逐镜锁定 / 解锁的落盘路径由 B 的“同版本锁定元数据可写入”确定性用例覆盖，未在加入守卫后重新跑一次真实点击。
8. **无真实模型调用**：B–F 不调用模型；生成入口的原子性由确定性用例和真实 IDB 单次写入覆盖，真实模型长输出 / 截断仍属于后续压测。
9. **未进入 4C**：没有时间轴、整集拼接、AI 审查、预览图、视频生成、版本历史 UI 扩展。
10. **未提交 / 未推送**：所有改动仍在工作区；没有 `git reset / checkout / stash / clean`，没有覆盖用户既有修改。

## 8. 下一步

1. 用户按 `pending-test.mdx` 的 Stage 3.2.2 清单复核 B–F 的真实边界，尤其是原始 live 项目 A、D 的浏览器故障注入、F 的同 profile 连续重跑。
2. 确认后再进入 Stage 4C；本轮不启动 4C。
3. 如需处理 `discardStoryboardSnapshot()` 的 conflict 删除边界，单独开一个元数据事务小项，不混入 4C。
