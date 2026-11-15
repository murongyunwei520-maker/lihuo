import { useState } from "react";
import {
    Alert,
    App as AntdApp,
    Button,
    Form,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Select,
    Space,
    Switch,
    Table,
    Tag,
    type TableProps,
} from "antd";
import { Plus } from "lucide-react";

import { adminApi, type GenerationPrice, type RegistryModel } from "@/services/api/lihuo-server";

import { LoadState, PageHead, useLoad, writeError } from "./shared";

const CAP_OPTIONS = [
    { value: "text", label: "文本" },
    { value: "image", label: "图像" },
    { value: "video", label: "视频" },
    { value: "audio", label: "音频" },
    { value: "embedding", label: "向量" },
];

/** 后端已有生成代理端点的能力；video 暂未接入，不显示按次价设置 */
const GENERATION_CAPABILITIES = new Set<RegistryModel["capability"]>(["image", "audio", "embedding"]);

interface CreateValues {
    modelId: string;
    displayName?: string;
    provider?: string;
    capability: RegistryModel["capability"];
    inPrice: number;
    outPrice: number;
    enabled: boolean;
}

/**
 * 模型中心
 * ------------------------------------------------------------
 * 注册表回答「怎么用、多少钱、能不能用」，网关只回答「上游现在有什么」。
 * 上架前必须有价格、参数必须落在能力白名单内——这两条由后端强制校验，
 * 前端只是把规则呈现出来，不是安全边界。
 */
export default function ModelsPage() {
    const { message } = AntdApp.useApp();
    const load = useLoad(async () => {
        const [models, perCall] = await Promise.all([adminApi.models(), adminApi.generationPrices()]);
        const perCallPrices = new Map<string, GenerationPrice>(perCall.items.map((item) => [item.model, item]));
        return { ...models, perCallPrices };
    });
    const [createOpen, setCreateOpen] = useState(false);
    const [priceTarget, setPriceTarget] = useState<RegistryModel | null>(null);
    const [perCallTarget, setPerCallTarget] = useState<RegistryModel | null>(null);
    const [busy, setBusy] = useState(false);
    const [form] = Form.useForm<CreateValues>();
    const [priceForm] = Form.useForm<{ inPrice: number; outPrice: number }>();
    const [perCallForm] = Form.useForm<{ centsPerCall: number; enabled: boolean }>();
    const capability = Form.useWatch("capability", form) as RegistryModel["capability"] | undefined;
    const allowedParams = capability ? (load.data?.parameterWhitelist[capability] ?? []) : [];

    const onCreate = async (v: CreateValues) => {
        setBusy(true);
        try {
            await adminApi.createModel({
                modelId: v.modelId.trim(),
                displayName: v.displayName,
                provider: v.provider,
                capability: v.capability,
                enabled: v.enabled,
                price: { inCentsPer1k: Number(v.inPrice), outCentsPer1k: Number(v.outPrice) },
            });
            message.success("模型已注册");
            setCreateOpen(false);
            form.resetFields();
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const onPrice = async (v: { inPrice: number; outPrice: number }) => {
        if (!priceTarget) return;
        setBusy(true);
        try {
            await adminApi.updateModel(priceTarget.modelId, {
                price: { inCentsPer1k: Number(v.inPrice), outCentsPer1k: Number(v.outPrice) },
            });
            message.success("价格已更新");
            setPriceTarget(null);
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const onPerCall = async (v: { centsPerCall: number; enabled: boolean }) => {
        if (!perCallTarget) return;
        setBusy(true);
        try {
            await adminApi.setGenerationPrice(perCallTarget.modelId, {
                centsPerCall: Number(v.centsPerCall),
                enabled: v.enabled,
            });
            message.success("按次价格已更新");
            setPerCallTarget(null);
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const toggleEnabled = async (m: RegistryModel) => {
        setBusy(true);
        try {
            await adminApi.updateModel(m.modelId, { enabled: !m.enabled });
            message.success(m.enabled ? "已下架" : "已上架");
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const onDelete = async (m: RegistryModel) => {
        setBusy(true);
        try {
            await adminApi.deleteModel(m.modelId);
            message.success("模型已删除");
            load.reload();
        } catch (e) {
            message.error(writeError(e));
        } finally {
            setBusy(false);
        }
    };

    const columns: TableProps<RegistryModel>["columns"] = [
        { title: "模型 ID", dataIndex: "modelId", key: "modelId" },
        { title: "名称", dataIndex: "displayName", key: "displayName" },
        {
            title: "能力",
            dataIndex: "capability",
            key: "capability",
            width: 90,
            render: (v: string) => <Tag>{CAP_OPTIONS.find((o) => o.value === v)?.label ?? v}</Tag>,
        },
        {
            title: "价格（分/1K）",
            key: "price",
            width: 140,
            align: "right",
            render: (_, m) =>
                m.price ? `${m.price.inCentsPer1k} / ${m.price.outCentsPer1k}` : <Tag color="orange">未定价</Tag>,
        },
        {
            title: "按次价（分/次）",
            key: "perCall",
            width: 130,
            align: "right",
            render: (_, m) => {
                if (!GENERATION_CAPABILITIES.has(m.capability)) return "—";
                const p = load.data?.perCallPrices.get(m.modelId);
                if (!p) return <Tag color="orange">未设置</Tag>;
                return p.enabled ? `${p.centsPerCall} 分` : <Tag>已停用</Tag>;
            },
        },
        {
            title: "上架",
            dataIndex: "enabled",
            key: "enabled",
            width: 80,
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "是" : "否"}</Tag>,
        },
        {
            title: "网关可用",
            dataIndex: "available",
            key: "available",
            width: 100,
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "可用" : "不可用"}</Tag>,
        },
        {
            title: "可使用",
            dataIndex: "usable",
            key: "usable",
            width: 90,
            render: (v: boolean) => <Tag color={v ? "purple" : "default"}>{v ? "是" : "否"}</Tag>,
        },
        {
            title: "操作",
            key: "actions",
            width: 300,
            render: (_, m) => (
                <Space size={4} wrap>
                    <Button
                        type="link"
                        size="small"
                        onClick={() => {
                            priceForm.setFieldsValue({
                                inPrice: m.price?.inCentsPer1k ?? 0,
                                outPrice: m.price?.outCentsPer1k ?? 0,
                            });
                            setPriceTarget(m);
                        }}
                    >
                        改价
                    </Button>
                    {GENERATION_CAPABILITIES.has(m.capability) && (
                        <Button
                            type="link"
                            size="small"
                            onClick={() => {
                                const p = load.data?.perCallPrices.get(m.modelId);
                                perCallForm.setFieldsValue({ centsPerCall: p?.centsPerCall ?? 0, enabled: p?.enabled ?? true });
                                setPerCallTarget(m);
                            }}
                        >
                            按次价
                        </Button>
                    )}
                    <Popconfirm
                        title={m.enabled ? "下架该模型？" : "上架该模型？"}
                        description={!m.enabled && !m.price ? "未定价的模型无法上架，请先改价。" : undefined}
                        onConfirm={() => toggleEnabled(m)}
                        disabled={!m.enabled && !m.price}
                    >
                        <Button type="link" size="small" disabled={!m.enabled && !m.price}>
                            {m.enabled ? "下架" : "上架"}
                        </Button>
                    </Popconfirm>
                    <Popconfirm title={`删除 ${m.modelId}？`} description="已下架的模型才可删除。" onConfirm={() => onDelete(m)} disabled={m.enabled}>
                        <Button type="link" size="small" danger disabled={m.enabled}>
                            删除
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <>
            <PageHead
                title="模型中心"
                desc="注册表定义能力、参数与价格；网关只提供上游可用性。上架前必须定价，生成类模型还需设置按次价。"
                extra={
                    <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                        注册模型
                    </Button>
                }
            />
            <LoadState loading={load.loading} error={load.error} onRetry={load.reload}>
                {load.data?.gatewayError && (
                    <Alert type="warning" showIcon message="模型网关不可用" description={load.data.gatewayError} style={{ marginBottom: 12 }} />
                )}
                {(load.data?.unregistered.length ?? 0) > 0 && (
                    <Alert
                        type="info"
                        showIcon
                        message="网关有但尚未注册的模型"
                        description={load.data?.unregistered.join("、")}
                        style={{ marginBottom: 12 }}
                    />
                )}
                <Table<RegistryModel>
                    rowKey="modelId"
                    size="small"
                    dataSource={load.data?.items ?? []}
                    columns={columns}
                    pagination={false}
                    locale={{ emptyText: "注册表为空，先注册一个模型" }}
                />
            </LoadState>

            <Modal
                title="注册模型"
                open={createOpen}
                onCancel={() => setCreateOpen(false)}
                onOk={() => form.submit()}
                okText="注册"
                cancelText="取消"
                confirmLoading={busy}
                destroyOnHidden
                width={560}
            >
                <Form<CreateValues>
                    form={form}
                    layout="vertical"
                    onFinish={onCreate}
                    initialValues={{ capability: "text", inPrice: 1, outPrice: 2, enabled: true }}
                >
                    <Form.Item name="modelId" label="模型 ID" extra="必须与网关渠道里的模型名逐字符一致" rules={[{ required: true, message: "请输入模型 ID" }]}>
                        <Input placeholder="例如 deepseek-chat" />
                    </Form.Item>
                    <Form.Item name="displayName" label="展示名称">
                        <Input placeholder="留空则使用模型 ID" />
                    </Form.Item>
                    <Form.Item name="provider" label="服务商">
                        <Input placeholder="例如 deepseek" />
                    </Form.Item>
                    <Form.Item name="capability" label="能力类型">
                        <Select options={CAP_OPTIONS} />
                    </Form.Item>
                    {allowedParams.length > 0 && (
                        <Form.Item label="该能力支持的参数">
                            <Space size={[4, 4]} wrap>
                                {allowedParams.map((p) => (
                                    <Tag key={p}>{p}</Tag>
                                ))}
                            </Space>
                        </Form.Item>
                    )}
                    <Form.Item label="价格（分 / 1K tokens）" required>
                        <Space.Compact block>
                            <Form.Item name="inPrice" noStyle rules={[{ required: true, message: "请输入输入价" }]}>
                                <InputNumber min={0} precision={0} addonBefore="输入" style={{ width: "50%" }} />
                            </Form.Item>
                            <Form.Item name="outPrice" noStyle rules={[{ required: true, message: "请输入输出价" }]}>
                                <InputNumber min={0} precision={0} addonBefore="输出" style={{ width: "50%" }} />
                            </Form.Item>
                        </Space.Compact>
                    </Form.Item>
                    <Form.Item name="enabled" label="立即上架" valuePropName="checked" extra="上架必须有价格；两项都为 0 会被后端拒绝。">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={`修改价格 · ${priceTarget?.modelId ?? ""}`}
                open={priceTarget !== null}
                onCancel={() => setPriceTarget(null)}
                onOk={() => priceForm.submit()}
                okText="保存"
                cancelText="取消"
                confirmLoading={busy}
                destroyOnHidden
            >
                <Form<{ inPrice: number; outPrice: number }> form={priceForm} layout="vertical" onFinish={onPrice}>
                    <Form.Item name="inPrice" label="输入价格（分 / 1K）" rules={[{ required: true, message: "请输入" }]}>
                        <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="outPrice" label="输出价格（分 / 1K）" rules={[{ required: true, message: "请输入" }]}>
                        <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={`按次价格 · ${perCallTarget?.modelId ?? ""}`}
                open={perCallTarget !== null}
                onCancel={() => setPerCallTarget(null)}
                onOk={() => perCallForm.submit()}
                okText="保存"
                cancelText="取消"
                confirmLoading={busy}
                destroyOnHidden
            >
                <Form<{ centsPerCall: number; enabled: boolean }> form={perCallForm} layout="vertical" onFinish={onPerCall}>
                    <Form.Item
                        name="centsPerCall"
                        label="每次调用价格（分）"
                        extra="生成类调用按次计费，与 token 单价互不影响。停用后该模型的生成代理会拒绝调用。"
                        rules={[{ required: true, message: "请输入每次调用价格" }]}
                    >
                        <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
}
