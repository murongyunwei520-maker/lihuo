// Stage 4D.2 确定性测试：任务恢复状态机 + 跨标签页项目元数据守卫。
// 真实 IndexedDB 事务、真实双标签页与真实 UI 失败提示不在此文件中冒充。

import assert from "node:assert/strict";
import type { StudioStatePlan, StudioStateStore } from "../src/lib/studio-store-persistence";

const { recoverInterruptedTask } = await import("../src/lib/studio/task-recovery");
const {
    assertNoStaleProjectMetadata,
    observeStudioStoreRaw,
    commitStoryboardSnapshotDiscard,
} = await import("../src/lib/studio-store-persistence");

type TaskLike = {
    id: string;
    kind: "text";
    label: string;
    status: string;
    retryCount: number;
    logs: string[];
    createdAt: string;
    updatedAt: string;
    remote?: { provider: "doubao"; taskId: string; model: string };
};

function task(overrides: Partial<TaskLike>): TaskLike {
    return {
        id: "task-1",
        kind: "text",
        label: "测试任务",
        status: "queued",
        retryCount: 0,
        logs: [],
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
        ...overrides,
    };
}

const fixedNow = "2026-11-25T12:00:00.000Z";

const queued = recoverInterruptedTask(task({ status: "queued" }) as never, fixedNow) as TaskLike;
assert.equal(queued.status, "interrupted");
assert.equal((queued as TaskLike & { submitState?: string }).submitState, "not_submitted");
assert.match(String((queued as TaskLike & { error?: string }).error), /可安全重新执行/);

const running = recoverInterruptedTask(task({ status: "running" }) as never, fixedNow) as TaskLike;
assert.equal(running.status, "unknown");
assert.equal((running as TaskLike & { submitState?: string }).submitState, "unknown");
assert.match(String((running as TaskLike & { error?: string }).error), /禁止自动重试/);

const submitting = recoverInterruptedTask(task({ status: "submitting" }) as never, fixedNow) as TaskLike;
assert.equal(submitting.status, "unknown");

const queuedWithRemote = recoverInterruptedTask(task({ status: "queued", remote: { provider: "doubao", taskId: "remote-1", model: "m" } }) as never, fixedNow) as TaskLike;
assert.equal(queuedWithRemote.status, "unknown");
assert.equal((queuedWithRemote as TaskLike & { submitState?: string }).submitState, "unknown");

const pending = recoverInterruptedTask(task({ status: "pending" }) as never, fixedNow) as TaskLike;
assert.equal(pending.status, "interrupted");

const retrying = recoverInterruptedTask(task({ status: "retrying" }) as never, fixedNow) as TaskLike;
assert.equal(retrying.status, "interrupted");

const done = recoverInterruptedTask(task({ status: "succeeded" }) as never, fixedNow) as TaskLike;
assert.equal(done.status, "succeeded");
assert.equal(done.updatedAt, "2026-11-25T00:00:00.000Z");

// 项目元数据守卫：本标签页观察到的 updatedAt 必须仍是 IDB 当前值，否则拒绝整仓覆盖。
function raw(projects: Array<{ id: string; updatedAt: string; title?: string }>) {
    return JSON.stringify({ state: { projects, migrationDone: true }, version: 0 });
}

const observed = raw([{ id: "proj-a", updatedAt: "v1", title: "A" }]);
observeStudioStoreRaw(observed);
assert.throws(
    () => assertNoStaleProjectMetadata(raw([{ id: "proj-a", updatedAt: "v2", title: "B" }]), observed),
    /项目已被其他标签页更新：proj-a/,
);
assert.throws(
    () => assertNoStaleProjectMetadata(raw([{ id: "proj-a", updatedAt: "v1", title: "A" }, { id: "proj-new", updatedAt: "v1" }]), observed),
    /其他标签页新建了项目/,
);
assert.throws(
    () => assertNoStaleProjectMetadata(raw([]), observed),
    /项目已被其他标签页删除：proj-a/,
);

// 快照丢弃事务：成功、重复、陈旧时间戳与双删竞态。这里是事务语义测试，
// 不能替代真实浏览器 IndexedDB 测试。
type SnapshotVersion = { snapshotId: string; snapshotType: "formal" | "backup" | "conflict" };

function snapshotRaw(input: {
    projectUpdatedAt?: string;
    episodeUpdatedAt?: string;
    versions?: SnapshotVersion[];
    storyboardVersion?: number;
}) {
    return JSON.stringify({
        state: {
            projects: [{
                id: "proj-snap",
                updatedAt: input.projectUpdatedAt ?? "p1",
                episodes: [{
                    id: "ep-snap",
                    updatedAt: input.episodeUpdatedAt ?? "e1",
                    production: {
                        storyboard: { storyboardVersion: input.storyboardVersion ?? 15 },
                        storyboardVersions: input.versions ?? [
                            { snapshotId: "sbs-a", snapshotType: "backup" },
                            { snapshotId: "sbs-f", snapshotType: "formal" },
                            { snapshotId: "sbs-b", snapshotType: "conflict" },
                        ],
                    },
                }],
            }],
        },
        version: 0,
    });
}

function memoryStudioStore(holder: { raw: string | null }): StudioStateStore {
    return {
        async readRaw() {
            return holder.raw;
        },
        async transact<T>(plan: (currentRaw: string | null) => StudioStatePlan<T>): Promise<T> {
            try {
                const statePlan = plan(holder.raw);
                if (statePlan.nextRaw !== undefined) {
                    holder.raw = statePlan.nextRaw;
                    statePlan.verify?.(holder.raw, statePlan.nextRaw);
                }
                return statePlan.result;
            } catch (error) {
                return { ok: false, error: error instanceof Error ? error.message : "快照删除失败" } as T;
            }
        },
    };
}

const snapshotStore = { raw: snapshotRaw({}) };
const snapshotSuccess = await commitStoryboardSnapshotDiscard({
    projectId: "proj-snap",
    episodeId: "ep-snap",
    snapshotId: "sbs-a",
    expectedProjectUpdatedAt: "p1",
    expectedEpisodeUpdatedAt: "e1",
    store: memoryStudioStore(snapshotStore),
});
assert.equal(snapshotSuccess.ok, true);
assert.ok(!snapshotSuccess.projects?.[0].episodes[0].production?.storyboardVersions.some((item) => item.snapshotId === "sbs-a"));
assert.equal(snapshotSuccess.projects?.[0].episodes[0].production?.storyboard?.storyboardVersion, 15);

const snapshotRepeat = await commitStoryboardSnapshotDiscard({
    projectId: "proj-snap",
    episodeId: "ep-snap",
    snapshotId: "sbs-a",
    expectedProjectUpdatedAt: "p1",
    expectedEpisodeUpdatedAt: "e1",
    store: memoryStudioStore(snapshotStore),
});
assert.equal(snapshotRepeat.ok, false);
assert.match(String(snapshotRepeat.error), /项目已被其他操作更新/);

const staleProjectStore = { raw: snapshotRaw({ projectUpdatedAt: "p2" }) };
const staleProject = await commitStoryboardSnapshotDiscard({
    projectId: "proj-snap",
    episodeId: "ep-snap",
    snapshotId: "sbs-a",
    expectedProjectUpdatedAt: "p1",
    expectedEpisodeUpdatedAt: "e1",
    store: memoryStudioStore(staleProjectStore),
});
assert.equal(staleProject.ok, false);
assert.match(String(staleProject.error), /项目已被其他操作更新/);

const staleEpisodeStore = { raw: snapshotRaw({ episodeUpdatedAt: "e2" }) };
const staleEpisode = await commitStoryboardSnapshotDiscard({
    projectId: "proj-snap",
    episodeId: "ep-snap",
    snapshotId: "sbs-a",
    expectedProjectUpdatedAt: "p1",
    expectedEpisodeUpdatedAt: "e1",
    store: memoryStudioStore(staleEpisodeStore),
});
assert.equal(staleEpisode.ok, false);
assert.match(String(staleEpisode.error), /分集已被其他操作更新/);

const formalStore = { raw: snapshotRaw({}) };
const formalReject = await commitStoryboardSnapshotDiscard({
    projectId: "proj-snap",
    episodeId: "ep-snap",
    snapshotId: "sbs-f",
    expectedProjectUpdatedAt: "p1",
    expectedEpisodeUpdatedAt: "e1",
    store: memoryStudioStore(formalStore),
});
assert.equal(formalReject.ok, false);
assert.match(String(formalReject.error), /正式快照不能丢弃/);

const concurrentStore = { raw: snapshotRaw({}) };
const [concurrentA, concurrentB] = await Promise.all([
    commitStoryboardSnapshotDiscard({
        projectId: "proj-snap",
        episodeId: "ep-snap",
        snapshotId: "sbs-a",
        expectedProjectUpdatedAt: "p1",
        expectedEpisodeUpdatedAt: "e1",
        store: memoryStudioStore(concurrentStore),
    }),
    commitStoryboardSnapshotDiscard({
        projectId: "proj-snap",
        episodeId: "ep-snap",
        snapshotId: "sbs-b",
        expectedProjectUpdatedAt: "p1",
        expectedEpisodeUpdatedAt: "e1",
        store: memoryStudioStore(concurrentStore),
    }),
]);
assert.equal([concurrentA.ok, concurrentB.ok].filter(Boolean).length, 1, "同一时间戳并发双删只能有一个成功");

const sameSnapshotStore = { raw: snapshotRaw({}) };
const [sameA, sameB] = await Promise.all([
    commitStoryboardSnapshotDiscard({
        projectId: "proj-snap",
        episodeId: "ep-snap",
        snapshotId: "sbs-a",
        expectedProjectUpdatedAt: "p1",
        expectedEpisodeUpdatedAt: "e1",
        store: memoryStudioStore(sameSnapshotStore),
    }),
    commitStoryboardSnapshotDiscard({
        projectId: "proj-snap",
        episodeId: "ep-snap",
        snapshotId: "sbs-a",
        expectedProjectUpdatedAt: "p1",
        expectedEpisodeUpdatedAt: "e1",
        store: memoryStudioStore(sameSnapshotStore),
    }),
]);
assert.equal([sameA.ok, sameB.ok].filter(Boolean).length, 1, "同一快照重复删除只能成功一次");

console.log(JSON.stringify({ ok: true, tasks: 7, metadataGuards: 3, snapshotDiscards: 7 }));
