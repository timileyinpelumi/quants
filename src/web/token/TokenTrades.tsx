"use client";
import { useEffect, useState } from "react";
import { fmtAgo, fmtCompact, fmtPrice, shortAddr } from "@/web/ui/format";
import type { TradeRow } from "@/web/server/landing";

export function TokenTrades({ mint, symbol, quoteSymbol }: { mint: string; symbol: string; quoteSymbol: string }) {
  const [trades, setTrades] = useState<TradeRow[] | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/trades/${mint}`).then((r) => r.json()).then((j) => setTrades(j.trades ?? [])).catch(() => setTrades((t) => t ?? []));
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [mint]);
  return (
    <section className="flex flex-col">
      <h2 className="m-0 pb-3 font-display font-bold text-xl">Trades</h2>
      <div className="hidden md:grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_100px] gap-6 pb-2 text-[12px] text-faint">
        <span>Side</span><span className="text-right">{symbol}</span><span className="text-right">Value</span><span>Wallet</span><span className="text-right">When</span>
      </div>
      {trades === null ? <p className="m-0 py-6 border-t line text-muted text-sm">Loading trades</p>
        : trades.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">No trades yet.</p>
        : trades.map((t) => (
          <div key={`${t.signature}:${t.eventIndex}`} className="grid grid-cols-[56px_minmax(0,1fr)_auto] md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_100px] gap-3 md:gap-6 items-center py-2.5 border-t line text-sm font-mono">
            <span className={`font-sans font-semibold ${t.side === "buy" ? "text-lime" : "text-burn"}`}>{t.side === "buy" ? "Buy" : "Sell"}</span>
            <span className="md:text-right truncate">{fmtCompact(t.amount)}</span>
            <span className="text-right">{t.valueUsd === null ? `${fmtPrice(t.quoteValue)} ${quoteSymbol}` : `$${fmtPrice(t.valueUsd)}`}</span>
            <a href={`https://solscan.io/account/${t.trader}`} target="_blank" rel="noreferrer" className="hidden md:block text-muted hover:text-ink truncate">{shortAddr(t.trader)}</a>
            <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noreferrer" className="hidden md:block text-right text-muted hover:text-ink">{fmtAgo(t.at)}</a>
          </div>
        ))}
    </section>
  );
}
