import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import AccountPage from "@/pages/account";
import AdminLayout from "@/layouts/admin-layout";
import UserLayout from "@/layouts/user-layout";
import AdminLogsPage from "@/pages/admin/logs";
import AdminModelsPage from "@/pages/admin/models";
import AdminChannelsPage from "@/pages/admin/channels";
import AdminPointsPage from "@/pages/admin/points";
import AdminProviderGovernancePage from "@/pages/admin/provider-governance";
import AdminUsageReviewsPage from "@/pages/admin/usage-reviews";
import AdminQuotasPage from "@/pages/admin/quotas";
import AdminOverviewPage from "@/pages/admin/overview";
import AdminSettingsPage from "@/pages/admin/settings";
import AdminUsersPage from "@/pages/admin/users";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import PointsPage from "@/pages/points";
import ForgotPasswordPage from "@/pages/forgot-password";
import DirectorPage from "@/pages/director";
import DoubaoAccountPage from "@/pages/doubao";
import DramaPage from "@/pages/drama";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";
import VerifyEmailPage from "@/pages/verify-email";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import ServerCheckPage from "@/pages/server-check";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/director", element: <DirectorPage /> },
            { path: "/doubao", element: <DoubaoAccountPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/drama", element: <DramaPage /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/account", element: <AccountPage /> },
            { path: "/points", element: <PointsPage /> },
            { path: "/server-check", element: <ServerCheckPage /> },
            { path: "/keys", element: <Navigate to="/config" replace /> },
        ],
    },
    // 管理后台：独立 Router 分支与 Layout，不套 UserLayout（admin-console.md 第 1 节）
    {
        path: "/admin",
        element: <AdminLayout />,
        children: [
            { index: true, element: <AdminOverviewPage /> },
            { path: "channels", element: <AdminChannelsPage /> },
            { path: "provider-governance", element: <AdminProviderGovernancePage /> },
            { path: "usage-reviews", element: <AdminUsageReviewsPage /> },
            { path: "models", element: <AdminModelsPage /> },
            { path: "users", element: <AdminUsersPage /> },
            { path: "points", element: <AdminPointsPage /> },
            { path: "quotas", element: <AdminQuotasPage /> },
            { path: "logs", element: <AdminLogsPage /> },
            { path: "settings", element: <AdminSettingsPage /> },
        ],
    },
    { path: "/login", element: <LoginPage /> },
    { path: "/forgot-password", element: <ForgotPasswordPage /> },
    { path: "/reset-password", element: <ResetPasswordPage /> },
    { path: "/verify-email", element: <VerifyEmailPage /> },
    { path: "*", element: <NotFound /> },
], {
    // GitHub Pages 部署在 /<repo>/ 子路径，浏览器路由必须使用同一 basename；
    // 本地与同域部署的 BASE_URL 为 /，去掉末尾斜杠后回退到根路径。
    basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
});
