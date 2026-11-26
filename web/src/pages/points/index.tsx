import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Modal, Table, Tag } from "antd";
import { Check, Sparkles } from "lucide-react";

import {
    cancelPointOrder,
    createPointOrder,
    listModels,
    listPointPackages,
    myPointOrders,
    myPoints,
    payPointOrder,
    type PointOrder,
    type PointPackage,
    type RegistryModel,
} from "@/services/api/lihuo-server";
import { useAuthStore } from "@/stores/use-auth-store";

/**
 * 积分充值
 * ------------------------------------------------------------
 * 套餐与定价全部来自后端（管理后台可改），前端不写死任何价格。
 * `paymentDriver=mock` 时点「立即充值」即时到账；`manual` 时生成待确认订单，
 * 由管理员在后台确认后才入账。
 */

const cardStyle = { background: "var(--studio-glass-strong)" };
const STATUS_LABEL: Record<string, { text: string; color: string }> = {
    pending: { text: "待确认", color: "gold" },
    paid: { text: "已到账", color: "green" },
    cancelled: { text: "已取消", color: "default" },
    refunded: { text: "已退款", color: "red" },
};

const CAPABILITY_LABEL: Record<string, string> = {
    image: "图片模型",
    video: "视频模型",
    audio: "语音模型",
    text: "文本模型",
};

function yuan(cents: number): string {
    return `¥${(cents / 100).toFixed(2)}`;
}

function time(seconds: number): string {
    return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

export default function PointsPage() {
    const { message } = App.useApp();
    const applyUser = useAuthStore((state) => state.applyUser);

    const [packages, setPackages] = useState<PointPackage[]>([]);
    const [driver, setDriver] = useState<"mock" | "manual">("mock");
    const [balance, setBalance] = useState(0);
    const [orders, setOrders] = useState<PointOrder[]>([]);
    const [models, setModels] = useState<RegistryModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<PointPackage | null>(null);

    const reload = useCallback(async () => {
        try {
            const [pkg, mine, orderList, modelList] = await Promise.all([listPointPackages(), myPoints(), myPointOrders(1, 10), listModels()]);
            setPackages(pkg.items);
            setDriver(pkg.paymentDriver);
            setBalance(mine.balance);
            setOrders(orderList.items);
            setModels(modelList.items.filter((item) => item.enabled && item.capability !== "embedding"));

            const current = useAuthStore.getState().user;
            if (current && current.points !== mine.balance) applyUser({ ...current, points: mine.balance });
        } catch (error) {
            message.error((error as Error).message || "加载套餐失败");
        } finally {
            setLoading(false);
        }
    }, [applyUser, message]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const onPurchase = async () => {
        if (!selected) return;
        setBusy(true);
        try {
            const created = await createPointOrder(selected.id);
            if (created.paymentDriver === "manual") {
                message.success(`已创建订单 ${created.order.id}，完成转账后请联系管理员确认到账`);
                setSelected(null);
                await reload();
                return;
            }
            const paid = await payPointOrder(created.order.id);
            message.success(`充值成功，获得 ${paid.order.points} 积分`);
            setSelected(null);
            await reload();
        } catch (error) {
            message.error((error as Error).message || "充值失败");
        } finally {
            setBusy(false);
        }
    };

    const onCancel = async (order: PointOrder) => {
        try {
            await cancelPointOrder(order.id);
            message.success("订单已取消");
            await reload();
        } catch (error) {
            message.error((error as Error).message || "取消失败");
        }
    };

    const grouped = models.reduce<Record<string, RegistryModel[]>>((acc, model) => {
        (acc[model.capability] ||= []).push(model);
        return acc;
    }, {});

    return (
        <main className="studio-config-page h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-6xl px-6 py-6">
                <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">积分充值</h1>
                        <p className="mt-1 text-sm text-stone-500">充值积分，解锁全部模型。积分永久有效，到账后立即可用。</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl px-4 py-2" style={cardStyle}>
                        <Sparkles className="size-4" style={{ color: "rgb(var(--studio-violet-deep))" }} />
                        <span className="text-xs text-stone-500">当前积分</span>
                        <span className="text-lg font-semibold text-stone-900 dark:text-stone-100">{balance}</span>
                    </div>
                </header>

                {driver === "manual" ? (
                    <Alert
                        className="mb-4"
                        type="info"
                        showIcon
                        message="当前为人工确认模式"
                        description="提交订单后请完成转账并联系管理员，管理员确认后积分自动到账。"
                    />
                ) : null}

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {packages.map((pack) => (
                        <section
                            key={pack.id}
                            className="relative flex flex-col gap-4 rounded-2xl border p-5 transition hover:-translate-y-0.5"
                            style={{
                                ...cardStyle,
                                borderColor: pack.recommended ? "rgb(var(--studio-violet) / 0.55)" : "var(--studio-border-soft)",
                                boxShadow: pack.recommended
                                    ? "0 16px 32px rgb(var(--studio-violet-deep) / 0.14), inset 0 1px 0 var(--studio-highlight)"
                                    : "var(--studio-card-shadow)",
                            }}
                        >
                            {pack.badge ? (
                                <span
                                    className="absolute right-4 top-0 -translate-y-1/2 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                                    style={{ background: "rgb(var(--studio-violet-deep))", color: "#fff" }}
                                >
                                    {pack.badge}
                                </span>
                            ) : null}

                            <div>
                                <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">{pack.name}</h2>
                                <p className="mt-0.5 text-xs text-stone-500">{pack.subtitle}</p>
                            </div>

                            <div>
                                <div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">{yuan(pack.priceCents)}</div>
                                <div className="mt-1 text-xs text-stone-500">
                                    基础 {pack.points.toLocaleString()} 积分
                                    {pack.bonusPoints > 0 ? ` + 赠送 ${pack.bonusPoints.toLocaleString()} 积分` : ""}
                                </div>
                                <div className="mt-2 text-sm font-medium text-stone-800 dark:text-stone-200">
                                    共 {pack.totalPoints.toLocaleString()} 积分
                                </div>
                            </div>

                            <ul className="flex flex-col gap-1.5 text-xs text-stone-600 dark:text-stone-300">
                                {pack.highlights.map((item) => (
                                    <li key={item} className="flex items-start gap-1.5">
                                        <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: "rgb(var(--studio-blue))" }} />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>

                            <Button
                                block
                                type={pack.recommended ? "primary" : "default"}
                                style={
                                    pack.recommended
                                        ? {
                                              background: "rgb(var(--studio-violet-deep))",
                                              borderColor: "rgb(var(--studio-violet-deep))",
                                              color: "#fff",
                                          }
                                        : { ...cardStyle, borderColor: "var(--studio-border-soft)" }
                                }
                                onClick={() => setSelected(pack)}
                            >
                                立即充值
                            </Button>
                        </section>
                    ))}
                </div>

                {!loading && packages.length === 0 ? (
                    <p className="mt-6 text-sm text-stone-500">暂时没有可购买的套餐，请联系管理员。</p>
                ) : null}

                <section className="mt-8 rounded-2xl p-5" style={cardStyle}>
                    <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">积分可用的模型</h2>
                    <p className="mt-1 text-xs text-stone-500">以下模型来自平台注册表，充值积分后即可调用。</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {Object.entries(grouped).map(([capability, list]) => (
                            <div key={capability}>
                                <div className="text-xs font-medium text-stone-500">{CAPABILITY_LABEL[capability] ?? capability}</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {list.map((model) => (
                                        <span
                                            key={model.modelId}
                                            className="rounded-lg border px-2 py-1 text-xs text-stone-700 dark:text-stone-200"
                                            style={{ borderColor: "var(--studio-border)", background: "var(--studio-glass)" }}
                                            title={model.description || model.modelId}
                                        >
                                            {model.displayName || model.modelId}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {models.length === 0 ? <span className="text-xs text-stone-500">平台暂未上架可用模型。</span> : null}
                    </div>
                </section>

                <section className="mt-8 rounded-2xl p-5" style={cardStyle}>
                    <h2 className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">我的充值记录</h2>
                    <Table<PointOrder>
                        size="small"
                        rowKey="id"
                        loading={loading}
                        dataSource={orders}
                        pagination={false}
                        columns={[
                            { title: "时间", dataIndex: "createdAt", key: "time", width: 170, render: (v: number) => time(v) },
                            { title: "订单号", dataIndex: "id", key: "id", width: 200 },
                            { title: "套餐", dataIndex: "packageName", key: "packageName", width: 110 },
                            { title: "金额", dataIndex: "priceCents", key: "price", width: 100, align: "right", render: (v: number) => yuan(v) },
                            { title: "积分", dataIndex: "points", key: "points", width: 90, align: "right" },
                            {
                                title: "状态",
                                dataIndex: "status",
                                key: "status",
                                width: 100,
                                render: (v: string) => {
                                    const meta = STATUS_LABEL[v] ?? { text: v, color: "default" };
                                    return <Tag color={meta.color}>{meta.text}</Tag>;
                                },
                            },
                            {
                                title: "操作",
                                key: "actions",
                                width: 100,
                                render: (_, order) =>
                                    order.status === "pending" ? (
                                        <Button type="link" size="small" onClick={() => onCancel(order)}>
                                            取消
                                        </Button>
                                    ) : null,
                            },
                        ]}
                    />
                    {orders.length === 0 && !loading ? <p className="mt-2 text-xs text-stone-500">还没有充值记录。</p> : null}
                </section>
            </div>

            <Modal
                title={`确认充值 · ${selected?.name ?? ""}`}
                open={selected !== null}
                onCancel={() => setSelected(null)}
                onOk={onPurchase}
                okText={driver === "mock" ? "确认支付" : "提交订单"}
                cancelText="取消"
                confirmLoading={busy}
                destroyOnHidden
            >
                {selected ? (
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-stone-500">套餐</span>
                            <span>{selected.name}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500">金额</span>
                            <span className="font-semibold">{yuan(selected.priceCents)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500">获得积分</span>
                            <span>
                                {selected.totalPoints.toLocaleString()}（含赠送 {selected.bonusPoints.toLocaleString()}）
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-500">支付方式</span>
                            <span>{driver === "mock" ? "本地模拟支付（即时到账）" : "人工确认（转账后联系管理员）"}</span>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </main>
    );
}
