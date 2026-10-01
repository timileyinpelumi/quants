"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LoadMore, getJson, usePaged } from "@/web/ui/LoadMore";
import type { TokenRow } from "@/web/server/landing";
import { TokenCard } from "./TokenCard";

type Tab = { key: string; label: string; sort: string; filter: string };
const PAGE = 24;
const EMPTY: Record<string, string> = {
  trending: "Nothing launched yet.",
  bonding: "Nothing is on the bonding curve right now.",
  new: "Nothing launched yet.",
  graduating: "Nothing on the curve has traded yet.",
  graduated: "Nothing has graduated yet.",
};

function Grid({ tab, initial, nextOffset }: { tab: Tab; initial: TokenRow[] | null; nextOffset: number | null }) {
  const paged = usePaged(initial ?? [], initial ? nextOffset : 0, async (offset) => {
    const sp = new URLSearchParams({ sort: tab.sort, filter: tab.filter, offset: String(offset), limit: String(PAGE) });
    const r = await getJson<{ tokens: TokenRow[]; nextOffset: number | null }>(`/api/explore?${sp}`);
    return { items: r.tokens, next: r.nextOffset };
  }, (t) => t.mint);
  const first = initial === null && paged.pages === 0;
  useEffect(() => { if (initial === null) paged.more(); }, []);

  if (first) {
    return paged.state === "error" ? (
      <div className="flex flex-col items-start gap-3 py-10">
        <p role="alert" className="m-0 text-burn text-sm">Could not load tokens.</p>
        <button type="button" onClick={paged.more} className="text-sm font-semibold text-accent cursor-pointer min-h-11">Try again</button>
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[248px] rounded-3xl bg-surface border border-white/[0.05] animate-pulse" />)}
      </div>
    );
  }
  if (paged.items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 py-12 border-t line">
        <p className="m-0 text-muted">{EMPTY[tab.key] ?? "Nothing here yet."}</p>
        <Link href="/launch" className="font-display font-bold text-ground bg-accent glow-accent rounded-full px-6 min-h-12 flex items-center">Launch a token</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {paged.items.map((t) => <TokenCard key={t.mint} t={t} />)}
      </div>
      <LoadMore auto done={paged.done} state={paged.state} onMore={paged.more} doneText={paged.pages > 0 ? "No more tokens" : undefined} />
    </div>
  );
}

export function HomeGrid({ tabs, initial, nextOffset }: { tabs: Tab[]; initial: TokenRow[]; nextOffset: number | null }) {
  const [tab, setTab] = useState(tabs[0]!.key);
  const current = tabs.find((t) => t.key === tab)!;
  return (
    <section className="flex flex-col gap-5" aria-label="Tokens">
      <div className="flex items-center justify-between gap-4">
        <div role="tablist" aria-label="Token lists" className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`px-4 min-h-10 rounded-full text-sm font-semibold shrink-0 cursor-pointer ${tab === t.key ? "bg-raised-2 border border-white/10 text-ink" : "text-muted hover:text-ink"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <Link href={`/explore?sort=${current.sort === "active" ? "trending" : current.sort}${current.filter !== "all" ? `&filter=${current.filter}` : ""}`} className="hidden sm:flex text-sm text-muted hover:text-ink shrink-0 min-h-10 items-center">Explore all</Link>
      </div>
      <Grid key={tab} tab={current} initial={tab === tabs[0]!.key ? initial : null} nextOffset={nextOffset} />
    </section>
  );
}
