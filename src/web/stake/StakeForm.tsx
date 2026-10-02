"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/web/ui/Button";
import { fmtAmount, lockLabel, lockShort } from "@/web/ui/format";
import { useStake, toBase, days, mult, dateOf, STAKE_DECIMALS, type Tier } from "./useStake";
import { useUsd, usdText } from "@/web/ui/usd";
import { StakingOpens } from "./StakingOpens";
import type { StakingOpens as Opens } from "@/web/server/reads";

export function StakeForm({ mint, symbol, tiers, maxPenaltyBps, ready, earns, opens }: {
  mint: string; symbol: string; tiers: Tier[]; maxPenaltyBps: number; ready: boolean; earns: string; opens: Opens | null;
}) {
  const { owner, balance, positions, busy, error, act } = useStake(mint);
  const [tier, setTier] = useState(tiers[Math.min(1, tiers.length - 1)]?.id ?? tiers[0]!.id);
  const [amount, setAmount] = useState("");
  const selected = tiers.find((t) => t.id === tier)!;
  const amountBase = toBase(amount);
  const tooMuch = amountBase !== null && balance !== null && amountBase > balance;
  const lockedHere = positions.find((p) => p.tierId === tier && p.locked);
  const active = positions.filter((p) => p.staked !== "0");
  const price = useUsd([mint])[mint];
  const usd = (base: bigint | string) => usdText(Number(BigInt(base)) / 10 ** STAKE_DECIMALS, price);

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-muted">Stake {symbol} to earn {earns} from every trade. Longer locks earn a bigger share.</p>
      <div role="group" aria-label="Lock tier" className="grid grid-cols-4 gap-1.5">
        {tiers.map((t) => (
          <button key={t.id} type="button" aria-pressed={t.id === tier} onClick={() => setTier(t.id)}
            className={`flex flex-col items-center gap-0.5 py-3 rounded-2xl cursor-pointer ${t.id === tier ? "bg-stake-light text-ground" : "bg-ground border border-white/10 hover:border-white/25"}`}>
            <span className="font-display font-black text-lg">{mult(t.multiplierBps)}</span>
            <span className="text-[12px]">{lockShort(t.lockSeconds)}</span>
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-2.5 text-[13px] text-muted">
        <span className="flex justify-between"><span>You stake</span>{balance !== null && <span className="font-mono">Balance {fmtAmount(balance, STAKE_DECIMALS, 2)} {symbol}{usd(balance) && <span className="text-faint"> · {usd(balance)}</span>}</span>}</span>
        <span className="flex items-center bg-ground border border-white/10 rounded-[20px] px-5 focus-within:border-stake/60">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-label={`Amount of ${symbol} to stake`} className="flex-1 min-w-0 font-display font-bold text-[28px] text-ink bg-transparent border-0 py-4 outline-none" />
          {balance !== null && balance > 0n && (
            <button type="button" onClick={() => setAmount(fmtAmount(balance, STAKE_DECIMALS, STAKE_DECIMALS).replace(/,/g, ""))} className="text-sm font-semibold text-stake-light px-2 min-h-11 cursor-pointer">Max</button>
          )}
          <span className="flex flex-col items-end pl-2">
            <span className="font-display font-bold text-[15px] text-muted">{symbol}</span>
            {amountBase && amountBase > 0n && usd(amountBase) && <span className="font-mono text-[12px] text-faint">≈ {usd(amountBase)}</span>}
          </span>
        </span>
      </label>
      <div className="flex flex-col text-sm">
        <span className="flex justify-between py-2 border-b line"><span className="text-muted">Unlocks on</span><span className="font-mono">{dateOf(Math.floor(Date.now() / 1000) + selected.lockSeconds)}</span></span>
        <span className="flex justify-between py-2"><span className="text-muted">Leave early</span><span className="font-mono">up to {maxPenaltyBps / 100}% burned</span></span>
      </div>
      {lockedHere && <p className="m-0 text-sm text-burn">Adding restarts this {lockLabel(selected.lockSeconds)} lock for the whole position.</p>}
      {tooMuch && <p className="m-0 text-sm text-burn">You hold less {symbol} than that.</p>}
      {!ready && <StakingOpens initial={opens} />}
      {error && <p role="alert" className="m-0 text-sm text-burn">{error}</p>}
      <Button size="lg" variant="stake" disabled={!ready || busy !== null || (!!owner && (!amountBase || amountBase <= 0n || tooMuch))}
        onClick={async () => { if (await act("stake", tier, { amount: amountBase?.toString() })) setAmount(""); }}>
        {busy?.startsWith("stake") ? "Approve in your wallet" : owner ? `Stake for ${lockLabel(selected.lockSeconds)}` : "Connect wallet"}
      </Button>
      {active.length > 0 && (
        <div className="flex flex-col text-sm">
          {active.map((p) => (
            <span key={p.tierId} className="flex justify-between py-2 border-t line">
              <span className="font-mono">{fmtAmount(p.staked, STAKE_DECIMALS, 2)} {symbol} at {mult(p.multiplierBps)}{usd(p.staked) && <span className="text-faint"> · {usd(p.staked)}</span>}</span>
              <span className="text-muted">{p.locked ? `unlocks ${dateOf(p.unlocksAt)}` : "unlocked"}</span>
            </span>
          ))}
        </div>
      )}
      <Link href={`/t/${mint}/stake`} className="text-center text-sm text-stake-light min-h-11 md:min-h-9 flex items-center justify-center">{active.length ? "Claim rewards or manage stakes" : "See all lock tiers"}</Link>
    </div>
  );
}
