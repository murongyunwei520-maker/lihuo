# Hypotheses

## hyp_1 (Refuted)

H1 /media 是一个独立的素材提取工具站

Prediction: 页面与路由应显示 /media 为全站核心或独立产品

Contradicting: ev_bf613b211e4352eb7fba1f700c0b7cf7343ea4e6175bf14ca6c8c28db1dbe148, ev_d34465b59f97d2f39d74b30d1f1fd172bc041a8e5ca9123cdb90e85fd1a2dfd8, ev_327e2f446aa38b1b73895d151e6b947739bf054254bdcd047b39f790aedb6e97

- 主包导航数组与路由定义显示 /media 只是五大板块中的『自媒体』，提取素材是该板块里的一个工具，另有 /media/templates
## hyp_2 (Supported)

H2 该站同时提供桌面客户端

Prediction: HTML 或 chunk 列表应出现 Electron/下载页证据

Supporting: ev_c884d0d5d2577ccdb26a116ed2b48745480cb694df3acbafe00c79a0a3a83700, ev_2b09da11c1995936d04bbd065124600a1647e0909e6c422750fa91bf84d52a88, ev_3d9678c696e1fa0eea79758ac43bc15134ee474fdddbbc1226c8e45aaeb1a81a

- index.html 注释明确 transparent+frame:false 的 BrowserWindow 与 ?petOverlay=1；chunk 列表含 DesktopDownloadPage
## hyp_3 (Refuted)

H3 网页 bundle 内含 Electron 主进程代码

Prediction: REA 静态分析应检出 browser_windows/preload/IPC

Contradicting: ev_7471603adcb7ec9400bcc8e5b3d89dc9ef5be2931a2d104af2628a8104548571, ev_4e2042a6ad1b4aa5acdf721fdda49399847eddac3f5ee016bd713be45fcd3ad4

- REA electron 统计全为 0，桌面壳与网页分开交付；静态分析只覆盖惰性文本
## hyp_4 (Supported)

H4 无限画布是产品的主干能力

Prediction: SEO meta 与 chunk 体积应同时体现

Supporting: ev_1de8eb682add831a72c6fe76a402528deae46b2f1a46965899172bec44a5cf42, ev_c49176a5bd5a67e010e3011c4bf7b635ebf37f545a3171b268f7d4304c53ed17, ev_abd151e668f3d2260445bb5a04cffbd78c5262771a17fdf03ef1abae2f1ef79a, ev_cde4a461e73145f339a2df1f18e562f36a452a142a4f65068b62793db0caee97

- meta 明确列无限画布；Sora2WorkflowCanvas 是最大业务 chunk，含 1213 条中文字符串与三视图/宫格/垫图模板
## hyp_5 (Supported)

H5 技能(Skill)是可复用、可审核、可变现的资产

Prediction: 应同时出现创建流程、审核状态与积分收入

Supporting: ev_6f61a5760b9080c82ede0e54c1b7b9852944f1a89e648604ee95a9c43d6e6e59, ev_e80a1ddb854a942e9a07320aa480b86ce4ed03c45d7bfd643089ae33de9b55ef, ev_26357a129a6e8c3a358f0c0dbb8dac492d28d6627cc26b00b75d8e2983890919

- SkillCreatePage 有拉片→18维证据→方法论→可复用 Skill→审阅保存；SkillMarket 有我的技能/积分收入；AgentSkills 有待审核/已发布/安装数
