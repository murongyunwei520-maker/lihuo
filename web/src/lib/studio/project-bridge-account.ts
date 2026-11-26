import { builtinProviderName, builtinProviderOf, type BuiltinProvider } from "@/constants/doubao-builtin";
import type { DoubaoAccount } from "@/services/api/doubao-bridge";

// 阶段 2A 的项目级账号隔离：内置豆包/Dola 只允许使用项目明确选择的账号。
// 这里是纯函数，服务入口和设置页共用同一套判定，避免只在 UI 做禁用。
export type ProjectBridgeAccountCheck =
    | {
          ok: true;
          accountId: string;
          provider: BuiltinProvider;
          account: DoubaoAccount;
          quota: "unknown";
          warnings: string[];
      }
    | {
          ok: false;
          accountId: string;
          provider: BuiltinProvider | null;
          error: string;
          warnings: string[];
      };

function textQuotaBlock(account: DoubaoAccount) {
    const blocks = account.state.quotaBlocks?.length ? account.state.quotaBlocks : account.state.quotaBlock ? [account.state.quotaBlock] : [];
    return blocks.find((item) => !item.capability || /对话|文本|text|chat/i.test(item.capability));
}

export function validateProjectBridgeAccount(
    modelId: string | undefined | null,
    projectAccountId: string | number | boolean | null | undefined,
    accounts: readonly DoubaoAccount[],
): ProjectBridgeAccountCheck {
    const provider = builtinProviderOf(modelId);
    const accountId = String(projectAccountId ?? "").trim();
    const warnings = ["桥接未提供可读的剩余额度，项目账号额度状态：未知。"];
    if (!provider) {
        return { ok: false, accountId, provider: null, error: "当前模型不是内置豆包/Dola 模型", warnings };
    }
    if (!accountId) {
        return {
            ok: false,
            accountId,
            provider,
            error: `本项目尚未选择${builtinProviderName(provider)}账号；不会继承全局账号池账号，请先在项目设置中选择。`,
            warnings,
        };
    }
    const account = accounts.find((item) => item.id === accountId);
    if (!account) {
        return {
            ok: false,
            accountId,
            provider,
            error: `项目选择的账号 ${accountId} 不在${builtinProviderName(provider)}账号列表中，可能已删除或不可用。`,
            warnings,
        };
    }
    if (account.provider !== provider) {
        return {
            ok: false,
            accountId,
            provider,
            error: `项目账号 ${account.name} 属于${builtinProviderName(account.provider)}，与当前模型要求的${builtinProviderName(provider)}不一致。`,
            warnings,
        };
    }
    if (account.state.loggedIn !== true) {
        const reason = account.state.error?.message || account.state.error?.reason || "尚未确认登录";
        return {
            ok: false,
            accountId,
            provider,
            error: `项目账号 ${account.name} 未登录或登录状态异常（${reason}），请先到全局账号池扫码登录。`,
            warnings,
        };
    }
    if (account.state.error) {
        return {
            ok: false,
            accountId,
            provider,
            error: `项目账号 ${account.name} 状态异常：${account.state.error.message || account.state.error.reason || "未知错误"}。`,
            warnings,
        };
    }
    const quotaBlock = textQuotaBlock(account);
    if (quotaBlock) {
        return {
            ok: false,
            accountId,
            provider,
            error: `项目账号 ${account.name} 的对话额度已被平台拒绝：${quotaBlock.message || "额度不足"}；不会自动切换到其他账号。`,
            warnings,
        };
    }
    return { ok: true, accountId, provider, account, quota: "unknown", warnings };
}

/** 在任何请求发出前，把全局账号从配置副本中清掉，只写入项目显式选择的账号。 */
export function applyProjectBridgeAccount<T extends { doubaoAccountId?: string }>(config: T, check: ProjectBridgeAccountCheck): T {
    if (!check.ok) throw new Error(check.error);
    const next = { ...config };
    delete next.doubaoAccountId;
    next.doubaoAccountId = check.accountId;
    return next;
}
