import { getMediaBlob } from "@/services/file-storage";
import type { StudioProject } from "@/types/studio";

// 导出只读取已保存的素材 Blob 与项目 JSON，不改动任何数据；不引入 ZIP 依赖。

function safeName(value: string, fallback: string) {
    const clean = value.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
    return clean || fallback;
}

function extensionFor(blob: Blob, storageKey: string, kind: "image" | "video" | "audio") {
    const type = blob.type.toLowerCase();
    if (type.includes("mp4")) return "mp4";
    if (type.includes("webm")) return "webm";
    if (type.includes("quicktime")) return "mov";
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    if (type.includes("gif")) return "gif";
    if (type.includes("wav")) return "wav";
    if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
    if (type.includes("ogg")) return "ogg";
    if (type.includes("m4a")) return "m4a";
    const suffix = storageKey.match(/\.([a-z0-9]{2,5})(?:$|\?)/i)?.[1];
    if (suffix) return suffix.toLowerCase();
    return kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3";
}

function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** 下载一个正式版/候选版素材；素材文件不存在时抛错，由页面提示。 */
export async function downloadStudioMedia(storageKey: string | undefined, baseName: string, kind: "image" | "video" | "audio") {
    if (!storageKey) throw new Error("还没有可导出的素材");
    const blob = await getMediaBlob(storageKey);
    if (!blob) throw new Error("素材文件不存在，可能已被清理或只存在于旧浏览器缓存");
    triggerDownload(blob, `${safeName(baseName, "studio-media")}.${extensionFor(blob, storageKey, kind)}`);
}

/** 导出文本（剧本/大纲）为 Markdown 或纯文本文件。 */
export function downloadStudioText(text: string, baseName: string, extension: "md" | "txt" = "md") {
    if (!text.trim()) throw new Error("当前内容为空，没有可导出的文本");
    const type = extension === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";
    triggerDownload(new Blob([text], { type }), `${safeName(baseName, "studio-text")}.${extension}`);
}

/** 导出项目 JSON：包含剧本、分镜、资产、版本元数据与素材 storageKey，不内嵌大文件。 */
export function exportStudioProject(project: StudioProject) {
    const payload = {
        format: "lihuo-studio-project",
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        note: "素材文件未内嵌；storageKey 指向本机素材库，媒体请通过各工作区的下载按钮单独导出。",
        project,
    };
    triggerDownload(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `${safeName(project.title, "studio-project")}.json`);
}
