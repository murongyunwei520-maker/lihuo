# Lihuo AI 短剧工作室 · 阶段 2A 交付与验收说明

> 范围：第一步「AI 小说分析」的真实原著工作区：TXT / DOCX / PDF / 粘贴导入、章节识别与分块、原著结构化解析、证据追溯、人工修正保护、持久化分析任务。
> 本阶段不包含：阶段 2B 的短剧化改编、分集剧本、角色图 / 场景图 / 分镜图、视频生成。
> 结论：阶段 2A 已实现并通过类型检查、生产构建、核心自动化检查、真实 Bridge 文本模型和浏览器验收；停在第一步，等待用户确认，不自动进入 2B，不自动提交或推送。
> 验收修复：初审发现的证据有效性、项目账号隔离、分块重叠与 PDF 空白页页码问题已在本轮修复，详见 `docs/ai-handover/DRAMA_STUDIO_STAGE2A_FIX.md`；主体仍等待用户最终验收。

## 一、最终状态

| 项 | 结果 |
| --- | --- |
| 分支 / HEAD | `main` / `27b67bd09a8aead582868e139c585b7ba4b03b0e` |
| 工作区 | 仍保留用户原有全部未提交改动；阶段 2A 未执行 `git add`、commit、push 或回滚 |
| 阶段基线 | `...\.sessions\38454513883379714\agents\m_0cwediOGgIg\stage2a-baseline` |
| 净增量 diff | `docs/ai-handover/DRAMA_STUDIO_STAGE2A.diff`（31 个文件段，+5,350 / -130） |
| 阶段 2A 新代码 | 15 个新源码 / 脚本文件，约 3,581 行 |
| 类型检查 | `npm run typecheck`：通过 |
| 生产构建 | `npm run build`：通过；仅有既有 chunk 体积与动态/静态导入提示 |
| 核心自动化 | `npx tsx scripts/stage2a-core-check.ts`：通过 |
| 真实模型调用 | 11 次成功，仍在用户限定的 12 次以内；验收完成后未再调用模型 |
| 阶段 2B | 未开始 |

## 二、验收样本与真实模型结果

验收项目：

- 项目 A：`阶段2A验收·雾港夜航`，ID `proj-UORILWcK`，原文 `雾港夜航.txt`，UTF-8，3.7 KB，6 章，1,281 字，解析器 `stage2a-1`。
- 项目 B：`阶段2A隔离验收·粘贴样本`，ID `proj-iNU-UIPW`，粘贴 3 章，87 字，用于项目隔离。
- 项目模型：`builtin-doubao::对话`（UI 显示「对话（豆包）」），项目级桥接账号 `db-mvxvft3x-a9tky`（豆包1）。
- Bridge：`http://127.0.0.1:9091`，3 个账号，真实任务由本地 `doubao-bridge` 执行。

项目 A 最终分析（v3）：

| 指标 | 结果 |
| --- | --- |
| 状态 | 分析完成 |
| 覆盖 | 6/6 章有分析覆盖 |
| 档案 | 4 人物、4 关系、8 世界观、3 地点、6 事件、2 伏笔 |
| 证据 | 70 条显式证据；显式 70 / 推断 0 / AI 生成 0 |
| 人工修正 | 1 处（林舟身份） |
| 任务 | 1 个分块、3 次调用、版本 v3 |
| 跨章审校 | 3 条提示，列出证据矛盾、因果时序与规则无法判定点 |

真实调用记录：

| 调用 | Bridge 任务 | 结果 |
| --- | --- | --- |
| 最小对话自检 | `job-mwrcybbd-2o9u` | 成功返回「正常」 |
| v1 章节提取 / 全局汇总 / 跨章校验 | `job-mwrd0tqe-cc3o` / `job-mwrd3e4s-bcp6` / `job-mwrd40k8-e30r` | 成功 |
| v2 章节提取 / 全局汇总 / 跨章校验 | `job-mwrd84s1-wcok` / `job-mwrdafbv-5mrb` / `job-mwrdb4tz-a1tj` | 成功 |
| 中断测试遗留的单块请求 | `job-mwrddyli-5mll` | 成功但页面已中断，不再写回 |
| v3 重试章节提取 / 全局汇总 / 跨章校验 | `job-mwrdf5cy-02wg` / `job-mwrdhgpo-cubk` / `job-mwrdi7e7-niib` | 成功，写入 v3 |

说明：真实模型每次输出并非完全稳定，v1/v2/v3 的实体数量与证据数有波动；确定性校验只保证结构、引用和逐字证据，不等于自动判断内容绝对正确。最终 v3 仍保留 3 条审校提示供人工判断。

## 三、数据模型

新增 `web/src/types/novel.ts`，并在 `StudioProject` 中增量保存：

```ts
novel?: StudioNovel;
novelAnalysis?: NovelAnalysis;
novelAnalysisOverrides: NovelAnalysisOverrides;
analysisRuns: NovelAnalysisRun[];
analysisRunId?: string;
```

### 1. 原文与章节

- `StudioNovel`：只保存一份原文；包含文件信息、格式、编码、解析器版本、前言、章节、字数、章节数、警告和错误。
- `NovelChapter`：`id / no / title / text / charStart / charEnd / pageStart / pageEnd / paragraphStart / paragraphEnd / detectedBy`。
- 章节 ID 稳定，不依赖数组下标；正文中的「第一章」不会被标题规则误判。

### 2. 证据

```ts
type NovelEvidence = {
  chapterId: string;
  chapterTitle: string;
  excerpt: string;
  sourceLocation: { page?, pageEnd?, paragraph?, paragraphEnd?, charStart?, charEnd?, label? };
  confidence: number;
  evidenceType: "explicit" | "inferred" | "generated";
};
```

- 证据不复制整章，只保存章节引用、原文短摘录和定位。
- 证据摘录必须能在对应章节原文中逐字找到；找不到时丢弃或降级，不伪造命中。
- 完整度按实际有证据覆盖的章节计算，不按「发起过多少调用」计算。

### 3. 档案

- `NovelCharacter`：身份、年龄、性格、外貌、能力、职业、状态、动机、成长轨迹、首次 / 重要章节、结局。
- `NovelRelationship`：两端人物 ID、类型、当前状态、变化、重要章节和证据；无证据关系在归一化阶段丢弃。
- `NovelWorldEntry`：规则 / 力量 / 社会 / 组织 / 地理 / 物品 / 能力 / 历史 / 约束。
- `NovelScene`：地点身份与 `variants`（昼夜、天气、完好 / 损毁等）分开；`stateChanges` 记录变化章节。
- `NovelEvent`：章节、参与者、地点、前条件、结果、影响、因果标题与最终事件 ID、伏笔引用。
- `NovelForeshadowing`：首次章节、关联人物 / 事件、预计回收章节、实际回收章节、状态、证据。

### 4. 人工修正

`NovelAnalysisOverrides` 独立于 `NovelAnalysis`：

```ts
{
  version: 1;
  updatedAt: string;
  profile?: Partial<NovelProfile>;
  characters: Record<string, Partial<NovelCharacter>>;
  relationships: Record<string, Partial<NovelRelationship>>;
  world?: Partial<NovelWorld>;
  scenes: Record<string, Partial<NovelScene>>;
  events: Record<string, Partial<NovelEvent>>;
  foreshadowings: Record<string, Partial<NovelForeshadowing>>;
}
```

- 重新分析只替换 AI 结果，不删除 overrides。
- 展示与后续阶段统一通过 `applyNovelAnalysisOverrides()` 合并，UI 显示「人工修正」标签，并支持「恢复 AI 原值」。
- 联调已验证：林舟身份改为「雾港引航员、夜航原引航员（人工校对）」，刷新页面仍在；随后重新分析生成 v3，覆盖项仍为 1 处人工修正，身份未被覆盖。

## 四、导入与章节 / 分块

### 1. 导入入口

`web/src/lib/studio/novel-import.ts`：

- TXT：识别 UTF-8、UTF-16、GB18030、Big5；真实 GB18030 样本可正确解码。
- DOCX：懒加载 `mammoth`，校验 ZIP 魔数；损坏文件给出中文错误。
- PDF：懒加载 `pdfjs-dist` 与动态 worker；逐页进度；扫描 PDF 无可提取文本时明确失败；密码 PDF 明确失败。
- 粘贴：正文直接进入同一份 `StudioNovel`，与文件导入共用后续流程。
- 限制：单文件上限 `NOVEL_IMPORT_MAX_BYTES = 20 * 1024 * 1024`。
- 失败策略：保留失败文件信息但不覆盖已有原文；旧原文只由用户明确替换或删除。

浏览器实测覆盖：

- 通过：TXT、DOCX、PDF、GB18030 TXT、粘贴正文。
- 明确失败：空文件、损坏 PDF、损坏 DOCX、21 MB 超限文件。
- 进程内未改动用户原文，未发现静默覆盖。

### 2. 章节与分块

`web/src/lib/studio/novel-chapters.ts`：

- 识别常见中文章节标题；无标题时降级为单章并给出提示。
- 稳定章节 ID；保留章节标题前内容（书名 / 作者等）为 `preamble`。
- PDF 页范围映射到章节，见「已知边界」。
- 超长章节按段落拆分；`NOVEL_CHUNK_CHAR_LIMIT = 8000`；分块 ID 稳定，可重跑。
- 分块总调用数超过 `NOVEL_ANALYSIS_WARNING_CHUNKS = 24` 时给出成本提示。

## 五、分析链路

```text
导入 / 粘贴
  → StudioNovel
  → 章节识别
  → 8,000 字分块
  → NovelAnalysisRunner
      → 每块：严格 JSON 章节提取
      → normalizeChapterExtract：字段归一化 + 证据校验
      → 持久化成功分块
  → mergeChapterDigests：跨块合并、去重、因果 ID 解析
  → buildCompactDigest：按人物 / 关系 / 世界观 / 地点 / 事件 / 伏笔分区配额压缩
  → 全局汇总
  → 跨章一致性校验
  → finalizeNovelAnalysis：档案、统计、完整度、审校提示
  → NovelAnalysis（AI 结果）
  → applyNovelAnalysisOverrides（展示 / 后续阶段）
```

### 1. 模型调用

`web/src/lib/studio/novel-model.ts`：

- 只使用项目级 `modelProfiles` 的文本模型，不回退全局 `AiConfig`。
- 项目级 Bridge 账号通过局部 `config.doubaoAccountId` 注入，不改全局号池。
- 参数按模型注册表声明展示；`accountId` 不算模型参数，不触发「无效参数」警告。
- 分析请求复用 `requestImageQuestion` → `requestText`；阶段 2A 为文本请求补了 `temperature / maxTokens` 透传。

### 2. 章节提取与严格校验

`web/src/lib/studio/novel-analysis.ts`：

- 要求模型只返回 JSON；去除 Markdown 围栏后解析，非法 JSON 明确失败。
- 每条人物、关系、世界观、地点、事件、伏笔都要求 `evidence`。
- 证据必须属于当前分块允许的章节，并能在章节原文中逐字找到。
- `explicit / inferred / generated` 保留模型标记；AI 猜测的预计回收章节统一降级为 `inferred`。
- 无证据关系直接丢弃；无证据人物等仍保留为空证据条目，供人工核对。
- 章节内因果只保留标题线索，不编造跨块事件 ID；跨块引用由合并阶段解析。

### 3. 跨块合并与跨章校验

`web/src/lib/studio/novel-merge.ts`：

- 同名人物、同一关系、同一世界观条目、同一地点、同一事件、同一伏笔确定性合并。
- 人物首次出场取更早章节；关系变化和人物首次出场做时序检查。
- 事件因果标题解析为稳定事件 ID；解析不到时给警告，不硬连。
- 全局汇总压缩先保证每个分区至少有一条，再按配额补足，避免旧实现直接截断导致后半本书事件 / 伏笔丢失。
- 地点首次出场除了自身证据，还参考同一 `locationId` 的最早事件；事件证据本身完整，能修正模型漏写地点证据导致的首章回退。
- 跨章审校检查：地点首章与事件位置、物品流转、伏笔回收时序、关系变化早于人物出场、因果链未解析等。

### 4. 地点证据归一化修复

真实模型常把地点证据只写在 `variants[].evidence`，而 `normalizeScene` 原先只读顶层 `evidence`，导致：

- 地点卡显示「0 条证据」；
- 首次出场回退到分块首章。

修复：

- 顶层证据 + 所有变体证据按 `chapterId + excerpt` 去重、按章节顺序排序后回填 `scene.evidence`；
- `firstChapterId` 从聚合证据和同地点最早事件取真正最早；
- 只有聚合后仍为空才警告。

真实结果验证：

- 雾港码头：首次出现第 1 章；
- 旧钟楼：首次出现第 2 章，虽然地点自身证据最新是第 4 章，但第 2 章事件已使用该地点；
- 旧航道海面：首次出现第 6 章，保留真实证据，不把第 3 / 4 章的规则提及误当成地点出场。

该修复后，v3 的「地点首章与事件矛盾」审校提示已消失。

## 六、分析任务与恢复

`web/src/lib/studio/novel-analysis-runner.ts` + `use-studio-store.ts`：

九态：

```text
pending | queued | submitting | running | succeeded
failed | cancelling | cancelled | interrupted | unknown
```

- 每块执行后持久化成功结果；失败块保留其他成功块，不做全量清空。
- 取消是浏览器侧 AbortController；取消后保留已完成分块，可从失败 / 未完成块重试。
- 刷新时 `rehydrate` 把仍处于活跃状态的任务标为 `interrupted`，保留分块，不自动重新提交。
- UI 明确说明：刷新只能中断浏览器等待，服务端是否停止计费取决于模型接口；本阶段未实现服务端取消。
- 同一页面防止重复提交；多标签页仍可能把一个标签页的本地活跃任务误标为 `interrupted`，见已知边界。

浏览器实测：

1. 分析进行中强制让 `fetch` 挂起（不产生真实模型调用），刷新页面。
2. 页面进入「已暂停」，任务卡显示「已中断」，提示「页面刷新或关闭后分析任务中断；请先确认当前结果，再手动继续或重试」。
3. 点击「继续 / 重试失败分块」，完成 v3；结果写入当前项目，旧 AI 结果不覆盖人工修正。
4. 验证时有一次挂起请求实际已到 Bridge，成为孤立成功任务 `job-mwrddyli-5mll`；页面已断，未写回结果。这暴露了「刷新只中断浏览器」的真实边界。

## 七、第一步 UI

`web/src/pages/drama/studio/analysis-workspace.tsx` 提供 9 个页签：

1. 小说原文：原文就绪、替换 / 删除、章节导航、全书搜索。
2. 档案总览：标题、类型、世界观类型、主线、核心矛盾、主要地点、完整度、证据分布。
3. 人物档案：人物卡 + 详情抽屉 + 人工修正 + 证据。
4. 人物关系：关系表，显示类型、当前状态、关键变化、证据、来源。
5. 世界观：规则 / 力量 / 社会 / 组织 / 地理 / 物品 / 能力 / 历史 / 约束。
6. 地点场景：地点身份、变体、状态变化、首章、剧情用途、证据。
7. 事件与因果：事件章节、参与者、地点、前条件、结果、影响、因果链接。
8. 伏笔与悬念：埋设、回收、状态、关联人物 / 事件、证据。
9. 分析任务：任务状态、分块、调用数、版本、取消 / 重试、历史、审校提示、参数说明。

人工修正 Modal 与 AI 结果分开：编辑只写 `novelAnalysisOverrides`，不修改 `novelAnalysis`。已验证人物身份修正刷新与重新分析后均保留。

## 八、自动化与浏览器验收

### 1. 自动化

`web/scripts/stage2a-core-check.ts` 覆盖：

- 3 章样本识别；章节标题前内容；
- 无标题降级与空正文报错；
- 长章节多分块、8,000 字边界、分块 ID 稳定；
- 证据逐字校验；无证据关系丢弃；无证据人物保留；
- 人物首次出场取更早章节、状态合并；
- 变体地点证据聚合、地点首章按事件校正（新增断言）；
- 因果标题解析为事件 ID；
- 分区压缩保留全部分区、严格预算、超长截断说明；
- 完整度按证据覆盖章节计算；
- 人工 override 合并且不修改原始 AI 对象。

最近结果：

```json
{
  "ok": true,
  "chapters": 3,
  "chunks": 2,
  "maxChunkChars": 8029,
  "characters": 2,
  "relationships": 1,
  "events": 2,
  "foreshadowings": 1,
  "evidence": {"chapters": 3, "chunks": 2, "calls": 2, "evidenceCount": 13, "explicitCount": 10, "inferredCount": 3, "generatedCount": 0},
  "warnings": 0
}
```

### 2. 构建

- `npm run typecheck`：通过（最近源码改动后重跑）。
- `npm run build`：通过，Vite 7.3.6；PDF worker / pdfjs chunk 正常产出；仅有既有 chunk 体积警告和动态/静态导入提示。

### 3. 浏览器

四格式导入与异常文件、项目隔离、真实分析、人工修正刷新、重新分析保护、中断与重试均已验证。截图：

- `stage2a-analysis-v3.png`：项目 A 第一步完成态与五步导航。
- `stage2a-task-stats.png`：v3、70 条证据、1 处人工修正、6 章 / 1 分块、完整度。
- `stage2a-crosscheck.png`：3 条跨章审校提示与证据分布。
- `stage2a-character-evidence.png`：林舟人工修正、身份字段与 3 条逐字证据。
- `stage2a-scene-evidence.png`：旧钟楼首次出现第 2 章、地点变体与证据。
- `stage2a-task-v3.png`：任务完成状态与五步导航。

## 九、文件清单

### 1. 新增

| 文件 | 作用 |
| --- | --- |
| `web/src/types/novel.ts` | 原文、证据、档案、人工修正、分析任务类型 |
| `web/src/lib/studio/novel-import.ts` | 四格式导入与失败校验 |
| `web/src/lib/studio/novel-chapters.ts` | 章节识别、分块、稳定 ID、PDF 页范围 |
| `web/src/lib/studio/novel-analysis.ts` | 章节 / 全局 / 审校提示、JSON 归一化、证据校验 |
| `web/src/lib/studio/novel-merge.ts` | 跨块合并、因果解析、地点首章、跨章校验、完整度 |
| `web/src/lib/studio/novel-analysis-runner.ts` | 九态分析任务、取消、重试、分块持久化 |
| `web/src/lib/studio/novel-model.ts` | 项目文本模型 runtime、参数、请求 |
| `web/src/pages/drama/studio/analysis/novel-import-panel.tsx` | 导入 UI |
| `web/src/pages/drama/studio/analysis/novel-reader.tsx` | 原文阅读、章节导航、全书搜索 |
| `web/src/pages/drama/studio/analysis/novel-run-panel.tsx` | 任务进度、取消、重试、历史 |
| `web/src/pages/drama/studio/analysis/analysis-results.tsx` | 总览与六类档案 |
| `web/src/pages/drama/studio/analysis/analysis-editors.tsx` | 通用人工修正 Modal |
| `web/src/pages/drama/studio/analysis/analysis-evidence.tsx` | 证据 / 警告 / 修正标签 |
| `web/scripts/stage2a-core-check.ts` | 核心自动化检查 |
| `web/scripts/stage2a-gen-fixtures.py` | 样本生成脚本 |

### 2. 修改

| 文件 | 变更 |
| --- | --- |
| `web/src/types/studio.ts` | 增加 `novel` / `novelAnalysis` / `novelAnalysisOverrides` / `analysisRuns` / `analysisRunId` |
| `web/src/lib/studio/factory.ts` | 旧项目归一化补新字段 |
| `web/src/stores/use-studio-store.ts` | 小说、分析、人工修正、任务动作；刷新标中断 |
| `web/src/lib/studio/model-profile.ts` | 项目模型配置与 Bridge 账号参数辅助 |
| `web/src/pages/drama/studio/project-settings.tsx` | 内置豆包 / Dola 项目级账号下拉 |
| `web/src/pages/drama/studio/analysis-workspace.tsx` | 第一步真实工作区与 9 页签 |
| `web/src/pages/drama/studio.css` | 第一步样式 |
| `web/package.json` / `web/package-lock.json` | `mammoth ^1.13.0`、`pdfjs-dist ^6.5.438` |
| `web/src/services/api/image.ts` | 文本请求补 `temperature / maxTokens` 透传（该文件还包含本阶段前已有的未提交改动，见 diff 说明） |
| `web/src/pages/drama/index.tsx` | 阶段文案由「阶段 1」改为「阶段 2A 只调用本项目选定文本模型」 |
| `CHANGELOG.md` | 增加阶段 2A 新增与修复记录 |
| `docs/content/docs/progress/todo.mdx` | 2A 完成；2B 标记为待批准 |
| `docs/content/docs/progress/pending-test.mdx` | 增加阶段 2A 验收清单 |
| `docs/ai-handover/ARCHITECTURE.md` | 增加 2A 数据流和边界 |
| `docs/ai-handover/ENTRY_POINTS.md` | 增加 2A 文件入口 |
| `web/scripts/fixtures/*` | TXT / GB18030 / DOCX / PDF / 空 / 损坏 / 超大样本 |

### 3. 依赖修复

生产构建时补装缺失的 Windows 可选二进制包，未删除用户 `node_modules` 或 `package-lock.json`：

- `@rollup/rollup-win32-x64-msvc@4.62.2`
- `@esbuild/win32-x64@0.28.1`
- `@tailwindcss/oxide-win32-x64-msvc@4.2.4`
- `lightningcss-win32-x64-msvc@1.32.0`

## 十、已知边界与风险

1. PDF 页范围是 trim 后文本长度近似映射，不是精确 PDF 字符偏移；证据逐字校验仍按章节文本。
2. 全局 digest 仍有 12,000 / 18,000 字压缩上限；超长小说会按分区配额截断并在压缩档案中说明，可能丢失细节。
3. 真实模型非法 JSON 只明确报错，不自动重试；避免在未知返回上重复计费。
4. 刷新只中断浏览器等待，无法证明 Bridge / 上游已停止计费；本阶段没有服务端取消。
5. 多标签页共享同一 IndexedDB 时，rehydrate 可能把另一个标签页的活跃本地任务标为 `interrupted`；单人单页正常。
6. 地点首章的事件校正依赖 `event.locationId` 与地点 ID 已解析；模型完全没输出地点事件时仍以地点证据为准。
7. 模型内容存在波动，跨章审校提示不等于自动修复；人工修正只覆盖当前 AI 结果，不改变原著原文。
8. 本阶段尚未做服务端任务化 / 云端持久化；任务与档案仍在浏览器本地 `lihuo:studio_store`，文档与 UI 均未声明云同步。
9. 真实调用已用 11/12，本报告生成后未再调用；不要为了截图或复验再自动触发真实分析。

## 十一、阶段 2B 建议（未执行）

- 以已审核的 `NovelAnalysis + NovelAnalysisOverrides` 作为唯一原著 canon；2B 的改编、分集、剧本和资产引用都带 `chapterId + evidence`，不要复制整章。
- 在 2B 开始前先冻结「原著档案版本」或建立显式快照，避免再次分析把分集 / 剧本依据悄悄换掉。
- 先做全剧分集规划与改编差异表，再生成分集剧本；任何新增人物、合并人物、改写关键事件都要标为改编决策，不冒充原著事实。
- 2B 的编辑应继续使用独立 overrides / 改编层，不直接覆盖 2A AI 结果。
- 资产、分镜、视频按阶段边界分批实现；不要在本轮顺手生成角色图、场景图、分镜或视频。
- 若要支持云端 / 多设备，先设计服务端任务与档案存储，再改前端；当前本地方案不是云同步。

## 十二、验收结论

阶段 2A 已完成第一步的原著导入、章节分块、真实结构化分析、证据追溯、人工修正保护、分析任务中断恢复和真实工作区展示。自动化与真实模型主链路均通过，仍有 3 条真实审校提示和上述边界需要用户确认。按要求停在阶段 2A，不进入 2B，不提交、不推送，等待用户验收。
