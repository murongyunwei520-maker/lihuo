// 离火的品牌与全局标识配置中心。
// 换品牌、换仓库、换本地存储命名空间都只改这一个文件。
export const APP_BRAND = {
    name: "离火",
    nameEn: "Lihuo",
    tagline: "以火为笔，炼万象",
    description: "面向 AI 创作的无限画布工作台",
    slug: "lihuo",
    // 浏览器本地存储命名空间：画布、素材、生成记录和配置都挂在这个前缀下。
    namespace: "lihuo",
    // 你自己的源码仓库地址。留空时关闭「版本更新」的远程检查，只展示本地 CHANGELOG。
    repoUrl: "" as string,
    // 上游开源项目，用于保留出处与授权说明。
    upstreamUrl: "https://github.com/basketikun/infinite-canvas",
    license: "MIT",
} as const;

export const STORAGE_NAMESPACE = APP_BRAND.namespace;

// 生成带命名空间的本地存储键，避免和别的站点、别的版本串数据。
export function storageKey(key: string) {
    return `${STORAGE_NAMESPACE}:${key}`;
}
