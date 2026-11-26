import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronLeft, Info, ScrollText } from "lucide-react";

import { getJob, findJobForNode, type DoubaoJob } from "@/services/api/doubao-bridge";
import type { DoubaoRequestedParams } from "@/services/api/doubao-request-params";
import { useCanvasLayoutStore } from "@/stores/use-canvas-layout-store";
import type { CanvasNodeData } from "@/types/canvas";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
};

// 右侧检查器：选中节点属性 + 该节点任务的运行日志。
export function CanvasInspectorPanel({ nodes, selectedNodeIds }: Props) {
    const collapsed = !useCanvasLayoutStore((state) => state.inspectorOpen);
    const setInspectorOpen = useCanvasLayoutStore((state) => state.setInspectorOpen);
    const [job, setJob] = useState<DoubaoJob | null>(null);
    const selected = useMemo(() => {
        const id = [...selectedNodeIds][0];
        return id ? nodes.find((node) => node.id === id) || null : null;
    }, [nodes, selectedNodeIds]);

    const jobId = typeof selected?.metadata?.jobId === "string" ? selected.metadata.jobId : "";
    const selectedId = selected?.id || "";

    useEffect(() => {
        setJob(null);
        if (!selectedId || collapsed) return;
        let alive = true;
        // 有本地 jobId 就查它；没有就按 nodeId 反查桥接任务（图片任务也带 nodeId）
        const load = async () => {
            try {
                const next = jobId ? await getJob(jobId) : await findJobForNode(selectedId);
                if (alive) setJob(next);
            } catch {
                /* 桥接未启动时静默 */
            }
        };
        void load();
        const timer = setInterval(() => void load(), 4000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [collapsed, jobId, selectedId]);

    if (collapsed) {
        return (
            <aside className="flex w-11 shrink-0 flex-col items-center border-l border-black/5 py-3 dark:border-white/10">
                <button type="button" onClick={() => setInspectorOpen(true)} className="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-400 hover:bg-black/5 dark:hover:bg-white/10" title="展开检查器">
                    <ChevronLeft className="size-4" />
                </button>
                <Info className="mt-3 size-4 text-slate-400" />
            </aside>
        );
    }

    const meta = (selected?.metadata ?? {}) as Record<string, unknown>;
    const rows: { label: string; value: string }[] = selected
        ? [
              { label: "类型", value: selected.type },
              { label: "标题", value: selected.title || "—" },
              { label: "尺寸", value: `${Math.round(selected.width)} × ${Math.round(selected.height)}` },
              { label: "状态", value: String(meta.status ?? "—") },
              ...(meta.errorDetails ? [{ label: "错误", value: String(meta.errorDetails) }] : []),
              ...(meta.videoCaps ? [{ label: "视频模型", value: String((meta.videoCaps as { model?: { current?: string } }).model?.current ?? "—") }] : []),
              ...(tokenRow(meta)),
              ...(meta.progress ? [{ label: "进度", value: String(meta.progress) }] : []),
          ]
        : [];

    return (
        <aside className="flex w-[268px] shrink-0 flex-col border-l border-black/5 dark:border-white/10">
            <div className="flex h-9 items-center gap-1.5 px-2.5">
                <Info className="size-3.5 text-[#6b57a8] dark:text-[#c4b8ef]" />
                <span className="text-[12px] font-medium">属性 / 日志</span>
                <button type="button" onClick={() => setInspectorOpen(false)} className="ml-auto cursor-pointer rounded p-1 text-slate-400 hover:bg-black/5 dark:hover:bg-white/10" title="收起">
                    <ChevronRight className="size-3" />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 text-[11px]">
                {!selected ? (
                    <p className="py-6 text-center text-slate-400 dark:text-white/30">选中一个节点查看属性</p>
                ) : (
                    <>
                        <div className="space-y-1">
                            {rows.map((row) => (
                                <div key={row.label} className="flex gap-2">
                                    <span className="w-14 shrink-0 text-slate-400 dark:text-white/30">{row.label}</span>
                                    <span className="min-w-0 flex-1 break-all">{row.value}</span>
                                </div>
                            ))}
                        </div>

                        <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium">
                            <ScrollText className="size-3.5" /> 运行日志
                        </div>
                        <div className="mt-1 rounded-lg bg-black/[0.04] p-2 font-mono text-[10px] leading-4 dark:bg-white/[0.04]">
                            {job ? (
                                <>
                                    <div className="text-slate-400 dark:text-white/35">
                                        {job.id} · {job.status}
                                    </div>
                                    {formatRequestedParams(job.requestedParams) ? <div className="break-all text-slate-500 dark:text-white/55">请求参数：{formatRequestedParams(job.requestedParams)}</div> : null}
                                    {formatActualParams(job.actualParams) ? <div className="break-all text-emerald-600/80 dark:text-emerald-400/80">页面读回：{formatActualParams(job.actualParams)}</div> : null}
                                    {job.unsupportedParams?.length ? <div className="break-all text-amber-600 dark:text-amber-400">未提交（网页端无此控件）：{formatUnsupportedParams(job.unsupportedParams)}</div> : null}
                                    {(job.stderr?.length ? job.stderr : [job.progress || "—"]).slice(-8).map((line, index) => (
                                        <div key={index} className="break-all text-slate-500 dark:text-white/50">
                                            {line}
                                        </div>
                                    ))}
                                    {job.error ? <div className="break-all text-red-500">{job.error.reason}: {job.error.message}</div> : null}
                                </>
                            ) : (
                                <span className="text-slate-400 dark:text-white/30">{jobId ? "读取中…" : "该节点暂无豆包任务（点生成后会出现在这里）"}</span>
                            )}
                        </div>
                    </>
                )}
            </div>
        </aside>
    );
}

/** 摘要只列真正与生成有关的字段，避免把整段请求 JSON 塞进日志。 */
function formatRequestedParams(params: Partial<DoubaoRequestedParams> | null | undefined) {
    if (!params) return "";
    const keys = ["model", "ratio", "duration", "count", "resolution", "size", "mode", "attachmentCount"] as const;
    return keys
        .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
        .map((key) => `${key}=${String(params[key])}`)
        .join(" · ");
}

function formatActualParams(params: DoubaoJob["actualParams"]) {
    if (!params) return "";
    return (["model", "ratio", "duration", "resolution"] as const)
        .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
        .map((key) => `${key}=${String(params[key])}${key === "duration" ? "s" : ""}`)
        .join(" · ");
}

function formatUnsupportedParams(items: NonNullable<DoubaoJob["unsupportedParams"]>) {
    return items.map((item) => `${item.key}${item.value !== undefined ? `=${String(item.value)}` : ""}（${item.reason}）`).join("；");
}

/** 有模型/账号等信息就展示，没有就不显示（不编造）。 */
function tokenRow(meta: Record<string, unknown>) {
    const rows: { label: string; value: string }[] = [];
    if (typeof meta.modelName === "string" && meta.modelName) rows.push({ label: "模型", value: meta.modelName });
    if (typeof meta.accountName === "string" && meta.accountName) rows.push({ label: "账号", value: meta.accountName });
    if (typeof meta.submittedParams === "string" && meta.submittedParams) rows.push({ label: "参数", value: meta.submittedParams });
    return rows;
}
