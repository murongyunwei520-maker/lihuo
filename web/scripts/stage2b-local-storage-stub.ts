// 2B 确定性测试运行在 Node，不加载浏览器存储；这里只提供 i18n 初始化所需的 localStorage 垫片。
const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() { return store.size; },
    },
});
