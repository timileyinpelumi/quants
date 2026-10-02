"use client";
import { useCallback, useEffect, useState } from "react";
import type { Overview, Range, Report, Stat, TopToken } from "@/web/server/analytics";
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
      const res = await fetch(`/api/admin/analytics?range=${r}`);
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
        </>
      )}
    </div>
  );
}
