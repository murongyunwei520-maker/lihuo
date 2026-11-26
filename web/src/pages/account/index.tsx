import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from "antd";
import { Monitor, ShieldCheck, Sparkles, Wallet } from "lucide-react";

import { accountSummary, changePassword, deleteAccount, listLedger, listSessions, myPointLedger, myPoints, resendVerification, revokeOtherSessions, revokeSession, updateProfile, type AccountSummary, type LedgerItem, type LoginSession, type PointLedgerItem } from "@/services/api/lihuo-server";
import { useAuthStore } from "@/stores/use-auth-store";

/**
 * 账户中心
 * ------------------------------------------------------------
 * 只放"用户自己能改"的东西：资料、密码、登录设备、额度与流水、注销。
 * 额度充值由管理员操作；这里只读，避免用户绕过流水改余额。
 */

/** 仙境背景很花，内容卡片需要更实的底，否则正文读不清（取主题变量，不写死颜色） */
const cardStyle = { background: "var(--studio-glass-strong)" };

const KIND_LABEL: Record<string, string> = {
    grant: "赠送",
    recharge: "充值",
    redeem: "兑换",
    refund: "退款",
    adjust: "调整",
    task: "任务奖励",
    reward: "奖励",
    revoke: "回收",
};

function money(cents: number): string {
    return `¥${(cents / 100).toFixed(2)}`;
}

function time(seconds: number): string {
    return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

function deviceLabel(userAgent: string | null): string {
    if (!userAgent) return "未知设备";
    if (/Edg\//.test(userAgent)) return "Edge";
    if (/Chrome\//.test(userAgent)) return "Chrome";
    if (/Firefox\//.test(userAgent)) return "Firefox";
    if (/Safari\//.test(userAgent)) return "Safari";
    if (/curl|node|python/i.test(userAgent)) return "命令行/脚本";
    return userAgent.slice(0, 32);
}

export default function AccountPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const applyUser = useAuthStore((state) => state.applyUser);
    const signOut = useAuthStore((state) => state.signOut);

    const [summary, setSummary] = useState<AccountSummary | null>(null);
    const [ledger, setLedger] = useState<{ items: LedgerItem[]; total: number }>({ items: [], total: 0 });
    const [ledgerPage, setLedgerPage] = useState(1);
    const [points, setPoints] = useState(0);
    const [pointLedger, setPointLedger] = useState<{ items: PointLedgerItem[]; total: number }>({ items: [], total: 0 });
    const [pointPage, setPointPage] = useState(1);
    const [sessions, setSessions] = useState<LoginSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [profileForm] = Form.useForm<{ displayName?: string; email?: string }>();
    const [passwordForm] = Form.useForm<{ oldPassword: string; newPassword: string; confirm: string }>();

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [nextSummary, nextSessions, nextPoints] = await Promise.all([accountSummary(), listSessions(), myPoints()]);
            setSummary(nextSummary);
            setSessions(nextSessions.items);
            setPoints(nextPoints.balance);
            // 顶栏菜单里的余额与积分也要跟着刷新，否则调整后仍显示旧值
            const current = useAuthStore.getState().user;
            if (current && (current.quotaCents !== nextSummary.balanceCents || current.points !== nextPoints.balance)) {
                applyUser({ ...current, quotaCents: nextSummary.balanceCents, points: nextPoints.balance });
            }
        } catch (error) {
            message.error((error as Error).message || "加载账户信息失败");
        } finally {
            setLoading(false);
        }
    }, [applyUser, message]);

    useEffect(() => {
        void reload();
    }, [reload]);

    useEffect(() => {
        void listLedger(ledgerPage, 10)
            .then((res) => setLedger({ items: res.items, total: res.total }))
            .catch(() => setLedger({ items: [], total: 0 }));
    }, [ledgerPage]);

    useEffect(() => {
        void myPointLedger(10, (pointPage - 1) * 10)
            .then((res) => setPointLedger({ items: res.items, total: res.total }))
            .catch(() => setPointLedger({ items: [], total: 0 }));
    }, [pointPage]);

    useEffect(() => {
        if (user) profileForm.setFieldsValue({ displayName: user.displayName ?? "", email: user.email ?? "" });
    }, [profileForm, user]);

    const onSaveProfile = async (values: { displayName?: string; email?: string }) => {
        setBusy(true);
        try {
            const next = await updateProfile({ displayName: values.displayName?.trim() || "", email: values.email?.trim() || "" });
            applyUser(next);
            message.success("资料已更新");
        } catch (error) {
            message.error((error as Error).message || "保存失败");
        } finally {
            setBusy(false);
        }
    };

    const onChangePassword = async (values: { oldPassword: string; newPassword: string }) => {
        setBusy(true);
        try {
            const result = await changePassword(values.oldPassword.trim(), values.newPassword.trim());
            message.success(result.revokedSessions > 0 ? `密码已修改，${result.revokedSessions} 台其他设备已下线` : "密码已修改");
            passwordForm.resetFields();
            void reload();
        } catch (error) {
            message.error((error as Error).message || "修改失败");
        } finally {
            setBusy(false);
        }
    };

    const onRevoke = async (session: LoginSession) => {
        try {
            await revokeSession(session.id);
            message.success("已下线该设备");
            void reload();
        } catch (error) {
            message.error((error as Error).message || "下线失败");
        }
    };

    const onRevokeOthers = async () => {
        try {
            const result = await revokeOtherSessions();
            message.success(result.revoked > 0 ? `已下线 ${result.revoked} 台设备` : "没有其他在线设备");
            void reload();
        } catch (error) {
            message.error((error as Error).message || "操作失败");
        }
    };

    const onDeleteAccount = () => {
        let password = "";
        modal.confirm({
            title: "注销账号？",
            content: (
                <div className="space-y-2">
                    <p className="text-sm text-stone-600">注销后无法登录，画布与账单会保留 30 天，期间登录可撤销。</p>
                    <Input.Password placeholder="输入密码确认" onChange={(event) => (password = event.target.value)} />
                </div>
            ),
            okText: "注销",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                if (!password.trim()) {
                    message.error("请输入密码");
                    return Promise.reject(new Error("password required"));
                }
                await deleteAccount(password.trim());
                await signOut();
                message.success("账号已注销");
                navigate("/login", { replace: true });
            },
        });
    };

    if (!user) {
        return (
            <main className="studio-config-page h-full overflow-y-auto">
                <div className="mx-auto max-w-4xl px-6 py-10">
                    <Alert type="info" showIcon message="请先登录后查看账户信息" action={<Link to="/login?next=/account"><Button size="small" type="primary">去登录</Button></Link>} />
                </div>
            </main>
        );
    }

    return (
        <main className="studio-config-page h-full overflow-y-auto">
            <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
                <header>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">账户中心</h1>
                    <p className="mt-1 text-sm text-stone-500">管理个人资料、登录设备与额度；充值请联系管理员。</p>
                </header>

                <Card
                    size="small"
                    style={cardStyle}
                    loading={loading}
                    title={
                        <span className="inline-flex items-center gap-2">
                            <Wallet className="size-4" /> 额度
                        </span>
                    }
                >
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        {[
                            { label: "当前余额", value: money(summary?.balanceCents ?? 0) },
                            { label: "今日消费", value: money(summary?.todayCostCents ?? 0) },
                            { label: "今日调用", value: `${summary?.todayCalls ?? 0} 次` },
                            { label: "本月消费", value: money(summary?.monthCostCents ?? 0) },
                        ].map((item) => (
                            <div key={item.label}>
                                <div className="text-xs text-stone-500">{item.label}</div>
                                <div className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">{item.value}</div>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card
                    size="small"
                    style={cardStyle}
                    title={
                        <span className="inline-flex items-center gap-2">
                            <Sparkles className="size-4" /> 积分
                        </span>
                    }
                >
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <div className="text-xs text-stone-500">当前积分</div>
                            <div className="mt-1 text-2xl font-semibold text-stone-900 dark:text-stone-100">{points}</div>
                        </div>
                        <div className="flex max-w-md flex-col items-start gap-2">
                            <p className="text-xs text-stone-500">
                                积分是平台内部的虚拟点数，用于兑换权益与活动奖励，不能提现、不抵扣生成费用（生成按额度计费）。
                            </p>
                            <Link to="/points">
                                <Button size="small">充值积分</Button>
                            </Link>
                        </div>
                    </div>
                </Card>

                <Card size="small" style={cardStyle} title="积分流水">
                    <Table<PointLedgerItem>
                        size="small"
                        rowKey="id"
                        dataSource={pointLedger.items}
                        pagination={{ current: pointPage, pageSize: 10, total: pointLedger.total, onChange: setPointPage, showSizeChanger: false }}
                        columns={[
                            { title: "时间", dataIndex: "created_at", key: "time", width: 180, render: (v: number) => time(v) },
                            { title: "类型", dataIndex: "kind", key: "kind", width: 90, render: (v: string) => KIND_LABEL[v] ?? v },
                            {
                                title: "变动",
                                dataIndex: "amount",
                                key: "amount",
                                width: 100,
                                align: "right",
                                render: (v: number) => <span className={v < 0 ? "text-red-600" : "text-emerald-600"}>{v > 0 ? `+${v}` : v}</span>,
                            },
                            { title: "余额", dataIndex: "balance_after", key: "balance", width: 90, align: "right" },
                            { title: "原因", dataIndex: "reason", key: "reason" },
                        ]}
                    />
                </Card>

                <Card size="small" style={cardStyle} title="基本资料">
                    <Form form={profileForm} layout="vertical" onFinish={onSaveProfile} requiredMark={false}>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Form.Item label="用户名">
                                <Input value={user.username} disabled />
                            </Form.Item>
                            <Form.Item label="角色">
                                <Input value={user.role === "admin" ? "管理员" : "普通用户"} disabled />
                            </Form.Item>
                            <Form.Item name="displayName" label="昵称">
                                <Input placeholder="留空则显示用户名" maxLength={32} />
                            </Form.Item>
                            <Form.Item name="email" label="邮箱" extra="用于找回密码；修改后需要重新验证">
                                <Input placeholder="you@example.com" maxLength={120} />
                            </Form.Item>
                        </div>
                        <Space>
                            <Button type="primary" htmlType="submit" loading={busy}>
                                保存资料
                            </Button>
                            {user.email ? (
                                user.emailVerified ? (
                                    <Tag color="green">邮箱已验证</Tag>
                                ) : (
                                    <Button
                                        onClick={async () => {
                                            try {
                                                const result = await resendVerification();
                                                message.success(result.sent ? "验证邮件已发送" : "发送过于频繁，请稍后再试");
                                            } catch (error) {
                                                message.error((error as Error).message || "发送失败");
                                            }
                                        }}
                                    >
                                        发送验证邮件
                                    </Button>
                                )
                            ) : (
                                <Tag color="orange">未绑定邮箱</Tag>
                            )}
                        </Space>
                    </Form>
                </Card>

                <Card
                    size="small"
                    style={cardStyle}
                    title={
                        <span className="inline-flex items-center gap-2">
                            <ShieldCheck className="size-4" /> 登录与安全
                        </span>
                    }
                >
                    <Form form={passwordForm} layout="vertical" onFinish={onChangePassword} requiredMark={false}>
                        <div className="grid gap-4 md:grid-cols-3">
                            <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}>
                                <Input.Password autoComplete="current-password" />
                            </Form.Item>
                            <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: "请输入新密码" }, { min: 10, message: "至少 10 位" }]}>
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item
                                name="confirm"
                                label="确认新密码"
                                dependencies={["newPassword"]}
                                rules={[
                                    { required: true, message: "请再次输入新密码" },
                                    ({ getFieldValue }) => ({
                                        validator: (_, value) =>
                                            value && value.trim() !== String(getFieldValue("newPassword") ?? "").trim() ? Promise.reject(new Error("两次输入不一致")) : Promise.resolve(),
                                    }),
                                ]}
                            >
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>
                        </div>
                        <Button htmlType="submit" loading={busy}>
                            修改密码
                        </Button>
                    </Form>

                    <div className="mt-6 mb-2 flex items-center justify-between">
                        <span className="inline-flex items-center gap-2 text-sm font-medium">
                            <Monitor className="size-4" /> 登录设备（{sessions.length}）
                        </span>
                        <Button size="small" onClick={onRevokeOthers}>
                            下线其他设备
                        </Button>
                    </div>
                    <Table<LoginSession>
                        size="small"
                        rowKey="id"
                        pagination={false}
                        dataSource={sessions}
                        columns={[
                            {
                                title: "设备",
                                key: "device",
                                render: (_, row) => (
                                    <Space size={6}>
                                        <span>{deviceLabel(row.userAgent)}</span>
                                        {row.current ? <Tag color="green">当前</Tag> : null}
                                    </Space>
                                ),
                            },
                            { title: "IP", dataIndex: "ip", key: "ip", width: 140, render: (v: string | null) => v || "—" },
                            { title: "最近活跃", dataIndex: "lastSeenAt", key: "lastSeenAt", width: 180, render: (v: number) => time(v) },
                            {
                                title: "操作",
                                key: "actions",
                                width: 100,
                                render: (_, row) =>
                                    row.current ? (
                                        <Typography.Text type="secondary">—</Typography.Text>
                                    ) : (
                                        <Button type="link" size="small" danger onClick={() => void onRevoke(row)}>
                                            下线
                                        </Button>
                                    ),
                            },
                        ]}
                    />
                </Card>

                <Card size="small" style={cardStyle} title="额度流水">
                    <Table<LedgerItem>
                        size="small"
                        rowKey="id"
                        dataSource={ledger.items}
                        pagination={{ current: ledgerPage, pageSize: 10, total: ledger.total, onChange: setLedgerPage, showSizeChanger: false }}
                        columns={[
                            { title: "时间", dataIndex: "created_at", key: "time", width: 180, render: (v: number) => time(v) },
                            { title: "类型", dataIndex: "kind", key: "kind", width: 90, render: (v: string) => KIND_LABEL[v] ?? v },
                            {
                                title: "变动",
                                dataIndex: "amount_cents",
                                key: "amount",
                                width: 110,
                                align: "right",
                                render: (v: number) => <span className={v < 0 ? "text-red-600" : "text-emerald-600"}>{v > 0 ? `+${money(v)}` : money(v)}</span>,
                            },
                            { title: "余额", dataIndex: "balance_after", key: "balance", width: 110, align: "right", render: (v: number) => money(v) },
                            { title: "原因", dataIndex: "reason", key: "reason" },
                        ]}
                    />
                </Card>

                <Card size="small" style={cardStyle} title="危险操作" className="border-red-200/60">
                    <Descriptions size="small" column={1}>
                        <Descriptions.Item label="注销账号">删除登录资格并清空邮箱，画布与账单保留 30 天，期间登录可撤销。</Descriptions.Item>
                    </Descriptions>
                    <Popconfirm title="确认注销？" description="需要再次输入密码。" onConfirm={onDeleteAccount} okButtonProps={{ danger: true }} okText="继续" cancelText="取消">
                        <Button danger>注销账号</Button>
                    </Popconfirm>
                </Card>
            </div>
        </main>
    );
}
