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
}

export default function UsersPage() {
    const { message } = AntdApp.useApp();
    const load = useLoad(() => adminApi.users());
    const [createOpen, setCreateOpen] = useState(false);
    const [quotaTarget, setQuotaTarget] = useState<AdminUser | null>(null);
    const [busy, setBusy] = useState(false);
    const [form] = Form.useForm<CreateValues>();
    const [quotaForm] = Form.useForm<{ quotaCents: number }>();

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

    const onQuota = async (v: { quotaCents: number }) => {
        if (!quotaTarget) return;
        setBusy(true);
        try {
            await adminApi.updateUser(quotaTarget.id, { quotaCents: Number(v.quotaCents) });
            message.success("额度已更新");
            setQuotaTarget(null);
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
            title: "创建时间",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 170,
            render: (v: number) => time(v),
        },
        {
            title: "操作",
            key: "actions",
            width: 200,
            render: (_, u) => (
                <Space size={4}>
                    <Button
                        type="link"
                        size="small"
                        onClick={() => {
                            quotaForm.setFieldsValue({ quotaCents: u.quotaCents });
                            setQuotaTarget(u);
                        }}
                    >
                        调整额度
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
                title={`调整额度 · ${quotaTarget?.username ?? ""}`}
                open={quotaTarget !== null}
                onCancel={() => setQuotaTarget(null)}
                onOk={() => quotaForm.submit()}
                okText="保存"
                cancelText="取消"
                confirmLoading={busy}
                destroyOnHidden
            >
                <Form<{ quotaCents: number }> form={quotaForm} layout="vertical" onFinish={onQuota}>
                    <Form.Item
                        name="quotaCents"
                        label="新的剩余额度（分）"
                        rules={[{ required: true, message: "请输入额度" }]}
                        extra="这是直接设置余额，不是充值累加。"
                    >
                        <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
}
