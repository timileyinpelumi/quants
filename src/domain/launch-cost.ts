import type { Settings } from "./settings";

// Rent-exempt minimums for a Kamino FarmState (8,336 bytes) and an SPL token account (165 bytes).
export const FARM_RENT = 58_909_440n;
export const TOKEN_ACCOUNT_RENT = 2_039_280n;
export const TX_FEE = 5_000n;
// Rent-exempt minimum for a Kamino GlobalConfig (2,136 bytes) plus two signatures, doubled for a retry.
export const GLOBAL_CONFIG_COST = 15_757_440n + 4n * TX_FEE;
// Kamino reward registrations per transaction. Each adds about 120 bytes and 50-70k compute units; ten exceed the 1,232 byte limit.
export const REWARDS_PER_TX = 5;

/**
 * With `globalConfig`, the first launch to open staking also covers the Kamino global config, which is created then.
 * The rent the stakers' share has to cover before staking opens, which is what the keeper spends to set up staking: per lock tier a farm account, its stake vault, a reward vault per reward
 * token, and the signatures to create it, register rewards and configure it (doubled to cover retries).
 * Once per launch: a Kamino treasury vault per reward mint (keyed by global config and mint, so free when an earlier
 * launch used the mint) and the spill account for slashed stake.
 */
export function launchCost(s: Pick<Settings, "tiers">, rewardCount: number, o: { globalConfig?: boolean } = {}) {
  const signatures = BigInt(3 + Math.ceil(rewardCount / REWARDS_PER_TX));
  const perFarm = FARM_RENT + TOKEN_ACCOUNT_RENT * BigInt(1 + rewardCount) + 2n * TX_FEE * signatures;
  const rent = BigInt(s.tiers.length) * perFarm + TOKEN_ACCOUNT_RENT * BigInt(rewardCount + 1) + (o.globalConfig ? GLOBAL_CONFIG_COST : 0n);
  return { rent };
}

// Rent a launcher pays: a DBC config key (about 1,050 bytes), and for the launch the pool, mint, two vaults,
// token metadata and the first buy's token account. Rounded up; the wallet shows the exact amount.
export const CONFIG_RENT = 8_000_000n;
export const LAUNCH_RENT = 20_000_000n;
// Network and priority fees for up to three transactions.
export const LAUNCH_FEES = 1_000_000n;

/** Lamports a launcher's wallet needs for the whole launch: config rent when the pair has no key yet, launch rent, the first buy, fees and any keeper top up. */
export function walletNeed(o: { config: boolean; firstBuy: bigint; keeperTopUp?: bigint }): bigint {
  return (o.config ? CONFIG_RENT : 0n) + LAUNCH_RENT + o.firstBuy + LAUNCH_FEES + (o.keeperTopUp ?? 0n);
}

/** Errors that mean the wallet is short of SOL, from a simulation or a wallet's own send. */
export const SHORT_OF_SOL = /AccountNotFound|InsufficientFundsForFee|InsufficientFundsForRent|insufficient lamports|insufficient funds|no record of a prior credit/i;

/** `need` is rounded up to 0.001 SOL. */
export const needSolMessage = (need: bigint) =>
  `Your wallet needs about ${(Number((need + 999_999n) / 1_000_000n) / 1000).toFixed(3)} SOL for this launch. Add SOL and try again.`;

/** Percent of the farm rent the stakers' share covers, floored so it reads 100 only once staking can open. */
export function opensAt(p: { valueLamports: bigint; rentLamports: bigint }): number {
  if (p.rentLamports <= 0n) return 100;
  const pct = (p.valueLamports * 100n) / p.rentLamports;
  return Number(pct > 100n ? 100n : pct < 0n ? 0n : pct);
}
