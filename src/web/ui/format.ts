export function fmtAmount(base: bigint | string, decimals: number, maxFrac = 4): string {
  const v = typeof base === "string" ? BigInt(base) : base;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 10n ** BigInt(decimals);
  const whole = (abs / unit).toLocaleString("en-US");
  const frac = (abs % unit).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function fmtCompact(n: number): string {
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, s] of units) if (Math.abs(n) >= v) return `${(n / v).toFixed(1).replace(/\.0$/, "")}${s}`;
  return String(Math.round(n));
}

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const PAIRS: [string, string][] = [
  ["#FFB86B", "#FF7A59"], ["#F9D976", "#F4B400"], ["#FFC1E3", "#FF7AB6"], ["#9FE7FF", "#4FB8FF"],
  ["#8CBEFF", "#3B7DE0"], ["#BDB2FF", "#8B7BFF"], ["#A7F3D0", "#34D399"],
];

export function avatarGradient(seed: string): [string, string] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PAIRS[h % PAIRS.length]!;
}

export function fmtPrice(n: number, sig = 3): string {
  if (n === 0) return "0";
  if (Math.abs(n) >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const decimals = Math.min(12, -Math.floor(Math.log10(Math.abs(n))) + sig - 1);
  return n.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

const tenths = (pct: number) => Math.round(pct * 10) / 10 || 0;

/** "+12.3%", "-4.1%", "0.0%"; signed by the shown value so -0.04 is not "-0.0%". */
export const fmtChange = (pct: number) => { const v = tenths(pct); return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`; };

/** Market colour for a change: green up, red down, muted when it rounds to zero. */
export const changeTone = (pct: number) => { const v = tenths(pct); return v > 0 ? "text-up" : v < 0 ? "text-down" : "text-muted"; };

export function fmtAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Remote logos are served resized through wsrv.nl so pages never download full size token art; Cloudinary resizes its own. */
export function imgSrc(url: string, px: number): string {
  if (!/^https:\/\//.test(url) || /^https:\/\/(localhost|127\.0\.0\.1)/.test(url)) return url;
  const cld = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/.exec(url);
  if (cld) return `${cld[1]}w_${px * 2},h_${px * 2},c_fill,f_webp/${cld[2]}`;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${px * 2}&h=${px * 2}&fit=cover&output=webp`;
}

/** "12 hours", "1 day", "30 days" for a lock length. */
export function lockLabel(seconds: number): string {
  if (seconds < 86_400) { const h = Math.round(seconds / 3600); return `${h} ${h === 1 ? "hour" : "hours"}`; }
  const d = Math.round(seconds / 86_400);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

/** "12h", "1d", "30d" for tight spaces. */
export const lockShort = (seconds: number) => (seconds < 86_400 ? `${Math.round(seconds / 3600)}h` : `${Math.round(seconds / 86_400)}d`);
