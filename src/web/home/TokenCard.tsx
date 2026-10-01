import Link from "next/link";
import { Avatar } from "@/web/ui/Avatar";
import { CoinStack, CoinTag } from "@/web/ui/CoinStack";
import { TradingOnly } from "@/web/ui/StakingAt";
import { fmtAgo, fmtCompact, shortAddr } from "@/web/ui/format";
import type { TokenRow } from "@/web/server/landing";

export const usd = (n: number | null) => (n === null ? "No trades" : `$${fmtCompact(n)}`);

export function Change({ value, traded }: { value: number; traded: boolean }) {
  if (!traded) return <span className="text-faint">0%</span>;
  return <span className={value >= 0 ? "text-accent" : "text-burn"}>{value >= 0 ? "+" : ""}{value.toFixed(1)}%</span>;
}

export function Meter({ value, color }: { value: number; color: string }) {
  return (
    <span className="flex h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden">
      <span className="rounded-full" style={{ width: `${value}%`, background: color }} />
    </span>
  );
}

export const CURVE = "linear-gradient(90deg, #9D8CFF, #4C9DFF)";

export function TokenCard({ t }: { t: TokenRow }) {
  return (
    <Link href={`/t/${t.mint}`} className="flex flex-col gap-4 p-4 rounded-3xl bg-surface border border-white/[0.07] hover:border-white/15 hover:bg-raised transition-colors min-w-0">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar seed={t.mint} label={t.symbol} image={t.image} size={52} />
        <span className="flex flex-1 flex-col min-w-0 gap-0.5">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="font-display font-bold text-lg truncate">{t.symbol}</span>
            <span className="font-mono text-[11px] text-faint shrink-0">{fmtAgo(t.createdAt)}</span>
            {t.tradingOnly && <TradingOnly />}
          </span>
          <span className="text-[13px] text-muted truncate">{t.name ?? shortAddr(t.mint)}</span>
        </span>
      </div>
      <div className="flex items-end justify-between gap-3 font-mono">
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="font-sans text-[12px] text-faint">Market cap</span>
          <span className="text-[15px] truncate">{usd(t.mcapUsd)}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5 text-sm">
          <span className="font-sans text-[12px] text-faint">24h</span>
          <Change value={t.change24h} traded={t.price !== null} />
        </span>
      </div>
      {t.status === "graduated" ? (
        <span className="text-[13px] font-semibold text-accent">Graduated</span>
      ) : (
        <span className="flex flex-col gap-1.5">
          <span className="flex justify-between text-[12px] text-muted"><span>Bonding curve</span><span className="font-mono">{t.progress ?? 0}%</span></span>
          <Meter value={t.progress ?? 0} color={CURVE} />
        </span>
      )}
      {!t.tradingOnly && t.stakingPct !== null && (
        <span className="flex flex-col gap-1.5">
          <span className="flex justify-between text-[12px] text-stake-light"><span>Staking opens</span><span className="font-mono">{t.stakingPct}%</span></span>
          <Meter value={t.stakingPct} color="var(--color-stake-light)" />
        </span>
      )}
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
