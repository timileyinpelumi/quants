"use client";
import Link from "next/link";
import { Avatar } from "@/web/ui/Avatar";
import { fmtAgo, fmtCompact, fmtPrice } from "@/web/ui/format";
import { LoadMore, getJson, usePaged } from "@/web/ui/LoadMore";
import type { RewardPayment, StakerToken } from "@/web/server/rewards";

const PAGE = 20;
export type PricedPayment = RewardPayment & { priceUsd: number | null };

export function StakerTokensList({ initial, nextOffset }: { initial: StakerToken[]; nextOffset: number | null }) {
  const paged = usePaged(initial, nextOffset, async (offset) => {
    const r = await getJson<{ tokens: StakerToken[]; nextOffset: number | null }>(`/api/rewards/tokens?offset=${offset}&limit=${PAGE}`);
    return { items: r.tokens, next: r.nextOffset };
  }, (t) => t.mint);
  if (paged.items.length === 0) return <p className="m-0 py-6 border-t line text-muted text-sm">No fees collected yet.</p>;
  return (
    <>
      {paged.items.map((t, i) => (
        <Link key={t.mint} href={`/t/${t.mint}`} className="grid grid-cols-[28px_40px_minmax(0,1fr)_auto] gap-3 items-center py-3 border-t line hover:bg-white/[0.02]">
          <span className="font-mono text-sm text-faint">{i + 1}</span>
          <Avatar seed={t.mint} label={t.symbol} image={t.image} size={40} />
          <span className="flex flex-col min-w-0">
            <span className="font-display font-bold truncate">{t.symbol}</span>
            <span className="text-[12px] text-muted truncate">Pays {t.basket.join(", ")}</span>
          </span>
          <span className="flex flex-col items-end font-mono text-sm">
            <span>${fmtPrice(t.setAsideUsd)}</span>
            <span className="text-[12px] text-muted">{t.payments} {t.payments === 1 ? "payment" : "payments"}</span>
          </span>
        </Link>
      ))}
      <LoadMore done={paged.done} state={paged.state} onMore={paged.more} doneText={paged.pages > 0 ? "No more tokens" : undefined} />
    </>
  );
}

export function PaymentsList({ initial, next }: { initial: PricedPayment[]; next: string | null }) {
  const paged = usePaged(initial, next, async (before) => {
    const r = await getJson<{ payments: PricedPayment[]; next: string | null }>(`/api/rewards/payments?before=${before}&limit=${PAGE}`);
    return { items: r.payments, next: r.next };
  }, (p) => String(p.id));
  if (paged.items.length === 0) return <p className="m-0 py-6 border-t line text-muted text-sm">No rewards paid yet. Payments start once someone stakes.</p>;
  return (
    <>
      {paged.items.map((p) => (
        <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center py-3 border-t line text-sm">
          <span className="flex flex-col min-w-0">
            <Link href={`/t/${p.mint}`} className="font-display font-bold hover:text-accent truncate">{p.symbol} stakers</Link>
            <span className="font-mono text-[12px] text-muted">{fmtCompact(p.amount)} {p.reward}{p.priceUsd != null ? ` ($${fmtPrice(p.amount * p.priceUsd)})` : ""} added to the farm</span>
          </span>
          <a href={`https://solscan.io/tx/${p.signature}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-muted hover:text-ink text-right">{fmtAgo(p.at)}</a>
        </div>
      ))}
      <LoadMore done={paged.done} state={paged.state} onMore={paged.more} doneText={paged.pages > 0 ? "No more payments" : undefined} />
    </>
  );
}
