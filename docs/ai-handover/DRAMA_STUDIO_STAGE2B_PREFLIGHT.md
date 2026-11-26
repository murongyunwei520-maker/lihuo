# 离火 AI 短剧工作室 · 阶段 2B 前置检查

> 本报告是阶段 2B 正式开工前的检查结果，不代表 2B 已完成。
> 本阶段目标：建立统一的 AI 短剧总编剧系统，输出完整全剧分集规划，作为阶段 3 的正式生产输入；不提前生成正式剧本对白、分镜、图片或视频。

## 一、结论

**可以进入阶段 2B，但必须先接受一个最小数据结构扩展：在现有 `StudioProject` 内新增嵌套 `adaptation` 工作区，不新建项目根对象。**

结论依据：

1. 阶段 2A 的 P1 修复代码仍在当前源码中，确定性测试与当前 typecheck 通过。
2. 阶段 2A 已有真实小说项目、结构化原著档案、证据链、人工修正、任务记录和项目级文本模型调用链。
3. 现有 `StudioProject` 没有改编方案、全剧蓝图、全剧分集规划、人物弧光、伏笔池、剧情校验、审核版本和锁定容器；直接复用 `StudioEpisode` 会把 2B 规划与阶段 3 生产实体混在一起。
4. 现有任务中心没有 `unknown` 状态，且刷新后会把运行中任务统一标为 `failed`；2B 需要独立的阶段化生成记录和 `unknown` 语义，避免刷新后自动重发。
5. 当前工作区有 147 条既有未提交变更和未跟踪文件，必须保持原样，不能执行 `reset / checkout / stash / clean`。

## 二、阶段 2A 最终验收状态

### 已完成并有源码/测试证据

- TXT / DOCX / PDF / 粘贴导入。
- 章节识别、8,000 字分块、自然边界切分与上下文重叠。
- 真实文本模型结构化分析：人物、关系、世界观、地点、事件因果、伏笔。
- 证据追溯：原文摘录、章节、真实字符区间、显式 / 推断 / 生成分类。
- 人工修正独立保存，不随重新分析覆盖。
- 分析任务持久化、取消、失败重试、分块断点。
- 第一步 AI 小说分析工作区。
- 项目级文本模型配置与项目账号隔离。

### P1 修复核对

**P1-1 无效原著证据进入有效档案：已修复。**

`normalizeEvidence()` 当前会丢弃空摘录、错误摘录、错误章节 ID、跨章节摘录；空白/换行差异通过去空白规范化文本与原位置映射匹配；保存真实原文切片，`sourceLocation.charStart / charEnd` 对应整本原文真实字符区间。人物允许空证据待审核，关系无有效证据直接丢弃。

**P1-2 豆包 / Dola 项目账号缺失时继承全局账号：已修复。**

内置豆包 / Dola 的项目配置副本先清空全局账号；`novelTextModelRuntime()` 通过 Bridge `listAccounts()` 与纯函数校验项目账号；账号缺失、不存在、未登录、状态异常、provider 不匹配、对话额度被拒均阻止请求；发送前再次校验运行时账号与项目选择一致。

### 本轮复跑结果

在 `C:\Users\qq308\Desktop\lihuo\web` 执行：

```powershell
npx --yes tsx scripts/stage2a-fix-check.ts
npx --yes tsx scripts/stage2a-core-check.ts
npm run typecheck
```

结果：

- `stage2a-fix-check.ts`：`ok: true`
  - 正确证据 1、空白差异证据 1、错误/空/错误章节/跨章证据均为 0
  - 分块 2，最大 7,739 字
  - PDF 页码按有文本页重算
  - 无项目账号被拒、项目账号有效、`requestAccountId=project-doubao`、全局账号未被修改
- `stage2a-core-check.ts`：`ok: true`
  - 3 章 / 2 分块 / 最大 7,739 字
  - 2 人物 / 1 关系 / 2 事件 / 1 伏笔
  - 11 条证据：9 显式、2 推断、0 生成
  - 0 条 warnings
- `npm run typecheck`：通过，无输出错误。

### 仍需如实标记的边界

**阶段 2A 修复后的真实浏览器最终验收尚未重跑。**

- 修复前真实项目 A `阶段2A验收·雾港夜航`（`proj-UORILWcK`）完成过 v3 分析：4 人物 / 4 关系 / 8 世界观 / 3 地点 / 6 事件 / 2 伏笔 / 70 条显式证据 / 1 处人工修正 / 6/6 章覆盖。
- 真实模型调用累计停在 11 次；修复后没有重新调用真实模型。
- 因此不能把“修复后的真实模型/浏览器最终验收”写成已完成。用户已下发 2B 正式开发指令，视为继续推进授权。

## 三、当前数据资产

项目 A：

- ID：`proj-UORILWcK`
- 名称：`阶段2A验收·雾港夜航`
- 6 章 / 1,281 字
- v3 分析：4 人物 / 4 关系 / 8 世界观 / 3 地点 / 6 事件 / 2 伏笔 / 70 显式证据 / 1 人工修正 / 6/6 章覆盖
- 项目文本模型：`builtin-doubao::对话`（“对话（豆包）”）
- 项目账号：`db-mvxvft3x-a9tky`（豆包1）
- Bridge：`http://127.0.0.1:9091`

项目 B：

- ID：`proj-iNU-UIPW`
- 名称：`阶段2A隔离验收·粘贴样本`
- 3 章 / 87 字，用于项目隔离验收

> 项目 A/B 数据保存在浏览器 localForage，不在 Git 工作区文件中。2B 真实浏览器验收将直接在这些项目上继续，不另造 mock 项目冒充真实验收。

## 四、现有数据结构的不足

`StudioProject` 当前已有：

- `novel`、`novelAnalysis`、`novelAnalysisOverrides`、`analysisRuns`、`analysisRunId`
- `episodes`、`assets`、`settings`、`bible`、`visualStyle`
- `stepStates`、`modelProfiles`、`projectStatus`、`currentStep`

缺少：

- 改编定位配置
- 改编策略与改编差异账本
- 全剧蓝图
- 全剧分集规划（非阶段 3 生产集）
- 人物弧光与逐集人物状态时间线
- 全剧伏笔池
- 剧情因果 / 时间线 / 人物连续性校验结果
- 生成任务、输入/输出版本、取消与 unknown 状态
- 提案、旧版本、锁定的蓝本/集数/策略
- 阶段 3 交接快照

`StudioEpisode` 是阶段 3 生产实体，已有 `coreEvent / mainConflict / continuity / hook`，但缺少 2B 所需的：

- `episodeLogline`
- `openingHook`
- `dramaticGoal`
- `climax`
- `endingHook`
- 三类伏笔动作
- `continuityDependencies`
- `estimatedDuration`
- `sourceReferences`
- `adaptationChanges`
- `reviewStatus`
- `version`
- 人物逐集状态

**结论：不把 2B 规划字段硬塞进 `StudioEpisode`，也不新建第二个项目根对象。**

## 五、最小数据结构扩展方案

在 `StudioProject` 增加一个可选嵌套字段：

```ts
adaptation?: StudioAdaptationWorkspace
```

`adaptation` 作为一个项目内工作区容器，包含：

```text
adaptation
├─ settings            改编定位
├─ strategy            改编方案 + 改编差异账本
├─ blueprint           全剧故事蓝图
├─ episodePlans        全剧分集规划
├─ characterArcs       人物弧光 + 逐集状态时间线
├─ foreshadowings      全剧伏笔池
├─ checks              剧情校验结果
├─ proposals           待用户确认的生成提案
├─ history             已确认的整包旧版本快照
├─ generations         阶段化生成记录
├─ activeGenerationId  重复提交保护
└─ versionNumber       当前有效规划版本
```

关键约束：

- 所有子对象使用项目内稳定 ID，并引用阶段 2A 的 `characterId / relationshipId / sceneId / eventId / foreshadowingId / chapterId`。
- 分集规划单独使用 `StudioEpisodePlan`，不替代 `StudioEpisode`；阶段 3 再消费当前有效规划。
- 每个关键事件、分集来源、改编差异都带 `sourceType: explicit | inferred | generated` 和证据/引用校验。
- 重大改编带高风险类型、审核状态，不能被当成普通事实。
- `strategy / blueprint / 每个 episodePlan` 都带 `version / reviewStatus / locked`。
- 生成结果先进入 `proposal`，用户确认后才替换当前有效内容；旧版本进入 `history` 或集内版本记录。
- 锁定策略、蓝图或单集在局部重生成时不得覆盖。
- 新字段通过 `normalizeStudioProject()` 补默认值，不迁移、不覆盖旧项目已有内容。

## 六、持久化与任务

### 持久化

- `useStudioStore` 使用 Zustand persist + localForage。
- 键：`storageKey("studio_store")`。
- `partialize` 保存 `projects` 与 `migrationDone`；`merge` 逐个项目调用 `normalizeStudioProject()`。
- 2B 将新增 `updateAdaptation(projectId, updater)`，不另建 store，不复制项目根对象。

### 现有任务中心

`use-studio-tasks.ts`：

- 最多 300 条，默认 `maxConcurrent=3`。
- 状态：`pending / queued / running / succeeded / failed / canceled / retrying`。
- 队列与 AbortController 只在内存。
- 刷新会把 queued/running/pending/retrying 一律标为 `failed`。
- 没有 `unknown` 状态。

2B 处理方式：

- 保留现有任务中心不破坏。
- 2B 自己的模型调用使用 `adaptation.generations` 记录阶段、模型、参数、输入/输出快照、调用次数。
- 生成状态支持 `queued / running / succeeded / failed / canceled / interrupted / unknown`。
- 刷新时把未完成生成标为 `interrupted`；无法确认服务端是否已受理时标 `unknown`，**不自动重发**，只能用户手动确认后重试。
- 通过 `activeGenerationId` 与运行时锁阻止重复提交。

## 七、模型调用链

只使用项目级文本模型：

```text
StudioProject.modelProfiles
  → projectModelOption / projectModelSelection
  → novelTextModelRuntime()
  → 内置豆包/Dola 时校验项目账号
  → requestNovelText()
  → requestText(project config, messages, options)
```

不会：

- 读取全局选中模型替代项目模型。
- 把项目参数写回全局 `AiConfig`。
- 修改全局豆包 / Dola 账号行为。
- 把完整小说无差别发送到每次请求。

2B 输入将使用：

- 阶段 2A 的结构化档案摘要。
- 人物 / 关系 / 世界观 / 地点 / 事件 / 伏笔及证据短摘录。
- 必要时的小说原文证据切片，不发送整本原文。
- 已生成的改编方案 / 蓝图 / 邻接集摘要作为后续调用的上下文。

## 八、Git 与既有修改保护

- 分支：`main`
- HEAD：`27b67bd09a8aead582868e139c585b7ba4b03b0e`
- `git status --short`：147 条
- 未执行 `reset / checkout / stash / clean`
- 已创建开工前快照：`...\stage2b-baseline`，357 个文件
- 2B 本轮 diff 将用快照做 `git diff --no-index`，避免把 2A 未跟踪文件误算成本轮新增
- 不自动 commit / push

## 九、2B 实施边界

本阶段只做：

- 改编定位
- 改编方案与差异追踪
- 全剧蓝图
- 全剧分集规划
- 人物弧光与逐集记忆
- 伏笔池
- 剧情因果 / 时间线 / 人物连续性校验
- 审核、版本、锁定、局部重生成
- 阶段 3 交接数据

本阶段不做：

- 角色图 / 场景图
- 九宫格
- 分镜
- 视频
- 正式剧本对白
- 逐镜头提示词
- 自动进入阶段 3
- 修改 Bridge / 正式外部后端 / `server/` 业务路由 / 无限画布核心
- 修改全局 `AiConfig` 或豆包 / Dola 全局账号行为
- 删除旧项目数据

## 十、开工判定

前置检查通过，可以开始 2B 实现。实现顺序：

1. 数据模型与旧项目归一化。
2. 改编 schema、引用校验、业务校验。
3. 改编引擎与分阶段模型调用。
4. 版本/提案/锁定/局部重生成。
5. 第一步内 2B 审核工作区。
6. 确定性测试、typecheck、build。
7. 真实项目 A 浏览器验收；项目 B 验证隔离。
8. 交付报告、Diff、未完成事项与风险。

**在用户明确验收前，不进入阶段 3。**
