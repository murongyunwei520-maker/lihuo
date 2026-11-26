import { nanoid } from "nanoid";

import { builtinProviderOf, isDoubaoBuiltinModel } from "@/constants/doubao-builtin";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { listAccounts } from "@/services/api/doubao-bridge";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { createVideoGenerationTask, storeGeneratedVideo, waitForVideoGenerationTask, type VideoGenerationTask } from "@/services/api/video";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { useConfigStore } from "@/stores/use-config-store";
import { findEpisode, findProject, findShot, useStudioStore } from "@/stores/use-studio-store";
import { useStudioTasks } from "@/stores/use-studio-tasks";
import type { StudioProject, StudioShot, StudioTask, StudioTaskInput } from "@/types/studio";
import type { ReferenceImage } from "@/types/image";

import { aiContinuityReview, aiEpisodePlan, aiFillShot, aiOutline, aiScript, aiSplitEpisode } from "./ai";
import { assetVersionSnapshot, buildAssetPrompt, buildShotImagePrompt, buildShotVideoPrompt, referenceKeysForShot, resolveVoice } from "./prompt";
import { buildStudioVideoPlan } from "./video-plan";
import { createAsset, defaultShot, nowIso } from "./factory";

// 短剧工坊的真实业务动作层：页面只调这些函数，任务中心重试也复用同一套动作。
// 所有生成都经过 useStudioTasks 排队；所有结果都写回 useStudioStore。

export type StudioActionResult = { ok: boolean; error?: string; blocked?: boolean; taskId?: string };

function fail(error: unknown, fallback = "执行失败") {
    return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function latestShot(projectId: string, episodeId: string, shotId: string) {
    return findShot(projectId, episodeId, shotId);
}

async function toReferenceImages(keys: string[]): Promise<ReferenceImage[]> {
    const images = await Promise.all(
        keys.map(async (key, index) => {
            const url = await resolveMediaUrl(key, key).catch(() => "");
            if (!url || (!url.startsWith("data:") && !/^https?:/i.test(url) && !url.startsWith("blob:"))) return null;
            return { id: `ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl: url } satisfies ReferenceImage;
        }),
    );
    return images.filter((image): image is ReferenceImage => Boolean(image));
}

function imageConfig(project: StudioProject, shot?: StudioShot) {
    const base = buildGenerationConfig(useConfigStore.getState().config, undefined, "image");
    const model = (shot?.imageModel || project.settings.imageModel || base.model || "").trim();
    const ratio = (shot?.imageRatio || project.settings.imageRatio || "自动").trim();
    const quality = (project.settings.imageQuality || "自动").trim();
    return {
        ...base,
        model,
        ...(model ? { imageModel: model } : {}),
        ...(ratio !== "自动" ? { size: ratio } : {}),
        ...(quality !== "自动" ? { quality } : {}),
    };
}

function videoConfig(project: StudioProject, plan: { model: string; ratio: string; quality: string; seconds: number }, accountId?: string) {
    const base = buildGenerationConfig(useConfigStore.getState().config, undefined, "video");
    return {
        ...base,
        model: plan.model,
        videoModel: plan.model,
        videoSeconds: String(plan.seconds),
        ...(plan.ratio !== "自动" ? { size: plan.ratio } : {}),
        ...(plan.quality !== "自动" ? { vquality: plan.quality } : {}),
        ...(accountId ? { doubaoAccountId: accountId } : {}),
    };
}

function audioConfig(project: StudioProject, shot: StudioShot, voice: string) {
    const base = buildGenerationConfig(useConfigStore.getState().config, undefined, "audio");
    const model = (shot.audioModel || project.settings.audioModel || base.audioModel || base.model || "").trim();
    return {
        ...base,
        model,
        audioModel: model,
        audioVoice: voice,
        audioFormat: "mp3",
        audioSpeed: "1",
    };
}

type Runner = (ctx: {
    taskId: string;
    signal: AbortSignal;
    setProgress: (progress: number) => void;
    log: (message: string) => void;
    update: (patch: Partial<StudioTask>) => void;
}) => Promise<{ outputKey?: string; note?: string } | void>;

function ensureTaskStarted(input: StudioTaskInput, runner: Runner) {
    return useStudioTasks.getState().start(input, runner);
}

/** 资产参考图：第一次生成自动设为正式，之后只进候选版，由用户手动「设为正式」。 */
export async function runAssetImage(projectId: string, assetId: string, options?: { model?: string }): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const asset = project?.assets.find((item) => item.id === assetId);
    if (!project || !asset) return { ok: false, error: "资产不存在" };
    const config = imageConfig(project);
    if (options?.model) {
        config.model = options.model;
        config.imageModel = options.model;
    }
    if (!config.model) return { ok: false, error: "还没有配置图片模型：先在左侧模型设置里选择" };
    const prompt = buildAssetPrompt(project, asset);
    const params: Record<string, string> = { kind: asset.kind };
    if (config.size) params.ratio = String(config.size);
    if (config.quality) params.quality = String(config.quality);
    const { id, promise } = ensureTaskStarted(
        { kind: "image", label: `资产 · ${asset.name}`, projectId, assetId, model: config.model, prompt, params },
        async (ctx) => {
            ctx.setProgress(20);
            const items = await requestGeneration(config, prompt, { signal: ctx.signal });
            const dataUrl = items[0]?.dataUrl;
            if (!dataUrl) throw new Error("模型没有返回图片");
            ctx.update({ note: "已生成，正在写入素材库" });
            const file = await uploadMediaFile(await (await fetch(dataUrl)).blob(), "studio-asset");
            const version = useStudioStore.getState().addAssetVersion(projectId, assetId, {
                storageKey: file.storageKey,
                model: config.model,
                prompt,
                params,
                source: "studio",
                generationId: ctx.taskId,
            });
            const latestAsset = findProject(projectId)?.assets.find((item) => item.id === assetId);
            if (version && !latestAsset?.officialRef) useStudioStore.getState().chooseAssetVersion(projectId, assetId, version);
            ctx.setProgress(100);
            return { outputKey: file.storageKey };
        },
    );
    const outcome = await promise;
    return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id };
}

/** 镜头首帧：首次生成自动落正式版；已有正式版或镜头已确认时，新结果只进候选。 */
export async function runShotImage(projectId: string, episodeId: string, shotId: string): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    const shot = episode?.shots.find((item) => item.id === shotId);
    if (!project || !episode || !shot) return { ok: false, error: "镜头不存在" };
    const config = imageConfig(project, shot);
    if (!config.model) return { ok: false, error: "还没有配置图片模型：先在项目设置里选择" };
    const prompt = buildShotImagePrompt(project, episode, shot);
    const references = await toReferenceImages(referenceKeysForShot(project, shot, episode));
    const params: Record<string, string> = { references: String(references.length) };
    if (config.size) params.ratio = String(config.size);
    if (config.quality) params.quality = String(config.quality);
    const makeOfficial = !shot.imageRef && !shot.approved;
    const { id, promise } = ensureTaskStarted(
        { kind: "image", label: `镜 ${shot.no} · 首帧`, projectId, episodeId, shotId, model: config.model, prompt, params },
        async (ctx) => {
            useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "image", "running");
            ctx.setProgress(20);
            const items = references.length ? await requestEdit(config, prompt, references, { signal: ctx.signal }) : await requestGeneration(config, prompt, { signal: ctx.signal });
            const dataUrl = items[0]?.dataUrl;
            if (!dataUrl) throw new Error("模型没有返回图片");
            const file = await uploadMediaFile(await (await fetch(dataUrl)).blob(), "studio-shot");
            useStudioStore.getState().recordShotVersion(
                projectId,
                episodeId,
                shotId,
                "image",
                {
                    storageKey: file.storageKey,
                    model: config.model,
                    prompt,
                    params,
                    source: "studio",
                    generationId: ctx.taskId,
                    assetVersionIds: assetVersionSnapshot(project, shot, episode),
                },
                { makeOfficial, status: "succeeded" },
            );
            ctx.setProgress(100);
            return { outputKey: file.storageKey, note: makeOfficial ? "已设为正式首帧" : "已有正式首帧，新图作为候选版" };
        },
    );
    const outcome = await promise;
    const latest = latestShot(projectId, episodeId, shotId);
    if (outcome.status === "succeeded") {
        return { ok: true, taskId: id };
    }
    if (outcome.status === "canceled" || outcome.status === "cancelled" || outcome.status === "cancelling") {
        useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "image", latest?.imageRef ? "succeeded" : "idle");
        return { ok: false, error: outcome.status === "cancelling" ? "取消请求已发出，远端尚未确认停止" : "已停止等待", taskId: id };
    }
    useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "image", latest?.imageRef ? "succeeded" : "failed", outcome.error);
    return { ok: false, error: outcome.error, taskId: id };
}

/** 视频：先校验模型能力与账号，再提交；远端凭据尽早落进镜头，刷新后可续查。 */
export async function runShotVideo(projectId: string, episodeId: string, shotId: string): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    const shot = episode?.shots.find((item) => item.id === shotId);
    if (!project || !episode || !shot) return { ok: false, error: "镜头不存在" };
    const plan = buildStudioVideoPlan({ project, episode, shot });
    if (plan.blocked) return { ok: false, error: plan.blocked, blocked: true };

    // 账号继承：镜头覆盖优先，其次项目默认；明确指定的账号不可用时拦下，不静默换号。
    const accountId = shot.videoAccountId || project.settings.videoAccountId || "";
    let accountName = "号池自动";
    if (isDoubaoBuiltinModel(plan.model) && accountId) {
        const provider = builtinProviderOf(plan.model) ?? "doubao";
        const accounts = await listAccounts(provider).catch(() => []);
        const account = accounts.find((item) => item.id === accountId);
        if (!account) return { ok: false, error: "所选豆包账号已不存在：请重新选择账号，本次不会自动切换", blocked: true };
        if (account.state.loggedIn === false) return { ok: false, error: `所选账号「${account.name}」未登录：请先登录或重新选择，本次不会自动切换`, blocked: true };
        accountName = account.name;
    }
    const config = videoConfig(project, plan, accountId);
    const references = await toReferenceImages(plan.references);
    if (!references.length) return { ok: false, error: "首帧读取失败，请重新选择正式首帧", blocked: true };
    const makeOfficial = !shot.videoRef && !shot.approved;
    const { id, promise } = ensureTaskStarted(
        {
            kind: "video",
            label: `镜 ${shot.no} · 视频`,
            projectId,
            episodeId,
            shotId,
            model: plan.model,
            accountId,
            accountName,
            prompt: plan.prompt,
            params: { ...plan.params, ...(accountId ? { accountId } : {}) },
        },
        async (ctx) => {
            useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "video", "running");
            ctx.setProgress(15);
            const created = await createVideoGenerationTask(config, plan.prompt, references, { signal: ctx.signal });
            const remote: StudioShot["videoRemote"] = {
                taskId: created.id,
                provider: created.provider,
                model: created.model,
                prompt: plan.prompt,
                params: { ...plan.params, ...(accountId ? { accountId } : {}) },
                createdAt: nowIso(),
            };
            ctx.update({ remote: { provider: created.provider, taskId: created.id, model: created.model }, note: "已提交远程任务，等待结果" });
            useStudioStore.getState().setVideoRemote(projectId, episodeId, shotId, remote);
            ctx.setProgress(30);
            const result = await waitForVideoGenerationTask(config, created, { signal: ctx.signal });
            ctx.setProgress(80);
            const file = await storeGeneratedVideo(result);
            useStudioStore.getState().recordShotVersion(
                projectId,
                episodeId,
                shotId,
                "video",
                {
                    storageKey: file.storageKey,
                    model: plan.model,
                    accountId,
                    accountName,
                    prompt: plan.prompt,
                    params: plan.params,
                    source: "studio",
                    generationId: ctx.taskId,
                    assetVersionIds: assetVersionSnapshot(project, shot, episode),
                },
                { makeOfficial, status: "succeeded" },
            );
            useStudioStore.getState().setVideoRemote(projectId, episodeId, shotId, undefined);
            ctx.setProgress(100);
            return { outputKey: file.storageKey, note: makeOfficial ? "已设为正式视频" : "已有正式视频，新视频作为候选版" };
        },
    );
    const outcome = await promise;
    const latest = latestShot(projectId, episodeId, shotId);
    if (outcome.status === "succeeded") {
        return { ok: true, taskId: id };
    }
    if (outcome.status === "canceled" || outcome.status === "cancelled" || outcome.status === "cancelling") {
        useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "video", latest?.videoRef ? "succeeded" : "idle", "已停止等待，远程任务可能仍在运行，可续查");
        return { ok: false, error: outcome.status === "cancelling" ? "取消请求已发出，远端尚未确认停止" : "已停止等待，可稍后到任务中心续查", taskId: id };
    }
    useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "video", latest?.videoRef ? "succeeded" : "failed", outcome.error);
    return { ok: false, error: outcome.error, taskId: id };
}

/** 续查已提交的远端视频任务：不重新提交。 */
export async function resumeShotVideo(projectId: string, episodeId: string, shotId: string): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    const shot = episode?.shots.find((item) => item.id === shotId);
    if (!project || !episode || !shot?.videoRemote) return { ok: false, error: "没有可续查的远程视频任务" };
    const remote = shot.videoRemote;
    const quality = remote.params?.quality ?? project.settings.videoQuality;
    const config = videoConfig(project, { model: remote.model, ratio: remote.params?.ratio ?? "自动", quality, seconds: Number(remote.params?.seconds ?? shot.seconds) }, remote.params?.accountId);
    const makeOfficial = !shot.videoRef;
    const { id, promise } = ensureTaskStarted(
        { kind: "video", label: `续查 · 镜 ${shot.no}`, projectId, episodeId, shotId, model: remote.model, accountId: remote.params?.accountId, prompt: remote.prompt, params: remote.params },
        async (ctx) => {
            useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "video", "running");
            const result = await waitForVideoGenerationTask(config, { id: remote.taskId, provider: remote.provider, model: remote.model } as VideoGenerationTask, { signal: ctx.signal });
            const file = await storeGeneratedVideo(result);
            useStudioStore.getState().recordShotVersion(
                projectId,
                episodeId,
                shotId,
                "video",
                {
                    storageKey: file.storageKey,
                    model: remote.model,
                    accountId: remote.params?.accountId,
                    prompt: remote.prompt,
                    params: remote.params,
                    source: "studio",
                    generationId: ctx.taskId,
                    assetVersionIds: assetVersionSnapshot(project, shot, episode),
                },
                { makeOfficial, status: "succeeded" },
            );
            useStudioStore.getState().setVideoRemote(projectId, episodeId, shotId, undefined);
            return { outputKey: file.storageKey, note: "续查完成" };
        },
    );
    const outcome = await promise;
    const latest = latestShot(projectId, episodeId, shotId);
    if (outcome.status === "succeeded") return { ok: true, taskId: id };
    if (outcome.status === "canceled" || outcome.status === "cancelled" || outcome.status === "cancelling") {
        useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "video", latest?.videoRef ? "succeeded" : "idle", "已停止续查，远程任务可能仍在运行");
        return { ok: false, error: outcome.status === "cancelling" ? "取消请求已发出，远端尚未确认停止" : "已停止续查", taskId: id };
    }
    useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, "video", latest?.videoRef ? "succeeded" : "failed", `续查失败：${outcome.error ?? "未知原因"}`);
    return { ok: false, error: outcome.error, taskId: id };
}

/** 对白 / 旁白：音色来自人物资产绑定或项目旁白音色，缺失时拦下。 */
export async function runShotAudio(projectId: string, episodeId: string, shotId: string, media: "audio" | "narration"): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    const shot = episode?.shots.find((item) => item.id === shotId);
    if (!project || !episode || !shot) return { ok: false, error: "镜头不存在" };
    const text = media === "audio" ? shot.line.trim() : shot.narration.trim();
    if (!text) return { ok: false, error: media === "audio" ? "这一镜还没有台词" : "这一镜还没有旁白" };
    let voice = "";
    if (media === "audio") {
        if (!shot.speaker.trim()) return { ok: false, error: "台词缺少说话人：先指定角色" };
        const character = project.assets.find((asset) => asset.kind === "character" && asset.name === shot.speaker);
        if (!character) return { ok: false, error: `说话人「${shot.speaker}」还没有人物资产` };
        if (!character.voiceId) return { ok: false, error: `角色「${character.name}」还没有绑定音色：先到资产中心绑定` };
        voice = character.voiceId;
    } else {
        voice = project.settings.narratorVoice || resolveVoice(project, shot);
        if (!voice) return { ok: false, error: "还没有设置旁白音色：先到声音中心绑定旁白音色" };
        if (media === "narration" && shot.narrationStatus === "running") return { ok: false, error: "旁白正在生成中" };
    }
    const config = audioConfig(project, shot, voice);
    if (!config.model) return { ok: false, error: "还没有配置音频模型" };
    const makeOfficial = media === "audio" ? !shot.audioRef : !shot.narrationRef;
    const { id, promise } = ensureTaskStarted(
        { kind: "audio", label: `镜 ${shot.no} · ${media === "audio" ? "对白" : "旁白"}`, projectId, episodeId, shotId, model: config.model, prompt: text, params: { media, voice } },
        async (ctx) => {
            useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, media, "running");
            ctx.setProgress(20);
            const blob = await requestAudioGeneration(config, text, { signal: ctx.signal });
            const file = await storeGeneratedAudio(blob, "mp3");
            useStudioStore.getState().recordShotVersion(projectId, episodeId, shotId, media, {
                storageKey: file.storageKey,
                model: config.model,
                prompt: text,
                params: { voice, format: "mp3" },
                source: "studio",
                generationId: ctx.taskId,
            }, { makeOfficial, status: "succeeded" });
            ctx.setProgress(100);
            return { outputKey: file.storageKey, note: makeOfficial ? "已设为正式音轨" : "新音频作为候选版本" };
        },
    );
    const outcome = await promise;
    const latest = latestShot(projectId, episodeId, shotId);
    const hasRef = media === "audio" ? latest?.audioRef : latest?.narrationRef;
    if (outcome.status === "succeeded") return { ok: true, taskId: id };
    if (outcome.status === "canceled" || outcome.status === "cancelled" || outcome.status === "cancelling") {
        useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, media, hasRef ? "succeeded" : "idle");
        return { ok: false, error: outcome.status === "cancelling" ? "取消请求已发出，远端尚未确认停止" : "已取消", taskId: id };
    }
    useStudioStore.getState().setShotStatus(projectId, episodeId, shotId, media, hasRef ? "succeeded" : "failed", outcome.error);
    return { ok: false, error: outcome.error, taskId: id };
}

/** 故事大纲：覆盖前先自动快照旧版。 */
export async function runOutline(projectId: string, episodeId: string): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    if (!project || !episode) return { ok: false, error: "项目或集不存在" };
    if (!episode.script.premise.trim() && !project.logline.trim()) return { ok: false, error: "先写一句故事灵感或项目一句话" };
    const { id, promise } = ensureTaskStarted({ kind: "text", label: `大纲 · ${episode.title}`, projectId, episodeId, model: project.settings.textModel, prompt: episode.script.premise || project.logline, params: { operation: "outline" } }, async (ctx) => {
        ctx.setProgress(10);
        const text = await aiOutline({ config: useConfigStore.getState().config, model: project.settings.textModel, project, episode, signal: ctx.signal, onDelta: () => ctx.setProgress(50) });
        if (!text) throw new Error("模型没有返回大纲");
        if (episode.script.outline.trim()) useStudioStore.getState().saveScriptVersion(projectId, episodeId, "outline", "AI 重新生成前的快照");
        useStudioStore.getState().updateScript(projectId, episodeId, { outline: text, source: "generated" });
        return { note: `大纲 ${text.length} 字` };
    });
    const outcome = await promise;
    return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id };
}

/** 剧本正文：覆盖前自动快照旧版。 */
export async function runScript(projectId: string, episodeId: string): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    if (!project || !episode) return { ok: false, error: "项目或集不存在" };
    if (!episode.script.outline.trim()) return { ok: false, error: "先生成或填写大纲，再生成剧本" };
    const { id, promise } = ensureTaskStarted({ kind: "text", label: `剧本 · ${episode.title}`, projectId, episodeId, model: project.settings.textModel, prompt: episode.script.outline, params: { operation: "script" } }, async (ctx) => {
        ctx.setProgress(10);
        const text = await aiScript({ config: useConfigStore.getState().config, model: project.settings.textModel, project, episode, signal: ctx.signal, onDelta: () => ctx.setProgress(50) });
        if (!text) throw new Error("模型没有返回剧本");
        if (episode.script.text.trim()) useStudioStore.getState().saveScriptVersion(projectId, episodeId, "text", "AI 重新生成前的快照");
        useStudioStore.getState().updateScript(projectId, episodeId, { text, source: "generated", confirmedAt: undefined });
        return { note: `剧本 ${text.length} 字` };
    });
    const outcome = await promise;
    return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id };
}

/** 分集规划：更新已有集，不足则补建，不删除用户现有集。 */
export async function runEpisodePlan(projectId: string, count: number): Promise<StudioActionResult> {
    const project = findProject(projectId);
    if (!project) return { ok: false, error: "项目不存在" };
    const { id, promise } = ensureTaskStarted({ kind: "text", label: `分集规划 · ${count} 集`, projectId, model: project.settings.textModel, prompt: project.bible.synopsis || project.logline, params: { operation: "plan", count: String(count) } }, async (ctx) => {
        ctx.setProgress(10);
        const plan = await aiEpisodePlan({ config: useConfigStore.getState().config, model: project.settings.textModel, project, count, targetSeconds: project.settings.targetSeconds, signal: ctx.signal });
        if (!plan.length) throw new Error("模型没有返回有效的分集规划");
        plan.forEach((item, index) => {
            const current = findProject(projectId);
            const existing = current?.episodes[index];
            const patch = { title: item.title, coreEvent: item.coreEvent, mainConflict: item.mainConflict, continuity: item.continuity, hook: item.hook, targetSeconds: item.targetSeconds };
            if (existing) {
                useStudioStore.getState().updateEpisode(projectId, existing.id, patch);
            } else {
                const episodeId = useStudioStore.getState().createEpisode(projectId, item.title, item.targetSeconds);
                if (episodeId) useStudioStore.getState().updateEpisode(projectId, episodeId, patch);
            }
        });
        ctx.setProgress(100);
        return { note: `已写入 ${plan.length} 集` };
    });
    const outcome = await promise;
    return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id };
}

/** 拆场拆镜：替换已有镜头必须显式确认（replace=true）。缺失的人物/场景/道具会自动建成草稿资产。 */
export async function runSplitEpisode(projectId: string, episodeId: string, replace = false): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    if (!project || !episode) return { ok: false, error: "项目或集不存在" };
    if (!episode.script.text.trim() && !episode.script.outline.trim()) return { ok: false, error: "先填写或生成剧本" };
    if (episode.shots.length && !replace) return { ok: false, error: "这一集已有镜头：需要确认后才会替换", blocked: true };
    const { id, promise } = ensureTaskStarted({ kind: "analysis", label: `拆场拆镜 · ${episode.title}`, projectId, episodeId, model: project.settings.textModel, prompt: episode.script.text || episode.script.outline, params: { operation: "split" } }, async (ctx) => {
        ctx.setProgress(10);
        const result = await aiSplitEpisode({ config: useConfigStore.getState().config, model: project.settings.textModel, project, episode, signal: ctx.signal, onDelta: () => ctx.setProgress(40) });
        if (!result.shots.length) throw new Error("模型没有返回可用的镜头");
        let latest = findProject(projectId)!;

        const ensureAsset = (kind: "character" | "scene" | "prop" | "costume", name: string, description = "") => {
            const trimmed = name.trim();
            if (!trimmed) return "";
            latest = findProject(projectId)!;
            const existing = latest.assets.find((asset) => asset.kind === kind && asset.name === trimmed);
            if (existing) return existing.id;
            const asset = createAsset(kind, trimmed);
            asset.description = description;
            if (kind === "scene") {
                asset.layout = description;
                asset.environment = description;
            }
            useStudioStore.setState((state) => ({
                projects: state.projects.map((item) => (item.id === projectId ? { ...item, assets: [...item.assets, asset], updatedAt: nowIso() } : item)),
            }));
            return asset.id;
        };

        const characters: string[] = [];
        for (const name of result.characters) {
            const id = ensureAsset("character", name, "AI 拆镜提取的人物，待补充设定与参考图");
            if (!id) continue;
            latest = findProject(projectId)!;
            const asset = latest.assets.find((item) => item.id === id);
            if (asset && !characters.includes(asset.name)) characters.push(asset.name);
        }
        const characterIds = new Map<string, string>();
        latest.assets.filter((asset) => asset.kind === "character").forEach((asset) => characterIds.set(asset.name, asset.id));

        const rawScenes = result.scenes.length
            ? result.scenes
            : [...new Set(result.shots.map((shot) => String(shot.scene ?? "").trim()).filter(Boolean))].map((name) => ({ name, location: "", description: "", timeOfDay: "", weather: "" }));
        const scenes = rawScenes
            .filter((scene) => scene.name.trim())
            .map((scene, index) => {
                latest = findProject(projectId)!;
                const existing = episode.scenes.find((item) => item.name === scene.name);
                const assetId = ensureAsset("scene", scene.name, scene.description);
                return {
                    id: existing?.id ?? `scene-${nanoid(8)}`,
                    no: String(index + 1).padStart(2, "0"),
                    name: scene.name.trim(),
                    location: scene.location,
                    description: scene.description,
                    timeOfDay: scene.timeOfDay,
                    weather: scene.weather,
                    assetId,
                };
            });
        if (!scenes.length) throw new Error("没有解析出场景");
        const sceneByName = new Map(scenes.map((scene) => [scene.name, scene]));

        const shots: StudioShot[] = result.shots.map((record, index) => {
            latest = findProject(projectId)!;
            const sceneName = String(record.scene ?? "").trim() || scenes[0].name;
            const scene = sceneByName.get(sceneName) ?? scenes[0];
            const shot = defaultShot(episodeId, scene.id, String(index + 1).padStart(2, "0"));
            const charNames = Array.isArray(record.characters) ? record.characters.map(String) : [];
            const assetNames = Array.isArray(record.assetNames) ? record.assetNames.map(String) : [];
            const assetIds = [
                ...charNames.map((name) => characterIds.get(name)).filter((id): id is string => Boolean(id)),
                ...assetNames.map((name) => ensureAsset("prop", name, "AI 拆镜提取的服装/道具，待确认类别")).filter(Boolean),
            ];
            const seconds = Number(record.seconds);
            const speaker = String(record.speaker ?? "").trim();
            const isNarration = speaker === "旁白";
            return {
                ...shot,
                sceneName: scene.name,
                sceneId: scene.id,
                description: String(record.description ?? "").trim(),
                characterNames: charNames,
                assetIds: [...new Set(assetIds)],
                action: String(record.action ?? "").trim(),
                expression: String(record.expression ?? "").trim(),
                position: String(record.position ?? "").trim(),
                orientation: String(record.orientation ?? "").trim(),
                environment: String(record.environment ?? "").trim() || scene.location,
                size: String(record.size ?? "").trim() || shot.size,
                camera: String(record.camera ?? "").trim() || shot.camera,
                lens: String(record.lens ?? "").trim() || "自动",
                movement: String(record.movement ?? "").trim() || shot.movement,
                composition: String(record.composition ?? "").trim() || shot.composition,
                lighting: String(record.lighting ?? "").trim() || shot.lighting,
                effects: String(record.effects ?? "").trim(),
                line: isNarration ? "" : String(record.line ?? "").trim(),
                speaker: isNarration ? "" : speaker,
                narration: isNarration ? String(record.line ?? record.narration ?? "").trim() : String(record.narration ?? "").trim(),
                ambience: String(record.ambience ?? "").trim(),
                sfx: String(record.sfx ?? "").trim(),
                seconds: Number.isFinite(seconds) ? Math.min(15, Math.max(4, Math.round(seconds))) : shot.seconds,
                imageModel: project.settings.imageModel || undefined,
                videoModel: project.settings.videoModel || undefined,
                audioModel: project.settings.audioModel || undefined,
            };
        });

        useStudioStore.getState().setScenes(projectId, episodeId, scenes);
        useStudioStore.getState().replaceShots(projectId, episodeId, shots);
        const currentBible = findProject(projectId)!.bible;
        useStudioStore.getState().updateBible(projectId, {
            characters: [...new Set([...currentBible.characters.map((item) => item.name), ...characters])].map((name) => currentBible.characters.find((item) => item.name === name) ?? { name, role: "", description: "AI 拆镜提取，待补充" }),
        });
        ctx.setProgress(100);
        return { note: `${scenes.length} 场 / ${shots.length} 镜` };
    });
    const outcome = await promise;
    return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id };
}

export async function runShotFill(projectId: string, episodeId: string, shotId: string): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    const shot = episode?.shots.find((item) => item.id === shotId);
    if (!project || !episode || !shot) return { ok: false, error: "镜头不存在" };
    if (shot.locked) return { ok: false, error: "镜头已锁定：先解锁再补全" };
    const { id, promise } = ensureTaskStarted({ kind: "text", label: `补全 · 镜 ${shot.no}`, projectId, episodeId, shotId, model: project.settings.textModel, prompt: shot.description || shot.action, params: { operation: "shot" } }, async (ctx) => {
        const result = await aiFillShot({ config: useConfigStore.getState().config, model: project.settings.textModel, project, episode, shot, signal: ctx.signal });
        useStudioStore.getState().updateShot(projectId, episodeId, shotId, result);
        return { note: "镜头执行信息已补全" };
    });
    const outcome = await promise;
    return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id };
}

export async function runContinuityReview(projectId: string, episodeId: string, shotIds: string[]): Promise<StudioActionResult> {
    const project = findProject(projectId);
    const episode = findEpisode(projectId, episodeId);
    if (!project || !episode) return { ok: false, error: "项目或集不存在" };
    const shots = episode.shots.filter((shot) => shotIds.includes(shot.id));
    if (!shots.length) return { ok: false, error: "没有选中镜头" };
    const { id, promise } = ensureTaskStarted({ kind: "analysis", label: `连续性检查 · ${shots.length} 镜`, projectId, episodeId, model: project.settings.textModel, prompt: shots.map((shot) => `镜 ${shot.no}`).join("、"), params: { operation: "continuity", shotIds: shotIds.join(",") } }, async (ctx) => {
        const issues = await aiContinuityReview({ config: useConfigStore.getState().config, model: project.settings.textModel, project, episode, shots, signal: ctx.signal });
        useStudioStore.getState().updateEpisode(projectId, episodeId, { continuityReport: { createdAt: nowIso(), issues } });
        return { note: issues.length ? `${issues.length} 个问题` : "没有发现问题" };
    });
    const outcome = await promise;
    return { ok: outcome.status === "succeeded", error: outcome.error, taskId: id };
}

export async function uploadAssetReference(projectId: string, assetId: string, file: File): Promise<StudioActionResult> {
    try {
        const uploaded = await uploadMediaFile(file, "studio-asset");
        const project = findProject(projectId);
        const asset = project?.assets.find((item) => item.id === assetId);
        if (!project || !asset) return { ok: false, error: "资产不存在" };
        const version = useStudioStore.getState().addAssetVersion(projectId, assetId, { storageKey: uploaded.storageKey, source: "upload", params: { fileName: file.name } });
        if (version && !asset.officialRef) useStudioStore.getState().chooseAssetVersion(projectId, assetId, version);
        return { ok: true };
    } catch (error) {
        return fail(error, "上传失败");
    }
}

export async function uploadShotImage(projectId: string, episodeId: string, shotId: string, file: File): Promise<StudioActionResult> {
    try {
        const uploaded = await uploadMediaFile(file, "studio-shot");
        const version = useStudioStore.getState().recordShotVersion(projectId, episodeId, shotId, "image", { storageKey: uploaded.storageKey, source: "upload", params: { fileName: file.name } });
        return version ? { ok: true } : { ok: false, error: "镜头不存在" };
    } catch (error) {
        return fail(error, "上传失败");
    }
}

export async function uploadShotVideo(projectId: string, episodeId: string, shotId: string, file: File): Promise<StudioActionResult> {
    try {
        const uploaded = await uploadMediaFile(file, "studio-video");
        const version = useStudioStore.getState().recordShotVersion(projectId, episodeId, shotId, "video", { storageKey: uploaded.storageKey, source: "upload", params: { fileName: file.name } });
        if (version) useStudioStore.getState().setVideoRemote(projectId, episodeId, shotId, undefined);
        return version ? { ok: true } : { ok: false, error: "镜头不存在" };
    } catch (error) {
        return fail(error, "上传失败");
    }
}

export async function uploadShotSfx(projectId: string, episodeId: string, shotId: string, file: File): Promise<StudioActionResult> {
    try {
        const uploaded = await uploadMediaFile(file, "studio-sfx");
        const version = useStudioStore.getState().recordShotVersion(projectId, episodeId, shotId, "sfx", { storageKey: uploaded.storageKey, source: "upload", params: { fileName: file.name, media: "sfx" } });
        return version ? { ok: true } : { ok: false, error: "镜头不存在" };
    } catch (error) {
        return fail(error, "上传失败");
    }
}

/** 尾帧：当前模型只有在 Schema 声明尾帧能力时才提交；这里只负责保存候选尾帧。 */
export async function uploadVideoLastFrame(projectId: string, episodeId: string, shotId: string, file: File): Promise<StudioActionResult> {
    try {
        const uploaded = await uploadMediaFile(file, "studio-last-frame");
        useStudioStore.getState().updateShot(projectId, episodeId, shotId, { videoLastFrameRef: uploaded.storageKey });
        return { ok: true };
    } catch (error) {
        return fail(error, "上传失败");
    }
}

/** 任务中心「重新执行」按任务类型回到同一个动作；视频有 remote 时优先续查。 */
export async function rerunStudioTask(task: StudioTask): Promise<StudioActionResult> {
    const projectId = task.projectId ?? "";
    const episodeId = task.episodeId ?? "";
    const shotId = task.shotId ?? "";
    if (!projectId) return { ok: false, error: "任务没有关联项目" };
    if (!findProject(projectId)) return { ok: false, error: "项目已被删除" };
    if (task.kind === "image") {
        if (task.assetId) return runAssetImage(projectId, task.assetId, { model: task.model });
        if (shotId && episodeId) return runShotImage(projectId, episodeId, shotId);
    }
    if (task.kind === "video") {
        if (task.remote || findShot(projectId, episodeId, shotId)?.videoRemote) return resumeShotVideo(projectId, episodeId, shotId);
        if (shotId && episodeId) return runShotVideo(projectId, episodeId, shotId);
    }
    if (task.kind === "audio") {
        const media = task.params?.media === "narration" ? "narration" : "audio";
        if (shotId && episodeId) return runShotAudio(projectId, episodeId, shotId, media);
    }
    if (task.kind === "text" || task.kind === "analysis") {
        const operation = task.params?.operation;
        if (operation === "outline") return runOutline(projectId, episodeId);
        if (operation === "script") return runScript(projectId, episodeId);
        if (operation === "plan") return runEpisodePlan(projectId, Number(task.params?.count ?? 10));
        if (operation === "split") return runSplitEpisode(projectId, episodeId, true);
        if (operation === "shot") return runShotFill(projectId, episodeId, shotId);
        if (operation === "continuity") {
            const ids = (task.params?.shotIds ?? "").split(",").filter(Boolean);
            return runContinuityReview(projectId, episodeId, ids);
        }
    }
    return { ok: false, error: "这个任务没有可重复执行的动作" };
}
