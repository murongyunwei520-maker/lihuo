# 离火 Lihuo 开发历史

> 本文档记录关键修复和开发阶段。
> 信息来源：之前的开发交接报告 + 当前源码验证。

---

## 第一阶段：豆包链路接入

### 1.1 豆包 Bridge 服务建立
- **原始问题**：需要通过浏览器自动化调用豆包网页版生图/生视频
- **解决方案**：建立 Node.js 桥接服务（doubao-bridge/:9091），通过 Playwright 控制 Edge 浏览器
- **修改文件**：`doubao-bridge/server.mjs`、`run-doubao.mjs`
- **验证结果**：可成功生图/生视频
- **状态**：✅ 已完成

### 1.2 Edge 单实例问题修复
- **原始问题**：Windows 上 Playwright launchPersistentContext 启动 Edge 秒退
- **问题原因**：Edge 157+ 全局单实例转发机制，新进程会转发给已有实例后退出
- **解决方案**：改为 CDP 连接已有 viewer 窗口，不新开窗口
- **修改文件**：`run-doubao.mjs`、启动脚本
- **验证结果**：可稳定连接已有 Edge 窗口
- **状态**：✅ 已完成

### 1.3 一个号一个窗口原则
- **要求**：严格禁止新开 Edge 窗口，每个账号对应一个已有窗口
- **实现**：通过 CDP 端口区分不同账号窗口
- **状态**：✅ 已完成

---

## 第二阶段：稳定性修复

### 2.1 任务一直显示"生成中"修复
- **原始问题**：豆包网页端已经生成视频，但画布一直显示生成中
- **问题原因**：
  1. `videoTaskProvider` 被硬编码存成了 "openai"，恢复任务时走错轮询分支
  2. 模型选择优先级反了
- **解决方案**：恢复任务时先试试豆包 bridge 有没有这个 jobId，找到了就用豆包分支（兼容旧数据 fallback）
- **修改文件**：`web/src/pages/canvas/project.tsx`
- **验证结果**：视频可正常回填
- **状态**：✅ 已完成

### 2.2 runJob 生命周期重写
- **原始问题**：外层 Promise + 内层 async IIFE 嵌套，异常可能导致 Promise 永远不结束
- **解决方案**：改为完整 async 函数 + try/catch/finally
- **修改文件**：`doubao-bridge/server.mjs`
- **验证结果**：所有结束路径都能正确结算
- **状态**：✅ 已完成

### 2.3 finish() 分级 kill
- **原始问题**：finish() 无条件 kill child
- **解决方案**：正常完成不 kill，超时/异常才 kill，增加终止宽限时间
- **修改文件**：`doubao-bridge/server.mjs`
- **状态**：✅ 已完成

### 2.4 close 事件代替 exit 事件
- **原始问题**：只监听 exit，最后一段 stdout 可能没读完
- **解决方案**：改用 close 事件，确保流关闭后再处理
- **修改文件**：`doubao-bridge/server.mjs`
- **状态**：✅ 已完成

### 2.5 settled 守卫防重复结算
- **原始问题**：多个结束路径（result 消息、close、超时、error）可能重复触发结算
- **解决方案**：加 settled 标志，确保 exactly-once
- **修改文件**：`doubao-bridge/server.mjs`
- **状态**：✅ 已完成

---

## 第三阶段：账号调度

### 3.1 手动选账号（manual）
- **要求**：用户必须手动选账号，禁止自动选号
- **实现**：视频节点加账号选择下拉框，Bridge 端 pickAccountByMode 统一为 manual
- **修改文件**：
  - `doubao-bridge/server.mjs`（pickAccountByMode）
  - `web/src/components/canvas/nodes/lihuo/doubao-video-node.tsx`（UI）
- **状态**：✅ 已完成

### 3.2 自动分配框架（auto）
- **原始需求**：根据真实额度自动选账号
- **实际情况**：豆包没有额度查询接口，所有账号额度状态 = unknown
- **解决方案**：框架搭好，但默认禁用，返回 ACCOUNT_QUOTA_UNKNOWN 错误
- **状态**：⚠️ 框架已搭，实际不可用

### 3.3 resolveAccountId 验证
- **要求**：必须验证账号存在及登录状态，不允许静默切换账号
- **实现**：`doubao-bridge-adapter.ts` 里 resolveAccountId() 验证账号存在和登录态
- **状态**：✅ 已完成

---

## 第四阶段：产物类型与校验

### 4.1 expectedArtifactKind 贯穿全链路
- **原始问题**：靠中文字符串 capability 推断任务类型，不可靠
- **解决方案**：任务创建时显式传 expectedArtifactKind=image/video，Bridge 校验， Runner 按类型提取产物
- **修改文件**：
  - `doubao-bridge/server.mjs`（校验）
  - `doubao-bridge/run-doubao.mjs`（按类型提取）
  - `web/src/services/api/doubao-bridge-adapter.ts`（传参）
- **状态**：✅ 已完成

### 4.2 媒体文件校验
- **原始问题**：下载的文件可能是 HTML 错误页、不完整文件、格式不匹配
- **解决方案**：检查文件大小 + magic number + MIME 一致性 + 扩展名匹配
- **修改文件**：`vendor/doubao-brain/dbb/src/site.mjs`
- **校验失败处理**：删除不完整文件，标记任务失败
- **状态**：✅ 已完成

---

## 第五阶段：模型参数 Schema 化（开发中）

### 5.1 第一阶段：类型定义
- **内容**：`model-schema.ts` 定义 ParameterSchema、ModelDefinition、ProviderConfig 等类型
- **内置示例**：豆包 Seedance 2.5、Seedream 5.0、OpenAI gpt-image-1
- **状态**：✅ 已完成

### 5.2 第二阶段：DynamicParamsPanel 组件
- **内容**：根据 Schema 动态渲染 select/slider/number/boolean/text 等控件
- **状态**：✅ 组件已完成，未接入节点

### 5.3 第三阶段：接入豆包视频节点（未完成）
- **问题**：之前改的 `doubao-video-node.tsx` 节点已被删除，代码白改了
- **现状**：DynamicParamsPanel 组件存在，但未接入任何实际节点

### 5.4 第四阶段：参数提交打通（未完成）
- **现状**：动态面板参数尚未进入实际任务请求
- **新旧参数并存**：
  - 旧参数：metadata.ratio、metadata.duration（全局配置，实际生效）
  - 新参数：metadata.paramsCache[modelId]（缓存结构已设计，未实际使用）

---

## 第六阶段：节点注册清理

### 6.1 删除豆包专属节点
- **决策**：豆包模型合并到通用生图/视频卡片的模型下拉里，不单独做豆包节点
- **执行**：从 `lihuo/index.tsx` 注册列表里删除豆包图片/视频节点
- **状态**：✅ 已完成

---

**信息验证状态：**
- ✅ 大部分修复：源码可验证
- ⚠️ 时间线：来自交接报告，未逐个 git log 验证
