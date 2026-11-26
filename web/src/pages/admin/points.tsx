import { useState } from "react";
import {
    App as AntdApp,
    Button,
    Card,
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
    Typography,
    type TableProps,
} from "antd";
import { Plus } from "lucide-react";

import { adminApi, type PointOrder, type PointPackage } from "@/services/api/lihuo-server";

import { LoadState, PageHead, money, time, useLoad, writeError } from "./shared";

/**
 * 积分管理
 * ------------------------------------------------------------
 * 两件事：维护充值套餐（价格/积分/角标/上下架）、处理充值订单（人工确认到账 / 退款）。
 * 订单里的套餐名与金额是下单时快照，改套餐不会影响历史订单。
 */

const STATUS_META: Record<string, { text: string; color: string }> = {
    pending: { text: "待确认", color: "gold" },
    paid: { text: "已到账", color: "green" },
    cancelled: { text: "已取消", color: "default" },
    refunded: { text: "已退款", color: "red" },
};

interface PackageValues {
    name: string;
    subtitle?: string;
    price: number;
    points: number;
    bonusPoints: number;
    badge?: string;
    highlights?: string;
    recommended: boolean;
    enabled: boolean;
    sortOrder: number;
}

export default function AdminPointsPage() {
    const { message } = AntdApp.useApp();
    const packages = useLoad(() => adminApi.pointPackages());
    const [status, setStatus] = useState<string>("");
    const orders = useLoad(() => adminApi.pointOrders({ status, limit: 50 }));
    const [editing, setEditing] = useState<PointPackage | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [form] = Form.useForm<PackageValues>();

    const modalOpen = createOpen || editing !== null;

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({
            name: "",
            subtitle: "",
            price: 99,
            points: 1000,
            bonusPoints: 100,
            badge: "",
            highlights: "",
            recommended: false,
            enabled: true,
            sortOrder: (packages.data?.items.length ?? 0) + 1,
        });
        setCreateOpen(true);
    };

    const openEdit = (pack: PointPackage) => {
        setCreateOpen(false);
        form.setFieldsValue({
            name: pack.name,
            subtitle: pack.subtitle,
            price: pack.priceCents / 100,
            points: pack.points,
            bonusPoints: pack.bonusPoints,
            badge: pack.badge ?? "",
            highlights: pack.highlights.join("\n"),
            recommended: pack.recommended,
            enabled: pack.enabled,
            sortOrder: pack.sortOrder,
        });
        setEditing(pack);
    };

    const toPayload = (v: PackageValues) => ({
        name: v.name.trim(),
        subtitle: v.subtitle?.trim() ?? "",
        priceCents: Math.round(Number(v.price) * 100),
        points: Number(v.points),
        bonusPoints: Number(v.bonusPoints ?? 0),
        badge: v.badge?.trim() ?? "",
        highlights: (v.highlights ?? "")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        recommended: Boolean(v.recommended),
        enabled: Boolean(v.enabled),
        sortOrder: Number(v.sortOrder ?? 0),
    });

    const onCreate = async (v: PackageValues) => {
        setBusy(true);
        try {
            await adminApi.createPointPackage(toPayload(v));
            message.success("套餐已创建");
            setCreateOpen(false);
            packages.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const onUpdate = async (v: PackageValues) => {
        if (!editing) return;
        setBusy(true);
        try {
            await adminApi.updatePointPackage(editing.id, toPayload(v));
            message.success("套餐已更新");
            setEditing(null);
            packages.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const toggleEnabled = async (pack: PointPackage) => {
        setBusy(true);
        try {
            await adminApi.updatePointPackage(pack.id, { enabled: !pack.enabled });
            message.success(pack.enabled ? "已下架" : "已上架");
            packages.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const removePackage = async (pack: PointPackage) => {
        setBusy(true);
        try {
            const result = await adminApi.deletePointPackage(pack.id);
            message.success(result.disabled ? result.reason || "已下架" : "套餐已删除");
            packages.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const confirmOrder = async (order: PointOrder) => {
        setBusy(true);
        try {
            await adminApi.confirmPointOrder(order.id, "管理员确认到账");
            message.success(`已确认到账，用户获得 ${order.points} 积分`);
            orders.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const refundOrder = async (order: PointOrder) => {
        setBusy(true);
        try {
            await adminApi.refundPointOrder(order.id, "管理员操作退款");
            message.success("已退款并回收积分");
            orders.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const packageColumns: TableProps<PointPackage>["columns"] = [
        {
            title: "套餐",
            key: "name",
            render: (_, pack) => (
                <div>
                    <div style={{ fontWeight: 500 }}>
                        {pack.name}
                        {pack.recommended ? (
                            <Tag color="purple" style={{ marginLeft: 6 }}>
                                推荐
                            </Tag>
                        ) : null}
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {pack.subtitle || "—"}
                    </Typography.Text>
                </div>
            ),
        },
        { title: "价格", dataIndex: "priceCents", key: "price", width: 100, align: "right", render: (v: number) => money(v) },
        {
            title: "积分构成",
            key: "points",
            width: 200,
            render: (_, pack) => (
                <span>
                    {pack.points.toLocaleString()}
                    {pack.bonusPoints > 0 ? <Typography.Text type="secondary">（赠 {pack.bonusPoints.toLocaleString()}）</Typography.Text> : null}
                    <Typography.Text strong> = {pack.totalPoints.toLocaleString()}</Typography.Text>
                </span>
            ),
        },
        { title: "角标", dataIndex: "badge", key: "badge", width: 90, render: (v: string | null) => v || "—" },
        { title: "排序", dataIndex: "sortOrder", key: "sortOrder", width: 70, align: "right" },
        {
            title: "状态",
            dataIndex: "enabled",
            key: "enabled",
            width: 90,
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "上架中" : "已下架"}</Tag>,
        },
        {
            title: "操作",
            key: "actions",
            width: 200,
            render: (_, pack) => (
                <Space size={4}>
                    <Button type="link" size="small" onClick={() => openEdit(pack)}>
                        编辑
                    </Button>
                    <Button type="link" size="small" onClick={() => toggleEnabled(pack)}>
                        {pack.enabled ? "下架" : "上架"}
                    </Button>
                    <Popconfirm title="删除该套餐？" description="有订单的套餐只会下架，不会删除历史记录。" onConfirm={() => removePackage(pack)}>
                        <Button type="link" size="small" danger>
                            删除
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const orderColumns: TableProps<PointOrder>["columns"] = [
        { title: "时间", dataIndex: "createdAt", key: "time", width: 170, render: (v: number) => time(v) },
        { title: "订单号", dataIndex: "id", key: "id", width: 210 },
        { title: "用户", dataIndex: "username", key: "username", width: 130 },
        { title: "套餐", dataIndex: "packageName", key: "packageName", width: 110 },
        { title: "金额", dataIndex: "priceCents", key: "price", width: 100, align: "right", render: (v: number) => money(v) },
        { title: "积分", dataIndex: "points", key: "points", width: 90, align: "right" },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 100,
            render: (v: string) => {
                const meta = STATUS_META[v] ?? { text: v, color: "default" };
                return <Tag color={meta.color}>{meta.text}</Tag>;
            },
        },
        { title: "备注", dataIndex: "remark", key: "remark", ellipsis: true, render: (v: string | null) => v || "—" },
        {
            title: "操作",
            key: "actions",
            width: 170,
            render: (_, order) => (
                <Space size={4}>
                    {order.status === "pending" ? (
                        <Popconfirm title="确认已收到款项？" description="确认后积分立即入账。" onConfirm={() => confirmOrder(order)}>
                            <Button type="link" size="small">
                                确认到账
                            </Button>
                        </Popconfirm>
                    ) : null}
                    {order.status === "paid" ? (
                        <Popconfirm
                            title="确认退款？"
                            description="会回收该订单发放的积分；积分已被使用时会拒绝。"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => refundOrder(order)}
                        >
                            <Button type="link" size="small" danger>
                                退款
                            </Button>
                        </Popconfirm>
                    ) : null}
                </Space>
            ),
        },
    ];

    const fields = (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Form.Item name="name" label="套餐名" rules={[{ required: true, message: "请输入套餐名" }]}>
                <Input maxLength={32} placeholder="例如：创作包" />
            </Form.Item>
            <Form.Item name="subtitle" label="副标题">
                <Input maxLength={60} placeholder="例如：日常创作够用" />
            </Form.Item>
            <Form.Item name="price" label="价格（元）" rules={[{ required: true, message: "请输入价格" }]}>
                <InputNumber min={0.01} precision={2} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序（越小越靠前）">
                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="points" label="基础积分" rules={[{ required: true, message: "请输入基础积分" }]}>
                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="bonusPoints" label="赠送积分">
                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="badge" label="角标">
                <Input maxLength={12} placeholder="例如：推荐 / 最划算，留空则不显示" />
            </Form.Item>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Form.Item name="recommended" label="标记推荐" valuePropName="checked">
                    <Switch />
                </Form.Item>
                <Form.Item name="enabled" label="上架" valuePropName="checked">
                    <Switch />
                </Form.Item>
            </div>
        </div>
    );

    return (
        <>
            <PageHead
                title="积分管理"
                desc="维护充值套餐、处理充值订单；积分与额度相互独立，生成仍按额度计费。"
                extra={
                    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
                        新建套餐
                    </Button>
                }
            />

            <Card size="small" style={{ marginBottom: 16 }}>
                <Space size={32} wrap>
                    <div>
                        <div style={{ fontSize: 12, color: "#8c8c8c" }}>累计充值</div>
                        <div style={{ fontSize: 20, fontWeight: 500 }}>{money(orders.data?.stats.revenueCents ?? 0)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 12, color: "#8c8c8c" }}>待确认订单</div>
                        <div style={{ fontSize: 20, fontWeight: 500 }}>{orders.data?.stats.pendingOrders ?? 0}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 12, color: "#8c8c8c" }}>在售套餐</div>
                        <div style={{ fontSize: 20, fontWeight: 500 }}>{packages.data?.items.filter((pack) => pack.enabled).length ?? 0}</div>
                    </div>
                </Space>
            </Card>

            <Card size="small" title="充值套餐" style={{ marginBottom: 16 }}>
                <LoadState loading={packages.loading} error={packages.error} onRetry={packages.reload}>
                    <Table<PointPackage> rowKey="id" size="small" dataSource={packages.data?.items ?? []} columns={packageColumns} pagination={false} />
                </LoadState>
            </Card>

            <Card
                size="small"
                title="充值订单"
                extra={
                    <Select
                        size="small"
                        style={{ width: 140 }}
                        value={status}
                        onChange={(value) => {
                            setStatus(value);
                            orders.reload();
                        }}
                        options={[
                            { value: "", label: "全部状态" },
                            { value: "pending", label: "待确认" },
                            { value: "paid", label: "已到账" },
                            { value: "refunded", label: "已退款" },
                            { value: "cancelled", label: "已取消" },
                        ]}
                    />
                }
            >
                <LoadState loading={orders.loading} error={orders.error} onRetry={orders.reload}>
                    <Table<PointOrder> rowKey="id" size="small" dataSource={orders.data?.items ?? []} columns={orderColumns} pagination={false} />
                </LoadState>
            </Card>

            <Modal
                title={editing ? `编辑套餐 · ${editing.name}` : "新建套餐"}
                open={modalOpen}
                onCancel={() => {
                    setCreateOpen(false);
                    setEditing(null);
                }}
                onOk={() => form.submit()}
                okText={editing ? "保存" : "创建"}
                cancelText="取消"
                confirmLoading={busy}
                width={680}
                destroyOnHidden
            >
                <Form<PackageValues> form={form} layout="vertical" onFinish={editing ? onUpdate : onCreate} requiredMark={false}>
                    {fields}
                    <Form.Item name="highlights" label="权益说明（每行一条）">
                        <Input.TextArea rows={3} maxLength={200} placeholder={"积分永久有效\n优先体验新模型"} />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
}
