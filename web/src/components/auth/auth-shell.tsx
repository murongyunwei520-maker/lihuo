import type { ReactNode } from "react";
import { ConfigProvider, theme as antdTheme, Typography } from "antd";

import { getAntThemeConfig } from "@/lib/app-theme";

/**
 * 登录类页面的统一外壳：品牌头 + 居中卡片 + AGPL 署名。
 * 登录 / 注册 / 忘记密码 / 重置密码共用，避免四份重复样式。
 */
export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <ConfigProvider theme={getAntThemeConfig(false)}>
            <AuthCard title={title} description={description}>
                {children}
            </AuthCard>
        </ConfigProvider>
    );
}

function AuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    const { token } = antdTheme.useToken();

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "grid",
                placeItems: "center",
                padding: 24,
                background: token.colorBgLayout,
                color: token.colorText,
            }}
        >
            <div
                style={{
                    width: 400,
                    maxWidth: "100%",
                    padding: 32,
                    background: token.colorBgContainer,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusLG,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
                    <div
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: token.colorPrimary,
                            color: "#fff",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 16,
                            fontWeight: 600,
                        }}
                    >
                        离
                    </div>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>离火</div>
                        <div style={{ fontSize: 11, color: token.colorTextTertiary, letterSpacing: ".12em" }}>LIHUO</div>
                    </div>
                </div>

                <Typography.Title level={4} style={{ margin: "0 0 4px", fontWeight: 500 }}>
                    {title}
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ fontSize: 13, margin: "0 0 24px" }}>
                    {description}
                </Typography.Paragraph>

                {children}

                {/* AGPLv3 §7(b)(c)：保守保留署名与来源链接，落地位置待合规报告确认 */}
                <div style={{ marginTop: 24, fontSize: 11, lineHeight: 1.7, color: token.colorTextTertiary }}>
                    Frontend design and development by New API contributors.{" "}
                    <a href="https://github.com/QuantumNous/new-api" target="_blank" rel="noreferrer" style={{ color: token.colorPrimary }}>
                        github.com/QuantumNous/new-api
                    </a>
                </div>
            </div>
        </div>
    );
}
