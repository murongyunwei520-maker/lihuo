import type { DramaAssetKind, DramaSequence, DramaShot } from "@/types/drama";

// 短剧工厂的流程定义与派生状态：只有一份来源，导航、检查器、任务栏都读这里。
// 场景不单独建表——同场景名 + 同地点的镜头自然成组，避免和第二份数据打架。

export type DramaStep = { id: number; label: string; hint: string };
export type DramaStage = { id: string; label: string; steps: DramaStep[] };

export const DRAMA_STAGES: DramaStage[] = [
    {
        id: "plan",
        label: "故事策划",
        steps: [
            { id: 0, label: "输入灵感", hint: "创意 · 题材 · 要求" },
            { id: 1, label: "生成剧本", hint: "大纲 · 分集 · 对白" },
            { id: 2, label: "确认设定", hint: "世界观 · 人物 · 画风" },
        ],
    },
    {
        id: "visual",
        label: "视觉开发",
        steps: [
            { id: 3, label: "剧本拆解", hint: "场次 · 人物 · 道具" },
            { id: 4, label: "资产生成", hint: "人物 · 场景 · 服装 · 道具" },
            { id: 5, label: "分镜设计", hint: "镜头 · 景别 · 运镜" },
        ],
    },
    {
        id: "produce",
        label: "AI 内容生产",
        steps: [
            { id: 6, label: "逐镜出图", hint: "文生图 · 图生图 · 多版本" },
            { id: 7, label: "声音制作", hint: "音色绑定 · 对白配音" },
            { id: 8, label: "视频生成", hint: "图生视频 · 参数 · 队列" },
        ],
    },
    {
        id: "compose",
        label: "成片制作",
        steps: [{ id: 9, label: "分镜合成与成片导出", hint: "拼接 · 声音 · 导出" }],
    },
];

export const DRAMA_STEPS = DRAMA_STAGES.flatMap((stage) => stage.steps);
export const LAST_STEP = DRAMA_STEPS.length - 1;

export function stageOfStep(step: number) {
    return DRAMA_STAGES.find((stage) => stage.steps.some((item) => item.id === step)) ?? DRAMA_STAGES[0];
}

export type StepState = "done" | "active" | "todo" | "error";

/** 步骤完成度按真实内容判断，不按「点过没点过」——刷新后仍然准。 */
export function stepStates(sequence: DramaSequence | null): StepState[] {
    if (!sequence) return DRAMA_STEPS.map(() => "todo");
    const { assets, shots } = sequence;
    const withLine = shots.filter((shot) => shot.line.trim());
    const imageFailed = shots.some((shot) => shot.generation?.image?.status === "failed" || (!shot.generation?.image && shot.status === "failed"));
    const audioFailed = shots.some((shot) => shot.generation?.audio?.status === "failed");
    const videoFailed = shots.some((shot) => shot.generation?.video?.status === "failed");
    const bible = sequence.bible;
    // 剧本改过、素材内容对不上的镜头不算完成：批量按钮会把它们重新做一遍。
    const imageReady = shots.every((shot) => shot.imageRef && !shot.generation?.image?.stale);
    const audioReady = withLine.every((shot) => shot.audioRef && !shot.generation?.audio?.stale);
    const videoReady = shots.every((shot) => shot.videoRef && !shot.generation?.video?.stale);
    const checks: boolean[] = [
        Boolean(sequence.script?.premise?.trim() || sequence.script?.text.trim()),
        Boolean(sequence.script?.text.trim()),
        Boolean(bible && (bible.world.trim() || bible.visual.trim() || (bible.era ?? "").trim())),
        shots.length > 0,
        // 不只 refs 非空：必须是有内容的引用字符串，避免空 key 也算完成。
        assets.length > 0 && assets.every((asset) => asset.refs.some((ref) => Boolean(ref && ref.trim()))),
        shots.length > 0 && shots.every((shot) => shot.scene.trim() && (shot.prompt.trim() || shot.action?.trim())),
        shots.length > 0 && imageReady,
        // 没有台词的剧集不要求配音，直接视为完成。
        withLine.length === 0 || audioReady,
        shots.length > 0 && videoReady,
        Boolean(sequence.exportedAt),
    ];
    return checks.map((done, index) => {
        if (done) return "done";
        if (index === 6 && imageFailed) return "error";
        if (index === 7 && audioFailed) return "error";
        if (index === 8 && videoFailed) return "error";
        return "todo";
    });
}

export type DramaScene = {
    id: string;
    no: string;
    name: string;
    location: string;
    shots: DramaShot[];
    seconds: number;
    characters: string[];
    props: string[];
};

/** 项目 → 场景：同场景名成组，场景序号按首次出现的顺序。 */
export function deriveScenes(sequence: DramaSequence): DramaScene[] {
    const groups = new Map<string, DramaShot[]>();
    for (const shot of sequence.shots) {
        const key = shot.scene.trim() || "未标场景";
        const list = groups.get(key) ?? [];
        list.push(shot);
        groups.set(key, list);
    }
    const byId = new Map(sequence.assets.map((asset) => [asset.id, asset]));
    return [...groups.entries()].map(([name, shots], index) => {
        const picked = (kind: DramaAssetKind) =>
            [...new Set(shots.flatMap((shot) => shot.assetIds.map((id) => byId.get(id)).filter((asset) => asset?.kind === kind).map((asset) => asset!.name)))];
        return {
            id: `scene-${index + 1}`,
            no: String(index + 1).padStart(2, "0"),
            name,
            location: shots.find((shot) => shot.location?.trim())?.location ?? "",
            shots,
            seconds: shots.reduce((sum, shot) => sum + shot.seconds, 0),
            characters: picked("character"),
            props: [...picked("prop"), ...picked("costume")],
        };
    });
}

export function productionProgress(sequence: DramaSequence | null) {
    const shots = sequence?.shots ?? [];
    const withLine = shots.filter((shot) => shot.line.trim());
    const failedOf = (kind: "image" | "audio" | "video") =>
        shots.filter((shot) => (kind === "image" ? shot.generation?.image?.status === "failed" || (!shot.generation?.image && shot.status === "failed") : shot.generation?.[kind]?.status === "failed")).length;
    return {
        shots: shots.length,
        // 内容对不上新剧本的素材不算「已完成」，和导航的完成度保持一致。
        images: shots.filter((shot) => shot.imageRef && !shot.generation?.image?.stale).length,
        audios: withLine.filter((shot) => shot.audioRef && !shot.generation?.audio?.stale).length,
        voices: withLine.length,
        videos: shots.filter((shot) => shot.videoRef && !shot.generation?.video?.stale).length,
        /** 图片失败数（任务栏「图片」列用）。 */
        failed: failedOf("image"),
        imageFailed: failedOf("image"),
        audioFailed: failedOf("audio"),
        videoFailed: failedOf("video"),
    };
}
