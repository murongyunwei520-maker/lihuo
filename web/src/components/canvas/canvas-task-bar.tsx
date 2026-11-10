import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ListChecks } from "lucide-react";

import { listJobs, type DoubaoJob } from "@/services/api/doubao-bridge";

const STATUS_STYLE: Record<string, string> = {
    succeeded: "text-emerald-500",
    failed: "text-red-500",
    running: "text-amber-500",
    queued: "text-slate-400",
};

// 底部任务栏：所有豆包生成任务的统一队列与结果。
export function CanvasTaskBar() {
    const [open, setOpen] = useState(true);
    const [jobs, setJobs] = useState<DoubaoJob[]>([]);
    const [error, setError] = useState("");

    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const next = await listJobs(10);
                if (alive) {
                    setJobs(next);
                    setError("");
                }
            } catch {
                if (alive) setError("桥接未运行");
            }
        };
        void load();
        const timer = window.setInterval(() => void load(), 5000);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, []);

    const running = jobs.filter((job) => job.status === "running" || job.status === "queued").length;

    return (
        <section className="shrink-0 border-t border-black/5 dark:border-white/10">
            <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-[11px]">
                <ListChecks className="size-3.5 text-[#6b57a8] dark:text-[#c4b8ef]" />
                <span className="font-medium">任务队列</span>
                <span className="text-slate-400 dark:text-white/30">{jobs.length} 条{running ? ` · ${running} 进行中` : ""}</span>
                {error ? <span className="text-red-500">{error}</span> : null}
                {open ? <ChevronDown className="ml-auto size-3.5 text-slate-400" /> : <ChevronUp className="ml-auto size-3.5 text-slate-400" />}
            </button>
            {open ? (
                <div className="max-h-[132px] space-y-0.5 overflow-y-auto px-2 pb-1.5">
                    {!jobs.length ? <p className="py-2 text-center text-[11px] text-slate-400 dark:text-white/30">还没有任务</p> : null}
                    {jobs.map((job) => (
                        <div key={job.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                            <span className={`w-14 shrink-0 font-medium ${STATUS_STYLE[job.status] || ""}`}>{job.status}</span>
                            <span className="w-20 shrink-0 truncate text-slate-500 dark:text-white/45">{job.accountName}</span>
                            <span className="min-w-0 flex-1 truncate">{job.prompt}</span>
                            <span className="w-24 shrink-0 truncate text-right text-slate-400 dark:text-white/30">{job.progress || (job.files.length ? `${job.files.length} 个文件` : "—")}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </section>
    );
}
