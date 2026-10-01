"use client";
import { useCallback, useState } from "react";
import { Avatar } from "@/web/ui/Avatar";
import { TokenPicker, type PickedToken } from "./TokenPicker";

export type BasketItem = { mint: string; symbol: string; name: string; icon: string | null; decimals: number; weight: number };

export const basketTotal = (items: BasketItem[]) => items.reduce((a, b) => a + b.weight, 0);

const MAX = 10;

function evenly(items: BasketItem[]): BasketItem[] {
  if (!items.length) return items;
  const base = Math.floor(100 / items.length);
  return items.map((it, i) => ({ ...it, weight: base + (i === 0 ? 100 - base * items.length : 0) }));
}

export function BasketPicker({ value, onChange }: { value: BasketItem[]; onChange: (v: BasketItem[]) => void }) {
  const [picking, setPicking] = useState(false);
  const close = useCallback(() => setPicking(false), []);

  const add = (picked: PickedToken[]) => {
    const fresh = picked.filter((t) => !value.some((v) => v.mint === t.mint)).slice(0, MAX - value.length);
    if (fresh.length) onChange(evenly([...value, ...fresh.map((t) => ({ ...t, weight: 0 }))]));
  };
  const setWeight = (mint: string, w: number) => onChange(value.map((v) => (v.mint === mint ? { ...v, weight: Math.max(0, Math.min(100, Math.round(w) || 0)) } : v)));
  const remove = (mint: string) => onChange(evenly(value.filter((v) => v.mint !== mint)));
  const total = basketTotal(value);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex justify-between items-baseline gap-4">
        <span className="font-display font-bold text-xl">Reward basket</span>
        <span className="text-[13px] text-muted text-right">Up to 10 tokens. Trading fees buy them for your stakers.</span>
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
          <span className={total === 100 ? "text-muted" : "text-burn"}>{total === 100 ? "Weights add up to 100" : `Weights add up to ${total}. They must add up to 100.`}</span>
          {value.length > 1 && <button type="button" onClick={() => onChange(evenly(value))} className="text-lime cursor-pointer min-h-11 -my-3">Split evenly</button>}
        </div>
      )}

      {value.length < MAX && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex items-center gap-3 px-5 min-h-16 rounded-2xl border-[1.5px] border-dashed border-lime/40 bg-lime/[0.04] text-lime font-semibold cursor-pointer hover:border-lime/70 hover:bg-lime/[0.07] text-left"
        >
          <span className="w-9 h-9 rounded-full bg-lime/15 flex items-center justify-center shrink-0" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          </span>
          <span className="flex flex-col">
            <span>{value.length === 0 ? "Add reward tokens" : "Add more tokens"}</span>
            <span className="text-[13px] font-normal text-muted">{MAX - value.length} of {MAX} left</span>
          </span>
        </button>
      )}

      <TokenPicker open={picking} onClose={close} onPick={add} taken={value.map((v) => v.mint)} max={MAX - value.length} />
    </div>
  );
}
