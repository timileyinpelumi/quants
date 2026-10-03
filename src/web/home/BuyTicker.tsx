"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmtCompact, fmtPrice, shortAddr } from "@/web/ui/format";
import type { BuyRow } from "@/web/server/landing";

const ROTATE_MS = 3_500;
const REFRESH_MS = 15_000;

export function BuyTicker() {
  const [buys, setBuys] = useState<BuyRow[]>([]);
  const [i, setI] = useState(0);
  const shownRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/trades/recent?limit=12", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j) return;
        setBuys((prev) => (prev.length && prev[0]!.id === j.buys[0]?.id ? prev : j.buys));
        // A refreshed list keeps the rotation going from the trade on screen instead of starting over.
        setI((n) => {
          const shown = shownRef.current;
          const at = shown ? j.buys.findIndex((x: BuyRow) => x.id === shown) : -1;
          return at >= 0 ? at : Math.min(n, Math.max(0, j.buys.length - 1));
        });
      })
      .catch(() => {});
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (buys.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % buys.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [buys.length]);

  const b = buys[i % Math.max(1, buys.length)];
  shownRef.current = b?.id ?? null;
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
