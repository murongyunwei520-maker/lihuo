import { ExternalLink, Film, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

// 导演台是本机安装的独立开源应用（DirectorDesk，MIT），这里用 iframe 把它嵌进离火。
// 构建产物放在 web/public/director-app/，用独立路径避免和 /director 的 SPA 路由冲突。
const DIRECTOR_URL = "/director-app/";

export default function DirectorPage() {
    const { t } = useTranslation();
    const [state, setState] = useState<"checking" | "ready" | "missing">("checking");
    const [reloadKey, setReloadKey] = useState(0);

    // 先探测产物是否存在，缺失时给出安装提示，而不是显示一个白框。
    useEffect(() => {
        let alive = true;
        fetch(`${DIRECTOR_URL}index.html`, { method: "HEAD" })
            .then((response) => {
                if (alive) setState(response.ok ? "ready" : "missing");
            })
            .catch(() => {
                if (alive) setState("missing");
            });
        return () => {
            alive = false;
        };
    }, []);

    return (
        <main className="flex h-full flex-col bg-[#f6f4fa] text-slate-950 dark:bg-[#0a0810] dark:text-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 px-4 py-2.5 dark:border-white/[0.08]">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#6b57a8]/12 text-[#6b57a8] dark:bg-[#b9ace8]/15 dark:text-[#c4b8ef]">
                    <Film className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t("director.title")}</p>
                    <p className="truncate text-[11px] text-slate-500 dark:text-white/40">{t("director.subtitle")}</p>
                </div>
                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => setReloadKey((key) => key + 1)}>
                    {t("director.reload")}
                </Button>
                <Button size="small" icon={<ExternalLink className="size-3.5" />} href={DIRECTOR_URL} target="_blank" rel="noreferrer">
                    {t("director.openNew")}
                </Button>
            </div>

            {state === "ready" ? (
                <iframe key={reloadKey} src={DIRECTOR_URL} title={t("director.title")} className="min-h-0 w-full flex-1 border-0 bg-black" allow="clipboard-read; clipboard-write; fullscreen" />
            ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                    <div className="max-w-xl text-center">
                        <Film className="mx-auto size-8 text-[#6b57a8] dark:text-[#b9ace8]" />
                        <h2 className="mt-4 text-lg font-semibold">{state === "checking" ? t("director.checking") : t("director.missingTitle")}</h2>
                        {state === "missing" ? (
                            <>
                                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-white/45">{t("director.missingDesc")}</p>
                                <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950/90 p-4 text-left font-mono text-[11px] leading-6 text-slate-200">node scripts/install-director.cjs</pre>
                            </>
                        ) : null}
                    </div>
                </div>
            )}
        </main>
    );
}
