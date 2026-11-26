import { useMemo, useState } from "react";
import {
    Alert,
    App as AntdApp,
    Button,
    Drawer,
    Form,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Select,
    Space,
    Switch,
    Table,
    Tag,
    Tooltip,
    Typography,
    type TableProps,
} from "antd";
import { Activity, KeyRound, Plus, RefreshCw, Shuffle, Wallet } from "lucide-react";

import {
    adminApi,
    type ChannelBinding,
    type ChannelBindingWrite,
    type ChannelProvider,
    type ChannelRow,
    type ChannelWrite,
    type RegistryModel,
} from "@/services/api/lihuo-server";

import { LoadState, PageHead, money, time, useLoad, writeError } from "./shared";

/**
 * 渠道管理
 * ------------------------------------------------------------
 * 渠道 = 上游连接；模型 = 卖什么；绑定 = 两者之间的映射与成本。
 * 密钥只写不读，页面只展示末 4 位。
 */

const PROVIDER_LABEL: Record<ChannelProvider, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Gemini",
    newapi: "New-API",
    custom: "自定义兼容",
    mock: "Mock（本地）",
};

const HEALTH_META: Record<string, { color: string; label: string }> = {
    healthy: { color: "success", label: "健康" },
    degraded: { color: "warning", label: "降级" },
    unhealthy: { color: "error", label: "不可用" },
    unknown: { color: "default", label: "未探测" },
};

/** 上游成本单位是「微分」：1 元 = 100,000,000 微分 */
const MICROS_PER_YUAN = 100_000_000;
const MICROS_PER_YUAN_PER_1M_TOKENS = 100_000;

function costPer1M(micros: number): number {
    return Number((micros / MICROS_PER_YUAN_PER_1M_TOKENS).toFixed(6));
}

function yuan(valueMicros: number, digits = 4): string {
    return `¥${(valueMicros / MICROS_PER_YUAN).toFixed(digits)}`;
}

function parseJsonObject(text: string | undefined, field: string): Record<string, unknown> {
    if (!text || !text.trim()) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`${field} 不是合法 JSON`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${field} 必须是 JSON 对象`);
    return parsed as Record<string, unknown>;
}

interface ChannelFormValues {
    name: string;
    providerType: ChannelProvider;
    baseUrl?: string;
    apiKey?: string;
    priority: number;
    weight: number;
    maxConcurrency: number;
    timeoutMs: number;
    connectTimeoutMs: number;
    extraHeaders?: string;
    providerOptions?: string;
}

interface BindingFormValues {
    modelId: string;
    providerModel: string;
    contextLength?: number | null;
    supportsStreaming: boolean;
    supportsVision: boolean;
    supportsTools: boolean;
    supportsVideo: boolean;
    inCostYuan: number;
    outCostYuan: number;
    callCostYuan: number;
}

export default function ChannelsPage() {
    const { message } = AntdApp.useApp();
    const load = useLoad(async () => {
        const [channels, models] = await Promise.all([adminApi.channels(), adminApi.models()]);
        return { channels: channels.items, providers: channels.providers, mockAllowed: channels.mockAllowed, models: models.items };
    });

    const [createOpen, setCreateOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<ChannelRow | null>(null);
    const [keyTarget, setKeyTarget] = useState<ChannelRow | null>(null);
    const [bindingTarget, setBindingTarget] = useState<ChannelRow | null>(null);
    const [usageTarget, setUsageTarget] = useState<ChannelRow | null>(null);
    const [routeOpen, setRouteOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const [createForm] = Form.useForm<ChannelFormValues>();
    const [editForm] = Form.useForm<ChannelFormValues>();
    const [keyForm] = Form.useForm<{ apiKey: string }>();
    const [bindingForm] = Form.useForm<BindingFormValues>();

    const createProvider = Form.useWatch("providerType", createForm);
    const editProvider = editTarget?.providerType;

    const modelsById = useMemo(() => {
        const map = new Map<string, RegistryModel>();
        for (const model of load.data?.models ?? []) map.set(model.modelId, model);
        return map;
    }, [load.data?.models]);

    const reload = () => load.reload();

    const toWrite = (values: ChannelFormValues): ChannelWrite => ({
        name: values.name.trim(),
        providerType: values.providerType,
        baseUrl: values.baseUrl?.trim() || undefined,
        apiKey: values.apiKey?.trim() || undefined,
        priority: Number(values.priority),
        weight: Number(values.weight),
        maxConcurrency: Number(values.maxConcurrency),
        timeoutMs: Number(values.timeoutMs),
        connectTimeoutMs: Number(values.connectTimeoutMs),
        extraHeaders: parseJsonObject(values.extraHeaders, "自定义请求头") as Record<string, string>,
        providerOptions: parseJsonObject(values.providerOptions, "Provider 选项"),
    });

    const onCreate = async (values: ChannelFormValues) => {
        setBusy(true);
        try {
            await adminApi.createChannel(toWrite(values));
            message.success("渠道已创建");
            setCreateOpen(false);
            createForm.resetFields();
            reload();
        } catch (err) {
            message.error(writeError(err));
        } finally {
            setBusy(false);
        }
    };

    const onEdit = async (values: ChannelFormValues) => {
        if (!editTarget) return;
        setBusy(true);
        try {
            const payload = toWrite(values);
            delete payload.providerType;
            delete payload.apiKey;
            if (editTarget.providerType === "mock") payload.baseUrl = undefined;
            await adminApi.updateChannel(editTarget.id, payload);
            message.success("渠道已更新");
            setEditTarget(null);
            reload();
        } catch (err) {
            message.error(writeError(err));
        } finally {
            setBusy(false);
        }
    };

    const onRotateKey = async (values: { apiKey: string }) => {
        if (!keyTarget) return;
        setBusy(true);
        try {
            const result = await adminApi.rotateChannelKey(keyTarget.id, values.apiKey.trim());
            message.success(`密钥已更新到 v${result.keyVersion}（${result.apiKeyHint}），旧密钥立即失效`);
            setKeyTarget(null);
            keyForm.resetFields();
            reload();
        } catch (err) {
            message.error(writeError(err));
        } finally {
            setBusy(false);
        }
    };

    const onToggle = async (channel: ChannelRow, enabled: boolean) => {
        try {
            await adminApi.updateChannel(channel.id, { status: enabled ? "enabled" : "disabled" });
            message.success(enabled ? "渠道已启用" : "渠道已禁用");
            reload();
        } catch (err) {
            message.error(writeError(err));
        }
    };

    const onTest = async (channel: ChannelRow) => {
        setBusy(true);
        try {
            const result = await adminApi.testChannel(channel.id);
            if (result.ok) {
                message.success(`连通正常 · ${result.latencyMs}ms${result.billable ? "（本次为真实调用）" : "（未产生调用费用）"}`);
            } else {
                message.error(`测试失败：${result.error ?? `HTTP ${result.status}`}`);
            }
            reload();
        } catch (err) {
            message.error(writeError(err));
        } finally {
            setBusy(false);
        }
    };

    const onHealth = async (channel: ChannelRow) => {
        setBusy(true);
        try {
            const result = await adminApi.healthCheckChannel(channel.id, true);
            if (result.ok) message.success(`探活成功 · ${result.latencyMs}ms`);
            else message.warning(`探活失败：${result.error ?? `HTTP ${result.status}`}`);
            reload();
        } catch (err) {
            message.error(writeError(err));
        } finally {
            setBusy(false);
        }
    };

    const onDelete = async (channel: ChannelRow) => {
        try {
            await adminApi.deleteChannel(channel.id);
            message.success("渠道已删除");
            reload();
        } catch (err) {
            message.error(writeError(err));
        }
    };

    const openEdit = (channel: ChannelRow) => {
        setEditTarget(channel);
        editForm.setFieldsValue({
            name: channel.name,
            providerType: channel.providerType,
            baseUrl: channel.baseUrl,
            priority: channel.priority,
            weight: channel.weight,
            maxConcurrency: channel.maxConcurrency,
            timeoutMs: channel.timeoutMs,
            connectTimeoutMs: channel.connectTimeoutMs,
            extraHeaders: JSON.stringify(channel.extraHeaders ?? {}, null, 2),
            providerOptions: JSON.stringify(channel.providerOptions ?? {}, null, 2),
        });
    };

    const columns: TableProps<ChannelRow>["columns"] = [
        {
            title: "渠道",
            dataIndex: "name",
            render: (_, row) => (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <Space size={6}>
                        <Typography.Text strong>{row.name}</Typography.Text>
                        <Tag>{PROVIDER_LABEL[row.providerType] ?? row.providerType}</Tag>
                        {row.source === "migrated" && <Tag color="blue">迁移</Tag>}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {row.id}
                    </Typography.Text>
                </div>
            ),
        },
        {
            title: "接入地址",
            dataIndex: "baseUrl",
            width: 240,
            render: (value: string, row) => (
                <Typography.Text style={{ fontSize: 12 }} copyable={{ text: value || row.id }}>
                    {row.providerType === "mock" ? "（进程内 mock）" : value}
                </Typography.Text>
            ),
        },
        {
            title: "状态",
            width: 150,
            render: (_, row) => {
                const meta = HEALTH_META[row.healthStatus] ?? HEALTH_META.unknown;
                return (
                    <Space direction="vertical" size={2}>
                        <Switch
                            size="small"
                            checked={row.status === "enabled"}
                            checkedChildren="启用"
                            unCheckedChildren="停用"
                            onChange={(checked) => void onToggle(row, checked)}
                        />
                        <Tooltip title={row.lastError ?? "最近一次探活结果"}>
                            <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                                {meta.label}
                                {row.consecutiveFailures > 0 ? ` ×${row.consecutiveFailures}` : ""}
                            </Tag>
                        </Tooltip>
                    </Space>
                );
            },
        },
        {
            title: "调度",
            width: 150,
            render: (_, row) => (
                <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                    <div>优先级 {row.priority}</div>
                    <div>权重 {row.weight}</div>
                    <div>并发 {row.maxConcurrency === 0 ? "不限" : row.maxConcurrency}</div>
                </div>
            ),
        },
        {
            title: "今日",
            width: 170,
            render: (_, row) => {
                const today = row.today;
                const rate = today.requests ? Math.round((today.success / today.requests) * 100) : 0;
                return (
                    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                        <div>
                            {today.requests} 次 · 成功 {rate}%
                        </div>
                        <div>
                            成本 {yuan(today.upstreamCostMicros)}
                            <span style={{ color: "var(--ant-color-text-tertiary, #999)" }}> / 收入 {money(today.salesCents)}</span>
                        </div>
                        <div>平均 {today.avgLatencyMs}ms</div>
                    </div>
                );
            },
        },
        {
            title: "Key",
            width: 110,
            render: (_, row) => (
                <div style={{ fontSize: 12 }}>
                    <div>{row.hasApiKey ? row.apiKeyHint : "未配置"}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>v{row.apiKeyVersion}</Typography.Text>
                </div>
            ),
        },
        {
            title: "操作",
            width: 300,
            render: (_, row) => (
                <Space size={4} wrap>
                    <Button size="small" onClick={() => void onTest(row)} loading={busy}>
                        测试
                    </Button>
                    <Button size="small" onClick={() => void onHealth(row)} loading={busy}>
                        探活
                    </Button>
                    <Button size="small" icon={<Shuffle size={13} />} onClick={() => setBindingTarget(row)}>
                        映射 {row.bindingCount}
                    </Button>
                    <Button size="small" icon={<Wallet size={13} />} onClick={() => setUsageTarget(row)}>
                        用量
                    </Button>
                    <Button size="small" icon={<KeyRound size={13} />} onClick={() => setKeyTarget(row)}>
                        换钥
                    </Button>
                    <Button size="small" onClick={() => openEdit(row)}>
                        编辑
                    </Button>
                    <Popconfirm title="删除渠道？" description="有模型绑定时无法删除。" onConfirm={() => void onDelete(row)}>
                        <Button size="small" danger>
                            删除
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <>
            <PageHead
                title="渠道管理"
                desc="统一管理上游连接：优先级、权重、并发、健康与成本。模型通过绑定接入渠道，密钥只写不读。"
                extra={
                    <>
                        <Button icon={<Activity size={14} />} onClick={() => setRouteOpen(true)}>
                            路由决策
                        </Button>
                        <Button icon={<RefreshCw size={14} />} onClick={reload}>
                            刷新
                        </Button>
                        <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                            新建渠道
                        </Button>
                    </>
                }
            />

            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="渠道 ≠ 模型"
                description="一个模型可以绑定多个渠道，一个渠道也能提供多个模型。用户侧模型列表只展示能力由渠道计算后的结果；未绑定渠道的模型继续走旧网关。"
            />

            <LoadState loading={load.loading} error={load.error} onRetry={reload}>
                <Table<ChannelRow>
                    rowKey="id"
                    size="middle"
                    dataSource={load.data?.channels ?? []}
                    columns={columns}
                    pagination={false}
                    scroll={{ x: 1180 }}
                    expandable={{
                        expandedRowRender: (row) => (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                最后探活：{row.lastHealthCheckAt ? time(row.lastHealthCheckAt) : "未探测"} ·
                                超时 {row.timeoutMs}ms / 建连 {row.connectTimeoutMs}ms ·
                                创建 {time(row.createdAt)}
                                {row.lastError ? ` · 最近错误：${row.lastError}` : ""}
                            </Typography.Text>
                        ),
                    }}
                />
            </LoadState>

            {/* 新建 */}
            <Modal
                title="新建渠道"
                open={createOpen}
                onCancel={() => setCreateOpen(false)}
                onOk={() => createForm.submit()}
                confirmLoading={busy}
                width={640}
                destroyOnClose
            >
                <Form
                    form={createForm}
                    layout="vertical"
                    initialValues={{
                        providerType: "openai",
                        priority: 100,
                        weight: 100,
                        maxConcurrency: 16,
                        timeoutMs: 120000,
                        connectTimeoutMs: 10000,
                        extraHeaders: "{}",
                        providerOptions: "{}",
                    }}
                    onFinish={(values) => void onCreate(values)}
                >
                    <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: "请输入名称" }]}>
                        <Input placeholder="例如：OpenAI 主渠道" maxLength={60} />
                    </Form.Item>
                    <Form.Item name="providerType" label="Provider 类型" rules={[{ required: true }]}>
                        <Select
                            options={(load.data?.providers ?? []).map((provider) => ({
                                value: provider,
                                label: PROVIDER_LABEL[provider] ?? provider,
                                disabled: provider === "mock" && !load.data?.mockAllowed,
                            }))}
                        />
                    </Form.Item>
                    {createProvider !== "mock" && (
                        <>
                            <Form.Item
                                name="baseUrl"
                                label="API Base URL"
                                rules={[{ required: true, message: "请输入 Base URL" }]}
                                extra="只填到域名/版本前缀，例如 https://api.openai.com；内网地址需要服务端显式放行"
                            >
                                <Input placeholder="https://api.openai.com" />
                            </Form.Item>
                            <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: "请输入 API Key" }]} extra="加密存储，保存后不可回读，只能更换">
                                <Input.Password placeholder="sk-..." autoComplete="new-password" />
                            </Form.Item>
                        </>
                    )}
                    <Space size={12} style={{ display: "flex" }}>
                        <Form.Item name="priority" label="优先级" style={{ flex: 1 }}>
                            <InputNumber min={0} max={10000} style={{ width: "100%" }} />
                        </Form.Item>
                        <Form.Item name="weight" label="权重" style={{ flex: 1 }}>
                            <InputNumber min={0} max={10000} style={{ width: "100%" }} />
                        </Form.Item>
                        <Form.Item name="maxConcurrency" label="最大并发（0=不限）" style={{ flex: 1 }}>
                            <InputNumber min={0} max={1000} style={{ width: "100%" }} />
                        </Form.Item>
                    </Space>
                    <Space size={12} style={{ display: "flex" }}>
                        <Form.Item name="timeoutMs" label="请求超时(ms)" style={{ flex: 1 }}>
                            <InputNumber min={1000} max={600000} step={1000} style={{ width: "100%" }} />
                        </Form.Item>
                        <Form.Item name="connectTimeoutMs" label="建连超时(ms)" style={{ flex: 1 }}>
                            <InputNumber min={500} max={120000} step={500} style={{ width: "100%" }} />
                        </Form.Item>
                    </Space>
                    <Form.Item name="extraHeaders" label="自定义请求头（JSON）" extra="Authorization / Host / Content-Type 由系统管理，不允许覆盖">
                        <Input.TextArea rows={2} spellCheck={false} />
                    </Form.Item>
                    <Form.Item name="providerOptions" label="Provider 选项（JSON）" extra="适配器私有参数，例如自定义鉴权头、apiRoot">
                        <Input.TextArea rows={2} spellCheck={false} />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 编辑 */}
            <Modal
                title={`编辑渠道 · ${editTarget?.name ?? ""}`}
                open={Boolean(editTarget)}
                onCancel={() => setEditTarget(null)}
                onOk={() => editForm.submit()}
                confirmLoading={busy}
                width={640}
                destroyOnClose
            >
                <Form form={editForm} layout="vertical" onFinish={(values) => void onEdit(values)}>
                    <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}>
                        <Input maxLength={60} />
                    </Form.Item>
                    {editProvider !== "mock" && (
                        <Form.Item name="baseUrl" label="API Base URL" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                    )}
                    <Space size={12} style={{ display: "flex" }}>
                        <Form.Item name="priority" label="优先级" style={{ flex: 1 }}>
                            <InputNumber min={0} max={10000} style={{ width: "100%" }} />
                        </Form.Item>
                        <Form.Item name="weight" label="权重" style={{ flex: 1 }}>
                            <InputNumber min={0} max={10000} style={{ width: "100%" }} />
                        </Form.Item>
                        <Form.Item name="maxConcurrency" label="最大并发（0=不限）" style={{ flex: 1 }}>
                            <InputNumber min={0} max={1000} style={{ width: "100%" }} />
                        </Form.Item>
                    </Space>
                    <Space size={12} style={{ display: "flex" }}>
                        <Form.Item name="timeoutMs" label="请求超时(ms)" style={{ flex: 1 }}>
                            <InputNumber min={1000} max={600000} step={1000} style={{ width: "100%" }} />
                        </Form.Item>
                        <Form.Item name="connectTimeoutMs" label="建连超时(ms)" style={{ flex: 1 }}>
                            <InputNumber min={500} max={120000} step={500} style={{ width: "100%" }} />
                        </Form.Item>
                    </Space>
                    <Form.Item name="extraHeaders" label="自定义请求头（JSON）">
                        <Input.TextArea rows={2} spellCheck={false} />
                    </Form.Item>
                    <Form.Item name="providerOptions" label="Provider 选项（JSON）">
                        <Input.TextArea rows={2} spellCheck={false} />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 换钥 */}
            <Modal
                title={`更换 API Key · ${keyTarget?.name ?? ""}`}
                open={Boolean(keyTarget)}
                onCancel={() => setKeyTarget(null)}
                onOk={() => keyForm.submit()}
                confirmLoading={busy}
                destroyOnClose
            >
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="旧密钥会立即失效"
                    description="保存后密文会被覆盖、密钥版本 +1，进行中的请求不受影响，新请求只用新密钥。"
                />
                <Form form={keyForm} layout="vertical" onFinish={(values) => void onRotateKey(values)}>
                    <Form.Item name="apiKey" label="新的 API Key" rules={[{ required: true, min: 8, message: "至少 8 位" }]}>
                        <Input.Password autoComplete="new-password" placeholder="粘贴新密钥" />
                    </Form.Item>
                </Form>
            </Modal>

            {bindingTarget && (
                <BindingsDrawer
                    channel={bindingTarget}
                    models={load.data?.models ?? []}
                    modelsById={modelsById}
                    form={bindingForm}
                    onClose={() => setBindingTarget(null)}
                    onChanged={reload}
                />
            )}

            {usageTarget && <UsageDrawer channel={usageTarget} onClose={() => setUsageTarget(null)} />}

            <RouteDecisionModal open={routeOpen} onClose={() => setRouteOpen(false)} />
        </>
    );
}

/* ------------------------------ 模型映射 ------------------------------ */

function BindingsDrawer({
    channel,
    models,
    modelsById,
    form,
    onClose,
    onChanged,
}: {
    channel: ChannelRow;
    models: RegistryModel[];
    modelsById: Map<string, RegistryModel>;
    form: ReturnType<typeof Form.useForm<BindingFormValues>>[0];
    onClose: () => void;
    onChanged: () => void;
}) {
    const { message } = AntdApp.useApp();
    const load = useLoad(async () => adminApi.channel(channel.id));
    const [busy, setBusy] = useState(false);

    const bind = async (values: BindingFormValues) => {
        setBusy(true);
        try {
            const payload: ChannelBindingWrite & { modelId: string; providerModel: string } = {
                modelId: values.modelId,
                providerModel: values.providerModel.trim(),
                contextLength: values.contextLength ?? null,
                supportsStreaming: values.supportsStreaming,
                supportsVision: values.supportsVision,
                supportsTools: values.supportsTools,
                supportsVideo: values.supportsVideo,
                upstreamInMicrosPer1k: Math.round(Number(values.inCostYuan ?? 0) * MICROS_PER_YUAN_PER_1M_TOKENS),
                upstreamOutMicrosPer1k: Math.round(Number(values.outCostYuan ?? 0) * MICROS_PER_YUAN_PER_1M_TOKENS),
                upstreamCallMicros: Math.round(Number(values.callCostYuan ?? 0) * MICROS_PER_YUAN),
            };
            await adminApi.bindChannelModel(channel.id, payload);
            message.success("已绑定");
            form.resetFields(["providerModel", "contextLength", "inCostYuan", "outCostYuan", "callCostYuan"]);
            load.reload();
            onChanged();
        } catch (err) {
            message.error(writeError(err));
        } finally {
            setBusy(false);
        }
    };

    const patch = async (binding: ChannelBinding, payload: ChannelBindingWrite) => {
        try {
            await adminApi.updateChannelBinding(binding.id, payload);
            message.success("已更新");
            load.reload();
            onChanged();
        } catch (err) {
            message.error(writeError(err));
        }
    };

    const remove = async (binding: ChannelBinding) => {
        try {
            await adminApi.deleteChannelBinding(binding.id);
            message.success("已解绑");
            load.reload();
            onChanged();
        } catch (err) {
            message.error(writeError(err));
        }
    };

    const columns: TableProps<ChannelBinding>["columns"] = [
        {
            title: "逻辑模型 / 上游模型",
            render: (_, row) => (
                <div style={{ fontSize: 12 }}>
                    <div style={{ fontWeight: 500 }}>{modelsById.get(row.modelId)?.displayName ?? row.modelId}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>{row.providerModel}</Typography.Text>
                </div>
            ),
        },
        {
            title: "能力",
            width: 210,
            render: (_, row) => (
                <Space size={4} wrap>
                    {row.supportsStreaming && <Tag color="blue">流式</Tag>}
                    {row.supportsVision && <Tag color="purple">图片输入</Tag>}
                    {row.supportsTools && <Tag color="cyan">工具调用</Tag>}
                    {row.supportsVideo && <Tag color="magenta">视频</Tag>}
                    {!row.supportsStreaming && !row.supportsVision && !row.supportsTools && !row.supportsVideo && <Tag>仅基础</Tag>}
                </Space>
            ),
        },
        {
            title: "上游成本",
            width: 180,
            render: (_, row) => (
                <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                    <div>入 {costPer1M(row.upstreamInMicrosPer1k)} 元/1M</div>
                    <div>出 {costPer1M(row.upstreamOutMicrosPer1k)} 元/1M</div>
                    {row.upstreamCallMicros > 0 && <div>按次 {yuan(row.upstreamCallMicros)}</div>}
                </div>
            ),
        },
        {
            title: "启用",
            width: 70,
            render: (_, row) => (
                <Switch size="small" checked={row.enabled} onChange={(checked) => void patch(row, { enabled: checked })} />
            ),
        },
        {
            title: "",
            width: 70,
            render: (_, row) => (
                <Popconfirm title="解除绑定？" onConfirm={() => void remove(row)}>
                    <Button size="small" danger type="text">
                        解绑
                    </Button>
                </Popconfirm>
            ),
        },
    ];

    return (
        <Drawer title={`模型映射 · ${channel.name}`} open onClose={onClose} width={820} destroyOnClose>
            <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
                <Table<ChannelBinding>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={load.data?.bindings ?? []}
                    columns={columns}
                />
            </LoadState>

            <Typography.Title level={5} style={{ marginTop: 24 }}>
                新增绑定
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                能力位必须按上游实际情况勾选，前端模型选择器依赖它判断「能不能用某个功能」。
            </Typography.Paragraph>
            <Form
                form={form}
                layout="vertical"
                initialValues={{
                    supportsStreaming: true,
                    supportsVision: false,
                    supportsTools: false,
                    supportsVideo: false,
                    inCostYuan: 0,
                    outCostYuan: 0,
                    callCostYuan: 0,
                }}
                onFinish={(values) => void bind(values)}
            >
                <Space size={12} style={{ display: "flex" }} align="start">
                    <Form.Item name="modelId" label="逻辑模型" rules={[{ required: true }]} style={{ flex: 1 }}>
                        <Select
                            showSearch
                            optionFilterProp="label"
                            options={models.map((model) => ({
                                value: model.modelId,
                                label: `${model.displayName}（${model.modelId}）`,
                            }))}
                        />
                    </Form.Item>
                    <Form.Item name="providerModel" label="上游模型名" rules={[{ required: true }]} style={{ flex: 1 }}>
                        <Input placeholder="例如 gpt-4o-mini" />
                    </Form.Item>
                    <Form.Item name="contextLength" label="上下文长度" style={{ width: 140 }}>
                        <InputNumber min={1} style={{ width: "100%" }} placeholder="可选" />
                    </Form.Item>
                </Space>
                <Space size={12} style={{ display: "flex" }} align="start">
                    <Form.Item name="inCostYuan" label="输入成本（元/1M tokens）" style={{ flex: 1 }}>
                        <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="outCostYuan" label="输出成本（元/1M tokens）" style={{ flex: 1 }}>
                        <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="callCostYuan" label="按次成本（元/次）" style={{ flex: 1 }}>
                        <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
                    </Form.Item>
                </Space>
                <Space size={20} style={{ display: "flex", marginBottom: 12 }}>
                    <Form.Item name="supportsStreaming" label="流式" valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Switch size="small" />
                    </Form.Item>
                    <Form.Item name="supportsVision" label="图片输入" valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Switch size="small" />
                    </Form.Item>
                    <Form.Item name="supportsTools" label="工具调用" valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Switch size="small" />
                    </Form.Item>
                    <Form.Item name="supportsVideo" label="视频生成" valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Switch size="small" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={busy} style={{ marginLeft: "auto" }}>
                        绑定
                    </Button>
                </Space>
            </Form>
        </Drawer>
    );
}

/* ------------------------------ 用量 ------------------------------ */

function UsageDrawer({ channel, onClose }: { channel: ChannelRow; onClose: () => void }) {
    const load = useLoad(async () => adminApi.channelUsage(channel.id, 7));
    const summary = load.data?.summary;

    return (
        <Drawer title={`渠道用量 · ${channel.name}`} open onClose={onClose} width={720} destroyOnClose>
            <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
                <Space size={24} style={{ marginBottom: 20, flexWrap: "wrap" }}>
                    <Stat label="请求数" value={String(summary?.requests ?? 0)} />
                    <Stat label="成功率" value={`${summary?.requests ? Math.round(((summary.success ?? 0) / summary.requests) * 100) : 0}%`} />
                    <Stat label="上游成本" value={yuan(summary?.upstreamCostMicros ?? 0)} />
                    <Stat label="用户消费" value={money(summary?.salesCents ?? 0)} />
                    <Stat label="毛利" value={yuan(summary?.grossMarginMicros ?? 0)} />
                    <Stat label="平均延迟" value={`${summary?.avgLatencyMs ?? 0}ms`} />
                </Space>
                <Table
                    rowKey="modelId"
                    size="small"
                    pagination={false}
                    dataSource={load.data?.models ?? []}
                    columns={[
                        { title: "模型", dataIndex: "modelId" },
                        { title: "请求", dataIndex: "requests" },
                        { title: "失败", dataIndex: "failed" },
                        { title: "上游成本", render: (_, row) => yuan(row.upstreamCostMicros) },
                        { title: "用户消费", render: (_, row) => money(row.salesCents) },
                    ]}
                />
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
                    统计窗口：最近 7 天。上游成本按绑定时填写的单价与实际 token 计算，与售价分开累计。
                </Typography.Paragraph>
            </LoadState>
        </Drawer>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div style={{ fontSize: 12, opacity: 0.65 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{value}</div>
        </div>
    );
}

/* ------------------------------ 路由决策 ------------------------------ */

function RouteDecisionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const load = useLoad(async () => adminApi.routeDecisions({ limit: 100 }));
    return (
        <Modal title="最近路由决策" open={open} onCancel={onClose} footer={null} width={980}>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                每次尝试一条记录：选中的渠道、原因（pinned / priority / weighted / failover / legacy_fallback），以及其它候选被淘汰的原因。
            </Typography.Paragraph>
            <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
                <Table
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 12 }}
                    dataSource={load.data?.items ?? []}
                    columns={[
                        { title: "时间", dataIndex: "created_at", width: 150, render: (value: number) => time(value) },
                        { title: "端点", dataIndex: "endpoint", width: 110 },
                        { title: "模型", dataIndex: "model_id", width: 150, ellipsis: true },
                        { title: "渠道", dataIndex: "channel_id", width: 150, ellipsis: true },
                        { title: "尝试", dataIndex: "attempt", width: 56 },
                        { title: "原因", dataIndex: "reason", width: 110 },
                        {
                            title: "来源",
                            dataIndex: "key_source",
                            width: 90,
                            render: (value?: string) =>
                                value === "byok" ? <Tag color="purple">BYOK</Tag> : <Tag>平台</Tag>,
                        },
                        {
                            title: "结果",
                            dataIndex: "status",
                            width: 80,
                            render: (value: string) => <Tag color={value === "success" ? "success" : "error"}>{value}</Tag>,
                        },
                        { title: "耗时", dataIndex: "latency_ms", width: 70, render: (value: number) => `${value}ms` },
                        {
                            title: "候选",
                            render: (_, row) => (
                                <Tooltip
                                    title={
                                        <div style={{ fontSize: 12 }}>
                                            {(row.candidates ?? []).map((item) => (
                                                <div key={`${item.channelId}-${item.reason}`}>
                                                    {item.channelName || item.channelId}：{item.reason}
                                                </div>
                                            ))}
                                        </div>
                                    }
                                >
                                    <Typography.Text style={{ fontSize: 12 }}>{(row.candidates ?? []).length} 个</Typography.Text>
                                </Tooltip>
                            ),
                        },
                    ]}
                />
            </LoadState>
        </Modal>
    );
}
