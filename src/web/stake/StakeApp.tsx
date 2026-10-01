"use client";
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/web/ui/Button";
import { Flame } from "@/web/ui/Flame";
import { fmtAmount } from "@/web/ui/format";
import { signAndSendAll } from "@/web/wallet/send";

type Tier = { id: string; lockSeconds: number; multiplierBps: number };
type Position = {
  tierId: string; multiplierBps: number; lockSeconds: number; staked: string; unlocksAt: number; locked: boolean;
  pending: { mint: string; symbol: string | null; decimals: number | null; amount: string }[];
  exitPreview: { back: string; burned: string; penaltyBps: number; daysLeft: number } | null;
};

const DECIMALS = 6;
const days = (s: number) => Math.round(s / 86_400);
const mult = (bps: number) => `${bps / 10_000}x`;
const dateOf = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function toBase(v: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [w, f = ""] = v.split(".");
  return BigInt(w || "0") * 10n ** BigInt(DECIMALS) + BigInt((f + "000000").slice(0, DECIMALS));
}

export function StakeApp({ mint, symbol, tiers, maxPenaltyBps, ready }: { mint: string; symbol: string; tiers: Tier[]; maxPenaltyBps: number; ready: boolean }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const modal = useWalletModal();
  const [tier, setTier] = useState(tiers[Math.min(2, tiers.length - 1)]?.id ?? tiers[0]!.id);
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exiting, setExiting] = useState<string | null>(null);
  const owner = wallet.publicKey?.toBase58();

  const refresh = useCallback(async () => {
    if (!owner) { setPositions([]); setBalance(null); return; }
    const [p, b] = await Promise.all([
      fetch(`/api/launches/${mint}/positions?owner=${owner}`).then((r) => r.json()).catch(() => ({ positions: [] })),
      connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner))).then((r) => BigInt(r.value.amount)).catch(() => 0n),
    ]);
    setPositions(p.positions ?? []);
    setBalance(b);
  }, [owner, mint, connection]);

  useEffect(() => { refresh(); }, [refresh]);

  async function act(action: "stake" | "claim" | "exit" | "withdraw", tierId: string, body: object = {}) {
    if (!owner) { modal.setVisible(true); return; }
    setError(null);
    setBusy(`${action}:${tierId}`);
    try {
      const r = await fetch(`/api/stake/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mint, tierId, owner, ...body }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Something went wrong");
      await signAndSendAll(wallet, connection, [j.transaction]);
      setExiting(null);
      if (action === "stake") setAmount("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const selected = tiers.find((t) => t.id === tier)!;
  const lockedHere = positions.find((p) => p.tierId === tier && p.locked);
  const amountBase = toBase(amount);
  const tooMuch = amountBase !== null && balance !== null && amountBase > balance;
  const unlockPreview = dateOf(Math.floor(Date.now() / 1000) + selected.lockSeconds);

  return (
    <main className="grid grid-cols-1 lg:grid-cols-[560px_minmax(0,1fr)] gap-12 lg:gap-16 wrap pt-10 md:pt-14 pb-16">
      <section className="flex flex-col gap-7 min-w-0">
        <h1 className="m-0 font-display font-black text-[40px] md:text-[52px] leading-[1.02] tracking-[-0.03em]">
          Lock longer.<br /><span className="text-violet-light">Earn more.</span>
        </h1>

        <div className="flex flex-col gap-3">
          <span className="text-[13px] text-muted">Pick a lock</span>
          <div role="group" aria-label="Lock tier" className="grid grid-cols-4 gap-2.5">
            {tiers.map((t) => {
              const on = t.id === tier;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTier(t.id)}
                  className={`flex flex-col items-center gap-1 py-5 min-h-24 rounded-3xl cursor-pointer transition-colors ${on ? "bg-violet-light text-ground border border-violet-light glow-violet" : "bg-surface text-ink border border-white/10 hover:border-white/25"}`}
                >
                  <span className="font-display font-black text-2xl md:text-[28px]">{mult(t.multiplierBps)}</span>
                  <span className="text-[13px]">{days(t.lockSeconds)} days</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-2.5 text-[13px] text-muted">
          <span className="flex justify-between"><span>Amount</span>{balance !== null && <span className="font-mono">You hold {fmtAmount(balance, DECIMALS, 2)} {symbol}</span>}</span>
          <span className="flex items-center bg-surface border border-white/10 rounded-[22px] px-5 md:px-6 focus-within:border-violet/60">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="flex-1 min-w-0 font-display font-bold text-[28px] md:text-[32px] text-ink bg-transparent border-0 py-5 outline-none" />
            {balance !== null && balance > 0n && (
              <button type="button" onClick={() => setAmount(fmtAmount(balance, DECIMALS, DECIMALS).replace(/,/g, ""))} className="text-sm font-semibold text-violet-light px-2 min-h-11 cursor-pointer">Max</button>
            )}
            <span className="font-display font-bold text-[15px] text-muted pl-2">{symbol}</span>
          </span>
        </label>

        <div className="flex flex-col text-sm">
          <span className="flex justify-between py-2.5 border-b line"><span className="text-muted">Unlocks on</span><span className="font-mono">{unlockPreview}</span></span>
          <span className="flex justify-between py-2.5 border-b line"><span className="text-muted">Reward weight</span><span className="font-mono">{mult(selected.multiplierBps)}</span></span>
          <span className="flex justify-between py-2.5"><span className="text-muted">Leave early</span><span className="font-mono">up to {maxPenaltyBps / 100}% burned</span></span>
        </div>

        {lockedHere && <p className="m-0 text-sm text-burn">Adding to this stake restarts its {days(selected.lockSeconds)} day lock for the whole position.</p>}
        {tooMuch && <p className="m-0 text-sm text-burn">You hold less {symbol} than that.</p>}
        {!ready && <p className="m-0 text-sm text-muted">Staking opens a few minutes after launch.</p>}
        {error && <p role="alert" className="m-0 text-sm text-burn">{error}</p>}

        <Button
          size="lg"
          disabled={!ready || busy !== null || (!!owner && (!amountBase || amountBase <= 0n || tooMuch))}
          onClick={() => act("stake", tier, { amount: amountBase?.toString() })}
        >
          {busy?.startsWith("stake") ? "Approve in your wallet" : owner ? `Stake for ${days(selected.lockSeconds)} days` : "Connect wallet"}
        </Button>
      </section>

      <section className="flex flex-col gap-6 min-w-0">
        <div className="flex justify-between items-baseline gap-4">
          <h2 className="m-0 font-display font-black text-2xl md:text-[28px] tracking-tight">Your positions</h2>
        </div>

        {!owner ? (
          <p className="m-0 text-muted py-8 border-t line">Connect a wallet to see your stakes.</p>
        ) : positions.length === 0 ? (
          <p className="m-0 text-muted py-8 border-t line">No stakes yet. Pick a lock and stake some {symbol}.</p>
        ) : (
          <div className="flex flex-col">
            {positions.map((p) => (
              <div key={p.tierId} className="flex flex-col gap-4 py-5 border-t line">
                <div className="grid grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[72px_minmax(0,1fr)_200px_auto] gap-4 items-center">
                  <span className="font-display font-black text-2xl text-violet-light">{mult(p.multiplierBps)}</span>
                  <span className="flex flex-col gap-1">
                    <span className="font-mono">{fmtAmount(p.staked, DECIMALS, 2)} {symbol}</span>
                    <span className="text-[13px] text-muted">{days(p.lockSeconds)} days, {p.locked ? `unlocks ${dateOf(p.unlocksAt)}` : p.staked === "0" ? "exited" : "unlocked"}</span>
                  </span>
                  <span className="col-span-2 md:col-span-1 flex flex-col gap-1 font-mono text-[13px]">
                    {p.pending.map((r) => <span key={r.mint}>{fmtAmount(r.amount, r.decimals ?? 0, 4)} {r.symbol ?? ""}</span>)}
                  </span>
                  <span className="col-span-2 md:col-span-1 flex gap-2 md:justify-end">
                    <Button size="sm" variant="lime" disabled={busy !== null || p.pending.every((r) => r.amount === "0")} onClick={() => act("claim", p.tierId)}>
                      {busy === `claim:${p.tierId}` ? "Approve" : "Claim"}
                    </Button>
                    {p.locked ? (
                      <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setExiting(exiting === p.tierId ? null : p.tierId)}>Exit early</Button>
                    ) : p.staked !== "0" ? (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("withdraw", p.tierId)}>{busy === `withdraw:${p.tierId}` ? "Approve" : "Withdraw"}</Button>
                    ) : null}
                  </span>
                </div>

                {exiting === p.tierId && p.exitPreview && (
                  <div className="flex flex-col gap-5 p-5 md:p-7 rounded-[32px] border border-burn/25" style={{ background: "linear-gradient(180deg, rgba(255,122,89,0.10), rgba(255,122,89,0.03))" }}>
                    <div className="flex items-center gap-3"><Flame /><span className="font-display font-black text-xl md:text-[22px]">Exit the {days(p.lockSeconds)} day lock early?</span></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5 px-5 py-4 rounded-[22px] bg-surface"><span className="text-[13px] text-muted">You get back</span><span className="font-display font-bold text-2xl">{fmtAmount(p.exitPreview.back, DECIMALS, 2)} {symbol}</span></div>
                      <div className="flex flex-col gap-1.5 px-5 py-4 rounded-[22px] bg-surface"><span className="text-[13px] text-muted">Burned</span><span className="font-display font-bold text-2xl text-burn">{fmtAmount(p.exitPreview.burned, DECIMALS, 2)} {symbol}</span></div>
                    </div>
                    <p className="m-0 text-sm text-[#C9C5D6] leading-relaxed">
                      The penalty is {(p.exitPreview.penaltyBps / 100).toFixed(p.exitPreview.penaltyBps % 100 ? 1 : 0)}% because {p.exitPreview.daysLeft} of your {days(p.lockSeconds)} days are left. It shrinks every day you stay. Rewards you already earned are yours to keep. Burned tokens are gone for good, and quants never receives them.
                    </p>
                    <div className="flex flex-wrap gap-2.5">
                      <Button variant="burn" disabled={busy !== null} onClick={() => act("exit", p.tierId)}>{busy === `exit:${p.tierId}` ? "Approve in your wallet" : `Exit and burn ${fmtAmount(p.exitPreview.burned, DECIMALS, 0)} ${symbol}`}</Button>
                      <Button variant="outline" onClick={() => setExiting(null)}>Keep staking</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
