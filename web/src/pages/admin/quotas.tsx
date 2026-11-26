import { useState } from "react";
import { Alert, App, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import { Pencil, Plus, Trash2, UserRound } from "lucide-react";

import { adminApi, type AdminQuotaPlan } from "@/services/api/lihuo-server";

import { LoadState, PageHead, useLoad } from "./shared";

type PlanFormValues = {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    isDefault: boolean;
    qps: number;
    burst: number;
    maxConcurrent: number;
    dailyRequests: number;
    imageDaily: number;
    imageConcurrent: number;
    audioDaily: number;
    audioConcurrent: number;
    streamConcurrent: number;
    streamIdleTimeoutMs: number;
    streamMaxDurationMs: number;
    requestTimeoutMs: number;
    maxChatRequestBytes: number;
    maxImageRequestBytes: number;
    maxAudioRequestBytes: number;
    maxResponseBytes: number;
};

const defaults: PlanFormValues = {
    id: "",
    name: "",
    description: "",
    enabled: true,
    isDefault: false,
    qps: 5,
    burst: 10,
    maxConcurrent: 10,
    dailyRequests: 2000,
    imageDaily: 100,
    imageConcurrent: 3,
    audioDaily: 200,
    audioConcurrent: 3,
    streamConcurrent: 5,
    streamIdleTimeoutMs: 60000,
    streamMaxDurationMs: 300000,
    requestTimeoutMs: 120000,
    maxChatRequestBytes: 1048576,
    maxImageRequestBytes: 209715200,
    maxAudioRequestBytes: 10485760,
    maxResponseBytes: 33554432,
};

export default function AdminQuotasPage() {
    const { message } = App.useApp();
    const load = useLoad(() => adminApi.quotaPlans());
    const [editing, setEditing] = useState<AdminQuotaPlan | null>(null);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<PlanFormValues>();
    const [assignOpen, setAssignOpen] = useState(false);
    const [assignUserId, setAssignUserId] = useState<number | null>(null);
    const [assignPlanId, setAssignPlanId] = useState<string | null>(null);
    const [assigning, setAssigning] = useState(false);
    const [userQuota, setUserQuota] = useState<Awaited<ReturnType<typeof adminApi.userQuota>> | null>(null);

    const openCreate = () => {
        setEditing(null);
        form.setFieldsValue({ ...defaults });
        setOpen(true);
    };

    const openEdit = (plan: AdminQuotaPlan) => {
        setEditing(plan);
        form.setFieldsValue({
            ...plan,
            description: plan.description,
        });
        setOpen(true);
    };

    const submit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) {
                await adminApi.updateQuotaPlan(editing.id, values);
                message.success("计划已更新");
            } else {
                await adminApi.createQuotaPlan(values);
                message.success("计划已创建");
            }
            setOpen(false);
            load.reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (plan: AdminQuotaPlan) => {
        try {
            await adminApi.deleteQuotaPlan(plan.id);
            message.success("计划已删除");
            load.reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    };

    const lookupUser = async () => {
        if (!assignUserId) return;
        try {
            const quota = await adminApi.userQuota(assignUserId);
            setUserQuota(quota);
            setAssignPlanId(quota.planId);
        } catch (error) {
            setUserQuota(null);
            message.error(error instanceof Error ? error.message : "读取用户配额失败");
        }
    };

    const assign = async () => {
        if (!assignUserId) return;
        setAssigning(true);
        try {
            const quota = await adminApi.assignUserQuota(assignUserId, { planId: assignPlanId });
            setUserQuota(quota);
            message.success("已更新用户配额计划");
            load.reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "分配失败");
        } finally {
            setAssigning(false);
        }
    };

    return (
        <>
            <PageHead
                title="BYOK 配额计划"
                desc="管理用户自带 Key 的 QPS、并发、日请求与图片/音频配额；平台模型计费不受影响。"
                extra={
                    <Space>
                        <Button icon={<UserRound size={16} />} onClick={() => setAssignOpen(true)}>
                            分配用户
                        </Button>
                        <Button type="primary" icon={<Plus size={16} />} onClick={openCreate}>
                            新建计划
                        </Button>
                    </Space>
                }
            />
            <Alert
                className="mb-4"
                type="info"
                showIcon
                message="计划只影响 BYOK 资源准入"
                description="删除仍有用户引用的计划会返回 409；请先在用户分配中解除引用。平台渠道继续使用原有余额/计费逻辑。"
            />
            <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>{null}</LoadState>
            {load.data ? (
                <Table<AdminQuotaPlan>
                    rowKey="id"
                    size="small"
                    dataSource={load.data.items}
                    pagination={false}
                    columns={[
                        {
                            title: "计划",
                            render: (_, plan) => (
                                <div>
                                    <div className="font-medium">
                                        {plan.name} {plan.isDefault ? <Tag color="blue">默认</Tag> : null}
                                    </div>
                                    <div className="text-xs text-stone-500">{plan.id}</div>
                                </div>
                            ),
                        },
                        {
                            title: "QPS / Burst",
                            width: 110,
                            render: (_, plan) => `${plan.qps} / ${plan.burst}`,
                        },
                        {
                            title: "并发",
                            width: 80,
                            render: (_, plan) => plan.maxConcurrent,
                        },
                        {
                            title: "日请求",
                            width: 90,
                            render: (_, plan) => plan.dailyRequests,
                        },
                        {
                            title: "图片 / 音频",
                            width: 150,
                            render: (_, plan) => `${plan.imageDaily} / ${plan.audioDaily}`,
                        },
                        {
                            title: "流并发",
                            width: 80,
                            render: (_, plan) => plan.streamConcurrent,
                        },
                        {
                            title: "状态",
                            width: 80,
                            render: (_, plan) => (plan.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
                        },
                        {
                            title: "操作",
                            width: 150,
                            render: (_, plan) => (
                                <Space size={2}>
                                    <Button size="small" icon={<Pencil size={14} />} onClick={() => openEdit(plan)}>
                                        编辑
                                    </Button>
                                    <Popconfirm title="删除该计划？" onConfirm={() => void remove(plan)}>
                                        <Button size="small" danger icon={<Trash2 size={14} />} />
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                />
            ) : null}

            <Modal
                title={editing ? `编辑计划 · ${editing.name}` : "新建 BYOK 配额计划"}
                open={open}
                onCancel={() => setOpen(false)}
                onOk={() => void submit()}
                confirmLoading={saving}
                width={760}
                destroyOnClose
            >
                <Form form={form} layout="vertical" initialValues={defaults}>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Form.Item name="id" label="计划 ID" rules={[{ required: true }, { pattern: /^[a-zA-Z0-9_-]{2,64}$/, message: "字母、数字、下划线、短横线" }]}>
                            <Input disabled={Boolean(editing)} />
                        </Form.Item>
                        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                    </div>
                    <Form.Item name="description" label="说明">
                        <Input />
                    </Form.Item>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Form.Item name="qps" label="QPS" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                        <Form.Item name="burst" label="Burst" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                        <Form.Item name="maxConcurrent" label="总并发" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                        <Form.Item name="dailyRequests" label="每日总请求" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                        <Form.Item name="imageDaily" label="图片/日" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                        <Form.Item name="imageConcurrent" label="图片并发" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                        <Form.Item name="audioDaily" label="音频/日" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                        <Form.Item name="audioConcurrent" label="音频并发" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                        <Form.Item name="streamConcurrent" label="流并发" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={-1} />
                        </Form.Item>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Form.Item name="streamIdleTimeoutMs" label="流空闲超时 ms">
                            <InputNumber className="w-full" min={1} />
                        </Form.Item>
                        <Form.Item name="streamMaxDurationMs" label="流总时长 ms">
                            <InputNumber className="w-full" min={1} />
                        </Form.Item>
                        <Form.Item name="requestTimeoutMs" label="请求超时 ms">
                            <InputNumber className="w-full" min={1} />
                        </Form.Item>
                        <Form.Item name="maxChatRequestBytes" label="聊天请求体上限">
                            <InputNumber className="w-full" min={1} />
                        </Form.Item>
                        <Form.Item name="maxImageRequestBytes" label="图片请求体上限">
                            <InputNumber className="w-full" min={1} />
                        </Form.Item>
                        <Form.Item name="maxAudioRequestBytes" label="音频请求体上限">
                            <InputNumber className="w-full" min={1} />
                        </Form.Item>
                        <Form.Item name="maxResponseBytes" label="响应体上限">
                            <InputNumber className="w-full" min={1} />
                        </Form.Item>
                    </div>
                    <Space size="large">
                        <Form.Item name="enabled" label="启用" valuePropName="checked" className="mb-0">
                            <Switch size="small" />
                        </Form.Item>
                        <Form.Item name="isDefault" label="设为默认" valuePropName="checked" className="mb-0">
                            <Switch size="small" />
                        </Form.Item>
                    </Space>
                </Form>
            </Modal>

            <Modal
                title="给用户分配 BYOK 配额计划"
                open={assignOpen}
                onCancel={() => setAssignOpen(false)}
                onOk={() => (userQuota ? void assign() : void lookupUser())}
                okText={userQuota ? "保存分配" : "查询用户"}
                confirmLoading={assigning}
                width={620}
                destroyOnClose
            >
                <Space className="mb-4" wrap>
                    <InputNumber
                        placeholder="用户 ID"
                        min={1}
                        value={assignUserId}
                        onChange={(value) => {
                            setAssignUserId(typeof value === "number" ? value : null);
                            setUserQuota(null);
                        }}
                    />
                    <Button onClick={() => void lookupUser()}>查询</Button>
                    <Select
                        className="w-56"
                        placeholder="选择计划"
                        value={assignPlanId}
                        onChange={(value) => setAssignPlanId(value)}
                        options={(load.data?.items ?? []).filter((plan) => plan.enabled).map((plan) => ({ value: plan.id, label: `${plan.name}（${plan.id}）` }))}
                        allowClear
                    />
                </Space>
                {userQuota ? (
                    <Descriptions size="small" column={2} bordered>
                        <Descriptions.Item label="用户 ID">{userQuota.userId}</Descriptions.Item>
                        <Descriptions.Item label="当前计划">{userQuota.plan.name}</Descriptions.Item>
                        <Descriptions.Item label="今日请求">{userQuota.usage.requests} / {userQuota.limits.dailyRequests}</Descriptions.Item>
                        <Descriptions.Item label="并发">{userQuota.usage.concurrent} / {userQuota.limits.maxConcurrent}</Descriptions.Item>
                        <Descriptions.Item label="图片">{userQuota.usage.image} / {userQuota.limits.imageDaily}</Descriptions.Item>
                        <Descriptions.Item label="音频">{userQuota.usage.audio} / {userQuota.limits.audioDaily}</Descriptions.Item>
                    </Descriptions>
                ) : (
                    <div className="text-xs text-stone-500">输入用户 ID 后查询当前配额，再选择要分配的计划。</div>
                )}
            </Modal>
        </>
    );
}
