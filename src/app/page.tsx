import Link from "next/link";
import type { ReactNode } from "react";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { fmtAgo, fmtCompact, fmtPrice, shortAddr } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { landing, type TokenRow } from "@/web/server/landing";

export const dynamic = "force-dynamic";

const usd = (n: number | null) => (n === null ? "No price" : `$${fmtCompact(n)}`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5 py-5 md:py-0 md:px-6 first:md:pl-0 border-t md:border-t-0 md:border-l first:md:border-l-0 line">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-display font-bold text-2xl md:text-[28px] tracking-tight">{value}</span>
    </div>
  );
}

function List({ title, href, empty, children }: { title: string; href: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="flex flex-col min-w-0">
      <div className="flex items-baseline justify-between pb-3">
        <h2 className="m-0 font-display font-bold text-xl">{title}</h2>
        <Link href={href} className="text-sm text-muted hover:text-ink">See all</Link>
      </div>
      {children.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">{empty}</p> : children}
    </section>
  );
}

function TokenLine({ t, right, sub }: { t: TokenRow; right: ReactNode; sub: ReactNode }) {
  return (
    <Link href={`/t/${t.mint}`} className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3.5 items-center py-3 border-t line hover:bg-white/[0.02]">
      <Avatar seed={t.mint} label={t.symbol} image={t.image} size={40} />
      <span className="flex flex-col min-w-0">
        <span className="font-display font-bold truncate">{t.symbol}</span>
        <span className="text-[13px] text-muted truncate">{t.name ?? shortAddr(t.mint)}</span>
      </span>
      <span className="flex flex-col items-end gap-0.5 text-right">
        <span className="font-mono text-sm">{right}</span>
        <span className="font-mono text-[12px] text-muted">{sub}</span>
      </span>
    </Link>
  );
}

const change = (c: number) => <span className={c >= 0 ? "text-lime" : "text-burn"}>{c >= 0 ? "+" : ""}{c.toFixed(1)}%</span>;

export default async function HomePage() {
  const d = await landing(getContext().sql);
  return (
    <div className="flex-1 bg-launch">
      <Header active="home" />
      <main className="wrap flex flex-col gap-14 md:gap-20 pt-12 md:pt-20 pb-20">
        <section className="flex flex-col gap-7 max-w-5xl">
          <h1 className="m-0 font-display font-black text-[44px] md:text-[80px] leading-[0.98] tracking-[-0.035em]">
            Launch a token.<br /><span className="text-lime">Stakers earn three.</span>
          </h1>
          <p className="m-0 text-lg md:text-xl text-muted leading-relaxed max-w-2xl">
            Every trade pays a fee. Most of it buys up to three tokens the creator picks, and those go to the people staking the launched token.
            Stake longer to earn a bigger share.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/launch" className="font-display font-bold text-ground bg-lime glow-lime rounded-full px-7 min-h-13 flex items-center">Launch a token</Link>
            <Link href="/explore" className="font-display font-bold rounded-full px-7 min-h-13 flex items-center bg-raised-2 border border-white/10">Explore tokens</Link>
            <Link href="/docs" className="font-display font-bold rounded-full px-5 min-h-13 flex items-center text-muted hover:text-ink">How it works</Link>
          </div>
        </section>

        <section aria-label="Platform numbers" className="grid grid-cols-2 md:grid-cols-5 gap-x-6 md:gap-x-0 md:py-6 md:border-y line">
          <Stat label="Tokens launched" value={fmtCompact(d.stats.launches)} />
          <Stat label="Graduated" value={fmtCompact(d.stats.graduated)} />
          <Stat label="Volume today" value={usd(d.stats.volume24hUsd)} />
          <Stat label="Volume all time" value={usd(d.stats.volumeAllUsd)} />
          <Stat label="Traders today" value={fmtCompact(d.stats.traders24h)} />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-16 gap-y-14">
          <List title="Biggest" href="/explore" empty="No trades yet.">
            {d.biggest.map((t) => <TokenLine key={t.mint} t={t} right={usd(t.mcapUsd)} sub={<>{change(t.change24h)} today</>} />)}
          </List>
          <List title="Top gainers today" href="/explore" empty="Nothing is up today yet.">
            {d.gainers.map((t) => <TokenLine key={t.mint} t={t} right={change(t.change24h)} sub={t.priceUsd === null ? "" : `$${fmtPrice(t.priceUsd)}`} />)}
          </List>
          <List title="Closest to graduating" href="/explore" empty="Nothing on the curve has traded yet.">
            {d.closest.map((t) => (
              <TokenLine key={t.mint} t={t} right={`${t.progress}%`} sub={
                <span className="inline-flex h-1.5 w-24 rounded-full bg-white/[0.07] overflow-hidden align-middle">
                  <span className="rounded-full" style={{ width: `${t.progress}%`, background: "linear-gradient(90deg, #9D8CFF, #C8FF3D)" }} />
                </span>
              } />
            ))}
          </List>
          <List title="Newest" href="/explore" empty="Nothing launched yet.">
            {d.newest.map((t) => <TokenLine key={t.mint} t={t} right={t.mcapUsd === null ? "No trades" : usd(t.mcapUsd)} sub={fmtAgo(t.createdAt)} />)}
          </List>
        </div>

        <section className="flex flex-col">
          <h2 className="m-0 pb-3 font-display font-bold text-xl">Recent trades</h2>
          {d.recent.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">No trades yet.</p> : d.recent.map((t) => (
            <Link key={`${t.signature}:${t.eventIndex}`} href={`/t/${t.mint}`} className="grid grid-cols-[64px_minmax(0,1fr)_auto] md:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_120px] gap-3 md:gap-6 items-center py-3 border-t line hover:bg-white/[0.02] text-sm">
              <span className={`font-semibold ${t.side === "buy" ? "text-lime" : "text-burn"}`}>{t.side === "buy" ? "Buy" : "Sell"}</span>
              <span className="font-display font-bold truncate">{t.symbol}</span>
              <span className="hidden md:block font-mono text-muted truncate">{shortAddr(t.trader)}</span>
              <span className="flex flex-col items-end font-mono">
                <span>{t.valueUsd === null ? "" : `$${fmtPrice(t.valueUsd)}`}</span>
                <span className="text-[12px] text-muted">{fmtAgo(t.at)}</span>
              </span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
