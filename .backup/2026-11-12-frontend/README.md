# 前端改造备份（2026-11-12）

改造前基线：commit `1b7be31`（分支 `chore/integrate-cleanup`）

- `router.tsx` —— 新增任何路由之前（不含 `/server-check`、`/login`，**也不含并行会话后加的 `/drama`**）

---

## ⚠️ 重要：不要整体覆盖 router.tsx

这份基线里没有 `/drama`（另一个会话在改造期间加的）。
直接 `cp` 覆盖会**丢掉 `/drama` 两行**。若要回退到基线，覆盖后必须手工补回：

```tsx
import DramaPage from "@/pages/drama";
// 以及 children 中：
{ path: "/drama", element: <DramaPage /> },
```

推荐改用「按行删除」而不是整文件覆盖。

---

## 分步回滚

### 撤销第二步（明色定稿 + 登录页，见 14-FRONTEND-STEP2.md）

```bash
rm -rf web/src/pages/login
# 再从 router.tsx 删掉两行：
#   import LoginPage from "@/pages/login";
#   { path: "/login", element: <LoginPage /> },
```

明色改版只发生在 `Desktop\new\lihuo-admin\` 与 `Desktop\new\docs\`，
不在本仓库内，无需回滚。

### 撤销第一步（后端联调页，见 13-FRONTEND-STEP1.md）

```bash
rm -rf web/src/pages/server-check web/src/services/api/lihuo-server.ts
# 从 router.tsx 删掉两行：
#   import ServerCheckPage from "@/pages/server-check";
#   { path: "/server-check", element: <ServerCheckPage /> },
```

### 回到完整基线（会丢 /drama，慎用）

```bash
cp .backup/2026-11-12-frontend/router.tsx web/src/router.tsx
rm -rf web/src/pages/server-check web/src/pages/login web/src/services/api/lihuo-server.ts
# 然后按上面的说明补回 /drama
```

---

## 改造纪律

所有前端改动均为「新增文件 + router.tsx 加行」，
**不修改画布、不改 `image.ts`、不改 `use-config-store.ts`**。
`server/` 是独立新增目录，删除即回滚，不影响 web 与运行中的 New-API 容器。
