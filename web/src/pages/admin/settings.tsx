import { Alert, Card, Descriptions, Tag, Typography } from "antd";

import { LIHUO_SERVER_URL, adminApi } from "@/services/api/lihuo-server";

import { LoadState, PageHead, useLoad } from "./shared";

function GatewayStatus() {
    const load = useLoad(() => adminApi.gatewayHealth());
    return (
        <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
            {load.error ? null : (
                <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="状态">
                        <Tag color="green">在线</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="网关版本">{load.data?.version ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="探测延迟">
                        {load.data?.latencyMs === undefined ? "—" : `${load.data.latencyMs} ms`}
                    </Descriptions.Item>
                </Descriptions>
            )}
        </LoadState>
    );
}

export default function SettingsPage() {
    return (
        <>
            <PageHead title="系统设置" desc="当前为本地开发环境；生产配置（HTTPS、反代、SSE）在云端迁移阶段接入。" />

            <Card title="服务状态" size="small" style={{ marginBottom: 16 }}>
                <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
                    <Descriptions.Item label="离火业务后端">{LIHUO_SERVER_URL}</Descriptions.Item>
                    <Descriptions.Item label="账单权威">离火业务后端</Descriptions.Item>
                    <Descriptions.Item label="网关引擎">New-API（仅服务端调用，前端不直连）</Descriptions.Item>
                    <Descriptions.Item label="部署阶段">本地开发 / 功能验证</Descriptions.Item>
                </Descriptions>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    模型网关健康：
                </Typography.Text>
                <div style={{ marginTop: 8 }}>
                    <GatewayStatus />
                </div>
            </Card>

            <Card title="开源致谢与许可" size="small">
                <Typography.Paragraph style={{ marginBottom: 8 }}>
                    Frontend design and development by New API contributors.
                </Typography.Paragraph>
                <Typography.Paragraph style={{ marginBottom: 8 }}>
                    <a href="https://github.com/QuantumNous/new-api" target="_blank" rel="noreferrer">
                        https://github.com/QuantumNous/new-api
                    </a>
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
                    离火对界面品牌、导航与信息架构做了修改与重构。依据 New-API 项目 NOTICE 中 AGPLv3 §7(b)(c)
                    的要求保留上述署名、来源链接与修改说明。
                </Typography.Paragraph>
                <Alert
                    type="info"
                    showIcon
                    message="正式对外提供服务前需单独生成许可证合规报告"
                    description="本页按最保守方式保留署名。由于离火后台不包含 New-API 前端代码，署名的法律落点需法务确认；对外发布前还需核对修改版源码提供义务。"
                />
            </Card>
        </>
    );
}
