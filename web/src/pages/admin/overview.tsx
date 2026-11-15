import { Alert, Button, Card, Col, Row, Statistic, Table, Tag, type TableProps } from "antd";
import { RefreshCw } from "lucide-react";

import { adminApi, type UsageRecord } from "@/services/api/lihuo-server";

import { LoadState, PageHead, money, time, useLoad } from "./shared";

/** 平台总览：全部数字来自离火后端，网关只提供可用性与上游用量 */
export default function OverviewPage() {
    const load = useLoad(async () => {
        const [users, models, usage] = await Promise.all([
            adminApi.users(),
            adminApi.models(),
            adminApi.usage(100),
        ]);
        return { users, models, usage };
    });

    const items = load.data?.usage.items ?? [];
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todaySec = Math.floor(dayStart.getTime() / 1000);
    const today = items.filter((r) => r.createdAt >= todaySec);
    const settled = today.filter((r) => r.status === "settled");
    const todayCost = settled.reduce((sum, r) => sum + r.costCents, 0);
    const enabledModels = load.data?.models.items.filter((m) => m.enabled).length ?? 0;

    const columns: TableProps<UsageRecord>["columns"] = [
        { title: "时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: (v: number) => time(v) },
        { title: "模型", dataIndex: "model", key: "model" },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 100,
            render: (v: string) => (
                <Tag color={v === "settled" ? "green" : v === "refunded" ? "orange" : "default"}>{v}</Tag>
            ),
        },
        {
            title: "Token",
            key: "tokens",
            width: 120,
            align: "right",
            render: (_, r) => `${r.promptTokens} / ${r.completionTokens}`,
        },
        {
            title: "费用",
            dataIndex: "costCents",
            key: "costCents",
            width: 100,
            align: "right",
            render: (v: number) => money(v),
        },
        {
            title: "流式",
            dataIndex: "isStream",
            key: "isStream",
            width: 80,
            render: (v: boolean) => (v ? "是" : "否"),
        },
    ];

    return (
        <>
            <PageHead
                title="平台总览"
                desc="离火后端是用户与账单的权威来源；New-API 只负责网关转发和上游用量。"
                extra={
                    <Button icon={<RefreshCw size={14} />} onClick={load.reload} loading={load.loading}>
                        刷新
                    </Button>
                }
            />
            <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
                {load.data?.models.gatewayError && (
                    <Alert
                        type="warning"
                        showIcon
                        message="模型网关当前不可用"
                        description={load.data.models.gatewayError}
                        style={{ marginBottom: 16 }}
                    />
                )}
                <Row gutter={[12, 12]}>
                    <Col xs={12} md={6}>
                        <Card size="small">
                            <Statistic title="用户总数" value={load.data?.users.total ?? 0} />
                        </Card>
                    </Col>
                    <Col xs={12} md={6}>
                        <Card size="small">
                            <Statistic title="已上架模型" value={enabledModels} />
                        </Card>
                    </Col>
                    <Col xs={12} md={6}>
                        <Card size="small">
                            <Statistic title="今日请求" value={settled.length} suffix="次" />
                        </Card>
                    </Col>
                    <Col xs={12} md={6}>
                        <Card size="small">
                            <Statistic title="今日消费" value={money(todayCost)} />
                        </Card>
                    </Col>
                </Row>

                <Card title="近期调用流水" size="small" style={{ marginTop: 16 }}>
                    <Table<UsageRecord>
                        rowKey="id"
                        size="small"
                        dataSource={items.slice(0, 10)}
                        columns={columns}
                        pagination={false}
                        locale={{ emptyText: "暂无调用记录" }}
                    />
                </Card>
            </LoadState>
        </>
    );
}
