import Link from "next/link";
import { Avatar } from "@/web/ui/Avatar";
import { Flame } from "@/web/ui/Flame";
import { fmtAgo, fmtAmount, fmtCompact, lockLabel, shortAddr } from "@/web/ui/format";
import { StakingOpens } from "@/web/stake/StakingOpens";
import type { FeeSummary, LaunchDetail } from "@/web/server/reads";

type Quote = { symbol: string; decimals: number; usd: number | null };

const whole = (base: string, decimals: number) => Number(BigInt(base)) / 10 ** decimals;
const usdOf = (n: number, price: number | null | undefined) => (price == null ? null : `$${fmtCompact(n * price)}`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-display font-bold text-xl md:text-2xl truncate">{value}</span>
      {sub && <span className="font-mono text-[12px] text-faint truncate">{sub}</span>}
    </div>
  );
}

export function RewardsStaking({ mint, symbol, d, fees, icons, px, quote, tokenUsd }: {
  mint: string; symbol: string; d: LaunchDetail; fees: FeeSummary; icons: Record<string, string | null>;
  px: Record<string, number | null>; quote: Quote; tokenUsd: number | null;
}) {
  const q = (base: string) => `${fmtAmount(base, quote.decimals, 3)} ${quote.symbol}`;
  const qUsd = (base: string) => usdOf(whole(base, quote.decimals), quote.usd);
  const paidUsd = d.basket.reduce<number | null>((sum, b) => {
    const p = px[b.mint];
    if (sum === null || b.decimals === null || p == null) return BigInt(b.paidOut) === 0n ? sum : null;
    return sum + whole(b.paidOut, b.decimals) * p;
  }, 0);
  const split = [
    { key: "Stakers", amount: fees.stakers, color: "bg-accent" },
    { key: "Creator", amount: fees.creator, color: "bg-ink" },
    { key: "Platform", amount: fees.platform, color: "bg-violet" },
  ];
  const total = split.reduce((s, x) => s + BigInt(x.amount), 0n);
  const burnedUsd = usdOf(whole(d.burned, 6), tokenUsd);

  return (
    <section className="flex flex-col gap-8" aria-labelledby="rewards-staking">
      <div className="flex justify-between items-baseline gap-4">
        <h2 id="rewards-staking" className="m-0 font-display font-black text-2xl md:text-[28px] tracking-tight">Rewards and staking</h2>
        <Link href={`/t/${mint}/stake`} className="font-semibold text-[15px] text-stake-light min-h-11 flex items-center shrink-0">{d.stakeReady ? "Stake now" : "See lock tiers"}</Link>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-[13px] text-muted">Stakers of {symbol} earn, in this order of weight</span>
        <div className="flex gap-2.5 flex-wrap">
          {d.basket.map((b) => (
            <div key={b.mint} className="flex items-center gap-3 pl-2 pr-4 py-2 rounded-2xl bg-surface border line min-w-0">
              <Avatar seed={b.mint} label={b.symbol ?? "?"} image={icons[b.mint]} size={36} />
              <span className="flex flex-col min-w-0">
                <span className="font-display font-bold truncate">{b.symbol ?? shortAddr(b.mint)}</span>
                <span className="font-mono text-[12px] text-muted">{b.weightBps / 100}%{BigInt(b.paidOut) > 0n && b.decimals !== null ? ` · ${fmtAmount(b.paidOut, b.decimals, 3)} paid` : ""}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5 py-5 border-y line">
        <Stat label="Paid to stakers" value={paidUsd === null ? "No price" : `$${fmtCompact(paidUsd)}`} />
        <Stat label="Fees earned" value={qUsd(fees.earned) ?? q(fees.earned)} sub={qUsd(fees.earned) ? q(fees.earned) : null} />
        <Stat label="Held for stakers" value={qUsd(fees.held) ?? q(fees.held)} sub={qUsd(fees.held) ? q(fees.held) : null} />
        <Stat label="Last paid" value={fees.lastPaidAt ? fmtAgo(fees.lastPaidAt) : "Not yet"} />
      </div>

      {!d.stakeReady && <StakingOpens initial={d.stakingOpens} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12">
        <div className="flex flex-col">
          <div className="flex justify-between items-baseline pb-3 gap-4">
            <h3 className="m-0 font-display font-bold text-lg">Lock tiers</h3>
            <span className="text-[13px] text-muted text-right">Share of rewards now</span>
          </div>
          {d.tiers.map((t) => (
            <div key={t.tierId} className="grid grid-cols-[64px_minmax(0,1fr)_56px] md:grid-cols-[72px_minmax(0,1fr)_120px_56px] gap-4 items-center py-3.5 border-t line">
              <span className="font-display font-black text-xl text-stake-light">{t.multiplierBps / 10_000}x</span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="font-semibold">{lockLabel(t.lockSeconds)}</span>
                <span className="font-mono text-[12px] text-muted truncate">
                  {t.staked === null ? "Unknown" : fmtCompact(whole(t.staked, 6))} {symbol} staked{t.staked !== null && usdOf(whole(t.staked, 6), tokenUsd) ? `, ${usdOf(whole(t.staked, 6), tokenUsd)}` : ""}
                </span>
              </span>
              <span className="hidden md:flex h-2 rounded-full bg-white/[0.07] overflow-hidden"><span className="bg-stake rounded-full" style={{ width: `${t.sharePct}%` }} /></span>
              <span className="font-mono text-[15px] text-right">{t.sharePct}%</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h3 className="m-0 font-display font-bold text-lg">Where every fee goes</h3>
            <div className="flex h-3 rounded-full overflow-hidden gap-[3px] bg-white/[0.07]">
              {total > 0n && split.map((s) => <span key={s.key} className={s.color} style={{ width: `${Number((BigInt(s.amount) * 10_000n) / total) / 100}%` }} />)}
            </div>
            <div className="flex flex-col text-sm">
              {split.map((s) => (
                <span key={s.key} className="flex justify-between gap-4 py-2 border-b line">
                  <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${s.color}`} />{s.key}</span>
                  <span className="font-mono text-right">{q(s.amount)}{qUsd(s.amount) && <span className="text-faint"> · {qUsd(s.amount)}</span>}</span>
                </span>
              ))}
            </div>
            <span className="text-[13px] text-muted leading-normal">
              All time, after Meteora&apos;s 20% of each trading fee{BigInt(fees.meteora) > 0n ? `, about ${q(fees.meteora)}` : ""}. Fees not yet split are counted in fees earned only.
            </span>
          </div>

          <div className="flex items-center gap-3.5 px-5 py-4 rounded-[22px] bg-burn/[0.08] border border-burn/25">
            <Flame />
            <span className="flex flex-col gap-0.5">
              <span className="font-display font-bold text-lg">{fmtAmount(d.burned, 6, 0)} {symbol} burned{burnedUsd && d.burned !== "0" ? `, about ${burnedUsd}` : ""}</span>
              <span className="text-[13px] text-muted">From early exits. Burned tokens are gone for good.</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
