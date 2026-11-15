import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
    Avatar,
    Button,
    ConfigProvider,
    Dropdown,
    Layout,
    Menu,
    Result,
    Spin,
    theme as antdTheme,
} from "antd";
import { Boxes, FileText, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";

import { getAntThemeConfig } from "@/lib/app-theme";
import { logout, me, type SessionUser } from "@/services/api/lihuo-server";

/**
 * 离火管理中心 · 独立布局
 * ------------------------------------------------------------
 * 依据 design-system/components/admin-console.md：
 *   - /admin/* 独立 Router 分支与 Layout，不套 UserLayout
 *   - 明色优先；侧栏 240、顶栏 56、内容区 padding 24
 *   - 只共享 app-theme.ts 的色彩与字体令牌，不共享布局组件
 *
 * 安全：会话校验只是为了体验（未登录跳转、非管理员显示 403）。
 * 真正的权限在后端 requireAdmin —— 前端隐藏不能作为安全边界。
 */

const NAV = [
    { key: "/admin", icon: <LayoutDashboard size={16} />, label: "总览" },
    { key: "/admin/models", icon: <Boxes size={16} />, label: "模型中心" },
    { key: "/admin/users", icon: <Users size={16} />, label: "用户中心" },
    { key: "/admin/logs", icon: <FileText size={16} />, label: "运行日志" },
    { key: "/admin/settings", icon: <Settings size={16} />, label: "系统设置" },
] as const;

type GuardState =
    | { status: "loading" }
    | { status: "guest" }
    | { status: "denied"; user: SessionUser }
    | { status: "ok"; user: SessionUser };

function AdminGuard() {
    const [state, setState] = useState<GuardState>({ status: "loading" });
    const location = useLocation();

    useEffect(() => {
        let alive = true;
        me()
            .then((u) => {
                if (!alive) return;
                setState(u.role === "admin" ? { status: "ok", user: u } : { status: "denied", user: u });
            })
            .catch(() => {
                if (alive) setState({ status: "guest" });
            });
        return () => {
            alive = false;
        };
    }, []);

    if (state.status === "loading") {
        return (
            <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
                <Spin tip="正在校验会话" />
            </div>
        );
    }
    if (state.status === "guest") {
        return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
    }
    if (state.status === "denied") {
        return (
            <Result
                status="403"
                title="没有管理员权限"
                subTitle={`账号 ${state.user.username} 是普通用户，无法进入管理中心。`}
                extra={
                    <Button href="/">返回画布</Button>
                }
            />
        );
    }
    return <AdminFrame user={state.user} />;
}

function AdminFrame({ user }: { user: SessionUser }) {
    const { token } = antdTheme.useToken();
    const navigate = useNavigate();
    const location = useLocation();

    const selected =
        location.pathname === "/admin"
            ? "/admin"
            : (NAV.find((n) => n.key !== "/admin" && location.pathname.startsWith(n.key))?.key ?? "/admin");
    const currentLabel = NAV.find((n) => n.key === selected)?.label ?? "总览";

    const onLogout = async () => {
        try {
            await logout();
        } catch {
            /* 会话可能已过期，仍回到登录页 */
        }
        navigate("/login", { replace: true });
    };

    const brandMark = {
        width: 26,
        height: 26,
        borderRadius: 8,
        background: token.colorPrimary,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        fontWeight: 600,
    } as const;

    return (
        <Layout style={{ minHeight: "100vh" }}>
            <Layout.Sider
                width={240}
                theme="light"
                style={{
                    background: token.colorBgContainer,
                    borderRight: `1px solid ${token.colorBorderSecondary}`,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <div
                    style={{
                        height: 56,
                        flex: "0 0 auto",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "0 16px",
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}
                >
                    <div style={brandMark}>离</div>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>离火</div>
                        <div style={{ fontSize: 10, color: token.colorTextTertiary, letterSpacing: ".1em" }}>
                            LIHUO ADMIN
                        </div>
                    </div>
                </div>

                <Menu
                    mode="inline"
                    selectedKeys={[selected]}
                    items={NAV.map((n) => ({ key: n.key, icon: n.icon, label: n.label }))}
                    onClick={({ key }) => navigate(key)}
                    style={{ borderInlineEnd: "none", marginTop: 8, flex: "1 1 auto" }}
                />

                <div
                    style={{
                        flex: "0 0 auto",
                        padding: 16,
                        fontSize: 11,
                        color: token.colorTextTertiary,
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                    }}
                >
                    本地开发环境 · 会话已校验
                </div>
            </Layout.Sider>

            <Layout>
                <Layout.Header
                    style={{
                        height: 56,
                        padding: "0 24px",
                        background: token.colorBgContainer,
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        lineHeight: "normal",
                    }}
                >
                    <span style={{ fontSize: 13, color: token.colorTextTertiary }}>
                        管理中心 / <b style={{ color: token.colorText, fontWeight: 500 }}>{currentLabel}</b>
                    </span>
                    <div style={{ flex: 1 }} />
                    <Dropdown
                        menu={{
                            items: [{ key: "logout", icon: <LogOut size={14} />, label: "退出登录" }],
                            onClick: onLogout,
                        }}
                    >
                        <Button type="text">
                            <Avatar size={24} style={{ background: token.colorPrimary, fontSize: 12 }}>
                                {user.username.slice(0, 1).toUpperCase()}
                            </Avatar>
                            <span style={{ marginLeft: 8 }}>{user.username}</span>
                        </Button>
                    </Dropdown>
                </Layout.Header>

                <Layout.Content style={{ padding: 24, background: token.colorBgLayout, overflow: "auto" }}>
                    <Outlet />
                </Layout.Content>
            </Layout>
        </Layout>
    );
}

export default function AdminLayout() {
    // 后台明色优先：局部覆盖，不改全局 AppProviders（否则会把画布一起切走）
    return (
        <ConfigProvider theme={getAntThemeConfig(false)}>
            <AdminGuard />
        </ConfigProvider>
    );
}
