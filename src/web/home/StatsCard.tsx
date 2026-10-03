"use client";
import { useEffect, useRef, useState } from "react";
import { fmtCompact } from "@/web/ui/format";

type Stats = { volumeAllUsd: number; volume24hUsd: number; stakersUsd: number; launches: number; traders24h: number; hourly: number[] };

function useCountUp(target: number, ms = 1200) {
  const [v, setV] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(target); return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setV(a + (target - a) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Spark({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const w = 100, h = 40;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - (p / max) * (h - 4) - 2] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-28 w-full opacity-60" aria-hidden="true">
      <defs>
        <linearGradient id="statsSpark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#statsSpark)" />
      <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const usd = (n: number) => `$${fmtCompact(n)}`;

export function StatsCard({ s }: { s: Stats }) {
  const total = useCountUp(s.volumeAllUsd);
  return (
    <div className="relative rounded-[28px] p-[1.5px] overflow-hidden stats-ring">
      <div className="relative flex flex-col gap-6 rounded-[27px] bg-surface p-6 md:p-7 overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-accent/25 blur-3xl" aria-hidden="true" />
        <Spark points={s.hourly} />
        <div className="relative flex flex-col gap-2">
          <span className="text-[13px] text-muted">
            Total volume traded
          </span>
          <span className="font-display font-black text-[48px] md:text-[64px] leading-none tracking-tight bg-gradient-to-r from-white via-[#BFE0FF] to-accent bg-clip-text text-transparent tabular-nums">{usd(total)}</span>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-up/15 px-2.5 py-1 text-[13px] font-semibold text-up">
            {usd(s.volume24hUsd)} in the last 24h
          </span>
        </div>
        <div className="relative grid grid-cols-3 gap-4 pt-5 border-t line">
          {[["Rewards", usd(s.stakersUsd)], ["Tokens launched", fmtCompact(s.launches)], ["Traders today", fmtCompact(s.traders24h)]].map(([l, v]) => (
            <div key={l} className="flex flex-col gap-1 min-w-0">
              <span className="text-[12px] text-muted">{l}</span>
              <span className="font-display font-bold text-lg md:text-xl">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
