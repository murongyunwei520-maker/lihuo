# Brief

**Question:** https://www.makenow.tv/media 属于什么产品、/media 页与整站各有哪些功能与页面结构、前端如何实现？对离火无限画布项目有什么可借鉴之处？

**Purpose:** 用户要求同时用 craft-anything（证据账本）、graphify（知识图谱）、reverse-engineer-anything（shipped artifact 静态分析）学习该网站；本轮不改任何业务代码。

**Targets:**
- https://www.makenow.tv/media
- https://www.makenow.tv/ 及 /assets/index-*.js 等公开静态资源
- 72 个 Vite 懒加载 chunk 对应的功能页面
- REA analyze-javascript-application 证据包
- graphify 知识图谱（如依赖可用）

**Constraints:**
- 只读取公开静态 HTML/JS 与页面可见文本，不登录、不提交任何生成任务、不消耗积分
- 不运行目标站点脚本；craft-anything 的浏览器工具需要用户明确授权，本轮不绕过
- 不记录任何 write key、Cookie、凭据或个人信息（页面含第三方埋点 SDK）
- 不把第三方前端代码复制进离火项目，仅做学习
- 结论区分观察（shipped artifact 字符串/API 路径）、推导与推断，并标注覆盖边界

**Done when:** 三种方法各留下可引用的产物；形成带证据的功能清单、实现结构与对离火的借鉴结论；findings、unknowns、handoff 与报告落盘。
