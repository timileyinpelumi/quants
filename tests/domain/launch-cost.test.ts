import { test, expect } from "bun:test";
import { launchCost, opensAt, FARM_RENT, TOKEN_ACCOUNT_RENT, TX_FEE } from "../../src/domain/launch-cost";
import { defaultSettings } from "../../src/domain/settings";

test("the rent covers farm setup for every lock tier", () => {
  const s = defaultSettings("OURS1111111111111111111111111111111111111111");
  const c = launchCost(s, 3);
  // Farm account, stake vault and a reward vault per reward; create (two signers), one reward batch, configure.
  const perFarm = FARM_RENT + TOKEN_ACCOUNT_RENT * 4n + 2n * TX_FEE * 4n;
  // One treasury vault per reward mint and the spill account, shared by every farm of the launch.
  const perLaunch = TOKEN_ACCOUNT_RENT * 4n;
  expect(c.rent).toBe(BigInt(s.tiers.length) * perFarm + perLaunch);
});

test("ten rewards take two reward batches per farm", () => {
  const s = { tiers: [{ id: "7d", lockSeconds: 604_800, multiplierBps: 10_000 }] };
  expect(launchCost(s, 10).rent).toBe(FARM_RENT + TOKEN_ACCOUNT_RENT * 11n + 2n * TX_FEE * 5n + TOKEN_ACCOUNT_RENT * 11n);
});

test("default lock tiers run from 24 hours to 30 days", () => {
  expect(defaultSettings("OURS1111111111111111111111111111111111111111").tiers.map((t) => t.lockSeconds / 3600)).toEqual([24, 72, 168, 720]);
});

test("opensAt is the stakers' share as a percent of the rent, floored and capped at 100", () => {
  expect(opensAt({ valueLamports: 0n, rentLamports: 400n })).toBe(0);
  expect(opensAt({ valueLamports: 168n, rentLamports: 400n })).toBe(42);
  expect(opensAt({ valueLamports: 399n, rentLamports: 400n })).toBe(99);
  expect(opensAt({ valueLamports: 400n, rentLamports: 400n })).toBe(100);
  expect(opensAt({ valueLamports: 10_000n, rentLamports: 400n })).toBe(100);
});

test("what a launcher's wallet needs: config rent only when the pair has no key, then launch rent, first buy, fees and top up", async () => {
  const { walletNeed, needSolMessage, CONFIG_RENT, LAUNCH_RENT, LAUNCH_FEES, SHORT_OF_SOL } = await import("../../src/domain/launch-cost");
  expect(walletNeed({ config: false, firstBuy: 0n })).toBe(LAUNCH_RENT + LAUNCH_FEES);
  expect(walletNeed({ config: true, firstBuy: 1_000_000_000n, keeperTopUp: 6_000_000n })).toBe(CONFIG_RENT + LAUNCH_RENT + LAUNCH_FEES + 1_006_000_000n);
  expect(needSolMessage(21_000_000n)).toBe("Your wallet needs about 0.021 SOL for this launch. Add SOL and try again.");
  expect(needSolMessage(50_000_000n)).toBe("Your wallet needs about 0.050 SOL for this launch. Add SOL and try again.");
  expect(needSolMessage(1_021_000_000n)).toBe("Your wallet needs about 1.021 SOL for this launch. Add SOL and try again.");
  for (const m of ["Transfer: insufficient lamports 4900000, need 8000000", "InsufficientFundsForRent", "Attempt to debit an account but found no record of a prior credit."]) expect(SHORT_OF_SOL.test(m)).toBe(true);
});
