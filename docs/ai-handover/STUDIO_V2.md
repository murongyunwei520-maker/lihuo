# 短剧工坊 V2（Studio）

> 本文档记录新短剧工坊的真实结构、数据流、验证结果和仍未完成的能力。入口仍为 `/drama`；旧十步向导代码和旧数据都保留，只是不再从 `/drama` 进入。

## 一、目标与边界

- 一个短剧项目 = 多集 + 项目级共享资产（人物 / 场景 / 服装 / 道具）+ 统一任务记录。
- 六个真实生产工作区：剧本、资产、导演、画面、视频、声音。
- Studio 与 Workflow 双模式：Workflow 直接复用现有无限画布，不复制第二套画布或模型系统。
- 不包含剪辑工作区；不提供第二套模型/账号体系。
- 图片、视频、声音任务统一进入全局任务中心。

## 二、入口与文件

| 能力 | 文件 |
| --- | --- |
| 页面壳 / URL / 项目切换 / 六区导航 / 导出入口 | `web/src/pages/drama/index.tsx` |
| 项目库 | `web/src/pages/drama/studio/project-manager.tsx` |
| 剧本中心 | `web/src/pages/drama/studio/script-workspace.tsx` |
| 资产中心 | `web/src/pages/drama/studio/assets-workspace.tsx` |
| 导演中心 | `web/src/pages/drama/studio/director-workspace.tsx` |
| 画面中心 | `web/src/pages/drama/studio/picture-workspace.tsx` |
| 视频中心 | `web/src/pages/drama/studio/video-workspace.tsx` |
| 声音中心 | `web/src/pages/drama/studio/sound-workspace.tsx` |
| 全局任务中心 | `web/src/pages/drama/studio/task-center.tsx` |
| 共享 UI / 版本条 / 媒体预览 | `web/src/pages/drama/studio/ui.tsx` |
| 页面样式 | `web/src/pages/drama/studio.css` |
| 唯一数据仓 | `web/src/stores/use-studio-store.ts` |
| 统一任务队列 | `web/src/stores/use-studio-tasks.ts` |
| 数据模型 | `web/src/types/studio.ts` |
| 实体工厂 | `web/src/lib/studio/factory.ts` |
| 旧数据迁移 | `web/src/lib/studio/migrate.ts` |
| 提示词 / 参考资产 / 音色解析 | `web/src/lib/studio/prompt.ts` |
| 资产 / 音色影响检测 | `web/src/lib/studio/deps.ts` |
| 导演校验 / 连续性 / 时长预算 | `web/src/lib/studio/lint.ts` |
| 文本生成动作 | `web/src/lib/studio/ai.ts` |
| 视频请求计划与能力校验 | `web/src/lib/studio/video-plan.ts` |
| 真实生成 / 上传 / 重跑动作 | `web/src/lib/studio/actions.ts` |
| 导出（项目 JSON / 文本 / 单个媒体） | `web/src/lib/studio/export.ts` |
| Studio → 画布 | `web/src/lib/studio/workflow.ts` |
| 画布锚点节点 | `web/src/components/canvas/nodes/lihuo/drama-node.tsx` |
| 画布镜头节点 | `web/src/components/canvas/nodes/lihuo/drama-shot.tsx` |

## 三、URL

```
/drama?project=<projectId>&episode=<episodeId>&workspace=projects|script|assets|director|picture|video|sound
```

无项目或 `workspace=projects` 时显示项目库；Workflow 按钮跳到 `/canvas/:id`。

## 四、数据结构

- `StudioProject`：跨集共享的 `settings` / `bible` / `visualStyle` / `assets`，以及 `episodes`、`bgmTracks`、`bgmBrief`、`legacySequenceId`。
- `StudioEpisode`：剧本、场景、镜头、目标时长、分集字段、`workflowProjectId`。
- `StudioShot`：导演字段 + 五类媒体（image / video / audio / narration / sfx）各自的正式 ref、候选版本和状态；模型、比例、时长、画质、账号覆盖；`impact` 与 `videoRemote`。
- `StudioAsset`：人物 / 场景 / 服装 / 道具；正式参考图、候选版本、音色、音色样本、归档标记。
- `StudioMediaVersion`：`storageKey`、模型、账号、提示词、参数、来源、资产版本快照、任务 id。
- `StudioTask`：统一任务记录（状态、进度、参数、远端凭据、产物、错误、日志）。

持久化键：

- 新项目：`storageKey("studio_store")`
- 新任务：`storageKey("studio_tasks")`
- 旧项目只读：`storageKey("drama_store")`

## 五、真实生产动作

- 资产图：`runAssetImage` → 图片接口 → 素材入库 → 资产版本；首次自动正式，之后候选。
- 镜头首帧：`runShotImage` → 参考资产图生图 / 文生图 → 镜头版本；首次自动正式，之后候选。
- 镜头视频：`runShotVideo` → 能力/首帧/账号校验 → 远端任务 → 轮询 → 入库 → 版本；`resumeShotVideo` 只续查不重提交。
- 对白 / 旁白：`runShotAudio` → TTS → 版本；音效只支持导入。
- 文本：`runOutline` / `runScript` / `runEpisodePlan` / `runSplitEpisode` / `runShotFill` / `runContinuityReview`。
- 上传：首帧、视频、尾帧、音效、资产参考、BGM。
- 失败重试：任务中心 `rerunStudioTask`；画面/视频卡片单镜重试。

## 六、任务中心

- 并发默认 3，范围 1–6；图片 / 视频 / 声音 / 文本 / 分析统一排队。
- 刷新后运行中的任务标记为失败/中断；视频保留 `videoRemote`，可续查。
- 取消只停止前端等待；豆包桥没有取消远端 job 的接口，界面明确提示远端可能仍在跑。

## 七、资产影响与版本

- 生成时记录使用到的资产正式版快照（`assetVersionIds`）。
- 用户切换资产正式版后，`affectedByAsset` 找出引用该资产的镜头，标记首帧/视频为「需确认」，不自动删除或重生成。
- 镜头与资产都有候选版本，正式版可随时切换；正式资源可单独下载。

## 八、旧数据兼容

- 旧 `DramaSequence` 一条序列迁移为一个项目的一集。
- 保留旧 shot/asset id、图片/视频/音频版本、镜号、音色、远端视频凭据、画布 `projectId`。
- 旧 `speaker === "旁白"` 转为 `narration`。
- 迁移只读旧 key，不修改旧 store；迁移失败不覆盖旧数据，也不把 `migrationDone` 置为完成。
- 旧十步页面、`drama.css`、旧 store、旧任务文件全部保留。

## 九、已验证

- `npx tsc --noEmit --pretty false`：通过。
- `npm run build`：通过（Vite 构建成功，仅有既有 chunk 体积/动态导入警告）。
- `npx tsx scripts/studio-core-check.ts`：通过（合成旧数据迁移、资产/场景参考、依赖标记、导演校验、视频计划与 `5s` 时长解析）。

## 十、尚未完成 / 明确边界

- 未做真实浏览器六区点选验收，未使用真实模型账号额度。
- 旧数据迁移只用合成样本验证，未在真实浏览器 IndexedDB 旧库上跑。
- 导出目前是项目 JSON + 正式媒体单个下载，没有整包 ZIP、整集合成导出。
- 声音中心只有 TTS；音效/BGM 只支持导入，生成需要专门的音乐/音效模型。
- Workflow 镜头节点当前只生成首帧候选，不生成视频/音频。
- 任务队列是本机持久化，不跨设备；豆包远端任务不能取消。
- 资产归档/项目归档仍显示在列表中，只是带标记，未做隐藏筛选。

## 十一、Git 变更与文件清单

完整 V2 专属 diff 快照：[`STUDIO_V2.diff`](./STUDIO_V2.diff)（35 个文件，约 9.7k 行新增，562 KB）。

新增：

```
web/src/types/studio.ts
web/src/stores/use-studio-store.ts
web/src/stores/use-studio-tasks.ts
web/src/lib/studio/{actions,ai,deps,export,factory,lint,migrate,prompt,video-plan,workflow}.ts
web/src/pages/drama/studio.css
web/src/pages/drama/studio/{assets-workspace,director-workspace,picture-workspace,project-manager,script-workspace,sound-workspace,task-center,ui,video-workspace}.tsx
web/scripts/studio-core-check.ts
docs/ai-handover/STUDIO_V2.md
docs/ai-handover/STUDIO_V2.diff
```

修改：

```
web/src/pages/drama/index.tsx
web/src/components/canvas/nodes/lihuo/drama-node.tsx
web/src/components/canvas/nodes/lihuo/drama-shot.tsx
CHANGELOG.md
docs/ai-handover/{ARCHITECTURE,CURRENT_STATUS,ENTRY_POINTS}.md
docs/content/docs/progress/{todo,pending-test,pending-test.zh-CN}.mdx
```

另有首页短剧卡的一行文案改为「剧本、资产、分镜、画面、视频与声音」，但 `web/src/pages/home/index.tsx` 同时包含本轮之前就存在的首页视觉改动，无法单独拆分，故未计入 V2 专属 diff；`web/src/styles/studio.css` 的改动同样属于既有视觉工作，未计入。

> 工作区本身还有 Dockerfile、登录/积分/云端、后端安全等大量本轮之前未提交的改动。`git status` 共 68 个已跟踪文件 + 多个未跟踪目录；不要把全量 `git diff` 当作本次短剧重构的改动。

## 十二、测试记录

- `npx tsc --noEmit --pretty false`：exit 0。
- `npm run build`：exit 0，`✓ built in 42.37s`，产物 `index-D3B_So8-.js`；只有既有 chunk 体积和动态导入警告。
- `npx tsx scripts/studio-core-check.ts`：exit 0，输出 `ok: true`、`assertions: "all passed"`、`migration: "旧序列→项目/集"`、`references: ["char-new","scene-new"]`、`impacts: 1`、`issues: 3`、`plan: "ready"`。
- 未执行：真实浏览器六区点选、真实模型/账号生成、真实旧 IndexedDB 迁移。不要把这三项写成已通过。

