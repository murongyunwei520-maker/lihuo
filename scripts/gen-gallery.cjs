// 生成灵感图鉴用的本地作品图（SVG，零网络依赖，随包发布）。
// 风格：墨底 + 火焰/云纹/回纹/朱雀/朱印，朱红与暖金作点缀，带纸纹噪点。
const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "..", "web", "public", "gallery");
fs.mkdirSync(outDir, { recursive: true });

// 固定种子，保证每次生成结果一致。
function rng(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

const PALETTES = [
    { id: "abyss", bg: ["#05161e", "#0a2a38"], glow: "#4fa8c8", ink: "#bfe3f0", paper: false },
    { id: "mist", bg: ["#100c1c", "#1d1633"], glow: "#a79bd6", ink: "#d8d2f0", paper: false },
    { id: "ink", bg: ["#05080b", "#101822"], glow: "#7fc4d8", ink: "#dbe6ee", paper: false },
    { id: "moss", bg: ["#06140f", "#0c2a20"], glow: "#5fb894", ink: "#cfeee0", paper: false },
    { id: "fog", bg: ["#f2f5f9", "#dbe4ee"], glow: "#2b6f8a", ink: "#2a3a48", paper: true },
];

// 朱雀剪影（与 logo 同源，缩放到画面里）
const PHOENIX_PATHS = [
    "M28 36C20 40 10 44 2 44c7 3 14 4.4 21 4-6 3-9.6 6.2-10.6 9.4C22 55 30 51.6 36 45Z",
    "M33 30c-4 7-3.4 14 .4 20.6 1.6 2.8 2.4 4.6 2.6 6.4-3.4-1.6-7-5-10.4-10-3.2-4.8-5.2-9.8-6-15 4.6-1.4 9-2 13.4-2Z",
    "M36 24C29 17 18 10 5 5c1.6 8.6 7.4 15 16 19.6-6.6-.8-11.6.6-15.4 4 7.6 4 15 4.8 22 2.6Z",
    "M33 26c4.6 1.2 8 4.6 10 9.4l-7 9.6c-4.6-2.4-7.6-6.8-8.6-12.6Z",
    "M45 18c3.6 0 6.4 2.6 6.4 5.8 0 2-1 3.8-2.8 4.8l6.4-1.4-6.8 4.2c-.8 2.4-3 4-5.8 4-3.6 0-6.4-3-6.4-6.6 0-6 4.2-10.8 9-10.8Z",
    "M43.6 12.6c-1.4-3.4-.2-6.4 3.4-8.6-.6 3.4.4 5.8 2.6 7.4-.6 1.4-1.6 2.2-3 2.6Z",
];

function arcs(rand, palette, w, h) {
    const cx = w * (0.3 + rand() * 0.4);
    const cy = h * (0.3 + rand() * 0.35);
    let body = "";
    const count = 12 + Math.floor(rand() * 8);
    for (let i = 0; i < count; i += 1) {
        const r = (i + 1) * (Math.max(w, h) / (count + 3)) * (0.55 + rand() * 0.5);
        const start = rand() * Math.PI * 2;
        const sweep = 1.2 + rand() * 2.4;
        const x1 = cx + Math.cos(start) * r;
        const y1 = cy + Math.sin(start) * r;
        const x2 = cx + Math.cos(start + sweep) * r;
        const y2 = cy + Math.sin(start + sweep) * r;
        body += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${i % 3 === 0 ? palette.glow : palette.ink}" stroke-width="${(1.2 + rand() * 2.6).toFixed(1)}" fill="none" opacity="${(0.3 + rand() * 0.5).toFixed(2)}"/>`;
    }
    return body;
}

function blades(rand, palette, w, h) {
    let body = "";
    const base = h * (0.8 + rand() * 0.1);
    const count = 8 + Math.floor(rand() * 6);
    for (let i = 0; i < count; i += 1) {
        const x = w * (0.06 + (i / count) * 0.88) + (rand() - 0.5) * 20;
        const height = h * (0.26 + rand() * 0.5);
        const width = 20 + rand() * 40;
        const bend = (rand() - 0.5) * 70;
        body += `<path d="M${x} ${base} C${x - width} ${base - height * 0.45} ${x + bend - width * 0.5} ${base - height * 0.8} ${x + bend} ${base - height} C${x + bend + width * 0.5} ${base - height * 0.8} ${x + width} ${base - height * 0.45} ${x} ${base}Z" fill="${i % 2 ? palette.glow : palette.ink}" opacity="${(0.34 + rand() * 0.45).toFixed(2)}"/>`;
    }
    return body;
}

function clouds(rand, palette, w, h) {
    let body = "";
    const rows = 4 + Math.floor(rand() * 3);
    for (let row = 0; row < rows; row += 1) {
        const y = h * (0.18 + (row / rows) * 0.64);
        let d = `M0 ${y.toFixed(1)}`;
        const steps = 5;
        for (let i = 0; i < steps; i += 1) {
            const x1 = (w / steps) * i + w / steps / 2;
            const y1 = y + (rand() - 0.5) * h * 0.06;
            d += ` Q${x1.toFixed(1)} ${(y1 - h * 0.08).toFixed(1)} ${((w / steps) * (i + 1)).toFixed(1)} ${y.toFixed(1)}`;
        }
        body += `<path d="${d}" stroke="${row % 2 ? palette.ink : palette.glow}" stroke-width="${(1.6 + rand() * 2.6).toFixed(1)}" fill="none" opacity="${(0.3 + rand() * 0.45).toFixed(2)}"/>`;
    }
    return body;
}

function meander(rand, palette, w, h) {
    let body = "";
    const layers = 6 + Math.floor(rand() * 4);
    const cx = w / 2;
    const cy = h / 2;
    for (let i = 0; i < layers; i += 1) {
        const inset = (i + 1) * (Math.min(w, h) / (layers * 2 + 3));
        body += `<rect x="${(cx - w / 2 + inset).toFixed(1)}" y="${(cy - h / 2 + inset).toFixed(1)}" width="${(w - inset * 2).toFixed(1)}" height="${(h - inset * 2).toFixed(1)}" rx="${(inset * 0.2).toFixed(1)}" stroke="${i % 2 ? palette.ink : palette.glow}" stroke-width="${(1.4 + rand() * 2).toFixed(1)}" fill="none" opacity="${(0.24 + rand() * 0.4).toFixed(2)}"/>`;
    }
    return body;
}

function sparks(rand, palette, w, h) {
    let body = "";
    const cx = w * (0.35 + rand() * 0.3);
    const cy = h * (0.3 + rand() * 0.3);
    const maxR = Math.hypot(w, h) * 0.6;
    const count = 260 + Math.floor(rand() * 160);
    for (let i = 0; i < count; i += 1) {
        const angle = rand() * Math.PI * 2;
        // 越靠近中心越密，形成光的核心。
        const r = Math.pow(rand(), 0.55) * maxR;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        const size = (1 - r / maxR) * 3.2 + 0.4;
        body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" fill="${rand() > 0.7 ? palette.glow : palette.ink}" opacity="${(0.25 + rand() * 0.6).toFixed(2)}"/>`;
    }
    return body;
}

// 朱雀：剪影居中加光晕，作为品牌母题
function phoenix(rand, palette, w, h) {
    const scale = (Math.min(w, h) * 0.78) / 64;
    const tx = (w - 64 * scale) / 2;
    const ty = (h - 64 * scale) / 2;
    const halo = `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * 0.34}" fill="${palette.glow}" opacity="0.18"/>`;
    const ring = `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * 0.42}" fill="none" stroke="${palette.ink}" stroke-opacity="0.28" stroke-width="1.2" stroke-dasharray="6 8"/>`;
    const glyph = PHOENIX_PATHS.map((d) => `<path d="${d}" fill="${rand() > 0.5 ? palette.glow : palette.ink}" opacity="0.82"/>`).join("");
    return `${halo}${ring}<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale.toFixed(3)})">${glyph}</g>`;
}

// 朱印：朱红方块里压一个「离」字，做国潮印章
function seal(rand, palette, w, h) {
    const size = Math.min(w, h) * 0.44;
    const x = (w - size) / 2;
    const y = (h - size) / 2;
    const angle = (rand() - 0.5) * 6;
    return `<g transform="rotate(${angle.toFixed(1)} ${w / 2} ${h / 2})">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="${(size * 0.08).toFixed(1)}" fill="#4b3f72" opacity="0.92"/>
      <rect x="${(x + size * 0.07).toFixed(1)}" y="${(y + size * 0.07).toFixed(1)}" width="${(size * 0.86).toFixed(1)}" height="${(size * 0.86).toFixed(1)}" rx="${(size * 0.05).toFixed(1)}" fill="none" stroke="#eee9ff" stroke-opacity="0.6" stroke-width="${(size * 0.014).toFixed(1)}"/>
      <text x="${w / 2}" y="${(y + size * 0.74).toFixed(1)}" text-anchor="middle" font-family="Songti SC, SimSun, serif" font-size="${(size * 0.62).toFixed(1)}" fill="#eee9ff" opacity="0.95">离</text>
    </g>`;
}

const PATTERNS = { arcs, blades, clouds, meander, sparks, phoenix, seal };

const ITEMS = [
    ["abyss-arcs", "abyss", "arcs", 0.62],
    ["abyss-blades", "abyss", "blades", 0.4],
    ["abyss-phoenix", "abyss", "phoenix", 0.5],
    ["mist-clouds", "mist", "clouds", 0.55],
    ["mist-meander", "mist", "meander", 0.42],
    ["ink-sparks", "ink", "sparks", 0.5],
    ["ink-blades", "ink", "blades", 0.45],
    ["ink-seal", "ink", "seal", 0.4],
    ["moss-arcs", "moss", "arcs", 0.6],
    ["moss-blades", "moss", "blades", 0.38],
    ["fog-clouds", "fog", "clouds", 0.45],
    ["fog-meander", "fog", "meander", 0.5],
];

const SIZES = [
    [720, 900],
    [720, 720],
    [720, 1040],
];

let index = 0;
for (const [name, paletteId, pattern, focus] of ITEMS) {
    const palette = PALETTES.find((item) => item.id === paletteId);
    const rand = rng(1000 + index * 37);
    const [w, h] = SIZES[index % SIZES.length];
    const art = PATTERNS[pattern](rand, palette, w, h);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg[0]}"/>
      <stop offset="100%" stop-color="${palette.bg[1]}"/>
    </linearGradient>
    <radialGradient id="glow" cx="${(0.3 + rand() * 0.4).toFixed(2)}" cy="${(0.25 + focus * 0.4).toFixed(2)}" r="0.8">
      <stop offset="0%" stop-color="${palette.glow}" stop-opacity="${palette.paper ? 0.22 : 0.55}"/>
      <stop offset="65%" stop-color="${palette.glow}" stop-opacity="0"/>
    </radialGradient>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <g>${art}</g>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="${palette.paper ? 0.14 : 0.1}" style="mix-blend-mode:overlay"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="${palette.ink}" stroke-opacity="0.16"/>
</svg>
`;
    fs.writeFileSync(path.join(outDir, `${name}.svg`), svg, "utf8");
    index += 1;
    console.log(`${name}.svg  ${w}x${h}  ${pattern}/${paletteId}`);
}

// 清理上一版遗留、已不再引用的图。
const keep = new Set(ITEMS.map(([name]) => `${name}.svg`));
for (const file of fs.readdirSync(outDir)) {
    if (file.endsWith(".svg") && !keep.has(file)) {
        fs.rmSync(path.join(outDir, file));
        console.log(`removed stale ${file}`);
    }
}
console.log(`\n${index} artworks written to web/public/gallery`);
