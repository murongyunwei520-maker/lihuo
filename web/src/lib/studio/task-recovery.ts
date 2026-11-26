import type { StudioTask, StudioTaskStatus } from "@/types/studio";

/** 旧数据里的 canceled 统一读为 cancelled；写入时只产生 cancelled。 */
export function normalizeStudioTaskStatus(status: StudioTaskStatus): StudioTaskStatus {
    return status === "canceled" ? "cancelled" : status;
}

/**
 * 刷新/重开后的恢复语义：running/submitting 或已记录 remote 的任务可能已被远端接受，
 * 必须标 unknown 并禁止自动重试；只有仍在本标签页队列里、确认未提交的排队任务才可安全恢复。
 * cancelling 表示取消请求已发出但远端未确认，刷新后保留该状态，不能冒充已取消。
 */
export function recoverInterruptedTask(task: StudioTask, now = new Date().toISOString()): StudioTask {
    const normalized = normalizeStudioTaskStatus(task.status);
    if (normalized === "cancelling") {
        return {
            ...task,
            status: "cancelling",
            error: task.error ?? "取消请求已发出，但远端尚未确认停止；刷新后请核对远端结果，不自动恢复",
            updatedAt: now,
        };
    }
    if (!["running", "submitting", "queued", "pending", "retrying"].includes(normalized)) {
        return normalized === task.status ? task : { ...task, status: normalized, updatedAt: now };
    }
    const mayHaveReachedRemote = normalized === "running" || normalized === "submitting" || Boolean(task.remote);
    return {
        ...task,
        status: mayHaveReachedRemote ? "unknown" : "interrupted",
        submitState: mayHaveReachedRemote ? "unknown" : "not_submitted",
        error: mayHaveReachedRemote
            ? "页面刷新或关闭时任务正在提交/运行；无法确认远端是否已接受，禁止自动重试，请先核对远端结果"
            : "任务在本地排队时页面刷新/关闭，已确认未提交远端；可安全重新执行",
        updatedAt: now,
    };
}
