# Stage 4 第一阶段修复 · 测试证据

执行环境：Windows 本机，仓库 `C:\Users\qq308\Desktop\lihuo`，前端目录 `web`。所有测试均为**确定性测试 / 内存测试 / 构建检查**，没有连接真实浏览器、真实 IndexedDB 或真实 AI 模型。

## 1. 等级说明

- **A 确定性逻辑**：纯函数、内存 store 或 fixture 断言；可重复执行。
- **B 集成 fixture**：Vite SSR 加载真实模块，但状态存储是内存实现，不是浏览器 IndexedDB。
- **C 构建/类型**：TypeScript 与 Vite 构建，只证明可编译和可打包。
- **R 真实浏览器 / I 真实 IndexedDB / M 真实 AI**：本轮均为 **未执行**。

## 2. 汇总

| 编号 | 检查 | 命令 | 结果 | 等级 | R | I | M |
|---|---|---|---|---|---|---|---|
| T1 | Stage 4A 基础审核 | `npx tsx scripts/stage4a-core-check.ts` | `9 groups passed`，exit 0 | A | 否 | 否 | 否 |
| T2 | Stage 4B 审核列表/统计回归 | `npx tsx scripts/stage4b-core-check.ts` | `8 groups passed`，exit 0 | A | 否 | 否 | 否 |
| T3 | Stage 4C 连续性 | `npx tsx scripts/stage4c-core-check.ts` | `19 rules, 26 groups passed`，exit 0 | A | 否 | 否 | 否 |
| T4 | Stage 4C.1 回归 | `npx tsx scripts/stage4c1-core-check.ts` | `11 identity groups, 32 action-phase cases + 8 assertions, 15 direction texts + 9 engine cases, 18 state cases (9 pairs), 12 async groups, 9 snapshot groups passed`，exit 0 | A | 否 | 否 | 否 |
| T5 | Stage 4D 核心解析/持久化 | `npx tsx scripts/stage4d-core-check.ts` | `4 P1 regression groups, AI parse groups, proposal isolation/protection groups, persistence groups passed`，exit 0 | A | 否 | 否 | 否 |
| T6 | Stage 4D 动作集成 | `node scripts/vite-ssr-check.mjs /scripts/stage4d-action-check.ts` | `shot/episode/selection review, failed run persistence, proposal apply, auto version-conflict, same-batch second proposal conflict, asset validation, manual protection, reject, storage failure passed`，exit 0 | B | 否 | 否 | 否 |
| T7 | Stage 4D.2 任务恢复/快照丢弃 | `npx tsx scripts/stage4d2-core-check.ts` | `{"ok":true,"tasks":7,"metadataGuards":3,"snapshotDiscards":7}`，exit 0 | A（内存事务） | 否 | 否 | 否 |
| T8 | 4A 严格版本 A–G | `npx tsx scripts/stage4a-strict-version-check.ts` | `A–G 7 groups passed`，exit 0 | A | 否 | 否 | 否 |
| T9 | 4D Prompt/证据/unknown/自动冲突 | `npx tsx scripts/stage4d-phase1-check.ts` | `prompt/evidence/unknown/auto-conflict 4 groups passed`，exit 0 | A | 否 | 否 | 否 |
| T10 | 项目资产 ID 校验 | `npx tsx scripts/stage4-asset-validation-check.ts` | `4 groups passed`，exit 0 | A | 否 | 否 | 否 |
| T11 | 任务状态语义 | `npx tsx scripts/stage4-task-status-check.ts` | `5 groups passed`，exit 0 | A | 否 | 否 | 否 |
| T12 | TypeScript | `npm run typecheck` | exit 0 | C | 否 | 否 | 否 |
| T13 | 生产构建 | `npm run build` | exit 0，`✓ built in 59.92s` | C | 否 | 否 | 否 |

**全部 13 项 exit 0。** 构建仍有既有动态/静态混合导入和非关键 chunk 体积 warning，不影响 exit code。

## 3. 4A 严格版本 A–G

脚本：`web/scripts/stage4a-strict-version-check.ts`。

| 组 | 场景 | 断言结果 |
|---|---|---|
| A | 版本相同、单镜内容变化 | 变化镜 stale reason=content；未变化镜仍 approved |
| B | 只提升正式版本、镜头内容不变 | 全部旧审核 stale reason=version，即使内容哈希一致 |
| C | 重新审核 | 新记录绑定当前 `storyboardVersion`；旧 audit 保留；未重审镜头仍 stale |
| D | 锁定 + 旧审核 | 锁定不把 stale 洗成 approved；锁定镜头仍按版本 stale |
| E | 重新审核后再次提升版本 | v4 记录再次 stale，不能沿用 |
| F | 旧项目缺 `storyboardVersion` | 归一化为 `-1`，不冒充当前版本 |
| G | 统计与 readiness | `reviewStats.approved=0`、stale 全量，readiness=`not_ready` 且原因含旧版本 |

测试输出：`stage4a-strict-version-check: A–G 7 groups passed`。

## 4. 4D 第一阶段 4 组

脚本：`web/scripts/stage4d-phase1-check.ts`，使用本地 JSON 文本模拟模型输出，**不调用模型**。

1. Prompt 覆盖景别、机位、运镜、角色外观、服装、服装变体，并实际携带 `outfitBindings` 等绑定上下文。
2. 证据四分类：`explicit / inference / suggestion / unknown`；空证据得到 unknown，不补成事实；声称 explicit 但 corpus 找不到时降为 inference。
3. 旧 pending 在版本变化后自动 conflict；重复归一化不重复写冲突应用记录；conflict 提案不能再次应用。
4. 证据范围：实际发送镜头与相邻上下文才进入 corpus；未发送场景的“explicit”证据降级，不能冒充事实。

测试输出：`stage4d-phase1-check: prompt/evidence/unknown/auto-conflict 4 groups passed`。

## 5. 资产校验 4 组

脚本：`web/scripts/stage4-asset-validation-check.ts`。

- 人物、服装、场景、道具缺失或类型错误 → 阻断。
- 归档资产 → 阻断。
- 同名但 ID 不同 → 仍按稳定 ID 阻断，不按名称猜测。
- 镜头组缺失、重复、跨场景、`shotIds` 未包含镜头 → 阻断。
- 对白人物未绑定 → 阻断。
- 结果只返回错误，不静默清空绑定。

测试输出：`stage4-asset-validation-check: 4 groups passed`。

**边界**：项目没有独立服装/场景变体表。`outfitId` 按 `costume` 资产 ID 校验；`locationVariantId` 保留在绑定中，但未校验变体存在性。

## 6. 任务状态 5 组

脚本：`web/scripts/stage4-task-status-check.ts`。

- `cancelling` 刷新后保留，不冒充已取消。
- `running/submitting` 刷新后按 unknown/interrupted 处理，不自动重试。
- 本地排队且确认未提交的任务刷新后 interrupted，可安全重跑。
- 旧 `canceled` 统一读为 `cancelled`。
- `cancelling` 刷新后保留取消中；`confirmCancelled()` 的实际 store 调用未在本脚本中断言。

测试输出：`stage4-task-status-check: 5 groups passed`。

**未覆盖**：`use-studio-tasks` 真实 store 的 UI 点击、`confirmCancelled` 的 store 状态转换、远端任务实际停止确认；本轮没有独立组件测试。

## 7. 4D.2 的测试边界

`stage4d2-core-check` 输出 `{"ok":true,"tasks":7,"metadataGuards":3,"snapshotDiscards":7}`。这 7 组快照删除测试是**内存 `StudioStateStore` 事务语义**，验证的是原子写入/丢弃分支，不是浏览器 IndexedDB 并发。不能写成“真实 IDB 7 组通过”。

## 8. 测试脚本本轮变更

- `stage4b-core-check.ts`：旧断言“版本变化后未变化镜头仍 approved”按严格版本规则改为 stale；`partialOnVersionChange` 不再允许旧记录写入当前版本；旧 audit 比较改为 ID 比较，避免 JSON clone 丢失 `projectId: undefined`。
- `stage4d-core-check.ts`：证据类型断言从旧 `shot_text` 改为 canonical `explicit`；`change()` helper 补 evidence/confidence。
- `stage4d-action-check.ts`：project fixture 增加人物/服装/场景/道具资产；`change()` helper 补 evidence、evidenceType、confidence；新增资产删除后提案被阻断用例；同批两条 pending 在第一条应用后，第二条自动 conflict，不再依赖“显式标记冲突”制造冲突。
- 新增 4 个脚本：`stage4a-strict-version-check.ts`、`stage4d-phase1-check.ts`、`stage4-asset-validation-check.ts`、`stage4-task-status-check.ts`。

## 9. 未执行的真实环境验证

- 未打开真实浏览器；4A 统计/九宫格/列表/Drawer/旧 audit 标签、4D 证据 UI、任务中心 cancelling 确认入口均无截图。
- 未运行真实 IndexedDB 并发、跨标签页、磁盘配额或事务 abort 复现。
- 未调用真实 AI 模型，未消耗额度；没有把 fixture 输出写成真实 AI 输出。
- 未验证 4E 预览/版本管理/最终交接；4F 未开始，第五步仍无审核闸门。

## 10. 复跑命令

```powershell
cd C:\Users\qq308\Desktop\lihuo\web

npx tsx scripts/stage4a-core-check.ts
npx tsx scripts/stage4b-core-check.ts
npx tsx scripts/stage4c-core-check.ts
npx tsx scripts/stage4c1-core-check.ts
npx tsx scripts/stage4d-core-check.ts
node scripts/vite-ssr-check.mjs /scripts/stage4d-action-check.ts
npx tsx scripts/stage4d2-core-check.ts
npx tsx scripts/stage4a-strict-version-check.ts
npx tsx scripts/stage4d-phase1-check.ts
npx tsx scripts/stage4-asset-validation-check.ts
npx tsx scripts/stage4-task-status-check.ts

npm run typecheck
npm run build
```
