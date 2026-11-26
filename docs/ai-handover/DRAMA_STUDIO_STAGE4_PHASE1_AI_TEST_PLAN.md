# Stage 4 第一阶段 · 真实 AI pending 并发测试方案

状态：**仅方案，未执行。本轮真实模型调用次数为 0，未消耗额度。**

本方案用于验证：真实模型产生 pending 提案时，正式分镜版本变化、刷新、双标签页、自动 conflict 和重新审核是否都遵循 4A/4D 的严格版本与证据规则。方案不代替确定性测试，也不把 fixture 结果写成真实 AI 结果。

## 1. 需要用户先确认的事项

| 项目 | 当前状态 | 执行前必须确认 |
|---|---|---|
| 模型 | 未指定 | 使用当前隔离项目绑定的**文本模型**；确认 provider、模型名、账号/区域和是否走 Bridge。不得用图像/视频模型，不得用 Mock 模型。 |
| 调用次数 | 计划 5 次 | 最多 5 次真实文本调用；不自动重试。若失败，需用户确认后才可补跑。 |
| 输入上限 | 建议每次 ≤ 120k input tokens | 以项目实际 Prompt 为准；超过上限停止，不静默截断关键镜头。 |
| 输出上限 | 建议每次 ≤ 8k output tokens | 避免模型输出过长；不是对模型能力的承诺。 |
| 预计费用/额度 | **无法在模型单价确认前给出可信金额** | 执行前按“模型单价 × 实际 token 上限”计算，并写入确认记录；建议设置硬上限：5 次、总计 input ≤ 600k tokens、output ≤ 40k tokens。超过即停止。 |
| 隔离项目 | 未创建 | 新建 `阶段4第一阶段-AI并发-<时间戳>`，记录 projectId；不得使用原始 live A，不得把 `proj-UORILWcK` 当原始 A。 |
| 浏览器/端口 | 未指定 | 确认测试端口和两个标签页；不得关闭用户正在使用的浏览器/标签页。 |
| 数据备份 | 未执行 | 测试前导出隔离项目 JSON 并记录 SHA256；测试后再导出一次。不得删除原项目。 |
| 删除测试项目 | 未授权 | 测试结束默认保留；只有用户明确确认后才能删除。 |

**没有以上确认，不发起任何真实模型请求。**

## 2. 测试前置

1. 在隔离项目内准备一集正式分镜，至少 3 个镜头、2 个镜头组，带人物/服装/场景/道具绑定；正式版本记为基线 `v0`。
2. 先生成一轮**不调用模型**的当前版本审核，确保 `storyboardReview.storyboardVersion = v0`，至少一个镜头 approved，作为“旧审核对照”。
3. 记录测试前项目 JSON、项目 ID、分镜版本、审核记录 ID、审核 run ID；导出备份并计算 SHA256。
4. 确认当前项目 AI 配置为真实文本模型，但**先不点击审核**。
5. 打开两个标签页 A/B，均进入同一隔离项目的第四步审核工作台；等待 hydration 完成，确认两边显示同一 `projectId` 和 `v0`。双 pending 版本变化场景另开一个普通编辑标签页 C（不调用模型）。
6. 在测试记录中写明：模型名、provider、账号、端口、项目 ID、基线版本、备份 SHA256。
7. 如果无法确认隔离项目或备份，停止，不调用模型。

## 3. 调用与场景

### AI-01：单镜真实审核（1 次调用）

- 在标签页 A 选择 1 个镜头，点击“AI 审核”。
- 等待真实 run 完成；记录 runId、promptVersion、输入/输出 token、耗时、findings、proposals。
- 验证：
  - promptVersion 为 `stage4d-storyboard-review-v2`。
  - Prompt 只发送选中镜头 + 必要相邻上下文；finding/proposal 的 shotIds 不超出允许范围。
  - 每条 change 有独立 evidence、evidenceType、confidence、sourceShotIds/sourceChapterId/sourceVersion（适用时）。
  - 空证据/unknown 的 change 不可勾选；“全选”不会选中它。
  - 没有把模型推断标成 explicit。
- 不应用提案，保留 pending 作为后续对照。
- 如果模型未返回 proposal，如实记录“无提案”，不重试、不伪造。

### AI-02：选中多镜真实审核 + 版本变化（1 次调用）

- 在标签页 A 选择 2 个镜头（跨镜头组或相邻组），发起真实审核。
- 在请求 pending 期间，标签页 B 通过正常 UI 修改正式分镜（例如修改一个镜头动作并保存），使正式版本从当前 `vN` 递增到 `vN+1`。
- 等待 AI-02 返回。
- 验证：
  - run 绑定旧版本 `vN`；不会写入 `vN+1` 的当前审核。
  - 旧 pending 提案自动 `conflict`，`decidedBy=system:version-guard`、`autoConflict=true`；已有 accepted 被清空，rejected 写全。
  - 冲突应用记录只出现一次；重复刷新不重复写。
  - 列表、九宫格、Drawer、统计、readiness 均显示旧审核 stale/conflict，不显示 pending。
  - 尝试应用旧提案被拒绝，正式版本仍为 `vN+1`。
- 如果 B 的保存没有真正提升版本，停止该场景，先修复测试前提，不把结果算通过。

### AI-03：整集真实审核 + 快照/版本变化（1 次调用）

- 标签页 A 发起整集 AI 审核。
- pending 期间，标签页 B 应用一个旧快照（正常 UI，产生新正式版本 `vN → vN+1`），或修改正式分镜。
- 等待返回。
- 验证：
  - 整集 run 绑定 `vN`，不写 `vN+1` 当前审核。
  - 自动 conflict；旧 pending 不复活。
  - refresh 两个标签页后，旧 pending 仍不出现；旧 audit 保留并标注旧版本。
  - readiness 不因旧 approved 变成 ready。
  - 快照应用的资产校验和版本守卫均未绕过。

### AI-04：双标签页真实 pending 并发（2 次调用）

- 标签页 A 发起单镜或选中审核（第 1 次真实调用），保持 pending。
- 标签页 B 在同一项目上发起另一个真实审核（第 2 次真实调用，选中不同镜头），两个请求同时 pending。
- 在两个 run 都 pending 时，由标签页 C（普通编辑页，不发起 AI）通过正常 UI 修改正式分镜，使正式版本变化。
- 验证：
  - A/B 两个 run 都绑定各自发起时的旧版本，不互相覆盖。
  - 版本变化后，两边 pending 都转 conflict，不能有一个被当成当前 pending。
  - 任何一边都不能用旧版本审核写入新版本。
  - 只有实际应用成功的提案产生正式写入；另一个保持 conflict/失败，不静默合并。

### AI-05：同批多提案的第二条冲突（0 次新增调用）

- 执行顺序放在 AI-01 返回后、AI-02 版本变化前；沿用 AI-01 已返回的 run。
- 只有 AI-01 的 run 真实返回**多条 proposal**时才执行：在 A 应用同批第一条 proposal，正式版本 `v0 → v1`。
- 在 B 刷新/切换集/重开，并观察未应用的第二条 proposal。
- 验证：
  - 已应用 proposal 写入 v1；同批未应用 proposal 自动 conflict，不会再次应用。
  - 刷新后旧 pending 不再显示为普通 pending；若数据库仍保留旧 JSON，读取归一化必须显示 conflict。
  - 重新审核只能生成绑定当前版本的新记录；旧 audit 不删除。
  - 应用第二条旧提案被拒绝，正式版本不变。

如果 AI-01 的 run 没有返回多条 proposal，本场景标记为“真实模型未覆盖”，由 `stage4d-action-check` 的同批 fixture 用例提供逻辑证据；不为了制造多条 proposal 补调用、改模型输出或伪造 pending。

**建议执行顺序**：AI-01 → AI-05（仅当 AI-01 有多条 proposal）→ AI-02 → AI-03 → AI-04。AI-05 不新增调用。

**总计：5 次真实文本调用**（AI-01 1 次、AI-02 1 次、AI-03 1 次、AI-04 2 次；AI-05 复用 AI-01 结果，不新增调用）。不自动重试；每次调用前记录预算，超过上限立即停止。

## 4. 每次调用必须记录

- 调用时间、标签页、项目 ID、模型/provider/账号、操作类型（单镜/选中/整集）、发起时版本、返回后版本。
- runId、promptVersion、输入/输出 token、耗时、HTTP/ Bridge 状态、错误原文。
- findings/proposals 数量、evidenceType 分布、unknown 数量、被拒绝/降级的证据。
- 页面截图：审核前、pending、返回、version conflict、刷新后、apply 拒绝、Drawer 历史。
- IndexedDB 只读快照或项目导出 JSON；记录 SHA256。
- 如果使用真实计费，记录账单归属或可查询的 requestId；不能只凭前端显示声称费用准确。

## 5. 通过标准

必须同时满足：

1. 真实 run 的 promptVersion 为 v2，单镜/选中/整集范围与实际输入一致。
2. proposal change 有独立证据字段；unknown/空证据不可应用；explicit 不来自未发送内容。
3. 版本变化后旧 pending 自动 conflict，旧 approved 不再计入当前统计/readiness。
4. 刷新、切换集、重开、双标签页都不能恢复普通 pending。
5. 旧提案应用被拒绝，正式版本不被旧审核改写。
6. 重新审核创建当前版本新记录，旧 audit 保留。
7. 快照/提案资产校验失败时保留正式分镜，不静默清空绑定。
8. 所有截图、run 记录、项目导出和 SHA256 可复核；不把 Mock/fixture 写成真实 AI 结果。

任何一项失败，都只记录失败，不通过“重试到成功”掩盖。

## 6. 停止条件

出现以下任一情况立即停止，不继续消耗额度：

- 模型/provider/账号与确认记录不一致。
- 单次费用或累计费用超过用户设定上限。
- 输入超过 120k tokens 或输出异常截断。
- 真实项目 ID 不是隔离项目，或原始 live A 被打开。
- 任何操作要求删除原项目/快照、关闭用户浏览器、执行 reset/clean/stash。
- 页面出现无法解释的 pending 复活、版本被旧审核改写、资产被静默清空。
- 测试过程中无法确认远端任务是否仍在执行。

## 7. 回滚与清理

- 默认保留隔离项目和全部 run/审核记录，供复核。
- 不删除、不重建原项目；不删除原始快照。
- 测试前备份和测试后导出都保留在 `docs/ai-handover/backups/` 下，记录 SHA256。
- 只有用户明确确认后，才删除隔离测试项目；删除前再次导出并确认项目 ID 不是原项目。
- 若出现真实数据损坏，停止测试，按备份恢复；不得用 `git reset/clean/stash/checkout` 处理。

## 8. 本轮结论

- 本轮**未执行**上述任何真实模型调用。
- 现有 `stage4d-action-check` 等确定性测试不能替代本方案；它们使用 fixture/内存 store，不是真实 AI pending 并发。
- 执行本方案前，必须先完成第 1 节的模型、调用次数、费用/额度、隔离项目和浏览器授权确认。
