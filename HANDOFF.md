# 离火源码包说明

这份包是**源码**，不含 `node_modules`、构建产物和本机运行时数据。按下面顺序即可在本机跑起来。

## 一、准备

- Windows（脚本都是 `.bat`，其他系统用等价命令）
- Node.js 20+ 与 pnpm（或 npm / bun）
- Python 3.10+（只有豆包账号池的「应用内扫码登录」才需要，见「四」）

## 二、装依赖并运行

```bash
cd web
pnpm install
pnpm dev            # 开发：http://localhost:3000
pnpm build          # 生产构建：产物在 web/dist
```

生产构建好后，回到仓库根目录双击 **`open-canvas.bat`**：它会用本机静态服务托管 `web/dist` 并打开浏览器，同时尝试拉起豆包账号池桥接服务（`:9091`）。

其他脚本：`stop-canvas.bat` 停服务，`start-canvas.bat` 起开发服务器。

## 三、两个可选能力（需要额外构建一次）

这两个工具是独立开源项目，产物体积大，所以没打进源码包，各自一条命令安装：

```bash
node scripts/install-director.cjs      # 页面版导演台（DirectorDesk，MIT）→ web/public/director-app
node scripts/install-director-3d.cjs   # 画布节点版 3D 导演台（MIT）→ web/public/director-3d，约 75MB 角色素材
```

装完重新 `pnpm build`，导航「导演台」和画布新建菜单里的「导演台」节点即可用。

## 四、豆包扫码登录依赖（venv）

豆包的账号、登录、生图/生视频统一由桥接服务 `doubao-bridge`（`:9091`，见「六点五」）负责，随 `open-canvas.bat` 自动启动，无需单独安装。

桥接的「应用内扫码登录」复用了 `.doubao-venv` 里 `doubao2api` 的 `QRLogin`（`doubao-bridge/qr-helper.py`）。该 venv 已随仓库保留；换机器若缺失，手动重建即可：

```bash
python -m venv .doubao-venv
.doubao-venv\Scripts\python.exe -m pip install doubao2api
```

> 原本机 `:9090` 的 doubao2api 免费额度服务已下线，不再需要 `install-doubao-service.cjs` / `start-doubao2api.bat` / 开机自启项。

## 五、配置 AI 接口

应用没有后端，AI 能力由你填的接口直连：

1. 右上角「配置 API」→「渠道」标签；
2. 点渠道卡片「编辑」，填 **接口地址**（OpenAI 兼容，如 `https://api.openai.com`）与 **API Key**；
3. 「选择模型」拉取或手填模型，给每个模型勾上能力（生图/视频/文本/音频）；
4. 保存。

密钥只存在浏览器本地（`localforage`，命名空间 `lihuo`），不会上传。

## 六、目录速查

```
web/                       前端应用（Vite + React 19 + Ant Design 6 + Tailwind 4 + Zustand）
  src/constant/app.ts      品牌配置中心（名称、仓库、存储命名空间）
  src/lib/app-theme.ts     Ant Design 主题
  src/lib/canvas-theme.ts  画布配色
  src/pages/canvas/        画布页与画布交互主逻辑
  src/components/canvas/nodes/lihuo/
                           自研节点：朱笺 / 提示词工坊 / 导演台 / 豆包视频 / 豆包图片
  src/components/canvas/canvas-doubao-accounts-panel.tsx   左侧豆包账号池
  src/components/canvas/canvas-inspector-panel.tsx         右侧属性/日志
  src/components/canvas/canvas-task-bar.tsx                底部任务队列
doubao-bridge/             豆包本地桥接服务（:9091，账号池 / 扫码 / 参数读取 / 任务执行）
vendor/doubao-brain/       doubao-brain 的 dbb CLI（MIT，浏览器自动化底座）
scripts/                   安装与本地静态服务脚本
docs/                      上游功能文档站
canvas-agent/              本地 Agent（可选，MCP）
canvas-proxy/              本地代理（可选，绕 CORS）
```

## 六点五、豆包账号池与生成（本轮新增，重点看这里）

**服务**：`doubao-bridge/server.mjs`，默认 `http://127.0.0.1:9091`，零依赖，随 `open-canvas.bat` 自动启动。

**账号隔离**：每个账号一个 `DBB_STATE_DIR` = `.doubao-accounts/<id>/state`，浏览器 profile、登录态、下载目录互不可见。

**登录**：应用内扫码（豆包 passport 接口出二维码，1 分钟过期自动换码）→ 扫码成功后在账号自己的浏览器里注入 cookie、重载页面、双重校验（会话 cookie + 页面无「登录」按钮）→ 通过才写 `storage-state.json`。

**参数读取（读一次缓存 12 小时）**：

- `GET /api/accounts/:id/video-caps` → 视频模型（Seedance 2.5 / 2.0 / 2.0 Fast / 2.0 Mini）、比例、时长（4–15s）
- `GET /api/accounts/:id/image-caps` → 图片模型（Seedream 5.0 Pro / Flash / 4.5 / 4.0）、比例
- 结果缓存在 `<state>/video-caps.json` / `image-caps.json`，卡片上直接作为固定选项

**生成**：`run-doubao.mjs` 真正驱动页面——打开账号浏览器 → 切能力 → **点选模型 / 比例 / 时长** → 传素材 → 发提示词 → 自动确认 → 等产物 → 下载 → 打印结果。生成的浏览器会保持打开方便观察。

**结果归属**：任务带 `nodeId`，哪张卡片发起就回填哪张卡片（卡片每 5 秒按 nodeId 自兜底），不另开结果节点。

**profile 释放**：每次生成前与打开账号窗口前都会强制释放该账号 profile（收查看器、上一个生成器、所有占用该 profile 的 Edge）；卡死时可手动 `POST /api/accounts/:id/release`。

**常用接口**：`/api/accounts`、`/api/accounts/:id/{open,close,release,qr-login,video-caps,image-caps,doctor}`、`/api/jobs`（支持 `?nodeId=`）、`/api/jobs/:id/files/:index`。

更多改造说明见 `DEVELOPMENT.md`，版本记录见 `CHANGELOG.md`。

## 七、已知注意点

- `web/public/director-3d/` 若未安装，画布里的「导演台」节点会提示安装命令，不影响其他功能。
- 豆包账号池桥接（`:9091`）通过浏览器自动化驱动豆包网页版，可用性与条款风险自担；账号数据与登录态在 `.doubao-accounts/` 下。
- 扫码登录依赖 `.doubao-venv`（见「四」）；换机器需手动重建该 venv。
