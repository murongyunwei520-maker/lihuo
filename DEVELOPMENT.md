# 二次开发指南

面向这个分支（离火 / Lihuo）的改造说明。上游功能文档在 `docs/`，本文只讲「怎么改」。

## 1. 运行环境

```bash
cd web
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # 产物在 web/dist
pnpm typecheck  # tsc --noEmit
```

Windows 上仓库根目录还有三个脚本：`open-canvas.bat`（生产包 + 本机静态服务 + 自动开浏览器，日常使用）、`stop-canvas.bat`（停服务）、`start-canvas.bat`（开发服务器）。

生产包由一个零依赖静态服务器托管，方便分发给别人或自己长期使用：

```bash
node scripts/serve.mjs web/dist 3000
```

- 前端：Vite 7 + React 19 + TypeScript + Ant Design 6 + Tailwind 4 + Zustand 5 + React Router 7。
- 没有自己的后端：AI 请求、画布、素材、配置全部在浏览器里，直接请求你配置的 OpenAI 兼容接口。
- `canvas-agent/`（本地 Agent，MCP）和 `canvas-proxy/`（本地代理，绕开跨域）是可选组件，不影响前端单独运行。

## 2. 一次渲染的数据流

```
Zustand store（画布/配置/主题）
        │
        ▼
pages/canvas/project.tsx        画布主逻辑：拖拽、连线、生成、撤销重做
        │  CanvasNodeData[]
        ▼
components/canvas/canvas-node.tsx
        │  getNodeDefinition(type)  ← lib/canvas/node-registry.ts
        ▼
CanvasNodeDefinition.Content / Panel / toolbar
        │  buildNodeContext()       ← lib/canvas/plugin-node-context.ts
        ▼
节点组件（内置节点、自研节点、远程插件节点共用这一条链路）
```

关键点：**内置节点、自研节点、远程插件节点走的是同一套注册表和同一套上下文**，所以自研节点不需要改动画布主逻辑。

## 3. 品牌改造入口

| 要改什么 | 改哪里 |
| --- | --- |
| 应用名、英文名、标语、仓库地址 | `web/src/constant/app.ts` 的 `APP_BRAND` |
| 浏览器标题、描述、首屏主题脚本 | `web/index.html` |
| Logo | `web/public/logo.svg`（纯色 `currentColor`，会被 mask 成主题色） |
| 界面文案 | `web/src/i18n/locales/zh-CN.ts` / `en-US.ts` |
| 画布配色（背景、节点、工具栏、连线） | `web/src/lib/canvas-theme.ts` |
| Ant Design 主色与弹层配色 | `web/src/lib/app-theme.ts` |
| 页面级 CSS 变量（shadcn 组件） | `web/src/styles/globals.css` |

### 本地存储命名空间

`APP_BRAND.namespace`（当前是 `lihuo`）是所有浏览器本地数据的命名空间前缀：

- Zustand 持久化键：`storageKey("canvas_store")` → `lihuo:canvas_store`；
- localforage 实例名：`STORAGE_NAMESPACE` → 画布、素材、生成记录、提示词缓存；
- 导入导出的 `app` 字段：用 `typeof STORAGE_NAMESPACE` 约束，导出的文件只能被同命名空间的应用识别。

改命名空间等于换一套干净的本地数据，旧数据不会自动迁移。

### 版本检查

`APP_BRAND.repoUrl` 为空时，前端不做远程版本检查，只展示本地 `CHANGELOG.md`（构建时通过 `__APP_RELEASES__` 注入）。填上自己的 GitHub 仓库地址后，会自动去 `raw.githubusercontent.com` 拉 `VERSION` 和 `CHANGELOG.md`。

## 4. 自研节点框架

目录：`web/src/components/canvas/nodes/`

```
builtin-nodes.tsx     内置节点（图片/文本/配置/视频/音频/分组）
lihuo/
  index.tsx           自研节点定义数组 + registerLihuoNodes()
  lihuo-note.tsx      朱笺：本地便签
  prompt-lab.tsx      提示词工坊：AI 改写 + 面板
  director-node.tsx   导演台：iframe 嵌入 3D 预演，截图回传成图片节点
```

### 内嵌型节点（以导演台为例）

`director-node.tsx` 演示了「把外部 web 应用装成画布节点」的完整做法：

- 产物放 `web/public/director-3d/`，用 `--base=/director-3d/` 构建，避免和主应用的 `/assets` 冲突；
- 节点 `Content` 里放 `iframe`，通过 URL 参数 `instanceId=<nodeId>` 让外部应用按节点隔离工程；
- `interactionToggle: true` + `defaultMetadata.content` 让节点默认不可交互（可以拖动），需要用工具栏「交互」按钮切换；
- 用 `window.addEventListener("message")` 接收外部应用的 `storyai:director-desk-captures-sent`，再用 `ctx.applyOps([{ type: "add_node", nodeType: "image", ... }])` 把截图变成画布节点。

要再接一个类似工具，照这个文件改 `src`、消息类型和回传处理即可。

### 豆包账号池（doubao-brain 桥接）

真正的执行者是 `vendor/doubao-brain/dbb/cli.mjs`（MIT，官方 CLI 驱动豆包网页版）。我们只做两件事：账号隔离和编排。

```
doubao-bridge/server.mjs     本地 HTTP 服务（:9091），零依赖
vendor/doubao-brain/dbb/     上游 CLI（不要改它的业务逻辑）
vendor/doubao-brain/deps-template/  预装好的 playwright-core，新账号复制一份即可
```

关键约定：

- 每个账号一个状态目录 `.doubao-accounts/<id>/state`，通过环境变量 `DBB_STATE_DIR` 传给 dbb；cwd 固定为该账号的 `work/`，保证 dbb 的 workspaceId 稳定。
- 桥接只调 dbb 的公开命令：`login` / `logout` / `doctor --deep` / `list-models` / `ask --json`，不自己实现页面操作，也不造假数据。
- `ask` 的 JSON 契约：成功是 `{ ok: true, files: [{ file, kind, ... }], modes, text }`，失败是 `{ ok: false, reason, message }`；桥接原样透出 `reason`，前端按失败码提示。
- 额度：dbb 没有额度接口，前端一律显示「无法确认」，不要补默认值。
- 时长/分辨率/比例：dbb 不提供修改参数（豆包页面生成前自己列并确认），前端只做说明，不传这些参数。
- 同一账号并发上限 1 个任务，桥接用 `runningByAccount` 拦截；前端不自动换号。

前端入口：`pages/doubao`（账号中心）、`components/canvas/nodes/lihuo/doubao-video-node.tsx`（生成节点）、`services/api/doubao-bridge.ts`（客户端）、`stores/use-doubao-account-store.ts`（当前账号）。

节点落产物用桥接地址 `http://127.0.0.1:9091/api/jobs/<id>/files/<i>` 直接喂给视频节点；所以重开画布时需要桥接服务在运行。

`registerLihuoNodes()` 在 `pages/canvas/project.tsx` 模块加载时和 `registerBuiltinNodes()` 一起调用一次。注册表一变，创建菜单、小地图、节点渲染会自动更新。

### 节点定义字段

`CanvasNodeDefinition`（`web/src/types/canvas-plugin.ts`）里常用的字段：

| 字段 | 作用 |
| --- | --- |
| `type` | 节点类型 id，自研节点用 `lihuo:<name>` |
| `title` / `icon` / `description` | 创建菜单与列表里展示的名称、图标、说明 |
| `defaultSize` / `defaultMetadata` | 新建节点时的尺寸和初始 metadata |
| `Content` | 节点卡片内的渲染组件，收到 `{ ctx }` |
| `Panel` | 节点下方展开的面板，收到 `{ ctx, onClose }` |
| `hidePanel` | 不弹面板（纯展示 / 记事节点） |
| `autoOpenPanel` | 新建后自动展开自定义面板 |
| `toolbar` | 追加到节点悬浮工具栏的按钮 |
| `resource` | 把这个节点当成上游素材暴露给下游（`text` / `image` / `video` / `audio`） |
| `minimapColor` | 小地图里的节点颜色 |
| `interactionToggle` | 需要内嵌 iframe / 画布类交互内容时才开 |

### 节点上下文（ctx）

`CanvasNodeContext` 是节点和画布之间的唯一接口：

```ts
ctx.node                      // 当前节点数据
ctx.theme                     // 当前画布主题色
ctx.updateMetadata(patch)     // 改节点 metadata（触发持久化）
ctx.updateNode(patch)         // 改标题 / 宽高
ctx.getNodes() / ctx.getUpstream() / ctx.getDownstream()
ctx.applyOps(ops)             // 用 Agent 指令集增删节点、连线、改视口
ctx.ai.generateText/Image/Video(prompt, options)   // 复用宿主的模型与密钥
ctx.openPanel() / ctx.closePanel()
ctx.storage.get/set/remove    // 按插件 id 隔离的私有存储
ctx.emit/on                   // 节点、插件之间的事件总线
```

`ctx.applyOps` 是操作画布的统一入口，例如「插入一个文本节点」：

```ts
ctx.applyOps([
    {
        type: "add_node",
        nodeType: "text",
        title: "提示词",
        position: { x: ctx.node.position.x + ctx.node.width + 48, y: ctx.node.position.y },
        metadata: { content: result },
    },
]);
```

### 新增一个节点

1. 在 `lihuo/` 下新建组件文件，导出 `Content`（需要面板再导出 `Panel`）。
2. 在 `lihuo/index.tsx` 的 `LIHUO_NODE_DEFINITIONS` 里追加一项。
3. `pnpm typecheck`，刷新页面即可在「新建节点」菜单看到它。

最小骨架：

```tsx
// lihuo/hello-node.tsx
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export const HELLO_NODE_TYPE = "star:hello";

export function HelloContent({ ctx }: { ctx: CanvasNodeContext }) {
    return (
        <div data-canvas-no-zoom className="size-full p-3" style={{ color: ctx.theme.node.text }}>
            {ctx.node.metadata?.content || "你好，星图"}
        </div>
    );
}
```

```tsx
// lihuo/index.tsx 里追加
{
    type: HELLO_NODE_TYPE,
    title: "示例节点",
    icon: <Sparkles className="size-4" />,
    defaultSize: { width: 240, height: 160 },
    defaultMetadata: { content: "" },
    hidePanel: true,
    Content: HelloContent,
}
```

### 节点里的交互注意事项

画布对指针事件有自己的处理，写节点 UI 时注意这几条，否则会出现「拖不动 / 点不动 / 编辑退不出去」：

- 节点内的按钮、输入框、可点击区域：在 `onMouseDown` / `onPointerDown` 上 `stopPropagation()`，避免触发节点拖动。
- 需要自定义的浮层（下拉、调色板、弹窗）：加 `data-canvas-no-zoom`，避免被画布缩放。
- 判断「点击节点外部」时用 `pointerdown` 的 capture 阶段：宿主会在 `pointerdown` 上 `preventDefault`，普通 `mousedown` 不会触发。
- 高频写 `updateMetadata` 会让整张画布重渲染并落盘，流式输出这类高频状态优先放在组件本地 state，结束时再一次性写回。
- 节点内容默认可以接收指针事件；只有声明了 `interactionToggle` 的节点才受「移动 / 交互」开关控制。

### 自研节点 vs 远程插件

| | 自研节点 | 远程插件 |
| --- | --- | --- |
| 位置 | 编译进主应用 | 运行时从 URL 加载 |
| 用到的 API | 直接 import 主应用模块 | 只能通过插件 SDK / `ctx` |
| 适合 | 常驻核心能力、需要复用主应用代码 | 分发给别人、独立迭代 |
| 注册 | `registerNodeDefinitions(defs, "star")` | 安装后自动注册 |

两者共用 `CanvasNodeDefinition` 契约，所以原型可以先写成远程插件，验证后再搬进 `lihuo/`。

## 5. AI 调用链路

`web/src/services/api/` 是唯一的外部请求出口：

- `request.ts`：底层 fetch，负责超时、错误归一化；
- `image.ts` / `video.ts` / `audio.ts`：按能力拆分，支持自定义调用脚本（`services/api/model-plugin.ts`）；
- `services/api/*` 都只接收 `AiConfig`，不直接读 store，方便被节点、Agent、工作台复用。

模型与密钥来自 `stores/use-config-store.ts`，存在浏览器本地（`localforage`），不会上传。

### 5.1 豆包 / Dola 桥接的视频编码

- 豆包成片是 H.264（`avc1`），Dola 成片是 HEVC（`hvc1`）。Chrome / Edge 没装 HEVC 解码器时只能解析出时长、画面全黑（`canPlayType('video/mp4; codecs="hvc1…"')` 返回空串）。
- 执行器（`doubao-bridge/run-doubao.mjs`）在回传前会读 `stsd` 里**视频轨**的编码（音频轨 `mp4a` 排在前面，不能只看第一条）；识别到 HEVC 就调用 ffmpeg 转成 H.264（`libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart`），转码失败或没有 ffmpeg 时在运行日志里明确写出原因。
- ffmpeg 按「`vendor/ffmpeg/ffmpeg.exe` → 环境变量 `FFMPEG_PATH` → `PATH`」的顺序查找。项目自带的这份是 Windows 静态构建（`ffmpeg-master-latest-win64-gpl`，约 160MB），**不进 git**（`.gitignore` 已排除 `vendor/ffmpeg/`）。
- 换新版本：把新的 `ffmpeg.exe` 覆盖到 `vendor/ffmpeg/ffmpeg.exe` 即可，要求带 `hevc` 解码器与 `libx264` 编码器（`ffmpeg -decoders | grep hevc`、`-encoders | grep libx264` 可验）。

## 6. 灵感图鉴

首页「灵感图鉴」的作品图随包发布，不走任何外部接口，因此离线也能打开、点击能看大图。

- 图片文件：`web/public/gallery/*.svg`（构建时原样复制到 `dist/gallery/`）
- 作品清单：`web/src/constant/gallery.ts` 的 `GALLERY_ITEMS`（标题、描述、标签、尺寸）
- 分类胶囊：同文件的 `GALLERY_TAGS`

**换图有两种方式**

1. 直接替换：把自己的图（PNG/JPG/SVG 都行）放进 `web/public/gallery/`，再改 `GALLERY_ITEMS` 里对应的 `src`、`title`、`tag`、`width`、`height`。宽高一定要填对，卡片靠它占位，漏填会在滚动时抖动。
2. 重新生成：改 `scripts/gen-gallery.cjs` 里的 `ITEMS`、配色或图案函数，然后跑

```bash
node scripts/gen-gallery.cjs
```

脚本会按固定随机种子重写 `web/public/gallery/`，并清掉不再被引用的旧图。

作品图目前是纯矢量（单张 2–15KB），所以整组图鉴只增加约 50KB。

## 7. 发版

1. 把 `CHANGELOG.md` 的 `Unreleased` 整理成新的版本段落（保留 `## Unreleased` 标题，条目用 `+ [新增] / [调整] / [修复] / [优化]` 开头）。
2. 提升根目录 `VERSION`。
3. 提交并打 tag。

`web/vite.config.ts` 在构建时读取 `VERSION` 与 `CHANGELOG.md`，分别注入 `__APP_VERSION__` 和 `__APP_RELEASES__`，所以两者的格式不能随意改。
