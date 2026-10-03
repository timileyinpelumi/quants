import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { defaultSettings, parseSettings, saveSettings, loadLatestSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";
import { quoteCoins } from "../../src/domain/quotes";

const OURS = "OURS1111111111111111111111111111111111111111";

test("defaults match the spec", () => {
  const s = defaultSettings(OURS);
  expect(s.split).toEqual({ basketBps: 6000, platformBps: 1500, creatorBps: 2500 });
  expect(s.tiers.map((t) => [t.id, t.lockSeconds, t.multiplierBps])).toEqual([
    ["1d", 86_400, 10_000], ["3d", 259_200, 12_500], ["7d", 604_800, 15_000], ["30d", 2_592_000, 20_000],
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

test("a fresh database is seeded from the env on first load", async () => {
  const sql = await freshDb();
  const prev = { ...process.env };
  Object.assign(process.env, { STOCK_PAIRS: "1", ALERT_WEBHOOK_URL: "https://hooks.example/a", QUOTE_GRADUATIONS: JSON.stringify({ SOL: 120 }) });
  try {
    const s = await loadLatestSettings(sql);
    expect(s.version).toBe(1);
    expect(s.stockPairs).toBe(true);
    expect(s.alertWebhookUrl).toBe("https://hooks.example/a");
    expect(s.quotes.SOL).toEqual({ enabled: true, graduation: 120 });
    expect(s.platformToken).toMatchObject({ mint: OURS, symbol: "QUANTS", graduation: 100_000, enabled: true });
    expect((await sql`select created_by from settings`)[0].created_by).toBe("env seed");
    expect((await loadLatestSettings(sql)).version).toBe(1);
  } finally {
    for (const k of ["STOCK_PAIRS", "ALERT_WEBHOOK_URL", "QUOTE_GRADUATIONS"]) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
  }
});

test("settings saved before the new fields existed load with env defaults", () => {
  const { quotes, platformToken, feeTiersBps, featured, xUrl, alertWebhookUrl, launchesPaused, bannerMessage, stockPairs, ...old } = defaultSettings(OURS);
  const s = parseSettings(JSON.parse(JSON.stringify(old, (_k, v) => (typeof v === "bigint" ? v.toString() : v))));
  expect(s.feeTiersBps).toEqual([100, 200, 300]);
  expect(s.launchesPaused).toBe(false);
  expect(s.platformToken.mint).toBe(OURS);
  expect(s.quotes.USDC!.graduation).toBe(12_000);
});

test("new settings are validated", () => {
  const s = defaultSettings(OURS);
  expect(() => parseSettings({ ...s, feeTiersBps: [] })).toThrow();
  expect(() => parseSettings({ ...s, feeTiersBps: [100, 100] })).toThrow();
  expect(() => parseSettings({ ...s, feeTiersBps: [5000] })).toThrow();
  expect(parseSettings({ ...s, feeTiersBps: [300, 50] }).feeTiersBps).toEqual([50, 300]);
  expect(() => parseSettings({ ...s, quotes: { ...s.quotes, SOL: { enabled: true, graduation: 0 } } })).toThrow();
  expect(() => parseSettings({ ...s, quotes: { ...s.quotes, BONK: { enabled: true, graduation: 5 } } })).toThrow();
  expect(() => parseSettings({ ...s, platformToken: { ...s.platformToken, mint: "", enabled: true } })).toThrow();
  expect(() => parseSettings({ ...s, platformToken: { ...s.platformToken, mint: "not a mint" } })).toThrow();
  expect(parseSettings({ ...s, platformToken: { ...s.platformToken, mint: "", enabled: false } }).platformToken.mint).toBe("");
  expect(() => parseSettings({ ...s, xUrl: "http://x.com/q" })).toThrow();
  expect(() => parseSettings({ ...s, xUrl: "javascript:alert(1)" })).toThrow();
  expect(parseSettings({ ...s, xUrl: "https://x.com/q" }).xUrl).toBe("https://x.com/q");
  expect(() => parseSettings({ ...s, bannerMessage: "x".repeat(201) })).toThrow();
  expect(() => parseSettings({ ...s, keeperIntervalSeconds: 30 })).toThrow();
});

test("quote coins follow the loaded settings", async () => {
  const sql = await freshDb();
  const s = defaultSettings(OURS);
  await saveSettings(sql, { ...s, quotes: { ...s.quotes, USDT: { enabled: false, graduation: 40_000 } }, platformToken: { ...s.platformToken, mint: "", enabled: false } }, "t");
  await loadLatestSettings(sql);
  const coins = quoteCoins();
  expect(coins.map((c) => c.symbol)).toEqual(["SOL", "USDC", "USDT"]);
  expect(coins[2]).toMatchObject({ enabled: false, graduation: 40_000 });
  await saveSettings(sql, s, "t");
  await loadLatestSettings(sql);
  expect(quoteCoins().at(-1)).toMatchObject({ mint: OURS, platform: true });
});

test("saved settings that still list a dropped pair load, with that pair left out", async () => {
  const sql = await freshDb();
  const s = defaultSettings(OURS);
  const data = JSON.stringify({ ...s, quotes: { ...s.quotes, JUP: { enabled: true, graduation: 30_000 } } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  await sql`insert into settings (data, created_by) values (${data}::text::jsonb, 't')`;
  const loaded = await loadLatestSettings(sql);
  expect(Object.keys(loaded.quotes)).not.toContain("JUP");
  expect(Object.keys(loaded.quotes)).toContain("SOL");
});
