# Lihuo AI 短剧工作室 · 阶段 1 交付与架构说明

> 范围：短剧项目基础、五步导航、项目级模型配置结构、旧项目兼容。
> 本阶段不包含小说解析、真实资产/视频生成、后端重构、Bridge 修改、云端参考图协议。
> 结论：阶段 1 已完成，等待用户检查；未自动进入阶段 2。

## 一、正式结构与边界

### 1. 五步导航

```text
项目库（不是生产步骤）
  └─ 01 AI 小说分析
  └─ 02 角色与场景资产
  └─ 03 分集剧本与分镜
        ├─ 剧本（内部页签）
        └─ 分镜（内部页签）
  └─ 04 分镜审核与调整
  └─ 05 视频生成
        ├─ 视频（内部页签）
        └─ 声音（内部页签，不新增第六步）
Workflow 画布（高级编辑入口，不是第六步）
```

- `StudioProject` 仍是唯一短剧项目根对象；没有新建第二套 `DramaProject`。
- 新项目创建后直接进入 `step=analysis`；分集由第一步分析规划，创建表单不再要求预填集数。
- 旧 V2 项目有内容时默认进入 `script`，不强制重走小说分析。
- 声音固定在第五步内部；`scan`、`compose` 等旧能力不进入正式导航。

### 2. 旧 workspace URL 映射

| 旧 URL | 新位置 |
| --- | --- |
| `?workspace=projects` | 项目库 |
| `?workspace=script` | `step=script&view=script` |
| `?workspace=director` | `step=script&view=storyboard` |
| `?workspace=assets` | `step=assets` |
| `?workspace=picture` | `step=review` |
| `?workspace=video` | `step=video&view=video` |
| `?workspace=sound` | `step=video&view=sound` |

旧 URL 会在页面内规范成新 URL；映射逻辑在 `web/src/lib/studio/navigation.ts`，没有散落在组件里。

## 二、数据结构

### 1. `StudioProject` 扩展

原有 V2 字段全部保留：`settings`、`bible`、`visualStyle`、`assets`、`episodes`、旧剧本/场景/镜头/媒体版本/远端任务。

新增字段：

```ts
workflowMode: "all";                 // 固定 all：全剧一次性规划，任务队列控并发
automationMode: "auto";              // 固定 auto：自动推进，两个人工审核门
adaptationMode: "adapt";             // 固定 adapt：短剧化改编，保留人物/主线/关键事件/因果
projectStatus: DramaProjectStatus;
currentStep: DramaStep;
stepStates: Record<DramaStep, DramaStepStatus>;
modelProfiles: DramaModelProfiles;
novelId?: string;
workflowRunId?: string;
workflowRun?: DramaWorkflowRun;
```

`DramaStep` 固定为：

```text
analysis | assets | script | review | video
```

`DramaStepStatus` 为：

```text
idle | pending | running | waiting_review | completed | partial | failed | paused
```

状态条只读取 `project.stepStates`；点击导航不会把步骤伪造成完成。

### 2. 项目级模型方案

```ts
type DramaModelProfiles = {
    version: 1;
    selected: Partial<Record<"text" | "image" | "video", {
        channelId: string;
        modelId: string;
    }>>;
    paramsByKey: Record<string, Record<string, string | number | boolean>>;
};
```

- 参数键固定为 `capability::channelId::modelId`，例如 `text::default::gpt-5.5`。
- 切换模型只新增/替换 `selected`，旧模型的 `paramsByKey` 原样保留；切回旧模型可恢复其参数。
- 项目 profile 只保存模型身份、参数和必要非密钥配置；不保存 API Key。
- `setProjectModel` 只修改当前项目的 `modelProfiles`，同时同步项目 `settings.textModel/imageModel/videoModel`，让旧 V2 工作区继续可用。
- 不调用 `updateConfig`，不修改全局 `AiConfig`。
- 新项目默认从全局画布默认模型复制“身份”，不复制凭证或整个配置对象。
- 旧项目 `settings` 里的完整 `channel::model` 值仍可作为兼容回退。

### 3. 项目级模型隔离验证

实测步骤：

1. 第一个项目把图片模型改为 `Seedream 5.5`。
2. 切到第二个项目，项目设置仍显示 `gpt-image-2（默认渠道）`。
3. 在第一个项目修改后新建第三个项目，第三个项目仍显示 `gpt-image-2（默认渠道）`。
4. 纯函数测试断言 `effectiveProjectConfig()` 返回副本，调用前后全局 `AiConfig` 的 JSON 完全一致。

结论：项目级修改没有污染其他项目，也没有改变新建项目的全局默认值。

## 三、持久化与旧项目兼容

- 当前持久化键：`storageKey("studio_store")`，通过 localforage/IndexedDB 保存。
- 旧库 `storageKey("drama_store")` 只读，不在迁移中写入、清理或覆盖。
- `createStudioProject()` 默认 0 集；`createProject()` 从全局配置生成项目模型 profile。
- `persist.merge` 对保存的项目统一执行 `normalizeStudioProject()`：
  - 缺 `workflowMode/automationMode/adaptationMode` 补固定值；
  - 缺 `projectStatus` 补 `draft`；
  - 缺 `stepStates` 补五步 `idle`；
  - 缺 `modelProfiles` 补空 profile；
  - 缺 `currentStep` 时，有 `legacySequenceId`、分集或资产则补 `script`，否则补 `analysis`。
- `migrateLegacySequence()` 迁移旧 `DramaSequence` 时补 `currentStep="script"` 和默认五步字段，保留旧剧本、资产、镜头、媒体版本、音色与视频远端任务。
- 旧项目不会被强制改成“必须重新导入小说”的项目。

## 四、页面与交互

### 1. 项目首页

- 新建项目表单移除“初始集数”，显示“创建后位置：01 · AI 小说分析”。
- 创建按钮为“创建并进入第一步”；创建后 URL 带 `project=<id>&step=analysis`。
- 项目卡显示当前步骤、五步状态条、集数/镜头/规划时长/资产、失败任务数。
- 重命名只改 `title`，不重置项目数据；删除确认明确写出项目集/镜头/资产数量。
- 无分集项目仍可打开第一步和资产阶段；Workflow 按钮禁用并说明原因。

### 2. 第一步

- 可编辑项目名称、一句话故事、题材、单集目标时长、整体视觉风格，立即写入本项目。
- 小说导入与分析结果只显示明确的“阶段 2 接入/未开始分析”占位；不解析、不调用模型、不伪造完成。
- 显示项目模型摘要与“更换本项目模型”真实入口。
- 显示 `all + auto + adapt` 的工作流说明。

### 3. 第三/第五步内部页签

- 第三步：剧本 / 分镜；第五步：视频 / 声音。
- 无分集时页签仍显示，内容区是真实空态和“补建一集”，不再把内部页签整体藏掉。
- 有分集时旧 V2 剧本、导演、画面、视频、声音工作区在对应步骤内复用；没有删除旧页面。

### 4. 页面截图

截图取自 998×667 的隔离验收视口，窄屏侧栏为折叠态；桌面宽屏使用 236px 侧栏。

- 第一步与五步导航：[stage1-analysis.png](./stage1-analysis.png)
- 第五步空态仍显示“视频 / 声音”页签：[stage1-video-tabs.png](./stage1-video-tabs.png)

## 五、后端与外部工程

- 正式云端业务后端仍是 `C:\Users\qq308\Desktop\lihuo后端`；阶段 1 未修改它。
- 仓库 `server/` 保留旧版实现，阶段 1 未修改其业务路由，也没有把外部后端能力写成仓库已有能力。
- `doubao-bridge/` 阶段 1 未修改。
- 前端继续使用现有服务层；本阶段没有新增服务端接口。
- 没有复制外部后端到 `server/`，没有合并两个仓库。

## 六、验收结果

### 1. 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（最终修复空态页签回调用 `goStep` 后重跑） |
| `npm run build` | 通过；7877 modules transformed，约 2m16s，只有既有 chunk 与 dynamic/static import 提示 |
| `web/scripts/drama-stage1-check.ts` | 全部断言通过（含 7 条旧 workspace 映射） |
| `web/scripts/studio-core-check.ts` | 全部断言通过（旧用例显式传 `episodeCount:1`） |
| `DRAMA_STUDIO_STAGE1.diff` | `git apply --check` 对开工基线通过；LF，2166 行，仅含阶段 1 代码/测试增删 |

阶段 1 纯函数测试覆盖：

- 新项目默认 0 集、`currentStep=analysis`、`status=draft`、`all/auto/adapt`；
- 项目 profile 默认继承、模型切换保留旧参数、切回恢复参数、不含 `apiKey`；
- `effectiveProjectConfig()` 返回副本，全局配置 JSON 不变；
- 旧项目缺字段 normalization 后保留剧本、资产、视频引用、视频远端任务；
- 七条旧 workspace 映射（`script/director/assets/picture/video/sound/projects`；含 `projects` 返回项目库）。

### 2. 浏览器实测

| 验收项 | 结果 |
| --- | --- |
| 新建短剧项目 | 通过，表单不再要求集数 |
| 创建后直接进入第一步 | 通过，URL 为 `project=<id>&step=analysis` |
| 五步导航切换 | 通过，01–05 均能切换；第三步/第五步内部页签可用 |
| 刷新后项目仍在 | 通过 |
| 切换项目不串数据 | 通过；两个项目标题、简介、模型配置互不影响 |
| 项目级模型隔离 | 通过；改第一个项目图片模型后，第二个和新建第三个项目仍为全局默认 |
| 旧 V2 项目打开 | 通过；注入临时旧结构样本后显示“旧版迁移”，默认进入剧本分镜，1 集/1 镜/1 资产与旧剧本正文保留 |
| 旧 workspace URL | 通过；`director` 规范为 `step=script&view=storyboard`，`sound` 规范为 `step=video&view=sound` |
| 原无限画布入口 | 通过；`/canvas` 可加载画布库，阶段 1 未改画布核心 |
| 项目重命名 | 通过 |
| 项目删除 | 通过；确认框写清项目数据，删除后项目库只剩目标项目 |
| 无分集空态 | 通过；第三/第五步显示真实空态和“视频 / 声音”页签 |
| 补建一集 | 通过；创建后 URL 带 `episode`，第三/第五步进入有分集工作区 |
| 控制台 | 无阶段 1 运行时错误；只有既有的 antd 弃用提示和未启动本地 Bridge 的连接拒绝 |

旧 V2 浏览器样本包含：旧剧本文本、1 个人物资产、1 个场景、1 个镜头、旧版迁移标识，不含五步新字段。测试后已从隔离浏览器 IndexedDB 移除，原项目库恢复为 1 个测试项目。

旧视频“不丢失”的验证边界：`normalizeStudioProject()` 纯函数测试断言了 `videoRef` 与 `videoRemote.taskId` 保留；既有 `studio-core-check.ts` 继续断言旧序列迁移的视频远端任务。浏览器样本没有真实视频文件，因此没有把“能播放旧视频文件”描述为已实测。

## 七、既有改动保护

- 开工前基线副本：`.sessions/38454513883379714/agents/m_0cwediOGgIg/stage1-baseline/`，保存 10 个目标文件原始内容与 `index-existing.diff`。
- `web/src/pages/drama/index.tsx` 的既有 V2 改动仍在当前工作区；阶段 1 的差异是相对该基线的最小增量，不是对用户改动的回滚。
- `web/src/stores/use-config-store.ts` 未修改：基线 SHA256 与当前 SHA256 均为 `184B88CEB21700A913BA9CB34D45E305936BF179294E5683DDC90C80CC8A1BFA`。
- 未执行 `git reset --hard`、`git checkout -- .`、`git stash`、批量格式化、自动提交或自动推送。
- 未修改仓库 `server/`、外部后端、`doubao-bridge/`、无限画布核心、`package.json`。
- 工作区最终 128 项改动（70 项已跟踪修改 + 58 项未跟踪）；其中绝大多数是用户既有工作，阶段 1 只新增/修改本报告所列文件。未跟踪文件同样没有删除或清理。

## 八、阶段 1 实际文件

### 新增

```text
web/src/lib/studio/model-profile.ts
web/src/lib/studio/navigation.ts
web/src/pages/drama/studio/analysis-workspace.tsx
web/src/pages/drama/studio/project-settings.tsx
web/scripts/drama-stage1-check.ts
docs/ai-handover/DRAMA_STUDIO_STAGE1.md
docs/ai-handover/DRAMA_STUDIO_STAGE1.diff
docs/ai-handover/stage1-analysis.png
docs/ai-handover/stage1-video-tabs.png
```

### 修改

```text
web/src/types/studio.ts
web/src/lib/studio/factory.ts
web/src/lib/studio/migrate.ts
web/src/stores/use-studio-store.ts
web/src/pages/drama/studio/ui.tsx
web/src/pages/drama/studio/project-manager.tsx
web/src/pages/drama/studio/studio.css
web/src/pages/drama/index.tsx
web/scripts/studio-core-check.ts   // 旧用例显式 episodeCount:1，保持原测试语义
docs/ai-handover/ARCHITECTURE.md
docs/ai-handover/ENTRY_POINTS.md
docs/content/docs/progress/todo.mdx
docs/content/docs/progress/pending-test.mdx
CHANGELOG.md
```

相对阶段 1 开工基线的代码/测试差异统计（不含用户既有 V2 改动与交付文档，单位：行）：

```text
修改文件
index.tsx                  260 insertions / 82 deletions
types/studio.ts            103 insertions
factory.ts                  53 insertions / 3 deletions
migrate.ts                  10 insertions
use-studio-store.ts         27 insertions / 2 deletions
studio/ui.tsx               29 insertions / 1 deletion
project-manager.tsx         75 insertions / 26 deletions
studio.css                 444 insertions
studio-core-check.ts         2 insertions / 1 deletion

新增文件
model-profile.ts           142 insertions
navigation.ts               76 insertions
analysis-workspace.tsx     152 insertions
project-settings.tsx        87 insertions
drama-stage1-check.ts      162 insertions

合计                     1622 insertions / 115 deletions
```

完整逐行 diff 见 [`DRAMA_STUDIO_STAGE1.diff`](./DRAMA_STUDIO_STAGE1.diff)（2166 行，106,532 bytes，LF）；已用 `git apply --check` 对开工基线验证可应用。该 diff 只覆盖上述 9 个修改文件和 5 个新增代码/测试文件，不把用户既有 V2 改动或文档改动混入。

## 九、尚未完成 / 阶段 2 依赖

- 小说导入与全文解析（TXT/DOCX/PDF/粘贴），`mammoth`、`pdfjs-dist` 懒加载与 Vite worker 配置；阶段 1 未安装这两个依赖。
- 真实文本分析、分集规划、改编追踪、人物/场景抽取。
- 真实资产生成、分镜审核门、逐镜头视频队列。
- 云端视频首帧/参考图协议与供应商适配；云端未支持前必须明确阻止或提示，不静默丢弃。
- 短剧独立账号选择策略（固定账号、记录实际账号、不自动切换、额度未知显示“无法确认”）；不得改全局画布账号逻辑。
- 声音页签的真实对白/旁白/BGM/音效能力按后续阶段接入；本阶段只保留入口和旧 V2 声音工作区。
- 整集自动合成、时间轴、镜头拼接、字幕合成仍明确不做；如需要必须另立产品需求。
