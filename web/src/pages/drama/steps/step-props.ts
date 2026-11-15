import type { SequencePatch } from "@/stores/use-drama-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { DramaSequence, DramaSettings } from "@/types/drama";

/** 十个步骤工作区共用的上下文，避免每个组件再透传一长串 props。 */
export type StepProps = {
    sequence: DramaSequence;
    settings: DramaSettings;
    config: AiConfig;
    patch: (patch: SequencePatch) => void;
    patchSetting: (key: keyof DramaSettings, value: string) => void;
    go: (step: number) => void;
    selectShot: (id: string | null) => void;
    selectedShotId: string | null;
    selectAsset: (id: string | null) => void;
    selectedAssetId: string | null;
};
