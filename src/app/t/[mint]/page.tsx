import { notFound } from "next/navigation";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { CopyButton } from "@/web/ui/CopyButton";
import { shortAddr } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { feeSummary, launchDetail } from "@/web/server/reads";
import { RewardsStaking } from "@/web/token/RewardsStaking";
import { Chart } from "@/web/token/Chart";
import { TradePanel } from "@/web/token/TradePanel";
import { MarketStats, GraduationBar } from "@/web/token/MarketStats";
import { TokenLiveProvider } from "@/web/token/TokenLive";
import { TokenInsights } from "@/web/token/TokenInsights";
import { tokenLive } from "@/web/server/token-live";
import { quoteCoin } from "@/domain/quotes";
import { allQuotes, quoteIcons } from "@/web/server/quotes";
import { fetchMint, uiMultiplier } from "@/chain/mints";
import { TradingOnly } from "@/web/ui/StakingAt";
import { usdPrices } from "@/web/server/prices";

export const dynamic = "force-dynamic";

export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const ctx = getContext();
  const [d, live] = await Promise.all([launchDetail(ctx, mint), tokenLive(ctx, mint)]);
  if (!d) notFound();
  const { launch } = d;
  const symbol = launch.symbol ?? shortAddr(mint);
  const quotes = await allQuotes(ctx);
  const quote = quoteCoin(launch.quoteMint, quotes);
  const tradingOnly = launch.tradingOnly;
  const quoteUiMultiplier = quote?.tradingOnly ? await fetchMint(ctx.conn, launch.quoteMint).then((m) => uiMultiplier(m.mint), () => 1) : 1;
  const pairSymbol = quote?.symbol ?? shortAddr(launch.quoteMint);
  const quoteDecimals = quote?.decimals ?? 6;
  const icons = await quoteIcons(ctx, [launch.quoteMint, ...d.basket.map((b) => b.mint)], quotes);
  const progress = d.curve.migrated || BigInt(d.curve.threshold) === 0n ? 100 : Math.min(100, Number((BigInt(d.curve.quoteReserve) * 100n) / BigInt(d.curve.threshold)));
  const earns = d.basket.map((b) => b.symbol ?? shortAddr(b.mint)).join(", ");
  const [px, fees] = await Promise.all([
    usdPrices(ctx, [launch.quoteMint, ...d.basket.map((b) => b.mint)]).catch(() => ({} as Record<string, number | null>)),
    feeSummary(ctx.sql, d.launch.id),
  ]);
  const tokenUsd = live?.market?.priceUsd ?? null;

  return (
    <TokenLiveProvider mint={mint} initial={live}>
    <div className="flex-1 bg-token">
      <Header active="token" />
      <main className="flex flex-col gap-10 wrap pt-8 md:pt-12 pb-16">
        <section className="flex flex-col gap-8">
          <div className="flex items-center gap-4 md:gap-6 min-w-0">
            <span className="shrink-0" style={{ filter: "drop-shadow(0 20px 40px rgba(255,122,89,0.25))" }}>
              <Avatar seed={mint} label={symbol} image={launch.image} size={96} />
            </span>
            <div className="flex flex-1 flex-col gap-2 min-w-0">
              <div className="flex items-baseline gap-3.5 flex-wrap">
                <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">{symbol}</h1>
                {launch.name && <span className="text-lg text-muted whitespace-nowrap">{launch.name}</span>}
              </div>
              <div className="flex gap-2.5 text-[13px] flex-wrap">
                <span className="flex items-center gap-1.5 whitespace-nowrap pl-1.5 pr-3 py-1 rounded-full bg-raised-2 border border-white/[0.08]"><Avatar seed={launch.quoteMint} label={pairSymbol} image={icons[launch.quoteMint]} size={20} />{symbol} / {pairSymbol}</span>
                <span className="px-3 py-1.5 whitespace-nowrap rounded-full bg-raised-2 border border-white/[0.08]">{launch.feeTierBps / 100}% trading fee</span>
                {tradingOnly && <span className="flex items-center"><TradingOnly /></span>}
                <CopyButton value={mint} label={shortAddr(mint)} />
                <a href={`https://dexscreener.com/solana/${mint}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full bg-raised-2 border border-white/[0.08] text-muted hover:text-ink">
                  DexScreener
                  <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
                </a>
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
          <a href="#insights" className="self-start -mt-3 text-sm text-muted hover:text-ink">Trades, activity and holders ↓</a>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8">
          <Chart mint={mint} quoteSymbol={pairSymbol} />
          <TradePanel mint={mint} symbol={symbol} quoteMint={launch.quoteMint} quoteSymbol={pairSymbol} quoteDecimals={quoteDecimals} quoteUiMultiplier={quoteUiMultiplier}
            stake={tradingOnly ? null : { tiers: d.tiers.map((t) => ({ id: t.tierId, lockSeconds: t.lockSeconds, multiplierBps: t.multiplierBps })), maxPenaltyBps: d.maxPenaltyBps, ready: d.stakeReady, earns, opens: d.stakingOpens }} />
        </section>

        {tradingOnly ? (
          <p className="m-0 text-[15px] text-muted max-w-[640px]">{symbol} is paired with a stock, so it is trading only. It has no reward basket and no staking. Trading fees go to the creator and the platform.</p>
        ) : (
          <RewardsStaking mint={mint} symbol={symbol} d={d} fees={fees} icons={icons} px={px} tokenUsd={tokenUsd}
            quote={{ symbol: pairSymbol, decimals: quoteDecimals, usd: live?.quoteUsd ?? px[launch.quoteMint] ?? null }} />
        )}

        <TokenInsights mint={mint} symbol={symbol} quoteSymbol={pairSymbol} />
      </main>
    </div>
    </TokenLiveProvider>
  );
}
