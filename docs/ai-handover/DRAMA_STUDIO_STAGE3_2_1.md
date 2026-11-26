# 离火 AI 短剧工作室 · Stage 3.2.1

剧本人工编辑保护、分镜草稿隔离与版本管理修复

- 日期：2026-11-23
- 基线：Stage 3.2 完成态，主仓库 HEAD `27b67bd09a8a`
- 状态：代码修复完成；确定性测试、Stage 3.2 / 3 / 3.1 回归、`typecheck`、`build` 通过；隔离项目 E 完成浏览器真实点击。**真实模型覆盖确认路径未执行**；未提交、未推送；本轮停在此阶段，不进入 Stage 4。

## 0. 结论与验收边界

三个问题都已在当前调用链上修复，且没有新建第二套项目体系：

| 项目 | 代码已实现 | 确定性测试 | 浏览器真实点击 | 真实模型调用 |
| --- | --- | --- | --- | --- |
| 对白重生成人工编辑保护 | 是 | 通过 | 保护 Modal 触发、取消通过 | 未执行（未点击确认覆盖） |
| 分镜「复制到新草稿」独立隔离 | 是 | 通过 | 复制 / 重复复制 / 编辑 / 删除 / 冲突取消 / 应用 / 刷新通过 | 不涉及 |
| 正式剧本手工写入统一版本管理 | 是 | 通过 | 单场修改、局部 stale、无变化不递增通过 | 不涉及 |
| Stage 3.2 原有功能回归 | 保留 | 通过 | 本轮只回归受影响路径，未重跑全量队列 UI | 未重跑 |

**明确边界：**

- `typecheck`、`build` 只证明类型与构建通过，不等于浏览器功能验收。
- 浏览器已完成「对白覆盖保护」的触发与取消，但没有点击确认，也没有调用真实模型；因此「确认后只覆盖目标对白」和「模型失败旧对白保留」仍属于代码路径 + 纯函数覆盖，不是真实模型验收。
- 备份持久化失败、写入回读失败两条异常路径没有做存储故障注入，也没有在浏览器里制造失败；只由代码顺序保证“失败不覆盖”。
- 本轮没有在原始 live 项目 A/B 上做破坏性测试，也没有重新打开旧 V2 项目；只使用隔离项目 E。

## 1. 开发前检查

### 1.1 实际源码位置

本轮先核对了当前源码，以下路径与任务描述中的目录名有一处差异：

- `web/src/pages/drama/studio.css`：实际 CSS 文件；不是 `web/src/pages/drama/studio/studio.css`。
- `web/src/lib/studio/production-protection.ts`
- `web/src/lib/studio/production-actions.ts`
- `web/src/lib/studio/storyboard-snapshots.ts`
- `web/src/types/studio-production.ts`
- `web/src/lib/studio/production-workspace.ts`
- `web/src/lib/studio/production-engine.ts`
- `web/src/stores/use-studio-store.ts`
- `web/src/pages/drama/studio/production/script-tab.tsx`
- `web/src/pages/drama/studio/production/storyboard-tab.tsx`

### 1.2 三个问题的真实调用链

**对白保护：**

- Stage 3.2 的 `guardSceneScriptWrite()` 只有场景级人工标记可选，`module === "dialogue"` 不检查人工对白。
- Stage 3.2 的确定性测试里甚至有一条旧断言：「旧场景级人工标记下，只重生成对白不要求整场覆盖确认」。这证明绕过不是 UI 误操作，而是底层 guard 的判定缺口。
- `regenerateDialogue()` 直接带 `module: "dialogue"` 调 `runEpisodeScript()`；只要 guard 放行，用户手工改过的对白会被模型结果覆盖。

**复制到新草稿：**

- `planStoryboardSnapshotApply()` 的 `mode` 只改变正式快照 `reason`。
- `applyStoryboardSnapshot()` 无论 `mode: "apply"` 还是 `mode: "copy"`，都写 `storyboard: plan.restored`、递增 `storyboardVersion`。
- 所以 UI 上名为「复制到新草稿」的按钮，实际会改当前正式工作区。这是数据语义错误，不是展示文案问题。

**正式剧本手工写入：**

- `updateScriptManual()` 原来只合并 patch 并写人工标记，不递增 `scriptVersion`、不创建修改前快照、不更新分镜 stale。
- `saveScriptSceneEdit()`、`saveScriptMeta()` 各自实现备份 / 版本 / stale，入口不统一。
- 结果是内容已经改变，但版本号可能不变；后续分镜依赖判断会引用旧版本。

## 2. P1：对白局部重生成的人工编辑保护

### 2.1 原始原因

原数据只有场景级 `manualEditedSceneIds / manualEditedAt`，没有模块级记录。`guardSceneScriptWrite()` 对 `module === "dialogue"` 不检查这些标记，导致：

1. 手工修改某场台词；
2. 点「只重生成对白」；
3. guard 认为只是对白模块，放行；
4. 模型结果通过 `mergeDialogueIntoScript()` 覆盖该场对白。

UI 只能提示，不能作为安全边界；直接调用 `runEpisodeScript()` 同样会绕过。

### 2.2 修改方式

**新增类型字段（兼容旧字段）：**

```ts
StudioScriptManualEditModule = "scene" | "dialogue" | "action" | "other";

StudioScriptDocument {
  // 旧字段保留，不清空、不改语义
  manualEditedSceneIds?: string[];
  manualEditedAt?: string;
  // 新增模块级记录
  manualEditedModules?: Record<string, StudioScriptManualEditModule[]>;
}
```

**纯函数层（`production-protection.ts`）：**

- `scriptManualEditModules()`：优先读模块记录；旧数据若只有 `manualEditedSceneIds`，按 `scene / dialogue / action / other` 全部展开，避免旧保护被降级。
- `ensureScriptManualModules()`：hydration 时幂等补模块记录；不修改场景内容，不把历史快照升级成正式版本。
- `scriptSceneEditModules()`：只比较场景字段差异，分别识别 `dialogue / action / other`；场景新增或 `sceneId` 变化记为 `scene`。
- `guardSceneScriptWrite()`：
  - `module === "scene"`：任意人工模块都要求确认；
  - `module === "dialogue"`：只检查 `dialogue`，所以只改动作不会误阻止对白；
  - `allowOverwriteManual !== true`：返回 `manual_edited` + `requiresConfirmation`；
  - 锁定剧本即使确认也拒绝。
- `markScriptManualEdit()`：按模块合并，保留已有模块。
- `clearScriptManualEditModules()`：只清除本次确认覆盖的模块；其他人工模块和其他场景保留。

**动作层（`production-actions.ts`）：**

`runEpisodeScript()` 的局部路径现在是：

```text
点击「只重生成对白」
  → runEpisodeScript({ sceneId, module: "dialogue" })
  → guardSceneScriptWrite(底层统一判定)
       ├─ 未编辑：放行
       └─ 有人工对白：requiresConfirmation = "dialogue_overwrite"
  → UI 弹出对白覆盖 Modal
       ├─ 取消：不调用模型，不写入
       └─ 确认：allowOverwriteManual = true
  → persistScriptBackup() + 回读确认
  → 调用模型
  → 校验返回 dialogueBlocks 非空、人物绑定、场景仍存在、版本未变化
  → mergeDialogueIntoScript()：只替换目标场对白
  → withNextScriptSceneVersions()：只推进目标场
  → clearScriptManualEditModules(document, sceneId, ["dialogue"])
  → 写入并更新该场相关分镜 stale
```

关键安全点：

- **先 guard，再备份，再模型**：guard 不通过时连模型都不会调用；备份失败时直接返回，不进入模型。
- **不先删除原对白**：模型结果校验通过后才 `mergeDialogueIntoScript()`；模型失败、截断、人物未绑定都抛错，旧对白留在原正式剧本中。
- **确认后只清目标模块**：`clearScriptManualEditModules(..., ["dialogue"])` 只清对白模块，动作 / 环境 / 人物绑定 / 其他场景保留。
- **人工标记不被普通生成自行清除**：只有确认覆盖后清理目标模块；整集生成仍保留 Stage 3.2 的显式覆盖与备份路径。

### 2.3 测试覆盖

`web/scripts/stage3_2_1-core-check.ts` 覆盖：

- 未编辑场景对白可正常生成（底层 guard 返回 `ok`）。
- 人工编辑对白默认返回 `manual_edited` + `requiresConfirmation`。
- 只改动作的场景不阻止「只重生成对白」；但会阻止整场重生成。
- 旧场景级标记迁移后模块为四项；迁移幂等；未迁移旧数据仍按整场保护。
- 确认后只清目标 `dialogue`；混合人工模块中 `action` 仍保护整场。
- `mergeDialogueIntoScript()` 后目标场版本 `2`、另一场仍 `1`；动作、人物、道具绑定、另一场内容全部保留。
- `markStoryboardStaleForScriptChange()` 只命中目标场 / 目标镜头，旧分镜仍为 2 镜。
- 直接调用底层 `guardSceneScriptWrite()` 无法绕过；`runEpisodeScript()` 的写回前还校验剧本锁定与 `scriptVersion`，避免并发生成期间被人工修改后仍写入。
- 旧 Stage 3.2 测试已按新语义调整：旧的「只重生成对白不需要确认」断言改为必须确认。

### 2.4 浏览器记录（隔离项目 E）

**浏览器截图记录**：`stage3_2_1-dialogue-protection.png`（998×667，对白人工保护 Modal）。

- 第 1 集人工修改第一场对白后，点击「只重生成对白」。
- 出现 Modal：`覆盖「雾港码头交钥」的人工对白？`。
- Modal 实际显示：
  - `保护原因：本场对白已被人工编辑`
  - `覆盖范围：只替换本场对白；动作、环境、人物绑定与其他场景保留`
  - `旧版处理：先保存剧本快照，再写入新结果`
  - `取消时不会调用模型，也不会修改正式剧本`
- 点击「取消」：正式剧本仍为 `v3`，台词文本不变，剧本快照仍为 2 条，`stale` 状态不变。
- **没有点击「确认只覆盖本场对白」**：本轮未登录、未调用真实模型、未消耗真实账号额度；确认后的模型输出未做浏览器验收。

## 3. P1：真正实现分镜「复制到新草稿」

### 3.1 原始原因

`planStoryboardSnapshotApply()` 的 `mode` 只用于生成正式快照的 `reason`；`applyStoryboardSnapshot()` 的写入分支不区分 `apply / copy`，统一把 `plan.restored` 写入 `storyboard`，并递增正式版本。于是「复制」和「应用」共用同一条正式写入路径。

### 3.2 数据结构

优先复用 `StudioProject / StudioEpisodeProduction`，新增独立草稿集合，不新建第二套项目根：

```ts
StudioStoryboardDraftStatus = "active" | "archived";

StudioStoryboardDraft {
  draftId: string;
  episodeId: string;
  sourceSnapshotId: string;
  sourceStoryboardVersion: number;
  draftVersion: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  storyboard: StudioStoryboardDocument;
  status: StudioStoryboardDraftStatus;
  appliedStoryboardVersion?: number;
  appliedAt?: string;
}

StudioEpisodeProduction {
  storyboardDrafts: StudioStoryboardDraft[];
}

StudioStoryboardDocument {
  appliedDraftId?: string;
}
```

旧项目 hydration 时 `storyboardDrafts` 缺省补空数组；旧草稿缺 `draftId` 时生成稳定 ID；最多保留 20 条；不自动把历史快照升级成正式版本。

### 3.3 复制行为

**`planStoryboardDraftFromSnapshot()`：**

- 读取目标快照，不读写正式 `storyboardVersion`；
- 同快照已有 `active` 草稿时复用原草稿并返回 `reused: true`；
- 否则生成 `draftId`（`sbd-` 前缀）、记录 `sourceSnapshotId / sourceStoryboardVersion = 快照 basedOnVersion`；
- `JSON.parse(JSON.stringify())` 深拷贝，草稿与快照 / 正式文档不共享可变引用；
- `status = active`，`draftVersion = 1`。

**`copyStoryboardSnapshotToDraft()`：**

- 只写 `storyboardDrafts`；
- 写后回读确认草稿存在，并且正式 `storyboard?.storyboardVersion` 与写前完全一致；
- 保存失败回滚写入前 `production`；正式分镜、正式版本号、原快照都不变。

**`planStoryboardSnapshotApply()`：**

- `mode: "copy"` 现在直接拒绝，错误为 `复制快照必须创建独立草稿，不能修改正式分镜`；旧的「假复制」路径被彻底关闭。
- UI 的「复制到新草稿」改走 `copyStoryboardSnapshotToDraft()`，不再调用正式应用 action。

### 3.4 草稿管理

`storyboard-tab.tsx` 增加：

- 「独立分镜草稿」列表，显示 `draftId / 来源快照 / 来源正式版本 / draftVersion / 组数 / 镜数 / 应用状态`；
- 草稿 Drawer：查看、编辑、保存、删除、应用；
- 删除确认明确写明「只删除草稿；正式分镜、正式版本号和历史快照都不会改变」；
- 旧来源版本应用前弹出冲突确认。

`production-actions.ts` 中：

- `saveStoryboardDraft()`：只改草稿内容与 `draftVersion`，保存后回读确认正式 `storyboardVersion` 未变；无实际变化返回 `unchanged`，不递增草稿版本。
- `deleteStoryboardDraft()`：只从 `storyboardDrafts` 移除，写后回读确认正式版本未变；失败回滚。
- `applyStoryboardDraft()`：
  - 校验当前正式版本等于 `expectedVersion`；
  - 校验草稿 `active`、非锁定分镜、无锁定镜头；
  - 草稿来源版本不等于当前正式版本时返回 `draft_conflict`，必须用户确认 `allowStaleDraft`；
  - 校验草稿结构（唯一 `shotId / shotGroupId / shotIds` 引用）；
  - 先备份当前正式版本，再生成 `current + 1` 正式版本；
  - 写 `appliedDraftId`，草稿保留 `active` 并记录 `appliedStoryboardVersion / appliedAt`；
  - 回读校验正式版本、备份快照、正式快照、草稿应用标记；失败回滚。

### 3.5 测试与浏览器记录

确定性测试覆盖：

- 复制快照后正式文档、正式版本、原快照不变；
- 草稿 ID 独立、来源字段正确、深拷贝（改草稿镜头动作不影响正式）；
- 同一快照重复复制复用草稿；
- 旧草稿缺 ID 时生成稳定 ID；旧项目缺集合补空；
- 草稿应用：备份当前 v18，正式升 v19，记录 `appliedDraftId`；
- 来源版本冲突先要求确认；确认后才允许；
- 当前版本变化、锁定镜头、重复 `shotId` 草稿全部拒绝；
- `planStoryboardSnapshotApply({ mode: "copy" })` 必须拒绝。

浏览器真实点击（隔离项目 E 的上一轮草稿验收状态；之后 E 被重置用于剧本测试，当前 IDB 中已无该草稿）：

**浏览器截图记录**：`stage3_2_1-draft-applied.png`（998×667，正式 v14 + 已应用草稿）。

- 历史快照 `sbs-legacy-oziex1` 基于正式 `v12`，当前正式为 `v13`。
- 点击「复制到新草稿」：正式仍为 `v13`，新建 `sbd-11io048`，4 组 / 8 镜。
- 同一快照再点一次：草稿数量仍是 1，复用原草稿，不重复创建。
- 修改草稿第一镜动作并保存：草稿 `draftVersion = 2`；正式 `v13` 与正式第一镜动作完全不变。
- 删除草稿：正式仍 `v13`；重新复制得到 `sbd-rxzelo`。
- 应用该草稿：因来源 `v12`、当前 `v13`，出现 `草稿基于旧正式版本，仍要应用？` Modal；取消后正式不变。
- 再次确认应用：正式升至 `v14`；新增：
  - `sbs-81gh4c` backup `v13`「应用草稿 sbd-rxzelo 前快照」
  - `sbs-14jlgre` formal `v14`「应用草稿 sbd-rxzelo 为新的正式版本」
- 正式 `appliedDraftId = sbd-rxzelo`；草稿保持 `active`，`appliedStoryboardVersion = 14`。
- 刷新后草稿、正式 `v14`、分镜与剧本版本均保留。
- 全程没有删除或改写原快照。

## 4. P2：统一正式剧本手工编辑版本管理

### 4.1 原始原因

`updateScriptManual()` 只合并 patch 并写人工标记；`saveScriptSceneEdit()` 与 `saveScriptMeta()` 各自实现备份 / 版本 / stale。结果：

- 正式内容变了，`scriptVersion` 可能没变；
- 没有修改前快照，无法回退；
- 没有局部 `stale`，分镜仍引用旧剧本版本。

### 4.2 唯一提交路径

`production-actions.ts` 新增内部 `commitScriptManualWrite()`，三个公开入口全部走它：

```text
saveScriptSceneEdit() ─┐
saveScriptMeta()       ├→ commitScriptManualWrite()
updateScriptManual()   ─┘
```

提交顺序：

```text
校验项目 / 分集 / 正式剧本
  → 校验剧本锁定与当前版本
  → 合并候选文档，恢复稳定身份字段
  → scriptContentChanged() 判断真实内容变化
       ├─ 无变化：返回 unchanged，不备份、不递增
       └─ 有变化：
            → persistScriptBackup() 写入修改前快照
            → 回读确认快照已持久化（失败：阻止写入）
            → 正式 scriptVersion + 1
            → withNextScriptSceneVersions() 只推进实际变化 / 顺序变化的场景
            → markScriptManualEdit() 按模块标记人工编辑
            → markStoryboardStaleForScriptChange() 只标记受影响场景及镜头
            → 写入 production
            → 回读校验版本、内容 hash、备份快照
                 ├─ 成功：syncLegacyEpisode()
                 └─ 失败：恢复写入前 production
```

`scriptContentChanged()` 在做内容比较时会忽略 `scriptVersion / status / sceneVersions / manualEdited* / restoredFromSnapshotId / createdAt / updatedAt`，所以“只改人工标记”“只改时间戳”不会无意义递增版本；标题、概要、场景内容、对白、动作、顺序变化才算真实变化。

### 4.3 局部版本与 stale

- `withNextScriptSceneVersions()` 按场景内容签名和顺序比较：
  - 只改第三场：整集 `scriptVersion` +1；第三场 `sceneVersions` +1；其他场不变。
  - 场景新增、删除或顺序交换也计为变化。
- `markStoryboardStaleForScriptChange()`：
  - 只把内容变化 / 顺序变化 / 缺失场景加入 `stale.sceneIds`；
  - 只把这些场景下的 `shotIds` 加入 `stale.shotIds`；
  - 旧分镜全部保留，不自动重生成；
  - 旧分镜 `sourceSceneVersions` 缺失时按保守 baseline 处理（见风险）。
- `saveScriptMeta()` 修改标题 / logline / synopsis 时属于文档级变化，会写 `manualEditedAt` 但不逐场展开；这会保守地让整集进入“有人工编辑”状态，具体语义见未验证项。

### 4.4 本轮自查发现并修复的备份重复

浏览器首次验收发现 `scriptVersions` 中同一个 `snapshotId` 出现两次：

- `persistScriptBackup()` 已经把新快照追加到 `scriptVersions`；
- `commitScriptManualWrite()` 又执行了 `[backup.snapshot, ...value.scriptVersions]`，造成重复。

已删除 `commitScriptManualWrite()` 中重复追加的那一行；重新保存后浏览器 IDB 中只出现 1 条备份。这个修复在首次浏览器验收之后完成，随后重跑了全部测试、`typecheck` 和 `build`。

### 4.5 测试与浏览器记录

确定性测试覆盖：

- 无实际内容变化不递增版本；
- 只改人工标记不递增；
- 标题 / 场景内容变化才允许递增；
- 单场修改只推进目标场；
- 单场修改只标记目标场镜头，旧分镜保留。

浏览器真实点击（E 重置后的状态）：

**浏览器截图记录**：`stage3_2_1-local-stale.png`（998×667，分镜页顶部局部 stale）。

- 只修改第三场动作：正式剧本 `v1 → v2`；只生成 `scs-it1jr2` 一条「手工修改单场前快照」；`sceneVersions` 仅 `scene-1ti9702 = 2`；stale 只命中 `scene-1ti9702` 及其 2 个镜头；分镜正式版本保持 `v13`，8 镜全部保留。
- 再修改第一场对白：正式剧本 `v2 → v3`；新增 `scs-xfuu5n` 一条「手工修改单场前快照」；`manualEditedModules = { scene-9ognjx: ["dialogue"], scene-1ti9702: ["action"] }`；stale 为 `scene-9ognjx + scene-1ti9702` 共 2 场 / 4 镜；第二、四场不受影响。
- 无变化保存：打开第一场编辑器直接保存，剧本仍为 `v3`，备份仍 2 条，`updatedAt` 未变，未无意义递增。
- 对白保护 Modal 取消后：上述 `v3`、2 条备份、台词、stale 均保持不变。
- 刷新浏览器后：`scriptVersion = 3`、2 条备份、`manualEditedModules`、`storyboardVersion = 13`、stale 2 场 / 4 镜、8 镜 / 4 组均保留。

E 的最终 IDB 读数：

```text
scriptVersion = 3
scriptVersions = [scs-xfuu5n(v2), scs-it1jr2(v1)]   // 各 1 条，无重复
sceneVersions = { scene-9ognjx: 2, scene-184qpf0: 1, scene-1ti9702: 2, scene-uq23vl: 1 }
manualEditedModules = { scene-9ognjx: ["dialogue"], scene-1ti9702: ["action"] }
storyboardVersion = 13
stale = { sceneIds: [scene-1ti9702, scene-9ognjx], shotIds: [shot-u1o8gw, shot-uvn1jt, shot-1yqjpid, shot-1xwkwfg], scriptVersion: 3 }
storyboardDrafts = []
```

## 5. 旧数据兼容

- `manualEditedSceneIds / manualEditedAt` 原样保留；旧数据没有 `manualEditedModules` 时，`scriptManualEditModules()` 把命中场景展开为四项，`ensureScriptManualModules()` 在 hydration 时幂等补字段。旧项目的保护不会因为新字段缺失而降级。
- 旧剧本快照的 `document` 同样在 hydration 时补场景版本和人工模块字段；只补字段，不提升为正式版本。
- `storyboardDrafts` 在旧 `StudioEpisodeProduction` 缺失时补 `[]`；旧快照的 `snapshotId / basedOnVersion / contentHash` 由现有 `normalizeStoryboardSnapshots()` 补全，不重新生成正式版本。
- `StudioProject` 没有新增第二套项目根；旧 V2 项目仍走既有 normalization。**旧 V2 项目、原始 live 项目 A/B 本轮未在浏览器中重新打开；兼容性只由 hydration 纯函数、旧 Stage 3.1 回归和现有代码路径覆盖。**
- 历史快照不会自动升级成正式版本；旧草稿只补稳定 ID / 默认状态，不改变正式 `storyboardVersion`。

## 6. 测试命令与真实输出

工作目录：`C:\Users\qq308\Desktop\lihuo\web`

### 6.1 Stage 3.2.1 确定性测试

```powershell
npx --yes tsx scripts/stage3_2_1-core-check.ts
```

```json
{"ok":true,"tests":"stage3_2_1-core-check","manual":{"legacyModules":["scene","dialogue","action","other"],"dialogueBlocks":"manual_edited","actionDoesNotBlockDialogue":true,"sceneStillBlocks":false},"dialogueMerge":{"sceneVersions":{"scene-a":2,"scene-b":1},"stale":["shot-a"],"shotsKept":2},"draft":{"id":"sbd-4e81m2","reused":true,"sourceVersion":18,"formalVersion":19,"conflict":true,"staleConfirmed":true}}
```

### 6.2 Stage 3.2 回归

```powershell
npx --yes tsx scripts/stage3_2-core-check.ts
```

```json
{"ok":true,"tests":"stage3_2-core-check","scriptProtection":{"queue":1,"skips":5},"sceneVersions":{"changed":{"scene-a":2,"scene-b":1},"swapped":{"scene-b":2,"scene-a":2}},"stale":{"sceneIds":["scene-a"],"shotIds":["shot-a"],"oldShotsKept":2},"snapshots":{"formal":19,"conflict":18,"normalized":["conflict","formal"]},"apply":{"newVersion":20,"backupVersion":19},"scriptRestore":{"newVersion":4,"backupVersion":3}}
```

### 6.3 Stage 3 回归

```powershell
npx --yes tsx scripts/stage3-core-check.ts
```

```json
{"ok":true,"tests":"stage3-core-check","fixture":{"projectId":"proj-UORILWcK","snapshotId":"handoff-14rfeou","openChecks":8},"admission":{"episode1Formal":true,"episode2Formal":false},"script":{"scenes":2,"characters":3,"props":2,"durationSeconds":39.4},"storyboard":{"groups":1,"shots":2},"checks":{"scriptError":0,"storyboardError":0},"persistence":{"status":["interrupted","unknown"],"remoteState":["unknown","unknown"],"activeJobId":null}}
```

### 6.4 Stage 3.1 回归

```powershell
npx --yes tsx scripts/stage3_1-core-check.ts
```

```json
{"ok":true,"tests":"stage3_1-core-check","hydration":{"queued":"interrupted/not_submitted","submitting":"interrupted/unknown","unknown":"unknown","succeeded":"completed","legacyFailed":"failed/unknown"},"selection":{"resumable":1,"retryable":1,"review":6},"lock":{"episodeBlocksScene":true,"episodeBlocksShot":true,"sceneBlocksScene":true,"sceneBlocksShot":true,"differentEpisodePasses":true},"frozenModel":{"old":"对话","next":"gpt-5.5"},"storyboard":{"version":6,"lockedShotKept":true,"shots":2}}
```

### 6.5 类型检查与生产构建

```powershell
npm run typecheck
npm run build
```

实际结果：

```text
typecheck_exit=0
build_exit=0
✓ 8298 modules transformed.
✓ built in 2m 57s
```

构建只有既有的 chunk 体积 warning 和动态 / 静态混合导入 warning，没有新增错误。

### 6.6 Diff 校验

```text
git apply --check（Stage 3.2 基线临时工作树）：exit 0
git apply --check --reverse（当前文件）：exit 0
```

`DRAMA_STUDIO_STAGE3_2_1.diff` 只包含本节列出的 12 个源码 / 测试文件，不包含仓库中既有的其他用户改动。生成时排除了行尾噪声，使用 LF 输出。

## 7. 浏览器验收汇总

### 7.1 环境

- 隔离项目 E：`proj-stage321-protection`，标题「Stage 3.2.1 隔离项目 E」。
- 第 1 集：`ep-GHduqaBp`「雾钟授钥」；第 2 集 `ep-tNU6q0U_`、第 3 集 `ep-AFT0ST-h`。
- E 由项目 A 导出快照克隆：`C:\Users\qq308\Downloads\阶段2A验收·雾港夜航(4).json`；项目 A `proj-UORILWcK` 只读，未被修改。
- 浏览器路由：
  - `http://localhost:3000/drama?project=proj-stage321-protection&step=script&view=script&episode=ep-GHduqaBp`
  - `http://localhost:3000/drama?project=proj-stage321-protection&step=script&view=storyboard&episode=ep-GHduqaBp`
- IndexedDB：`lihuo / app_state / lihuo:studio_store`。
- 临时夹具 `web/public/stage321-fixture.json` 只在隔离测试中使用，交付前已删除。
- 未关闭用户已打开的浏览器窗口或标签页；验收使用 BU 标签页。
- BU 抽屉动画在当前环境会停在 `translateX(720px)`，验收时只临时设置抽屉 wrapper 的 inline transform 以继续点击；未改业务代码。

### 7.2 剧本保护 / 局部 stale

- 人工修改第一场对白 → `v2 → v3`；对白保护 Modal 触发；取消后正式剧本、台词、备份、stale 不变。
- 修改第三场动作 → 目标场版本 `2`、其他场 `1`；stale 只命中目标场 2 镜；分镜 `v13` 未变。
- 无变化保存 → 不递增版本、不新增备份、`updatedAt` 不变。
- 刷新 → 版本、备份、模块标记、stale 全保留。
- **未执行**：确认覆盖并调用真实模型。

### 7.3 独立草稿

- 复制快照 → 正式 `v13` 不变，草稿独立创建；重复复制复用；编辑 / 删除草稿正式不变；应用草稿需冲突确认；确认后正式 `v14` + 备份 + 正式快照；刷新保留。
- 该轮草稿数据后因隔离项目 E 重置用于剧本测试而不在当前 IDB 中；截图和上述 IDB 读数保留作为证据。

## 8. 尚未验证

1. 点击「确认只覆盖本场对白」后的真实模型调用；模型截断 / 空对白 / 未绑定人物的输出校验是否在真实请求中按预期阻止写入。
2. 备份持久化失败（存储不可用）与写入回读失败的浏览器 UI 路径。
3. `saveScriptMeta()` 产生的文档级人工标记语义：当前会把整集视为有人工编辑，是否需要在后续拆成更细的文档级模块，仍未验收。
4. `updateScriptManual()` 当前没有实际调用方；已统一接入新提交路径，但真实 UI 路径未被调用。
5. 旧 V2 项目、原始 live 项目 A/B、跨标签页并发写入、无限画布回归。
6. Stage 3.2 的整集队列 / 显式覆盖 UI 本轮没有重新点击；仅通过 Stage 3.2 回归测试与既有验收记录确认未被删除。
7. 窄屏 / 移动端草稿 Drawer 布局。

## 9. 已知风险

- **旧草稿应用后的 stale 范围保守扩大**：旧快照没有 `sourceSceneVersions` 时，`planStoryboardDraftApply()` 会把来源场景版本补为 0；应用这种旧来源草稿后再修改一个场景，可能一次命中多个场景。这个扩大来自“来源场景版本未知”的保守 baseline，不是单场写入逻辑。重置 E 后直接单改第三场，stale 精确为 1 场 / 2 镜。后续可增加草稿来源场景版本记录或迁移策略。
- **文档级人工标记偏保守**：`saveScriptMeta()` 只改标题 / logline / synopsis 时写 `manualEditedAt`，会让整集进入人工编辑状态，可能阻止整集生成；这是安全优先的保守行为，但尚未做真实 UI 验收。
- **真实模型确认路径未验收**：所有“确认后只改目标对白”的结论来自纯函数和代码顺序，不能当作真实模型验收。
- **异常注入未做**：备份失败、回读失败只由代码返回路径保证；没有制造真实存储故障。
- **既有 20 条历史上限**：脚本 / 分镜快照沿用 Stage 3.2 的 `.slice(0, 20)`，本轮没有改动；极端频繁修改可能挤掉更早的备份，这是既有行为，不是本轮新增。

## 10. Stage 3.2 原有功能回归结果

`stage3_2-core-check.ts` 通过，覆盖：

- 全剧剧本队列固定 `skip_existing`：`queue 1 / skips 5`。
- 场景版本：单场变化只推进目标场；场景顺序交换时两场均推进。
- stale：只命中 `scene-a / shot-a`，旧 2 镜保留。
- 快照身份：正式 `19`、冲突 `18`、`normalized: ["conflict","formal"]`；冲突快照不占正式版本。
- 快照应用：`newVersion 20 / backupVersion 19`。
- 剧本恢复：`newVersion 4 / backupVersion 3`。

代码层面没有删除这些功能：

- 全剧跳过、已有剧本显式覆盖确认、覆盖前备份、备份失败门禁保留；
- `snapshotId / basedOnVersion / snapshotType / conflictWithSnapshotId` 保留；
- 冲突快照身份隔离、旧快照补稳定 ID 保留；
- 剧本 → 分镜局部 stale、旧分镜保留保留；
- 本轮新增的 `mode: "copy"` 拒绝只关闭错误入口，UI 已改到独立草稿 action。

未重跑项：Stage 3.2 浏览器里的整集队列、显式覆盖确认、冲突快照比较；这些不是本轮修改点，仍以既有 Stage 3.2 验收记录为准，不能把本轮确定性回归写成浏览器全量通过。

## 11. 修改文件

| 文件 | 作用 |
| --- | --- |
| `web/src/types/studio-production.ts` | 新增模块级人工编辑类型、`manualEditedModules`、`StudioStoryboardDraft`、`storyboardDrafts`、`appliedDraftId` |
| `web/src/lib/studio/production-protection.ts` | 模块级 guard、旧标记迁移、内容变化判定、场景版本 / stale 纯函数 |
| `web/src/lib/studio/storyboard-snapshots.ts` | 草稿规范化、从快照创建草稿、草稿结构校验、草稿应用计划、copy 模式拒绝 |
| `web/src/lib/studio/production-actions.ts` | 草稿 CRUD / 应用、剧本统一提交、备份回读、失败回滚 |
| `web/src/lib/studio/production-workspace.ts` | hydration 补模块记录、草稿集合与稳定 ID |
| `web/src/lib/studio/production-engine.ts` | `productionFromProject` 补 `storyboardDrafts` |
| `web/src/stores/use-studio-store.ts` | episode production 默认补 `storyboardDrafts` |
| `web/src/pages/drama/studio/production/script-tab.tsx` | 对白覆盖确认 Modal、保存提示 |
| `web/src/pages/drama/studio/production/storyboard-tab.tsx` | 草稿列表 / Drawer / 冲突确认 / 复制入口 |
| `web/src/pages/drama/studio.css` | 草稿列表与镜头样式 |
| `web/scripts/stage3_2-core-check.ts` | 旧测试按模块级保护调整 |
| `web/scripts/stage3_2_1-core-check.ts` | 新增 Stage 3.2.1 确定性测试 |

`DRAMA_STUDIO_STAGE3_2_1.diff`：12 个文件，1,022 insertions / 86 deletions，100,175 bytes。文档侧的 `CHANGELOG.md`、`pending-test.mdx`、`todo.mdx` 已同步更新，不在本 Diff 中。

## 12. 停止条件

- 本轮只完成 Stage 3.2.1 的三个定点修复。
- 未进入 Stage 4。
- 未开发图片 / 视频生成。
- 未修改五步导航、全局任务系统、无限画布核心、正式外部后端、Doubao Bridge、全局 `AiConfig`。
- 未执行 `git reset / checkout / stash / clean`，未删除用户原有文件，未覆盖用户既有修改。
- 未执行 `git add / commit / push`。
- 等待用户审查本报告和完整 Diff；真实模型确认、异常注入、旧 V2 与 live 项目 A/B 验收待用户决定后再做。
