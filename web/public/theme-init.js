/**
 * 主题初始化：必须在首屏渲染前执行，避免深色/浅色切换闪烁。
 * 独立成文件而不是内联脚本，便于 CSP 使用 script-src 'self'（无需 unsafe-inline）。
 */
try {
    var s = JSON.parse(localStorage.getItem("lihuo:theme_store") || "{}");
    var t = s.state && s.state.theme === "light" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
} catch (e) {}
