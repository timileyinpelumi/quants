"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Avatar } from "@/web/ui/Avatar";
import { Button } from "@/web/ui/Button";
import { Jazzicon } from "@/web/ui/Jazzicon";
import { fmtAmount, fmtCompact, shortAddr, lockLabel } from "@/web/ui/format";
import { useUsd, usdText } from "@/web/ui/usd";

type Position = {
  tierId: string; multiplierBps: number; lockSeconds: number; staked: string; unlocksAt: number; locked: boolean;
  pending: { mint: string; symbol: string | null; decimals: number | null; amount: string }[];
};
type StakeLaunch = { mint: string; symbol: string | null; name: string | null; image: string | null; positions: Position[] };
type Held = { mint: string; amount: string; decimals: number; symbol: string | null; name: string | null; image: string | null; kind: "launch" | "platform" | "reward" | "other" };

const days = (s: number) => Math.round(s / 86_400);
const dateOf = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const GROUPS: [Held["kind"], string][] = [["launch", "Tokens launched here"], ["platform", "Platform token"], ["reward", "Reward tokens"], ["other", "Other tokens"]];

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="flex items-baseline justify-between gap-4 pb-3">
        <h2 className="m-0 font-display font-black text-2xl md:text-[28px] tracking-tight">{title}</h2>
        {count !== undefined && <span className="font-mono text-sm text-muted">{count}</span>}
      </div>
      {children}
    </section>
  );
}

export function PortfolioApp() {
  const wallet = useWallet();
  const modal = useWalletModal();
  const owner = wallet.publicKey?.toBase58();
  const [holdings, setHoldings] = useState<{ sol: string; solIcon?: string | null; tokens: Held[] } | null>(null);
  const [stakes, setStakes] = useState<StakeLaunch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!owner) return;
    setError(null);
    setHoldings(null);
    setStakes(null);
    const [h, s] = await Promise.allSettled([
      fetch(`/api/wallet/${owner}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`/api/portfolio?owner=${owner}`).then((r) => (r.ok ? r.json() : Promise.reject())),
    ]);
    if (h.status === "fulfilled") setHoldings(h.value); else setError("Balances could not load.");
    if (s.status === "fulfilled") setStakes(s.value.launches); else setError((e) => (e ? "Balances and stakes could not load." : "Stakes could not load."));
  }, [owner]);

  useEffect(() => { load(); }, [load]);

  if (!owner) {
    return (
      <main className="flex flex-col gap-8 wrap pt-10 md:pt-14 pb-16">
        <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Portfolio</h1>
        <div className="flex flex-col items-start gap-4 py-10 border-t line">
          <p className="m-0 text-lg text-muted">Connect a wallet to see your balances, tokens and stakes.</p>
          <Button onClick={() => modal.setVisible(true)}>Connect wallet</Button>
        </div>
      </main>
    );
  }

  const skeleton = <div className="flex flex-col gap-2">{[0, 1].map((i) => <div key={i} className="h-16 rounded-2xl bg-white/[0.03] animate-pulse" />)}</div>;
  const stakeCount = stakes?.reduce((a, l) => a + l.positions.length, 0);
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const px = useUsd([SOL_MINT, ...(holdings?.tokens.map((t) => t.mint) ?? []), ...(stakes ?? []).flatMap((l) => [l.mint, ...l.positions.flatMap((p) => p.pending.map((r) => r.mint))])]);
  const usdOf = (base: string, decimals: number, mint: string) => usdText(Number(BigInt(base)) / 10 ** decimals, px[mint]);
  const worth = (base: string, decimals: number, mint: string) => (Number(BigInt(base)) / 10 ** decimals) * (px[mint] ?? 0);
  const total = holdings && px[SOL_MINT] != null
    ? worth(holdings.sol, 9, SOL_MINT) + holdings.tokens.reduce((a, t) => a + worth(t.amount, t.decimals, t.mint), 0)
      + (stakes ?? []).reduce((a, l) => a + l.positions.reduce((b, p) => b + worth(p.staked, 6, l.mint), 0), 0)
    : null;

  return (
    <main className="flex flex-col gap-12 wrap pt-10 md:pt-14 pb-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="flex items-center gap-4">
          <Jazzicon address={owner} size={64} />
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Portfolio</h1>
            <span className="font-mono text-sm text-muted">{shortAddr(owner)}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-6 md:gap-12">
          <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Worth about</span><span className="font-display font-bold text-2xl">{total === null ? "…" : `$${fmtCompact(total)}`}</span></div>
          <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">SOL</span><span className="font-display font-bold text-2xl">{holdings ? fmtAmount(holdings.sol, 9, 3) : "…"}</span></div>
          <div className="flex flex-col gap-1"><span className="text-[13px] text-muted">Stakes</span><span className="font-display font-bold text-2xl">{stakeCount ?? "…"}</span></div>
        </div>
      </div>

      {error && <p role="alert" className="m-0 text-burn">{error} <button type="button" onClick={load} className="underline cursor-pointer">Try again</button></p>}

      <Section title="Native">
        {holdings ? (
          <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] gap-4 items-center py-4 border-t line">
            {holdings.solIcon ? <Avatar seed="SOL" label="SOL" image={holdings.solIcon} size={44} /> : <span className="w-11 h-11 rounded-[14px] flex items-center justify-center font-display font-black text-ground puff" style={{ background: "linear-gradient(145deg, #9945FF, #14F195)" }} aria-hidden>S</span>}
            <span className="flex flex-col"><span className="font-semibold">SOL</span><span className="text-[13px] text-muted">Solana</span></span>
            <span className="flex flex-col items-end font-mono"><span>{fmtAmount(holdings.sol, 9, 4)}</span>{usdOf(holdings.sol, 9, SOL_MINT) && <span className="text-[13px] text-faint">{usdOf(holdings.sol, 9, SOL_MINT)}</span>}</span>
          </div>
        ) : !error && skeleton}
      </Section>

      {GROUPS.map(([kind, title]) => {
        const rows = holdings?.tokens.filter((t) => t.kind === kind) ?? [];
        if (holdings && rows.length === 0) return null;
        return (
          <Section key={kind} title={title} count={holdings ? rows.length : undefined}>
            {!holdings ? !error && skeleton : rows.map((t) => {
              const inner = (
                <>
                  <Avatar seed={t.mint} label={t.symbol ?? "?"} image={t.image} />
                  <span className="flex flex-col min-w-0">
                    <span className="font-semibold truncate">{t.symbol ?? shortAddr(t.mint)}</span>
                    <span className="text-[13px] text-muted truncate">{t.name ?? shortAddr(t.mint)}</span>
                  </span>
                  <span className="flex flex-col items-end font-mono text-right"><span>{fmtAmount(t.amount, t.decimals, 4)}</span>{usdOf(t.amount, t.decimals, t.mint) && <span className="text-[13px] text-faint">{usdOf(t.amount, t.decimals, t.mint)}</span>}</span>
                </>
              );
              const cls = "grid grid-cols-[44px_minmax(0,1fr)_auto] gap-4 items-center py-4 border-t line";
              return kind === "launch"
                ? <Link key={t.mint} href={`/t/${t.mint}`} className={`${cls} hover:bg-white/[0.02]`}>{inner}</Link>
                : <div key={t.mint} className={cls}>{inner}</div>;
            })}
          </Section>
        );
      })}

      <Section title="Stakes" count={stakeCount}>
        {stakes === null ? !error && skeleton : stakes.length === 0 ? (
          <div className="flex flex-col items-start gap-4 py-8 border-t line">
            <p className="m-0 text-muted">No stakes yet. Stake a token to earn its reward basket.</p>
            <Link href="/explore" className="font-display font-bold text-ground bg-accent glow-accent rounded-full px-6 min-h-12 flex items-center">Explore tokens</Link>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {stakes.map((l) => {
              const symbol = l.symbol ?? shortAddr(l.mint);
              return (
                <div key={l.mint} className="flex flex-col">
                  <div className="flex items-center justify-between gap-4 py-3 border-t line">
                    <Link href={`/t/${l.mint}`} className="flex items-center gap-3 min-w-0">
                      <Avatar seed={l.mint} label={symbol} image={l.image} size={36} />
                      <span className="font-display font-bold text-lg truncate">{symbol}</span>
                    </Link>
                    <Link href={`/t/${l.mint}/stake`} className="text-sm font-semibold text-accent min-h-11 flex items-center shrink-0">Manage</Link>
                  </div>
                  {l.positions.map((p) => (
                    <div key={p.tierId} className="grid grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] gap-4 items-center py-4 border-t line">
                      <span className="font-display font-black text-2xl text-stake-light">{p.multiplierBps / 10_000}x</span>
                      <span className="flex flex-col gap-1">
                        <span className="font-mono">{fmtAmount(p.staked, 6, 2)} {symbol}{usdOf(p.staked, 6, l.mint) && <span className="text-faint"> · {usdOf(p.staked, 6, l.mint)}</span>}</span>
                        <span className="text-[13px] text-muted">{lockLabel(p.lockSeconds)}, {p.locked ? `unlocks ${dateOf(p.unlocksAt)}` : p.staked === "0" ? "exited" : "unlocked"}</span>
                      </span>
                      <span className="col-span-2 md:col-span-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] md:justify-end">
                        {p.pending.map((r) => <span key={r.mint}><span className="text-muted">Earned </span>{fmtAmount(r.amount, r.decimals ?? 0, 4)} {r.symbol ?? ""}{r.decimals !== null && usdOf(r.amount, r.decimals, r.mint) && <span className="text-faint"> · {usdOf(r.amount, r.decimals, r.mint)}</span>}</span>)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </main>
  );
}
