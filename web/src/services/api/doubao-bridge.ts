// 豆包账号池 + 视频生成的本地桥接客户端。
// 所有数据都来自 doubao-bridge（它再调用 doubao-brain 的 dbb CLI），读不到就返回 unknown，不编造。
export const DOUBAO_BRIDGE_URL = import.meta.env.VITE_DOUBAO_BRIDGE_URL || "http://127.0.0.1:9091";

export type DoubaoAccountState = {
    busy: boolean;
    loginRunning: boolean;
    loggedIn: boolean | null;
    checkedAt: string | null;
    models: string[] | null;
    capabilities: string[] | null;
    error: { reason?: string; message?: string } | null;
    /** 上一次因套餐/额度被豆包拒绝的能力（同能力成功一次就清掉） */
    quotaBlock?: { capability?: string; message: string; at?: string } | null;
    /** 每个能力各有一条（一个号可能同时卡住视频和图片） */
    quotaBlocks?: { capability?: string; message: string; at?: string }[];
};

export type DoubaoAccount = {
    id: string;
    name: string;
    /** 账号所属站点：豆包（国内）或 Dola（国际版） */
    provider?: BridgeProvider;
    providerName?: string;
    createdAt: string;
    lastLoginAt: string | null;
    state: DoubaoAccountState;
};

export type DoubaoJobFile = {
    index: number;
    path: string;
    name: string;
    bytes: number | null;
    kind: string;
    contentType: string | null;
};

export type DoubaoJobStatus = "queued" | "running" | "succeeded" | "failed";

export type DoubaoJob = {
    id: string;
    nodeId?: string | null;
    accountId: string;
    accountName: string;
    prompt: string;
    capability: string;
    mode: string;
    status: DoubaoJobStatus;
    createdAt: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    elapsedMs?: number | null;
    progress?: string;
    modelName?: string | null;
    requestedParams?: Record<string, unknown> | null;
    actualParams?: { model: string | null; ratio: string | null; duration: number | null; resolution: string | null; source: string } | null;
    files: DoubaoJobFile[];
    error: { reason?: string; message?: string } | null;
    text?: string;
    stderr?: string[];
    modes?: { model?: string | null; capability?: string | null } | null;
    confirmRounds?: number | null;
};

export type DoubaoModelInfo = {
    current: string | null;
    options: string[];
    capabilities: string[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${DOUBAO_BRIDGE_URL}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers || {}) },
    });
    const text = await response.text();
    let data: unknown = null;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(text || `请求失败（${response.status}）`);
    }
    const record = data as { ok?: boolean; error?: unknown };
    if (!response.ok || record?.ok === false) {
        const error = record?.error;
        const message = typeof error === "string" ? error : (error as { message?: string })?.message || `请求失败（${response.status}）`;
        throw new Error(message);
    }
    return data as T;
}

export async function bridgeHealth() {
    return request<{ ok: boolean; cliExists: boolean; accounts: number; running: number }>("/api/health");
}

/** 豆包账号池的站点：doubao = 国内豆包，dola = 国际版 Dola */
export type BridgeProvider = "doubao" | "dola";

export async function listAccounts(provider?: BridgeProvider) {
    const query = provider ? `?provider=${provider}` : "";
    const data = await request<{ ok: boolean; accounts: DoubaoAccount[] }>(`/api/accounts${query}`);
    return data.accounts;
}

export async function createAccount(name: string, provider: BridgeProvider = "doubao") {
    const data = await request<{ ok: boolean; account: DoubaoAccount }>("/api/accounts", { method: "POST", body: JSON.stringify({ name, provider }) });
    return data.account;
}

export async function deleteAccount(id: string) {
    await request(`/api/accounts/${id}`, { method: "DELETE" });
}

/** 打开真实豆包浏览器等人工扫码；耗时可能到几分钟。 */
export async function loginAccount(id: string) {
    const data = await request<{ ok: boolean; account: DoubaoAccount }>(`/api/accounts/${id}/login`, { method: "POST", body: "{}" });
    return data.account;
}

/** 应用内扫码：助手在后台开真实浏览器，我们只把二维码截图取回来。 */
export async function startQrLogin(id: string) {
    return request<{ ok: boolean; started: boolean; message?: string }>(`/api/accounts/${id}/qr-login`, { method: "POST", body: "{}" });
}

export type DoubaoQrStatus = {
    state: "idle" | "starting" | "waiting" | "logged_in" | "timeout" | "closed" | "cancel" | "canceled" | "error" | "unknown";
    message?: string;
    updatedAt?: string;
    shot?: string;
};

export async function fetchQrStatus(id: string) {
    return request<{ ok: boolean; status: DoubaoQrStatus; loggedIn: boolean | null }>(`/api/accounts/${id}/qr-login/status`);
}

export async function cancelQrLogin(id: string) {
    await request(`/api/accounts/${id}/qr-login/cancel`, { method: "POST", body: "{}" });
}

export function qrImageUrl(id: string, bust: number) {
    return `${DOUBAO_BRIDGE_URL}/api/accounts/${id}/qr-login.png?t=${bust}`;
}

/** 弹窗登录：窗口不会自己关，检测到真实登录态才保存并关闭。 */
export type DoubaoWindowStatus = {
    state: "idle" | "starting" | "waiting" | "saving" | "logged_in" | "timeout" | "closed" | "cancel" | "canceled" | "error" | "unknown";
    message?: string;
    updatedAt?: string;
    cookies?: string[];
};

export async function startWindowLogin(id: string) {
    return request<{ ok: boolean; started: boolean }>(`/api/accounts/${id}/window-login`, { method: "POST", body: "{}" });
}

export async function fetchWindowStatus(id: string) {
    return request<{ ok: boolean; status: DoubaoWindowStatus; loggedIn: boolean | null }>(`/api/accounts/${id}/window-login/status`);
}

export async function cancelWindowLogin(id: string) {
    await request(`/api/accounts/${id}/window-login/cancel`, { method: "POST", body: "{}" });
}

/** 打开（或前置）该账号唯一的豆包窗口；不会重复开窗。 */
export async function openAccountWindow(id: string) {
    return request<{ ok: boolean; reused: boolean; focused?: boolean; port?: number }>(`/api/accounts/${id}/open`, { method: "POST", body: "{}" });
}

export async function closeAccountWindow(id: string) {
    await request(`/api/accounts/${id}/close`, { method: "POST", body: "{}" });
}

export async function fetchAccountWindowStatus(id: string) {
    return request<{ ok: boolean; running: boolean; status: { state?: string; message?: string } }>(`/api/accounts/${id}/open/status`);
}

export async function logoutAccount(id: string) {
    await request(`/api/accounts/${id}/logout`, { method: "POST", body: "{}" });
}

export async function checkAccount(id: string) {
    const data = await request<{ ok: boolean; doctor: { loggedIn: boolean | null; models: string[] | null; capabilities: string[] | null; checkedAt: string } }>(`/api/accounts/${id}/doctor`);
    return data.doctor;
}

/** 读豆包网页端真实可用的模型与能力栏。 */
export async function fetchAccountModels(id: string) {
    const data = await request<{ ok: boolean; current: string | null; options: string[]; capabilities: string[] }>(`/api/accounts/${id}/models`);
    return { current: data.current, options: data.options, capabilities: data.capabilities } satisfies DoubaoModelInfo;
}

/** 豆包「视频生成」面板的真实参数（模型 / 比例 / 时长），只读。 */
export type DoubaoVideoCaps = {
    capability: string;
    model: { current: string | null; options: string[] };
    ratio: { current: string | null; options: string[] };
    duration: { current: number | null; min: number | null; max: number | null };
    readAt: string;
};

export async function fetchVideoCaps(id: string, refresh = false) {
    const data = await request<{ ok: boolean; caps: DoubaoVideoCaps; cached?: boolean }>(`/api/accounts/${id}/video-caps${refresh ? "?refresh=1" : ""}`);
    return data.caps;
}

/** 图片生成面板的真实参数（模型 / 比例）。 */
export type DoubaoImageCaps = {
    capability: string;
    model: { current: string | null; options: string[] };
    ratio: { current: string | null; options: string[] };
    readAt: string;
};

export async function fetchImageCaps(id: string, refresh = false) {
    const data = await request<{ ok: boolean; caps: DoubaoImageCaps; cached?: boolean }>(`/api/accounts/${id}/image-caps${refresh ? "?refresh=1" : ""}`);
    return data.caps;
}

/** 把素材字节上传到账号目录，返回本地路径（真正的 --attach 入参）。 */
export async function uploadAttachment(accountId: string, file: Blob, name: string) {
    const response = await fetch(`${DOUBAO_BRIDGE_URL}/api/uploads?accountId=${encodeURIComponent(accountId)}&name=${encodeURIComponent(name)}`, {
        method: "POST",
        body: file,
    });
    const data = (await response.json()) as { ok?: boolean; path?: string; error?: string };
    if (!response.ok || !data.ok || !data.path) throw new Error(data.error || "素材上传失败");
    return data.path;
}

export async function createVideoJob(input: {
    accountId?: string;
    /** 本次任务走哪个站点（由模型决定）：桥接只会调度同站点的账号 */
    provider?: BridgeProvider;
    accountSelectionMode?: "auto" | "manual" | "round-robin";
    prompt: string;
    attachments?: string[];
    mode?: string;
    capability?: string;
    expectedArtifactKind?: "image" | "video" | "text";
    modelName?: string;
    requestedParams?: Record<string, unknown>;
    nodeId?: string;
}) {
    const data = await request<{ ok: boolean; job: { id: string; status: DoubaoJobStatus } }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ ...input, capability: input.capability || "视频生成" }),
    });
    return data.job;
}

export async function getJob(id: string): Promise<DoubaoJob | null> {
    try {
        const data = await request<{ ok: boolean; job: DoubaoJob }>(`/api/jobs/${id}`);
        return data.job;
    } catch (error) {
        // 桥接重启后极老的任务可能连磁盘产物都没了：这不是错误弹窗，是「查不到」，
        // 交给调用方决定（检查器留空、生成流程重新开始），不要一打开画布就弹「任务不存在」。
        const message = error instanceof Error ? error.message : String(error);
        if (/任务不存在/.test(message) || /file not found/i.test(message)) return null;
        throw error;
    }
}

/** 按画布节点找最近一次任务：结果只回这个节点。 */
export async function findJobForNode(nodeId: string) {
    const data = await request<{ ok: boolean; jobs: DoubaoJob[] }>(`/api/jobs?nodeId=${encodeURIComponent(nodeId)}&limit=5`);
    return data.jobs[0] || null;
}

export async function listJobs(limit = 50) {
    const data = await request<{ ok: boolean; jobs: DoubaoJob[] }>(`/api/jobs?limit=${limit}`);
    return data.jobs;
}

export function jobFileUrl(jobId: string, index: number) {
    return `${DOUBAO_BRIDGE_URL}/api/jobs/${jobId}/files/${index}`;
}

/** 轮询到任务结束（供节点与页面复用）。 */
export async function waitJob(id: string, onProgress?: (job: DoubaoJob) => void, intervalMs = 3000, timeoutMs = 20 * 60 * 1000, signal?: AbortSignal) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const job = await getJob(id);
        // 任务真的没了（连磁盘产物都不在）：明确失败，别让界面一直「生成中」
        if (!job) throw new Error("任务已在桥接重启后失效，请重新生成");
        onProgress?.(job);
        if (job.status === "succeeded" || job.status === "failed") return job;
        if (Date.now() > deadline) throw new Error("等待任务超时");
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}
