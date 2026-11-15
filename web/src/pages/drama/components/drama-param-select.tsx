import { useState } from "react";
import { Input, Select, type SelectProps } from "antd";

const CUSTOM_VALUE = "__drama_custom__";

type Option = { value: string; label: string };
export type DramaSelectGroup = { label: string; options: Option[] };

type DramaParamSelectProps = {
    label: string;
    value: string;
    /** 平铺预设；与 groups 二选一。 */
    options?: string[];
    /** 按渠道等维度分组的预设，用于模型下拉。 */
    groups?: DramaSelectGroup[];
    onChange: (value: string) => void;
    customPlaceholder?: string;
};

/** 序列设置用的下拉：预设可选，也能自己填；自定义值会作为当前项留在下拉里。 */
export function DramaParamSelect({ label, value, options = [], groups, onChange, customPlaceholder = "输入自定义值" }: DramaParamSelectProps) {
    const [customizing, setCustomizing] = useState(false);
    const [draft, setDraft] = useState("");

    const flat: Option[] = groups ? groups.flatMap((group) => group.options) : options.map((item) => ({ value: item, label: item }));
    const currentIsCustom = Boolean(value) && !flat.some((item) => item.value === value);
    const currentOption: Option[] = currentIsCustom ? [{ value, label: `${value}（自定义）` }] : [];

    const selectOptions: NonNullable<SelectProps["options"]> = groups
        ? [
              ...groups.map((group) => ({ label: group.label, options: group.options })),
              ...(currentIsCustom ? [{ label: "自定义", options: currentOption }] : []),
              { value: CUSTOM_VALUE, label: "+ 自定义…" },
          ]
        : [...flat, ...currentOption, { value: CUSTOM_VALUE, label: "+ 自定义…" }];

    const commit = () => {
        const next = draft.trim();
        setCustomizing(false);
        setDraft("");
        if (next) onChange(next);
    };

    return (
        <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] text-stone-500 dark:text-stone-400">{label}</span>
            {customizing ? (
                <Input
                    autoFocus
                    value={draft}
                    placeholder={customPlaceholder}
                    onChange={(event) => setDraft(event.target.value)}
                    onPressEnter={commit}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            setDraft("");
                            setCustomizing(false);
                        }
                    }}
                />
            ) : (
                <Select
                    className="w-full"
                    value={value}
                    options={selectOptions}
                    onChange={(next: string) => {
                        if (next === CUSTOM_VALUE) {
                            setDraft(currentIsCustom ? value : "");
                            setCustomizing(true);
                            return;
                        }
                        onChange(next);
                    }}
                />
            )}
        </label>
    );
}
