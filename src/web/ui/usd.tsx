"use client";
import { useEffect, useState } from "react";
import { fmtPrice } from "./format";

const TTL = 60_000;
const cache = new Map<string, { at: number; usd: number | null }>();
const inflight = new Map<string, Promise<void>>();

async function load(mints: string[]) {
  const key = [...mints].sort().join(",");
  if (!inflight.has(key)) {
    inflight.set(key, fetch(`/api/prices?mints=${key}`).then((r) => r.json()).then((j) => {
      for (const m of mints) cache.set(m, { at: Date.now(), usd: j.prices?.[m] ?? null });
    }).catch(() => undefined).finally(() => inflight.delete(key)));
  }
  await inflight.get(key);
}

/** USD per whole token for each mint, shared across components and refreshed every minute. */
export function useUsd(mints: string[]): Record<string, number | null> {
  const key = [...new Set(mints.filter(Boolean))].sort().join(",");
  const read = () => Object.fromEntries(key.split(",").filter(Boolean).map((m) => [m, cache.get(m)?.usd ?? null]));
  const [prices, setPrices] = useState<Record<string, number | null>>(read);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const tick = async () => {
      const stale = key.split(",").filter((m) => { const c = cache.get(m); return !c || Date.now() - c.at > TTL; });
      if (stale.length) await load(stale);
      if (live) setPrices(read());
    };
    tick();
    const t = setInterval(tick, TTL);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return prices;
}

export const usdText = (amount: number, price: number | null | undefined) => (price == null || !Number.isFinite(amount) ? null : `$${fmtPrice(amount * price)}`);

export function Usd({ amount, price, className = "" }: { amount: number; price: number | null | undefined; className?: string }) {
  const t = usdText(amount, price);
  return t ? <span className={`text-faint ${className}`}>≈ {t}</span> : null;
}
