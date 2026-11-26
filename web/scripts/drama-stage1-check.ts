import assert from "node:assert/strict";

import type { AiConfig } from "@/stores/use-config-store";
import type { StudioProject, StudioShot } from "@/types/studio";

// 阶段 1 纯函数验收：五步默认值、旧项目补字段、项目级模型隔离、旧 URL 映射。
// 不触碰真实浏览器存储，不加载真实模型，不消耗任何账号额度。
// use-config-store 在模块初始化时读取 localStorage，所以先放内存桩，再动态导入业务模块。

const memoryStore = new Map<string, string>();
const storage = {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStore.set(key, value); },
    removeItem: (key: string) => { memoryStore.delete(key); },
    clear: () => { memoryStore.clear(); },
    key: () => null,
    length: 0,
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "window", {
    value: {
        localStorage: storage,
        location: { hash: "", search: "" },
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    configurable: true,
});

const { createAsset, createStudioProject, defaultShot, normalizeStudioProject } = await import("@/lib/studio/factory");
const {
    buildDefaultDramaModelProfiles,
    dramaModelKey,
    effectiveProjectConfig,
    projectModelOption,
    updateProjectSettingsModels,
    withProjectModelSelection,
} = await import("@/lib/studio/model-profile");
const { defaultStepForProject, mapLegacyWorkspace } = await import("@/lib/studio/navigation");
const { defaultConfig } = await import("@/stores/use-config-store");

const config: AiConfig = {
    ...defaultConfig,
    channelMode: "local",
    channels: [
        {
            id: "ch1",
            name: "测试渠道",
            baseUrl: "http://127.0.0.1:9999/v1",
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "text-a", capability: "text" },
                { name: "text-b", capability: "text" },
                { name: "image-a", capability: "image" },
                { name: "video-a", capability: "video" },
            ],
        },
    ],
    textModel: "ch1::text-a",
    imageModel: "ch1::image-a",
    videoModel: "ch1::video-a",
};

const profiles = buildDefaultDramaModelProfiles(config);
assert.deepEqual(profiles.selected.text, { channelId: "ch1", modelId: "text-a" });
assert.deepEqual(profiles.selected.image, { channelId: "ch1", modelId: "image-a" });
assert.deepEqual(profiles.selected.video, { channelId: "ch1", modelId: "video-a" });

const fresh = createStudioProject({ title: "阶段 1 测试剧", modelProfiles: profiles });
assert.equal(fresh.episodes.length, 0, "阶段 1 新项目由分析决定分集，不再预填");
assert.equal(fresh.currentStep, "analysis");
assert.equal(fresh.projectStatus, "draft");
assert.equal(fresh.workflowMode, "all");
assert.equal(fresh.automationMode, "auto");
assert.equal(fresh.adaptationMode, "adapt");
assert.deepEqual(fresh.stepStates, { analysis: "idle", assets: "idle", script: "idle", review: "idle", video: "idle" });
assert.equal(projectModelOption(fresh, "text", config), "ch1::text-a");

// 参数按 text + channel + model 隔离；切到 text-b 不丢 text-a 的参数，切回可恢复。
const textA = { channelId: "ch1", modelId: "text-a" };
const keyA = dramaModelKey("text", textA);
const withParams = { ...profiles, paramsByKey: { ...profiles.paramsByKey, [keyA]: { reasoningEffort: "high" } } };
const switched = withProjectModelSelection(withParams, "text", "ch1::text-b");
assert.equal(projectModelOption({ ...fresh, modelProfiles: switched }, "text", config), "ch1::text-b");
assert.deepEqual(switched.paramsByKey[keyA], { reasoningEffort: "high" }, "旧模型参数不能在切换时丢失");
assert.ok(!JSON.stringify(switched).includes("apiKey"), "项目 profile 不能包含 API Key");

const switchedBack = withProjectModelSelection(switched, "text", "ch1::text-a");
const project = normalizeStudioProject({
    ...fresh,
    modelProfiles: switchedBack,
    settings: updateProjectSettingsModels(fresh.settings, switchedBack),
});
assert.equal(projectModelOption(project, "text", config), "ch1::text-a");
assert.equal(effectiveProjectConfig(project, "text", config).model, "text-a");
assert.equal(effectiveProjectConfig(project, "text", config).reasoningEffort, "high", "切回原模型必须恢复原参数");
const configBefore = JSON.stringify(config);
const effective = effectiveProjectConfig(project, "text", config);
assert.notEqual(effective.model, config.textModel, "项目模型可以不同于全局默认");
assert.equal(JSON.stringify(config), configBefore, "项目生成配置不能修改全局 AiConfig");
assert.notEqual(effective, config, "有效配置必须是副本");

// 旧 V2 项目缺新字段：补默认值但保留原有集/剧本/资产内容，并默认从剧本阶段继续。
const oldProject = {
    ...createStudioProject({ title: "旧项目", episodeCount: 1 }),
    legacySequenceId: "legacy-seq-1",
    workflowMode: undefined,
    automationMode: undefined,
    adaptationMode: undefined,
    projectStatus: undefined,
    currentStep: undefined,
    stepStates: undefined,
    modelProfiles: undefined,
} as unknown as StudioProject;
const oldEpisode = oldProject.episodes[0];
oldEpisode.script = { ...oldEpisode.script, text: "旧项目剧本正文", outline: "旧项目大纲" };
const oldShot = defaultShot(oldEpisode.id, "scene-old", "01");
oldShot.videoRef = "old-video-key";
oldShot.videoRemote = {
    taskId: "old-remote-task",
    provider: "doubao",
    model: "video-a",
    prompt: "旧项目视频",
    params: { seconds: "5" },
    createdAt: new Date().toISOString(),
    stale: false,
} as StudioShot["videoRemote"];
oldEpisode.shots = [oldShot];
const oldAsset = createAsset("character", "阿岚");
oldProject.assets = [oldAsset];
const normalized = normalizeStudioProject(oldProject);
assert.equal(normalized.episodes.length, 1, "旧项目分集不能被清空");
assert.equal(normalized.episodes[0].script.text, "旧项目剧本正文", "旧剧本文本不能丢失");
assert.equal(normalized.episodes[0].shots[0].videoRef, "old-video-key", "旧视频引用不能丢失");
assert.equal(normalized.episodes[0].shots[0].videoRemote?.taskId, "old-remote-task", "旧视频远端任务不能丢失");
assert.equal(normalized.assets[0].name, "阿岚", "旧人物资产不能丢失");
assert.equal(normalized.currentStep, "script");
assert.equal(normalized.projectStatus, "draft");
assert.equal(defaultStepForProject(normalized), "script");
assert.equal(defaultStepForProject(fresh), "analysis");

assert.deepEqual(mapLegacyWorkspace("script"), { location: "script", subView: "script" });
assert.deepEqual(mapLegacyWorkspace("director"), { location: "script", subView: "storyboard" });
assert.deepEqual(mapLegacyWorkspace("assets"), { location: "assets" });
assert.deepEqual(mapLegacyWorkspace("picture"), { location: "review" });
assert.deepEqual(mapLegacyWorkspace("video"), { location: "video", subView: "video" });
assert.deepEqual(mapLegacyWorkspace("sound"), { location: "video", subView: "sound" });
assert.deepEqual(mapLegacyWorkspace("projects"), { location: "projects" });
assert.equal(mapLegacyWorkspace("unknown"), null);

console.log(JSON.stringify({
    ok: true,
    assertions: "all passed",
    freshStep: fresh.currentStep,
    oldStep: normalized.currentStep,
    textProfile: projectModelOption(project, "text", config),
    effectiveModel: effective.model,
    globalUntouched: true,
    legacyRoutes: ["script", "director", "assets", "picture", "video", "sound", "projects"].map((workspace) => [workspace, mapLegacyWorkspace(workspace)]),
}, null, 2));
