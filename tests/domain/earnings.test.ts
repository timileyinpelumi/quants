import { test, expect } from "bun:test";
import { accrue, TOTAL_SUPPLY_BASE } from "../../src/domain/earnings";

const DAY = 86_400;
const tokens = (n: number) => BigInt(n) * 10n ** 6n;

test("a small staker below the target earns their per-token rate and the rest stays in the reserve", () => {
  // 500K tokens is 0.05% of supply; at a 50% target they get 0.1% of the day's drip.
  const out = accrue({ reserve: 30_000_000n, dtSeconds: DAY, periodSeconds: 30 * DAY, targetBps: 5000, stakes: [{ key: "a", staked: tokens(500_000), multiplierBps: 10_000 }] });
  expect(out.get("a")).toBe(1_000n);
});

test("longer tiers earn more per token through the multiplier", () => {
  const out = accrue({ reserve: 30_000_000n, dtSeconds: DAY, periodSeconds: 30 * DAY, targetBps: 5000, stakes: [
    { key: "1d", staked: tokens(500_000), multiplierBps: 10_000 }, { key: "30d", staked: tokens(500_000), multiplierBps: 20_000 },
  ] });
  expect(out.get("30d")).toBe(2n * out.get("1d")!);
});

test("above the target stakers split the full drip pro rata and never exceed it", () => {
  const half = TOTAL_SUPPLY_BASE / 2n;
  const out = accrue({ reserve: 30_000_000n, dtSeconds: DAY, periodSeconds: 30 * DAY, targetBps: 5000, stakes: [
    { key: "a", staked: half, multiplierBps: 10_000 }, { key: "b", staked: half, multiplierBps: 10_000 },
  ] });
  expect(out.get("a")).toBe(500_000n);
  expect(out.get("b")).toBe(500_000n);
});

test("nothing accrues with no time, no reserve or no stake, and a long gap is capped at one period", () => {
  const s = [{ key: "a", staked: TOTAL_SUPPLY_BASE, multiplierBps: 10_000 }];
  expect(accrue({ reserve: 100n, dtSeconds: 0, periodSeconds: DAY, targetBps: 5000, stakes: s }).size).toBe(0);
  expect(accrue({ reserve: 0n, dtSeconds: DAY, periodSeconds: DAY, targetBps: 5000, stakes: s }).size).toBe(0);
  expect(accrue({ reserve: 100n, dtSeconds: DAY, periodSeconds: DAY, targetBps: 5000, stakes: [] }).size).toBe(0);
  expect(accrue({ reserve: 100n, dtSeconds: 10 * DAY, periodSeconds: DAY, targetBps: 5000, stakes: s }).get("a")).toBe(100n);
});
