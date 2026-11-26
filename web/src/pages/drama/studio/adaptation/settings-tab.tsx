import { App, Button, Input, InputNumber, Select, Tag } from "antd";
import { Save, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ADAPTATION_MAX_EPISODES, ADAPTATION_MAX_EPISODE_SECONDS, ADAPTATION_MIN_EPISODE_SECONDS, ADAPTATION_STRENGTH_LABEL, type StudioAdaptationSettings, type StudioAdaptationStrength } from "@/types/studio-adaptation";
import { StudioField, StudioPanel } from "../ui";
import { adaptationTime } from "./shared";

export function AdaptationSettingsTab({ settings, modelLabel, estimatedCalls, hasPlans, disabled, onSave }: {
    settings: StudioAdaptationSettings;
    modelLabel: string;
    estimatedCalls: number;
    hasPlans: boolean;
    disabled?: boolean;
    onSave: (settings: StudioAdaptationSettings) => void;
}) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState(settings);
    useEffect(() => setDraft(settings), [settings]);
    const changed = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);
    const targetChanged = draft.targetEpisodes !== settings.targetEpisodes || draft.targetEpisodeSeconds !== settings.targetEpisodeSeconds;
    const update = <K extends keyof StudioAdaptationSettings>(key: K, value: StudioAdaptationSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));

    return (
        <div className="adaptation-settings-layout">
            <StudioPanel title="改编定位" extra={<Tag bordered={false}>会被生成流程真实消费</Tag>}>
                <div className="adaptation-grid-3">
                    <StudioField label="短剧题材"><Input value={draft.genre} onChange={(event) => update("genre", event.target.value)} placeholder="例如：民国悬疑 / 都市复仇 / 古装权谋" /></StudioField>
                    <StudioField label="目标受众"><Input value={draft.audience} onChange={(event) => update("audience", event.target.value)} placeholder="例如：18-30 岁女性" /></StudioField>
                    <StudioField label="发布平台"><Input value={draft.platform} onChange={(event) => update("platform", event.target.value)} placeholder="例如：抖音 / 快手 / 视频号" /></StudioField>
                    <StudioField label="目标总集数" hint={`1-${ADAPTATION_MAX_EPISODES} 集`}>
                        <InputNumber min={1} max={ADAPTATION_MAX_EPISODES} value={draft.targetEpisodes} onChange={(value) => update("targetEpisodes", Number(value) || 1)} className="w-full" />
                    </StudioField>
                    <StudioField label="单集目标时长" hint={`${ADAPTATION_MIN_EPISODE_SECONDS}-${ADAPTATION_MAX_EPISODE_SECONDS} 秒`}>
                        <InputNumber min={ADAPTATION_MIN_EPISODE_SECONDS} max={ADAPTATION_MAX_EPISODE_SECONDS} value={draft.targetEpisodeSeconds} onChange={(value) => update("targetEpisodeSeconds", Number(value) || 60)} addonAfter="秒" className="w-full" />
                    </StudioField>
                    <StudioField label="改编强度" hint="默认平衡改编">
                        <Select
                            value={draft.strength}
                            onChange={(value) => update("strength", value as StudioAdaptationStrength)}
                            options={(Object.keys(ADAPTATION_STRENGTH_LABEL) as StudioAdaptationStrength[]).map((value) => ({ value, label: ADAPTATION_STRENGTH_LABEL[value] }))}
                        />
                    </StudioField>
                    <StudioField label="整体叙事风格"><Input value={draft.narrativeStyle} onChange={(event) => update("narrativeStyle", event.target.value)} placeholder="例如：高密度反转、冷峻写实、强情绪爽感" /></StudioField>
                    <StudioField label="情绪基调"><Input value={draft.tone} onChange={(event) => update("tone", event.target.value)} placeholder="例如：压抑中带希望 / 悬疑冷感" /></StudioField>
                    <StudioField label="结局倾向"><Input value={draft.endingDirection} onChange={(event) => update("endingDirection", event.target.value)} placeholder="例如：苦尽甘来 / 开放式 / 悲剧反噬" /></StudioField>
                </div>
                <div className="adaptation-grid-2">
                    <StudioField label="用户特别要求"><Input.TextArea rows={4} value={draft.requirements} onChange={(event) => update("requirements", event.target.value)} placeholder="必须保留的桥段、人物关系、平台节奏要求…" /></StudioField>
                    <StudioField label="禁止事项"><Input.TextArea rows={4} value={draft.prohibitions} onChange={(event) => update("prohibitions", event.target.value)} placeholder="禁止无依据改人物性格、禁止提前揭露秘密…" /></StudioField>
                </div>
                {targetChanged && hasPlans ? <div className="adaptation-inline-warning"><TriangleAlert className="size-4" /><span>修改目标集数或时长后，现有分集规划不会自动删除或改写；需要重新生成并人工确认。</span></div> : null}
                <div className="adaptation-actions-row">
                    <Button type="primary" icon={<Save className="size-4" />} disabled={!changed || disabled} onClick={() => { onSave({ ...draft, updatedAt: new Date().toISOString() }); message.success("改编定位已保存；下一次生成会使用新配置"); }}>保存改编定位</Button>
                    <span className="adaptation-muted">最近保存：{adaptationTime(settings.updatedAt)}</span>
                </div>
            </StudioPanel>
            <StudioPanel title="成本与生成边界" extra={<Tag bordered={false}>项目级文本模型</Tag>}>
                <dl className="adaptation-kv">
                    <div><dt>当前文本模型</dt><dd>{modelLabel || "未选择"}</dd></div>
                    <div><dt>目标集数 / 单集时长</dt><dd>{draft.targetEpisodes} 集 / {draft.targetEpisodeSeconds} 秒</dd></div>
                    <div><dt>全量生成预计调用</dt><dd>{estimatedCalls} 次模型请求</dd></div>
                    <div><dt>上下文策略</dt><dd>阶段 2A 结构化档案 + 必要证据短摘录，不重复发送整本小说</dd></div>
                </dl>
                <p className="adaptation-note"><Sparkles className="size-4" />本阶段只输出改编方案、全剧蓝图和分集规划；不会生成角色图、场景图、分镜、视频或正式剧本对白。</p>
            </StudioPanel>
        </div>
    );
}
