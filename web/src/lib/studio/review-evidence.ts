// Stage 4D 证据等级：旧来源字段只做兼容映射，新记录必须落在 explicit / inference / suggestion / unknown。
// unknown 是“证据不足”，不是低置信度推断，也不能被 apply 当成可应用证据。

import type { StudioAiEvidenceType, StudioAiReviewEvidenceType } from "@/types/studio-production";

export const AI_EVIDENCE_TYPE_LABEL: Record<StudioAiEvidenceType, string> = {
    explicit: "输入中可直接核对",
    inference: "模型推断",
    suggestion: "创作建议",
    unknown: "证据不足",
};

export function normalizeAiEvidenceType(value: unknown): StudioAiEvidenceType {
    switch (value) {
        case "explicit":
        case "shot_text":
        case "script_text":
        case "continuity_report":
            return "explicit";
        case "inference":
            return "inference";
        case "suggestion":
            return "suggestion";
        case "unknown":
        default:
            return "unknown";
    }
}

export function aiEvidenceTypeLabel(value: StudioAiReviewEvidenceType | undefined): string {
    return AI_EVIDENCE_TYPE_LABEL[normalizeAiEvidenceType(value)] ?? AI_EVIDENCE_TYPE_LABEL.unknown;
}
