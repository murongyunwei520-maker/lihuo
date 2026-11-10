# 离火 Lihuo 项目概览

> 本文档供 AI 编程 Agent 快速了解项目全貌。
> 信息来源：源码审查 + 现有文档，标注「已验证」的内容来自当前代码。

## 一、项目定位

离火 Lihuo 是一个**基于 infinite-canvas 二次开发的 AI 创作平台**，核心是无限画布上的 AI 生成工作流。

- 基础引擎：infinite-canvas（开源画布）
- 二次开发方向：豆包账号池、视频生成、3D 导演台、提示词工坊等
- 主要用户：内容创作者（东方玄幻视频、图片生成）

## 二、技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | React + TypeScript + Vite |
| UI 组件 | Ant Design + Tailwind CSS |
| 状态管理 | Zustand |
| 画布引擎 | infinite-canvas（自研二次开发） |
| 桥接服务 | Node.js（doubao-bridge，:9091） |
| 浏览器自动化 | Playwright + Edge CDP |
| Python 依赖 | doubao2api（扫码登录用） |

## 三、目录结构（已验证）

```
lihuo/
├── web/                          # 前端项目
│   ├── src/
│   │   ├── components/canvas/     # 画布组件
│   │   ├── stores/                # Zustand 状态
│   │   ├── services/api/          # API 调用
│   │   ├── pages/                 # 页面
│   │   └── lib/canvas/            # 画布工具
│   └── package.json
├── doubao-bridge/                 # 豆包桥接服务（Node.js）
│   ├── server.mjs                 # HTTP 服务
│   └── run-doubao.mjs             # 子进程 Runner
├── vendor/doubao-brain/           # 豆包浏览器自动化库
├── canvas-agent/                  # Canvas Agent
├── canvas-proxy/                  # Canvas 代理
├── .doubao-accounts/              # 账号态目录（含 state/video-caps.json 等能力缓存）
├── docs/ai-handover/              # 本目录
├── AGENTS.md                      # AI 开发约束规则
├── HANDOFF.md                     # 部署交接文档
└── DEVELOPMENT.md                 # 开发文档
```

> ⚠️ 工程环境：该目录**不含 `.git`**，`git status` 会报 not a git repository。AGENTS.md 里的「发版本流程」需要先补建版本库才能执行，删除类操作不可回滚。

## 四、核心子系统

### 1. 无限画布系统
- 位置：`web/src/components/canvas/`
- 节点注册：`builtin-nodes.tsx` + `lihuo/index.tsx`
- 节点类型：图片、视频、音频、文本、组、便签、提示词工坊、导演台

### 2. 豆包生成链路
- 前端：`web/src/services/api/doubao-bridge.ts`
- 桥接：`doubao-bridge/server.mjs`（:9091）
- Runner：`doubao-bridge/run-doubao.mjs`
- 浏览器自动化：`vendor/doubao-brain/dbb/`
- 支持：图片生成、视频生成

### 3. 模型与 Provider 系统
- 配置存储：`web/src/stores/use-config-store.ts`
- 内置豆包 channel：`web/src/constants/doubao-builtin.ts`
- Schema 定义：`web/src/stores/model-schema.ts`（开发中）
- 动态面板：`web/src/components/DynamicParamsPanel.tsx`（开发中）

### 4. 豆包账号池
- 前端 store：`web/src/stores/use-doubao-account-store.ts`
- 后端：`doubao-bridge/server.mjs`
- 调度模式：manual（手动选账号）/ auto（自动分配，暂不可用）
- 浏览器：Edge CDP 连接已有窗口，一个号一个窗口

## 五、当前运行方式（已验证）

```bash
# 前端开发
cd web && pnpm dev

# 生产构建
cd web && pnpm build

# 启动完整服务（Windows）
双击 open-canvas.bat
```

前端静态服务端口：3000
豆包 Bridge 端口：9091
Edge CDP 端口：9470（豆包1账号）

## 六、关键约束（必须遵守）

- 不重写无限画布，不替换画布引擎
- 不删除已有二次开发功能
- 不擅自运行真实豆包生成任务（消耗额度）
- 不自动切换豆包账号
- 不伪造账号额度
- 修改前先读代码，最小范围修改
- 任何修改不覆盖用户已有未提交改动

---

**信息验证状态：**
- ✅ 目录结构：源码已验证
- ✅ 技术栈：package.json 已验证
- ✅ 端口号：HANDOFF.md 已验证
- ⚠️ 功能清单：详见 FEATURE_INVENTORY.md
