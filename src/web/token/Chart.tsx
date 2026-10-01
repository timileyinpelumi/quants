"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, AreaSeries, ColorType, type UTCTimestamp } from "lightweight-charts";
import { fmtPrice } from "@/web/ui/format";

type Candle = { time: number; open: number; high: number; low: number; close: number };
const TFS = ["1H", "1D", "1W"] as const;

export function Chart({ mint, quoteSymbol }: { mint: string; quoteSymbol: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState<(typeof TFS)[number]>("1D");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [unit, setUnit] = useState<"usd" | "quote">("usd");

  useEffect(() => {
    let live = true;
    setCandles(null);
    const load = () => fetch(`/api/chart/${mint}?tf=${tf}`)
      .then((r) => r.json())
      .then((j) => { if (!live) return; setUnit(j.unit ?? "usd"); const next: Candle[] = j.candles ?? []; setCandles((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)); })
      .catch(() => live && setCandles((c) => c ?? []));
    load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [mint, tf]);

  useEffect(() => {
    if (!el.current || !candles?.length) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9A97A8", fontFamily: "var(--font-geist-mono), monospace", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.05)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: tf !== "1W" },
      crosshair: { vertLine: { color: "rgba(76,157,255,0.35)" }, horzLine: { color: "rgba(76,157,255,0.35)" } },
    });
    const s = chart.addSeries(AreaSeries, {
      lineColor: "#4C9DFF", lineWidth: 3, topColor: "rgba(76,157,255,0.28)", bottomColor: "rgba(76,157,255,0)",
      priceFormat: { type: "custom", minMove: 1e-12, formatter: (p: number) => (unit === "usd" ? `$${fmtPrice(p, 5)}` : fmtPrice(p, 5)) },
    });
    s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, tf, unit]);

  return (
    <div className="flex flex-col gap-4 bg-surface border line rounded-[32px] px-5 md:px-7 py-6 min-w-0">
      <div className="flex justify-between items-center">
        <span className="font-display font-bold">Price{unit === "quote" && <span className="font-sans font-normal text-sm text-muted"> in {quoteSymbol}</span>}</span>
        <div className="flex gap-1.5 font-mono text-[13px]">
          {TFS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTf(t)}
              aria-pressed={tf === t}
              className={`px-3.5 min-h-11 rounded-full cursor-pointer ${tf === t ? "bg-raised-2 text-ink border border-white/10" : "text-muted hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {candles === null ? (
        <div className="h-[280px] md:h-[340px] rounded-2xl bg-white/[0.02] animate-pulse" />
      ) : candles.length === 0 ? (
        <div className="h-[280px] md:h-[340px] flex items-center justify-center text-muted text-sm">No trades to chart yet</div>
      ) : (
        <div ref={el} className="h-[280px] md:h-[340px]" role="img" aria-label="Price chart" />
      )}
    </div>
  );
}
