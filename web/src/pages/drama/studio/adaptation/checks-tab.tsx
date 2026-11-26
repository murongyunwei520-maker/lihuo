import { Button, InputNumber, Select, Tag } from "antd";
import { CheckCircle2, CircleAlert, Lightbulb, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import type { NovelAnalysis } from "@/types/novel";
import type { StudioAdaptationCheck, StudioAdaptationCheckLevel, StudioAdaptationCheckStatus, StudioAdaptationWorkspace } from "@/types/studio-adaptation";
import { checkSummary } from "@/lib/studio/adaptation-schema";
import { StudioEmpty, StudioPanel } from "../ui";
import { CheckLevelTag } from "./shared";

export function AdaptationChecksTab({ workspace, analysis, disabled, onUpdateStatus, onRegenerateFromCheck }: {
    workspace: StudioAdaptationWorkspace;
    analysis: NovelAnalysis;
    disabled: boolean;
    onUpdateStatus: (checkId: string, status: StudioAdaptationCheckStatus) => void;
    onRegenerateFromCheck: (check: StudioAdaptationCheck) => void;
}) {
    const [level, setLevel] = useState<StudioAdaptationCheckLevel | "">("");
    const [episode, setEpisode] = useState<number | null>(null);
    const [character, setCharacter] = useState("");
    const [openOnly, setOpenOnly] = useState(false);
    const summary = checkSummary(workspace.checks);
    const checks = useMemo(() => workspace.checks.filter((check) => {
        if (level && check.level !== level) return false;
        if (episode && !check.episodeNumbers.includes(episode)) return false;
        if (character && !check.characterIds.includes(character)) return false;
        if (openOnly && check.status !== "open") return false;
        return true;
    }), [workspace.checks, level, episode, character, openOnly]);
    if (!workspace.checks.length) {
        return <StudioEmpty icon={<CircleAlert className="size-7" />} title="还没有剧情校验结果" description="分集规划生成后会运行确定性校验：集数、时长、人物状态、信息差、时间线、伏笔、因果和改编引用。模型只负责提出风险，不会自动改写剧情。" />;
    }
    return (
        <div className="adaptation-tab-layout">
            <StudioPanel title="剧情递归自检" extra={<div className="adaptation-check-summary"><Tag bordered={false} color="error">{summary.errors} error</Tag><Tag bordered={false} color="warning">{summary.warnings} warning</Tag><Tag bordered={false} color="processing">{summary.suggestions} suggestion</Tag><Tag bordered={false}>待处理 {summary.open}</Tag></div>}>
                <div className="adaptation-filter-row">
                    <CircleAlert className="size-4" />
                    <Select allowClear value={level || undefined} onChange={(value) => setLevel((value as StudioAdaptationCheckLevel) ?? "")} placeholder="问题级别" options={[{ value: "error", label: "必须修复" }, { value: "warning", label: "需要确认" }, { value: "suggestion", label: "优化建议" }]} />
                    <InputNumber min={1} max={workspace.settings.targetEpisodes} value={episode ?? undefined} onChange={setEpisode} placeholder="集数" className="adaptation-filter-number" />
                    <Select allowClear showSearch value={character || undefined} onChange={(value) => setCharacter(value ?? "")} placeholder="人物" optionFilterProp="label" options={analysis.characters.map((item) => ({ value: item.id, label: item.name }))} />
                    <Button type={openOnly ? "primary" : "default"} onClick={() => setOpenOnly((value) => !value)}>只看待处理</Button>
                </div>
                <div className="adaptation-check-list">
                    {checks.map((check) => <CheckItem key={check.id} check={check} analysis={analysis} disabled={disabled} onUpdateStatus={onUpdateStatus} onRegenerateFromCheck={onRegenerateFromCheck} />)}
                    {!checks.length ? <div className="adaptation-empty-hint">当前筛选下没有校验项。</div> : null}
                </div>
            </StudioPanel>
        </div>
    );
}

function CheckItem({ check, analysis, disabled, onUpdateStatus, onRegenerateFromCheck }: {
    check: StudioAdaptationCheck;
    analysis: NovelAnalysis;
    disabled: boolean;
    onUpdateStatus: (checkId: string, status: StudioAdaptationCheckStatus) => void;
    onRegenerateFromCheck: (check: StudioAdaptationCheck) => void;
}) {
    const characters = check.characterIds.map((id) => analysis.characters.find((item) => item.id === id)?.name ?? id).join("、");
    const events = check.eventIds.map((id) => analysis.events.find((item) => item.id === id)?.title ?? id).join("、");
    return (
        <article className={`adaptation-check is-${check.level}`}>
            <header><CheckLevelTag level={check.level} /><Tag bordered={false}>{check.category}</Tag><span>{check.code}</span><span>{check.status === "open" ? "待处理" : check.status === "accepted" ? "已接受" : check.status === "ignored" ? "已忽略" : "已解决"}</span></header>
            <strong>{check.message}</strong>
            {check.suggestion ? <p><Lightbulb className="size-3.5" />{check.suggestion}</p> : null}
            <div className="adaptation-check-meta">
                {check.episodeNumbers.length ? <span>第 {check.episodeNumbers.join("、")} 集</span> : null}
                {characters ? <span>人物：{characters}</span> : null}
                {events ? <span>事件：{events}</span> : null}
                <span>来源：{check.source === "model" ? "模型自检" : "确定性校验"}</span>
            </div>
            <div className="adaptation-check-actions">
                {check.status !== "accepted" ? <Button size="small" type="text" icon={<CheckCircle2 className="size-3.5" />} disabled={disabled} onClick={() => onUpdateStatus(check.id, "accepted")}>接受建议</Button> : null}
                {check.status !== "ignored" ? <Button size="small" type="text" disabled={disabled} onClick={() => onUpdateStatus(check.id, "ignored")}>忽略</Button> : null}
                {check.status === "accepted" ? <Button size="small" type="text" disabled={disabled} onClick={() => onUpdateStatus(check.id, "resolved")}>标记已解决</Button> : null}
                {check.episodeNumbers.length === 1 ? <Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} disabled={disabled} onClick={() => onRegenerateFromCheck(check)}>按建议重生成该集</Button> : null}
            </div>
        </article>
    );
}
