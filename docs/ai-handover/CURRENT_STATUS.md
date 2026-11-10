# 离火 Lihuo 当前状态快照

> 本文档记录当前开发进度，供新 AI 快速了解"现在做到哪了"。
> 更新时间：2026-11-09（已按源码复核修订）

---

## 一、整体进度

```
豆包链路接入          ████████████████████ 100%
稳定性修复            ████████████████████ 100%
账号调度（manual）    ████████████████████ 100%
自动分配（auto）      ████░░░░░░░░░░░░░░░░  20%（框架搭好，额度 unknown）
模型 Schema 类型      ████████████████████ 100%（含 configKey 绑定）
DynamicParamsPanel    ████████████████████ 100%（已接入视频面板）
视频参数提交打通      ████████████████████ 100%
图片参数提交打通      ░░░░░░░░░░░░░░░░░░░░   0%
按模型隔离参数        ░░░░░░░░░░░░░░░░░░░░   0%（仍共用全局配置）
```

---

## 二、最近完成的工作

### 模型参数 Schema 化（第一、二阶段）
1. ✅ 创建 `web/src/stores/model-schema.ts`
   - 定义了 ParameterSchema、ModelDefinition、ProviderConfig 等类型
   - 内置了豆包 Seedance 2.5、Seedream 5.0、OpenAI gpt-image-1 的 Schema 示例
   - 实现了参数校验、旧参数迁移函数

2. ✅ 创建 `web/src/components/DynamicParamsPanel.tsx`
   - 根据 Schema 动态渲染 select/slider/number/boolean/text/textarea
   - 支持分组、条件显示、描述提示
   - 复用 Ant Design 组件

---

## 三、上一轮卡点的处理结果

### 原问题：Schema 面板没接入真实链路
- 第三阶段想接入豆包视频节点，但该节点已删除（合并到通用视频卡片）
- 第四阶段做通用视频节点的演示面板，用户觉得是空壳，要求回退

### 处理方式（本轮）
1. 先确认唯一真实的视频参数 UI 是 `video-settings-panel.tsx`（视频工作台桌面/移动端 + 画布弹层共三处都用它）
2. 不新建第二套参数存储，改为把 Schema 绑定到全局 `AiConfig`（`ParameterSchema.configKey`）
3. 面板的比例选项、时长范围改由当前模型 Schema 决定；豆包视频按要求收敛为 4–15s
4. `DynamicParamsPanel` 只渲染面板没有专门控件的参数（非豆包模型的音频/水印开关），不再做空壳
5. 提交侧 `video.ts` 豆包分支改用 `readVideoRequestParams(config)`，保证面板值就是请求值

### 仍需用户实测确认
- 见 `docs/content/docs/progress/pending-test.mdx` 首条：比例选项、4–15s 范围、「自动」是否原样提交、音频/水印开关是否进请求体

---

## 四、当前代码状态（已验证）

### Schema 相关文件
| 文件 | 状态 |
|------|------|
| `web/src/stores/model-schema.ts` | ✅ 已生效：`resolveVideoParamSchema` / `readSchemaConfigValues` / `schemaParamPatch` / `readVideoRequestParams` |
| `web/src/components/DynamicParamsPanel.tsx` | ✅ 已生效：被 `video-settings-panel.tsx` 引用 |
| `web/src/components/video-settings-panel.tsx` | ✅ 已改：比例选项、时长范围来自 Schema，新增「更多参数」分组 |
| `web/src/services/api/video.ts` | ✅ 已改：豆包分支用 `readVideoRequestParams(config)` |
| `web/src/stores/__tests__/model-schema.test.ts` | ✅ 仍覆盖旧导出（未覆盖新增函数） |

### 仍未做
- 图片侧（`image-settings-panel.tsx`、`services/api/image.ts`）没接 Schema
- 参数仍共用全局配置，切模型不隔离
- 旧的 `getModelParams()` / `migrateLegacyParams()` 只剩测试在用，主链路不走它们

### 死代码清理（本轮）
- 删除 `nodes/lihuo/doubao-video-node.tsx`、`doubao-image-node.tsx`、`doubao-ref-picker.tsx` 三个零引用文件（约 72KB）
- 删除前已备份到 `.backup/2026-11-09-dead-nodes/`（项目无 git，用户确认后可自行删除该备份）
- `nodes/lihuo/` 现在只剩 `lihuo-note.tsx`、`prompt-lab.tsx`、`director-node.tsx` 与注册表 `index.tsx`

---

## 五、Build 状态

- `vite build`（`pnpm build`）：✅ 通过，exit code 0，7809 modules，38.4s，产物 `dist/assets/index-*.js` 3.75MB（仍有 chunk 体积警告）
- `tsc --noEmit`（`pnpm typecheck`）：❌ **基线不干净，改动前就有 8 个类型错误**，不是本轮引入：
  1. `components/DynamicParamsPanel.tsx:61` — `Slider` 不支持 `size` 属性
  2. `components/DynamicParamsPanel.tsx:131` — `Number(values[...]) || field.defaultValue` 把 `unknown` 渲染到 JSX
  3. `pages/canvas/project.tsx:329` — `videoTaskProvider` 允许 `plugin`，但节点元数据类型只允许 `openai`/`gemini`
  4. `pages/canvas/project.tsx:374` — `provider` 为 `string`，与联合类型不兼容
  5. `services/api/video.ts:108` — `accountSelectionMode` 为 `string`，与 `"manual" | "auto" | "round-robin"` 不兼容
  6. `stores/__tests__/model-schema.test.ts:7` — 导入路径写成 `./model-schema`，应为 `../model-schema`
  7. `stores/model-schema.ts:133` — `getModelSchema()` 返回类型里没有 `schemaVersion`
  8. `stores/model-schema.ts:290` — `validateParamsAgainstSchema()` 里 `value` 收窄失效
- 结论：`pnpm build` 只跑 esbuild、不做类型检查，所以"构建通过"不等于类型正确；接手时若 `pnpm typecheck` 报错，先对照上面这份基线，不要误以为是自己改坏的。

---

## 六、用户当前最关心的问题

1. **模型参数 Schema 化**——视频侧已打通（比例/时长/音频/水印都进真实请求），图片侧还没做
2. **不要做空壳演示**——先打通真实参数链路，再做 UI
3. **不要改已经删除的节点**——先确认节点真的被注册了再改

---

## 七、文档校订记录（源码复核）

接手时对文档做了逐条核对，以下四处原描述与代码不符，已按实测修正：

| 原描述 | 实测结论 |
|--------|----------|
| 发版本流程为「提交 + 打 tag」 | 项目目录**不含 `.git`**，`git status` 直接报 not a git repository，该流程当前无法执行 |
| 死代码只有 `doubao-video-node.tsx` | 共 3 个文件零引用：`doubao-video-node.tsx`(44KB)、`doubao-image-node.tsx`(27KB)、`doubao-ref-picker.tsx`(4KB) |
| 参数存于 `metadata.ratio` / `metadata.duration` | 实际存于全局 `AiConfig`：`size` / `vquality` / `videoSeconds` / `videoMode` / `videoGenerateAudio` / `videoWatermark`；画布上节点 `metadata` 用同名小写字段（`size`/`seconds`/`vquality`/`videoMode`）覆盖全局值；`ratio`、`duration` 只出现在豆包适配器与 Bridge 侧 |
| `video-settings-panel.tsx` 已回退原状 | 确认为原状：硬编码 5 组控件 + `onConfigChange(key, value)`，无任何 Schema 调用 |

另外两处新发现（原文档未记录）：

- **视频面板时长上限与豆包真实能力不一致**：面板允许 4–30s，豆包网页端实际 4–15s（见账号目录 `state/video-caps.json`）。
- **「自动」比例会被强制成 16:9**：`videoAspectRatio()` 对 `auto` 回落 16:9，豆包网页端「自动」能力被吞掉。

---

**信息验证状态：**
- ✅ 所有文件状态：源码已验证
- ✅ 第七节表格：逐条文件/接口复核
- ⚠️ 进度百分比：主观估算

