import { useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, ConfigProvider, Form, Input, theme as antdTheme, Typography } from "antd";

import { getAntThemeConfig } from "@/lib/app-theme";
import { ServerApiError, login as apiLogin } from "@/services/api/lihuo-server";

/**
 * 离火管理中心 · 登录页
 * ------------------------------------------------------------
 * 设计依据：design-system/components/admin-console.md
 *   - 后台明色优先，且与画布使用独立 Router 分支 / Layout
 *   - 不与画布共享布局组件，只共享 app-theme.ts 的色彩与字体令牌
 *
 * 主题：全局 AppProviders 用 getAntThemeConfig(dark) 且跟随用户偏好，
 * 所以这里必须用自己的 ConfigProvider **局部覆盖为明色**，
 * 否则用户切到深色时后台会跟着变暗（admin-console.md 不允许）。
 * 待 admin-theme.ts 并入仓库后，改用 getAdminThemeConfig(false)。
 *
 * 安全：
 *   - 会话凭据是后端下发的 HttpOnly Cookie，前端不接触、不存储任何密钥
 *   - next 参数做站内白名单校验，防开放重定向
 */

/** 后台首页尚未建成，联调页作为登录后的落点 */
const DEFAULT_NEXT = "/server-check";

function safeNext(raw: string | null): string {
    if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_NEXT;
    return raw;
}

interface LoginValues {
    username: string;
    password: string;
}

function LoginCard() {
    const { token } = antdTheme.useToken();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    const onFinish = async (values: LoginValues) => {
        setError(null);
        setPending(true);
        try {
            await apiLogin(values.username.trim(), values.password);
            navigate(safeNext(params.get("next")), { replace: true });
        } catch (e) {
            setError(e instanceof ServerApiError ? e.message : (e as Error).message);
        } finally {
            setPending(false);
        }
    };

    const shell: CSSProperties = {
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: token.colorBgLayout,
        color: token.colorText,
    };
    const card: CSSProperties = {
        width: 400,
        maxWidth: "100%",
        padding: 32,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        // 规范：靠边框分层，不加阴影
    };
    const brandMark: CSSProperties = {
        width: 32,
        height: 32,
        borderRadius: 8,
        background: token.colorPrimary,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: 16,
        fontWeight: 600,
    };

    return (
        <div style={shell}>
            <div style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
                    <div style={brandMark}>离</div>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>离火</div>
                        <div style={{ fontSize: 11, color: token.colorTextTertiary, letterSpacing: ".12em" }}>
                            LIHUO
                        </div>
                    </div>
                </div>

                <Typography.Title level={4} style={{ margin: "0 0 4px", fontWeight: 500 }}>
                    登录管理中心
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ fontSize: 13, margin: "0 0 24px" }}>
                    使用离火账号继续
                </Typography.Paragraph>

                {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

                <Form<LoginValues>
                    layout="vertical"
                    requiredMark={false}
                    onFinish={onFinish}
                    initialValues={{ username: "", password: "" }}
                >
                    <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input autoComplete="username" autoFocus disabled={pending} />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password autoComplete="current-password" disabled={pending} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block loading={pending}>
                        登录
                    </Button>
                </Form>

                {/* AGPLv3 §7(b)(c)：保守保留署名与来源链接，落地位置待合规报告确认 */}
                <div
                    style={{
                        marginTop: 24,
                        fontSize: 11,
                        lineHeight: 1.7,
                        color: token.colorTextTertiary,
                    }}
                >
                    Frontend design and development by New API contributors.{" "}
                    <a
                        href="https://github.com/QuantumNous/new-api"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: token.colorPrimary }}
                    >
                        github.com/QuantumNous/new-api
                    </a>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <ConfigProvider theme={getAntThemeConfig(false)}>
            <LoginCard />
        </ConfigProvider>
    );
}
