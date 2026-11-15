import { useEffect, useRef, type CSSProperties } from "react";

const farParticles = Array.from({ length: 22 }, (_, index) => ({
    left: `${(index * 37 + 11) % 100}%`,
    top: `${(index * 53 + 7) % 88}%`,
    size: 2 + (index % 4),
    delay: -(index % 9) * 2.6,
    duration: 18 + (index % 6) * 3,
}));

const foregroundPetals = Array.from({ length: 9 }, (_, index) => ({
    left: `${(index * 23 + 8) % 100}%`,
    top: `${(index * 31 + 12) % 76}%`,
    size: 5 + (index % 3) * 3,
    delay: -(index % 6) * 4,
    duration: 22 + (index % 4) * 4,
}));

export function StudioBackdrop({ animated = true }: { animated?: boolean }) {
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const root = rootRef.current;
        const shell = root?.closest(".studio-shell");
        if (!root || !shell || !animated || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        let frame = 0;
        const handlePointer = (event: PointerEvent) => {
            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const x = event.clientX / window.innerWidth - 0.5;
                const y = event.clientY / window.innerHeight - 0.5;
                (shell as HTMLElement).style.setProperty("--studio-pointer-x", x.toFixed(4));
                (shell as HTMLElement).style.setProperty("--studio-pointer-y", y.toFixed(4));
            });
        };
        window.addEventListener("pointermove", handlePointer, { passive: true });
        return () => {
            window.removeEventListener("pointermove", handlePointer);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [animated]);

    return (
        <div ref={rootRef} className={animated ? "studio-backdrop" : "studio-backdrop is-paused"} aria-hidden="true">
            <div className="studio-backdrop__base" />
            <img className="studio-backdrop__image" src="/studio/backgrounds/lihuo-fantasy-bg.webp" alt="" draggable={false} />
            <div className="studio-backdrop__veil" />
            <div className="studio-backdrop__clouds" />
            <div className="studio-backdrop__particles">
                {farParticles.map((particle, index) => (
                    <i
                        key={index}
                        style={{
                            left: particle.left,
                            top: particle.top,
                            width: particle.size,
                            height: particle.size,
                            animationDelay: `${particle.delay}s`,
                            animationDuration: `${particle.duration}s`,
                        }}
                    />
                ))}
            </div>
            <div className="studio-backdrop__halo studio-backdrop__halo--violet" />
            <div className="studio-backdrop__halo studio-backdrop__halo--blue" />
            <div className="studio-backdrop__ribbon studio-backdrop__ribbon--one" />
            <div className="studio-backdrop__ribbon studio-backdrop__ribbon--two" />
        </div>
    );
}

export function StudioCharacter() {
    return (
        <div className="studio-character" aria-hidden="true">
            <div className="studio-character__aura" />
            <img src="/studio/characters/lihuo-character.webp" alt="" draggable={false} />
            <div className="studio-character__mist" />
        </div>
    );
}

export function StudioForeground() {
    return (
        <div className="studio-foreground" aria-hidden="true">
            {foregroundPetals.map((petal, index) => (
                <i
                    key={index}
                    style={{
                        left: petal.left,
                        top: petal.top,
                        width: petal.size,
                        height: petal.size * 0.62,
                        animationDelay: `${petal.delay}s`,
                        animationDuration: `${petal.duration}s`,
                        "--petal-rotation": `${index * 37}deg`,
                    } as CSSProperties}
                />
            ))}
        </div>
    );
}
