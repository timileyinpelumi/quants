"use client";
import { useState } from "react";
import { Button } from "@/web/ui/Button";
import { Flame } from "@/web/ui/Flame";
import { fmtAmount, lockLabel, lockShort } from "@/web/ui/format";
import { useStake, toBase, days, mult, dateOf, STAKE_DECIMALS as DECIMALS, type Tier } from "./useStake";
import { useUsd, usdText } from "@/web/ui/usd";
import { StakingOpens } from "./StakingOpens";
import type { StakingOpens as Opens } from "@/web/server/reads";

export function StakeApp({ mint, symbol, tiers, maxPenaltyBps, ready, opens }: { mint: string; symbol: string; tiers: Tier[]; maxPenaltyBps: number; ready: boolean; opens: Opens | null }) {
  const { owner, balance, positions, busy, error, act: run } = useStake(mint);
  const [tier, setTier] = useState(tiers[Math.min(2, tiers.length - 1)]?.id ?? tiers[0]!.id);
  const [amount, setAmount] = useState("");
  const [exiting, setExiting] = useState<string | null>(null);
  const rewardMints = [...new Set(positions.flatMap((p) => p.earned.map((r) => r.mint)))];
  const px = useUsd([mint, ...rewardMints]);
  const usd = (base: bigint | string, decimals = DECIMALS, m = mint) => usdText(Number(BigInt(base)) / 10 ** decimals, px[m]);

  async function act(action: "stake" | "claim" | "exit" | "withdraw", tierId: string, body: object = {}) {
    if (await run(action, tierId, body)) {
      setExiting(null);
      if (action === "stake") setAmount("");
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
          Lock longer.<br /><span className="text-stake-light">Earn more.</span>
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
                  className={`flex flex-col items-center gap-1 py-5 min-h-24 rounded-3xl cursor-pointer transition-colors ${on ? "bg-stake-light text-ground border border-stake-light glow-stake" : "bg-surface text-ink border border-white/10 hover:border-white/25"}`}
                >
                  <span className="font-display font-black text-2xl md:text-[28px]">{mult(t.multiplierBps)}</span>
                  <span className="text-[13px]">{lockLabel(t.lockSeconds)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-2.5 text-[13px] text-muted">
          <span className="flex justify-between"><span>Amount</span>{balance !== null && <span className="font-mono">You hold {fmtAmount(balance, DECIMALS, 2)} {symbol}{usd(balance) && <span className="text-faint"> · {usd(balance)}</span>}</span>}</span>
          <span className="flex items-center bg-surface border border-white/10 rounded-[22px] px-5 md:px-6 focus-within:border-stake/60">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="flex-1 min-w-0 font-display font-bold text-[28px] md:text-[32px] text-ink bg-transparent border-0 py-5 outline-none" />
            {balance !== null && balance > 0n && (
              <button type="button" onClick={() => setAmount(fmtAmount(balance, DECIMALS, DECIMALS).replace(/,/g, ""))} className="text-sm font-semibold text-stake-light px-2 min-h-11 cursor-pointer">Max</button>
            )}
            <span className="font-display font-bold text-[15px] text-muted pl-2">{symbol}</span>
          </span>
        </label>

        <div className="flex flex-col text-sm">
          <span className="flex justify-between py-2.5 border-b line"><span className="text-muted">Unlocks on</span><span className="font-mono">{unlockPreview}</span></span>
          <span className="flex justify-between py-2.5 border-b line"><span className="text-muted">Reward weight</span><span className="font-mono">{mult(selected.multiplierBps)}</span></span>
          <span className="flex justify-between py-2.5"><span className="text-muted">Leave early</span><span className="font-mono">up to {maxPenaltyBps / 100}% burned</span></span>
        </div>

        {lockedHere && <p className="m-0 text-sm text-burn">Adding to this stake restarts the {lockLabel(selected.lockSeconds)} lock for the whole position.</p>}
        {tooMuch && <p className="m-0 text-sm text-burn">You hold less {symbol} than that.</p>}
        {!ready && <StakingOpens initial={opens} />}
        {error && <p role="alert" className="m-0 text-sm text-burn">{error}</p>}

        <Button
          size="lg"
          disabled={!ready || busy !== null || (!!owner && (!amountBase || amountBase <= 0n || tooMuch))}
          onClick={() => act("stake", tier, { amount: amountBase?.toString() })}
        >
          {busy?.startsWith("stake") ? "Approve in your wallet" : owner ? `Stake for ${lockLabel(selected.lockSeconds)}` : "Connect wallet"}
        </Button>
      </section>

      <section className="flex flex-col gap-6 min-w-0">
        <div className="flex justify-between items-baseline gap-4">
          <h2 className="m-0 font-display font-black text-2xl md:text-[28px] tracking-tight">Your positions</h2>
        </div>

        {!owner ? (
          <p className="m-0 text-muted py-8 border-t line">Connect a wallet to see your stakes.</p>
        ) : positions.length === 0 ? (
          <p className="m-0 text-muted py-8 border-t line">No stakes yet. Pick a lock and stake {symbol}.</p>
        ) : (
          <div className="flex flex-col">
            {positions.map((p) => (
              <div key={p.tierId} className="flex flex-col gap-4 py-5 border-t line">
                <div className="grid grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[72px_minmax(0,1fr)_200px_auto] gap-4 items-center">
                  <span className="font-display font-black text-2xl text-stake-light">{mult(p.multiplierBps)}</span>
                  <span className="flex flex-col gap-1">
                    <span className="font-mono">{fmtAmount(p.staked, DECIMALS, 2)} {symbol}{usd(p.staked) && <span className="text-faint"> · {usd(p.staked)}</span>}</span>
                    <span className="text-[13px] text-muted">{lockLabel(p.lockSeconds)}, {p.locked ? `unlocks ${dateOf(p.unlocksAt)}` : p.staked === "0" ? "exited" : "unlocked"}</span>
                  </span>
                  <span className="col-span-2 md:col-span-1 flex flex-col gap-1 font-mono text-[13px]">
                    {p.earned.length === 0 && <span className="text-muted">Nothing earned yet</span>}
                    {p.earned.map((r) => <span key={r.mint}>{fmtAmount(r.amount, r.decimals ?? 0, 4)} {r.symbol ?? ""}{r.decimals !== null && usd(r.amount, r.decimals, r.mint) && <span className="text-faint"> · {usd(r.amount, r.decimals, r.mint)}</span>}</span>)}
                  </span>
                  <span className="col-span-2 md:col-span-1 flex gap-2 md:justify-end">
                    <span className="text-[13px] text-muted self-center">
                      {p.paying ? "Your lock ended. Payout is on the way." : p.paysAt ? `Paid after your lock ends on ${dateOf(p.paysAt)}` : ""}
                    </span>
                    {p.locked ? (
                      <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setExiting(exiting === p.tierId ? null : p.tierId)}>Exit early</Button>
                    ) : p.staked !== "0" ? (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("withdraw", p.tierId)}>{busy === `withdraw:${p.tierId}` ? "Approve" : "Withdraw"}</Button>
                    ) : null}
                  </span>
                </div>

                {exiting === p.tierId && p.exitPreview && (
                  <div className="flex flex-col gap-5 p-5 md:p-7 rounded-[32px] border border-burn/25" style={{ background: "linear-gradient(180deg, rgba(255,122,89,0.10), rgba(255,122,89,0.03))" }}>
                    <div className="flex items-center gap-3"><Flame /><span className="font-display font-black text-xl md:text-[22px]">Exit the {lockLabel(p.lockSeconds)} lock early?</span></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5 px-5 py-4 rounded-[22px] bg-surface"><span className="text-[13px] text-muted">You get back</span><span className="font-display font-bold text-2xl">{fmtAmount(p.exitPreview.back, DECIMALS, 2)} {symbol}</span>{usd(p.exitPreview.back) && <span className="font-mono text-[13px] text-faint">≈ {usd(p.exitPreview.back)}</span>}</div>
                      <div className="flex flex-col gap-1.5 px-5 py-4 rounded-[22px] bg-surface"><span className="text-[13px] text-muted">Burned</span><span className="font-display font-bold text-2xl text-burn">{fmtAmount(p.exitPreview.burned, DECIMALS, 2)} {symbol}</span>{usd(p.exitPreview.burned) && <span className="font-mono text-[13px] text-faint">≈ {usd(p.exitPreview.burned)}</span>}</div>
                    </div>
                    <p className="m-0 text-sm text-[#C9C5D6] leading-relaxed">
                      The penalty is {(p.exitPreview.penaltyBps / 100).toFixed(p.exitPreview.penaltyBps % 100 ? 1 : 0)}% because {lockLabel(Math.max(0, p.unlocksAt - Math.floor(Date.now() / 1000)))} of your {lockLabel(p.lockSeconds)} lock is left. It shrinks every day you stay. Leaving early gives up what this lock has earned so far. Burned tokens are destroyed and quants never receives them.
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
