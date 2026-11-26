import { describe, expect, test } from "bun:test";

import { bindAssets } from "../src/lib/drama/bind";
import { buildAssetPrompt } from "../src/lib/drama/asset-prompt";
import { mergeBibleDraft, ruleBibleDraft } from "../src/lib/drama/bible";
import { assetsOfShot, shotImagePrompt, shotReferences, shotVideoPrompt } from "../src/lib/drama/prompt";
import { extractCast, extractScenes, normalizeAiShots, ruleBasedSplit } from "../src/lib/drama/script";
import { DEFAULT_DRAMA_SETTINGS } from "../src/lib/drama/settings";
import { isScriptStale, mergeSplitShots, scriptFingerprint } from "../src/lib/drama/sync";
import { resolveCinematography } from "../src/lib/drama/visual";
import type { DramaAsset, DramaSequence, DramaShot } from "../src/types/drama";

// 短剧生产链路的纯逻辑回归：拆镜、容错、Prompt 构造、摄影参数分层、资产绑定。
// 不涉及网络请求，可在无模型 Key 的情况下运行。

const SCRIPT = `场景一：老宅正堂，夜，内。
人物：沈砚、沈夫人。
沈夫人放下茶盏，说：“你还知道回来？”
沈砚没有回答，只抬眼看向她。

场景二：老宅庭院，夜，外。
沈砚转身离开，雨水落在青石地面。`;

describe("ruleBasedSplit", () => {
    const shots = ruleBasedSplit(SCRIPT);

    test("识别两个场景且没有空场景镜头", () => {
        const scenes = [...new Set(shots.map((shot) => shot.scene))];
        expect(scenes).toEqual(["老宅正堂", "老宅庭院"]);
        expect(shots.every((shot) => shot.scene.trim().length > 0)).toBe(true);
    });

    test("场景标题与人物表不会被当成台词或镜头", () => {
        expect(shots.every((shot) => !shot.line.includes("场景一"))).toBe(true);
        expect(shots.every((shot) => !shot.prompt.includes("沈砚、沈夫人"))).toBe(true);
    });

    test("对白与动作分开，且识别说话人", () => {
        const dialog = shots.find((shot) => shot.line.includes("你还知道回来"));
        expect(dialog).toBeTruthy();
        expect(dialog?.speaker).toBe("沈夫人");
        expect(dialog?.action).toContain("放下茶盏");
        expect(dialog?.line).not.toContain("放下茶盏");
    });

    test("无对白镜头 line 保持为空", () => {
        const silent = shots.find((shot) => (shot.prompt ?? "").includes("没有回答"));
        expect(silent).toBeTruthy();
        expect(silent?.line).toBe("");
    });

    test("时长在 4–15s，并推断出场人物", () => {
        expect(shots.every((shot) => shot.seconds >= 4 && shot.seconds <= 15)).toBe(true);
        expect(shots.some((shot) => (shot.characters ?? []).includes("沈夫人"))).toBe(true);
        expect(shots.some((shot) => (shot.characters ?? []).includes("沈砚"))).toBe(true);
    });
});

describe("normalizeAiShots", () => {
    const dirty = {
        shots: [
            { scene: "老宅正堂", size: "中景", seconds: 99, line: "你还知道回来？", action: "放下茶盏", characters: "沈夫人", assetNames: ["沈夫人"] },
            { scene: "老宅正堂", seconds: -3, prompt: "抬眼看向她", characters: ["沈砚"] },
            { scene: "", line: "", prompt: "", action: "" },
            null,
            { scene: "老宅庭院", seconds: "abc", action: "转身离开", light: "right" },
            { scene: "老宅庭院", seconds: 6, prompt: "雨水落在青石地面" },
        ],
    };
    const shots = normalizeAiShots(dirty);

    test("丢掉空镜与 null，保留有效镜头", () => {
        expect(shots).toHaveLength(4);
    });

    test("时长越界与类型错误被兜住", () => {
        expect(shots.every((shot) => shot.seconds >= 4 && shot.seconds <= 15)).toBe(true);
        expect(shots.every((shot) => Number.isFinite(shot.seconds))).toBe(true);
    });

    test("镜号重新编号，不重复", () => {
        expect(new Set(shots.map((shot) => shot.no)).size).toBe(shots.length);
    });

    test("动作保留、字符串人物转数组", () => {
        expect(shots[0].action).toBe("放下茶盏");
        expect(Array.isArray(shots[0].characters)).toBe(true);
        expect(shots[0].characters?.[0]).toBe("沈夫人");
    });
});

const sequence: DramaSequence = {
    id: "seq",
    title: "测试",
    targetSeconds: 60,
    shots: [],
    assets: [],
    script: { text: SCRIPT, source: "paste" },
    bible: { world: "民国老宅", background: "", relations: "", visual: "低饱和冷调", era: "民国江南", palette: "青灰", material: "青石与实木", negative: "现代电器" },
    settings: { ...DEFAULT_DRAMA_SETTINGS, style: "写实电影", ratio: "9:16", lens: "85mm 中焦", aperture: "f/1.4 极浅景深", keyLight: "窗光", fillLight: "无补光", composition: "对称构图" },
    createdAt: "",
    updatedAt: "",
};

describe("buildAssetPrompt", () => {
    const character: DramaAsset = { id: "a1", name: "沈夫人", kind: "character", description: "五十岁，发髻，深色旗袍", refs: [] };
    const scene: DramaAsset = { id: "a2", name: "老宅正堂", kind: "scene", description: "正堂，夜，内", refs: [] };

    test("包含项目画风、时代、色彩与摄影参数", () => {
        const prompt = buildAssetPrompt(sequence, character);
        expect(prompt).toContain("写实电影");
        expect(prompt).toContain("民国江南");
        expect(prompt).toContain("青灰");
        expect(prompt).toContain("85mm");
        expect(prompt).toContain("f/1.4");
        expect(prompt).toContain("窗光");
    });

    test("包含类型模板、画幅与负面词", () => {
        const prompt = buildAssetPrompt(sequence, character);
        expect(prompt).toContain("人物设定图");
        expect(prompt).toContain("画幅：9:16");
        expect(prompt).toContain("负面提示词");
        expect(prompt).toContain("现代电器");
    });

    test("不同资产类型使用不同模板", () => {
        const characterPrompt = buildAssetPrompt(sequence, character);
        const scenePrompt = buildAssetPrompt(sequence, scene);
        expect(scenePrompt).toContain("场景概念图");
        expect(scenePrompt).toContain("不要出现人物");
        expect(scenePrompt).not.toBe(characterPrompt);
    });
});

describe("shot prompts", () => {
    const shot = { ...ruleBasedSplit(SCRIPT)[0], assetIds: ["a1"], expression: "克制", sound: "雨声" } as DramaShot;

    test("图片 Prompt 含动作、表情、摄影与一致性约束", () => {
        const prompt = shotImagePrompt(sequence, shot);
        expect(prompt).toContain("放下茶盏");
        expect(prompt).toContain("克制");
        expect(prompt).toContain("85mm");
        expect(prompt).toContain("对称构图");
        expect(prompt).toContain("人物一致性");
        expect(prompt).toContain("负面提示词");
    });

    test("视频 Prompt 描述运动，且与图片 Prompt 不同", () => {
        const image = shotImagePrompt(sequence, shot);
        const video = shotVideoPrompt(sequence, shot);
        expect(video).not.toBe(image);
        expect(video).toContain("动作过程");
        expect(video).toContain("镜头");
        expect(video).toContain("时长：约");
    });
});

describe("resolveCinematography", () => {
    test("默认取项目设置", () => {
        const cinema = resolveCinematography(sequence);
        expect(cinema.lens).toBe("85mm 中焦");
        expect(cinema.aperture).toBe("f/1.4 极浅景深");
        expect(cinema.composition).toBe("对称构图");
    });

    test("镜头级参数覆盖项目默认", () => {
        const cinema = resolveCinematography(sequence, { ...ruleBasedSplit(SCRIPT)[0], lens: "24mm 广角", aperture: "f/8 大景深" });
        expect(cinema.lens).toBe("24mm 广角");
        expect(cinema.aperture).toBe("f/8 大景深");
        expect(cinema.keyLight).toBe("窗光");
    });
});

describe("bindAssets", () => {
    const shots = ruleBasedSplit(SCRIPT);
    const first = bindAssets(shots, []);

    test("为人物与场景建资产，并把 id 绑到镜头", () => {
        expect(first.assets.some((asset) => asset.kind === "character" && asset.name.includes("沈夫人"))).toBe(true);
        expect(first.assets.some((asset) => asset.kind === "scene")).toBe(true);
        expect(first.bound).toBeGreaterThan(0);
        expect(first.shots.some((shot) => shot.assetIds.length > 0)).toBe(true);
    });

    test("assetIds 全部指向真实资产", () => {
        expect(first.shots.every((shot) => shot.assetIds.every((id) => first.assets.some((asset) => asset.id === id)))).toBe(true);
    });

    test("重复绑定不新增资产，id 保持稳定", () => {
        const again = bindAssets(shots, first.assets);
        expect(again.assets).toHaveLength(first.assets.length);
        expect(again.shots.map((shot) => shot.assetIds)).toEqual(first.shots.map((shot) => shot.assetIds));
    });
});

// 剧本改过之后，下游镜头与素材要能跟着对齐：能对上的继承，对不上的标成待重做。
const shotOf = (part: Partial<DramaShot>): DramaShot => ({
    id: "p1",
    no: "01",
    scene: "老宅正堂",
    size: "中景",
    move: "固定",
    light: "left",
    seconds: 5,
    line: "",
    prompt: "",
    status: "done",
    assetIds: [],
    ...part,
});

const sequenceWith = (text: string, splitHash?: string): DramaSequence => ({
    id: "seq",
    title: "同步",
    targetSeconds: 60,
    shots: [shotOf({})],
    assets: [],
    script: { text, source: "paste" },
    split: splitHash ? { scriptHash: splitHash, at: "", mode: "ai" } : undefined,
    createdAt: "",
    updatedAt: "",
});

describe("scriptFingerprint / isScriptStale", () => {
    test("只改空白与缩进不算剧本变更", () => {
        expect(scriptFingerprint("场景一：正堂\n沈夫人起身")).toBe(scriptFingerprint("  场景一：正堂\n\n沈夫人起身  "));
    });

    test("没有拆镜快照的老数据不判脏", () => {
        expect(isScriptStale(sequenceWith("新剧本"))).toBe(false);
    });

    test("剧本改过且与快照不一致时为脏", () => {
        const text = "场景一：正堂\n沈夫人起身";
        expect(isScriptStale(sequenceWith(text, scriptFingerprint(text)))).toBe(false);
        expect(isScriptStale(sequenceWith(`${text}\n沈砚离开`, scriptFingerprint(text)))).toBe(true);
    });
});

describe("mergeSplitShots", () => {
    const produced = shotOf({
        id: "p1",
        line: "你还知道回来？",
        imageRef: "img-old",
        audioRef: "aud-old",
        videoRef: "vid-old",
        imageVersions: [{ storageKey: "img-old", createdAt: "" }],
        generation: { image: { status: "done" }, audio: { status: "done" }, video: { status: "done" } },
        approved: true,
    });

    test("台词没变时继承画面 / 配音 / 视频与旧 id", () => {
        const { shots, stats } = mergeSplitShots([produced], [shotOf({ id: "n1", line: "你还知道回来？" })]);
        expect(stats.reused).toBe(1);
        expect(shots[0].id).toBe("p1");
        expect(shots[0].imageRef).toBe("img-old");
        expect(shots[0].audioRef).toBe("aud-old");
        expect(shots[0].videoRef).toBe("vid-old");
        expect(shots[0].approved).toBe(true);
        expect(shots[0].generation?.image?.stale).toBeFalsy();
    });

    test("台词变了：旧配音丢掉，画面与视频保留并标成待重做", () => {
        const { shots, stats } = mergeSplitShots([produced], [shotOf({ id: "n1", line: "你终于回来了。" })]);
        expect(stats.edited).toBe(1);
        expect(shots[0].imageRef).toBe("img-old");
        expect(shots[0].audioRef).toBeUndefined();
        expect(shots[0].generation?.image?.stale).toBe(true);
        expect(shots[0].generation?.video?.stale).toBe(true);
        expect(shots[0].approved).toBeUndefined();
        // 新台词要按新内容展示，不能被旧版覆盖。
        expect(shots[0].line).toBe("你终于回来了。");
    });

    test("新增镜头不继承素材，删除镜头计入 removed，镜号重排", () => {
        const { shots, stats } = mergeSplitShots([produced], [shotOf({ id: "n1", line: "你还知道回来？" }), shotOf({ id: "n2", scene: "老宅庭院", prompt: "雨落青石" })]);
        expect(stats.reused).toBe(1);
        expect(stats.added).toBe(1);
        expect(stats.removed).toBe(0);
        expect(shots[1].imageRef).toBeUndefined();
        expect(shots.map((shot) => shot.no)).toEqual(["01", "02"]);

        const dropped = mergeSplitShots([produced], []);
        expect(dropped.shots).toHaveLength(0);
        expect(dropped.stats.removed).toBe(1);
    });

    test("同场景内按顺序配对：AI 重拆改写描述也能保住画面", () => {
        const { shots, stats } = mergeSplitShots([produced], [shotOf({ id: "n1", prompt: "她放下茶盏，抬眼" })]);
        expect(stats.edited).toBe(1);
        expect(shots[0].imageRef).toBe("img-old");
        expect(shots[0].generation?.image?.stale).toBe(true);
    });
});

// 03 步的设定补全：只重排前两步已有的信息，人物 / 场景从剧本里认，不编造剧情。
describe("extractCast / extractScenes", () => {
    test("人物表、引号对白说话人、「名字：台词」都能认出来", () => {
        const cast = extractCast(SCRIPT);
        expect(cast).toContain("沈夫人");
        expect(cast).toContain("沈砚");
        expect(cast.every((name) => name.length <= 8)).toBe(true);
    });

    test("场景标题按出现顺序去重，带地点信息", () => {
        const scenes = extractScenes(SCRIPT);
        expect(scenes.map((scene) => scene.name)).toEqual(["老宅正堂", "老宅庭院"]);
        expect(scenes[0].location).toContain("夜");
    });
});

describe("ruleBibleDraft / mergeBibleDraft", () => {
    const base: DramaSequence = {
        id: "bible",
        title: "测试",
        targetSeconds: 60,
        shots: [],
        assets: [],
        script: { text: SCRIPT, source: "paste", premise: "雨夜的一通电话", genre: "悬疑推理", background: "民国老宅，三日前下葬的人打来电话", direction: "女主查清真相" },
        settings: { ...DEFAULT_DRAMA_SETTINGS, style: "写实电影", composition: "三分构图" },
        createdAt: "",
        updatedAt: "",
    };

    test("世界观 / 背景 / 视觉用前两步的内容拼出来，人物建卡但不编造描述", () => {
        const draft = ruleBibleDraft(base);
        expect(draft.bible.world).toContain("民国老宅");
        expect(draft.bible.world).toContain("悬疑推理");
        expect(draft.bible.background).toContain("雨夜的一通电话");
        expect(draft.bible.visual).toContain("写实电影");
        expect(draft.bible.relations).toBe("");
        expect(draft.characters.length).toBeGreaterThan(0);
        expect(draft.characters.every((item) => item.description === "")).toBe(true);
        expect(draft.scenes.map((scene) => scene.name)).toEqual(["老宅正堂", "老宅庭院"]);
    });

    test("fill 模式只补空字段，用户写的设定不被覆盖", () => {
        const draft = ruleBibleDraft(base);
        const edited = { ...base, bible: { world: "用户自己写的世界观", background: "", relations: "", visual: "" } };
        const merged = mergeBibleDraft(edited, draft, "fill");
        expect(merged.bible.world).toBe("用户自己写的世界观");
        expect(merged.bible.background).toContain("雨夜的一通电话");
        expect(merged.assets.some((asset) => asset.kind === "character" && asset.name === "沈夫人")).toBe(true);
        expect(merged.assets.some((asset) => asset.kind === "scene" && asset.name === "老宅正堂")).toBe(true);
    });

    test("AI 的人物描述只补空描述，改过的文案保留", () => {
        const current = { ...base, assets: [{ id: "a1", name: "沈夫人", kind: "character" as const, description: "用户改过的描述", refs: [] }] };
        const merged = mergeBibleDraft(current, { bible: { world: "AI 世界观", background: "", relations: "沈夫人是沈砚的继母", visual: "", era: "", palette: "", material: "", negative: "" }, characters: [{ name: "沈夫人", description: "AI 描述" }, { name: "沈砚", description: "三十岁，留洋归来" }], scenes: [] }, "replace");
        expect(merged.bible.world).toBe("AI 世界观");
        expect(merged.assets.find((asset) => asset.name === "沈夫人")?.description).toBe("用户改过的描述");
        expect(merged.assets.find((asset) => asset.name === "沈砚")?.description).toBe("三十岁，留洋归来");
    });
});

describe("道具参考图", () => {
    const props = (withRefs: boolean) => [
        { id: "c1", name: "林晚", kind: "character" as const, description: "", refs: withRefs ? ["face.png"] : [] },
        { id: "s1", name: "街口", kind: "scene" as const, description: "", refs: withRefs ? ["street.png"] : [] },
        { id: "p1", name: "手机", kind: "prop" as const, description: "", refs: withRefs ? ["phone.png"] : [] },
    ];

    test("拆镜时按名字提到就绑定道具", () => {
        const shots = [{ ...ruleBasedSplit(SCRIPT)[0], prompt: "她低头看手机", assetIds: [], assetNames: [] }];
        const bound = bindAssets(shots, props(true));
        expect(bound.shots[0].assetIds).toContain("p1");
    });

    test("老镜头没绑道具时，出图也会按画面文字补上参考图", () => {
        const sequence: DramaSequence = {
            id: "seq",
            title: "测试",
            targetSeconds: 60,
            shots: [],
            assets: props(true),
            createdAt: "",
            updatedAt: "",
        };
        const shot = { ...ruleBasedSplit(SCRIPT)[0], assetIds: ["c1", "s1"], prompt: "她低头看手机" };
        const assets = assetsOfShot(sequence, shot);
        expect(assets.map((asset) => asset.id)).toEqual(["c1", "s1", "p1"]);
        expect(shotReferences(sequence, shot)).toEqual(["face.png", "street.png", "phone.png"]);
    });

    test("没有图的资产不进参考图，重复 key 去重", () => {
        const assets = props(false).map((asset) => (asset.id === "s1" ? { ...asset, refs: ["face.png"] } : asset));
        const sequence: DramaSequence = { id: "seq", title: "t", targetSeconds: 60, shots: [], assets, createdAt: "", updatedAt: "" };
        const shot = { ...ruleBasedSplit(SCRIPT)[0], assetIds: ["c1", "s1"], prompt: "" };
        expect(shotReferences(sequence, shot)).toEqual(["face.png"]);
    });
});
