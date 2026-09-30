const COLORS = ["#01888C", "#FC7500", "#034F5D", "#F73F01", "#FC1960", "#C7144C", "#F3C100", "#1598F2", "#2465E1", "#F19E02"];

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shiftHue(hex: string, deg: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  h = (h + deg + 360) % 360;
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

// Deterministic per address, in the style of MetaMask's jazzicon.
export function Jazzicon({ address, size = 32 }: { address: string; size?: number }) {
  const r = rng(address);
  const shift = r() * 30 - 15;
  const palette = COLORS.map((c) => shiftHue(c, shift));
  const pick = () => palette.splice(Math.floor(r() * palette.length), 1)[0]!;
  const bg = pick();
  const shapes = [0, 1, 2].map((i) => {
    const angle = r() * 360;
    const velocity = (size / 3) * r() + (i * size) / 3;
    const tx = Math.cos((Math.PI * 2 * angle) / 360) * velocity;
    const ty = Math.sin((Math.PI * 2 * angle) / 360) * velocity;
    return { tx, ty, rot: r() * 360, fill: pick() };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 rounded-full" style={{ background: bg }}>
      {shapes.map((s, i) => (
        <rect key={i} width={size} height={size} fill={s.fill} transform={`translate(${s.tx.toFixed(2)} ${s.ty.toFixed(2)}) rotate(${s.rot.toFixed(1)} ${size / 2} ${size / 2})`} />
      ))}
    </svg>
  );
}
