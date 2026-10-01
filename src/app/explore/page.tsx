import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { fmtAgo, fmtCompact, shortAddr } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { iconsFor } from "@/web/server/icons";
import { quoteCoins } from "@/domain/quotes";
import { CoinStack, CoinTag } from "@/web/ui/CoinStack";
import { exploreTokens, type ExploreFilter, type ExploreSort } from "@/web/server/landing";

export const dynamic = "force-dynamic";

const SORTS: [ExploreSort, string][] = [["trending", "Trending"], ["mcap", "Market cap"], ["new", "New"], ["gainers", "Gainers"], ["graduating", "About to graduate"]];
const FILTERS: [ExploreFilter, string][] = [["all", "All"], ["live", "On the curve"], ["graduated", "Graduated"]];
const COLS = "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]";

const usd = (n: number | null) => (n === null ? "No trades" : `$${fmtCompact(n)}`);

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; filter?: string; graduated?: string }> }) {
  const p = await searchParams;
  const sort = (SORTS.find(([k]) => k === p.sort)?.[0] ?? "trending") as ExploreSort;
  const filter = (p.graduated === "1" ? "graduated" : FILTERS.find(([k]) => k === p.filter)?.[0] ?? "all") as ExploreFilter;
  const q = p.q?.trim() ?? "";
  const ctx = getContext();
  const tokens = await exploreTokens(ctx.sql, { sort, filter, q }, Date.now(), (m) => iconsFor(ctx.icons, m, quoteCoins()));
  const href = (o: { sort?: string; filter?: string }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("sort", o.sort ?? sort);
    if ((o.filter ?? filter) !== "all") sp.set("filter", o.filter ?? filter);
    return `/explore?${sp}`;
  };
  const pill = (on: boolean) => `px-4 min-h-10 flex items-center rounded-full text-sm font-semibold shrink-0 ${on ? "bg-raised-2 border border-white/10 text-ink" : "text-muted hover:text-ink"}`;

  return (
    <div className="flex-1 bg-launch">
      <Header active="explore" />
      <main className="flex flex-col gap-6 wrap pt-8 md:pt-12 pb-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <h1 className="m-0 font-display font-black text-[36px] md:text-[48px] tracking-[-0.03em] leading-none">Explore</h1>
          <form action="/explore" role="search" className="w-full md:w-96">
            <input type="hidden" name="sort" value={sort} />
            {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
            <input name="q" type="search" defaultValue={q} placeholder="Search by name, symbol or address" aria-label="Search tokens"
              className="w-full h-11 px-4 rounded-full bg-raised-2 border border-white/[0.08] focus:border-white/20 outline-none text-sm placeholder:text-faint" />
          </form>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <nav aria-label="Sort" className="flex gap-1 overflow-x-auto">
            {SORTS.map(([k, l]) => <Link key={k} href={href({ sort: k })} aria-current={sort === k ? "page" : undefined} className={pill(sort === k)}>{l}</Link>)}
          </nav>
          <nav aria-label="Filter" className="flex gap-1 overflow-x-auto">
            {FILTERS.map(([k, l]) => <Link key={k} href={href({ filter: k })} aria-current={filter === k ? "page" : undefined} className={pill(filter === k)}>{l}</Link>)}
          </nav>
        </div>

        {tokens.length === 0 ? (
          <div className="flex flex-col items-start gap-4 py-16 border-t line">
            <p className="m-0 text-lg text-muted">{q ? `Nothing matches "${q}".` : "Nothing here yet."}</p>
            <Link href="/launch" className="font-display font-bold text-ground bg-lime glow-lime rounded-full px-6 min-h-12 flex items-center">Launch a token</Link>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className={`hidden md:grid ${COLS} gap-6 pb-2 text-[12px] text-faint`}>
              <span>Token</span><span className="text-right">Market cap</span><span className="text-right">24h</span><span className="text-right">Volume 24h</span><span>Graduation</span><span>Stakers earn</span>
            </div>
            {tokens.map((t) => (
              <Link key={t.mint} href={`/t/${t.mint}`} className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-3 md:gap-6 items-center py-3.5 border-t line hover:bg-white/[0.02]`}>
                <span className="flex items-center gap-3 min-w-0">
                  <Avatar seed={t.mint} label={t.symbol} image={t.image} size={44} />
                  <span className="flex flex-col min-w-0">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="font-display font-bold text-lg truncate">{t.symbol}</span>
                      <span className="font-mono text-[12px] text-faint shrink-0">{fmtAgo(t.createdAt)}</span>
                    </span>
                    <span className="text-[13px] text-muted truncate flex items-center gap-1.5">{t.name ?? shortAddr(t.mint)} · <CoinTag coin={t.quote} size={14} /></span>
                  </span>
                </span>
                <span className="flex flex-col items-end font-mono text-sm md:hidden">
                  <span>{usd(t.mcapUsd)}</span>
                  {t.price !== null && <span className={`text-[12px] ${t.change24h >= 0 ? "text-lime" : "text-burn"}`}>{t.change24h >= 0 ? "+" : ""}{t.change24h.toFixed(1)}%</span>}
                </span>
                <span className="hidden md:block text-right font-mono text-sm">{usd(t.mcapUsd)}</span>
                <span className={`hidden md:block text-right font-mono text-sm ${t.change24h >= 0 ? "text-lime" : "text-burn"}`}>{t.price === null ? "" : `${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(1)}%`}</span>
                <span className="hidden md:block text-right font-mono text-sm">{t.volume24hUsd ? `$${fmtCompact(t.volume24hUsd)}` : "$0"}</span>
                <span className="hidden md:flex flex-col gap-1.5">
                  {t.status === "graduated" ? <span className="text-sm font-semibold text-lime">Graduated</span> : (
                    <>
                      <span className="font-mono text-[12px] text-muted">{t.progress ?? 0}%</span>
                      <span className="inline-flex h-1.5 w-full max-w-32 rounded-full bg-white/[0.07] overflow-hidden">
                        <span className="rounded-full" style={{ width: `${t.progress ?? 0}%`, background: "linear-gradient(90deg, #9D8CFF, #C8FF3D)" }} />
                      </span>
                    </>
                  )}
                </span>
                <span className="hidden md:flex text-sm min-w-0"><CoinStack coins={t.basket} /></span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
