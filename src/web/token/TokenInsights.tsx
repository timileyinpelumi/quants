"use client";
import { useEffect, useState } from "react";
import type { TradeRow } from "@/web/server/landing";
import type { Trader } from "@/web/server/live";
import { LoadMore, getJson } from "@/web/ui/LoadMore";
import { changeTone, fmtAgo, fmtChange, fmtCompact, fmtPrice, shortAddr } from "@/web/ui/format";
import { Jazzicon } from "@/web/ui/Jazzicon";
import { useTokenLive } from "./TokenLive";

const TABS = ["Trades", "Activity", "Top traders", "Holders"] as const;
type Tab = (typeof TABS)[number];

// the live endpoint carries this many of each
const LIVE_TRADES = 25;
const LIVE_TRADERS = 10;
type LoadState = "idle" | "loading" | "error";

function mergeTrades(...lists: TradeRow[][]): TradeRow[] {
  const m = new Map<string, TradeRow>();
  for (const l of lists) for (const t of l) m.set(`${t.signature}:${t.eventIndex}`, t);
  return [...m.values()].sort((a, b) => b.slot - a.slot || b.seq - a.seq);
}

const solscan = (path: string) => `https://solscan.io/${path}`;
const ago = (iso: string) => { const a = fmtAgo(iso); return a === "just now" ? "now" : a.replace(" ago", ""); };
const TRADE_COLS = "grid-cols-[44px_36px_minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[56px_44px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,168px)]";

function Wallet({ address, tag }: { address: string; tag?: string | null }) {
  return (
    <a href={solscan(`account/${address}`)} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 text-muted hover:text-ink">
      <Jazzicon address={address} size={18} />
      <span className="font-mono truncate">{shortAddr(address)}</span>
      {tag && <span className="font-sans text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet/15 text-violet-light shrink-0">{tag}</span>}
    </a>
  );
}

function Bar({ buy, sell }: { buy: number; sell: number }) {
  const total = buy + sell || 1;
  return (
    <span className="flex h-1.5 w-full rounded-full overflow-hidden bg-white/[0.07]">
      <span className="bg-up" style={{ width: `${(buy / total) * 100}%` }} />
      <span className="bg-down" style={{ width: `${(sell / total) * 100}%` }} />
    </span>
  );
}

export function TokenInsights({ mint, symbol, quoteSymbol }: { mint: string; symbol: string; quoteSymbol: string }) {
  const live = useTokenLive();
  const [tab, setTab] = useState<Tab>("Trades");
  const [win, setWin] = useState("24h");
  const [older, setOlder] = useState<TradeRow[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const [olderState, setOlderState] = useState<LoadState>("idle");
  const [moreTraders, setMoreTraders] = useState<Trader[]>([]);
  const [tradersNext, setTradersNext] = useState<number | null>(LIVE_TRADERS);
  const [tradersState, setTradersState] = useState<LoadState>("idle");

  // once paging back, keep every live snapshot so trades that scroll out of the newest 25 stay listed
  useEffect(() => {
    const t = live?.trades;
    if (t) setOlder((o) => (o.length ? mergeTrades(o, t) : o));
  }, [live]);

  const liveTrades = live?.trades ?? [];
  const trades = older.length ? mergeTrades(liveTrades, older) : liveTrades;
  const liveWallets = new Set((live?.traders ?? []).map((t) => t.wallet));
  const traders = [...(live?.traders ?? []), ...moreTraders.filter((t) => !liveWallets.has(t.wallet))];

  async function loadOlder() {
    const last = trades.at(-1);
    if (!last || olderState === "loading") return;
    setOlderState("loading");
    try {
      const r = await getJson<{ trades: TradeRow[]; next: string | null }>(`/api/trades/${mint}?before=${last.slot}:${last.seq}&limit=${LIVE_TRADES}`);
      setOlder((o) => mergeTrades(o, liveTrades, r.trades));
      if (!r.next) setOlderDone(true);
      setOlderState("idle");
    } catch {
      setOlderState("error");
    }
  }

  async function loadTraders() {
    if (tradersNext === null || tradersState === "loading") return;
    setTradersState("loading");
    try {
      const r = await getJson<{ traders: Trader[]; nextOffset: number | null }>(`/api/token/${mint}/traders?offset=${tradersNext}&limit=${LIVE_TRADERS}`);
      setMoreTraders((m) => [...m, ...r.traders.filter((t) => !m.some((x) => x.wallet === t.wallet))]);
      setTradersNext(r.nextOffset);
      setTradersState("idle");
    } catch {
      setTradersState("error");
    }
  }
  const usd = live?.quoteUsd ?? null;
  const value = (q: number) => (usd !== null ? `$${fmtPrice(q * usd)}` : `${fmtPrice(q)} ${quoteSymbol}`);
  const compact = (q: number) => (usd !== null ? `$${fmtCompact(q * usd)}` : `${fmtCompact(q)} ${quoteSymbol}`);
  const stakers = new Set((live?.holders?.list ?? []).filter((h) => h.label === "Staked").map((h) => h.owner));
  const big = (live?.trades ?? []).map((t) => t.quoteValue).sort((a, b) => b - a)[2] ?? Infinity;
  const tagFor = (wallet: string) => (wallet === live?.creator ? "Creator" : stakers.has(wallet) ? "Staker" : null);
  const a = live?.activity.find((x) => x.window === win);

  return (
    <section id="insights" className="flex flex-col gap-4 scroll-mt-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <nav aria-label="Token insights" className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
              className={`px-4 min-h-10 rounded-full text-sm font-semibold shrink-0 cursor-pointer ${tab === t ? "bg-raised-2 border border-white/10 text-ink" : "text-muted hover:text-ink"}`}>{t}</button>
          ))}
        </nav>
        {tab === "Activity" && (
          <div className="flex gap-1 font-mono text-[13px]">
            {live?.activity.map((x) => (
              <button key={x.window} type="button" aria-pressed={win === x.window} onClick={() => setWin(x.window)}
                className={`px-3 min-h-9 rounded-full cursor-pointer ${win === x.window ? "bg-raised-2 border border-white/10 text-ink" : "text-muted"}`}>{x.window}</button>
            ))}
          </div>
        )}
      </div>

      {tab === "Trades" && (
        <div className="flex flex-col max-h-[520px] overflow-y-auto overscroll-contain pr-1">
          <div className={`grid ${TRADE_COLS} sticky top-0 z-10 bg-ground/95 backdrop-blur gap-3 md:gap-5 py-2 text-[12px] text-faint`}>
            <span>Time</span><span>Type</span><span className="text-right">USD</span><span className="text-right truncate">{symbol}</span>
            <span className="hidden md:block text-right truncate">{quoteSymbol}</span><span className="hidden md:block text-right">Price</span><span className="hidden md:block text-right">Maker</span>
          </div>
          {!live || trades.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">No trades yet.</p> : trades.map((t) => {
            const price = t.amount > 0 ? (t.valueUsd ?? t.quoteValue) / t.amount : null;
            return (
              <div key={`${t.signature}:${t.eventIndex}`} className={`grid ${TRADE_COLS} gap-3 md:gap-5 items-center py-2 border-t line text-[13px] font-mono tabular-nums ${t.side === "buy" ? "text-up" : "text-down"} ${t.quoteValue >= big && live.trades.length > 5 ? "font-semibold" : ""}`}>
                <a href={solscan(`tx/${t.signature}`)} target="_blank" rel="noreferrer" className="text-faint hover:text-ink">{ago(t.at)}</a>
                <span className="font-sans font-semibold">{t.side === "buy" ? "Buy" : "Sell"}</span>
                <span className="text-right truncate">{t.valueUsd === null ? `${fmtPrice(t.quoteValue)} ${quoteSymbol}` : `$${fmtPrice(t.valueUsd)}`}</span>
                <span className="text-right truncate">{fmtCompact(t.amount)}</span>
                <span className="hidden md:block text-right truncate">{fmtPrice(t.quoteValue)}</span>
                <span className="hidden md:block text-right truncate">{price === null ? "" : `${t.valueUsd === null ? "" : "$"}${fmtPrice(price)}`}</span>
                <span className="hidden md:flex justify-end min-w-0 text-[12px]"><Wallet address={t.trader} tag={tagFor(t.trader)} /></span>
              </div>
            );
          })}
          {liveTrades.length >= LIVE_TRADES && (
            <LoadMore done={olderDone} state={olderState} onMore={loadOlder} label="Load older trades" doneText="No older trades" />
          )}
        </div>
      )}

      {tab === "Activity" && a && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6 py-2">
          <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Price change</span>
            <span className={`font-display font-bold text-2xl ${a.change === null ? "" : changeTone(a.change)}`}>{a.change === null ? "No trades" : fmtChange(a.change)}</span></div>
          <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Volume</span><span className="font-display font-bold text-2xl">{compact(a.buyValue + a.sellValue)}</span></div>
          <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Net flow</span>
            <span className={`font-display font-bold text-2xl ${a.buyValue >= a.sellValue ? "text-up" : "text-down"}`}>{a.buyValue >= a.sellValue ? "+" : "-"}{compact(Math.abs(a.buyValue - a.sellValue))}</span></div>
          <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Wallets</span><span className="font-display font-bold text-2xl">{a.buyers + a.sellers}</span></div>
          {[["Trades", a.buys, a.sells, (n: number) => String(n)], ["Volume", a.buyValue, a.sellValue, compact], ["Wallets", a.buyers, a.sellers, (n: number) => String(n)]].map(([label, b, s, f]) => (
            <div key={label as string} className="col-span-2 flex flex-col gap-2">
              <span className="flex justify-between text-[13px]">
                <span className="text-up">{(f as (n: number) => string)(b as number)} {label === "Wallets" ? "buyers" : "buys"}</span>
                <span className="text-muted">{label as string}</span>
                <span className="text-down">{(f as (n: number) => string)(s as number)} {label === "Wallets" ? "sellers" : "sells"}</span>
              </span>
              <Bar buy={b as number} sell={s as number} />
            </div>
          ))}
        </div>
      )}

      {tab === "Top traders" && (
        <div className="flex flex-col">
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-6 pb-2 text-[12px] text-faint">
            <span>Wallet</span><span className="text-right">Bought</span><span className="text-right">Sold</span><span className="text-right">Holding</span><span className="text-right">Profit</span>
          </div>
          {!live || traders.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">No trades yet.</p> : traders.map((t) => (
            <div key={t.wallet} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 md:gap-6 items-center py-2.5 border-t line text-sm font-mono">
              <span className="min-w-0 flex flex-col gap-0.5"><Wallet address={t.wallet} tag={tagFor(t.wallet)} /><span className="text-[12px] text-faint font-sans">{t.trades} {t.trades === 1 ? "trade" : "trades"}, first {fmtAgo(t.firstAt)}</span></span>
              <span className="hidden md:flex flex-col items-end"><span>{value(t.spent)}</span><span className="text-[12px] text-muted">{fmtCompact(t.bought)} {symbol}</span></span>
              <span className="hidden md:flex flex-col items-end"><span>{value(t.received)}</span><span className="text-[12px] text-muted">{fmtCompact(t.sold)} {symbol}</span></span>
              <span className="hidden md:block text-right">{fmtCompact(t.position)}</span>
              <span className={`text-right ${t.pnl >= 0 ? "text-up" : "text-down"}`}>{t.pnl >= 0 ? "+" : "-"}{value(Math.abs(t.pnl))}</span>
            </div>
          ))}
          {(live?.traders.length ?? 0) >= LIVE_TRADERS && (
            <LoadMore done={tradersNext === null} state={tradersState} onMore={loadTraders} doneText="No more traders" />
          )}
          <p className="m-0 pt-3 text-[12px] text-faint">Profit is based on each wallet&apos;s average buy price and the current price. Transfers in are not counted.</p>
        </div>
      )}

      {tab === "Holders" && (
        !live?.holders ? <p className="m-0 py-6 border-t line text-muted text-sm">Holder data is unavailable. Try again later.</p> : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-6">
              <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Holders</span><span className="font-display font-bold text-2xl">{live.holders.count === null ? "Unknown" : fmtCompact(live.holders.count)}</span></div>
              <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Top 10 hold</span><span className="font-display font-bold text-2xl">{live.holders.top10Pct.toFixed(1)}%</span></div>
              <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Staked</span><span className="font-display font-bold text-2xl text-stake-light">{live.holders.stakedPct.toFixed(1)}%</span></div>
            </div>
            <div className="flex flex-col">
              {live.holders.list.map((h, i) => (
                <div key={h.owner} className="grid grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 md:gap-6 items-center py-2.5 border-t line text-sm font-mono">
                  <span className="text-faint">{i + 1}</span>
                  <span className="min-w-0"><Wallet address={h.owner} tag={h.label} /></span>
                  <span className="hidden md:block text-right">{fmtCompact(h.amount)}</span>
                  <span className="flex items-center gap-3">
                    <span className="hidden md:flex flex-1 h-1.5 rounded-full bg-white/[0.07] overflow-hidden"><span className="bg-violet-light rounded-full" style={{ width: `${Math.min(100, h.pct)}%` }} /></span>
                    <span className="w-16 text-right">{h.pct.toFixed(2)}%</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="m-0 text-[12px] text-faint">Top 10 excludes the bonding curve and the pool. Staked counts tokens in this token&apos;s Kamino farms.</p>
          </div>
        )
      )}
    </section>
  );
}
