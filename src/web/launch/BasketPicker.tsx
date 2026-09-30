"use client";
import { useEffect, useState } from "react";
import { Avatar } from "@/web/ui/Avatar";
import { inputClass } from "@/web/ui/Field";

export type BasketItem = { mint: string; symbol: string; name: string; icon: string | null; decimals: number; weight: number };
type Found = Omit<BasketItem, "weight">;

export const basketTotal = (items: BasketItem[]) => items.reduce((a, b) => a + b.weight, 0);

function evenly(items: BasketItem[]): BasketItem[] {
  if (!items.length) return items;
  const base = Math.floor(100 / items.length);
  return items.map((it, i) => ({ ...it, weight: base + (i === 0 ? 100 - base * items.length : 0) }));
}

export function BasketPicker({ value, onChange }: { value: BasketItem[]; onChange: (v: BasketItem[]) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/tokens/search?q=${encodeURIComponent(q.trim())}`);
        setFound(((await r.json()).tokens ?? []) as Found[]);
      } catch {
        setFound([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const add = (t: Found) => {
    if (value.length >= 3 || value.some((v) => v.mint === t.mint)) return;
    onChange(evenly([...value, { ...t, weight: 0 }]));
    setQ("");
    setFound([]);
  };
  const setWeight = (mint: string, w: number) => onChange(value.map((v) => (v.mint === mint ? { ...v, weight: Math.max(0, Math.min(100, Math.round(w) || 0)) } : v)));
  const remove = (mint: string) => onChange(evenly(value.filter((v) => v.mint !== mint)));
  const total = basketTotal(value);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex justify-between items-baseline gap-4">
        <span className="font-display font-bold text-xl">Reward basket</span>
        <span className="text-[13px] text-muted text-right">Up to 3 tokens. Stakers earn these.</span>
      </div>

      <div className="flex flex-col">
        {value.map((b) => (
          <div key={b.mint} className="grid grid-cols-[44px_minmax(0,1fr)_88px_44px] md:grid-cols-[44px_minmax(0,1fr)_200px_96px_44px] gap-3 md:gap-4 items-center py-3.5 border-b line">
            <Avatar seed={b.mint} label={b.symbol} image={b.icon} />
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="font-semibold truncate">{b.symbol}</span>
              <span className="text-[13px] text-muted truncate">{b.name}</span>
            </span>
            <span className="hidden md:flex h-2 rounded-full bg-white/[0.07] overflow-hidden">
              <span className="bg-lime rounded-full" style={{ width: `${b.weight}%` }} />
            </span>
            <label className="flex items-center justify-end gap-1 font-mono">
              <span className="sr-only">Weight for {b.symbol}</span>
              <input
                inputMode="numeric"
                value={b.weight}
                onChange={(e) => setWeight(b.mint, Number(e.target.value))}
                className="w-14 bg-transparent text-right text-base outline-none border-b border-white/15 focus:border-lime/60 py-1"
              />
              <span className="text-muted">%</span>
            </label>
            <button
              type="button"
              aria-label={`Remove ${b.symbol}`}
              onClick={() => remove(b.mint)}
              className="w-11 h-11 rounded-full border border-white/10 text-muted hover:text-ink flex items-center justify-center cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
            </button>
          </div>
        ))}
      </div>

      {value.length > 0 && (
        <div className="flex justify-between text-[13px]">
          <span className={total === 100 ? "text-muted" : "text-burn"}>{total === 100 ? "Weights add up to 100" : `Weights add up to ${total}. They need to add up to 100.`}</span>
          {value.length > 1 && <button type="button" onClick={() => onChange(evenly(value))} className="text-lime cursor-pointer min-h-11 -my-3">Split evenly</button>}
        </div>
      )}

      {value.length < 3 && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2.5 text-[13px] text-muted">
            <span>Add a token</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, symbol or address" className={`${inputClass} font-sans text-base`} />
          </label>
          {(found.length > 0 || searching) && (
            <div className="flex flex-col max-h-72 overflow-y-auto">
              {searching && found.length === 0 && <span className="text-sm text-muted py-3">Searching</span>}
              {found.map((t) => (
                <button
                  key={t.mint}
                  type="button"
                  onClick={() => add(t)}
                  disabled={value.some((v) => v.mint === t.mint)}
                  className="grid grid-cols-[36px_minmax(0,1fr)_auto] gap-3 items-center py-3 border-b line text-left cursor-pointer hover:bg-white/[0.02] disabled:opacity-40 min-h-11"
                >
                  <Avatar seed={t.mint} label={t.symbol} image={t.icon} size={36} />
                  <span className="flex flex-col min-w-0">
                    <span className="font-semibold truncate">{t.symbol}</span>
                    <span className="text-[13px] text-muted truncate">{t.name}</span>
                  </span>
                  <span className="text-lime text-sm font-semibold">Add</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
