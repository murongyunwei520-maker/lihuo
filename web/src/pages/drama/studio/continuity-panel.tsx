import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Empty, Input, Select } from "antd";
import { AlertTriangle, ArrowLeftRight, CircleDot, Info, LoaderCircle, Play, ScanSearch, StopCircle, Target } from "lucide-react";

import type {
    StudioContinuityCheckReport,
    StudioContinuityFinding,
    StudioScriptDocument,
    StudioStoryboardDocument,
} from "@/types/studio-production";
import type { StudioStoryboardReviewAnalysis } from "@/lib/studio/review-engine";
import {
    STUDIO_CONTINUITY_RULES,
    runContinuityCheckAsync,
    type StudioContinuityScope,
} from "@/lib/studio/continuity-engine";
import type { Stage4ReviewActionResult } from "@/lib/studio/review-actions";
import { groupNoLabel, sceneTitleOf, shotLabel } from "./review-shared";
import "./continuity.css";

const SEVERITY_LABEL = { error: "Error", warning: "Warning", suggestion: "Suggestion" } as const;
const CONFIDENCE_LABEL = { high: "高置信度", medium: "中置信度", low: "低置信度" } as const;
const SCOPE_LABEL = { episode: "整集", scene: "单场景", group: "单镜头组", shot: "单镜头上下文" } as const;

type ProgressState = { checked: number; total: number; phase: "idle" | "checking" | "done" | "cancelled" };

export function ContinuityPanel({
    open,
    document,
    script,
    analysis,
    busy,
    onClose,
    onCommit,
    onLocate,
}: {
    open: boolean;
    document?: StudioStoryboardDocument;
    script?: StudioScriptDocument;
    analysis?: StudioStoryboardReviewAnalysis;
    busy: boolean;
    onClose: () => void;
    onCommit: (scope: StudioContinuityScope, report: StudioContinuityCheckReport) => Promise<Stage4ReviewActionResult>;
    onLocate: (shotId: string) => void;
}) {
    const { message } = App.useApp();
    const [scopeType, setScopeType] = useState<StudioContinuityScope["type"]>("episode");
    const [scopeId, setScopeId] = useState<string>();
    const [severityFilter, setSeverityFilter] = useState("all");
    const [sceneFilter, setSceneFilter] = useState("all");
    const [groupFilter, setGroupFilter] = useState("all");
    const [ruleFilter, setRuleFilter] = useState("all");
    const [shotQuery, setShotQuery] = useState("");
    const [preview, setPreview] = useState<StudioContinuityCheckReport>();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<ProgressState>({ checked: 0, total: 0, phase: "idle" });
    const abortRef = useRef<AbortController | undefined>(undefined);
    const mountedRef = useRef(true);
    const inFlightRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
        };
    }, []);

    const report = preview ?? analysis?.continuity;
    const review = analysis?.review;
    const runs = review?.continuityRuns ?? [];
    const staleIssues = analysis?.issues.filter((issue) => issue.continuityStale) ?? [];

    const sceneOptions = useMemo(() => {
        if (!document) return [];
        return [...new Set(document.shots.map((shot) => shot.sceneId))].map((sceneId) => ({
            value: sceneId,
            label: document.groups.find((group) => group.sceneId === sceneId)?.sceneTitle || sceneId,
        }));
    }, [document]);

    const groupOptions = useMemo(() => (document ? document.groups.map((group) => ({ value: group.shotGroupId, label: `${groupNoLabel(document, group)} · ${group.sceneTitle}` })) : []), [document]);
    const shotOptions = useMemo(() => (document ? [...document.shots].sort((left, right) => left.shotNumber - right.shotNumber).map((shot) => ({ value: shot.shotId, label: shotLabel(shot) })) : []), [document]);
    const ruleOptions = useMemo(() => STUDIO_CONTINUITY_RULES.map((rule) => ({ value: rule.id, label: `${rule.title}（${rule.id}）` })), []);

    useEffect(() => {
        if (!open) {
            abortRef.current?.abort();
            setRunning(false);
            setProgress({ checked: 0, total: 0, phase: "idle" });
            return;
        }
        setPreview(undefined);
        setProgress({ checked: 0, total: 0, phase: "idle" });
    }, [open]);

    useEffect(() => {
        if (!document) {
            setScopeId(undefined);
            return;
        }
        const first = scopeType === "scene" ? sceneOptions[0]?.value : scopeType === "group" ? groupOptions[0]?.value : scopeType === "shot" ? shotOptions[0]?.value : undefined;
        setScopeId((current) => {
            const options = scopeType === "scene" ? sceneOptions : scopeType === "group" ? groupOptions : scopeType === "shot" ? shotOptions : [];
            if (current && options.some((option) => option.value === current)) return current;
            return first;
        });
    }, [document, groupOptions, sceneOptions, scopeType, shotOptions]);

    const scope = useMemo<StudioContinuityScope>(() => (scopeType === "episode" ? { type: "episode" } : { type: scopeType, id: scopeId }), [scopeId, scopeType]);

    const findings = useMemo(() => {
        const list = report?.findings ?? [];
        return list.filter((finding) => {
            if (severityFilter !== "all" && finding.severity !== severityFilter) return false;
            if (sceneFilter !== "all" && finding.sceneId !== sceneFilter) return false;
            if (groupFilter !== "all" && finding.shotGroupId !== groupFilter) return false;
            if (ruleFilter !== "all" && finding.ruleId !== ruleFilter) return false;
            if (shotQuery.trim()) {
                const query = shotQuery.trim();
                const matched = finding.shotIds.some((shotId) => {
                    const shot = document?.shots.find((item) => item.shotId === shotId);
                    return shot ? String(shot.shotNumber).includes(query) : shotId.includes(query);
                });
                if (!matched) return false;
            }
            return true;
        });
    }, [document, groupFilter, report?.findings, ruleFilter, sceneFilter, severityFilter, shotQuery]);

    const contextRows = useMemo(() => {
        if (!document) return [];
        const ordered = [...document.shots].sort((left, right) => left.shotNumber - right.shotNumber);
        const ids = new Set<string>();
        for (const finding of findings) {
            for (const shotId of finding.shotIds) {
                const index = ordered.findIndex((shot) => shot.shotId === shotId);
                if (index < 0) continue;
                for (let cursor = Math.max(0, index - 1); cursor <= Math.min(ordered.length - 1, index + 1); cursor += 1) ids.add(ordered[cursor].shotId);
            }
        }
        return ordered.filter((shot) => ids.has(shot.shotId));
    }, [document, findings]);

    async function startCheck() {
        if (!document || !scopeId && scopeType !== "episode" || running || busy || inFlightRef.current) return;
        inFlightRef.current = true;
        setRunning(true);
        setPreview(undefined);
        setProgress({ checked: 0, total: 0, phase: "checking" });
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const result = await runContinuityCheckAsync({
                document,
                script,
                scope,
                signal: controller.signal,
                batchSize: 12,
                onProgress: (value) => setProgress({ checked: value.checkedPairs, total: value.totalPairs, phase: value.phase }),
            });
            if (result.cancelled || controller.signal.aborted || !mountedRef.current) {
                setProgress((current) => ({ ...current, phase: "cancelled" }));
                message.info("连续性检查已取消，未写入检查记录");
                return;
            }
            setPreview(result.report);
            setProgress({ checked: result.report.checkedPairs, total: result.report.totalPairs, phase: "done" });
            if (result.report.storyboardVersion !== document.storyboardVersion || result.report.episodeId !== document.episodeId) {
                message.error("当前正式分镜在检查期间发生变化，旧结果未写入；请重新检查");
                return;
            }
            const commit = await onCommit(scope, result.report);
            if (!commit.ok) {
                message.error(commit.error || "连续性检查写入失败");
                return;
            }
            message.success(`连续性检查完成并写入本地数据库：${result.report.counts.error} Error / ${result.report.counts.warning} Warning / ${result.report.counts.insufficient} 信息不足`);
        } catch (error) {
            setProgress((current) => ({ ...current, phase: "idle" }));
            message.error(error instanceof Error ? error.message : "连续性检查执行失败，未写入检查记录");
        } finally {
            inFlightRef.current = false;
            setRunning(false);
            abortRef.current = undefined;
        }
    }

    function cancelCheck() {
        abortRef.current?.abort();
    }

    function locateFinding(finding: StudioContinuityFinding) {
        const shotId = finding.shotIds.at(-1);
        if (!shotId) return;
        onLocate(shotId);
        onClose();
    }

    function contextFor(finding: StudioContinuityFinding) {
        if (!document) return [];
        const ordered = [...document.shots].sort((left, right) => left.shotNumber - right.shotNumber);
        const range = new Set<string>();
        for (const shotId of finding.shotIds) {
            const index = ordered.findIndex((shot) => shot.shotId === shotId);
            if (index < 0) continue;
            for (let cursor = Math.max(0, index - 1); cursor <= Math.min(ordered.length - 1, index + 1); cursor += 1) range.add(ordered[cursor].shotId);
        }
        return ordered.filter((shot) => range.has(shot.shotId));
    }

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={620}
            className="stage4c-continuity-drawer"
            title={<span className="stage4c-drawer-title"><ScanSearch className="size-4" /> 连续性检查</span>}
        >
            <div className="stage4c-panel">
                {!document ? (
                    <Empty description="本集还没有正式分镜" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                    <>
                        <section className="stage4c-scope">
                            <div className="stage4c-scope__row">
                                <Select
                                    size="small"
                                    value={scopeType}
                                    onChange={(value) => setScopeType(value)}
                                    options={Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label }))}
                                />
                                {scopeType !== "episode" ? (
                                    <Select
                                        size="small"
                                        value={scopeId}
                                        placeholder="选择检查对象"
                                        onChange={setScopeId}
                                        options={scopeType === "scene" ? sceneOptions : scopeType === "group" ? groupOptions : shotOptions}
                                    />
                                ) : <span className="stage4c-scope__hint">检查整集所有相邻镜头与跨组 / 跨场景边界</span>}
                                <Button size="small" type="primary" icon={running ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} onClick={startCheck} disabled={running || busy}>
                                    运行检查
                                </Button>
                                {running ? <Button size="small" danger icon={<StopCircle className="size-3.5" />} onClick={cancelCheck}>取消</Button> : null}
                            </div>
                            <div className="stage4c-progress">
                                {progress.phase === "checking" ? `检查中 ${progress.checked} / ${progress.total || "…"} 对镜头` : progress.phase === "done" ? `已检查 ${progress.checked} 对镜头` : progress.phase === "cancelled" ? "已取消" : "检查范围按依赖关系确定；不会默认重查整部剧。"}
                            </div>
                        </section>

                        <section className="stage4c-counts">
                            <CountCard tone="error" label="Error" value={report?.counts.error ?? 0} />
                            <CountCard tone="warning" label="Warning" value={report?.counts.warning ?? 0} />
                            <CountCard tone="suggestion" label="Suggestion" value={report?.counts.suggestion ?? 0} />
                            <CountCard tone="muted" label="信息不足" value={report?.counts.insufficient ?? 0} />
                        </section>

                        <section className="stage4c-affected">
                            <div className="stage4c-section-head"><strong>受影响镜头</strong><small>{report?.affectedShotIds.length ?? 0} 镜 · 已检查 {report?.checkedShots ?? 0} 镜 / {report?.checkedPairs ?? 0} 对</small></div>
                            <div className="stage4c-chips">
                                {(report?.affectedShotIds ?? []).map((shotId) => {
                                    const shot = document.shots.find((item) => item.shotId === shotId);
                                    return shot ? <button type="button" key={shotId} className="stage4c-chip" onClick={() => { onLocate(shotId); onClose(); }}>{shotLabel(shot)}</button> : null;
                                })}
                                {!report?.affectedShotIds.length ? <span className="stage4c-muted">未发现受影响镜头</span> : null}
                            </div>
                        </section>

                        <section className="stage4c-filters">
                            <Select size="small" value={severityFilter} onChange={setSeverityFilter} options={[
                                { value: "all", label: "全部等级" },
                                { value: "error", label: "Error" },
                                { value: "warning", label: "Warning" },
                                { value: "suggestion", label: "Suggestion" },
                            ]} />
                            <Select size="small" value={sceneFilter} onChange={setSceneFilter} options={[{ value: "all", label: "全部场景" }, ...sceneOptions]} />
                            <Select size="small" value={groupFilter} onChange={setGroupFilter} options={[{ value: "all", label: "全部镜头组" }, ...groupOptions]} />
                            <Select size="small" value={ruleFilter} onChange={setRuleFilter} options={[{ value: "all", label: "全部问题类型" }, ...ruleOptions]} />
                            <Input size="small" allowClear placeholder="按镜号筛选" value={shotQuery} onChange={(event) => setShotQuery(event.target.value)} />
                        </section>

                        <section className="stage4c-findings">
                            <div className="stage4c-section-head"><strong>检查问题</strong><small>{findings.length} / {report?.findings.length ?? 0} 条</small></div>
                            {findings.map((finding, index) => {
                                const rule = STUDIO_CONTINUITY_RULES.find((item) => item.id === finding.ruleId);
                                return (
                                    <article key={`${finding.ruleId}-${finding.shotIds.join("-")}-${finding.fieldPath}-${index}`} className={`stage4c-finding is-${finding.severity}`}>
                                        <header>
                                            <span className="stage4c-severity">{SEVERITY_LABEL[finding.severity]}</span>
                                            <strong>{rule?.title ?? finding.ruleId}</strong>
                                            <span className="stage4c-confidence">{CONFIDENCE_LABEL[finding.confidence]}</span>
                                        </header>
                                        <div className="stage4c-rule-id">{finding.ruleId} · {finding.fieldPath}{rule?.description ? ` · ${rule.description}` : ""}</div>
                                        <div className="stage4c-evidence"><span>证据</span>{finding.evidence}</div>
                                        <div className="stage4c-reason">{finding.reason}</div>
                                        <div className="stage4c-suggestion"><span>修正建议</span>{finding.suggestion}</div>
                                        <div className="stage4c-finding__shots">
                                            <ArrowLeftRight className="size-3.5" />
                                            {finding.shotIds.map((shotId) => {
                                                const shot = document.shots.find((item) => item.shotId === shotId);
                                                return shot ? <button type="button" key={shotId} onClick={() => { onLocate(shotId); onClose(); }}>{shotLabel(shot)}</button> : null;
                                            })}
                                            <Button size="small" type="link" icon={<Target className="size-3.5" />} onClick={() => locateFinding(finding)}>定位镜头</Button>
                                        </div>
                                        <div className="stage4c-context">
                                            {contextFor(finding).map((shot) => (
                                                <button type="button" key={shot.shotId} className="stage4c-context-row" onClick={() => { onLocate(shot.shotId); onClose(); }}>
                                                    <b>{shotLabel(shot)}</b>
                                                    <span>{shot.action || shot.characterBlocking || "未填写动作"}</span>
                                                    <small>{sceneTitleOf(document, shot)}</small>
                                                </button>
                                            ))}
                                        </div>
                                    </article>
                                );
                            })}
                            {!findings.length ? <div className="stage4c-empty"><Info className="size-4" /> 当前筛选下没有连续性问题；信息不足项在计数中单独展示，不当作确定错误。</div> : null}
                        </section>

                        <section className="stage4c-context-all">
                            <div className="stage4c-section-head"><strong>前后镜头上下文</strong><small>按镜号排序，点击进入单镜审片</small></div>
                            <div className="stage4c-context-list">
                                {contextRows.map((shot) => (
                                    <button type="button" key={shot.shotId} className="stage4c-context-row" onClick={() => { onLocate(shot.shotId); onClose(); }}>
                                        <b>{shotLabel(shot)}</b>
                                        <span>{shot.action || shot.characterBlocking || "未填写动作"}</span>
                                        <small>{sceneTitleOf(document, shot)}</small>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="stage4c-runs">
                            <div className="stage4c-section-head"><strong>检查记录</strong><small>只保留摘要，正式分镜版本变化后旧结果标记 stale</small></div>
                            {runs.slice(0, 5).map((run) => (
                                <div key={run.id} className="stage4c-run">
                                    <b>v{run.storyboardVersion}</b>
                                    <span>{SCOPE_LABEL[run.scope.type]}{run.scope.id ? ` · ${run.scope.id}` : ""}</span>
                                    <span>{run.checkedPairs} 对 · {run.counts.error} Error / {run.counts.warning} Warning</span>
                                    <small>{new Date(run.checkedAt).toLocaleString()}</small>
                                </div>
                            ))}
                            {!runs.length ? <div className="stage4c-muted">还没有检查记录；运行后写入现有审核历史。</div> : null}
                            {staleIssues.length ? (
                                <div className="stage4c-stale">
                                    <div><AlertTriangle className="size-3.5" /> {staleIssues.length} 条旧连续性问题已标记 stale，不再是当前 open 问题</div>
                                    <span>{staleIssues.slice(0, 3).map((issue) => issue.message).join("；")}</span>
                                </div>
                            ) : null}
                        </section>

                        <section className="stage4c-note">
                            <CircleDot className="size-3.5" /> 连续性检查只写入审核问题，不自动修改正式分镜；锁定不等于审核通过。
                        </section>
                    </>
                )}
            </div>
        </Drawer>
    );
}

function CountCard({ tone, label, value }: { tone: "error" | "warning" | "suggestion" | "muted"; label: string; value: number }) {
    return <div className={`stage4c-count is-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}
