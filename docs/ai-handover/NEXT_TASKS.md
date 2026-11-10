# 离火 Lihuo 下一步任务清单

> 本文档列出待办任务，按优先级排序。
> 新 AI 接手时从这里开始看。

---

## 已完成（上一轮）

### ✅ 动态参数 → 面板 → 提交 链路打通（视频侧）
- `ParameterSchema.configKey` 把参数绑定到全局 `AiConfig` 字段，参数值不再另存一份。
- `video-settings-panel.tsx` 的比例选项、时长范围改由当前模型 Schema 决定；豆包视频收敛为 4–15s。
- `DynamicParamsPanel` 真正接入：渲染面板没有专门控件的参数（非豆包模型生成音频 / 添加水印）。
- `video.ts` 豆包分支改用 `readVideoRequestParams(config)`，`auto` 比例保留「自动」原文提交。
- 验收点已写入 `docs/content/docs/progress/pending-test.mdx`，**需要用户实测确认**。

---

## P0：必须先做的

### 1. 图片侧接入同一套 Schema
**背景**：视频侧已经打通，图片设置面板（`image-settings-panel.tsx`）仍是硬编码。

**要做的事**：
1. 按 `configKey` 的同一约定给 `image-settings-panel.tsx` 接 Schema
2. 豆包生图（`Seedream`）的尺寸/比例以 `/api/accounts/:id/image-caps` 的实测值为准
3. 图片参数提交处（`services/api/image.ts`、`generateImageViaDoubao`）读同一份参数

### 2. 按模型隔离参数
**背景**：参数共用全局 `AiConfig`，切模型 A → B 会沿用 A 的比例/时长。

**要做的事**：
- 要么在 Schema 里声明「模型不支持当前值就回落到默认」（轻量）
- 要么给配置加 `按模型 ID 缓存`（重，需要同步所有读 config 的地方，`buildGenerationConfig`、`buildLog`、画布摘要都在读）

**注意**：改这里前先确认用户要哪种语义，不要直接上双份数据源。

---

## P1：后续优化

### 3. 真正的取消任务机制
- 前端取消时，后端也要停止 Runner 子进程
- 关闭对应的豆包网页标签页
- 释放账号锁

### 4. Bridge 任务持久化
- 把任务状态存到文件，重启后可恢复
- 而不是现在的内存 Map

### 5. 真实额度查询
- 研究豆包网页有没有额度接口
- 如果没有，就一直用 manual 模式，不要硬做 auto

### 6. 豆包能力实时刷新
- 把 `/api/accounts/:id/video-caps`、`image-caps` 的实时结果覆盖到 Schema
- 避免豆包改版后写死的比例/时长范围过期

---

## P2：长期方向

### 7. 代码分割和性能优化
- 首屏加载 3.7MB 太大了
- 按需加载，路由分割

---

## 接手建议（给新 AI）

### 第一步：先读这些文件
1. `AGENTS.md` - 开发约束规则
2. `docs/ai-handover/PROJECT_OVERVIEW.md` - 项目全貌
3. `docs/ai-handover/ARCHITECTURE.md` - 系统架构与 Schema 约定
4. `docs/ai-handover/CURRENT_STATUS.md` - 当前进度（第七节是文档校订记录）
5. `docs/ai-handover/KNOWN_ISSUES.md` - 已知坑

### 第二步：确认现状
- 打开视频工作台，切到豆包模型，确认时长滑杆是 4–15
- 切到非豆包视频模型，确认底部出现「更多参数」的两个开关

### 第三步：从最小修改开始
- 不要一上来就重构
- 新增参数只改 Schema，不要在面板里加分支

---

**信息验证状态：**
- ✅ 任务清单：基于当前进度整理
