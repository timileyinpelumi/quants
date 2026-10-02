import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { fmtCompact } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { allQuotes, quoteIcons } from "@/web/server/quotes";
import { HOME_TABS, landing } from "@/web/server/landing";
import { platformCardFor, platformLinks } from "@/web/server/platform-token";
import { clusterOf } from "@/cluster";
import { HomeGrid } from "@/web/home/HomeGrid";
import { BuyTicker } from "@/web/home/BuyTicker";
import { FeaturedCard } from "@/web/home/FeaturedCard";
import { PrelaunchCard } from "@/web/home/PrelaunchCard";
import { cachedSettings, fillSymbol, xUrlOf } from "@/domain/settings";

export const dynamic = "force-dynamic";

const usd = (n: number | null) => (n === null ? "No price" : `$${fmtCompact(n)}`);

export default async function HomePage() {
  const ctx = getContext();
  const now = Date.now();
  const s = await cachedSettings(ctx.sql);
  const p = s.platformToken;
  const text = (t: string) => fillSymbol(t, p.symbol);
  const [d, card] = await Promise.all([
    landing(ctx.sql, now, async (m) => quoteIcons(ctx, m, await allQuotes(ctx))),
    p.mint ? platformCardFor(ctx, now).catch(() => null) : null,
  ]);
  const launchedHere = card ? (await ctx.sql`select 1 from launches where mint = ${card.mint}`).length > 0 : false;
  return (
    <div className="flex-1 bg-launch">
      <Header active="home" />
      <main className="wrap flex flex-col gap-10 md:gap-12 pt-8 md:pt-12 pb-20">
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] gap-8 lg:gap-12 items-center">
          <div className="flex flex-col gap-5">
            <h1 className="m-0 font-display font-black text-[38px] md:text-[56px] leading-[1.02] tracking-[-0.03em]">
              Launch a token that <span className="text-accent">pays its stakers.</span>
            </h1>
            <p className="m-0 text-[17px] md:text-lg text-muted leading-relaxed max-w-xl">
              Most of every trading fee buys up to ten tokens the creator picks and pays them to the token's stakers.
              Lock longer for a bigger share.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/launch" className="font-display font-bold text-ground bg-accent glow-accent rounded-full px-6 min-h-12 flex items-center">Launch a token</Link>
              <Link href="/docs" className="font-display font-bold rounded-full px-6 min-h-12 flex items-center bg-raised-2 border border-white/10">How it works</Link>
            </div>
            <BuyTicker />
          </div>
          <div className="flex flex-col gap-6 bg-surface border line rounded-[28px] p-6 md:p-7">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted">Fees set aside for stakers</span>
              <span className="font-display font-black text-[44px] md:text-[56px] leading-none tracking-tight text-accent">{usd(d.stats.stakersUsd)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-5 border-t line">
              {[["Volume today", usd(d.stats.volume24hUsd)], ["Volume all time", usd(d.stats.volumeAllUsd)], ["Tokens launched", fmtCompact(d.stats.launches)], ["Traders today", fmtCompact(d.stats.traders24h)]].map(([l, v]) => (
                <div key={l} className="flex flex-col gap-1">
                  <span className="text-[13px] text-muted">{l}</span>
                  <span className="font-display font-bold text-xl">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {card && <FeaturedCard c={card} links={platformLinks(card.mint, clusterOf(), launchedHere)} headline={text(s.featured.headline)} body={text(s.featured.body)} />}
        {!p.mint && <PrelaunchCard symbol={p.symbol} headline={text(s.featured.headline)} body={text(s.featured.body)} message={text(s.featured.prelaunch)} xUrl={xUrlOf(s)} />}

        <HomeGrid tabs={HOME_TABS} initial={d.tokens} nextOffset={d.nextOffset} />
      </main>
    </div>
  );
}
