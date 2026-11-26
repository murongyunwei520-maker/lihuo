import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildSettingHint } from "@/lib/drama/settings";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
import type { DramaSettings } from "@/types/drama";

// 短剧工作室的 AI 能力：生成剧本、把剧本拆成分镜。
// 复用画布同一条文本生成链路（requestImageQuestion + buildGenerationConfig），
// 模型由页面从画布渠道里选中后传入，不另起一套请求逻辑。

type BaseArgs = {
    config: AiConfig;
    /** encodeChannelModel 编码值；空串表示跟随画布默认文本模型。 */
    model?: string;
    settings?: DramaSettings;
    onDelta?: (text: string) => void;
    signal?: AbortSignal;
};

type GenerateScriptArgs = BaseArgs & {
    premise: string;
    genre?: string;
    /** 01 步收集到的创作约束，会拼进提示词，不是只存在面板里。 */
    direction?: string;
    background?: string;
    requirement?: string;
    /** 02 步的故事大纲：有就作为硬约束。 */
    outline?: string;
};
type SplitScriptArgs = BaseArgs & { script: string };

function textConfig(config: AiConfig, model?: string): AiConfig {
    const base = buildGenerationConfig(config, undefined, "text");
    return model ? { ...base, model, textModel: model } : base;
}

/**
 * 一句话灵感 + 创作约束 → 故事大纲（含分集结构）。
 * 单独一步生成，是为了让 02 步能先定结构再写正文，而不是一次吐一大段。
 */
export async function generateOutline(args: GenerateScriptArgs): Promise<string> {
    const { model, settings, onDelta, signal } = args;
    const config = textConfig(args.config, model);
    const system =
        "你是一名短剧策划。根据灵感写一份可直接开拍的故事大纲。\n" +
        "结构固定为：一句话故事 / 主要人物（姓名 + 身份 + 目标）/ 分集大纲（每集一句主线 + 一句结尾钩子）。\n" +
        "只输出大纲正文，不要解释。" +
        briefOf(args) +
        (settings ? buildSettingHint(settings) : "");
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        { role: "user", content: `灵感：${args.premise}` },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => onDelta?.(delta), { signal });
    return text.trim();
}

/** 把 01 步的题材 / 方向 / 背景 / 要求 / 大纲拼成提示词片段。 */
function briefOf(args: GenerateScriptArgs): string {
    const lines = [
        args.genre?.trim() ? `题材：${args.genre.trim()}` : "",
        args.direction?.trim() ? `核心剧情方向：${args.direction.trim()}` : "",
        args.background?.trim() ? `故事背景：${args.background.trim()}` : "",
        args.requirement?.trim() ? `创作要求：${args.requirement.trim()}` : "",
        args.outline?.trim() ? `已确认的大纲（必须遵守）：\n${args.outline.trim()}` : "",
    ].filter(Boolean);
    return lines.length ? `\n\n${lines.join("\n")}` : "";
}

/**
 * 一句话灵感 → 剧本正文。
 * 要求模型只输出剧本纯文本，方便直接落到剧本面板。
 */
export async function generateScript(args: GenerateScriptArgs): Promise<string> {
    const { model, settings, onDelta, signal } = args;
    const config = textConfig(args.config, model);
    const system =
        "你是一名短剧编剧。根据用户给的一句话灵感，写一段适合竖屏短剧拍摄的分场剧本正文。\n" +
        "要求：\n" +
        "1. 用「场景：」标注每场戏的地点与时间；\n" +
        "2. 每场戏写清楚人物动作和台词，台词用引号括起来；\n" +
        "3. 节奏紧凑，镜头感强，单场戏控制在 20–40 秒可拍完；\n" +
        "4. 只输出剧本正文，不要解释、不要标题、不要分镜表。" +
        briefOf(args) +
        (settings ? buildSettingHint(settings) : "");
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        { role: "user", content: `灵感：${args.premise}` },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => onDelta?.(delta), { signal });
    return text.trim();
}

/**
 * 剧本 → 分镜结构。
 * 要求模型返回 JSON 数组，前端 normalizeAiShots 容错解析；解析失败会抛错，调用方降级到规则拆分。
 */
export async function splitScriptToShots(args: SplitScriptArgs): Promise<{ shots: unknown; characters: string[]; scenes: string[] }> {
    const { script, model, settings, onDelta, signal } = args;
    const config = textConfig(args.config, model);
    const system =
        "你是一名短剧分镜导演。把用户给出的剧本拆成分镜列表，只输出一个 JSON 对象，不要解释、不要 Markdown 围栏。\n" +
        'JSON 结构：{"characters":["角色名"],"scenes":["场景名"],"shots":[{"scene":"场景名","location":"地点与时间","characters":["出场人物"],"assetNames":["需要绑定的资产名"],"size":"远景/全景/中景/近景/特写","camera":"平视/俯拍/仰拍/过肩/主观视角","move":"固定/推/拉/摇/移/跟拍/手持","composition":"中心构图/三分构图/对称构图/留白构图/前景遮挡","light":"left/right/none","seconds":4-15,"action":"人物动作","expression":"面部表情","line":"台词，无台词为空串","speaker":"说话人，旁白写 旁白","prompt":"画面描述","sound":"环境声或音效","note":"情绪备注"}]}\n' +
        "规则：\n" +
        "1. 场景标题（例如「场景一：老宅正堂，夜，内。」）只能转成场次，绝不能当台词或画面；\n" +
        "2. 「某某放下茶盏，说：……」这类叙述里的动作与台词必须分开：动作写 action，引号内写 line，说话人写 speaker；\n" +
        "3. 旁白用 speaker=\"旁白\" 并保留原文；没有台词时 line 必须是空串，不得把动作写进 line；\n" +
        "4. 一个镜头只表现一个清晰的主要视觉动作，不要把一个段落里多件事塞进同一镜；\n" +
        "5. 按剧情节奏拆镜，不要机械地一行一镜；场景切换必须单独成镜并把 scene/location 写清楚；\n" +
        "6. 每镜时长 4–15 秒，动作复杂或台词长的给更长时长；\n" +
        "7. characters/assetNames 只填实际出场的人物、场景、服装或道具，名称前后一致；\n" +
        "8. 相邻镜头景别要变化，避免连续同一景别。" +
        (settings ? buildSettingHint(settings) : "");
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        { role: "user", content: `剧本：\n${script}` },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => onDelta?.(delta), { signal });
    return parseSplitJson(text);
}

/**
 * 单镜补全：把镜头已有信息（场景/景别/光位/台词/资产）写成一句可出图的画面描述。
 * 只返回一句提示词，不返回解释，直接写回 shot.prompt。
 */
export async function generateShotDetails(args: {
    config: AiConfig;
    settings: DramaSettings;
    model?: string;
    shot: { scene: string; size: string; camera?: string; move: string; composition?: string; light: string; line: string; action?: string; expression?: string; sound?: string; prompt: string };
    assets: { name: string; kind: string; description: string }[];
}): Promise<string> {
    const config = textConfig(args.config, args.model);
    const { shot, settings } = args;
    const system =
        "你是短剧摄影指导。根据镜头信息写一句中文画面描述，用于文生图 / 图生视频提示词。\n" +
        "要求：一句话，包含主体、动作、环境、光线、景别与构图；不要台词、不要分镜编号、不要解释。" +
        "只补充画面描述本身，不得改动台词、人物绑定与摄影参数。" +
        buildSettingHint(settings);
    const assetText = args.assets.map((asset) => `${asset.name}（${asset.kind}${asset.description ? `：${asset.description}` : ""}）`).join("、");
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        {
            role: "user",
            content: `场景：${shot.scene}\n景别：${shot.size}\n机位：${shot.camera ?? "平视"}\n运镜：${shot.move}\n构图：${shot.composition ?? "未指定"}\n光位：${shot.light}\n台词：${shot.line || "无"}\n人物动作：${shot.action ?? "未指定"}\n面部表情：${shot.expression ?? "未指定"}\n环境声：${shot.sound ?? "未指定"}\n已有描述：${shot.prompt || "无"}\n出场资产：${assetText || "无"}`,
        },
    ];
    const text = await requestImageQuestion(config, messages, () => undefined);
    return text.trim().replace(/^["「]|["」]$/g, "");
}

/** 从模型输出里抠出 JSON 对象：去掉可能的 ```json 围栏和前后杂散文字。 */
function parseJsonObject(text: string): Record<string, unknown> {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("模型没有返回有效的 JSON");
    }
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object") throw new Error("模型返回的 JSON 不是对象");
    return parsed as Record<string, unknown>;
}

/** 从模型输出里抠出 JSON：去掉可能的 ```json 围栏和前后杂散文字。 */
function parseSplitJson(text: string): { shots: unknown; characters: string[]; scenes: string[] } {
    const parsed = parseJsonObject(text);
    return {
        shots: parsed.shots ?? [],
        characters: Array.isArray(parsed.characters) ? parsed.characters.map(String) : [],
        scenes: Array.isArray(parsed.scenes) ? parsed.scenes.map(String) : [],
    };
}

export type BibleDraftResult = {
    bible: { world: string; background: string; relations: string; visual: string; era: string; palette: string; material: string; negative: string };
    characters: { name: string; description: string }[];
    scenes: { name: string; description: string }[];
};

/**
 * 03 步：根据前两步已有的信息（灵感 / 大纲 / 剧本）补全世界观、故事背景、人物关系与视觉规范。
 * 只做「从已有材料里提取并整理」，不新增剧情；输出 JSON 供调用方合并进设定集与资产卡。
 */
export async function deriveBibleDraft(args: {
    config: AiConfig;
    model?: string;
    settings?: DramaSettings;
    script: string;
    /** 已经认出的人物 / 场景名，要求模型只围绕这些写，不要新造。 */
    cast: string[];
    scenes: string[];
    onDelta?: (text: string) => void;
    signal?: AbortSignal;
}): Promise<BibleDraftResult> {
    const config = textConfig(args.config, args.model);
    const system =
        "你是短剧的剧本策划。根据用户给的剧本与已有设定，整理出一份可直接开拍的设定集，只输出一个 JSON 对象，不要解释、不要 Markdown 围栏。\n" +
        'JSON 结构：{"world":"世界观","background":"故事开始前的背景与主角处境","relations":"人物关系，一行一条","visual":"画面视觉规范：色调/光线/镜头质感/服化道基准","era":"时代与地域","palette":"色彩基调","material":"材质质感","negative":"全片负面提示词","characters":[{"name":"角色名","description":"年龄/身份/性格/外观/服装，60字内"}],"scenes":[{"name":"场景名","description":"地点/时间/陈设/光线，40字内"}]}\n' +
        "规则：\n" +
        "1. 只能从已有材料里提取和归纳，不得新增剧本里没有的人物、场景或情节；\n" +
        "2. characters 必须覆盖给定的人物名单；名单为空时从剧本里提取真正出场的人物，不要写没出现过的人；\n" +
        "3. scenes 只用给定的场景名单；名单为空时用剧本里的场景标题，描述里补上时间与光线；\n" +
        "4. 每个字段都要写具体可执行的内容，不要写「待补充」「详见剧本」这类占位；\n" +
        "5. 全部用中文。" +
        (args.settings ? buildSettingHint(args.settings) : "");
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        {
            role: "user",
            content: [
                args.cast.length ? `已知人物：${args.cast.join("、")}` : "",
                args.scenes.length ? `已知场景：${args.scenes.join("、")}` : "",
                `剧本：\n${args.script.slice(0, 6000)}`,
            ]
                .filter(Boolean)
                .join("\n\n"),
        },
    ];
    const text = await requestImageQuestion(config, messages, (delta) => args.onDelta?.(delta), { signal: args.signal });
    const parsed = parseJsonObject(text);
    const field = (key: string) => (typeof parsed[key] === "string" ? String(parsed[key]).trim() : "");
    const list = (value: unknown): { name: string; description: string }[] => {
        if (!Array.isArray(value)) return [];
        return value
            .map((item) => {
                if (!item || typeof item !== "object") return null;
                const record = item as Record<string, unknown>;
                const name = typeof record.name === "string" ? record.name.trim() : "";
                if (!name) return null;
                const description = typeof record.description === "string" ? record.description.trim() : "";
                return { name, description };
            })
            .filter((item): item is { name: string; description: string } => Boolean(item));
    };
    return {
        bible: {
            world: field("world"),
            background: field("background"),
            relations: field("relations"),
            visual: field("visual"),
            era: field("era"),
            palette: field("palette"),
            material: field("material"),
            negative: field("negative"),
        },
        characters: list(parsed.characters),
        scenes: list(parsed.scenes),
    };
}
