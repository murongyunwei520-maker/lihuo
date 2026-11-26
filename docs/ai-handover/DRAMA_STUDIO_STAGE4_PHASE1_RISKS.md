# Stage 4 第一阶段修复 · 风险与边界

本文件只记录本轮修复后的真实边界，不把确定性测试写成真实浏览器、真实 IndexedDB 或真实 AI 通过。

## 1. 已解决（代码级）

| 风险 | 处理 | 证据等级 |
|---|---|---|
| 4A 只比较内容哈希，版本变化后未变镜头仍可 approved | `describeShotReviewStale` 先判正式版本；旧版本直接 stale；内容哈希只解释差异 | A（`stage4a-strict-version-check` A–G） |
| 统计/九宫格/列表/Drawer 各自判断，可能显示不一致 | 统一由 `effectiveShotReviewStatus`、`reviewStats`、`buildStoryboardReviewReadiness` 派生；UI 读取 `analysis.statuses` | A + 代码检查 |
| 旧审核缺 `storyboardVersion` 时继承当前版本，冒充当前 | `normalizeStoryboardReview` 归一化为 `-1`，始终 stale | A（F 组） |
| 批量审核 `partialOnVersionChange` 允许旧记录写入当前版本 | 版本冲突逐镜 `version_conflict`，不再写旧记录 | A（B 组） |
| 重新审核可能复用旧记录 | 重新审核创建当前版本新记录，旧 audit 保留 | A（C/E 组） |
| 锁定状态把 stale 洗成 approved | 锁定只影响修改权限，不改变 effective review；`locked + stale` 仍 stale | A（D 组） |
| 4D Prompt 只检查字段存在，不检查景别/机位/运镜/外观/服装连续性 | Prompt v2 明确要求字段值匹配、镜头间运镜连续、服装变体与场景/时间/状态匹配；实际输入补 `outfitBindings` | A（Prompt 字符串与输入视图断言） |
| 提案证据只留在 finding，change 无独立证据 | `StudioAiProposalChange` 增加必填 evidence / confidence 和可选来源字段 | A（4D phase1） |
| 空证据/unknown 被降级成低置信度 inference 后仍可应用 | canonical 四分类；空证据→unknown；unknown 由 `proposalChangeEvidenceError` 阻断 | A（4D phase1、4D action） |
| 旧 pending 提案在版本变化后仍可应用 | `normalizeStoryboardReview` 自动转 conflict；`applyAiProposalAction` 对旧版本提案拒绝；应用同批第一条后第二条自动 conflict | A（4D phase1、4D action） |
| 提案/快照使用已删除、归档或错误类型的资产 | 新增共享 `validateStoryboardAssetReferences`；提案 preview、事务内、快照正式写入都调用 | A（资产 4 组、4D action） |
| 审核/AI 记录跨项目串数据 | stamp 项目、分集、集数上下文；hydration、审核写入、提案应用路径都补齐 | A + 代码检查 |
| 任务取消只有一个 `canceling`，不能表达远端未确认 | 新增 `cancelling` / `cancelled`；运行中取消保持取消中，人工确认才收口；旧 `canceled` 兼容读取 | A（任务 5 组） |
| 刷新把取消中任务当成已取消或失败 | `recoverInterruptedTask` 保留 `cancelling`，不冒充完成；running/submitting 仍 unknown/interrupted | A（任务 5 组） |

## 2. 部分解决 / 真实环境未验证

### 2.1 4A 的 UI 消费链只有代码与确定性测试

`review-workspace`、`review-grid`、`review-list`、`review-shot-drawer`、`task-center` 已改为同源状态，但没有本轮真实浏览器点击、刷新、跨标签页截图。无法据此证明实际页面在浏览器 IndexedDB 恢复后也完全一致。

### 2.2 旧 pending 自动 conflict 是“读取归一化”结果

`normalizeStoryboardReview` 在 hydration、列表/详情分析、审核写入、提案应用时派生 conflict；但数据库里可能仍是旧 pending JSON，直到下一次审核写入、提案应用或快照写入才落盘。**任何新消费者（特别是未来 4F）必须先调用 normalize / effective status，不能直接读原始 `proposal.decision.status`，否则仍可能把旧 pending 当有效。**

### 2.3 4D 的真实模型服从度未验证

Prompt 字符串、输入视图、证据 corpus、解析器已对齐；但没有真实模型调用，无法证明模型会稳定遵守“unknown 不提提案”“服装变体匹配”“机位/运镜连续性”等要求。确定性测试使用固定 JSON 文本，不是模型输出。

### 2.4 资产变体校验不完整

项目资产模型是扁平 `StudioAsset`，没有独立服装变体表、场景变体表：

- `outfitId` 当前按 `costume` 资产 ID 校验，错误文案为“服装变体”；如果未来 `outfitId` 改为指向变体记录而非资产 ID，当前校验语义会不匹配。
- `locationVariantId` 只保留在 `sceneBindings` 和 Prompt 中，**没有校验变体是否存在**；这是明确未完成项，不能写成“服装变体/场景变体全部校验通过”。
- 没有服装所属人物字段，无法校验“服装变体是否属于该人物”；只能校验服装资产存在且类型正确。
- `storyboard-asset-validation` 未校验 `document.groups[].sceneId` 对应场景资产，只校验镜头 `sceneBindings.locationId` 和镜头组/镜头场景一致性；因为 `sceneId` 在当前模型里是剧本场景 ID，不是资产 ID。

### 2.5 任务取消的远端确认仍是人工

`confirmCancelled()` 是人工确认入口，需要用户核对远端确实停止；后端没有通用任务取消/查询接口。前端 `cancelled` 只表示“本地已收口”，不能作为远端任务已停止的证明。若远端实际成功而本地已停止等待，结果可能丢失，任务会保持未知语义。

### 2.6 领域记录上下文不完整

主要审核/AI 记录已补 `projectId / episodeId / episodeNumber`；`StudioStoryboardAuditRecord` 保留 `projectId / episodeId / storyboardVersion`，没有单独 `episodeNumber`。嵌套 finding/change/application 依赖父记录上下文，不是每条都完全自包含。旧记录缺字段时不会据此编造归属。

### 2.7 4D.2 快照测试仍是内存事务

`stage4d2-core-check` 的 7 组快照丢弃测试验证的是内存 `StudioStateStore` 事务语义，不是真实浏览器 IndexedDB 并发。不能写成“真实 IDB 7 组通过”。

### 2.8 4D 自动 conflict 的 UI 端到端未验证

确定性测试覆盖重复归一化不重复写 conflict application，以及已 conflict 提案的 apply 拒绝；没有真实页面截图证明刷新后 Drawer/应用按钮/统计都立即变为 conflict。

## 3. 未解决

### 3.1 4E/4F 未开始，第五步没有审核闸门（P0）

- 4E 的分镜预览、版本管理、历史版本恢复 UI 未实现。
- 4F 的最终交接未实现。
- 五步导航仍未检查 readiness；`video-step.tsx` 仍直接使用 legacy `sequence.shots`，没有 review/storyboardVersion/readiness 闸门。
- 因此 Stage 4 **不能整体验收**；4A/4D 代码修复不能替代 4F 交接保护。未来 4F 必须复用 `buildStoryboardReviewReadiness`、`validateStoryboardAssetReferences` 和严格版本规则。

### 3.2 真实 AI pending 并发未复跑（P0）

没有执行真实模型调用，没有真实 pending 并发、刷新、双标签页、自动 conflict 的端到端证据。测试方案见 `DRAMA_STUDIO_STAGE4_PHASE1_AI_TEST_PLAN.md`，本轮调用次数 0。

### 3.3 真实浏览器 IndexedDB 并发/配额未复现（P1）

4D.2.1 原有风险仍有效；本轮没有重新做真实 IndexedDB 事务 abort、磁盘配额、跨标签页写入。快照删除 7 组是内存事务语义。

### 3.4 后端任务查询/幂等/取消确认缺失（P1，外部）

- 后端没有任务查询接口，刷新恢复只能根据本地 submitState 推断 unknown/interrupted。
- 后端没有提交幂等键，重复提交仍可能产生重复远端任务。
- 后端没有远端取消确认接口，`cancelling` 只能人工收口。
这些不是前端状态机能在本轮解决的。

### 3.5 原始 live 项目 A 永久不可恢复（P0，数据事件）

原始 live A 与 `proj-stage4c-snap-1795573351974` 已永久不可恢复；`proj-UORILWcK` 只是恢复副本，不能冒充原始 live A。任何后续测试不得把恢复副本写成原始 A 的验收。

### 3.6 4D.2 快照删除一次拒绝未归因（P2）

4D.2 记录中一次快照删除被拒绝的原因仍未完全归因；本轮未重新复现，不能声明已修复。

## 4. 需用户授权

- **真实 AI 模型调用与额度消耗**：本轮未调用；执行前需确认模型、调用次数、费用/额度上限和隔离项目。
- **真实浏览器验收**：需要启动/复用浏览器、操作真实项目并读取真实 IndexedDB；本轮未做，且不得关闭用户正在使用的浏览器或标签页。
- **真实 IndexedDB 故障注入/磁盘配额测试**：需要明确测试页面、端口、隔离项目和备份/恢复方式。
- **删除隔离测试项目**：只能在用户明确确认后执行；不得删除原项目或未授权数据。

## 5. 需外部后端

- 任务查询接口（按 clientTaskId 查询远端状态）。
- 提交幂等键（同一 clientTaskId 重复提交只产生一个远端任务）。
- 远端取消确认接口（`cancelling → cancelled` 的服务端确认）。
- 若要做真实 AI 并发计费核对，还需要可查询的调用/账单归属；当前不能只凭前端日志声称计费准确。

## 6. 4D.2 八项原风险保留

1. 原始 live A 永久不可恢复。
2. 真实 AI pending 并发未复跑。
3. 真实磁盘配额未复现。
4. 后端无任务查询接口。
5. 后端无幂等键。
6. 快照删除一次拒绝未归因。
7. 真实 AI pending 测试需额度确认。
8. `proj-UORILWcK` 只是恢复副本，不能冒充原始 live A。

## 7. 结论

- 代码层：4A 严格版本、4D 证据/自动冲突/资产校验、任务取消状态机已完成并有确定性证据。
- 产品层：**Stage 4 仍未完成**；4E/4F 未开始，第五步没有审核闸门。
- 真实层：本轮没有真实浏览器、真实 IndexedDB 或真实 AI 证据；相关结论必须等授权测试后才能升级。
