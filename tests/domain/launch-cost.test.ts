import { test, expect } from "bun:test";
import { launchCost, FARM_RENT, TOKEN_ACCOUNT_RENT } from "../../src/domain/launch-cost";
import { defaultSettings } from "../../src/domain/settings";

test("the launch fee is the platform fee plus rent for one farm per lock tier and its reward vaults", () => {
  const s = defaultSettings("OURS");
  const c = launchCost(s, 3);
  const perFarm = FARM_RENT + TOKEN_ACCOUNT_RENT * 7n; // stake vault plus a reward vault and a treasury vault per reward
  expect(c.rent).toBe(BigInt(s.tiers.length) * perFarm);
  expect(c.total).toBe(s.launchFeeLamports + c.rent);
  expect(launchCost(s, 10).rent).toBeGreaterThan(c.rent);
});

test("default lock tiers start at 12 hours", () => {
  expect(defaultSettings("OURS").tiers.map((t) => t.lockSeconds / 3600)).toEqual([12, 24, 72, 168, 720, 2160, 4320]);
});
