import Link from "next/link";
import { Avatar } from "@/web/ui/Avatar";
import { CoinStack, CoinTag } from "@/web/ui/CoinStack";
import { TradingOnly } from "@/web/ui/StakingAt";
import { changeTone, fmtAgo, fmtChange, fmtCompact, shortAddr } from "@/web/ui/format";
import type { TokenRow } from "@/web/server/landing";

export const usd = (n: number | null) => (n === null ? "No trades" : `$${fmtCompact(n)}`);

export function Change({ value, traded }: { value: number; traded: boolean }) {
  if (!traded) return <span className="text-faint">0%</span>;
  return <span className={changeTone(value)}>{fmtChange(value)}</span>;
}

function Stat({ label, children, end = false }: { label: string; children: React.ReactNode; end?: boolean }) {
  return (
    <span className={`flex flex-col gap-1 min-w-0 ${end ? "items-end text-right" : ""}`}>
      <span className="text-[12px] text-faint">{label}</span>
      <span className="font-display font-bold text-[17px] leading-none tabular-nums truncate max-w-full">{children}</span>
    </span>
  );
}

export function TokenCard({ t }: { t: TokenRow }) {
  return (
    <Link href={`/t/${t.mint}`} className="flex flex-col gap-4 p-4 rounded-2xl bg-surface border border-white/[0.08] hover:border-white/20 transition-colors min-w-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className="relative shrink-0">
          <Avatar seed={t.mint} label={t.symbol} image={t.image} size={48} />
          <span className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-surface leading-none" title={`Paired with ${t.quote.symbol}`}>
            <Avatar seed={t.quote.mint} label={t.quote.symbol} image={t.quote.icon} size={18} />
          </span>
        </span>
        <span className="flex flex-1 flex-col min-w-0 gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span className="font-display font-bold text-lg leading-none break-all">{t.symbol}</span>
            {t.tradingOnly && <TradingOnly />}
            <span className="ml-auto font-mono text-[11px] text-faint shrink-0">{fmtAgo(t.createdAt)}</span>
          </span>
          <span className="text-[13px] text-muted truncate">{t.name ?? shortAddr(t.mint)} <span className="text-faint">· {t.symbol}/{t.quote.symbol}</span></span>
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-3">
        <Stat label="Market cap">{usd(t.mcapUsd)}</Stat>
        <Stat label="Vol 24h">{t.volume24hUsd ? `$${fmtCompact(t.volume24hUsd)}` : "$0"}</Stat>
        <Stat label="24h" end><Change value={t.change24h} traded={t.price !== null} /></Stat>
      </div>
      <div className="flex items-center justify-between gap-3 text-[12px] font-mono">
        {t.status === "graduated"
          ? <span className="font-sans font-semibold text-ink">Graduated</span>
          : <span className="text-muted"><span className="font-sans">Bonding curve</span> <span className="text-ink font-semibold">{t.progress ?? 0}%</span></span>}
        {!t.tradingOnly && t.stakingPct !== null && <span className="text-stake-light"><span className="font-sans">Staking opens</span> <span className="font-semibold">{t.stakingPct}%</span></span>}
      </div>
      <span className="flex items-center gap-2 text-[12px] text-muted min-w-0 pt-3 border-t line">
        {t.tradingOnly ? <>
          <span className="shrink-0">Paired with</span>
          <CoinTag coin={t.quote} size={18} />
        </> : <>
          <span className="shrink-0">Earns</span>
          <CoinStack coins={t.basket} size={18} max={4} />
        </>}
      </span>
    </Link>
  );
}
