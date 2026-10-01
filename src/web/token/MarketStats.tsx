"use client";
import { useEffect, useState } from "react";
import { fmtCompact, fmtPrice } from "@/web/ui/format";
import type { Market } from "@/web/server/chart";

export function MarketStats({ mint, quoteSymbol }: { mint: string; quoteSymbol: string }) {
  const [m, setM] = useState<Market | null | undefined>(undefined);
  useEffect(() => {
    const load = () => fetch(`/api/chart/${mint}?tf=1H`).then((r) => r.json()).then((j) => setM(j.market ?? null)).catch(() => setM((x) => x ?? null));
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [mint]);
  const dash = <span className="font-sans font-normal text-base text-faint">No trades yet</span>;
  const price = m && (m.priceUsd !== null ? `$${fmtPrice(m.priceUsd)}` : `${fmtPrice(m.price)} ${quoteSymbol}`);
  const cap = m && (m.fdvUsd !== null ? `$${fmtCompact(m.fdvUsd)}` : `${fmtCompact(m.price * 1e9)} ${quoteSymbol}`);
  const vol = m && (m.volume24hUsd !== null ? `$${fmtCompact(m.volume24hUsd)}` : `${fmtCompact(m.volume24h)} ${quoteSymbol}`);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Price</span>
        <span className="font-display font-bold text-2xl md:text-[30px]">{m ? price : dash}</span>
        {m && <span className={`font-mono text-sm ${m.change24h >= 0 ? "text-lime" : "text-burn"}`}>{m.change24h >= 0 ? "+" : ""}{m.change24h.toFixed(1)}% today</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Market cap</span>
        <span className="font-display font-bold text-2xl md:text-[30px]">{m ? cap : dash}</span>
        <span className="font-mono text-sm text-muted">1B supply</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Volume today</span>
        <span className="font-display font-bold text-2xl md:text-[30px]">{m ? vol : dash}</span>
        {m && <span className="font-mono text-sm text-muted">{m.trades24h} {m.trades24h === 1 ? "trade" : "trades"}</span>}
      </div>
    </>
  );
}
