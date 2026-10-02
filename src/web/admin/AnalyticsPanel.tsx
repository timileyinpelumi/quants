"use client";
import { useCallback, useEffect, useState } from "react";
import type { Overview, Range, Report, Stat } from "@/web/server/analytics";
import { Segmented } from "@/web/ui/Segmented";
import { Button } from "@/web/ui/Button";
import { fmtChange, fmtCompact } from "@/web/ui/format";

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
        </>
      )}
    </div>
  );
}
