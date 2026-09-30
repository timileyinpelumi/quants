"use client";
import { useEffect, useState } from "react";
import { fmtCompact } from "@/web/ui/format";

type Market = { priceUsd: number; fdvUsd: number; change24h: number } | null;

function price(p: number) {
  if (p >= 1) return `$${p.toFixed(2)}`;
  const s = p.toPrecision(2);
  return `$${Number(s).toString()}`;
}

export function MarketStats({ mint }: { mint: string }) {
  const [m, setM] = useState<Market | undefined>(undefined);
  useEffect(() => {
    fetch(`/api/chart/${mint}?tf=1D`).then((r) => r.json()).then((j) => setM(j.market ?? null)).catch(() => setM(null));
  }, [mint]);
  const dash = <span className="font-sans font-normal text-base text-faint">No trades yet</span>;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Price</span>
        <span className="font-display font-bold text-2xl md:text-[30px]">{m ? price(m.priceUsd) : dash}</span>
        {m && <span className={`font-mono text-sm ${m.change24h >= 0 ? "text-lime" : "text-burn"}`}>{m.change24h >= 0 ? "+" : ""}{m.change24h.toFixed(1)}% today</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Market cap</span>
        <span className="font-display font-bold text-2xl md:text-[30px]">{m ? `$${fmtCompact(m.fdvUsd)}` : dash}</span>
        <span className="font-mono text-sm text-muted">1B supply</span>
      </div>
    </>
  );
}
