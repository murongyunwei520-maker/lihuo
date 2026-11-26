# 短剧工坊 Stage 4D.2 可靠性专项报告

## 结论

Stage 4D.2 已完成代码修复和大部分真实浏览器专项，但**不能整体关闭**。4D.2.1 已按用户指定完成三项收口：`studio_store` 读取失败不再回退 localStorage、第一轮跨标签页证据矛盾已作废并用 3002 重跑替代、快照删除包装补齐 7 组重复 / 并发事务测试。以下边界仍未完成或存在未决问题：

1. 原始 live 项目 A 与 `proj-stage4c-snap-1795573351974` 不可恢复；当前所有测试均使用替代项目，不能冒充原始 A。
2. 真实 IndexedDB 故障注入触发的是**真实事务 abort**，异常由隔离 Origin 的 `put` 包装抛出 `QuotaExceededError`，不是真实磁盘配额耗尽。
3. “一个标签页应用提案、另一个标签页修改正式分镜”的真实双标签页机制已用 **pending 提案夹具** 执行：B 成功写入正式 v16，A 的提案应用返回 `提案基于 v15，当前正式分镜已是 v16` 并写入 conflict 记录，未覆盖 B。夹具复用现有提案结构、仅改 ID / 版本 / 决策状态，**不是模型生成的真实提案**；真实 AI pending 提案仍需用户确认额度后再验。
4. `discardStoryboardSnapshot` 曾出现一次同一标签页返回“项目已被其他操作更新”，随后同一包装调用成功；直接调用 `commitStoryboardSnapshotDiscard` 使用相同时间戳也能成功。该次拒绝未能归因，保留为观察项，不认定为已确认产品 bug，但也不能声称所有快照并发边界都已验证。
5. 任务恢复没有后端查询 / 幂等键；`unknown` 只能由用户确认重试，存在重复提交 / 重复扣费风险。

## 一、原始项目 A 审计与替代项目

### 审计结果

- 已检查当前浏览器 IndexedDB、`lihuo` / `app_state` / `lihuo:studio_store`、导出文件、`docs/ai-handover/backups` 与浏览器数据目录。
- `C:\Users\qq308\Downloads\阶段2A验收·雾港夜航*.json` 五个导出（986,669 / 994,476 / 1,209,008 / 1,249,208 / 1,298,493 bytes）的项目 ID 全部为 `proj-UORILWcK`，不是丢失的原始 live 项目 A；最新导出 `(4)` 为 3 集 / 第 1 集 8 镜。
- `proj-stage4c-snap-1795573351974` 只出现在历史聊天记录、命令文本和报告中，没有找到对应项目数据。
- **结论：原始 live 项目 A 不可恢复，`proj-stage4c-snap-1795573351974` 也不可恢复。** 禁止重新创建同名项目或修改 ID 冒充恢复。

当前 `proj-UORILWcK`（3 集 / 8 资产 / 第 1 集 v14 / 8 镜）是从可信导出副本恢复的项目，不是原始 live 项目 A。

### 备份

- `docs/ai-handover/backups/stage4d2-proj-UORILWcK-backup.json`
- 807,032 bytes，1 项目 3 集，SHA256 `694D227A35F894AA3EB4FD7F331229EE6C52E346EF7DFC935964E47D5072CE94`
- 已用 JSON 解析和重新读取验证，可用于恢复当前正式恢复项目。

### 替代项目

| 用途 | Origin | 项目 ID | 状态 |
| --- | --- | --- | --- |
| 3000 替代验收 | `http://127.0.0.1:3000` | `proj-stage4d2-1795608774580` | 标题 `B-守卫2`（第一轮历史结果，不作为通过证据），3 集；第 1 集 v16 / 8 镜；两镜编辑均写入 `production.storyboard` |
| 3002 隔离故障 / 并发 | `http://127.0.0.1:3002` | `proj-stage4d2-iso-1795610200000` | 标题 `删除前修改-4D2`，3 集；第 1 集 v16 / 8 镜 / 4 组；从同一可信导出副本克隆，未触碰 3000 正式替代项目 |

后续报告与 UI 必须区分“原始 A / `proj-UORILWcK` 恢复项目 / 3000 替代项目 / 3002 隔离项目”。

## 二、A–G 测试记录

> A/B 是自动化或 Mock；C/D/E/F 是真实浏览器；G 包含自动化回归与 3002 页面 smoke。A/B 通过不代表 C/D/E/F 通过。

| 类别 | 环境 / Profile | 项目 ID | 测试步骤 | 预期 | 实际 | 证据 | 最终 IndexedDB 重新读取 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A 自动化确定性 | Node 22 + Vite SSR / `web` | 纯函数夹具 | `stage3_2_2` / `4A` / `4B` / `4C` / `4C.1` / `4D` / `4D.2` / `4D-action` | 既有断言不降低，全部通过 | 全部通过（3.2.2 通过 Vite SSR 运行；直接 `tsx` 会因 `import.meta.env` 失败，属于运行器差异，不是产品回归） | 命令输出；`stage4d2-core-check` 输出 `{"ok":true,"tasks":7,"metadataGuards":3,"snapshotDiscards":7}` | 不适用 |
| B Mock 故障注入 | Node 22 / 纯函数与 action 测试 | 测试夹具 | `stage4d-action-check` 存储失败、`stage4d-core-check` persistence groups | 失败不能冒充成功，旧数据保留 | 通过；仅证明 Mock / action 层，不代表真实 IDB | 测试输出 | 不适用 |
| C 真实 IndexedDB 事务故障 | BUA Chrome，`127.0.0.1:3002`，隔离 Origin | `proj-stage4d2-iso-1795610200000` | 主世界包装 `IDBObjectStore.prototype.put`，仅对 `lihuo:studio_store` 抛 `QuotaExceededError`；修改标题；观察事务 / abort / 原始字节 / UI；刷新重读 | 事务 abort；正式数据不部分覆盖；UI 明确失败；刷新后旧数据一致 | `forcePutError=true`、`abortCalls=1`、`rawChanged=false`；内存标题 `未保存失败态-4D2`，IDB 旧标题 `阶段4D.2隔离验收·雾港夜航`；Alert / toast 均为失败，无成功提示；刷新回旧标题 | `stage4d2-real-idb-failure-ui.png` | 刷新后标题、updatedAt 回到旧值；正式 v15 / 8 镜未变 |
| D 真实双标签页并发 | BUA Chrome，同一 Profile，3000 与 3002 | `proj-stage4d2-1795608774580` / `proj-stage4d2-iso-1795610200000` | 同项目标题、同集不同分镜、删除 vs 修改、快照丢弃、快照创建、提案应用 vs 正式修改 | 旧状态不得静默覆盖；冲突明确提示；最终数据正确 | 项目标题、删除 / 修改、同集不同分镜、快照删除 / 创建通过；第一轮标题记录因 `A-守卫2 / 最终 B-守卫2` 无法对应而作废，3002 重跑得到 A 写成功、B 陈旧写被拒、IDB 保持 A 标题；提案 vs 正式修改已用 pending 夹具完成，B v16 成功、A 提案冲突；快照包装层有一次拒绝，复测成功、未归因 | 3002 两个标签页 store / IDB / DOM 读取记录；`stage4d2-stale-tab-blocked.png` 为第二轮旧代码证据 | 3002 最终标题 `删除前修改-4D2`、v16 / 8 镜 / 4 组；快照列表见下 |
| E 页面卸载与任务恢复 | BUA Chrome，3002，刷新 / 关闭标签再打开 | `proj-stage4d2-iso-1795610200000` | 提交 running + queued 任务；确认落盘；刷新；关闭标签再打开；读取任务中心 | running / 已提交不能自动重试；queued 未提交标 interrupted；正式记录不丢失 | 刷新前 running/submitted + queued/not_submitted；刷新后 unknown（remote 保留）+ interrupted（not_submitted）；新标签重开一致；无自动重试 | `stage4d2-task-recovery.png`；`lihuo:studio_tasks` 两条记录 | `task-kEuJ1i02YC` unknown / remote `remote-4d2-recovery-1`；`task-UqgGj23BsV` interrupted / not_submitted |
| F 真实持久化失败 UI | BUA Chrome，3002 | `proj-stage4d2-iso-1795610200000` | 在 C 的事务失败后观察页面 | 显示未保存 / 失败；不能提前成功；支持安全重试 | `工作区尚未保存` Alert、错误原因、重试 / 重新读取按钮；无 success toast；内存修改未静默丢弃 | `stage4d2-real-idb-failure-ui.png` | 刷新后正式数据回到旧值，Alert 消失 |
| G 替代项目回归 | 3002 + 自动化 | `proj-stage4d2-iso-1795610200000` | 01–05 工作区页面 smoke；A 类自动化全回归；typecheck / build | 关键页面可进入，正式数据可读，构建通过 | 01 分析 / 02 资产 / 03 剧本与分镜 / 04 审核 / 05 视频均可进入；隔离 Origin 项目模型账号显示读取失败 / 待修复，未做真实生成；所有自动化与 build 通过 | 页面文本读取；构建日志 | v16 / 8 镜 / 4 组；3 集；无生成写入 |

### D 类细节

1. **同项目标题并发**
   - 3000 第一轮记录作废：原记录写 A 改为 `A-守卫2`，同时写最终 IndexedDB 为 `B-守卫2` 并声称是 A 的更新。这两个标题无法对应，也没有保存当时 A / B 的写结果与 updatedAt，因此不能作为“B 被拒绝”的证据。3000 当前 IndexedDB 标题仍为 `B-守卫2`，只作为历史事实保留，不再引用为通过证据。
   - 3002 重跑（当前 4D.2.1 代码）：两个标签页基线均为 `删除前修改-4D2` / `2026-11-25T13:17:50.996Z`。A 实际写入 `4D21-重跑A-证据2`，store 与 IndexedDB 均为 `2026-11-25T14:06:19.020Z`；B 仍持旧 updatedAt，写入 `4D21-重跑B-陈旧覆盖` 后内存显示该标题，但 IndexedDB 保持 A 的 `4D21-重跑A-证据2` / `2026-11-25T14:06:19.020Z`，B 页面显示「工作区尚未保存」Alert。随后 A 将标题恢复为 `删除前修改-4D2`，project updatedAt 更新为 `2026-11-25T14:07:08.908Z`；B 刷新后显示恢复标题、Alert 消失。
   - 旧 3002 第二轮：A 改为 `并发A-新标题`，B 陈旧写 `并发B-陈旧覆盖`，B 显示“工作区尚未保存 / 保存失败：项目已被其他标签页更新…”，内存保留 B 的未保存标题，IndexedDB 为 A 标题；B 刷新后显示 A 标题、横幅消失。
2. **同集不同分镜**
   - A / B 同时从 v14 提交 `shot-1yqjpid` / `shot-1xwkwfg`。A 返回 conflict：`baseVersion 14 / currentVersion 15 / preservedSnapshotId sbs-a6s5ga`；B 成功 v15。最终正式文档 v15 包含 B 的编辑，A 的编辑保留在冲突快照，不存在两个标签都假成功，也不是旧状态覆盖新状态。
3. **删除 vs 修改**
   - A 将标题改为 `删除前修改-4D2`；B 保持旧 `updatedAt` 调用删除，返回 `{ok:false, reason:"项目已被其他操作更新，请刷新后重试"}`；项目仍存在。
4. **快照**
   - 并发镜头编辑已产生 A 的 conflict 快照 `sbs-a6s5ga` 与 B 的 formal 快照 `sbs-pdfdob`，证明两边都创建了各自快照。
   - A 通过底层 `commitStoryboardSnapshotDiscard` 删除 `sbs-a6s5ga` 成功；B 对 `sbs-1nn2d7h` 的陈旧丢弃被拒绝：“项目已被其他操作更新，请刷新后重试”。随后 A 用 `discardStoryboardSnapshot` 包装层再次删除 `sbs-1nn2d7h`，`ok:true`，证明 store 同步后包装层可以成功。正式 v16、formal `sbs-pdfdob` / `sbs-uzodyw` 等保持；正式版本未因快照删除改变。
   - 早前同一包装层曾有一次 `ok:false`，当时 store 与 IDB 时间戳看起来一致；该次未能复现，报告保留为观察项，不写成已确认 bug。
5. **提案 vs 正式分镜（pending 夹具）**
   - 隔离项目现有 `ai-proposal-i8t2ay` 为 `partial`、`ai-proposal-conflict-fixture` 为 `conflict`，均不是 pending；为避免消耗真实模型额度，基于现有 conflict 提案克隆了 `ai-proposal-4d2-pending-fixture`：只改 `proposalId / storyboardVersion=15 / decision.status=pending / 标题说明`，变更仍为已验证的 `shot-1yqjpid / cameraMovement`，并在隔离项目通过 `planProposalChanges` 校验后写入。
   - A 标签页持有该 pending 提案并调用 `applyAiProposalAction`；B 标签页仍持 v15 旧状态，调用 `saveStoryboardShotEdit('shot-1xwkwfg')`。B 先成功：`newVersion=16`、backup `sbs-29xsf6`；A 的提案应用返回 `{ok:false, conflict:true, persisted:true, error:"提案基于 v15，当前正式分镜已是 v16；已阻止静默覆盖"}`，写入冲突应用记录 `ai-apply-bIXnkwJ7hz`，提案状态变为 `conflict`，未覆盖 B 的正式编辑。
   - 该测试证明真实双标签页下的提案 / 正式写入互斥、冲突记录与最终数据正确；但提案是**夹具**，不是模型输出，不能冒充真实 AI 提案并发验收。

### 最终 3002 IndexedDB 读取

- 项目：`proj-stage4d2-iso-1795610200000`，标题 `删除前修改-4D2`
- project updatedAt：`2026-11-25T14:07:08.908Z`；episode updatedAt：`2026-11-25T13:17:50.996Z`
- 正式分镜：v16 / 8 镜 / 4 组
- 快照：`sbs-29xsf6` backup（basedOn 15）、`sbs-uzodyw` formal（basedOn 16）、`sbs-pdfdob` formal（basedOn 15）、`sbs-1a40ya2` backup、`sbs-xrglrj` formal、`sbs-legacy-oziex1` / `sbs-legacy-u0vvf5` / `sbs-legacy-xsyux` backup
- 提案记录：`ai-proposal-4d2-pending-fixture` conflict，应用记录 `ai-apply-bIXnkwJ7hz` conflict；`ai-proposal-i8t2ay` partial；`ai-proposal-conflict-fixture` conflict
- 任务：`task-UqgGj23BsV` interrupted / not_submitted；`task-kEuJ1i02YC` unknown / remote `remote-4d2-recovery-1`

完整机器可读记录见 `docs/ai-handover/stage4d2-browser-evidence.json`。

### 4D.2.1 三项收口

1. **`studio_store` 读取失败 fail-closed**
   - `localforage-storage.ts` 的 `studio_store` 分支只读 IndexedDB 权威副本；读取失败抛错、置 `studioStoreReadFailed`、派发 `lihuo:studio-store-read-blocked`，不再回退 localforage / localStorage。非 `studio_store` 键仍保留既有回退。
   - `use-studio-store.ts` 增加 `hydrationError`；`onRehydrateStorage` 出错时保留错误并进入只读暂停态；`refreshStudioStoreFromPersistence()` 失败时返回 `false`；`persistStudioStoreNow()` 与 `ensureStudioMigrated()` 在 `hydrationError` 下拒绝写入 / 迁移，避免空项目覆盖 IndexedDB。
   - 3002 页面真实测试：包装 `IDBObjectStore.prototype.get`，仅对 `app_state` 的 `lihuo:studio_store` 抛错；`refreshStudioStoreFromPersistence()` 返回 `false`，`hydrationError` 为注入原因，`persistStudioStoreNow()` 返回 `{ok:false, error:"工作区读取失败，已暂停写入；请先重新读取"}`；页面显示“工作区读取失败”Alert，写入被暂停。读取恢复后 `refresh` 返回 `true`，错误清除；刷新页面后正式项目 `删除前修改-4D2` 正常载入。
   - 测试前在 `localStorage` 人为写入 `LOCALSTORAGE-FALLBACK` 旧值；读取失败期间页面未出现该值，证明没有回退。测试后已删除该标记。
   - 本次未新增读取失败截图：BUA 截图接口返回 `The BUA page viewport is unavailable for screenshot capture`，因此以页面 DOM 文本与返回值作为证据，不伪造截图。
2. **第一轮跨标签页证据矛盾修正**
   - 3000 第一轮记录写 A 改为 `A-守卫2`、最终 IDB 为 `B-守卫2` 且称是 A 的更新；两者无法对应，且没有当时的写结果与 updatedAt。该记录标记为 **invalidated**，不再作为“B 陈旧写被拒绝”的通过证据。3000 当前 IDB 标题 `B-守卫2` 仅保留为历史事实。
   - 3002 用当前代码重跑：两个标签页基线 `删除前修改-4D2` / `13:17:50.996Z`；A 写 `4D21-重跑A-证据2` 成功，store / IDB 均为 `14:06:19.020Z`；B 持旧时间戳写 `4D21-重跑B-陈旧覆盖`，内存保留 B 标题，IDB 保持 A 标题，B 显示「工作区尚未保存」Alert；A 恢复原标题后 project updatedAt 为 `14:07:08.908Z`，B 刷新后显示原标题且 Alert 消失。详细字段见证据 JSON 的 `concurrency.sameProjectMetadata.rerun3002`。
3. **快照删除包装重复与并发测试**
   - `stage4d2-core-check.ts` 新增 7 组 `commitStoryboardSnapshotDiscard` 事务语义测试：成功删除 backup 且正式版本 / formal 不变；同一快照重复删除被拒；project updatedAt 陈旧被拒；episode updatedAt 陈旧被拒；formal 快照拒绝删除；两个不同快照并发删除只有一方成功；同一快照并发删除只有一方成功。
   - 这些测试用内存 `StudioStateStore` 模拟事务内 compare-and-write，覆盖 `nextRaw` / `verify` 路径；它们不等于真实浏览器 IndexedDB 并发，报告中不把 Mock 写成真实 C/D 级验证。

## 三、代码修复与行为

### 1. 跨标签页项目元数据守卫

`studio-store-persistence.ts` 新增模块级 `observedProjectUpdatedAt`、`observeStudioStoreRaw()`、`assertNoStaleProjectMetadata()`：

- 当前 IndexedDB 某项目的 `updatedAt` 与本标签页最近观察值不同，拒绝整仓写入；
- 拒绝删除另一标签页新建的项目；
- `readRaw()` 成功后观察；`transact()` 只在写入成功并提交后观察，避免读取后立即观察掩盖并发；
- `localforage-storage.ts` 的正式写入守卫之后调用项目元数据守卫；`getItem` 成功后观察。

`pages/drama/index.tsx` 监听 `lihuo:studio-store-write-blocked` 后不再自动刷新丢弃内存修改，而是显示 AntD Alert「工作区尚未保存」、原因、「重试保存」「重新读取」按钮；toast 用固定 key 去重。`use-studio-store.ts` 新增 `persistStudioStoreNow()`，重试仍走整仓守卫。

4D.2.1 追加读取失败保护：`studio_store` 读取失败时 `localforage-storage.ts` 不回退 localStorage，`use-studio-store.ts` 设置 `hydrationError` 并暂停 `persistStudioStoreNow` / `ensureStudioMigrated`，页面显示「工作区读取失败」Alert，只保留「重新读取」；读取成功后清除错误并恢复正式数据。

### 2. 任务提交与卸载恢复

原 `use-studio-tasks.ts` 把 running / queued / pending / retrying 一律标 `failed`，无法区分远端是否已接受。现改为：

- `StudioTask` 增加 `submitting`、`interrupted` 状态及 `submitState`、`submitStartedAt`、`submitConfirmedAt`、`modelSnapshot`、`promptVersion`。
- `start` 先创建 `submitting` 任务并等待 `lihuo:studio_tasks` 落盘，成功后才入队；落盘失败不提交远端。
- `pump` 进入 running 且 `submitState:"submitting"` 时先落盘，再调用 runner；收到 remote 后写 `submitted` / `submitConfirmedAt`。
- rehydrate 使用 `recoverInterruptedTask()`：running / submitting 或已有 remote → `unknown`，禁止自动重试；queued / pending / retrying 且无 remote → `interrupted`，允许用户显式重新执行。
- hydration 合并当前内存任务与持久化任务，避免晚到的 hydration 覆盖刚创建的任务。
- 任务中心：unknown 显示「确认重试」并二次确认“可能重复提交 / 重复扣费”；interrupted 显示「重新执行」；submitting / running / queued 显示取消；详情显示模型与 prompt 快照。
- `production-actions.ts` 的 `taskInput` 增加 `promptVersion` 与 `modelSnapshot`（channelId / modelId / label）。

### 3. 数据与操作保护

- 先备份 `proj-UORILWcK` 并验证可读。
- 故障注入仅在 3002 隔离 Origin / 隔离项目执行；未直接修改正式 `app_state` 构造故障。
- 未修改全局 `AiConfig`、Doubao Bridge、外部正式后端、无限画布核心。
- 未执行 commit / push / reset / clean / stash / checkout。
- `web/public/stage4d2-backup.json` 为测试辅助副本，应在交付后删除；不得作为产品资源。

## 四、自动化与构建

| 命令 | 结果 |
| --- | --- |
| `node scripts/vite-ssr-check.mjs scripts/stage3_2_2-core-check.ts` | 通过（55 例；直接 `npx tsx` 因 `import.meta.env` 在 Node 下不可用而报错，属于运行器差异） |
| `npx tsx scripts/stage4a-core-check.ts` | 9 groups passed |
| `npx tsx scripts/stage4b-core-check.ts` | 8 groups passed |
| `npx tsx scripts/stage4c-core-check.ts` | 19 rules, 26 groups passed |
| `npx tsx scripts/stage4c1-core-check.ts` | 11 identity + 32 action-phase + 8 assertions + 15 direction + 9 engine + 18 state + 12 async + 9 snapshot groups passed |
| `npx tsx scripts/stage4d-core-check.ts` | 4 P1 regression groups, AI parse groups, proposal isolation/protection groups, persistence groups passed |
| `npx tsx scripts/stage4d2-core-check.ts` | `{"ok":true,"tasks":7,"metadataGuards":3,"snapshotDiscards":7}` |
| `node scripts/vite-ssr-check.mjs scripts/stage4d-action-check.ts` | shot/episode/selection review, failed run persistence, proposal apply, version conflict, same-batch second conflict, conflict, manual protection, reject, storage failure passed |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0；Vite 7.3.6；仅有既有的 dynamic/static import 与 chunk 体积 warning |

## 五、未完成项、风险与替代方案

### 1. 原始 live 项目 A 不可恢复

- 技术原因：原数据在旧浏览器会话被误写 `app_state` out-of-line key 时丢失，浏览器数据和备份中没有原始项目字节。
- 已尝试：检查 IndexedDB、浏览器数据目录、五个导出、历史备份与聊天记录。
- 当前风险：任何声称“恢复原始 A”的说法都是伪造；原始 run / proposal 无法再核对。
- 替代方案：保留 `proj-UORILWcK` 恢复项目、3000 替代项目与 3002 隔离项目，报告中永久区分；后续验收使用替代项目。

### 2. 真实磁盘配额耗尽未复现

- 技术原因：CDP `Storage.overrideQuotaForOrigin` 能让 `getUsageAndQuota` 返回 `quota:0`，但 IndexedDB 写入仍成功；没有安全方式在不破坏用户磁盘的情况下真实耗尽配额。
- 已尝试：隔离 Origin 包装 `put` 抛出 `QuotaExceededError`，实际触发 `IDBTransaction.abort()`；记录 `abortCalls=1`、`rawChanged=false`、UI 失败与刷新一致。
- 当前风险：真实磁盘满时浏览器底层错误路径 / 配额提示可能与注入异常文本不同；但事务 abort 后的数据与 UI 行为已验证。
- 替代方案：保留该隔离事务注入测试，并在报告中明确“真实事务 abort，非真实磁盘配额耗尽”；增加浏览器 QuotaExceededError 监听和统一失败提示作为后续小项。

### 3. 提案 vs 正式分镜：pending 夹具已执行，真实 AI 提案仍待额度

- 技术原因：替代项目没有真实 pending 提案；现有提案是 partial / conflict。生成新提案需要真实模型调用并消耗账号额度，未经用户同意不做。
- 已尝试：检查 `storyboardReview.proposals`；基于现有 conflict 提案克隆 `ai-proposal-4d2-pending-fixture`，只改 ID / 版本 / 决策状态，变更内容仍为已验证的 `shot-1yqjpid / cameraMovement`，通过 `planProposalChanges` 校验后写入隔离项目。A 标签应用该提案、B 标签同时提交 `shot-1xwkwfg` 正式修改：B 成功 v16，A 返回冲突并持久化 `ai-apply-bIXnkwJ7hz`，未覆盖 B。
- 当前风险：真实双标签页机制已验证，但提案是**夹具**，不是模型返回；模型生成的真实 pending 提案在同一竞态下仍需复核。不能把夹具测试写成真实 AI 提案验收。
- 替代方案：用户确认可用一次真实 AI 审核生成 pending 提案后，在同一 3002 隔离项目复跑；或保留该夹具测试作为回归，不消耗额度。

### 4. 快照包装层一次拒绝（未复现）

- 技术原因：`discardStoryboardSnapshot` 曾返回“项目已被其他操作更新”，当时同页 store / IDB 时间戳看起来一致；直接 `commitStoryboardSnapshotDiscard` 使用相同时间戳成功。之后同一包装调用成功，未能复现。
- 已尝试：对比 store 与 IDB updatedAt、直接底层事务、B 标签陈旧写入拒绝、A 包装层重试删除 `sbs-1nn2d7h`（成功）。
- 当前风险：无法排除短暂的 store / raw 同步差；当前 fail-closed 行为会要求刷新，但没有证据说明会丢数据。不能写成已确认产品 bug。
- 4D.2.1 已补 7 组 `commitStoryboardSnapshotDiscard` 事务语义测试，覆盖成功、重复、project / episode 陈旧、formal 拒绝与并发双删；但包装层那次拒绝仍未归因，测试不能替代真实浏览器包装层复现。
- 替代方案：保留该观察记录；后续如再次出现，在 `discardStoryboardSnapshot` 前后打印 store / raw project / episode updatedAt 定位；不放宽现有守卫。

### 5. 任务恢复无远程查询 / 幂等键

- 技术原因：当前后端不提供任务查询或幂等键；客户端无法确认远端是否已接受。
- 已尝试：提交前落盘、`submitting` / `unknown` / `interrupted` 状态、刷新 / 关闭标签 / 新标签读取；running 任务标 unknown，不自动重试。
- 当前风险：unknown 重试可能重复提交 / 重复扣费；UI 已二次确认，但不能保证后端幂等。
- 替代方案：后端补任务查询与 `idempotencyKey` 后再实现自动恢复；当前只允许用户明确确认重试。

## 六、交付物

- 报告：`docs/ai-handover/DRAMA_STUDIO_STAGE4D_2.md`
- Diff：`docs/ai-handover/DRAMA_STUDIO_STAGE4D_2.diff`（11 个 4D.2 / 4D.2.1 触碰文件，+5626 / −244，321,833 bytes；新文件为整文件 diff，tracked 文件包含此前未提交的 guard / UI 段落与 4D.2.1 读取失败保护；`git apply --reverse --check` 通过）
- 机器可读证据：`docs/ai-handover/stage4d2-browser-evidence.json`
- 截图：`stage4d2-stale-tab-blocked.png`、`stage4d2-real-idb-failure-ui.png`、`stage4d2-task-recovery.png`、`stage4d2-replacement-project.png`
- 备份：`docs/ai-handover/backups/stage4d2-proj-UORILWcK-backup.json`
- 4D.1-FINAL 报告：`docs/ai-handover/DRAMA_STUDIO_STAGE4D_1_FINAL.md` / `.diff`

本阶段不进入 Stage 4E。
