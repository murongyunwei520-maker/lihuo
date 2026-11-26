import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Form, Input } from "antd";

import { AuthShell } from "@/components/auth/auth-shell";
import { ServerApiError } from "@/services/api/lihuo-server";
import { useAuthStore } from "@/stores/use-auth-store";

/**
 * 登录 / 注册
 * ------------------------------------------------------------
 * - 普通用户入口：登录后回到 next（默认 /canvas）
 * - 管理员同样从这里进，登录后可直接访问 /admin
 * - 会话凭据是后端下发的 HttpOnly Cookie，前端不存储任何密钥
 * - next 参数做站内白名单校验，防开放重定向
 */

const DEFAULT_NEXT = "/canvas";

function safeNext(raw: string | null): string {
    if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_NEXT;
    return raw;
}

interface LoginValues {
    username: string;
    password: string;
}

interface RegisterValues extends LoginValues {
    confirm: string;
    email: string;
    inviteCode?: string;
}

function AuthForm({ mode, onSwitch }: { mode: "login" | "register"; onSwitch: (mode: "login" | "register") => void }) {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const signIn = useAuthStore((state) => state.signIn);
    const signUp = useAuthStore((state) => state.signUp);

    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    const handleError = (e: unknown) => {
        if (e instanceof ServerApiError) {
            if (e.code === "register_disabled") {
                setError("当前未开放自助注册，请联系管理员开通账号");
                return;
            }
            setError(e.message);
            return;
        }
        setError((e as Error).message);
    };

    const onLogin = async (values: LoginValues) => {
        setError(null);
        setPending(true);
        try {
            await signIn(values.username.trim(), values.password.trim());
            navigate(safeNext(params.get("next")), { replace: true });
        } catch (e) {
            handleError(e);
        } finally {
            setPending(false);
        }
    };

    const onRegister = async (values: RegisterValues) => {
        setError(null);
        setPending(true);
        try {
            await signUp({ username: values.username.trim(), password: values.password.trim(), email: values.email.trim(), inviteCode: values.inviteCode?.trim() });
            navigate(safeNext(params.get("next")), { replace: true });
        } catch (e) {
            handleError(e);
        } finally {
            setPending(false);
        }
    };

    return (
        <>
            {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

            {mode === "login" ? (
                <Form<LoginValues> layout="vertical" requiredMark={false} onFinish={onLogin} initialValues={{ username: "", password: "" }}>
                    <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input autoComplete="username" autoFocus disabled={pending} />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password autoComplete="current-password" disabled={pending} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block loading={pending}>
                        登录
                    </Button>
                    <div className="mt-2 flex items-center justify-between">
                        <Button
                            type="link"
                            size="small"
                            style={{ paddingInline: 0 }}
                            onClick={() => {
                                onSwitch("register");
                                setError(null);
                            }}
                        >
                            没有账号？注册
                        </Button>
                        <Link to="/forgot-password" className="text-xs">
                            忘记密码？
                        </Link>
                    </div>
                </Form>
            ) : (
                <Form<RegisterValues> layout="vertical" requiredMark={false} onFinish={onRegister}>
                    <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }, { min: 3, message: "至少 3 个字符" }]}>
                        <Input autoComplete="username" autoFocus disabled={pending} />
                    </Form.Item>
                    <Form.Item
                        name="password"
                        label="密码"
                        rules={[{ required: true, message: "请输入密码" }, { min: 10, message: "至少 10 位" }]}
                        extra="至少 10 位，且包含大小写、数字、符号中的三类"
                    >
                        <Input.Password autoComplete="new-password" disabled={pending} />
                    </Form.Item>
                    <Form.Item
                        name="email"
                        label="邮箱"
                        rules={[
                            { required: true, message: "请填写邮箱，用于找回密码" },
                            { type: "email", message: "邮箱格式不正确" },
                        ]}
                    >
                        <Input autoComplete="email" disabled={pending} placeholder="you@example.com" />
                    </Form.Item>
                    <Form.Item
                        name="confirm"
                        label="确认密码"
                        dependencies={["password"]}
                        rules={[
                            { required: true, message: "请再次输入密码" },
                            ({ getFieldValue }) => ({
                                validator: (_, value) =>
                                    value && value.trim() !== String(getFieldValue("password") ?? "").trim() ? Promise.reject(new Error("两次输入不一致")) : Promise.resolve(),
                            }),
                        ]}
                    >
                        <Input.Password autoComplete="new-password" disabled={pending} />
                    </Form.Item>
                    <Form.Item name="inviteCode" label="邀请码">
                        <Input disabled={pending} placeholder="如已开放注册会提示获取方式" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block loading={pending}>
                        注册并登录
                    </Button>
                    <Button
                        type="link"
                        block
                        style={{ marginTop: 8 }}
                        onClick={() => {
                            onSwitch("login");
                            setError(null);
                        }}
                    >
                        已有账号？去登录
                    </Button>
                </Form>
            )}
        </>
    );
}

export default function LoginPage() {
    const [mode, setMode] = useState<"login" | "register">("login");

    return (
        <AuthShell
            title={mode === "login" ? "登录离火" : "创建账号"}
            description={mode === "login" ? "登录后创作、保存与生成都在云端完成" : "注册后即可获得平台模型额度"}
        >
            <AuthForm mode={mode} onSwitch={setMode} />
        </AuthShell>
    );
}
