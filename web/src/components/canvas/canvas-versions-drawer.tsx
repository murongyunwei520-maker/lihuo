import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Empty, Popconfirm, Spin, Tag } from "antd";
import { History, RotateCcw } from "lucide-react";

import { listProjectVersions, restoreProjectVersion, type ProjectVersionSummary } from "@/services/api/lihuo-server";

/**
 * 历史版本抽屉
 * ------------------------------------------------------------
 * 后端在保存时按 5 分钟节流留档（最多 30 版），恢复前会先把当前内容存一版，
 * 所以「恢复」本身也能再退回来。恢复后整页重新加载，避免半新半旧的编辑态。
 */
export function CanvasVersionsDrawer({
    open,
    projectId,
    revision,
    onClose,
}: {
    open: boolean;
    projectId: string;
    revision?: number;
    onClose: () => void;
}) {
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState<ProjectVersionSummary[]>([]);
    const [busyId, setBusyId] = useState<number | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listProjectVersions(projectId);
            setItems(res.items);
        } catch (error) {
            message.error((error as Error).message || "读取历史版本失败");
        } finally {
            setLoading(false);
        }
    }, [message, projectId]);

    useEffect(() => {
        if (!open) return;
        void reload();
    }, [open, reload]);

    const onRestore = async (item: ProjectVersionSummary) => {
        if (revision === undefined) {
            message.error("画布还没保存到云端，无法恢复");
            return;
        }
        setBusyId(item.id);
        try {
            await restoreProjectVersion(projectId, item.id, revision);
            message.success("已恢复到该版本，正在重新加载…");
            window.setTimeout(() => window.location.reload(), 600);
        } catch (error) {
            message.error((error as Error).message || "恢复失败");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={380}
            title={
                <span className="inline-flex items-center gap-2 text-sm">
                    <History className="size-4" /> 历史版本
                </span>
            }
        >
            <p className="mb-4 text-xs text-stone-500">
                保存时每 5 分钟最多留一版，保留最近 30 版。恢复前会自动备份当前内容，恢复错了还能再退回来。
            </p>

            {loading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-stone-500">
                    <Spin size="small" /> 读取中…
                </div>
            ) : items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有历史版本，继续编辑一会儿就会出现" />
            ) : (
                <ul className="space-y-2">
                    {items.map((item, index) => (
                        <li key={item.id} className="rounded-xl border border-stone-200/70 px-3 py-2.5 dark:border-white/10">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 text-sm">
                                        <span className="truncate">{new Date(item.createdAt * 1000).toLocaleString("zh-CN", { hour12: false })}</span>
                                        {item.label ? <Tag color="gold">{item.label}</Tag> : index === 0 ? <Tag color="blue">最新</Tag> : null}
                                    </div>
                                    <div className="mt-0.5 text-xs text-stone-500">
                                        rev {item.revision} · {item.nodeCount} 个节点 · {item.connectionCount} 条连线
                                    </div>
                                </div>
                                <Popconfirm
                                    title="恢复到这一版？"
                                    description="当前内容会先自动备份，可再退回。"
                                    okText="恢复"
                                    cancelText="取消"
                                    onConfirm={() => onRestore(item)}
                                >
                                    <Button size="small" icon={<RotateCcw className="size-3.5" />} loading={busyId === item.id}>
                                        恢复
                                    </Button>
                                </Popconfirm>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Drawer>
    );
}
