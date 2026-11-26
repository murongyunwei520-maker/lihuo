import { Button, Input, InputNumber, Modal, Tag } from "antd";
import { KeyRound, Settings2, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { modelOptionLabel, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { useStudioStore } from "@/stores/use-studio-store";
import type { DramaModelCapability, StudioProject } from "@/types/studio";
import { builtinProviderOf, isDoubaoBuiltinModel } from "@/constants/doubao-builtin";
import { listAccounts, type DoubaoAccount } from "@/services/api/doubao-bridge";

import { dramaModelParams, projectModelOption, projectModelSelection } from "@/lib/studio/model-profile";
import { validateProjectBridgeAccount } from "@/lib/studio/project-bridge-account";
import { novelModelParameters, type NovelModelParameter } from "@/lib/studio/novel-model";
import { StudioField, StudioModelSelect } from "./ui";

const CAPABILITIES: { key: DramaModelCapability; label: string; hint: string }[] = [
    { key: "text", label: "文本模型", hint: "小说分析、改编、分集、剧本与连续性检查" },
    { key: "image", label: "图片模型", hint: "人物/场景资产、关键帧与分镜图" },
    { key: "video", label: "视频模型", hint: "单镜头、单集与全剧视频生成" },
];

/**
 * 项目级模型设置。模型身份与参数只写到 StudioProject，
 * 不调用 updateConfig，不改变画布全局默认模型，也不保存任何 Key。
 */
export function StudioProjectSettingsModal({ open, project, onClose }: { open: boolean; project: StudioProject | null; onClose: () => void }) {
    const config = useConfigStore((state) => state.config);
    const openGlobalConfig = useConfigStore((state) => state.openConfigDialog);
    const updateProject = useStudioStore((state) => state.updateProject);
    const setProjectModel = useStudioStore((state) => state.setProjectModel);
    const setProjectModelParam = useStudioStore((state) => state.setProjectModelParam);
    const [textParams, setTextParams] = useState<NovelModelParameter[]>([]);
    const [paramWarnings, setParamWarnings] = useState<string[]>([]);
    const [bridgeAccounts, setBridgeAccounts] = useState<DoubaoAccount[]>([]);
    const [bridgeError, setBridgeError] = useState("");
    const textSelection = project ? projectModelSelection(project, "text") : undefined;
    const textValue = project ? projectModelOption(project, "text", config) : "";
    const textBuiltin = Boolean(textValue && isDoubaoBuiltinModel(textValue));
    const textProvider = textValue ? builtinProviderOf(textValue) : null;

    useEffect(() => {
        if (!open || !project || !textBuiltin) {
            setBridgeAccounts([]);
            setBridgeError("");
            return;
        }
        let cancelled = false;
        listAccounts()
            .then((accounts) => {
                if (!cancelled) setBridgeAccounts(accounts);
                setBridgeError("");
            })
            .catch((error) => {
                if (!cancelled) setBridgeError(error instanceof Error ? error.message : String(error));
            });
        return () => {
            cancelled = true;
        };
    }, [open, project?.id, textBuiltin, textProvider]);

    useEffect(() => {
        if (!project) return;
        let cancelled = false;
        void novelModelParameters(project, config).then((result) => {
            if (cancelled) return;
            setTextParams(result.parameters);
            setParamWarnings(result.warnings);
        });
        return () => {
            cancelled = true;
        };
    }, [project?.id, project?.modelProfiles, config, config.channelMode, config.channels, config.model, textSelection?.channelId, textSelection?.modelId]);

    if (!project) return null;
    const textParamValues = textSelection ? dramaModelParams(project.modelProfiles, "text", textSelection) : {};
    const textAccounts = bridgeAccounts.filter((account) => textProvider && account.provider === textProvider);
    const textAccountCheck = textBuiltin && !bridgeError ? validateProjectBridgeAccount(textValue, textParamValues.accountId, bridgeAccounts) : null;

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={<Button onClick={onClose}>完成</Button>}
            title={<span className="studio-settings-title"><Settings2 className="size-4" /> 项目模型与基础设置</span>}
            width={620}
            destroyOnHidden
        >
            <div className="studio-settings-body">
                <StudioField label="项目名称">
                    <Input value={project.title} maxLength={60} onChange={(event) => updateProject(project.id, { title: event.target.value })} />
                </StudioField>

                <div className="studio-settings-models">
                    <div className="studio-settings-models__head">
                        <div>
                            <strong>项目模型方案</strong>
                            <p>参数按「能力 + 渠道 + 模型」隔离；切换模型不会污染全局画布配置。</p>
                        </div>
                        <Tag bordered={false} color="processing">项目级</Tag>
                    </div>

                    {CAPABILITIES.map((item) => {
                        const options = selectableModelsByCapability(config, item.key);
                        const value = projectModelOption(project, item.key, config);
                        return (
                            <StudioField key={item.key} label={item.label} hint={item.hint}>
                                <div className="studio-settings-model-row">
                                    <StudioModelSelect
                                        config={config}
                                        capability={item.key}
                                        value={value}
                                        allowAuto={false}
                                        disabled={!options.length}
                                        onChange={(next) => setProjectModel(project.id, item.key, next)}
                                    />
                                    {value ? <small>{modelOptionLabel(config, value)}</small> : <small>未选择</small>}
                                </div>
                                {!options.length ? <span className="studio-muted">全局没有可用{item.label}，先到全局模型配置检查渠道。</span> : null}
                                {item.key === "text" && textBuiltin ? (
                                    <div className="studio-settings-params">
                                        <label>
                                            <span>桥接账号</span>
                                            <select
                                                className="studio-select"
                                                value={String(textParamValues.accountId || "")}
                                                onChange={(event) => setProjectModelParam(project.id, "text", "accountId", event.target.value || undefined)}
                                            >
                                                <option value="">请选择本项目账号</option>
                                                {textAccounts.map((account) => (
                                                    <option key={account.id} value={account.id}>
                                                        {account.name}{account.state.loggedIn === true ? "" : account.state.loggedIn === false ? "（未登录）" : "（登录状态未知）"}
                                                    </option>
                                                ))}
                                            </select>
                                            <small>只允许本项目显式选择的账号；不会继承或自动切换到全局账号池。账号未登录时请先到全局账号池扫码。</small>
                                        </label>
                                        {bridgeError ? <span className="studio-muted">桥接不可用：{bridgeError}</span> : null}
                                        {!bridgeError && !textAccounts.length ? <span className="studio-muted">桥接里没有与当前站点匹配的账号；分析任务会被阻止。</span> : null}
                                        {textAccountCheck && !textAccountCheck.ok ? (
                                            <span className="text-xs text-[var(--ant-color-error)]">{textAccountCheck.error}</span>
                                        ) : null}
                                        {textAccountCheck?.ok ? (
                                            <span className="studio-muted">已锁定项目账号「{textAccountCheck.account.name}」；额度状态：未知（桥接未提供可读额度，不会自动换号）。</span>
                                        ) : null}
                                    </div>
                                ) : null}
                                {item.key === "text" && textParams.length ? (
                                    <div className="studio-settings-params">
                                        {textParams.map((parameter) => (
                                            <label key={parameter.key}>
                                                <span>{parameter.label}</span>
                                                <InputNumber
                                                    min={parameter.min}
                                                    max={parameter.max}
                                                    step={parameter.step}
                                                    value={Number(textParamValues[parameter.key] ?? parameter.defaultValue)}
                                                    onChange={(value) => setProjectModelParam(project.id, "text", parameter.key, value === null ? undefined : Number(value))}
                                                />
                                                <small>{parameter.description}</small>
                                            </label>
                                        ))}
                                    </div>
                                ) : null}
                            </StudioField>
                        );
                    })}
                </div>

                <div className="studio-settings-note">
                    <SlidersHorizontal className="size-4" />
                    <p>只显示模型注册表声明支持的温度/输出上限参数；本地或未声明参数的模型不显示可调项，避免制造无效配置。{paramWarnings[0] ? ` ${paramWarnings[0]}` : ""}</p>
                </div>
                <div className="studio-settings-note">
                    <KeyRound className="size-4" />
                    <p>项目 profile 不保存 API Key。需要配置渠道凭证时，仍走全局模型配置；本操作不会修改本项目的模型选择。</p>
                </div>

                <Button icon={<Settings2 className="size-4" />} onClick={() => openGlobalConfig()}>打开全局模型配置</Button>
            </div>
        </Modal>
    );
}
