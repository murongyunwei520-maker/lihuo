import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Form, Input } from "antd";

import { AuthShell } from "@/components/auth/auth-shell";
import { resetPassword } from "@/services/api/lihuo-server";

/** 重置密码：token 从邮件链接带入，成功后所有设备下线 */
export default function ResetPasswordPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = (params.get("token") || "").trim();

    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        if (!done) return;
        const timer = window.setTimeout(() => navigate("/login", { replace: true }), 1800);
        return () => window.clearTimeout(timer);
    }, [done, navigate]);

    const onFinish = async (values: { password: string }) => {
        setError(null);
        setPending(true);
        try {
            await resetPassword(token, values.password.trim());
            setDone(true);
        } catch (e) {
            setError((e as Error).message || "重置失败，请重新申请");
        } finally {
            setPending(false);
        }
    };

    return (
        <AuthShell title="重置密码" description="设置一个新密码，保存后所有设备需要重新登录">
            {!token ? (
                <Alert type="error" showIcon message="链接不完整" description="请从邮件里重新打开，或回到登录页重新申请。" />
            ) : done ? (
                <Alert type="success" showIcon message="密码已重置" description="正在跳转到登录页…" />
            ) : (
                <>
                    {error ? <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} /> : null}
                    <Form<{ password: string; confirm: string }> layout="vertical" requiredMark={false} onFinish={onFinish}>
                        <Form.Item
                            name="password"
                            label="新密码"
                            rules={[
                                { required: true, message: "请输入新密码" },
                                { min: 10, message: "至少 10 位" },
                            ]}
                            extra="至少 10 位，且包含大小写、数字、符号中的三类"
                        >
                            <Input.Password autoComplete="new-password" autoFocus disabled={pending} />
                        </Form.Item>
                        <Form.Item
                            name="confirm"
                            label="确认新密码"
                            dependencies={["password"]}
                            rules={[
                                { required: true, message: "请再次输入新密码" },
                                ({ getFieldValue }) => ({
                                    validator: (_, value) =>
                                        value && value.trim() !== String(getFieldValue("password") ?? "").trim() ? Promise.reject(new Error("两次输入不一致")) : Promise.resolve(),
                                }),
                            ]}
                        >
                            <Input.Password autoComplete="new-password" disabled={pending} />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" block loading={pending}>
                            保存新密码
                        </Button>
                        <div className="mt-3 text-center text-xs">
                            <Link to="/login">返回登录</Link>
                        </div>
                    </Form>
                </>
            )}
        </AuthShell>
    );
}
