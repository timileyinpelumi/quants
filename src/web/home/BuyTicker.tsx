"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtCompact, fmtPrice, shortAddr } from "@/web/ui/format";
import type { BuyRow } from "@/web/server/landing";

const ROTATE_MS = 3_500;
const REFRESH_MS = 15_000;

export function BuyTicker() {
  const [buys, setBuys] = useState<BuyRow[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/trades/recent?limit=12", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j) return;
        setBuys((prev) => (prev.length && prev[0]!.id === j.buys[0]?.id ? prev : j.buys));
      })
      .catch(() => {});
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    setI(0);
    if (buys.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % buys.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [buys]);

  const b = buys[i];
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
