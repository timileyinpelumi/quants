"use client";
import Link from "next/link";
import { Avatar } from "@/web/ui/Avatar";
import { CoinStack, CoinTag } from "@/web/ui/CoinStack";
import { fmtAgo, fmtCompact, shortAddr } from "@/web/ui/format";
import { LoadMore, getJson, usePaged } from "@/web/ui/LoadMore";
import type { TokenRow } from "@/web/server/landing";
import { StakingAt } from "@/web/ui/StakingAt";

const COLS = "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]";
const PAGE = 30;

const usd = (n: number | null) => (n === null ? "No trades" : `$${fmtCompact(n)}`);

export function ExploreList({ initial, nextOffset, query }: { initial: TokenRow[]; nextOffset: number | null; query: { sort: string; filter: string; q: string } }) {
  const paged = usePaged(initial, nextOffset, async (offset) => {
    const sp = new URLSearchParams({ ...query, offset: String(offset), limit: String(PAGE) });
    const r = await getJson<{ tokens: TokenRow[]; nextOffset: number | null }>(`/api/explore?${sp}`);
    return { items: r.tokens, next: r.nextOffset };
  }, (t) => t.mint);

  return (
    <div className="flex flex-col">
      <div className={`hidden md:grid ${COLS} gap-6 pb-2 text-[12px] text-faint`}>
        <span>Token</span><span className="text-right">Market cap</span><span className="text-right">24h</span><span className="text-right">Volume 24h</span><span>Graduation</span><span>Stakers earn</span>
      </div>
      {paged.items.map((t) => (
        <Link key={t.mint} href={`/t/${t.mint}`} className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-3 md:gap-6 items-center py-3.5 border-t line hover:bg-white/[0.02]`}>
          <span className="flex items-center gap-3 min-w-0">
            <Avatar seed={t.mint} label={t.symbol} image={t.image} size={44} />
            <span className="flex flex-col min-w-0">
              <span className="flex items-baseline gap-2 min-w-0">
                <span className="font-display font-bold text-lg truncate">{t.symbol}</span>
                <span className="font-mono text-[12px] text-faint shrink-0">{fmtAgo(t.createdAt)}</span>
                <StakingAt pct={t.stakingPct} />
              </span>
              <span className="text-[13px] text-muted truncate flex items-center gap-1.5">{t.name ?? shortAddr(t.mint)} · <CoinTag coin={t.quote} size={14} /></span>
            </span>
          </span>
          <span className="flex flex-col items-end font-mono text-sm md:hidden">
            <span>{usd(t.mcapUsd)}</span>
            {t.price !== null && <span className={`text-[12px] ${t.change24h >= 0 ? "text-accent" : "text-burn"}`}>{t.change24h >= 0 ? "+" : ""}{t.change24h.toFixed(1)}%</span>}
          </span>
          <span className="hidden md:block text-right font-mono text-sm">{usd(t.mcapUsd)}</span>
          <span className={`hidden md:block text-right font-mono text-sm ${t.change24h >= 0 ? "text-accent" : "text-burn"}`}>{t.price === null ? "" : `${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(1)}%`}</span>
          <span className="hidden md:block text-right font-mono text-sm">{t.volume24hUsd ? `$${fmtCompact(t.volume24hUsd)}` : "$0"}</span>
          <span className="hidden md:flex flex-col gap-1.5">
            {t.status === "graduated" ? <span className="text-sm font-semibold text-accent">Graduated</span> : (
              <>
                <span className="font-mono text-[12px] text-muted">{t.progress ?? 0}%</span>
                <span className="inline-flex h-1.5 w-full max-w-32 rounded-full bg-white/[0.07] overflow-hidden">
                  <span className="rounded-full" style={{ width: `${t.progress ?? 0}%`, background: "linear-gradient(90deg, #9D8CFF, #4C9DFF)" }} />
                </span>
              </>
            )}
          </span>
          <span className="hidden md:flex text-sm min-w-0"><CoinStack coins={t.basket} /></span>
        </Link>
      ))}
      <LoadMore auto done={paged.done} state={paged.state} onMore={paged.more} doneText={paged.pages > 0 ? "No more tokens" : undefined} />
    </div>
  );
}
