# 离火 Lihuo 已知问题

> 本文档记录尚未解决的问题和风险。

---

## P0 级别（影响核心功能）

### 1. 任务取消不彻底（2026-11-21 已修复）
- **原现象**：前端点取消只停止轮询，后台 Runner 子进程继续运行
- **修复**：`POST /api/jobs/:id/cancel` 会把任务标记为 CANCELED，并用 `taskkill /T` 收掉 Runner 进程树；图片/视频/文本适配器在 Abort 时都会调用该接口。
- **仍需确认**：Windows 下 Runner 拉起的 Edge 子进程是否全部退出，需要在真实账号上点一次取消验证。

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

### 6.2 阶段 3.1 队列、冻结模型与分镜并发边界
- **已修复**：刷新不再把 `submitting / running / unknown` 无条件改成可自动重发的 `queued`；停止运行中任务进入 `interrupted + unknown + needsReview`，任务中心同步显示「结果未知」。
- **已实现**：队列任务冻结渠道 / 模型 / 参数 / capability / promptVersion，执行时用冻结快照；冻结模型不可用明确失败，不静默切换。
- **已实现**：同项目同分集增加整集 / 单场 / 单镜互斥锁和版本校验；冲突时保留当前草稿，模型结果写入 `storyboardVersions` 并追加 `storyboard_write_conflict`。
- **已修复（3.2）**：快照已与正式版本号分离，每份快照有独立 `snapshotId` 和 `snapshotType`；冲突快照不占新的正式版本号，应用时以当前正式版本 + 1 重新生成。
- **未验证**：整集生成期间触发单镜 / 单场、单场期间同场单镜、两个不同场景同时提交，只有确定性互斥测试覆盖，尚无真实并发生成证据。
- **范围限制**：模型冻结只覆盖队列任务；直接「生成本集 / 单场 / 单镜」仍按当前项目模型。浏览器回归使用项目 A 导出快照与隔离项目 D，不等于原始 live 项目已回归。

### 6.3 阶段 3.2 剧本覆盖与分镜快照边界
- **已实现**：全剧剧本队列默认 `skip_existing`；已有正式剧本、人工编辑和锁定剧本跳过并记录原因；显式覆盖需确认，覆盖前同步写快照并回读确认，备份失败不调用模型。
- **已实现**：分镜快照有独立 `snapshotId / snapshotType / basedOnVersion / sourceTaskId / contentHash`；冲突和备份不占正式版本号；旧快照读取时补稳定身份，刷新不重新生成 ID。
- **已实现**：应用 / 恢复快照先校验当前正式版本和锁定镜头，先备份当前版本，再以 `current + 1` 写为新的正式版本；剧本内容或顺序变化只局部标记受影响分镜 stale。
- **遗留**：直接剧本手工编辑入口 `updateScriptManual()` 仍只标记人工编辑、不递增正式剧本版本，也没有自动快照；后续需与正式版本语义对齐。
- **遗留**：剧本备份的 `sourceTaskId` 多数为空；任务中心是否展示 `job.skipReason` 还未做最终交互核对，当前以剧本 inspector 的「队列跳过记录」和 `production.skips[]` 为准。
- **未验证**：跨标签页并发写入、原始 live 项目 A/B 全量回归、旧 V2 / 无限画布回归、真实模型失败 / JSON 截断覆盖、真实并发生成仍未执行；不得把确定性测试或隔离项目 D 写成 live 全量通过。

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

## 阶段 2B 已实现但仍需确认的风险

### 1. 2A 修复后的最终浏览器验收未重跑
- **状态**：2A 两项 P1 修复（无效证据、项目账号隔离）已完成，并有 `stage2a-fix-check.ts` 与确定性测试覆盖；真实项目 A 回归正常。
- **遗留**：修复后的完整 2A 浏览器最终验收没有重新跑一轮；不要写成“2A 已全量重新验收”。
- **位置**：`docs/ai-handover/DRAMA_STUDIO_STAGE2A_FIX.md`、`web/scripts/stage2a-fix-check.ts`。

### 2. 全剧蓝图在 Bridge 长结构化输出处会截断
- **现象**：让模型一次性输出蓝图核心 + 人物 / 关系 / 地点 / 时间线，会在 `"characters":` 处稳定截断；真实任务 `job-mwrhotlh-bc17` 只返回 4,197 字符，压缩提示词后仅 15 字符。
- **现状**：不改 Bridge；蓝图模型只生成核心编剧字段，人物 / 关系 / 地点 / 时间线由 2A 真实档案确定性补齐。如果核心字段仍被截断，生成失败且不写半成品。
- **注意**：不要把这个补齐说成“模型完整生成了全部蓝图”；它只补齐 2A 已有事实，不新增原著事实。

### 3. 模块重生成也可能截断
- **现象**：要求模型输出完整 episode 对象再取模块，会在约 4.7k 字符处连续截断。
- **现状**：模块提示词只输出当前模块字段；真实项目 A 第 2 集「核心冲突 / 高潮」第三次调用成功。
- **注意**：弱模型或长模块仍可能失败；失败必须保留旧版本、不写半成品、不自动重发。

### 4. 分集批次为 1 集 / 批，长剧成本未压测
- **现状**：`ADAPTATION_EPISODE_BATCH = 1`、`ADAPTATION_EPISODE_BATCH_LARGE = 1`，是为了避开 Bridge 截断的可靠性取舍；模型若一次返回多集，`ensureEpisodeBatch()` 接受并提前结束后续批次。
- **风险**：20 集以上可能产生较多模型调用；`ADAPTATION_MAX_EPISODES = 120` 只是硬上限，不是已验证产能。不得把 120 集当成可稳定生成的承诺。

### 5. 规则校验不等于剧情质量
- **现状**：已覆盖集数、重复摘要、重复事件、戏剧目标、冲突、高潮、人物提前知情、死亡后回归、地点瞬移、伏笔假回收、原著证据、阶段覆盖等确定性检查。
- **边界**：不能判断对白质量、节奏是否精彩、人物动机是否足够动人。真实项目 A 仍是 `0 error / 7 warning / 1 suggestion / 待处理 8`，warning 需用户处理，不能自动全部改写。

### 6. 阶段 3 已消费 handoff，但仍有真实边界未验证
- **现状**：`adaptationHandoff()` 已被 `Stage3Workspace` 真实消费；第 1 集剧本 `script v1`、分镜 `v13`、单镜重生成和锁定保护已完成浏览器验收；项目 A 的 8 条待处理只读保留。
- **边界**：真实多集剧本排队 / 暂停 / 停止、逐场分镜独立生成、镜头组级真实重生成、真实高风险提案拒绝 / `generated` 复活确认点击、旧 V2 项目和无限画布回归仍待验证。整集分镜提示词当前限制每场 2 镜（最多 3 镜）以规避 Bridge 截断，8 镜草稿不等于最终分镜质量；不能把确定性测试写成所有真实链路已通过。

### 7. 2B 数据仍只存在浏览器本地
- **现状**：沿用 `storageKey("studio_store")` + localForage；没有云同步。
- **风险**：换浏览器、清缓存、不同设备会丢；大项目（多集 + 历史快照 + 生成记录）可能触及容量上限，本阶段未做容量拦截。

### 8. 多标签页会打断另一标签页的生成状态
- **现象**：同一项目在多个标签页打开时，刷新 / rehydrate 可能把另一个标签页正在运行的任务标为 `interrupted`。
- **现状**：这是既有本地任务模型边界；为避免重复计费，2B 不自动重发。需要真实多标签页验收后再决定是否加跨标签页锁。

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
