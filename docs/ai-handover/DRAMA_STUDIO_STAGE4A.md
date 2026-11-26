# 离火 AI 短剧工作室 · Stage 4A

分镜审核与调整：数据模型与审核基础

- 日期：2026-11-23
- 基线：Stage 3.2.1 完成态，主仓库 HEAD `27b67bd09a8a`；工作区仍有用户既有修改与未跟踪文件。
- 状态：Stage 4A 代码已实现；确定性测试、Stage 3 / 3.1 / 3.2 / 3.2.1 回归、`typecheck`、`build` 通过；隔离项目 E 完成真实浏览器点击。**4A 没有调用任何真实模型，也没有进入 4B–4F。** 未提交、未推送。

## 0. 结论与验收边界

本轮只完成 Stage 4A，不继续九宫格、单镜检查、调整、AI 提案、预览图和最终 5 步交接。第四步在 UI 中仍是第五步之前的质量检查环节，不是独立后期步骤。

| 项目 | 代码已实现 | 确定性测试 | 真实浏览器点击 | 真实模型调用 |
| --- | --- | --- | --- | --- |
| 独立审核状态与审核记录 | 是 | 通过 | 单镜审核 + 记录 Modal 通过 | 不涉及 |
| Error / Warning / Suggestion 确定性检查 | 是 | 通过 | 页面统计与检查条显示真实数据 | 不涉及（4A 只做确定性检查） |
| 全剧分镜总览与基础镜头列表 | 是 | 通过（数据层） | 通过 | 不涉及 |
| 审核统计 / readiness | 是 | 通过 | 显示 `not_ready` 与真实原因 | 不涉及 |
| 正式分镜不被审核写入修改 | 是 | 通过 | 审核 + 重新检查后正式 v13 不变 | 不涉及 |
| Stage 3.2.2 A 草稿结构校验 | 是 | 通过 | 未在旧草稿 UI 重跑 | 不涉及 |
| 3.2.2 B 正式写入并发保护 | 部分依赖既有 Stage 3.1 机制 | 既有回归通过 | 未做跨标签页实测 | 不涉及 |
| 3.2.2 C Mock 覆盖确认 | 未在 4A 执行 | 未执行 | 未执行 | 未执行 |
| 3.2.2 D 备份失败注入 | 未在 4A 执行 | 未执行 | 未执行 | 未执行 |
| 3.2.2 E 旧项目 / 历史快照 / 旧草稿兼容 | 仅纯函数 hydration 覆盖 | 部分通过 | 旧 V2 未实测，项目 A 不在当前 IDB | 不涉及 |
| 3.2.2 F 跨标签页并发 | **未验证** | 未覆盖 | 未执行 | 不涉及 |

**明确边界：**

- “确定性测试通过”不等于浏览器真实点击通过；浏览器通过也不等于真实模型调用通过。
- 4A 没有 AI 审查、没有模型重生成、没有预览图，因此不存在“真实模型调用通过”的项。
- 当前浏览器 IndexedDB 只有隔离项目 E，没有旧 V2 项目和原始 live 项目 A；旧 V2 回退 UI 不能写成浏览器通过。
- 审核写入已有 `expectedVersion` 和写入后回读校验，但不是跨标签页互斥；3.2.2 B/F 仍需单独验收。

## 1. 开发前置检查

### 1.1 历史报告与 Diff

实际存在并已核对：

- `docs/ai-handover/DRAMA_STUDIO_STAGE3.md`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3.diff`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_1.md`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_1.diff`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2.md`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2.diff`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_1.md`
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_1.diff`

**缺失文件：**

- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2.md`：不存在。
- `docs/ai-handover/DRAMA_STUDIO_STAGE3_2_2.diff`：不存在。

因此本轮没有声称“读过 Stage 3.2.2 报告”。用户列出的 A–F 作为第四阶段并行前置验收清单处理；没有把不存在的报告内容写成已核对事实。

### 1.2 当前架构

本轮实际读取并沿用的结构：

- 项目根：`StudioProject`。
- 分集：`StudioEpisode`。
- 分集制作数据：`StudioEpisodeProduction`，已有 `script / scriptVersions / storyboard / storyboardVersions / storyboardDrafts / checks`。
- 全剧改编：`StudioAdaptationWorkspace`、`StudioEpisodePlan`，属于 Stage 2B；4A 没有复制这一套规划数据。
- 正式分镜：`StudioStoryboardDocument`，内含 `groups: StudioShotGroup[]` 和 `shots: StudioProductionShot[]`。
- 草稿与快照：`StudioStoryboardDraft`、`StudioStoryboardVersion`，沿用 Stage 3.2.1。
- 模型：项目级 `modelProfiles`；4A 不调用模型，因此没有读取或修改 `AiConfig`。

### 1.3 第四步入口现状

- 旧 V2 项目：没有 `project.adaptation` 时，第四步继续使用旧 `StudioPictureWorkspace`，并显示兼容提示。
- 新 Stage 3 项目：有 `project.adaptation` 时，第四步进入 `Stage4ReviewWorkspace`。
- 五步仍是：01 AI 小说分析、02 角色与场景资产、03 分集剧本与分镜、04 分镜审核与调整、05 视频生成；没有增加第六步。
- 第四步不提供视频生成入口，不生成图片，不拼接整集视频，不扩展声音 Tab。

## 2. 数据模型设计

### 2.1 扩展点

没有创建第二套项目、分集或分镜模型。审核数据只作为 `StudioEpisodeProduction` 的可选字段：

```ts
StudioEpisodeProduction {
  // 既有字段保持不变
  version: 1;
  script?: StudioScriptDocument;
  scriptVersions: StudioScriptVersion[];
  storyboard?: StudioStoryboardDocument;
  storyboardVersions: StudioStoryboardVersion[];
  storyboardDrafts: StudioStoryboardDraft[];
  checks: StudioProductionCheck[];
  // Stage 4A 新增
  storyboardReview?: StudioStoryboardReview;
  updatedAt: string;
}
```

新增类型：

```ts
StudioStoryboardReviewStatus =
  | "pending"
  | "approved"
  | "needs_revision"
  | "rejected"
  | "locked"
  | "stale";

StudioStoryboardReviewAction =
  | "approve"
  | "needs_revision"
  | "reject"
  | "reset"
  | "note"
  | "recheck";

StudioStoryboardReadinessStatus =
  | "not_ready"
  | "ready_for_video"
  | "blocked";

StudioStoryboardShotReview {
  shotId: string;
  status: Exclude<StudioStoryboardReviewStatus, "locked" | "stale">;
  note: string;
  storyboardVersion: number;
  reviewedAt: string;
  reviewedBy: string;
}

StudioStoryboardAuditRecord {
  id: string;
  episodeId: string;
  shotId: string;
  action: StudioStoryboardReviewAction;
  fromStatus: StudioStoryboardReviewStatus;
  toStatus: StudioStoryboardReviewStatus;
  note: string;
  actor: string;
  storyboardVersion: number;
  createdAt: string;
}

StudioStoryboardReviewIssue {
  id: string;
  level: "error" | "warning" | "suggestion";
  code: string;
  category: string;
  message: string;
  suggestion: string;
  episodeNumber: number;
  sceneId?: string;
  shotGroupId?: string;
  shotId?: string;
  source: "deterministic" | "model";
  status: "open" | "accepted" | "ignored" | "resolved";
  createdAt: string;
  updatedAt: string;
}

StudioStoryboardReadiness {
  status: "not_ready" | "ready_for_video" | "blocked";
  reasons: string[];
  blocking: string[];
  storyboardVersion: number;
  checkedAt: string;
}

StudioStoryboardReview {
  version: 1;
  episodeId: string;
  storyboardVersion: number;
  shots: Record<string, StudioStoryboardShotReview>;
  issues: StudioStoryboardReviewIssue[];
  audits: StudioStoryboardAuditRecord[];
  readiness: StudioStoryboardReadiness;
  lastCheckedAt?: string;
  updatedAt: string;
}
```

### 2.2 设计取舍

- **审核和正式分镜分离**：`storyboardReview` 不进入 `storyboardContentHash()`；审核动作不会改 `storyboard`、`storyboardVersion`、快照或独立草稿。
- **`locked` / `stale` 不落盘为独立审核结论**：镜头真实 `locked` 字段和分镜 `stale.shotIds` 是权威来源；审核记录只保存 `pending / approved / needs_revision / rejected`，避免“正式状态已经变化，审核表还写着旧 locked”的双重真相。
- **版本绑定**：每条审核记录带 `storyboardVersion`；旧记录对不上当前正式版本时投影为 `stale`。
- **Issue 与 Stage 3 `checks` 分开**：4A 的检查结果是第四步审核视图，不改写 Stage 3 的 `checks`；模型审查建议在 4D 另走提案，不混入正式分镜。
- **没有新增** `StoryboardPreviewAsset`：静态预览图属于 4E，本阶段没有生成或保存预览资产。

### 2.3 旧数据归一化

`normalizeStoryboardReview(value, storyboard)`：

- 没有 `storyboardReview` 且没有正式分镜时返回 `undefined`，不给每集制造空审核。
- 有正式分镜但无审核字段时，建立空审核壳，版本绑定当前 `storyboardVersion`，readiness 为 `not_ready`。
- 旧记录里的 `locked` / `stale` 存量状态回退为 `pending`，因为这两个状态必须由真实镜头 / 上游数据派生。
- 缺字段补空字符串或当前时间；未知审核状态直接丢弃，不伪造结论。
- 保留旧 issue 的 `accepted / ignored / resolved` 状态；重新检查时同一 issue id 的状态不会被自动重置。

`normalizeEpisodeProduction()` 在 hydration 时只补 `storyboardReview`，不修改旧剧本、分镜、快照和独立草稿。

## 3. 审核状态设计

### 3.1 生效顺序

`effectiveShotReviewStatus()` 的顺序是：

1. 整份正式分镜 `status === "locked"` 或镜头 `locked === true` → `locked`。
2. `storyboard.stale.shotIds` 命中 → `stale`。
3. 已有审核记录的 `storyboardVersion` 与当前正式 `storyboardVersion` 不一致 → `stale`。
4. 有审核记录 → 记录中的 `pending / approved / needs_revision / rejected`。
5. 无记录 → `pending`。

锁定优先于其他状态，不允许把锁定内容当作普通待审镜头覆盖。

### 3.2 审核动作

4A UI 实际提供：

- `通过` → `approved`
- `需修改` → `needs_revision`
- `驳回` → `rejected`
- `重置待审` → `pending`

数据层还预留 `note`、`recheck` 两个 action 值；`recheck` 走单独的重新检查路径，`note` 的备注编辑 UI 属于后续阶段。

`planStoryboardReviewStatus()` 是纯函数：

- 校验 `expectedVersion` 与当前正式 `storyboardVersion`。
- 先按锁定 / stale / 不存在 / 状态未变化筛选；`locked / stale / missing` 一律跳过，不写入。
- 同状态且无备注视为 `unchanged`，不产生审核记录。
- 其他镜头继续写入，返回 `updated` 与 `skipped`，支持批量部分成功。
- 每个成功状态变化生成一条 `StudioStoryboardAuditRecord`。
- 审核写入不增加正式 `storyboardVersion`。

### 3.3 统计

`reviewStats()` 返回：

- `total`
- `approved`
- `pending`
- `needsRevision`
- `rejected`
- `locked`
- `stale`
- `reviewed = approved + locked`
- `scenes`
- `groups`
- `duration`
- `errors / warnings / suggestions`（只算 `open`）

统计全部来自当前数据和当前生效状态，不使用固定演示数字。

### 3.4 Readiness

当前 4A 采用保守规则：

- `blocked`：没有镜头、存在 open Error、存在 rejected 镜头。
- `not_ready`：仍有 pending / needs_revision / stale，存在 open Warning，或 `storyboard.stale` 未复核。
- `ready_for_video`：无上述阻塞，且所有镜头已通过或锁定。

锁定镜头被视为“受保护”，不再按 pending 计数；这是 4A 的保守实现，最终第五步交接规则仍应在 4F 按真实业务确认。

## 4. 审核记录设计

### 4.1 记录内容

每条记录包含：

- 镜头 ID、分集 ID
- 操作类型（`approve / needs_revision / reject / reset / note / recheck`）
- 操作者（默认 `local-user`，显示为“本地用户”）
- 操作时间
- 原状态、新状态
- 备注
- 对应正式分镜版本

记录 ID 由 `shotId + action + toStatus + storyboardVersion + time + audits.length` 计算稳定哈希；同一镜头连续操作不会共用同一条记录。

### 4.2 读取与展示

- `auditsForShot()` 按时间倒序返回当前镜头的记录。
- 4A Modal 展示：原状态 → 新状态、备注、操作者 / 动作、版本、时间。
- 没有记录时明确显示“这个镜头还没有审核记录”。
- 当前 Modal 还会展示该镜头当前 open 检查项，但不提供备注编辑、删除记录或恢复历史审核状态。

### 4.3 部分成功

底层 `planStoryboardReviewStatus()` 已支持批量镜头；某个镜头锁定 / stale / 不存在 / unchanged 时只进入 `skipped`，合法镜头仍然写入。4A UI 当前只暴露单镜操作，批量按钮和进度 UI 属于 4B。

## 5. Error / Warning / Suggestion 检查机制

### 5.1 检查层

`buildStoryboardReviewIssues()` 是纯函数，读取当前 `StudioStoryboardDocument` 和可选 `StudioScriptDocument`，输出带镜头 / 场景 / 镜头组归属的 issue。4A 只做确定性检查，不调用模型。

每条 issue 有稳定的 `stage4-issue-*` ID；重新检查时按 ID 保留旧 `open / accepted / ignored / resolved` 状态，避免用户已经接受的建议被无意义重置。

### 5.2 已实现的结构检查

Error：

- 分镜没有任何镜头。
- 镜头组缺 `shotGroupId`。
- 镜头组 ID 重复。
- 镜头组引用不存在的剧本场景。
- 镜头组缺摄影机轴线。
- 镜头组内重复引用同一镜头。
- 镜头 ID 缺失或重复。
- 镜头没有有效镜头组。
- 镜头未登记在所属镜头组的 `shotIds` 中。
- 镜头场景与镜头组场景不一致。
- 同一镜头被多个镜头组引用。
- 镜头引用不存在的剧本场景。
- 镜头组 `shotIds` 引用不存在的镜头。
- 对白没有绑定 `characterId`。

Warning：

- 镜头组没有共享空间布局。
- 有角色起点但没有共享布局。
- 镜头组没有登记任何镜头。
- 镜头时长缺失 / 非法。
- 单个镜头时长超过 30s。
- 景别、机位或运镜不完整。
- 没有动作描述。
- 有出场人物但没有人物调度。
- 图片或视频提示词不完整。
- 人物 / 道具不在剧本绑定中。
- 说话人不在画面人物中。
- 对白估算时长明显超过镜头时长。
- 上游 `stale.shotIds` 命中。
- 同一镜号被多个镜头重复使用。
- 分镜总时长与剧本目标偏差过大。

Suggestion：

- 同一镜头组相邻镜头没有声明连续性规则。

### 5.3 草稿结构校验（3.2.2 A）

`validateStoryboardDraftDocument()` 额外强化：

- `shotGroupId` 唯一。
- 同一镜头不能被多个镜头组重复引用。
- 镜头组 `shotIds` 内不能重复引用。
- 引用的镜头必须存在。
- 镜头必须登记在所属组的 `shotIds` 中。
- 镜头 `shotGroupId` 与镜头组引用双向一致。
- 草稿必须有分镜 / 分集标识和完整数组。

这一步是“应用草稿到正式分镜”前的硬门禁，不是 UI 提示。

### 5.4 尚未实现的检查

4A 没有实现的连续性 / 摄影检查（4C 再做）：

- 人物位置、朝向、视线、运动方向的跨镜头连续。
- 摄影机轴线是否无故跨越。
- 服装、道具持有状态、场景状态、光照 / 天气的连续。
- 动作起势、接触、结果是否完整。
- 表情、眼神、人物反应是否符合情绪。
- 构图前后景层次、关键动作遮挡、镜头重复与切换动机。
- 对白表演匹配、镜头节奏与冗余镜头分析。

因此 4A 的“确定性检查”不能被描述成完整分镜质量引擎；它是结构 / 资产引用 / 时长 / 局部组内提示的第一层。

## 6. 分镜总览与基础列表

### 6.1 页面结构

`Stage4ReviewWorkspace`：

- 左侧：全剧分集总览。每集显示集号、集名、正式分镜版本、镜头数、组数、审核进度条、readiness；没有正式分镜的集显示“未生成正式分镜 / 未就绪”。
- 右侧：当前集详情。包含正式分镜 v、剧本 v、审核绑定 v、readiness、8 项统计、确定性检查计数与前 3 条 open issue、筛选栏、基础镜头列表。
- 顶部：`重新检查` 与 `去分镜设计`。`去分镜设计` 回到第三步 `step=script&view=storyboard`。

### 6.2 统计卡片

实际 8 项：

- 镜头
- 已通过
- 待审核
- 需修改
- 驳回
- 锁定
- stale
- 总时长

### 6.3 筛选与列表

支持：

- 搜索镜号、景别、机位、运镜、动作、台词。
- 按场景筛选。
- 按镜头组筛选（值是 `shotGroupId`，标签显示 `Gxx · 场景`）。
- 按审核状态筛选：全部 / 待审核 / 已通过 / 需要修改 / 不通过 / 已锁定 / 上游已变化。
- 按问题等级筛选：Error / Warning / Suggestion，可点击计数条切换。
- 快速定位全部待审核镜头。
- 基础列表显示：镜号、场景 / 组、镜头语言、时长、人物 / 台词 / 动作、检查条数、审核状态、状态操作与记录入口。

**组号说明：** Stage 3 的 `groupNumber` 是场景内序号，因此不同场景都可能出现 `G01`。4A 列表显示为 `G01 · 2 镜`，组筛选用唯一 `shotGroupId`，总览的“4 组”按 `document.groups.length` 统计。是否把组号改成全剧唯一编号，属于 Stage 3 数据语义调整，本轮没有擅自修改。

### 6.4 4A 没有做的 UI

- 九宫格分镜视图。
- 单镜头完整审片面板。
- 批量审核 / 批量锁定 / 批量解锁 / 批量重新生成预览图 / 批量标记问题。
- 审核备注编辑。
- 锁定 / 解锁动作（当前只派生并跳过锁定镜头）。
- 历史版本比较、恢复、冲突快照管理。
- AI 审查、AI 局部重生成、差异预览。
- 静态预览图 / 角色场景参考图。
- 视频生成、时间轴、整集合成。

这些属于 4B–4F，不在 4A 交付。

## 7. 持久化与写入保护

### 7.1 存储位置

- 沿用 `use-studio-store` 的 Zustand `persist`。
- 存储引擎：`localForageStorage`，浏览器实际落到 IndexedDB。
- 键：`lihuo:studio_store`（经 `storageKey()` 命名空间）。
- 数据归属：`StudioProject -> StudioEpisode -> StudioEpisodeProduction -> storyboardReview`。

没有新建审核数据库、第二套项目集合或云端表。

### 7.2 写入路径

`refreshStoryboardReviewAction()`：

- 读当前 `episode.production.storyboard`。
- 可选校验 `expectedVersion`。
- 记录写入前 `storyboardContentHash`。
- 生成刷新后的 review（issues / readiness / 版本绑定）。
- 只写 `storyboardReview`，不改正式分镜。
- 写后回读：正式 storyboard hash 必须不变，正式版本必须不变，review 的 `checkedAt` 必须落盘。
- 失败返回错误，不报告成功。

`setStoryboardShotReviewAction()`：

- 读当前正式分镜。
- `planStoryboardReviewStatus()` 校验当前版本与目标镜头状态。
- 无合法更新时直接返回 `updated: []`，不写空记录。
- 记录写入前 hash，只写 `storyboardReview`。
- 写后回读：正式 hash / 版本不变；每个 `updated` 镜头回读状态必须等于目标状态。
- 失败返回错误。

### 7.3 当前保护边界

- **不覆盖正式分镜**：所有审核写入都只改 `storyboardReview`；hash 与版本回读用于发现同时修改。
- **单页版本校验**：`expectedVersion` 阻止基于旧正式版本的审核提交。
- **不是跨标签页互斥**：没有 Web Lock、BroadcastChannel 互斥或服务端串行化。如果两个标签页在读取之后、写入之前同时修改，可能出现审核写入后回读失败，但正式分镜仍然安全；审核记录可能已落盘为旧版本绑定。这个边界必须保留在“未验证”里，不能用 4A 的单页测试替代 3.2.2 B/F。

## 8. 测试结果

工作目录：`C:\Users\qq308\Desktop\lihuo\web`

### 8.1 Stage 4A 确定性测试

```powershell
npx --yes tsx scripts/stage4a-core-check.ts
```

实际输出：

```text
stage4a-core-check: 9 groups passed
```

覆盖：

1. 初始审核、通过、批量计划、审核记录、readiness。
2. 锁定 / stale / unchanged / 版本冲突。
3. 结构检查：重复组、跨组引用、缺失镜头、非法时长、未知场景、未知组。
4. 草稿结构校验 A：重复组、跨组、缺失引用、未登记、重复引用。
5. readiness：pending → not_ready；Error → blocked；全部锁定 → ready。
6. 重新检查只更新 issues / readiness，不改审核结论与审核记录。
7. 统计、旧数据归一化、审核记录状态保留。
8. Stage 3.2.1 兼容：只补审核壳，不篡改剧本 / 分镜 / 草稿。
9. 锁定镜头统计与 `reviewed` 口径。

### 8.2 回归

```powershell
npx --yes tsx scripts/stage3_2_1-core-check.ts
npx --yes tsx scripts/stage3_2-core-check.ts
npx --yes tsx scripts/stage3-core-check.ts
npx --yes tsx scripts/stage3_1-core-check.ts
```

全部通过，输出与 Stage 3.2.1 记录一致：

```json
{"ok":true,"tests":"stage3_2_1-core-check","manual":{"legacyModules":["scene","dialogue","action","other"],"dialogueBlocks":"manual_edited","actionDoesNotBlockDialogue":true,"sceneStillBlocks":false},"dialogueMerge":{"sceneVersions":{"scene-a":2,"scene-b":1},"stale":["shot-a"],"shotsKept":2},"draft":{"id":"sbd-1ylekzn","reused":true,"sourceVersion":18,"formalVersion":19,"conflict":true,"staleConfirmed":true}}
{"ok":true,"tests":"stage3_2-core-check","scriptProtection":{"queue":1,"skips":5},"sceneVersions":{"changed":{"scene-a":2,"scene-b":1},"swapped":{"scene-b":2,"scene-a":2}},"stale":{"sceneIds":["scene-a"],"shotIds":["shot-a"],"oldShotsKept":2},"snapshots":{"formal":19,"conflict":18,"normalized":["conflict","formal"]},"apply":{"newVersion":20,"backupVersion":19},"scriptRestore":{"newVersion":4,"backupVersion":3}}
{"ok":true,"tests":"stage3-core-check","fixture":{"projectId":"proj-UORILWcK","snapshotId":"handoff-14rfeou","openChecks":8},"admission":{"episode1Formal":true,"episode2Formal":false},"script":{"scenes":2,"characters":3,"props":2,"durationSeconds":39.4},"storyboard":{"groups":1,"shots":2},"checks":{"scriptError":0,"storyboardError":0},"persistence":{"status":["interrupted","unknown"],"remoteState":["unknown","unknown"],"activeJobId":null}}
{"ok":true,"tests":"stage3_1-core-check","hydration":{"queued":"interrupted/not_submitted","submitting":"interrupted/unknown","unknown":"unknown","succeeded":"completed","legacyFailed":"failed/unknown"},"selection":{"resumable":1,"retryable":1,"review":6},"lock":{"episodeBlocksScene":true,"episodeBlocksShot":true,"sceneBlocksScene":true,"sceneBlocksShot":true,"differentEpisodePasses":true},"frozenModel":{"old":"对话","next":"gpt-5.5"},"storyboard":{"version":6,"lockedShotKept":true,"shots":2}}
```

### 8.3 类型检查与生产构建

```powershell
npm run typecheck
npm run build
```

实际结果：

```text
typecheck_exit=0
build_exit=0
✓ 8301 modules transformed.
✓ built in 1m 29s
```

构建只有既有的 chunk 体积 warning 和动态 / 静态混合导入 warning，没有新增错误。

### 8.4 Diff 校验

```text
git apply --check --reverse docs/ai-handover/DRAMA_STUDIO_STAGE4A.diff
reverse-check: OK
```

Diff 基于改动前基线 `C:\Users\qq308\AppData\Local\Temp\lihuo-stage4a-baseline` 生成，不是基于主仓库 HEAD；新增文件显示为 `new file`。文档侧 `CHANGELOG.md`、`todo.mdx`、`pending-test.mdx` 另行同步，不混入代码 Diff。

## 9. 浏览器验收记录

### 9.1 环境

- 页面：`http://localhost:3000/drama?project=proj-stage321-protection&step=review&episode=ep-GHduqaBp`
- 隔离项目 E：`proj-stage321-protection`，第 1 集 `ep-GHduqaBp`「雾钟授钥」。
- 正式分镜 `v13`，剧本 `v3`，8 镜 / 4 组，总时长 58.3s。
- 浏览器视口：998×667。
- IndexedDB：`lihuo / app_state / lihuo:studio_store`。
- 没有关闭用户已打开的浏览器窗口或标签页；验收使用独立标签页。

**截图证据：**

- `docs/ai-handover/stage4a-overview.png`（998×667，总览、统计、确定性检查、筛选与基础列表）。
- `docs/ai-handover/stage4a-audit-modal.png`（998×667，镜头 03 审核记录 Modal）。

### 9.2 实际操作

1. 打开第四步：左侧全剧总览显示 3 集；第 1 集显示正式 v13 / 8 镜 / 4 组；第 2、3 集显示未生成正式分镜。
2. 第 1 集统计：镜头 8、已通过 0、待审核 4、需修改 0、驳回 0、锁定 0、stale 4、总时长 58.3s；确定性检查 0 Error / 4 Warning / 0 Suggestion；readiness 为“尚未就绪”，原因“3 个镜头待审核”（另有 4 个 stale）。
3. 点击镜头 03 状态下拉，选择“通过”：已通过变为 1、待审核变为 3；镜头 03 状态标签变为“已通过”；readiness 仍为“尚未就绪”。
4. 刷新页面：镜头 03 的“已通过”仍在，说明 IndexedDB 持久化成功。
5. 打开镜头 03 的“记录”Modal：显示“待审核 → 已通过”，无备注，`v13 · 2026/11/23 20:52:46`；审核记录 Modal 还显示操作者 / 动作。
6. 点击“重新检查”：出现“已完成确定性检查，正式分镜未被修改”；正式分镜仍为 v13，审核绑定仍为 v13。
7. 点击 `4 Warning` 计数：列表过滤为 4 / 8 镜；再次点击清除。
8. 点击“未审核”快速筛选：列表过滤为 3 / 8 镜；刷新后恢复为 8 / 8 镜。
9. 基础列表组标签从 `G01 · 1 镜组` 修正为 `G01 · 2 镜`，避免把“场景内组号”误读成“每组只有 1 镜”；总览的 4 组口径不变。

### 9.3 IDB 读数

```text
projectCount = 1
projectIds = ["proj-stage321-protection"]
storyboardVersion = 13
reviewVersion = 13
reviewStatuses = { "shot-ofmgpi": "approved" }
audits = 1
issueCount = 4
readiness = "not_ready"
```

这证明审核状态与审核记录落盘、正式分镜 v13 未变；但不能证明跨标签页并发、旧 V2 或真实模型路径。

### 9.4 浏览器控制台

没有新的 Stage 4 错误。只有既有 antd `Spin tip`、`Drawer width`、`Tag bordered` 弃用提示和两个 401 Unauthorized（与未登录模型相关）。

## 10. 与 Stage 3.2.1 的兼容性

- 数据只增加可选 `storyboardReview`，不改 `StudioProject / StudioEpisode / StudioStoryboardDocument` 的既有字段。
- `normalizeEpisodeProduction()` 只补审核壳；旧剧本、旧分镜、旧快照、`storyboardDrafts` 和 `checks` 原样保留。
- 正式分镜、快照、独立草稿的版本语义未改变；审核不新增正式 `storyboardVersion`，也不把历史快照升级成正式版本。
- `storyboardReview` 不参与 `storyboardContentHash()`；审核写入与正式分镜内容分离。
- E 的旧数据回归：剧本 v3、分镜 v13、8 镜 / 4 组、2 场 / 4 镜 stale 均保留。
- `validateStoryboardDraftDocument()` 的 A 修复会使包含重复组 / 跨组引用 / 缺失引用的草稿在应用时被拒绝。这是有意的安全收紧，但旧草稿若本身结构非法，本轮没有在浏览器中逐条回归。
- 没有修改 Stage 3.2.1 的对白保护、独立草稿和剧本手工写入路径；对应回归测试全部通过。

## 11. 未验证事项

1. **Stage 3.2.2 B / F**：跨标签页同时编辑同一集 / 同一镜头组、一个标签页修改而另一个应用旧审核、一个标签页锁定而另一个尝试修改、刷新后冲突状态保留，均未实测。
2. **Stage 3.2.2 C**：Mock 模型覆盖确认路径未执行；4A 没有模型调用，不能代替这一项。
3. **Stage 3.2.2 D**：备份失败注入未执行；4A 没有正式写入备份流程。
4. **Stage 3.2.2 E**：旧 V2、原始 live 项目 A/B、历史快照 / 历史草稿的浏览器回归未完成。当前 IndexedDB 只有项目 E；访问 `proj-UORILWcK` 会回落到项目库，不能把这次回落当作旧 V2 回退成功。
5. **筛选逐项验收**：场景筛选、镜头组筛选、已通过 / 需修改 / 驳回 / 锁定 / stale 筛选尚未逐项点击；本轮实测了 Warning 计数筛选和“未审核”快速筛选。
6. **性能**：当前按集渲染全部镜头，没有虚拟滚动或分页；长剧、大量镜头和预览图懒加载属于 4F / 后续性能验收。
7. **锁定 / 解锁 UI**：当前没有解锁按钮；锁定状态只由正式镜头字段派生并阻止审核。
8. **审核备注**：数据字段与 action 已有，但 4A 没有备注编辑 UI。
9. **批量审核 UI**：纯函数支持批量部分成功，4A 没有批量按钮、进度和取消。
10. **版本管理 / 预览图 / AI 审查 / 局部重生成**：均未实现；不能写成 4A 已完成。
11. **真实 `ready_for_video`**：只有确定性夹具覆盖；真实项目 E 仍是 `not_ready`。
12. **真实模型调用**：4A 无模型调用，故没有“真实模型调用通过”的结论。

## 12. 已知风险

- **跨标签页审核写入不是原子操作**：`expectedVersion` 与回读校验能保护正式分镜，但另一个标签页在读取与写入之间改变正式版本时，审核记录可能落盘为旧版本绑定；页面重新计算后会显示 stale，正式分镜内容不被覆盖。3.2.2 B/F 仍需专项处理。
- **检查引擎偏保守**：任何 open Warning 都会阻止 `ready_for_video`；锁定镜头按已审核统计。最终业务规则需在 4F 确认。
- **对白时长是估算**：按中文字符数 / 4.2 字每秒估算，只做提示，不替代真实配音时长。
- **组号是场景内序号**：`G01` 会在不同场景重复；4A 用 `shotGroupId` 作为筛选值，列表显示组内镜头数，没有改 Stage 3 的编号语义。
- **旧草稿结构可能被新校验拒绝**：这是安全优先的结果；若用户有历史非法草稿，需要单独迁移或修复，不能静默放行。
- **项目 E 不是原始 live 项目**：浏览器结论只覆盖隔离项目；原始项目 A/B 的旧媒体、旧 V2、跨标签页仍需用户自己的环境复核。

## 13. 新增与修改文件

新增：

| 文件 | 作用 |
| --- | --- |
| `web/src/lib/studio/review-engine.ts` | 审核状态、审核记录、确定性检查、统计、readiness、批量审核计划、旧数据归一化 |
| `web/src/lib/studio/review-actions.ts` | 审核刷新 / 单镜或批量写入、版本与内容回读保护 |
| `web/src/pages/drama/studio/review-workspace.tsx` | Stage 4A 总览、统计、筛选、基础列表、单镜审核、审核记录 Modal |
| `web/scripts/stage4a-core-check.ts` | 9 组确定性测试 |

修改：

| 文件 | 作用 |
| --- | --- |
| `web/src/types/studio-production.ts` | 新增审核状态、动作、记录、issue、readiness、review 类型和 `StudioEpisodeProduction.storyboardReview` |
| `web/src/lib/studio/production-workspace.ts` | hydration 归一化审核壳，不篡改既有制作数据 |
| `web/src/lib/studio/storyboard-snapshots.ts` | 草稿结构校验加强（3.2.2 A） |
| `web/src/pages/drama/index.tsx` | 新 Stage 3 项目第四步接入 `Stage4ReviewWorkspace`；旧 V2 保留 `StudioPictureWorkspace` |
| `web/src/pages/drama/studio.css` | Stage 4A 样式、998px 卡片行布局与窄屏堆叠 |

`DRAMA_STUDIO_STAGE4A.diff`：9 个源码 / 测试文件，1,847 insertions / 6 deletions，113,270 bytes；只包含上述 9 个文件，不包含 CHANGELOG、todo、pending-test、报告和截图。Diff 生成后 `git apply --check --reverse` 通过；未执行提交或推送。

## 14. 停止条件

- 本轮只完成 Stage 4A。
- 未开发 4B 九宫格、单镜审片、批量审核 UI、锁定 / 解锁 UI。
- 未开发 4C 完整连续性与轴线引擎。
- 未开发 4D AI 审查、调整提案、局部重生成。
- 未开发 4E 预览图、版本历史、恢复、草稿管理。
- 未开发 4F 最终第五步交接与完整性能验收。
- 未进入 Stage 5，未调用视频模型，未新增第六步、时间轴剪辑器、整集拼接或声音扩展。
- 未修改外部后端、Doubao Bridge、全局 `AiConfig`、无限画布核心或项目账号隔离。
- 未执行 `git reset / checkout / stash / clean`，未删除用户文件，未覆盖既有修改，未执行 `git add / commit / push`。
- 等待用户审查本报告与 Diff；3.2.2 B–F 仍作为第四阶段并行前置验收保留，未验证前不得宣布第四阶段正式完成。
