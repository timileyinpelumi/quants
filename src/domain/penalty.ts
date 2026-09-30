import { BPS } from "./types";

// Mirrors kfarms rounding: the rate is floored in bps before it is applied to the amount.
export function earlyExitPenalty(amount: bigint, maxPenaltyBps: number, lockSeconds: number, secondsRemaining: number): bigint {
  if (secondsRemaining <= 0) return 0n;
  const remaining = BigInt(Math.min(secondsRemaining, lockSeconds));
  const bps = (BigInt(maxPenaltyBps) * remaining) / BigInt(lockSeconds);
  return (amount * bps) / BPS;
}
