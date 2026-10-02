import Link from "next/link";
import { changeTone, fmtAgo, fmtChange, fmtCompact, fmtPrice } from "@/web/ui/format";
import { Avatar } from "@/web/ui/Avatar";
import type { PlatformCard } from "@/web/server/platform-token";

const money = (n: number) => `$${fmtCompact(n)}`;
const moneyOr = (n: number, none: string) => (n > 0 ? money(n) : none);

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[12px] text-faint">{label}</span>
      <span className="font-display font-bold text-xl md:text-[22px] leading-none tabular-nums truncate">{children}</span>
    </span>
  );
}

export function FeaturedCard({ c, links, headline, body }: { c: PlatformCard; links: { buy: string; buyExternal: boolean; launch: string }; headline: string; body: string }) {
  const market: [string, React.ReactNode][] = [];
  if (c.priceUsd !== null) market.push(["Price", `$${fmtPrice(c.priceUsd)}`]);
  if (c.mcapUsd !== null) market.push(["Market cap", money(c.mcapUsd)]);
  if (c.volume24hUsd !== null) market.push(["Vol 24h", money(c.volume24hUsd)]);
  if (c.change24h !== null) market.push(["24h", <span key="c" className={changeTone(c.change24h)}>{fmtChange(c.change24h)}</span>]);
  const p = c.pairs;
  const pairs: [string, string][] = [
    ["Tokens paired", fmtCompact(p.pairs)],
    ["Pair volume 24h", moneyOr(p.volume24hUsd, "None today")],
    ["Pair volume all time", moneyOr(p.volumeAllUsd, "None yet")],
    ["Paid to stakers", moneyOr(p.stakersUsd, "None yet")],
  ];
  const buy = "font-display font-bold rounded-full px-6 min-h-12 flex items-center justify-center bg-ground text-ink hover:bg-black";
  return (
    <section aria-label="Featured" data-featured className="rounded-[28px] overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] border border-accent">
      <div className="flex flex-col gap-6 bg-accent text-ground p-6 md:p-8">
        <div className="flex items-center gap-4 min-w-0">
          <img src="/brand/quants-icon-tile.svg" alt="" width={64} height={64} className="w-14 h-14 md:w-16 md:h-16 rounded-2xl shrink-0" />
          <span className="flex flex-col gap-1.5 min-w-0">
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="font-display font-black text-[32px] md:text-[40px] leading-none tracking-tight truncate">{c.symbol}</span>
              <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-ground text-accent shrink-0">Featured</span>
            </span>
            <span className="text-sm font-semibold opacity-75">The {c.name} platform token</span>
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <p className="m-0 font-display font-black text-[24px] md:text-[30px] leading-[1.08] tracking-[-0.02em]">{headline}</p>
          {body && <p className="m-0 text-[15px] leading-relaxed font-medium opacity-80 max-w-lg">{body}</p>}
        </div>
        <div className="flex flex-wrap gap-2.5 mt-auto">
          {links.buyExternal
            ? <a href={links.buy} target="_blank" rel="noreferrer" className={buy}>Buy {c.symbol}</a>
            : <Link href={links.buy} className={buy}>Buy {c.symbol}</Link>}
          <Link href={links.launch} className="font-display font-bold rounded-full px-6 min-h-12 flex items-center justify-center border-2 border-ground hover:bg-ground/10">Launch with {c.symbol}</Link>
        </div>
      </div>
      <div className="flex flex-col gap-6 bg-surface p-6 md:p-8">
        {market.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-5 pb-6 border-b line">
            {market.map(([l, v]) => <Stat key={l} label={l}>{v}</Stat>)}
          </div>
        )}
        <div className="flex flex-col gap-5 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 font-display font-bold text-lg">{c.symbol} pairs</h2>
            {p.pairs > 0 && <Link href={`/explore?quote=${c.mint}`} className="text-sm font-semibold text-accent hover:text-ink min-h-11 flex items-center">See all pairs</Link>}
          </div>
          {p.pairs === 0 ? (
            <div data-no-pairs className="flex-1 flex flex-col justify-center gap-3 rounded-2xl border border-dashed border-white/15 p-6 md:p-8">
              <span className="font-display font-black text-[30px] md:text-[38px] leading-none tracking-tight">No pairs yet</span>
              <p className="m-0 text-[15px] text-muted leading-relaxed max-w-md">Be the first to launch with {c.symbol} as the pair. Your curve fills in {c.symbol}, so every buy of your token is a buy of {c.symbol}.</p>
              <Link href={links.launch} className="self-start text-[15px] font-semibold text-accent hover:text-ink min-h-11 flex items-center">Launch the first {c.symbol} pair</Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px rounded-2xl overflow-hidden bg-white/[0.07] border line">
                {pairs.map(([l, v]) => (
                  <div key={l} className="bg-surface flex flex-col gap-2 p-4 md:p-5 min-w-0">
                    <span className="text-[12px] text-faint">{l}</span>
                    <span className="font-display font-black text-[24px] md:text-[32px] leading-none tracking-tight tabular-nums truncate">{v}</span>
                  </div>
                ))}
              </div>
              {c.recent.length > 0 && (
                <div className="flex flex-col mt-auto">
                  <span className="text-[12px] text-faint pb-1.5">Newest {c.symbol} pairs</span>
                  {c.recent.map((r) => (
                    <Link key={r.mint} href={`/t/${r.mint}`} className="flex items-center gap-3 min-h-11 py-1.5 border-t line hover:text-accent">
                      <Avatar seed={r.mint} label={r.symbol ?? "?"} size={28} image={r.image} />
                      <span className="font-mono font-semibold truncate">{r.symbol ?? r.mint.slice(0, 6)}</span>
                      <span className="ml-auto text-sm text-muted shrink-0">{fmtAgo(r.createdAt)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
