import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { CopyButton } from "@/web/ui/CopyButton";
import { Flame } from "@/web/ui/Flame";
import { fmtAmount, fmtCompact, shortAddr, lockLabel } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { launchDetail } from "@/web/server/reads";
import { Chart } from "@/web/token/Chart";
import { TradePanel } from "@/web/token/TradePanel";
import { MarketStats, GraduationBar } from "@/web/token/MarketStats";
import { TokenLiveProvider } from "@/web/token/TokenLive";
import { TokenInsights } from "@/web/token/TokenInsights";
import { tokenLive } from "@/web/server/token-live";
import { iconsFor } from "@/web/server/icons";
import { quoteCoin, quoteCoins } from "@/domain/quotes";
import { usdPrices } from "@/web/server/prices";

export const dynamic = "force-dynamic";

const tokens = (base: string | null) => (base === null ? "Unknown" : fmtCompact(Number(BigInt(base) / 10_000n) / 100));

export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const ctx = getContext();
  const [d, live] = await Promise.all([launchDetail(ctx, mint), tokenLive(ctx, mint)]);
  if (!d) notFound();
  const { launch } = d;
  const symbol = launch.symbol ?? shortAddr(mint);
  const quote = quoteCoin(launch.quoteMint);
  const pairSymbol = quote?.symbol ?? shortAddr(launch.quoteMint);
  const quoteDecimals = quote?.decimals ?? 6;
  const icons = await iconsFor(ctx.icons, [launch.quoteMint, ...d.basket.map((b) => b.mint)], quoteCoins());
  const progress = d.curve.migrated || BigInt(d.curve.threshold) === 0n ? 100 : Math.min(100, Number((BigInt(d.curve.quoteReserve) * 100n) / BigInt(d.curve.threshold)));
  const earns = d.basket.map((b) => b.symbol ?? shortAddr(b.mint)).join(", ");
  const px = await usdPrices(ctx, d.basket.map((b) => b.mint)).catch(() => ({} as Record<string, number | null>));
  const tokenUsd = live?.market?.priceUsd ?? null;
  const usd = (whole: number, price: number | null | undefined) => (price == null ? null : `$${fmtCompact(whole * price)}`);

  return (
    <TokenLiveProvider mint={mint} initial={live}>
    <div className="flex-1 bg-token">
      <Header active="token" />
      <main className="flex flex-col gap-10 wrap pt-8 md:pt-12 pb-16">
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
                <span className="flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full bg-raised-2 border border-white/[0.08]"><Avatar seed={launch.quoteMint} label={pairSymbol} image={icons[launch.quoteMint]} size={20} />{symbol} / {pairSymbol}</span>
                <span className="px-3 py-1.5 rounded-full bg-raised-2 border border-white/[0.08]">{launch.feeTierBps / 100}% fee</span>
                <CopyButton value={mint} label={shortAddr(mint)} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:flex gap-6 md:gap-12 items-start">
            <MarketStats quoteSymbol={pairSymbol} />
            <div className="col-span-2 flex flex-col gap-2 md:w-60">
              <GraduationBar quoteSymbol={pairSymbol} quoteDecimals={quoteDecimals}
                initial={{ reserve: d.curve.quoteReserve, threshold: d.curve.threshold, progress, migrated: d.curve.migrated }} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8">
          <Chart mint={mint} quoteSymbol={pairSymbol} />
          <TradePanel mint={mint} symbol={symbol} quoteMint={launch.quoteMint} quoteSymbol={pairSymbol} quoteDecimals={quoteDecimals}
            stake={{ tiers: d.tiers.map((t) => ({ id: t.tierId, lockSeconds: t.lockSeconds, multiplierBps: t.multiplierBps })), maxPenaltyBps: d.maxPenaltyBps, ready: d.stakeReady, earns }} />
        </section>

        <TokenInsights mint={mint} symbol={symbol} quoteSymbol={pairSymbol} />

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-8">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-baseline pb-3 gap-4">
              <h2 className="m-0 font-display font-black text-2xl md:text-[28px] tracking-tight">Stake {symbol}, earn</h2>
              <Link href={`/t/${mint}/stake`} className="font-semibold text-[15px] text-lime min-h-11 flex items-center">Stake now</Link>
            </div>
            {d.basket.map((b) => (
              <div key={b.mint} className="grid grid-cols-[44px_minmax(0,1fr)_auto] gap-4 items-center py-3.5 border-t line">
                <Avatar seed={b.mint} label={b.symbol ?? "?"} image={icons[b.mint]} />
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-semibold">{b.symbol ?? shortAddr(b.mint)}</span>
                  <span className="text-[13px] text-muted">{b.weightBps / 100}% of the basket</span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="font-mono text-[15px]">{fmtAmount(b.paidOut, b.decimals ?? 0, 3)} {b.symbol ?? ""}</span>
                  <span className="text-[13px] text-muted">paid to stakers{b.decimals !== null && usd(Number(BigInt(b.paidOut)) / 10 ** b.decimals, px[b.mint]) ? `, ${usd(Number(BigInt(b.paidOut)) / 10 ** b.decimals, px[b.mint])}` : ""}</span>
                </span>
              </div>
            ))}
            <div className="flex items-center gap-3.5 mt-3 px-5 py-4 rounded-[22px] bg-burn/[0.08] border border-burn/25">
              <Flame />
              <span className="flex flex-col gap-0.5">
                <span className="font-display font-bold text-lg">{fmtAmount(d.burned, 6, 0)} {symbol} burned{usd(Number(BigInt(d.burned)) / 1e6, tokenUsd) && d.burned !== "0" ? `, about ${usd(Number(BigInt(d.burned)) / 1e6, tokenUsd)}` : ""}</span>
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
                  <span className="font-semibold">{lockLabel(t.lockSeconds)}</span>
                  <span className="font-mono text-[13px] text-muted">{tokens(t.staked)} {symbol} staked{t.staked !== null && usd(Number(BigInt(t.staked)) / 1e6, tokenUsd) ? `, ${usd(Number(BigInt(t.staked)) / 1e6, tokenUsd)}` : ""}</span>
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
    </TokenLiveProvider>
  );
}
