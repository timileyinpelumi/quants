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
import { MarketStats, GraduationBar, PhoneQuote } from "@/web/token/MarketStats";
import { PhoneBars, TokenPhoneShell } from "@/web/token/PhoneBars";
import { TabPanel } from "@/web/ui/MobileTabs";
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

  const pill = "flex items-center whitespace-nowrap rounded-full bg-raised-2 border border-white/[0.08]";
  const dexUrl = `https://dexscreener.com/solana/${mint}`;
  const external = <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>;

  return (
    <TokenLiveProvider mint={mint} initial={live}>
    <TokenPhoneShell>
    <div className="flex-1 bg-token">
      <Header active="token" />
      <main className="flex flex-col gap-6 md:gap-10 wrap pt-5 md:pt-12 pb-[calc(9.5rem+env(safe-area-inset-bottom))] md:pb-16">
        <section className="flex flex-col gap-5 md:gap-8">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 md:gap-x-6 gap-y-3 md:gap-y-2 items-center">
            <span className="shrink-0 md:row-span-2" style={{ filter: "drop-shadow(0 20px 40px rgba(255,122,89,0.25))" }}>
              <span className="md:hidden"><Avatar seed={mint} label={symbol} image={launch.image} size={56} /></span>
              <span className="hidden md:block"><Avatar seed={mint} label={symbol} image={launch.image} size={96} /></span>
            </span>
            <div className="flex flex-col gap-1 md:gap-2 min-w-0 md:self-end">
              <div className="flex items-baseline gap-x-2.5 md:gap-x-3.5 min-w-0 md:flex-wrap">
                <h1 className="m-0 font-display font-black text-[28px] md:text-[56px] tracking-[-0.03em] leading-none truncate max-md:shrink-0 max-md:max-w-[60%]">{symbol}</h1>
                {launch.name && <span className="text-sm md:text-lg text-muted whitespace-nowrap max-md:truncate">{launch.name}</span>}
              </div>
              <div className="md:hidden"><PhoneQuote quoteSymbol={pairSymbol} /></div>
            </div>
            <div className="col-span-2 md:col-span-1 md:col-start-2 md:self-start flex gap-2.5 text-[13px] md:flex-wrap no-scrollbar max-md:overflow-x-auto max-md:-mx-4 max-md:px-4 [&>*]:shrink-0 max-md:[&>*]:min-h-10">
              <span className={`${pill} gap-1.5 pl-1.5 pr-3 py-1`}><Avatar seed={launch.quoteMint} label={pairSymbol} image={icons[launch.quoteMint]} size={20} />{symbol} / {pairSymbol}</span>
              <span className={`${pill} px-3 py-1.5`}>{launch.feeTierBps / 100}% trading fee</span>
              {tradingOnly && <span className="flex items-center"><TradingOnly /></span>}
              <CopyButton value={mint} label={shortAddr(mint)} />
              <a href={dexUrl} target="_blank" rel="noreferrer" className={`${pill} gap-1.5 px-3 py-1.5 text-muted hover:text-ink`}>
                DexScreener
                {external}
              </a>
            </div>
          </div>
          <TabPanel show="chart">
            <div className="grid grid-cols-2 md:flex gap-6 md:gap-12 items-start">
              <MarketStats quoteSymbol={pairSymbol} />
              <div className="col-span-2 flex flex-col gap-2 md:w-60">
                <GraduationBar quoteSymbol={pairSymbol} quoteDecimals={quoteDecimals}
                  initial={{ reserve: d.curve.quoteReserve, threshold: d.curve.threshold, progress, migrated: d.curve.migrated }} />
              </div>
            </div>
          </TabPanel>
          <a href="#insights" className="hidden md:block self-start -mt-3 text-sm text-muted hover:text-ink">Trades, activity and holders ↓</a>
        </section>

        <section className="max-md:contents grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8">
          <TabPanel show="chart"><Chart mint={mint} quoteSymbol={pairSymbol} /></TabPanel>
          <TradePanel mint={mint} symbol={symbol} quoteMint={launch.quoteMint} quoteSymbol={pairSymbol} quoteDecimals={quoteDecimals} quoteUiMultiplier={quoteUiMultiplier}
            stake={tradingOnly ? null : { tiers: d.tiers.map((t) => ({ id: t.tierId, lockSeconds: t.lockSeconds, multiplierBps: t.multiplierBps })), maxPenaltyBps: d.maxPenaltyBps, ready: d.stakeReady, earns, opens: d.stakingOpens }} />
        </section>

        <TabPanel show="info" className="md:hidden flex flex-col">
          <h2 className="m-0 pb-3 font-display font-black text-2xl tracking-tight">About {symbol}</h2>
          <div className="flex flex-col text-sm">
            <span className="flex justify-between items-center gap-4 min-h-12 border-t line"><span className="text-muted">Paired with</span><span className="flex items-center gap-2 font-semibold"><Avatar seed={launch.quoteMint} label={pairSymbol} image={icons[launch.quoteMint]} size={20} />{pairSymbol}</span></span>
            <span className="flex justify-between items-center gap-4 min-h-12 border-t line"><span className="text-muted">Fee tier</span><span className="font-mono">{launch.feeTierBps / 100}% per trade</span></span>
            <span className="flex justify-between items-center gap-4 min-h-12 border-t line"><span className="text-muted">Contract</span><CopyButton value={mint} label={shortAddr(mint)} /></span>
            <span className="flex justify-between items-center gap-4 min-h-12 border-t line"><span className="text-muted">Supply</span><span className="font-mono">1,000,000,000</span></span>
            <a href={dexUrl} target="_blank" rel="noreferrer" className="flex justify-between items-center gap-4 min-h-12 border-y line text-muted hover:text-ink"><span>Open on DexScreener</span>{external}</a>
          </div>
        </TabPanel>

        {tradingOnly ? (
          <TabPanel show="rewards info">
            <p className="m-0 text-[15px] text-muted max-w-[640px]">{symbol} is paired with a stock, so it is trading only. It has no reward basket and no staking. Trading fees go to the creator and the platform.</p>
          </TabPanel>
        ) : (
          <RewardsStaking mint={mint} symbol={symbol} d={d} fees={fees} icons={icons} px={px} tokenUsd={tokenUsd}
            quote={{ symbol: pairSymbol, decimals: quoteDecimals, usd: live?.quoteUsd ?? px[launch.quoteMint] ?? null }} />
        )}

        <TabPanel show="trades"><TokenInsights mint={mint} symbol={symbol} quoteSymbol={pairSymbol} /></TabPanel>
      </main>
      <PhoneBars canStake={!tradingOnly} />
    </div>
    </TokenPhoneShell>
    </TokenLiveProvider>
  );
}
