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
        "你是一名短剧分镜导演。把用户给出的剧本拆成分镜列表，并只输出一个 JSON 对象，不要输出任何解释或 Markdown 代码块标记。\n" +
        'JSON 结构：{"characters":["角色名"],"scenes":["场景名"],"shots":[{"scene":"场景名","size":"景别(远景/全景/中景/近景/特写)","move":"运镜(固定/推/拉/摇/移/跟拍/手持)","light":"光位(left/right/none)","seconds":时长秒数(4-15),"line":"台词，无台词为空串","prompt":"画面描述","note":"情绪或备注"}]}\n' +
        "要求：\n" +
        "1. 每个镜头时长在 4 到 15 秒之间；\n" +
        "2. 台词与画面描述分开；\n" +
        "3. 景别、运镜只从括号里的词里选；\n" +
        "4. 相邻镜头景别要有变化，避免连续长镜头。" +
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
    shot: { scene: string; size: string; move: string; light: string; line: string; prompt: string };
    assets: { name: string; kind: string; description: string }[];
}): Promise<string> {
    const config = textConfig(args.config, args.model);
    const { shot, settings } = args;
    const system =
        "你是短剧摄影指导。根据镜头信息写一句中文画面描述，用于文生图 / 图生视频提示词。\n" +
        "要求：一句话，包含主体、动作、环境、光线、景别与构图；不要台词、不要分镜编号、不要解释。" +
        buildSettingHint(settings);
    const assetText = args.assets.map((asset) => `${asset.name}（${asset.kind}${asset.description ? `：${asset.description}` : ""}）`).join("、");
    const messages: AiTextMessage[] = [
        { role: "system", content: system },
        {
            role: "user",
            content: `场景：${shot.scene}\n景别：${shot.size}\n运镜：${shot.move}\n光位：${shot.light}\n台词：${shot.line || "无"}\n已有描述：${shot.prompt || "无"}\n出场资产：${assetText || "无"}`,
        },
    ];
    const text = await requestImageQuestion(config, messages, () => undefined);
    return text.trim().replace(/^["「]|["」]$/g, "");
}

/** 从模型输出里抠出 JSON：去掉可能的 ```json 围栏和前后杂散文字。 */
function parseSplitJson(text: string): { shots: unknown; characters: string[]; scenes: string[] } {
    const cleaned = text
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("模型没有返回有效的分镜 JSON");
    }
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return {
        shots: parsed.shots ?? [],
        characters: Array.isArray(parsed.characters) ? parsed.characters.map(String) : [],
        scenes: Array.isArray(parsed.scenes) ? parsed.scenes.map(String) : [],
    };
}
