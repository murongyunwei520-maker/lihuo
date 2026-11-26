# 离火 AI 短剧工作室 · Stage 4B

九宫格分镜工作台与单镜头审片系统

- 日期：2026-11-24
- 基线：Stage 4A 完成态；主仓库 HEAD `27b67bd09a8a`，分支 `main`；工作区仍保留用户既有修改和未跟踪文件。
- 状态：Stage 4B 代码已实现；`stage4b-core-check` 8 组、更新后的 `stage4a-core-check` 9 组、`typecheck`、`build` 均通过；隔离项目 E 完成真实浏览器写入与回读。**4B 没有调用任何真实模型，没有进入 4C，也没有实现 AI 审查、预览图、视频生成、版本恢复或第六步。** 代码未提交、未推送。

## 0. 结论与验收边界

Stage 4B 把第四步从 4A 的“基础审核清单”升级为可实际审片的九宫格 / 列表 / 单镜 Drawer 工作台，并修正了 4A 的三个核心语义问题：

1. `locked` 不再是审核状态，审核结论与锁定彻底分离。
2. `reviewStats.reviewed` 只统计 `approved`，锁定数量和未通过镜头不会被合并成“已审核”。
3. stale 可以显式复核，复核只创建当前正式版本的 pending 记录，不自动通过；上游再次变化后重新 stale。

| 验收项 | 代码已实现 | 确定性测试 | 真实浏览器点击 | 真实模型调用 |
| --- | --- | --- | --- | --- |
| 审核状态与锁定分离 | 是 | 通过 | 通过（approved + locked、pending + locked、解锁后状态保持） | 不涉及 |
| stale 局部化与显式复核 | 是 | 通过 | 通过（镜头 02 / 05 / 06 复核后 pending → approved） | 不涉及 |
| 审核历史与备注 | 是 | 通过 | 通过（备注保存、18 条记录刷新后保留） | 不涉及 |
| 九宫格 / 列表 / 单镜 Drawer | 是 | 数据层通过 | 通过（视图切换、筛选、排序、选择保持） | 不涉及 |
| 批量审核 / 部分成功 | 是 | 通过 | 通过（批量通过 2 镜：成功 1、跳过 1） | 不涉及 |
| 批量锁定 / 解锁 | 是 | 通过 | 通过（锁定 01 / 02 后锁 3，解锁后锁 1） | 不涉及 |
| readiness 修正 | 是 | 通过 | 通过（8 镜 approved + 1 镜 locked → 可进入视频生成） | 不涉及 |
| StepWorkspace 重挂载修复 | 是 | 不适用 | 通过（写入后 Drawer / 报告 / 筛选不再丢失） | 不涉及 |
| 4C AI 审查 / 预览图 / 视频生成 | **未实现（按要求不做）** | 不适用 | 不适用 | 不涉及 |
| Stage 3.2.2 B / F 跨标签页并发 | 仍依赖 3.2.2 验收 | 未覆盖 | 未执行 | 不涉及 |

**证据边界：**

- “真实浏览器点击”指隔离项目 E 的实际页面写入与刷新回读，不是用户原始 live 项目。
- 浏览器验证没有调用模型，因此不存在“真实模型调用通过”。
- Stage 3.2.2 B 正式分镜写入跨标签页并发、C Mock 覆盖确认、D 备份失败注入、E 旧项目 / 历史快照 / 旧草稿浏览器回归、F 跨标签页并发仍未完成。4B 的 `expectedVersion`、写入后回读与批量部分成功不能替代 B/F。
- 当前 IndexedDB 只有项目 E，没有旧项目 A；不能拿项目 E 冒充旧项目回归。

## 1. 4A 遗留问题与 4B 修正对应

| 4A 问题 | 4B 修正 |
| --- | --- |
| `StudioStoryboardReviewStatus` 含 `locked`，锁定被当成审核结论 | 审核状态改为 `pending / approved / needs_revision / rejected / stale`；`locked` 由 `isShotLocked(document, shot)` 从 `shot.locked` 或整份文档 `status === "locked"` 派生，不再写入审核记录 |
| `reviewStats.reviewed = approved + locked` | `reviewStats.reviewed` 只计 `approved`；`locked` 单列；`pending + locked` 不计已通过 |
| 全部锁定可以进入 `ready_for_video` | readiness 按审核结论判断：全部 `locked` 但 `pending` 为 `not_ready`；全部 `approved + locked` 才允许 `ready_for_video` |
| `planStoryboardReviewStatus()` 跳过 stale / locked 且不区分原因 | 增加 `partialOnVersionChange`（4B UI 默认 `true`）；锁定、stale、版本冲突分别返回 `locked / stale / version_conflict`，合法镜头继续写入 |
| `planStoryboardReviewRefresh()` 只刷新工作区版本，不创建当前版本审核记录 | 刷新不创建审核记录；需要复核时由用户显式执行 `planStoryboardReviewReReview()`，只对真实 stale 且未锁定镜头创建绑定当前正式版本的 pending 记录 |
| UI 只有基础列表与单镜下拉 | 新增九宫格、8 列列表、单镜三栏 Drawer、筛选 / 搜索 / 排序 / 多选、批量栏、确认 Modal、操作报告、审核历史 Modal |

## 2. 审核状态模型与统计

### 2.1 状态与锁定

```ts
type StudioStoryboardReviewStatus =
    | "pending"
    | "approved"
    | "needs_revision"
    | "rejected"
    | "stale";

type StudioStoryboardShotStatus = Exclude<StudioStoryboardReviewStatus, "stale">;
```

允许并存的组合：

- `pending + locked`
- `approved + locked`
- `needs_revision + locked`
- `rejected + locked`
- `stale + locked`

`isShotLocked()` 的优先级：

1. `shot.locked === true`；
2. 整份 `StudioStoryboardDocument.status === "locked"`；
3. 否则未锁定。

锁定只限制后续修改；审核结论仍由 `storyboardReview` 记录决定。批量锁定不解锁审核结论，批量解锁不改变审核状态。

### 2.2 统计与 readiness

- `reviewStats.total = shots.length`
- `approved` 只计 `approved`
- `pending / needsRevision / rejected / stale` 分别单列
- `locked` 从 `isShotLocked()` 统计，不进入 `reviewed`
- `reviewed` 只等于 `approved`
- readiness 不再把锁定当已通过；未通过的锁定镜头仍按实际状态阻塞
- 全部 `approved` 且存在锁定镜头时，仍可以 `ready_for_video`

浏览器最终状态：

- 正式分镜 `v13`
- 剧本 `v3`
- 8 镜 / 4 组 / 58.3s
- approved 8、pending 0、needs_revision 0、rejected 0、stale 0
- locked 1
- 审核记录 18 条
- readiness = `ready_for_video`

## 3. stale 局部化、ack 与显式复核

### 3.1 内容签名

`shotReviewContentHash(shot)` 覆盖镜头可见内容：镜号、场景、镜头组、时长、景别、机位、角度、焦段、运镜、构图、人物站位、视线、动作、表情、情绪、对白、旁白、音效、环境、光线、连续性规则、人物 / 服装 / 场景 / 道具绑定、提示词等。

忽略字段：`locked`、`status`、`version`、`createdAt`、`updatedAt`、审核记录本身。

### 3.2 stale 判定

`describeShotReviewStale(document, review, shot)` 依次判断：

1. 上游剧本 / 分镜 `document.stale.shotIds` 命中该镜头；
2. 审核记录的 `shotContentHash` 与当前镜头签名不一致；
3. 旧版本审核记录缺少 `shotContentHash`。

上游 stale 与内容 stale 分别显示；同一镜头同时命中时只显示一个“需要重新审核”面板，但保留两种原因。

### 3.3 上游 ack

`storyboardStaleAckKey(document)` 由以下部分组成：

```
scriptVersion | markedAt | reason | shotIds
```

审核记录保存 `staleAckKey`。复核后进入 pending；上游再次变化会生成新的 key，原 ack 失效并重新 stale。

4A 曾出现“内容 stale 与上游 stale 叠加时，复核后仍卡 stale”的问题；4B 在复核时只要当前 `document.stale.shotIds` 包含该镜头，就同时写入当前 ack key，避免复核后状态无法前进。

### 3.4 显式复核

`planStoryboardReviewReReview()`：

- 只处理真实 stale 且未锁定的镜头；
- 创建绑定当前正式 `storyboardVersion` 的 `pending` 记录；
- 保存 `reviewedShot`、`shotContentHash`、`staleAckKey`；
- 追加 `re_review` audit；
- 旧 audit 完整保留；
- 不自动 approved；
- `refresh` 不清除 stale。

锁定 stale 镜头不参与复核；必须先解锁。`locked stale` 在 UI 显示锁定原因和“先解锁”提示。

### 3.5 版本差异

`buildShotStaleDiff({ document, review, shot, versions })`：

1. 优先使用审核记录的 `reviewedShot`；
2. 否则查 `storyboardVersions` 的 formal / backup / conflict 快照；
3. 找不到旧镜头返回 `unavailable`；
4. UI 显示“无法完整比较历史内容”，不编造字段差异；
5. 找到旧镜头时只展示真实变化的字段。

## 4. 锁定写入与审核写入分离

`setStoryboardShotLocksAction()`：

- 只修改 `production.storyboard.shots[].locked`；
- 保持 `storyboardVersion` 不变；
- 保持 `storyboardReview` 不变；
- 保持 audit 不变；
- 支持批量锁定 / 解锁和部分成功；
- 写入后回读并校验版本、镜头内容和审核记录数量；
- 整份文档 `status === "locked"` 时不允许逐镜解锁。

Stage 3 的 `setShotLocked()` 同步修正为不递增 `storyboardVersion`，否则每次锁定都会把“内容签名一致的审核记录”误判为旧版本。

浏览器验证：

- 镜头 01 原 `pending + locked`；解锁后刷新显示“锁定 1”，审核状态仍 pending。
- 镜头 03 `approved + locked`；Drawer 显示已通过 + 已锁定，审核操作禁用，只保留“解锁镜头（需确认）”。
- 批量锁定 01 / 02 后锁定数从 1 变 3，审核记录仍 15 条，approved 仍 8。
- 批量解锁 01 / 02 后锁定数回到 1，approved / pending / stale 不变。

## 5. 批量部分成功

`planStoryboardReviewStatus()` 新增 `partialOnVersionChange?: boolean`，4B UI 默认开启。

批量规则：

| 镜头情况 | 结果 |
| --- | --- |
| 内容签名一致，目标状态合法 | 写入，计入 success |
| 旧版本记录缺少内容签名 | `version_conflict`，跳过 |
| 当前真实 stale | `stale`，跳过 |
| 已锁定且操作为审核 | `locked`，跳过 |
| 操作会改变正式版本 | `version_conflict`，跳过 |
| 非法状态 / 非法动作 | 对应错误，跳过 / failed |

部分成功不回滚已成功写入的镜头。操作报告分别列出成功、跳过、失败和原因，并明确“正式分镜 vN 未改变”。

浏览器实测：

- 选中镜头 01（pending + locked）和镜头 04（approved）执行批量通过。
- 结果：成功 0、跳过 2、失败 0；正式分镜 v13 未改变；镜头 01 原因为锁定，镜头 04 为状态未变化。
- 后续选中镜头 02（pending）和镜头 04（approved）批量通过：成功 1、跳过 1、失败 0；镜头 02 变为 approved，镜头 04 保持 approved。

## 6. UI 结构

新增文件：

| 文件 | 职责 |
| --- | --- |
| `web/src/pages/drama/studio/review-shared.tsx` | 状态标签、锁定徽标、排序、组号 / 组标签、镜头排序、状态文案 |
| `web/src/pages/drama/studio/review-grid.tsx` | 九宫格镜头卡片、选择、状态、关键字段、检查摘要、审片 / 历史 / 操作 |
| `web/src/pages/drama/studio/review-list.tsx` | 8 列紧凑镜头列表，支持搜索、排序后的行操作与批量选择 |
| `web/src/pages/drama/studio/review-shot-drawer.tsx` | 单镜三栏 Drawer：镜头信息 / 内容与连续性 / 审核与锁定；stale 面板、版本差异、前后镜头、同组镜头、当前检查、审核历史 |
| `web/src/pages/drama/studio/review-workspace.tsx` | 总览、统计、筛选、视图切换、批量栏、确认、操作报告、审核历史 Modal、Drawer 编排 |

### 6.1 九宫格 / 列表 / Drawer

- 九宫格默认 3 列；`<=1180px` 改为 2 列，`<=760px` 改为 1 列。
- 列表为 8 列：选择、镜号、场景 / 镜头语言 / 台词、时长、审核、锁定、问题、操作。
- 单镜 Drawer 三栏：左栏预览占位与镜头基础信息；中栏景别、机位、构图、动作、对白、连续性；右栏审核、备注、锁定、stale 复核与历史。
- Drawer 支持前后镜头切换，切换时保持打开。
- 预览仍为“暂无预览图”占位；不生成图片、不调用外部图片。
- 镜头组标签按 `document.groups` 顺序生成整集唯一 `G01...G0N`，不再依赖 `groupNumber`；正式数据不改。

### 6.2 筛选与排序

已验证：

- 搜索“顾北”得到 3 / 8 镜，包含对白 / 动作 / 场景命中的镜头。
- 场景筛选“顾北闯入抢夺”得到 2 / 8 镜。
- 镜头组筛选“G03 · 顾北闯入抢夺 · 2 镜”得到 2 / 8 镜。
- 审核状态筛选“待重新审核”得到 2 / 8 镜；复核 05 后变 1 / 8；复核 06 后 0 / 8。
- 锁定状态筛选“已锁定”得到 1 / 8 镜（镜头 03）。
- 镜号降序为 08 → 01；时长从短到长为 5.1s、5.2s、6.9s、7.8s、8s、8.1s、8.2s、9s。
- 列表选择 2 镜后切换到九宫格，选择仍保持 2 镜；筛选在单镜写入后不丢失。
- “检查等级”筛选在 UI 中存在，但本轮未逐项点击全部等级；其数据由 `buildStoryboardReviewIssues()` 的真实 issue 等级驱动，确定性测试覆盖。

### 6.3 操作报告与审核历史

- 批量操作报告在页面内保持显示，不再因审核写入后的父组件重渲染而关闭。
- 审核历史 Modal 从九宫格卡片的历史图标打开，显示每条记录的原状态 → 新状态、备注、操作者、动作、版本与时间。
- 浏览器实测历史从 pending → approved、pending → pending（备注）、stale → pending（重新审核）、approved → rejected、rejected → pending、approved → approved 等记录均保留。

## 7. StepWorkspace 重挂载根因修复

浏览器验收最初发现：每次审核、备注、复核或批量写入后，单镜 Drawer 自动关闭、批量报告消失、筛选 / 选择 / 视图状态重置。进一步排查确认不是 Drawer 或报告组件自身的问题，而是：

- `DramaStudioPage` 在组件体内定义 `StepWorkspace`；
- 之前使用 `<StepWorkspace ... />` 渲染；
- 父组件因 studio store 更新重渲染时，`StepWorkspace` 函数引用每次都是新的；
- React 将其视为新的组件类型，整棵子树卸载重挂载；
- `Stage4ReviewWorkspace` 的 `drawerShotId`、`selected`、`report`、筛选、视图等局部状态全部丢失。

修复方式：

- `StepWorkspace` 改为普通函数，调用处使用 `StepWorkspace({...})` 直接执行并返回元素；
- 返回的 `Stage4ReviewWorkspace` 等仍是稳定组件类型，父组件重渲染只协调 props，不再重挂载整个第四步工作区；
- 在函数定义处增加注释，禁止改回 JSX 组件渲染；
- 该函数不包含 React hooks，因此直接调用符合当前结构。

修复后浏览器验证：

- 镜头 04 标记“需要修改”后 Drawer 保持打开，状态实时变为 needs_revision；
- 再点“通过审核”仍保持打开，历史追加两条；
- 镜头 05“重新审核当前正式分镜”后 Drawer 保持打开，状态 stale → pending；
- 再“通过审核”后仍保持打开，状态 approved；
- 批量通过后操作报告持续存在，1.5 秒后仍在 DOM 且内容完整；
- 状态筛选在写入后保持“待重新审核”，计数从 2 变 1 再到 0。

这是本轮最关键的稳定性修复。若未来 `StepWorkspace` 继续增长并需要 hooks，建议把整个函数移到模块级组件并显式传 props，而不是恢复为组件体内 JSX 渲染。

## 8. 数据与持久化

- 审核数据仍只写入 `StudioEpisodeProduction.storyboardReview`。
- 正式分镜内容和 `storyboardVersion` 不因审核写入改变；项目 E 全程保持 `v13`。
- 审核记录追加而不覆盖；备注、重新审核、状态流转均追加 audit。
- `normalizeStoryboardReview()` 兼容旧数据：旧 `locked` / `stale` 审核状态回退为 `pending`，同版本旧记录补内容签名，历史审核保留为 pending。
- 刷新后审核状态、备注、历史、锁定状态、readiness 均保留；项目 E 刷新后为 18 条记录、approved 8、locked 1、ready_for_video。

## 9. 确定性测试与构建

运行方式（本机无 bun）：

```powershell
cd C:\Users\qq308\Desktop\lihuo\web
.\node_modules\.bin\esbuild.cmd scripts/stage4b-core-check.ts --bundle --platform=node --format=esm --outfile=scripts/.tmp-stage4b.mjs --alias:@=./src
node scripts/.tmp-stage4b.mjs
```

结果：

- `stage4b-core-check: 8 groups passed`
- `stage4a-core-check: 9 groups passed`
- `npm run typecheck`：通过
- `npm run build`：通过（Vite 7.3.6，8305 modules，约 1 分 16 秒）
- 构建仅有既有的动态 / 静态混合导入警告和 chunk > 500 kB 警告，无 4B 新增错误。

`stage4b-core-check` 覆盖：

1. 锁定与审核彻底分离：approved + locked 仍通过；pending + locked 不计通过；rejected + locked 阻塞。
2. 局部内容变化只 stale 相关镜头；重新审核创建新记录、保留旧历史、不自动通过。
3. 上游 stale ack：复核后进入 pending；上游再次变化后重新 stale；刷新不能消除 stale。
4. 历史内容不可比较时必须明确 `unavailable`；有快照时可展示真实字段差异。
5. 批量部分成功：内容签名一致可继续写；缺签名旧版本冲突；锁定跳过；部分失败不回滚成功项。
6. 锁定计划：只算 locked；整份锁定不能逐镜解锁；版本冲突拒绝；内容签名不受锁影响。
7. 旧数据归一化：locked / stale 审核状态回退 pending；同版本旧记录补签名；历史审核保留为 pending。
8. 刷新与统计：refresh 不创建新审核；`reviewStats.reviewed` 只计 approved，locked 单列。

## 10. 浏览器验收记录

环境：

- 页面：`http://localhost:3000/drama?project=proj-stage321-protection&step=review&episode=ep-GHduqaBp`
- 项目：`proj-stage321-protection`，名称“Stage 3.2.1 隔离项目 E”；集 `ep-GHduqaBp`，第 1 集“雾钟授钥”
- 浏览器：Aha Browser Use，Windows 桌面 998 × 667 视口；Vite dev server 端口 3000
- 无真实模型调用，无外部图片 / 视频生成

浏览器已验证：

1. 九宫格 2 列、G01–G04 唯一组号、卡片字号提升。
2. 单镜 Drawer 打开、三栏布局、stale 面板、版本差异、前后镜头、同组镜头、当前检查、审核历史。
3. 镜头 01：解锁 → 备注保存 → approved；刷新后备注和历史仍在。
4. 镜头 04：approved → 标记需要修改 → approved；Drawer 全程不关闭。
5. 镜头 02 / 05 / 06：stale → 重新审核 → pending → approved；刷新后 stale 清零。
6. 镜头 01：approved → 驳回 → 重置待审 → approved，三个动作均即时生效且 Drawer 保持打开。
7. 批量通过 01 + 04：成功 0、跳过 2；批量通过 02 + 04：成功 1、跳过 1；报告持久。
8. 批量锁定 01 + 02：成功 2，锁定 3；批量解锁：成功 2，锁定 1；approved 始终 8。
9. 搜索、场景 / 镜头组 / 审核状态 / 锁定状态筛选、镜号降序、时长升序。
10. 列表选择 2 镜后切九宫格，选择保持；筛选在写入后保持。
11. 刷新后 18 条审核记录、approved 8、pending 0、stale 0、locked 1、readiness `ready_for_video`。

截图：

- `docs/ai-handover/stage4b-overview.png`：最终总览，8 镜全部通过、锁定 1、可进入视频生成。
- `docs/ai-handover/stage4b-history.png`：镜头 01 审核历史，包含通过、备注、重新审核、驳回、重置与再次通过。
- `docs/ai-handover/stage4b-locked-drawer.png`：镜头 03 `approved + locked`，审核按钮禁用、解锁入口独立。
- `docs/ai-handover/stage4b-report.png`：批量操作报告，成功 1 / 跳过 1 / 失败 0 / 正式分镜 v13 未改变。

浏览器环境说明：

- 当前 Browser Use 标签页 `document.hidden=false`、`visibilityState=visible`，但 CSS 动画时间轴多次停在 `currentTime=0`，`studio-page-enter` 的 opacity 停在 0；截图时通过运行时 `document.getAnimations().forEach(a => a.finish())` 强制完成入场动画。
- Drawer / Modal / Dropdown 的 rc-motion 过渡同样可能停在起始帧；截图时临时设置 wrapper `transform:none; opacity:1` 和 mask `opacity:1`。这些是自动化标签页的动画冻结表现，不是产品代码 bug；尚未在用户真实可见窗口确认。
- 未关闭用户已有浏览器窗口或标签页；自动化使用独立测试页面。
- 控制台未出现 React key、组件重挂载或 4B 新增状态错误；仅有既有的 antd `Drawer width` / `Tag bordered` / `Spin tip` deprecation 警告和未登录 401，不属于 4B 新增问题。

## 11. 文件清单

修改：

- `web/src/types/studio-production.ts`
- `web/src/lib/studio/review-engine.ts`
- `web/src/lib/studio/review-actions.ts`
- `web/src/lib/studio/production-actions.ts`
- `web/src/pages/drama/studio/review-workspace.tsx`
- `web/src/pages/drama/studio.css`
- `web/src/pages/drama/index.tsx`
- `web/scripts/stage4a-core-check.ts`

新增：

- `web/src/pages/drama/studio/review-shared.tsx`
- `web/src/pages/drama/studio/review-grid.tsx`
- `web/src/pages/drama/studio/review-list.tsx`
- `web/src/pages/drama/studio/review-shot-drawer.tsx`
- `web/scripts/stage4b-core-check.ts`

Diff：`docs/ai-handover/DRAMA_STUDIO_STAGE4B.diff`，13 个文件，2,685 insertions / 327 deletions，`git apply --check --reverse` 通过。

未包含在 Diff 的临时文件：

- `web/scripts/.tmp-stage4a.mjs`
- `web/scripts/.tmp-stage4b.mjs`

两者仅由 esbuild 测试编译生成，不属于交付代码。

## 12. 已知限制与后续

- Stage 3.2.2 B 正式分镜写入跨标签页并发、F 跨标签页并发仍未验证；4B 的单页 `expectedVersion` 与回读不能替代。
- Stage 3.2.2 C Mock 覆盖确认、D 备份失败注入、E 旧项目 / 历史快照 / 旧草稿浏览器回归仍未执行。
- 真实模型失败 / 截断、超长集镜头数量、大量镜头性能与虚拟滚动未验证。
- 998px 下九宫格 2 列、Drawer 三栏可用但偏密；字号已从 7–8px 提升到 9–10px，仍建议在真实桌面窗口复核。
- `groupNumber` 在项目 E 四个组中均为 1；UI 已改用集内顺序生成 G01–G04，正式数据未改。旧项目若依赖 `groupNumber` 可能需要后续数据校正，但不属于 4B。
- locked + stale 的设计选择：必须先解锁才能“重新审核”；这在 UI 有明确提示，但未来若需要允许锁定镜头复核，需要单独确认语义。
- 4B 不实现 AI 审查、预览图、视频生成、版本恢复、时间轴、音频、整集合成或第六步；这些不属于本轮验收。

## 13. 建议的用户验收步骤

1. 在真实可见窗口打开项目 E 第四步，确认入场动画、九宫格 / 列表 / Drawer 的视觉与字号。
2. 对任一 `approved + locked` 镜头尝试审核动作，确认按钮禁用且解锁入口独立。
3. 对 stale 镜头执行“重新审核当前正式分镜”，确认进入 pending、历史追加、刷新后仍 pending。
4. 执行一次批量通过（含 1 个合法镜头 + 1 个锁定镜头），确认报告显示成功 / 跳过且正式版本不变。
5. 执行批量锁定 / 解锁，确认锁定数变化但审核结论不变。
6. 切换九宫格 / 列表、筛选、排序、选择，确认状态不因审核写入重置。
7. 若需要，再单独验收 Stage 3.2.2 B–F；不要把本轮通过写成 3.2.2 全部通过。
