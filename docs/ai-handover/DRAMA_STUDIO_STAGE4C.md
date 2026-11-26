# Stage 4C：专业分镜连续性检查引擎

状态：**部分完成，等待用户审查**。连续性检查引擎、审核集成、第四步检查面板和确定性测试已完成；FINAL1 三项真实浏览器遗留事项完成两项，IndexedDB 真实故障注入未执行，原因与证据见 12.4。

本轮没有调用真实模型，没有提交，没有推送，没有进入 Stage 4D，没有开发 AI 自动审查、AI 自动修复、预览图、视频生成、时间轴、音频或第六步。

## 0. 结论

| 项目 | 结果 |
| --- | --- |
| Stage 4C 连续性检查引擎 | 已实现 |
| 16 条规则、证据、等级、置信度、信息不足 | 已实现 |
| 接入 4B `StoryboardReviewIssue` / stale / 版本绑定 | 已实现 |
| 第四步连续性检查 Drawer 与筛选、定位、上下文 | 已实现，真实浏览器打开并运行过 |
| 4C 确定性测试 | 通过：16 rules，26 groups |
| 4A / 4B 回归 | 通过：9 组 / 8 组 |
| Stage 3.2.2 55 例回归 | 通过：A 8 / B 20 / C 12 / D 9 / E 6，`pass=true` |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过（Vite 7.3.6，本轮重新构建） |
| FINAL1 快照丢弃真实点击 | 通过；但 UI 没有二次确认弹窗，点击按钮直接执行 |
| FINAL1 双标签页删除项目真实点击 | 通过；Tab B 删除被版本守卫拒绝，冲突提示真实出现 |
| FINAL1 IndexedDB 真实故障注入 | **未执行**；CDP 配额覆盖无法让真实 IndexedDB 事务失败，不能写成通过 |
| 真实模型调用 | 未执行 |
| Git 提交 / 推送 | 未执行 |

## 1. 开发前检查与历史边界

### 1.1 实际读取的文件

本轮实际读取并核对了：

- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2_FINAL.md`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2_FINAL1.md`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2.diff`
- `docs/ai-handover/DRAMA_STUDIO_STAGE4A.md`
- `docs/ai-handover/DRAMA_STUDIO_STAGE4A.diff`
- `docs/ai-handover/DRAMA_STUDIO_STAGE4B.md`
- `docs/ai-handover/DRAMA_STUDIO_STAGE4B.diff`

用户点名的 `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2_FINAL1.diff` **在当前仓库中不存在**。本轮没有创建或补造这个文件，只读取了实际存在的 `DRAMA_STUDIO_STAGE3_2_2.diff`。

本轮检查的真实源码包括：

- `web/src/lib/studio/review-engine.ts`
- `web/src/lib/studio/review-actions.ts`
- `web/src/pages/drama/studio/review-workspace.tsx`
- `web/src/pages/drama/studio/review-grid.tsx`
- `web/src/pages/drama/studio/review-list.tsx`
- `web/src/lib/studio/storyboard-snapshots.ts`
- `web/src/lib/studio/production-actions.ts`
- `web/src/lib/localforage-storage.ts`
- `web/src/lib/studio/storyboard-write-protocol.ts`
- `web/src/stores/use-studio-store.ts`
- `web/src/types/studio-production.ts`

### 1.2 已有实现与 4C 的边界

已有 4A / 4B 检查是**结构、引用和镜头组一致性检查**，不是跨镜头连续性检查：

- 空分镜、空镜头组、重复组 ID、组引用未知场景、缺少轴线 / 共享布局 / 镜头引用。
- 镜头无 ID、重复 ID、未知组、未登记到组、场景不一致、被多个组共享。
- 镜头时长非法或过长、镜头语言不完整、动作 / 调度 / 提示词为空。
- 人物 / 道具绑定引用失效、对白说话人无 characterId、说话人不在画面。
- 上游 stale、重复镜号、组引用不存在的镜头。
- 4A / 4B 已有审核状态、审核历史、锁定、stale、readiness 和版本绑定。

4C **没有重复实现这些检查**。4C 只新增同一场景内连续镜头、同一 ShotGroup 内镜头、跨组边界和跨场景边界的关系检查。

已有正式分镜写入入口仍是 `commitFormalStoryboardWrite()`；4C 不修改正式写入协议，不修改正式分镜内容，不建立第二套审核状态。

### 1.3 FINAL1 历史边界

以下边界在本轮仍然有效：

- 原始 live 项目 A 当前不可用；E 只验证了项目 A 的导出副本 `阶段2A验收·雾港夜航(4).json`，不能写成 live A 回归。
- D 是确定性故障注入，不是浏览器存储故障注入。
- F1–F5 与 F6 分属两个浏览器会话，不能合并写成同一会话连续通过。
- 未调用真实模型，未提交，未推送。
- FINAL1 的三项真实浏览器操作必须逐项记录，不能因 4C 功能完成而自动关闭。

## 2. 连续性数据模型

4C 在 `web/src/types/studio-production.ts` 中给 `StudioShotGroup` 和 `StudioProductionShot` 增加可选 `continuity`，旧镜头缺失字段时只能产生信息不足，不伪造机位、空间或道具状态。

### 2.1 镜头空间状态

`StudioShotContinuityState.space` 支持：

- `characters[]`：`characterId`、`screenSide`（left / center / right / off_screen / unknown）、`depth`（foreground / midground / background / unknown）、`distance`、`facing`、`facingTargetId`、`eyelineTargetId`。
- `cameraSide`：`axis_left / axis_right / on_axis / unknown`。
- `movementCharacterId`、`movementDirection`。
- `establishing`、`subjective`、`orbit`、`crossAxis`。

### 2.2 人物、道具、环境、动作

- `characters[]`：`outfitId`、`hairstyle`、`accessories`、`injured`、`blood`、`weaponPropId`、`posture`、`emotion`、`facing`、`actionPhase`。
- `props[]`：`propId`、`holderCharacterId`、`hand`（left / right / both / none / unknown）、`state`、`visible`、`damaged`、`dropped`、`pickedUp`、`transferredTo`、`used`、`form`。
- `environment`：`timeOfDay`、`weather`、`lighting`、`ground`、`damage`、`visibility`、`transition`。
- `action`：`phase`（start / process / contact / reaction / result / recovery / unknown）、`actorId`、`targetId`、`actionType`、`contactPoint`、`forceDirection`、`reactionDirection`、`interrupted`、`causeShotId`。
- `exceptions[]`：`turn`、`stop`、`costume_change`、`injury`、`heal`、`time_jump`、`scene_transition`、`flashback`、`dream`、`illusion`、`cross_axis`、`subjective`、`establishing`、`orbit`、`match_cut`、`jump_cut`、`slow_motion`、`omitted_process`、`result_first`、`prop_handoff`、`prop_drop`、`prop_pickup`、`prop_consume`、`environment_change`、`other`。

### 2.3 审核问题扩展

`StudioStoryboardReviewIssue` 增加可选字段：

- `ruleId`
- `confidence`（high / medium / low）
- `shotIds`
- `fieldPath`
- `evidence`
- `storyboardVersion`
- `continuityStale`
- `continuityScope`

`StudioStoryboardReview` 增加 `continuityRuns?: StudioContinuityRun[]`，只保留检查摘要，最多 20 条；检查历史不冒充当前检查结果。

## 3. 引擎分层

实现位于 `web/src/lib/studio/continuity-engine.ts`。

1. **输入归一化**：显式结构化字段优先；文本只作为补充推导（例如从 action / characterBlocking 推导同组人物左右和视线），缺失字段不臆造。
2. **镜头关系构建**：同一 ShotGroup 内相邻镜头、组边界、场景边界；不是所有镜头两两比较。
3. **空间状态提取**：人物屏幕侧、景深、距离、朝向、视线目标、相机侧、运动方向。
4. **时间 / 场景状态提取**：场景、时间、天气、光照、地面、破坏、转场。
5. **人物状态检查**：身份、服装变体、发型、配饰、伤势、血迹、武器持有、姿势、情绪、动作阶段。
6. **道具状态检查**：持有者、左右手、可见、损坏、掉落、拾起、交接、使用、形态。
7. **动作承接检查**：阶段、目标、接触点、受力、反应、打断、原因镜头。
8. **轴线检查**：相机侧、镜头组轴线、建立镜头、主观镜头、环绕、明确跨轴。
9. **例外识别**：见 2.2 的 `exceptions`，并支持从 `transition` 读取 `time_jump / scene_change / flashback / dream / illusion`。
10. **问题归并**：同一 `ruleId + shotIds + fieldPath` 去重；信息不足单独进入 gaps，不混入 Error / Warning。
11. **审核输出**：转换为现有 `StudioStoryboardReviewIssue`，绑定当前 `storyboardVersion`。

## 4. 规则目录（16 条）

| ruleId | 检查范围 | 默认等级 | 检查内容 |
| --- | --- | --- | --- |
| `continuity.position_jump` | group | Error | 同一连续段落人物左右 / 景深跳变，无转身、建立镜头或转场依据 |
| `continuity.position_distance` | group | Warning | 人物距离无运动 / 调度解释 |
| `continuity.movement_reversal` | group | Warning | 运动方向反转，无转身、停止、遮挡或跳切依据 |
| `continuity.eyeline_mismatch` | group | Error | 视线目标与人物朝向 / 反打方向不一致 |
| `continuity.axis_cross` | group | Error | 同组相机侧反转，无跨轴、环绕、主观或建立镜头依据 |
| `continuity.character_identity_conflict` | scene | Error | 同名不同 `characterId`，或角色身份绑定错误 |
| `continuity.character_outfit_change` | scene | Warning | 服装变体 / 发型 / 配饰变化，无换装、时间跳跃或转场依据 |
| `continuity.character_injury_change` | scene | Warning | 已建立伤势 / 血迹消失，无治疗、时间跳跃或转场依据 |
| `continuity.prop_holder_change` | group | Error | 道具持有者变化，无交接、拾起、掉落或使用动作 |
| `continuity.prop_hand_change` | group | Warning | 道具换手，无换手、交接或掉落动作 |
| `continuity.prop_disappear` | group | Error | 显式道具状态中消失 / 不可见 / 形态改变，无合理动作 |
| `continuity.scene_time_change` | scene | Error | 同组昼夜 / 时间状态跳变，无时间跳跃、转场、回忆或幻境 |
| `continuity.scene_weather_change` | scene | Warning | 天气 / 光照 / 地面突变，无环境变化或转场依据 |
| `continuity.scene_environment_reset` | scene | Warning | 建筑、地面、烟尘、火焰、积水无解释恢复 |
| `continuity.action_cause_missing` | group | Warning | 出现反应 / 结果，但无攻击、接触、受力或可接受的剪辑省略 |
| `continuity.action_force_mismatch` | group | Warning | 受力方向与反应位移方向明显不一致 |

规则目录本身带 `fields` 和 `description`，UI 直接读取，不维护第二份规则说明。

## 5. 空间、轴线与视线

### 5.1 人物空间位置

使用显式 `screenSide`、`depth`、`distance`、`facing`、`eyelineTargetId`，并以 `characterBlocking` 做受限文本补充。判断前先确认：

- 同一人物（`characterId`）在前后镜头都存在。
- 属于同一连续段落；同一 ShotGroup 更严格。
- 有明确转身、建立镜头、场景转场、时间跳跃、闪回、梦境、幻境或跳切例外时不判错。
- 只有左右 / 景深变化且没有解释时才报 Error / Warning；景深变化只在同组检查，跨组不机械判错。

因此不会因为两个镜头都出现同一人物就认定连续，也不会因为描述文字不完全一致就判错。

### 5.2 运动方向

检查 `movementDirection` 和 `characterBlocking` 中的从左向右、从右向左、朝向 / 远离镜头、朝向目标、转身、停止、跌倒、起身、跳跃、被击退等。方向反转必须有转身、停止、遮挡、跳切或场景转场依据；明确 `turn` 时不报。

### 5.3 视线与正反打

- A 在画面左侧看向右侧 B，下一镜头 B 反打看向画面左侧 A，视为正常正反打。
- 视线目标在画面另一侧但人物朝向 / 反打方向错误，报 `eyeline_mismatch`；同组 Error，跨组 Warning。
- 允许主观镜头、越轴、环绕、俯拍、仰拍和明确标记的跨轴运动；这些例外存在时不报错。
- 建立镜头重新定位是显式例外，不能把重新建立空间关系当成位置跳变。

### 5.4 180 度轴线

轴线的判断优先使用 `continuity.axis.cameraSide` 或 `continuity.space.cameraSide`，其次使用镜头组 `cameraAxis` / `cameraPosition` 文本。同一 ShotGroup 内相机侧反转且无 `cross_axis / orbit / subjective / establishing / scene_transition` 依据时报 Error；跨组或场景边界降为 Warning。没有结构化机位时不伪造机位，只输出信息不足。

## 6. 人物、道具、场景、动作

### 6.1 人物状态

- 身份按 `characterId` 判断；同名不同 ID 是 Error。换 `outfitId` 是服装变体变化，不自动等于身份变化。
- 同一连续段落中服装变体、发型、配饰变化且无 `costume_change / time_jump / scene_transition / flashback / dream / illusion`，报 Warning。
- 只有已建立 `injured === true` / `blood === true` 后消失才报；新受伤不判错；治疗、时间跳跃、转场、闪回、梦境允许恢复。
- 不自动修改人物资产，只输出问题和修正建议。

### 6.2 道具状态

- 显式道具状态存在时，检查持有者、左右手、可见、掉落、拾起、交接、使用和形态。
- 持有者变化必须有 `transferredTo`、交接动作、掉落或拾取依据，否则 Error。
- 换手必须有换手 / 交接 / 掉落动作或例外，否则 Warning。
- 只有当前镜头**显式**提供 `props`（包括空数组）时，才判定“显式消失”；当前镜头完全缺道具字段时输出信息不足，不把旧数据误报成消失。
- `prop_drop / prop_pickup / prop_consume / prop_handoff / scene_transition / time_jump` 等例外允许合理状态变化。

### 6.3 场景与时间

- 比较 `timeOfDay`、`weather`、`lighting`、`ground`、`damage`、`visibility`。
- 同组昼夜变化 Error，跨组 / 场景边界 Warning；天气、光照、地面、破坏变化按 Warning / Suggestion。
- 明确时间跳跃、场景转场、回忆、梦境、幻境、环境变化例外时不报。
- 缺少时间或环境字段时输出信息不足，不把“未填写”当成“白天变夜晚”。

### 6.4 动作承接

- 检查动作阶段：起势 → 过程 → 接触 → 反应 → 结果 → 恢复。
- 当前镜头进入 reaction / result，但前一镜头没有 contact / process / start 且无 `match_cut / omitted_process / result_first / slow_motion / jump_cut / scene_transition / time_jump` 依据时，报 `action_cause_missing`。
- 受力方向与反应方向明显不一致时报 `action_force_mismatch`。
- 允许动作匹配剪辑、跳切、省略过程、慢动作、闪回、交叉剪辑、结果先行；动作连续性不等于每个镜头都重复动作。

## 7. 等级、置信度与信息不足

### 7.1 等级

- **Error**：明确违反已建立约束。例如同组人物位置无法解释跳变、同组道具明确消失、同组正反打视线错误、同组无依据越轴、资产 ID 冲突。
- **Warning**：较可能有问题，但可能有解释。例如天气 / 光照变化、运动方向反转缺少转身、伤势消失缺少解释、疑似越轴、道具换手未交代。
- **Suggestion**：专业拍摄建议，不代表错误。例如补建立镜头、补过渡动作、补反应镜头、补道具交接、调整景别节奏。

跨组 / 跨场景的同类问题会降级：位置跳变、视线、轴线、时间变化不再一律 Error。

### 7.2 置信度

- **high**：结构化字段明确冲突，例如同组 `screenSide` 直接相反、`characterId` 同名冲突。
- **medium**：多项证据指向同一问题，例如结构化字段 + 动作 / 调度文本。
- **low**：主要依赖不完整文本描述。

信息不足时：

- 不判定为确定错误。
- 输出 gap，计入 `counts.insufficient`。
- 不伪造缺失的空间、机位、道具或动作信息。
- 可以用 Suggestion 提示补字段，但不会被当作已确认的连续性问题。

## 8. 与 4B 审核系统集成、版本与 stale

### 8.1 复用现有问题体系

`buildAllStoryboardReviewIssues()` 现在返回：

- 结构检查问题（原有 `buildStoryboardReviewIssues()`）
- 连续性问题（4C `buildContinuityCheck()` 转换）
- 旧连续性问题（保留历史，必要时标 stale）

连续性问题进入现有 `storyboardReview.issues`，字段包含规则、等级、置信度、证据镜头、字段路径、证据、原因、建议、当前正式版本和检查范围。没有建立第二套审核状态。

### 8.2 版本绑定

- 每条连续性问题绑定当前 `document.storyboardVersion`。
- 旧问题在当前检查中没有复现时，保留但标记 `continuityStale: true`，不再计入当前 open。
- 定向检查（单场景 / 单组 / 单镜头）只把该范围内的旧问题标 stale；范围外问题原样保留，不无理由清除。
- `reviewStats`、九宫格 / 列表 / 工作区统计都排除 `continuityStale`。
- 检查记录 `continuityRuns` 最多 20 条，每次记录范围、检查版本、检查镜头数、检查对子数、受影响镜头、问题 ID 与计数。
- 正式分镜变化后旧检查结果不会继续冒充当前结果；重新检查后生成新结果，旧历史仍保留。

### 8.3 锁定与正式分镜

- 锁定状态不等于审核通过；`reviewed` 只计 approved，锁定只限制修改。
- 连续性检查发现问题不会自动修改正式分镜。
- 本次浏览器运行检查后，正式分镜仍为 v14，8 镜，内容 hash 不变。

## 9. 检查范围与增量

支持四种范围：

- `shot`：单镜头上下文，检查该镜头关联的相邻对子。
- `group`：单个 ShotGroup，检查组内相邻与组边界。
- `scene`：单个场景，检查场景内相邻与场景边界。
- `episode`：整集所有相邻镜头与跨组 / 跨场景边界。

引擎只按范围构建 pairs，不对整部剧全量重查。UI 只有用户点击「运行检查」才执行，不在每次修改后自动全量重查。

异步入口 `runContinuityCheckAsync()`：

- `batchSize: 12` 分批。
- `AbortController` 可取消；取消返回 `cancelled: true`，不写入检查记录。
- 进度通过 `onProgress` 更新，不阻塞页面主要交互。

## 10. 第四步 UI

入口：第四步「分镜审核与调整」页头「连续性检查」按钮。

Drawer 展示：

- 检查范围选择：整集 / 单场景 / 单镜头组 / 单镜头上下文。
- 进度：检查中 `checked / total` 对镜头；取消按钮。
- 计数：Error、Warning、Suggestion、信息不足。
- 受影响镜头：可点击定位到 `ReviewShotDrawer`。
- 筛选：严重程度、场景、镜头组、问题类型（规则）、镜号。
- 问题卡片：等级、规则标题、置信度、`ruleId`、字段路径、规则说明、证据、原因、修正建议。
- 镜头证据：问题关联镜头按钮、定位镜头按钮。
- 前后镜头上下文：问题相关镜头前后各一镜，点击可定位。
- 检查记录：最近运行的版本、范围、时间、检查对子数、问题数与 stale 提示。
- 提示：连续性检查只写入审核问题，不自动修改正式分镜；锁定不等于审核通过。

真实浏览器截图：

- `docs/ai-handover/stage4c-continuity-panel.png`
- `docs/ai-handover/stage4c-continuity-run.png`

真实运行结果：`proj-stage4c-snap-1795573351974` / `ep-GHduqaBp`，正式 v14、8 镜、4 组；点击运行后 `已检查 7 对`，`0 Error / 2 Warning / 22 信息不足`，检查记录写入时间 `2026/11/25 10:20:02`，正式 v14 未变。

注：问题卡中的规则 `description` 展示是在上述真实运行截图之后追加的一行 UI 文本；最终 `typecheck`、`build` 已通过，但没有为这行文本再次截屏复看。引擎、检查结果和正式版本不受影响。

## 11. 确定性测试

命令：

```powershell
cd C:\Users\qq308\Desktop\lihuo\web
npx --yes tsx scripts/stage4c-core-check.ts
```

输出：

```text
stage4c-core-check: 16 rules, 26 groups passed
```

覆盖矩阵：

| 组 | 场景 | 断言 |
| --- | --- | --- |
| G1 | 正常双人对话 / 正反打 | 零误报，`checkedPairs=1`，`insufficient=0` |
| G2 | 同组人物从左变右且无解释 | `position_jump` Error，高置信度，证据镜头 |
| G3 | 明确转身 / 环绕镜头 | 不报运动反转、不报轴线跨越 |
| G4 | 视线方向不匹配 | `eyeline_mismatch` Error |
| G5 | 相机跨越 180 度轴线无例外 | `axis_cross` Error |
| G6 | 无解释换装 / 合理换装 | 前者 Warning，后者零误报 |
| G7 | 伤势消失 / 治疗例外 | 前者 Warning，后者零误报 |
| G8 | 同名不同角色 ID / 同 ID 服装变体 | 身份冲突 Error；服装变体不报身份 |
| G9 | 无解释换手 / 换手动作 / 持有者交接 / 道具消失 | 对应规则和例外 |
| G10 | 同组昼夜变化 / `time_jump` / 天气变化 | Error / 允许 / Warning |
| G11 | 环境破坏恢复 | `scene_environment_reset` Warning |
| G12 | 动作结果缺原因 / `match_cut` | 前者 Warning，后者零误报 |
| G13 | 受力方向与反应方向不一致 | `action_force_mismatch` Warning |
| G14 | 旧数据缺空间 / 道具字段 | 不误判，输出 `insufficient` gap |
| G15 | 单镜头 / 单组 / 整集范围 | 检查对子数与范围区分 |
| G16 | 异步完成 / 取消 | 完成正常；取消返回 `cancelled` 且不落问题 |
| G17 | 审核集成 | 规则、等级、置信度、`shotIds`、`storyboardVersion`、去重 |
| G18 | 正式版本变化 | 旧问题保留并 `continuityStale`，不计 open；`continuityRuns` 记录新版本 |
| G19 | 定向 scope | 重查 group-2 不清除 group-1 旧问题 |
| G20 | 明确 `cross_axis` / `establishing` | 不误报轴线、不误报位置跳变 |
| G21 | 正常天气变化 `environment_change` | 不误报天气 / 光照 |
| G22 | 正常掉落 / 拾起 `prop_drop / prop_pickup` | 不误报道具消失 |
| G23 | 合理 `jump_cut` / `slow_motion` | 不误报动作原因缺失 |
| G24 | 正常动作承接 起势→接触→反应 | 不误报原因缺失 |
| G25 | 正常正反打 A 左看右 / B 右看左 | 不误报视线、轴线 |
| G26 | 三人稳定群像站位 | 不误报位置跳变 |

测试只调用纯函数与异步入口，不读取真实项目数据，不调用模型。

## 12. 真实浏览器验收

### 12.1 连续性检查面板运行

- 隔离项目：`proj-stage4c-snap-1795573351974`，第 1 集 `ep-GHduqaBp`，正式 v14、8 镜、4 组。
- 操作：真实浏览器点击第四步「连续性检查」，选择整集，点击「运行检查」。
- 结果：进度 `已检查 7 对`；`0 Error / 2 Warning / 22 信息不足`；提示「连续性检查完成：0 Error / 2 Warning / 22 信息不足」；检查记录写入 `2026/11/25 10:20:02`。
- 正式分镜：v14 未变，8 镜未变，内容 hash `b4e9b9e6` 未变。
- 结论：**真实浏览器面板操作通过**；不是脚本直接调用函数。

### 12.2 快照丢弃按钮真实点击

使用克隆隔离项目 `proj-stage4c-snap-1795573351974`，第 1 集 `ep-GHduqaBp`。

点击前 IndexedDB：

- 正式 v14，8 镜，内容长度 17765，内容 hash `b4e9b9e6`。
- 快照 6 条：formal `storyboard-version-sbs-rmiw5a`、backup `sbs-1p4h4bv`、conflict `sbs-1nq7lgh`，以及 3 条 legacy backup。

操作与结果：

1. 打开 formal `sbs-rmiw5a`：弹窗只有「保留快照 / 复制到新草稿 / 应用为正式版本」，**没有丢弃按钮**；formal 不能丢弃。
2. 打开 backup `sbs-1p4h4bv`，真实点击「丢弃快照」：快照列表 6 → 5。
3. 打开 conflict `sbs-1nq7lgh`，真实点击「丢弃快照」：快照列表 5 → 4。
4. 刷新页面：只剩 formal `sbs-rmiw5a` + 3 条 legacy backup；正式 v14、8 镜、hash `b4e9b9e6` 不变。
5. UI 行为：**没有二次确认弹窗，点击「丢弃快照」直接执行**。本轮没有把“确认弹窗”写成已存在。

截图：

- `stage4c-snapshot-list-before.png`
- `stage4c-snapshot-current.png`
- `stage4c-snapshot-after-discard.png`

结论：**真实浏览器按钮点击通过**；FINAL1 原文要求“确认操作”，但当前产品实际无确认步骤，此差异保留为待确认产品行为。

### 12.3 双标签页删除项目真实点击

使用隔离项目 `proj-stage4c-del-1795573351974`（3 集），两个同源（`127.0.0.1:3000`）标签页 Tab A / Tab B。

操作序列：

1. 两个标签页都读取项目 `updatedAt = 2026-11-25T02:22:31.987Z`，标题 `Stage 4C 双标签删除隔离项目 1795573351974`，3 集，第 1 集 v14，第 1 集 `updatedAt = 2026-11-25T02:20:02.843Z`。
2. Tab A 真实打开项目「重命名」弹窗，保存新标题 `Stage 4C 双标签 A 已修改 1795573351974`；写入后项目 `updatedAt = 2026-11-25T02:30:35.726Z`。
3. Tab B 仍显示旧标题，说明其内存仍持有旧数据；删除按钮**未被禁用**。
4. Tab B 真实点击项目卡片删除按钮，确认弹窗显示旧标题、3 集、8 镜、8 资产；点击「确认删除」。
5. Tab B 收到真实 UI 错误提示：**「项目已被其他操作更新，请刷新后重试」**。
6. 读取 IndexedDB：项目仍存在，标题为 Tab A 的新标题，`updatedAt` 仍为 `02:30:35.726Z`，项目数 3，分集数 3，第 1 集 v14，项目内容 hash `3248a1a7`。Tab A 的新数据没有被静默删除。
7. 刷新 Tab B：显示新标题；刷新 Tab A：同样显示新标题；两个标签页最终数据一致。

截图：

- `stage4c-tab-a-renamed.png`
- `stage4c-tab-b-delete-conflict.png`
- `stage4c-tab-a-after-refresh.png`
- `stage4c-tab-b-after-refresh.png`

结论：**真实双标签页删除点击通过**；版本守卫和冲突提示生效，没有静默删除 Tab A 的新数据。

### 12.4 IndexedDB 真实故障注入（未执行）

本轮尝试使用 Chrome DevTools Protocol 的 `Storage.overrideQuotaForOrigin` 做浏览器级真实配额故障注入：

- 正确参数为 `quotaSize`。首次误用 `quota` 无效；改成 `quotaSize: 0` 后，`Storage.getUsageAndQuota` 返回 `overrideActive: true`、`quota: 0`、`usage: 5,071,567` 字节。
- 在该状态下，真实 IndexedDB 写入仍然成功：
  - 在已有探针库写入 5 MB `Uint8Array`：`complete`。
  - 新建探针库并写入：`complete`。
  - 刷新页面后再次写入：`complete`。
- 这说明当前浏览器环境的 quota override 只改变 `navigator.storage.estimate()` / CDP 报告，不触发真实 `QuotaExceededError`。已知 Chromium / Playwright 环境存在“`Storage.overrideQuotaForOrigin` 不改变 off-the-record 浏览器上下文实际配额”的限制；本轮实际观测与之一致。
- 已恢复：调用 `Storage.overrideQuotaForOrigin` 不带 `quotaSize`，`getUsageAndQuota` 回到 `overrideActive: false`、`quota: 613,084,970,188`；删除 `lihuo-fault-probe` / `lihuo-fault-probe2` 探针库。

因此：

- 本轮**没有**在真实页面触发一次保存或正式分镜写入失败。
- **没有**验证 fail-closed、无成功提示、v14 内容不变、草稿保留、恢复后可操作。
- **16.1 未执行**，不能写成通过。原因不是没有尝试，而是当前浏览器自动化后端无法安全产生真实 IndexedDB 事务失败；用控制台 `throw` 或脚本覆盖 `IDBObjectStore.put` 冒充会违反用户边界，本轮没有这样做。
- 测试项目当前仍存在一个真实创建的活动草稿 `sbd-g70aug`（基于 formal `sbs-rmiw5a` / v14），正式 v14 与 hash `b4e9b9e6` 未变；这只证明面板和草稿入口可用，不证明故障注入。

### 12.5 FINAL1 历史边界

- 原始 live 项目 A 当前不可用；E 只验证了导出副本，不是 live A。
- D 是确定性故障注入。
- F1–F5 与 F6 分属两个浏览器会话，不能合并。
- 未调用真实模型。
- 未提交，未推送。
- 快照丢弃和双标签删除是本轮真实浏览器点击；IndexedDB 故障注入仍未执行。

## 13. 命令与输出

```text
cd C:\Users\qq308\Desktop\lihuo\web
npx --yes tsx scripts/stage4c-core-check.ts
→ stage4c-core-check: 16 rules, 26 groups passed

npx --yes tsx scripts/stage4a-core-check.ts
→ stage4a-core-check: 9 groups passed

npx --yes tsx scripts/stage4b-core-check.ts
→ stage4b-core-check: 8 groups passed

npm run typecheck
→ exit 0（tsc --noEmit）

npm run build
→ exit 0（vite v7.3.6，8310 modules transformed，built in 44.57s）

npx --yes esbuild scripts/stage3_2_2-core-check.ts --bundle --platform=node --format=esm "--alias:@=./src" "--define:import.meta.env={}" --outfile=.tmp-stage322-core.mjs
node .tmp-stage322-core.mjs
→ STAGE3_2_2_CORE_RESULT { "pass": true, "cases": 55 }；A 8 / B 20 / C 12 / D 9 / E 6
```

构建仍有既有警告：多个模块同时动态 / 静态导入、主 chunk 大于 500 kB；这些不是 4C 引入的新错误，本轮未做大范围拆包。

## 14. 修改文件清单与 Diff

4C Diff：`docs/ai-handover/DRAMA_STUDIO_STAGE4C.diff`，10 个文件，2,592 insertions / 25 deletions。

新增：

- `web/src/lib/studio/continuity-engine.ts`（1,120 行）
- `web/src/pages/drama/studio/continuity-panel.tsx`（346 行）
- `web/src/pages/drama/studio/continuity.css`（227 行）
- `web/scripts/stage4c-core-check.ts`（493 行）

修改：

- `web/src/types/studio-production.ts`（+222）
- `web/src/lib/studio/review-engine.ts`（+142 / -14）
- `web/src/lib/studio/review-actions.ts`（20 行变更）
- `web/src/pages/drama/studio/review-workspace.tsx`（29 行变更）
- `web/src/pages/drama/studio/review-grid.tsx`（2 行）
- `web/src/pages/drama/studio/review-list.tsx`（2 行）

说明：

- `review-grid.tsx` / `review-list.tsx` 的 4C 变更是把 `continuityStale` 排除出 open 计数；整份锁定提示是 4B 已完成的既有行为，不重新算作 4C 新增。
- `review-shared.tsx` 和 `studio.css` 在本轮没有改动，未纳入 Diff。
- 用户点名的 `DRAMA_STUDIO_STAGE3_2_2_FINAL1.diff` 不存在，不能补造。

## 15. 未完成事项与已知风险

### 未完成

1. **FINAL1 IndexedDB 真实故障注入未执行**；工具限制与尝试证据见 12.4。
2. **快照丢弃没有二次确认弹窗**；当前真实点击是直接执行，和 FINAL1 原文“确认操作”存在口径差异，需用户确认是否补二次确认。
3. 原始 live 项目 A 不可用，E 仍是导出副本。
4. F1–F5 与 F6 仍是两个浏览器会话，不能写成同一会话。
5. 未调用真实模型；4C 不包含 AI 审查 / 自动修复 / 预览 / 视频 / 时间轴 / 音频 / 第六步。

### 已知风险

- 连续性引擎优先依赖结构化字段；旧数据只有文本时，位置、机位、道具状态可能只能输出信息不足，不能给出确定结论。
- 动作因果检查只理解结构化 `continuity.action` 和受限动作文本，不做视频画面理解；复杂打斗、多人交错、主观镜头仍需人工审片。
- `screenSide` / `cameraSide` 是显式字段；生成端如果不写这些字段，4C 会倾向信息不足而不是自动推导，这是有意的误报控制，但会降低旧数据的检查覆盖率。
- 部分异常（例如明确慢动作、跳切、建立镜头）需要生成端 / 人工在 `exceptions` 中标注；没有标注时可能产生 Warning / Suggestion，而不是被自动识别。
- UI 目前是 Drawer + 列表，未做虚拟滚动；大型整集分镜的极端数量仍需性能压测。
- 本轮 UI 验证是 998×667 / 1280×960 浏览器视口，未覆盖窄屏、超宽屏和用户真实可见窗口的全部动画 / 字号观感。

## 16. Stage 4C 验收自检

| 验收项 | 状态 | 证据 / 说明 |
| --- | --- | --- |
| 连续性检查不是关键词匹配 | 是 | 显式 `continuity` 字段优先；文本只补充 |
| 规则有明确证据 | 是 | 每条 finding 有 `shotIds`、`fieldPath`、`evidence`、`reason`、`suggestion` |
| 错误等级合理 | 是 | 同组明确冲突 Error；可能解释 Warning；建议 Suggestion |
| 置信度可解释 | 是 | high / medium / low；旧数据 gap |
| 信息不足不误判 | 是 | G14、旧数据缺字段只出 gap |
| 同一镜头组空间关系正确 | 是 | G2、G3、G20、G25、G26 |
| 轴线与视线检查有效 | 是 | G3、G4、G5、G20、G25 |
| 人物状态连续性有效 | 是 | G6、G7、G8 |
| 道具状态连续性有效 | 是 | G9、G22 |
| 场景状态连续性有效 | 是 | G10、G11、G21 |
| 动作承接检查有效 | 是 | G12、G13、G23、G24 |
| 检查结果与正式分镜版本绑定 | 是 | issue `storyboardVersion`；G17 / G18 |
| 正式分镜变化后旧结果 stale | 是 | G18；`continuityStale` 不计 open |
| 不相关问题不被清除 | 是 | G19 定向 scope |
| 锁定不等于审核通过 | 是 | 复用 4B 语义；未改审核状态机 |
| 不自动修改正式分镜 | 是 | 检查只写 issues / runs；浏览器 v14 未变 |
| 不破坏 4A / 4B | 是 | 4A 9 组、4B 8 组通过；typecheck / build |
| 不破坏 Stage 3.2.2 正式写入保护 | 是 | 未改 `storyboard-write-protocol.ts`；55 例重跑通过（A 8 / B 20 / C 12 / D 9 / E 6） |
| FINAL1 三项逐项记录 | 是 | 12.2 通过、12.3 通过、12.4 未执行 |

**最终状态：Stage 4C 功能与确定性测试完成；FINAL1 三项中两项真实浏览器操作完成，IndexedDB 真实故障注入未执行并明确保留为未完成。不进入 Stage 4D，等待用户审查报告与完整 Diff。**
