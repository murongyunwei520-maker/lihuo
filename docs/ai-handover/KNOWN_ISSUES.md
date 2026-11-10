# 离火 Lihuo 已知问题

> 本文档记录尚未解决的问题和风险。

---

## P0 级别（影响核心功能）

### 1. 任务取消不彻底
- **现象**：前端点取消只停止轮询，后台 Runner 子进程继续运行
- **影响**：取消后任务还在跑，消耗用户额度
- **位置**：`doubao-bridge/server.mjs` 取消接口
- **临时方案**：用户手动去豆包网页停止任务

### 2. Bridge 重启后任务丢失
- **现象**：任务只保存在内存 Map，Bridge 重启后所有运行中任务状态丢失
- **影响**：刷新页面后任务永远显示"生成中"，找不到结果
- **位置**：`doubao-bridge/server.mjs` activeJobs Map
- **临时方案**：重启 Bridge 前先确认没有正在跑的任务

### 3. 自动选号不可用
- **现象**：auto 模式选不了账号，返回 ACCOUNT_QUOTA_UNKNOWN
- **原因**：豆包没有额度查询接口，所有账号额度状态 = unknown
- **影响**：只能手动选账号
- **位置**：`pickAccountByMode` 函数
- **临时方案**：用 manual 模式手动选

---

## P1 级别（体验问题）

### 4. 模型参数 Schema 化未完成
- **现象**：DynamicParamsPanel 组件写好了，但没接入实际节点
- **现状**：
  - ✅ `model-schema.ts` 类型定义完成
  - ✅ `DynamicParamsPanel.tsx` 组件完成
  - ❌ 未接入通用视频/图片节点
  - ❌ 参数缓存 paramsCache 未实际使用
  - ❌ 动态面板参数未进入任务提交请求
- **新旧参数并存**：
  - 旧：`metadata.ratio`、`metadata.duration`（实际生效）
  - 新：`metadata.paramsCache[modelId]`（设计好了，没用上）

### 5. 豆包专属节点整组是死代码（已清理）
- **状态**：✅ 已删除以下三个零引用文件，删除前已备份到 `.backup/2026-11-09-dead-nodes/`
  - `doubao-video-node.tsx`（44KB）
  - `doubao-image-node.tsx`（27KB）
  - `doubao-ref-picker.tsx`（4KB，仅被上面两个引用）
- **影响**：合计约 72KB 孤儿代码，容易误改；`model-schema.ts` 与 `DynamicParamsPanel.tsx` 的唯一调用方也曾在这里
- **后续注意**：不要再在 `nodes/lihuo/` 下新增豆包专属节点，豆包模型走通用图片/视频卡片的模型下拉

### 5.1 视频面板时长上限与豆包真实能力不一致（已修复）
- **状态**：✅ 面板范围改由 Schema 提供，豆包视频收敛为 4–15s
- **依据**：`.doubao-accounts/<account>/state/video-caps.json` 的 `duration.max = 15`
- **位置**：`web/src/stores/model-schema.ts` + `web/src/components/video-settings-panel.tsx`
- **遗留**：其他模型仍按 4–30s（`VIDEO_SECONDS_MIN/MAX`），是否也收紧需按各自接口确认

### 5.2 「自动」比例被强制成 16:9（已修复）
- **状态**：✅ 豆包分支改由 `readVideoRequestParams()` 输出「自动」原文，Runner 按文案点选
- **遗留**：OpenAI / Gemini 分支仍走 `videoAspectRatio()`，`auto` 会回落 16:9，属这两家协议要求，未改动
- **位置**：`web/src/services/api/video.ts`

### 6. 没有真实额度读取
- **现象**：所有账号额度状态都显示"未知"
- **原因**：豆包网页没有暴露可用的额度查询接口
- **影响**：无法做真实的自动分配
- **注意**：不要伪造额度数字，不要根据登录状态猜额度

### 6.1 画布视频节点的模型选择是否真生效（待实测）
- **疑点**：画布节点选的模型存在 `metadata.model`，经 `buildGenerationConfig()` 写进 `config.model`；但 `createVideoGenerationTask()` 取的是 `config.videoModel || config.model`，而 `videoModel` 是配置里的全局默认视频模型
- **可能后果**：节点上换模型后，实际仍按全局 `videoModel` 生成
- **验证方式**：在画布视频卡片上选一个与全局默认不同的模型（例如一侧豆包、一侧 OpenAI 兼容），看 Bridge 收到的 `modelName` 与 provider 分支
- **位置**：`web/src/lib/canvas/canvas-generation-helpers.ts` 的 `buildGenerationConfig()` 与 `web/src/services/api/video.ts` 的 `selectedModel`

---

## P2 级别（后续优化）

### 7. 小文件体积警告
- **现象**：vite build 提示 chunk 超过 500kB
- **影响**：首次加载慢
- **位置**：`web/dist/assets/index-*.js` 约 3.75MB
- **建议**：后续做代码分割和懒加载

### 7.1 `pnpm typecheck` 基线不干净（已修复）
- **状态**：✅ 8 个类型错误已修掉，`tsc --noEmit` 现在 exit 0，可以当质量门禁
- **注意**：`pnpm build` 只跑 esbuild、不做类型检查，以后改完代码记得单独跑 `pnpm typecheck`

### 8. Windows 子进程终止可能不彻底
- **现象**：超时 kill 后，子进程的子进程（浏览器）可能还在
- **风险**：旧 Runner 继续占用账号浏览器
- **现状**：已加终止宽限时间，但仍需观察

### 9. 工程目录不含 Git 仓库
- **现象**：`lihuo/` 下没有 `.git`，`git status` 报 not a git repository
- **影响**：AGENTS.md 的「发版本流程」（提交 + 打 tag）无法执行；任何删除/重写都不可回滚
- **建议**：改动前先确认版本库是否需要补建，或由用户指定外部备份方式

---

## 已验证的坑（不要再踩）

1. **不要在 `nodes/lihuo/` 下找豆包节点**——豆包专属节点已整组删除，豆包模型走通用卡片
2. **不要新开 Edge 窗口**——会秒退
3. **不要自动切账号**——用户禁止
4. **不要伪造额度**——用户禁止
5. **不要为了过测试把任务强制标成 succeeded**——必须真实校验产物

---

**信息验证状态：**
- ✅ 大部分问题：源码已验证
- ⚠️ 部分边界情况：需要实际运行验证
