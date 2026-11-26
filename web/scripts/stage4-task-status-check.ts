// 任务状态语义：旧 canceled 统一读为 cancelled；cancelling 表示远端未确认，刷新不冒充已取消；
// running/submitting 刷新后仍按 unknown/interrupted 处理，避免自动重试。
import assert from "node:assert/strict";

import type { StudioTask, StudioTaskStatus } from "../src/types/studio";
import { normalizeStudioTaskStatus, recoverInterruptedTask } from "../src/lib/studio/task-recovery";

const now = "2026-11-26T14:00:00.000Z";

function task(status: StudioTaskStatus, remote = false): StudioTask {
    return {
        id: `task-${status}`,
        kind: "video",
        label: "测试任务",
        status,
        submitState: remote ? "submitted" : "not_submitted",
        logs: [],
        createdAt: now,
        updatedAt: now,
        ...(remote ? { remote: { provider: "cloud" as const, taskId: "remote-1", model: "test" } } : {}),
    } as StudioTask;
}

assert.equal(normalizeStudioTaskStatus("canceled"), "cancelled");
assert.equal(normalizeStudioTaskStatus("cancelling"), "cancelling");
assert.equal(normalizeStudioTaskStatus("cancelled"), "cancelled");

// 刷新/重开：cancelling 保留取消中，不冒充已取消。
{
    const recovered = recoverInterruptedTask(task("cancelling"), now);
    assert.equal(recovered.status, "cancelling");
    assert.equal(recovered.error?.includes("尚未确认") || recovered.error?.includes("远端尚未确认"), true);
}

// 刷新/重开：running/submitting 且可能已到远端 -> unknown，禁止自动重试。
for (const status of ["running", "submitting"] as const) {
    const recovered = recoverInterruptedTask(task(status, true), now);
    assert.equal(recovered.status, "unknown");
    assert.equal(recovered.submitState, "unknown");
}

// 刷新/重开：本地排队且确认未提交 -> interrupted，可安全重跑。
for (const status of ["queued", "pending"] as const) {
    const recovered = recoverInterruptedTask(task(status, false), now);
    assert.equal(recovered.status, "interrupted");
    assert.equal(recovered.submitState, "not_submitted");
}

// 旧数据 canceled 刷新后读为 cancelled，不残留旧枚举。
{
    const recovered = recoverInterruptedTask(task("canceled"), now);
    assert.equal(recovered.status, "cancelled");
}

console.log("stage4-task-status-check: 5 groups passed");
