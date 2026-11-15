import { useRef } from "react";
import { ArrowRight, Bot, Clapperboard, ImagePlus, Maximize2, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { StudioCharacter, StudioForeground } from "@/components/studio/studio-backdrop";
import { StudioButton, StudioFeatureCard } from "@/components/studio/studio-controls";
import { APP_BRAND } from "@/constant/app";
import { useAgentStore } from "@/stores/use-agent-store";

import "./home.css";

const FEATURES = [
    { title: "AI 画布", description: "无限节点编排创作链路", icon: Maximize2, path: "/canvas" },
    { title: "AI Agent", description: "对话驱动画布与生成任务", icon: Bot },
    { title: "生图工坊", description: "文生图、参考图与批量对比", icon: ImagePlus, path: "/image" },
    { title: "视频工坊", description: "首尾帧与全能参考出片", icon: Video, path: "/video" },
    { title: "短剧工坊", description: "剧本、分镜、配音与成片", icon: Clapperboard, path: "/drama" },
];

export default function IndexPage() {
    const navigate = useNavigate();
    const toggleAgent = useAgentStore((state) => state.togglePanel);
    const featuresRef = useRef<HTMLElement>(null);

    return (
        <main className="home-page">
            <StudioCharacter />
            <section className="home-hero" aria-label="lihuo 创作首页">
                <span className="home-hero__brand lihuo-signature">{APP_BRAND.nameEn}</span>
                <h1>点燃你的创造力</h1>
                <p>一站式 AI 创作平台，开启无限可能。</p>
                <div className="home-hero__actions">
                    <StudioButton variant="primary" icon={<ArrowRight />} onClick={() => navigate("/canvas?mode=new")}>开始创作</StudioButton>
                    <StudioButton onClick={() => featuresRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })}>探索功能</StudioButton>
                </div>
            </section>

            <section className="home-features" ref={featuresRef} aria-label="五大创作功能">
                <div className="home-feature-grid">
                    {FEATURES.map((feature, index) => {
                        const Icon = feature.icon;
                        return <StudioFeatureCard key={feature.title} icon={<Icon />} title={feature.title} description={feature.description} index={index} onClick={feature.path ? () => navigate(feature.path) : toggleAgent} />;
                    })}
                </div>
            </section>
            <StudioForeground />
        </main>
    );
}
