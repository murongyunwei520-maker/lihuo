import { useEffect, useRef, useState } from "react";

import type { CanvasNodeContext } from "@/types/canvas-plugin";

// 3D 导演台（xiaozangao/3d-director-desk，MIT）按官方嵌入协议以 iframe 装进节点。
// 协议：子应用发 ready / captures-sent，宿主收截图后直接在画布上生成图片节点。
export const LIHUO_DIRECTOR_TYPE = "lihuo:director";
export const DIRECTOR_DESK_URL = "/director-3d/";

export function directorDeskSrc(nodeId: string) {
    const params = new URLSearchParams({ instanceId: nodeId, theme: "dark" });
    if (typeof window !== "undefined") params.set("hostOrigin", window.location.origin);
    return `${DIRECTOR_DESK_URL}?${params.toString()}`;
}

type DirectorCapture = { dataUrl?: string; fileName?: string };

export function LihuoDirectorContent({ ctx }: { ctx: CanvasNodeContext }) {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    const [saved, setSaved] = useState(0);

    // 接收导演台回传的机位截图，直接变成画布上的图片节点。
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.source !== frameRef.current?.contentWindow) return;
            const message = event.data as { type?: string; payload?: { captures?: DirectorCapture[] } };

            if (message?.type === "storyai:director-desk-ready") {
                setReady(true);
                frameRef.current?.contentWindow?.postMessage({ type: "storyai:director-desk-session", payload: { instanceId: ctx.node.id, theme: "dark" } }, "*");
                return;
            }
            if (message?.type !== "storyai:director-desk-captures-sent") return;

            const captures = (message.payload?.captures || []).filter((capture) => capture.dataUrl?.startsWith("data:image/"));
            if (!captures.length) return;
            ctx.applyOps(
                captures.map((capture, index) => ({
                    type: "add_node" as const,
                    nodeType: "image",
                    title: capture.fileName || "导演台机位",
                    position: { x: ctx.node.position.x + ctx.node.width + 48, y: ctx.node.position.y + index * 250 },
                    width: 320,
                    height: 240,
                    metadata: { content: capture.dataUrl as string, status: "success" as const },
                })),
            );
            setSaved((count) => count + captures.length);
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [ctx]);

    return (
        <div className="relative size-full overflow-hidden bg-[#0b0b12]">
            <iframe
                ref={frameRef}
                src={directorDeskSrc(ctx.node.id)}
                title="3D 导演台"
                className="size-full border-0"
                allow="clipboard-read; clipboard-write; fullscreen"
            />
            {!ready ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0b0b12]/90 text-center text-[11px] leading-5 text-white/45">
                    <span>
                        正在载入导演台…
                        <br />
                        首次打开需要下载 3D 资源
                    </span>
                </div>
            ) : null}
            {saved ? <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-[#6b57a8]/85 px-2 py-0.5 text-[10px] text-white">已生成 {saved} 张机位图</div> : null}
        </div>
    );
}
