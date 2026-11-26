// 阶段 3 提示词：分层上下文，只给当前集/当前场景必要信息。
// 模型输出只允许结构化草稿；不读取原著全文，不自行重建全剧规划，不把 2B 警告自动标记为已解决。

import type { StudioProject } from "@/types/studio";
import type { StudioAdaptationHandoff, StudioEpisodePlan } from "@/types/studio-adaptation";
import type { StudioProductionShot, StudioScriptDocument, StudioScriptScene } from "@/types/studio-production";
import { estimateSceneDuration } from "./production-engine";

export const STAGE3_SCRIPT_PROMPT_VERSION = "stage3-script-v1";
export const STAGE3_STORYBOARD_PROMPT_VERSION = "stage3-storyboard-v6";

export type ProductionPrompt = {
    system: string;
    user: string;
    promptVersion: string;
    inputChars: number;
};

export type ProductionPromptContext = {
    project: StudioProject;
    handoff: StudioAdaptationHandoff;
    plan: StudioEpisodePlan;
    targetSeconds: number;
    previousPlan?: StudioEpisodePlan;
    previousScript?: StudioScriptDocument;
    issues: { level: string; message: string; suggestion: string }[];
};

const line = (label: string, value: string | undefined | number) => (value !== undefined && String(value).trim() ? `- ${label}：${String(value).trim()}` : "");

function head(project: StudioProject, handoff: StudioAdaptationHandoff, plan: StudioEpisodePlan) {
    return [
        `【全剧约束】`,
        line("项目", project.title),
        line("视觉风格", project.visualStyle.mainStyle),
        line("核心 logline", handoff.blueprint?.logline ?? project.logline),
        line("核心主题", handoff.blueprint?.theme),
        line("核心冲突", handoff.blueprint?.centralConflict),
        line("结局方向", handoff.blueprint?.ending),
        `【当前集规划】`,
        line("集数", `第 ${plan.episodeNumber} 集`),
        line("标题", plan.episodeTitle),
        line("logline", plan.episodeLogline),
        line("概要", plan.episodeSynopsis),
        line("戏剧目标", plan.dramaticGoal),
        line("开场钩子", plan.openingHook),
        line("核心冲突", plan.mainConflict),
        line("高潮", plan.climax),
        line("结尾钩子", plan.endingHook),
        line("人物", plan.characterAppearances.map((item) => `${item.name}（${item.role}，${item.summary}）`).join("；")),
        line("人物状态", plan.characterStates.map((state) => `${state.name}：位置 ${state.location || "未定"}；知道 ${state.knows.join("、") || "无"}；不知道 ${state.unknown.join("、") || "无"}；关系 ${state.relationships}；身体 ${state.physicalState}；在场 ${state.present ? "是" : "否"}`).join("\n")),
        line("关系变化", plan.characterRelationshipChanges.map((item) => `${item.fromName}→${item.toName}：${item.change}`).join("；")),
        line("地点", plan.locations.map((item) => `${item.name}（${item.purpose}）`).join("；")),
        line("情感推进", plan.emotionalProgression.join(" → ")),
        line("伏笔埋设", plan.foreshadowingIntroduced.join("；")),
        line("伏笔推进", plan.foreshadowingAdvanced.join("；")),
        line("伏笔回收", plan.foreshadowingResolved.join("；")),
        line("连续性依赖", plan.continuityDependencies.join("；")),
        line("本集来源", `episodePlanId=${plan.episodeId}；sourceBlueprintVersion=${handoff.blueprintVersion}；handoffSnapshotId=${handoff.snapshotId}`),
    ]
        .filter(Boolean)
        .join("\n");
}

function issueContext(issues: ProductionPromptContext["issues"]) {
    if (!issues.length) return "";
    return `\n【2B 未处理连续性事项（只读，不得声称已解决）】\n${issues
        .map((issue) => `- [${issue.level}] ${issue.message}${issue.suggestion ? `；建议：${issue.suggestion}` : ""}`)
        .join("\n")}`;
}

function previousContext(context: ProductionPromptContext) {
    if (!context.previousPlan) return "";
    return `\n【上一集必要承接】\n- 上一集 ${context.previousPlan.episodeNumber} 结尾：${context.previousPlan.endingHook || "未填写"}\n- 上一集概要：${context.previousPlan.episodeSynopsis || "未填写"}${
        context.previousScript
            ? `\n- 上一集剧本最后一段场景：${context.previousScript.scenes.at(-1)?.sceneTitle ?? ""}（只用于承接，不得复制整段剧情）`
            : ""
    }`;
}

export function scriptPrompt(context: ProductionPromptContext): ProductionPrompt {
    const system = [
        "你是短剧正式分集编剧。只输出一个 JSON 对象，不要 Markdown 围栏、不要解释、不要在 JSON 前后写任何字。",
        'JSON 结构：{"title":"集标题","logline":"一句话故事","synopsis":"本集概要","scenes":[{"sceneTitle":"场景标题","locationName":"地点名","locationVariant":"日景/夜景/雨天等变体","timeOfDay":"日/夜/黄昏","environment":"空间、陈设、光线、声音","charactersPresent":["人物名"],"props":["道具名"],"scenePurpose":"这场戏的戏剧目的","conflict":"场内冲突","action":"人物行动和关键动作","dialogueBlocks":[{"speaker":"人物名","text":"台词","delivery":"表演方式","emotion":"情绪","subtext":"潜台词","linkedAction":"伴随动作","timing":"节奏"}],"transitionIn":"如何进入本场","transitionOut":"如何离开本场","continuityNotes":"本场连续性说明"}]}',
        "硬性要求：",
        "1. 只写当前集，不写下一集，不写分镜表。场景数量按目标时长自然安排，通常 3-8 场。",
        "2. 每个场景必须有进入、人物行动、信息揭示、矛盾或情绪变化、冲突结果、退出或转场；不要机械套同一模板。",
        "3. 对白必须体现不同人物的身份、语言习惯、目标和潜台词；禁止无意义寒暄、重复信息、为凑时长重复表达。",
        "4. 不得擅自改变关键人物动机、原著重要事实、人物生死和核心关系；没有依据的补充只能作为草稿，并写进 continuityNotes，不能声称是原著事实。",
        "5. 对白说话人必须使用给定人物名；不要新造主要人物、地点或道具。场景地点必须来自当前集规划地点或既有场景资产。",
        "6. 2B 的地点移动 warning 只表示需要写转场/赶路/时间跳跃；你可以在剧本 action 或 transitionIn/Out 中提出合理衔接，但不能在输出中声称 warning 已被解决，也不能编造原著没有的移动事实。",
        "7. 目标时长是约束，不是把中文字符数直接换算成秒数；靠对白长度、动作、转场、停顿和环境镜头共同控制。",
        "8. 对白要能被演员执行；动作要能被导演拆镜；不要把抽象情绪当成动作。",
    ].join("\n");
    const user = [head(context.project, context.handoff, context.plan), previousContext(context), issueContext(context.issues), `【目标时长】${context.targetSeconds} 秒。请写出可直接进入分镜的草稿；不确定的事实写进 continuityNotes，不要伪造。`].join("\n");
    return { system, user, promptVersion: STAGE3_SCRIPT_PROMPT_VERSION, inputChars: system.length + user.length };
}

export function scriptSceneRegeneratePrompt(context: ProductionPromptContext, scene: StudioScriptScene, instruction: string): ProductionPrompt {
    const system = [
        "你是短剧编剧，只重写指定的一场戏。只输出一个 JSON 对象，不要解释、不要 Markdown 围栏。",
        'JSON 结构：{"sceneTitle":"","locationName":"","locationVariant":"","timeOfDay":"","environment":"","charactersPresent":[],"props":[],"scenePurpose":"","conflict":"","action":"","dialogueBlocks":[{"speaker":"","text":"","delivery":"","emotion":"","subtext":"","linkedAction":"","timing":""}],"transitionIn":"","transitionOut":"","continuityNotes":""}',
        "必须保留本场在整集中的叙事功能、人物身份、地点和已知事实；不能改写其他场景，不能引入原著没有的关键事实。",
    ].join("\n");
    const user = [
        head(context.project, context.handoff, context.plan),
        issueContext(context.issues),
        `【待重写场景】\n${JSON.stringify(scene, null, 0)}`,
        `【修改意见】${instruction || "在不改变剧情事实的前提下，提升对白潜台词、动作可拍性和场景衔接。"}`,
        "只返回这一场的 JSON，不要返回整集。",
    ].join("\n");
    return { system, user, promptVersion: `${STAGE3_SCRIPT_PROMPT_VERSION}-scene`, inputChars: system.length + user.length };
}

export function scriptDialogueRegeneratePrompt(context: ProductionPromptContext, scene: StudioScriptScene, instruction: string): ProductionPrompt {
    const system = [
        "你是短剧台词编剧，只重写指定场景的对白块。只输出一个 JSON 对象，不要解释、不要 Markdown 围栏。",
        'JSON 结构：{"dialogueBlocks":[{"speaker":"人物名","text":"台词","delivery":"表演方式","emotion":"情绪","subtext":"潜台词","linkedAction":"伴随动作","timing":"节奏"}]}',
        "硬性要求：",
        "1. 只能改对白块，不得返回场景、动作、环境、人物、道具、转场或其他场景。",
        "2. 保留本场叙事功能、人物关系、已知事实和原剧情结果；不得新造人物或关键事实。",
        "3. 说话人只能使用本场已有的人物名；台词要可被演员执行，避免无意义寒暄和重复信息。",
    ].join("\n");
    const user = [
        head(context.project, context.handoff, context.plan),
        issueContext(context.issues),
        `【目标场景】\n${JSON.stringify({ sceneTitle: scene.sceneTitle, charactersPresent: scene.charactersPresent, scenePurpose: scene.scenePurpose, conflict: scene.conflict, action: scene.action, dialogueBlocks: scene.dialogueBlocks }, null, 0)}`,
        `【修改意见】${instruction || "只提升对白潜台词、节奏和人物语言差异，不改变剧情事实与其他场景。"}`,
        "只返回 dialogueBlocks，不要返回其他字段。",
    ].join("\n");
    return { system, user, promptVersion: `${STAGE3_SCRIPT_PROMPT_VERSION}-dialogue`, inputChars: system.length + user.length };
}

export function storyboardScenePrompt(context: ProductionPromptContext, script: StudioScriptDocument, scene: StudioScriptScene): ProductionPrompt {
    const sceneBudget = estimateSceneDuration(scene);
    const system = [
        "你是短剧分镜导演。只输出一个 JSON 对象，不要 Markdown 围栏、不要解释。",
        'JSON 结构：{"groups":[{"groupNumber":1,"sharedLayout":"空间布局与人物初始位置","characterStartPositions":[{"name":"人物名","position":"画面位置","orientation":"朝向","eyeline":"视线"}],"cameraAxis":"摄影机轴线与人物关系","propStates":"道具状态","timeOfDay":"时间","lighting":"光线","weather":"天气","continuityRules":["规则"],"shots":[{"shotNumber":1,"duration":4,"shotSize":"景别","cameraPosition":"机位","cameraAngle":"角度","lens":"镜头","cameraMovement":"运镜","composition":"构图","foreground":"前景","midground":"中景层","background":"背景","characterBlocking":"人物站位、朝向、重心、动作起点","eyeline":"视线方向","action":"一个主要视觉动作","facialExpression":"眼睑、眉、唇、下颌、呼吸等微表情","emotion":"情绪","charactersPresent":["实际入镜人物名"],"props":["实际入镜道具名"],"dialogue":[{"speaker":"人物名","text":"台词","delivery":"表演方式","emotion":"情绪"}],"voiceOver":"旁白","soundEffects":"环境声/动作声/道具声","backgroundMusic":"音乐意图或留白","lighting":"光线","environment":"环境细节","continuityRules":["本镜连续性规则"],"imagePrompt":"只描述画面，不执行生成","videoPrompt":"只描述运动和时长，不执行生成"}]}]}',
        "硬性要求：",
        "1. 只处理指定场景，不生成其他场景；镜头必须能追溯到剧本场景、人物、动作和对白。",
        "2. 每场只输出 1 个 ShotGroup、正好 2 个镜头（最多 3 个，绝不允许 4 个以上）；本场镜头 duration 相加必须等于本场预算上下 10%，单镜 2–8 秒；不要把每句对白都拆成一个镜头，优先保留信息转折、冲突升级和关键动作。",
        "3. 同一 ShotGroup 内共享空间布局、人物初始位置、相对距离、朝向、视线、摄影机轴线、运动方向、道具状态、时间与光照。只有场景/时间变化或设计过的轴线转换才新建组。",
        "4. 相邻镜头不能无原因让人物从左跳到右，不能无原因越轴；动作要写清发起者、方向、轨迹、接触位置、受力与结束状态。",
        "5. 重要镜头写具体微表情与肢体动作，不能只写“震惊/愤怒/悲伤”。",
        "6. 不要每个镜头都推拉摇移；运镜必须服务叙事。",
        "7. imagePrompt / videoPrompt 只保存文本提示词和约束，不执行图片或视频生成。",
        "8. 如果剧本中没有某条信息，不要为了让分镜好看而新造剧情事实。",
        "9. 单镜文字必须精炼：action、characterBlocking、facialExpression 各不超过 50 个汉字，soundEffects / backgroundMusic / composition 各写一句；严禁输出空字段，也不要重复剧本整段原文。",
        "10. 每镜的 charactersPresent 只列这一镜真正入镜的人物；props 只列这一镜真正可见或正在被使用的道具。不要为了省事把全场景人物和道具都塞进每一镜。",
    ].join("\n");
    const user = [
        head(context.project, context.handoff, context.plan),
        `【正式剧本场景】\n${JSON.stringify(scene, null, 0)}`,
        issueContext(context.issues),
        `【场景预算】本场约 ${sceneBudget} 秒（按对白、动作、转场、停顿与环境镜头估算）。第 ${scene.sceneNumber} 场 / 共 ${script.scenes.length} 场；整集目标 ${context.targetSeconds} 秒。请只返回本场分镜：1 个 ShotGroup、正好 2 个镜头（最多 3 个），镜头 duration 相加控制在 ${Math.max(1, Math.round(sceneBudget * 0.9))}–${Math.round(sceneBudget * 1.1)} 秒；单镜 2–8 秒。`,
    ].join("\n");
    return { system, user, promptVersion: `${STAGE3_STORYBOARD_PROMPT_VERSION}-scene`, inputChars: system.length + user.length };
}

export function storyboardShotPrompt(context: ProductionPromptContext, script: StudioScriptDocument, scene: StudioScriptScene, shot: StudioProductionShot): ProductionPrompt {
    const system = [
        "你是短剧分镜师，只重写一个镜头。只输出 JSON 对象，不要解释、不要 Markdown 围栏。",
        "保留所在 ShotGroup 的空间布局、轴线、人物站位和道具状态，只改进这一个镜头的镜头语言、表演和声音设计。",
        'JSON 结构：{"duration":4,"shotSize":"","cameraPosition":"","cameraAngle":"","lens":"","cameraMovement":"","composition":"","foreground":"","midground":"","background":"","characterBlocking":"","eyeline":"","action":"","facialExpression":"","emotion":"","dialogue":[],"voiceOver":"","soundEffects":"","backgroundMusic":"","lighting":"","environment":"","continuityRules":[],"imagePrompt":"","videoPrompt":""}',
    ].join("\n");
    const user = [
        head(context.project, context.handoff, context.plan),
        `【正式剧本场景】\n${JSON.stringify(scene, null, 0)}`,
        `【待重写镜头】\n${JSON.stringify(shot, null, 0)}`,
        "只返回这一镜的 JSON，不要返回整组或整场。",
    ].join("\n");
    return { system, user, promptVersion: `${STAGE3_STORYBOARD_PROMPT_VERSION}-shot`, inputChars: system.length + user.length };
}
