import type { CanvasNodeData } from "@/types/canvas";

/**
 * 画布生成幂等键（Phase 5 P0-1）。
 *
 * 目标不是「每个节点一个键」，而是「每一次逻辑生成操作一个键」：
 * - 同一节点再次生成（用户主动重新生成）→ 新键，允许创建新任务；
 * - 同一次操作的重试 / 超时恢复 → 复用原键，后端会返回原任务或原结论；
 * - 多节点并发生成 → 键里带节点 ID 与随机段，互不干扰。
 *
 * 键格式受后端约束：8–128 字符，只允许字母、数字与 `. _ : + -`。
 */

export type GenerationKind = "text" | "image" | "video" | "audio";

const rand = () => Math.random().toString(36).slice(2, 8);

/**
 * 生成新的幂等键。
 *
 * 不使用「节点 ID 当键」：同一节点先后两次生成是两个独立业务意图，
 * 共用一个键会让后端把第二次请求当成第一次的重放（返回旧任务 / 参数冲突）。
 */
export function createGenerationKey(kind: GenerationKind, nodeId: string): string {
    const scope = String(nodeId || "node").slice(0, 40);
    return `canvas:${kind}:${scope}:${Date.now().toString(36)}:${rand()}`;
}

/**
 * 读取节点上记录的幂等键（由创建该节点的那次生成写入）。
 * 重试路径优先复用它；没有则说明是旧数据，调用方应生成新键。
 *
 * `slotId` 用于批量节点：同一个图片 / 文本节点里有多张卡片，
 * 每张卡片是独立的生成请求，必须各自持有自己的键。
 */
export function generationKeyOf(node: CanvasNodeData | undefined | null, slotId?: string): string | undefined {
    const metadata = node?.metadata;
    if (!metadata) return undefined;
    if (slotId) {
        const slotKeys = metadata.generationKeys;
        const scoped = slotKeys && typeof slotKeys === "object" ? (slotKeys as Record<string, unknown>)[slotId] : undefined;
        if (typeof scoped === "string" && scoped.length >= 8) return scoped;
    }
    const key = metadata.generationKey;
    return typeof key === "string" && key.length >= 8 ? key : undefined;
}

/**
 * 把本次请求的键写进节目标识（不覆盖其它槽位）。
 * 只保存键本身，不含提示词或任何用户内容。
 */
export function attachGenerationKey(
    metadata: CanvasNodeData["metadata"] | undefined,
    input: { key: string; slotId?: string },
): NonNullable<CanvasNodeData["metadata"]> {
    const base = { ...(metadata || {}) };
    if (!input.slotId) return { ...base, generationKey: input.key };
    const existing = base.generationKeys && typeof base.generationKeys === "object" ? (base.generationKeys as Record<string, unknown>) : {};
    return { ...base, generationKeys: { ...existing, [input.slotId]: input.key } };
}
