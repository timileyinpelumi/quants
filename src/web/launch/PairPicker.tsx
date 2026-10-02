"use client";
import { useMemo, useState } from "react";
import { Avatar } from "@/web/ui/Avatar";
import { TradingOnly } from "@/web/ui/StakingAt";

export type PairKind = "crypto" | "xstocks" | "backpack";
export type PairOption = { mint: string; symbol: string; name: string; decimals: number; graduation: number; icon: string | null; kind: PairKind; tradingOnly: boolean };

const TABS: { id: "all" | PairKind; label: string }[] = [
  { id: "all", label: "All" }, { id: "crypto", label: "Crypto" }, { id: "xstocks", label: "xStocks" }, { id: "backpack", label: "Backpack" },
];

export function pairTabs(quotes: PairOption[]) {
  return TABS.map((t) => ({ ...t, count: t.id === "all" ? quotes.length : quotes.filter((q) => q.kind === t.id).length })).filter((t) => t.id === "all" || t.count > 0);
}

export function filterPairs(quotes: PairOption[], tab: "all" | PairKind, q: string) {
  const needle = q.trim().toLowerCase();
  return quotes.filter((c) => (tab === "all" || c.kind === tab) && (!needle || `${c.symbol} ${c.name} ${c.mint}`.toLowerCase().includes(needle)));
}

export function PairPicker({ quotes, value, onChange }: { quotes: PairOption[]; value: string; onChange: (mint: string) => void }) {
  const [tab, setTab] = useState<"all" | PairKind>("all");
  const [q, setQ] = useState("");
  const tabs = useMemo(() => pairTabs(quotes), [quotes]);
  const shown = useMemo(() => filterPairs(quotes, tab, q), [quotes, tab, q]);
  const picked = quotes.find((c) => c.mint === value);
  const label = picked?.symbol ?? "SOL";
  const grouped = tabs.length > 2;

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[13px] text-muted">Paired with</span>
      {grouped && (
        <div role="tablist" aria-label="Pair groups" className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3.5 min-h-10 rounded-full border text-sm font-semibold cursor-pointer ${tab === t.id ? "bg-raised-2 border-accent/60 text-ink" : "border-white/10 text-muted hover:text-ink"}`}>
              {t.label}<span className="font-mono text-[12px] text-faint">{t.count}</span>
            </button>
          ))}
        </div>
      )}
      {quotes.length > 6 && (
        <label className="flex items-center gap-3 bg-ground border border-white/10 rounded-2xl px-4 focus-within:border-accent/60">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A97A8" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className="sr-only">Search pairs</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, symbol or address" className="flex-1 min-w-0 bg-transparent py-3 text-base outline-none" />
        </label>
      )}
      <div role="radiogroup" aria-label="Paired with" className="flex flex-col max-h-[312px] overflow-y-auto border-t line">
        {shown.length === 0 && <p className="m-0 py-4 text-sm text-muted">No pair matches.</p>}
        {shown.map((c) => {
          const on = c.mint === value;
          return (
            <button key={c.mint} type="button" role="radio" aria-checked={on} onClick={() => onChange(c.mint)}
              className={`grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 items-center px-2 py-2.5 min-h-12 border-b line text-left cursor-pointer ${on ? "bg-accent/[0.06]" : "hover:bg-white/[0.03]"}`}>
              <Avatar seed={c.mint} label={c.symbol} image={c.icon} size={28} />
              <span className="flex items-baseline gap-2 min-w-0">
                <span className="font-semibold shrink-0">{c.symbol}</span>
                <span className="text-[13px] text-muted truncate">{c.name}</span>
              </span>
              <span className="flex items-center gap-2.5">
                {c.tradingOnly && <TradingOnly />}
                <span aria-hidden className={`w-5 h-5 rounded-full border flex items-center justify-center ${on ? "bg-accent border-accent" : "border-white/25"}`}>
                  {on && <span className="w-2 h-2 rounded-full bg-ground" />}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <span className="text-[13px] text-muted">
        Your token trades against {label}. Fees are earned in {label}.
        {picked?.tradingOnly && " Tokens paired with a stock are trading only. They have no reward basket and no staking."}
      </span>
    </div>
  );
}
