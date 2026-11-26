# 离火 AI 短剧工作室 · Stage 4 第一阶段修复报告

状态：**代码修复完成；确定性测试通过；未执行真实 AI 调用、真实浏览器验收与真实 IndexedDB 并发验证。**

本轮只做 Stage 4 第一阶段修复，不进入 4E/4F：没有实现预览图、版本管理、全量版本 diff、历史版本恢复 UI、第五步最终交接 UI，也没有改造视频链路。

## 1. 结论摘要

- 4A 已统一为**严格版本过期**：正式分镜版本变化后，所有绑定旧版本的审核记录一律 stale；内容哈希只用于差异解释，不再覆盖版本过期。
- 4A 的统计、九宫格、列表、Drawer、审核历史、批量审核、重新审核、ready 判定都从 `effectiveShotReviewStatus / reviewStats / buildStoryboardReviewReadiness` 这一条链读取，不再各自判断。
- 4D 已补齐 Prompt 检查范围、证据四分类、提案独立证据字段、unknown/空证据阻断、旧 pending 自动 conflict、项目资产 ID 校验和领域记录上下文。
- 任务状态已增加 `cancelling`，写入统一为 `cancelled`，保留 `canceled` 作为旧数据读取兼容；刷新时 `cancelling` 不会被冒充为已取消。
- 4B 的审核列表已补 suggestion 统计；Drawer 已展示人物/服装/场景/道具绑定 ID 与变体，并标记旧版本审核历史。
- 27 个文件发生变更（+1404 / −134）。全部确定性测试、`typecheck`、`build` 通过。
- **Stage 4 仍不能整体完成**：4E/4F 未开始，第五步仍没有审核 readiness 闸门；真实 AI pending 并发、真实浏览器 IndexedDB 并发、真实磁盘配额和后端任务查询/幂等仍未验证。

## 2. 修改清单

### 4A 审核版本链

- `web/src/lib/studio/review-engine.ts`
  - `describeShotReviewStale()` 先判 `record.storyboardVersion !== document.storyboardVersion`，版本不一致直接返回 `version`；只有版本相同才比较内容哈希并返回 `content`。
  - `normalizeStoryboardReview()` 对缺失镜头版本的旧记录写 `-1`，不再继承当前版本；旧记录无法确认版本时必须 stale。
  - `planStoryboardReviewStatus()` 在版本变化时，即使内容哈希一致、即使 `partialOnVersionChange=true`，也按 `version_conflict` 跳过，不允许旧记录写入当前版本。
  - `reviewStats`、`buildStoryboardReviewReadiness`、`planStoryboardReviewReReview` 继续统一走 effective status。
  - 新增 `stampStoryboardReviewContext()`，为 review / issue / audit / AI run / proposal 补项目/分集上下文；review、issue、AI run、proposal 能取到集数时补 `episodeNumber`，audit 至少补 `projectId`。
  - 旧 pending 提案在正式版本变化时自动转 `conflict`；清空 accepted、写全 rejected、`decidedBy=system:version-guard`、`autoConflict=true`，并生成冲突应用记录。
- `web/src/lib/studio/review-persistence.ts`：审核写入事务内统一 stamp 上下文，持久化后不丢项目/分集归属。
- `web/src/lib/studio/production-workspace.ts`：hydration 按项目/分集传入上下文，读入旧数据时同一套版本规则生效。
- `web/src/pages/drama/studio/review-list.tsx`：补 suggestion 统计，只有 suggestion 时不再显示“无”。
- `web/src/pages/drama/studio/review-shot-drawer.tsx`：展示人物、服装、场景、道具稳定 ID 和变体；审核历史标记“当前版本 / 旧版本记录”。
- **未改但必须同源读取**：`web/src/pages/drama/studio/review-grid.tsx`、`review-workspace.tsx` 继续读取 `analysis.statuses`，不另起判断；本轮 Diff 不包含这两个文件。
- `web/src/lib/studio/production-actions.ts`：快照恢复成功后，旧 review 会在下一次读取按版本规则 stale；本轮未新增 4E 预览/版本恢复能力。

### 4D 证据、提案与资产

- `web/src/types/studio-production.ts`
  - 新增 `StudioAiEvidenceType = explicit | inference | suggestion | unknown`；旧 `shot_text / script_text / continuity_report` 只保留读取兼容。
  - `StudioAiProposalChange` 增加必填 `evidence`、`confidence`，可选 `sourceShotIds`、`sourceChapterId`、`sourceVersion`。
  - 审核问题、审核记录、AI run、提案尽量补 `projectId / episodeId / episodeNumber`；audit 记录补 `projectId` 并保留 `episodeId / storyboardVersion`；旧记录缺字段可读，不据此编造归属。
  - 审核分类增加景别、机位、运镜、角色外观、服装连续性。
- `web/src/lib/studio/review-evidence.ts`（新增）：证据类型归一化与中文标签；旧来源映射 explicit，未知/空值映射 unknown。
- `web/src/lib/studio/review-ai.ts`
  - Prompt 版本升级为 `stage4d-storyboard-review-v2`。
  - 检查范围明确要求景别、机位、运镜匹配、运镜连续性、角色外观、服装连续性、服装变体与场景/时间/状态匹配；要求判断字段值与输入是否一致，不只检查“字段有没有填”。
  - 实际模型输入补 `outfitBindings`，Prompt / evidenceCorpus / 解析使用同一份审核输入视图。
  - 证据四分类落地；explicit 必须能在实际发送的输入中找到，找不到降为 inference；空证据和 unknown 保留为 unknown，不再降级成低置信度 inference。
  - 提案 change 解析补齐 evidence、evidenceType、confidence、speculative、sourceShotIds、sourceChapterId、sourceVersion，并补 projectId / episodeNumber。
- `web/src/lib/studio/stage4d-engine.ts`：新增 `proposalChangeEvidenceError()`；空证据、unknown 一律阻断应用，旧提案缺证据同样走拒绝路径。
- `web/src/lib/studio/stage4d-actions.ts`
  - 提案应用 preview 和事务内都调用项目资产引用校验，失败写入 failed 记录并保留正式分镜。
  - 应用后 review 统一 stamp 上下文；冲突提案返回 `conflict=true`，不会被当成普通失败。
- `web/src/lib/studio/storyboard-asset-validation.ts`（新增）：共享资产引用校验，按 `StudioAsset.kind` 校验人物、服装、场景、道具、镜头组、镜头组成员、对白人物；只按稳定 ID，不按名称匹配，不静默清空。
- `web/src/lib/studio/production-actions.ts`：`applyStoryboardSnapshot` 在正式写入前校验资产引用，失败不写正式版本。
- `web/src/pages/drama/studio/ai-review-panel.tsx`：展示证据类型/正文/置信度/来源；unknown 修改项禁用勾选，全选自动过滤不可应用项，应用前再次过滤。

**已知数据约束**：项目资产是扁平 `StudioAsset`，没有独立服装变体表或场景变体表。`outfitId` 按服装资产 ID 校验；`locationVariantId` 只能保留在绑定和 Prompt 中，当前无法验证变体存在性，已列入风险。

### 任务状态

- `web/src/types/studio.ts`：`StudioTaskStatus` 增加 `cancelling`、`cancelled`，保留 `canceled` 读取兼容。
- `web/src/stores/use-studio-tasks.ts`
  - 未提交任务取消直接 `cancelled`；运行中任务先 `cancelling`，不冒充远端已停止。
  - 新增 `confirmCancelled()`，只有远端核对后才从 `cancelling` 落为 `cancelled`。
  - 刷新/恢复保留 `cancelling`；旧 `canceled` 统一读为 `cancelled`。
  - 运行计数和并发槽位包含 `cancelling`；确认取消后才释放队列。
- `web/src/lib/studio/task-recovery.ts`：`normalizeStudioTaskStatus()` 统一旧状态；`cancelling` 刷新不自动变 unknown/cancelled。
- `web/src/pages/drama/studio/ui.tsx`、`task-center.tsx`、`web/src/pages/drama/index.tsx`：补状态标签、取消中提示、确认已取消入口和运行计数。

## 3. 4A 验收

### 统一规则

正式版本变化后，旧审核记录一律 stale。判断顺序固定为：

1. 记录绑定版本是否等于当前正式版本；不等即 `stale/version`。
2. 版本相同才比较镜头内容哈希；不等为 `stale/content`。
3. 锁定只影响修改权限，不改变审核结论；`locked + stale` 仍是 stale。
4. `approved` 统计只计当前版本有效记录；旧版本 approved 不计入。
5. 重新审核必须创建绑定当前版本的新记录，旧 audit 全部保留。
6. ready 判定使用同一 effective status；旧版本 stale 会进入 `not_ready` 原因。

### 测试覆盖 A–G

- A 单镜内容变化（版本相同）→ 只有该镜 stale，原因 content。
- B 只改版本、镜头内容不变 → 全部旧审核 stale，原因 version。
- C 重新审核 → 新记录绑定当前版本、旧历史保留、未重审镜头仍 stale。
- D 锁定 → 不改变 stale，也不把旧审核洗成当前有效。
- E 重新审核后再次版本变化 → v4 新记录也 stale，不能沿用。
- F 旧项目缺 `storyboardVersion` → 归一化为 `-1`，不能冒充当前版本。
- G `reviewStats`、readiness 与 statuses 同源，approved=0、stale=全部、readiness=not_ready。

测试脚本：`web/scripts/stage4a-strict-version-check.ts`，输出 `A–G 7 groups passed`。

## 4. 4D 验收

- Prompt 覆盖景别、机位、运镜与动作/空间匹配、镜头间运镜连续性、角色外观、服装连续性、服装变体与场景/时间/状态匹配；并明确要求字段值一致性，不只检查字段是否填写。
- Prompt 声明范围、实际模型输入、evidenceCorpus、finding 证据来源使用同一份 `createReviewInputView`；单镜/选中/整集三组在 `stage4d-core-check` 中逐字段比对通过。
- proposal change 有独立 evidence 正文；空证据→unknown；unknown→不可应用；声称 explicit 但输入中找不到→降级 inference，不能冒充事实。
- 旧 pending 提案在版本变化后自动 conflict：刷新、hydration、列表/详情读取、应用前都会得到同一结果；重复归一化不会重复写冲突应用记录。
- 资产引用失败会阻止提案应用和快照恢复；测试同时覆盖缺失、归档、同名不同 ID、服装缺失、场景类型错误、道具缺失、镜头组缺失/重复/未登记。
- 领域记录上下文：review / issue / audit / AI run / proposal 尽量补齐 `projectId / episodeId / episodeNumber`；旧数据缺字段可读，不据此编造归属。

## 5. 测试证据摘要

完整命令、输出和等级见 `DRAMA_STUDIO_STAGE4_PHASE1_TESTS.md`。

- `stage4a-core-check`: 9 groups passed
- `stage4b-core-check`: 8 groups passed（旧“版本变化不影响未变镜头”断言已按严格版本更新）
- `stage4c-core-check`: 19 rules, 26 groups passed
- `stage4c1-core-check`: `11 identity groups, 32 action-phase cases + 8 assertions, 15 direction texts + 9 engine cases, 18 state cases (9 pairs), 12 async groups, 9 snapshot groups passed`
- `stage4d-core-check`: 4 P1 regression groups, AI parse groups, proposal isolation/protection groups, persistence groups passed
- `stage4d-action-check`（Vite SSR）: 单镜/整集/选中审核、失败 run 落盘、提案应用、自动版本冲突、同批第二提案冲突、资产校验、人工保护、拒绝、存储失败 passed
- `stage4d2-core-check`: `{"ok":true,"tasks":7,"metadataGuards":3,"snapshotDiscards":7}`
- `stage4a-strict-version-check`: A–G 7 groups passed
- `stage4d-phase1-check`: prompt/evidence/unknown/auto-conflict 4 groups passed
- `stage4-asset-validation-check`: 4 groups passed
- `stage4-task-status-check`: 5 groups passed
- `npm run typecheck`: exit 0
- `npm run build`: exit 0（仅有既有 chunk 体积/动态导入警告）

## 6. 风险与边界

详见 `DRAMA_STUDIO_STAGE4_PHASE1_RISKS.md`。关键边界：

- 本轮所有测试均为确定性/内存测试，不是真实浏览器、真实 IndexedDB 并发或真实 AI 调用。
- 旧 pending 自动 conflict 是读取归一化派生结果；数据库里仍可能保留原来的 pending JSON，直到下一次审核写入/应用/刷新后写入。任何新的 4F 读取都必须先走 `normalizeStoryboardReview` 或 `effectiveShotReviewStatus`，不能直接读原始 pending。
- 任务“远端确认取消”目前是人工确认按钮；后端没有任务取消确认接口，不能把前端 `cancelled` 当作远端已停止证明。
- 4E/4F 未开始，第五步仍没有 readiness / review / storyboardVersion 闸门。
- 4D.2 的八项风险仍有效，未因本轮修复升级为真实通过。
- 原始 live 项目 A 与 `proj-stage4c-snap-1795573351974` 永久不可恢复；`proj-UORILWcK` 只是恢复副本，不能冒充原始 A。

## 7. Git 保护报告

- 起始 HEAD：`27b67bd09a8aead582868e139c585b7ba4b03b0e`
- 结束 HEAD：同为 `27b67bd09a8aead582868e139c585b7ba4b03b0e`
- 未执行 commit、push、tag。
- 未执行 `git reset` / `git clean` / `git stash` / `git checkout` / `git restore`。
- 修改前 `git status --short` 311 行；生成 5 个交付文件后为 316 行。新增的 5 行全部是本轮交付文件（`DRAMA_STUDIO_STAGE4_PHASE1.diff` 和 4 个 `.md`），仓库原有 98 个 tracked 修改和未跟踪文件保持不变。
- 因为目标文件未 tracked，`git diff` 无法直接生成本轮变更；Diff 用修改前副本 `stage4-phase1-baseline` 与当前工作区独立比较生成，覆盖 27 个文件，+1404 / −134。
- Diff 文件：`docs/ai-handover/DRAMA_STUDIO_STAGE4_PHASE1.diff`，141,610 bytes / 2,467 行；SHA256 `BA5E5F85F724E3495A4FF20446ED89777BC040562350048687F1C826B5D8655A`；`git apply --reverse --check` 通过，exit 0。
- 未发现意外覆盖：所有写入均为目标文件的定点 Edit/Write；未删除、未重命名、未回滚用户既有改动。仍应把“未覆盖无关文件”理解为基于基线比较的结论，而不是对整个工作区历史的人工逐行审计。

## 8. 最终结论分级

### 代码修复结果

- 4A 严格版本过期、统计/列表/九宫格/Drawer/历史/重新审核/readiness 统一规则：**已完成**。
- 4D Prompt 范围、证据四分类、提案独立证据、unknown/空证据阻断、自动 conflict、资产 ID 校验：**已完成代码层**。
- 领域记录自包含字段：**已完成主要审核/AI 记录**。
- 任务 `cancelling / cancelled`：**已完成前端状态机与恢复语义**。
- 4E/4F：**未开始**，第五步仍无审核闸门。

### 确定性测试结果

- 11 个确定性测试脚本全部 exit 0；`typecheck` exit 0；`build` exit 0。
- 这些结果只证明逻辑、类型和构建，不证明真实浏览器交互、真实 IndexedDB 并发、真实 AI 或真实计费链路。

### 真实环境未验证项

- 4A/4D UI 的真实浏览器点击、刷新、双标签页并发未复跑。
- 真实 AI pending 并发未复跑；本轮禁止真实模型调用。
- 真实 IndexedDB 事务/磁盘配额故障未复现；4D.2.1 的 7 组快照测试仍是内存事务语义。
- 快照恢复后的 4E 预览/版本历史/交接未实现。
- 后端任务查询、幂等键、远端取消确认不存在。

### 需要用户授权项

- 真实 AI 模型调用与额度消耗。测试方案见 `DRAMA_STUDIO_STAGE4_PHASE1_AI_TEST_PLAN.md`；本轮调用次数为 0。
- 如需要真实浏览器/真实 IndexedDB 验收，需要单独授权并指定测试端口、隔离项目和可接受的数据备份方式。

### 需要外部后端项

- 任务查询接口、提交幂等键、远端取消确认接口；本轮没有用前端枚举声称解决后端幂等。

**Stage 4 不能整体验收，也不能据此进入 4E。**
