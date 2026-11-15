import type { ButtonHTMLAttributes, CSSProperties, PointerEvent, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

type StudioButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "quiet";
    icon?: ReactNode;
};

export function StudioButton({ variant = "secondary", icon, className, children, ...props }: StudioButtonProps) {
    return (
        <button type="button" className={cn("studio-button", `studio-button--${variant}`, className)} {...props}>
            <span className="studio-button__shine" aria-hidden="true" />
            {icon}
            <span>{children}</span>
        </button>
    );
}

type StudioFeatureCardProps = {
    icon: ReactNode;
    title: string;
    description: string;
    onClick: () => void;
    index?: number;
};

export function StudioFeatureCard({ icon, title, description, onClick, index = 0 }: StudioFeatureCardProps) {
    const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        event.currentTarget.style.setProperty("--card-rx", `${(0.5 - y) * 5}deg`);
        event.currentTarget.style.setProperty("--card-ry", `${(x - 0.5) * 6}deg`);
        event.currentTarget.style.setProperty("--card-mx", `${x * 100}%`);
        event.currentTarget.style.setProperty("--card-my", `${y * 100}%`);
    };
    const resetTilt = (event: PointerEvent<HTMLButtonElement>) => {
        event.currentTarget.style.setProperty("--card-rx", "0deg");
        event.currentTarget.style.setProperty("--card-ry", "0deg");
    };

    return (
        <button
            type="button"
            className="studio-feature-card"
            style={{ "--enter-order": index } as CSSProperties}
            onPointerMove={handlePointerMove}
            onPointerLeave={resetTilt}
            onClick={onClick}
        >
            <span className="studio-feature-card__light" aria-hidden="true" />
            <span className="studio-feature-card__icon">{icon}</span>
            <span className="studio-feature-card__title">{title}</span>
            <span className="studio-feature-card__description">{description}</span>
            <ArrowUpRight className="studio-feature-card__arrow" aria-hidden="true" />
        </button>
    );
}
