# Stage 4C.1：连续性引擎精度与持久化修正

状态：**代码修改、确定性测试、类型检查、生产构建已完成；快照二次确认与异步检查落库已通过真实浏览器验证；等待用户审查**。

本轮不是重新开发 Stage 4C，而是在现有 4C 实现上做最小范围增量修复。没有重写连续性引擎，没有进入 Stage 4D，没有开发 AI 审查、AI 自动修复、预览图、视频生成或时间轴；没有调用真实模型，没有提交或推送。

## 0. 结论

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 人物注册表与镜头绑定分离 | 已实现；确定性测试通过 | `stage4c1-core-check` 11 组身份用例 |
| 动作阶段识别顺序 | 已实现；确定性测试通过 | 32 个表驱动用例 + 8 条补充断言 |
| 文本运动方向接入引擎 | 已实现；确定性测试通过 | 15 个方向用例 + 9 个引擎级例外用例 |
| 人物 / 道具 / 环境状态扩展 | 已实现；确定性测试通过 | 18 个状态正反例（9 对） |
| 异步检查结果复用与审核持久化 | 已实现；确定性测试通过 | 12 组异步 / 版本 / stale 用例 |
| 异步检查真实浏览器落库 | 真实浏览器测试通过 | 隔离项目；IDB 新增检查记录；重复运行不新增 |
| 快照丢弃二次确认 | 真实浏览器测试通过 | 确认层、取消不删、确认删除；正式 v14 未变 |
| FINAL1 IndexedDB 真实故障注入 | 未执行 | CDP 配额覆盖不触发真实写入失败；不能写成通过 |
| 统一类型检查 | 通过 | `npm run typecheck` exit 0 |
| 生产构建 | 通过 | Vite 7.3.6，8310 modules，exit 0 |
| Git 提交 / 推送 | 未执行 | 遵守用户禁止自动提交 / 推送的要求 |

本轮唯一额外发现并修复的运行期问题：React StrictMode 重放 effect 后 `mountedRef` 停留在 `false`，异步检查完成后被误判为页面卸载，界面显示“已取消”且不写入审核历史。修复后真实浏览器重新运行通过。

## 1. 开发前保护与边界

### 1.1 开发前检查

修改前检查了 `git status`，仓库存在用户已有修改和未跟踪文件，包括 `server/`、`doubao-bridge/`、`web/src/lib/studio/`、`web/src/pages/drama/studio/`、`web/src/types/studio-production.ts` 等。以上均视为用户资产。

本轮没有执行 `git reset`、`git checkout`、`git stash`、`git clean`，没有删除用户已有文件，没有回滚或覆盖已有修改，没有自动提交，没有自动推送，也没有做全仓格式化。

### 1.2 实际修改范围

代码只修改以下文件：

- `web/src/lib/studio/continuity-engine.ts`
- `web/src/types/studio-production.ts`
- `web/src/lib/studio/review-engine.ts`
- `web/src/lib/studio/review-actions.ts`
- `web/src/pages/drama/studio/continuity-panel.tsx`
- `web/src/pages/drama/studio/review-workspace.tsx`
- `web/src/pages/drama/studio/production/storyboard-tab.tsx`

新增确定性测试：

- `web/scripts/stage4c1-core-check.ts`

没有修改正式外部后端、`doubao-bridge`、全局 `AiConfig`、无限画布核心或全局账号行为；没有调用真实模型；没有生成视频 / 预览图。

### 1.3 阶段边界

- 只完成 Stage 4C.1，不进入 Stage 4D。
- 不开发 AI 审查或 AI 自动修复。
- 不修改正式分镜内容；审核和连续性检查只写审核数据与检查记录。
- 不修改正式写入协议，不建立第二套审核状态。
- 快照丢弃仍使用现有 `commitStoryboardSnapshotDiscard()` 事务，只新增 UI 二次确认。

## 2. 发现的问题与修复前 / 后行为

| 等级 | 问题 | 修复前行为 | 修复后行为 |
| --- | --- | --- | --- |
| P1 | 全剧注册表与当前镜头绑定混合 | `knownNames()` 把当前镜头绑定和全剧 `script.characterBindings` 合并，同名人物可能被全剧 ID 覆盖；全剧人物也会进入当前镜头的名称 / 位置推断 | `buildScriptRegistry()` 只核对全剧 ID 与规范名称；`shotNameMap()` 只读当前镜头正式绑定；新增 `characterBindingConflicts()` 和 `characterBindingGaps()`，不自动把全剧人物加入镜头 |
| P1 | 动作阶段判断顺序错误 | 先判断“准备 / 击中 / 过程”，再判断“被击中 / 受击”，导致“被击中”归为 `contact`，“受到冲击”被过程词吞掉 | 按“明确承受者 + 击飞结果特例 → 受击反应 → 动作结果 → 攻击接触 → 准备 → 过程 → 恢复”判断；“被击中 / 受到冲击”归 `reaction`，“对手被击飞”归 `result` |
| P1 | 方向解析函数没有接入 | `parseDirection()` 已存在但引擎未调用；纯文本镜头只依赖结构化 `movementDirection`，文本方向反转无法检查 | `deriveMovement()` 接入方向解析；优先级为显式 `movementDirection` > `characterBlocking` > `action`；文本不覆盖结构化字段 |
| P2 | 状态字段提取了但没有比较 | 旧代码提取了发型、配饰、姿势等字段，但未实际比较；武器、情绪、能见度等字段未进入状态比较；报告容易把“已提取”误解为“已检查” | 新增 / 接入武器、姿态 / 情绪、道具损坏 / 掉落 / 形态、环境能见度；新增规则 `character_weapon_change`、`character_state_change`、`prop_state_change`；规则总数 16 → 19 |
| P1 | 异步检查后二次完整计算 | 异步检查完成时调用 `onCommit(scope)`；审核刷新再次调用 `buildContinuityCheck()`，同一份检查可能执行两次 | 面板把异步产生的 `report` 原样传给 `onCommit(scope, report)`；审核引擎在提供报告时直接复用，只校验版本 / 分集 / 范围 |
| P2 | 快照丢弃没有二次确认 | 点击「丢弃快照」直接调用 `discardStoryboardSnapshot()`，没有确认层 | 点击只打开确认 Modal；取消不执行；确认后才调用现有丢弃事务；formal 快照仍没有入口 |
| 运行期 | StrictMode 重放 effect 导致误判取消 | `mountedRef` 在 effect cleanup 中置 `false` 后，第二次 setup 没有复位；检查完成后 `!mountedRef.current` 成立，界面显示“已取消”，审核历史不写入 | effect setup 每次设置 `mountedRef.current = true`；真实浏览器重新运行后检查完成并落库 |

## 3. P1：人物注册表与镜头实际绑定冲突

### 3.1 三类数据已分离

**全剧人物注册表**（`buildScriptRegistry()`）：

- 只枚举 `script.characterBindings` 中的 `name` 与 `characterId`。
- 只用于核对全剧是否存在该姓名 / ID，以及同名对应哪些 ID。
- 不把注册表中的人物自动加入任意镜头。

**当前镜头人物绑定**（`shotNameMap()`）：

- 只读当前镜头的 `shot.characterBindings`，保留其原始 `characterId` 和 `name`。
- 当前镜头的 `continuity.space.characters` / `continuity.characters` 仍作为当前镜头的显式补充证据，不会被注册表替换。
- 无绑定但文本提到注册表人物，只产生 `characterBindingGaps` 信息不足，不产生“人物在场”结论。

**明确出画**：

- `off_screen` 已从位置跳变比较中排除。
- 缺失绑定不能等同于人物不存在；没有绑定时只记录信息不足。

### 3.2 身份冲突规则

- 同名人物对应错误 ID：Error `continuity.character_identity_conflict`，证据同时保留镜头 ID 和注册表 ID。
- 同一 `characterId` 对应不同姓名：Warning `continuity.character_identity_conflict`，不自动改名。
- 同一镜头同名出现两个 ID：Error。
- 当前镜头人物绑定缺失、旧数据缺 `characterId` 或缺少姓名：写入 `characterBindingGaps`，不伪造身份。
- 相似名称使用最长匹配（`nameOccursInSegment()`），避免“林月”被拆成“林”。

### 3.3 确定性测试覆盖

`stage4c1-core-check` 人物身份 11 组：

1. 同一人物正常绑定。
2. 同名人物正确 ID。
3. 同名人物错误 ID：Error，shotIds `["s1"]`，evidence 含 `char-x` 与 `char-a`。
4. 同 ID 不同姓名：Warning，不自动改成注册表姓名。
5. 全剧 10 人、当前镜头 2 人：不产生身份问题，也不产生其余 8 人的绑定信息不足。
6. 明确出画：`off_screen` 不产生位置跳变。
7. 当前镜头绑定缺失，文本提到注册表人物：只产生信息不足。
8. 旧数据没有人物 ID：产生 `characterBindings[].characterId` 信息不足。
9. 两个相似名称：最长匹配，不拆出短名。
10. 绑定错误不能被归一化隐藏：问题仍带原 ID、shotIds 和证据。
11. 同一镜头同名两个 ID：Error。

上述 11 组均执行 `ruleId`、severity、shotIds、evidence、confidence、reason、suggestion、fieldPath 断言。

## 4. P1：动作阶段识别优先级

### 4.1 当前识别顺序

`parseActionPhase()` 已导出，实际顺序为：

1. 明确承受者 + 击飞 / 打飞结果特例 → `result`
2. 受击反应 → `reaction`
3. 动作结果 → `result`
4. 攻击接触 → `contact`
5. 动作准备 → `start`
6. 动作过程 → `process`
7. 恢复阶段 → `recovery`
8. 无法识别 → `undefined`（引擎在标准化时保持 `unknown`，不伪造动作主体）

### 4.2 受击与接触的区分

- 归 `reaction` 的关键词包括：被击中、被打中、受击、挨打、受到冲击、被震退、被击飞、中拳、中剑、被砍中、被刺中。
- 归 `contact` 的关键词包括：击中、打中、踢中、刺中、砍中、命中、撞击、接触目标、接触。
- “对手被击飞 / 敌人被击飞 / 目标被击飞”等明确承受者加结果词，优先归 `result`。
- “挥拳击中对手”“攻击者击中目标”仍归 `contact`；“目标被击中”归 `reaction`。
- 当前数据结构没有可靠的“动作主体 / 承受者”字段时，不伪造角色关系；无法识别的动作保持未知。

### 4.3 确定性测试规模

32 个表驱动用例覆盖全部用户点名词语：

- 受击反应 7 个。
- 攻击接触 5 个。
- 动作结果 5 个。
- 动作准备 5 个。
- 动作过程 6 个。
- 恢复阶段 4 个。

另有 8 条补充断言，包括“被击中不能归类为 contact”“受到冲击不能归类为 contact”“挥拳击中对手为 contact”“对手被击飞为 result”“人物抬手蓄力为 start”“目标被击中被 reaction 捕获”“完全未知动作返回 undefined”。

## 5. P1：运动方向解析真正接入引擎

### 5.1 数据优先级

`deriveMovement()` 的取值顺序：

1. `shot.continuity.space.movementDirection`（明确结构化字段，最高优先级）。
2. `shot.characterBlocking` 中可确定的方向文本。
3. `shot.action` 中可确定的方向文本。
4. 无法确定，`source: unknown`，不猜测。

显式结构化字段即使与文本冲突，也不被文本覆盖；文本只补充结构化字段缺失的情况。

### 5.2 支持方向

`StudioContinuityDirection` 已扩展并支持：

- 左向右 / 右向左。
- 向镜头 / 远离镜头。
- 向前 / 向后。
- 向上 / 向下。
- 顺时针 / 逆时针。
- 朝向目标、转身、停止、跌倒、起身、跳跃、被击退、瞬移、静止、未知。

文本解析新增“向左 / 向右 + 跑 / 冲 / 奔 / 移动 / 走 / 飞 / 退 / 扑 / 滑 / 滚”等组合；无法确定时返回 `undefined`，不默认成某个方向。

### 5.3 反转检查与例外

`evaluatePair()` 只在同一连续动作、真正相反的方向对之间报告 `continuity.movement_reversal`，默认 Warning，同一镜头组内 confidence 较高，跨组较低。

以下例外会压制误报：

- 明确转身（`turn`）。
- 明确停止（`stop`）。
- 场景转场（`scene_transition`）。
- 时间跳跃 / 回忆 / 梦境 / 幻境（`time_jump / flashback / dream / illusion`）。
- 动作匹配剪辑 / 跳切（`match_cut / jump_cut`）。
- 摄影机环绕（`orbit`）。
- 建立镜头（`establishing`）。
- 摄影机侧 / 结构化空间明确说明方向变化的情况。

### 5.4 确定性测试覆盖

15 个方向文本用例：

- 左向右、右向左、向镜头、远离镜头、向前、向后、向上、向下、顺时针、逆时针。
- “向左奔跑”“向右奔跑”等反向推论。
- 转身、停住、信息不足返回 `undefined`。

9 个引擎级用例：

- 纯文本左右反转产生 Warning。
- 显式结构化方向优先，文本相反不覆盖。
- 向镜头 / 远离镜头反转。
- 合理转身不误报。
- 摄影机环绕不误报。
- 建立镜头不误报。
- 明确场景转场不误报。
- 动作匹配剪辑不误报。
- 信息不足不产生反转问题。

## 6. P2：人物、道具、环境状态检查覆盖

### 6.1 人物状态

| 字段 | 当前行为 | 状态 |
| --- | --- | --- |
| `characterId` / `name` | 当前镜头绑定与全剧注册表核对，冲突保留原始证据 | 已实现并经过测试 |
| `outfitId` / 服装 ID | 比较同一角色服装 ID；服装变体由 `outfitId` 承载，当前模型没有独立 `outfitVariantId` 字段 | 已实现；独立变体字段当前数据结构不支持 |
| `hairstyle` / `accessories` | 显式 `continuity.characters` 同时存在时比较；换装 / 时间跳跃 / 转场可抑制 | 已实现并经过测试；仅显式字段 |
| `posture` / `emotion` | 同一镜头组内显式字段变化报 Suggestion `continuity.character_state_change`；动作匹配 / 跳切 / 转场 / 时间跳跃例外 | 已实现并经过测试；提示级，不判确定错误 |
| `injured` / `blood` | 沿用 4C `continuity.character_injury_change`：已建立伤势 / 血迹变为明确 `false` 才报，治疗 / 时间跳跃 / 转场可抑制 | 已实现；4C 回归覆盖正反例 |
| `weaponPropId` | 同一角色武器 ID 改变报 Warning `continuity.character_weapon_change` | 已实现并经过测试 |
| `actionPhase` / `facing` | 分别参与动作和视线判断，不作为独立持久状态比较 | 已提取；不作为独立状态规则 |

字段缺失或只有一侧有显式值时，不伪造“状态未变”的结论；当前实现只对具备双方显式证据的字段做比较，缺失的情况不产生确定性错误。信息不足会在绑定缺失、道具不可见、空间 / 轴线 / 时间缺失等已有 gap 路径中体现；不是每个可选状态字段都单独生成 gap，见第 6.4 节。

### 6.2 道具状态

| 字段 | 当前行为 | 状态 |
| --- | --- | --- |
| `propId` | 按稳定 ID 匹配前后镜头道具 | 已实现 |
| `holderCharacterId` | 持有者改变且无交接 / 拾起 / 掉落依据时报 `continuity.prop_holder_change` | 已实现并经过测试 |
| `hand` | 左右手 / 双手 / 无手改变且无换手动作时报 `continuity.prop_hand_change` | 已实现并经过测试 |
| `visible` | 显式 `visible=false` 且无收起 / 使用 / 掉落 / 转场依据时报 `continuity.prop_disappear` | 已实现并经过测试 |
| `dropped` / `pickedUp` | `dropped=true → false` 必须有 `pickedUp=true` 或例外，否则 Warning；`pickedUp` 不作为独立违规 | 已实现；pickedUp 作为解释证据 |
| `damaged` | `damaged=true → false` 报 Warning `continuity.prop_state_change`；修复 / 替换例外 | 已实现并经过测试 |
| `state` | 状态文本改变报 Suggestion `continuity.prop_state_change`；交接 / 使用 / 收刀等例外 | 已实现并经过测试 |
| `form` | 道具形态改变沿用 `continuity.prop_disappear`，不另造找不到依据的新规则 | 已实现；挂在已有规则下 |
| `transferredTo` | 作为持有者 / 换手的解释证据，不单独判错 | 已提取并参与例外判断 |
| `used` | 已提取；未单独比较布尔值，因为“使用”是动作过程，不作为持久状态误判 | 已提取但未参与独立比较 |

镜头 01“右手持剑”、镜头 02“右手挥剑”不会因为动作过程被误判为换手；只有左右手改变且缺少换手 / 交接 / 掉落依据时才提示。

### 6.3 环境状态

| 字段 | 当前行为 | 状态 |
| --- | --- | --- |
| `timeOfDay` | 同场景 / 同地点昼夜跳变报 `continuity.scene_time_change`；时间跳跃 / 转场 / 回忆 / 幻境例外 | 4C 已实现并回归 |
| `weather` / `lighting` | 同连续段落天气 / 光照变化报 `continuity.scene_weather_change`；环境变化 / 转场例外 | 4C 已实现并回归 |
| `ground` / `damage` | 地面、建筑损坏等文本状态改变沿用 `continuity.scene_environment_reset`；明确修复 / 时间跳跃 / 幻境例外 | 4C 已实现并回归 |
| `visibility` | 新增显式能见度比较，变化报 `continuity.scene_weather_change` Suggestion；环境变化例外 | 已实现并经过测试 |
| 烟尘 / 火焰 / 积水 | 当前模型没有独立布尔或数值字段，只存在于 `damage` / `ground` 等自由文本；不能伪造独立字段或数值 | 当前数据结构不支持独立字段 |
| `transition` | 支持 `continuous / cut / scene_change / time_jump / flashback / dream / illusion / unspecified`，参与例外压制 | 已实现 |

### 6.4 状态覆盖声明

- **已实现并经过测试**：人物绑定、服装 ID、发型 / 配饰、姿势 / 情绪、武器持有、道具持有者 / 左右手 / 可见 / 掉落 / 损坏 / 状态文本 / 形态、环境时间 / 天气 / 光照 / 地面 / 损坏 / 能见度。
- **已提取但未参与独立比较**：角色 `actionPhase`（参与动作判断）、`facing`（参与视线判断）、道具 `used`（只作为动作过程的布尔证据）、道具 `pickedUp` / `transferredTo`（作为掉落、换手或交接的解释证据）。
- **当前数据结构不支持**：独立服装变体 ID；独立的烟尘 / 火焰 / 积水数值字段；动作主体 / 承受者的可靠关系字段。
- **信息不足**：人物绑定缺失、旧数据缺人物 ID、下一镜头没有结构化道具状态、空间 / 轴线 / 时间字段缺失等已有 gap 路径；可选状态字段只有一侧显式时不产生“状态未变”的结论，也不会自动补值。
- **本阶段未实现**：AI 语义审查、AI 自动修复、真实预览图、视频生成、时间轴 / 音频工作区、Stage 4D。

新增状态规则均有正反例：发型、配饰、武器、姿态、情绪、损坏、掉落、形态、能见度；共 18 个断言（9 对正反例）。合理换装、治疗、拾起、交接、动作匹配、时间跳跃和环境变化均有压制案例。

## 7. P1：异步检查与审核持久化重复计算

### 7.1 当前流程

1. 用户在连续性 Drawer 选择整集 / 场景 / 镜头组 / 单镜头范围。
2. `runContinuityCheckAsync()` 按批执行检查，每批让出事件循环并回传进度。
3. 生成完整 `StudioContinuityCheckReport`，包含 `checkId`、`storyboardVersion`、`episodeId`、`scope`、计数、findings / gaps。
4. 面板检查报告版本 / 分集是否仍与任务开始时的 `document` 一致。
5. 面板把同一份 `report` 传给 `onCommit(scope, report)`。
6. `refreshStoryboardReviewAction()` 再次校验当前正式版本、分集、范围。
7. `planStoryboardReviewRefresh()` 使用传入报告，不再调用 `buildContinuityCheck()`。
8. 写入审核问题、readiness、stale 状态与 `continuityRuns`。
9. 回读确认正式分镜内容 / 版本未被修改。

**修复前**：异步检查完成调用 `onCommit(scope)`；`planStoryboardReviewRefresh` 内部再次 `buildContinuityCheck`，完整检查可能执行两次。

**修复后**：`buildAllStoryboardReviewIssues()`、`planStoryboardReviewRefresh()`、`refreshStoryboardReviewAction()` 都支持传入预计算 `continuity`；提供报告时直接复用。没有提供报告的旧调用（4 参数）仍兼容，不会破坏其他调用方。

### 7.2 报告身份与版本保护

`StudioContinuityCheckReport` 新必填：

- `checkId: string`
- `storyboardVersion: number`
- `episodeId: string`
- `scope: { type, id? }`

`checkId` 由 `episodeId + storyboardVersion + scope + findings / gaps` 的稳定哈希生成；同步和异步同一文档同一范围得到稳定相同 `checkId`。

提交前校验：

- `report.storyboardVersion` 与当前正式 `storyboardVersion` 一致。
- `report.episodeId` 与当前分集一致。
- `report.scope` 与提交 scope 一致。

不匹配时：

- `buildAllStoryboardReviewIssues()` 抛出明确错误。
- `planStoryboardReviewRefresh()` 拒绝使用旧报告。
- `refreshStoryboardReviewAction()` 返回 `{ ok: false, conflict: true, error }`，不写入审核数据。
- 面板显示错误，不提示检查成功。

### 7.3 重复提交与历史

- `continuityRun` 的 ID 改为 `continuity-run-${report.checkId}`。
- 同一 `checkId` 不重复追加 `continuityRuns`，仍保留历史中已有 run；`continuityRuns` 继续限制最多 20 条。
- `lastCheckedAt` 和 readiness 时间可因重新检查更新，但不会因重复点击产生重复历史。
- 面板新增 `inFlightRef`，防止重入；按钮在 `running || busy` 时禁用。
- 异步执行异常、提交失败、版本冲突都走 error 分支，只有 `commit.ok` 才显示成功提示。

### 7.4 取消与卸载

- 用户点击取消：`AbortController.abort()`；引擎返回 `cancelled: true`，报告 `checkedPairs=0`、`findings=[]`、`gaps=[]`，面板不提交。
- 页面卸载：effect cleanup 置 `mountedRef=false` 并 abort；结果返回后不提交。
- 异步异常：`catch` 清空运行状态、显示错误，不写成功。
- 版本冲突：保留错误信息，旧报告不绑定新版本。
- 重复提交：`inFlightRef` + 按钮禁用双层保护。

### 7.5 确定性测试覆盖

12 组异步 / 持久化用例：

- 异步检查正常完成，`onProgress` 只触发一次 `done`。
- 报告字段完整：version / episode / scope / checkId。
- 同步和异步同一文档 `checkId` 相同。
- `buildAllStoryboardReviewIssues` 使用传入报告，不重新计算。
- `planStoryboardReviewRefresh` 使用传入报告。
- 同一 `checkId` 重复 plan 不追加第二条 run。
- 版本 / 分集 / 范围不匹配时抛错。
- 取消时报告为空，不产生部分 findings / gaps。
- 计划审核不修改正式分镜 JSON。
- 旧连续性问题保留并标记 `continuityStale`，不重复、不删除不相关旧问题。

“只计算一次”的确定性证据不是函数调用次数 spy：测试向 `buildAllStoryboardReviewIssues()` / `planStoryboardReviewRefresh()` 传入预计算报告，断言 `buildAllStoryboardReviewIssues().continuity` 与传入报告是同一对象实例，并断言生成的 `continuityRun` ID 必须等于 `continuity-run-${report.checkId}`；如果内部重新调用 `buildContinuityCheck()`，对象身份与 run ID 断言会失败。代码路径上，`input.continuity ?? buildContinuityCheck(...)` 只在未提供报告时计算；浏览器重复运行还验证了同一 `checkId` 不追加重复历史。报告不把这一项写成 spy 级函数调用计数验证。

### 7.6 真实浏览器结果

隔离项目 `proj-stage4c-snap-1795573351974`，第 1 集 `ep-GHduqaBp`，正式 v14 / 8 镜 / 4 组。

初次点击「运行检查」时：

- 界面显示“已取消”。
- 没有新增审核历史。
- `lastCheckedAt / readinessCheckedAt` 保持原值。
- 根因是 StrictMode 重放 effect 后 `mountedRef.current` 保持 `false`，检查结果被当作卸载后的结果丢弃。

修复 `mountedRef` 后刷新页面重新运行：

- 出现「连续性检查完成：0 Error / 2 Warning / 16 信息不足」。
- IDB 新增一条 `continuity-run-continuity-check-q6xu4a`。
- `checkedAt = 2026-11-25T03:48:24.335Z`。
- 正式版本仍为 v14 / 8 镜 / 4 组。
- 再次点击同一检查后，`continuityRuns` 仍只有旧 4C 记录 `continuity-run-1ls2xls` + 新记录共 2 条；`lastCheckedAt` 更新为 `2026-11-25T03:49:20.792Z`。
- 没有出现重复历史；正式分镜 `updatedAt` 仍为 `2026-11-25T00:51:45.104Z`，formal `sbs-rmiw5a`，hash `15j4xc3`。

说明：浏览器能证明检查完成、审核记录写入、重复运行不重复追加历史；不能单凭浏览器证明函数调用次数，完整“只计算一次”的调用链结论来自代码路径和确定性用例。

## 8. P2：快照丢弃二次确认

### 8.1 UI 行为

修改文件：`web/src/pages/drama/studio/production/storyboard-tab.tsx`。

- 新增 `pendingDiscard` 状态。
- 快照详情 footer 的「丢弃快照」只执行 `setPendingDiscard(snapshotOpen)`，不直接丢弃。
- 新增确认 Modal，展示：
  - 快照类型。
  - 快照 ID。
  - 创建时间。
  - 关联正式分镜版本（正式快照为 `vN`，backup / conflict 为“基于 vN，不是正式 vN”）。
  - 当前正式版本。
  - 影响说明：只删除快照记录，不修改正式分镜、正式版本号或其他快照。
- 取消：`setPendingDiscard(null)`，不调用事务。
- 确认：`discardSnapshot()` 从 `pendingDiscard` 读取 ID，设置 `busy` 防重复，然后调用现有 `discardStoryboardSnapshot(project.id, episode.id, snapshotId)`。
- 成功后关闭确认层；如果详情仍显示同一快照，同时关闭详情。
- `formal` 快照 footer 仍不渲染「丢弃快照」按钮。

### 8.2 保护规则

确认层不绕过任何现有事务检查：

- `projectId` / `episodeId`。
- 快照存在性。
- `updatedAt` 版本检查。
- formal 快照拒绝丢弃。
- 正式分镜版本和 formal 快照 ID 不变。
- 项目 / 分集 / 快照身份检查。

### 8.3 确定性测试覆盖

9 组快照事务用例：

1. formal 快照拒绝，写入前原始 raw 不变。
2. 快照不存在拒绝。
3. 项目 `updatedAt` 冲突拒绝。
4. 分集 `updatedAt` 冲突拒绝。
5. backup 正常丢弃；formal 保留；正式版本 v14 不变。
6. conflict 正常丢弃。
7. 第二次丢弃同一快照拒绝，不重复写。
8. 刷新持久化后只剩 formal + 剩余 backup。
9. 正式分镜内容与版本不变。

### 8.4 真实浏览器结果

隔离项目 `proj-stage4c-snap-1795573351974`：

- 打开 backup `sbs-legacy-ofj7j3` 详情，点击「丢弃快照」，只出现「确认丢弃快照？」确认层。
- 取消后，快照列表仍有 4 条，`sbs-legacy-ofj7j3` 仍在。
- 再次打开并点击「确认丢弃」，列表从 4 条变为 3 条，`sbs-legacy-ofj7j3` 消失。
- 剩余快照：formal `sbs-rmiw5a` v14、backup `sbs-legacy-tgwo17` v8、backup `sbs-legacy-1hs68v` v4。
- IDB 读回 3 条快照；正式版本 v14 未变；formal 快照仍在。
- 打开 formal 快照详情，没有「丢弃快照」按钮。
- 证据截图：`docs/ai-handover/stage4c1-snapshot-confirm.png`、`stage4c1-snapshot-after-discard.png`。

补充一轮取消与 formal 入口截图：

- 重新打开 backup `sbs-legacy-tgwo17`，点击「丢弃快照」，确认层显示类型、ID、创建时间、关联版本、当前正式版本和影响；截图 `stage4c1-snapshot-confirm-cancel.png`。
- 点击「取消」，确认层关闭；详情仍停留，VERSIONS 列表仍为 3 条，`sbs-legacy-tgwo17` 仍在；截图 `stage4c1-snapshot-cancel-result.png`。
- 打开 formal `sbs-rmiw5a` 详情，操作区只有「保留快照 / 复制到新草稿 / 应用为正式版本」，没有「丢弃快照」；截图 `stage4c1-snapshot-formal-no-discard.png`。
- 以上均在隔离项目操作，未修改正式分镜 v14；测试后已恢复审核工作台 URL。

## 9. FINAL1：IndexedDB 真实故障注入

### 9.1 已尝试

- 使用 CDP `Storage.overrideQuotaForOrigin` 设置 `quotaSize: 0`。
- `getUsageAndQuota` 返回 `overrideActive: true`、`quota: 0`。
- 在该状态下执行真实 5 MB IndexedDB 写入，仍然成功，没有触发真实 `QuotaExceededError` 或事务失败。
- 恢复覆盖为 `overrideActive: false`，删除探针库 `lihuo-fault-probe` / `lihuo-fault-probe2`。
- 没有修改用户正式项目，没有向正式数据制造失败，没有通过控制台抛普通异常冒充 IndexedDB 事务失败。

### 9.2 结论

**未执行 / 无法验证**。当前浏览器自动化后端无法用配额覆盖制造真实 IndexedDB 事务失败；此项保留为未完成事项，不能写成真实浏览器故障注入通过。

## 10. 测试矩阵

### 10.1 Stage 4C.1 确定性测试

命令：

```text
cd web
npx --yes tsx scripts/stage4c1-core-check.ts
```

输出：

```text
stage4c1-core-check: 11 identity groups, 32 action-phase cases + 8 assertions, 15 direction texts + 9 engine cases, 18 state cases (9 pairs), 12 async groups, 9 snapshot groups passed
```

| 类别 | 组数 / 用例 | 关键断言 | 结果 |
| --- | --- | --- | --- |
| 人物身份 | 11 组 | ruleId、severity、shotIds、evidence、confidence、信息不足 gap、无全剧人物混入 | 通过 |
| 动作阶段 | 32 个表驱动 + 8 条补充断言 | reaction / contact / result / start / process / recovery、未知返回 undefined | 通过 |
| 方向解析 | 15 个文本用例 + 9 个引擎用例 | explicit / blocking / action 优先级、左右反转、向 / 离镜头、转身 / 环绕 / 转场 / 匹配剪辑 / 信息不足 | 通过 |
| 状态比较 | 18 个断言（9 对正反例） | 发型、配饰、武器、姿态、情绪、损坏、掉落、形态、能见度 | 通过 |
| 异步持久化 | 12 组 | checkId、report 复用、版本 / 分集 / scope、取消、去重、stale、正式分镜不变 | 通过 |
| 快照事务 | 9 组 | formal 拒绝、backup / conflict 删除、版本冲突、持久化、正式版本不变 | 通过 |
| 规则注册表 | 1 组 | 19 条规则、ID 唯一 | 通过 |

### 10.2 回归

| 测试 | 结果 |
| --- | --- |
| `stage4c-core-check` | 通过：19 rules，26 groups |
| `stage4a-core-check` | 通过：9 groups |
| `stage4b-core-check` | 通过：8 groups |
| `stage3_2_2-core-check`（esbuild 注入 `import.meta.env`） | 通过：55 例，`pass=true` |
| `npm run typecheck` | 通过，exit 0 |
| `npm run build` | 通过，Vite 7.3.6，8310 modules，exit 0 |

`stage3_2_2` 55 例分组仍为 A 8 / B 20 / C 12 / D 9 / E 6；4A / 4B / 3.2.2 只运行确定性回归，没有重跑浏览器。

## 11. 浏览器证据

| 证据 | 路径 | 说明 |
| --- | --- | --- |
| 快照丢弃确认层 | `docs/ai-handover/stage4c1-snapshot-confirm.png` | 快照类型、ID、创建时间、关联正式版本、当前正式版本、影响说明；取消 / 确认 |
| 快照丢弃后 | `docs/ai-handover/stage4c1-snapshot-after-discard.png` | 4 → 3 条快照；formal `sbs-rmiw5a` v14 保留 |
| 取消前的确认层 | `docs/ai-handover/stage4c1-snapshot-confirm-cancel.png` | backup `sbs-legacy-tgwo17` 的确认层 |
| 取消后列表 | `docs/ai-handover/stage4c1-snapshot-cancel-result.png` | 确认层关闭；VERSIONS 仍 3 条，`sbs-legacy-tgwo17` 仍在 |
| formal 详情 | `docs/ai-handover/stage4c1-snapshot-formal-no-discard.png` | 正式快照 `sbs-rmiw5a` 详情；操作区无「丢弃快照」 |
| 异步检查修复前 | `docs/ai-handover/stage4c1-continuity-drawer.png` | 显示“已取消”；作为失败 / 修复前证据，不写成通过 |
| 异步检查修复后 | `docs/ai-handover/stage4c1-continuity-run.png` | 已检查 7 对镜头；0 Error / 2 Warning / 16 信息不足 |

真实浏览器已通过：

- 快照确认层展示字段。
- 点击取消不删除。
- 点击确认才删除。
- formal 快照没有丢弃入口。
- 正式 v14 / 8 镜 / 4 组未变。
- 异步检查完成后审核记录写入。
- 重复运行同一检查不新增 `continuityRuns`。

真实浏览器未执行：

- 检查期间修改正式分镜导致版本冲突的 UI 场景。
- 真实持久化失败 UI 场景。
- 页面卸载、取消后返回页面的完整 UI 路径。
- 原始 live 项目 A 回归。

## 12. 修改前后 Diff 摘要

文件：`docs/ai-handover/DRAMA_STUDIO_STAGE4C_1.diff`

| 文件 | 新增 | 删除 |
| --- | ---: | ---: |
| `web/src/lib/studio/continuity-engine.ts` | 497 | 53 |
| `web/src/types/studio-production.ts` | 12 | 0 |
| `web/src/lib/studio/review-engine.ts` | 21 | 6 |
| `web/src/lib/studio/review-actions.ts` | 16 | 3 |
| `web/src/pages/drama/studio/continuity-panel.tsx` | 23 | 4 |
| `web/src/pages/drama/studio/review-workspace.tsx` | 3 | 2 |
| `web/src/pages/drama/studio/production/storyboard-tab.tsx` | 32 | 4 |
| `web/scripts/stage4c1-core-check.ts` | 742 | 0 |
| **合计** | **1346** | **72** |

Diff 基线说明：

- 7 个代码文件与测试文件在当前仓库中均为未跟踪文件（`??`），不能从 Git 旧版本直接生成增量 Diff；没有改动、删除或回滚这些用户已有文件。
- `continuity-engine.ts`、`types/studio-production.ts`、`review-engine.ts`、`review-actions.ts`、`continuity-panel.tsx`、`review-workspace.tsx` 的旧侧取自本轮修改前保存的 Stage 4C 源码树 `C:\Users\qq308\AppData\Local\Temp\stage4c-diff\new`。
- `storyboard-tab.tsx` 在当前仓库中是未跟踪文件，没有 4C 保存的旧侧；Diff 的旧侧是通过只反向移除 4C.1 的快照确认改动重建的，不包含该文件更早的用户 / 4C 历史。
- 新测试文件整文件计入 Diff。
- Diff 已做应用校验：把 Diff 应用到保存的 4C 基线临时树后，8 个文件的 LF 归一化内容与当前代码树逐文件一致；`git apply --stat` 统计为 8 files changed，1346 insertions(+)，72 deletions(−)。
- Diff 不包含 `CHANGELOG.md`、`todo.mdx`、`pending-test.mdx` 与本报告；这些是文档变更，不是运行时修改。

## 13. 未完成事项

1. **FINAL1 IndexedDB 真实故障注入**：未执行；CDP 配额覆盖不能触发真实事务失败。
2. **真实浏览器版本冲突**：仅确定性测试覆盖；没有在浏览器中制造检查期间正式版本变化。
3. **真实持久化失败 UI**：代码有 error 分支，但没有真实 IndexedDB / 审核写入失败注入；不能写成“真实浏览器验证通过”。
4. **页面卸载 / 取消后的完整 UI 回归**：代码已实现，确定性取消测试通过；没有真实浏览器取消后返回页面的证据。
5. **原始 live 项目 A**：本轮只在隔离项目与确定性夹具上验证，未重跑用户原始 live 项目。
6. **真实模型调用**：未执行。
7. **Stage 4D**：未进入；AI 审查、AI 修复、预览图、视频生成未开发。

## 14. 已知风险

- 人物注册表只使用 `script.characterBindings`；剧本缺失时，同名错误 ID 的跨镜头检测能力下降，只能在当前镜头内或已有显式字段中发现问题。
- 可选状态字段只有一侧有显式值时不做比较，避免伪造“未变”；这意味着某些真实状态变化可能因数据缺失而无法提示，属于信息不足而不是已检查通过。
- `used`、`pickedUp`、`transferredTo`、`actionPhase`、`facing` 没有作为独立持久状态规则；它们分别作为动作、掉落恢复、交接、视线证据使用。
- 独立服装变体、烟尘 / 火焰 / 积水独立字段当前数据结构不支持；不能为满足清单而虚构字段。
- 方向解析仍依赖有限中文关键词；复杂长句、反讽、比喻或主体不明的文本可能返回未知或被归入较宽泛的方向，已有例外可压制常见误报，但不能保证语义完全准确。
- 异步检查的审核写入仍通过现有 Zustand `updateEpisodeProduction` 路径，不是正式分镜事务；已通过版本 / 回读检查保护正式 `storyboardVersion`，但没有额外的真实并发写入故障注入。
- `checkId` 去重意味着同一内容重复点击不会创建新的历史 run，只更新 `lastCheckedAt`；如果未来产品要求每次点击都保留独立记录，需要重新定义历史键。
- 浏览器自动化进行到后续步骤时页面 viewport 曾变为 0×0，已停止继续截图；已取得的成绩来自此前真实页面与 IDB 读回，不用 0×0 状态冒充新证据。
- Vite 构建仍有大 chunk 警告（`index-BehRFZOn.js` 约 4,921.56 kB）；exit 0，不阻塞本阶段，但属于既有风险。

## 15. 最终状态

| 交付项 | 状态 |
| --- | --- |
| Stage 4C.1 代码修复 | 已实现 |
| 4C.1 确定性测试 | 确定性测试通过 |
| TypeScript 类型检查 | 通过 |
| 生产构建 | 通过 |
| 快照二次确认真实浏览器 | 真实浏览器测试通过 |
| 异步检查落库真实浏览器 | 真实浏览器测试通过 |
| IndexedDB 真实故障注入 | 未执行 / 无法验证 |
| 报告 | 本文件 |
| Diff | `DRAMA_STUDIO_STAGE4C_1.diff` |
| 提交 / 推送 | 未执行 |
| Stage 4D | 未进入 |

本轮在此停止，等待用户审查报告与完整 Diff。
