import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { fmtCompact, fmtPrice } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { allQuotes, quoteIcons } from "@/web/server/quotes";
import { HOME_TABS, landing, type Featured } from "@/web/server/landing";
import { HomeGrid } from "@/web/home/HomeGrid";
import { BuyTicker } from "@/web/home/BuyTicker";
import { Change } from "@/web/home/TokenCard";

export const dynamic = "force-dynamic";

const usd = (n: number | null) => (n === null ? "No price" : `$${fmtCompact(n)}`);

function FeaturedToken({ f }: { f: Featured }) {
  const t = f.token;
  return (
    <section aria-label="Featured" className="rounded-2xl border border-accent/35 bg-surface">
      <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-8 px-5 py-5 md:px-7 md:py-6">
        <div className="flex items-center gap-4 min-w-0 md:flex-1">
          <img src="/brand/quants-mark.svg" alt="" width={64} height={64} className="w-16 h-16 shrink-0" />
          <span className="flex flex-col gap-1 min-w-0">
            <span className="flex items-center gap-2.5">
              <span className="font-display font-black text-2xl tracking-tight">{f.symbol}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent text-ground">Featured</span>
            </span>
            <span className="text-sm text-muted">The quants platform token. Pair a launch with it, or trade the tokens paired with it.</span>
          </span>
        </div>
        {t && (
          <div className="grid grid-cols-3 gap-5 md:gap-8 md:w-[380px] shrink-0 font-display font-bold text-[17px] tabular-nums">
            <span className="flex flex-col gap-1"><span className="font-sans font-normal text-[12px] text-faint">Price</span><span>{t.priceUsd === null ? "No trades" : `$${fmtPrice(t.priceUsd)}`}</span></span>
            <span className="flex flex-col gap-1"><span className="font-sans font-normal text-[12px] text-faint">Market cap</span><span>{usd(t.mcapUsd)}</span></span>
            <span className="flex flex-col gap-1"><span className="font-sans font-normal text-[12px] text-faint">24h</span><Change value={t.change24h} traded={t.price !== null} /></span>
          </div>
        )}
        <div className="flex flex-wrap gap-2.5 shrink-0">
          {t && <Link href={`/t/${t.mint}`} className="font-display font-bold text-ground bg-accent rounded-full px-5 min-h-11 flex items-center">Trade {f.symbol}</Link>}
          <Link href={`/explore?quote=${f.mint}`} className="font-display font-bold rounded-full px-5 min-h-11 flex items-center bg-raised-2 border border-white/10">
            {f.symbol} pairs{f.pairs > 0 && <span className="ml-2 font-mono font-normal text-sm text-muted">{f.pairs}</span>}
          </Link>
        </div>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const ctx = getContext();
  const d = await landing(ctx.sql, Date.now(), async (m) => quoteIcons(ctx, m, await allQuotes(ctx)));
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

        {d.featured && <FeaturedToken f={d.featured} />}

        <HomeGrid tabs={HOME_TABS} initial={d.tokens} nextOffset={d.nextOffset} />
      </main>
    </div>
  );
}
