import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
import type { StudioEpisode, StudioProject, StudioShot } from "@/types/studio";

// 剧本 / 分集 / 拆场拆镜 / 单镜补全 的 AI 能力。复用画布文本链路，不另起请求层。

type Base = { config: AiConfig; model?: string; signal?: AbortSignal; onDelta?: (text: string) => void };

function textConfig(config: AiConfig, model?: string): AiConfig {
    const base = buildGenerationConfig(config, undefined, "text");
    return model ? { ...base, model, textModel: model } : base;
}

function projectHint(project: StudioProject) {
    const lines = [
        project.visualStyle.mainStyle ? `视觉风格：${project.visualStyle.mainStyle}` : "",
        project.visualStyle.palette ? `色彩：${project.visualStyle.palette}` : "",
        project.bible.world ? `世界观：${project.bible.world}` : "",
        project.bible.background ? `背景：${project.bible.background}` : "",
        project.bible.relations ? `人物关系：${project.bible.relations}` : "",
        project.bible.ending ? `结局方向：${project.bible.ending}` : "",
    ].filter(Boolean);
    return lines.length ? `\n\n项目设定：\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
}

function brief(project: StudioProject, episode: StudioEpisode) {
    const script = episode.script;
    return [
        script.premise ? `一句话灵感：${script.premise}` : "",
        script.genre ? `题材：${script.genre}` : "",
        script.type ? `类型：${script.type}` : "",
        script.audience ? `受众：${script.audience}` : "",
        script.direction ? `创作方向：${script.direction}` : "",
        script.conflict ? `核心冲突：${script.conflict}` : "",
        script.constraints ? `特殊约束：${script.constraints}` : "",
        script.outline ? `已确认大纲（必须遵守）：\n${script.outline}` : "",
        project.logline ? `项目一句话：${project.logline}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("模型没有返回有效的 JSON");
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object") throw new Error("模型返回的 JSON 不是对象");
    return parsed as Record<string, unknown>;
}

const field = (record: Record<string, unknown>, key: string) => (typeof record[key] === "string" ? String(record[key]).trim() : "");
const num = (record: Record<string, unknown>, key: string, fallback: number) => {
    const value = Number(record[key]);
    return Number.isFinite(value) ? value : fallback;
};

export async function aiOutline(args: Base & { project: StudioProject; episode: StudioEpisode }) {
    const config = textConfig(args.config, args.model);
    const system =
        "你是短剧策划。根据用户给的一句话灵感与约束，写一份可直接开拍的故事大纲，只输出大纲正文，不要解释。\n" +
        "结构固定：一句话故事 / 世界观 / 主要人物（姓名、身份、目标、冲突关系）/ 故事主线 / 核心冲突 / 结局方向 / 分集大纲（每集一句主线 + 一句结尾钩子）。" +
        projectHint(args.project);
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        { role: "user", content: brief(args.project, args.episode) || `灵感：${args.project.logline || "未填写"}` },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => args.onDelta?.(delta), { signal: args.signal });
    return text.trim();
}

export async function aiScript(args: Base & { project: StudioProject; episode: StudioEpisode }) {
    const config = textConfig(args.config, args.model);
    const system =
        "你是短剧编剧。根据灵感、大纲和约束，写一集适合竖屏短剧拍摄的分场剧本正文。\n" +
        "要求：用「场景：地点 · 时间」标注每场戏；每场写清人物动作与台词，台词用引号；节奏紧凑，镜头感强；只输出剧本正文，不要分镜表与解释。" +
        projectHint(args.project);
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        { role: "user", content: `${brief(args.project, args.episode)}\n\n请写${args.episode.title}的完整剧本，目标时长约 ${args.episode.targetSeconds} 秒。` },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => args.onDelta?.(delta), { signal: args.signal });
    return text.trim();
}

export type EpisodePlanItem = { no: number; title: string; coreEvent: string; mainConflict: string; continuity: string; hook: string; targetSeconds: number };

export async function aiEpisodePlan(args: Base & { project: StudioProject; count: number; targetSeconds?: number }) {
    const config = textConfig(args.config, args.model);
    const system =
        "你是短剧策划。把故事大纲拆成分集规划，只输出一个 JSON 对象，不要 Markdown 围栏、不要解释。\n" +
        '结构：{"episodes":[{"no":1,"title":"第 1 集标题","coreEvent":"本集核心事件","mainConflict":"主要冲突","continuity":"与上集的承接","hook":"结尾钩子","targetSeconds":60}]}\n' +
        `要求：共 ${args.count} 集；每集写具体事件，不能写「待补充」；钩子必须有悬念；单集目标时长 ${args.targetSeconds ?? 60} 秒左右。` +
        projectHint(args.project);
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        { role: "user", content: args.project.bible.synopsis || args.project.bible.mainPlot || args.project.logline || "未填写故事大纲" },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => args.onDelta?.(delta), { signal: args.signal });
    const parsed = parseJsonObject(text);
    const episodes = Array.isArray(parsed.episodes) ? parsed.episodes : [];
    return episodes
        .map((item, index) => {
            const record = (item ?? {}) as Record<string, unknown>;
            return {
                no: num(record, "no", index + 1),
                title: field(record, "title") || `第 ${index + 1} 集`,
                coreEvent: field(record, "coreEvent"),
                mainConflict: field(record, "mainConflict"),
                continuity: field(record, "continuity"),
                hook: field(record, "hook"),
                targetSeconds: num(record, "targetSeconds", args.targetSeconds ?? 60),
            };
        })
        .filter((item) => item.coreEvent || item.mainConflict || item.hook);
}

export type EpisodeSplitResult = {
    characters: string[];
    scenes: { name: string; location: string; description: string; timeOfDay: string; weather: string }[];
    shots: Record<string, unknown>[];
};

export async function aiSplitEpisode(args: Base & { project: StudioProject; episode: StudioEpisode }) {
    const config = textConfig(args.config, args.model);
    const system =
        "你是短剧分镜导演。把剧本拆成「场景 + 镜头」结构，只输出一个 JSON 对象，不要解释、不要 Markdown 围栏。\n" +
        'JSON 结构：{"characters":["角色名"],"scenes":[{"name":"场景名","location":"地点与时间","description":"场景陈设与气氛","timeOfDay":"日/夜/黄昏","weather":"晴/雨/阴"}],"shots":[{"scene":"场景名","location":"地点与时间","characters":["出场人物"],"assetNames":["服装或道具"],"size":"远景/全景/中景/近景/特写","camera":"平视/俯拍/仰拍/过肩/主观视角","lens":"24mm 广角/35mm 人文/50mm 标准/85mm 中焦/135mm 长焦","movement":"固定/推/拉/摇/移/跟拍/手持","composition":"中心构图/三分构图/对称构图/留白构图/前景遮挡/低角度构图","lighting":"左侧主光/右侧主光/顶光/逆光轮廓/窗光/无主光","seconds":4-15,"action":"人物动作","expression":"面部表情","position":"画面中的位置","orientation":"人物朝向","environment":"环境细节","effects":"特效","line":"台词，无台词为空串","speaker":"说话人，旁白写 旁白","narration":"旁白文本，没有为空串","ambience":"环境声","sfx":"音效","description":"画面描述"}]}\n' +
        "规则：\n" +
        "1. 场景标题只转场次，不能当台词；\n" +
        "2. 叙述里的动作与台词必须分开；旁白单独写 narration，不要混进 line；\n" +
        "3. 一个镜头只表现一个主要视觉动作；场景切换单独成镜；\n" +
        "4. 每镜时长 4–15 秒，相邻镜头景别要有变化；\n" +
        "5. 人物与服装道具名称前后一致；position/orientation/environment 必须写具体。" +
        projectHint(args.project);
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        { role: "user", content: `剧本：\n${args.episode.script.text || "未填写剧本"}\n\n目标时长：${args.episode.targetSeconds} 秒` },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => args.onDelta?.(delta), { signal: args.signal });
    const parsed = parseJsonObject(text);
    return {
        characters: Array.isArray(parsed.characters) ? parsed.characters.map(String) : [],
        scenes: Array.isArray(parsed.scenes)
            ? parsed.scenes.map((item) => {
                  const record = (item ?? {}) as Record<string, unknown>;
                  return { name: field(record, "name"), location: field(record, "location"), description: field(record, "description"), timeOfDay: field(record, "timeOfDay"), weather: field(record, "weather") };
              })
            : [],
        shots: Array.isArray(parsed.shots) ? (parsed.shots as Record<string, unknown>[]) : [],
    } satisfies EpisodeSplitResult;
}

export type ShotFillResult = {
    description: string;
    action: string;
    expression: string;
    position: string;
    orientation: string;
    environment: string;
    camera: string;
    lens: string;
    movement: string;
    composition: string;
    lighting: string;
    effects: string;
    ambience: string;
    sfx: string;
};

export async function aiFillShot(args: Base & { project: StudioProject; episode: StudioEpisode; shot: StudioShot }) {
    const config = textConfig(args.config, args.model);
    const system =
        "你是短剧摄影指导。补全单个镜头的画面执行信息，只输出 JSON 对象，不改台词、不改人物绑定。\n" +
        '结构：{"description":"一句画面描述","action":"人物动作","expression":"面部表情","position":"人物在画面中的位置","orientation":"人物朝向","environment":"环境细节","camera":"平视/俯拍/仰拍/过肩/主观视角","lens":"24mm 广角/35mm 人文/50mm 标准/85mm 中焦/135mm 长焦","movement":"固定/推/拉/摇/移/跟拍/手持","composition":"中心构图/三分构图/对称构图/留白构图/前景遮挡/低角度构图","lighting":"左侧主光/右侧主光/顶光/逆光轮廓/窗光/无主光","effects":"特效","ambience":"环境声","sfx":"音效"}\n' +
        "要求：所有字段写具体可拍的内容，不要写「待定」。" +
        projectHint(args.project);
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        {
            role: "user",
            content: [
                `场景：${args.shot.sceneName}｜${args.shot.environment}`,
                `已有：景别 ${args.shot.size}，机位 ${args.shot.camera}，运镜 ${args.shot.movement}，构图 ${args.shot.composition}，光照 ${args.shot.lighting}`,
                `台词：${args.shot.line || "无"}｜旁白：${args.shot.narration || "无"}｜环境声：${args.shot.ambience || "无"}`,
                `人物：${args.shot.characterNames.join("、") || "无"}｜当前描述：${args.shot.description || "无"}`,
            ].join("\n"),
        },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => args.onDelta?.(delta), { signal: args.signal });
    const parsed = parseJsonObject(text);
    return {
        description: field(parsed, "description"),
        action: field(parsed, "action"),
        expression: field(parsed, "expression"),
        position: field(parsed, "position"),
        orientation: field(parsed, "orientation"),
        environment: field(parsed, "environment"),
        camera: field(parsed, "camera"),
        lens: field(parsed, "lens"),
        movement: field(parsed, "movement"),
        composition: field(parsed, "composition"),
        lighting: field(parsed, "lighting"),
        effects: field(parsed, "effects"),
        ambience: field(parsed, "ambience"),
        sfx: field(parsed, "sfx"),
    } satisfies ShotFillResult;
}

export async function aiContinuityReview(args: Base & { project: StudioProject; episode: StudioEpisode; shots: StudioShot[] }) {
    const config = textConfig(args.config, args.model);
    const system =
        "你是短剧导演。检查一组连续镜头的人物位置、朝向、动作、运动方向、空间关系、切换逻辑、画面风格与动作连续性。\n" +
        '只输出 JSON：{"issues":[{"level":"error|warning|info","message":"具体问题与怎么改"}]}。没有问题时 issues 为空数组。不要复述镜头内容。' +
        projectHint(args.project);
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        {
            role: "user",
            content: args.shots
                .map(
                    (shot) =>
                        `镜 ${shot.no}｜${shot.sceneName}｜${shot.size}｜${shot.camera}｜${shot.movement}｜${shot.lighting}｜位置 ${shot.position || "未填"}｜朝向 ${shot.orientation || "未填"}｜动作 ${shot.action || "未填"}｜台词 ${shot.line || "无"}`,
                )
                .join("\n"),
        },
    ];
    const text = await requestImageQuestion(config, messages, () => undefined, { signal: args.signal });
    const parsed = parseJsonObject(text);
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    return issues
        .map((item) => {
            const record = (item ?? {}) as Record<string, unknown>;
            const level = field(record, "level");
            return { level: level === "error" || level === "warning" ? (level as "error" | "warning") : ("info" as const), message: field(record, "message") };
        })
        .filter((item) => item.message);
}
