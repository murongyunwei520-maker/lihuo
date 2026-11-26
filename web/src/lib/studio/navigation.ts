import { DRAMA_STEP_KEYS, type DramaStep, type StudioProject, type StudioWorkspace } from "@/types/studio";

// 五步导航与旧六工作区 URL 的纯映射层；页面只调用这里，避免把兼容规则散落在组件里。

export type DramaLocation = "projects" | DramaStep;

export type DramaSubView = "script" | "storyboard" | "review" | "video" | "sound";

export function isDramaStep(value: string | null | undefined): value is DramaStep {
    return Boolean(value) && DRAMA_STEP_KEYS.includes(value as DramaStep);
}

export function defaultStepForProject(project: StudioProject | null | undefined): DramaStep {
    if (!project) return "analysis";
    if (isDramaStep(project.currentStep)) return project.currentStep;
    // 阶段 1 之前的 V2 项目没有 currentStep；有内容就从原有剧本继续，不强制重走小说分析。
    if (project.legacySequenceId || project.episodes.length || project.assets.length) return "script";
    return "analysis";
}

export function defaultSubView(step: DramaStep): DramaSubView | undefined {
    if (step === "script") return "script";
    if (step === "video") return "video";
    return undefined;
}

export function normalizeSubView(step: DramaStep, value: string | null | undefined): DramaSubView | undefined {
    if (step === "script") return value === "storyboard" ? "storyboard" : "script";
    if (step === "video") return value === "sound" ? "sound" : "video";
    return undefined;
}

/** 旧 `/drama?workspace=...` 到五步位置；projects 返回项目首页。 */
export function mapLegacyWorkspace(workspace: string | null | undefined): { location: DramaLocation; subView?: DramaSubView } | null {
    if (!workspace) return null;
    switch (workspace as StudioWorkspace | "analysis") {
        case "projects":
            return { location: "projects" };
        case "analysis":
            return { location: "analysis" };
        case "script":
            return { location: "script", subView: "script" };
        case "director":
            return { location: "script", subView: "storyboard" };
        case "assets":
            return { location: "assets" };
        case "picture":
            return { location: "review" };
        case "video":
            return { location: "video", subView: "video" };
        case "sound":
            return { location: "video", subView: "sound" };
        default:
            return null;
    }
}

export function resolveStudioLocation(input: {
    step?: string | null;
    workspace?: string | null;
    view?: string | null;
    project?: StudioProject | null;
}): { location: DramaLocation; subView?: DramaSubView } {
    const explicitStep = input.step;
    if (explicitStep === "projects") return { location: "projects" };
    if (isDramaStep(explicitStep)) {
        return { location: explicitStep, subView: normalizeSubView(explicitStep, input.view) };
    }
    const legacy = mapLegacyWorkspace(input.workspace);
    if (legacy) {
        return { location: legacy.location, subView: legacy.subView ?? (isDramaStep(legacy.location) ? normalizeSubView(legacy.location, input.view) : undefined) };
    }
    if (!input.project) return { location: "projects" };
    const step = defaultStepForProject(input.project);
    return { location: step, subView: normalizeSubView(step, input.view) };
}
