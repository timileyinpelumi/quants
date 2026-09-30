import { test, expect } from "bun:test";
import { splitFees, splitByWeights, allocateAcrossTiers } from "../../src/domain/weights";

const split = { basketBps: 6000, platformBps: 2500, creatorBps: 1500 };

test("splitFees uses the configured ratio", () => {
  expect(splitFees(1_000_000n, split)).toEqual({ basket: 600_000n, platform: 250_000n, creator: 150_000n });
});

test("splitFees gives rounding dust to the basket and always sums to the input", () => {
  for (const amount of [0n, 1n, 7n, 999_999n, 123_456_789_012n]) {
    const r = splitFees(amount, split);
    expect(r.basket + r.platform + r.creator).toBe(amount);
  }
  expect(splitFees(1n, split)).toEqual({ basket: 1n, platform: 0n, creator: 0n });
});

test("splitFees rejects negative amounts", () => {
  expect(() => splitFees(-1n, split)).toThrow();
});

test("splitByWeights is proportional and exact", () => {
  const r = splitByWeights(100n, [{ key: "a", weight: 5000n }, { key: "b", weight: 3000n }, { key: "c", weight: 2000n }]);
  expect([...r.entries()]).toEqual([["a", 50n], ["b", 30n], ["c", 20n]]);
  const odd = splitByWeights(10n, [{ key: "a", weight: 1n }, { key: "b", weight: 1n }, { key: "c", weight: 1n }]);
  expect([...odd.values()].reduce((x, y) => x + y, 0n)).toBe(10n);
});

test("splitByWeights returns empty when all weights are zero", () => {
  expect(splitByWeights(100n, [{ key: "a", weight: 0n }]).size).toBe(0);
});

test("allocateAcrossTiers weights stake by multiplier", () => {
  const r = allocateAcrossTiers(1_000n, [
    { tierId: "7d", staked: 100n, multiplierBps: 10_000 },
    { tierId: "180d", staked: 100n, multiplierBps: 30_000 },
  ]);
  expect(r.get("7d")).toBe(250n);
  expect(r.get("180d")).toBe(750n);
});

test("allocateAcrossTiers skips empty tiers and holds everything when nobody staked", () => {
  const r = allocateAcrossTiers(1_000n, [
    { tierId: "7d", staked: 0n, multiplierBps: 10_000 },
    { tierId: "30d", staked: 50n, multiplierBps: 15_000 },
  ]);
  expect([...r.entries()]).toEqual([["30d", 1_000n]]);
  expect(allocateAcrossTiers(1_000n, [{ tierId: "7d", staked: 0n, multiplierBps: 10_000 }]).size).toBe(0);
});
