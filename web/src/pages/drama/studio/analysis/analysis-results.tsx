import { Button, Drawer, Empty, Input, Progress, Select, Statistic, Table, Tag } from "antd";
import { ArrowRight, BookOpenText, CalendarClock, Edit3, MapPin, Network, ShieldAlert, Users } from "lucide-react";
import { useMemo, useState } from "react";

import type { NovelAnalysis, NovelAnalysisOverrides, NovelCharacter, NovelEvent, NovelForeshadowing, NovelRelationship, NovelScene, NovelWorldEntry, StudioNovel } from "@/types/novel";
import { NOVEL_EVIDENCE_TYPE_LABEL } from "@/types/novel";
import type { StudioProject } from "@/types/studio";

import { overrideCount } from "@/lib/studio/novel-merge";
import { EvidenceList, ManualTag, WarningList, chapterLabel } from "./analysis-evidence";
import {
    CHARACTER_FIELDS,
    EVENT_FIELDS,
    EntityEditModal,
    FORESHADOWING_FIELDS,
    PROFILE_FIELDS,
    RELATIONSHIP_FIELDS,
    SCENE_FIELDS,
    WORLD_ENTRY_FIELDS,
    WORLD_FIELDS,
    formPatch,
} from "./analysis-editors";
import { StudioPanel, StudioStat } from "../ui";

export type OverrideKind = "profile" | "characters" | "relationships" | "world" | "scenes" | "events" | "foreshadowings";
export type SaveOverride = (kind: OverrideKind, id: string, patch: Record<string, unknown>) => void;
export type ResetOverride = (kind: OverrideKind, id: string) => void;

type SectionProps = {
    project: StudioProject;
    novel: StudioNovel;
    analysis: NovelAnalysis;
    overrides: NovelAnalysisOverrides | undefined;
    saveOverride: SaveOverride;
    resetOverride: ResetOverride;
};

function isEdited(kind: OverrideKind, id: string, overrides: NovelAnalysisOverrides | undefined) {
    if (!overrides) return false;
    if (kind === "profile" || kind === "world") return Boolean(overrides[kind]);
    const map = overrides[kind] as Record<string, unknown> | undefined;
    return Boolean(map?.[id]);
}

function analysisMeta(analysis: NovelAnalysis, overrides: NovelAnalysisOverrides | undefined) {
    return (
        <div className="novel-analysis-meta">
            <span>v{analysis.version}</span>
            <span>{analysis.model.label}</span>
            <span>{analysis.status === "complete" ? "完整" : "部分完成"}</span>
            <span>{analysis.stats.evidenceCount} 条证据</span>
            {overrideCount(overrides) ? <Tag bordered={false} color="purple">{overrideCount(overrides)} 处人工修正</Tag> : null}
        </div>
    );
}

export function AnalysisEmpty({ onStart }: { onStart?: () => void }) {
    return (
        <StudioPanel title="原著档案" extra="尚未生成">
            <div className="novel-analysis-empty">
                <BookOpenText className="size-8" />
                <strong>原文已就绪，等待 AI 分析</strong>
                <p>不会先填入空人物、空关系或伪造的伏笔。分析完成后，每个关键结论都会带章节与原文证据。</p>
                {onStart ? <Button type="primary" onClick={onStart}>开始原著分析</Button> : null}
            </div>
        </StudioPanel>
    );
}

export function OverviewSection({ analysis, novel, overrides, saveOverride, resetOverride, onStart }: SectionProps & { onStart?: () => void }) {
    const [editOpen, setEditOpen] = useState(false);
    const profile = analysis.profile;
    return (
        <div className="novel-overview">
            <StudioPanel title="小说基本信息" extra={analysisMeta(analysis, overrides)}>
                <div className="novel-overview__hero">
                    <div>
                        <h3>{profile.title || "未命名小说"}</h3>
                        <p>{profile.mainline || "主线尚未明确"}</p>
                        <div className="novel-overview__tags">
                            {[profile.author && `作者：${profile.author}`, profile.genre, profile.worldType, profile.era].filter(Boolean).map((item) => <Tag bordered={false} key={String(item)}>{item}</Tag>)}
                            <ManualTag edited={isEdited("profile", "", overrides)} />
                        </div>
                    </div>
                    <div className="novel-overview__completeness">
                        <Progress type="circle" size={86} percent={profile.completeness} />
                        <span>{profile.analyzedChapters}/{profile.totalChapters} 章有分析覆盖</span>
                    </div>
                </div>
                <div className="novel-overview__stats">
                    <StudioStat label="人物" value={analysis.characters.length} />
                    <StudioStat label="关系" value={analysis.relationships.length} />
                    <StudioStat label="世界观条目" value={analysis.world.entries.length} />
                    <StudioStat label="地点" value={analysis.scenes.length} />
                    <StudioStat label="事件" value={analysis.events.length} />
                    <StudioStat label="伏笔" value={analysis.foreshadowings.length} />
                </div>
                <dl className="novel-overview__facts">
                    <div><dt>核心矛盾</dt><dd>{profile.coreConflict || "原著未明确"}</dd></div>
                    <div><dt>主要地点</dt><dd>{profile.mainLocations.length ? profile.mainLocations.join("、") : "未明确"}</dd></div>
                    <div><dt>分析覆盖</dt><dd>{analysis.stats.chunks} 个分块 · {analysis.stats.calls} 次调用 · v{analysis.version}</dd></div>
                </dl>
                <div className="novel-section-actions">
                    <Button icon={<Edit3 className="size-4" />} onClick={() => setEditOpen(true)}>审核并修正基本信息</Button>
                    {isEdited("profile", "", overrides) ? <Button onClick={() => resetOverride("profile", "")}>恢复 AI 原值</Button> : null}
                </div>
            </StudioPanel>
            <WarningList warnings={analysis.warnings} />
            <StudioPanel title="数据可信度" extra="不接受无证据关系">
                <div className="novel-overview__confidence">
                    <>显式证据 {analysis.stats.explicitCount}</>
                    <>推断证据 {analysis.stats.inferredCount}</>
                    <>AI 生成 {analysis.stats.generatedCount}</>
                </div>
                <ul className="novel-analysis-rules">
                    <li>人物、事件、伏笔的证据摘录保留章节和字符位置；人物关系缺少证据时在分析阶段直接丢弃。</li>
                    <li>AI 推断的回收章节标注为“推断”，不会伪装成原著事实；未确定值保持为空。</li>
                    <li>人工修正与 AI 结果分开保存，重新分析不会静默覆盖；若实体 ID 消失，人工修正会保留但暂不显示。</li>
                </ul>
            </StudioPanel>
            <EntityEditModal
                open={editOpen}
                title="修正小说基本信息"
                description="人工修正优先于后续 AI 汇总；无法确定的信息请留空，不要补写。"
                fields={PROFILE_FIELDS}
                value={profile as unknown as Record<string, unknown>}
                novel={novel}
                manual={isEdited("profile", "", overrides)}
                onSave={(draft) => saveOverride("profile", "", formPatch(PROFILE_FIELDS, draft))}
                onReset={() => resetOverride("profile", "")}
                onClose={() => setEditOpen(false)}
            />
        </div>
    );
}

export function CharactersSection({ analysis, novel, overrides, saveOverride, resetOverride }: SectionProps) {
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<NovelCharacter | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return analysis.characters;
        return analysis.characters.filter((character) => [character.name, character.identity, character.aliases.join(" "), character.occupation].join(" ").toLowerCase().includes(query));
    }, [analysis.characters, search]);

    return (
        <StudioPanel title="人物档案" extra={<Tag bordered={false}>{analysis.characters.length} 人 · 身份与服装造型分开保存</Tag>}>
            <div className="novel-toolbar">
                <Input allowClear placeholder="搜索姓名、别名、身份、职业" value={search} onChange={(event) => setSearch(event.target.value)} />
                <span>{filtered.length} / {analysis.characters.length}</span>
            </div>
            {filtered.length ? (
                <div className="novel-character-grid">
                    {filtered.map((character) => (
                        <button key={character.id} className="novel-character-card" onClick={() => setSelected(character)}>
                            <div className="novel-character-card__head">
                                <div className="novel-avatar">{character.name.slice(0, 1)}</div>
                                <div><strong>{character.name}</strong><span>{character.identity || "身份未明确"}</span></div>
                                <ManualTag edited={isEdited("characters", character.id, overrides)} />
                            </div>
                            <p>{character.personality || character.motivation || "性格/动机尚未明确"}</p>
                            <div className="novel-character-card__meta">
                                <span>{chapterLabel(novel, character.firstChapterId)}</span>
                                <span>{character.evidence.length} 条证据</span>
                                <Tag bordered={false}>{character.status === "unknown" ? "状态未知" : character.status}</Tag>
                            </div>
                        </button>
                    ))}
                </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配人物" />}
            <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} width={620} title={selected ? `${selected.name} · 人物档案` : ""} extra={selected ? <Button icon={<Edit3 className="size-4" />} onClick={() => setEditOpen(true)}>修正</Button> : null}>
                {selected ? <CharacterDetail character={selected} novel={novel} edited={isEdited("characters", selected.id, overrides)} onReset={() => { resetOverride("characters", selected.id); setSelected(null); }} /> : null}
            </Drawer>
            {selected ? (
                <EntityEditModal
                    open={editOpen}
                    title={`修正人物 · ${selected.name}`}
                    description="只修身份与稳定特征，不在这里填写服装造型；服装属于后续资产阶段。"
                    fields={CHARACTER_FIELDS}
                    value={selected as unknown as Record<string, unknown>}
                    novel={novel}
                    manual={isEdited("characters", selected.id, overrides)}
                    onSave={(draft) => { saveOverride("characters", selected.id, formPatch(CHARACTER_FIELDS, draft)); setSelected({ ...selected, ...formPatch(CHARACTER_FIELDS, draft) } as NovelCharacter); }}
                    onReset={() => resetOverride("characters", selected.id)}
                    onClose={() => setEditOpen(false)}
                />
            ) : null}
        </StudioPanel>
    );
}

function CharacterDetail({ character, novel, edited, onReset }: { character: NovelCharacter; novel: StudioNovel; edited: boolean; onReset: () => void }) {
    return (
        <div className="novel-detail">
            <div className="novel-detail__tags">
                <Tag bordered={false} color="blue">{character.status}</Tag>
                {character.aliases.map((alias) => <Tag bordered={false} key={alias}>别名：{alias}</Tag>)}
                {edited ? <Tag bordered={false} color="purple" onClick={onReset} style={{ cursor: "pointer" }}>人工修正 · 恢复 AI 原值</Tag> : null}
            </div>
            <dl className="novel-detail__facts">
                {[
                    ["身份", character.identity], ["年龄", character.age], ["性格", character.personality], ["外貌", character.appearance], ["能力", character.abilities], ["职业/地位", character.occupation], ["动机", character.motivation], ["成长轨迹", character.arc], ["关键状态", character.fate],
                ].filter(([, value]) => Boolean(value)).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                <div><dt>首次出场</dt><dd>{chapterLabel(novel, character.firstChapterId)}</dd></div>
                <div><dt>重要章节</dt><dd>{character.keyChapterIds.length ? character.keyChapterIds.map((id) => chapterLabel(novel, id)).join("、") : "未明确"}</dd></div>
            </dl>
            <h4>证据来源</h4>
            <EvidenceList evidence={character.evidence} />
        </div>
    );
}

export function RelationshipsSection({ analysis, novel, overrides, saveOverride, resetOverride }: SectionProps) {
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<NovelRelationship | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query ? analysis.relationships.filter((relation) => [relation.fromName, relation.toName, relation.type, relation.currentStatus].join(" ").toLowerCase().includes(query)) : analysis.relationships;
    }, [analysis.relationships, search]);
    return (
        <StudioPanel title="人物关系" extra={<Tag bordered={false}>无证据关系已在分析阶段丢弃</Tag>}>
            <div className="novel-toolbar">
                <Input allowClear placeholder="搜索人物或关系类型" value={search} onChange={(event) => setSearch(event.target.value)} />
                <span>{filtered.length} 条</span>
            </div>
            <Table
                size="small"
                rowKey="id"
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                dataSource={filtered}
                onRow={(record) => ({ onClick: () => setSelected(record) })}
                columns={[
                    { title: "关系", render: (_, record) => <strong>{record.fromName} <ArrowRight className="size-3.5" /> {record.toName}</strong> },
                    { title: "类型", dataIndex: "type", width: 160 },
                    { title: "当前状态", dataIndex: "currentStatus", ellipsis: true },
                    { title: "关键变化", render: (_, record) => record.changes.length ? record.changes.map((change) => `${chapterLabel(novel, change.chapterId)}：${change.description}`).join("；") : "未明确", ellipsis: true },
                    { title: "证据", width: 80, render: (_, record) => <span>{record.evidence.length} 条</span> },
                    { title: "来源", width: 100, render: (_, record) => <ManualTag edited={isEdited("relationships", record.id, overrides)} /> },
                ]}
            />
            <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} width={620} title={selected ? `${selected.fromName} → ${selected.toName}` : ""} extra={selected ? <Button icon={<Edit3 className="size-4" />} onClick={() => setEditOpen(true)}>修正</Button> : null}>
                {selected ? (
                    <div className="novel-detail">
                        <div className="novel-detail__tags"><Tag bordered={false}>{selected.type}</Tag><ManualTag edited={isEdited("relationships", selected.id, overrides)} /></div>
                        <dl className="novel-detail__facts">
                            <div><dt>当前状态</dt><dd>{selected.currentStatus || "未明确"}</dd></div>
                            {selected.changes.map((change) => <div key={`${change.chapterId}-${change.description}`}><dt>{chapterLabel(novel, change.chapterId)}</dt><dd>{change.description}</dd></div>)}
                        </dl>
                        <h4>证据来源</h4>
                        <EvidenceList evidence={selected.evidence} />
                    </div>
                ) : null}
            </Drawer>
            {selected ? (
                <EntityEditModal
                    open={editOpen}
                    title={`修正关系 · ${selected.fromName} → ${selected.toName}`}
                    description="关系类型和当前状态会持久化，并优先于后续 AI 分析。变化章节与证据仍保留原记录。"
                    fields={RELATIONSHIP_FIELDS}
                    value={selected as unknown as Record<string, unknown>}
                    novel={novel}
                    manual={isEdited("relationships", selected.id, overrides)}
                    onSave={(draft) => { saveOverride("relationships", selected.id, formPatch(RELATIONSHIP_FIELDS, draft)); setSelected({ ...selected, ...formPatch(RELATIONSHIP_FIELDS, draft) } as NovelRelationship); }}
                    onReset={() => resetOverride("relationships", selected.id)}
                    onClose={() => setEditOpen(false)}
                />
            ) : null}
        </StudioPanel>
    );
}

const WORLD_GROUP_LABEL: Record<string, string> = {
    rule: "世界规则", power: "力量体系", society: "社会结构", organization: "组织 / 门派 / 国家 / 家族", geography: "地理区域", item: "特殊物品", ability: "特殊能力", history: "重要历史事件", constraint: "不能违反的约束",
};

export function WorldSection({ analysis, novel, overrides, saveOverride, resetOverride }: SectionProps) {
    const [editOpen, setEditOpen] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<NovelWorldEntry | null>(null);
    const [entryEditOpen, setEntryEditOpen] = useState(false);
    const grouped = useMemo(() => Object.entries(Object.fromEntries(analysis.world.entries.map((entry) => [entry.category, analysis.world.entries.filter((item) => item.category === entry.category)]))), [analysis.world.entries]);
    return (
        <StudioPanel title="世界观与组织" extra={analysisMeta(analysis, overrides)}>
            <div className="novel-world-summary">
                <p>{analysis.world.summary || "世界观总述尚未明确"}</p>
                <div className="novel-section-actions">
                    <Button icon={<Edit3 className="size-4" />} onClick={() => setEditOpen(true)}>修正世界观</Button>
                    {isEdited("world", "", overrides) ? <Button onClick={() => resetOverride("world", "")}>恢复 AI 原值</Button> : null}
                </div>
            </div>
            <div className="novel-world-core">
                <div><span>力量体系</span><strong>{analysis.world.powerSystem || "未明确"}</strong></div>
                <div><span>社会结构</span><strong>{analysis.world.socialStructure || "未明确"}</strong></div>
                <div><span>世界规则</span><strong>{analysis.world.rules.length ? analysis.world.rules.join("；") : "未明确"}</strong></div>
            </div>
            {grouped.map(([category, entries]) => (
                <section key={category} className="novel-world-group">
                    <h4>{WORLD_GROUP_LABEL[category] ?? category}<span>{entries.length}</span></h4>
                    <div className="novel-world-grid">
                        {entries.map((entry) => (
                            <button key={entry.id} className="novel-world-card" onClick={() => setSelectedEntry(entry)}>
                                <div><strong>{entry.name}</strong><ManualTag edited={isEdited("world", "", overrides)} /></div>
                                <p>{entry.description || "未填写"}</p>
                                <small>{entry.evidence.length} 条证据</small>
                            </button>
                        ))}
                    </div>
                </section>
            ))}
            <EntityEditModal
                open={editOpen}
                title="修正世界观核心"
                description="修改会写入独立人工修正；原著明确设定与 AI 推断由证据标签区分。"
                fields={WORLD_FIELDS}
                value={analysis.world as unknown as Record<string, unknown>}
                novel={novel}
                manual={isEdited("world", "", overrides)}
                onSave={(draft) => saveOverride("world", "", formPatch(WORLD_FIELDS, draft))}
                onReset={() => resetOverride("world", "")}
                onClose={() => setEditOpen(false)}
            />
            <Drawer open={Boolean(selectedEntry)} onClose={() => setSelectedEntry(null)} width={560} title={selectedEntry?.name ?? ""}>
                {selectedEntry ? <div className="novel-detail"><dl className="novel-detail__facts"><div><dt>类别</dt><dd>{WORLD_GROUP_LABEL[selectedEntry.category]}</dd></div><div><dt>设定</dt><dd>{selectedEntry.description}</dd></div></dl><h4>证据来源</h4><EvidenceList evidence={selectedEntry.evidence} /></div> : null}
                {selectedEntry ? (
                    <Button block icon={<Edit3 className="size-4" />} onClick={() => setEntryEditOpen(true)}>修正条目</Button>
                ) : null}
            </Drawer>
            {selectedEntry ? (
                <EntityEditModal
                    open={entryEditOpen}
                    title={`修正世界观条目 · ${selectedEntry.name}`}
                    description="人工修改条目会写进世界观人工修正；证据仍保留原 AI 来源，不会自动替换成新事实。"
                    fields={WORLD_ENTRY_FIELDS}
                    value={selectedEntry as unknown as Record<string, unknown>}
                    novel={novel}
                    manual={isEdited("world", "", overrides)}
                    onSave={(draft) => {
                        const patch = formPatch(WORLD_ENTRY_FIELDS, draft);
                        const entries = analysis.world.entries.map((entry) => entry.id === selectedEntry.id ? { ...entry, ...patch } : entry) as NovelWorldEntry[];
                        saveOverride("world", "", { entries });
                        setSelectedEntry({ ...selectedEntry, ...patch } as NovelWorldEntry);
                    }}
                    onReset={() => resetOverride("world", "")}
                    onClose={() => setEntryEditOpen(false)}
                />
            ) : null}
        </StudioPanel>
    );
}

export function ScenesSection({ analysis, novel, overrides, saveOverride, resetOverride }: SectionProps) {
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<NovelScene | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const filtered = useMemo(() => analysis.scenes.filter((scene) => !search.trim() || `${scene.name} ${scene.type} ${scene.region} ${scene.organization}`.toLowerCase().includes(search.trim().toLowerCase())), [analysis.scenes, search]);
    return (
        <StudioPanel title="地点与场景" extra={<Tag bordered={false}>地点身份与昼夜/天气/损毁变体分开</Tag>}>
            <div className="novel-toolbar"><Input allowClear placeholder="搜索地点、区域、组织" value={search} onChange={(event) => setSearch(event.target.value)} /><span>{filtered.length} 个地点</span></div>
            <div className="novel-scene-grid">
                {filtered.map((scene) => (
                    <button key={scene.id} className="novel-scene-card" onClick={() => setSelected(scene)}>
                        <div className="novel-scene-card__head"><MapPin className="size-4" /><strong>{scene.name}</strong><ManualTag edited={isEdited("scenes", scene.id, overrides)} /></div>
                        <span>{[scene.type, scene.region, scene.organization].filter(Boolean).join(" · ") || "类型未明确"}</span>
                        <p>{scene.space || scene.plotUses || "空间与剧情用途未明确"}</p>
                        <div><small>{scene.evidence.length} 条证据</small><small>{scene.variants.length} 个状态变体</small></div>
                    </button>
                ))}
            </div>
            <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} width={620} title={selected ? `${selected.name} · 场景` : ""} extra={selected ? <Button icon={<Edit3 className="size-4" />} onClick={() => setEditOpen(true)}>修正</Button> : null}>
                {selected ? (
                    <div className="novel-detail">
                        <div className="novel-detail__tags"><Tag bordered={false}>{selected.type || "未分类"}</Tag><ManualTag edited={isEdited("scenes", selected.id, overrides)} /></div>
                        <dl className="novel-detail__facts">
                            <div><dt>空间特征</dt><dd>{selected.space || "未明确"}</dd></div>
                            <div><dt>所属区域 / 组织</dt><dd>{[selected.region, selected.organization].filter(Boolean).join(" / ") || "未明确"}</dd></div>
                            <div><dt>首次出现</dt><dd>{chapterLabel(novel, selected.firstChapterId)}</dd></div>
                            <div><dt>剧情用途</dt><dd>{selected.plotUses || "未明确"}</dd></div>
                        </dl>
                        {selected.stateChanges.length ? <><h4>状态变化</h4>{selected.stateChanges.map((change) => <p key={`${change.chapterId}-${change.description}`}>{chapterLabel(novel, change.chapterId)}：{change.description}</p>)}</> : null}
                        {selected.variants.length ? <><h4>场景变体</h4><div className="novel-variant-list">{selected.variants.map((variant) => <div key={variant.id}><strong>{[variant.timeOfDay, variant.weather, variant.condition].filter(Boolean).join(" / ") || "变体"}</strong><p>{variant.description}</p><EvidenceList evidence={variant.evidence} /></div>)}</div></> : null}
                        <h4>证据来源</h4>
                        <EvidenceList evidence={selected.evidence} />
                    </div>
                ) : null}
            </Drawer>
            {selected ? <EntityEditModal open={editOpen} title={`修正地点 · ${selected.name}`} description="只修改地点身份与稳定空间特征；昼夜、天气、损毁仍保存在独立变体里。" fields={SCENE_FIELDS} value={selected as unknown as Record<string, unknown>} novel={novel} manual={isEdited("scenes", selected.id, overrides)} onSave={(draft) => { saveOverride("scenes", selected.id, formPatch(SCENE_FIELDS, draft)); setSelected({ ...selected, ...formPatch(SCENE_FIELDS, draft) } as NovelScene); }} onReset={() => resetOverride("scenes", selected.id)} onClose={() => setEditOpen(false)} /> : null}
        </StudioPanel>
    );
}

export function EventsSection({ analysis, novel, overrides, saveOverride, resetOverride }: SectionProps) {
    const [search, setSearch] = useState("");
    const [chapterFilter, setChapterFilter] = useState<string>("");
    const [selected, setSelected] = useState<NovelEvent | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const filtered = useMemo(() => analysis.events.filter((event) => {
        const matchText = !search.trim() || `${event.title} ${event.content} ${event.participantNames.join(" ")} ${event.locationName}`.toLowerCase().includes(search.trim().toLowerCase());
        return matchText && (!chapterFilter || event.chapterId === chapterFilter);
    }), [analysis.events, chapterFilter, search]);
    return (
        <StudioPanel title="关键事件与因果链" extra={<Tag bordered={false}>按章节定位 · 不做剧情摘要排序</Tag>}>
            <div className="novel-toolbar novel-toolbar--events">
                <Input allowClear placeholder="搜索事件、人物、地点" value={search} onChange={(event) => setSearch(event.target.value)} />
                <Select allowClear showSearch optionFilterProp="label" placeholder="按章节筛选" value={chapterFilter || undefined} options={novel.chapters.map((chapter) => ({ label: `第 ${chapter.no} 章 ${chapter.title || ""}`, value: chapter.id }))} onChange={(value) => setChapterFilter(value ?? "")} />
                <span>{filtered.length} 个事件</span>
            </div>
            <div className="novel-event-list">
                {filtered.map((event) => (
                    <button key={event.id} className="novel-event-card" onClick={() => setSelected(event)}>
                        <div className="novel-event-card__time"><CalendarClock className="size-4" /><span>{chapterLabel(novel, event.chapterId)}</span></div>
                        <div className="novel-event-card__body">
                            <strong>{event.title}</strong>
                            <p>{event.content || "事件内容未明确"}</p>
                            <div className="novel-event-card__chips">
                                {event.participantNames.slice(0, 4).map((name) => <Tag bordered={false} key={name}>{name}</Tag>)}
                                {event.locationName ? <Tag bordered={false}><MapPin className="size-3" />{event.locationName}</Tag> : null}
                                <ManualTag edited={isEdited("events", event.id, overrides)} />
                            </div>
                        </div>
                        <div className="novel-event-card__links">
                            <span>前置 {event.causeEventIds.length}</span>
                            <span>后续 {event.consequenceEventIds.length}</span>
                            <small>{event.evidence.length} 条证据</small>
                        </div>
                    </button>
                ))}
            </div>
            <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} width={680} title={selected?.title ?? ""} extra={selected ? <Button icon={<Edit3 className="size-4" />} onClick={() => setEditOpen(true)}>修正</Button> : null}>
                {selected ? (
                    <div className="novel-detail">
                        <div className="novel-detail__tags"><Tag bordered={false}>{chapterLabel(novel, selected.chapterId)}</Tag><ManualTag edited={isEdited("events", selected.id, overrides)} /></div>
                        <dl className="novel-detail__facts">
                            <div><dt>事件内容</dt><dd>{selected.content || "未明确"}</dd></div>
                            <div><dt>参与人物</dt><dd>{selected.participantNames.join("、") || "未明确"}</dd></div>
                            <div><dt>发生地点</dt><dd>{selected.locationName || "未明确"}</dd></div>
                            <div><dt>前置条件</dt><dd>{selected.preconditions.join("；") || "未明确"}</dd></div>
                            <div><dt>直接结果</dt><dd>{selected.results.join("；") || "未明确"}</dd></div>
                            <div><dt>后续影响</dt><dd>{selected.impacts.join("；") || "未明确"}</dd></div>
                            <div><dt>因果链</dt><dd>{selected.causeEventIds.length ? `前置：${selected.causeEventIds.map((id) => analysis.events.find((event) => event.id === id)?.title ?? id).join("、")}` : "未解析到前置事件"}{selected.consequenceEventIds.length ? `；后续：${selected.consequenceEventIds.map((id) => analysis.events.find((event) => event.id === id)?.title ?? id).join("、")}` : ""}</dd></div>
                        </dl>
                        <h4>证据来源</h4>
                        <EvidenceList evidence={selected.evidence} />
                    </div>
                ) : null}
            </Drawer>
            {selected ? <EntityEditModal open={editOpen} title={`修正事件 · ${selected.title}`} description="人工修改不会改变因果引用 id；请在证据中核对前置/后续是否仍成立。" fields={EVENT_FIELDS} value={selected as unknown as Record<string, unknown>} novel={novel} manual={isEdited("events", selected.id, overrides)} onSave={(draft) => { saveOverride("events", selected.id, formPatch(EVENT_FIELDS, draft)); setSelected({ ...selected, ...formPatch(EVENT_FIELDS, draft) } as NovelEvent); }} onReset={() => resetOverride("events", selected.id)} onClose={() => setEditOpen(false)} /> : null}
        </StudioPanel>
    );
}

export function ForeshadowingSection({ analysis, novel, overrides, saveOverride, resetOverride }: SectionProps) {
    const [status, setStatus] = useState<string>("");
    const [selected, setSelected] = useState<NovelForeshadowing | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const filtered = analysis.foreshadowings.filter((item) => !status || item.status === status);
    return (
        <StudioPanel title="伏笔与悬念" extra={<Tag bordered={false}>AI 推断的回收章节单独标记</Tag>}>
            <div className="novel-toolbar"><Select allowClear placeholder="按状态筛选" value={status || undefined} options={[{ label: "未回收", value: "open" }, { label: "已回收", value: "paid_off" }, { label: "未知", value: "unknown" }]} onChange={(value) => setStatus(value ?? "")} /><span>{filtered.length} 条</span></div>
            <Table
                size="small"
                rowKey="id"
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                dataSource={filtered}
                onRow={(record) => ({ onClick: () => setSelected(record) })}
                columns={[
                    { title: "伏笔", dataIndex: "content", ellipsis: true },
                    { title: "首次出现", width: 160, render: (_, record) => chapterLabel(novel, record.firstChapterId) },
                    { title: "预计回收", width: 210, render: (_, record) => record.expectedPayoffChapterId ? <span>{chapterLabel(novel, record.expectedPayoffChapterId)} <Tag bordered={false} color={record.expectedPayoffEvidenceType === "explicit" ? "green" : "orange"}>{record.expectedPayoffEvidenceType === "explicit" ? "原著明确" : "AI 推断"}</Tag></span> : "未明确" },
                    { title: "实际回收", width: 160, render: (_, record) => record.actualPayoffChapterId ? chapterLabel(novel, record.actualPayoffChapterId) : "未明确" },
                    { title: "状态", width: 90, render: (_, record) => <Tag bordered={false} color={record.status === "paid_off" ? "success" : record.status === "open" ? "processing" : "default"}>{record.status === "paid_off" ? "已回收" : record.status === "open" ? "未回收" : "未知"}</Tag> },
                    { title: "来源", width: 100, render: (_, record) => <ManualTag edited={isEdited("foreshadowings", record.id, overrides)} /> },
                ]}
            />
            <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} width={620} title="伏笔详情" extra={selected ? <Button icon={<Edit3 className="size-4" />} onClick={() => setEditOpen(true)}>修正</Button> : null}>
                {selected ? (
                    <div className="novel-detail">
                        <div className="novel-detail__tags"><ManualTag edited={isEdited("foreshadowings", selected.id, overrides)} /></div>
                        <dl className="novel-detail__facts">
                            <div><dt>伏笔内容</dt><dd>{selected.content}</dd></div>
                            <div><dt>首次出现</dt><dd>{chapterLabel(novel, selected.firstChapterId)}</dd></div>
                            <div><dt>预计回收</dt><dd>{selected.expectedPayoffChapterId ? `${chapterLabel(novel, selected.expectedPayoffChapterId)}（${selected.expectedPayoffEvidenceType === "explicit" ? "原著明确" : selected.expectedPayoffEvidenceType === "inferred" ? "AI 推断" : "未标注"}）` : "未明确"}</dd></div>
                            <div><dt>实际回收</dt><dd>{selected.actualPayoffChapterId ? chapterLabel(novel, selected.actualPayoffChapterId) : "未明确"}</dd></div>
                        </dl>
                        <h4>证据来源</h4>
                        <EvidenceList evidence={selected.evidence} />
                    </div>
                ) : null}
            </Drawer>
            {selected ? <EntityEditModal open={editOpen} title="修正伏笔" description="人工填写预计/实际回收章节后按人工结果展示；不会把它改写成原著事实。" fields={FORESHADOWING_FIELDS} value={selected as unknown as Record<string, unknown>} novel={novel} manual={isEdited("foreshadowings", selected.id, overrides)} onSave={(draft) => { saveOverride("foreshadowings", selected.id, formPatch(FORESHADOWING_FIELDS, draft)); setSelected({ ...selected, ...formPatch(FORESHADOWING_FIELDS, draft) } as NovelForeshadowing); }} onReset={() => resetOverride("foreshadowings", selected.id)} onClose={() => setEditOpen(false)} /> : null}
        </StudioPanel>
    );
}

export function AnalysisStatsSection({ analysis, novel, overrides }: SectionProps) {
    return (
        <div className="novel-stats-grid">
            <StudioPanel title="分析覆盖" extra={analysisMeta(analysis, overrides)}>
                <div className="novel-stats-cards">
                    <Statistic title="总章节" value={analysis.stats.chapters} />
                    <Statistic title="分块" value={analysis.stats.chunks} />
                    <Statistic title="证据" value={analysis.stats.evidenceCount} />
                    <Statistic title="人工修正" value={overrideCount(overrides)} />
                </div>
                <Progress percent={analysis.profile.completeness} />
                <p className="novel-muted">分析完整度按实际覆盖章节计算；部分完成不会显示为完整。</p>
            </StudioPanel>
            <WarningList warnings={analysis.warnings} limit={20} />
            <StudioPanel title="证据分布" extra="来源可追溯">
                <div className="novel-overview__confidence">
                    <><Users className="size-4" /> 人物证据 {analysis.characters.reduce((count, item) => count + item.evidence.length, 0)}</>
                    <><Network className="size-4" /> 关系证据 {analysis.relationships.reduce((count, item) => count + item.evidence.length, 0)}</>
                    <><ShieldAlert className="size-4" /> 伏笔证据 {analysis.foreshadowings.reduce((count, item) => count + item.evidence.length, 0)}</>
                </div>
                <p className="novel-muted">证据类型：显式 {analysis.stats.explicitCount} / 推断 {analysis.stats.inferredCount} / AI 生成 {analysis.stats.generatedCount}。{NOVEL_EVIDENCE_TYPE_LABEL.explicit}不等于绝对正确，仍需人工审核。</p>
            </StudioPanel>
        </div>
    );
}
