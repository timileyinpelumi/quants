import { test, expect } from "bun:test";
import { earlyExitPenalty } from "../../src/domain/penalty";

const DAY = 86_400;

test("penalty decays linearly with remaining lock time", () => {
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, 45 * DAY)).toBe(150_000n);
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, 90 * DAY)).toBe(300_000n);
});

test("no penalty after the lock ends, remaining time is capped at the lock", () => {
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, 0)).toBe(0n);
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, -5)).toBe(0n);
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, 200 * DAY)).toBe(300_000n);
});
