import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import { KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { byokApi, type ByokCatalog, type ByokChannel, type ByokChannelModelInput, type ByokProvider, type ByokQuota, type ByokUserModel } from "@/services/api/byok";

/**
 * 我的渠道（BYOK）
 * ------------------------------------------------------------
 * 统一在「配置 → 渠道」里管理：Provider、Base URL、Key、模型映射、测试、换钥、删除。
 * Key 加密存在服务端，页面只显示末 4 位；模型可选平台目录或用户自定义模型，可改上游名称。
 */

const CAPABILITY_LABEL: Record<string, string> = {
    text: "文本",
    image: "图像",
    video: "视频",
    audio: "语音",
    embedding: "向量",
};

interface DraftModel {
    providerModel: string;
    enabled: boolean;
    modelSource: "catalog" | "custom";
}

interface Draft {
    id?: string;
    name: string;
    providerType: ByokProvider;
    baseUrl: string;
    apiKey: string;
    isDefault: boolean;
    models: Record<string, DraftModel>;
}

const emptyDraft: Draft = {
    name: "",
    providerType: "openai",
    baseUrl: "",
    apiKey: "",
    isDefault: false,
    models: {},
};

function time(seconds: number | null): string {
    if (!seconds) return "—";
    return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

export function ByokChannelsSection({ onChanged }: { onChanged: () => void | Promise<void> }) {
    const { message } = App.useApp();
    const [channels, setChannels] = useState<ByokChannel[]>([]);
    const [catalog, setCatalog] = useState<ByokCatalog | null>(null);
    const [quota, setQuota] = useState<ByokQuota | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [rotating, setRotating] = useState<ByokChannel | null>(null);
    const [usageTarget, setUsageTarget] = useState<ByokChannel | null>(null);
    const [rotateForm] = Form.useForm<{ apiKey: string }>();
    const [customOpen, setCustomOpen] = useState(false);
    const [customModels, setCustomModels] = useState<ByokUserModel[]>([]);
    const [customBusy, setCustomBusy] = useState(false);
    const [customForm] = Form.useForm<{
        name: string;
        capability: "text" | "image" | "audio";
        upstreamModel?: string;
        supportsStreaming?: boolean;
        supportsVision?: boolean;
        supportsTools?: boolean;
        contextLength?: number;
        maxOutputTokens?: number;
    }>();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [list, catalogData, quotaData] = await Promise.all([
                byokApi.channels(),
                byokApi.catalog(),
                byokApi.quota().catch(() => null),
            ]);
            setChannels(list.items);
            setCatalog(catalogData);
            setQuota(quotaData);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载渠道失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    const loadUserModels = useCallback(async () => {
        try {
            const result = await byokApi.userModels();
            setCustomModels(result.items);
        } catch {
            // 自定义模型拉取失败不影响渠道编辑
        }
    }, []);

    const openCustomModels = () => {
        setCustomOpen(true);
        customForm.setFieldsValue({ capability: "text", supportsStreaming: true });
        void loadUserModels();
    };

    const createCustomModel = async () => {
        if (!draft) return;
        const values = await customForm.validateFields();
        setCustomBusy(true);
        try {
            const created = await byokApi.createUserModel({
                name: values.name.trim(),
                providerType: draft.providerType,
                capability: values.capability,
                supportsStreaming: values.supportsStreaming ?? values.capability === "text",
                supportsVision: values.supportsVision,
                supportsTools: values.supportsTools,
                contextLength: values.contextLength ?? null,
                maxOutputTokens: values.maxOutputTokens ?? null,
            });
            await load();
            await loadUserModels();
            setDraft({
                ...draft,
                models: {
                    ...draft.models,
                    [created.id]: {
                        providerModel: values.upstreamModel?.trim() || created.id,
                        enabled: true,
                        modelSource: "custom",
                    },
                },
            });
            customForm.resetFields();
            message.success("自定义模型已创建，请填写上游模型名后保存渠道");
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setCustomBusy(false);
        }
    };

    const removeCustomModel = async (model: ByokUserModel) => {
        setCustomBusy(true);
        try {
            await byokApi.deleteUserModel(model.id);
            await load();
            await loadUserModels();
            if (draft) {
                const next = { ...draft.models };
                delete next[model.id];
                setDraft({ ...draft, models: next });
            }
            message.success("自定义模型已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        } finally {
            setCustomBusy(false);
        }
    };

    const providerInfo = catalog?.providers.find((item) => item.value === draft?.providerType);
    const modelsById = useMemo(() => new Map((catalog?.models ?? []).map((model) => [model.modelId, model])), [catalog]);

    const openCreate = () => setDraft({ ...emptyDraft });
    const openEdit = (channel: ByokChannel) => {
        const models: Record<string, DraftModel> = {};
        for (const model of channel.models) {
            models[model.modelId] = {
                providerModel: model.providerModel,
                enabled: model.enabled,
                modelSource: model.source === "user" ? "custom" : "catalog",
            };
        }
        setDraft({
            id: channel.id,
            name: channel.name,
            providerType: channel.providerType,
            baseUrl: channel.baseUrl,
            apiKey: "",
            isDefault: channel.isDefault,
            models,
        });
    };

    const afterChange = async () => {
        await load();
        await onChanged();
    };

    const saveDraft = async () => {
        if (!draft) return;
        const name = draft.name.trim();
        if (!name) return message.warning("请填写渠道名称");
        if (!draft.id && draft.apiKey.trim().length < 8) return message.warning("请填写至少 8 位的 API Key");
        if (providerInfo?.baseUrlRequired && !draft.baseUrl.trim()) return message.warning("该 Provider 必须填写 Base URL");
        const models: ByokChannelModelInput[] = Object.entries(draft.models).map(([modelId, value]) => ({
            modelId,
            providerModel: value.providerModel.trim() || modelId,
            enabled: value.enabled,
            modelSource: value.modelSource,
        }));
        if (!models.length) return message.warning("至少选择一个模型，否则这个渠道无法被使用");

        setBusy(true);
        try {
            if (draft.id) {
                await byokApi.updateChannel(draft.id, {
                    name,
                    baseUrl: draft.providerType === "mock" ? undefined : draft.baseUrl.trim(),
                    ...(draft.isDefault ? { isDefault: true } : {}),
                });
                await byokApi.updateChannelModels(draft.id, models);
                message.success("渠道已更新");
            } else {
                await byokApi.createChannel({
                    name,
                    providerType: draft.providerType,
                    apiKey: draft.apiKey.trim(),
                    baseUrl: draft.providerType === "mock" ? undefined : draft.baseUrl.trim() || undefined,
                    models,
                    isDefault: draft.isDefault,
                });
                message.success("渠道已创建（密钥已加密保存）");
            }
            setDraft(null);
            await afterChange();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setBusy(false);
        }
    };

    const onTest = async (channel: ByokChannel) => {
        setBusy(true);
        try {
            const result = await byokApi.testChannel(channel.id);
            if (result.ok) message.success(`连接正常 · ${result.latencyMs}ms`);
            else message.error(`连接失败：${result.error ?? `HTTP ${result.status}`}`);
            await afterChange();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "测试失败");
        } finally {
            setBusy(false);
        }
    };

    const onDefault = async (channel: ByokChannel) => {
        try {
            await byokApi.updateChannel(channel.id, { isDefault: true });
            message.success("已设为默认渠道");
            await afterChange();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "设置失败");
        }
    };

    const onDelete = async (channel: ByokChannel) => {
        try {
            await byokApi.deleteChannel(channel.id);
            message.success("渠道已删除");
            await afterChange();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    };

    const onRotate = async (values: { apiKey: string }) => {
        if (!rotating) return;
        setBusy(true);
        try {
            await byokApi.rotateChannelKey(rotating.id, values.apiKey.trim());
            message.success("密钥已更新，旧密钥立即失效");
            setRotating(null);
            rotateForm.resetFields();
            await afterChange();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新失败");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">我的渠道（BYOK）</div>
                    <div className="text-xs text-stone-500">使用自己的 API Key，不消耗平台额度；可选择平台模型，或添加自己的自定义模型。</div>
                </div>
                <Space>
                    <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void load()} loading={loading}>
                        刷新
                    </Button>
                    <Button size="small" type="primary" icon={<Plus className="size-3.5" />} onClick={openCreate}>
                        添加渠道
                    </Button>
                </Space>
            </div>

            {quota ? (
                <div className="rounded-lg border border-stone-200/70 bg-stone-50/60 p-3 text-xs dark:border-stone-700/60 dark:bg-stone-900/30">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-stone-800 dark:text-stone-100">
                            资源配额 · {quota.plan.name}
                        </div>
                        <div className="text-stone-500">
                            重置 {new Date(quota.resetAt * 1000).toLocaleString("zh-CN", { hour12: false })}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-stone-600 dark:text-stone-300 sm:grid-cols-4">
                        <div>QPS {quota.limits.qps} · Burst {quota.limits.burst}</div>
                        <div>并发 {quota.usage.concurrent}/{quota.limits.maxConcurrent}</div>
                        <div>今日请求 {quota.usage.requests}/{quota.limits.dailyRequests}</div>
                        <div>流式 {quota.usage.streams}/{quota.limits.streamConcurrent}</div>
                        <div>图片 {quota.usage.image}/{quota.limits.imageDaily}</div>
                        <div>音频 {quota.usage.audio}/{quota.limits.audioDaily}</div>
                    </div>
                </div>
            ) : !loading ? (
                <div className="text-xs text-stone-500">配额信息暂不可用（不影响当前渠道配置）。</div>
            ) : null}

            {channels.length === 0 && !loading ? (
                <Alert
                    type="info"
                    showIcon
                    message="还没有自己的渠道"
                    description="添加一个渠道后，它的模型会出现在模型选择器里，标注「我的 Key」；选中后不扣平台额度。"
                />
            ) : (
                <Table<ByokChannel>
                    rowKey="id"
                    size="small"
                    loading={loading}
                    pagination={false}
                    dataSource={channels}
                    scroll={{ x: 860 }}
                    columns={[
                        {
                            title: "渠道",
                            render: (_, channel) => (
                                <div className="text-xs">
                                    <div className="text-sm font-semibold">
                                        {channel.name}
                                        {channel.isDefault ? <Tag color="blue" className="ml-2">默认</Tag> : null}
                                    </div>
                                    <div className="text-stone-500">
                                        {channel.providerType} · {channel.baseUrl || "官方端点"}
                                    </div>
                                </div>
                            ),
                        },
                        {
                            title: "密钥",
                            width: 110,
                            render: (_, channel) => (
                                <div className="text-xs">
                                    <div className="font-mono">{channel.apiKeyHint}</div>
                                    <div className="text-stone-500">v{channel.apiKeyVersion}</div>
                                </div>
                            ),
                        },
                        {
                            title: "模型",
                            width: 220,
                            render: (_, channel) => (
                                <Tooltip
                                    title={
                                        <div className="text-xs">
                                            {channel.models.map((model) => (
                                                <div key={model.modelId}>
                                                    {model.displayName} → {model.providerModel}
                                                    {model.enabled ? "" : "（停用）"}
                                                </div>
                                            ))}
                                        </div>
                                    }
                                >
                                    <Space size={4} wrap>
                                        {channel.models.slice(0, 3).map((model) => (
                                            <Tag key={model.modelId} color={model.enabled ? "default" : "default"}>
                                                {model.displayName}
                                            </Tag>
                                        ))}
                                        {channel.models.length > 3 ? <Tag>+{channel.models.length - 3}</Tag> : null}
                                        {channel.models.length === 0 ? <Tag color="orange">未配置模型</Tag> : null}
                                    </Space>
                                </Tooltip>
                            ),
                        },
                        {
                            title: "最近",
                            width: 160,
                            render: (_, channel) => (
                                <div className="text-xs">
                                    <div>{channel.lastUsedAt ? time(channel.lastUsedAt) : "尚未调用"}</div>
                                    <div className="text-stone-500">
                                        成功 {channel.callCount - channel.failCount} / 失败 {channel.failCount}
                                    </div>
                                </div>
                            ),
                        },
                        {
                            title: "操作",
                            width: 300,
                            render: (_, channel) => (
                                <Space size={2} wrap>
                                    <Button size="small" loading={busy} onClick={() => void onTest(channel)}>
                                        测试
                                    </Button>
                                    {!channel.isDefault ? (
                                        <Button size="small" onClick={() => void onDefault(channel)}>
                                            设默认
                                        </Button>
                                    ) : null}
                                    <Button size="small" onClick={() => setUsageTarget(channel)}>
                                        用量
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<KeyRound className="size-3.5" />}
                                        onClick={() => {
                                            setRotating(channel);
                                            rotateForm.setFieldsValue({ apiKey: "" });
                                        }}
                                    >
                                        换钥
                                    </Button>
                                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(channel)}>
                                        编辑
                                    </Button>
                                    <Popconfirm title="删除该渠道？" description="Key 会立即失效，模型也会从选择器移除。" onConfirm={() => void onDelete(channel)}>
                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} />
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                />
            )}

            {/* 新建 / 编辑 */}
            <Drawer
                title={draft?.id ? `编辑渠道 · ${draft.name}` : "添加渠道"}
                open={Boolean(draft)}
                onClose={() => setDraft(null)}
                width={720}
                destroyOnClose
                extra={
                    <Space>
                        <Button onClick={() => setDraft(null)}>取消</Button>
                        <Button type="primary" loading={busy} onClick={() => void saveDraft()}>
                            保存
                        </Button>
                    </Space>
                }
            >
                {draft ? (
                    <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs text-stone-500">
                                渠道名称
                                <Input
                                    className="mt-1"
                                    value={draft.name}
                                    maxLength={60}
                                    placeholder="例如：我的 OpenAI"
                                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                                />
                            </label>
                            <label className="text-xs text-stone-500">
                                Provider
                                <Select
                                    className="mt-1 w-full"
                                    value={draft.providerType}
                                    disabled={Boolean(draft.id)}
                                    onChange={(value: ByokProvider) => setDraft({ ...draft, providerType: value })}
                                    options={(catalog?.providers ?? []).map((provider) => ({ value: provider.value, label: provider.label }))}
                                />
                            </label>
                        </div>

                        {draft.providerType !== "mock" ? (
                            <label className="block text-xs text-stone-500">
                                API Base URL
                                <Input
                                    className="mt-1"
                                    value={draft.baseUrl}
                                    placeholder={providerInfo?.defaultBaseUrl || "https://your-gateway.example.com"}
                                    onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                                />
                                <span className="mt-1 block text-[11px] text-stone-400">
                                    {providerInfo?.baseUrlRequired ? "该 Provider 必须填写" : `留空使用官方端点：${providerInfo?.defaultBaseUrl ?? ""}`}
                                </span>
                            </label>
                        ) : null}

                        {!draft.id ? (
                            <label className="block text-xs text-stone-500">
                                API Key
                                <Input.Password
                                    className="mt-1"
                                    value={draft.apiKey}
                                    autoComplete="new-password"
                                    placeholder="sk-..."
                                    onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                                />
                                <span className="mt-1 block text-[11px] text-stone-400">加密后保存，只能更换，无法查看明文。</span>
                            </label>
                        ) : null}

                        <div>
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="text-xs text-stone-500">模型（平台目录或自定义模型，可改上游模型名）</div>
                                <Space size={4}>
                                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={openCustomModels}>
                                        自定义模型
                                    </Button>
                                    <Select
                                        size="small"
                                        className="w-64"
                                        placeholder="添加模型"
                                        value={null}
                                        showSearch
                                        optionFilterProp="label"
                                        onChange={(modelId: string) => {
                                            if (!modelId) return;
                                            const picked = catalog?.models.find((model) => model.modelId === modelId);
                                            setDraft({
                                                ...draft,
                                                models: {
                                                    ...draft.models,
                                                    [modelId]: {
                                                        providerModel: modelId,
                                                        enabled: true,
                                                        modelSource: picked?.source === "user" ? "custom" : "catalog",
                                                    },
                                                },
                                            });
                                        }}
                                        options={(catalog?.models ?? [])
                                            .filter((model) => !draft.models[model.modelId] && model.capability !== "embedding" && model.capability !== "video")
                                            .map((model) => ({
                                                value: model.modelId,
                                                label: `${model.displayName}（${CAPABILITY_LABEL[model.capability] ?? model.capability}${model.source === "user" ? " · 自定义" : ""}）`,
                                            }))}
                                    />
                                </Space>
                            </div>

                            {Object.keys(draft.models).length === 0 ? (
                                <Alert type="warning" showIcon message="至少添加一个模型，否则这个渠道无法使用" />
                            ) : (
                                <div className="space-y-2">
                                    {Object.entries(draft.models).map(([modelId, value]) => {
                                        const model = modelsById.get(modelId);
                                        return (
                                            <div key={modelId} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200/70 px-3 py-2 dark:border-stone-700/60">
                                                <div className="min-w-[9rem] flex-1">
                                                    <div className="flex items-center gap-1 text-xs font-medium">
                                                        <span>{model?.displayName ?? modelId}</span>
                                                        {value.modelSource === "custom" ? <Tag color="purple">自定义</Tag> : null}
                                                    </div>
                                                    <div className="text-[11px] text-stone-500">
                                                        {modelId} · {CAPABILITY_LABEL[model?.capability ?? ""] ?? model?.capability ?? ""}
                                                    </div>
                                                </div>
                                                <Input
                                                    size="small"
                                                    className="w-56"
                                                    value={value.providerModel}
                                                    placeholder="上游模型名"
                                                    onChange={(event) =>
                                                        setDraft({
                                                            ...draft,
                                                            models: { ...draft.models, [modelId]: { ...value, providerModel: event.target.value } },
                                                        })
                                                    }
                                                />
                                                <Switch
                                                    size="small"
                                                    checked={value.enabled}
                                                    onChange={(checked) =>
                                                        setDraft({ ...draft, models: { ...draft.models, [modelId]: { ...value, enabled: checked } } })
                                                    }
                                                />
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    danger
                                                    onClick={() => {
                                                        const next = { ...draft.models };
                                                        delete next[modelId];
                                                        setDraft({ ...draft, models: next });
                                                    }}
                                                >
                                                    移除
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-stone-500">
                            <Switch size="small" checked={draft.isDefault} onChange={(checked) => setDraft({ ...draft, isDefault: checked })} />
                            设为默认渠道（不指定渠道时优先使用）
                        </div>
                    </div>
                ) : null}
            </Drawer>

            {/* 自定义模型 */}
            <Modal
                title="自定义模型"
                open={customOpen}
                onCancel={() => setCustomOpen(false)}
                onOk={() => void createCustomModel()}
                okText="创建并添加"
                confirmLoading={customBusy}
                destroyOnClose
                width={620}
            >
                <Alert
                    className="mb-4"
                    type="info"
                    showIcon
                    message="自定义模型只属于你，不会出现在平台模型目录"
                    description="能力必须手动声明，系统不会按模型名称推断；Provider 必须与当前渠道一致。"
                />
                <Form form={customForm} layout="vertical" initialValues={{ capability: "text", supportsStreaming: true }}>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Form.Item name="name" label="模型名称" rules={[{ required: true, max: 60 }]}>
                            <Input placeholder="例如：我的 GPT-4o" />
                        </Form.Item>
                        <Form.Item label="Provider / 协议">
                            <Input value={`${draft?.providerType ?? ""} / ${draft?.providerType === "anthropic" ? "anthropic" : draft?.providerType === "gemini" ? "gemini" : "openai"}`} disabled />
                        </Form.Item>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Form.Item name="capability" label="能力" rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { value: "text", label: "文本" },
                                    { value: "image", label: "图像" },
                                    { value: "audio", label: "语音" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="upstreamModel" label="上游模型名（可选）">
                            <Input placeholder="例如：gpt-4o-2024-08-06" />
                        </Form.Item>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Form.Item name="contextLength" label="上下文长度">
                            <InputNumber className="w-full" min={1} placeholder="例如 128000" />
                        </Form.Item>
                        <Form.Item name="maxOutputTokens" label="最大输出 tokens">
                            <InputNumber className="w-full" min={1} placeholder="例如 16384" />
                        </Form.Item>
                    </div>
                    <Space size="large" wrap>
                        <Form.Item name="supportsStreaming" label="流式" valuePropName="checked" className="mb-0">
                            <Switch size="small" />
                        </Form.Item>
                        <Form.Item name="supportsVision" label="视觉输入" valuePropName="checked" className="mb-0">
                            <Switch size="small" />
                        </Form.Item>
                        <Form.Item name="supportsTools" label="工具调用" valuePropName="checked" className="mb-0">
                            <Switch size="small" />
                        </Form.Item>
                    </Space>

                    <div className="mt-5 border-t border-stone-200/70 pt-3 dark:border-stone-700/60">
                        <div className="mb-2 text-xs font-medium text-stone-600 dark:text-stone-300">已有自定义模型</div>
                        {customModels.length === 0 ? (
                            <div className="text-xs text-stone-500">还没有自定义模型</div>
                        ) : (
                            <div className="space-y-1">
                                {customModels.map((model) => (
                                    <div key={model.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-stone-50 dark:hover:bg-stone-900/40">
                                        <span className="min-w-0 flex-1 truncate">
                                            {model.name} · {CAPABILITY_LABEL[model.capability] ?? model.capability} · {model.bindingCount} 个绑定
                                        </span>
                                        <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => void removeCustomModel(model)} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </Form>
            </Modal>

            {/* 换钥 */}
            <Modal
                title={`更换密钥 · ${rotating?.name ?? ""}`}
                open={Boolean(rotating)}
                onCancel={() => setRotating(null)}
                onOk={() => rotateForm.submit()}
                confirmLoading={busy}
                destroyOnClose
            >
                <Alert
                    className="mb-4"
                    type="warning"
                    showIcon
                    message="旧密钥立即失效"
                    description="保存后密钥版本 +1，旧密文被覆盖；正在进行的请求不受影响。"
                />
                <Form form={rotateForm} layout="vertical" onFinish={(values) => void onRotate(values)}>
                    <Form.Item name="apiKey" label="新的 API Key" rules={[{ required: true, min: 8 }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 用量 */}
            <Drawer title={`最近调用 · ${usageTarget?.name ?? ""}`} open={Boolean(usageTarget)} onClose={() => setUsageTarget(null)} width={720}>
                {usageTarget ? <ChannelUsage channel={usageTarget} /> : null}
            </Drawer>
        </div>
    );
}

function ChannelUsage({ channel }: { channel: ByokChannel }) {
    const [rows, setRows] = useState<Array<{ id: number; model: string; endpoint: string; status: string; prompt_tokens: number; completion_tokens: number; created_at: number }>>([]);
    useEffect(() => {
        let alive = true;
        byokApi
            .channelUsage(channel.id, 30)
            .then((result) => {
                if (alive) setRows(result.items);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [channel.id]);

    return (
        <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={rows}
            columns={[
                { title: "时间", dataIndex: "created_at", render: (value: number) => time(value) },
                { title: "模型", dataIndex: "model" },
                { title: "端点", dataIndex: "endpoint" },
                { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "settled" ? "green" : "red"}>{value}</Tag> },
                { title: "tokens", render: (_: unknown, row: { prompt_tokens: number; completion_tokens: number }) => row.prompt_tokens + row.completion_tokens },
            ]}
        />
    );
}
