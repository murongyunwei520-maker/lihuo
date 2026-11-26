# Stage 4D.1：遗留问题修复与验收补强报告

## 1. 结论

Stage 4D.1 的四项代码修复已完成并通过代码审查，真实浏览器中的真实 AI 审核和真实提案应用主路径也已完成：

- 真实 AI 整集审核成功，返回 3 条 findings 和 1 条真实 proposal，run 与 proposal 均落盘。
- 真实提案默认 0/2 未选中，逐项选择、取消选择、全选入口和确认层计数均可用。
- 真实点击确认后正式分镜 v13 → v14，只应用 1/2 项，写入了 backup / formal 快照，并重跑连续性检查。
- 同批旧版本 pending 提案在真实 UI 中转为「版本冲突」，保留 conflict decision 与 application，未改正式分镜、未 rebase。
- 页面刷新后，正式 v14、已应用 / 冲突提案、应用记录和审核历史均能恢复。
- 持久化失败 UI 用浏览器主世界 IndexedDB `put` 故障注入触发；这是故障注入，不是真实 IndexedDB 故障，详见第 8 节边界。

因此可以报告 **Stage 4D.1 主体验收完成**，但不能报告所有边界全部实机通过。原始 live 项目 A、跨标签页并发、真实 IndexedDB 故障注入、页面卸载期间任务恢复、真实持久化失败仍单独保留为未验证边界。

本轮没有进入 4E，没有修改外部正式后端、Doubao Bridge、全局 `AiConfig` 和无限画布核心，没有执行 Git commit 或 push。

## 2. 实际修改文件与原因

共修改 6 个代码 / 测试脚本文件，另新增报告、Diff、截图并同步文档。

| 文件 | 原因 |
| --- | --- |
| `web/src/lib/studio/continuity-engine.ts` | 增加武器取得动作识别；明确空手后出现武器时，只有没有取得动作才记信息不足 |
| `web/src/lib/studio/review-ai.ts` | 证据校验范围改为与实际 Prompt 相同的镜头 / 剧本场景 / 连续性报告；Prompt JSON 改为 compact |
| `web/src/lib/studio/stage4d-actions.ts` | 新增 `markAiProposalConflictAction()`，只写 conflict 决策与应用记录 |
| `web/src/pages/drama/studio/ai-review-panel.tsx` | 提案默认不选中、独立全选、过期提案「标记版本冲突」、确认层数量 / 版本提示 |
| `web/scripts/stage4d-core-check.ts` | 增加武器正向 / 反向 / 边界测试和 AI 证据范围测试 |
| `web/scripts/stage4d-action-check.ts` | 增加显式标记冲突测试，并更新通过输出 |

文档与验收资产：

- 新增 `docs/ai-handover/DRAMA_STUDIO_STAGE4D_1.md`（本报告）
- 新增 `docs/ai-handover/DRAMA_STUDIO_STAGE4D_1.diff`
- 新增 `docs/ai-handover/stage4d1-*.png` 真实浏览器截图
- 更新 `CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx`、`docs/content/docs/progress/todo.mdx`
- 删除临时文件 `web/public/stage4d1-restore.json`

没有修改 Stage 4D 的 `stage4d-engine.ts`、审核数据模型、正式写入协议、快照机制或旧 Action 单元测试断言。

## 3. 四项修复

### 3.1 过期提案状态

`markAiProposalConflictAction()` 的边界：

- 只接受仍为 `pending` 且 `proposal.storyboardVersion !== 当前正式版本` 的提案。
- 仍基于当前版本的提案拒绝标记，提示直接应用或拒绝。
- 已决策提案不能重复标记。
- 只通过 `recordProposalOutcome()` 写入 `status:"conflict"` 的 application 与 decision，`acceptedChangeIds: []`。
- 不触碰正式分镜、不重新应用、不 rebase。
- 返回 `ok / persisted / conflict / error`；只有回读确认写入后才 `persisted: true`。

真实 UI 验证：

1. 真实 proposal `ai-proposal-i8t2ay` 基于 v13，局部应用 1 项后正式分镜进入 v14。
2. 同批旧版本夹具 `ai-proposal-conflict-fixture` 仍基于 v13、保持 pending。
3. Drawer 中该提案出现「标记版本冲突」，确认层明确显示「提案基于 v13，当前正式分镜是 v14；确认后只写入冲突决策与应用记录，不修改正式分镜、不重新应用任何修改、不自动 rebase」。
4. 确认后 UI 显示「已标记版本冲突并写入本地数据库；正式分镜未改变」，提案标签变为「版本冲突」，并出现 application `ai-apply-Uy-x0Err8w`：`v13 / 0 项 / 已持久化确认`。
5. IndexedDB 中该提案 decision 为 `conflict`，正式版本仍为 v14。

注意：这条同批第二条提案是**人工注入的旧版本夹具**，不是模型生成的第二条 proposal；使用同一 `runId`、同一 v13 批次，目的是验证「第一条真实提案应用后，旧版本 pending 在真实 UI 中转 conflict」。报告不把它写成模型返回的第二条提案。

证据：

- `stage4d1-two-proposals.png`：两条 pending 均默认未选中
- `stage4d1-version-conflict-marked.png`：冲突标记成功 toast、版本冲突标签、冲突 application
- `stage4d1-apply-result.png`：真实提案「已局部接受」与冲突提案并存

### 3.2 提案默认选择

`ai-review-panel.tsx` 的 `selectedChanges` 初始化改为：

- 每个当前版本 pending 提案默认 `[]`。
- 只保留用户之前明确选中的 change ID。
- 不再用 `proposal.changes.map(...)` 默认全选。
- 增加独立「全选修改」按钮。
- 应用按钮在 0 选中时 disabled。
- 确认层显示「已选中 N / M 项；正式分镜将从 vX 写入 vX+1」。

真实 UI 验证：

- 首次打开真实 proposal：按钮「应用选中修改（0/2）」disabled，两个 checkbox 均未选中。
- 勾选第一个 change 后：1/2，按钮可用；再取消回到 0/2。
- 独立「全选修改」可全选；未把全选做成默认状态。
- 确认层显示「已选中 1 / 2 项；正式分镜将从 v13 写入 v14」，并提示其他 pending 不会自动合并。
- 点击「保存备份并应用」后，IndexedDB 正式分镜为 v14；`shot-1bks285.characterBlocking` 包含新增的钥匙动作，`action` 保持原值，证明只应用选中 1 项。

证据：

- `stage4d1-proposal-default-none.png`
- `stage4d1-proposal-one-selected.png`
- `stage4d1-apply-confirm.png`
- `stage4d1-apply-result.png`

### 3.3 AI 证据校验范围

`review-ai.ts` 现在按实际 Prompt 输入建立证据范围：

- `promptScenes(document, script, shotIds)`：按选中镜头实际 `sceneId` 生成 Prompt 剧本场景。
- `continuityPromptView(report)`：Prompt 与证据 corpus 使用同一份 `{ checkId, storyboardVersion, scope, counts, findings, gaps }` 视图。
- `compactScene` 增加实际发送的 `conflict`、`transitionIn`、`transitionOut`、`continuityNotes` 字段，不再引用不存在的 `content / summary / sourceText`。
- `evidenceCorpus()` 接收 `scopeType`、`scopeShotIds`、`shotIds`：
  - `shot_text` 只含 `allowedFindingShotIds` 对应的 `compactShot`（选中镜头 + 实际发送的相邻镜头）。
  - `script_text` 只含 `scopeShotIds` 对应的 `compactScene`（实际发送的剧本场景）。
  - `continuity_report` 只含 `relevantContinuity()` 过滤后的同一 `continuityPromptView()`。
- `parseStoryboardAiReview()` 传入实际范围，不拿完整剧本为模型证据背书。

真实 AI 证据：

- 真实 run `ai-review-PP5o8NQ68j` 的第 3 条 finding 声称剧本 `scene-uq23vl` 写明钥匙转移，但该场景不在本次实际 `script_text` 中；解析结果把该 finding 标为 `inference / speculative: true`，原因包含「证据未在script_text输入中找到，已降级为推断」。
- 同一次返回的两条 `continuity_report` 证据保持 `continuity_report / speculative: false`，没有因范围收窄被错误降级。

确定性测试：

- 已发送剧本场景 `码头对峙` 的有效 `script_text` 证据不降级。
- 引用未发送场景 `地下仓库` 的 `script_text` 证据必须降级为 `inference`。
- 已发送镜头文本 `两人对峙` 的 `shot_text` 证据不降级。
- 这些断言在 `stage4d-core-check.ts` 中通过。

### 3.4 武器取得动作

`continuity-engine.ts` 增加：

```ts
const weaponAcquired = /拔刀|拔剑|拔枪|抽出|取出|拾取|拾起|捡起|捡到|接过|接住|召出|召唤|举起|握紧|亮出|现出/.test(`${currentShot.action}；${currentShot.characterBlocking}`);
```

分支行为：

- `previousWeapon === null && typeof currentWeapon === "string"`：
  - 有取得动作：不记 gap、不记 finding。
  - 无取得动作：只记信息不足 gap，不推断武器异常。
- `previousWeapon !== undefined && currentWeapon === undefined`：仍只记信息不足，不推断武器消失。
- `previousWeapon !== null && currentWeapon === null`：仍按收剑 / 放下 / 掉落等动作判断武器消失。
- 明确空手后未记录：只报信息不足。

测试覆盖：

- 正向：拔刀、拾起短刀、接过短刀、召出长剑均不报 gap / finding。
- 反向：两人对峙、无取得动作时仍只报信息不足。
- 边界：明确空手后未记录，不能推断武器消失；上一镜有武器、当前未记录，仍只报信息不足。
- 这些用例在 `stage4d-core-check.ts` 中通过。

### 3.5 代码审查结论

四项修复均按小范围补丁审查：

- `markAiProposalConflictAction` 只走 `recordProposalOutcome()` 的审核状态事务，不调用正式写入协议，不生成新正式版本；`recordProposalOutcome()` 仍通过 `commitReviewState()` 回读校验 application 与 decision。
- 默认选择只影响 UI `selectedChanges` 初始值，不在数据层预填 `acceptedChangeIds`；应用 Action 仍独立校验 `acceptedIds` 非空、版本、依赖、人工保护、锁定、字段白名单和 before。
- `evidenceCorpus()` 的 `script_text` 只使用 `promptScenes(scopeShotIds)`，与 Prompt 的 `scenes` 同源；不存在“完整剧本参与校验、但模型没收到”的路径。
- 武器分支只在“上一镜明确空手 + 当前镜持有武器 + 无取得动作”时记信息不足 gap；不会推断武器消失，也不会把有取得动作的镜头标成异常。
- 没有降低 `before` 精确匹配、人工编辑保护、字段白名单、正式写入前备份或 `persisted` 回读要求；没有新增批量应用入口。

## 4. 额外修复：Bridge 注入失败

真实 AI 审核之前一直失败，原因不是 Prompt 长度，而是 Bridge 的注入校验：

- `expected = text.replace(/\s+/g, " ").trim().length`
- `finalLen = editor.innerText.length`

pretty JSON 的换行被折叠后，`expected` 与 `finalLen` 差异超过 10%，`injectPrompt` 误判失败。典型失败：

- `ai-review-9U_0eeTETH`：`25713/19986`
- `ai-review-nBAeo8Ot3c` / `ai-review-HWRSLvbFG7`：`7136/5822`

修复：把 `review-ai.ts` 中 8 处 `JSON.stringify(..., null, 2)` 改为 compact `JSON.stringify(...)`。没有修改 Doubao Bridge 代码。

修复后真实成功：

- 早前测试项目上已有真实 AI 成功 run，并生成过 proposal（`ai-review-dOfZXuuCvV`、`ai-review-MoXchlHaCz`、`ai-proposal-bg6f45`）；这些项目后来因误写 IDB 丢失，只保留截图，不计入本轮可复查的 IndexedDB 证据。
- 恢复项目 `ai-review-PP5o8NQ68j`（episode，v13）`completed`，3 findings，1 真实 proposal `ai-proposal-i8t2ay`，是本轮真实浏览器验收的实际证据。

## 5. 真实浏览器验收记录

环境：

- 页面：`http://127.0.0.1:3000/drama?project=proj-UORILWcK&episode=ep-GHduqaBp&step=review`
- 项目：`proj-UORILWcK`「阶段2A验收·雾港夜航」，3 集 / 8 资产；第 1 集 `ep-GHduqaBp`，正式 v13 / 8 镜 / 4 组
- 模型：`builtin-doubao / 对话`；账号 `db-mvxvft3x-a9tky`
- Bridge：`http://127.0.0.1:9091`

### 5.1 真实 AI 审核成功

- 点击「整集审核」后真实模型返回，run `ai-review-PP5o8NQ68j` 为 `completed`。
- scope episode，storyboardVersion 13，8 镜。
- 3 findings：
  - 2 条 `continuity_report`：顾北 / 沈鸢在 `sg-1rqeuuv` 内前后景深度跳变，无解释。
  - 1 条 `inference`：剧本写顾北抢走铜钥匙，但 `shot-1bks285` 未体现钥匙转移；证据未在本次 `script_text` 输入中找到，已降级。
- 1 个真实 proposal：`ai-proposal-i8t2ay`，2 changes，pending：
  - `ai-change-17k7ngl`：`shot-1bks285 / characterBlocking`
  - `ai-change-j3zvh4`：`shot-1bks285 / action`
- 审核记录与 proposal 落盘；Drawer 显示 3 findings 和 2 项修改。
- 证据：`stage4d1-ai-review-success.png`、`stage4d1-restored-project.png`。

### 5.2 真实提案 UI

- 默认 0/2 未选中；应用按钮 disabled；独立「全选修改」。
- 勾选第一项变 1/2；取消回 0/2。
- 确认层显示「已选中 1 / 2 项；正式分镜将从 v13 写入 v14」。
- 点击「保存备份并应用」后：

| 项目 | 值 |
| --- | --- |
| 正式版本 | v13 → v14 |
| 应用记录 | `ai-apply-1cshj1f`，`applied`，`v13 → v14`，1 项 |
| backup 快照 | `sbs-1a40ya2`，v13，`AI 提案应用前快照` |
| formal 快照 | `sbs-xrglrj`，v14，`AI 提案应用 v14` |
| 局部应用 | 只应用 `ai-change-17k7ngl`；`action` 仍为原文 |
| 连续性 | `continuity-run-continuity-check-qqhzhi`，v14，8 镜 / 7 对，0 Error / 2 Warning / 19 信息不足 |

- 刷新后 Drawer 仍显示「已局部接受」、冲突提案「版本冲突」、应用记录「已持久化确认」，无待决策提案。
- 证据：`stage4d1-proposal-default-none.png`、`stage4d1-proposal-one-selected.png`、`stage4d1-apply-confirm.png`、`stage4d1-apply-result.png`、`stage4d1-after-refresh.png`。

### 5.3 同批第二条提案转冲突

- 真实 proposal 应用后，正式版本 v14。
- 同批 v13 夹具 `ai-proposal-conflict-fixture` 仍在 UI 中显示「待决策」，并显示「标记版本冲突」。
- 确认标记后：

| 项目 | 值 |
| --- | --- |
| 决策 | `conflict` |
| 应用记录 | `ai-apply-Uy-x0Err8w`，`v13 / 0 项` |
| 正式分镜 | 仍 v14，未重新应用 |
| rebase | 未发生 |
| 持久化 | 「已持久化确认」 |

- 证据：`stage4d1-version-conflict-marked.png`。
- 说明：该第二条提案是人工注入的同批夹具，不是模型返回的第二条 proposal；这是本轮为验证 UI / 持久化冲突状态使用的测试数据。

### 5.4 持久化失败 UI

- 在浏览器主世界将 `IDBObjectStore.prototype.put` 对 `app_state` 注入 `QuotaExceededError`，点击「拒绝提案」。
- 结果：UI 显示失败信息，待决策提案仍在（IDB 中 `ai-proposal-persist-failure-ui-2` 仍为 `pending`），正式分镜仍 v14，没有出现成功提示。
- 观察到确认层在失败后仍停留，刷新后回到待决策列表；这是失败交互的现有表现，本轮未做额外交互打磨。
- 证据：`stage4d1-persist-failure-ui.png`。
- 边界：这是**浏览器内主世界 IndexedDB `put` 故障注入（Mock）**，不是真实 IndexedDB 事务故障注入；不能写成真实持久化故障验收通过。

### 5.5 刷新 / 页面重载恢复

- 应用 + 冲突标记后执行 `reload`，重新打开 Drawer。
- 恢复结果：
  - 正式版本 v14、8 镜。
  - 真实 proposal：`partial`，2 changes 中只接受 1 项。
  - 冲突夹具：`conflict`。
  - 应用记录：`ai-apply-1cshj1f`（applied，v13→v14），`ai-apply-Uy-x0Err8w`（conflict，v13）。
  - 审核历史：`ai-review-PP5o8NQ68j` 仍以 v13 历史 run 展示，不冒充当前 v14 审核。
- 这验证了页面刷新后的结果恢复；**不等同页面卸载期间任务恢复**，后者未做专项验证。

## 6. 持久化证据摘要

清理测试用持久化夹具后，当前 IndexedDB 的恢复项目关键状态：

```json
{
  "formalStoryboardVersion": 14,
  "shots": 8,
  "snapshots": [
    { "id": "sbs-1a40ya2", "version": 13, "type": "backup", "reason": "AI 提案应用前快照" },
    { "id": "sbs-xrglrj", "version": 14, "type": "formal", "reason": "AI 提案应用 v14" }
  ],
  "proposals": [
    { "id": "ai-proposal-i8t2ay", "status": "partial" },
    { "id": "ai-proposal-conflict-fixture", "status": "conflict" }
  ],
  "applications": [
    { "id": "ai-apply-1cshj1f", "status": "applied", "from": 13, "to": 14, "accepted": 1 },
    { "id": "ai-apply-Uy-x0Err8w", "status": "conflict", "from": 13, "accepted": 0 }
  ],
  "continuityRun": { "version": 14, "checkedShots": 8, "checkedPairs": 7, "error": 0, "warning": 2, "insufficient": 19 }
}
```

## 7. 测试记录

### 7.1 自动化 / 确定性

| 测试 | 结果 |
| --- | --- |
| `stage4d-core-check.ts` | 通过：4 个 P1 回归组、AI parse、proposal isolation/protection、persistence 组；含武器取得与证据范围新断言 |
| `stage4d-action-check.ts`（Vite SSR） | 通过：shot / episode / selection review、failed run、proposal apply、显式标记冲突、同批第二条冲突、conflict、人工保护、reject、storage failure |
| `stage3_2_2-core-check.ts`（Vite SSR） | 通过：55 例（A 8 / B 20 / C 12 / D 9 / E 6） |
| `stage4a-core-check.ts` | 通过：9 组 |
| `stage4b-core-check.ts` | 通过：8 组 |
| `stage4c-core-check.ts` | 通过：19 规则、26 组 |
| `stage4c1-core-check.ts` | 通过：人物 11 组、动作 32 例 + 8 断言、方向 15 例 + 9 引擎例、状态 18 例、异步 12 组、快照 9 组 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0，Vite 7.3.6，8315 modules；只有动态导入 / chunk 体积 warning |

### 7.2 Mock / 故障注入

- `stage4d-action-check.ts` 的 storage failure 使用注入 store 覆盖保存失败，验证 action 返回 `ok:false / persisted:false`，不是浏览器 UI 证据。
- 持久化失败 UI 使用浏览器主世界 `IDBObjectStore.prototype.put` 注入 `QuotaExceededError`，验证 UI 不显示成功、待决策不落成、正式 v14 不变。
- 这两项都不能写成真实 IndexedDB 故障注入通过。

### 7.3 失败测试及原因（未删除、未降低断言）

1. `stage4d-core-check` 第一次失败：`林舟拾起短刀` 没有被 `weaponAcquired` 识别，因为正则漏了「拾起」。补入「拾起」后通过。
2. `stage4d-core-check` 第二次失败：有效剧本证据「码头对峙」被误降级。原因是测试 fixture 用了 `title`，实际场景类型字段是 `sceneTitle`；修正 fixture，并让 `compactScene` 发送实际字段后通过。
3. `stage3_2_2-core-check` 直接用 `npx tsx` 运行时失败：`import.meta.env` 在 Node 下为 `undefined`，不是业务断言失败；按项目既有方式改用 `node scripts/vite-ssr-check.mjs` 运行，55 例通过。
4. 真实 AI 初期的 Bridge 注入失败（`25713/19986`、`7136/5822`）不是超长，而是 pretty JSON 空白折叠导致 Bridge 长度校验误判；改为 compact JSON 后通过。失败 run 仍保留为历史记录，没有被删除。

### 7.4 真实浏览器

见第 5 节。真实 AI 成功、真实提案应用、同批旧版本冲突、刷新恢复已完成；持久化失败 UI 只完成注入路径。

## 8. 测试数据事故、恢复与边界

### 8.1 误写 IndexedDB 事故

为构造同批冲突，曾在旧浏览器会话直接读 IDB 后把 proposal 对象写回 `app_state`，犯了两个错误：

1. `app_state` 是 out-of-line key，必须 `put(value, 'lihuo:studio_store')`；不带 key 会失败。
2. Zustand persist 的值必须是 JSON 字符串；写入对象导致 rehydrate 失败，页面显示“还没有短剧项目”，随后把空状态写回。

结果：原 3 个测试项目（含 `proj-stage4c-snap-1795573351974`）被清空，旧项目真实 run `ai-review-dOfZXuuCvV`、`ai-review-MoXchlHaCz` 和 proposal `ai-proposal-bg6f45` 不可恢复，只保留截图。

已恢复：

- 从 `C:\Users\qq308\Downloads\阶段2A验收·雾港夜航(4).json` 导出副本恢复项目。
- 恢复项目 ID `proj-UORILWcK`，标题「阶段2A验收·雾港夜航」，3 集 / 8 资产；第 1 集 `ep-GHduqaBp` 正式 v13 / 8 镜 / 4 组。
- 没有把恢复项目写成原始 live 项目 A。

后续夹具：

- 同批旧版本冲突提案 `ai-proposal-conflict-fixture` 是人工注入的测试数据，保留在恢复项目中作为冲突记录。
- 持久化失败测试用的 `ai-proposal-persist-fixture`、`ai-proposal-persist-failure-ui`、`ai-proposal-persist-failure-ui-2` 已在验证后从持久化记录清理，只保留截图与报告。
- 当前项目最终只保留真实 proposal `ai-proposal-i8t2ay`（partial）和同批冲突夹具 `ai-proposal-conflict-fixture`（conflict）。

### 8.2 必须保留的未验证边界

以下项目没有完成实机验证，未写入“真实通过”：

- 原始 live 项目 A。
- 跨标签页并发（本轮没有做双标签页写入）。
- 真实 IndexedDB 故障注入（本轮只有浏览器主世界 `put` 注入）。
- 页面卸载期间任务恢复（本轮只有 reload 结果恢复）。
- 真实持久化失败 UI（当前只验证了注入路径；真实 IDB 事务失败未触发）。
- 真实提案应用在原始 live 项目上的重复验收（本轮在导出副本恢复项目上完成）。

此前 4D 的确定性测试、Mock 故障注入、导出项目副本测试仍单独列出，不能冒充上述实机验证。

## 9. Diff 与 Git

- 4D.1 focused Diff：`docs/ai-handover/DRAMA_STUDIO_STAGE4D_1.diff`，6 个代码 / 脚本文件，+241 / −38；已用 LF 保存，并在当前工作区执行 `git apply --reverse --check` 通过，证明 Diff 的 new 侧与当前 4D.1 文件一致。
- 说明：Stage 4D 的四个核心文件在当前工作区仍未纳入 Git 索引，旧 4D Diff 早于 4D.1；因此 4D.1 Diff 不是普通 `git diff HEAD`，而是以 4D 基线重建后生成。`continuity-engine.ts` 的基线按 4D 代码去掉 4D.1 武器改动重建；其余新文件使用旧 4D Diff 中的完整基线。
- 本轮没有执行 `git commit`、`git push`、`git reset`、`git checkout`、`git stash`、`git clean`，没有覆盖用户已有未提交修改。
- 旧 4D 报告 / Diff 保留：`docs/ai-handover/DRAMA_STUDIO_STAGE4D.md` / `.diff`。

## 10. 边界确认

- 没有自动 rebase。
- 没有旧版本提案覆盖新版本正式分镜。
- `before` 精确匹配、人工编辑保护、字段白名单校验没有降低。
- 正式写入前备份仍然保留，应用前 backup + formal 快照已真实落盘。
- 提案失败没有显示成功；失败时正式分镜不变。
- `persisted: true` 只在 IndexedDB 回读确认后返回；没有用状态更新冒充持久化成功。
- 一条提案内部的局部接受继续保留；本轮没有开发多条提案批量应用。
- 没有进入 Stage 4E。

## 11. 验收判断

**Stage 4D.1 主体验收可以报告完成**：四项代码修复通过审查，真实 AI 审核成功，真实提案应用主路径完成真实浏览器验证，正式版本递增、backup / formal 快照、审核记录和连续性重跑均已核对。

但这不是“所有 4D.1 边界完成”：原始 live 项目 A、跨标签页并发、真实 IndexedDB 故障注入、页面卸载任务恢复、真实持久化失败仍单独保留，后续需要专项验证。
