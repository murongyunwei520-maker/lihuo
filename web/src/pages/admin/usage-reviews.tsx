import { useState } from "react";
import {
    App as AntdApp,
    Button,
    Descriptions,
    Drawer,
    Form,
    Input,
    InputNumber,
    Modal,
    Space,
    Spin,
    Table,
    Tag,
    Typography,
    type TableProps,
} from "antd";
import { RefreshCw } from "lucide-react";

import {
    getUsageReview,
    listUsageReviews,
    refundUsageReview,
    settleUsageReview,
    type UsageReviewDetail,
    type UsageReviewFilterStatus,
    type UsageReviewItem,
} from "@/services/api/usage-reviews";

import { LoadState, PageHead, money, time, useLoad, writeError } from "./shared";

/**
 * 待人工处理预扣
 * ------------------------------------------------------------
 * 回收器把「无法自动判定」的预扣置为 review，这里负责核对并二选一：
 *   - 确认实际产生费用 → 填实际金额结算（不默认等于预扣）；
 *   - 确认不应收费 → 全额退款。
 * 两种操作都要求填写原因，后端会写审计并做并发保护。
 */

const STATUS_META: Record<string, { text: string; color: string }> = {
    review: { text: "待处理", color: "gold" },
    settled: { text: "已结算", color: "green" },
    refunded: { text: "已退款", color: "red" },
};

const TASK_STATUS_META: Record<string, { text: string; color: string }> = {
    succeeded: { text: "成功", color: "green" },
    failed: { text: "失败", color: "red" },
    canceled: { text: "已取消", color: "default" },
    running: { text: "执行中", color: "blue" },
    creating: { text: "创建中", color: "processing" },
};

function statusTag(status: string) {
    const meta = STATUS_META[status] ?? { text: status, color: "default" };
    return <Tag color={meta.color}>{meta.text}</Tag>;
}

function taskTag(taskId: string | null, taskStatus: string | null) {
    if (!taskId) return <Typography.Text type="secondary">无关联任务</Typography.Text>;
    const meta = taskStatus ? TASK_STATUS_META[taskStatus] : undefined;
    return (
        <Space direction="vertical" size={2}>
            <Typography.Text code>{taskId}</Typography.Text>
            {meta ? <Tag color={meta.color}>{meta.text}</Tag> : null}
        </Space>
    );
}

interface SettleValues {
    /** 必须由管理员填写；不预填预扣金额，避免「默认等于预扣」 */
    costYuan?: number;
    note: string;
}

export default function AdminUsageReviewsPage() {
    const { message } = AntdApp.useApp();
    const [status, setStatus] = useState<UsageReviewFilterStatus>("review");
    const [userId, setUserId] = useState<string>("");
    const [taskId, setTaskId] = useState<string>("");
    const [page, setPage] = useState(1);
    const [detail, setDetail] = useState<UsageReviewDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [settling, setSettling] = useState<UsageReviewItem | null>(null);
    const [refunding, setRefunding] = useState<UsageReviewItem | null>(null);
    const [busy, setBusy] = useState(false);
    const [settleForm] = Form.useForm<SettleValues>();
    const [refundForm] = Form.useForm<{ note: string }>();

    const list = useLoad(() =>
        listUsageReviews({
            status,
            userId: userId ? Number(userId) : undefined,
            taskId: taskId.trim() || undefined,
            page,
            limit: 20,
        }),
    );

    const openDetail = async (id: number) => {
        setDetailLoading(true);
        try {
            setDetail(await getUsageReview(id));
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setDetailLoading(false);
        }
    };

    const submitSettle = async () => {
        if (!settling) return;
        const values = await settleForm.validateFields();
        setBusy(true);
        try {
            const result = await settleUsageReview(settling.id, {
                costCents: Math.round(Number(values.costYuan ?? 0) * 100),
                note: values.note.trim(),
            });
            message.success(
                `已结算：应收 ${money(result.costCents)}，退回 ${money(result.refundedCents)}${
                    result.chargedExtraCents > 0 ? `，补扣 ${money(result.chargedExtraCents)}` : ""
                }`,
            );
            setSettling(null);
            settleForm.resetFields();
            list.reload();
            if (detail?.record.id === settling.id) setDetail(null);
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const submitRefund = async () => {
        if (!refunding) return;
        const values = await refundForm.validateFields();
        setBusy(true);
        try {
            const result = await refundUsageReview(refunding.id, { note: values.note.trim() });
            message.success(`已退款 ${money(result.refundedCents)}`);
            setRefunding(null);
            refundForm.resetFields();
            list.reload();
            if (detail?.record.id === refunding.id) setDetail(null);
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const columns: TableProps<UsageReviewItem>["columns"] = [
        { title: "ID", dataIndex: "id", width: 76 },
        {
            title: "用户",
            dataIndex: "username",
            width: 160,
            render: (_, row) => (
                <Space direction="vertical" size={0}>
                    <Typography.Text>{row.username ?? `#${row.userId}`}</Typography.Text>
                    <Typography.Text type="secondary">#{row.userId}</Typography.Text>
                </Space>
            ),
        },
        {
            title: "关联任务",
            dataIndex: "taskId",
            width: 220,
            render: (_, row) => taskTag(row.taskId, row.taskStatus),
        },
        { title: "模型", dataIndex: "model", width: 140 },
        {
            title: "预扣",
            dataIndex: "reservedCents",
            width: 100,
            align: "right",
            render: (value: number) => money(value),
        },
        {
            title: "触发原因",
            dataIndex: "reviewReason",
            render: (value: string | null, row) => (
                <Typography.Text type="secondary" ellipsis={{ tooltip: value ?? row.error ?? "" }}>
                    {value ?? row.error ?? "—"}
                </Typography.Text>
            ),
        },
        { title: "创建时间", dataIndex: "createdAt", width: 168, render: (value: number) => time(value) },
        { title: "状态", dataIndex: "status", width: 96, render: (value: string) => statusTag(value) },
        {
            title: "操作",
            width: 200,
            render: (_, row) => (
                <Space size={4}>
                    <Button size="small" type="link" onClick={() => void openDetail(row.id)}>
                        详情
                    </Button>
                    {row.status === "review" ? (
                        <>
                            <Button
                                size="small"
                                type="link"
                                onClick={() => {
                                    // 刻意不预填金额：人工结算必须自己核实
                                    settleForm.setFieldsValue({ costYuan: undefined, note: "" });
                                    setSettling(row);
                                }}
                            >
                                结算
                            </Button>
                            <Button
                                size="small"
                                type="link"
                                danger
                                onClick={() => {
                                    refundForm.setFieldsValue({ note: "" });
                                    setRefunding(row);
                                }}
                            >
                                退款
                            </Button>
                        </>
                    ) : null}
                </Space>
            ),
        },
    ];

    return (
        <div>
            <PageHead
                title="待人工处理预扣"
                desc="回收器无法自动判定的预扣会进入这里：核对后选择「按实际金额结算」或「全额退款」，两种操作都会写审计。"
                extra={
                    <Button icon={<RefreshCw size={14} />} onClick={list.reload}>
                        刷新
                    </Button>
                }
            />

            <Space wrap style={{ marginBottom: 16 }}>
                <Space size={4}>
                    <Typography.Text type="secondary">状态</Typography.Text>
                    <select
                        value={status}
                        onChange={(e) => {
                            setStatus(e.target.value as UsageReviewFilterStatus);
                            setPage(1);
                        }}
                        style={{ padding: "4px 8px", borderRadius: 6 }}
                    >
                        <option value="review">待处理</option>
                        <option value="settled">已结算</option>
                        <option value="refunded">已退款</option>
                        <option value="all">全部</option>
                    </select>
                </Space>
                <Input
                    placeholder="用户 ID"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value.replace(/[^0-9]/g, ""))}
                    style={{ width: 120 }}
                    allowClear
                />
                <Input
                    placeholder="任务 ID"
                    value={taskId}
                    onChange={(e) => setTaskId(e.target.value)}
                    style={{ width: 220 }}
                    allowClear
                />
                <Button onClick={() => { setPage(1); list.reload(); }}>查询</Button>
            </Space>

            <LoadState loading={list.loading} error={list.error} onRetry={list.reload}>
                <Table<UsageReviewItem>
                    rowKey="id"
                    size="small"
                    columns={columns}
                    dataSource={list.data?.items ?? []}
                    pagination={{
                        current: page,
                        pageSize: 20,
                        total: list.data?.total ?? 0,
                        showSizeChanger: false,
                        onChange: setPage,
                    }}
                />
            </LoadState>

            <Drawer
                open={detail !== null}
                onClose={() => setDetail(null)}
                width={640}
                title={detail ? `预扣 #${detail.record.id}` : "预扣详情"}
            >
                {detailLoading ? (
                    <div style={{ padding: 48, textAlign: "center" }}>
                        <Spin />
                    </div>
                ) : detail ? (
                    <Space direction="vertical" size={20} style={{ width: "100%" }}>
                        <Descriptions column={2} size="small" bordered>
                            <Descriptions.Item label="用户">
                                {detail.record.username ?? `#${detail.record.userId}`}（#{detail.record.userId}）
                            </Descriptions.Item>
                            <Descriptions.Item label="状态">{statusTag(detail.record.status)}</Descriptions.Item>
                            <Descriptions.Item label="模型">{detail.record.model}</Descriptions.Item>
                            <Descriptions.Item label="接口">{detail.record.endpoint}</Descriptions.Item>
                            <Descriptions.Item label="预扣金额">{money(detail.record.reservedCents)}</Descriptions.Item>
                            <Descriptions.Item label="实际费用">{money(detail.record.costCents)}</Descriptions.Item>
                            <Descriptions.Item label="触发原因" span={2}>
                                {detail.record.reviewReason ?? detail.record.error ?? "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label="人工原因" span={2}>
                                {detail.record.reviewNote ?? "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label="创建时间">{time(detail.record.createdAt)}</Descriptions.Item>
                            <Descriptions.Item label="处理时间">
                                {detail.record.reviewedAt ? time(detail.record.reviewedAt) : "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label="关联任务" span={2}>
                                {taskTag(detail.record.taskId, detail.record.taskStatus)}
                                {detail.task?.errorCode ? (
                                    <Typography.Text type="secondary">（{detail.task.errorCode}）</Typography.Text>
                                ) : null}
                            </Descriptions.Item>
                        </Descriptions>

                        <div>
                            <Typography.Title level={5}>审计记录</Typography.Title>
                            {(detail.audits ?? []).length === 0 ? (
                                <Typography.Text type="secondary">暂无审计记录</Typography.Text>
                            ) : (
                                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                    {detail.audits.map((item) => (
                                        <div key={item.id}>
                                            <Typography.Text code>{item.action}</Typography.Text>
                                            <Typography.Text type="secondary">
                                                {" "}
                                                {item.username ?? "system"} · {time(item.createdAt)}
                                            </Typography.Text>
                                            <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
                                                {item.detail ?? ""}
                                            </Typography.Paragraph>
                                        </div>
                                    ))}
                                </Space>
                            )}
                        </div>
                    </Space>
                ) : null}
            </Drawer>

            <Modal
                open={settling !== null}
                title={settling ? `人工结算 #${settling.id}` : "人工结算"}
                onCancel={() => setSettling(null)}
                onOk={() => void submitSettle()}
                confirmLoading={busy}
                okText="确认结算"
                destroyOnClose
            >
                {settling ? (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        <Typography.Text>
                            预扣金额 {money(settling.reservedCents)}。请按实际应付金额填写，默认值仅作参考，不自动等于预扣。
                        </Typography.Text>
                        <Form form={settleForm} layout="vertical" preserve={false}>
                            <Form.Item
                                name="costYuan"
                                label="实际应付金额（元）"
                                rules={[{ required: true, message: "请填写实际金额" }]}
                                extra="大于预扣时补扣；小于预扣时退回差额。"
                            >
                                <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="例如 0.60" />
                            </Form.Item>
                            <Form.Item
                                name="note"
                                label="处理原因"
                                rules={[{ required: true, min: 2, message: "请填写处理原因（至少 2 个字）" }]}
                            >
                                <Input.TextArea rows={3} maxLength={200} showCount placeholder="例如：核实上游已成功出片，按定价 30 分结算" />
                            </Form.Item>
                        </Form>
                    </Space>
                ) : null}
            </Modal>

            <Modal
                open={refunding !== null}
                title={refunding ? `人工退款 #${refunding.id}` : "人工退款"}
                onCancel={() => setRefunding(null)}
                onOk={() => void submitRefund()}
                confirmLoading={busy}
                okText="确认退款"
                okButtonProps={{ danger: true }}
                destroyOnClose
            >
                {refunding ? (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        <Typography.Text>
                            将全额退回预扣 {money(refunding.reservedCents)}，并把记录标记为已退款。
                        </Typography.Text>
                        <Form form={refundForm} layout="vertical" preserve={false}>
                            <Form.Item
                                name="note"
                                label="处理原因"
                                rules={[{ required: true, min: 2, message: "请填写处理原因（至少 2 个字）" }]}
                            >
                                <Input.TextArea rows={3} maxLength={200} showCount placeholder="例如：任务未成功，确认不产生费用" />
                            </Form.Item>
                        </Form>
                    </Space>
                ) : null}
            </Modal>
        </div>
    );
}
