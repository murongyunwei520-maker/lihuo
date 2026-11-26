# 离火 AI 短剧工作室 · Stage 4 全量审计

- 日期：2026-11-26
- 审计基线：Git HEAD `27b67bd09a8aead582868e139c585b7ba4b03b0e`
- 审计范围：4A、4B、4C、4C.1、4D、4D.1、4D.2、4D.2.1、4E、4F
- 本轮性质：只做代码与交付物审计，不修改业务代码，不进入 4E
- 结论：**Stage 4 不能整体宣布完成。4A–4D.2.1 已有较完整实现，但 4A 存在一个与总指令直接冲突的版本过期语义；4D 仍有审核契约与冲突状态缺口；4E、4F 尚未实现；第五步当前没有被第四步审核状态闸门拦住。**
- 本轮代码 Diff：**无**。仓库工作区现有未提交改动不属于本轮审计，未做任何回滚、暂存或提交。

---

## 0. 审计方法

1. 读取 `AGENTS.md`、`docs/ai-handover/ENTRY_POINTS.md`、`CURRENT_STATUS.md`、`KNOWN_ISSUES.md`。
2. 读取 Stage 4A–4D.2 的报告、Diff 和 4D.2 浏览器证据。
3. 以当前源码为准核对，不以过时文档覆盖实现。
4. 运行确定性脚本与类型检查；未重跑真实浏览器 / 真实 IndexedDB / 真实模型测试。
5. 不修改 `server/`、`doubao-bridge/`、全局 `AiConfig`、无限画布核心。

### 本轮实际执行的验证

| 验证 | 结果 | 说明 |
| --- | --- | --- |
| `stage4a-core-check.ts` | 通过 | `9 groups passed` |
| `stage4b-core-check.ts` | 通过 | `8 groups passed` |
| `stage4c-core-check.ts` | 通过 | `19 rules, 26 groups passed` |
| `stage4c1-core-check.ts` | 通过 | 11 identity、32 action-phase + 8 assertions、15 direction + 9 engine、18 state、12 async、9 snapshot |
| `stage4d-core-check.ts` | 通过 | 4 P1 regression、AI parse、proposal isolation/protection、persistence |
| `stage4d-action-check.ts` | 通过 | 必须走 `node scripts/vite-ssr-check.mjs /scripts/stage4d-action-check.ts`；直接 `tsx` 会因 `import.meta.env` 未定义失败，这是运行器差异 |
| `stage4d2-core-check.ts` | 通过 | `{"ok":true,"tasks":7,"metadataGuards":3,"snapshotDiscards":7}` |
| `npm run typecheck` | 通过 | exit 0 |
| `npm run build` | 本轮未重跑 | 不能把旧报告构建结果写成本轮结果 |

**测试等级声明：** 本轮 A 级（确定性）通过，B 级只核对了既有输出，C–G 级未重跑。既有 4D.2 浏览器证据仍然只按其原报告等级引用，不能升级为本轮新证据。

---

## 1. 总体结论

| 阶段 | 实现状态 | 审计判断 |
| --- | --- | --- |
| 4A 数据模型与基础能力 | 有完整实现 | **不通过**：版本过期语义与总指令冲突，P0 |
| 4B 审核工作台 | 九宫格 / 列表 / 单镜 Drawer / 批量操作已实现 | **基本通过，有 UI 完整性缺口** |
| 4C 连续性检查 | 19 条规则、26 组测试、14 类要求已覆盖 | **基本通过，问题记录缺少项目 / 集 ID 自包含字段** |
| 4C.1 遗留修复 | 10 项修复均有代码与回归测试 | **通过** |
| 4D AI 审核与提案 | 单镜 / 选中 / 整集审核、提案、安全应用已实现 | **基本通过，有 prompt、证据字段和旧提案状态缺口** |
| 4D.1 遗留修复 | 10 项修复均保留 | **通过，但旧提案仍不是自动转 conflict** |
| 4D.2 持久化 / 并发 / 恢复 | fail-closed、跨标签页、任务恢复、快照安全已实现 | **部分完成，不能关闭**：8 项风险仍有效 |
| 4D.2.1 收口 | 读取失败保护、3002 重跑、快照事务测试 | **通过，但测试等级有限**：快照测试是内存事务，不是真实 IDB 并发 |
| 4E 预览图与版本管理 | **未实现** | **未开始**；现有 Stage 3 恢复 API 不能直接当 4E 成品 |
| 4F 最终验收与第五步交接 | **未实现** | **未开始**；第五步当前没有被审核闸门拦住 |

**一句话结论：** 第四步主体已经“能用”，但还没有达到“可验收、可安全交接第五步”的状态。当前不应进入 4E，尤其不应把第五步的现有生成入口当成 4F 已完成。

---

## 2. 分阶段审计

### 2.1 Stage 4A：审核数据模型与基础能力

#### 已完成

- `StudioStoryboardReviewStatus` 已区分 `pending / approved / needs_revision / rejected / stale`，`locked` 独立表达。
- 镜头审核记录含 `shotId / status / note / storyboardVersion / reviewedAt / reviewedBy / shotContentHash / reviewedShot / staleAckKey`。
- 审核审计记录含动作、前后状态、说明、主体、版本、时间。
- 审核问题含级别、规则 / 检查码、证据、置信度、镜头 / 镜头组 / 场景、正式版本。
- AI 审核 run、AI 提案、提案变更、提案应用记录、快照类型、草稿类型均有独立类型。
- 快照类型为 `formal | conflict | backup`；快照含 `basedOnVersion`、文档、来源任务、内容哈希、冲突来源。
- 旧 V2 项目通过 `normalizeStudioProject` / `normalizeProductionForHydration` / `normalizeStoryboardReview` 补齐；旧审核记录不会直接当成当前记录。
- 没有把短剧生产状态写入 `CanvasNodeData`。
- 五步工作流仍为 `analysis / assets / script / review / video`，没有第六步、时间轴编辑器或视频拼接系统。
- 正式分镜变更通过正式写入协议递增版本；审核写入本身不改正式分镜版本。
- 审核历史通过 `audits` 追加，不覆盖旧审计记录。

#### P0 问题：版本号变化后，旧审核记录仍可能显示为当前 `approved`

总指令要求：

> 审核结果必须绑定审核时的版本。版本发生变化后，旧审核结果必须明确标记为过期。旧版本审核结果不能冒充当前版本审核结果。

当前实现 `describeShotReviewStale()` 的逻辑是：

```ts
if (record.shotContentHash) {
    return record.shotContentHash === shotReviewContentHash(shot) ? null : "content";
}
if (record.storyboardVersion !== document.storyboardVersion) return "version";
```

也就是说：

- 有 `shotContentHash` 的审核记录，只看镜头内容哈希；
- 只要该镜头内容没变，即使正式分镜从 v13 变成 v14，旧记录仍返回 `null`（不是 stale）；
- 4B 测试还显式断言“未变化的镜头不因版本号变化而 stale”。

这与 4A 报告第 185 / 209 行的“旧记录对不上当前正式版本时投影为 `stale`”直接矛盾，也与本次总指令第 4A 节直接冲突。

**影响：**

- 用户在 v13 通过镜头 A，镜头 B 修改后正式版本到 v14；镜头 A 仍显示 `approved`，可能被计入当前通过数量，并被 4F 当成可交接镜头。
- “旧版本审核结果不能冒充当前版本审核结果”这一条没有真正成立。
- 这是 **Stage 4 验收阻断项**，不是文档小问题。

**需要裁决：**

- 方案 A（按总指令严格实现）：正式版本一旦变化，所有旧审核记录一律 `stale`；重新审核生成绑定新版本的新记录。
- 方案 B（保留现在的局部 stale）：按镜头内容哈希判断，只 stale 被改动的镜头；但必须修改总指令和 4A 验收口径，并明确 4F 交接前如何证明每个 approved 记录就是当前版本审核。

在用户确认前，不应把 4A / 4B 的“旧版本不冒充当前”写成已通过。

#### P1 问题：审核问题记录自身缺少项目 / 集 ID

`StudioStoryboardReviewIssue` 有 `episodeNumber`、`sceneId`、`shotGroupId`、`shotId`、`storyboardVersion`，但没有 `projectId`、`episodeId`。它通过 `StudioEpisodeProduction` 容器间接归属项目和集；在项目内使用时成立，但：

- 导出单条 issue 或交给第五步时，无法自包含地还原项目 / 集；
- 4C 总指令要求每条问题关联项目 ID、集 ID、镜头 ID、正式版本；
- 4F handoff 必须补齐这些字段。

同类情况：`StudioStoryboardAuditRecord` 有 `episodeId` 但没有 `projectId`；`StudioAiAdjustmentProposal` 有 `episodeId` 但没有 `projectId`。建议在 4F handoff 对象中显式补齐，或直接给领域记录增加冗余 ID。

#### 结论

4A 的模型骨架完整，兼容迁移和快照类型基本达标；**但 P0 版本过期语义必须先解决，否则 4A 不能验收。**

---

### 2.2 Stage 4B：分镜审核工作台

#### 已完成

- 九宫格：镜头编号、时长、景别、审核状态、锁定状态、问题级别入口均已具备；支持单镜 / 多选。
- 列表：编号、场景、人物、动作、景别、时长、审核状态、问题计数、镜头详情入口。
- 单镜 Drawer：镜头语言、构图层次、人物站位 / 视线 / 动作、表情 / 情绪、环境 / 灯光 / 声音、对白、连续性要求、审核意见、审核历史、版本信息、锁定操作。
- 批量审核、批量锁定 / 解锁、部分成功报告：成功 / 跳过 / 失败数量均展示。
- 整份分镜锁定时，批量审核、批量锁定、详情解锁均被统一拦截；没有出现“列表禁用、详情绕过”。
- 审核与锁定彻底分离；`reviewed` 只计 `approved`；`locked + pending` 不会被当成通过。
- stale 复核、重新审核、审核备注、历史记录可用。
- 4B 确定性测试 8 组通过；4A 9 组仍通过。

#### 缺口

| 级别 | 缺口 | 证据 | 影响 |
| --- | --- | --- | --- |
| P2 | 九宫格和单镜 Drawer 没有真实镜头画面 / 预览图 | `review-shot-drawer.tsx` 显示“暂无预览图”；九宫格为占位 | 4B 总指令要求显示镜头画面 / 预览图；4E 才实现生成。当前只能算“审核占位”，不能写成预览图完成 |
| P2 | 列表只显示 error / warning，不显示 suggestion | `review-list.tsx` 只统计 `errors`、`warnings`；只有 suggestion 时显示“无” | 总指令要求快速识别错误、警告、建议；建议项在列表中被吞掉 |
| P2 | 单镜详情没有完整展示服装 / 场景绑定 ID | Drawer 有人物名、道具状态、场景标题，但没有 `outfitBindings`、`sceneBindings` 的 ID / 变体 | 总指令要求展示角色、服装、场景、道具绑定；4F 交接需要稳定 ID |

#### 结论

4B 的审核交互和锁权限基本达标；**预览图属于 4E 范围，当前不能算 4B 完成项；列表建议显示和绑定详情应在 4E/4F 前补齐。**

---

### 2.3 Stage 4C：连续性检查引擎

#### 已完成

- 引擎共有 **19 条规则**，4C 测试 **26 组**通过。
- 覆盖总指令 14 类要求：
  - 人物身份 / 绑定：`character_identity_conflict`
  - 空间位置：`position_jump`、`position_distance`
  - 移动方向：`movement_reversal`
  - 镜头轴线：`axis_cross`
  - 人物视线：`eyeline_mismatch`
  - 动作阶段 / 因果：`action_cause_missing`、`action_force_mismatch`
  - 武器 / 道具：`character_weapon_change`、`prop_holder_change`、`prop_hand_change`、`prop_state_change`、`prop_disappear`
  - 服装 / 人物状态：`character_outfit_change`、`character_injury_change`、`character_state_change`
  - 场景 / 时间：`scene_time_change`、`scene_weather_change`、`scene_environment_reset`
  - 相邻镜头 / 镜头组内部关系 / 状态继承：通过相邻镜头对和组内状态比较实现
- 检查优先使用结构化 `continuity` 字段，文本只作为回退；不是简单关键词匹配。
- 问题含 `error / warning / suggestion`、规则 ID、证据、置信度、正式版本、处理状态、`continuityStale`。
- 推断不直接当事实；无法确认时降级为 warning / suggestion 或标记证据不足。
- 定向 scope 只重算相关范围，范围外旧结果保留并标记 `continuityStale`。

#### 缺口

| 级别 | 缺口 | 影响 |
| --- | --- | --- |
| P1 | 每条 issue 没有自包含 `projectId` / `episodeId` | 总指令要求每条问题关联项目、集、镜头、版本；当前依赖外层 `StudioEpisodeProduction` 容器。项目内运行可推导，导出 / 交接不自包含 |
| P2 | 没有独立“状态继承”规则名，继承由相邻镜头比较实现 | 功能覆盖成立，但审计口径上不能声称存在一条独立规则；应在 4F 文档写清“继承由 pair state 比较实现” |

#### 结论

4C 引擎覆盖面和测试强度足够，**基本通过**；问题记录 ID 自包含是 4F 前的数据契约问题，不是当前检查逻辑错误。

---

### 2.4 Stage 4C.1：遗留问题修复与回归

#### 已完成

`stage4c1-core-check` 输出覆盖：

- 11 组人物身份 / 绑定；
- 32 个动作阶段用例 + 8 条断言；
- 15 条方向文本 + 9 个引擎用例；
- 18 个状态用例（9 对）；
- 12 组异步检查；
- 9 组快照测试。

总指令 4C.1 的 10 项修复均有对应实现或回归：

1. 部分人物绑定时仍检查镜头文本中出现但未绑定人物。
2. “林月”优先完整名称匹配，不错误匹配“林”。
3. 多人物动作主体不明确时标记证据不足。
4. “踉跄 / 后退 / 闷哼”受击反应恢复，同时区分主动后退。
5. 武器明确消失识别状态变化。
6. “明确无武器”和“武器信息未知”区分。
7. 人物取得武器时绑定具体人物。
8. 其他人物拾取武器不消除当前人物信息不足。
9. “举起手臂 / 握紧拳头”不直接证明获得武器。
10. AI Prompt 与 `evidenceCorpus` 使用完全一致的实际输入范围；4D 测试覆盖单镜 / 选中 / 整集三种范围。

#### 结论

**4C.1 通过**，没有发现回退。

---

### 2.5 Stage 4D：AI 分镜审核与调整提案

#### 已完成

- 支持单镜头、选中镜头、整集审核；三种范围分别有 action 测试。
- AI 返回经结构校验；非法 finding / proposal 进入 `warnings`，不静默吞掉。
- 每条 finding 有 `evidence`、`evidenceType`、`speculative`、`confidence`。
- AI 只能生成提案，不直接改正式分镜。
- 提案含 `proposalId`、来源 `storyboardVersion`、`episodeId`、`runId`、变更列表、决策状态。
- 每个 change 含 `shotId`、`fieldPath`、`before`、`after`、`reason`、`impact`、`evidenceType`、`speculative`。
- 初始不默认勾选；支持逐项选择、局部接受、拒绝、查看差异、提案历史。
- 安全应用前检查 expected version、来源版本、`before` 是否仍匹配、人工编辑保护、字段白名单；应用后递增正式版本、创建备份、写应用记录、重跑连续性、刷新审核状态。
- 同批第二条旧版本提案不会静默覆盖；同一提案内部允许局部选择；每次应用只递增一次正式版本；不开发多条提案批量应用。
- 正式写入失败不会显示成功；有持久化回读校验。
- 4D action 测试覆盖单镜 / 整集 / 选中审核、失败 run 落盘、提案应用、版本冲突、人工保护、拒绝、存储失败。

#### 缺口

| 级别 | 缺口 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1 | AI 审核 Prompt 的检查范围没有明确包含“景别和运镜合理性”，也没有“角色外观 / 服装连续性”的明确指令 | `review-ai.ts` 的检查范围是“人物一致性、场景、动作、空间关系、轴线、视线、道具、情绪、对白、镜头衔接” | 总指令 4D 要求审核景别 / 运镜合理性和角色外观 / 服装连续性；当前依赖模型自行从字段推断，不能证明覆盖 |
| P1 | 提案变更没有独立 `evidence` 字段 | `StudioAiProposalChange` 只有 `evidenceType / speculative`，没有证据正文 | 总指令要求每条提案包含“证据”；当前只有类型和推断标记，证据可能只存在于 finding，提案自身不完整 |
| P1 | AI 审核证据类型没有“无法确认 / unknown”这一类 | `StudioAiReviewEvidenceType = shot_text / script_text / continuity_report / inference` | 总指令要求区分“原著明确事实、有证据的推断、AI 建议、无法确认的信息”；当前只能靠 `inference + speculative + low confidence` 近似，不能严格区分 |
| P1 | 过期 pending 提案不是自动转 `conflict`，要用户点击“标记版本冲突” | `ai-review-panel.tsx` 对旧版本 pending 显示按钮；`markAiProposalConflictAction` 由用户触发；`stage4d-action-check` 也是第二条提案被再次应用时才转 conflict | 总指令要求“旧提案必须明确转为 conflict”；当前是惰性冲突，旧 pending 可以一直悬着 |
| P2 | 应用前没有对镜头已有角色 / 场景 / 道具 ID 做项目资产引用校验 | 字段白名单排除了绑定字段，`validateProposalChange` 只校验文本字段、时长和白名单；`validateStoryboardDocument` 只校验剧本场景 / 对白，不校验项目资产库 | 总指令要求应用前检查角色、场景、道具 ID；当前是“不能改 ID”而不是“确认现有 ID 仍有效” |
| P2 | “相关依赖版本”只覆盖正式分镜 / 剧本版本，没有覆盖资产 / 服装变体版本 | `sourceScriptVersion` 有；项目资产没有版本字段参与应用校验 | 资产被删除或换版后，旧提案仍可能在文本层面应用；4F 交接前必须补引用校验 |

#### 结论

4D 的“提案不直接改正式分镜、应用前对齐、人工保护、版本冲突不覆盖”主链路成立，**基本通过**；但 prompt 覆盖、提案证据字段、unknown 证据类型、旧提案自动冲突是明确的验收缺口。

---

### 2.6 Stage 4D.1：遗留问题修复

#### 已完成

1. 过期提案有 conflict 决策和 application 记录（显式标记路径）。
2. 提案初始 0 选中，应用按钮 disabled。
3. 支持逐项选择。
4. AI 证据范围与实际发送内容一致。
5. 单镜、选中、整集三种范围分别验证。
6. 武器取得动作绑定具体人物。
7. 动作主体 / 对象不明确不推断。
8. 应用前版本检查。
9. 正式写入失败不显示成功。
10. 人工编辑字段受保护。

#### 保留意见

- 第 1 项目前是“可显式标记冲突”，不是“版本变化后自动转 conflict”。如果总指令按字面执行，这一项只能算部分通过。
- 4D.1-FINAL 的武器取得和证据范围修复没有回退。

#### 结论

**除旧提案自动冲突语义外，4D.1 通过。**

---

### 2.7 Stage 4D.2：持久化、并发和任务恢复

#### 已完成

- `studio_store` 的 IndexedDB 是正式权威；读取失败 fail-closed，不回退 localStorage。
- `hydrationError` 阻断 `persistStudioStoreNow` 与 `ensureStudioMigrated`；UI 显示“工作区读取失败”，只保留重新读取。
- 4D.2.1 已验证读取成功后恢复正式写入；测试期间 localStorage 注入值未被页面读取。
- 跨标签页保护覆盖项目元数据、集数据、正式分镜、快照、提案、删除 / 恢复：
  - 正式写入通过 IndexedDB 事务 compare-and-write；
  - `assertNoStaleFormalWrite` 防止正式版本回退；
  - `assertNoStaleProjectMetadata` 防止旧 `updatedAt` 覆盖；
  - 快照删除有 project / episode / 正式版本守卫；
  - 不是只依赖 BroadcastChannel。
- 冲突写入保留内存中的未提交修改，显示“工作区尚未保存”，提供重新读取入口。
- 真实 IndexedDB 事务 abort 注入已验证：事务 abort、原始字节不变、UI 失败、刷新后旧数据一致。
- 任务恢复区分 `submitting / running / unknown / interrupted`、`submitState not_submitted`；已提交但无法确认的任务标 `unknown`，不自动重试；`not_submitted` 允许用户显式重新执行。
- 任务保存模型摘要、参数、Prompt、Prompt 版本；刷新 / 关闭标签后任务中心可恢复。
- 快照安全：formal 禁止删除；backup / conflict 有规则；删除前检查项目、集、正式版本；重复删除安全拒绝；并发删除不会误删其他快照；删除不改正式分镜版本；冲突快照保留来源版本和恢复能力。
- 4D.2.1 的 7 组快照事务测试通过。

#### 未关闭风险（必须原样保留）

1. 原始 live 项目 A 永久不可恢复。
2. 真实 AI pending 提案并发尚未复跑。
3. 真实磁盘配额耗尽尚未复现；现有证据是真实事务 abort，不是磁盘满。
4. 后端缺少任务查询接口。
5. 后端缺少幂等键；`unknown` 用户确认重试仍有重复提交 / 重复扣费风险。
6. `discardStoryboardSnapshot` 曾有一次无法归因的拒绝，保留观察；不得删除记录或放宽守卫。
7. 真实 AI pending 提案测试需要用户明确确认额度。
8. 恢复项目不能冒充原始 live 项目。

#### 缺口

| 级别 | 缺口 | 证据 | 影响 |
| --- | --- | --- | --- |
| P2 | `StudioTaskStatus` 缺少 `cancelling`，且使用美式 `canceled` 而非总指令的 `cancelled` | `web/src/types/studio.ts:414` 为 `pending / submitting / queued / running / succeeded / failed / canceled / retrying / unknown / interrupted` | 总指令要求区分“取消中”和“已取消”；当前取消是即时状态，无法表达取消请求已发出但远端未确认 |
| P0 外部阻断 | 后端无任务查询 / 幂等键 | 4D.2 报告与代码均确认 | 前端 `unknown` 只能提示用户，不能真正消除重复扣费；这一项不能靠 4E/4F 前端验收关闭 |

#### 4D.2 当前隔离证据状态（保留）

- `proj-stage4d2-iso-1795610200000`：`删除前修改-4D2`，第 1 集 `ep-GHduqaBp`，v16 / 8 镜 / 4 组；项目 `updatedAt 2026-11-25T14:07:08.908Z`。
- 无 pending 提案；已有 `ai-proposal-4d2-pending-fixture` conflict、`ai-proposal-i8t2ay` partial、`ai-proposal-conflict-fixture` conflict。
- 任务：`task-UqgGj23BsV` interrupted / not_submitted；`task-kEuJ1i02YC` unknown / submitState unknown / remote `remote-4d2-recovery-1`。
- 3000 替代项目：`proj-stage4d2-1795608774580`；历史恢复项目：`proj-UORILWcK`。
- 原始 live A 和 `proj-stage4c-snap-1795573351974` 永久不可恢复；禁止同名重建或改 ID 冒充。
- 测试不得为了构造夹具直接写正式 `app_state`；必须先备份、隔离执行、重新读取验证。

#### 结论

4D.2 **部分完成，不能关闭**。主体保护链路成立，但 8 项风险仍然有效；其中后端幂等是唯一不能仅靠前端彻底解决的风险。

---

### 2.8 Stage 4D.2.1：读取失败、证据修正、快照事务

#### 已完成

1. `studio_store` 读取失败 fail-closed：`localforage-storage.ts` 对 `studio_store` 只读 IndexedDB，失败抛出 `studioStoreReadFailed`，不回退 localStorage；非 studio 键仍保留既有回退。
2. 第一轮跨标签页矛盾证据已作废，用 3002 重跑替代；A 写成功、B 陈旧覆盖被拒绝、B 显示未保存、A 恢复标题，最终证据一致。
3. 快照删除包装补齐 7 组事务语义测试：成功、重复、project 陈旧、episode 陈旧、formal 拒绝、并发双删等；输出 `snapshotDiscards:7`。

#### 等级限制

- 7 组快照测试是内存 `StudioStateStore` 事务语义测试，不是真实浏览器 IndexedDB 并发。
- 读取失败没有新增截图，因 BUA 截图接口返回 viewport unavailable；只有 DOM 文本与返回值证据。
- 不得把 4D.2.1 的 A 级结果写成 C/D/E 级通过。

#### 结论

**4D.2.1 三项收口通过，但不能替代 4D.2 整体关闭。**

---

### 2.9 Stage 4E：预览图与版本管理（未开始）

#### 当前状态

- 没有预览图生成、预览版本、预览参数、预览与正式分镜隔离的实现。
- `StudioProductionShot` 只有 `keyframeRefs: string[]`，没有预览版本 / 生成参数 / 来源正式版本字段；不能直接满足总指令的“预览图关联镜头 ID、版本和生成参数”。
- 没有 4E 的版本差异比较 UI；现有 `buildShotStaleDiff` 只是单镜 stale 差异，不是正式版本全量 diff。
- 没有 4E 的版本恢复专用 API；现有 `applyStoryboardSnapshot` 是 Stage 3 的快照应用能力。

#### 现有恢复 API 不能直接当 4E 成品

`applyStoryboardSnapshot` / `planStoryboardSnapshotApply` 当前只检查：

- 当前正式分镜是否锁定；
- 当前是否有锁定镜头；
- `expectedVersion` 是否等于当前正式版本；
- 文档结构、场景 ID、镜头组归属、镜头重复 ID。

它**没有**检查：

1. 当前镜头是否含 `manualEditedAt` / `manualEditedFields`（人工编辑保护）。
2. 恢复后审核状态是否过期（尤其版本号变化但镜头内容未变的情况）。
3. 恢复后是否重新运行 4C 连续性检查。
4. 角色 / 服装 / 场景 / 道具资产 ID 是否仍存在。
5. 恢复前是否保留恢复前快照（当前有 backup，但需要 4E 明确审计展示）。

现有恢复 API 仍是 Stage 3 的“快照应用”，可以保留为底层能力；**4E 必须加保护层，不能把现有入口直接暴露成 4E 版本恢复。**

#### 结论

4E **0 实现**；且现有快照恢复路径存在人工编辑保护和审核过期保护缺口。进入 4E 前必须先解决 4A P0，并在 4E 内补齐上述 5 项门禁。

---

### 2.10 Stage 4F：最终验收与第五步交接（未开始）

#### 当前状态

- 没有 4F 的最终审核汇总对象、交接数据对象、交接前门禁。
- `reviewStats` 已能提供 approved / pending / rejected / locked / errors / warnings 和正式版本，但缺少预览图生成状态、未保存修改、冲突状态和交接条件。
- 没有预览图生成状态统计。
- 没有“正式版本是否最新、是否有未保存修改、是否有未处理版本冲突、审核记录是否过期、必要资产引用是否存在、是否满足生成条件”的交接检查。
- 没有 4F 的交接数据清单；现有第五步仍使用旧 `StudioShot` 结构。

#### 当前第五步没有审核闸门

- `web/src/pages/drama/index.tsx` 的五步导航只按项目和集是否存在禁用，不检查第四步 readiness。
- `web/src/pages/drama/steps/video-step.tsx` 直接使用 legacy `sequence.shots` 生成视频，没有读取 `storyboardReview`、`readiness`、`storyboardVersion` 或 `locked` 审核状态。
- 旧 `StudioShot` 交接丢失了 `shotGroupId`、`outfitBindings`、`sceneBindings`、`propBindings` 的稳定 ID、连续性结果、审核状态、正式版本、预览图引用等 4F 必需字段。

**影响：** 当前第五步可以被直接打开并生成视频，即使第四步还有未审核 / 驳回 / stale / 冲突提案。4F 不能只做“统计面板”，必须把第五步入口和生成动作真正接到 4F 交接门禁上。

#### 4F 必须具备

- 最终状态：已通过、未审核、驳回、锁定、错误、警告、预览图状态、正式版本。
- 交接数据：项目、集、正式版本、镜头、场景、ShotGroup、角色、服装变体、道具、对白、时长、景别、机位、运镜、构图、人物动作 / 微表情、环境 / 灯光、声音、预览图引用、连续性结果、人工审核状态、版本 / 锁定。
- 交接前检查：版本最新、未保存修改、版本冲突、审核过期、资产引用、生成条件。
- 未满足时必须明确提示原因，不能静默跳过。

#### 结论

4F **0 实现**；当前第五步是未受审核闸门保护的旧链路。**Stage 4 不能宣布完成。**

---

## 3. 问题清单与优先级

| 编号 | 级别 | 阶段 | 问题 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- |
| P0-1 | P0 验收阻断 | 4A / 4B | 有内容哈希的旧审核记录在正式版本变化后仍可能显示 `approved`，旧版本审核冒充当前版本 | `review-engine.ts:203-215`；`stage4b-core-check.ts:224`；`DRAMA_STUDIO_STAGE4A.md:185/209` | 先裁决严格版本 stale 还是局部 stale；按总指令默认严格版本 stale，并补回归测试 |
| P0-2 | P0 数据安全 / 4E 阻断 | 4E / Stage 3 恢复 | 现有 `applyStoryboardSnapshot` 不检查人工编辑、不刷新审核过期、不重跑连续性、不校验资产 ID | `production-actions.ts:1255-1323`；`storyboard-snapshots.ts:301-315`；`validateStoryboardDraftDocument:180-223` | 4E 前增加恢复保护层；禁止直接暴露现有 API 为 4E 成品 |
| P0-3 | P0 外部阻断 | 4D.2 / 4F | 后端缺少任务查询接口和幂等键；`unknown` 用户重试仍可能重复提交 / 重复扣费 | 4D.2 报告；`StudioTaskSubmitState` 只有前端状态 | 需用户单独批准外部正式 Fastify 后端改动；不能把前端 unknown 写成后端幂等 |
| P1-1 | P1 数据契约 | 4A / 4C / 4D / 4F | issue 缺 `projectId` / `episodeId`；audit / proposal 有 `episodeId` 但缺 `projectId`，脱离项目容器后不自包含 | `studio-production.ts:560-599`；`StudioStoryboardReviewIssue` 只有 `episodeNumber` | 4F handoff 显式补齐；必要时给领域记录增加冗余 ID |
| P1-2 | P1 AI 契约 | 4D | Prompt 未明确覆盖景别 / 运镜合理性和角色外观 / 服装连续性 | `review-ai.ts:239` | 4D 补齐检查范围与 finding 分类，补真实 AI 对照测试 |
| P1-3 | P1 AI 契约 | 4D | 提案 change 缺独立 `evidence` 字段；证据类型缺“无法确认” | `studio-production.ts:657-668`；`StudioAiReviewEvidenceType:609` | 增加 `evidence` 文本和 `unknown` 类型；严格区分四类证据 |
| P1-4 | P1 版本冲突 | 4D / 4D.1 | 旧 pending 提案不自动转 conflict，要用户手动点击 | `ai-review-panel.tsx:118-120`；`stage4d-actions.ts:361-375`；`stage4d-action-check.ts:250-257` | 版本变化刷新时将同批旧 pending 明确转 conflict，或至少强制阻断并要求一键确认；不能继续显示普通 pending |
| P1-5 | P1 交接阻断 | 4F | 第五步入口没有审核闸门，旧 `StudioShot` 交接字段不足 | `drama/index.tsx` 五步导航；`video-step.tsx` 无 readiness / review；`production-actions.ts:282-356` | 4F 新增 handoff 对象和门禁；未通过不得进入生成 |
| P1-6 | P1 文档 | 全阶段 | 交接文档严重滞后，`CURRENT_STATUS.md` 仍停在 2026-11-09 / Stage 3.2，`ENTRY_POINTS.md` 无 4A–4D.2.1 入口，`KNOWN_ISSUES.md` 无完整 4D.2 风险 | `CURRENT_STATUS.md:4/112/144`；`ENTRY_POINTS.md:27-35`；`KNOWN_ISSUES.md` 目录 | 4E 前同步交接文档；不能以旧文档覆盖当前实现 |
| P1-7 | P1 测试缺口 | 4D.2 | 真实 AI pending 提案并发尚未复跑；真实磁盘配额耗尽尚未复现 | 4D.2 报告；现有证据是 pending 夹具与真实事务 abort | 按用户顺序补真实 AI 额度测试；磁盘配额需真实环境或明确降级为已知风险 |
| P2-1 | P2 UI | 4B | 列表只显示 error / warning，suggestion 被吞 | `review-list.tsx:62-118` | 增加 suggestion 计数与图标 |
| P2-2 | P2 UI | 4B | 单镜详情未展示服装 / 场景绑定 ID | `review-shot-drawer.tsx:146/186`，无 `outfitBindings` / `sceneBindings` | 4E / 4F 前补齐绑定详情 |
| P2-3 | P2 状态机 | 4D.2 | `StudioTaskStatus` 缺 `cancelling`，使用 `canceled` | `studio.ts:414` | 补 `cancelling`，统一 `cancelled` 命名或明确映射 |
| P2-4 | P2 安全校验 | 4D | 应用前没有校验现有角色 / 场景 / 道具 ID 在项目中仍存在 | `stage4d-engine.ts` 白名单 + `validateProposalChange` 只校验文本 | 4F 交接前补项目资产引用校验 |

---

## 4. 已完成 / 未完成清单

### 已完成

- 4A：审核状态、镜头审核、审计记录、问题记录、AI run、提案、应用记录、快照类型、旧数据归一化。
- 4B：九宫格、列表、单镜 Drawer、筛选 / 排序、批量审核、批量锁定 / 解锁、部分成功报告、审核历史、整份锁定统一拦截。
- 4C：19 条连续性规则、26 组测试、结构化连续性字段、问题分级 / 证据 / 置信度 / 版本 / 处理状态、定向 scope。
- 4C.1：10 项修复及对应回归测试。
- 4D：单镜 / 选中 / 整集 AI 审核、结构校验、提案、局部接受 / 拒绝 / 差异 / 历史、安全应用、版本备份、应用后连续性刷新、失败不显示成功。
- 4D.1：10 项遗留修复，除旧提案自动冲突语义外均保留。
- 4D.2：fail-closed 读取、跨标签页守卫、真实事务 abort 失败 UI、任务恢复、快照删除安全、8 项风险记录。
- 4D.2.1：读取失败不回退、3002 证据重跑、7 组快照事务测试。

### 未完成 / 未通过

- 4A P0：版本变化后的旧审核过期语义。
- 4A / 4C / 4D 数据记录的项目 / 集 ID 自包含。
- 4D prompt 覆盖、提案 evidence、unknown 证据类型、旧提案自动 conflict、资产 ID 应用校验。
- 4D.2 真实 AI pending 并发、真实磁盘配额、后端任务查询 / 幂等键。
- 4B 列表 suggestion、详情服装 / 场景绑定、真实预览图。
- 4E 全部：预览图生成、版本管理、差异比较、恢复保护。
- 4F 全部：最终状态、交接数据、交接门禁、第五步闸门。
- 交接文档同步。

---

## 5. 建议执行顺序

### 第 0 步：确认审计口径（现在）

先确认 P0-1：

- 如果按总指令执行：正式版本变化后所有旧审核一律 `stale`，重新审核生成新记录。
- 如果保留现在的“内容签名局部 stale”：必须修改总指令和 4A / 4F 验收口径，并明确 4F 如何证明 approved 是当前版本审核。

**在确认前，不进入 4E。**

### 第 1 步：修 4A P0 与必要的 4E 前置保护

- 统一版本过期语义，补“版本 bump 后旧审核不得冒充当前”的回归测试。
- 在 4E 前给现有快照恢复加保护层：人工编辑、审核过期、连续性重跑、项目资产 ID。
- 补齐 issue / proposal 的 project / episode 自包含字段，至少保证 4F handoff 能带全。

### 第 2 步：补齐 4D 真实 AI 提案测试

- 需要用户明确确认模型额度。
- 使用隔离项目，不用原始 live A，不用导出副本冒充。
- 验证真实 AI pending 提案的跨标签页冲突与持久化。
- 不以 pending 夹具代替真实 AI。

### 第 3 步：处理后端任务查询 / 幂等键

- 这是当前唯一不能只靠前端彻底解决的重复提交风险。
- 修改外部正式 Fastify 后端需要用户另行明确批准；不得擅自改 `server/` 旧代码冒充正式后端。

### 第 4 步：进入 4E

顺序建议：

1. 先做恢复保护层，再暴露历史版本恢复入口。
2. 再做预览图生成、预览版本、预览参数、预览与正式分镜隔离。
3. 再做正式版本列表、差异比较、来源 / 时间 / 修改内容、恢复前快照。
4. 测试必须分开记录 A–G 等级；Mock 不能写成真实浏览器 / 真实 IDB。

### 第 5 步：进入 4F

- 先做最终状态汇总和交接前检查。
- 再做显式 handoff 对象，补齐 ShotGroup、服装变体、道具、连续性、审核、版本、锁定、预览引用。
- 最后把第五步入口和生成动作接到 4F 门禁；未通过不得静默进入生成。
- 4F 交接验收通过后，才能宣布 Stage 4 整体完成。

### 第 6 步：同步交接文档

- 更新 `CURRENT_STATUS.md`、`ENTRY_POINTS.md`、`KNOWN_ISSUES.md`，加入 4A–4F 当前状态、未关闭风险和入口路径。
- 修正 `CURRENT_STATUS.md` 中“项目目录不含 .git”等与当前仓库不符的过时陈述。
- 不能把本文档当成替代 `CURRENT_STATUS` 的唯一状态源。

---

## 6. 本轮交付边界

- 本文档是 **审计报告**，不是 4E 开工报告。
- 本轮未修改业务代码，因此没有代码 Diff。
- 工作区已有大量 Stage 4 / 非 Stage 4 未提交改动；本轮没有 `git reset / clean / stash / checkout`，没有自动 commit / push。
- 既有浏览器 / 真实 IDB / 真实模型证据仍按原报告等级引用，本轮未重跑。
- 4D.2 的 8 项风险继续有效，不能因本轮 A 级测试通过而关闭。
- Stage 4 只有在 4F 交接验收通过后才能宣布整体完成。
