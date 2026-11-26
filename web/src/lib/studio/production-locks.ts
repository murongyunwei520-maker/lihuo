// Stage 3.1 分镜写入互斥与版本冲突判定。
// 只管理当前页面内的生成锁；跨刷新/跨标签页的最终保护仍依赖 storyboardVersion 校验。

export type StoryboardWriteOperation = "episode" | "scene" | "shot";

export type StoryboardWriteLock = {
    token: string;
    projectId: string;
    episodeId: string;
    operation: StoryboardWriteOperation;
    targetId?: string;
    acquiredAt: string;
};

type LockResult = { ok: true; lock: StoryboardWriteLock } | { ok: false; error: string };

const locks = new Map<string, StoryboardWriteLock>();
let sequence = 0;

function lockKey(projectId: string, episodeId: string) {
    return `${projectId}:${episodeId}`;
}

export function acquireStoryboardWriteLock(input: {
    projectId: string;
    episodeId: string;
    operation: StoryboardWriteOperation;
    targetId?: string;
}): LockResult {
    const key = lockKey(input.projectId, input.episodeId);
    const current = locks.get(key);
    if (current) {
        const target = current.targetId ? ` / ${current.targetId}` : "";
        return {
            ok: false,
            error: `本集分镜已有${operationLabel(current.operation)}${target}正在生成；为避免覆盖，请等待当前任务结束`,
        };
    }
    const lock: StoryboardWriteLock = {
        token: `storyboard-lock-${Date.now()}-${(sequence += 1)}`,
        projectId: input.projectId,
        episodeId: input.episodeId,
        operation: input.operation,
        targetId: input.targetId,
        acquiredAt: new Date().toISOString(),
    };
    locks.set(key, lock);
    return { ok: true, lock };
}

export function releaseStoryboardWriteLock(lock: StoryboardWriteLock) {
    const current = locks.get(lockKey(lock.projectId, lock.episodeId));
    if (current?.token === lock.token) locks.delete(lockKey(lock.projectId, lock.episodeId));
}

export function currentStoryboardWriteLock(projectId: string, episodeId: string) {
    return locks.get(lockKey(projectId, episodeId));
}

export function hasStoryboardVersionConflict(baseVersion: number, currentVersion: number) {
    return baseVersion !== currentVersion;
}

export function storyboardVersionConflictMessage(baseVersion: number, currentVersion: number) {
    return `分镜已被其他操作更新（基础 v${baseVersion} → 当前 v${currentVersion}）；本次模型结果不会覆盖当前草稿`;
}

function operationLabel(operation: StoryboardWriteOperation) {
    if (operation === "episode") return "整集分镜";
    if (operation === "scene") return "单场分镜";
    return "单镜重生成";
}
