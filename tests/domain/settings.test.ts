import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { defaultSettings, parseSettings, saveSettings, loadLatestSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";

const OURS = "OURS1111111111111111111111111111111111111111";

test("defaults match the spec", () => {
  const s = defaultSettings(OURS);
  expect(s.split).toEqual({ basketBps: 6000, platformBps: 2500, creatorBps: 1500 });
  expect(s.tiers.map((t) => [t.id, t.lockSeconds, t.multiplierBps])).toEqual([
    ["12h", 43_200, 10_000], ["1d", 86_400, 11_000], ["3d", 259_200, 12_500], ["7d", 604_800, 15_000],
    ["30d", 2_592_000, 20_000], ["90d", 7_776_000, 25_000], ["180d", 15_552_000, 30_000],
  ]);
  expect(s.maxPenaltyBps).toBe(3000);
  expect(s.rewardPeriodSeconds).toBe(86_400);
  expect(s.slippageBps).toBe(100);
  expect("launchFeeLamports" in s).toBe(false);
  expect(s.creatorPayoutMin[NATIVE_MINT]).toBe(50_000_000n);
  expect(s.devBuyCapBps).toBe(5000);
  expect(s.keeperIntervalSeconds).toBe(600);
});

test("split must sum to 100%", () => {
  const s = defaultSettings(OURS);
  expect(() => parseSettings({ ...s, split: { basketBps: 6000, platformBps: 2500, creatorBps: 1000 } })).toThrow();
});

test("tiers need unique ids, positive locks, multiplier at least 1x", () => {
  const s = defaultSettings(OURS);
  expect(() => parseSettings({ ...s, tiers: [s.tiers[0], s.tiers[0]] })).toThrow();
  expect(() => parseSettings({ ...s, tiers: [{ id: "x", lockSeconds: 0, multiplierBps: 10_000 }] })).toThrow();
  expect(() => parseSettings({ ...s, tiers: [{ id: "x", lockSeconds: 60, multiplierBps: 9_000 }] })).toThrow();
  expect(() => parseSettings({ ...s, tiers: [] })).toThrow();
});

test("penalty must be strictly between 0 and 100%", () => {
  const s = defaultSettings(OURS);
  expect(() => parseSettings({ ...s, maxPenaltyBps: 0 })).toThrow();
  expect(() => parseSettings({ ...s, maxPenaltyBps: 10_000 })).toThrow();
});

test("save creates a new version and load returns the latest with bigints intact", async () => {
  const sql = await freshDb();
  const s = defaultSettings(OURS);
  const v1 = await saveSettings(sql, s, "admin1");
  const v2 = await saveSettings(sql, { ...s, split: { basketBps: 7000, platformBps: 2000, creatorBps: 1000 } }, "admin1");
  expect(v2).toBe(v1 + 1);
  const latest = await loadLatestSettings(sql);
  expect(latest.version).toBe(v2);
  expect(latest.split.basketBps).toBe(7000);
});

test("settings saved with a launch fee still load", () => {
  const s = parseSettings({ ...defaultSettings(OURS), launchFeeLamports: "300000000" });
  expect("launchFeeLamports" in s).toBe(false);
});
