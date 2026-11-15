import { Clapperboard, ExternalLink, Film, LayoutGrid, Palette, Sparkles, StickyNote, Wand2 } from "lucide-react";

import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

import { PromptLabContent, PromptLabPanel, promptResource, LIHUO_PROMPT_TYPE } from "./prompt-lab";
import { directorDeskSrc, LihuoDirectorContent, LIHUO_DIRECTOR_TYPE } from "./director-node";
import { nextNoteColor, noteResource, LihuoNoteContent, LIHUO_NOTE_DEFAULT_COLOR, LIHUO_NOTE_TYPE } from "./lihuo-note";
import { LihuoDramaContent, LihuoDramaPanel, LIHUO_DRAMA_TYPE } from "./drama-node";
import { DramaShotContent, DramaShotPanel, generateShotImage, LIHUO_DRAMA_SHOT_TYPE } from "./drama-shot";

// 自研节点统一挂在 lihuo 命名空间下：节点类型写作 "lihuo:<name>"，插件私有存储也按这个 id 隔离。
export const LIHUO_NODE_PLUGIN_ID = "lihuo";

const iconClass = "size-4";

// 新增自研节点只需要往这个数组里加一项，创建菜单、小地图、下游资源引用都会自动生效。
// 注意：豆包不在这里注册专属节点——豆包模型已并入「生图 / 视频」卡片的统一模型下拉（见 constants/doubao-builtin.ts）。
export const LIHUO_NODE_DEFINITIONS: CanvasNodeDefinition[] = [
    {
        type: LIHUO_NOTE_TYPE,
        title: "朱笺",
        icon: <StickyNote className={iconClass} />,
        description: "双击编辑的彩色便签",
        defaultSize: { width: 280, height: 200 },
        defaultMetadata: { content: "", noteColor: LIHUO_NOTE_DEFAULT_COLOR },
        minimapColor: "#f59e0b",
        // 纯记事节点不需要下方生成面板。
        hidePanel: true,
        resource: noteResource,
        toolbar: (ctx) => [
            {
                id: "lihuo-note-color",
                title: "切换便签颜色",
                label: "换色",
                icon: <Palette className={iconClass} />,
                onClick: () => ctx.updateMetadata({ noteColor: nextNoteColor(ctx.node) }),
            },
        ],
        Content: LihuoNoteContent,
    },
    {
        type: LIHUO_PROMPT_TYPE,
        title: "提示词工坊",
        icon: <Sparkles className={iconClass} />,
        description: "把想法改写成可直接使用的提示词",
        defaultSize: { width: 340, height: 220 },
        defaultMetadata: { content: "", prompt: "" },
        minimapColor: "#818cf8",
        // 新建后自动展开工坊面板，点击节点可再次展开。
        autoOpenPanel: true,
        resource: promptResource,
        toolbar: (ctx) => [
            {
                id: "lihuo-prompt-open",
                title: "打开提示词工坊",
                label: "工坊",
                icon: <Wand2 className={iconClass} />,
                onClick: ctx.openPanel,
            },
        ],
        Content: PromptLabContent,
        Panel: PromptLabPanel,
    },
    {
        type: LIHUO_DIRECTOR_TYPE,
        title: "导演台",
        icon: <Film className={iconClass} />,
        description: "3D 白模调度与机位预演，截图可直接落到画布",
        defaultSize: { width: 760, height: 520 },
        // content 只用来启用「移动 / 交互」开关；默认不可交互，避免 iframe 吞掉节点拖动。
        defaultMetadata: { content: "director", status: "idle" },
        minimapColor: "#9b8ad0",
        hidePanel: true,
        interactionToggle: true,
        toolbar: (ctx) => [
            {
                id: "lihuo-director-open",
                title: "在新窗口打开导演台",
                label: "打开",
                icon: <ExternalLink className={iconClass} />,
                onClick: () => window.open(directorDeskSrc(ctx.node.id), "_blank", "noopener,noreferrer"),
            },
        ],
        Content: LihuoDirectorContent,
    },
    {
        type: LIHUO_DRAMA_TYPE,
        title: "短剧工作室",
        icon: <Clapperboard className={iconClass} />,
        description: "把一集分镜投影成画布节点，逐镜生成画面",
        defaultSize: { width: 380, height: 200 },
        defaultMetadata: { sequenceId: "", status: "idle" },
        minimapColor: "#8b7ac9",
        // 新建后直接展开面板，省掉「再点一次节点选序列」这一步。
        autoOpenPanel: true,
        toolbar: (ctx) => [
            {
                id: "lihuo-drama-project",
                title: "打开投影面板",
                label: "投影",
                icon: <LayoutGrid className={iconClass} />,
                onClick: ctx.openPanel,
            },
        ],
        Content: LihuoDramaContent,
        Panel: LihuoDramaPanel,
    },
    {
        type: LIHUO_DRAMA_SHOT_TYPE,
        title: "短剧镜头",
        icon: <Film className={iconClass} />,
        description: "单镜画面卡，按镜头参数直接生成画面",
        defaultSize: { width: 200, height: 300 },
        defaultMetadata: { sequenceId: "", shotId: "", status: "idle" },
        minimapColor: "#6b57a8",
        toolbar: (ctx) => [
            {
                id: "lihuo-drama-shot-generate",
                title: "生成这一镜的画面",
                label: ctx.node.metadata?.status === "loading" ? "生成中" : "生成画面",
                icon: <Wand2 className={iconClass} />,
                onClick: () => void generateShotImage(ctx),
            },
        ],
        Content: DramaShotContent,
        Panel: DramaShotPanel,
    },
];

let registered = false;

// 在画布入口调用一次即可；自研节点和内置节点共用同一个注册表。
export function registerLihuoNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(LIHUO_NODE_DEFINITIONS, LIHUO_NODE_PLUGIN_ID);
}
