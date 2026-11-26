import assert from "node:assert/strict";

import { buildStudioVideoPlan } from "@/lib/studio/video-plan";
import { affectedByAsset, shotsUsingAsset } from "@/lib/studio/deps";
import { createAsset, createEpisode, createMediaVersion, createScene, createStudioProject, defaultShot, nowIso } from "@/lib/studio/factory";
import { lintEpisode, suggestDurationAdjustment } from "@/lib/studio/lint";
import { migrateLegacySequence } from "@/lib/studio/migrate";
import { assetVersionSnapshot, assetsOfShot, buildShotImagePrompt, referenceKeysForShot } from "@/lib/studio/prompt";
import type { DramaSequence } from "@/types/drama";

// 纯函数级核心验收：旧数据迁移、资产/场景参考、依赖标记、导演校验、视频计划。
// 不触碰浏览器存储，不调用任何真实模型账号额度。

const created = nowIso();
const legacy = {
    id: "seq-legacy-1",
    title: "旧版测试剧",
    projectId: "canvas-legacy-1",
    targetSeconds: 60,
    createdAt: created,
    updatedAt: created,
    settings: { textModel: "text-1", imageModel: "image-1", videoModel: "video-1", audioModel: "audio-1", style: "写实电影", ratio: "9:16", assetQuality: "1080P", videoRatio: "9:16", videoQuality: "1080P", videoSeconds: "5s", lens: "35mm 人文", aperture: "f2.8", keyLight: "left", fillLight: "soft", composition: "三分构图" },
    script: { premise: "旧版灵感", genre: "悬疑", direction: "快节奏", requirement: "不能超时", outline: "旧版大纲", text: "旧版剧本文本", fileName: "旧剧本.md", source: "generated" },
    bible: { logline: "旧版一句话", world: "旧世界", background: "旧背景", relations: "阿岚—师父", palette: "冷蓝", material: "金属", negative: "低清", visual: "统一电影感" },
    voices: { "asset-a": "voice-a", narration: "voice-narr" },
    assets: [
        { id: "asset-a", kind: "character", name: "阿岚", description: "旧人物设定", refs: ["char-key"], versions: [{ id: "v-char", storageKey: "char-key", model: "image-1", prompt: "旧人物图", parameters: { ratio: "9:16" }, createdAt: created }], audioRef: "sample-key", model: "image-1" },
    ],
    shots: [
        {
            id: "shot-legacy-1",
            no: "01",
            scene: "天台",
            location: "城市天台",
            prompt: "雨夜天台，阿岚回头",
            characters: ["阿岚"],
            assetIds: ["asset-a"],
            action: "回头",
            expression: "惊讶",
            size: "中景",
            camera: "平视",
            lens: "35mm 人文",
            move: "推",
            composition: "三分构图",
            light: "left",
            line: "“你终于来了。”",
            speaker: "旁白",
            sound: "雨声",
            seconds: 5,
            approved: false,
            status: "done",
            imageRef: "img-key",
            imageVersions: [{ id: "v-img", storageKey: "img-key", model: "image-1", prompt: "旧首帧", params: {}, createdAt: created }],
            videoRef: "video-key",
            videoVersions: [],
            audioRef: "audio-key",
            audioVersions: [],
            imagePrompt: "旧首帧提示词",
            videoPrompt: "旧视频提示词",
            nodeId: "node-legacy-1",
            generation: {
                image: { status: "done" },
                video: { status: "done", remote: { taskId: "remote-1", provider: "doubao", model: "video-1", prompt: "旧视频", params: { seconds: "5" }, createdAt: created, stale: false } },
                audio: { status: "done" },
            },
        },
    ],
} as unknown as DramaSequence;

const project = migrateLegacySequence(legacy);
assert.equal(project.id, "legacy-seq-legacy-1");
assert.equal(project.legacySequenceId, "seq-legacy-1");
assert.equal(project.genre, "悬疑");
assert.equal(project.episodes.length, 1);
assert.equal(project.episodes[0].shots[0].id, "shot-legacy-1");
assert.equal(project.episodes[0].workflowProjectId, "canvas-legacy-1");
assert.equal(project.episodes[0].shots[0].narration, "“你终于来了。”");
assert.equal(project.episodes[0].shots[0].speaker, "");
assert.equal(project.episodes[0].shots[0].line, "");
assert.equal(project.episodes[0].shots[0].videoRemote?.taskId, "remote-1");
assert.equal(project.assets[0].voiceId, "voice-a");
assert.ok(project.assets[0].officialRef === "char-key");
assert.ok(project.episodes[0].script.versions.length === 1);
assert.equal((legacy as DramaSequence).title, "旧版测试剧", "迁移不能修改旧对象");

// createStudioProject 新项目默认 0 集（分集由第一步分析产生），旧核心用例显式要一集空壳。
const fresh = createStudioProject({ title: "资产依赖测试", targetSeconds: 60, episodeCount: 1 });
const episode = fresh.episodes[0];
const scene = createScene("01", "天台", "城市天台");
const character = createAsset("character", "阿岚");
character.description = "冷静的女主";
character.versions = [createMediaVersion({ storageKey: "char-new", source: "studio" })];
character.officialRef = "char-new";
const sceneAsset = createAsset("scene", "天台");
sceneAsset.versions = [createMediaVersion({ storageKey: "scene-new", source: "studio" })];
sceneAsset.officialRef = "scene-new";
scene.assetId = sceneAsset.id;
episode.scenes = [scene];
fresh.assets = [character, sceneAsset];
const shot = defaultShot(episode.id, scene.id, "01");
shot.sceneName = scene.name;
shot.description = "雨夜，阿岚站在天台边缘";
shot.characterNames = ["阿岚"];
shot.assetIds = [];
shot.imageRef = "shot-img";
shot.imageVersions = [createMediaVersion({ storageKey: "shot-img", source: "studio", assetVersionIds: { [character.id]: "old-character-version" } })];
episode.shots = [shot];

assert.ok(assetsOfShot(fresh, shot, episode).some((asset) => asset.id === character.id), "按人物名补齐资产");
assert.ok(assetsOfShot(fresh, shot, episode).some((asset) => asset.id === sceneAsset.id), "场景资产自动进入参考");
assert.deepEqual(referenceKeysForShot(fresh, shot, episode).sort(), ["char-new", "scene-new"].sort());
const snapshot = assetVersionSnapshot(fresh, shot, episode);
assert.equal(snapshot[character.id], character.versions[0].id);
assert.equal(snapshot[sceneAsset.id], sceneAsset.versions[0].id);
assert.equal(shotsUsingAsset(fresh, character.id).length, 1, "未显式绑定但按人物名引用也要算依赖");
assert.equal(shotsUsingAsset(fresh, sceneAsset.id).length, 1, "场景资产按场景名引用也要算依赖");
const prompt = buildShotImagePrompt(fresh, episode, shot);
assert.ok(prompt.includes("阿岚"));
assert.ok(prompt.includes("天台"));
assert.ok(prompt.includes("冷静的女主"));

shot.assetIds = [character.id];
const impacts = affectedByAsset(fresh, character.id);
assert.ok(impacts.some((impact) => impact.shotId === shot.id && impact.media.includes("image")), "旧资产版本应标记首帧受影响");

shot.seconds = 3;
shot.description = "";
shot.action = "";
const issues = lintEpisode(fresh, episode);
assert.ok(issues.some((issue) => issue.message.includes("超出 4–15s")));
assert.ok(issues.some((issue) => issue.message.includes("缺少画面描述")));
const adjustment = suggestDurationAdjustment({ ...episode, targetSeconds: 5, shots: [{ ...shot, seconds: 12 }] }, 5);
assert.ok(adjustment.length === 1 && adjustment[0].to >= 4, "压缩建议不得低于 4s");

const savedImageRef = shot.imageRef;
shot.imageRef = "";
const withoutFirstFrame = buildStudioVideoPlan({ project: fresh, episode, shot, model: "test-video-model" });
assert.ok(withoutFirstFrame.blocked.includes("正式首帧"));
shot.seconds = 5;
shot.imageRef = savedImageRef;
const plan = buildStudioVideoPlan({ project: fresh, episode, shot, model: "test-video-model" });
assert.equal(plan.blocked, "");
assert.equal(plan.references[0], "shot-img");
assert.equal(plan.seconds, 5);
shot.videoSeconds = "5s";
const planWithDurationString = buildStudioVideoPlan({ project: fresh, episode, shot, model: "test-video-model" });
assert.equal(planWithDurationString.seconds, 5, "5s 这类下拉值必须能解析");
shot.videoLastFrameRef = "tail-key";
assert.equal(plan.lastFrame, false);

console.log(JSON.stringify({ ok: true, assertions: "all passed", migration: "旧序列→项目/集", references: referenceKeysForShot(fresh, shot, episode), impacts: impacts.length, issues: issues.length, plan: plan.blocked || "ready" }, null, 2));
