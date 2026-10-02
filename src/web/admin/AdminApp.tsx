"use client";
import { useCallback, useEffect, useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/web/ui/Button";
import { inputClass } from "@/web/ui/Field";
import { Segmented } from "@/web/ui/Segmented";
import { shortAddr } from "@/web/ui/format";
import { LoadMore } from "@/web/ui/LoadMore";

type Tier = { id: string; lockSeconds: number; multiplierBps: number };
type Settings = {
  split: { basketBps: number; platformBps: number; creatorBps: number };
  creatorPayoutMin: Record<string, string>;
  tiers: Tier[];
  maxPenaltyBps: number; rewardPeriodSeconds: number; slippageBps: number;
  devBuyCapBps: number; keeperIntervalSeconds: number; defaultBackend: "kamino";
};
type VoteRow = { mint: string; symbol: string | null; up: number; down: number; score: number };
type Status = { lastActivity: string | null; failed: { id: number; mint: string; symbol: string | null; kind: string; error: string; attempts: number; at: string }[]; failedNext: number | null; inFlight: { mint: string; symbol: string | null }[] };

const SOL = "So11111111111111111111111111111111111111112";
const small = `${inputClass} text-base py-3 font-mono`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error?.message ?? "Something went wrong"), { status: r.status });
  return j as T;
}

function Num({ label, value, onChange, suffix }: { label: string; value: number | string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <label className="flex flex-col gap-2 text-[13px] text-muted">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={small} />
        {suffix && <span className="text-muted text-sm shrink-0">{suffix}</span>}
      </span>
    </label>
  );
}

export type Pair = { mint: string; symbol: string; name: string; graduation: number };

export function AdminApp({ pairs }: { pairs: Pair[] }) {
  const wallet = useWallet();
  const modal = useWalletModal();
  const [signedIn, setSignedIn] = useState(false);
  const [tab, setTab] = useState<"settings" | "keeper" | "baskets" | "pairs" | "votes">("settings");
  const [votes, setVotes] = useState<VoteRow[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [failedState, setFailedState] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [basketMint, setBasketMint] = useState("");
  const [basketJson, setBasketJson] = useState('[{ "mint": "", "weightBps": 10000, "symbol": "", "decimals": 6 }]');

  const load = useCallback(async () => {
    try {
      const s = await call<{ version: number; settings: Settings }>("/api/admin/settings");
      setSettings(s.settings);
      setVersion(s.version);
      setStatus(await call<Status>("/api/admin/status"));
      setSignedIn(true);
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) setSignedIn(false);
      else setMsg({ ok: false, text: e.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab !== "votes" || !signedIn) return;
    call<{ tokens: VoteRow[] }>("/api/admin/votes").then((r) => setVotes(r.tokens), (e) => setMsg({ ok: false, text: e.message }));
  }, [tab, signedIn]);

  async function loadFailed() {
    if (!status?.failedNext || failedState === "loading") return;
    setFailedState("loading");
    try {
      const more = await call<Status>(`/api/admin/status?before=${status.failedNext}`);
      setStatus((s) => (s ? { ...s, failed: [...s.failed, ...more.failed], failedNext: more.failedNext } : s));
      setFailedState("idle");
    } catch {
      setFailedState("error");
    }
  }

  async function signIn() {
    if (!wallet.publicKey) { modal.setVisible(true); return; }
    if (!wallet.signMessage) { setMsg({ ok: false, text: "This wallet cannot sign messages" }); return; }
    try {
      const { message } = await call<{ message: string }>("/api/admin/nonce", { method: "POST" });
      if (!message.startsWith(`${window.location.host} wants you`)) throw new Error("The sign in message is for a different site");
      const sig = await wallet.signMessage(new TextEncoder().encode(message));
      await call("/api/admin/session", { method: "POST", body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), signature: bs58.encode(sig) }) });
      setMsg(null);
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? "Sign in failed" });
    }
  }

  async function save() {
    if (!settings) return;
    try {
      const r = await call<{ version: number }>("/api/admin/settings", { method: "POST", body: JSON.stringify(settings) });
      setVersion(r.version);
      setMsg({ ok: true, text: `Saved as version ${r.version}. It applies to fees claimed and launches created from now on.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }

  async function saveBasket() {
    try {
      await call("/api/admin/basket", { method: "POST", body: JSON.stringify({ mint: basketMint.trim(), basket: JSON.parse(basketJson) }) });
      setMsg({ ok: true, text: "Basket replaced" });
    } catch (e: any) {
      setMsg({ ok: false, text: e instanceof SyntaxError ? "Basket must be valid JSON" : e.message });
    }
  }

  if (!signedIn) {
    return (
      <main className="wrap pt-14 pb-16">
        <div className="flex flex-col items-start gap-6 max-w-2xl">
        <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Admin</h1>
        <p className="m-0 text-muted">Sign a message with an admin wallet to continue. Signing costs nothing.</p>
        <Button onClick={signIn}>{wallet.publicKey ? "Sign in" : "Connect wallet"}</Button>
        {msg && <p role="alert" className={`m-0 text-sm ${msg.ok ? "text-accent" : "text-burn"}`}>{msg.text}</p>}
        </div>
      </main>
    );
  }

  const set = (patch: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...patch } : s));
  const pct = (bps: number) => String(bps / 100);
  const toBps = (v: string) => Math.round(Number(v) * 100);
  const splitTotal = settings ? settings.split.basketBps + settings.split.platformBps + settings.split.creatorBps : 0;

  return (
    <main className="flex flex-col gap-8 wrap pt-10 md:pt-14 pb-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Admin</h1>
        <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "settings", label: "Settings" }, { value: "keeper", label: "Keeper" }, { value: "baskets", label: "Baskets" }, { value: "pairs", label: "Pairs" }, { value: "votes", label: "Votes" }]} />
      </div>
      {msg && <p role="status" className={`m-0 text-sm ${msg.ok ? "text-accent" : "text-burn"}`}>{msg.text}</p>}

      {tab === "settings" && settings && (
        <section className="flex flex-col gap-8 max-w-4xl">
          <p className="m-0 text-sm text-muted">Current version {version}. Saving creates a new version; earlier launches keep the tiers and penalty they started with.</p>

          <div className="flex flex-col gap-3">
            <h2 className="m-0 font-display font-bold text-xl">Fee split</h2>
            <div className="grid grid-cols-3 gap-4">
              <Num label="Reward basket" suffix="%" value={pct(settings.split.basketBps)} onChange={(v) => set({ split: { ...settings.split, basketBps: toBps(v) } })} />
              <Num label="Platform" suffix="%" value={pct(settings.split.platformBps)} onChange={(v) => set({ split: { ...settings.split, platformBps: toBps(v) } })} />
              <Num label="Creator" suffix="%" value={pct(settings.split.creatorBps)} onChange={(v) => set({ split: { ...settings.split, creatorBps: toBps(v) } })} />
            </div>
            {splitTotal !== 10_000 && <span className="text-sm text-burn">These add up to {splitTotal / 100}%. They must add up to 100%.</span>}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="m-0 font-display font-bold text-xl">Lock tiers</h2>
            {settings.tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_44px] gap-3 items-end">
                <label className="flex flex-col gap-2 text-[13px] text-muted"><span>Name</span><input value={t.id} onChange={(e) => set({ tiers: settings.tiers.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} className={small} /></label>
                <Num label="Lock (0.5 is 12 hours)" suffix="days" value={t.lockSeconds / 86_400} onChange={(v) => set({ tiers: settings.tiers.map((x, j) => (j === i ? { ...x, lockSeconds: Math.round(Number(v) * 86_400) } : x)) })} />
                <Num label="Multiplier" suffix="x" value={t.multiplierBps / 10_000} onChange={(v) => set({ tiers: settings.tiers.map((x, j) => (j === i ? { ...x, multiplierBps: Math.round(Number(v) * 10_000) } : x)) })} />
                <button type="button" aria-label={`Remove tier ${t.id}`} onClick={() => set({ tiers: settings.tiers.filter((_, j) => j !== i) })} className="w-11 h-11 rounded-full border border-white/10 text-muted hover:text-ink cursor-pointer">×</button>
              </div>
            ))}
            {settings.tiers.length < 8 && <button type="button" onClick={() => set({ tiers: [...settings.tiers, { id: "new", lockSeconds: 86_400, multiplierBps: 10_000 }] })} className="self-start text-sm font-semibold text-accent min-h-11 cursor-pointer">Add a tier</button>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Num label="Max early exit penalty" suffix="%" value={pct(settings.maxPenaltyBps)} onChange={(v) => set({ maxPenaltyBps: toBps(v) })} />
            <Num label="Reward stream period" suffix="hours" value={settings.rewardPeriodSeconds / 3600} onChange={(v) => set({ rewardPeriodSeconds: Math.round(Number(v) * 3600) })} />
            <Num label="Swap slippage cap" suffix="%" value={pct(settings.slippageBps)} onChange={(v) => set({ slippageBps: toBps(v) })} />
            <Num label="Creator payout minimum" suffix="SOL" value={Number(settings.creatorPayoutMin[SOL] ?? "0") / 1e9} onChange={(v) => set({ creatorPayoutMin: { ...settings.creatorPayoutMin, [SOL]: String(Math.round(Number(v) * 1e9)) } })} />
            <Num label="First buy cap" suffix="% of supply" value={pct(settings.devBuyCapBps)} onChange={(v) => set({ devBuyCapBps: toBps(v) })} />
            <Num label="Keeper interval" suffix="minutes" value={settings.keeperIntervalSeconds / 60} onChange={(v) => set({ keeperIntervalSeconds: Math.round(Number(v) * 60) })} />
          </div>

          <Button className="self-start" onClick={save} disabled={splitTotal !== 10_000}>Save as new version</Button>
        </section>
      )}

      {tab === "keeper" && status && (
        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-muted">Last keeper activity</span>
            <span className="font-mono text-lg">{status.lastActivity ? new Date(status.lastActivity).toLocaleString() : "None yet"}</span>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="m-0 font-display font-bold text-xl">Waiting on a transaction</h2>
            {status.inFlight.length === 0 ? <p className="m-0 text-muted">Nothing is waiting.</p> : status.inFlight.map((l) => (
              <div key={l.mint} className="py-3 border-t line font-mono">{l.symbol ?? shortAddr(l.mint)} <span className="text-muted">skipped until its transaction resolves</span></div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="m-0 font-display font-bold text-xl">Failed steps</h2>
            {status.failed.length === 0 ? <p className="m-0 text-muted">No failed steps.</p> : status.failed.map((f) => (
              <div key={f.id} className="grid grid-cols-1 md:grid-cols-[140px_140px_minmax(0,1fr)_200px] gap-2 md:gap-4 py-3 border-t line text-sm">
                <span className="font-mono">{f.symbol ?? shortAddr(f.mint)}</span>
                <span className="font-semibold">{f.kind}</span>
                <span className="text-burn break-words">{f.error}</span>
                <span className="text-muted md:text-right">{new Date(f.at).toLocaleString()}</span>
              </div>
            ))}
            {status.failed.length > 0 && <LoadMore done={status.failedNext === null} state={failedState} onMore={loadFailed} />}
          </div>
          <Button variant="ghost" className="self-start" onClick={load}>Refresh</Button>
        </section>
      )}

      {tab === "baskets" && (
        <section className="flex flex-col gap-5 max-w-3xl">
          <p className="m-0 text-sm text-muted">Replace a launch's reward basket. Only possible before its farms exist, usually in the first minutes after launch.</p>
          <label className="flex flex-col gap-2 text-[13px] text-muted"><span>Token mint</span><input value={basketMint} onChange={(e) => setBasketMint(e.target.value)} className={small} /></label>
          <label className="flex flex-col gap-2 text-[13px] text-muted"><span>Basket (weights in basis points, adding to 10000)</span><textarea value={basketJson} onChange={(e) => setBasketJson(e.target.value)} className={`${small} min-h-40`} /></label>
          <Button className="self-start" onClick={saveBasket}>Replace basket</Button>
        </section>
      )}

      {tab === "pairs" && (
        <section className="flex flex-col gap-5 max-w-3xl">
          <p className="m-0 text-sm text-muted">Each pair graduates once this much has been raised on its curve. The target is fixed into the config keys when they are created, so changing QUOTE_GRADUATIONS only applies to config keys created after the change. Current server targets:</p>
          <div className="flex flex-col">
            {pairs.map((p) => (
              <div key={p.mint} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 border-t line text-sm">
                <span><span className="font-mono font-semibold">{p.symbol}</span> <span className="text-muted">{p.name}</span></span>
                <span className="font-mono text-right">{p.graduation > 0 ? `${p.graduation.toLocaleString("en-US")} ${p.symbol}` : "Not set"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "votes" && (
        <section className="flex flex-col gap-5 max-w-3xl">
          <p className="m-0 text-sm text-muted">Thumbs on token pages, highest score first. Score is up votes minus down votes. Only admins see these counts.</p>
          {votes === null ? <p className="m-0 text-muted">Loading</p> : votes.length === 0 ? <p className="m-0 text-muted">No votes yet.</p> : (
            <div className="flex flex-col text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_56px_56px_64px] gap-3 pb-2 text-[13px] text-muted">
                <span>Token</span><span className="text-right">Up</span><span className="text-right">Down</span><span className="text-right">Score</span>
              </div>
              {votes.map((v) => (
                <a key={v.mint} href={`/t/${v.mint}`} className="grid grid-cols-[minmax(0,1fr)_56px_56px_64px] gap-3 py-3 border-t line hover:bg-white/[0.02]">
                  <span className="min-w-0 truncate"><span className="font-mono font-semibold">{v.symbol ?? shortAddr(v.mint)}</span> <span className="text-muted font-mono">{shortAddr(v.mint)}</span></span>
                  <span className="font-mono text-right text-up">{v.up}</span>
                  <span className="font-mono text-right text-down">{v.down}</span>
                  <span className="font-mono text-right font-semibold">{v.score > 0 ? `+${v.score}` : v.score}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
