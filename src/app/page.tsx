import Link from "next/link";
import type { ReactNode } from "react";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { fmtAgo, fmtCompact, fmtPrice, shortAddr } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { iconsFor } from "@/web/server/icons";
import { quoteCoins } from "@/domain/quotes";
import { CoinStack, CoinTag } from "@/web/ui/CoinStack";
import { landing, type TokenRow } from "@/web/server/landing";

export const dynamic = "force-dynamic";

const SOL = "So11111111111111111111111111111111111111112";

const usd = (n: number | null) => (n === null ? "No price" : `$${fmtCompact(n)}`);
const change = (c: number) => <span className={c >= 0 ? "text-lime" : "text-burn"}>{c >= 0 ? "+" : ""}{c.toFixed(1)}%</span>;

function Progress({ value }: { value: number }) {
  return (
    <span className="inline-flex h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden">
      <span className="rounded-full" style={{ width: `${value}%`, background: "linear-gradient(90deg, #9D8CFF, #C8FF3D)" }} />
    </span>
  );
}

function Column({ title, href, empty, rows, right }: { title: string; href: string; empty: string; rows: TokenRow[]; right: (t: TokenRow) => ReactNode }) {
  return (
    <section className="flex flex-col min-w-0">
      <div className="flex items-baseline justify-between pb-3">
        <h2 className="m-0 font-display font-bold text-lg">{title}</h2>
        <Link href={href} className="text-sm text-muted hover:text-ink">See all</Link>
      </div>
      {rows.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">{empty}</p> : rows.map((t) => (
        <Link key={t.mint} href={`/t/${t.mint}`} className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 items-center py-3 border-t line hover:bg-white/[0.02]">
          <Avatar seed={t.mint} label={t.symbol} image={t.image} size={40} />
          <span className="flex flex-col min-w-0 gap-0.5">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="font-display font-bold truncate">{t.symbol}</span>
              <span className="font-mono text-[12px] text-faint shrink-0">{fmtAgo(t.createdAt)}</span>
            </span>
            <span className="text-[12px] text-muted truncate flex items-center gap-1.5">Earns <CoinStack coins={t.basket} size={14} max={3} /></span>
          </span>
          <span className="flex flex-col items-end gap-1 font-mono text-sm min-w-[84px]">{right(t)}</span>
        </Link>
      ))}
    </section>
  );
}

export default async function HomePage() {
  const ctx = getContext();
  const d = await landing(ctx.sql, Date.now(), (m) => iconsFor(ctx.icons, m, quoteCoins()));
  return (
    <div className="flex-1 bg-launch">
      <Header active="home" />
      <main className="wrap flex flex-col gap-12 md:gap-16 pt-8 md:pt-12 pb-20">
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] gap-8 lg:gap-12 items-center">
          <div className="flex flex-col gap-5">
            <h1 className="m-0 font-display font-black text-[38px] md:text-[56px] leading-[1.02] tracking-[-0.03em]">
              Launch a token that <span className="text-lime">pays its stakers.</span>
            </h1>
            <p className="m-0 text-[17px] md:text-lg text-muted leading-relaxed max-w-xl">
              Most of every trading fee buys up to ten tokens the creator picks, and pays them to the people who stake the launched token.
              Lock longer for a bigger share.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/launch" className="font-display font-bold text-ground bg-lime glow-lime rounded-full px-6 min-h-12 flex items-center">Launch a token</Link>
              <Link href="/docs" className="font-display font-bold rounded-full px-6 min-h-12 flex items-center bg-raised-2 border border-white/10">How it works</Link>
            </div>
          </div>
          <div className="flex flex-col gap-6 bg-surface border line rounded-[28px] p-6 md:p-7">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted">Fees set aside for stakers</span>
              <span className="font-display font-black text-[44px] md:text-[56px] leading-none tracking-tight text-lime">{usd(d.stats.stakersUsd)}</span>
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

        <section className="flex flex-col">
          <div className="flex items-baseline justify-between pb-3">
            <h2 className="m-0 font-display font-bold text-xl">Trending today</h2>
            <Link href="/explore" className="text-sm text-muted hover:text-ink">Explore all</Link>
          </div>
          <div className="hidden md:grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-6 pb-2 text-[12px] text-faint">
            <span>#</span><span>Token</span><span className="text-right">Market cap</span><span className="text-right">24h</span><span className="text-right">Volume 24h</span><span>Stakers earn</span>
          </div>
          {d.trending.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">No trades today yet.</p> : d.trending.map((t, i) => (
            <Link key={t.mint} href={`/t/${t.mint}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 md:gap-6 items-center py-3 border-t line hover:bg-white/[0.02]">
              <span className="font-mono text-sm text-faint">{i + 1}</span>
              <span className="flex items-center gap-3 min-w-0">
                <Avatar seed={t.mint} label={t.symbol} image={t.image} size={40} />
                <span className="flex flex-col min-w-0">
                  <span className="font-display font-bold truncate">{t.symbol}</span>
                  <span className="text-[12px] text-muted truncate flex items-center gap-1.5">{t.name ?? shortAddr(t.mint)} · <CoinTag coin={t.quote} size={12} /></span>
                </span>
              </span>
              <span className="flex flex-col items-end font-mono text-sm md:hidden">
                <span>{usd(t.mcapUsd)}</span>
                <span className="text-[12px]">{change(t.change24h)}</span>
              </span>
              <span className="hidden md:block text-right font-mono text-sm">{usd(t.mcapUsd)}</span>
              <span className="hidden md:block text-right font-mono text-sm">{change(t.change24h)}</span>
              <span className="hidden md:block text-right font-mono text-sm">{usd(t.volume24hUsd)}</span>
              <span className="hidden md:flex text-sm min-w-0"><CoinStack coins={t.basket} /></span>
            </Link>
          ))}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-10 gap-y-12">
          <Column title="New" href="/explore?sort=new" empty="Nothing launched yet." rows={d.newest}
            right={(t) => <><span>{t.mcapUsd === null ? "No trades" : usd(t.mcapUsd)}</span><span className="text-[12px] text-muted">market cap</span></>} />
          <Column title="About to graduate" href="/explore?sort=graduating" empty="Nothing on the curve has traded yet." rows={d.soon}
            right={(t) => <><span>{t.progress}%</span><span className="w-20"><Progress value={t.progress ?? 0} /></span></>} />
          <Column title="Graduated" href="/explore?filter=graduated" empty="Nothing has graduated yet." rows={d.graduated}
            right={(t) => <><span>{usd(t.mcapUsd)}</span><span className="text-[12px]">{change(t.change24h)}</span></>} />
        </div>

        <section className="flex flex-col">
          <h2 className="m-0 pb-3 font-display font-bold text-xl">Latest trades</h2>
          {d.recent.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">No trades yet.</p> : d.recent.map((t) => (
            <Link key={`${t.signature}:${t.eventIndex}`} href={`/t/${t.mint}`} className="grid grid-cols-[56px_minmax(0,1fr)_auto] md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_120px] gap-3 md:gap-6 items-center py-3 border-t line hover:bg-white/[0.02] text-sm">
              <span className={`font-semibold ${t.side === "buy" ? "text-lime" : "text-burn"}`}>{t.side === "buy" ? "Buy" : "Sell"}</span>
              <span className="font-display font-bold truncate">{t.symbol}</span>
              <span className="hidden md:block font-mono text-muted truncate">{shortAddr(t.trader)}</span>
              <span className="flex flex-col items-end font-mono">
                <span>{t.valueUsd === null ? `${fmtPrice(t.quoteValue)} ${t.quoteMint === SOL ? "SOL" : process.env.NEXT_PUBLIC_OURTOKEN_SYMBOL ?? "OURTOKEN"}` : `$${fmtPrice(t.valueUsd)}`}</span>
                <span className="text-[12px] text-muted">{fmtAgo(t.at)}</span>
              </span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
