# components/ · 离火核心组件规范

每个模块一份文档，覆盖结构、尺寸、状态、交互与禁止项。**文档对应真实代码入口**，不描述不存在的组件。

| 文档 | 产品模块 | 代码入口 | 状态 |
|---|---|---|---|
| `canvas-surface.md` | 无限画布 | `web/src/components/canvas/infinite-canvas.tsx` 等 | 已实现 |
| `node.md` | 模型节点（含节点内工具条） | `web/src/components/canvas/canvas-node.tsx` 等 | 已实现 |
| `params-panel.md` | 模型参数面板 | `web/src/components/DynamicParamsPanel.tsx` 等 | 已实现 |
| `generation.md` | 图片生成 + 视频生成 | `canvas-config-composer.tsx`、`canvas-node-generation.ts` | 已实现 |
| `agent.md` | Coding Agent | `web/src/components/agent/*` | 已实现 |
| `bridge.md` | Bridge（本地桥接 / 豆包·Dola 账号池） | `pages/doubao/`、`services/api/doubao-bridge.ts` | 已实现 |
| `task-center.md` | 任务中心 | `canvas-task-bar.tsx`（雏形） | **部分实现，契约先行** |
| `model-management.md` | 模型管理 | `model-select-modal.tsx`、`model-script-editor.tsx` | 已实现 |
| `admin-console.md` | 用户管理 + 管理员后台 | 无 | **未实现，契约先行** |
| `primitives.md` | 跨模块基础件 | `components/ui/*`、`app-theme.ts` | 已实现 |

> "契约先行"= 规范先定结构与状态，代码尚未存在。**文档不得描述成已上线功能**，实现时按本文档落地并在 `CHANGELOG.md` 记录。

## 通用约束（所有组件文档共用）

1. 颜色只从 `canvasThemes`（画布）或 CSS 变量 / antd token（其他）取，不硬编码。
2. 间距只用 4 的倍数；画布 4/8/12，后台 8/12/16/24。
3. 字重只 400/500；画布正文 12–13px，后台 13–14px。
4. 画布内按钮：透明底 + 图标，hover 才给 `black/5` / `white/10`。
5. 任何组件新增状态，必须同时定义：空态、加载态、错误态、禁用态。
