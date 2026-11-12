# MakeNow AI /media 调研快照

抓取时间：2026-11-11（GMT+8）。方式：`curl` 读取公开静态 HTML/JS、`WebFetch` 读取页面可见文本、REA 静态分析本地 JS 目录。
边界：未登录、未提交任何生成任务、未消耗积分、未运行站点脚本、未连接用户已打开的浏览器；不记录任何 write key / Cookie / 凭据 / 个人信息。

## 1. 身份与定位（一手：index.html 的 SEO meta）

- 标题：`MakeNow AI - 你的超创平台 · Make anything. Now`
- description：`MakeNow AI 一站式 AI 创作平台：短剧、电商、自媒体、工作、讨论组五大板块，涵盖无限画布、一键成片、视频转绘、AI Agent 智能体与超多实用工具。Make anything. Now —— 你的超创平台！`
- keywords：`MakeNow AI,AI创作平台,AI短剧,AI视频生成,一键成片,视频转绘,无限画布,AI Agent,智能体,AI绘画,文生图,以图生图,电商素材,自媒体创作,AI工具`
- OG description 重述五大板块；`application-name=MakeNow AI`；`theme-color=#4f9cf0`；PWA manifest `/manifest.json`、iOS 主屏图标。

首页可见文案（WebFetch）：`由顶级 AI 驱动的一站式超创平台`；三个创作入口 `视频生成 / 图片生成 / 剧本创作`；示例参数 `Seedance 2.0 12积分/秒`、`16:9 · 720P · 15s · 有声`、`生成视频`；特色功能 `视频转绘（保留镜头节奏，重塑画面风格）`、`一键成片（从故事创意到分镜成片）`、`一键出广告（让商品卖点成为故事主角）`；技能 `动态镜头设计`、`角色一致性导演` 与 `技能市场` 链接；`我的项目 / 全部项目`；`开始创作 / 新建互动剧情世界（选一个题材，AI 陪你往下写，最后生成可试玩的分支剧情）`；`MakeNow TV` 社区作品流（带点赞数与作者）。

## 2. /media 不是「素材站」，而是「自媒体」板块（一手：主包路由定义）

主包 `index-BCbWB_b3.js` 中的导航数组（原文）：

```
[{key:"drama",label:"短剧",path:"/"},{key:"ecommerce",label:"电商",path:"/ecommerce"},
 {key:"media",label:"自媒体",path:"/media"},{key:"work",label:"工作",path:"/work"},
 {key:"discussion",label:"讨论组",path:"/discussion"}]
```

路由定义（原文片段）：`{path:"/media",name:"user_page_media",component:()=>import("./MediaPage-CW1cH5ZD.js"),meta:{public:!0}}`；另有 `{path:"/media/templates",name:"user_page_media_templates",component:()=>import("./TemplateMarketPage-Dd9DZ7KP.js")}`。路由守卫里还有 `e.path==="/media"&&e.query.tool` 的特判，说明 /media 通过 query 参数切换工具。

WebFetch 在 /media 看到的可见文案：`提取灵感，即刻创作`；`粘贴整段分享文案也能识别，提取后可直接导入原画质素材`；控件 `粘贴 / 清空 / 提取`；`4 个平台支持原画质提取，其余公开网页可尝试通用提取`。

MediaPage chunk 里的字符串：`支持的平台`、`提取结果`、`提取素材（消耗 ${...} 积分，失败自动全额退还）`、`精选创作`、风控提示 `${平台}当前风控较严，可改用其它平台，或直接上传素材`；标识符含 `PlatformLogo`、`adapter`、`unstable`。四个平台的 key 在代码里为 `douyin / xiaohongshu / kuaishou / bilibili`（抖音、小红书、快手、B站）。

## 3. 功能地图（一手：72 个 Vite 懒加载 chunk 名）

创作主干：`Sora2WorkflowCanvas`（无限画布，1213 条中文字符串，含 2D 动漫/3D动漫/写实风格库、角色三视图、场景概念图、物品三视图、2×2/2×3/3×3/3×4/4×4 宫格、垫图模板、参考图推理、场景图推理）、`Sora2WorkflowProjects` / `Sora2WorkflowProjectStats`、`VideoClip`（分镜、配音、字幕、音乐、分割、FFmpeg）、`ImageEdit`、`ImageManager`、`ToolWorkspace`（长图拼接、切片、裁剪比例、旋转翻转、导出格式）、`Generations`（生成记录）、`Prompts`。

技能与模板：`SkillMarketPage`（探索/我的技能/积分收入；分类 通用·写作·视频·图片·分镜·角色·营销·其他；获取/启用/停用/提交审核）、`SkillCreatePage`（逐镜头拉片、拆解镜头与 18 维证据、提炼方法论、构建可复用 Skill、审阅保存；生成适用条件/提问表单/执行步骤/每步产物/失败处理）、`AgentSkills`（管理端：待审核数/已发布数/总技能数、扫描、内置、价格、安装数、版本）、`TemplateMarketPage`（单图等分 2×2、多图生成、收藏、排队/后台处理）。

五大板块：`homePageIndex`（首页，视频/图片/剧本三入口与示例提示词、素材审核状态）、`EcommercePage`（电商：执行时间线、导师/子任务、预览、下载、直连/免费/积分、模型选择）、`WorkPage`（工作：Agent 智能体、主Agent模式、任务模式、沙箱「仅在工作空间内读写，禁止联网」/完全访问「可联网、可读写本机文件」、执行时间线、上传附件）、`MediaPage`（自媒体）、`discussionPageIndex` 等讨论组系列（讨论组/帖子/举报/活动/我的讨论）。

互动剧情世界：`WorldEditor`（场景、结局、好/坏/中性结局、剧情树、新增场景/结局、生成配图/生成视频、多人编辑冲突提示）、`WorldGuide`、`WorldPlay`、`PersonaQuizPage`（12 种职场身份卡，可导出 PNG、分享）。

客户端与运营：`DesktopDownloadPage`（Mac / Windows 客户端下载）、`InteropLoginPage` / `JimengAssetsAdmin`、`TaskCenterPage`（任务中心「暂未开放」）、`PersonaQuizPage`、`VoiceLibrary`（音色库：名称/描述/标签/示例音频、音频 ≤100MB）、`Routes`（路由管理）、`Dashboard`、`Admin` 与大量 `/admin/*` 管理块。

## 4. 前端实现与桌面端形态（一手：index.html 注释 + 内联脚本）

- Vue 3 + Vite SPA：`<div id="app"></div>`，入口 `/assets/index-BCbWB_b3.js`，modulepreload `vendor / vue-vendor / ant-design-vue`，四个 CSS 分包；注释直接提到 `App.vue`、`main.css`。
- 多主题：localStorage key `sora2-theme`，皮肤 `dark / forest / ocean / cherry / light / cream`，映射 `data-theme`、`data-theme-skin`、`data-theme-scope`；`/admin-login` 与 `/admin/` 强制 dark。内部代号 `sora2` 同时出现在 chunk 名、`Sora2WorkflowCanvas` 与主题 key 中。
- **桌面客户端存在**：注释写明「桌面萌宠窗口」是 `transparent + frame:false` 的独立 Electron `BrowserWindow`，用 `?petOverlay=1` 加载同一份 index.html；为避免启动白屏，必须在任何样式与脚本之前同步给 `<html>` 打 `data-pet-overlay` 标记并内联透明兜底样式。REA 静态分析在网页 bundle 里没有发现 Electron 主进程/IPC/preload 代码，说明壳与网页是分开交付的。
- 统计埋点：异步加载第三方 SDK（Entmesh v0.5.3），开启 `fingerprint: true` 设备指纹，并上报事件；萌宠窗口不加载。（具体 write key 未记录，属不应外泄的前端凭据。）
- PWA / SEO：manifest.json、apple-touch-icon、Google / Bing 站点验证、OG / Twitter Card；`robots.txt`、`sitemap.xml` 返回的是 SPA fallback HTML（即没有独立文件）。

## 5. API 与后台（一手：主包中 69 个 `/api/...` 字面量）

- 账号：`/api/auth/login`、`/api/auth/sms/*`（验证码、密码、绑定手机、重置）、`/api/oauth/wechat/*`（扫码登录/绑定）、`/api/account-center/*`（统一账号、二维码、手机登录）、`/api/auth/redeem-activation-code`、`/api/attribution/claim`（渠道归因）、`/api/interop/login`、`/api/interop/tickets`。
- 生成与媒体：`/api/generations/create`、`/api/generations/reasoning-shot`、`/api/audio/generate`、`/api/music/sing`、`/api/music/cover`、`/api/music/voices`、`/api/face-swap/generate`、`/api/design-to-psd/analyze`、`/api/chat-agent/chat`、`/api/chat-agent/match-characters`、`/api/canvas-collaboration/invitations/*`（画布协作邀请）。
- 社区与内容：`/api/discussion-groups`、`/api/discussion-posts/*`、`/api/discussion-activities/*`、`/api/interactions/unread-count`。
- 商业化：`/api/payment/create-order`、`/api/payment/my-orders`、`/api/payment/packages`、`/api/desktop/report`。
- 管理端 `/api/admin/*` 模块（主包中文菜单）：概览、站点配置、API 多站点管理、用户管理、渠道归因管理、灵感库管理、生成记录、积分流水、AI 配置、音色库管理、素材审核、图片管理、公告管理、活动管理、案例分享审核、作品点赞管理、讨论组审核/举报、路由管理、自定义生成日志、API 密钥管理、充值套餐/促销管理、签到管理、邀请注册管理、支付订单管理、激活码管理、技能审核管理、模型健康白名单。

## 6. 计费、账号与社区

积分制（首页示例 `Seedance 2.0 12积分/秒`）；提取素材按次扣积分且失败全额退还；充值套餐、支付订单、积分流水、签到、邀请注册、任务中心（暂未开放）；技能市场有「积分收入」，说明技能可交易/分成。登录支持手机号验证码/密码、微信扫码、统一账号、激活码兑换。社区侧有 MakeNow TV 作品流、案例分享、点赞、讨论组、身份卡分享。

## 7. REA 静态分析结果（`analyze-javascript-application`，证据包 140MB）

- 目标：`assets/` 目录，sha256 `944b20a3fb114977e65d4f3483ae9d07fb033e26fc5ef67cbf98ba430db6383e`。
- 统计：`relevant_files=4`、`parsed_javascript_files=4`、`parse_failures=1`、`text_bytes_read=3,270,302`、`visited_ast_nodes=525,356`、`findings=2,642`、`modules=0`；view coverage `complete-within-view`，examined/total = 1549/1549。
- Electron 检测全为 0（browser_windows / preload / contextBridge / IPC / native addons 均无），与「桌面壳单独交付」一致。
- 限制与未知：明确写明「JavaScript 与 HTML 按惰性文本解析，bundle bootstrap 从未执行」；图覆盖不完整，仍有 55,228 个 semantic graph unknowns；1 个 parse failure；静态指纹不等于行为等价。因此本文件的实现结论是**观察/推导**，不是运行时验证。

## 8. 证据边界与未知

- 观察到的只是公开 shipped artifacts 的字符串、路径、注释与配置，**不等于**页面真实交互、服务端逻辑或可用性。
- 未登录，登录后功能（项目、画布协作、技能发布、充值）不可见；未验证四个平台提取的实际成功率与风控策略；未验证积分单价与模型清单的当前有效性。
- `/media` 的「提取」功能在 WebFetch 可见文本与 MediaPage chunk 字符串中出现，但完整交互链路（适配器、失败退还）未实测。
- graphify 依赖在本机 PyPI 源无匹配包，未能运行其完整 pipeline；本轮以功能关系清单与可视化替代（见报告）。
