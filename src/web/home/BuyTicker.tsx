"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtCompact, fmtPrice, shortAddr } from "@/web/ui/format";
import type { BuyRow } from "@/web/server/landing";


export function BuyTicker() {
  const [b, setB] = useState<BuyRow | null>(null);

  // One shared stream from the server: new trades as they land, otherwise one recent trade per token in turn.
  useEffect(() => {
    const es = new EventSource("/api/trades/stream");
    es.onmessage = (e) => { try { setB(JSON.parse(e.data) as BuyRow); } catch {} };
    return () => es.close();
  }, []);

  if (!b) return null;
  return (
    <div className="flex items-center gap-2.5 h-10 md:h-6 text-[13px] text-muted overflow-hidden" aria-live="off">
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${b.side === "sell" ? "bg-down" : "bg-up"}`} />
      <Link key={b.id} href={`/t/${b.mint}`} className="ticker-in block truncate min-w-0 hover:text-ink max-md:leading-10">
        <span className="font-mono">{shortAddr(b.trader)}</span> <span className={b.side === "sell" ? "text-down" : "text-up"}>{b.side === "sell" ? "sold" : "bought"}</span> {b.amount >= 1 ? fmtCompact(b.amount) : fmtPrice(b.amount)} <span className="font-semibold text-ink">{b.symbol}</span>
      </Link>
    </div>
  );
}
