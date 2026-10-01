import type { Settings } from "./settings";

// Rent-exempt minimums for a Kamino FarmState (8,336 bytes) and an SPL token account (165 bytes).
export const FARM_RENT = 58_909_440n;
export const TOKEN_ACCOUNT_RENT = 2_039_280n;

/** The keeper creates one farm per lock tier, each with a stake vault and a reward plus treasury vault per reward token. */
export function launchCost(s: Pick<Settings, "launchFeeLamports" | "tiers">, rewardCount: number) {
  const perFarm = FARM_RENT + TOKEN_ACCOUNT_RENT * BigInt(1 + 2 * rewardCount);
  const rent = BigInt(s.tiers.length) * perFarm;
  return { fee: s.launchFeeLamports, rent, total: s.launchFeeLamports + rent };
}
