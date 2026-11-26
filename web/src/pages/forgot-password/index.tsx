import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Form, Input } from "antd";

import { AuthShell } from "@/components/auth/auth-shell";
import { forgotPassword } from "@/services/api/lihuo-server";

/** 忘记密码：只负责发信，不透露邮箱是否注册过 */
export default function ForgotPasswordPage() {
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    const onFinish = async (values: { email: string }) => {
        setError(null);
        setPending(true);
        try {
            await forgotPassword(values.email.trim());
            setSent(true);
        } catch (e) {
            setError((e as Error).message || "发送失败，请稍后重试");
        } finally {
            setPending(false);
        }
    };

    return (
        <AuthShell title="找回密码" description="输入注册时填写的邮箱，我们会发送一条重置链接">
            {sent ? (
                <>
                    <Alert
                        type="success"
                        showIcon
                        message="如果该邮箱已绑定账号，重置链接已发出"
                        description="链接 30 分钟内有效，且只能使用一次。没收到请检查垃圾邮件，或确认账户里填过这个邮箱。"
                        style={{ marginBottom: 16 }}
                    />
                    <Link to="/login">
                        <Button block>返回登录</Button>
                    </Link>
                </>
            ) : (
                <Form<{ email: string }> layout="vertical" requiredMark={false} onFinish={onFinish}>
                    <Form.Item
                        name="email"
                        label="邮箱"
                        rules={[
                            { required: true, message: "请输入邮箱" },
                            { type: "email", message: "邮箱格式不正确" },
                        ]}
                    >
                        <Input autoComplete="email" autoFocus disabled={pending} placeholder="you@example.com" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block loading={pending}>
                        发送重置链接
                    </Button>
                    <div className="mt-3 text-center text-xs">
                        <Link to="/login">返回登录</Link>
                    </div>
                </Form>
            )}

            {error ? <Alert type="error" message={error} showIcon style={{ marginTop: 16 }} /> : null}
        </AuthShell>
    );
}
