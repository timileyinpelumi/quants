import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { CopyButton } from "@/web/ui/CopyButton";
import { Flame } from "@/web/ui/Flame";
import { fmtAmount, fmtCompact, shortAddr } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { launchDetail } from "@/web/server/reads";
import { Chart } from "@/web/token/Chart";
import { TradePanel } from "@/web/token/TradePanel";
import { MarketStats } from "@/web/token/MarketStats";

export const dynamic = "force-dynamic";

const SOL = "So11111111111111111111111111111111111111112";
const tokens = (base: string | null) => (base === null ? "Unknown" : fmtCompact(Number(BigInt(base) / 10_000n) / 100));

export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const ctx = getContext();
  const d = await launchDetail(ctx, mint);
  if (!d) notFound();
  const { launch } = d;
  const symbol = launch.symbol ?? shortAddr(mint);
  const pairSymbol = launch.quoteMint === SOL ? "SOL" : process.env.NEXT_PUBLIC_OURTOKEN_SYMBOL ?? "OURTOKEN";
  const quoteDecimals = launch.quoteMint === SOL ? 9 : 6;
  const progress = d.curve.migrated || BigInt(d.curve.threshold) === 0n ? 100 : Math.min(100, Number((BigInt(d.curve.quoteReserve) * 100n) / BigInt(d.curve.threshold)));

  return (
    <div className="min-h-screen bg-token">
      <Header active="token" />
      <main className="flex flex-col gap-10 px-4 md:px-16 pt-8 md:pt-12 pb-16">
        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-8 items-end">
          <div className="flex items-center gap-4 md:gap-6 min-w-0">
            <span className="shrink-0" style={{ filter: "drop-shadow(0 20px 40px rgba(255,122,89,0.25))" }}>
              <Avatar seed={mint} label={symbol} image={launch.image} size={96} />
            </span>
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-baseline gap-3.5 flex-wrap">
                <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">{symbol}</h1>
                {launch.name && <span className="text-lg text-muted">{launch.name}</span>}
              </div>
              <div className="flex gap-2.5 text-[13px] flex-wrap">
                <span className="px-3 py-1.5 rounded-full bg-raised-2 border border-white/[0.08]">{symbol} / {pairSymbol}</span>
                <span className="px-3 py-1.5 rounded-full bg-raised-2 border border-white/[0.08]">{launch.feeTierBps / 100}% fee</span>
                <CopyButton value={mint} label={shortAddr(mint)} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:flex gap-6 md:gap-12 items-start">
            <MarketStats mint={mint} />
            <div className="col-span-2 flex flex-col gap-2 md:w-60">
              {d.curve.migrated ? (
                <>
                  <span className="text-[13px] text-muted">Graduated</span>
                  <span className="font-mono text-sm text-lime">Trading on Meteora DAMM v2</span>
                </>
              ) : (
                <>
                  <span className="flex justify-between text-[13px] text-muted"><span>To graduation</span><span className="font-mono text-ink">{progress}%</span></span>
                  <span className="h-3 rounded-full bg-white/[0.07] overflow-hidden flex"><span className="rounded-full" style={{ width: `${progress}%`, background: "linear-gradient(90deg, #9D8CFF, #C8FF3D)" }} /></span>
                  <span className="font-mono text-[13px] text-muted">{fmtAmount(d.curve.quoteReserve, quoteDecimals, 1)} of {fmtAmount(d.curve.threshold, quoteDecimals, 1)} {pairSymbol}</span>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8">
          <Chart mint={mint} />
          <TradePanel mint={mint} quoteMint={launch.quoteMint} />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-8">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-baseline pb-3 gap-4">
              <h2 className="m-0 font-display font-black text-2xl md:text-[28px] tracking-tight">Stake {symbol}, earn</h2>
              <Link href={`/t/${mint}/stake`} className="font-semibold text-[15px] text-lime min-h-11 flex items-center">Stake now</Link>
            </div>
            {d.basket.map((b) => (
              <div key={b.mint} className="grid grid-cols-[44px_minmax(0,1fr)_auto] gap-4 items-center py-3.5 border-t line">
                <Avatar seed={b.mint} label={b.symbol ?? "?"} />
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-semibold">{b.symbol ?? shortAddr(b.mint)}</span>
                  <span className="text-[13px] text-muted">{b.weightBps / 100}% of the basket</span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="font-mono text-[15px]">{fmtAmount(b.paidOut, b.decimals ?? 0, 3)} {b.symbol ?? ""}</span>
                  <span className="text-[13px] text-muted">paid to stakers</span>
                </span>
              </div>
            ))}
            <div className="flex items-center gap-3.5 mt-3 px-5 py-4 rounded-[22px] bg-burn/[0.08] border border-burn/25">
              <Flame />
              <span className="flex flex-col gap-0.5">
                <span className="font-display font-bold text-lg">{fmtAmount(d.burned, 6, 0)} {symbol} burned</span>
                <span className="text-[13px] text-muted">From early exits. Burned tokens are gone for good.</span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-baseline pb-3 gap-4">
              <h2 className="m-0 font-display font-black text-2xl md:text-[28px] tracking-tight">Lock tiers</h2>
              <span className="text-[13px] text-muted text-right">Share of rewards now</span>
            </div>
            {d.tiers.map((t) => (
              <div key={t.tierId} className="grid grid-cols-[72px_minmax(0,1fr)_64px] md:grid-cols-[88px_minmax(0,1fr)_140px_64px] gap-4 items-center py-4 border-t line">
                <span className="font-display font-black text-2xl text-violet-light">{t.multiplierBps / 10_000}x</span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{Math.round(t.lockSeconds / 86_400)} days</span>
                  <span className="font-mono text-[13px] text-muted">{tokens(t.staked)} {symbol} staked</span>
                </span>
                <span className="hidden md:flex h-2 rounded-full bg-white/[0.07] overflow-hidden"><span className="bg-violet rounded-full" style={{ width: `${t.sharePct}%` }} /></span>
                <span className="font-mono text-[15px] text-right">{t.sharePct}%</span>
              </div>
            ))}
            {!d.stakeReady && <p className="m-0 pt-3 text-[13px] text-muted">Staking opens a few minutes after launch.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
