# Investigation report

**Question:** LibTV（LiblibAI 的一站式 AI 视频创作平台）和即梦（字节跳动的 AI 影像创作平台）各自有哪些功能、产品结构与能力边界？对离火这个无限画布 AI 创作平台有哪些可借鉴之处？

**Purpose:** 用户要求用 Craft Anything 技能做功能学习与竞品调研，为离火项目的产品与功能规划提供事实依据；本轮不修改任何项目代码。

**Done when:** 两个产品各有一份带证据出处的功能清单与结构说明；记录假设验证、findings、unknowns 与 handoff；给出对离火的可借鉴点与不可照搬之处。

## What we looked at

- feature-snapshot.md (unknown)
- https://www.liblib.tv/
- https://jimeng.jianying.com/
- LibTV 与即梦的官方公开介绍页、帮助文档与权威媒体报道

## What we found

### LibTV 官方定位为『为专业 AI 视频创作而生、从生成到剪辑全链路覆盖』；官网功能页标注 20+ 独家专业功能、50+ 顶尖模型聚合、100+ AI 导演 Skill、10万+ 创作者，并把产品叙事拆成『剧本·角色·世界观 / 无限画布·自由编排·智能Agent / 工作流·社区分享』三段。

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_d04eff07fc9d4a06374be41ffaf76aecc249ae9b271a4e7af9231f73a6971eb2` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x815)
  - `ev_fcf254af655bb01aacb4c8052d7c01b4836d9240af4c1698086ff829a462dc04` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x8a0)
  - `ev_d166abdffe8239d9ededa79c4f54e9cc9d9d47bfb91c8d5cce7ee6bae060da99` — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (file_offset=0x976, file_offset=0x1cc0, file_offset=0x26cc, file_offset=0x2c3c)
  - `ev_2acd67a8c78a97d4eb83efcc35130bf68da49cccca05b232ad0dfe82367d1a48` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1fe1, file_offset=0x2534, file_offset=0x28ec)

### LibTV 的产品结构是『无限画布 + 节点式工作流』：把剧本、分镜、镜头、剪辑组织在同一空间，创作者可对任意节点修改与复用，从线性抽卡变成结构化流程（官方页 + 南方+ / 界面新闻一致）。

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_d166abdffe8239d9ededa79c4f54e9cc9d9d47bfb91c8d5cce7ee6bae060da99` — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (file_offset=0x976, file_offset=0x1cc0, file_offset=0x26cc, file_offset=0x2c3c)
  - `ev_324b6e7ccaa383852691efad6b11a88633e4ff42de94405d1f5eee7df5f9dc43` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0x1ccf, file_offset=0x26db)
  - `ev_09c05f53a4f81af9e8819d9b60b9fa49a57561c67b45a3067e2c4287ae2d2bf0` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x1564)

### LibTV 独家影视化工具（媒体列举 8 类，官网只给 20+ 数字）：角色三视图生成、主体库角色一致性管理、多机位 9/25 宫格、剧情推演 4 宫格、画面推演（3 秒后 & 5 秒前）、电影级灯光控制（24 种主光位 / 9 种轮廓光预设）、镜头聚焦、9/25 宫格切分；完整 20 项清单未在一手页面取得。

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_1599fe5be781f0dbcf2c828b8c21f59d129c3feb75b9de22e5905c39e95513dd` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1e8f, file_offset=0x241f, file_offset=0x292e)
  - `ev_295c9c314f761afa07ce2faf47d7efba62e40aaf77c5f5ee2eb891702ac3055f` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0x1ea7, file_offset=0x2437)
  - `ev_fffe7142fd28ddbc16ffb69c0c079749b6324050b4d939b99fb5c2c80cd486d5` — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (file_offset=0x1ece, file_offset=0x245e, file_offset=0x27cd, file_offset=0x295d)
  - `ev_709d40f0cc1066ee8c69ebb48d731b7a72bd4bb0c9f0e448253a1105a567a9c7` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0x1f26, file_offset=0x2499)
  - `ev_9905d8050c367c20378fd6d4382a408796bda49f7083f582dce1d4381c12360d` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1ed8, file_offset=0x1f79, file_offset=0x2952)
  - `ev_fb35272ed89c8b4b3e8173324288f6ed835cf0e81473af8088af493ee269e9bd` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1ee6, file_offset=0x2474, file_offset=0x27f4)
  - `ev_f6836f947ac7ff3dbd84bd52960541d9db29c83208bc74553a42d9a5a76c6520` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x1e7b)

### LibTV 采用『GUI + Agent Skill 双入口』：传统界面之外开放 Skill 接口，外部 Agent（如 OpenClaw）可用自然语言、链接或文件作为输入，自动完成脚本生成→分镜设计→视频输出；官网称有 100+ AI 导演 Skill，首页社区也公开展示 Skill 作品。

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_2acd67a8c78a97d4eb83efcc35130bf68da49cccca05b232ad0dfe82367d1a48` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1fe1, file_offset=0x2534, file_offset=0x28ec)
  - `ev_8a76eb250f8456fddbad190c6ab62f504982961cc65b9f12b47c2ffe4f7cd423` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0x2031, file_offset=0x254a)
  - `ev_fcf254af655bb01aacb4c8052d7c01b4836d9240af4c1698086ff829a462dc04` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x8a0)

### LibTV 走多模型聚合路线：可灵 3.0、Wan 2.6、Seedream 5.0、Midjourney V7、Mureka 等覆盖文本/图像/视频/音频，合作方含豆包、Hailuo、Kimi、PixVerse、千问、生数、智谱；官宣上线首日访问破 10 万、一个月合作 300 家短剧公司。第三方站另称 30+/50+ 模型、5 分钟成片、成本低 76%-92%，未获官方验证。

- **Confidence:** Worked it out (derived)
- **Evidence:**
  - `ev_0535d1b86f435c21605652b842913d51f1368bca4f488018f1a59effcbc560b3` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0x1dd5, file_offset=0x239c)
  - `ev_2089941c2918f6a6754a3c0dbd027d460575f8d63cc255f028d52409ec640cc6` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1e22, file_offset=0x211e, file_offset=0x23e9)
  - `ev_be953525e2f1f8b47abef1f3dc4c6b0c343a82d5887a34fedc17da2f71ea4276` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x2859)
  - `ev_de3d8d9295149764d3897a8249ac3741d64dac78912f1819e1d6f49f07eb013f` — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (file_offset=0x369, file_offset=0xabe, file_offset=0x183c, file_offset=0x1875)

### 即梦基础能力：文/图生视频、首尾帧精准控制、运镜与速度调节、中文提示词语义优化、文/图生图与背景替换/风格联想/画风保持/姿势保持；『智能画布』提供 AI 拼图、局部重绘、一键扩图、图像消除、抠图与多图层编辑，强调多图 AI 融合与风格统一。

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_f4d4bf0232fcb603894c4adb3597ab19ea1d31dea498b462cd93b4c73de8c81a` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0xde2)
  - `ev_5cfe4e2b8da4c0136636edeb48a045b891fa418244bf7d7444cff99455afa29b` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0xfb2, file_offset=0xfe1)
  - `ev_aae4d48d3e9b80a4416afebfd1a50e6dfec3a71159a0f0d6d7315c80f685a8e2` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x1016)

### 即梦已有面向 Agent 的两条 CLI 产品线：短剧创作 CLI（Agent 驱动多集批量生产、剧本到成片全链路、上下文承接与本地资产复用、Seedance 全系列含样片模式、自研 DreamScript 剧本与 Anycook 角色一致性）与全能画布 CLI（图片/视频/音频生成、后编辑、即梦画布感知与编排、工作流批量生成与模板复用、时间轴编排与视频粗剪、3D 导演台搭景/运镜/预演导出，已支持团队版）。

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_aa6b3cd460f306bb4cf6d0c6b91925ce3e961d94fa2ed7ef8e65e3c356103de9` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x1321)
  - `ev_4fcad6fc428a54b5216c4adb2ed0196af5454d488d4340a1635f3ea11e67bb9e` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x146b)
  - `ev_f8760f3427bc867854a27db650c0217d39cc55e2948ea3461eab544362d1a1f3` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x140c)
  - `ev_5651c55a0a07483070c3268221f5e024f8bad6b6126c2a47d4f2148299f85626` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x143e)
  - `ev_f1898a39daf2299c83a04124f778cb687e43ade1dadffb92d41e600dc7917d9b` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0x13f7, file_offset=0x1501)
  - `ev_ccc8ae490e9ecd575c8375361cca7fccd414c76003d67f198a5d455294d52290` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x1543)
  - `ev_09c05f53a4f81af9e8819d9b60b9fa49a57561c67b45a3067e2c4287ae2d2bf0` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x1564)
  - `ev_1c2727e2cad9c7110d8b1dbe4063f7a7fe96898e0864fea6f76ce5b5f0d82b3a` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x158e)
  - `ev_5a12117f62c2b3796a050554e07f9617f338da9b9e7c676eaad5391a7cf9ad89` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x15b2)

### 即梦采用会员 + 积分计费：基础/标准/高级/超级四档 ¥69 / ¥199 / ¥998 / ¥4299 每月（首月折扣），月积分 725 / 2210 / 12320 / 54600；权益含 Seedance 2.0 VIP 专属通道、生成作品去品牌水印，超级会员另含 API 服务购买。Seedance 2.5 宣传最长 30 秒直出、单秒低至 ¥0.16（限时活动，具时效性）。

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_f1594d3a41de40824ae554ff7eb842c4f2c1ee8c2511ac6cbe03220d3fd7b9fb` — 6 match(es) for utf8 + utf16le in feature-snapshot.md; showing 6 from #0. (file_offset=0x1108, file_offset=0x1145, file_offset=0x1183, file_offset=0x11c3, file_offset=0x1a8a, file_offset=0x2904)
  - `ev_392d0817d3a8bc3e1e39fb43fd902c346228776c4c90932392e55525fedb9dcb` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x11e2)
  - `ev_de3d8d9295149764d3897a8249ac3741d64dac78912f1819e1d6f49f07eb013f` — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (file_offset=0x369, file_offset=0xabe, file_offset=0x183c, file_offset=0x1875)

### 两家路线不同：LibTV 是『多模型聚合 Hub + 影视工业流程编排 + Agent Skill 生态』，卖的是结构与跨工具搬运的消除；即梦是『自研 Seed 系列模型 + 官方创作工作台 + Agent CLI』，卖的是模型能力与官方一体化产出（含去水印、VIP 通道、时间轴粗剪与 3D 导演台）。

- **Confidence:** Worked it out (derived)
- **Evidence:**
  - `ev_be953525e2f1f8b47abef1f3dc4c6b0c343a82d5887a34fedc17da2f71ea4276` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x2859)
  - `ev_2acd67a8c78a97d4eb83efcc35130bf68da49cccca05b232ad0dfe82367d1a48` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1fe1, file_offset=0x2534, file_offset=0x28ec)
  - `ev_de3d8d9295149764d3897a8249ac3741d64dac78912f1819e1d6f49f07eb013f` — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (file_offset=0x369, file_offset=0xabe, file_offset=0x183c, file_offset=0x1875)
  - `ev_4fcad6fc428a54b5216c4adb2ed0196af5454d488d4340a1635f3ea11e67bb9e` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x146b)

### 对离火最有价值的可借鉴点：①把剧本/分镜/镜头/音频抽象成可连线可复用节点，并把调好的节点组合沉淀为模板；②角色一致性/主体库这类跨镜头资产管理；③多机位分镜与灯光控制这类影视化参数；④GUI + Agent 双入口；⑤『画布感知与编排 + 工作流批量 + 时间轴粗剪 + 3D 导演台预演导出』与离火现有导演台节点方向一致。

- **Confidence:** Best guess (inferred)
- **Evidence:**
  - `ev_324b6e7ccaa383852691efad6b11a88633e4ff42de94405d1f5eee7df5f9dc43` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0x1ccf, file_offset=0x26db)
  - `ev_295c9c314f761afa07ce2faf47d7efba62e40aaf77c5f5ee2eb891702ac3055f` — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (file_offset=0x1ea7, file_offset=0x2437)
  - `ev_fffe7142fd28ddbc16ffb69c0c079749b6324050b4d939b99fb5c2c80cd486d5` — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (file_offset=0x1ece, file_offset=0x245e, file_offset=0x27cd, file_offset=0x295d)
  - `ev_09c05f53a4f81af9e8819d9b60b9fa49a57561c67b45a3067e2c4287ae2d2bf0` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x1564)
  - `ev_5a12117f62c2b3796a050554e07f9617f338da9b9e7c676eaad5391a7cf9ad89` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x15b2)
  - `ev_2acd67a8c78a97d4eb83efcc35130bf68da49cccca05b232ad0dfe82367d1a48` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1fe1, file_offset=0x2534, file_offset=0x28ec)

### 不建议照搬：多模型聚合、会员积分、VIP 通道与去水印都依赖平台侧商务/账号体系；离火是浏览器本地直连、不自研模型，且项目约束明确『不自动切账号、不伪造额度』。可借鉴的是节点与工作流组织方式，而非号池、计费与平台运营。

- **Confidence:** Best guess (inferred)
- **Evidence:**
  - `ev_392d0817d3a8bc3e1e39fb43fd902c346228776c4c90932392e55525fedb9dcb` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x11e2)
  - `ev_be953525e2f1f8b47abef1f3dc4c6b0c343a82d5887a34fedc17da2f71ea4276` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x2859)
  - `ev_2acd67a8c78a97d4eb83efcc35130bf68da49cccca05b232ad0dfe82367d1a48` — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (file_offset=0x1fe1, file_offset=0x2534, file_offset=0x28ec)

### 证据边界：本轮只读取公开页面的静态文本快照，未登录、未运行站点脚本、未提交任何生成任务；即梦画布页直接读取只返回『企业服务』，『Agent 模式/无限画布自由创作/使用技能』等 UI 文案来自搜索引擎索引快照、置信度低。登录后真实交互、参数面板、模型可用性与实时计费均未验证。

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_26e919c8a3ca92753de8a548bee79b346245b3bb91020fd2188de374bc8b6bd1` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x2bc1)
  - `ev_d04eff07fc9d4a06374be41ffaf76aecc249ae9b271a4e7af9231f73a6971eb2` — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (file_offset=0x815)

## Open questions

- LibTV 官方『20 项独家功能』完整清单，以及第三方『5 分钟成片 / 成本低 76%-92%』是否属实？ _(severity Medium, Open)_
  - would settle it: 找官方功能列表或发布会长图
  - would settle it: 对第三方汇总站的表述做交叉验证
- 即梦两条 CLI 的实际命令、鉴权、可调用能力清单与限额是什么？ _(severity High, Open)_
  - would settle it: 读取『复制命令给 Agent』渲染出的命令文本
  - would settle it: 尝试访问官方 Lark 详细指南（可能需权限）
- 登录后 LibTV 工作台的真实节点类型、参数面板与交互流程是什么？ _(severity High, Open)_
  - would settle it: 在用户授权后运行 web-site-open + web-page-states-capture 被动观察工作台
  - would settle it: 查官方帮助中心/教程视频
- 即梦画布页登录后的真实 UI 与 S10 索引文案是否一致？ _(severity Medium, Open)_
  - would settle it: 官方帮助中心 / 登录后被动观察
  - would settle it: 复核『Agent 模式』『/ 使用技能』等交互
- 两家当前可用的模型清单、额度与价格（促销具时效性）是什么？ _(severity Medium, Open)_
  - would settle it: 按抓取时点复核官网价格页与会员页
  - would settle it: 区分活动价与日常价
- LibTV Skill 接口的协议、鉴权方式、输入输出 schema 与调用示例是什么？ _(severity High, Open)_
  - would settle it: 寻找官方 Skill 文档或社区公开的 Skill 定义
  - would settle it: 核实 OpenClaw 接入方式

## How this was done

- **Mode:** Clean room (nothing inside the original was read)
- **Engines:** builtin
- **Limitations:**
  - The file's bytes are searched as stored: compressed, encrypted or packed regions and data built at run time are not seen, so no match is not proof of absence.
  - This file is not a readable ELF, PE or Mach-O program, so matches carry file offsets only.
  - the kind is detected from the first bytes and, to break ties, the file name

## Handoff

调研对象：LibTV（LiblibAI，www.liblib.tv）与即梦（jimeng.jianying.com）。本轮已完成：brief、plan、静态证据快照 sources/feature-snapshot.md（S1-S10 分级标注）、32 条 native_bytes_find 证据、5 条假设（4 supported / 1 refuted）、12 条 findings、6 条 unknowns、report.md。结论要点：LibTV=无限画布+节点式工作流+多模型聚合+Agent Skill 双入口；即梦=智能画布/生成+Agent CLI（短剧创作 CLI / 全能画布 CLI，含 3D 导演台与时间轴粗剪）+会员积分；两者与离火形态高度相关，可借鉴节点抽象、模板复用、角色一致性、GUI+Agent 双入口，不宜照搬号池/计费。下一步：若用户授权运行站点脚本（web-site-open 需要 consent），补做登录态/工作台被动观察，优先解 U1/U3/U4；再查官方 Skill 文档解 U2。陷阱：①MCP 工具未注入本会话，必须用绝对路径 CLI + --project；②web-site-open 不带 --allow-run 会等待交互批准而挂起，不要用 --allow-run 绕过；③craft-anything 对纯 Markdown 判定 unknown，core-feature-find 报 Unknown file magic，改用 native-bytes-find 做文本取证；④libtv.gongke.net 是第三方汇总，非官方；⑤价格/促销/访问量数字具时效性；⑥证据是『快照文本命中』，不等于产品实测。

## Evidence ledger

- `ev_030de4641cdea8c087cf5f012222b6c8f169e5ad0aeb12592923e2beb1bd192c` **core_target_triage** — feature-snapshot.md isn't a format we recognise yet. (Best guess)
- `ev_ba65784b78e6e95310fd967912cc8109358deecef77fbee2cb7f49f25fba281e` **native_bytes_find** — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (Seen it)
- `ev_d166abdffe8239d9ededa79c4f54e9cc9d9d47bfb91c8d5cce7ee6bae060da99` **native_bytes_find** — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (Seen it)
- `ev_324b6e7ccaa383852691efad6b11a88633e4ff42de94405d1f5eee7df5f9dc43` **native_bytes_find** — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (Seen it)
- `ev_1599fe5be781f0dbcf2c828b8c21f59d129c3feb75b9de22e5905c39e95513dd` **native_bytes_find** — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (Seen it)
- `ev_295c9c314f761afa07ce2faf47d7efba62e40aaf77c5f5ee2eb891702ac3055f` **native_bytes_find** — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (Seen it)
- `ev_fffe7142fd28ddbc16ffb69c0c079749b6324050b4d939b99fb5c2c80cd486d5` **native_bytes_find** — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (Seen it)
- `ev_709d40f0cc1066ee8c69ebb48d731b7a72bd4bb0c9f0e448253a1105a567a9c7` **native_bytes_find** — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (Seen it)
- `ev_9905d8050c367c20378fd6d4382a408796bda49f7083f582dce1d4381c12360d` **native_bytes_find** — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (Seen it)
- `ev_fb35272ed89c8b4b3e8173324288f6ed835cf0e81473af8088af493ee269e9bd` **native_bytes_find** — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (Seen it)
- `ev_2acd67a8c78a97d4eb83efcc35130bf68da49cccca05b232ad0dfe82367d1a48` **native_bytes_find** — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (Seen it)
- `ev_fcf254af655bb01aacb4c8052d7c01b4836d9240af4c1698086ff829a462dc04` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_8a76eb250f8456fddbad190c6ab62f504982961cc65b9f12b47c2ffe4f7cd423` **native_bytes_find** — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (Seen it)
- `ev_be953525e2f1f8b47abef1f3dc4c6b0c343a82d5887a34fedc17da2f71ea4276` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_de3d8d9295149764d3897a8249ac3741d64dac78912f1819e1d6f49f07eb013f` **native_bytes_find** — 4 match(es) for utf8 + utf16le in feature-snapshot.md; showing 4 from #0. (Seen it)
- `ev_5cfe4e2b8da4c0136636edeb48a045b891fa418244bf7d7444cff99455afa29b` **native_bytes_find** — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (Seen it)
- `ev_aae4d48d3e9b80a4416afebfd1a50e6dfec3a71159a0f0d6d7315c80f685a8e2` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_f4d4bf0232fcb603894c4adb3597ab19ea1d31dea498b462cd93b4c73de8c81a` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_4fcad6fc428a54b5216c4adb2ed0196af5454d488d4340a1635f3ea11e67bb9e` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_aa6b3cd460f306bb4cf6d0c6b91925ce3e961d94fa2ed7ef8e65e3c356103de9` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_f8760f3427bc867854a27db650c0217d39cc55e2948ea3461eab544362d1a1f3` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_5651c55a0a07483070c3268221f5e024f8bad6b6126c2a47d4f2148299f85626` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_5a12117f62c2b3796a050554e07f9617f338da9b9e7c676eaad5391a7cf9ad89` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_1c2727e2cad9c7110d8b1dbe4063f7a7fe96898e0864fea6f76ce5b5f0d82b3a` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_09c05f53a4f81af9e8819d9b60b9fa49a57561c67b45a3067e2c4287ae2d2bf0` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_f1898a39daf2299c83a04124f778cb687e43ade1dadffb92d41e600dc7917d9b` **native_bytes_find** — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (Seen it)
- `ev_392d0817d3a8bc3e1e39fb43fd902c346228776c4c90932392e55525fedb9dcb` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_26e919c8a3ca92753de8a548bee79b346245b3bb91020fd2188de374bc8b6bd1` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_f6836f947ac7ff3dbd84bd52960541d9db29c83208bc74553a42d9a5a76c6520` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_d04eff07fc9d4a06374be41ffaf76aecc249ae9b271a4e7af9231f73a6971eb2` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_5eb2c21ad70f570f5ae6a7c951e605e20e6080402ed9985dc6bd63b751e0a6d4` **native_bytes_find** — 0 match(es) for utf8 + utf16le in feature-snapshot.md. (Seen it)
- `ev_0535d1b86f435c21605652b842913d51f1368bca4f488018f1a59effcbc560b3` **native_bytes_find** — 2 match(es) for utf8 + utf16le in feature-snapshot.md; showing 2 from #0. (Seen it)
- `ev_2089941c2918f6a6754a3c0dbd027d460575f8d63cc255f028d52409ec640cc6` **native_bytes_find** — 3 match(es) for utf8 + utf16le in feature-snapshot.md; showing 3 from #0. (Seen it)
- `ev_ccc8ae490e9ecd575c8375361cca7fccd414c76003d67f198a5d455294d52290` **native_bytes_find** — 1 match(es) for utf8 + utf16le in feature-snapshot.md; showing 1 from #0. (Seen it)
- `ev_f1594d3a41de40824ae554ff7eb842c4f2c1ee8c2511ac6cbe03220d3fd7b9fb` **native_bytes_find** — 6 match(es) for utf8 + utf16le in feature-snapshot.md; showing 6 from #0. (Seen it)

