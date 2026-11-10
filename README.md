<p align="center">
  <img src="web/public/logo.svg" width="96" alt="Lihuo logo">
</p>

<h1 align="center">离火 · Lihuo</h1>

<p align="center">以火为笔，炼万象 —— 面向 AI 创作的无限画布工作台</p>

离火是基于开源项目 [无限画布 / infinite-canvas](https://github.com/basketikun/infinite-canvas) 二次开发的个人分支：保留上游完整的 AI 创作能力，替换为自己的品牌、配色与本地存储命名空间，并在其上搭了一套可以直接编译进主应用的自研节点框架。

## 核心功能

- **无限画布**：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- **AI 创作**：浏览器前台直连你配置的 OpenAI 兼容接口，支持文生图、图生图、参考图编辑、文本问答、音频和视频生成。
- **画布助手**：围绕选中节点和上游节点对话、生图，并把结果插回画布。
- **本地 Agent**：通过本机 Canvas Agent 连接 Codex / Claude Code，让 Agent 通过 MCP 操作当前画布。
- **插件系统**：支持通过 URL 动态安装 / 启用 / 更新 / 卸载远程节点插件，并提供 TypeScript SDK。
- **自研节点框架**：`web/src/components/canvas/nodes/lihuo/` 下自带「朱笺」「提示词工坊」两个示范节点，新增节点只需往定义数组里加一项。
- **提示词库**：内置多个开源提示词来源，支持自定义标准 JSON 来源，由浏览器前端直连并缓存到 IndexedDB。

## 快速开始

AI API Key、Base URL、画布、素材和生成记录默认保存在浏览器本地。

### Windows：双击即用

| 脚本 | 用途 |
| --- | --- |
| `open-canvas.bat` | **日常使用**：用生产构建起一个本机静态服务，并自动打开 `http://127.0.0.1:3000/`。首次运行会自动装依赖、构建，之后秒开。 |
| `stop-canvas.bat` | 停止后台服务。 |
| `start-canvas.bat` | **改代码时用**：起开发服务器（热更新），同样是 `http://127.0.0.1:3000/`。 |

`open-canvas.bat` 把服务放在最小化窗口里跑，不占桌面；关掉系统会话或双击 `stop-canvas.bat` 即可停止。

### 其他系统 / 手动启动

```bash
cd web
pnpm install     # 或 bun install / npm install
pnpm dev         # 开发服务器 http://localhost:3000
pnpm build       # 生产构建，产物在 web/dist
```

生产构建可以用任意静态服务器托管 `web/dist`；仓库里的 `scripts/serve.mjs` 是零依赖版本：

```bash
node scripts/serve.mjs web/dist 3000
```

## 配置模型接口（API Key 填在哪）

应用没有自己的后端，AI 能力由你填的接口直连。入口有两个，都在页面右上角：

- 导航条上的 **「配置 API」** 按钮（一直在）；
- 右侧头像区里的齿轮图标。

打开后切到 **「渠道」** 标签，点渠道卡片上的「**编辑**」（默认已内置一个 OpenAI 渠道；要接中转站就点「新增渠道」），然后填四样东西：

1. **接口地址**：你的 OpenAI 兼容地址。官方是 `https://api.openai.com`；用中转站就填对方给的地址（一般以 `/v1` 结尾或直接给域名）。
2. **API Key**：填 `sk-...`（中转站给的 key 同样填这里）。
3. **选择模型**：拉取或手动增加模型，并给每个模型勾上能力：**生图 / 视频 / 文本 / 音频**。
4. 点「保存」→ 关闭配置弹窗。回到首页，顶部「先配置模型接口」的提示条消失就代表可以直接出图了。

补充说明：

- 没配置时，首页顶部会有一条醒目提示条，点「去配置」直达；点了生成也会自动弹配置。
- 配置存在这台电脑的浏览器里（`localforage`，命名空间 `lihuo`），**不会上传到任何服务器**，换浏览器/清缓存需要重新填。
- 如果浏览器直连接口被跨域拦住，在配置里开启 **「本地代理」**，再按提示运行 `canvas-proxy` 转发。
- 接口的调用方式和默认实现不同（比如某些中转站要求特殊字段），可以在渠道里为该模型自定义 **调用脚本**。

首次打开后进入右上角配置，填入自己的 OpenAI 兼容 `Base URL` 和 `API Key`；如果接口调用方式和默认实现不同，可以在配置里自定义生图 / 视频 / 音频调用脚本。

Docker 部署沿用上游方案，见 `Dockerfile` 与 `docker-compose.yml`（镜像名、容器名已改为 lihuo，推送到自己的仓库后即可使用）。

## 导演台（3D 白模预演）

「导演台」页面内嵌了开源项目 [DirectorDesk](https://github.com/mangfufu/director-desk)（MIT）：搭白模场景、排人物走位、设摄影机与切镜，导出普通参考视频或深度视频，再交给视频模型。网页版不含桌面版的 AI 助手与 MCP。

它不在主应用源码里，装在 `web/public/director-app/`，由脚本构建：

```bash
node scripts/install-director.cjs
```

脚本会下载源码 → 安装依赖 → 用 `--base=/director-app/` 构建网页版 → 复制产物。装完重新构建即可在导航「导演台」里使用；没装时页面会显示这条命令。

### 导演台节点（画布内）

除了独立页面，画布新建菜单里还有 **「导演台」节点**：它内嵌的是 [xiaozangao/3d-director-desk](https://github.com/xiaozangao/3d-director-desk)（MIT，浏览器端 3D 运镜与分镜导演台），按项目官方的 iframe 嵌入协议接进来，装在 `web/public/director-3d/`。

节点版由脚本构建（约 75MB 角色素材，换机器或重新克隆后跑一次即可）：

```bash
node scripts/install-director-3d.cjs
```

用法：画布双击 → 选「导演台」→ 用节点工具栏的 **交互 / 移动** 开关切换「操作导演台」和「拖动节点」。在导演台里点「发送机位截图」后，截图会**直接在画布上生成图片节点**，可以接着连线喂给视频模型。

> 两个导演台分工：页面版（DirectorDesk）功能更全，适合完整预演；节点版（3d-director-desk）胜在嵌入画布、截图能直接变成节点。

## 豆包账号池（多账号 + 视频生成）

基于 [ops120/doubao-brain](https://github.com/ops120/doubao-brain)（MIT）的 `dbb` CLI。每个豆包账号使用**独立的 `DBB_STATE_DIR`**，浏览器 profile、登录态、下载目录完全隔离。

- 导航 **「豆包账号」**：添加账号 → 点「登录」在真实豆包页面扫码 → 「检测」读取真实登录态与可用模型 → 「设为当前」。
- 画布双击 → **「豆包视频」** 节点：选模式（文生 / 参考图 / 参考视频）→ 选账号或采用智能推荐 → **读取豆包实际能力** → 填提示词、加素材（本地上传或连线取上游节点）→ **确认生成**。
- 提交前会弹确认窗口，列出账号、模式、模型、素材、额度与风险；额度读不到时明确写「无法确认」，不编造数值。
- 三种模式共用同一套账号池和任务系统；同一账号同时只跑一个任务，不会自动轮换或失败自动切号。

桥接服务 `doubao-bridge` 默认 `http://127.0.0.1:9091`，随 `open-canvas.bat` 自动启动，也可单独运行 `node doubao-bridge/server.mjs`。账号数据在 `.doubao-accounts/` 下，按账号分目录。

> 该方案通过浏览器自动化驱动豆包网页版，可能不符合其服务条款，存在限流或封禁风险，请自行评估；额度与参数以豆包网页端为准。

## 关于 Canvas Studio（doubao-infinite-canvas）

[hrbj18/doubao-infinite-canvas](https://github.com/hrbj18/doubao-infinite-canvas) 是一个**独立的 Windows 桌面画布**（Electron，抽帧要本机 ffmpeg），不是一个能装进网页的插件，所以没有合并进来。它值得借鉴的是「按账号池管理 Seedance 免费额度 + 任务幂等排队」这套调度思路；要那套能力就单独装它的桌面版。

## 接入豆包 / 火山方舟（视频）

方舟为新用户提供模型体验额度，额度内可以免费出视频。接入不用改代码，用内置调用脚本模板即可：

1. 到火山方舟控制台开通视频模型，创建一个**推理接入点**（`ep-...`），记下 API Key；
2. 本应用「配置 API → 渠道」里新增一个渠道，**接口地址**填 `https://ark.cn-beijing.volces.com/api/v3`，**协议**选 OpenAI，填上 API Key；
3. 在「选择模型」里手动加一条，模型名填接入点 ID（或模型名），能力只勾 **视频**；
4. 打开该模型的「调用脚本」，模板选 **「火山方舟 · 豆包 Seedance」**，保存。

脚本会按方舟的异步流程提交 `POST /contents/generations/tasks` 并轮询 `GET /contents/generations/tasks/{id}`，成功后把视频地址回填到画布或工作台。额度用完会返回计费错误，按提示充值即可。

## 目录结构

```
lihuo/
├── web/                      前端应用（Vite + React 19 + Ant Design + Tailwind + Zustand）
│   └── src/
│       ├── constant/app.ts   品牌配置中心：名称、仓库、本地存储命名空间
│       ├── constant/         画布节点默认规格等常量
│       ├── lib/canvas-theme.ts  画布配色主题（浅色 / 深色）
│       ├── lib/app-theme.ts     Ant Design 品牌色与弹层配色
│       ├── components/canvas/nodes/
│       │   ├── builtin-nodes.tsx  内置节点注册
│       │   └── lihuo/              自研节点（朱笺 / 提示词工坊）
│       ├── pages/canvas/     画布页面与画布交互主逻辑
│       ├── stores/           Zustand 全局状态
│       ├── services/         浏览器直连的外部请求与本地存储
│       └── types/            画布与插件类型契约
├── plugins/canvas/           远程插件 SDK 与官方示例插件
├── canvas-agent/             本地 Agent（MCP 服务）
├── canvas-proxy/             本地代理，绕过浏览器跨域限制
└── docs/                     上游功能文档站
```

## 二次开发

改造入口、新增节点、换肤和发布流程都写在 [DEVELOPMENT.md](DEVELOPMENT.md) 里，建议先读它再动手。

最常用的两条：

- **换品牌**：只改 `web/src/constant/app.ts` 里的 `APP_BRAND`，以及 `web/src/i18n/locales/*` 里的界面文案。
- **加节点**：在 `web/src/components/canvas/nodes/lihuo/` 新建组件，然后往 `lihuo/index.tsx` 的 `LIHUO_NODE_DEFINITIONS` 里加一项。

## 上游与授权

- 本项目基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 二次开发，原作者与上游项目信息保留在页面导航与文档中。
- 前端页面标识与品牌已替换为「离火 / Lihuo」，功能实现来自上游社区。
- 采用 [MIT License](LICENSE)，可自由用于开源、闭源与商业场景。
- `docs/` 目录是上游功能文档站，用于查阅功能说明；其中品牌文案尚未整体替换。
