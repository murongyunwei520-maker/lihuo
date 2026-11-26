import { describe, expect, test } from "bun:test";

import { DEFAULT_DRAMA_SETTINGS } from "../src/lib/drama/settings";
import { applyVideoPlan, buildVideoPlan } from "../src/lib/drama/video-request";
import { resolveVideoCapability } from "../src/lib/drama/video-caps";
import type { DramaSequence, DramaShot } from "../src/types/drama";

// 视频请求计划：只验证「提交内容如何折算」这一层，不发起真实网络请求。
// 能力来自项目里的模型参数 Schema；无法确认的能力（文生视频/多参考图）必须保持关闭。

const shot: DramaShot = {
    id: "s1",
    no: "01",
    scene: "老宅正堂",
    location: "夜，内",
    size: "中景",
    move: "固定",
    light: "left",
    seconds: 6,
    line: "你还知道回来？",
    prompt: "沈夫人放下茶盏",
    action: "放下茶盏",
    expression: "克制",
    status: "pending",
    assetIds: [],
    imageRef: "media/shot-01.png",
};

const sequence: DramaSequence = {
    id: "seq",
    title: "测试",
    targetSeconds: 60,
    shots: [shot],
    assets: [],
    bible: { world: "民国老宅", background: "", relations: "", visual: "低饱和冷调", era: "民国江南", palette: "青灰", material: "青石", negative: "现代电器" },
    settings: { ...DEFAULT_DRAMA_SETTINGS, videoModel: "builtin-doubao::seedance-2.5", videoRatio: "9:16", videoQuality: "1080P" },
    createdAt: "",
    updatedAt: "",
};

describe("resolveVideoCapability", () => {
    test("内置豆包模型：时长 4–15s，比例来自能力表", () => {
        const caps = resolveVideoCapability("builtin-doubao::seedance-2.5");
        expect(caps.provider).toBe("builtin");
        expect(caps.seconds.min).toBeGreaterThanOrEqual(4);
        expect(caps.seconds.max).toBeLessThanOrEqual(15);
        expect(caps.ratios.length).toBeGreaterThan(0);
        expect(caps.firstFrame).toBe(true);
    });

    test("未确认的能力默认关闭", () => {
        const caps = resolveVideoCapability("some-channel::video-model");
        expect(caps.textToVideo).toBe(false);
        expect(caps.multiReference).toBe(false);
        expect(caps.firstFrame).toBe(true);
    });

    test("未选模型时不报错，给出通用能力", () => {
        const caps = resolveVideoCapability("");
        expect(caps.provider).toBe("unknown");
        expect(caps.seconds.max).toBe(15);
        expect(caps.notes.length).toBeGreaterThan(0);
    });
});

describe("buildVideoPlan", () => {
    const caps = resolveVideoCapability(sequence.settings?.videoModel);

    test("有首帧时按图生视频提交，提示词来自分镜动态描述", () => {
        const plan = buildVideoPlan({ sequence, shot, settings: { ...DEFAULT_DRAMA_SETTINGS, videoModel: "builtin-doubao::seedance-2.5", videoRatio: "9:16" }, capability: caps });
        expect(plan.blocked).toBe("");
        expect(plan.referenceMode).toBe("first-frame");
        expect(plan.references).toEqual(["media/shot-01.png"]);
        expect(plan.prompt).toContain("动作过程");
        expect(plan.params.seconds).toBe("6");
    });

    test("镜头时长超出模型范围时收敛并给出差异提示", () => {
        const longShot = { ...shot, seconds: 30 };
        const plan = buildVideoPlan({ sequence, shot: longShot, settings: { ...DEFAULT_DRAMA_SETTINGS, videoModel: "builtin-doubao::seedance-2.5" }, capability: caps });
        expect(plan.seconds).toBeLessThanOrEqual(caps.seconds.max);
        expect(plan.seconds).toBeLessThan(30);
        expect(plan.warnings.join(" ")).toContain("本次按");
    });

    test("模型不支持的比例退回自动，并提示", () => {
        const plan = buildVideoPlan({ sequence, shot, settings: { ...DEFAULT_DRAMA_SETTINGS, videoModel: "builtin-doubao::seedance-2.5", videoRatio: "21:9" }, capability: resolveVideoCapability("builtin-doubao::seedance-2.5") });
        if (!resolveVideoCapability("builtin-doubao::seedance-2.5").ratios.includes("21:9")) {
            expect(plan.ratio).toBe("自动");
            expect(plan.warnings.join(" ")).toContain("不支持");
        }
    });

    test("没有首帧且模型不支持文生视频时拦截", () => {
        const plan = buildVideoPlan({ sequence, shot: { ...shot, imageRef: undefined }, settings: DEFAULT_DRAMA_SETTINGS, capability: caps });
        expect(plan.blocked).not.toBe("");
        expect(plan.referenceMode).toBe("none");
    });

    test("自定义视频提示词优先", () => {
        const plan = buildVideoPlan({ sequence, shot: { ...shot, videoPrompt: "镜头缓慢推进，雨丝落下" }, settings: DEFAULT_DRAMA_SETTINGS, capability: caps });
        expect(plan.prompt).toBe("镜头缓慢推进，雨丝落下");
    });

    test("applyVideoPlan 把时长与比例写回请求配置", () => {
        const plan = buildVideoPlan({ sequence, shot, settings: { ...DEFAULT_DRAMA_SETTINGS, videoModel: "builtin-doubao::seedance-2.5", videoRatio: "9:16", videoQuality: "1080P" }, capability: caps });
        const config = applyVideoPlan({ videoSeconds: "10", size: "1:1", vquality: "720P" } as never, plan);
        expect(config.videoSeconds).toBe("6");
        expect(config.size).toBe("9:16");
        expect(config.vquality).toBe("1080P");
    });
});
