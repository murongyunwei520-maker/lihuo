import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import DirectorPage from "@/pages/director";
import DoubaoAccountPage from "@/pages/doubao";
import DramaPage from "@/pages/drama";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
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
            { path: "/server-check", element: <ServerCheckPage /> },
        ],
    },
    // 管理后台入口：独立分支，不套 UserLayout（admin-console.md 第 1 节）
    { path: "/login", element: <LoginPage /> },
    { path: "*", element: <NotFound /> },
]);
