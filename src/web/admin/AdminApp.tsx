"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/web/ui/Button";
import { inputClass } from "@/web/ui/Field";
import { Segmented } from "@/web/ui/Segmented";
import { shortAddr } from "@/web/ui/format";
import { LoadMore } from "@/web/ui/LoadMore";
import { CopyButton } from "@/web/ui/CopyButton";
import { SettingsEditor, type AdminSettings, type Pair } from "./SettingsEditor";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { ADMIN_API } from "./api";

type Settings = AdminSettings;
type WalletRow = { role: string; index: number; path: string; address: string | null; solscan: string | null; lamports: string | null; low: boolean; usd: number | null };
type VoteRow = { mint: string; symbol: string | null; up: number; down: number; score: number };
type Status = { lastActivity: string | null; failed: { id: number; mint: string; symbol: string | null; kind: string; error: string; attempts: number; at: string }[]; failedNext: number | null; inFlight: { mint: string; symbol: string | null }[] };

const small = `${inputClass} text-base py-3 font-mono`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error?.message ?? "Something went wrong"), { status: r.status });
  return j as T;
}

export type { Pair };

export function AdminApp() {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"settings" | "analytics" | "keeper" | "wallets" | "baskets" | "votes">("settings");
  const [wallets, setWallets] = useState<WalletRow[] | null>(null);
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
      const s = await call<{ version: number; settings: Settings; pairs: Pair[] }>(`${ADMIN_API}/settings`);
      setPairs(s.pairs);
      setSettings(s.settings);
      setVersion(s.version);
      setStatus(await call<Status>(`${ADMIN_API}/status`));
      setSignedIn(true);
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) setSignedIn(false);
      else setMsg({ ok: false, text: e.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const loadWallets = useCallback(() => {
    setWallets(null);
    call<{ wallets: WalletRow[] }>(`${ADMIN_API}/wallets`).then((r) => setWallets(r.wallets), (e) => setMsg({ ok: false, text: e.message }));
  }, []);
  useEffect(() => {
    if (tab === "wallets" && signedIn) loadWallets();
  }, [tab, signedIn, loadWallets]);
  useEffect(() => {
    if (tab !== "votes" || !signedIn) return;
    call<{ tokens: VoteRow[] }>(`${ADMIN_API}/votes`).then((r) => setVotes(r.tokens), (e) => setMsg({ ok: false, text: e.message }));
  }, [tab, signedIn]);

  async function loadFailed() {
    if (!status?.failedNext || failedState === "loading") return;
    setFailedState("loading");
    try {
      const more = await call<Status>(`${ADMIN_API}/status?before=${status.failedNext}`);
      setStatus((s) => (s ? { ...s, failed: [...s.failed, ...more.failed], failedNext: more.failedNext } : s));
      setFailedState("idle");
    } catch {
      setFailedState("error");
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await call(`${ADMIN_API}/session`, { method: "POST", body: JSON.stringify({ code }) });
      setCode("");
      setMsg(null);
      await load();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message ?? "Sign in failed" });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await call(`${ADMIN_API}/session`, { method: "DELETE" }).catch(() => {});
    setSignedIn(false);
    setSettings(null);
    setStatus(null);
    setMsg(null);
  }

  async function save(next: Settings) {
    try {
      const r = await call<{ version: number; settings: Settings }>(`${ADMIN_API}/settings`, { method: "POST", body: JSON.stringify(next) });
      setVersion(r.version);
      setSettings(r.settings);
      setMsg({ ok: true, text: `Saved as version ${r.version}.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }

  async function saveBasket() {
    try {
      await call(`${ADMIN_API}/basket`, { method: "POST", body: JSON.stringify({ mint: basketMint.trim(), basket: JSON.parse(basketJson) }) });
      setMsg({ ok: true, text: "Basket replaced" });
    } catch (e: any) {
      setMsg({ ok: false, text: e instanceof SyntaxError ? "Basket must be valid JSON" : e.message });
    }
  }

  if (signedIn === null) return <main className="wrap pt-14 pb-16" />;
  if (!signedIn) {
    return (
      <main className="wrap pt-14 pb-16">
        <form onSubmit={signIn} className="flex flex-col items-start gap-6 max-w-md">
          <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Admin</h1>
          <label className="flex flex-col gap-2 text-[13px] text-muted w-full">
            <span>Access code</span>
            <input
              name="code" type="password" autoComplete="current-password" autoCapitalize="characters" spellCheck={false}
              value={code} onChange={(e) => setCode(e.target.value)} className={small} maxLength={64} required
            />
          </label>
          <Button type="submit" disabled={busy || code.trim().length === 0}>{busy ? "Checking" : "Sign in"}</Button>
          {msg && <p role="alert" className={`m-0 text-sm ${msg.ok ? "text-accent" : "text-burn"}`}>{msg.text}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-8 wrap pt-10 md:pt-14 pb-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Admin</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "settings", label: "Settings" }, { value: "analytics", label: "Analytics" }, { value: "keeper", label: "Keeper" }, { value: "wallets", label: "Wallets" }, { value: "baskets", label: "Baskets" }, { value: "votes", label: "Votes" }]} />
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </div>
      {msg && <p role="status" className={`m-0 text-sm ${msg.ok ? "text-accent" : "text-burn"}`}>{msg.text}</p>}

      {tab === "settings" && settings && version !== null && (
        <SettingsEditor initial={settings} version={version} pairs={pairs} onSave={save} />
      )}

      {tab === "analytics" && <AnalyticsPanel />}

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

      {tab === "wallets" && (
        <section className="flex flex-col gap-5 max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-muted">Platform wallets from one seed phrase, which stays off the server. Addresses come from PLATFORM_ADDRESSES.</p>
            <Button variant="ghost" onClick={loadWallets}>Refresh balances</Button>
          </div>
          {wallets === null ? <p className="m-0 text-muted">Loading</p> : (
            <div className="flex flex-col text-sm">
              {wallets.map((w) => (
                <div key={w.role} className="grid grid-cols-1 md:grid-cols-[150px_150px_minmax(0,1fr)_140px] gap-2 md:gap-4 py-3 border-t line md:items-center">
                  <span className="font-semibold">{w.index}. {w.role}</span>
                  <span className="font-mono text-muted">{w.path}</span>
                  {w.address ? (
                    <span className="flex items-center gap-2 min-w-0">
                      <a href={w.solscan!} target="_blank" rel="noreferrer" className="font-mono truncate hover:text-accent">{w.address}</a>
                      <CopyButton value={w.address} label="Copy" />
                    </span>
                  ) : <span className="text-muted">Not set</span>}
                  <span className={`font-mono md:text-right ${w.low ? "text-burn" : ""}`}>
                    {w.lamports === null ? (w.address ? "Unavailable" : "") : `${(Number(w.lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`}
                    {w.usd !== null && <span className="block text-[12px] text-muted">${w.usd.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</span>}
                    {w.low && <span className="block text-[12px]">Below 0.01 SOL. Top it up.</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
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
