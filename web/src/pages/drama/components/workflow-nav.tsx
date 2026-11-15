import { Check, ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";

import { DRAMA_STAGES, type StepState } from "@/lib/drama/workflow";
import { cn } from "@/lib/utils";

type Props = {
    step: number;
    states: StepState[];
    collapsed: boolean;
    onStep: (step: number) => void;
    onToggleCollapsed: () => void;
};

/** 左侧工作流导航：四个阶段 / 十个步骤，纵向固定。 */
export function WorkflowNav({ step, states, collapsed, onStep, onToggleCollapsed }: Props) {
    return (
        <nav className={cn("drama-nav", collapsed && "is-collapsed")} aria-label="制作流程">
            <div className="drama-nav__head">
                {!collapsed ? <span className="drama-nav__title">制作流程</span> : null}
                <button type="button" className="drama-nav__collapse" onClick={onToggleCollapsed} title={collapsed ? "展开流程" : "收起流程"}>
                    {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                </button>
            </div>

            <div className="drama-nav__body">
                {DRAMA_STAGES.map((stage, stageIndex) => (
                    <section key={stage.id} className="drama-nav__stage">
                        {!collapsed ? (
                            <div className="drama-nav__stage-label">
                                <span>{stage.label}</span>
                                <span className="drama-nav__stage-index">0{stageIndex + 1}</span>
                            </div>
                        ) : (
                            <div className="drama-nav__stage-rule" />
                        )}
                        <div className="space-y-1">
                            {stage.steps.map((item) => {
                                const state = states[item.id] ?? "todo";
                                const active = item.id === step;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => onStep(item.id)}
                                        title={`${String(item.id + 1).padStart(2, "0")} ${item.label} · ${item.hint}`}
                                        className={cn("drama-nav__item", active && "is-active", state === "done" && "is-done", state === "error" && "is-error")}
                                    >
                                        <span className="drama-nav__index">
                                            {state === "done" && !active ? <Check className="size-3.5" /> : state === "error" && !active ? <CircleAlert className="size-3.5" /> : String(item.id + 1).padStart(2, "0")}
                                        </span>
                                        {!collapsed ? (
                                            <span className="min-w-0 flex-1 text-left">
                                                <span className="drama-nav__label">{item.label}</span>
                                                <span className="drama-nav__hint">{item.hint}</span>
                                            </span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </nav>
    );
}
