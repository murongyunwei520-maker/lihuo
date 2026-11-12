# MakeNow AI 功能图谱报告（graphify 契约等价产物）

> 说明：graphifyy / graphify 在本机 PyPI 源均返回 no matching distribution，完整 pipeline 未运行。
> 本文件按 graphify 的数据契约（nodes / edges / communities / god nodes / confidence）由本次调研证据手工构建，
> 语义节点来自公开 HTML/JS 静态字符串、路由与 API 路径观察，未调用 LLM，token cost = 0。

- 节点：40；边：49（EXTRACTED 34 / INFERRED 15）
- 社区：6 个（按功能域人工划分，未运行图聚类算法）

## God Nodes

- **无限画布 Sora2WorkflowCanvas**（度 10）
- **MakeNow AI 超创平台**（度 6）
- **积分（12积分/秒）**（度 5）
- **Agent 智能体 / 主Agent模式**（度 4）
- **灵感库 / 提取原画质素材**（度 4）
- **69 个 /api 端点**（度 4）
- **/api/admin/* 管理端**（度 4）

## Surprising Connections

- **桌面萌宠窗口 ↔ 同一份 index.html**：Electron 透明无边框窗口用 `?petOverlay=1` 复用网页代码，但 REA 在网页 bundle 里没有检出任何 Electron 主进程 / IPC / preload，说明壳与网页分开交付。
- **/media 的素材提取 ↔ 积分失败全退 ↔ 无限画布**：自媒体页把「粘贴分享文案→原画质提取」做成按次计费且失败自动退还，产物直接导入画布，把社区内容采集和创作主干接在一起。
- **Skill 拉片 18 维证据 ↔ 宫格分镜**：技能创建流程把「逐镜头拉片」沉淀成可复用方法论，与画布里的三视图/多宫格分镜共享同一套影视语言。
- **第三方设备指纹埋点 ↔ 萌宠窗口不加载**：同一份页面在普通窗口开启 fingerprint，在透明萌宠窗口被主动跳过。

## Suggested Questions

1. 从 /media 提取的素材如何进入无限画布，中间经过哪些审核与积分扣减节点？
2. Skill 的 18 维证据与画布节点参数之间是什么关系（方法论 → 可执行工作流）？
3. 积分在「提取 / 生成 / 技能收入 / 充值」之间如何流转，失败退还由谁判定？

## 审计与边界

- 每条关系的置信度见 graph.json 的 `confidence` 字段；INFERRED 为推断，需登录态或运行时证据验证。
- 社区为人工划分，cohesion 分数未计算（graphify 未运行）。
- 未登录、未提交生成任务、未消耗积分；登录态交互、服务端逻辑、当前价格均未验证。
