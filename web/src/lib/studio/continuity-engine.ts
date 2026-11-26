// Stage 4C 分镜连续性检查：只读正式分镜与剧本，输出带证据的确定性结果。
// 规则先读显式 continuity 字段；旧数据缺少结构化字段时只记信息不足，不猜测机位或伪造空间。

import type {
    StudioContinuityActionPhase,
    StudioContinuityCameraSide,
    StudioContinuityCheckReport,
    StudioContinuityConfidence,
    StudioContinuityDepth,
    StudioContinuityDirection,
    StudioContinuityException,
    StudioContinuityExceptionType,
    StudioContinuityFinding,
    StudioContinuityGap,
    StudioContinuityPropState,
    StudioContinuityRuleDefinition,
    StudioContinuityScreenSide,
    StudioContinuityScopeType,
    StudioContinuitySpaceCharacter,
    StudioContinuityCharacterState,
    StudioProductionCheckLevel,
    StudioProductionShot,
    StudioScriptDocument,
    StudioShotContinuityState,
    StudioShotGroup,
    StudioShotGroupContinuityState,
    StudioStoryboardDocument,
} from "@/types/studio-production";

export type StudioContinuityScope = {
    type: StudioContinuityScopeType;
    id?: string;
};

/** 所有规则都声明检查范围、输入字段、默认等级和判断依据；UI 与报告直接读取这份目录。 */
export const STUDIO_CONTINUITY_RULES: StudioContinuityRuleDefinition[] = [
    { id: "continuity.position_jump", title: "人物空间位置跳变", scope: "group", fields: ["characterBlocking", "continuity.space.characters[].screenSide", "continuity.space.characters[].depth"], defaultSeverity: "error", description: "同一连续段落内人物左右侧或景深无解释改变；建立镜头、转身、转场等显式例外除外。" },
    { id: "continuity.position_distance", title: "人物距离突变", scope: "group", fields: ["continuity.space.characters[].distance"], defaultSeverity: "warning", description: "同一连续段落内人物靠近 / 远离镜头无运动或调度解释。" },
    { id: "continuity.movement_reversal", title: "运动方向反转", scope: "group", fields: ["continuity.space.movementDirection", "action", "characterBlocking"], defaultSeverity: "warning", description: "前后镜头运动方向相反且没有转身、停止、遮挡或转场依据。" },
    { id: "continuity.eyeline_mismatch", title: "视线目标与朝向不匹配", scope: "group", fields: ["continuity.space.characters[].eyelineTargetId", "continuity.space.characters[].facing", "characterBlocking"], defaultSeverity: "error", description: "人物视线目标在画面另一侧，但人物朝向或反打方向指向错误一侧。" },
    { id: "continuity.axis_cross", title: "摄影机无依据越轴", scope: "group", fields: ["continuity.axis.cameraSide", "continuity.space.cameraSide", "cameraAxis"], defaultSeverity: "error", description: "同一镜头组内相机侧反转，且未标记跨轴、环绕、主观镜头或建立镜头。" },
    { id: "continuity.character_identity_conflict", title: "人物身份绑定冲突", scope: "scene", fields: ["characterBindings[].characterId", "characterBindings[].name"], defaultSeverity: "error", description: "镜头绑定姓名与全剧人物注册表不一致，或同一姓名对应不同 characterId；保留原始绑定，不自动归一化。" },
    { id: "continuity.character_outfit_change", title: "服装 / 外观无解释变化", scope: "scene", fields: ["outfitBindings[].outfitId", "continuity.characters[].outfitId", "continuity.characters[].hairstyle", "continuity.characters[].accessories"], defaultSeverity: "warning", description: "同一连续段落内服装变体、发型或配饰改变，且无换装、时间跳跃或转场例外。" },
    { id: "continuity.character_injury_change", title: "伤势 / 血迹无解释消失", scope: "scene", fields: ["continuity.characters[].injured", "continuity.characters[].blood"], defaultSeverity: "warning", description: "已建立的伤势或血迹在后续镜头消失，且无治疗、时间跳跃或转场解释；新增受伤不判错。" },
    { id: "continuity.character_weapon_change", title: "武器持有状态改变", scope: "scene", fields: ["continuity.characters[].weaponPropId"], defaultSeverity: "warning", description: "同一角色在连续镜头中换了武器或武器缺失，且无交接、拾取、收起或剧情例外。" },
    { id: "continuity.character_state_change", title: "姿态 / 情绪无解释变化", scope: "group", fields: ["continuity.characters[].posture", "continuity.characters[].emotion"], defaultSeverity: "suggestion", description: "同一镜头组内已显式记录姿态或情绪突变，没有动作或剪辑依据；只作专业提示，不判为确定错误。" },
    { id: "continuity.prop_holder_change", title: "道具持有者无解释改变", scope: "group", fields: ["continuity.props[].holderCharacterId", "continuity.props[].transferredTo", "action"], defaultSeverity: "error", description: "同一道具从一人转到另一人，但没有交接、拾起、掉落或使用动作。" },
    { id: "continuity.prop_hand_change", title: "道具换手未交代", scope: "group", fields: ["continuity.props[].hand", "action"], defaultSeverity: "warning", description: "同一道具在左右手之间切换，且没有换手、交接或掉落动作。" },
    { id: "continuity.prop_state_change", title: "道具状态无解释变化", scope: "group", fields: ["continuity.props[].state", "continuity.props[].damaged", "continuity.props[].dropped", "continuity.props[].pickedUp", "continuity.props[].used", "continuity.props[].form"], defaultSeverity: "warning", description: "道具损坏、掉落、使用或形态状态改变，缺少动作过程或剧情解释。" },
    { id: "continuity.prop_disappear", title: "道具无解释消失", scope: "group", fields: ["continuity.props[].visible", "propBindings", "action"], defaultSeverity: "error", description: "显式标记道具仍应存在，却在同一连续段落中消失、不可见或形态改变；合理收起 / 使用 / 转场除外。" },
    { id: "continuity.scene_time_change", title: "昼夜 / 时间状态跳变", scope: "scene", fields: ["timeOfDay", "continuity.environment.timeOfDay", "continuity.environment.transition"], defaultSeverity: "error", description: "同一连续段落内从白天变夜晚或相反，且没有时间跳跃、转场、回忆或幻境例外。" },
    { id: "continuity.scene_weather_change", title: "天气 / 光照无解释变化", scope: "scene", fields: ["weather", "lighting", "continuity.environment.weather", "continuity.environment.lighting"], defaultSeverity: "warning", description: "同一连续段落内天气、光照或地面状态突变，且没有环境变化或转场依据。" },
    { id: "continuity.scene_environment_reset", title: "环境破坏状态恢复", scope: "scene", fields: ["continuity.environment.damage", "continuity.environment.ground"], defaultSeverity: "warning", description: "建筑、地面、烟尘、火焰或积水状态无解释恢复；明确修复、时间跳跃或幻境除外。" },
    { id: "continuity.action_cause_missing", title: "动作原因 / 接触缺失", scope: "group", fields: ["continuity.action.phase", "continuity.action.targetId", "continuity.action.causeShotId", "action"], defaultSeverity: "warning", description: "出现反应或结果，却没有攻击、接触、受力或可接受的剪辑省略依据。" },
    { id: "continuity.action_force_mismatch", title: "受力方向不一致", scope: "group", fields: ["continuity.action.forceDirection", "continuity.action.reactionDirection"], defaultSeverity: "warning", description: "受力方向与反应位移方向明显不一致。" },
];

const RULE_BY_ID = new Map(STUDIO_CONTINUITY_RULES.map((rule) => [rule.id, rule]));

const DIRECTION_LABEL: Record<StudioContinuityDirection, string> = {
    left_to_right: "从左向右",
    right_to_left: "从右向左",
    toward_camera: "向镜头",
    away_from_camera: "远离镜头",
    forward: "向前",
    backward: "向后",
    up: "向上",
    down: "向下",
    clockwise: "顺时针",
    counterclockwise: "逆时针",
    toward_target: "朝向目标",
    turn: "转身",
    stop: "停止",
    fall: "跌倒",
    rise: "起身",
    jump: "跳跃",
    knockback: "被击退",
    teleport: "瞬移",
    static: "静止",
    unknown: "未知",
};

const PHASE_LABEL: Record<StudioContinuityActionPhase, string> = {
    start: "起势",
    process: "过程",
    contact: "接触",
    reaction: "反应",
    result: "结果",
    recovery: "恢复",
    unknown: "未知",
};

type PairKind = "group" | "group_boundary" | "scene_boundary";

type CharacterDraft = StudioContinuitySpaceCharacter & {
    outfitId?: string;
    hairstyle?: string;
    accessories?: string[];
    injured?: boolean;
    blood?: boolean;
    /** 字符串表示持有武器；null 表示镜头明确空手 / 武器已收起；undefined 表示未记录，不能当作武器消失。 */
    weaponPropId?: string | null;
    posture?: string;
    emotion?: string;
    actionPhase?: StudioContinuityActionPhase;
    facingTargetId?: string;
};

type NormalizedCharacter = CharacterDraft & {
    name: string;
};

type NormalizedProp = StudioContinuityPropState & {
    name: string;
    explicit: boolean;
    listed: boolean;
};

type NormalizedMovement = {
    characterId?: string;
    direction?: StudioContinuityDirection;
    source: "explicit" | "blocking" | "action" | "ambiguous" | "unknown";
    evidence: string;
};

type CharacterBindingIssue = {
    characterId: string;
    name: string;
    fieldPath: string;
    evidence: string;
    reason: string;
    severity: StudioProductionCheckLevel;
    confidence: StudioContinuityConfidence;
};

type CharacterBindingGap = {
    fieldPath: string;
    reason: string;
};

type NormalizedAction = {
    phase: StudioContinuityActionPhase;
    actorId?: string;
    targetId?: string;
    actionType?: string;
    contactPoint?: string;
    forceDirection?: StudioContinuityDirection;
    reactionDirection?: StudioContinuityDirection;
    interrupted?: boolean;
    causeShotId?: string;
    explicit: boolean;
};

type NormalizedEnvironment = {
    timeOfDay: string;
    weather: string;
    lighting: string;
    ground: string;
    damage: string;
    visibility: string;
    transition: string;
};

type NormalizedShot = {
    shot: StudioProductionShot;
    group?: StudioShotGroup;
    groupContinuity?: StudioShotGroupContinuityState;
    continuity?: StudioShotContinuityState;
    characters: NormalizedCharacter[];
    props: NormalizedProp[];
    environment: NormalizedEnvironment;
    action: NormalizedAction;
    movement: NormalizedMovement;
    exceptions: StudioContinuityException[];
    cameraSide: StudioContinuityCameraSide;
    bindingIssues: CharacterBindingIssue[];
    bindingGaps: CharacterBindingGap[];
};

type Pair = {
    previous: NormalizedShot;
    current: NormalizedShot;
    kind: PairKind;
    sameScene: boolean;
    groupId: string;
    sceneId: string;
};

type BuildContext = {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    scope: StudioContinuityScope;
    pairIds: Set<string>;
    normalize: (shot: StudioProductionShot, group?: StudioShotGroup) => NormalizedShot;
};

const normalizeScope = (scope?: StudioContinuityScope): StudioContinuityScope => scope ?? { type: "episode" };

function stableHash(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function checkIdentity(document: StudioStoryboardDocument, scope: StudioContinuityScope, findings: StudioContinuityFinding[], gaps: StudioContinuityGap[]) {
    return `continuity-check-${stableHash(JSON.stringify({
        episodeId: document.episodeId,
        storyboardVersion: document.storyboardVersion,
        scope,
        findings: findings.map((item) => [item.ruleId, item.severity, item.shotIds, item.fieldPath, item.evidence]),
        gaps: gaps.map((item) => [item.ruleId, item.shotIds, item.fieldPath, item.reason]),
    }))}`;
}

const pairKey = (previous: string, current: string) => `${previous}>${current}`;

function ruleLevel(ruleId: string): StudioProductionCheckLevel {
    return RULE_BY_ID.get(ruleId)?.defaultSeverity ?? "warning";
}

function hasException(normalized: NormalizedShot, types: StudioContinuityExceptionType[]): boolean {
    return normalized.exceptions.some((exception) => types.includes(exception.type));
}

function exceptionText(normalized: NormalizedShot, types: StudioContinuityExceptionType[]) {
    const exception = normalized.exceptions.find((item) => types.includes(item.type));
    return exception ? `${exception.type}${exception.reason ? `：${exception.reason}` : ""}` : "";
}

function hasTransition(normalized: NormalizedShot, types: string[]): boolean {
    return types.includes(normalized.environment.transition);
}

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WEAPON_ACQUISITION_VERB = /拔出|拔刀|拔剑|拔枪|抽刀|抽剑|抽枪|抽出|取出|拾取|拾起|捡起|捡到|接过|接住|召出|召唤|亮出|现出|举起|握紧|拿到|夺得|夺过|抢过/;
const WEAPON_OBJECT = /武器|兵器|短刀|长刀|长剑|刀|剑|枪|匕首|斧|锤|棍|戟|矛|弓|箭|盾|鞭/;
const NON_WEAPON_OBJECT = /手臂|胳膊|拳头|手掌|手指|手腕|刀柄|剑柄|枪柄|刀鞘|剑鞘|枪套|话/;

function nameOccurrences(text: string, names: string[]) {
    const found: Array<{ name: string; index: number }> = [];
    for (const name of names) {
        if (!name) continue;
        const regex = new RegExp(escapeRegex(name), "g");
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            found.push({ name, index: match.index });
            if (match[0].length === 0) regex.lastIndex += 1;
        }
    }
    return found.sort((left, right) => left.index - right.index || right.name.length - left.name.length);
}

/**
 * 取得动作必须能落在这个角色身上：动作主体是当前人物，动作对象是武器。
 * 只看到“抬起手臂 / 握紧拳头”或别的人物拾取武器，都不能消除当前人物的信息不足。
 */
function weaponAcquisitionForCharacter(
    shot: StudioProductionShot,
    character: NormalizedCharacter,
    peers: NormalizedCharacter[],
) {
    const text = [shot.action, shot.characterBlocking].filter(Boolean).join("；");
    if (!text) return false;
    const names = [...new Set([character.name, ...peers.map((item) => item.name)].filter(Boolean))]
        .sort((left, right) => right.length - left.length);
    const clauses = text.split(/[，。；;！？!?\n]+/).map((item) => item.trim()).filter(Boolean);

    for (const clause of clauses) {
        const verb = WEAPON_ACQUISITION_VERB.exec(clause);
        if (!verb || verb.index === undefined) continue;
        const verbIndex = verb.index;
        const verbText = verb[0];
        const before = clause.slice(0, verbIndex);
        const after = clause.slice(verbIndex + verbText.length);
        const occurrences = nameOccurrences(before, names);
        if (!occurrences.length) continue;

        const passiveIndex = before.lastIndexOf("被");
        let subject: string | undefined;
        if (passiveIndex >= 0) {
            const passiveNames = nameOccurrences(before.slice(passiveIndex + 1), names);
            if (passiveNames.length === 1) subject = passiveNames[0].name;
        } else {
            const first = occurrences[0];
            const lead = before.slice(0, first.index).trim();
            const allowedLead = /^(?:随后|然后|接着|立即|立刻|突然|猛地|又|再|先|随即|转身|弯腰|伸手|一把|一手|抬手|反手|顺势|终于|当即)?$/;
            if (allowedLead.test(lead)) {
                const intervening = occurrences.filter((item) => item.index > first.index);
                const between = before.slice(first.index + first.name.length);
                // “从沈砚手中接过”里的沈砚是来源，不是动作主体；其他插入人物按主体不明处理。
                const ablative = intervening.length === 1 && /^从/.test(between) && /手中|手里|那边|处/.test(between);
                if (!intervening.length || ablative) subject = first.name;
            }
        }
        if (subject !== character.name) continue;

        const objectBefore = /(?:把|将)([^，。；]*)$/.exec(before)?.[1] ?? "";
        const passiveObject = passiveIndex >= 0 ? before : "";
        const objectText = `${objectBefore}；${passiveObject}；${after}`;
        const verbItselfIsWeapon = /^(?:拔刀|拔剑|拔枪|拔武器|抽刀|抽剑|抽枪)$/.test(verbText);
        if (!verbItselfIsWeapon) {
            if (!WEAPON_OBJECT.test(objectText) || NON_WEAPON_OBJECT.test(objectText)) continue;
        }
        return true;
    }
    return false;
}

type ScriptRegistry = {
    names: Map<string, Set<string>>;
    ids: Map<string, Set<string>>;
    canonicalName: Map<string, string>;
};

function buildScriptRegistry(script?: StudioScriptDocument): ScriptRegistry {
    const names = new Map<string, Set<string>>();
    const ids = new Map<string, Set<string>>();
    const canonicalName = new Map<string, string>();
    for (const binding of script?.characterBindings ?? []) {
        if (!binding.name || !binding.characterId) continue;
        names.set(binding.name, new Set([...(names.get(binding.name) ?? []), binding.characterId]));
        ids.set(binding.characterId, new Set([...(ids.get(binding.characterId) ?? []), binding.name]));
        if (!canonicalName.has(binding.characterId)) canonicalName.set(binding.characterId, binding.name);
    }
    return { names, ids, canonicalName };
}

/** 只读当前镜头的正式人物绑定；全剧注册表不能替镜头“添加”人物。 */
function shotNameMap(shot: StudioProductionShot) {
    const map = new Map<string, string>();
    for (const binding of shot.characterBindings) {
        if (binding.name && binding.characterId) map.set(binding.name, binding.characterId);
    }
    return map;
}

function shotText(shot: StudioProductionShot) {
    return [
        shot.characterBlocking,
        shot.action,
        shot.eyeline,
        shot.foreground,
        shot.midground,
        shot.background,
        shot.environment,
        shot.facialExpression,
        shot.emotion,
        shot.voiceOver,
        ...shot.dialogue.map((line) => line.text),
    ].filter(Boolean).join("；");
}

function characterBindingConflicts(shot: StudioProductionShot, registry: ScriptRegistry): CharacterBindingIssue[] {
    const issues: CharacterBindingIssue[] = [];
    const seenNames = new Map<string, string>();
    for (const binding of shot.characterBindings) {
        if (!binding.name) continue;
        if (!binding.characterId) {
            continue;
        }
        const previousId = seenNames.get(binding.name);
        if (previousId && previousId !== binding.characterId) {
            issues.push({
                characterId: binding.characterId,
                name: binding.name,
                fieldPath: "characterBindings[].characterId",
                evidence: `当前镜头同一姓名「${binding.name}」同时绑定 ${previousId} 与 ${binding.characterId}。`,
                reason: "同一镜头内同名人物出现多个角色 ID，身份无法确认。",
                severity: "error",
                confidence: "high",
            });
        }
        seenNames.set(binding.name, binding.characterId);
        const registeredIds = registry.names.get(binding.name);
        if (registeredIds && registeredIds.size && !registeredIds.has(binding.characterId)) {
            issues.push({
                characterId: binding.characterId,
                name: binding.name,
                fieldPath: `characterBindings[${binding.characterId}].characterId`,
                evidence: `镜头「${binding.name}」绑定 ${binding.characterId}；全剧注册表同名 ID 为 ${[...registeredIds].join(" / ")}。`,
                reason: "镜头人物绑定与全剧注册表不一致；不能把同名人物自动归一化为注册表 ID。",
                severity: "error",
                confidence: "high",
            });
        }
        const registeredNames = registry.ids.get(binding.characterId);
        if (registeredNames && registeredNames.size && !registeredNames.has(binding.name)) {
            issues.push({
                characterId: binding.characterId,
                name: binding.name,
                fieldPath: `characterBindings[${binding.characterId}].name`,
                evidence: `镜头人物名「${binding.name}」绑定 ${binding.characterId}；全剧注册表该 ID 的名称为 ${[...registeredNames].join(" / ")}。`,
                reason: "人物名称与角色 ID 不对应，可能是错误绑定或未经登记的别名。",
                severity: "warning",
                confidence: "high",
            });
        }
    }
    return issues;
}

function characterBindingGaps(shot: StudioProductionShot, registry: ScriptRegistry): CharacterBindingGap[] {
    const gaps: CharacterBindingGap[] = [];
    const correctlyBoundIds = new Set<string>();
    for (const binding of shot.characterBindings) {
        if (!binding.characterId) {
            gaps.push({
                fieldPath: "characterBindings[].characterId",
                reason: `当前镜头人物「${binding.name || "未命名"}」缺少 characterId，不能确认身份与资产绑定。`,
            });
        } else if (binding.name && registry.ids.get(binding.characterId)?.has(binding.name)) {
            correctlyBoundIds.add(binding.characterId);
        }
        if (!binding.name) {
            gaps.push({
                fieldPath: "characterBindings[].name",
                reason: `当前镜头人物 ${binding.characterId} 缺少姓名，不能与全剧注册表核对。`,
            });
        }
    }
    // 只扫描当前镜头文本里确实出现的人物，并排除已经正确绑定（姓名与 ID 都在注册表内）的人物。
    // 已绑定一个人物不代表文本里的其他人物也已完成绑定。
    const mentioned = mentionedNameEntries(shotText(shot), [...registry.names.keys()]);
    for (const [name] of mentioned) {
        const registeredIds = registry.names.get(name);
        if (!registeredIds) continue;
        for (const characterId of registeredIds) {
            if (correctlyBoundIds.has(characterId)) continue;
            gaps.push({
                fieldPath: "characterBindings",
                reason: `镜头文本提到「${name}」（${characterId}），但当前镜头没有正确绑定这个人物；不能把注册表人物自动加入镜头。`,
            });
        }
    }
    return gaps;
}

/** 按最长名称优先切分文本，避免“林月”同时被识别成“林”；返回实际出现的人物名。 */
function mentionedNameEntries(text: string, names: string[]): Array<[string, number]> {
    if (!text) return [];
    const candidates = [...new Set(names.filter(Boolean))].sort((left, right) => right.length - left.length);
    if (!candidates.length) return [];
    const counts = new Map<string, number>();
    const regex = new RegExp(candidates.map(escapeRegex).join("|"), "g");
    for (const match of text.matchAll(regex)) {
        const name = match[0];
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()];
}

function findName(text: string, names: string[]): string | undefined {
    return mentionedNameEntries(text, names)
        .map(([name]) => name)
        .sort((left, right) => right.length - left.length)[0];
}

function nameOccursInSegment(segment: string, name: string, allNames: string[]) {
    return mentionedNameEntries(segment, allNames).some(([mentioned]) => mentioned === name);
}

function uniqueNames(values: Array<string | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((left, right) => right.length - left.length);
}

function parseSide(value: string | undefined): StudioContinuityScreenSide | undefined {
    if (!value) return undefined;
    if (value.includes("左")) return "left";
    if (value.includes("右")) return "right";
    if (value.includes("中") || value.includes("正")) return "center";
    return undefined;
}

function parseDepth(value: string | undefined): StudioContinuityDepth | undefined {
    if (!value) return undefined;
    if (value.includes("前景") || value.includes("前层")) return "foreground";
    if (value.includes("中景") || value.includes("中层")) return "midground";
    if (value.includes("后景") || value.includes("背景") || value.includes("后层")) return "background";
    return undefined;
}

function parseDistance(value: string | undefined) {
    if (!value) return undefined;
    if (value.includes("靠近镜头") || value.includes("贴近镜头") || value.includes("近处")) return "near" as const;
    if (value.includes("远离镜头") || value.includes("远处") || value.includes("远端")) return "far" as const;
    return undefined;
}

export function parseDirection(value: string | undefined): StudioContinuityDirection | undefined {
    if (!value) return undefined;
    if (value.includes("从左向右") || value.includes("自左向右") || value.includes("由左至右") || value.includes("左向右")) return "left_to_right";
    if (value.includes("从右向左") || value.includes("自右向左") || value.includes("由右至左") || value.includes("右向左")) return "right_to_left";
    if (/(?:向左|朝左|往左)(?:跑|冲|奔|移动|走|飞|退|掠|扑|滑|滚)/.test(value)) return "right_to_left";
    if (/(?:向右|朝右|往右)(?:跑|冲|奔|移动|走|飞|退|掠|扑|滑|滚)/.test(value)) return "left_to_right";
    if (value.includes("顺时针") || value.includes("顺时钟")) return "clockwise";
    if (value.includes("逆时针") || value.includes("反时针")) return "counterclockwise";
    if (value.includes("向镜头") || value.includes("冲向镜头") || value.includes("逼近镜头")) return "toward_camera";
    if (value.includes("远离镜头") || value.includes("背向镜头")) return "away_from_camera";
    // 受击位移必须先于普通方向词识别；主动“后退”只表示向后移动，不能冒充 knockback。
    if (value.includes("被击退") || value.includes("击退") || value.includes("震退") || value.includes("打退") || value.includes("逼退") || value.includes("踉跄") || value.includes("趔趄")) return "knockback";
    if (value.includes("向前")) return "forward";
    if (value.includes("向后")) return "backward";
    if (value.includes("向上") || value.includes("朝上")) return "up";
    if (value.includes("向下") || value.includes("朝下")) return "down";
    if (value.includes("朝向目标") || value.includes("向目标") || value.includes("冲向目标")) return "toward_target";
    if (value.includes("转身") || value.includes("扭身")) return "turn";
    if (value.includes("停住") || value.includes("停下") || value.includes("站定")) return "stop";
    if (value.includes("跌倒") || value.includes("倒下") || value.includes("摔倒")) return "fall";
    if (value.includes("起身") || value.includes("站起") || value.includes("爬起")) return "rise";
    if (value.includes("跃") || value.includes("跳起")) return "jump";
    if (value.includes("后退") || value.includes("后撤") || value.includes("退后")) return "backward";
    if (value.includes("瞬移") || value.includes("闪现到")) return "teleport";
    return undefined;
}

/** 动作语义按“具体反应 → 结果 → 接触 → 准备 → 过程 → 恢复”的顺序识别。 */
export function parseActionPhase(value: string | undefined): StudioContinuityActionPhase | undefined {
    if (!value) return undefined;
    // 明确承受者 + 击飞 / 打飞，表达的是结果，不是攻击者接触。
    if (/(?:对手|敌人|目标|对方|被击者)(?:被|遭)(?:击飞|打飞|击倒|踢飞)/.test(value)) return "result";
    // 受击反应必须先于“击中”，否则“被击中”会被宽泛的接触词吞掉。
    // 踉跄 / 闷哼 / 吃痛是明确的身体受击反应；普通主动后退不在其中，避免把调度动作误判为受击。
    if (/被击中|被打中|受击|挨打|受到冲击|被震退|被击飞|中拳|中剑|被砍中|被刺中|踉跄|趔趄|闷哼|痛呼|吃痛|吐血|喷血/.test(value)) return "reaction";
    if (/倒地|跪地|飞出|失去平衡|撞上墙壁|撞墙|倒下|跪倒|昏倒|死亡|击飞出去/.test(value)) return "result";
    // “击中 / 打中 / 命中 / 接触目标”表示攻击者与目标的接触。
    if (/击中|打中|踢中|刺中|砍中|命中|撞击|接触目标|接触/.test(value)) return "contact";
    if (/蓄力|抬手|握拳|举剑|举刀|瞄准|准备|起势|拔剑|拔刀/.test(value)) return "start";
    if (/挥拳|出拳|挥剑|挥刀|劈|刺|砍|踢|冲|扑|攻击|袭向|奔跑|跳跃|推动|转身/.test(value)) return "process";
    if (/起身|稳住身体|重新站立|调整姿势|爬起|站起/.test(value)) return "recovery";
    return undefined;
}

function parsePropHand(text: string): NormalizedProp["hand"] | undefined {
    if (text.includes("双手")) return "both";
    if (text.includes("左手")) return "left";
    if (text.includes("右手")) return "right";
    if (text.includes("手中") || text.includes("手里")) return "unknown";
    return undefined;
}

function propDescriptor(text: string, propName: string) {
    const index = text.indexOf(propName);
    if (index < 0) return "";
    return text.slice(Math.max(0, index - 14), Math.min(text.length, index + propName.length + 18));
}

function deriveCharacterPositions(shot: StudioProductionShot, group: StudioShotGroup | undefined, names: Map<string, string>): Map<string, CharacterDraft> {
    const allNames = [...names.keys()];
    const result = new Map<string, StudioContinuitySpaceCharacter>();
    const inputs = [
        { text: shot.characterBlocking, weight: 2 },
        { text: group?.sharedLayout, weight: 1 },
    ];
    for (const input of inputs) {
        if (!input.text) continue;
        for (const [name, characterId] of names) {
            const escaped = escapeRegex(name);
            const segments = input.text.split(/[，。；;、]/).filter((segment) => nameOccursInSegment(segment, name, allNames));
            for (const segment of segments) {
                const after = segment.match(new RegExp(`${escaped}(?:站在|位于|处于|坐在|蹲在|立在|靠在|在|站在画面|站在屏幕)?(?:画面|屏幕)?(?:的)?(左|右|中|正)(?:侧|边|方|前景|中景|后景|景)?`));
                const before = segment.match(new RegExp(`(?:画面|屏幕)?(左|右|中|正)(?:侧|边|方)(?:的)?${escaped}`));
                const side = parseSide(after?.[1] ?? before?.[1]);
                const depth = parseDepth(segment.slice(Math.max(0, segment.indexOf(name) - 4), segment.indexOf(name) + name.length + 10));
                const distance = parseDistance(segment);
                const existing = result.get(characterId);
                if (!existing || (side && !existing.screenSide) || (depth && !existing.depth) || (distance && !existing.distance) || input.weight > 1) {
                    result.set(characterId, {
                        ...existing,
                        characterId,
                        screenSide: side ?? existing?.screenSide,
                        depth: depth ?? existing?.depth,
                        distance: distance ?? existing?.distance,
                    });
                }
            }
        }
    }
    for (const [name, characterId] of names) {
        if (shot.foreground.includes(name)) result.set(characterId, { ...result.get(characterId), characterId, depth: "foreground" });
        if (shot.midground.includes(name)) result.set(characterId, { ...result.get(characterId), characterId, depth: result.get(characterId)?.depth === "foreground" ? "foreground" : "midground" });
        if (shot.background.includes(name)) {
            const current = result.get(characterId);
            if (!current?.depth) result.set(characterId, { ...current, characterId, depth: "background" });
        }
    }
    return result;
}

function deriveEyeline(shot: StudioProductionShot, characters: Map<string, CharacterDraft>, names: Map<string, string>) {
    const text = [shot.eyeline, shot.characterBlocking].filter(Boolean).join("；");
    for (const [name, characterId] of names) {
        const current = characters.get(characterId) ?? { characterId };
        const escaped = escapeRegex(name);
        const look = text.match(new RegExp(`${escaped}(?:的)?(?:视线|目光|眼神)?(?:看向|望向|盯着|注视着|投向|落向)([^，。；;、]{1,12})`));
        const face = text.match(new RegExp(`${escaped}(?:面向|朝向|转向|对着)([^，。；;、]{1,12})`));
        const targetName = findName(look?.[1] ?? "", [...names.keys()]);
        const faceName = findName(face?.[1] ?? "", [...names.keys()]) ?? (look?.[1]?.includes("对方") && names.size === 2 ? [...names.keys()].find((item) => item !== name) : undefined);
        const counterpartId = names.size === 2 ? [...names.entries()].find(([candidate]) => candidate !== name)?.[1] : undefined;
        const targetId = targetName ? names.get(targetName) : look?.[1]?.includes("对方") ? counterpartId : undefined;
        const explicit = shot.continuity?.space?.characters?.find((item) => item.characterId === characterId);
        const facingTargetId = explicit?.eyelineTargetId ?? (faceName ? names.get(faceName) : undefined);
        const facing = explicit?.facing ?? current.facing;
        characters.set(characterId, {
            ...current,
            characterId,
            eyelineTargetId: explicit?.eyelineTargetId ?? targetId ?? current.eyelineTargetId,
            facing,
            facingTargetId: explicit?.facingTargetId ?? facingTargetId ?? current.facingTargetId,
        });
    }
}

function deriveOutfit(shot: StudioProductionShot, characterId: string): { outfitId?: string; hairstyle?: string; accessories?: string[]; injured?: boolean; blood?: boolean; weaponPropId?: string | null; posture?: string; emotion?: string; actionPhase?: StudioContinuityActionPhase } {
    const explicit = shot.continuity?.characters?.find((item) => item.characterId === characterId);
    const binding = shot.characterBindings.find((item) => item.characterId === characterId);
    const outfit = shot.outfitBindings.find((item) => item.characterId === characterId);
    const text = [shot.action, shot.characterBlocking, shot.environment].join("；");
    const injured = explicit?.injured ?? (/受伤|伤口|流血|血迹|绷带/.test(text) ? true : undefined);
    return {
        outfitId: explicit?.outfitId ?? outfit?.outfitId ?? binding?.outfitId,
        hairstyle: explicit?.hairstyle,
        accessories: explicit?.accessories,
        injured,
        blood: explicit?.blood,
        weaponPropId: explicit?.weaponPropId,
        posture: explicit?.posture,
        emotion: explicit?.emotion,
        actionPhase: explicit?.actionPhase,
    };
}

function deriveProps(shot: StudioProductionShot): NormalizedProp[] {
    const explicit = new Map((shot.continuity?.props ?? []).map((item) => [item.propId, item]));
    return shot.propBindings.map((binding) => {
        const item = explicit.get(binding.propId);
        const descriptor = propDescriptor([binding.state, shot.action, shot.characterBlocking].filter(Boolean).join("；"), binding.name);
        const hand = item?.hand ?? parsePropHand(descriptor);
        const visible = item?.visible ?? !/收起|消失|不见|熄灭/.test(descriptor);
        return {
            propId: binding.propId,
            name: binding.name,
            holderCharacterId: item?.holderCharacterId,
            hand,
            state: item?.state ?? binding.state,
            visible,
            damaged: item?.damaged,
            dropped: item?.dropped ?? /掉落|落地|脱手/.test(descriptor),
            pickedUp: item?.pickedUp,
            transferredTo: item?.transferredTo,
            used: item?.used,
            form: item?.form,
            explicit: Boolean(item),
            listed: true,
        };
    });
}

function normalizeTimeOfDay(value: string) {
    return value.trim().replace(/夜晚|夜间|晚上/g, "夜").replace(/白天|日间/g, "日").replace(/天$/g, "");
}

function normalizeWeather(value: string) {
    return value.trim().replace(/天气$/g, "").replace(/天$/g, "");
}

function deriveEnvironment(shot: StudioProductionShot, group: StudioShotGroup | undefined, script: StudioScriptDocument | undefined): NormalizedEnvironment {
    const groupContinuity = group?.continuity?.environment;
    const shotContinuity = shot.continuity?.environment;
    const scene = script?.scenes.find((item) => item.sceneId === shot.sceneId);
    const location = script?.locationBindings.find((item) => item.locationId === shot.sceneBindings.locationId);
    const transition = shotContinuity?.transition ?? group?.continuity?.transition;
    return {
        timeOfDay: normalizeTimeOfDay(shotContinuity?.timeOfDay ?? groupContinuity?.timeOfDay ?? group?.timeOfDay ?? scene?.timeOfDay ?? location?.timeOfDay ?? ""),
        weather: normalizeWeather(shotContinuity?.weather ?? groupContinuity?.weather ?? group?.weather ?? location?.weather ?? ""),
        lighting: shotContinuity?.lighting ?? groupContinuity?.lighting ?? group?.lighting ?? shot.lighting ?? "",
        ground: shotContinuity?.ground ?? groupContinuity?.ground ?? "",
        damage: shotContinuity?.damage ?? groupContinuity?.damage ?? "",
        visibility: shotContinuity?.visibility ?? groupContinuity?.visibility ?? "",
        transition: transition ?? "",
    };
}

function deriveAction(shot: StudioProductionShot, names: Map<string, string>): NormalizedAction {
    const explicit = shot.continuity?.action;
    const text = [shot.action, shot.characterBlocking].filter(Boolean).join("；");
    const characterPhase = shot.continuity?.characters?.length === 1 ? shot.continuity.characters[0].actionPhase : undefined;
    const phase = explicit?.phase ?? parseActionPhase(text) ?? characterPhase ?? "unknown";
    const actionType = explicit?.actionType;
    const actorId = explicit?.actorId;
    let targetId = explicit?.targetId;
    if (!targetId) {
        const targetName = findName(text, [...names.keys()].filter((name) => text.indexOf(name) > 0));
        if (targetName && actorId) targetId = names.get(targetName);
    }
    return {
        phase,
        actorId,
        targetId,
        actionType,
        contactPoint: explicit?.contactPoint,
        forceDirection: explicit?.forceDirection,
        reactionDirection: explicit?.reactionDirection,
        interrupted: explicit?.interrupted,
        causeShotId: explicit?.causeShotId,
        explicit: Boolean(explicit),
    };
}

function movementActor(text: string, direction: StudioContinuityDirection, names: Map<string, string>): { characterId?: string; ambiguousNames: string[] } {
    const mentioned = mentionedNameEntries(text, [...names.keys()]);
    if (mentioned.length === 1) return { characterId: names.get(mentioned[0][0]), ambiguousNames: [] };
    if (mentioned.length < 2) return { characterId: undefined, ambiguousNames: [] };
    // 多人物同场时只接受方向词同一分句内的唯一人物作为动作主体；
    // 同一分句出现两个以上人物，或方向词旁边没有人物时，不擅自认定执行者。
    const clauses = text.split(/[，。；;、]/).filter(Boolean);
    const directionClauses = clauses.filter((clause) => parseDirection(clause) === direction);
    const clauseNames = new Set<string>();
    for (const clause of directionClauses) {
        for (const [name] of mentionedNameEntries(clause, [...names.keys()])) clauseNames.add(name);
    }
    if (directionClauses.length && clauseNames.size === 1) {
        const name = [...clauseNames][0];
        return { characterId: names.get(name), ambiguousNames: [] };
    }
    return { characterId: undefined, ambiguousNames: mentioned.map(([name]) => name) };
}

function deriveMovement(shot: StudioProductionShot, names: Map<string, string>): NormalizedMovement {
    const explicit = shot.continuity?.space;
    const explicitDirection = explicit?.movementDirection;
    if (explicitDirection) {
        const actor = explicit?.movementCharacterId ?? movementActor([shot.action, shot.characterBlocking].filter(Boolean).join("；"), explicitDirection, names).characterId;
        return {
            characterId: actor,
            direction: explicitDirection,
            source: actor ? "explicit" : names.size > 1 ? "ambiguous" : "explicit",
            evidence: `continuity.space.movementDirection=${explicitDirection}${!actor && names.size > 1 ? "；缺少 movementCharacterId，多人物主体不明确" : ""}`,
        };
    }
    const blocking = parseDirection(shot.characterBlocking);
    const action = parseDirection(shot.action);
    const direction = blocking ?? action;
    if (!direction) return { source: "unknown", evidence: "" };
    const source = blocking ? "blocking" : "action";
    const text = blocking ? shot.characterBlocking : shot.action;
    const actor = movementActor(text, direction, names);
    if (actor.ambiguousNames.length) {
        return {
            characterId: undefined,
            direction,
            source: "ambiguous",
            evidence: `${source === "blocking" ? "characterBlocking" : "action"}=${text}；出现多个人物（${actor.ambiguousNames.join("、")}），无法确认动作执行者`,
        };
    }
    return {
        characterId: actor.characterId,
        direction,
        source,
        evidence: `${source === "blocking" ? "characterBlocking" : "action"}=${text}`,
    };
}

function normalizeShot(shot: StudioProductionShot, group: StudioShotGroup | undefined, script?: StudioScriptDocument): NormalizedShot {
    const registry = buildScriptRegistry(script);
    const names = shotNameMap(shot);
    const characters = deriveCharacterPositions(shot, group, names);
    const explicitSpaceCharacters = new Map((shot.continuity?.space?.characters ?? []).map((item) => [item.characterId, item]));
    for (const [characterId, item] of explicitSpaceCharacters) {
        if (!characterId) continue;
        characters.set(characterId, {
            ...(characters.get(characterId) ?? { characterId }),
            ...item,
            characterId,
        });
    }
    const explicitCharacters = new Map((shot.continuity?.characters ?? []).map((item) => [item.characterId, item]));
    for (const [characterId, item] of explicitCharacters) {
        if (!characterId) continue;
        characters.set(characterId, { ...(characters.get(characterId) ?? { characterId }), ...item, characterId });
    }
    deriveEyeline(shot, characters, names);
    for (const binding of shot.characterBindings) {
        if (!binding.characterId) continue;
        const current = characters.get(binding.characterId) ?? { characterId: binding.characterId };
        characters.set(binding.characterId, { ...current, ...deriveOutfit(shot, binding.characterId) });
    }
    const bindingIssues = characterBindingConflicts(shot, registry);
    const bindingGaps = characterBindingGaps(shot, registry);
    const normalizedCharacters: NormalizedCharacter[] = [...characters.values()].map((character) => {
        const name = [...names.entries()].find(([, id]) => id === character.characterId)?.[0] ?? registry.canonicalName.get(character.characterId) ?? character.characterId;
        return {
            ...character,
            ...deriveOutfit(shot, character.characterId),
            name,
        };
    });
    return {
        shot,
        group,
        groupContinuity: group?.continuity,
        continuity: shot.continuity,
        characters: normalizedCharacters,
        props: deriveProps(shot),
        environment: deriveEnvironment(shot, group, script),
        action: deriveAction(shot, names),
        movement: deriveMovement(shot, names),
        exceptions: [...(shot.continuity?.exceptions ?? []), ...(group?.continuity?.exceptions ?? [])],
        cameraSide: shot.continuity?.space?.cameraSide ?? "unknown",
        bindingIssues,
        bindingGaps,
    };
}

function buildPairs(document: StudioStoryboardDocument, normalize: BuildContext["normalize"]): Pair[] {
    const pairs: Pair[] = [];
    const groupById = new Map(document.groups.map((group) => [group.shotGroupId, group]));
    const shotById = new Map(document.shots.map((shot) => [shot.shotId, shot]));
    const groups = [...document.groups].sort((left, right) => left.groupNumber - right.groupNumber);
    for (const group of groups) {
        const shots = group.shotIds.map((shotId) => shotById.get(shotId)).filter((shot): shot is StudioProductionShot => Boolean(shot)).sort((left, right) => left.shotNumber - right.shotNumber);
        for (let index = 1; index < shots.length; index += 1) {
            pairs.push({
                previous: normalize(shots[index - 1], group),
                current: normalize(shots[index], group),
                kind: "group",
                sameScene: shots[index - 1].sceneId === shots[index].sceneId,
                groupId: group.shotGroupId,
                sceneId: group.sceneId,
            });
        }
    }
    for (let index = 1; index < groups.length; index += 1) {
        const previousGroup = groups[index - 1];
        const currentGroup = groups[index];
        if (previousGroup.sceneId !== currentGroup.sceneId) continue;
        const previousShot = previousGroup.shotIds.map((shotId) => shotById.get(shotId)).filter((shot): shot is StudioProductionShot => Boolean(shot)).sort((left, right) => left.shotNumber - right.shotNumber).at(-1);
        const currentShot = currentGroup.shotIds.map((shotId) => shotById.get(shotId)).filter((shot): shot is StudioProductionShot => Boolean(shot)).sort((left, right) => left.shotNumber - right.shotNumber)[0];
        if (!previousShot || !currentShot) continue;
        pairs.push({
            previous: normalize(previousShot, previousGroup),
            current: normalize(currentShot, currentGroup),
            kind: "group_boundary",
            sameScene: true,
            groupId: currentGroup.shotGroupId,
            sceneId: currentGroup.sceneId,
        });
    }
    const sceneGroups = new Map<string, StudioShotGroup[]>();
    for (const group of groups) sceneGroups.set(group.sceneId, [...(sceneGroups.get(group.sceneId) ?? []), group]);
    const orderedScenes = [...sceneGroups.values()].sort((left, right) => left[0].groupNumber - right[0].groupNumber);
    for (let index = 1; index < orderedScenes.length; index += 1) {
        const previousGroup = orderedScenes[index - 1].at(-1);
        const currentGroup = orderedScenes[index][0];
        if (!previousGroup || !currentGroup) continue;
        const previousShot = previousGroup.shotIds.map((shotId) => shotById.get(shotId)).filter((shot): shot is StudioProductionShot => Boolean(shot)).sort((left, right) => left.shotNumber - right.shotNumber).at(-1);
        const currentShot = currentGroup.shotIds.map((shotId) => shotById.get(shotId)).filter((shot): shot is StudioProductionShot => Boolean(shot)).sort((left, right) => left.shotNumber - right.shotNumber)[0];
        if (!previousShot || !currentShot) continue;
        pairs.push({
            previous: normalize(previousShot, previousGroup),
            current: normalize(currentShot, currentGroup),
            kind: "scene_boundary",
            sameScene: false,
            groupId: currentGroup.shotGroupId,
            sceneId: currentGroup.sceneId,
        });
    }
    return pairs;
}

function pairInScope(pair: Pair, scope: StudioContinuityScope) {
    if (scope.type === "episode") return true;
    if (scope.type === "shot") return pair.previous.shot.shotId === scope.id || pair.current.shot.shotId === scope.id;
    if (scope.type === "group") {
        const previousGroup = pair.previous.shot.shotGroupId;
        const currentGroup = pair.current.shot.shotGroupId;
        return previousGroup === scope.id || currentGroup === scope.id;
    }
    if (scope.type === "scene") return pair.previous.shot.sceneId === scope.id || pair.current.shot.sceneId === scope.id;
    return false;
}

function shotInScope(shot: StudioProductionShot, scope: StudioContinuityScope) {
    if (scope.type === "episode") return true;
    if (!scope.id) return false;
    if (scope.type === "shot") return shot.shotId === scope.id;
    if (scope.type === "group") return shot.shotGroupId === scope.id;
    return shot.sceneId === scope.id;
}

function shotLabel(shot: StudioProductionShot) {
    return `镜头 ${String(shot.shotNumber).padStart(2, "0")}`;
}

function sideLabel(side?: StudioContinuityScreenSide) {
    return side === "left" ? "左" : side === "right" ? "右" : side === "center" ? "中" : side === "off_screen" ? "画外" : "未标注";
}

function depthLabel(depth?: StudioContinuityDepth) {
    return depth === "foreground" ? "前景" : depth === "midground" ? "中景" : depth === "background" ? "后景" : "未标注";
}

function directionsOpposite(previous: StudioContinuityDirection, current: StudioContinuityDirection) {
    return (previous === "left_to_right" && current === "right_to_left")
        || (previous === "right_to_left" && current === "left_to_right")
        || (previous === "toward_camera" && current === "away_from_camera")
        || (previous === "away_from_camera" && current === "toward_camera")
        || (previous === "forward" && current === "backward")
        || (previous === "backward" && current === "forward")
        || (previous === "up" && current === "down")
        || (previous === "down" && current === "up")
        || (previous === "clockwise" && current === "counterclockwise")
        || (previous === "counterclockwise" && current === "clockwise");
}

function transitionAllows(normalized: NormalizedShot, types: string[]) {
    return hasTransition(normalized, types) || normalized.exceptions.some((exception) => types.includes(exception.type));
}

function addFinding(list: StudioContinuityFinding[], finding: StudioContinuityFinding) {
    if (!list.some((item) => item.ruleId === finding.ruleId && item.shotIds.join(",") === finding.shotIds.join(",") && item.fieldPath === finding.fieldPath)) list.push(finding);
}

function addGap(list: StudioContinuityGap[], gap: StudioContinuityGap) {
    // 同一 fieldPath 可能对应多个不同人物 / 原因（例如同一镜头漏绑两个人物）；
    // 只有规则、镜头、路径和原因都相同才视为重复，避免把第二个缺失人物吞掉。
    if (!list.some((item) => item.ruleId === gap.ruleId && item.shotIds.join(",") === gap.shotIds.join(",") && item.fieldPath === gap.fieldPath && item.reason === gap.reason)) list.push(gap);
}

function pairException(pair: Pair, types: StudioContinuityExceptionType[]) {
    return exceptionText(pair.previous, types) || exceptionText(pair.current, types);
}

function evaluatePair(pair: Pair, findings: StudioContinuityFinding[], gaps: StudioContinuityGap[]) {
    const previousShot = pair.previous.shot;
    const currentShot = pair.current.shot;
    const base = {
        shotIds: [previousShot.shotId, currentShot.shotId],
        shotGroupId: pair.groupId,
        sceneId: pair.sceneId,
        scope: "group" as const,
    };
    const sameGroup = pair.kind === "group";
    const sameSegment = pair.sameScene && !hasTransition(pair.current, ["time_jump", "flashback", "dream", "illusion", "scene_change"]);
    const currentEstablishing = Boolean(pair.current.continuity?.space?.establishing) || Boolean(pair.current.continuity?.space?.subjective);
    const exceptionForMovement = pairException(pair, ["turn", "stop", "scene_transition", "time_jump", "flashback", "dream", "illusion", "match_cut", "jump_cut", "orbit", "establishing"]);
    const exceptionForProp = pairException(pair, ["prop_handoff", "prop_drop", "prop_pickup", "prop_consume", "environment_change", "scene_transition", "time_jump"]);
    const exceptionForLook = pairException(pair, ["subjective", "cross_axis", "scene_transition", "time_jump", "flashback", "dream", "illusion", "orbit"]);
    const exceptionForAxis = pairException(pair, ["cross_axis", "establishing", "subjective", "orbit", "scene_transition", "time_jump"]);
    const exceptionForAction = pairException(pair, ["match_cut", "omitted_process", "result_first", "slow_motion", "jump_cut", "scene_transition", "time_jump"]);

    if (sameGroup && !sameSegment) {
        // 同一镜头组不应出现未标记的跨时空跳转；这里只提示，不替代上游剧本判断。
        addGap(gaps, {
            ruleId: "continuity.scene_time_change",
            shotIds: base.shotIds,
            fieldPath: "continuity.environment.transition",
            reason: "同一镜头组内存在时间 / 场景边界，但镜头没有标记 transition。",
            scope: "group",
        });
    }

    // 5.1 / 5.2 人物空间与运动
    if (sameSegment && !currentEstablishing) {
        for (const previousCharacter of pair.previous.characters) {
            const currentCharacter = pair.current.characters.find((item) => item.characterId === previousCharacter.characterId);
            if (!currentCharacter) continue;
            if (previousCharacter.screenSide && currentCharacter.screenSide && previousCharacter.screenSide !== "unknown" && currentCharacter.screenSide !== "unknown" && previousCharacter.screenSide !== "off_screen" && currentCharacter.screenSide !== "off_screen" && previousCharacter.screenSide !== currentCharacter.screenSide) {
                const exempt = exceptionText(pair.current, ["turn", "establishing", "scene_transition", "time_jump", "flashback", "dream", "illusion", "jump_cut"]);
                if (!exempt) {
                    addFinding(findings, {
                        ...base,
                        ruleId: "continuity.position_jump",
                        severity: sameGroup ? "error" : "warning",
                        confidence: "high",
                        fieldPath: `continuity.space.characters[${previousCharacter.characterId}].screenSide`,
                        evidence: `${shotLabel(previousShot)} ${previousCharacter.name}在${sideLabel(previousCharacter.screenSide)}；${shotLabel(currentShot)} ${currentCharacter.name}在${sideLabel(currentCharacter.screenSide)}。`,
                        reason: `${previousCharacter.name}在同一连续段落中从画面${sideLabel(previousCharacter.screenSide)}跳到${sideLabel(currentCharacter.screenSide)}，没有转身、建立镜头或转场依据。`,
                        suggestion: "补人物调度或转身动作；如果是有意的机位重建，标记 establishing 例外并补建立镜头。",
                    });
                }
            }
            if (sameGroup && previousCharacter.depth && currentCharacter.depth && previousCharacter.depth !== "unknown" && currentCharacter.depth !== "unknown" && previousCharacter.depth !== currentCharacter.depth && !exceptionText(pair.current, ["turn", "scene_transition", "time_jump", "establishing"])) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.position_jump",
                    severity: "warning",
                    confidence: "medium",
                    fieldPath: `continuity.space.characters[${previousCharacter.characterId}].depth`,
                    evidence: `${shotLabel(previousShot)} ${previousCharacter.name}在${depthLabel(previousCharacter.depth)}；${shotLabel(currentShot)} ${currentCharacter.name}在${depthLabel(currentCharacter.depth)}。`,
                    reason: `${previousCharacter.name}的前后景层次无解释改变。`,
                    suggestion: "补走位、焦点变化或镜头重建依据。",
                });
            }
            const previousDistance = previousCharacter.distance;
            const currentDistance = currentCharacter.distance;
            if (previousCharacter.distance && currentCharacter.distance && previousCharacter.distance !== "unknown" && currentCharacter.distance !== "unknown" && previousCharacter.distance !== currentCharacter.distance && !exceptionText(pair.current, ["turn", "scene_transition", "time_jump", "establishing"])) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.position_distance",
                    severity: "warning",
                    confidence: "medium",
                    fieldPath: `continuity.space.characters[${previousCharacter.characterId}].distance`,
                    evidence: `${shotLabel(previousShot)} ${previousCharacter.name}${previousCharacter.distance === "near" ? "靠近镜头" : "远离镜头"}；${shotLabel(currentShot)} ${currentCharacter.name}${currentCharacter.distance === "near" ? "靠近镜头" : "远离镜头"}。`,
                    reason: `${previousCharacter.name}与镜头的距离无解释突变。`,
                    suggestion: "补前进、后退或变焦 / 机位变化的依据。",
                });
            }
            const previousMovement = pair.previous.movement;
            const currentMovement = pair.current.movement;
            const movementCharacterId = currentMovement.source === "ambiguous" || previousMovement.source === "ambiguous" ? undefined : currentMovement.characterId ?? previousMovement.characterId;
            if (movementCharacterId && movementCharacterId === previousCharacter.characterId && previousMovement.direction && currentMovement.direction && directionsOpposite(previousMovement.direction, currentMovement.direction)) {
                if (!exceptionForMovement && !exceptionText(pair.current, ["turn", "stop", "jump_cut", "match_cut"])) {
                    addFinding(findings, {
                        ...base,
                        ruleId: "continuity.movement_reversal",
                        severity: "warning",
                        confidence: sameGroup ? "high" : "medium",
                        fieldPath: `continuity.space.characters[${previousCharacter.characterId}].movementDirection`,
                        evidence: `${shotLabel(previousShot)} ${previousCharacter.name}${DIRECTION_LABEL[previousMovement.direction]}（${previousMovement.source}）；${shotLabel(currentShot)} ${currentCharacter.name}${DIRECTION_LABEL[currentMovement.direction]}（${currentMovement.source}）。`,
                        reason: `${previousCharacter.name}的运动方向从「${DIRECTION_LABEL[previousMovement.direction]}」变为「${DIRECTION_LABEL[currentMovement.direction]}」，没有转身、停止或合理机位变化。`,
                        suggestion: "补转身 / 急停 / 遮挡，或者把方向变化写成新的动作起点 / 明确转场。",
                    });
                }
            }
        }
    }

    // 5.3 / 6 视线与轴线
    if (sameSegment && !exceptionForLook) {
        for (const currentCharacter of pair.current.characters) {
            if (!currentCharacter.eyelineTargetId) continue;
            const target = pair.current.characters.find((item) => item.characterId === currentCharacter.eyelineTargetId);
            if (!target?.screenSide || !currentCharacter.facing || currentCharacter.facing === "unknown") continue;
            const targetSide = target.screenSide;
            const expected = targetSide === "left" ? "left" : targetSide === "right" ? "right" : undefined;
            const facingToSide = currentCharacter.facing === "left" ? "left" : currentCharacter.facing === "right" ? "right" : undefined;
            if (!expected || !facingToSide || expected === facingToSide) continue;
            addFinding(findings, {
                ...base,
                ruleId: "continuity.eyeline_mismatch",
                severity: sameGroup ? "error" : "warning",
                confidence: "high",
                fieldPath: `continuity.space.characters[${currentCharacter.characterId}].facing`,
                evidence: `${shotLabel(currentShot)} ${currentCharacter.name}看向${target.name}（${sideLabel(targetSide)}），但人物朝向${sideLabel(facingToSide)}。`,
                reason: `视线目标在画面${sideLabel(targetSide)}，人物朝向却指向${sideLabel(facingToSide)}；正反打方向不匹配。`,
                suggestion: "按 180 度关系调整人物朝向或反打机位；主观 / 越轴镜头必须显式标记。",
            });
        }
        for (const currentCharacter of pair.current.characters) {
            if (!currentCharacter.eyelineTargetId || !currentCharacter.screenSide || !currentCharacter.facing) continue;
            const target = pair.current.characters.find((item) => item.characterId === currentCharacter.eyelineTargetId);
            if (!target?.screenSide) {
                addGap(gaps, {
                    ruleId: "continuity.eyeline_mismatch",
                    shotIds: base.shotIds,
                    fieldPath: `continuity.space.characters[${currentCharacter.characterId}].eyelineTargetId`,
                    reason: `视线目标 ${currentCharacter.eyelineTargetId} 没有画面侧信息，不能判定正反打。`,
                    scope: "group",
                });
            }
        }
    }

    const groupAxis = pair.current.groupContinuity?.axis?.cameraSide ?? pair.previous.groupContinuity?.axis?.cameraSide ?? "unknown";
    const previousSide = pair.previous.cameraSide;
    const currentSide = pair.current.cameraSide;
    if (!exceptionForAxis && sameSegment && !currentEstablishing && !(pair.current.continuity?.space?.orbit ?? false)) {
        if (previousSide !== "unknown" && currentSide !== "unknown" && previousSide !== currentSide) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.axis_cross",
                severity: sameGroup ? "error" : "warning",
                confidence: "high",
                fieldPath: "continuity.space.cameraSide",
                evidence: `${shotLabel(previousShot)} 机位在轴线${previousSide === "axis_left" ? "左" : previousSide === "axis_right" ? "右" : "上"}；${shotLabel(currentShot)} 机位在轴线${currentSide === "axis_left" ? "左" : currentSide === "axis_right" ? "右" : "上"}。`,
                reason: "同一镜头组内相机跨到轴线另一侧，没有跨轴 / 环绕 / 主观镜头依据。",
                suggestion: "保持同一轴线侧，或用中性镜头 / 明确越轴动作过渡；不要用剪辑掩盖空间断裂。",
            });
        } else if (groupAxis !== "unknown" && currentSide !== "unknown" && currentSide !== groupAxis) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.axis_cross",
                severity: "warning",
                confidence: "high",
                fieldPath: "continuity.axis.cameraSide",
                evidence: `${shotLabel(currentShot)} 位于轴线${currentSide === "axis_left" ? "左" : currentSide === "axis_right" ? "右" : "上"}，镜头组轴线在${groupAxis === "axis_left" ? "左" : groupAxis === "axis_right" ? "右" : "上"}。`,
                reason: "当前镜头偏离镜头组建立的相机侧，缺少显式越轴例外。",
                suggestion: "确认 180 度轴线；若主动越轴，补跨轴动作或环摇镜头。",
            });
        }
        if (sameGroup && previousSide === "unknown" && currentSide === "unknown") {
            addGap(gaps, {
                ruleId: "continuity.axis_cross",
                shotIds: base.shotIds,
                fieldPath: "continuity.space.cameraSide",
                reason: "同一镜头组缺少相机轴线侧；旧数据不能凭文本推断机位。",
                scope: "group",
            });
        }
    }

    // 7 人物状态
    for (const previousCharacter of pair.previous.characters) {
        const currentCharacter = pair.current.characters.find((item) => item.characterId === previousCharacter.characterId);
        const nameTwin = pair.current.characters.find((item) => item.name === previousCharacter.name && item.characterId !== previousCharacter.characterId);
        if (nameTwin) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.character_identity_conflict",
                severity: "error",
                confidence: "high",
                fieldPath: "characterBindings[].characterId",
                evidence: `${shotLabel(previousShot)} ${previousCharacter.name}（${previousCharacter.characterId}）；${shotLabel(currentShot)} 同名角色使用 ${nameTwin.characterId}。`,
                reason: "同一姓名在相邻镜头使用了不同人物资产 ID。",
                suggestion: "修正人物绑定；不能把换装变体当成新角色。",
            });
        }
        if (!currentCharacter) {
            if (sameSegment && sameGroup) {
                addGap(gaps, {
                    ruleId: "continuity.character_outfit_change",
                    shotIds: base.shotIds,
                    fieldPath: "characterBindings",
                    reason: `${previousCharacter.name}在下一镜头缺席，无法判断是出画还是身份变化。`,
                    scope: "scene",
                });
            }
            continue;
        }
        if (previousCharacter.characterId === currentCharacter.characterId && previousCharacter.name !== currentCharacter.name) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.character_identity_conflict",
                severity: "warning",
                confidence: "high",
                fieldPath: `characterBindings[${previousCharacter.characterId}].name`,
                evidence: `${shotLabel(previousShot)} ${previousCharacter.name}（${previousCharacter.characterId}）；${shotLabel(currentShot)} ${currentCharacter.name}（同一 characterId）。`,
                reason: "同一角色 ID 在相邻镜头使用了不同姓名，可能是错误绑定或未登记别名。",
                suggestion: "核对人物姓名与 characterId；如果只是别名，请在注册表中登记，不能靠显示名覆盖。",
            });
        }
        if (previousCharacter.outfitId && currentCharacter.outfitId && previousCharacter.outfitId !== currentCharacter.outfitId && !exceptionText(pair.current, ["costume_change", "time_jump", "scene_transition", "flashback", "dream", "illusion"])) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.character_outfit_change",
                severity: "warning",
                confidence: "high",
                fieldPath: `continuity.characters[${previousCharacter.characterId}].outfitId`,
                evidence: `${shotLabel(previousShot)} ${previousCharacter.name}服装 ${previousCharacter.outfitId}；${shotLabel(currentShot)} ${currentCharacter.name}服装 ${currentCharacter.outfitId}。`,
                reason: "同一角色的服装变体在同一连续段落中改变，没有换装或时间跳跃依据。",
                suggestion: "统一服装变体 ID；若剧情换装，补换装动作或显式 costume_change 例外。",
            });
        }
        const appearanceException = exceptionText(pair.current, ["costume_change", "time_jump", "scene_transition", "flashback", "dream", "illusion"]);
        if (!appearanceException && previousCharacter.hairstyle && currentCharacter.hairstyle && previousCharacter.hairstyle !== currentCharacter.hairstyle) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.character_outfit_change",
                severity: "warning",
                confidence: "medium",
                fieldPath: `continuity.characters[${previousCharacter.characterId}].hairstyle`,
                evidence: `${shotLabel(previousShot)} ${previousCharacter.name}发型「${previousCharacter.hairstyle}」；${shotLabel(currentShot)}「${currentCharacter.hairstyle}」。`,
                reason: "发型在同一连续段落中改变，没有换装或转场依据。",
                suggestion: "补换装 / 伪装 / 时间跳跃依据，或统一发型字段。",
            });
        }
        if (!appearanceException && previousCharacter.accessories && currentCharacter.accessories && previousCharacter.accessories.join("|") !== currentCharacter.accessories.join("|")) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.character_outfit_change",
                severity: "suggestion",
                confidence: "medium",
                fieldPath: `continuity.characters[${previousCharacter.characterId}].accessories`,
                evidence: `${shotLabel(previousShot)} ${previousCharacter.name}配饰 ${previousCharacter.accessories.join("、") || "无"}；${shotLabel(currentShot)} ${currentCharacter.accessories.join("、") || "无"}。`,
                reason: "配饰清单在同一连续段落中变化；可能是合理摘戴，也可能是资产状态遗漏。",
                suggestion: "确认配饰是否被剧情摘下 / 戴上；必要时补动作或更新资产状态。",
            });
        }
        const previousWeapon = previousCharacter.weaponPropId;
        const currentWeapon = currentCharacter.weaponPropId;
        const weaponStowed = /收起|收剑|收刀|归鞘|入鞘|放下武器|扔掉|丢弃|空手/.test(`${currentShot.action}；${currentShot.characterBlocking}`);
        const weaponAcquired = weaponAcquisitionForCharacter(currentShot, currentCharacter, pair.current.characters);
        const weaponException = exceptionText(pair.current, ["prop_consume", "prop_drop", "scene_transition", "time_jump", "flashback", "dream", "illusion"]);
        if (previousWeapon !== undefined && currentWeapon === undefined) {
            // 下一镜头没有记录武器信息，不能当作武器消失。
            addGap(gaps, {
                ruleId: "continuity.character_weapon_change",
                shotIds: base.shotIds,
                fieldPath: `continuity.characters[${previousCharacter.characterId}].weaponPropId`,
                reason: `${previousCharacter.name}上一镜头记录了武器「${previousWeapon ?? "明确无武器"}」，下一镜头没有 weaponPropId 记录；信息不足，不能判定武器保留或消失。`,
                scope: "scene",
            });
        } else if (previousWeapon !== null && previousWeapon !== undefined && currentWeapon === null) {
            // null 是明确的空手 / 武器已收起；与“没有记录”严格区分。
            if (!weaponStowed && !weaponException) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.character_weapon_change",
                    severity: "warning",
                    confidence: "high",
                    fieldPath: `continuity.characters[${previousCharacter.characterId}].weaponPropId`,
                    evidence: `${shotLabel(previousShot)} ${previousCharacter.name}持有 ${previousWeapon}；${shotLabel(currentShot)} 明确记录 weaponPropId=null（无武器）。`,
                    reason: "同一角色的武器从明确持有变为明确无武器，且当前镜头没有收起、丢弃或交接动作。",
                    suggestion: "补收剑 / 放下 / 被击落动作；如果只是漏写武器状态，应恢复 weaponPropId，而不是留空。",
                });
            }
        } else if (previousWeapon !== null && previousWeapon !== undefined && typeof currentWeapon === "string" && previousWeapon !== currentWeapon) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.character_weapon_change",
                severity: "warning",
                confidence: "high",
                fieldPath: `continuity.characters[${previousCharacter.characterId}].weaponPropId`,
                evidence: `${shotLabel(previousShot)} ${previousCharacter.name}持有 ${previousWeapon}；${shotLabel(currentShot)} 持有 ${currentWeapon}。`,
                reason: "同一角色的武器 ID 改变，但没有交接或拾取依据。",
                suggestion: "核对武器绑定；补交换 / 拾取动作，或统一 weaponPropId。",
            });
        } else if (previousWeapon === null && typeof currentWeapon === "string") {
            if (!weaponAcquired) {
                addGap(gaps, {
                    ruleId: "continuity.character_weapon_change",
                    shotIds: base.shotIds,
                    fieldPath: `continuity.characters[${previousCharacter.characterId}].weaponPropId`,
                    reason: `${previousCharacter.name}上一镜头明确无武器，当前镜头出现武器「${currentWeapon}」；没有拔刀、拾取、接过或召出等取得动作记录，信息不足，不认定为连续状态错误。`,
                    scope: "scene",
                });
            }
        }
        if (sameGroup && previousCharacter.posture && currentCharacter.posture && previousCharacter.posture !== currentCharacter.posture) {
            const postureExempt = exceptionText(pair.current, ["turn", "match_cut", "jump_cut", "scene_transition", "time_jump"]);
            if (!postureExempt) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.character_state_change",
                    severity: "suggestion",
                    confidence: "low",
                    fieldPath: `continuity.characters[${previousCharacter.characterId}].posture`,
                    evidence: `${shotLabel(previousShot)} ${previousCharacter.name}姿态「${previousCharacter.posture}」；${shotLabel(currentShot)}「${currentCharacter.posture}」。`,
                    reason: "同一镜头组内姿态突变，可能是剪辑省略或缺少过渡动作。",
                    suggestion: "补起身 / 坐下 / 转身等过渡动作；若只是景别变化，可忽略此建议。",
                });
            }
        }
        if (sameGroup && previousCharacter.emotion && currentCharacter.emotion && previousCharacter.emotion !== currentCharacter.emotion) {
            const emotionExempt = exceptionText(pair.current, ["match_cut", "jump_cut", "scene_transition", "time_jump"]);
            if (!emotionExempt && previousCharacter.actionPhase === currentCharacter.actionPhase) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.character_state_change",
                    severity: "suggestion",
                    confidence: "low",
                    fieldPath: `continuity.characters[${previousCharacter.characterId}].emotion`,
                    evidence: `${shotLabel(previousShot)} ${previousCharacter.name}情绪「${previousCharacter.emotion}」；${shotLabel(currentShot)}「${currentCharacter.emotion}」。`,
                    reason: "同一镜头组内情绪突变，且动作阶段没有变化；可能是表演连续性提示。",
                    suggestion: "确认情绪变化是否由台词 / 事件触发；必要时补反应镜头。",
                });
            }
        }
        if (previousCharacter.injured === true && currentCharacter.injured === false && !exceptionText(pair.current, ["heal", "time_jump", "scene_transition", "flashback", "dream"])) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.character_injury_change",
                severity: "warning",
                confidence: "high",
                fieldPath: `continuity.characters[${previousCharacter.characterId}].injured`,
                evidence: `${shotLabel(previousShot)} ${previousCharacter.name}有伤；${shotLabel(currentShot)} ${currentCharacter.name}无伤。`,
                reason: "已建立的伤势在下一镜头消失，没有治疗或时间跳跃依据。",
                suggestion: "保留伤口 / 血迹，或补治疗、时间跳跃、换场依据。",
            });
        }
        if (previousCharacter.blood === true && currentCharacter.blood === false && !exceptionText(pair.current, ["heal", "time_jump", "scene_transition"])) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.character_injury_change",
                severity: "warning",
                confidence: "medium",
                fieldPath: `continuity.characters[${previousCharacter.characterId}].blood`,
                evidence: `${shotLabel(previousShot)} ${previousCharacter.name}有血迹；${shotLabel(currentShot)} 无血迹。`,
                reason: "血迹状态无解释消失。",
                suggestion: "补擦拭 / 治疗 / 时间跳跃，或保留连续血迹。",
            });
        }
    }

    // 8 道具状态
    for (const previousProp of pair.previous.props) {
        const currentProp = pair.current.props.find((item) => item.propId === previousProp.propId);
        if (!currentProp) {
            if (sameSegment && !exceptionForProp && previousProp.visible !== false) {
                const explicitCurrentProps = Array.isArray(pair.current.shot.continuity?.props);
                if (!explicitCurrentProps) {
                    addGap(gaps, {
                        ruleId: "continuity.prop_disappear",
                        shotIds: base.shotIds,
                        fieldPath: `continuity.props[${previousProp.propId}]`,
                        reason: `${previousProp.name}在下一镜头没有结构化道具状态，不能判定是消失、收起还是画外。`,
                        scope: "group",
                    });
                } else if (sameGroup || pair.kind === "group_boundary") {
                    addFinding(findings, {
                        ...base,
                        ruleId: "continuity.prop_disappear",
                        severity: sameGroup ? "warning" : "suggestion",
                        confidence: "medium",
                        fieldPath: `continuity.props[${previousProp.propId}].visible`,
                        evidence: `${shotLabel(previousShot)} 有${previousProp.name}（${previousProp.state || "未标状态"}）；${shotLabel(currentShot)} 显式道具状态中没有该道具。`,
                        reason: `${previousProp.name}在同一连续段落中从显式道具状态消失，缺少收起、掉落、使用完或转场依据。`,
                        suggestion: "确认道具是否应留在画面；补交接 / 收起 / 使用动作，或明确标记画外。",
                    });
                }
            }
            continue;
        }
        if (previousProp.holderCharacterId && currentProp.holderCharacterId && previousProp.holderCharacterId !== currentProp.holderCharacterId) {
            const transferred = currentProp.transferredTo === currentProp.holderCharacterId || /交给|递给|接过|转交/.test(currentShot.action) || previousProp.transferredTo === currentProp.holderCharacterId;
            if (!transferred && !exceptionForProp) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.prop_holder_change",
                    severity: "error",
                    confidence: "high",
                    fieldPath: `continuity.props[${previousProp.propId}].holderCharacterId`,
                    evidence: `${shotLabel(previousShot)} ${previousProp.name}由 ${previousProp.holderCharacterId} 持有；${shotLabel(currentShot)} 由 ${currentProp.holderCharacterId} 持有。`,
                    reason: "道具持有者发生变化，但没有交接 / 掉落 / 拾起动作。",
                    suggestion: "补交接动作并更新 transferredTo，或恢复正确持有者。",
                });
            }
        }
        if (previousProp.hand && currentProp.hand && previousProp.hand !== "unknown" && currentProp.hand !== "unknown" && previousProp.hand !== currentProp.hand) {
            const handChanged = currentProp.transferredTo || /换手|交给|接过|掉落|落地/.test(currentShot.action);
            if (!handChanged && !exceptionForProp) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.prop_hand_change",
                    severity: "warning",
                    confidence: "high",
                    fieldPath: `continuity.props[${previousProp.propId}].hand`,
                    evidence: `${shotLabel(previousShot)} ${previousProp.name}在${previousProp.hand === "left" ? "左" : previousProp.hand === "right" ? "右" : "双"}手；${shotLabel(currentShot)} 在${currentProp.hand === "left" ? "左" : currentProp.hand === "right" ? "右" : "双"}手。`,
                    reason: "道具换手没有动作依据。",
                    suggestion: "补换手 / 交接 / 抛接动作，或统一持握状态。",
                });
            }
        }
        if (currentProp.visible === false && previousProp.visible !== false && !exceptionForProp) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.prop_disappear",
                severity: "error",
                confidence: "high",
                fieldPath: `continuity.props[${currentProp.propId}].visible`,
                evidence: `${shotLabel(previousShot)} ${previousProp.name}可见；${shotLabel(currentShot)} 显式标记不可见。`,
                reason: "道具被显式标记为不可见，但没有收起 / 使用 / 掉落 / 转场依据。",
                suggestion: "补道具处理动作，或修正 visible 状态。",
            });
        }
        if (previousProp.form && currentProp.form && previousProp.form !== currentProp.form && !exceptionForProp) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.prop_disappear",
                severity: "warning",
                confidence: "medium",
                fieldPath: `continuity.props[${currentProp.propId}].form`,
                evidence: `${shotLabel(previousShot)} ${previousProp.name}形态 ${previousProp.form}；${shotLabel(currentShot)} ${currentProp.form}。`,
                reason: "道具形态无解释变化。",
                suggestion: "补形态变化原因，或统一道具状态。",
            });
        }
        if (previousProp.damaged === true && currentProp.damaged === false && !exceptionForProp) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.prop_state_change",
                severity: "warning",
                confidence: "high",
                fieldPath: `continuity.props[${currentProp.propId}].damaged`,
                evidence: `${shotLabel(previousShot)} ${previousProp.name}已损坏；${shotLabel(currentShot)} 显式标记为未损坏。`,
                reason: "道具损坏状态无解释恢复。",
                suggestion: "补修复 / 替换依据，或保持 damaged 状态。",
            });
        }
        if (previousProp.dropped === true && currentProp.dropped === false && currentProp.pickedUp !== true && !exceptionForProp) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.prop_state_change",
                severity: "warning",
                confidence: "medium",
                fieldPath: `continuity.props[${currentProp.propId}].dropped`,
                evidence: `${shotLabel(previousShot)} ${previousProp.name}已掉落；${shotLabel(currentShot)} dropped=false，且没有 pickedUp。`,
                reason: "道具从掉落状态恢复，但没有拾起或交接依据。",
                suggestion: "补拾起 / 交接动作，或保持 dropped 状态。",
            });
        }
        if (previousProp.state && currentProp.state && previousProp.state !== currentProp.state && !exceptionForProp) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.prop_state_change",
                severity: "suggestion",
                confidence: "low",
                fieldPath: `continuity.props[${currentProp.propId}].state`,
                evidence: `${shotLabel(previousShot)} ${previousProp.name}状态 ${previousProp.state}；${shotLabel(currentShot)} ${currentProp.state}。`,
                reason: "道具状态文本改变，缺少动作过程或剧情解释。",
                suggestion: "确认道具状态变化是否由动作触发；必要时补交接 / 使用 / 受损过程。",
            });
        }
    }

    // 9 场景与时间
    if ((pair.sameScene || pair.kind === "scene_boundary") && !hasTransition(pair.current, ["time_jump", "flashback", "dream", "illusion"]) && !exceptionText(pair.current, ["time_jump", "flashback", "dream", "illusion"])) {
        const previousLocation = previousShot.sceneBindings;
        const currentLocation = currentShot.sceneBindings;
        const sameLocation = previousLocation.locationId === currentLocation.locationId && (!previousLocation.locationVariantId || !currentLocation.locationVariantId || previousLocation.locationVariantId === currentLocation.locationVariantId);
        const environmentChangeAllowed = exceptionText(pair.current, ["environment_change", "scene_transition", "time_jump", "flashback", "dream", "illusion"]);
        if (pair.sameScene || sameLocation) {
            if (pair.previous.environment.timeOfDay && pair.current.environment.timeOfDay && pair.previous.environment.timeOfDay !== pair.current.environment.timeOfDay) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.scene_time_change",
                    severity: sameGroup ? "error" : "warning",
                    confidence: "high",
                    fieldPath: "continuity.environment.timeOfDay",
                    evidence: `${shotLabel(previousShot)} ${pair.previous.environment.timeOfDay}；${shotLabel(currentShot)} ${pair.current.environment.timeOfDay}。`,
                    reason: "同一连续段落内昼夜 / 时间状态改变，缺少时间跳跃或转场。",
                    suggestion: "补时间跳跃 / 夜景转场，或统一 timeOfDay。",
                });
            }
            if (!environmentChangeAllowed && pair.previous.environment.weather && pair.current.environment.weather && pair.previous.environment.weather !== pair.current.environment.weather) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.scene_weather_change",
                    severity: "warning",
                    confidence: "medium",
                    fieldPath: "continuity.environment.weather",
                    evidence: `${shotLabel(previousShot)} ${pair.previous.environment.weather}；${shotLabel(currentShot)} ${pair.current.environment.weather}。`,
                    reason: "天气在同一连续段落内改变。",
                    suggestion: "补天气变化剧情或转场；不要把晴天和雨天直接剪在一起。",
                });
            }
            if (!environmentChangeAllowed && pair.previous.environment.lighting && pair.current.environment.lighting && pair.previous.environment.lighting !== pair.current.environment.lighting && previousShot.sceneId === currentShot.sceneId) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.scene_weather_change",
                    severity: "suggestion",
                    confidence: "low",
                    fieldPath: "continuity.environment.lighting",
                    evidence: `${shotLabel(previousShot)} ${pair.previous.environment.lighting}；${shotLabel(currentShot)} ${pair.current.environment.lighting}。`,
                    reason: "光照描述改变；可能只是机位或光源变化，先作为建议。",
                    suggestion: "确认光源方向是否连续；若换光，补动机或转场。",
                });
            }
            if (!environmentChangeAllowed && pair.previous.environment.visibility && pair.current.environment.visibility && pair.previous.environment.visibility !== pair.current.environment.visibility) {
                addFinding(findings, {
                    ...base,
                    ruleId: "continuity.scene_weather_change",
                    severity: "suggestion",
                    confidence: "low",
                    fieldPath: "continuity.environment.visibility",
                    evidence: `${shotLabel(previousShot)} 能见度 ${pair.previous.environment.visibility}；${shotLabel(currentShot)} ${pair.current.environment.visibility}。`,
                    reason: "能见度 / 烟尘状态改变，可能是环境变化，也可能是镜头景深差异。",
                    suggestion: "确认烟尘 / 雾气 / 火焰是否应保持连续；若剧情变化，补 environment_change 依据。",
                });
            }
            for (const [field, label] of [["ground", "地面状态"], ["damage", "环境破坏状态"]] as const) {
                const previousValue = pair.previous.environment[field];
                const currentValue = pair.current.environment[field];
                if (!environmentChangeAllowed && previousValue && currentValue && previousValue !== currentValue) {
                    addFinding(findings, {
                        ...base,
                        ruleId: "continuity.scene_environment_reset",
                        severity: "warning",
                        confidence: "high",
                        fieldPath: `continuity.environment.${field}`,
                        evidence: `${shotLabel(previousShot)} ${label} ${previousValue}；${shotLabel(currentShot)} ${currentValue}。`,
                        reason: `${label}无解释变化，可能把已建立的破坏 / 积水状态恢复。`,
                        suggestion: "补修复、清理、时间跳跃或幻境依据；否则保持环境状态连续。",
                    });
                }
            }
        }
        if (pair.sameScene && !pair.previous.environment.timeOfDay && !pair.current.environment.timeOfDay) {
            addGap(gaps, {
                ruleId: "continuity.scene_time_change",
                shotIds: base.shotIds,
                fieldPath: "continuity.environment.timeOfDay",
                reason: "同一场景缺少时间状态，不能判定昼夜连续。",
                scope: "scene",
            });
        }
    }

    // 10 动作承接
    if (sameSegment && ["reaction", "result"].includes(pair.current.action.phase)) {
        const current = pair.current.action;
        const previous = pair.previous.action;
        const explicitOrStrong = current.explicit || previous.explicit || current.phase === "result" && /倒地|倒下|死亡/.test(currentShot.action);
        const contactBefore = previous.phase === "contact" || previous.phase === "process" || previous.phase === "start";
        const allowed = exceptionForAction || current.interrupted || pair.current.shot.continuity?.action?.interrupted;
        if (explicitOrStrong && !contactBefore && !allowed) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.action_cause_missing",
                severity: "warning",
                confidence: current.explicit ? "high" : "medium",
                fieldPath: "continuity.action.phase",
                evidence: `${shotLabel(previousShot)} 动作阶段「${PHASE_LABEL[previous.phase]}」；${shotLabel(currentShot)} 动作阶段「${PHASE_LABEL[current.phase]}」。`,
                reason: "当前镜头已进入反应 / 结果，但前一镜头没有攻击、接触、受力或可接受的省略依据。",
                suggestion: "补接触 / 受力镜头，或用 match_cut / omitted_process 例外明确说明。",
            });
        }
        if (current.causeShotId && !pair.current.group?.shotIds.includes(current.causeShotId) && pair.current.shot.shotId !== current.causeShotId) {
            addFinding(findings, {
                ...base,
                ruleId: "continuity.action_cause_missing",
                severity: "error",
                confidence: "high",
                fieldPath: "continuity.action.causeShotId",
                evidence: `${shotLabel(currentShot)} 引用原因镜头 ${current.causeShotId}，当前镜头组不存在该镜头。`,
                reason: "动作原因镜头引用失效。",
                suggestion: "修正 causeShotId，或改用当前镜头组内的有效原因镜头。",
            });
        }
    }
    if (sameSegment && pair.previous.action.forceDirection && pair.current.action.reactionDirection && pair.previous.action.forceDirection !== pair.current.action.reactionDirection && !exceptionForAction) {
        addFinding(findings, {
            ...base,
            ruleId: "continuity.action_force_mismatch",
            severity: "warning",
            confidence: "high",
            fieldPath: "continuity.action.reactionDirection",
            evidence: `${shotLabel(previousShot)} 受力${DIRECTION_LABEL[pair.previous.action.forceDirection]}；${shotLabel(currentShot)} 反应位移${DIRECTION_LABEL[pair.current.action.reactionDirection]}。`,
            reason: "受力方向与反应位移方向不一致。",
            suggestion: "让反应方向顺着受力方向，或补格挡 / 反弹 / 二次受力依据。",
        });
    }

    // 缺字段只记信息不足，不输出确定错误。
    if (sameSegment && !currentEstablishing) {
        for (const previousCharacter of pair.previous.characters) {
            const currentCharacter = pair.current.characters.find((item) => item.characterId === previousCharacter.characterId);
            if (!currentCharacter) continue;
            if (!previousCharacter.screenSide || !currentCharacter.screenSide) {
                addGap(gaps, {
                    ruleId: "continuity.position_jump",
                    shotIds: base.shotIds,
                    fieldPath: `continuity.space.characters[${previousCharacter.characterId}].screenSide`,
                    reason: `${previousCharacter.name}缺少左右侧结构化位置，不能判定位置跳变。`,
                    scope: "group",
                });
            }
        }
    }
}

export function buildContinuityCheck(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    scope?: StudioContinuityScope;
    /** 供长集分批 / 取消时使用；同步调用可省略。 */
    shouldCancel?: () => boolean;
    onProgress?: (progress: { checkedPairs: number; totalPairs: number }) => void;
}): StudioContinuityCheckReport {
    const document = input.document;
    const scope = normalizeScope(input.scope);
    const groupById = new Map(document.groups.map((group) => [group.shotGroupId, group]));
    const cache = new Map<string, NormalizedShot>();
    const normalize = (shot: StudioProductionShot, group?: StudioShotGroup) => {
        const cached = cache.get(shot.shotId);
        if (cached) return cached;
        const value = normalizeShot(shot, group ?? groupById.get(shot.shotGroupId), input.script);
        cache.set(shot.shotId, value);
        return value;
    };
    const pairs = buildPairs(document, normalize);
    const scopedPairs = pairs.filter((pair) => pairInScope(pair, scope));
    const findings: StudioContinuityFinding[] = [];
    const gaps: StudioContinuityGap[] = [];
    let cancelled = false;
    for (const [index, pair] of scopedPairs.entries()) {
        if (input.shouldCancel?.()) {
            cancelled = true;
            break;
        }
        evaluatePair(pair, findings, gaps);
        input.onProgress?.({ checkedPairs: index + 1, totalPairs: scopedPairs.length });
    }
    if (!cancelled) {
        for (const shot of document.shots.filter((item) => shotInScope(item, scope))) {
            const normalized = normalize(shot);
            for (const issue of normalized.bindingIssues) {
                addFinding(findings, {
                    ruleId: "continuity.character_identity_conflict",
                    severity: issue.severity,
                    confidence: issue.confidence,
                    shotIds: [shot.shotId],
                    shotGroupId: shot.shotGroupId,
                    sceneId: shot.sceneId,
                    fieldPath: issue.fieldPath,
                    evidence: issue.evidence,
                    reason: issue.reason,
                    suggestion: "核对当前镜头 characterBindings 与全剧注册表；保留原始绑定证据，不自动归一化或改写正式分镜。",
                    scope: "scene",
                });
            }
            for (const gap of normalized.bindingGaps) {
                addGap(gaps, {
                    ruleId: "continuity.character_identity_conflict",
                    shotIds: [shot.shotId],
                    fieldPath: gap.fieldPath,
                    reason: gap.reason,
                    scope: "scene",
                });
            }
        }
    }
    const affected = new Set([...findings.flatMap((finding) => finding.shotIds), ...gaps.flatMap((gap) => gap.shotIds)]);
    const counts = {
        error: findings.filter((item) => item.severity === "error").length,
        warning: findings.filter((item) => item.severity === "warning").length,
        suggestion: findings.filter((item) => item.severity === "suggestion").length,
        insufficient: gaps.length,
    };
    return {
        storyboardVersion: document.storyboardVersion,
        episodeId: document.episodeId,
        scope,
        checkId: checkIdentity(document, scope, findings, gaps),
        checkedShots: new Set([...scopedPairs.flatMap((pair) => [pair.previous.shot.shotId, pair.current.shot.shotId])]).size,
        checkedGroups: new Set([...scopedPairs.flatMap((pair) => [pair.previous.shot.shotGroupId, pair.current.shot.shotGroupId])]).size,
        checkedScenes: new Set([...scopedPairs.flatMap((pair) => [pair.previous.shot.sceneId, pair.current.shot.sceneId])]).size,
        checkedPairs: cancelled ? 0 : scopedPairs.length,
        totalPairs: pairs.length,
        affectedShotIds: [...affected],
        counts,
        findings: cancelled ? [] : findings,
        gaps: cancelled ? [] : gaps,
    };
}

/** 长集分批入口：每批让出事件循环；UI 取消时返回 cancelled 且不落库。 */
export async function runContinuityCheckAsync(input: {
    document: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    scope?: StudioContinuityScope;
    signal?: AbortSignal;
    batchSize?: number;
    onProgress?: (progress: { checkedPairs: number; totalPairs: number; phase: "checking" | "done" | "cancelled" }) => void;
}): Promise<{ report: StudioContinuityCheckReport; cancelled: boolean }> {
    const scope = normalizeScope(input.scope);
    const groupById = new Map(input.document.groups.map((group) => [group.shotGroupId, group]));
    const cache = new Map<string, NormalizedShot>();
    const normalize = (shot: StudioProductionShot, group?: StudioShotGroup) => {
        const cached = cache.get(shot.shotId);
        if (cached) return cached;
        const value = normalizeShot(shot, group ?? groupById.get(shot.shotGroupId), input.script);
        cache.set(shot.shotId, value);
        return value;
    };
    const pairs = buildPairs(input.document, normalize).filter((pair) => pairInScope(pair, scope));
    const findings: StudioContinuityFinding[] = [];
    const gaps: StudioContinuityGap[] = [];
    const batchSize = Math.max(4, input.batchSize ?? 24);
    let checked = 0;
    for (let index = 0; index < pairs.length; index += batchSize) {
        if (input.signal?.aborted) {
            input.onProgress?.({ checkedPairs: 0, totalPairs: pairs.length, phase: "cancelled" });
            return { report: buildContinuityCheck({ document: input.document, script: input.script, scope, shouldCancel: () => true }), cancelled: true };
        }
        for (const pair of pairs.slice(index, index + batchSize)) {
            evaluatePair(pair, findings, gaps);
            checked += 1;
        }
        input.onProgress?.({ checkedPairs: Math.min(checked, pairs.length), totalPairs: pairs.length, phase: "checking" });
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    for (const shot of input.document.shots.filter((item) => shotInScope(item, scope))) {
        const normalized = normalize(shot);
        for (const issue of normalized.bindingIssues) {
            addFinding(findings, {
                ruleId: "continuity.character_identity_conflict",
                severity: issue.severity,
                confidence: issue.confidence,
                shotIds: [shot.shotId],
                shotGroupId: shot.shotGroupId,
                sceneId: shot.sceneId,
                fieldPath: issue.fieldPath,
                evidence: issue.evidence,
                reason: issue.reason,
                suggestion: "核对当前镜头 characterBindings 与全剧注册表；保留原始绑定证据，不自动归一化或改写正式分镜。",
                scope: "scene",
            });
        }
        for (const gap of normalized.bindingGaps) {
            addGap(gaps, {
                ruleId: "continuity.character_identity_conflict",
                shotIds: [shot.shotId],
                fieldPath: gap.fieldPath,
                reason: gap.reason,
                scope: "scene",
            });
        }
    }
    const affected = new Set([...findings.flatMap((finding) => finding.shotIds), ...gaps.flatMap((gap) => gap.shotIds)]);
    input.onProgress?.({ checkedPairs: pairs.length, totalPairs: pairs.length, phase: "done" });
    return {
        report: {
            storyboardVersion: input.document.storyboardVersion,
            episodeId: input.document.episodeId,
            scope,
            checkId: checkIdentity(input.document, scope, findings, gaps),
            checkedShots: new Set(pairs.flatMap((pair) => [pair.previous.shot.shotId, pair.current.shot.shotId])).size,
            checkedGroups: new Set(pairs.flatMap((pair) => [pair.previous.shot.shotGroupId, pair.current.shot.shotGroupId])).size,
            checkedScenes: new Set(pairs.flatMap((pair) => [pair.previous.shot.sceneId, pair.current.shot.sceneId])).size,
            checkedPairs: pairs.length,
            totalPairs: pairs.length,
            affectedShotIds: [...affected],
            counts: {
                error: findings.filter((item) => item.severity === "error").length,
                warning: findings.filter((item) => item.severity === "warning").length,
                suggestion: findings.filter((item) => item.severity === "suggestion").length,
                insufficient: gaps.length,
            },
            findings,
            gaps,
        },
        cancelled: false,
    };
}
