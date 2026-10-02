export function Sparkline({ points, width = 96, height = 28, className = "" }: { points: number[]; width?: number; height?: number; className?: string }) {
  if (points.length < 2) return <span aria-hidden className={`block ${className}`} style={{ width, height }} />;
  const first = points[0]!, last = points.at(-1)!;
  // same rounding as the 24h change column, so a float wobble is neither coloured nor drawn as a step
  const pct = first ? Math.round((last / first - 1) * 1000) / 10 : 0;
  const tone = pct > 0 ? "var(--color-up)" : pct < 0 ? "var(--color-down)" : "var(--color-faint)";
  let lo = Math.min(...points), hi = Math.max(...points);
  if (hi - lo <= Math.abs(hi) * 1e-9) lo = hi;
  const pad = 2;
  const y = (v: number) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2));
  const x = (i: number) => (i / (points.length - 1)) * width;
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`block overflow-visible ${className}`}>
      <path d={d} fill="none" stroke={tone} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
