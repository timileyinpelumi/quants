"use client";
import { useEffect, useState } from "react";
import { Button } from "@/web/ui/Button";
import { inputClass } from "@/web/ui/Field";

type Tier = { id: string; lockSeconds: number; multiplierBps: number };
export type AdminSettings = {
  split: { basketBps: number; platformBps: number; creatorBps: number };
  creatorPayoutMin: Record<string, string>;
  tiers: Tier[];
  maxPenaltyBps: number; rewardPeriodSeconds: number; slippageBps: number;
  devBuyCapBps: number; keeperIntervalSeconds: number; defaultBackend: "kamino";
  quotes: Record<string, { enabled: boolean; graduation: number }>;
  platformToken: { mint: string; symbol: string; decimals: number; graduation: number; enabled: boolean };
  feeTiersBps: number[];
  featured: { headline: string; body: string; prelaunch: string };
  xUrl: string; alertWebhookUrl: string; launchesPaused: boolean; bannerMessage: string; stockPairs: boolean; creatorPayoutHold?: string[];
};
export type Pair = { mint: string; symbol: string; name: string; decimals: number; payoutMin: string; graduation: number; enabled: boolean };

const small = `${inputClass} text-base py-3 font-mono`;
const text = `${inputClass} text-base py-3`;

const LABELS: Record<keyof AdminSettings, string> = {
  split: "Fee split", creatorPayoutMin: "Creator payout minimums", tiers: "Lock tiers", maxPenaltyBps: "Max early exit penalty",
  rewardPeriodSeconds: "Reward stream period", slippageBps: "Swap slippage cap", devBuyCapBps: "First buy cap",
  keeperIntervalSeconds: "Keeper interval", defaultBackend: "Staking backend", quotes: "Pairs", platformToken: "Platform token",
  feeTiersBps: "Fee tiers", featured: "Featured card text", xUrl: "X link", alertWebhookUrl: "Alert webhook",
  launchesPaused: "Launches paused", bannerMessage: "Site banner", stockPairs: "Stock pairs", creatorPayoutHold: "Creator payouts on hold",
};

/** Text while typing, a number once it parses, so "0." and "" can be typed through. */
function Num({ label, value, onChange, suffix, step = 1 }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { if (Number(raw) !== value) setRaw(String(value)); }, [value]);
  return (
    <label className="flex flex-col gap-2 text-[13px] text-muted min-w-0">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input inputMode="decimal" value={raw} step={step} onChange={(e) => { setRaw(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n); }} className={`${small} min-w-0`} />
        {suffix && <span className="text-muted text-sm shrink-0">{suffix}</span>}
      </span>
    </label>
  );
}

function Text({ label, value, onChange, placeholder, area, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; area?: boolean; hint?: string }) {
  return (
    <label className="flex flex-col gap-2 text-[13px] text-muted min-w-0">
      <span>{label}</span>
      {area
        ? <textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${text} min-h-24`} />
        : <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={text} />}
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

/** One token address per line; the raw text stays while typing and the list updates as lines change. */
function HoldList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [raw, setRaw] = useState(value.join("\n"));
  useEffect(() => { if (raw.split(/\s+/).filter(Boolean).join("\n") !== value.join("\n")) setRaw(value.join("\n")); }, [value]);
  return (
    <Text area label="Tokens on hold" value={raw} placeholder="One token address per line"
      onChange={(v) => { setRaw(v); onChange([...new Set(v.split(/\s+/).map((x) => x.trim()).filter(Boolean))]); }}
      hint="The keeper keeps these tokens' creator share instead of sending it. Remove a token to pay out what built up on the next run." />
  );
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-3 min-h-11 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 w-5 h-5 accent-[var(--color-accent)] shrink-0" />
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-medium">{label}</span>
        {hint && <span className="text-[13px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pt-7 border-t line">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display font-bold text-xl">{title}</h2>
        {note && <p className="m-0 text-sm text-muted max-w-2xl">{note}</p>}
      </div>
      {children}
    </div>
  );
}

const units = (base: string | undefined, decimals: number) => Number(base ?? "0") / 10 ** decimals;
const toBase = (v: number, decimals: number) => String(Math.round(v * 10 ** decimals));

export function SettingsEditor({ initial, version, pairs, onSave, readOnly = false }: {
  initial: AdminSettings; version: number; pairs: Pair[];
  onSave: (s: AdminSettings) => Promise<void>;
  /** Read only sessions see every value with every control disabled and no save step. */
  readOnly?: boolean;
}) {
  const [s, setS] = useState(initial);
  const [fees, setFees] = useState(initial.feeTiersBps.map((b) => b / 100).join(", "));
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setS(initial); setFees(initial.feeTiersBps.map((b) => b / 100).join(", ")); setReview(false); }, [initial]);

  const set = (patch: Partial<AdminSettings>) => { setS((x) => ({ ...x, ...patch })); setReview(false); };
  const pct = (bps: number) => bps / 100;
  const toBps = (v: number) => Math.round(v * 100);
  const splitTotal = s.split.basketBps + s.split.platformBps + s.split.creatorBps;
  const feeList = fees.split(/[,\s]+/).filter(Boolean).map(Number);
  const feesOk = feeList.length > 0 && feeList.every((f) => Number.isFinite(f) && f >= 0.25 && f <= 10);
  const draft: AdminSettings = { ...s, feeTiersBps: feesOk ? feeList.map(toBps) : s.feeTiersBps };
  const changed = (Object.keys(LABELS) as (keyof AdminSettings)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(initial[k]));
  const p = s.platformToken;
  const setP = (patch: Partial<AdminSettings["platformToken"]>) => set({ platformToken: { ...p, ...patch } });
  const problem = splitTotal !== 10_000 ? `The fee split adds up to ${splitTotal / 100}%. It must add up to 100%.`
    : !feesOk ? "Fee tiers are percents from 0.25 to 10, separated by commas."
    : null;

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      setReview(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-7 max-w-4xl">
      <p className="m-0 text-sm text-muted">
        {readOnly
          ? `Current version ${version}.`
          : `Current version ${version}. Saving creates a new version. Pages pick it up within a few seconds and the keeper on its next run. Earlier launches keep the tiers and penalty they started with.`}
      </p>
      <fieldset disabled={readOnly} data-settings-fields className="m-0 p-0 border-0 min-w-0 flex flex-col gap-7">

      <Section title="Launches">
        <Check label="Pause new launches" checked={s.launchesPaused} onChange={(v) => set({ launchesPaused: v })} hint="The launch page says launches are paused and prepare refuses. Trading, staking and the keeper carry on." />
        <Text label="Site banner" value={s.bannerMessage} onChange={(v) => set({ bannerMessage: v })} placeholder="Empty shows no banner" hint="Shown at the top of every page. 200 characters at most." />
      </Section>

      {!readOnly && <Section title="Creator payouts">
        <HoldList value={s.creatorPayoutHold ?? []} onChange={(v) => set({ creatorPayoutHold: v })} />
      </Section>}

      <Section title="Pairs" note="Which pair tokens new launches can use, and how much each curve raises before it graduates. A new target applies to curves created from now on; existing pools keep theirs.">
        <div className="flex flex-col">
          {pairs.map((c) => {
            const q = s.quotes[c.symbol] ?? { enabled: c.enabled, graduation: c.graduation };
            const setQ = (patch: Partial<typeof q>) => set({ quotes: { ...s.quotes, [c.symbol]: { ...q, ...patch } } });
            return (
              <div key={c.symbol} className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)] gap-3 md:gap-4 py-4 border-t line items-end">
                <Check label={`${c.symbol}`} hint={c.name} checked={q.enabled} onChange={(v) => setQ({ enabled: v })} />
                <Num label="Graduates at" suffix={c.symbol} value={q.graduation} onChange={(v) => setQ({ graduation: v })} />
                <Num label="Creator payout minimum" suffix={c.symbol} value={units(s.creatorPayoutMin[c.mint] ?? c.payoutMin, c.decimals)}
                  onChange={(v) => set({ creatorPayoutMin: { ...s.creatorPayoutMin, [c.mint]: toBase(v, c.decimals) } })} />
              </div>
            );
          })}
        </div>
        <Check label="Stock pairs" checked={s.stockPairs} onChange={(v) => set({ stockPairs: v })} hint="Lets new launches pair with tokenized stocks. Those launches are trading only, with no staking." />
      </Section>

      <Section title="Platform token" note="Leave the mint empty until the token exists. The home page then shows the prelaunch card.">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <Text label="Mint" value={p.mint} onChange={(v) => setP({ mint: v.trim(), enabled: v.trim() ? p.enabled : false })} placeholder="Empty means not launched yet" />
          <Text label="Symbol" value={p.symbol} onChange={(v) => setP({ symbol: v.trim() })} />
          <Num label="Decimals" value={p.decimals} onChange={(v) => setP({ decimals: Math.round(v) })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <Num label="Graduates at" suffix={p.symbol} value={p.graduation} onChange={(v) => setP({ graduation: v })} />
          {p.mint && <Num label="Creator payout minimum" suffix={p.symbol} value={units(s.creatorPayoutMin[p.mint], p.decimals)}
            onChange={(v) => set({ creatorPayoutMin: { ...s.creatorPayoutMin, [p.mint]: toBase(v, p.decimals) } })} />}
        </div>
        <Check label={`Offer ${p.symbol} as a pair`} checked={p.enabled} onChange={(v) => setP({ enabled: v })} hint="Needs the mint and a graduation target." />
      </Section>

      <Section title="Fees">
        <Text label="Fee tiers offered, in percent" value={fees} onChange={(v) => { setFees(v); setReview(false); }} placeholder="1, 2, 3" hint="Up to four, from 0.25 to 10." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Num label="Reward basket" suffix="%" value={pct(s.split.basketBps)} onChange={(v) => set({ split: { ...s.split, basketBps: toBps(v) } })} />
          <Num label="Platform" suffix="%" value={pct(s.split.platformBps)} onChange={(v) => set({ split: { ...s.split, platformBps: toBps(v) } })} />
          <Num label="Creator" suffix="%" value={pct(s.split.creatorBps)} onChange={(v) => set({ split: { ...s.split, creatorBps: toBps(v) } })} />
        </div>
        {splitTotal !== 10_000 && <span className="text-sm text-burn">These add up to {splitTotal / 100}%. They must add up to 100%.</span>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Num label="Swap slippage cap" suffix="%" value={pct(s.slippageBps)} onChange={(v) => set({ slippageBps: toBps(v) })} />
          <Num label="First buy cap" suffix="% of supply" value={pct(s.devBuyCapBps)} onChange={(v) => set({ devBuyCapBps: toBps(v) })} />
        </div>
      </Section>

      <Section title="Staking">
        {s.tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_44px] gap-3 items-end">
            <Text label="Name" value={t.id} onChange={(v) => set({ tiers: s.tiers.map((x, j) => (j === i ? { ...x, id: v } : x)) })} />
            <Num label="Lock (0.5 is 12 hours)" suffix="days" value={t.lockSeconds / 86_400} onChange={(v) => set({ tiers: s.tiers.map((x, j) => (j === i ? { ...x, lockSeconds: Math.round(v * 86_400) } : x)) })} />
            <Num label="Multiplier" suffix="x" value={t.multiplierBps / 10_000} onChange={(v) => set({ tiers: s.tiers.map((x, j) => (j === i ? { ...x, multiplierBps: Math.round(v * 10_000) } : x)) })} />
            {!readOnly && <button type="button" aria-label={`Remove tier ${t.id}`} onClick={() => set({ tiers: s.tiers.filter((_, j) => j !== i) })} className="w-11 h-11 rounded-full border border-white/10 text-muted hover:text-ink cursor-pointer">×</button>}
          </div>
        ))}
        {!readOnly && s.tiers.length < 8 && <button type="button" onClick={() => set({ tiers: [...s.tiers, { id: "new", lockSeconds: 86_400, multiplierBps: 10_000 }] })} className="self-start text-sm font-semibold text-accent min-h-11 cursor-pointer">Add a tier</button>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Num label="Max early exit penalty" suffix="%" value={pct(s.maxPenaltyBps)} onChange={(v) => set({ maxPenaltyBps: toBps(v) })} />
          <Num label="Reward stream period" suffix="hours" value={s.rewardPeriodSeconds / 3600} onChange={(v) => set({ rewardPeriodSeconds: Math.round(v * 3600) })} />
        </div>
      </Section>

      <Section title="Keeper">
        <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-4">
          <Num label="Run every" suffix="minutes" value={s.keeperIntervalSeconds / 60} onChange={(v) => set({ keeperIntervalSeconds: Math.round(v * 60) })} />
          {readOnly
            ? <Text label="Alert webhook" value={s.alertWebhookUrl ? "Set" : "Not set"} onChange={() => {}} />
            : <Text label="Alert webhook" value={s.alertWebhookUrl} onChange={(v) => set({ alertWebhookUrl: v.trim() })} placeholder="https://hooks.slack.com/..." hint="The keeper and indexer post alerts here. Empty sends none." />}
        </div>
      </Section>

      <Section title="Home page" note="{symbol} is replaced with the platform token symbol.">
        <Text label="Featured headline" value={s.featured.headline} onChange={(v) => set({ featured: { ...s.featured, headline: v } })} />
        <Text label="Featured text" area value={s.featured.body} onChange={(v) => set({ featured: { ...s.featured, body: v } })} />
        <Text label="Prelaunch message" area value={s.featured.prelaunch} onChange={(v) => set({ featured: { ...s.featured, prelaunch: v } })} hint="The back of the featured card while the platform token mint is empty." />
        <Text label="X link" value={s.xUrl} onChange={(v) => set({ xUrl: v.trim() })} placeholder="Empty uses NEXT_PUBLIC_X_URL" />
      </Section>

      </fieldset>

      {!readOnly && <div className="flex flex-col gap-4 pt-7 border-t line">
        {problem && <p className="m-0 text-sm text-burn">{problem}</p>}
        {!review ? (
          <Button className="self-start" disabled={!!problem || changed.length === 0} onClick={() => setReview(true)}>
            {changed.length === 0 ? "No changes" : "Review changes"}
          </Button>
        ) : (
          <div className="flex flex-col gap-4 rounded-2xl border border-accent/40 p-5">
            <span className="font-semibold">Save these as version {version + 1}?</span>
            <ul className="m-0 pl-5 text-sm text-muted flex flex-col gap-1">
              {changed.map((k) => <li key={k}>{LABELS[k]}</li>)}
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button onClick={save} disabled={saving}>{saving ? "Saving" : `Save as version ${version + 1}`}</Button>
              <Button variant="ghost" onClick={() => setReview(false)}>Keep editing</Button>
            </div>
          </div>
        )}
      </div>}
    </section>
  );
}
