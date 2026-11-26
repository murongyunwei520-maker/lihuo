import { APP_BRAND, STORAGE_NAMESPACE } from "@/constant/app";
import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { useConfigStore, withoutCredentials, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: typeof STORAGE_NAMESPACE;
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    // 导出的配置备份不含 API Key / WebDAV 密码；导入旧备份时凭证只回到内存，不会重新落盘
    const data: AppConfigFile = { app: STORAGE_NAMESPACE, version: 1, exportedAt: new Date().toISOString(), config: withoutCredentials(config), webdav: { ...webdav, password: "" }, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), `${APP_BRAND.slug}-config.json`);
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== STORAGE_NAMESPACE || data.version !== 1 || !data.config || !data.webdav || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    // 配置文件可能来自别人：不接受其中的 API Key / WebDAV 密码，避免把未知凭证带进当前会话。
    useConfigStore.setState({ config: withoutCredentials(data.config), webdav: { ...data.webdav, password: "" } });
    usePromptSourceStore.setState(data.promptSources);
}
