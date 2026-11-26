# Stage 4D.1-FINAL：武器取得人物绑定与 AI 审核输入范围报告

## 1. 结论

Stage 4D.1-FINAL 只处理两个针对性问题，没有大规模重构：

- 武器取得动作已绑定到正在检查的角色，不再因其他人物拾取武器或普通肢体动作消除当前角色的信息不足。
- AI Prompt 与证据库已改为共用同一份审核输入视图，单镜 / 选中 / 整集三种范围逐字段比对一致。

两项修改均已通过自动化测试、`typecheck`、`build` 和 Stage 4A / 4B / 4C / 4C.1 / 4D.1 回归。没有进入 Stage 4E，没有修改全局 `AiConfig`、Doubao Bridge、外部正式后端或无限画布核心，没有执行 Git commit / push / reset / clean / stash。

## 2. 修改文件

| 文件 | 修改原因 |
| --- | --- |
| `web/src/lib/studio/continuity-engine.ts` | 新增角色级武器取得判断；区分动作主体、动作对象和普通肢体动作 |
| `web/src/lib/studio/review-ai.ts` | 抽取 `createReviewInputView`；Prompt 与证据 corpus 共用同一份镜头、场景、连续性输入 |
| `web/scripts/stage4d-core-check.ts` | 增加 5 个指定武器场景、额外主体 / 对象边界，以及单镜 / 选中 / 整集 Prompt 与 corpus 逐字段一致性测试 |

没有修改现有的明确空手、未知武器状态、武器消失判断；没有修改 4D.1 的冲突标记、默认选择、备份、before 匹配、人工编辑保护和字段白名单逻辑。

## 3. 武器取得人物绑定

### 3.1 判断顺序

新增 `weaponAcquisitionForCharacter(shot, character, peers)`：

1. 按标点把 `action` / `characterBlocking` 切成动作分句。
2. 在分句中找取得动词。
3. 判断动作主体：
   - 正常主动句取分句首个明确人物名，且该名字前只允许“随后 / 立即 / 突然 / 转身 / 弯腰”等副词。
   - `从沈砚手中接过` 里的沈砚按来源处理，不抢主体。
   - `被` 被动句按 `被` 后的施事者判断。
   - 出现其他插入人物且无法确认是来源时，按主体不明处理。
4. 判断动作对象：
   - `拔刀 / 拔剑 / 拔枪 / 抽刀 / 抽剑 / 抽枪` 这类动词本身即包含武器。
   - `拾起 / 接过 / 召出 / 举起 / 握紧` 等必须有武器对象。
   - `手臂 / 胳膊 / 拳头 / 手掌 / 手指 / 手腕 / 刀柄 / 剑柄 / 枪柄 / 刀鞘 / 剑鞘 / 枪套 / 话` 不算武器对象。
   - 对象不明确时保留信息不足。
5. 只有“主体是当前角色 + 对象是武器”才返回 `true`。

### 3.2 行为

- 上一镜明确空手，当前镜持有武器，且有当前角色的取得动作：不记 gap / finding。
- 上一镜明确空手，当前镜持有武器，但没有当前角色的取得动作：只记 `continuity.character_weapon_change` 信息不足 gap。
- 其他人物拾取武器：当前角色仍保留 gap，不记武器异常。
- 普通“举起手臂 / 握紧拳头”：仍保留 gap。
- 明确空手 → 未记录：仍只报信息不足，不推断武器消失。
- 明确持有 → `weaponPropId:null`：仍按收剑 / 放下 / 掉落判断武器消失。
- 被动句 `短刀被林舟拾起` 可作为林舟的取得动作；`林舟的短刀被沈砚拾起` 不会消除林舟的 gap。

### 3.3 测试

`stage4d-core-check.ts` 新增并通过：

1. `林舟拾起武器`：不报信息不足。
2. `沈砚拾起武器，林舟获得武器绑定`：林舟仍报信息不足，不报武器异常。
3. `林舟举起手臂` 与 `林舟握紧拳头`：仍报信息不足。
4. `林舟明确拔刀`：不报信息不足。
5. `拾起武器`（主体不明）：保留信息不足。
6. 额外：`林舟从沈砚手中接过短刀` 不报；`林舟的短刀被沈砚拾起` 仍报；`林舟将短刀拾起` 不报；`短刀被林舟拾起` 不报。

## 4. AI Prompt 与证据库同范围

### 4.1 共用输入视图

`review-ai.ts` 新增 `createReviewInputView`，统一产出：

- `selectedIds`
- `selectedShots`
- `contextShots`
- `scenes`
- `continuity`
- `existingIssues`

`buildStoryboardReviewPrompt` 和 `buildStoryboardReviewEvidenceCorpus` 都调用同一个函数：

- 选中镜头按正式分镜顺序过滤。
- 相邻镜头按正式分镜顺序过滤，且排除选中镜头。
- 剧本场景只按选中镜头的 `sceneId` 生成。
- 连续性报告按同一 `scopeType` 和同一选中镜头过滤。
- 证据 corpus 的 `shot_text` 就是 Prompt 中“选中镜头 + 相邻镜头”的同一组 `compactShot` JSON。
- 证据 corpus 的 `script_text` 就是 Prompt 的同一组 `compactScene` JSON。
- 证据 corpus 的 `continuity_report` 就是 Prompt 的同一份 `continuityPromptView` JSON。

未发送的镜头、剧本场景和连续性内容不会进入证据库。`existingIssues` 只作为 Prompt 输入，不参与 `shot_text / script_text / continuity_report` 证据类型，因此没有放入 corpus。

### 4.2 测试

`stage4d-core-check.ts` 新增单镜 / 选中 / 整集三组逐字段比对：

- 从 Prompt 文本中解析 `【选中镜头】`、`【相邻镜头】`、`【相关剧本场景】`、`【4C 连续性检查结果】`。
- 与 `buildStoryboardReviewEvidenceCorpus` 的 `shot_text / script_text / continuity_report` 做 `JSON.parse` 后深度相等断言。
- 单镜只发送当前镜头的剧本场景；选中发送选中镜头涉及的全部场景；整集发送整集场景。
- 未发送的 `sc-1` 不会出现在只审核 `sc-2` 的 `script_text` 中。

三组均通过。

## 5. 测试与构建

| 项目 | 结果 |
| --- | --- |
| `npx tsx scripts/stage4d-core-check.ts` | 通过：4 个 P1 回归组、AI parse、proposal isolation/protection、persistence 组；含新增武器与 Prompt/corpus 一致性断言 |
| `node scripts/vite-ssr-check.mjs scripts/stage4d-action-check.ts` | 通过：shot / episode / selection review、失败 run、提案应用、显式冲突、同批第二提案冲突、拒绝、存储失败 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0，Vite 7.3.6，8315 modules；仅有既有 dynamic/static import 与 chunk 体积 warning |
| Stage 3.2.2 | 55 例通过（A 8 / B 20 / C 12 / D 9 / E 6） |
| Stage 4A | 9 组通过 |
| Stage 4B | 8 组通过 |
| Stage 4C | 19 规则、26 组通过 |
| Stage 4C.1 | 人物 11 组、动作 32 例 + 8 断言、方向 15 例 + 9 引擎例、状态 18 例、异步 12 组、快照 9 组通过 |

没有删除失败用例或降低断言。4D.1-FINAL 修改的是纯逻辑与 Prompt 构造，真实浏览器回归沿用 4D.1 已完成的真实 AI / 真实提案主路径；本轮没有重新调用真实模型，也没有把真实浏览器证据写成新增通过。

## 6. Diff 与边界

- 独立 Diff：`docs/ai-handover/DRAMA_STUDIO_STAGE4D_1_FINAL.diff`
- 3 个文件，`+265 / −22`。
- 已用 LF 保存，并在当前工作区通过 `git apply --reverse --check`，证明 Diff 的 new 侧与当前文件一致。
- 本轮没有执行 commit / push / reset / clean / stash。
- 未验证边界仍按 4D.1 报告保留：原始 live 项目 A、跨标签页并发、真实 IndexedDB 故障注入、页面卸载期间任务恢复、真实持久化失败。
- 不进入 Stage 4E。
