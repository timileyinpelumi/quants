import { test, expect } from "bun:test";
import { launchCost, FARM_RENT, TOKEN_ACCOUNT_RENT, TX_FEE } from "../../src/domain/launch-cost";
import { defaultSettings } from "../../src/domain/settings";

test("the launch fee is the platform fee plus farm setup for every lock tier", () => {
  const s = defaultSettings("OURS");
  const c = launchCost(s, 3);
  // Farm account, stake vault and a reward vault per reward; create (two signers), one reward batch, configure.
  const perFarm = FARM_RENT + TOKEN_ACCOUNT_RENT * 4n + 2n * TX_FEE * 4n;
  // One treasury vault per reward mint and the spill account, shared by every farm of the launch.
  const perLaunch = TOKEN_ACCOUNT_RENT * 4n;
  expect(c.rent).toBe(BigInt(s.tiers.length) * perFarm + perLaunch);
  expect(c.total).toBe(s.launchFeeLamports + c.rent);
});

test("ten rewards take two reward batches per farm", () => {
  const s = { launchFeeLamports: 0n, tiers: [{ id: "7d", lockSeconds: 604_800, multiplierBps: 10_000 }] };
  expect(launchCost(s, 10).rent).toBe(FARM_RENT + TOKEN_ACCOUNT_RENT * 11n + 2n * TX_FEE * 5n + TOKEN_ACCOUNT_RENT * 11n);
});

test("default lock tiers start at 12 hours", () => {
  expect(defaultSettings("OURS").tiers.map((t) => t.lockSeconds / 3600)).toEqual([12, 24, 72, 168, 720, 2160, 4320]);
});
