import { Tag, Tooltip } from "antd";
import { BookMarked, CircleAlert } from "lucide-react";

import type { NovelEvidence, StudioNovel } from "@/types/novel";
import { NOVEL_EVIDENCE_TYPE_LABEL } from "@/types/novel";

export function chapterLabel(novel: StudioNovel, chapterId: string) {
    const chapter = novel.chapters.find((item) => item.id === chapterId);
    return chapter ? `第 ${chapter.no} 章${chapter.title ? ` · ${chapter.title}` : ""}` : "章节未识别";
}

export function EvidenceList({ evidence }: { evidence: NovelEvidence[] }) {
    if (!evidence.length) return <span className="novel-evidence-empty"><CircleAlert className="size-3.5" /> 没有可用证据，需人工核对</span>;
    return (
        <div className="novel-evidence">
            {evidence.map((item, index) => (
                <div key={`${item.chapterId}-${index}`} className="novel-evidence__item">
                    <div className="novel-evidence__head">
                        <Tag bordered={false} color={item.evidenceType === "explicit" ? "green" : item.evidenceType === "inferred" ? "orange" : "default"}>{NOVEL_EVIDENCE_TYPE_LABEL[item.evidenceType]}</Tag>
                        <strong>{item.chapterTitle}</strong>
                        <span>置信度 {(item.confidence * 100).toFixed(0)}%</span>
                    </div>
                    {item.excerpt ? <blockquote>{item.excerpt}</blockquote> : <p className="novel-evidence__missing">模型未提供原文摘录</p>}
                    <small>{item.sourceLocation.label ?? ""}{item.sourceLocation.page ? ` · PDF 第 ${item.sourceLocation.page} 页` : ""}{item.sourceLocation.charStart !== undefined ? ` · 字符 ${item.sourceLocation.charStart}–${item.sourceLocation.charEnd ?? item.sourceLocation.charStart}` : ""}</small>
                </div>
            ))}
        </div>
    );
}

export function WarningList({ warnings, limit = 8 }: { warnings: string[]; limit?: number }) {
    if (!warnings.length) return null;
    return (
        <div className="novel-warnings">
            <div className="novel-warnings__head"><BookMarked className="size-4" /><strong>审校提示</strong><span>{warnings.length}</span></div>
            {warnings.slice(0, limit).map((warning, index) => (
                <p key={`${warning}-${index}`}>{warning}</p>
            ))}
            {warnings.length > limit ? <small>另有 {warnings.length - limit} 条，请查看分析任务与证据详情。</small> : null}
        </div>
    );
}

export function ManualTag({ edited, onReset }: { edited: boolean; onReset?: () => void }) {
    if (!edited) return <Tag bordered={false}>AI 结果</Tag>;
    return (
        <Tooltip title="人工修正优先于后续 AI 分析">
            <Tag bordered={false} color="purple" onClick={onReset} style={onReset ? { cursor: "pointer" } : undefined}>人工修正{onReset ? " · 恢复 AI 原值" : ""}</Tag>
        </Tooltip>
    );
}
