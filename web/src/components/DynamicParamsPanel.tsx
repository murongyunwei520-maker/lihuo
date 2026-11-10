// Schema 驱动的动态参数面板
// 根据 ModelDefinition.parameterSchema 动态渲染参数表单
import { useMemo } from "react";
import { Select, Slider, Switch, Input } from "antd";
import type { ParameterSchema } from "@/stores/model-schema";

const { TextArea } = Input;

type DynamicParamsPanelProps = {
    /** 参数 Schema 列表 */
    schema: ParameterSchema[];
    /** 当前参数值 */
    values: Record<string, unknown>;
    /** 参数变化回调 */
    onChange: (key: string, value: unknown) => void;
    /** 可选的额外 class */
    className?: string;
};

/** 检查条件显示规则是否满足 */
function shouldShow(field: ParameterSchema, values: Record<string, unknown>): boolean {
    if (!field.showIf) return true;
    const { dependsOn, equals, in: inList } = field.showIf;
    const currentValue = values[dependsOn];
    if (equals !== undefined) return currentValue === equals;
    if (inList !== undefined) return inList.includes(currentValue);
    return true;
}

/** 按 group 分组参数 */
function groupFields(schema: ParameterSchema[]): Map<string, ParameterSchema[]> {
    const groups = new Map<string, ParameterSchema[]>();
    for (const field of schema) {
        const group = field.group || "默认";
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push(field);
    }
    return groups;
}

/** 渲染单个参数控件 */
function renderField(
    field: ParameterSchema,
    value: unknown,
    onChange: (key: string, value: unknown) => void,
) {
    switch (field.type) {
        case "select":
            return (
                <Select
                    size="small"
                    className="w-full"
                    value={value as string}
                    options={field.options}
                    onChange={(v) => onChange(field.key, v)}
                />
            );
        case "slider":
            return (
                <Slider
                    min={field.min}
                    max={field.max}
                    step={field.step || 1}
                    value={Number(value ?? field.defaultValue ?? 0)}
                    onChange={(v) => onChange(field.key, v)}
                />
            );
        case "number":
            return (
                <Input
                    size="small"
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step || 1}
                    value={Number(value) || 0}
                    onChange={(e) => onChange(field.key, Number(e.target.value))}
                />
            );
        case "boolean":
            return (
                <Switch
                    size="small"
                    checked={Boolean(value)}
                    onChange={(v) => onChange(field.key, v)}
                />
            );
        case "textarea":
            return (
                <TextArea
                    size="small"
                    rows={3}
                    value={String(value || "")}
                    placeholder={field.description}
                    onChange={(e) => onChange(field.key, e.target.value)}
                />
            );
        case "text":
        default:
            return (
                <Input
                    size="small"
                    value={String(value || "")}
                    placeholder={field.description}
                    onChange={(e) => onChange(field.key, e.target.value)}
                />
            );
    }
}

export function DynamicParamsPanel({ schema, values, onChange, className = "" }: DynamicParamsPanelProps) {
    const groups = useMemo(() => groupFields(schema), [schema]);

    return (
        <div className={`space-y-3 ${className}`}>
            {Array.from(groups.entries()).map(([groupName, fields]) => (
                <div key={groupName}>
                    <div className="mb-1.5 text-[11px] font-medium opacity-60">{groupName}</div>
                    <div className="space-y-2">
                        {fields
                            .filter((field) => shouldShow(field, values))
                            .map((field) => (
                                <label key={field.key} className="block">
                                    <span className="mb-1 flex items-center justify-between text-[11px] opacity-80">
                                        <span>
                                            {field.label}
                                            {field.required && <span className="ml-0.5 text-red-500">*</span>}
                                        </span>
                                        {field.type === "slider" && (
                                            <span className="opacity-60">{String(Number(values[field.key] ?? field.defaultValue ?? 0))}</span>
                                        )}
                                    </span>
                                    {renderField(field, values[field.key], onChange)}
                                    {field.description && (
                                        <span className="mt-0.5 block text-[10px] opacity-50">{field.description}</span>
                                    )}
                                </label>
                            ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
