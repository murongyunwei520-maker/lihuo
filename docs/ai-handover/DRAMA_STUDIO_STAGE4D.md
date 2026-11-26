# Stage 4D：AI 分镜审核、调整提案与安全应用

> 后续 Stage 4D.1 已补做过期提案冲突、默认不选中、AI 证据范围和武器取得动作，并完成真实 AI / 真实提案主路径浏览器验收。本报告保留 4D 基线状态；4D.1 增量见 `docs/ai-handover/DRAMA_STUDIO_STAGE4D_1.md` 与同名 `.diff`。

状态：**主体代码、自动化测试、故障注入测试、类型检查、生产构建已完成；真实浏览器已验证 AI 审核失败记录持久化、锁定 / 解锁持久化、AI 审核 Drawer 与历史记录读取、reload hydration 修复。真实 AI 成功路径、真实提案应用 UI、真实版本冲突 UI、真实持久化失败 UI、页面卸载恢复、原始 live 项目 A、跨标签页并发和真实 IndexedDB 故障注入尚未验证；等待用户审查**。

本轮没有进入 Stage 4E，没有新增第六步，没有修改正式外部后端、`doubao-bridge`、全局 `AiConfig`、无限画布核心，没有自动提交或推送。

## 0. 结论

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 4C.1 人物绑定遗漏修复 | 已实现；自动化测试通过 | 双人 / 三人 / 部分绑定 / 正确绑定 / 无提及 |
| 4C.1 人物名称最长匹配与动作主体歧义 | 已实现；自动化测试通过 | 名称包含、重名双 ID、同分句多人、方向主体不明确 |
| 4C.1 动作阶段回归 | 已实现；自动化测试通过 | 32 个表驱动用例 + 补充断言；受击反应与主动后退分开 |
| 4C.1 武器明确消失 / 未知 | 已实现；自动化测试通过 | 保留、更换、明确空手、收剑、未知、空手取得武器 |
| 审核持久化与版本安全 | 已改为 IndexedDB 事务确认；自动化与真实浏览器部分通过 | `commitReviewState`、锁 / 解锁真实 IDB、失败 run 真实落库 |
| AI 分镜审核 | 已实现；action 层测试通过 | 单镜、选中、整集；4C 结果作为输入；失败记录保留 |
| 调整提案与局部应用 | 已实现；action 层测试通过 | 接受 / 拒绝 / 局部接受、版本冲突、人工保护、备份 + 正式快照 |
| AI 审核 Drawer | 已接入；真实浏览器已验证失败态与历史读取 | 失败 run、历史记录、提案区、应用记录、旧版本记录 |
| 类型检查 | 通过 | `npm run typecheck` exit 0 |
| 生产构建 | 通过 | Vite 7.3.6，8315 modules，exit 0 |
| Git 提交 / 推送 | 未执行 | 遵守禁止自动提交 / 推送的要求 |

**不能把自动化或 Mock 等同于真实浏览器验收。** 本报告第 5.4 节单独列出未验证边界，未混入“测试全部通过”。

## 1. 修改范围与保护

修改前未执行 `git reset`、`git checkout`、`git stash`、`git clean`，没有删除用户已有文件，没有回滚或覆盖其他未提交修改，没有自动提交或推送。

代码只涉及短剧 Studio、审核持久化、第四步 UI 和测试脚本：

修改文件：

- `web/src/lib/studio/continuity-engine.ts`
- `web/src/types/studio-production.ts`
- `web/src/lib/studio/review-engine.ts`
- `web/src/lib/studio/review-actions.ts`
- `web/src/lib/studio/production-actions.ts`
- `web/src/lib/studio/production-ai.ts`
- `web/src/lib/studio/storyboard-write-protocol.ts`
- `web/src/lib/studio-store-persistence.ts`
- `web/src/stores/use-studio-store.ts`
- `web/src/pages/drama/studio/continuity-panel.tsx`
- `web/src/pages/drama/studio/review-workspace.tsx`
- `web/src/pages/drama/studio.css`
- `web/scripts/stage4c1-core-check.ts`

新增文件：

- `web/src/lib/studio/review-persistence.ts`
- `web/src/lib/studio/stage4d-engine.ts`
- `web/src/lib/studio/review-ai.ts`
- `web/src/lib/studio/stage4d-actions.ts`
- `web/src/pages/drama/studio/ai-review-panel.tsx`
- `web/scripts/stage4d-core-check.ts`
- `web/scripts/stage4d-action-check.ts`
- `web/scripts/vite-ssr-check.mjs`

未修改正式外部后端、`doubao-bridge`、全局账号行为、模型配置结构和旧画布逻辑；没有新增工作流步骤。

## 2. 4C.1 四项遗留 P1 修复

### 2.1 人物绑定遗漏

`characterBindingGaps()` 现在：

- 扫描当前镜头文本中所有能在剧本注册表确认出现的人物，不只检查已绑定的人物；
- 排除姓名与 `characterId` 都正确绑定的当前镜头人物；
- 对仍出现在文本中但未绑定的人物逐个生成 `characterBindingGaps`；
- 不把整集 / 全剧人物自动注入每个镜头，不因已绑定一个人物就忽略其他人物。

同时修复 `addGap()` 去重键：原键为 `ruleId + shotIds + fieldPath`，同一镜头多个漏绑人物共用 `characterBindings` 路径时会只保留第一条；现改为 `ruleId + shotIds + fieldPath + reason` 都相同才去重。

测试覆盖：双人、三人、部分绑定、全部正确绑定、只提及未绑定人物、无人物提及、同一镜头多个漏绑人物。

### 2.2 人物名称匹配与动作主体

新增 `mentionedNameEntries(text, names)`：所有注册表名称按长度降序构造匹配，保证“林月”优先于“林”；`findName()`、`nameOccursInSegment()` 复用该结果。

`deriveMovement()` 新增 `movementActor()`：

- 单人物镜头：直接以该人物为动作主体；
- 多人物镜头：只有方向词所在同一分句内能唯一确认一个人物时，才认定主体；
- 同分句多人、或方向词所在分句没有人物：标记 `source: "ambiguous"`，`characterId` 为空，证据说明无法确认执行者；
- `ambiguous` movement 不参与方向 / 归属判定，不擅自认定动作执行者。

测试覆盖：名称包含关系、同名两个 ID、简称与完整名、多人物同句、多人物动作主体不明确。

### 2.3 动作阶段识别回归

`parseActionPhase()` 恢复受击反应识别：

- `踉跄 / 趔趄 / 闷哼 / 痛呼 / 吃痛 / 吐血 / 喷血` → `reaction`；
- 普通主动 `后退 / 后撤 / 退后` → `backward`，不返回 `reaction`；
- `被击退 / 击退 / 震退 / 打退 / 逼退` 在普通方向词之前判定为 `knockback`。

测试覆盖“击中”“被击中”“受击后踉跄”“主动后退”和普通方向 / 受击方向的正反例。

### 2.4 武器明确消失与未知

`CharacterDraft.weaponPropId` 与 `StudioContinuityCharacterState.weaponPropId` 改为 `string | null`：

- `string`：明确持有该武器；
- `null`：明确空手 / 已收起；
- `undefined`：没有记录武器信息，不能推断为消失。

`evaluatePair()` 的武器比较：

- 上一镜有武器、当前 `undefined`：生成信息不足 gap，明确“不能判定消失”；
- 当前 `null` 且没有收剑 / 归鞘 / 放下 / 丢弃 / 空手等动作：生成武器消失 warning；
- 两个不同武器 ID：生成武器更换 warning；
- 上一镜 `null`、当前有武器：生成“无取得动作，信息不足” gap；
- 双方 `null` 或同 ID：无变化。

测试覆盖武器保留、武器更换、明确消失、收剑、信息未知、空手取得武器、双方空手。

## 3. 审核持久化与版本安全审查

### 3.1 不再用 Zustand 内存回读冒充持久化

新增 `web/src/lib/studio/review-persistence.ts` 的 `commitReviewState()`：

- 在 Web Lock + 单个 IndexedDB `readwrite` 事务内读取权威项目；
- 校验 `expectedStoryboardVersion`、项目 / 分集存在、正式分镜存在；
- 执行审核 plan；
- 校验正式版本未变、正式分镜叙事内容 hash 未变、项目 / 分集数量未变、其他分集正式版本未变；
- 写回后回读，执行调用方的 `verifySaved`；
- 成功返回持久化后的 `projects`；失败返回明确错误，不返回成功。

`storyboard-write-protocol.ts` 新增 `withStudioWriteLock()`，审核元数据和正式分镜写入共用 `lihuo:studio-storyboard-write` 锁；不支持 Web Locks 时使用进程内队列，最终仍由 IndexedDB 事务守卫。

`review-actions.ts` 的 `refreshStoryboardReviewAction`、`setStoryboardShotReviewAction`、`reReviewStoryboardShotsAction`、`setStoryboardShotLocksAction` 全部改为 `async`，事务内重新 plan 并回读校验；UI 已全部 `await`，成功文案明确“已写入本地数据库”。

### 3.2 锁定持久化的 P1 修复

审核事务原用全量 `storyboardContentHash` 比较，但锁定会修改 `shot.locked`，导致锁定写入永远失败。现：

- `studio-store-persistence.ts` 导出 `storyboardNarrativeHash()`，复用 `guardStoryboardHash`，忽略 `shot.locked` 与 `group.reviewedByUser`；
- `commitReviewState` 用叙事 hash 校验审核写入；
- 正式分镜写入仍使用全量 `assertNoStaleFormalWrite` 守卫，不降低正式写入安全。

真实浏览器已验证：第 1 镜锁定成功，`version:14`、`locked:["shot-1yqjpid"]`；解锁后 `locked:[]`，正式分镜仍为 v14。

### 3.3 reload hydration 竞态 P1 修复

真实浏览器 reload 曾出现：

```text
StudioStateVerificationError: 正式项目被整仓写入删除：proj-stage322-f6
```

定位为 `ensureStudioMigrated()` 在 Zustand 异步 hydration 完成前运行；`migrateLegacyStore()` 看到空 `projects` 并尝试整仓写入，守卫阻止了真实删除。

修复：

- `use-studio-store.ts` 新增 `waitForStudioHydration()`；
- `ensureStudioMigrated()` 先等待 `hydrated`；
- `migrateLegacyStore()` 自身在未 hydrated 时直接返回。

真实浏览器 reload 后该错误消失；IDB 中 `proj-stage322-f6`、`proj-stage4c-snap-1795573351974`、`proj-stage4c-del-1795573351974` 三个项目均在，未发生项目丢失。

### 3.4 当前持久化边界

- `commitReviewState` 的成功含义是“IndexedDB 事务已提交并回读校验通过”，不是“界面已经刷新”；
- 事务失败、回读失败、版本冲突均返回 `persisted:false`，UI 不显示成功；
- 真实 IndexedDB 故障注入仍**未执行**；Mock store 抛错只证明代码分支，不等同浏览器真实故障；
- 当前没有页面卸载期间审核写入完成的专项真实浏览器验证。

## 4. Stage 4D 功能实现

### 4.1 数据模型

`studio-production.ts` 新增：

- `StudioAiReviewFinding`：级别、类别、消息、原因、建议、对应镜头、字段路径、证据、证据类型、置信度、推测标记；
- `StudioAiReviewRun`：runId、分集、正式版本、范围、连续性检查 ID、状态、摘要、findings、warnings、prompt 版本、模型 trace、错误、时间；
- `StudioAiProposalChange`、`StudioAiProposalDecision`、`StudioAiProposalApplication`、`StudioAiAdjustmentProposal`；
- 提案记录 `sourceScriptVersion` / `sourceScriptId`；
- `StudioStoryboardReview` 增加 `aiReviewRuns`、`proposals`、`proposalApplications`；
- 正式写入操作类型增加 `ai_proposal_apply`；
- `StudioProductionShot` 增加 `manualEditedAt`、`manualEditedFields`。

### 4.2 AI 审核输入与输出

`review-ai.ts`：

- 审核输入包含当前正式分镜、剧本相关场景、选中镜头与真实相邻镜头、4C 连续性报告和已有确定性 issues；
- 审核范围：人物一致性、场景、动作、空间关系、轴线、视线、道具、情绪、对白、镜头衔接；
- system prompt 强制 JSON、不得改 ID / 绑定 / 版本 / locked / manual 标记、duration 4–15 秒、无证据降级；
- `parseStoryboardAiReview()` 校验 findings 的对应镜头归属；对整集审核没有对应镜头的问题直接丢弃，不再强行归到第一镜；单镜审核才允许归到唯一镜头；
- 模型声称 `shot_text / script_text / continuity_report` 的证据必须在实际输入语料中出现，否则降级为 `inference + speculative`；
- proposals 逐条校验字段白名单、人工保护、`before` 当前值精确匹配、`after` 非空且不同、duration 范围；非法项写 warnings，不进入正式提案。

### 4.3 调整提案

`stage4d-engine.ts`：

- 字段白名单：景别、机位、角度、镜头、运镜、构图、前中后景、调度、视线、动作、表情、情绪、旁白、音效、音乐、光线、环境、图片 / 视频 prompt、时长、对白文本 / 表演 / 情绪；
- `dialogue[N].text / delivery / emotion` 支持多种索引写法；
- 应用计划只应用用户选中的 changeId；同字段重复修改整体拒绝；任一修改失败整体拒绝；
- 保留人物、场景、道具 ID 与镜头归属，不因提案改变绑定；
- 人工编辑过的镜头整体保护；`manualEditedFields` 覆盖的根字段单独保护；
- `proposalDependencyError()` 同时校验分镜版本、来源剧本版本、当前正式剧本版本和来源剧本 ID。

### 4.4 安全应用

`applyAiProposalAction()`：

- 只允许 pending 提案；
- 预检分镜版本、剧本依赖、字段白名单、人工编辑、`before` 值；
- 冲突时记录 `conflict`，不写正式分镜；
- 合法时调用 `commitFormalStoryboardWrite()`，`operationType: "ai_proposal_apply"`、整份文档 scope、`expectedVersion = proposal.storyboardVersion`；
- 事务内再次校验版本、剧本依赖、字段、人工编辑和 `before`；
- 新版本为 `current + 1`，同时写入应用前 backup 快照与 formal 快照；
- 重跑全集连续性检查，更新审核状态；
- 更新 proposal decision（accepted / partial），写 `StudioAiProposalApplication`；
- `afterWrite` 回读验证审核记录、application、decision；
- 版本冲突、应用失败、拒绝均保留记录。

`rejectAiProposalAction()` 只允许 pending 提案拒绝，更新决策并事务写入、回读校验。

### 4.5 审核 UI

`ai-review-panel.tsx`：

- header / 批量栏提供「AI 审核」「AI 审核选中」，Drawer 内提供「整集审核」；
- 展示当前版本最新 AI run、findings、推断标签、证据类型、对应镜头；
- 展示待决策提案、每项修改的 checkbox、before / after、原因、影响；
- 应用前弹出确认层，明确正式版本递增、保存备份、重跑检查，以及同批其他 pending 提案不会自动合并；
- 支持拒绝提案，展示已决策历史、应用记录、历史 AI 审核记录；
- 历史记录包含同版本较早 run 和旧版本 run，显示状态，均不冒充当前审核。

## 5. 测试与审查

### 5.1 自动化测试通过

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0，Vite 7.3.6，8315 modules |
| `stage4d-core-check` | 4 个 P1 回归组、AI 解析组、提案隔离 / 保护组、持久化组通过 |
| `stage4d-action-check` | 单镜 / 选中 / 整集审核、失败 run 持久化、提案应用、同批第二个旧版本提案显式冲突、版本冲突、人工保护、拒绝、存储失败通过 |
| `stage4c1-core-check` | 人物 11 组、动作 32 例 + 8 断言、方向 15 例 + 9 引擎例、状态 18 例（9 对）、异步 12 组、快照 9 组通过 |
| `stage4a-core-check` | 9 组通过 |
| `stage4b-core-check` | 8 组通过 |
| `stage4c-core-check` | 19 条规则、26 组通过 |
| `stage3_2_1-core-check` | JSON `ok:true` |
| `stage3_2_2-core-check` | 55 例通过（Vite SSR） |

`stage4d-action-check` 通过 `web/scripts/vite-ssr-check.mjs` 运行，因为真实 action 链依赖 `import.meta.env` 和 Bridge 模块；直接 `tsx` 会在模块初始化阶段失败。

### 5.2 Mock / 故障注入测试通过

以下只证明代码分支和事务语义，不等同真实浏览器：

- `commitReviewState`：事务成功、回读失败回滚、版本冲突、锁定允许、叙事内容拒绝、事务失败、归一化上限；
- 提案应用：fake `StudioStateStore` 上版本 +1、backup + formal 快照、连续性重跑、审核记录更新、application applied、decision accepted；
- 版本冲突：正式版本不变，proposal decision / application 记录 conflict；
- 人工编辑保护：应用失败记 failed，正式内容不变；
- 存储失败：`transact` 抛“配额不足”时，提案应用与 AI 审核均返回 `persisted:false`，正式 v3 不变；
- 多提案隔离：纯函数层面接受一个提案不会应用其他提案的 change；action 层面同批第二个仍绑旧版本的提案明确判 conflict，正式版本保持 +1 后不变；
- `stage4d-core-check` 顶部的内存 `localStorage` 仅用于 Node 模块初始化，不代表浏览器持久化。

### 5.3 真实浏览器操作通过

浏览器页面：`http://127.0.0.1:3000/drama?project=proj-stage4c-snap-1795573351974&episode=ep-GHduqaBp&step=review`；隔离项目「Stage 4C 快照丢弃隔离项目 1795573351974」，第 1 集 `ep-GHduqaBp`。

已验证：

- 「AI 审核」Drawer 打开；Bridge 不可用时显示“无法读取 Bridge 账号列表，已阻止本次分析：Failed to fetch”，并显示“失败记录已保留”；
- 真实 IDB 中该集 review 保留 3 条失败 run：`ai-review-LhDAT5dGWp`（shot）、`ai-review-kVdrQ6Pr0l`（selection）、`ai-review-6Sto9uofXY`（episode），均为 v14、status `failed`；
- 当前版本 v14 的 Drawer 显示最新失败 run；历史 AI 审核记录显示 2 条较早 run；页面 DOM 读取为“历史 AI 审核记录（2）— 不冒充当前审核”；
- 第 1 镜 `shot-1yqjpid` 批量锁定成功，IDB `version:14`、`locked:["shot-1yqjpid"]`；解锁后 `locked:[]`、`reviewVersion:14`，正式分镜未变；
- reload 后不再出现 `StudioStateVerificationError: 正式项目被整仓写入删除：proj-stage322-f6`；IDB 仍为 `proj-stage322-f6`、`proj-stage4c-snap-1795573351974`、`proj-stage4c-del-1795573351974` 三个项目；
- 失败 run 截图：`docs/ai-handover/stage4d-ai-review-failure.png`。

说明：测试会话中 Ant Design Drawer 的打开过渡在浏览器工具里停在 offscreen（DOM 已创建、文字可读，截图只捕获背景）；早期同一版本 Drawer 的可见截图仍为 `stage4d-ai-review-failure.png`。这不改变 IDB 与 DOM 验证结果，但不能据此声称本轮重新截到了可见的新历史面板。

### 5.4 尚未实际验证

以下边界继续保持“未验证”，不能因自动化通过而升级：

1. 真实 AI 审核成功路径：Bridge 可用、真实模型返回 findings / proposals、真实耗时与截断处理；
2. 真实提案接受 / 拒绝 / 局部接受 UI：真实按钮、确认层、提案卡片；
3. 真实提案应用后的 IDB 备份 + formal 快照、版本递增、连续性重跑、审核记录更新；
4. 真实版本冲突 UI 和真实持久化失败 UI；
5. 页面卸载 / 刷新期间 AI 审核或提案应用的结果恢复；
6. 原始 live 项目 A；当前 3.2.2 E 组读取的是导出副本，不是原始 live 项目；
7. 跨标签页并发审核 / 提案应用；
8. 真实 IndexedDB 故障注入；Mock `transact` 抛错不等同真实配额 / 磁盘故障；
9. 同版本多个 AI run 的可见历史面板本轮未重新截图；只读 DOM 确认记录存在。

4C.1 遗留的 FINAL1 真实 IndexedDB 故障注入仍未执行，不能并入“全部通过”。

## 6. 已知限制与风险

1. **多个 pending 提案按版本安全优先**：同一轮生成的多个提案都绑定同一正式版本；应用第一个后正式版本 +1，第二个仍绑定旧版本的提案会明确判为版本冲突，不会自动 rebase 或静默合并。这是保守的版本安全行为，符合“不静默覆盖”，但不满足“同批多提案一键连续应用”的便利预期；如业务要求同批应用，应另立批量提案设计，在事务内一次性校验所有 change。
2. **AI 结果仍是建议**：findings / proposals 由模型生成，UI 明确标记输入证据 / 推断与置信度；应用必须经过用户确认和字段 / 版本 / 人工保护校验。
3. **审核 UI 的历史范围**：当前版本只展示最新 run，较早 run 进入“历史 AI 审核记录”；同版本较早成功 run 不会被提升为当前审核，也不冒充当前版本。
4. **真实失败反馈**：代码和 Mock 已覆盖失败返回，但没有在浏览器中真实制造 IndexedDB 配额 / 磁盘失败，不能宣称失败 UI 已实机验证。

## 7. Diff 与文件

Diff：`docs/ai-handover/DRAMA_STUDIO_STAGE4D.diff`

统计：21 个文件，+3670 / −246。

本次 Diff 的旧侧由 4C.1 完成态基线生成；`studio.css` 旧侧取 4C 基线（4C.1 未改 CSS），`use-studio-store.ts` 与 `studio-store-persistence.ts` 的 4D 增量通过移除新增 hydration 等待 / 公开 narrative hash 还原旧侧。Studio 相关文件大多仍未跟踪，不能依赖 Git 提交历史生成旧版本。

## 8. 未完成事项

- 真实 AI 成功路径与真实提案应用 UI 的浏览器验收；
- 真实版本冲突 UI、真实持久化失败 UI、页面卸载恢复；
- 原始 live 项目 A、跨标签页并发、真实 IndexedDB 故障注入；
- 用户验收后，才可把 4D 功能写入正式功能说明。

本阶段只完成 Stage 4D，不开始 Stage 4E。
