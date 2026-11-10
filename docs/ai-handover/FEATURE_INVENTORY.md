# 离火 Lihuo 功能清单

> 本文档列出所有已实现功能，标注所在文件和当前状态。
> 信息来源：源码审查。

## 一、画布系统

| 功能 | 位置 | 状态 | 备注 |
|------|------|------|------|
| 无限画布 | `web/src/components/canvas/` | ✅ 已上线 | infinite-canvas 二开 |
| 节点注册系统 | `web/src/lib/canvas/node-registry.ts` | ✅ 已上线 | 支持插件式注册 |
| 内置节点 | `builtin-nodes.tsx` | ✅ 已上线 | 图片、视频、音频、文本、组 |
| 自研节点 | `nodes/lihuo/index.tsx` | ✅ 已上线 | 朱笺（便签）、提示词工坊、导演台 |
| 画布保存/加载 | localforage | ✅ 已上线 | 自动保存 |
| 撤销/重做 | 画布内置 | ✅ 已上线 | |
| 小地图 | 画布内置 | ✅ 已上线 | |
| 节点连线 | 画布内置 | ✅ 已上线 | |

## 二、AI 生成功能

### 2.1 图片生成

| 功能 | 位置 | 状态 | 备注 |
|------|------|------|------|
| 通用图片节点 | `builtin-nodes.tsx` | ✅ 已上线 | |
| 图片设置面板 | `image-settings-panel.tsx` | ✅ 已上线 | 尺寸、质量等 |
| 豆包生图 | doubao-bridge | ✅ 已上线 | 走 Bridge 浏览器自动化 |
| OpenAI 生图 | `services/api/image.ts` | ✅ 已上线 | gpt-image-1 等 |

### 2.2 视频生成

| 功能 | 位置 | 状态 | 备注 |
|------|------|------|------|
| 通用视频节点 | `builtin-nodes.tsx` | ✅ 已上线 | |
| 视频设置面板 | `video-settings-panel.tsx` | ✅ 已上线 | 分辨率、比例、时长、模式 |
| 豆包生视频 | doubao-bridge | ✅ 已上线 | 走 Bridge 浏览器自动化 |
| OpenAI 视频 | `services/api/video.ts` | ✅ 已上线 | Sora 等 |
| 视频轮询 | `waitJob()` | ✅ 已上线 | 前端轮询任务状态 |

## 三、豆包账号池与 Bridge

| 功能 | 位置 | 状态 | 备注 |
|------|------|------|------|
| 豆包账号列表 | `use-doubao-account-store.ts` | ✅ 已上线 | |
| 账号登录状态 | Bridge `/api/accounts` | ✅ 已上线 | |
| 手动选账号 | 视频节点下拉框 | ✅ 已上线 | manual 模式 |
| 自动分配账号 | Bridge `pickAccountByMode` | ⚠️ 框架已搭 | 额度全部 unknown，实际不可用 |
| 账号锁 | `server.mjs` | ✅ 已上线 | 同账号串行 |
| 任务队列 | `server.mjs` | ✅ 已上线 | queued 状态 |
| 任务取消 | Bridge API | ⚠️ 部分实现 | 前端只停轮询，后台任务继续 |
| 任务超时 | `server.mjs` | ✅ 已上线 | 分级 kill |
| 媒体文件校验 | `vendor/doubao-brain/dbb/src/site.mjs` | ✅ 已上线 | magic number + MIME + 大小 |
| Edge CDP 连接 | `run-doubao.mjs` | ✅ 已上线 | 连接已有窗口，一个号一个窗口 |
| 扫码登录 | `doubao-bridge/qr-helper.py` | ✅ 已上线 | Python venv |

## 四、模型与参数系统

| 功能 | 位置 | 状态 | 备注 |
|------|------|------|------|
| Channel/Model 配置 | `use-config-store.ts` | ✅ 已上线 | 全局配置 |
| 内置豆包 channel | `constants/doubao-builtin.ts` | ✅ 已上线 | builtin-doubao |
| 模型 Schema 类型 | `stores/model-schema.ts` | ✅ 已完成 | 类型定义 + `configKey` 绑定 + 豆包视频/图片内置 Schema |
| 视频面板按 Schema 渲染 | `components/video-settings-panel.tsx` | ✅ 已接入 | 比例可选项、时长范围按当前模型 Schema 取 |
| 动态参数面板 | `components/DynamicParamsPanel.tsx` | ✅ 已接入 | 渲染面板没有专门控件的参数（音频/水印） |
| 参数提交打通（视频） | `readVideoRequestParams()` + `video.ts` | ✅ 已打通 | 豆包分支的 ratio/duration 由 Schema 收敛后提交 |
| 参数提交打通（图片） | `services/api/image.ts` | ❌ 未完成 | 图片参数还没走 Schema |
| 按模型独立参数缓存 | — | ❌ 未做 | 参数仍共用全局 `AiConfig`，切模型会沿用上一个模型的值 |

## 五、其他功能

| 功能 | 位置 | 状态 | 备注 |
|------|------|------|------|
| 3D 导演台 | `director-node.tsx` | ✅ 已上线 | 独立 app，iframe 嵌入 |
| 提示词工坊 | `prompt-lab.tsx` | ✅ 已上线 | 节点内置 |
| Canvas Agent | `canvas-agent/` | ✅ 已上线 | |
| MCP | 待确认 | ⚠️ 需核实 | |
| 素材管理 | `assets/` 页面 | ✅ 已上线 | |
| 生图工作台 | `/image` 页面 | ✅ 已上线 | |
| 视频创作台 | `/video` 页面 | ✅ 已上线 | |
| 多语言 | i18n | ✅ 已上线 | 中/英 |

## 六、已删除/废弃功能

| 功能 | 原因 | 备注 |
|------|------|------|
| 豆包专属图片节点 | 合并到通用图片卡片 | 节点文件已删除 |
| 豆包专属视频节点 | 合并到通用视频卡片 | 节点文件已删除 |
| 自动选账号（auto） | 额度无法查询 | 框架保留，默认禁用 |

---

**信息验证状态：**
- ✅ 大部分功能：源码已验证
- ⚠️ 标注"待确认"的：需要进一步核实
