"use client";
import { ADMIN_API } from "./api";
import { useCallback, useEffect, useState } from "react";
import type { FeeFlow, Health, Overview, Range, Report, Stat, TopToken, Traffic } from "@/web/server/analytics";
import { Segmented } from "@/web/ui/Segmented";
import { Button } from "@/web/ui/Button";
import { fmtChange, fmtCompact, shortAddr } from "@/web/ui/format";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "all", label: "All" },
];

export const fmtUsd = (n: number) =>
  Math.abs(n) >= 10_000 ? `$${fmtCompact(n)}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: n !== 0 && Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const fmtCount = (n: number) => (Math.abs(n) >= 100_000 ? fmtCompact(n) : n.toLocaleString("en-US"));

const TILES: { key: keyof Overview; label: string; usd?: boolean; now?: boolean }[] = [
  { key: "launches", label: "Launches" },
  { key: "trades", label: "Trades" },
  { key: "traders", label: "Unique traders" },
  { key: "volumeUsd", label: "Volume", usd: true },
  { key: "feesUsd", label: "Fees collected", usd: true },
  { key: "stakersUsd", label: "Paid to stakers", usd: true },
  { key: "creatorsUsd", label: "Paid to creators", usd: true },
  { key: "treasuryUsd", label: "Paid to treasury", usd: true },
  { key: "stakers", label: "Stakers", now: true },
  { key: "stakingOpen", label: "Tokens with staking open", now: true },
  { key: "stakingOpened", label: "Staking opened" },
  { key: "graduated", label: "Graduated" },
];

function Change({ s }: { s: Stat }) {
  if (s.value === null || s.prev === null) return null;
  if (s.prev === 0) return <span className="text-[12px] text-faint">{s.value === 0 ? "No change" : "None before"}</span>;
  const pct = ((s.value - s.prev) / Math.abs(s.prev)) * 100;
  const tone = Math.round(pct * 10) === 0 ? "text-faint" : pct > 0 ? "text-up" : "text-down";
  return <span className={`text-[12px] font-mono ${tone}`}>{fmtChange(pct)}</span>;
}

function Tiles({ o, range }: { o: Overview; range: Range }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-6 gap-y-5">
      {TILES.map((t) => {
        const s = o[t.key];
        return (
          <div key={t.key} className="flex flex-col gap-1 border-t line pt-3 min-w-0">
            <span className="text-[13px] text-muted truncate">{t.label}</span>
            <span className="font-mono text-xl">{s.value === null ? "Unavailable" : t.usd ? fmtUsd(s.value) : fmtCount(s.value)}</span>
            {t.now ? <span className="text-[12px] text-faint">Right now</span> : range === "all" ? <span className="text-[12px] text-faint">All time</span> : <Change s={s} />}
          </div>
        );
      })}
    </div>
  );
}

const when = (iso: string, unit: Report["unit"]) => {
  const d = new Date(iso);
  return unit === "hour"
    ? d.toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

function Bars({ title, values, labels, fmt, sum = true }: { title: string; values: number[]; labels: string[]; fmt: (n: number) => string; sum?: boolean }) {
  const W = 300, H = 96;
  const max = Math.max(0, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const slot = W / Math.max(1, values.length);
  const gap = values.length > 60 ? 0 : Math.min(2, slot * 0.25);
  return (
    <figure className="m-0 flex flex-col gap-2 border-t line pt-3 min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-muted">{title}</span>
        {sum && <span className="font-mono text-sm">{fmt(total)}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-24" role="img" aria-label={`${title} by ${labels.length > 25 ? "day" : "period"}`}>
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="rgba(255,255,255,0.08)" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => {
          const h = max === 0 ? 0 : Math.max(v > 0 ? 1.5 : 0, (v / max) * (H - 4));
          return (
            <rect key={i} x={i * slot + gap / 2} y={H - h} width={Math.max(0.5, slot - gap)} height={h} fill="var(--color-accent)" fillOpacity={0.75}>
              <title>{`${labels[i]}: ${fmt(v)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-faint font-mono">
        <span>{labels[0]}</span>
        <span>Peak {fmt(max)}</span>
        <span>{labels.at(-1)}</span>
      </div>
    </figure>
  );
}

function Series({ r }: { r: Report }) {
  const labels = r.series.map((p) => when(p.t, r.unit));
  const pick = (k: "launches" | "volumeUsd" | "trades" | "traders" | "feesUsd") => r.series.map((p) => p[k]);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-6">
      <Bars title="Volume" values={pick("volumeUsd")} labels={labels} fmt={fmtUsd} />
      <Bars title="Fees collected" values={pick("feesUsd")} labels={labels} fmt={fmtUsd} />
      <Bars title="Trades" values={pick("trades")} labels={labels} fmt={fmtCount} />
      <Bars title={r.unit === "hour" ? "Unique traders per hour" : "Unique traders per day"} values={pick("traders")} labels={labels} fmt={fmtCount} sum={false} />
      <Bars title="Launches" values={pick("launches")} labels={labels} fmt={fmtCount} />
    </div>
  );
}

const stakingLabel = (s: TopToken["staking"]) =>
  s.state === "open" ? "Open" : s.state === "opening" ? `${s.percent ?? 0}% to open` : s.state === "trading" ? "Trading only" : "None";

const TOKEN_COLS = "grid grid-cols-[minmax(0,1fr)_96px] md:grid-cols-[minmax(0,1fr)_110px_80px_80px_100px_120px] gap-x-4";

function Tokens({ rows }: { rows: TopToken[] }) {
  if (rows.length === 0) return <p className="m-0 text-muted">No trades in this range.</p>;
  return (
    <div className="flex flex-col text-sm">
      <div className={`${TOKEN_COLS} pb-2 text-[13px] text-muted`}>
        <span>Token</span><span className="text-right">Volume</span>
        <span className="hidden md:block text-right">Trades</span><span className="hidden md:block text-right">Traders</span>
        <span className="hidden md:block text-right">Fees</span><span className="hidden md:block text-right">Staking</span>
      </div>
      {rows.map((t) => (
        <a key={t.mint} href={`/t/${t.mint}`} className={`${TOKEN_COLS} gap-y-1 py-3 border-t line hover:bg-white/[0.02]`}>
          <span className="min-w-0 truncate">
            <span className="font-mono font-semibold">{t.symbol}</span> <span className="text-muted font-mono">{shortAddr(t.mint)}</span>
            {t.status === "graduated" && <span className="text-faint"> graduated</span>}
          </span>
          <span className="font-mono text-right">{fmtUsd(t.volumeUsd)}</span>
          <span className="md:hidden col-span-2 text-[12px] text-muted">
            {fmtCount(t.trades)} trades, {fmtCount(t.traders)} traders, {fmtUsd(t.feesUsd)} fees, staking {stakingLabel(t.staking).toLowerCase()}
          </span>
          <span className="hidden md:block font-mono text-right">{fmtCount(t.trades)}</span>
          <span className="hidden md:block font-mono text-right">{fmtCount(t.traders)}</span>
          <span className="hidden md:block font-mono text-right">{fmtUsd(t.feesUsd)}</span>
          <span className={`hidden md:block text-right ${t.staking.state === "open" ? "" : "text-muted"}`}>{stakingLabel(t.staking)}</span>
        </a>
      ))}
    </div>
  );
}

const FLOW: { key: keyof FeeFlow["flow"]; label: string; color: string }[] = [
  { key: "bought", label: "Stakers' basket bought", color: "var(--color-stake)" },
  { key: "rent", label: "Rent for farms", color: "var(--color-stake-light)" },
  { key: "creator", label: "Creators", color: "var(--color-violet)" },
  { key: "treasury", label: "Treasury", color: "var(--color-accent)" },
  { key: "held", label: "Held for stakers", color: "var(--color-faint)" },
];
const ESCROW: { key: keyof FeeFlow["escrow"]; label: string }[] = [
  { key: "unsplit", label: "Not split yet" },
  { key: "basket", label: "Stakers' share not spent" },
  { key: "reward", label: "Rewards bought, not paid" },
  { key: "creator", label: "Owed to creators" },
  { key: "treasury", label: "Owed to treasury" },
];

function Fees({ f }: { f: FeeFlow }) {
  const total = FLOW.reduce((s, x) => s + f.flow[x.key], 0);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-muted">Collected in this range</span>
          <span className="font-mono text-xl">{fmtUsd(f.collectedUsd)}</span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/[0.04]" role="img" aria-label="Where fees went">
          {total > 0 && FLOW.map((x) => f.flow[x.key] > 0 && (
            <span key={x.key} style={{ width: `${(f.flow[x.key] / total) * 100}%`, background: x.color }} title={`${x.label}: ${fmtUsd(f.flow[x.key])}`} />
          ))}
        </div>
        <div className="flex flex-col text-sm">
          {FLOW.map((x) => (
            <div key={x.key} className="grid grid-cols-[12px_minmax(0,1fr)_auto_56px] items-center gap-3 py-2.5 border-t line">
              <span className="size-2.5 rounded-full" style={{ background: x.color }} />
              <span className="truncate">{x.label}</span>
              <span className="font-mono text-right">{fmtUsd(f.flow[x.key])}</span>
              <span className="font-mono text-right text-muted">{total > 0 ? `${Math.round((f.flow[x.key] / total) * 100)}%` : ""}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-muted">In escrow right now</span>
          <span className="font-mono text-xl">{fmtUsd(ESCROW.reduce((s, x) => s + f.escrow[x.key], 0))}</span>
        </div>
        <div className="flex flex-col text-sm">
          {ESCROW.map((x) => (
            <div key={x.key} className="flex justify-between gap-3 py-2.5 border-t line">
              <span className="truncate">{x.label}</span>
              <span className="font-mono">{fmtUsd(f.escrow[x.key])}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};
const duration = (s: number) => (s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

function Fact({ label, value, bad, sub }: { label: string; value: string; bad?: boolean; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 border-t line pt-3 min-w-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className={`font-mono text-lg ${bad ? "text-burn" : ""}`}>{value}</span>
      {sub && <span className={`text-[12px] break-words ${bad ? "text-burn" : "text-faint"}`}>{sub}</span>}
    </div>
  );
}

function HealthView({ h }: { h: Health }) {
  const k = h.keeper;
  const lamports = h.wallet?.lamports;
  const lagBad = h.indexer.lagSeconds !== null && h.indexer.lagSeconds > 300;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
        <Fact label="Last keeper run" value={ago(k.lastAt)} bad={k.ok === false} sub={k.ok === null ? "No runs recorded yet" : k.ok ? `Clean, ${k.launches} launches` : k.error ?? "Had errors"} />
        <Fact label="Keeper runs with errors" value={`${fmtCount(k.failedRuns)} of ${fmtCount(k.runs)}`} bad={k.failedRuns > 0} sub={`${fmtCount(k.errors)} errors in this range`} />
        <Fact label="Keeper balance" value={lamports == null ? "Unavailable" : `${(Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`}
          bad={h.wallet?.low} sub={h.wallet?.low ? "Below 0.01 SOL. Top it up." : h.wallet?.address ? shortAddr(h.wallet.address) : "Set PLATFORM_ADDRESSES"} />
        <Fact label="Ledger steps" value={`${fmtCount(h.steps.failed)} failed`} bad={h.steps.failed > 0 || h.steps.stuck > 0}
          sub={h.steps.stuck ? `${h.steps.stuck} waiting over 10 minutes` : "None waiting over 10 minutes"} />
        <Fact label="Indexer last pass" value={ago(h.indexer.lastPassAt)} sub={`${fmtCount(h.indexer.addresses)} pools followed`} />
        <Fact label="Indexer lag" value={h.indexer.lagSeconds === null ? "None" : duration(h.indexer.lagSeconds)} bad={lagBad} sub="Since the stalest pool was read" />
        <Fact label="Newest indexed trade" value={ago(h.indexer.lastTradeAt)} />
      </div>
      {h.steps.recent.length > 0 && (
        <div className="flex flex-col text-sm">
          <span className="pb-2 text-[13px] text-muted">Latest failed steps</span>
          {h.steps.recent.map((f, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[120px_120px_minmax(0,1fr)_100px] gap-1 md:gap-4 py-3 border-t line">
              <a href={`/t/${f.mint}`} className="font-mono hover:text-accent">{f.symbol}</a>
              <span className="font-semibold">{f.kind}</span>
              <span className="text-burn break-words">{f.error}</span>
              <span className="text-muted md:text-right">{ago(f.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Ranked({ title, rows, empty }: { title: string; rows: { key: string; label: string; views: number; visitors?: number }[]; empty: string }) {
  return (
    <div className="flex flex-col text-sm min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] gap-3 pb-2 text-[13px] text-muted">
        <span>{title}</span><span className="text-right">Views</span><span className="text-right">{rows.some((r) => r.visitors !== undefined) ? "Visitors" : ""}</span>
      </div>
      {rows.length === 0 ? <p className="m-0 py-3 border-t line text-muted">{empty}</p> : rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_72px_72px] gap-3 py-2.5 border-t line">
          <span className="font-mono truncate">{r.label}</span>
          <span className="font-mono text-right">{fmtCount(r.views)}</span>
          <span className="font-mono text-right text-muted">{r.visitors === undefined ? "" : fmtCount(r.visitors)}</span>
        </div>
      ))}
    </div>
  );
}

function TrafficView({ t, unit, range }: { t: Traffic; unit: Report["unit"]; range: Range }) {
  const labels = t.days.map((d) => when(d.t, unit));
  const per = unit === "hour" ? "hour" : "day";
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
        {([["Page views", t.views], ["Daily visitors, summed", t.visitors]] as const).map(([label, s]) => (
          <div key={label} className="flex flex-col gap-1 border-t line pt-3 min-w-0">
            <span className="text-[13px] text-muted truncate">{label}</span>
            <span className="font-mono text-xl">{fmtCount(s.value ?? 0)}</span>
            {range === "all" ? <span className="text-[12px] text-faint">All time</span> : <Change s={s} />}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
        <Bars title={`Views per ${per}`} values={t.days.map((d) => d.views)} labels={labels} fmt={fmtCount} />
        <Bars title={`Unique visitors per ${per}`} values={t.days.map((d) => d.visitors)} labels={labels} fmt={fmtCount} sum={false} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8">
        <Ranked title="Top pages" empty="No views in this range." rows={t.pages.map((p) => ({ key: p.path, label: p.path, views: p.views, visitors: p.visitors }))} />
        <Ranked title="Top referrers" empty="No referred visits in this range." rows={t.referrers.map((r) => ({ key: r.host, label: r.host, views: r.views }))} />
      </div>
    </div>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display font-bold text-xl">{title}</h2>
        {note && <p className="m-0 text-sm text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export function AnalyticsPanel() {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (r: Range) => {
    setError(null);
    try {
      const res = await fetch(`${ADMIN_API}/analytics?range=${r}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message ?? "Something went wrong");
      setData(j as Report);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  const shown = data?.range === range ? data : null;
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Range" value={range} onChange={setRange} options={RANGE_OPTIONS} />
        <Button variant="ghost" onClick={() => load(range)}>Refresh</Button>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-burn">{error}</p>}
      {!shown ? <p className="m-0 text-muted">Loading</p> : (
        <>
          <Section title="Overview" note={range === "all" ? "Everything so far." : `Last ${range} against the ${range} before it. Fees are valued at each token's latest price.`}>
            <Tiles o={shown.overview} range={range} />
          </Section>
          <Section title={shown.unit === "hour" ? "By hour" : "By day"} note="UTC. Hover a bar for its value.">
            <Series r={shown} />
          </Section>
          <Section title="Top tokens" note="By volume in this range, up to 20.">
            <Tokens rows={shown.tokens} />
          </Section>
          <Section title="Fee flow" note="Fees split in this range and where they went. Held is the stakers' share not yet spent on rent or rewards in the range.">
            <Fees f={shown.fees} />
          </Section>
          <Section title="Keeper and indexer" note="Errors and failed steps count this range. Balances and lag are live.">
            <HealthView h={shown.health} />
          </Section>
          <Section title="Traffic" note="Counted on the server with no cookies. A visitor is a daily hash of address and browser, so the same person on two days counts twice. Bots, prefetches, admin and API calls are left out.">
            <TrafficView t={shown.traffic} unit={shown.unit} range={range} />
          </Section>
        </>
      )}
    </div>
  );
}
