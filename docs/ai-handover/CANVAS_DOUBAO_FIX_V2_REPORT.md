# 离火无限画布第二轮修复报告（V2）

## 0. 交付摘要

本轮以 `lihuo3.zip` 解压出来的初代源码作为唯一真实基线，重新完成了豆包参数、账号选择、沉浸布局、节点配置卡片定位和若干前端稳定性修复，并生成全新补丁。

- 基线源码包：`C:\Users\qq308\Downloads\lihuo3.zip`
- 基线工作目录：`C:\Users\qq308\AppData\Local\Temp\lihuo-baseline-lihuo3`
- 基线提交（仅用于生成本地补丁）：`701c1d595e6c8dba9841a4b2d9cfe66281c5a452`
- 补丁：`CANVAS_DOUBAO_FIX_V2.patch`（28 个文件，146,438 字节，2,657 行）
- 补丁 SHA256：`12935A417F136589724C9F32B33C98EDFC918A11B3C21A0318B4F49D5154027A`
- 报告：`CANVAS_DOUBAO_FIX_V2_REPORT.md`
- 最终补丁交付位置：`docs/ai-handover/CANVAS_DOUBAO_FIX_V2.patch`
- 没有提交 Git，没有推送 GitHub，没有执行 `git reset` / `git clean` / `git checkout` / `git stash`。
- 没有把补丁应用到用户当前主工作区 `C:\Users\qq308\Desktop\lihuo`，避免覆盖用户已有未提交改动。

上一轮的 `CANVAS_DOUBAO_FIX_2026-11-25.diff` 与 `CANVAS_DOUBAO_FIX_2026-11-25.md` 只作为需求、问题线索和实现参考，没有直接应用，也没有把旧 diff 原样复制进 V2 补丁。

## 1. 基线确认

### 1.1 根目录与项目结构

`lihuo3.zip` 的真实根目录包含：

- `web/`：Vite + React + TypeScript 前端
- `doubao-bridge/`：豆包桥接服务、执行器、账号池和测试
- `canvas-agent/`：画布 Agent
- `vendor/`：豆包自动化依赖
- `scripts/`、Docker 配置、项目文档等

### 1.2 Web 依赖与状态方案

`web/package.json` 的实际技术栈：

- Vite `^7.3.0`（实际构建输出为 Vite `7.3.6`）
- React / React DOM
- TypeScript
- Ant Design `^6.4.2`
- Zustand
- TanStack Query
- `lucide-react`
- `localforage` 等

现有状态管理不是新引入的方案，而是继续使用项目已有的 Zustand store。没有新建第二套状态管理，也没有新建重复组件。

### 1.3 初代源码中的真实调用链

本轮的代码修改按照以下真实链路定位，而不是按旧报告的文件名硬套：

图片：

`web/src/pages/canvas/project.tsx` / 图片页面
→ `web/src/services/api/image.ts` 的 `requestGeneration` / `requestEdit`
→ `web/src/services/api/doubao-bridge-adapter.ts`
→ `web/src/services/api/doubao-bridge.ts`
→ `doubao-bridge/server.mjs`
→ `doubao-bridge/run-doubao.mjs`

视频：

`web/src/pages/canvas/project.tsx` / 视频页面
→ `web/src/services/api/video.ts` 的 `createVideoGenerationTask` / `pollVideoGenerationTask`
→ 同一个 adapter / bridge 客户端
→ `doubao-bridge/server.mjs`
→ `doubao-bridge/run-doubao.mjs`

独立节点：

`web/src/components/canvas/nodes/lihuo/doubao-image-node.tsx`
`web/src/components/canvas/nodes/lihuo/doubao-video-node.tsx`
→ 直接调用 `doubao-bridge.ts` 的 `uploadAttachment`、`createVideoJob`、`getJob`、`waitJob`

### 1.4 为什么旧补丁不能直接用

旧 diff 是在另一份代码状态下生成的；在实际 `lihuo3.zip` 上，多个文件的首部导入、组件签名、状态结构、函数实现都不同。例如当前初代源码的 `doubao-bridge-adapter.ts` 与旧 diff 假设的 adapter 不是同一版结构，`canvas-node.tsx` 的节点面板也内嵌在 `NodePanelShell` 中，而不是旧报告假定的独立文件路径。

因此本轮没有：

- `git apply` 旧 diff
- `git apply --3way`
- `git apply --reject`
- 假定旧报告中的路径全部存在

V2 补丁全部相对 `701c1d5` 的初代源码重新生成。

## 2. 第一优先级：豆包图片和视频参数传递

### 2.1 类型化参数契约

新增 `web/src/services/api/doubao-params.ts`，明确四层参数：

1. `requestedParams`：用户请求参数，原样记录，不因为网页不支持而丢弃。
2. `appliedParams`：其中的网页参数（model / ratio / duration / attachments）只有执行器明确回传证据时才写入；prompt / capability 属于任务输入与能力元数据。
3. `actualParams`：从任务文本/日志中读回的实际参数，读不到就是 `null`，不编造。
4. `unsupportedParams`：当前网页没有对应控件的参数，带原因。

契约中的适用字段只有：

- `model`
- `prompt`
- `ratio`
- `duration`
- `attachments`
- `capability`

以下字段只进入 `requestedParams`，同时进入 `unsupportedParams`：

- `size`
- `resolution`
- `quality`
- `count`
- `mode`
- `generateAudio`
- `watermark`

其中：

- `size`：豆包网页当前没有尺寸/像素输入控件，不能声称已应用。
- `resolution`：豆包网页当前没有清晰度/分辨率控件，不能声称已应用。
- `count`：网页一次任务只产出当前结果；画布需要多结果时拆成多个任务，不把 `count` 当成网页已生效。
- `mode`：只作为任务元数据；图生图/图生视频由上传参考素材触发，网页没有独立模式开关。
- `quality` / `generateAudio` / `watermark`：当前网页没有对应控件。

`appliedParams` 的来源是 `doubao-bridge/params.mjs` 的 `buildAppliedParams`：

- 首选 runner 输出中的 `payload.applied` 证据。
- 兼容旧执行器时，只有 `actual` 原文确实包含请求值才承认。
- 没有证据就留空，不把 `requestedParams` 整体复制成已生效。

### 2.2 图片链路

`web/src/services/api/image.ts`：

- `requestGeneration` 在豆包内置模型分支中传递：
  - `model`
  - `prompt`
  - `ratio`（由像素尺寸归一，无法识别则不猜）
  - `size`
  - `resolution`
  - `quality`
  - `count`
  - `mode`
  - `accountId`
- 新增 `requestEdit` 的豆包分支；初代源码此前没有豆包图片编辑分支。
  - 参考图经 `imageToDataUrl` 转成 `Blob`
  - 通过桥接上传为真实附件路径
  - `mode` 标记为 `image-edit`
  - 上传失败会抛出明确错误，不会静默丢掉附件继续生成。

`web/src/services/api/doubao-bridge-adapter.ts`：

- 图片任务通过 `createVideoJob` 的通用 job 创建接口提交，`capability` 为 `图像生成`。
- `requestedParams` 记录 `model / prompt / ratio / size / resolution / quality / count / mode / capability / attachments`。
- `count > 1` 时按顺序逐个创建并等待任务，避免同一账号并发达到上限后剩余任务直接 409。
- 结果使用任务文件自身的 `file.index`，不再使用过滤后数组下标；这修复了多文件时的结果串位风险。
- 文件下载 URL 统一走 `jobFileUrl(done.id, file.index)`。

`web/src/components/canvas/nodes/lihuo/doubao-image-node.tsx`：

- 参考图上传后记录真实路径。
- `requestedParams` 带 `size / resolution / count / mode / attachments`。
- 上传失败、读取参考图字节失败、模式需要参考图但没有素材，都会阻止提交并报错。
- 结果回填使用 `jobFileUrl(finished.id, image.index)`，不再按过滤后的索引猜测。

### 2.3 视频链路

`web/src/services/api/video.ts`：

- `createVideoGenerationTask` 的豆包分支不再自行取 `listAccounts()[0]`，改为调用 adapter。
- 传递：
  - `model`
  - `prompt`
  - `ratio`（`videoAspectRatio(config.size)` + 归一）
  - `duration`（`normalizeVideoSeconds(config.videoSeconds)`）
  - `size`
  - `resolution`（`normalizeVideoResolution(config.vquality)`）
  - `mode`
  - 参考图片
  - 参考视频
  - 参考音频
  - `accountId`
- `pollVideoGenerationTask` 使用 `jobFileUrl(job.id, video.index)` 取真实视频文件。
- `waitForVideoGenerationTask` 捕获 abort 时，只有豆包任务会调用 `cancelJob`，其余 provider 保持原行为。

`doubao-bridge-adapter.ts` 的视频路径：

- 参考图片、参考视频、参考音频分别转成 `Blob` 后上传。
- 上传失败逐个报错，错误中包含素材名；不会删掉附件后继续按纯文生视频提交。
- `mode` 由实际素材和显式模式共同归一：
  - 有参考视频 → `video-to-video`
  - 有参考图片 → `image-to-video` 或 `reference`
  - 无素材 → `text-to-video`
- `assertVideoMode` 会在“选了图生视频但没有可用图片”“选了参考视频但没有视频”时直接抛错。
- 音频单独存在、但没有任何图片/视频参考时也会报错，避免被当成纯文生视频。

`doubao-bridge/server.mjs`：

- 创建 job 时记录 `requestedParams`。
- 创建 job 前检查附件路径是否存在；不存在直接 HTTP 400，不会把坏路径传给执行器。
- 创建 job 时生成 `unsupportedParams`。
- 任务成功后，`appliedParams` 中的网页参数只有 runner 明确回传 `applied` 证据才写入；prompt / capability 来自任务本身。
- 任务失败时统一经过 `failurePayload`，额度类错误映射为 `QUOTA_EXCEEDED`。

`doubao-bridge/run-doubao.mjs`：

- 严格按 `model / ratio / duration` 点选网页控件，并读回校验。
- 模型或参数与画布选择不一致时直接报错，不按默认值偷偷生成。
- 参考素材上传后检查输入区素材元素数量；没有出现则报“上传可能失败”。
- 成功输出带 `applied` 证据。
- V2 在 `run-doubao.mjs` 中补齐了 `attachments` 证据。

### 2.4 参考素材与失败处理

- 上传入口：`doubao-bridge/server.mjs` 的 `POST /api/uploads?accountId=...&name=...`。
- 附件路径：每个账号自己的 `uploads/` 目录。
- 服务端在创建 job 前用 `fs.existsSync` 校验路径；缺失时 400，错误中包含文件名。
- runner 上传后检查页面输入区的素材元素变化；无变化直接失败。
- 前端 adapter 对每个素材单独包装错误，任何失败都会中断任务，不会静默删除附件。
- 这保证“用户选择图生视频但实际变成纯文生视频”不会发生。

### 2.5 账号池与账号选择

新增 `web/src/services/api/doubao-account-selection.ts` 的纯函数规则：

1. 显式节点账号优先。
2. 否则使用账号池当前选中账号。
3. 只有唯一一个已登录账号时才自动兜底，并写回账号池。
4. 多账号且没有选择时明确报错，不默认使用第一个。
5. 选中账号不存在、未登录时明确报错。
6. `manual` 选择不会被自动切换到其他账号。

前端调用链：

- `doubao-bridge-adapter.ts` 的 `resolveDoubaoAccountId` 使用上述纯函数。
- `image.ts` / `video.ts` 从 `config.doubaoAccountId` 传入节点显式账号。
- `buildGenerationConfig` 从节点 `metadata.accountId` 写入 `config.doubaoAccountId`。
- 独立豆包图片/视频节点在提交时校验 `selectedAccount` 是否仍存在、是否已登录。
- 账号池面板和节点刷新时，只有唯一一个已登录账号才自动兜底；多账号必须由用户手动选择。
- 账号池的登录、二维码、窗口、额度检测、任务历史代码未重写；只是在选择规则和错误提示上补齐。

### 2.6 `size` / `resolution` / `mode` 的真实边界

这不是“把参数传到后端就宣称生效”的实现：

- `size` / `resolution` 即使传到了 bridge，也只记录在 `requestedParams`，同时进入 `unsupportedParams`。
- runner 的 `spec` 中虽然保留这些字段，但 runner 不会伪造对应网页控件操作；`applied` 不包含它们。
- `mode` 作为任务元数据保存；真实是否图生视频由图生视频/参考素材上传和 runner 的上传检查决定。
- 报告和 UI 都不把 `requestedParams` 当成 `appliedParams`。

## 3. 第二优先级：画布沉浸模式

### 3.1 统一布局状态

新增 `web/src/stores/use-canvas-layout-store.ts`：

- `topBarOpen`
- `taskBarOpen`
- `accountPanelOpen`
- `inspectorOpen`

首次没有快照时四项全部为 `false`。

- 模块初始化只读一次 localStorage；React 重渲染不会重新初始化。
- 用户手动修改后同步持久化。
- 刷新时按已持久化快照恢复，不会先展开再自动收起。
- localStorage 读取和写入都有异常兜底；不可用时只保留内存态。
- 非法快照、损坏 JSON、非布尔值安全回退到全部收起。

### 3.2 四周区域真正释放布局宽高

- 顶部导航栏：条件渲染，收起时完全不占高度。
- 账号池：条件渲染，收起时完全不占宽度，且没有 44px/48px 收起轨道。
- 右侧属性栏：条件渲染，收起时完全不占宽度，且没有 44px/48px 收起轨道。
- 底部任务队列：绝对定位覆盖层，收起时完全不占高度。
- 左侧素材栏：沿用 `use-canvas-side-panel-store` 的挂载/卸载逻辑，首次默认收起；没有保留隐性占位宽度。

### 3.3 展开入口

新增 `web/src/components/canvas/canvas-immersive-dock.tsx`，作为画布左上角的悬浮入口：

- 顶部栏
- 素材栏
- 账号池
- 属性栏
- 任务队列

入口只覆盖画布，不占布局宽高。顶部栏展开时，入口自动下移到顶部栏下方。

用户可独立展开/收起每个区域；画布随可用空间自动适配。首次进入时画布占满可用区域。

### 3.4 状态区分

- 首次初始化：无快照 → 全收起。
- 页面刷新：读快照 → 保持用户上次状态。
- 项目切换：布局 store 不重置，避免每次切项目重新初始化。
- 用户手动展开/收起：写快照并立即生效。
- 损坏快照：回退全收起。

## 4. 第三优先级：节点配置卡片智能定位

### 4.1 实际组件位置

初代源码中真正负责节点配置卡片的是 `web/src/components/canvas/canvas-node.tsx` 内部的 `NodePanelShell`，不是旧报告假定的独立 `NodePanelShell` 文件。V2 保留这个组件，只替换其定位和渲染方式，没有创建重复组件。

### 4.2 定位算法

新增 `web/src/lib/canvas/node-panel-layout.ts` 的纯函数 `computeNodePanelLayout`：

- 默认在节点下方。
- 下方空间不足时翻到节点上方。
- 上方定位时避开节点上方的操作条（如果存在）。
- 左右边界都夹在画布可视区域内。
- 宽度按视口可用宽度自适应，限制最小/最大宽度。
- 最大高度按可用空间和底部工具栏预留计算。
- 内容超出时由面板自身 `overflow-y: auto` 内部滚动。
- 避开底部工具栏的 72px 预留区域。

### 4.3 Portal 与事件驱动定位

`NodePanelShell` 使用 `createPortal` 到 `document.body`，面板本身 `position: fixed`：

- 不会被画布 `overflow: hidden` 裁剪。
- 不受画布 transform/zoom 缩放影响。
- 节点拖动、画布平移/缩放、窗口尺寸变化时，重新计算位置。
- 面板自身尺寸变化通过 `ResizeObserver` 触发。
- 节点位置/尺寸变化通过 `ResizeObserver` 和 `MutationObserver` 触发。
- 浏览器窗口 resize、document scroll capture 触发。
- 顶部栏展开/收起时，重新计算顶部 inset。
- 每次事件只排一帧 `requestAnimationFrame`；画布静止后没有持续循环。
- 卸载时清理 `ResizeObserver`、`MutationObserver`、window/document 监听器和未执行的 rAF。

### 4.4 交互与层级

- 面板 `z-index` 为 70，高于画布和顶部栏，低于 Ant Design Modal（1000）。
- 面板外层阻止 pointer/mouse 事件冒泡，避免拖动画布或误触节点。
- 输入框、下拉框、按钮仍在原 React 树中，只改变渲染容器；状态不会因为 Portal 丢失。
- 面板关闭时随节点组件卸载，不残留全局 DOM。
- 通过 `measureFocusFrame` 适配新的 `data-node-panel` 查询位置。

## 5. 第四优先级：有代码依据的前端修复

### 5.1 任务取消真正通知后台

- `doubao-bridge.ts` 新增 `cancelJob`。
- `waitJob` 支持 `AbortSignal`，abort 或超时会调用 `cancelJob`。
- `server.mjs` 新增 `POST /api/jobs/:id/cancel`。
- 取消时执行器进程树会被终止；Windows 使用 `taskkill /pid <pid> /T /F`，避免 runner 退出但浏览器/子进程继续占用并消耗额度。
- 取消标记会在 `runJob` 真正开跑前再次检查；即使任务在 POST 返回后、启动前被取消，也不会偷偷继续执行。
- 取消后 job 状态为 `failed` + `error.reason = CANCELLED`。

### 5.2 删除节点阻止晚到结果

- `project.tsx` 删除节点时，遍历 `generationRequestsRef`，中止 target 或 origin 命中的生成请求，并删除对应 key。
- 删除后 `setNodes` 过滤节点，晚到的回调即使到达也不会找到节点，不会回填到已删除节点。
- 视频 abort 经由 `waitForVideoGenerationTask`/`waitJob` 通知桥接取消。

### 5.3 图片结果原始文件索引

- adapter、独立豆包图片节点、视频任务均改为使用 `file.index`。
- 不再使用 `done.files.filter(...)` 后的数组下标。
- 视频任务使用 `jobFileUrl(job.id, video.index)`。

### 5.4 视频任务 provider 持久化

- `CanvasNodeMetadata.videoTaskProvider` 增加 `"doubao"`。
- `project.tsx` 创建任务时，将 provider 持久化为 `openai` / `gemini` / `doubao`。
- 页面刷新恢复视频任务时：
  - 先看 `videoTaskProvider`；
  - 没有时看 metadata model / config model 是否豆包内置模型；
  - 避免把豆包任务误当 OpenAI 任务轮询。
- 独立豆包视频节点不依赖 `videoTaskProvider`，继续按自己的 `jobId` 轮询。

### 5.5 localStorage 与 side panel

- 新增布局 store 的读写异常兜底。
- `use-canvas-side-panel-store.ts` 的宽度、展开状态、节点视图读写都增加异常兜底。
- 首次无配置默认收起，用户手动打开后持久化。
- 没有破坏原有素材栏的拖拽宽度、节点列表/网格视图等功能。

### 5.6 其他有依据的修正

- `canvas-toolbar.tsx` 的左边界从硬编码 `300` 改为 `16`，避免左侧栏收起后工具栏仍然被挤在中间。
- `infinite-canvas.tsx` 增加 `data-canvas-viewport` 标记，供节点面板定位使用。
- `canvas-node.tsx` 的节点面板查询改为 Portal 后的 `data-node-panel="${nodeId}"`。
- `canvas-task-bar.tsx` 改为接收 `open/onClose`，关闭时停止轮询定时器。
- `canvas-inspector-panel.tsx` 增加 `open/onClose`，关闭时停止轮询。
- `canvas-doubao-accounts-panel.tsx` 增加 `onClose`，收起时不再用 44px 轨道占位。
- `use-config-store.ts` 只增加可选 `doubaoAccountId` 字段，用于节点显式账号传递。
- `canvas-generation-helpers.ts` 只增加 `doubaoAccountId` 映射。

## 6. 上一轮补丁 10 个问题的复核结果

| 上轮问题 | V2 处理 |
| --- | --- |
| 1. 节点卡片持续 rAF 循环 | 改为事件驱动，一次事件只排一帧；静止后不计算 |
| 2. 右侧面板是否释放布局宽度 | 条件渲染，关闭后不占宽度，无 44px rail |
| 3. 账号池收起后是否占布局宽度 | 条件渲染，关闭后不占宽度 |
| 4. 底部任务栏收起后是否占高度 | 绝对定位覆盖层，关闭后无高度 |
| 5. 图片结果是否使用原始文件索引 | 全部使用 `file.index` |
| 6. 任务取消是否通知后台 | `cancelJob` + server cancel endpoint + 进程树终止 |
| 7. 删除节点后是否阻止晚到结果 | 删除时 abort 生成请求；节点删除后结果无处回填 |
| 8. 账号池选择与实际生成账号是否一致 | 纯函数规则 + adapter + 节点显式账号校验 |
| 9. 是否存在不存在的组件路径 | 已按初代源码定位；没有虚构 `NodePanelShell` 文件 |
| 10. 是否错改无关业务代码 | 只改参数、布局、定位、任务取消相关文件；未重写素材、登录、画布核心交互 |

## 7. 测试与验证结果

### 7.1 补丁应用检查

在重新解压的干净 `lihuo3.zip` 上执行：

```bash
git apply --check CANVAS_DOUBAO_FIX_V2.patch
```

结果：通过。补丁 28 个文件全部检查通过。

随后在干净副本上实际执行 `git apply`，再执行以下检查，确认补丁后的代码可独立构建。

### 7.2 TypeScript

```bash
cd web
node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

结果：退出码 0，无类型错误。

### 7.3 Web 测试

```bash
cd web
bun test
```

结果：

- 31 pass
- 0 fail
- 92 个 expect
- 4 个测试文件

其中新增 `web/tests/doubao-v2-params.test.ts` 覆盖：

- 参数契约字段保留
- `size/resolution/quality/count/mode` 进入 unsupported
- 比例像素归一
- 视频模式归一
- 清晰度归一
- 账号选择：显式优先、当前选中、多账号报错、唯一登录兜底
- 布局快照：首次全收起、手动状态持久化、损坏快照回退
- 节点卡片四边界定位和 maxHeight

### 7.4 桥接语法与单元测试

```bash
node --check doubao-bridge/server.mjs
node --check doubao-bridge/run-doubao.mjs
node --check doubao-bridge/params.mjs
node --test doubao-bridge/test/params.test.mjs
```

结果：

- 三个 `node --check` 均退出码 0
- `params.test.mjs`：4 pass / 0 fail

覆盖：

- requested 中网页没有控件的参数进入 unsupported
- 只有执行器证据才进入 applied
- 旧执行器只有在 actual 原文出现请求值时才承认
- 额度不足映射为 `QUOTA_EXCEEDED`

### 7.5 桥接集成测试（假执行器）

使用临时账号目录、假 `dbb`/假 runner、`DOUBAO_SKIP_VIEWER=1`，在补丁应用后的干净副本上执行：

- 上传参考文件成功
- 创建视频 job 成功
- job 最终 `succeeded`
- `appliedParams` 为：

```json
{
  "prompt": "参考图生成视频",
  "capability": "视频生成",
  "model": "Seedance 2.5",
  "ratio": "9:16",
  "duration": 8,
  "attachments": 1
}
```

- `unsupportedParams` 包含：
  - `size`
  - `resolution`
  - `count`
  - `mode`
- 缺失附件路径返回 HTTP 400
- 取消接口返回 `{ ok: true, cancelled: true }`
- 取消后任务最终为 `failed`，`error.reason = CANCELLED`

该测试验证的是桥接任务编排、参数记录、附件校验和取消链路，不是真实豆包网页生成。

### 7.6 生产构建

```bash
cd web
node ./node_modules/vite/bin/vite.js build
```

结果：构建成功。

- Vite `7.3.6`
- 7,859 modules transformed
- 构建产物正常生成

构建过程有以下既有警告，未导致失败，也不是本轮引入：

- `image-storage.ts` 同时被动态和静态导入
- `use-canvas-store.ts` 同时被动态和静态导入
- 主 chunk 超过 500 kB（产物约 3.7 MB，gzip 约 1.1 MB）

### 7.7 验证环境说明

- Web 依赖通过 Node modules Junction 复用主工作区已有依赖，没有把 `node_modules` 打进补丁。
- 使用临时 Bun 可执行文件运行测试。
- 补丁已在新解压的干净源码目录中实际应用后重新执行类型检查、测试、桥接检查和构建。
- 没有伪造测试结果。

## 8. 结论分级

### A. 已通过代码测试的内容

- 补丁可无冲突应用
- TypeScript 类型检查
- Web 全量测试 31 pass
- 桥接 params 单元测试 4 pass
- 桥接 server/runner/params 语法检查
- 假执行器桥接集成测试：参数 applied/unsupported、附件 400、取消终态

### B. 已通过构建的内容

- Vite 生产构建
- 在干净源码上应用 V2 补丁后再构建

### C. 仅完成静态/算法检查的内容

- 节点配置卡片四边界定位算法（纯函数测试）
- 沉浸布局 store 的状态解析和默认值
- Portal、事件监听清理、账号选择规则的代码审查
- 画布核心交互（拖动、缩放、多选、分组、连线等）未重写，只做了回归性静态审查

### D. 需要真实豆包账号验证的内容

- 真实网页模型选择是否与 `applied` 回执一致
- 真实比例/时长是否按 runner 点选生效
- 真实参考图片、视频、音频上传是否出现在豆包输入区
- 真实额度不足是否返回 `QUOTA_EXCEEDED`
- 真实取消是否终止后台执行器和豆包浏览器进程
- 真实多账号是否严格按显式选择/账号池选择执行
- 真实任务产物 index 与下载文件是否一一对应

### E. 需要浏览器人工验收的内容

- 1920×1080、1366×768、1280×720、1024×768 四档窗口下首次进入是否四周全收起
- 顶部栏、素材栏、账号池、属性栏、任务队列逐个展开/收起是否互不影响
- 刷新后是否保持用户设置，且没有“先展开再收起”的闪烁
- 节点配置卡片在节点下方/上方、左右边界、底部工具栏附近是否不越界
- 小屏幕下卡片内容是否内部滚动
- 画布平移、缩放、节点拖动时卡片是否跟随
- Portal 面板内输入框、下拉框、按钮是否可正常点击
- 关闭面板后是否有残留遮罩、监听器或层级冲突

## 9. 新增与修改文件清单

### 9.1 新增文件（9 个）

- `doubao-bridge/params.mjs`
- `doubao-bridge/test/fake-runner.mjs`
- `doubao-bridge/test/params.test.mjs`
- `web/src/components/canvas/canvas-immersive-dock.tsx`
- `web/src/lib/canvas/node-panel-layout.ts`
- `web/src/services/api/doubao-account-selection.ts`
- `web/src/services/api/doubao-params.ts`
- `web/src/stores/use-canvas-layout-store.ts`
- `web/tests/doubao-v2-params.test.ts`

### 9.2 修改文件（19 个）

- `doubao-bridge/run-doubao.mjs`
- `doubao-bridge/server.mjs`
- `web/src/components/canvas/canvas-doubao-accounts-panel.tsx`
- `web/src/components/canvas/canvas-inspector-panel.tsx`
- `web/src/components/canvas/canvas-node.tsx`
- `web/src/components/canvas/canvas-task-bar.tsx`
- `web/src/components/canvas/canvas-toolbar.tsx`
- `web/src/components/canvas/infinite-canvas.tsx`
- `web/src/components/canvas/nodes/lihuo/doubao-image-node.tsx`
- `web/src/components/canvas/nodes/lihuo/doubao-video-node.tsx`
- `web/src/lib/canvas/canvas-generation-helpers.ts`
- `web/src/pages/canvas/project.tsx`
- `web/src/services/api/doubao-bridge-adapter.ts`
- `web/src/services/api/doubao-bridge.ts`
- `web/src/services/api/image.ts`
- `web/src/services/api/video.ts`
- `web/src/stores/use-canvas-side-panel-store.ts`
- `web/src/stores/use-config-store.ts`
- `web/src/types/canvas.ts`

补丁共 28 个文件，`node_modules`、`web/dist`、临时测试脚本、旧 diff/旧报告均未包含。

## 10. 应用方式

建议在干净的 `lihuo3.zip` 解压目录或与基线一致的分支上：

```bash
git apply --check CANVAS_DOUBAO_FIX_V2.patch
git apply CANVAS_DOUBAO_FIX_V2.patch
```

不要使用：

```bash
git apply --3way
git apply --reject
```

如果依赖未安装，先按原项目方式安装 `web` 和 `doubao-bridge` 所需依赖；补丁本身不包含 `node_modules`。

## 11. 已知边界

1. `size` / `resolution` 当前没有对应网页控件，已在 `unsupportedParams` 明确标记，不能视为已生效。
2. `mode` 是任务元数据；实际生成模式由参考素材和 runner 上传行为决定。
3. `count` 由画布侧拆分多次单产物任务，网页任务本身不按 count 一次返回多张；报告不把它写成网页参数已应用。
4. `actualParams` 依赖执行器回传文本或 stderr；真实网页没有回传时保持为空，不用猜测填充。
5. 桥接测试开关 `DOUBAO_RUNNER_SCRIPT` / `DOUBAO_SKIP_VIEWER` 保留为环境变量覆盖，默认仍是真实窗口和真实 `run-doubao.mjs`；未改变生产默认行为。
6. 真实豆包账号的额度消耗未在本轮执行，真实网页的模型/比例/时长/素材上传/取消需要单独验收。
7. 本轮没有对用户当前 `C:\Users\qq308\Desktop\lihuo` 做同步、提交或覆盖；补丁位于 `docs/ai-handover/`，由用户决定在哪个干净分支或工作树应用。
