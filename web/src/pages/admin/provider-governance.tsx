import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Alert,
    App as AntdApp,
    Button,
    Card,
    Descriptions,
    Form,
    Input,
    InputNumber,
    Modal,
    Select,
    Space,
    Table,
    Tabs,
    Tag,
    Typography,
    type TableProps,
} from "antd";
import { Plus, RefreshCw, ShieldCheck } from "lucide-react";

import { adminApi, type ChannelRow } from "@/services/api/lihuo-server";
import {
    createErrorRule,
    getChannelCapabilities,
    getChannelContract,
    listCompensations,
    listErrorRules,
    verifyChannelCapability,
    verifyErrorRule,
    type ChannelCapabilityDetail,
    type ChannelContract,
    type CompensationItem,
    type CompensationKind,
    type CompensationStatus,
    type ErrorRule,
    type ErrorRuleList,
} from "@/services/api/provider-governance";

import { LoadState, PageHead, time, useLoad } from "./shared";

/**
 * Provider 治理
 * ------------------------------------------------------------
 * 三块内容（对应 Phase 5.3J / 5.3K 的取证明细）：
 *   1. 渠道能力：7 项能力 + 费用能力的「适配器是否实现 / 是否有验证记录」；
 *   2. 错误规则：4xx 只有「已验证」的规则才允许判定为未受理（可退款），默认全部未知；
 *   3. 任务补偿：结果未知 / 落库失败 / 取消失败留下的待核对记录。
 *
 * 页面只做只读展示与「登记证据」，不提供任何改账入口：
 * 结算与退款仍然只能走「待核对预扣」页面（后端有并发保护与审计）。
 */

const LEVEL_COLOR: Record<string, string> = {
    verified: "green",
    declared: "blue",
    not_tested: "default",
    unknown: "default",
    unsupported: "red",
};

const LEVEL_TEXT: Record<string, string> = {
    verified: "已验证",
    declared: "仅声明",
    not_tested: "未验证",
    unknown: "未知",
    unsupported: "不支持",
};

const RULE_STATUS_COLOR: Record<string, string> = {
    verified: "green",
    unverified: "orange",
    disabled: "default",
};

const RULE_STATUS_TEXT: Record<string, string> = {
    verified: "已验证",
    unverified: "未验证",
    disabled: "已停用",
};

const COMP_STATUS_COLOR: Record<string, string> = {
    pending: "blue",
    checking: "gold",
    needs_attention: "orange",
    resolved: "green",
    exhausted: "red",
};

const COMP_STATUS_TEXT: Record<string, string> = {
    pending: "待核对",
    checking: "核对中",
    needs_attention: "需人工",
    resolved: "已解决",
    exhausted: "已耗尽",
};

const COMP_KIND_TEXT: Record<string, string> = {
    create_unknown: "创建结果未知",
    persist_unconfirmed: "落库未确认",
    cancel_unconfirmed: "取消未确认",
};

export default function AdminProviderGovernancePage() {
    return (
        <>
            <PageHead
                title="Provider 治理"
                desc="能力验证、错误规则与任务补偿。未验证的能力不会影响账务；未验证的规则不会触发自动退款。"
            />
            <Tabs
                defaultActiveKey="capabilities"
                items={[
                    { key: "capabilities", label: "渠道能力", children: <CapabilitiesPanel /> },
                    { key: "rules", label: "错误规则", children: <ErrorRulesPanel /> },
                    { key: "compensations", label: "任务补偿", children: <CompensationsPanel /> },
                ]}
            />
        </>
    );
}

/* ------------------------------ 渠道能力 ------------------------------ */

function CapabilitiesPanel() {
    const { message } = AntdApp.useApp();
    const channels = useLoad(() => adminApi.channels());
    const [channelId, setChannelId] = useState<string>("");
    const [contract, setContract] = useState<ChannelContract | null>(null);
    const [idempotency, setIdempotency] = useState<ChannelCapabilityDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [target, setTarget] = useState<{ capability: string; label: string } | null>(null);

    const load = useCallback(async (id: string) => {
        if (!id) return;
        setLoading(true);
        setError(null);
        try {
            const [nextContract, nextIdempotency] = await Promise.all([getChannelContract(id), getChannelCapabilities(id)]);
            setContract(nextContract);
            setIdempotency(nextIdempotency);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!channelId && channels.data?.items?.length) {
            const first = channels.data.items[0].id;
            setChannelId(first);
            void load(first);
        }
    }, [channels.data, channelId, load]);

    const columns: TableProps<ChannelContract["capabilities"][number]>["columns"] = [
        { title: "能力", dataIndex: "label", width: 160 },
        {
            title: "等级",
            dataIndex: "level",
            width: 110,
            render: (level: string) => <Tag color={LEVEL_COLOR[level] ?? "default"}>{LEVEL_TEXT[level] ?? level}</Tag>,
        },
        {
            title: "适配器",
            dataIndex: "adapterSupported",
            width: 90,
            render: (value: boolean) => (value ? "已实现" : <span style={{ color: "#c0392b" }}>未实现</span>),
        },
        {
            title: "说明",
            dataIndex: "note",
            render: (value: string) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{value}</Typography.Text>,
        },
        {
            title: "最近证据",
            dataIndex: "verification",
            render: (value: ChannelContract["capabilities"][number]["verification"]) =>
                value ? (
                    <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: value.evidence }}>
                        {value.status} · {time(value.verifiedAt)}
                    </Typography.Text>
                ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        无记录
                    </Typography.Text>
                ),
        },
        {
            title: "操作",
            width: 100,
            render: (_value, row) => (
                <Button size="small" onClick={() => setTarget({ capability: row.capability, label: row.label })}>
                    登记验证
                </Button>
            ),
        },
    ];

    return (
        <LoadState loading={channels.loading} error={channels.error} onRetry={channels.reload}>
            {channels.data && channels.data.items.length === 0 ? (
                <Alert type="info" showIcon message="还没有任何渠道" description="先在「渠道管理」创建渠道，再回来登记能力验证。" />
            ) : (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Space wrap>
                        <Select
                            style={{ minWidth: 260 }}
                            value={channelId}
                            onChange={(value) => {
                                setChannelId(value);
                                void load(value);
                            }}
                            options={(channels.data?.items ?? []).map((channel: ChannelRow) => ({
                                value: channel.id,
                                label: `${channel.name}（${channel.providerType}）`,
                            }))}
                        />
                        <Button icon={<RefreshCw size={14} />} onClick={() => void load(channelId)} loading={loading}>
                            刷新
                        </Button>
                    </Space>

                    {error ? <Alert type="error" showIcon message={error} /> : null}

                    <Card size="small" title="能力矩阵">
                        <Table
                            rowKey="capability"
                            size="small"
                            loading={loading}
                            columns={columns}
                            dataSource={contract?.capabilities ?? []}
                            pagination={false}
                        />
                    </Card>

                    <Card size="small" title="费用能力">
                        {contract?.fee ? (
                            <Descriptions size="small" column={3}>
                                <Descriptions.Item label="可查询费用">
                                    {contract.fee.queryable ? <Tag color="green">已验证</Tag> : <Tag>未验证</Tag>}
                                </Descriptions.Item>
                                <Descriptions.Item label="币种">{contract.fee.currency ?? "—"}</Descriptions.Item>
                                <Descriptions.Item label="单位">{contract.fee.unit ?? "—"}</Descriptions.Item>
                                <Descriptions.Item label="说明" span={3}>
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        {contract.fee.note}
                                    </Typography.Text>
                                </Descriptions.Item>
                            </Descriptions>
                        ) : (
                            <Typography.Text type="secondary">选择渠道后显示</Typography.Text>
                        )}
                    </Card>

                    <Card size="small" title="创建请求幂等（决定「结果未知时能否自动重放」）">
                        {idempotency ? (
                            <Descriptions size="small" column={3}>
                                <Descriptions.Item label="等级">
                                    <Tag color={LEVEL_COLOR[idempotency.level] ?? "default"}>{LEVEL_TEXT[idempotency.level] ?? idempotency.level}</Tag>
                                </Descriptions.Item>
                                <Descriptions.Item label="渠道声明">{idempotency.declared === null ? "未声明" : idempotency.declared ? "声明支持" : "声明不支持"}</Descriptions.Item>
                                <Descriptions.Item label="最近验证">
                                    {idempotency.latest ? `${idempotency.latest.status} · ${time(idempotency.latest.verifiedAt)}` : "无"}
                                </Descriptions.Item>
                                <Descriptions.Item label="说明" span={3}>
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        只有「已验证」才允许在结果未知时自动重放创建请求；渠道声明不等于上游行为。
                                    </Typography.Text>
                                </Descriptions.Item>
                            </Descriptions>
                        ) : (
                            <Typography.Text type="secondary">选择渠道后显示</Typography.Text>
                        )}
                    </Card>

                    <VerifyCapabilityModal
                        channelId={channelId}
                        target={target}
                        onClose={() => setTarget(null)}
                        onDone={async () => {
                            setTarget(null);
                            message.success("验证记录已写入");
                            await load(channelId);
                        }}
                    />
                </Space>
            )}
        </LoadState>
    );
}

function VerifyCapabilityModal({
    channelId,
    target,
    onClose,
    onDone,
}: {
    channelId: string;
    target: { capability: string; label: string } | null;
    onClose: () => void;
    onDone: () => Promise<void>;
}) {
    const { message } = AntdApp.useApp();
    const [form] = Form.useForm<{ status: "verified" | "failed"; evidence: string; note?: string }>();
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        if (!target) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            await verifyChannelCapability(channelId, target.capability, values);
            await onDone();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={Boolean(target)}
            title={target ? `登记验证 · ${target.label}` : ""}
            onCancel={onClose}
            onOk={() => void submit()}
            okText="写入验证记录"
            confirmLoading={saving}
            destroyOnClose
        >
            <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="证据必须可追溯"
                description="请填写官方文档链接、错误码说明，或隔离环境的实际响应摘要；不要粘贴 API Key。"
            />
            <Form form={form} layout="vertical" initialValues={{ status: "verified" }}>
                <Form.Item name="status" label="结论" rules={[{ required: true }]}>
                    <Select options={[{ value: "verified", label: "已验证可用" }, { value: "failed", label: "验证失败 / 不可用" }]} />
                </Form.Item>
                <Form.Item name="evidence" label="证据" rules={[{ required: true, min: 10, message: "至少 10 个字符" }]}>
                    <Input.TextArea rows={4} maxLength={4000} showCount placeholder="例：官方文档 /v1/videos 返回字段说明；或隔离环境实测：同一幂等键重放返回同一 task id" />
                </Form.Item>
                <Form.Item name="note" label="备注">
                    <Input maxLength={500} placeholder="验证人、环境、时间等" />
                </Form.Item>
            </Form>
        </Modal>
    );
}

/* ------------------------------ 错误规则 ------------------------------ */

function ErrorRulesPanel() {
    const { message } = AntdApp.useApp();
    const [status, setStatus] = useState<string>("");
    const [providerType, setProviderType] = useState<string>("");
    const [data, setData] = useState<ErrorRuleList | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [verifying, setVerifying] = useState<ErrorRule | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await listErrorRules({ status: status || undefined, providerType: providerType || undefined }));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [status, providerType]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns: TableProps<ErrorRule>["columns"] = [
        { title: "#", dataIndex: "id", width: 60 },
        {
            title: "作用域",
            dataIndex: "scope",
            width: 110,
            render: (value: ErrorRule["scope"], row) =>
                value === "channel" ? `渠道 ${row.channelId ?? ""}` : `Provider ${row.providerType}`,
        },
        { title: "状态码", width: 110, render: (_v, row) => (row.statusMin === row.statusMax ? String(row.statusMin) : `${row.statusMin}-${row.statusMax}`) },
        { title: "错误类型", dataIndex: "errorType", width: 180, render: (value: string | null) => value ?? <Typography.Text type="secondary">任意</Typography.Text> },
        { title: "语义", dataIndex: "semantics", width: 120, render: (value: string) => (value === "not_accepted" ? "未受理（可退款）" : "未知") },
        {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value: string) => <Tag color={RULE_STATUS_COLOR[value] ?? "default"}>{RULE_STATUS_TEXT[value] ?? value}</Tag>,
        },
        { title: "版本", dataIndex: "version", width: 70 },
        { title: "证据", dataIndex: "evidence", ellipsis: true, render: (value: string | null) => value ?? "—" },
        { title: "更新时间", dataIndex: "updatedAt", width: 170, render: (value: number) => time(value) },
        {
            title: "操作",
            width: 100,
            render: (_v, row) => (
                <Button size="small" onClick={() => setVerifying(row)}>
                    {row.status === "verified" ? "停用" : "验证"}
                </Button>
            ),
        },
    ];

    return (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {data && !data.hasVerifiedRejectionRules ? (
                <Alert
                    type="warning"
                    showIcon
                    message="当前没有任何已验证的拒绝规则"
                    description="这意味着所有 4xx 都会被当作「结果未知」：不自动退款、不重试创建，全部进入人工核对。这是有意的保守默认值。"
                />
            ) : null}

            <Space wrap>
                <Select
                    style={{ width: 180 }}
                    value={status}
                    onChange={setStatus}
                    options={[
                        { value: "", label: "全部状态" },
                        { value: "verified", label: "已验证" },
                        { value: "unverified", label: "未验证" },
                        { value: "disabled", label: "已停用" },
                    ]}
                />
                <Input
                    style={{ width: 200 }}
                    placeholder="Provider（openai / newapi）"
                    value={providerType}
                    onChange={(e) => setProviderType(e.target.value.trim())}
                    allowClear
                />
                <Button icon={<RefreshCw size={14} />} onClick={() => void load()} loading={loading}>
                    刷新
                </Button>
                <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                    新建规则
                </Button>
            </Space>

            {error ? <Alert type="error" showIcon message={error} /> : null}

            <Table rowKey="id" size="small" loading={loading} columns={columns} dataSource={data?.items ?? []} pagination={false} />

            <CreateRuleModal
                open={creating}
                onClose={() => setCreating(false)}
                onDone={async () => {
                    setCreating(false);
                    message.success("规则已创建（默认未验证，不会影响账务）");
                    await load();
                }}
            />
            <VerifyRuleModal
                rule={verifying}
                onClose={() => setVerifying(null)}
                onDone={async () => {
                    setVerifying(null);
                    message.success("规则状态已更新");
                    await load();
                }}
            />
        </Space>
    );
}

function CreateRuleModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
    const { message } = AntdApp.useApp();
    const [form] = Form.useForm();
    const [saving, setSaving] = useState(false);
    const [scope, setScope] = useState<"provider" | "channel">("provider");

    const submit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await createErrorRule({
                scope: values.scope,
                providerType: values.providerType,
                channelId: values.scope === "channel" ? values.channelId : null,
                statusMin: Number(values.statusMin),
                statusMax: Number(values.statusMax),
                errorType: values.errorType ? String(values.errorType).trim() : null,
                semantics: values.semantics,
                note: values.note ? String(values.note) : null,
            });
            await onDone();
            form.resetFields();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} title="新建拒绝规则" onCancel={onClose} onOk={() => void submit()} okText="创建（未验证）" confirmLoading={saving} destroyOnClose>
            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="规则创建后是「未验证」状态"
                description="未验证规则不参与任何账务判断。验证需要单独一步，并填写可追溯证据。"
            />
            <Form
                form={form}
                layout="vertical"
                initialValues={{ scope: "provider", providerType: "openai", statusMin: 400, statusMax: 499, semantics: "not_accepted" }}
                onValuesChange={(changed) => {
                    if (changed.scope) setScope(changed.scope);
                }}
            >
                <Form.Item name="scope" label="作用域" rules={[{ required: true }]}>
                    <Select options={[{ value: "provider", label: "整个 Provider（谨慎）" }, { value: "channel", label: "单个渠道（推荐）" }]} />
                </Form.Item>
                <Form.Item name="providerType" label="Provider" rules={[{ required: true }]}>
                    <Select options={[{ value: "openai", label: "openai" }, { value: "newapi", label: "newapi" }, { value: "custom", label: "custom" }]} />
                </Form.Item>
                {scope === "channel" ? (
                    <Form.Item name="channelId" label="渠道 ID" rules={[{ required: true }]}>
                        <Input placeholder="ch_xxx" />
                    </Form.Item>
                ) : null}
                <Space size={12} style={{ display: "flex" }}>
                    <Form.Item name="statusMin" label="状态码下限" rules={[{ required: true }]} style={{ flex: 1 }}>
                        <InputNumber min={400} max={599} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="statusMax" label="状态码上限" rules={[{ required: true }]} style={{ flex: 1 }}>
                        <InputNumber min={400} max={599} style={{ width: "100%" }} />
                    </Form.Item>
                </Space>
                <Form.Item name="errorType" label="错误类型（可空）" extra="例如 invalid_request_error；留空表示匹配该状态码下的任意错误体">
                    <Input placeholder="invalid_request_error" />
                </Form.Item>
                <Form.Item name="semantics" label="拒绝语义" rules={[{ required: true }]}>
                    <Select options={[{ value: "not_accepted", label: "明确未受理（允许退款）" }, { value: "unknown", label: "未知（不退款）" }]} />
                </Form.Item>
                <Form.Item name="note" label="备注">
                    <Input maxLength={500} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

function VerifyRuleModal({ rule, onClose, onDone }: { rule: ErrorRule | null; onClose: () => void; onDone: () => Promise<void> }) {
    const { message } = AntdApp.useApp();
    const [form] = Form.useForm<{ status: "verified" | "disabled"; evidence?: string }>();
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        if (!rule) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            await verifyErrorRule(rule.id, values);
            await onDone();
            form.resetFields();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={Boolean(rule)}
            title={rule ? `规则 #${rule.id}` : ""}
            onCancel={onClose}
            onOk={() => void submit()}
            okText="提交"
            confirmLoading={saving}
            destroyOnClose
        >
            <Form form={form} layout="vertical" initialValues={{ status: rule?.status === "verified" ? "disabled" : "verified" }}>
                <Form.Item name="status" label="目标状态" rules={[{ required: true }]}>
                    <Select options={[{ value: "verified", label: "验证通过" }, { value: "disabled", label: "停用（回到未知）" }]} />
                </Form.Item>
                <Form.Item name="evidence" label="验证证据" extra="仅「验证通过」必填，至少 10 个字符；停用可不填">
                    <Input.TextArea rows={4} maxLength={4000} showCount placeholder="官方文档链接 / 错误码说明 / 隔离环境实测响应摘要" />
                </Form.Item>
            </Form>
        </Modal>
    );
}

/* ------------------------------ 任务补偿 ------------------------------ */

function CompensationsPanel() {
    const [status, setStatus] = useState<string>("");
    const [kind, setKind] = useState<string>("");
    const [data, setData] = useState<{ items: CompensationItem[]; total: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [detail, setDetail] = useState<CompensationItem | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const page = await listCompensations({ status: status || undefined, kind: kind || undefined, limit: 100 });
            setData({ items: page.items, total: page.total });
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [status, kind]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns: TableProps<CompensationItem>["columns"] = [
        { title: "#", dataIndex: "id", width: 60 },
        { title: "类型", dataIndex: "kind", width: 130, render: (value: CompensationKind) => COMP_KIND_TEXT[value] ?? value },
        {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value: CompensationStatus) => <Tag color={COMP_STATUS_COLOR[value] ?? "default"}>{COMP_STATUS_TEXT[value] ?? value}</Tag>,
        },
        { title: "任务", dataIndex: "taskId", width: 180, render: (value: string | null) => value ?? "—" },
        { title: "上游任务 ID", dataIndex: "providerTaskId", width: 180, render: (value: string | null) => value ?? "—" },
        { title: "模型", dataIndex: "model", width: 140 },
        { title: "尝试", dataIndex: "attempts", width: 70 },
        { title: "最后错误", dataIndex: "lastError", ellipsis: true, render: (value: string | null) => value ?? "—" },
        { title: "下次核对", dataIndex: "nextCheckAt", width: 170, render: (value: number | null) => (value ? time(value) : "—") },
        {
            title: "操作",
            width: 90,
            render: (_v, row) => (
                <Button size="small" onClick={() => setDetail(row)}>
                    详情
                </Button>
            ),
        },
    ];

    return (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
                type="info"
                showIcon
                message="补偿记录只提供证据，不直接动账"
                description="核对器只读上游状态；结算 / 退款必须去「待核对预扣」由管理员确认。同一记录可能被核对多次，`attempts` 即尝试次数。"
            />
            <Space wrap>
                <Select
                    style={{ width: 160 }}
                    value={status}
                    onChange={setStatus}
                    options={[
                        { value: "", label: "全部状态" },
                        { value: "pending", label: "待核对" },
                        { value: "checking", label: "核对中" },
                        { value: "needs_attention", label: "需人工" },
                        { value: "resolved", label: "已解决" },
                        { value: "exhausted", label: "已耗尽" },
                    ]}
                />
                <Select
                    style={{ width: 200 }}
                    value={kind}
                    onChange={setKind}
                    options={[
                        { value: "", label: "全部类型" },
                        { value: "create_unknown", label: "创建结果未知" },
                        { value: "persist_unconfirmed", label: "落库未确认" },
                        { value: "cancel_unconfirmed", label: "取消未确认" },
                    ]}
                />
                <Button icon={<RefreshCw size={14} />} onClick={() => void load()} loading={loading}>
                    刷新
                </Button>
                <Typography.Text type="secondary">共 {data?.total ?? 0} 条</Typography.Text>
            </Space>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Table rowKey="id" size="small" loading={loading} columns={columns} dataSource={data?.items ?? []} pagination={false} />

            <Modal open={Boolean(detail)} title={detail ? `补偿记录 #${detail.id}` : ""} footer={null} width={760} onCancel={() => setDetail(null)}>
                {detail ? (
                    <Descriptions size="small" column={2} bordered>
                        <Descriptions.Item label="类型">{COMP_KIND_TEXT[detail.kind] ?? detail.kind}</Descriptions.Item>
                        <Descriptions.Item label="状态">{COMP_STATUS_TEXT[detail.status] ?? detail.status}</Descriptions.Item>
                        <Descriptions.Item label="用户">{detail.userId}</Descriptions.Item>
                        <Descriptions.Item label="预扣记录">{detail.usageRecordId ?? "—"}</Descriptions.Item>
                        <Descriptions.Item label="任务">{detail.taskId ?? "—"}</Descriptions.Item>
                        <Descriptions.Item label="上游任务">{detail.providerTaskId ?? "—"}</Descriptions.Item>
                        <Descriptions.Item label="渠道">{detail.channelId ?? "—"}</Descriptions.Item>
                        <Descriptions.Item label="上游模型">{detail.providerModel ?? "—"}</Descriptions.Item>
                        <Descriptions.Item label="幂等键" span={2}>
                            {detail.idempotencyKey ?? "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="最后错误" span={2}>
                            {detail.lastError ?? "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Provider 结果" span={2}>
                            <pre style={{ margin: 0, maxHeight: 240, overflow: "auto", fontSize: 12 }}>
                                {detail.providerResult ? JSON.stringify(detail.providerResult, null, 2) : "—"}
                            </pre>
                        </Descriptions.Item>
                    </Descriptions>
                ) : null}
            </Modal>
        </Space>
    );
}
