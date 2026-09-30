"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Avatar } from "@/web/ui/Avatar";
import { Button } from "@/web/ui/Button";
import { fmtAmount, shortAddr } from "@/web/ui/format";

type Position = {
  tierId: string; multiplierBps: number; lockSeconds: number; staked: string; unlocksAt: number; locked: boolean;
  pending: { mint: string; symbol: string | null; decimals: number | null; amount: string }[];
};
type Launch = { mint: string; symbol: string | null; name: string | null; image: string | null; positions: Position[] };

const days = (s: number) => Math.round(s / 86_400);
const dateOf = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function PortfolioApp() {
  const wallet = useWallet();
  const modal = useWalletModal();
  const owner = wallet.publicKey?.toBase58();
  const [launches, setLaunches] = useState<Launch[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!owner) { setLaunches(null); return; }
    setLaunches(null);
    setError(false);
    fetch(`/api/portfolio?owner=${owner}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => setLaunches(j.launches)).catch(() => setError(true));
  }, [owner]);

  return (
    <main className="flex flex-col gap-8 px-4 md:px-16 pt-10 md:pt-14 pb-16">
      <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Portfolio</h1>
      {!owner ? (
        <div className="flex flex-col items-start gap-4 py-10 border-t line">
          <p className="m-0 text-lg text-muted">Connect a wallet to see your stakes and rewards.</p>
          <Button onClick={() => modal.setVisible(true)}>Connect wallet</Button>
        </div>
      ) : error ? (
        <p className="m-0 text-burn py-10 border-t line">Your stakes could not load. Refresh to try again.</p>
      ) : launches === null ? (
        <div className="flex flex-col gap-3 border-t line pt-6">{[0, 1].map((i) => <div key={i} className="h-20 rounded-2xl bg-white/[0.03] animate-pulse" />)}</div>
      ) : launches.length === 0 ? (
        <div className="flex flex-col items-start gap-4 py-10 border-t line">
          <p className="m-0 text-lg text-muted">No stakes yet. Find a token you like and lock it to earn its basket.</p>
          <Link href="/explore" className="font-display font-bold text-ground bg-lime glow-lime rounded-full px-6 min-h-12 flex items-center">Explore tokens</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {launches.map((l) => {
            const symbol = l.symbol ?? shortAddr(l.mint);
            return (
              <section key={l.mint} className="flex flex-col">
                <div className="flex items-center justify-between gap-4 pb-4">
                  <Link href={`/t/${l.mint}`} className="flex items-center gap-3 min-w-0">
                    <Avatar seed={l.mint} label={symbol} image={l.image} size={44} />
                    <span className="flex flex-col min-w-0">
                      <span className="font-display font-bold text-xl truncate">{symbol}</span>
                      {l.name && <span className="text-[13px] text-muted truncate">{l.name}</span>}
                    </span>
                  </Link>
                  <Link href={`/t/${l.mint}/stake`} className="text-sm font-semibold text-lime min-h-11 flex items-center shrink-0">Manage</Link>
                </div>
                {l.positions.map((p) => (
                  <div key={p.tierId} className="grid grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] gap-4 items-center py-4 border-t line">
                    <span className="font-display font-black text-2xl text-violet-light">{p.multiplierBps / 10_000}x</span>
                    <span className="flex flex-col gap-1">
                      <span className="font-mono">{fmtAmount(p.staked, 6, 2)} {symbol}</span>
                      <span className="text-[13px] text-muted">{days(p.lockSeconds)} days, {p.locked ? `unlocks ${dateOf(p.unlocksAt)}` : p.staked === "0" ? "exited" : "unlocked"}</span>
                    </span>
                    <span className="col-span-2 md:col-span-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] md:justify-end">
                      {p.pending.map((r) => <span key={r.mint}><span className="text-muted">Earned </span>{fmtAmount(r.amount, r.decimals ?? 0, 4)} {r.symbol ?? ""}</span>)}
                    </span>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
