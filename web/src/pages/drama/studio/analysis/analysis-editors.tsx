import { Button, Input, Modal, Select, Tag } from "antd";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import type { StudioNovel } from "@/types/novel";

import { StudioField } from "../ui";

export type EditField = {
    key: string;
    label: string;
    type: "text" | "textarea" | "select" | "stringList" | "chapter";
    options?: { label: string; value: string }[];
    emptyValue?: string;
    allowClear?: boolean;
    placeholder?: string;
    hint?: string;
};

function normalizeFieldValue(field: EditField, value: unknown) {
    if (field.type === "stringList") return Array.isArray(value) ? value.join("\n") : String(value ?? "");
    return value === undefined || value === null ? "" : String(value);
}

export function EntityEditModal({
    open,
    title,
    description,
    fields,
    value,
    novel,
    manual,
    onSave,
    onReset,
    onClose,
}: {
    open: boolean;
    title: string;
    description?: string;
    fields: EditField[];
    value: Record<string, unknown>;
    novel: StudioNovel;
    manual: boolean;
    onSave: (patch: Record<string, unknown>) => void;
    onReset?: () => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    useEffect(() => {
        if (!open) return;
        setDraft(Object.fromEntries(fields.map((field) => [field.key, normalizeFieldValue(field, value[field.key])])));
    }, [open, value, fields]);
    const chapterOptions = novel.chapters.map((chapter) => ({ label: `第 ${chapter.no} 章 ${chapter.title || ""}`, value: chapter.id }));
    return (
        <Modal
            open={open}
            title={title}
            width={680}
            onCancel={onClose}
            destroyOnHidden
            footer={
                <div className="novel-edit-footer">
                    {manual && onReset ? <Button icon={<RotateCcw className="size-4" />} onClick={() => { onReset(); onClose(); }}>恢复 AI 原值</Button> : <span>{manual ? <Tag bordered={false} color="purple">人工修正优先</Tag> : <Tag bordered={false}>AI 结果</Tag>}</span>}
                    <div>
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" onClick={() => { onSave(draft); onClose(); }}>保存修正</Button>
                    </div>
                </div>
            }
        >
            {description ? <p className="novel-edit-description">{description}</p> : null}
            <div className="studio-form-grid">
                {fields.map((field) => {
                    const valueText = draft[field.key];
                    return (
                        <StudioField key={field.key} label={field.label} hint={field.hint}>
                            {field.type === "textarea" ? (
                                <Input.TextArea rows={4} value={valueText as string} placeholder={field.placeholder} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                            ) : field.type === "select" ? (
                                <Select
                                    value={(valueText as string) || undefined}
                                    options={field.options}
                                    placeholder={field.placeholder}
                                    allowClear={field.allowClear !== false}
                                    onChange={(next) => setDraft((current) => ({ ...current, [field.key]: next ?? field.emptyValue ?? "" }))}
                                />
                            ) : field.type === "chapter" ? (
                                <Select
                                    showSearch
                                    optionFilterProp="label"
                                    value={(valueText as string) || undefined}
                                    options={chapterOptions}
                                    placeholder={field.placeholder ?? "未明确"}
                                    allowClear
                                    onChange={(next) => setDraft((current) => ({ ...current, [field.key]: next ?? "" }))}
                                />
                            ) : field.type === "stringList" ? (
                                <Input.TextArea rows={4} value={valueText as string} placeholder={field.placeholder ?? "一行一项"} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                            ) : (
                                <Input value={valueText as string} placeholder={field.placeholder} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                            )}
                        </StudioField>
                    );
                })}
            </div>
        </Modal>
    );
}

export function formPatch(fields: EditField[], draft: Record<string, unknown>) {
    return Object.fromEntries(fields.map((field) => [field.key, field.type === "stringList" ? String(draft[field.key] ?? "").split("\n").map((item) => item.trim()).filter(Boolean) : draft[field.key]]));
}

export const CHARACTER_FIELDS: EditField[] = [
    { key: "identity", label: "身份", type: "textarea", hint: "身份与服装造型分开；这里只改稳定身份特征。" },
    { key: "age", label: "年龄（原著明确时）", type: "text" },
    { key: "personality", label: "性格特征", type: "textarea" },
    { key: "appearance", label: "外貌（原著明确时）", type: "textarea" },
    { key: "abilities", label: "能力", type: "textarea" },
    { key: "occupation", label: "职业 / 地位", type: "text" },
    { key: "status", label: "关键状态", type: "select", emptyValue: "unknown", options: [{ label: "存活", value: "alive" }, { label: "死亡", value: "dead" }, { label: "失踪", value: "missing" }, { label: "身份变化", value: "transformed" }, { label: "未知", value: "unknown" }] },
    { key: "motivation", label: "人物动机", type: "textarea" },
    { key: "arc", label: "成长轨迹", type: "textarea" },
    { key: "fate", label: "生死 / 失踪 / 身份变化", type: "textarea" },
];

export const RELATIONSHIP_FIELDS: EditField[] = [
    { key: "type", label: "关系类型", type: "text", hint: "只在原著有证据时修改；不要凭同框推断亲属、恋爱或敌对。" },
    { key: "currentStatus", label: "当前关系状态", type: "textarea" },
];

export const PROFILE_FIELDS: EditField[] = [
    { key: "title", label: "小说名称", type: "text" },
    { key: "author", label: "作者", type: "text" },
    { key: "genre", label: "题材", type: "text" },
    { key: "worldType", label: "世界观类型", type: "text" },
    { key: "era", label: "故事时代", type: "text" },
    { key: "mainLocations", label: "主要地点", type: "stringList" },
    { key: "mainline", label: "主线概述", type: "textarea" },
    { key: "coreConflict", label: "核心矛盾", type: "textarea" },
];

export const WORLD_FIELDS: EditField[] = [
    { key: "summary", label: "世界观总述", type: "textarea" },
    { key: "rules", label: "世界规则", type: "stringList" },
    { key: "powerSystem", label: "力量体系", type: "textarea" },
    { key: "socialStructure", label: "社会结构", type: "textarea" },
];

export const WORLD_ENTRY_FIELDS: EditField[] = [
    { key: "name", label: "名称", type: "text" },
    { key: "category", label: "类别", type: "select", allowClear: false, options: [
        { label: "世界规则", value: "rule" },
        { label: "力量体系", value: "power" },
        { label: "社会结构", value: "society" },
        { label: "组织 / 门派 / 国家 / 家族", value: "organization" },
        { label: "地理区域", value: "geography" },
        { label: "特殊物品", value: "item" },
        { label: "特殊能力", value: "ability" },
        { label: "重要历史事件", value: "history" },
        { label: "不能违反的约束", value: "constraint" },
    ] },
    { key: "description", label: "设定说明", type: "textarea" },
];

export const SCENE_FIELDS: EditField[] = [
    { key: "type", label: "地点类型", type: "text" },
    { key: "space", label: "空间特征", type: "textarea" },
    { key: "region", label: "所属区域", type: "text" },
    { key: "organization", label: "所属组织", type: "text" },
    { key: "plotUses", label: "剧情用途", type: "textarea" },
];

export const EVENT_FIELDS: EditField[] = [
    { key: "title", label: "事件标题", type: "text" },
    { key: "content", label: "事件内容", type: "textarea" },
    { key: "preconditions", label: "前置条件", type: "stringList" },
    { key: "results", label: "直接结果", type: "stringList" },
    { key: "impacts", label: "后续影响", type: "stringList" },
];

export const FORESHADOWING_FIELDS: EditField[] = [
    { key: "content", label: "伏笔内容", type: "textarea" },
    { key: "status", label: "回收状态", type: "select", emptyValue: "unknown", options: [{ label: "未回收", value: "open" }, { label: "已回收", value: "paid_off" }, { label: "未知", value: "unknown" }] },
    { key: "expectedPayoffChapterId", label: "预计回收章节", type: "chapter", hint: "仅在原著明确写出时视为事实；人工修改后按人工结果展示。" },
    { key: "actualPayoffChapterId", label: "实际回收章节", type: "chapter" },
];
