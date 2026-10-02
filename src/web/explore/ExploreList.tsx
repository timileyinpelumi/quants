"use client";
import Link from "next/link";
import { Avatar } from "@/web/ui/Avatar";
import { CoinStack, CoinTag } from "@/web/ui/CoinStack";
import { changeTone, fmtAgo, fmtChange, fmtCompact, shortAddr } from "@/web/ui/format";
import { Sparkline } from "@/web/ui/Sparkline";
import { LoadMore, getJson, usePaged } from "@/web/ui/LoadMore";
import type { TokenRow } from "@/web/server/landing";
import { StakingAt } from "@/web/ui/StakingAt";

const COLS = "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.7fr)_96px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]";
const PAGE = 30;

const usd = (n: number | null) => (n === null ? "No trades" : `$${fmtCompact(n)}`);

export function ExploreList({ initial, nextOffset, query }: { initial: TokenRow[]; nextOffset: number | null; query: { sort: string; filter: string; q: string; quote?: string } }) {
  const paged = usePaged(initial, nextOffset, async (offset) => {
    const sp = new URLSearchParams({ ...query, offset: String(offset), limit: String(PAGE), spark: "1" });
    const r = await getJson<{ tokens: TokenRow[]; nextOffset: number | null }>(`/api/explore?${sp}`);
    return { items: r.tokens, next: r.nextOffset };
  }, (t) => t.mint);

  return (
    <div className="flex flex-col">
      <div className={`hidden md:grid ${COLS} gap-6 pb-2 text-[12px] text-faint`}>
        <span>Token</span><span className="text-right">Market cap</span><span className="text-right">24h</span><span>Last 24h</span><span className="text-right">Volume 24h</span><span>Graduation</span><span>Stakers earn</span>
      </div>
      {paged.items.map((t) => (
        <Link key={t.mint} href={`/t/${t.mint}`} className={`grid grid-cols-[minmax(0,1fr)_auto_auto] ${COLS} gap-3 md:gap-6 items-center py-3.5 border-t line hover:bg-white/[0.02]`}>
          <span className="flex items-center gap-3 min-w-0">
            <Avatar seed={t.mint} label={t.symbol} image={t.image} size={44} />
            <span className="flex flex-1 flex-col min-w-0">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                <span className="font-display font-bold text-lg truncate">{t.symbol}</span>
                <span className="font-mono text-[12px] text-faint shrink-0">{fmtAgo(t.createdAt)}</span>
                <StakingAt pct={t.stakingPct} tradingOnly={t.tradingOnly} />
              </span>
              <span className="text-[13px] text-muted truncate flex items-center gap-1.5">{t.name ?? shortAddr(t.mint)} · <CoinTag coin={t.quote} size={14} /></span>
            </span>
          </span>
          <Sparkline points={t.spark ?? []} width={56} height={24} className="md:hidden" />
          <span className="flex flex-col items-end font-mono text-sm tabular-nums md:hidden">
            <span>{usd(t.mcapUsd)}</span>
            {t.price !== null && <span className={`text-[12px] ${changeTone(t.change24h)}`}>{fmtChange(t.change24h)}</span>}
          </span>
          <span className="hidden md:block text-right font-mono text-sm tabular-nums">{usd(t.mcapUsd)}</span>
          <span className={`hidden md:block text-right font-mono text-sm tabular-nums ${changeTone(t.change24h)}`}>{t.price === null ? "" : fmtChange(t.change24h)}</span>
          <Sparkline points={t.spark ?? []} className="hidden md:block" />
          <span className="hidden md:block text-right font-mono text-sm tabular-nums">{t.volume24hUsd ? `$${fmtCompact(t.volume24hUsd)}` : "$0"}</span>
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
          <span className="hidden md:flex text-sm min-w-0">{t.tradingOnly ? <span className="text-muted">No staking</span> : <CoinStack coins={t.basket} />}</span>
        </Link>
      ))}
      <LoadMore auto done={paged.done} state={paged.state} onMore={paged.more} doneText={paged.pages > 0 ? "No more tokens" : undefined} />
    </div>
  );
}
