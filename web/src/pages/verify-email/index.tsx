import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Spin } from "antd";

import { AuthShell } from "@/components/auth/auth-shell";
import { verifyEmail } from "@/services/api/lihuo-server";
import { useAuthStore } from "@/stores/use-auth-store";

/** 邮箱验证：打开链接即自动提交，成功后把本地会话里的标记刷新掉 */
export default function VerifyEmailPage() {
    const [params] = useSearchParams();
    const token = (params.get("token") || "").trim();
    const applyUser = useAuthStore((state) => state.applyUser);
    const [state, setState] = useState<"pending" | "ok" | "error">("pending");
    const [message, setMessage] = useState("");
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        if (!token) {
            setState("error");
            setMessage("链接不完整，请从邮件里重新打开");
            return;
        }

        void verifyEmail(token)
            .then((user) => {
                applyUser(user);
                setState("ok");
            })
            .catch((error: Error) => {
                setState("error");
                setMessage(error.message || "验证失败，请重新发送验证邮件");
            });
    }, [applyUser, token]);

    return (
        <AuthShell title="邮箱验证" description="验证后即可用邮箱找回密码">
            {state === "pending" ? (
                <div className="flex items-center gap-3 text-sm text-stone-500">
                    <Spin size="small" /> 正在验证…
                </div>
            ) : state === "ok" ? (
                <>
                    <Alert type="success" showIcon message="邮箱已验证" description="现在可以用这个邮箱找回密码了。" style={{ marginBottom: 16 }} />
                    <Link to="/account">
                        <Button block type="primary">
                            回到账户中心
                        </Button>
                    </Link>
                </>
            ) : (
                <>
                    <Alert type="error" showIcon message="验证失败" description={message} style={{ marginBottom: 16 }} />
                    <Link to="/account">
                        <Button block>去账户中心重新发送</Button>
                    </Link>
                </>
            )}
        </AuthShell>
    );
}
