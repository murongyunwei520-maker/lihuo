import { Empty, Input, Tag } from "antd";
import { Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { StudioNovel } from "@/types/novel";

import { stripChapterTitle } from "@/lib/studio/novel-chapters";
import { StudioPanel } from "../ui";

export function NovelReader({ novel }: { novel: StudioNovel }) {
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query.trim());
    const [chapterId, setChapterId] = useState(novel.chapters[0]?.id ?? "");
    useEffect(() => {
        setChapterId(novel.chapters[0]?.id ?? "");
    }, [novel.id]);
    const selected = novel.chapters.find((chapter) => chapter.id === chapterId) ?? novel.chapters[0];
    const searchResults = useMemo(() => {
        if (deferredQuery.length < 2) return [];
        const results: { chapterId: string; chapterNo: number; title: string; excerpt: string }[] = [];
        for (const chapter of novel.chapters) {
            const normalized = chapter.text.replace(/\s+/g, " ");
            let index = normalized.toLowerCase().indexOf(deferredQuery.toLowerCase());
            while (index >= 0 && results.length < 120) {
                results.push({
                    chapterId: chapter.id,
                    chapterNo: chapter.no,
                    title: chapter.title || `第 ${chapter.no} 章`,
                    excerpt: normalized.slice(Math.max(0, index - 70), index + deferredQuery.length + 90),
                });
                index = normalized.toLowerCase().indexOf(deferredQuery.toLowerCase(), index + deferredQuery.length + 1);
            }
            if (results.length >= 120) break;
        }
        return results;
    }, [deferredQuery, novel.chapters]);

    if (!selected) return null;
    return (
        <StudioPanel title="原文与章节" extra={<Tag bordered={false}>{novel.chapterCount} 章 · {novel.charCount.toLocaleString()} 字</Tag>}>
            <div className="novel-reader">
                <aside className="novel-reader__nav">
                    <Input
                        allowClear
                        prefix={<Search className="size-3.5" />}
                        placeholder="全书搜索（至少 2 个字）"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    {deferredQuery.length >= 2 ? (
                        <div className="novel-reader__results">
                            <span className="novel-reader__result-count">{searchResults.length >= 120 ? "120+" : searchResults.length} 处匹配</span>
                            {searchResults.map((result, index) => (
                                <button key={`${result.chapterId}-${index}`} onClick={() => setChapterId(result.chapterId)}>
                                    <strong>第 {result.chapterNo} 章 · {result.title}</strong>
                                    <span>…{result.excerpt}…</span>
                                </button>
                            ))}
                            {!searchResults.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配" /> : null}
                        </div>
                    ) : (
                        <div className="novel-reader__chapters">
                            {novel.preamble ? <p className="novel-reader__preamble">标题前内容：{novel.preamble.length} 字</p> : null}
                            {novel.chapters.map((chapter) => (
                                <button key={chapter.id} className={chapter.id === selected.id ? "is-active" : ""} onClick={() => setChapterId(chapter.id)}>
                                    <span>{String(chapter.no).padStart(2, "0")}</span>
                                    <strong>{chapter.title || "无标题章节"}</strong>
                                    <small>{chapter.text.length} 字</small>
                                </button>
                            ))}
                        </div>
                    )}
                </aside>
                <article className="novel-reader__content">
                    <header>
                        <span>第 {selected.no} 章</span>
                        <h3>{selected.title || "无标题章节"}</h3>
                        <small>{selected.text.length.toLocaleString()} 字{selected.pageStart ? ` · PDF 第 ${selected.pageStart}${selected.pageEnd && selected.pageEnd !== selected.pageStart ? `–${selected.pageEnd}` : ""} 页` : ""}</small>
                    </header>
                    {novel.preamble && selected.no === 1 ? <div className="novel-reader__frontmatter">{novel.preamble}</div> : null}
                    <pre>{stripChapterTitle(selected)}</pre>
                </article>
            </div>
        </StudioPanel>
    );
}
