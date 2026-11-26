# 离火 AI 短剧工作室 阶段 2B · 收尾与最终验收报告

日期：2026-11-23
范围：阶段 2B 收尾修复、确定性测试、项目 A / B 真实浏览器最终回归、最终 Diff 与文档收口
状态：阶段 2B 收尾工作完成，等待用户在自己的工作区做最后确认；**未进入阶段 3，未生成剧本、分镜、图片或视频，未修改五步导航。**

## 0. 本轮结论

本轮把阶段 2B 从“还有 8 条 warning 的实现版本”收口为可交付的验收候选，并按用户追加要求完成二次加固：

- 第 1 集不再因为没有前序连续性依赖而误报 `episode_without_continuity`。
- 人物死亡后重新出现时，必须有发生在死亡集之后、当前出现集之前、带明确原因的 `return` 事件；来源依据按 `explicit` / `inferred` / `generated` 分别校验。`generated` 复活现在还必须由用户确认并写入 `confirmedAt`，模型输出不能自行确认。
- 高风险改编审核从 UI 下沉到工作区核心层，并且以当前工作区 canonical ledger 为准：即使提案把 `highRisk` 改为 `false`、清空 `riskTags` 或伪造 `approved`，核心层仍会拒绝。
- 项目 A 的 2B 校验由 `0 error / 8 warning / 1 suggestion / 待处理 9` 变为 `0 error / 7 warning / 1 suggestion / 待处理 8`；减少的正是第 1 集连续性误报，没有任何 warning 被自动改写、忽略或伪造处理。
- 项目 A 的 2B 头部状态、刷新持久化、第 2 集历史版本、第 3 集锁定均通过浏览器回归。
- 项目 B 仍与项目 A 隔离，保持草稿、无 2B 入口。
- 项目账号缺失时的服务入口拦截已做浏览器内验证：会阻止文本模型运行时，不创建分析任务、不发起模型生成；有效账号恢复后运行时能正确使用项目账号，且全局账号不变。

本轮没有进入阶段 3，也没有发起新的真实生成调用。项目 A 剩余 7 条 warning + 1 条 suggestion 全部保留“待处理”，留给用户逐条处置；最新二次加固只改源码和测试，没有读取或改写项目 A 的校验状态。

## 1. 本轮范围与不做事项

### 已完成

- 修正第 1 集连续性校验边界。
- 补齐死亡后回归的合法依据判定。
- 在 `applyProposalToWorkspace()` 等工作区核心层增加高风险审核保护。
- 补齐正常 / 异常 / 边界确定性测试。
- 项目 A / B 的 2A 最终浏览器回归与 2B 刷新、锁定、历史版本回归。
- 记录项目 A 剩余 warning 的逐条状态。
- 生成并检查最终 Diff。
- 更新 `CHANGELOG.md`、`todo.mdx`、`pending-test.mdx`。

### 明确未做

- 不进入阶段 3「分集剧本与分镜」，不生成正式剧本、分镜、角色图、场景图或视频。
- 不修改五步导航。
- 不修改 Bridge、`server/` 业务路由、全局 `AiConfig`、无限画布核心。
- 不为减少 warning 改动项目 A 的真实剧情。
- 不自动接受、忽略或标记项目 A 的任何校验条目。
- 不发起新的真实模型生成；账号验证只调用共享文本模型运行时，且在校验失败时没有继续发请求。
- 不提交、不推送、不执行 `reset` / `checkout` / `stash` / `clean`。

## 2. 源码修复与精确变更

本轮增量代码涉及 6 个文件：

| 文件 | 变更 |
|---|---|
| `web/src/lib/studio/adaptation-schema.ts` | 第 1 集连续性条件；新增 `hasReturnBasis()`；`validateCharacterContinuity()` 接收人物弧光并校验死亡后回归依据；`generated` 回归必须带用户确认时间 |
| `web/src/lib/studio/adaptation-workspace.ts` | 新增 `AdaptationReviewError` 与 `highRiskChangesInProposal()`；接受提案时以当前工作区 canonical ledger 为准，拒绝被篡改的 `highRisk` / `riskTags` / `reviewStatus` |
| `web/src/types/studio-adaptation.ts` | 人物弧光里程碑增加可选 `confirmedAt`，用于记录用户对 AI 新增复活的确认 |
| `web/src/pages/drama/studio/adaptation/index.tsx` | 复用核心 helper 计算 `highRiskPending` 并传入当前工作区；捕获 `AdaptationReviewError`；`approveChange()` 同时写回当前 ledger 和两份提案 changes；增加 `generated` 复活确认入口；增加按版本一次的 2B 挂载重算 effect |
| `web/src/pages/drama/studio/adaptation/characters-tab.tsx` | 在人物里程碑显示“AI 复活待确认 / 已确认”，提供“确认 AI 复活”按钮；确认前明确不能作为死亡后回归依据 |
| `web/scripts/stage2b-core-check.ts` | 增加正常 / 异常 / 边界测试：第 1 集、第 2 集、合法 return、无来源 return、早于死亡、晚于出现集、空原因、未确认 / 已确认 generated、模型自证确认、被篡改 highRisk / riskTags / reviewStatus；核心层接受拦截 |

### 2.1 第 1 集不再误报连续性缺失

`adaptation-schema.ts` 的 `episode_without_continuity` 检查改为只对第 2 集及以后生效：

```ts
if (plan.episodeNumber > 1 && !plan.continuityDependencies.length)
```

第 1 集是首集，没有前序集，不应该被要求补一个不存在的“上一集依赖”。第 2 集及以后缺少连续性依赖仍会报 warning。该改动不改变用户已有数据，不改变第 1 集的剧情。

### 2.2 死亡后回归必须有合法依据

新增 `hasReturnBasis(arc, deadAt, atEpisode)`，要求人物弧光中存在一个 `return` 里程碑，同时满足：

1. 类型为 `return`；
2. 发生集数在死亡集之后（`> deadAt`）；
3. 发生集数不晚于当前出现集（`<= atEpisode`）；
4. `description` 非空；
5. 来源按类型校验：
   - `generated`：明确标记为 AI 新增，回归事件、集数、原因存在，且里程碑必须有用户写入的 `confirmedAt`；模型输出中的 `confirmedAt` 不会被采信；
   - `explicit`：必须有 `sourceReferences.evidence`；
   - `inferred`：至少有 chapter / event / scene / foreshadowing / evidence 之一。

不满足时仍报 `character_returns_without_basis`，并给出死亡集、当前出现集和建议。该逻辑只影响校验，不会自动写入 `return` 事件，也不会自动修改人物弧光。

### 2.2.1 `generated` 复活必须由用户确认

`AdaptationCharactersTab` 为 `sourceType = generated` 的 `return` 里程碑显示确认入口：

- 未确认时显示“AI 复活待确认”，并提示“未确认前不能作为死亡后回归依据”；
- 点击“确认 AI 复活”后，写入里程碑 `confirmedAt`，人物弧光版本 +1、审核状态回到 `pending_review`；
- 已确认时显示“AI 复活已确认”，不再重复写确认时间；
- 提案预览、生成中或禁用状态下不能确认；
- `normalizeCharacterArcs()` 不读取模型返回的 `confirmedAt`，避免模型自证“用户已确认”。

因此，`generated` 复活不是“标记一下就能通过”，而是必须由用户在人物弧光里明确确认。

### 2.2.2 高风险审核以当前工作区为准

`highRiskChangesInProposal(proposal, current?)` 不只读取提案自身字段，而是把当前工作区 `changes` 与 `strategy.changes` 作为 canonical ledger：

- 提案 `highRisk = false` 但当前工作区仍为高风险：拦截；
- 提案清空 `riskTags` 并伪造 `reviewStatus = approved` 但当前工作区仍待审：拦截；
- 提案只在 `strategy.changes` 中篡改高风险标记：同样拦截；
- 当前工作区已 `approved` / `locked` 的高风险项：允许通过，避免用户确认被误拦。

`applyProposalToWorkspace(current, proposal, accept)` 调用该 helper 时已传入 `current`；UI 的 `approveChange()` 会同步更新当前 ledger，避免“UI 已确认、核心层仍看成待审”。

### 2.3 高风险审核保护下沉到核心层

`adaptation-workspace.ts` 新增：

- `AdaptationReviewError`，`code = "high_risk_pending"`，携带被拦截的高风险改编列表；
- `highRiskChangesInProposal(proposal, current?)`，把 `proposal.changes` 与 `proposal.strategy?.changes` 取并集并按 `adaptationChangeId` 去重，同时回到当前工作区核对高风险标记与审核状态。

`applyProposalToWorkspace(current, proposal, accept)` 在接受分支、写入任何 status / diff / version 之前抛出该错误。拒绝提案分支不变，不会被门禁阻止。

UI 侧：

- 用同一个 helper 计算 `highRiskPending`，并传入当前 `workspace`，避免 UI 与核心层判断不一致；
- `acceptProposal()` 捕获 `AdaptationReviewError`，提示“核心层拒绝接受”，不写入提案；
- `approveChange()` 同时更新当前 `changes`、当前 `strategy.changes`、`proposal.changes` 和 `proposal.strategy.changes`，避免只改一份数组导致核心层仍认为待审核；
- 高风险条目已 approved / locked 后可通过，未确认或被篡改时即使绕过 UI 直接调用核心函数也会被拒绝。

### 2.4 2B 挂载重算 effect

`adaptation/index.tsx` 增加按版本一次的 2B 挂载重算：

- 仅当 `strategy` / `blueprint` / `episodePlans` 已存在时执行；
- 仅当当前 `versionNumber` 尚未重算过时执行；
- 调用 `revalidateAdaptationWorkspace()`；
- 仅在 checks JSON 变化时 `commit(next)`。

它只按确定性规则重算 checks，**不改写剧情、不自动接受/忽略 warning**。项目 A 实测打开 2B 后从 8 条 warning 变为 7 条，剩余条目仍全部是“待处理”，说明该 effect 已运行且没有覆盖用户处置。

## 3. 自动化验证

### 3.1 2B 确定性测试

执行：

```powershell
cd C:\Users\qq308\Desktop\lihuo\web
npx --yes tsx scripts/stage2b-core-check.ts
```

实际输出：

```json
{
  "plans": 3,
  "targetEpisodes": 3,
  "characterArcTimeline": 3,
  "originalForeshadowings": 1,
  "reconciledForeshadowingStatus": "advancing",
  "errors": 5,
  "warnings": 5,
  "suggestions": 1,
  "firstEpisodeContinuityWarning": false,
  "missingEpisodeContinuityWarning": true,
  "legalReturnBlocked": false,
  "unsourcedReturnBlocked": true,
  "unconfirmedGeneratedReturnBlocked": true,
  "confirmedGeneratedReturnBlocked": false,
  "modelSelfConfirmedReturnAccepted": false,
  "tamperedHighRiskBlocked": true,
  "forgedApprovalBlocked": true,
  "tamperedStrategyBlocked": true,
  "lockedEpisodePreserved": true,
  "proposalDiffRemoved": 0,
  "proposalDiffChanged": [1, 3],
  "savedVersionReason": "验证锁定保护",
  "handoffEpisodes": 3,
  "handoffLocked": [1],
  "restoredStatus": "interrupted"
}
```

覆盖到：

- 第 1 集空 `continuityDependencies`：不报 `episode_without_continuity`。
- 第 2 集空 `continuityDependencies`：仍报 `episode_without_continuity`。
- 死亡后没有 `return`：仍报 `character_returns_without_basis`。
- 合法 `return`：不报。
- `return` 早于死亡集：报。
- `return` 晚于当前出现集：报。
- `return` 原因为空：报。
- `return` 缺少来源：报。
- 未确认的 `generated` 复活：报。
- 已带用户 `confirmedAt` 的 `generated` 复活：不报。
- 模型自带 `confirmedAt`：被丢弃，不能自证确认。
- 提案把 `highRisk` 改为 false：核心层按当前工作区拦截。
- 提案伪造 `highRisk=false`、空 `riskTags`、`reviewStatus=approved`：核心层仍按当前工作区待审状态拦截。
- 仅在被篡改的 `strategy.changes` 中隐藏高风险：核心层仍拦截。
- 核心层接受提案时拦截未确认高风险（`proposal.changes` 和仅 `strategy.changes` 两条路径均覆盖）。
- 已 approved / locked 的高风险可通过。
- 拒绝提案不被门禁阻止。
- 拦截时版本号、分集内容、提案状态不变。
- 锁定集保留；旧版本原因、局部差异、handoff、刷新恢复状态均通过。

### 3.2 2A 核心与修复检查

执行：

```powershell
cd C:\Users\qq308\Desktop\lihuo\web
npx --yes tsx scripts/stage2a-core-check.ts
npx --yes tsx scripts/stage2a-fix-check.ts
```

实际输出：

```json
{
  "ok": true,
  "chapters": 3,
  "chunks": 2,
  "maxChunkChars": 7739,
  "characters": 2,
  "relationships": 1,
  "events": 2,
  "foreshadowings": 1,
  "evidence": {
    "chapters": 3,
    "chunks": 2,
    "calls": 2,
    "evidenceCount": 11,
    "explicitCount": 9,
    "inferredCount": 2,
    "generatedCount": 0
  },
  "warnings": 0,
  "compactChars": 610
}
```

```json
{
  "ok": true,
  "evidence": {
    "valid": 1,
    "whitespace": 1,
    "wrong": 0,
    "empty": 0,
    "badChapter": 0,
    "crossChapter": 0,
    "invalidArchiveEvidence": 0
  },
  "chunks": {
    "count": 2,
    "maxChars": 7739
  },
  "pdf": [
    { "pageStart": 1, "pageEnd": 3 },
    { "pageStart": 3, "pageEnd": 3 }
  ],
  "account": {
    "noProjectRejected": true,
    "validProject": true,
    "requestAccountId": "project-doubao",
    "notLogged": false,
    "providerMismatch": false,
    "abnormal": false,
    "quotaBlocked": false,
    "globalAccountUntouched": true
  }
}
```

### 3.3 类型检查与构建

二次加固完成后重新执行：

- `npm run typecheck`：通过，`tsc --noEmit` 无报错。
- `npm run build`：通过。8285 modules；`dist/assets/index-DjLNecFq.js` 4,555.66 kB；1m 19s；只有既有 chunk / 动态导入 warning。

本轮最后一次构建发生在新增“高风险防篡改”和“generated 复活确认”之后，结果对应当前源码。

## 4. 项目 A / B 真实浏览器最终回归

验收浏览器：Browser Use 标签（该 profile 中才有项目 A/B 数据）。视口 998×667。
验收地址：`http://localhost:3000/drama?project=proj-UORILWcK&step=analysis`。
最终截图：`stage2b-final-checks.png`、`stage2b-final-project-b-isolation.png`。

二次加固完成后，本轮又做了一次只读复核：重新载入项目 A，重新打开「短剧改编 · 2B」并进入「剧情校验」，仍显示 `0 error / 7 warning / 1 suggestion / 待处理 8`，头部仍为 `3 集 × 60s / 当前分集 3 集 / 审核进度 4/5 / 当前版本 v4 / 锁定 +1 集`。本轮没有点击接受、忽略、标记已解决或重新生成，8 条全部保持待处理。最终截图已用新的 Browser Use 标签重新捕获；旧标签仍存在，未关闭用户可见的 Edge 窗口或标签。

### 4.1 项目 A 2A 回归（通过的部分）

项目 A 仍为：

- 6 章 / 1,281 字 / 4 人物 / 4 关系 / 8 世界观 / 3 地点 / 6 事件 / 2 伏笔 / 70 条显式证据 / 1 处人工修正；
- 文本模型 `对话（豆包）`；
- 分析任务版本 v3，1/1 分块，3 次调用；
- 林舟身份为“雾港引航员、夜航原引航员（人工校对）”，有“人工修正 · 恢复 AI 原值”入口；
- 林舟 3 条证据显示第 1 章字符 56–89、第 4 章字符 828–844、第 6 章字符 1218–1244；
- 用“他是一名引航员，三年前在一场沉船事故中失去记忆”做全书搜索得到 1 处匹配，落在第 1 章，证明证据摘录可以定位原文；
- 3 条跨章审校提示：1 error（第 4 章暗格内航海图与船牌记录矛盾）、1 warning（第 3 章事件因果与第七声钟实际第 5 章矛盾）、1 条未知规则提示（铜钥匙敲击船舷唤醒失忆者是否符合规则，无对应证据）。

无效证据没有在真实项目 A 中故意新增，以避免污染用户项目；该点由 2A fix-check 的 `invalidArchiveEvidence 0` 覆盖。

### 4.2 项目 A 2B 最终状态

页面头部：

- 目标：3 集 × 60s；
- 当前分集：3 集；
- 审核进度：4 / 5；
- 当前版本：v4；
- 锁定：+1 集。

三集：

- `ep-001 雾钟授钥`，60s，已通过；
- `ep-002 钟醒归航`，60s，待审核；
- `ep-003 夜航归港`，60s，已锁定。

剧情校验：

- `0 error`；
- `7 warning`；
- `1 suggestion`；
- `待处理 8`；
- 第 1 集不再出现 `episode_without_continuity`，没有要求用户补虚假的前序依赖。

### 4.3 刷新、锁定与局部重生成历史

- 重新加载后 2B 头部仍为 3 集 × 60s / 审核 4/5 / v4 / 锁定 +1 集。
- 校验仍为 0 error / 7 warning / 1 suggestion。
- 第 2 集抽屉显示当前 `版本 v2`，`3 章 / 3 事件 / 5 证据`。
- 第 2 集历史版本 1 条：`v1 · 让顾北在货仓对峙时说出当年夜航的更多内情，增加冲突层次`（11/22 15:33）。
- 第 3 集卡片显示“已锁定”；头部“锁定 +1 集”。
- 本轮没有发起新的真实模型调用，也没有重新生成第 2 集或第 3 集。

### 4.4 项目账号缺失与恢复验证

本轮用页面内共享文本模型运行时做了浏览器级服务入口验证，不通过 UI 点击“重新分析”，以避免把项目状态改为 `paused`：

1. 临时把项目 A 的桥接账号置空；
2. 设置页立即显示“本项目尚未选择豆包账号；不会继承全局账号池账号，请先在项目设置中选择”；
3. 关闭设置并刷新，置空状态持久化，项目仍不继承全局账号；
4. 在页面上下文加载 `novelTextModelRuntime(project A)`：
   - 先读取一次 `http://127.0.0.1:9091/api/accounts` 以取得账号列表；
   - 随后在发出模型请求前抛出精确错误：
     `本项目尚未选择豆包账号；不会继承全局账号池账号，请先在项目设置中选择。`
   - 没有创建分析任务，没有发起模型生成，项目内容与状态没有被改动；
5. 把项目账号恢复为「豆包1」，设置页显示“已锁定项目账号「豆包1」”；
6. 刷新后该锁定状态仍保留；
7. 再次调用运行时：`projectAccount = 豆包1`，`runtimeAccount = 豆包1`，`label = 对话（豆包）`；全局账号前后均为空，`globalUntouched = true`。

需要明确披露：账号校验前会有一次 Bridge 账号元数据读取（`/api/accounts`），但没有任何模型请求。若“发请求前”要求连 Bridge 元数据请求也不能有，这一层还需调整；本轮没有把它写成“零网络请求”。

### 4.5 项目 B 隔离

项目 B `阶段2A隔离验收·粘贴样本`：

- 3 章 / 87 字；
- 草稿，未分析；
- 文本模型 `gpt-5.5（默认渠道）`；
- 没有“短剧改编 · 2B”入口；
- 看不到项目 A 的 2B 数据、校验、版本或锁定状态。

## 5. 项目 A 剩余校验清单（最终状态：全部待处理）

### 5.1 7 条 warning

全部 `code = location_change_without_move`，全部为两集问题：

| # | 人物 | 集数 | 地点变化 |
|---|---|---|---|
| 1 | 林舟 | 第 1 → 2 集 | 旧钟楼，后被带往货仓 → 船帮货仓 → 旧钟楼 |
| 2 | 林舟 | 第 2 → 3 集 | 船帮货仓 → 旧钟楼 → 旧航道海面 → 雾港码头 |
| 3 | 沈鸢 | 第 1 → 2 集 | 旧钟楼 → 货仓外 → 旧钟楼 |
| 4 | 沈鸢 | 第 2 → 3 集 | 货仓外 → 旧钟楼 → 雾港码头 |
| 5 | 老周 | 第 2 → 3 集 | 旧钟楼 → 雾港码头 |
| 6 | 顾北 | 第 1 → 2 集 | 旧钟楼 → 货仓 → 旧钟楼 |
| 7 | 顾北 | 第 2 → 3 集 | 货仓 → 旧钟楼 → 雾港码头 |

建议均为补充赶路、转场或时间跳跃说明，避免人物瞬移。

### 5.2 1 条 suggestion

- `code = change_not_in_episode`
- `chg-005` 已记录，但没有映射到任何分集；
- 建议确认它是全剧级设定调整，还是遗漏了分集落点；
- 当前状态：待处理。

### 5.3 处置动作

UI 保留“接受建议”“忽略”；接受后会出现“标记已解决”；仅单集问题会出现“按建议重生成该集”。当前 7 条 warning 均为两集问题，因此没有单集重生成按钮；suggestion 没有集数。

本轮**没有点击任何接受、忽略、标记已解决或按建议重生成按钮**，所有条目保持“待处理”，避免替用户改变处置状态。因此这些动作本轮只观察了入口与状态，不作为已点击验收通过项。二次加固完成后重新载入页面，计数仍为 `7 warning / 1 suggestion / 待处理 8`，说明这些状态没有被代码修改或挂载重算覆盖。

## 6. 覆盖矩阵

| 项目 | 状态 |
|---|---|
| 第 1 集连续性修复 | 已实现 + 已确定性测试 + 项目 A 浏览器验证（warning 8→7） |
| 死亡后回归依据 | 已实现 + 已覆盖合法 / 提前 / 未来 / 空原因 / 无来源 / generated 测试 |
| `generated` 复活用户确认 | 已实现 + 已覆盖未确认拦截、已确认通过、模型自证确认被丢弃；UI 入口已通过类型检查 / 构建，未在项目 A 点击（项目 A 无 generated 复活） |
| 高风险核心层保护 | 已实现 + 已覆盖 UI 绕过路径、篡改 `highRisk` / `riskTags` / `reviewStatus`、仅 `strategy.changes` 路径与 approved/locked 测试 |
| 2B 刷新持久化 | 已真实浏览器验证；二次加固后重新载入仍保留 8 条待处理 |
| 2B 第 3 集锁定 | 已真实浏览器验证 + 核心测试 `lockedEpisodePreserved` |
| 第 2 集历史版本 v1 | 已真实浏览器验证 |
| 项目 A / B 隔离 | 已真实浏览器验证 |
| 项目账号缺失拦截 | 已浏览器服务入口验证；没有走完整 UI“重新分析”链路 |
| 项目账号恢复与全局隔离 | 已浏览器运行时验证 + 刷新持久化 |
| 2A 证据 / 人工修正 / 搜索定位 | 已真实浏览器验证 |
| 2A 无效证据 | 真实项目未故意制造；由 fix-check 覆盖 |
| 2B 剩余 7 warning + 1 suggestion | 已逐条记录；未点击处置；二次加固后重新载入仍为 8 条待处理 |
| 高风险提案真实浏览器拒绝 | **尚未在真实提案上触发**；由确定性测试覆盖 |
| `generated` 复活确认按钮真实浏览器点击 | **尚未在真实浏览器点击**；项目 A 没有 generated 复活事件，由确定性测试覆盖 |
| 阶段 3 / 正式剧本 / 分镜 / 媒体 | 未开始，未生成 |

## 7. 未验证与已知风险

1. **高风险提案的真实浏览器拒绝尚未触发。** 项目 A 当前没有 pending 提案，且本轮没有发起新的真实生成。核心层拦截由确定性测试覆盖，但还没有在真实模型返回的高风险提案上点过“接受提案”。
2. **账号缺失验证不是完整 UI 分析链路。** 已验证设置页阻断、刷新持久化和共享文本模型运行时拦截；没有点击“重新分析”，所以没有完整走 `setProjectStatus("paused")` 那条 UI 分支。
3. **`inferred` return 仍只校验结构来源。** `generated` 已改为必须用户确认，但 `inferred` return 只要有 chapter / event / scene / foreshadowing / evidence 之一即可通过；现有校验不能证明该来源真的描述了复活事件。项目 A 没有出现该问题，后续可在阶段 3 前补“来源内容与复活事件语义匹配”的检查。
4. **`generated` 复活确认按钮尚未真实点击。** 核心规则、模型自证拦截、UI 编译与确定性测试已覆盖；项目 A 没有 generated 复活事件，本轮没有为了验收而向真实项目注入 AI 复活。
5. **`resolveCharacter` 的姓名回退未修生产。** 如果 `characterStates[].characterId` 写的是人物名且没有 `name` 字段，生产代码不会按姓名回退，可能形成重复人物时间线。本轮只在测试夹具中使用稳定人物 ID，未修改生产 `resolveCharacter`；项目 A 没有出现该问题。
6. **2B 挂载重算会写回 checks。** 它只按确定性规则重算，不改剧情、不自动忽略；但只要 checks JSON 变化就会 `commit` 到本地持久化。项目 A 二次加固后重新载入仍保留 8 条待处理，用户处置没有被覆盖。
7. **120 集与长剧未压测。** 当前真实验收只有 3 集 / 1,281 字样本；20 集以上、120 集上限、长蓝图、弱模型截断和分集批次成本仍未验证。
8. **旧 Browser Use 标签存在渲染缓存。** 验收期间旧标签的 DOM 可读但截图停留在初始背景；本轮通过新建 Browser Use 标签并用 CDP 捕获完成最终截图，没有关闭用户可见的 Edge 标签。该现象属于浏览器验收环境问题，不是产品页面缺陷。

## 8. 文档、Diff 与 Git 状态

### 文档

- `CHANGELOG.md`：新增阶段 2B 收尾修复记录。
- `docs/content/docs/progress/todo.mdx`：2B 仍等待用户验收；剩余 warning 更新为 7 条，并指向本报告。
- `docs/content/docs/progress/pending-test.mdx`：2B 校验更新为 `0 error / 7 warning / 1 suggestion / 待处理 8`，新增收尾边界验收项。
- `docs/ai-handover/DRAMA_STUDIO_STAGE2B_FINAL.md`：本报告。
- `docs/ai-handover/DRAMA_STUDIO_STAGE2B_FINAL.diff`：最终净增量 Diff。

### Diff

- 基线：`stage2b-baseline`（阶段 2B 开工前的 docs / web/src / web/scripts / CHANGELOG 副本）。
- 文件：`docs/ai-handover/DRAMA_STUDIO_STAGE2B_FINAL.diff`。
- 大小：435,221 bytes。
- 文件头数量：28。
- 覆盖：22 个源码 / 脚本文件 + 6 个文档文件；不包含本报告、前置检查报告和截图。
- 生成方式：在无空格临时目录中按基线逐文件比较，`git diff --no-index --no-prefix a b`，输出 `a/...` / `b/...` 路径，保持可审查的统一 Diff 格式。

### Git

- 分支：`main`。
- 2B 开工前 HEAD：`27b67bd09a8a`。
- 本轮结束时 HEAD 未变：`27b67bd09a8a`。
- `git status --short`：170 行。
- 未提交、未推送、未 reset / checkout / stash / clean。
- 本轮六个代码 / 脚本文件最终 SHA-256 前 12 位与行数：
  - `adaptation-schema.ts`：`88101D3BB261`，1,315 行；
  - `adaptation-workspace.ts`：`0FA03FDA1439`，632 行；
  - `types/studio-adaptation.ts`：`4B3331BD6553`，521 行；
  - `adaptation/index.tsx`：`1D83318C4028`，635 行；
  - `adaptation/characters-tab.tsx`：`44E3263882D8`，118 行；
  - `stage2b-core-check.ts`：`B2F78C8C9DE5`，623 行。

### 本轮最终截图

- `docs/ai-handover/stage2b-final-checks.png`：项目 A 2B 头部与 `0 error / 7 warning / 1 suggestion`。
- `docs/ai-handover/stage2b-final-project-b-isolation.png`：项目 B 草稿、无 2B 入口。

## 9. 复现命令

```powershell
cd C:\Users\qq308\Desktop\lihuo\web
npx --yes tsx scripts/stage2b-core-check.ts
npx --yes tsx scripts/stage2a-core-check.ts
npx --yes tsx scripts/stage2a-fix-check.ts
npm run typecheck
npm run build
```

浏览器：

```text
http://localhost:3000/drama?project=proj-UORILWcK&step=analysis
→ 短剧改编 · 2B
→ 剧情校验
```

## 10. 最终建议

阶段 2B 可以进入用户最终确认，但仍建议用户在真实工作区完成以下动作后再正式关闭 2B：

1. 用项目 A 的 7 条地点移动 warning 逐条决定“接受建议 / 忽略 / 按建议重生成”（当前全部待处理）。
2. 对 `chg-005` 确认是全剧级设定还是遗漏分集落点。
3. 如需验证核心层高风险拒绝，发起一次带未确认高风险项的局部提案，确认“接受提案”被核心层拒绝；本轮只做了确定性测试。
4. 决定 `generated` return 是否需要额外来源链接；如需更严格，后续应要求 AI 新增复活也带用户确认或来源记录。
5. 阶段 3 另行启动，不沿用本报告自动进入。
