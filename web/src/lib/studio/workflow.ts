import { nanoid } from "nanoid";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useStudioStore } from "@/stores/use-studio-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { StudioEpisode, StudioProject } from "@/types/studio";

// Studio → Workflow：把项目/集/镜头作为节点种子写进现有无限画布，不复制第二套画布系统。
// 结果由画布里的 lihuo:drama-shot 节点回写为候选版本，正式版仍由用户确认。

const DRAMA_NODE = "lihuo:drama";
const SHOT_NODE = "lihuo:drama-shot";

export function openStudioWorkflow(project: StudioProject, episode: StudioEpisode, shotIds: string[] = []): string {
    const canvasStore = useCanvasStore.getState();
    let canvasProjectId = episode.workflowProjectId;
    let existing = canvasProjectId ? canvasStore.projects.find((item) => item.id === canvasProjectId) : null;
    if (!existing) {
        canvasProjectId = canvasStore.createProject(`${project.title} · ${episode.title} · Workflow`);
        existing = useCanvasStore.getState().projects.find((item) => item.id === canvasProjectId) ?? null;
    }
    if (!canvasProjectId) return "";

    const currentNodes = existing?.nodes ?? [];
    const currentConnections = existing?.connections ?? [];
    const nodes: CanvasNodeData[] = [...currentNodes];
    const connections: CanvasConnection[] = [...currentConnections];
    const drama = nodes.find((node) => node.type === DRAMA_NODE && node.metadata?.projectId === project.id && node.metadata?.episodeId === episode.id);
    let dramaNodeId = drama?.id ?? "";
    if (!drama) {
        dramaNodeId = `node-${nanoid(10)}`;
        nodes.push({
            id: dramaNodeId,
            type: DRAMA_NODE,
            title: episode.title,
            position: { x: 80, y: 120 },
            width: 380,
            height: 560,
            metadata: { projectId: project.id, episodeId: episode.id, status: "idle" },
        });
    }

    const selected = episode.shots.filter((shot) => !shotIds.length || shotIds.includes(shot.id));
    selected.forEach((shot, index) => {
        const existingNode = nodes.find((node) => node.type === SHOT_NODE && node.metadata?.shotId === shot.id);
        if (existingNode) {
            useStudioStore.getState().updateShot(project.id, episode.id, shot.id, { workflowNodeId: existingNode.id });
            return;
        }
        const nodeId = `node-${nanoid(10)}`;
        nodes.push({
            id: nodeId,
            type: SHOT_NODE,
            title: `镜 ${shot.no}`,
            position: { x: 540 + (index % 3) * 380, y: 100 + Math.floor(index / 3) * 560 },
            width: 340,
            height: 480,
            metadata: {
                projectId: project.id,
                episodeId: episode.id,
                shotId: shot.id,
                shotNo: shot.no,
                prompt: shot.imagePrompt ?? "",
                status: "idle",
            },
        });
        if (dramaNodeId) connections.push({ id: `conn-${nanoid(8)}`, fromNodeId: dramaNodeId, toNodeId: nodeId });
        useStudioStore.getState().updateShot(project.id, episode.id, shot.id, { workflowNodeId: nodeId });
    });

    useCanvasStore.getState().updateProject(canvasProjectId, { nodes, connections });
    if (episode.workflowProjectId !== canvasProjectId) useStudioStore.getState().updateEpisode(project.id, episode.id, { workflowProjectId: canvasProjectId });
    return canvasProjectId;
}

export function studioWorkflowPath(canvasProjectId: string) {
    return `/canvas/${canvasProjectId}`;
}
