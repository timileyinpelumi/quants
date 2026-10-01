import { test, expect } from "bun:test";
import type { SQL } from "bun";
import { freshDb } from "../helpers/db";
import { landing } from "../../src/web/server/landing";

const NOW = Date.parse("2026-10-01T12:00:00Z");
let n = 0;

async function launch(sql: SQL, symbol: string, hoursAgo: number, status = "live") {
  const [r] = await sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol, name, image, created_at)
    values (${`mint-${symbol}`}, ${`pool-${symbol}`}, 'So11111111111111111111111111111111111111112', 200, 'c', 'cr', ${status}, 1, ${symbol}, ${symbol + " coin"}, 'https://img', ${new Date(NOW - hoursAgo * 3_600_000)}) returning id`;
  return Number(r.id);
}
async function trade(sql: SQL, id: number, minutesAgo: number, price: number, o: Partial<{ trader: string; value: number; usd: number | null; reserve: number; side: string }> = {}) {
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, curve_reserve, curve_threshold, block_time, slot)
    values (${`s${n++}`}, 0, ${id}, 'curve', ${o.side ?? "buy"}, ${o.trader ?? "w1"}, 1, 1, 0, ${o.value ?? 1}, ${price}, ${o.usd === undefined ? 100 : o.usd},
            ${o.reserve ?? null}, ${o.reserve === undefined ? null : 10}, ${new Date(NOW - minutesAgo * 60_000)}, ${Math.floor((NOW - minutesAgo * 60_000) / 400)})`;
}

test("stats count launches, graduations, volume and traders", async () => {
  const sql = await freshDb();
  const a = await launch(sql, "AAA", 48);
  const b = await launch(sql, "BBB", 2, "graduated");
  await launch(sql, "CCC", 1);
  await trade(sql, a, 60 * 30, 0.001, { value: 10 });
  await trade(sql, a, 30, 0.002, { value: 2, trader: "w2" });
  await trade(sql, b, 10, 0.01, { value: 3, trader: "w2" });
  const { stats } = await landing(sql, NOW);
  expect(stats).toEqual({ launches: 3, graduated: 1, volume24hUsd: 500, volumeAllUsd: 1500, traders24h: 1 });
});

test("lists rank by market cap, gain, age and graduation progress", async () => {
  const sql = await freshDb();
  const a = await launch(sql, "AAA", 48);
  const b = await launch(sql, "BBB", 30);
  const c = await launch(sql, "CCC", 1);
  await trade(sql, a, 60 * 30, 0.001, { reserve: 2 });
  await trade(sql, a, 60, 0.003, { reserve: 9 });
  await trade(sql, b, 60 * 40, 0.02, { reserve: 5 });
  await trade(sql, b, 30, 0.01, { reserve: 4 });
  const d = await landing(sql, NOW);
  expect(d.biggest.map((t) => t.symbol)).toEqual(["BBB", "AAA"]);
  expect(d.biggest[0]!.mcapUsd).toBeCloseTo(0.01 * 100 * 1e9, 0);
  expect(d.gainers.map((t) => [t.symbol, Math.round(t.change24h)])).toEqual([["AAA", 200]]);
  expect(d.newest.map((t) => t.symbol)).toEqual(["CCC", "BBB", "AAA"]);
  expect(d.closest.map((t) => [t.symbol, t.progress])).toEqual([["AAA", 90], ["BBB", 40]]);
  expect(d.recent.map((t) => [t.symbol, t.side, t.valueUsd])).toEqual([["BBB", "buy", 100], ["AAA", "buy", 100], ["AAA", "buy", 100], ["BBB", "buy", 100]]);
  expect(d.recent[0]!.trader).toBe("w1");
  expect(c).toBeGreaterThan(0);
});

test("graduated tokens are left out of the graduation list and empty data gives empty lists", async () => {
  const sql = await freshDb();
  expect(await landing(sql, NOW)).toMatchObject({ stats: { launches: 0, volume24hUsd: 0 }, biggest: [], gainers: [], newest: [], closest: [], recent: [] });
  const g = await launch(sql, "GGG", 5, "graduated");
  await trade(sql, g, 10, 0.1, { reserve: 10 });
  expect((await landing(sql, NOW)).closest).toEqual([]);
});
