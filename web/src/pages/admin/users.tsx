import { useState } from "react";
import {
    App as AntdApp,
    Button,
    Form,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    type TableProps,
} from "antd";
import { Plus } from "lucide-react";

import { adminApi, type AdminUser } from "@/services/api/lihuo-server";

import { LoadState, PageHead, money, time, useLoad, writeError } from "./shared";

interface CreateValues {
    username: string;
    password: string;
    role: "admin" | "user";
    quotaCents: number;
    points: number;
}

export default function UsersPage() {
    const { message } = AntdApp.useApp();
    const load = useLoad(() => adminApi.users());
    const [createOpen, setCreateOpen] = useState(false);
    const [quotaTarget, setQuotaTarget] = useState<AdminUser | null>(null);
    const [pointsTarget, setPointsTarget] = useState<AdminUser | null>(null);
    const [busy, setBusy] = useState(false);
    const [form] = Form.useForm<CreateValues>();
    const [quotaForm] = Form.useForm<{ amount: number; reason: string }>();
    const [pointsForm] = Form.useForm<{ amount: number; reason: string }>();

    const onCreate = async (v: CreateValues) => {
        setBusy(true);
        try {
            await adminApi.createUser({
                username: v.username.trim(),
                password: v.password,
                role: v.role,
                quotaCents: Number(v.quotaCents ?? 0),
            });
            message.success("用户已创建");
            setCreateOpen(false);
            form.resetFields();
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const onQuota = async (v: { amount: number; reason: string }) => {
        if (!quotaTarget) return;
        setBusy(true);
        try {
            const result = await adminApi.creditUser(quotaTarget.id, { amountCents: Number(v.amount), reason: v.reason.trim() });
            message.success(`已入账，当前余额 ${(result.balanceCents / 100).toFixed(2)} 元`);
            setQuotaTarget(null);
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const onPoints = async (v: { amount: number; reason: string }) => {
        if (!pointsTarget) return;
        setBusy(true);
        try {
            const result = await adminApi.creditPoints(pointsTarget.id, { amount: Number(v.amount), reason: v.reason.trim() });
            message.success(`已调整，当前积分 ${result.balance}`);
            setPointsTarget(null);
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const toggleStatus = async (u: AdminUser) => {
        setBusy(true);
        try {
            await adminApi.updateUser(u.id, { status: u.status === "active" ? "banned" : "active" });
            message.success(u.status === "active" ? "已封禁，该用户所有会话立即失效" : "已解封");
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const columns: TableProps<AdminUser>["columns"] = [
        { title: "ID", dataIndex: "id", key: "id", width: 64 },
        { title: "用户名", dataIndex: "username", key: "username" },
        {
            title: "角色",
            dataIndex: "role",
            key: "role",
            width: 100,
            render: (v: string) => <Tag color={v === "admin" ? "purple" : "default"}>{v === "admin" ? "管理员" : "普通用户"}</Tag>,
        },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 100,
            render: (v: string) => <Tag color={v === "active" ? "green" : "red"}>{v === "active" ? "正常" : "已封禁"}</Tag>,
        },
        {
            title: "剩余额度",
            dataIndex: "quotaCents",
            key: "quotaCents",
            width: 120,
            align: "right",
            render: (v: number) => money(v),
        },
        {
            title: "积分",
            dataIndex: "points",
            key: "points",
            width: 100,
            align: "right",
            render: (v: number) => v ?? 0,
        },
        {
            title: "创建时间",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 170,
            render: (v: number) => time(v),
        },
        {
            title: "操作",
            key: "actions",
            width: 240,
            render: (_, u) => (
                <Space size={4}>
                    <Button
                        type="link"
                        size="small"
                        onClick={() => {
                            quotaForm.setFieldsValue({ amount: 0, reason: "" });
                            setQuotaTarget(u);
                        }}
                    >
                        调整额度
                    </Button>
                    <Button
                        type="link"
                        size="small"
                        onClick={() => {
                            pointsForm.setFieldsValue({ amount: 0, reason: "" });
                            setPointsTarget(u);
                        }}
                    >
                        调积分
                    </Button>
                    <Popconfirm
                        title={u.status === "active" ? "封禁该用户？" : "解封该用户？"}
                        description="封禁会立即吊销该用户的全部会话。"
                        onConfirm={() => toggleStatus(u)}
                        okButtonProps={{ danger: u.status === "active" }}
                    >
                        <Button type="link" size="small" danger={u.status === "active"}>
                            {u.status === "active" ? "封禁" : "解封"}
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <>
            <PageHead
                title="用户中心"
                desc="用户、角色与额度由离火后端统一管理；封禁会即时吊销会话。"
                extra={
                    <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                        新建用户
                    </Button>
                }
            />
            <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
                <Table<AdminUser>
                    rowKey="id"
                    size="small"
                    dataSource={load.data?.items ?? []}
                    columns={columns}
                    pagination={false}
                />
            </LoadState>

            <Modal
                title="新建用户"
                open={createOpen}
                onCancel={() => setCreateOpen(false)}
                onOk={() => form.submit()}
                okText="创建"
                cancelText="取消"
                confirmLoading={busy}
                destroyOnHidden
            >
                <Form<CreateValues>
                    form={form}
                    layout="vertical"
                    onFinish={onCreate}
                    initialValues={{ role: "user", quotaCents: 0 }}
                >
                    <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="password" label="初始密码" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item name="role" label="角色">
                        <Select
                            options={[
                                { value: "user", label: "普通用户" },
                                { value: "admin", label: "管理员" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="quotaCents" label="初始额度（分）" extra="100 分 = ¥1.00">
                        <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={`调整积分 · ${pointsTarget?.username ?? ""}`}
                open={pointsTarget !== null}
                onCancel={() => setPointsTarget(null)}
                onOk={() => pointsForm.submit()}
                okText="保存"
                cancelText="取消"
                confirmLoading={busy}
                destroyOnHidden
            >
                <Form<{ amount: number; reason: string }> form={pointsForm} layout="vertical" onFinish={onPoints}>
                    <Form.Item label="当前积分">
                        <Typography.Text strong>{pointsTarget?.points ?? 0}</Typography.Text>
                    </Form.Item>
                    <Form.Item
                        name="amount"
                        label="变动积分（正数发放 / 负数扣减）"
                        rules={[{ required: true, message: "请输入积分" }]}
                        extra="虚拟点数，按流水记账；扣减不能超过当前积分。"
                    >
                        <InputNumber precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="reason" label="原因" rules={[{ required: true, message: "请填写原因" }]} extra="会写进积分流水，用户也能看到。">
                        <Input maxLength={100} placeholder="例如：11 月活动奖励 / 兑换素材包" />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={`调整额度 · ${quotaTarget?.username ?? ""}`}
                open={quotaTarget !== null}
                onCancel={() => setQuotaTarget(null)}
                onOk={() => quotaForm.submit()}
                okText="保存"
                cancelText="取消"
                confirmLoading={busy}
                destroyOnHidden
            >
                <Form<{ amount: number; reason: string }> form={quotaForm} layout="vertical" onFinish={onQuota}>
                    <Form.Item label="当前余额">
                        <Typography.Text strong>{quotaTarget ? money(quotaTarget.quotaCents) : "—"}</Typography.Text>
                    </Form.Item>
                    <Form.Item
                        name="amount"
                        label="变动金额（分，正数入账 / 负数扣减）"
                        rules={[{ required: true, message: "请输入金额" }]}
                        extra="按流水记账，不能直接覆盖余额；正数代表充值或赠送。"
                    >
                        <InputNumber precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="reason" label="原因" rules={[{ required: true, message: "请填写原因" }]} extra="会写进额度流水，用户也能看到。">
                        <Input maxLength={100} placeholder="例如：2026-11 充值 / 补偿生成失败" />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
}
