import type { Settings } from "./settings";

// Rent-exempt minimums for a Kamino FarmState (8,336 bytes) and an SPL token account (165 bytes).
export const FARM_RENT = 58_909_440n;
export const TOKEN_ACCOUNT_RENT = 2_039_280n;
export const TX_FEE = 5_000n;
// Kamino reward registrations per transaction. Each adds about 120 bytes and 50-70k compute units; ten exceed the 1,232 byte limit.
export const REWARDS_PER_TX = 5;

/**
 * The rent the stakers' share has to cover before staking opens, which is what the keeper spends to set up staking: per lock tier a farm account, its stake vault, a reward vault per reward
 * token, and the signatures to create it, register rewards and configure it (doubled to cover retries).
 * Once per launch: a Kamino treasury vault per reward mint (keyed by global config and mint, so free when an earlier
 * launch used the mint) and the spill account for slashed stake.
 */
export function launchCost(s: Pick<Settings, "tiers">, rewardCount: number) {
  const signatures = BigInt(3 + Math.ceil(rewardCount / REWARDS_PER_TX));
  const perFarm = FARM_RENT + TOKEN_ACCOUNT_RENT * BigInt(1 + rewardCount) + 2n * TX_FEE * signatures;
  const rent = BigInt(s.tiers.length) * perFarm + TOKEN_ACCOUNT_RENT * BigInt(rewardCount + 1);
  return { rent };
}

/** Percent of the farm rent the stakers' share covers, floored so it reads 100 only once staking can open. */
export function opensAt(p: { valueLamports: bigint; rentLamports: bigint }): number {
  if (p.rentLamports <= 0n) return 100;
  const pct = (p.valueLamports * 100n) / p.rentLamports;
  return Number(pct > 100n ? 100n : pct < 0n ? 0n : pct);
}
