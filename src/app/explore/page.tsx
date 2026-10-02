import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { getContext } from "@/web/server/context";
import { allQuotes, quoteIcons } from "@/web/server/quotes";
import { ExploreList } from "@/web/explore/ExploreList";
import { exploreTokens, withSparks, type ExploreFilter, type ExploreSort } from "@/web/server/landing";

export const dynamic = "force-dynamic";

const SORTS: [ExploreSort, string][] = [["trending", "Trending"], ["mcap", "Market cap"], ["new", "New"], ["gainers", "Gainers"], ["graduating", "About to graduate"]];
const FILTERS: [ExploreFilter, string][] = [["all", "All"], ["live", "On the curve"], ["graduated", "Graduated"]];
const PAGE = 30;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; filter?: string; graduated?: string; quote?: string }> }) {
  const p = await searchParams;
  const sort = (SORTS.find(([k]) => k === p.sort)?.[0] ?? "trending") as ExploreSort;
  const filter = (p.graduated === "1" ? "graduated" : FILTERS.find(([k]) => k === p.filter)?.[0] ?? "all") as ExploreFilter;
  const q = p.q?.trim().slice(0, 100) ?? "";
  const ctx = getContext();
  const quotes = await allQuotes(ctx);
  const pair = quotes.find((c) => c.mint === p.quote);
  const now = Date.now();
  const rows = await exploreTokens(ctx.sql, { sort, filter, q, quote: pair?.mint, limit: PAGE + 1 }, now, (m) => quoteIcons(ctx, m, quotes));
  const tokens = await withSparks(ctx.sql, rows.slice(0, PAGE), now);
  const nextOffset = rows.length > PAGE ? PAGE : null;
  const href = (o: { sort?: string; filter?: string }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (pair) sp.set("quote", pair.mint);
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
          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-display font-black text-[36px] md:text-[48px] tracking-[-0.03em] leading-none">Explore</h1>
            {pair && <p className="m-0 text-muted">Tokens paired with {pair.symbol}. <Link href="/explore" className="text-accent">Show all</Link></p>}
          </div>
          <form action="/explore" role="search" className="w-full md:w-96">
            <input type="hidden" name="sort" value={sort} />
            {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
            {pair && <input type="hidden" name="quote" value={pair.mint} />}
            <input name="q" type="search" defaultValue={q} placeholder="Search by name, symbol or address" aria-label="Search tokens"
              className="w-full h-11 px-4 rounded-full bg-raised-2 border border-white/[0.08] focus:border-white/20 outline-none text-sm placeholder:text-faint" />
          </form>
        </div>

        <div className="flex md:items-center justify-between gap-3 max-md:gap-1 max-md:overflow-x-auto max-md:-mx-4 max-md:px-4 no-scrollbar">
          <nav aria-label="Sort" className="flex gap-1 shrink-0 md:shrink md:overflow-x-auto">
            {SORTS.map(([k, l]) => <Link key={k} href={href({ sort: k })} aria-current={sort === k ? "page" : undefined} className={pill(sort === k)}>{l}</Link>)}
          </nav>
          <span aria-hidden className="md:hidden w-px my-2.5 bg-white/10 shrink-0" />
          <nav aria-label="Filter" className="flex gap-1 shrink-0 md:shrink md:overflow-x-auto">
            {FILTERS.map(([k, l]) => <Link key={k} href={href({ filter: k })} aria-current={filter === k ? "page" : undefined} className={pill(filter === k)}>{l}</Link>)}
          </nav>
        </div>

        {tokens.length === 0 ? (
          <div className="flex flex-col items-start gap-4 py-16 border-t line">
            <p className="m-0 text-lg text-muted">{q ? `Nothing matches "${q}".` : "Nothing here yet."}</p>
            <Link href="/launch" className="font-display font-bold text-ground bg-accent glow-accent rounded-full px-6 min-h-12 flex items-center">Launch a token</Link>
          </div>
        ) : (
          <ExploreList key={`${sort}:${filter}:${q}:${pair?.mint ?? ""}`} initial={tokens} nextOffset={nextOffset} query={{ sort, filter, q, ...(pair ? { quote: pair.mint } : {}) }} />
        )}
      </main>
    </div>
  );
}
