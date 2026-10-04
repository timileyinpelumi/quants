// Every launch mints 1B tokens with 6 decimals.
export const TOTAL_SUPPLY_BASE = 1_000_000_000n * 10n ** 6n;

export interface EarningStake { key: string; staked: bigint; multiplierBps: number }

/**
 * Each staker earns reserve × (dt / period) × weight / max(target × supply, total weight), where weight is stake × multiplier.
 * Below the target the leftover stays in the reserve for holders who stake later; above it stakers share pro rata.
 */
export function accrue(i: { reserve: bigint; dtSeconds: number; periodSeconds: number; targetBps: number; supply?: bigint; stakes: EarningStake[] }): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const dt = BigInt(Math.max(0, Math.min(Math.floor(i.dtSeconds), i.periodSeconds)));
  if (i.reserve <= 0n || dt === 0n) return out;
  const weights = i.stakes.map((s) => ({ key: s.key, w: s.staked * BigInt(s.multiplierBps) })).filter((s) => s.w > 0n);
  const total = weights.reduce((a, s) => a + s.w, 0n);
  const target = BigInt(i.targetBps) * (i.supply ?? TOTAL_SUPPLY_BASE);
  const denom = (total > target ? total : target) * BigInt(i.periodSeconds);
  if (denom === 0n) return out;
  for (const s of weights) {
    const amount = (i.reserve * dt * s.w) / denom;
    if (amount > 0n) out.set(s.key, amount);
  }
  return out;
}
