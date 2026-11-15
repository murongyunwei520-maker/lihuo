import { Table, Tabs, Tag, type TableProps } from "antd";

import { adminApi, type AuditLog, type UsageRecord } from "@/services/api/lihuo-server";

import { LoadState, PageHead, money, time, useLoad } from "./shared";

function UsageTable() {
    const load = useLoad(() => adminApi.usage(200));
    const columns: TableProps<UsageRecord>["columns"] = [
        { title: "时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: (v: number) => time(v) },
        { title: "模型", dataIndex: "model", key: "model" },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 110,
            render: (v: string) => (
                <Tag color={v === "settled" ? "green" : v === "refunded" ? "orange" : "default"}>{v}</Tag>
            ),
        },
        {
            title: "Token（入/出）",
            key: "tokens",
            width: 140,
            align: "right",
            render: (_, r) => `${r.promptTokens} / ${r.completionTokens}`,
        },
        {
            title: "实收",
            dataIndex: "costCents",
            key: "costCents",
            width: 100,
            align: "right",
            render: (v: number) => money(v),
        },
        {
            title: "上游额度",
            dataIndex: "gatewayQuota",
            key: "gatewayQuota",
            width: 100,
            align: "right",
            render: (v: number | null) => (v === null ? "—" : v),
        },
        {
            title: "流式",
            dataIndex: "isStream",
            key: "isStream",
            width: 70,
            render: (v: boolean) => (v ? "是" : "否"),
        },
        {
            title: "网关 Request ID",
            dataIndex: "gatewayRequestId",
            key: "gatewayRequestId",
            ellipsis: true,
            render: (v: string | null) => v ?? "—",
        },
    ];
    return (
        <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
            <Table<UsageRecord>
                rowKey="id"
                size="small"
                dataSource={load.data?.items ?? []}
                columns={columns}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                locale={{ emptyText: "暂无调用记录" }}
            />
        </LoadState>
    );
}

function AuditTable() {
    const load = useLoad(() => adminApi.audit(200));
    const columns: TableProps<AuditLog>["columns"] = [
        { title: "时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: (v: number) => time(v) },
        { title: "操作者", dataIndex: "username", key: "username", width: 110, render: (v: string | null) => v ?? "—" },
        { title: "动作", dataIndex: "action", key: "action", width: 140, render: (v: string) => <Tag>{v}</Tag> },
        { title: "目标", dataIndex: "target", key: "target", width: 180, render: (v: string | null) => v ?? "—" },
        {
            title: "变更详情",
            dataIndex: "detail",
            key: "detail",
            ellipsis: true,
            render: (v: unknown) => (v == null ? "—" : JSON.stringify(v)),
        },
        { title: "IP", dataIndex: "ip", key: "ip", width: 130, render: (v: string | null) => v ?? "—" },
    ];
    return (
        <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
            <Table<AuditLog>
                rowKey="id"
                size="small"
                dataSource={load.data?.items ?? []}
                columns={columns}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                locale={{ emptyText: "暂无审计记录" }}
            />
        </LoadState>
    );
}

export default function LogsPage() {
    return (
        <>
            <PageHead
                title="运行日志"
                desc="调用流水来自离火账单表；网关 Request ID 可与 New-API 日志逐条对账。审计记录管理员敏感操作。"
            />
            <Tabs
                items={[
                    { key: "usage", label: "调用流水", children: <UsageTable /> },
                    { key: "audit", label: "操作审计", children: <AuditTable /> },
                ]}
            />
        </>
    );
}
