import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Spin, Typography } from "antd";

import { ServerApiError } from "@/services/api/lihuo-server";

/**
 * 管理页共享工具
 * ------------------------------------------------------------
 * 只做「加载 / 错误 / 重新加载」和格式化，不包含任何业务判断。
 * 权限由后端强制校验，这里不做二次推断。
 */

export function useLoad<T>(loader: () => Promise<T>) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);

    const reload = useCallback(() => setTick((n) => n + 1), []);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        loader()
            .then((d) => {
                if (alive) setData(d);
            })
            .catch((e) => {
                if (alive) setError(e instanceof ServerApiError ? e.message : (e as Error).message);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
        // loader 每次渲染都是新函数，刻意只在 reload() 时重跑
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick]);

    return { data, error, loading, reload, setData };
}

/** 内部以「分」记账，展示换算成元 */
export function money(cents: number): string {
    return `¥${(cents / 100).toFixed(2)}`;
}

export function time(sec: number): string {
    return new Date(sec * 1000).toLocaleString("zh-CN", { hour12: false });
}

export function PageHead({ title, desc, extra }: { title: string; desc: string; extra?: ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
            <div>
                <Typography.Title level={4} style={{ margin: "0 0 4px", fontWeight: 500 }}>
                    {title}
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
                    {desc}
                </Typography.Paragraph>
            </div>
            {extra && <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>{extra}</div>}
        </div>
    );
}

export function LoadState({
    loading,
    error,
    onRetry,
    children,
}: {
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    children: ReactNode;
}) {
    if (loading) {
        return (
            <div style={{ padding: 48, textAlign: "center" }}>
                <Spin />
            </div>
        );
    }
    if (error) {
        return (
            <Alert
                type="error"
                showIcon
                message="加载失败"
                description={error}
                action={
                    <Button size="small" onClick={onRetry}>
                        重试
                    </Button>
                }
            />
        );
    }
    return <>{children}</>;
}

/** 写操作统一错误提示，避免每个页面各写一套 */
export function writeError(e: unknown): string {
    return e instanceof ServerApiError ? e.message : (e as Error).message;
}
