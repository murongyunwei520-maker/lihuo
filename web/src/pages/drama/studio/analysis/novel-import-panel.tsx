import { Alert, Button, Progress, Tag, Upload } from "antd";
import { FileText, RefreshCw, Trash2, UploadCloud } from "lucide-react";

import type { NovelImportProgress, StudioNovel } from "@/types/novel";
import { NOVEL_IMPORT_MAX_BYTES, NOVEL_SOURCE_FORMAT_LABEL } from "@/types/novel";

import { StudioPanel } from "../ui";

export function NovelImportPanel({
    novel,
    importing,
    progress,
    error,
    onFile,
    onPaste,
    onDelete,
    onDismiss,
}: {
    novel?: StudioNovel;
    importing: boolean;
    progress: NovelImportProgress | null;
    error: string;
    onFile: (file: File) => void;
    onPaste: () => void;
    onDelete: () => void;
    onDismiss?: () => void;
}) {
    const ready = novel?.status === "ready" && novel.chapterCount > 0;
    return (
        <StudioPanel
            title="小说原文"
            extra={novel ? <Tag bordered={false} color={ready ? "success" : novel.status === "failed" ? "error" : "processing"}>{ready ? "原文就绪" : novel.status === "failed" ? "解析失败" : "解析中"}</Tag> : "支持 TXT / DOCX / PDF / 粘贴"}
        >
            {novel ? (
                <div className="novel-file">
                    <div className="novel-file__head">
                        <div className="novel-file__icon"><FileText className="size-5" /></div>
                        <div className="novel-file__meta">
                            <strong>{novel.file.name}</strong>
                            <span>
                                {NOVEL_SOURCE_FORMAT_LABEL[novel.file.format]} · {(novel.file.bytes / 1024).toFixed(1)} KB · {novel.chapterCount} 章 · {novel.charCount.toLocaleString()} 字
                            </span>
                            <span>{novel.encoding} · 解析器 {novel.parserVersion} · {new Date(novel.updatedAt).toLocaleString()}</span>
                        </div>
                        <div className="novel-file__actions">
                            <Upload
                                accept=".txt,.docx,.pdf"
                                maxCount={1}
                                showUploadList={false}
                                disabled={importing}
                                beforeUpload={(file) => {
                                    onFile(file);
                                    return false;
                                }}
                            >
                                <Button size="small" icon={<RefreshCw className="size-3.5" />} disabled={importing}>替换</Button>
                            </Upload>
                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={importing} onClick={onDelete}>删除</Button>
                        </div>
                    </div>
                    {novel.error ? <Alert type="error" showIcon message="解析失败" description={novel.error} /> : null}
                    {novel.warnings.length ? (
                        <div className="novel-file__warnings">
                            {novel.warnings.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
                            {novel.warnings.length > 4 ? <span>另有 {novel.warnings.length - 4} 条提示，见解析详情</span> : null}
                        </div>
                    ) : null}
                </div>
            ) : (
                <Upload.Dragger
                    accept=".txt,.docx,.pdf"
                    multiple={false}
                    maxCount={1}
                    showUploadList={false}
                    disabled={importing}
                    beforeUpload={(file) => {
                        onFile(file);
                        return false;
                    }}
                    className="novel-drop"
                >
                    <p className="novel-drop__icon"><UploadCloud className="size-7" /></p>
                    <p className="novel-drop__title">拖入小说文件，或点击选择</p>
                    <p className="novel-drop__hint">TXT / DOCX / PDF，单文件不超过 {NOVEL_IMPORT_MAX_BYTES / 1024 / 1024} MB；也可以直接粘贴正文。</p>
                </Upload.Dragger>
            )}
            {importing && progress ? (
                <div className="novel-progress">
                    <Progress percent={progress.percent} size="small" status="active" />
                    <span>{progress.message}</span>
                </div>
            ) : null}
            {error ? <Alert type="error" showIcon message="导入未完成" description={error} closable onClose={onDismiss} /> : null}
            <div className="novel-import-foot">
                <Button disabled={importing} onClick={onPaste}>粘贴小说正文</Button>
                <span>原文只保存一份；AI 分析不会覆盖或改写原文。</span>
            </div>
        </StudioPanel>
    );
}
