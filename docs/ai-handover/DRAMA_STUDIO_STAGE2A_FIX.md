# 阶段 2A 验收修复报告

范围：只修复阶段 2A 初审发现的 P1 / P2 问题。没有启动阶段 2B，没有重跑真实模型分析，没有新增模型调用额度；没有修改 `server/`、`doubao-bridge`、无限画布核心、全局 `AiConfig` 或全局账号池行为；没有执行 `git reset` / `checkout` / `stash` / `clean`，没有提交或推送。

## 1. 修复文件清单

| 文件 | 类型 | 本轮 +/- | 说明 |
| --- | --- | ---: | --- |
| `web/src/lib/studio/novel-analysis.ts` | 修改 | +44 / -19 | 证据规范化匹配、真实字符区间、丢弃无效证据、禁止模型页码覆盖 |
| `web/src/lib/studio/novel-model.ts` | 修改 | +28 / -6 | 内置豆包 / Dola 运行前校验项目账号，请求入口二次校验 |
| `web/src/lib/studio/model-profile.ts` | 修改 | +5 / -0 | 内置模型的有效配置副本先清空全局账号 |
| `web/src/pages/drama/studio/project-settings.tsx` | 修改 | +13 / -5 | 项目账号状态、未登录 / provider 不匹配 / 额度未知提示 |
| `web/src/lib/studio/novel-chapters.ts` | 修改 | +48 / -18 | 自然边界分块、有限重叠、PDF 空白页页码修正 |
| `web/src/lib/studio/novel-merge.ts` | 修改 | +36 / -10 | 证据按真实字符区间去重、统计排除无效证据 |
| `web/src/lib/studio/novel-import.ts` | 修改 | +1 / -1 | PDF 空白页提示改为“已过滤并重算页码” |
| `web/src/lib/studio/project-bridge-account.ts` | 新增 | +106 / -0 | 项目账号校验与配置应用纯函数 |
| `web/scripts/stage2a-fix-check.ts` | 新增 | +250 / -0 | 本轮确定性验收测试 |

文档同步：`CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx`、`docs/content/docs/progress/todo.mdx`。

## 2. P1 证据校验漏洞

### 修复前

- `normalizeEvidence()` 对空摘录、原文不匹配的摘录仍然 `push` 进 `evidence`。
- 未匹配摘录只加 warning，仍可保留 `evidenceType: "explicit"`。
- 精确匹配使用 `indexOf`，空格 / 换行不同会失配。
- 模型给的 `sourceLocation.page` 会覆盖章节解析器页码。
- 关系、世界观、地点、事件、伏笔的证据统计来自未经有效性过滤的数组，并且 `world.evidence`、`scene.variants.evidence` 会重复计数。
- 模型给出错误 `chapterId` 时会回退到当前分块首章，错误定位被静默改正。

### 修复后

- 空摘录、原文不匹配、错误章节 ID、跨章节摘录一律丢弃，不进入 `evidence`。
- 仅空格 / 换行不同的摘录通过“去空白规范化文本 + 位置索引”匹配；保存的 `excerpt` 是原文真实切片，不再是模型原文。
- `sourceLocation.charStart` / `charEnd` 使用 `chapter.charStart + 原文局部位置`，对应整本原文真实字符区间。
- 模型返回的 `sourceLocation.page` / `label` 不再采信；`pageStart` / `pageEnd` 只来自解析器。
- 人物允许保留为空证据待审核条目；关系在无有效证据时直接丢弃。
- `countEvidence()` 按实体过滤无 `charStart` / `charEnd`、空摘录的证据，并按原文区间去重；不再重复统计 `world` 根节点派生证据和 `scene` 已聚合的变体证据。

## 3. P1 豆包 / Dola 项目账号强制隔离

### 修复前

- 项目参数有 `accountId` 才覆盖 `config.doubaoAccountId`；没有选择时会保留 `effectiveProjectConfig()` 从全局配置带过来的账号。
- 没有校验账号是否存在、provider 是否匹配、是否登录、是否异常、对话额度是否被拒绝。
- UI 只显示“未登录”，没有项目账号缺失 / 站点不匹配 / 额度未知的阻断说明。
- 校验只可能发生在 UI，服务调用入口没有账号一致性检查。

### 修复后

- `effectiveProjectConfig()` 对内置豆包 / Dola 模型先把 `doubaoAccountId` 清空；全局账号无法进入项目配置副本。
- `novelTextModelRuntime()` 调 Bridge `listAccounts()`，用 `validateProjectBridgeAccount()` 校验：
  - 项目账号缺失：阻止，提示“不会继承全局账号池账号”。
  - 账号不存在：阻止。
  - `provider` 与模型不一致：阻止。
  - 未登录、登录态异常：阻止。
  - 对话额度被平台拒绝：阻止，并明确“不会自动切换账号”。
- `applyProjectBridgeAccount()` 只把项目账号写入配置副本，不修改传入的全局对象。
- `requestNovelText()` 发送前再次校验运行时账号与 `config.doubaoAccountId` 一致，防止绕过 UI 直接调用。
- 项目设置页显示账号锁定状态、阻断原因和“额度状态：未知”；账号下拉只列出与当前站点严格匹配的账号。

## 4. P2 证据定位、分块与 PDF 页码

### 超长段落分块

- 修复前：`paragraph.match(/[^\\n]{1,maxChars}/g)` 硬切，容易在句子中间断开，且没有上下文重叠。
- 修复后：
  - 优先在空行 / 换行 / 句末标点 / 逗号 / 空格等自然边界切分。
  - 以 8,000 字为硬上限，加入最多 160 字上下文重叠。
  - 重叠分块产生的同一原文证据按 `chapterId + charStart + charEnd` 去重；同章同标题事件保持单条。
  - 本轮样本分块 2 个，最大 `charCount` 7,739。

### PDF 空白页页码

- 修复前：`joined` 已过滤空白页，但 `pageRanges` 仍遍历所有页并按 `上一页 end + 2` 累加，空白页之后的章节页码会整体前移。
- 修复后：`pageRanges` 与 `joined` 使用同一份“有文本页”序列，空白页只从正文过滤，不参与字符偏移；章节 `pageStart` / `pageEnd` 指向原始 PDF 页码。
- 测试样本：第 1 页第一章、第 2 页空白、第 3 页第二章 → 第一章 `1–3`，第二章 `3–3`。

## 5. 新增测试与结果

### `web/scripts/stage2a-fix-check.ts`

覆盖：

- 正确摘录。
- 错误摘录。
- 空摘录。
- 错误章节 ID。
- 跨章节摘录。
- 仅空格 / 换行不同的摘录。
- 规范化后真实 `charStart` / `charEnd`；模型伪造页码被忽略。
- 无效证据不能让关系通过，也不能进入有效分析档案统计。
- 超长段落自然边界、8,000 字上限、有限上下文重叠。
- 重叠分块证据 / 事件去重。
- PDF 空白页过滤后的页码范围。
- 项目账号：无项目账号、有效账号、未登录、provider 不匹配、状态异常、额度拒绝、全局账号存在但项目为空、项目账号与全局账号不同。

实际输出：

```json
{
  "ok": true,
  "evidence": {
    "valid": 1,
    "whitespace": 1,
    "wrong": 0,
    "empty": 0,
    "badChapter": 0,
    "crossChapter": 0,
    "invalidArchiveEvidence": 0
  },
  "chunks": { "count": 2, "maxChars": 7739 },
  "pdf": [
    { "pageStart": 1, "pageEnd": 3 },
    { "pageStart": 3, "pageEnd": 3 }
  ],
  "account": {
    "noProjectRejected": true,
    "validProject": true,
    "requestAccountId": "project-doubao",
    "notLogged": false,
    "providerMismatch": false,
    "abnormal": false,
    "quotaBlocked": false,
    "globalAccountUntouched": true
  }
}
```

### 项目账号缺失不回退全局账号的证据

- `noProjectRejected: true`：项目账号为空时 `validateProjectBridgeAccount()` 返回失败。
- `globalAccountUntouched: true`：传入 `{ doubaoAccountId: 全局账号 }` 的配置对象没有被修改。
- 同一用例中 `applyProjectBridgeAccount()` 对缺失项目账号直接抛错，错误文案包含“不会继承全局账号池账号”；因此请求不会使用全局账号。
- 项目账号与全局账号不同时，`requestAccountId: "project-doubao"`，证明应用后的请求配置只写项目账号。

### 证据无效不进入有效档案的证据

- `invalidArchiveEvidence: 0`：所有人物 / 关系 / 世界观 / 地点 / 事件 / 伏笔都只提供无效摘录时，`finalizeNovelAnalysis()` 的 `stats.evidenceCount` 为 0。
- 同一用例 `invalidAnalysis.relationships.length === 0`：空证据关系没有进入档案。
- 人物仍保留 1 条空证据待审核记录，符合“人物可保留、关系不可保留”的要求。

### 回归测试

`cd web && npx tsx scripts/stage2a-core-check.ts`：

```json
{
  "ok": true,
  "chapters": 3,
  "chunks": 2,
  "maxChunkChars": 7739,
  "characters": 2,
  "relationships": 1,
  "events": 2,
  "foreshadowings": 1,
  "evidence": {
    "chapters": 3,
    "chunks": 2,
    "calls": 2,
    "evidenceCount": 11,
    "explicitCount": 9,
    "inferredCount": 2,
    "generatedCount": 0
  },
  "warnings": 0,
  "compactChars": 610
}
```

说明：旧口径 13 条包含 `world` 根节点派生副本和 `scene` 顶层 / 变体重复副本；本轮按真实字符区间去重后为 11 条，不是有效原文证据丢失。核心样本没有真实模型调用。

### typecheck / build

- `cd web && npm run typecheck`：通过，无输出错误。
- `cd web && npm run build`：通过，Vite 产出完成；仅有仓库既有的动态 / 静态混合导入与 500 kB chunk 警告。

## 6. Git 差异统计

当前阶段 2A 代码文件尚未提交，`git status` 显示为未跟踪；因此普通 `git diff --stat` 无法给出本轮差异。使用上一版 2A 交付 Diff 与基线快照重建“修复前”文件后，按文件比较得到本轮净增量：

```text
9 files changed, 531 insertions(+), 59 deletions(-)
```

分文件：

```text
web/src/lib/studio/novel-analysis.ts                +44 -19
web/src/lib/studio/novel-model.ts                   +28  -6
web/src/lib/studio/model-profile.ts                  +5  -0
web/src/pages/drama/studio/project-settings.tsx     +13  -5
web/src/lib/studio/novel-chapters.ts                +48 -18
web/src/lib/studio/novel-merge.ts                   +36 -10
web/src/lib/studio/novel-import.ts                   +1  -1
web/src/lib/studio/project-bridge-account.ts       +106  -0
web/scripts/stage2a-fix-check.ts                   +250  -0
```

Git 状态：`CHANGELOG.md`、`pending-test.mdx`、`todo.mdx` 为已跟踪修改；上述 9 个阶段 2A 代码 / 测试文件仍为未跟踪（`??`）。没有自动提交、没有推送。

## 7. 明确未做

- 没有启动阶段 2B。
- 没有重新执行真实模型分析。
- 没有修改外部正式后端、`server/`、`doubao-bridge`。
- 没有修改无限画布核心、全局 `AiConfig`、全局账号池行为。
- 没有覆盖既有未提交修改。
- 没有 `git reset` / `checkout` / `stash` / `clean`。
- 没有自动提交或推送。

完成。等待用户最终验收。
