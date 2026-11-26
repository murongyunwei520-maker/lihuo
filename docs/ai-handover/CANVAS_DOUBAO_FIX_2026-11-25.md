# 离火无限画布前端专项修复报告

本轮在现有工作区直接修改，没有回退 GitHub 旧版、没有重写 `project.tsx`、没有替换技术栈、没有提交或推送。修改前工作区备份：`C:\Users\qq308\AppData\Local\Temp\lihuo-canvas-fix-backup-20261125`。

## 一、发现的问题与根因

| # | 问题 | 根本原因 |
| --- | --- | --- |
| 1 | 豆包图片任务只带比例和数量，尺寸、清晰度、模式、参考图数量在入口处丢失 | `image.ts` 的 `requestGeneration / requestEdit` 只向适配器传 `ratio / count`；适配器再用裸对象拼 `requestedParams` |
| 2 | 豆包视频任务基本只提交模型，比例、时长、清晰度、参考素材没有完整契约 | `video.ts` 豆包分支的 `requestedParams` 只有 `model / ratio / duration`，没有统一 builder，也没有上传视频 / 音频参考素材 |
| 3 | 请求参数和实际参数混在一起，网页端不支持的参数被静默丢弃 | `requestedParams` 原样透传，执行器只读其中一部分；没有 `appliedParams / unsupportedParams` 分层 |
| 4 | 参考图上传失败被当成“没有参考图”，任务静默退化成文生图 | 旧逻辑 `uploadAttachment(...).catch(() => "")`，再 `filter(Boolean)` |
| 5 | 参考素材文件不存在时任务仍创建，实际没有按参考素材生成 | 桥接 `POST /api/jobs` 对附件路径只做 `existsSync` 过滤，不报错 |
| 6 | 普通视频入口可能擅自使用第一个登录账号或 `auto / round-robin`，与账号面板当前选择不一致 | `video.ts` 使用 `loggedIn[0]` 和 `auto`；账号面板只改号池 store，不同步 `config.doubaoAccountId` |
| 7 | 上传文件过滤后使用过滤数组下标，节点错位 | 先 `filter` 再按新数组 `i` 计算 stagger；替换目标节点时剩余文件也用 `i + 1` |
| 8 | 删除节点后旧任务继续轮询，晚到结果还可能回填 | `deleteNodes` 没有 abort `generationRequestsRef` 中对应请求；桥接等待只停止前端轮询，没有同步取消后台任务 |
| 9 | 首次进入画布时左右栏、顶栏、底部任务队列全部展开，画布被挤占 | 侧栏默认 `panelOpen=true`、检查器 / 任务栏各自维护本地 state，没有统一布局快照 |
| 10 | 底部工具栏固定 `left:300`，沉浸模式下错位 | `CanvasToolbar` 写死左侧偏移，依赖旧侧栏宽度 |
| 11 | 节点配置卡片固定 600px、以节点中心定位、只判断底部空间、随画布缩放反向缩放 | `NodePanelShell` 在节点内部 `absolute` 定位，宽度写死，只判断 `bottom`，并用 `scale(1 / scale)` |
| 12 | 卡片左右越界、高度超出可视区、内容不能滚动、缩放 / 拖动 / 窗口变化不重新定位 | 没有屏幕坐标算法，没有 viewport 边界和顶栏 / 底栏 inset，没有 ResizeObserver / rAF 跟随 |
| 13 | 检查器收起后仍轮询、任务栏收起后仍占布局高度 | 检查器 `collapsed` 只控制渲染分支，effect 仍运行；任务栏 `open` 只控制内容，外框一直存在 |
| 14 | 全量 `tsc` 被两个用户未跟踪的工作室文件阻断 | `drama/studio/ui.tsx` 的状态 meta 缺 `submitting / interrupted`；`use-studio-tasks.ts` 的 `map(recoverInterruptedTask)` 把数组 index 传给第二个 `now?: string` 参数 |

## 二、修改文件清单

新增：

- `web/src/services/api/doubao-request-params.ts` — 图片 / 视频 / 文本统一类型化参数契约和 builder。
- `web/src/lib/canvas/node-panel-layout.ts` — 节点卡片纯定位算法。
- `web/src/lib/canvas/canvas-layout-state.ts` — 布局快照解析 / 序列化。
- `web/src/stores/use-canvas-layout-store.ts` — 统一布局状态和首次初始化。
- `web/src/lib/media-file-selection.ts` — 过滤文件保留原始 index。
- `doubao-bridge/lib/request-params.mjs` — 服务端 requested / applied / unsupported 拆分与数量、时长收敛。
- 5 个测试文件（见第七节）。

修改：

- `web/src/services/api/image.ts`
- `web/src/services/api/video.ts`
- `web/src/services/api/doubao-bridge-adapter.ts`
- `web/src/services/api/doubao-bridge.ts`
- `doubao-bridge/server.mjs`
- `web/src/components/canvas/canvas-node.tsx`
- `web/src/components/canvas/canvas-top-bar.tsx`
- `web/src/components/canvas/canvas-toolbar.tsx`
- `web/src/components/canvas/infinite-canvas.tsx`
- `web/src/components/canvas/canvas-task-bar.tsx`
- `web/src/components/canvas/canvas-inspector-panel.tsx`
- `web/src/components/canvas/canvas-doubao-accounts-panel.tsx`
- `web/src/components/canvas/canvas-side-dock.tsx`
- `web/src/stores/use-canvas-side-panel-store.ts`
- `web/src/pages/canvas/project.tsx`
- `web/tsconfig.json`
- `web/src/pages/drama/studio/ui.tsx`（用户未跟踪文件，仅补状态类型）
- `web/src/stores/use-studio-tasks.ts`（用户未跟踪文件，仅修 `map` 回调类型）
- `CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx`、`docs/content/docs/progress/todo.mdx`

## 三、豆包参数契约：修复前后

### 修复前

```ts
// image.ts
params: { ratio, count }

// video.ts
requestedParams: { model, ratio, duration }
accountSelectionMode: preferredAccountId ? "manual" : "auto"
// 上传账号：loggedIn[0]
```

### 修复后

图片入口：

```ts
{
  model,
  mode: "text-to-image" | "image-to-image",
  ratio,
  size,
  resolution,
  count,
  attachmentCount
}
```

视频入口：

```ts
{
  model,
  mode: "text-to-video" | "image-to-video" | "reference-to-video",
  ratio,
  duration,
  size,
  resolution,
  count: 1,
  attachmentCount
}
```

文本 / 对话入口：

```ts
{ model, mode: "text-to-text" | "image-to-text", attachmentCount }
```

完整链路：

```text
节点配置 / Agent
  -> buildGenerationConfig
  -> requestGeneration / requestEdit / createVideoGenerationTask / askDoubao
  -> 类型化 builder
  -> POST /api/jobs 的 requestedParams
  -> server resolveRequestedParams + normalizeAppliedParams
  -> job.appliedParams / job.unsupportedParams
  -> spec.json
  -> run-doubao.mjs 的 model / ratio / duration / count / attachments / mode
  -> 任务结束写 actualParams（网页读回）
```

关键处理：

- 图片 `count` 网页端单次上限 4，视频上限 1；超出会收敛并记录原因。
- 视频 `duration` 收敛到 4–15s，并在 `unsupportedParams` 中记录“已收敛”提示。
- `size / resolution` 当前豆包网页没有对应控件，只进入 `requestedParams` 审计和 `unsupportedParams` 展示，不伪造为已提交。
- `mode` 当前网页没有独立按钮，作为任务元数据记录；实际图片 / 视频模式由附件与网页能力决定。
- 参考图 / 视频 / 音频都真实上传；任一附件上传失败直接报错，不再静默退化成纯文本。
- 桥接收到不存在的附件路径返回 `400 + ATTACHMENT_MISSING`。
- 普通图片、视频、豆包节点、Agent / 对话统一通过 `resolveDoubaoAccountId` 解析账号；`manual` 模式额度不足只报错，不换号。
- 删除节点时同步 `abort()` 并清理 `generationRequestsRef`；`waitJobWithCancel` 在 abort 时调用 `cancelJob`。
- 图片结果按任务文件的原始 `f.index` 取 URL；视频结果按任务文件对象真实下标取；任务 `nodeId` 不匹配直接报错，避免串卡片。

## 四、沉浸模式实现

- 新增 `canvas-layout-v1` 快照，记录 `topBarOpen / taskBarOpen / inspectorOpen / accountsOpen`。
- 首次无快照时四项全部收起；`initializeCanvasLayout()` 只执行一次并写入 `initialized: true`，之后完全尊重用户手动状态。
- 左侧素材栏：保留原有 `canvas-side-panel-open` 键；无布局快照时首帧直接 `false`，避免先开再收。
- 顶部栏：`project.tsx` 条件渲染；隐藏后在画布左上显示“显示顶栏 / 展开素材”胶囊按钮；`CanvasTopBar` 增加“收起顶栏”按钮。
- 底部任务队列：`CanvasTaskBar` 受控；收起时不占布局高度，右下角保留“任务队列 N 条 · M 进行中”浮动按钮；组件仍挂载、5 秒轮询仍运行。
- 右侧检查器：收起时不再占 44px 布局宽度，改为右缘悬浮展开按钮；展开时保留 268px 面板。
- 账号池：收起保留 44px 头像 rail 和展开入口，避免二维码弹窗被卸载；展开后账号选择同步 `useConfigStore.config.doubaoAccountId`。
- 画布主体是 flex：侧栏 / 检查器展开时 canvas 自动缩小，收起时自动填满；项目切换不重置布局 store；React 重渲染不触发自动收起。
- `CanvasToolbar` 从固定 `left:300` 改为 `left:16, right:16`，消除沉浸模式下的大块空白。

## 五、节点配置卡片智能定位

`NodePanelShell` 改为 `createPortal(document.body)` 的 fixed 浮层，`computeNodePanelLayout()` 使用屏幕坐标：

1. 默认在节点下方，间隔 12px。
2. 下方空间不足时翻到上方；上下都不足时选择空间更大的一侧。
3. 卡片中心对齐节点中心，再 clamp 到画布左右边界，左右越界自动向内偏移。
4. 宽度 `min(600, 画布可用宽度)`。
5. 高度 `min(自然高度, 画布可用高度, 当前侧空间)`，内容由外层 `overflow-y-auto` 滚动。
6. 顶部避开顶栏（隐藏顶栏时保留 52px 安全区），底部避开工具栏。
7. `useLayoutEffect` + 持续 `requestAnimationFrame` 跟随节点屏幕矩形，配合节点 / 面板 / viewport 三个 `ResizeObserver`、`window.resize`、捕获阶段 `scroll` 重新定位。
8. 清理时 `cancelAnimationFrame`、`disconnect` 三个 observer、移除 resize / scroll 监听。
9. 组件只依赖 `nodeId`，不会因面板内部 state 变化重建 observer；打开 / 关闭 / 切换节点不会用 `setTimeout` 补位置。

## 六、其他画布修复

- 上传过滤使用 `filterFilesWithOriginalIndex`，无目标节点和拖拽创建按原始 `FileList` 下标 stagger；替换目标节点时剩余文件也按原始 index 偏移。
- 检查器收起时不再轮询，展开后恢复；切换选中节点重置 job。
- 任务栏收起时不再占布局高度，但保留轮询和展开入口。
- `project.tsx` 删除节点时 abort 生成 / 轮询 controller，并清理记录，晚到结果不会回填已删除节点。
- `InfiniteCanvas` 根节点增加 `data-canvas-viewport`，供卡片定位计算可用区域。
- 两处非画布类型修复只影响编译，不改变运行逻辑。

## 七、测试执行结果

已实际执行：

| 命令 | 结果 |
| --- | --- |
| `node --experimental-strip-types --test` 运行布局 / 参数 / 文件索引 4 个测试文件 | 15 / 15 通过 |
| `node --test doubao-bridge/__tests__/request-params.test.mjs` | 4 / 4 通过 |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npm run build`（最终版本） | 成功，8321 modules，最长一次约 3m37s |
| `node --check doubao-bridge/server.mjs`、`lib/request-params.mjs` | exit 0 |

测试覆盖：

- 图片比例 / 尺寸 / 清晰度 / 数量 / 模式 / 参考图数量进入请求契约。
- 视频模型 / 比例 / 时长 / 清晰度 / 三种模式 / 附件数量进入请求契约。
- 桥接把 `size / resolution` 明确列为 unsupported，数量 / 时长收敛有原因。
- 过滤非图片文件后保留原始 index。
- 首次四个区域默认收起、用户状态可还原、损坏快照安全回退。
- 节点在左上 / 右下 / 左下、小屏、顶栏与底部工具栏 inset 的卡片位置和最大高度。

未执行：

- ESLint：项目没有 ESLint 配置或本地 `eslint` 依赖，未擅自安装。
- `npm test`：脚本使用 `bun test`，当前环境没有 `bun`；已用 Node 直接运行本轮相关测试。
- 真实浏览器 1920×1080 / 1600×900 / 1366×768 / 1280×720 视觉验收。
- 真实豆包 / Dola 账号生成、额度校验和真实网页参数读回。

## 八、尚未解决 / 必须真实环境验证

- 真实豆包网页是否按 `ratio / count / model / duration` 点选成功，是否真正接受视频 / 音频参考素材；本轮只验证了参数到达桥接和执行器 spec，没有消耗真实账号额度。
- `size / resolution` 在豆包网页没有控件，预期不会出现在 `actualParams`，只会显示在 `unsupportedParams`；不能把它写成真实生效。
- 真实任务取消后，后台 Runner 是否及时停止，仍需真实账号验证；代码已调用 `cancelJob` 并停止前端轮询。
- 1920×1080 / 1600×900 / 1366×768 / 1280×720 下卡片是否与工具栏 / 其他浮层重叠、刷新首帧是否有闪烁、任务栏浮动按钮是否与底部工具栏重叠，需要真实浏览器确认。
- 账号池收起仍保留 44px rail，属于为了保留展开入口和二维码弹窗的折中；是否进一步改成完全浮动由用户视觉验收决定。
- 图片 `mode` 目前是任务元数据，网页没有独立模式按钮；编辑 / 参考图的实际行为由附件决定。
- 构建仍有既有的 chunk > 500kB 和动态 / 静态混合导入警告，不是本轮引入的错误。

## 九、交付物

- 代码 diff：`docs/ai-handover/CANVAS_DOUBAO_FIX_2026-11-25.diff`
- 待测试记录：`docs/content/docs/progress/pending-test.mdx`
- 待办边界：`docs/content/docs/progress/todo.mdx`
- 变更记录：`CHANGELOG.md`

没有执行 `git add`、`git commit`、`git push`，没有 reset / checkout / stash / clean，工作区其他用户改动保持不变。
