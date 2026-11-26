// Stage 4D：审核元数据（审核结论 / AI 审核记录 / 提案决策）必须走独立 IndexedDB 事务，
// 不能只做 Zustand set 后回读内存，也不能用 localforage 的异步 persist 冒充已经保存。

import {
    assertNoStaleFormalWrite,
    createIndexedDbStudioStateStore,
    parseStudioEnvelope,
    serializeStudioEnvelope,
    storyboardNarrativeHash,
    StudioStateVerificationError,
    type StudioStatePlan,
    type StudioStateStore,
} from "@/lib/studio-store-persistence";
import { withStudioWriteLock } from "./storyboard-write-protocol";
import { stampStoryboardReviewContext } from "./review-engine";
import type { StudioEpisode, StudioProject } from "@/types/studio";
import type { StudioEpisodeProduction, StudioStoryboardDocument } from "@/types/studio-production";

export type ReviewStateApplyContext = {
    project: StudioProject;
    episode: StudioEpisode;
    production: StudioEpisodeProduction;
    document: StudioStoryboardDocument;
};

export type ReviewStateApplyPlan =
    | { ok: false; error: string; conflict?: boolean }
    | {
          ok: true;
          production: StudioEpisodeProduction;
          result: unknown;
          /** 事务内 put 后、提交前的附加校验；抛错会回滚。 */
          verifySaved?: (production: StudioEpisodeProduction, projects: StudioProject[]) => void;
      };

export type ReviewStateCommitInput = {
    projectId: string;
    episodeId: string;
    expectedStoryboardVersion: number;
    apply: (context: ReviewStateApplyContext) => ReviewStateApplyPlan;
    store?: StudioStateStore;
};

export type ReviewStateCommitResult = {
    ok: boolean;
    error?: string;
    conflict?: boolean;
    duplicate?: boolean;
    production?: StudioEpisodeProduction;
    projects?: StudioProject[];
    result?: unknown;
};

function nowIso() {
    return new Date().toISOString();
}

function readProjects(value: ReturnType<typeof parseStudioEnvelope>): StudioProject[] | undefined {
    const projects = value?.state?.projects;
    return Array.isArray(projects) ? projects as StudioProject[] : undefined;
}

function verifyEpisodeScope(previous: StudioProject[], next: StudioProject[], projectId: string, episodeId: string, expectedVersion: number) {
    if (previous.length !== next.length) throw new StudioStateVerificationError("审核写入误改项目数量");
    for (const previousProject of previous) {
        const nextProject = next.find((project) => project.id === previousProject.id);
        if (!nextProject) throw new StudioStateVerificationError(`审核写入误删项目：${previousProject.id}`);
        if (nextProject.episodes.length !== previousProject.episodes.length) throw new StudioStateVerificationError(`审核写入误改分集数量：${previousProject.id}`);
        for (const previousEpisode of previousProject.episodes) {
            const nextEpisode = nextProject.episodes.find((episode) => episode.id === previousEpisode.id);
            if (!nextEpisode) throw new StudioStateVerificationError(`审核写入误删分集：${previousProject.id}/${previousEpisode.id}`);
            const before = previousEpisode.production?.storyboard?.storyboardVersion ?? 0;
            const after = nextEpisode.production?.storyboard?.storyboardVersion ?? 0;
            const target = previousProject.id === projectId && previousEpisode.id === episodeId;
            if (target && after !== expectedVersion) throw new StudioStateVerificationError(`审核写入改动了正式版本：v${before} → v${after}`);
            if (!target && after !== before) throw new StudioStateVerificationError(`审核写入误改其他分集：${previousProject.id}/${previousEpisode.id} v${before} → v${after}`);
        }
    }
}

/**
 * 在单个 IndexedDB 事务内读取权威项目 → 校验版本 → 应用审核变更 → 回读校验 → 提交。
 * 成功返回的 projects 是持久化后的权威快照；调用方必须用它更新 Zustand，而不是只读内存。
 */
export async function commitReviewState(input: ReviewStateCommitInput): Promise<ReviewStateCommitResult> {
    const store = input.store ?? createIndexedDbStudioStateStore();
    return withStudioWriteLock(async () => {
        try {
            const result = await store.transact<ReviewStateCommitResult>((currentRaw): StudioStatePlan<ReviewStateCommitResult> => {
                const baseEnvelope = parseStudioEnvelope(currentRaw);
                if (currentRaw && !baseEnvelope) return { result: { ok: false, error: "本地工作区数据无法解析，已拒绝审核写入" } };
                const projects = readProjects(baseEnvelope);
                if (!projects) return { result: { ok: false, error: "本地工作区没有可用的项目数据，已拒绝审核写入" } };
                const project = projects.find((item) => item.id === input.projectId);
                const episode = project?.episodes.find((item) => item.id === input.episodeId);
                if (!project || !episode) return { result: { ok: false, error: "项目或分集不存在，未写入审核记录" } };
                const production = episode.production;
                const document = production?.storyboard;
                if (!production || !document) return { result: { ok: false, error: "当前分集还没有正式分镜，不能写入审核记录" } };
                if (document.storyboardVersion !== input.expectedStoryboardVersion) {
                    return {
                        result: {
                            ok: false,
                            conflict: true,
                            error: `正式分镜已变为 v${document.storyboardVersion}，审核操作基于 v${input.expectedStoryboardVersion}；请刷新后重试`,
                        },
                    };
                }
                const plan = input.apply({ project, episode, production, document });
                if (!plan.ok) return { result: { ok: false, error: plan.error, conflict: plan.conflict } };
                if (!plan.production.storyboard || plan.production.storyboard.storyboardVersion !== document.storyboardVersion) {
                    throw new StudioStateVerificationError("审核写入不得改变正式分镜版本");
                }
                if (storyboardNarrativeHash(plan.production.storyboard as unknown as Record<string, unknown>) !== storyboardNarrativeHash(document as unknown as Record<string, unknown>)) {
                    throw new StudioStateVerificationError("审核写入不得改变正式分镜叙事内容");
                }
                const reviewedProduction = plan.production.storyboardReview
                    ? { ...plan.production, storyboardReview: stampStoryboardReviewContext(plan.production.storyboardReview, { projectId: project.id, episodeId: episode.id, episodeNumber: episode.no }) }
                    : plan.production;
                const nextEpisode: StudioEpisode = { ...episode, production: reviewedProduction, updatedAt: nowIso() };
                const nextProject: StudioProject = {
                    ...project,
                    episodes: project.episodes.map((item) => item.id === input.episodeId ? nextEpisode : item),
                    updatedAt: nowIso(),
                };
                const nextProjects = projects.map((item) => item.id === input.projectId ? nextProject : item);
                const nextEnvelope = {
                    ...(baseEnvelope ?? {}),
                    state: { ...(baseEnvelope?.state ?? {}), projects: nextProjects },
                    version: baseEnvelope?.version ?? 0,
                };
                const nextRaw = serializeStudioEnvelope(nextEnvelope);
                return {
                    nextRaw,
                    result: {
                        ok: true,
                        production: reviewedProduction,
                        projects: nextProjects,
                        result: plan.result,
                    },
                    verify: (readBack) => {
                        const saved = parseStudioEnvelope(readBack);
                        const savedProjects = readProjects(saved);
                        if (!savedProjects) throw new StudioStateVerificationError("审核写入回读失败：项目数据无法解析");
                        const savedEpisode = savedProjects.find((item) => item.id === input.projectId)?.episodes.find((item) => item.id === input.episodeId);
                        if (!savedEpisode?.production?.storyboard) throw new StudioStateVerificationError("审核写入回读失败：分集或正式分镜丢失");
                        if (savedEpisode.production.storyboard.storyboardVersion !== document.storyboardVersion) {
                            throw new StudioStateVerificationError("审核写入回读失败：正式版本改变");
                        }
                        verifyEpisodeScope(projects, savedProjects, input.projectId, input.episodeId, document.storyboardVersion);
                        assertNoStaleFormalWrite(currentRaw, readBack ?? "");
                        plan.verifySaved?.(savedEpisode.production, savedProjects);
                    },
                };
            });
            return result;
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "审核写入失败" };
        }
    });
}
