import { test, expect } from "bun:test";
import type { SQL } from "bun";
import { candles, market } from "../../src/web/server/chart";
import { makeWebContext } from "../helpers/web-context";
import { insertLaunch } from "../helpers/fixtures";
import { GET } from "../../src/app/api/chart/[mint]/route";

const NOW = Date.parse("2026-10-01T12:00:00Z");
let n = 0;
async function trade(sql: SQL, launchId: number, minutesAgo: number, price: number, over: Partial<{ side: string; quote_value: number; quote_usd: number | null }> = {}) {
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
    values (${`sig${n++}`}, 0, ${launchId}, 'curve', ${over.side ?? "buy"}, 'w', 1, 1, 0, ${over.quote_value ?? 1}, ${price},
            ${over.quote_usd === undefined ? 100 : over.quote_usd}, ${new Date(NOW - minutesAgo * 60_000)}, ${Math.floor((NOW - minutesAgo * 60_000) / 400)})`;
}

test("buckets trades into candles oldest first, in USD when every trade has a USD price", async () => {
  const { sql } = await makeWebContext();
  const id = await insertLaunch(sql);
  await trade(sql, id, 50, 0.001);
  await trade(sql, id, 46, 0.003);
  await trade(sql, id, 44, 0.002);
  await trade(sql, id, 10, 0.004);
  await trade(sql, id, 60 * 30, 0.0001);
  const r = await candles(sql, id, "1D", NOW);
  expect(r.unit).toBe("usd");
  expect(r.candles).toHaveLength(3);
  const [a, b, c] = r.candles;
  expect(a!.time).toBe((NOW - 60 * 60_000) / 1000);
  expect([a!.open, a!.high, a!.low, a!.close].map((x) => +x.toFixed(6))).toEqual([0.1, 0.3, 0.1, 0.3]);
  expect([b!.open, b!.close].map((x) => +x.toFixed(6))).toEqual([0.2, 0.2]);
  expect(c!.close).toBeCloseTo(0.4, 6);
});

test("falls back to quote token prices when any trade lacks a USD price", async () => {
  const { sql } = await makeWebContext();
  const id = await insertLaunch(sql);
  await trade(sql, id, 30, 0.001, { quote_usd: null });
  await trade(sql, id, 20, 0.002);
  const r = await candles(sql, id, "1H", NOW);
  expect(r.unit).toBe("quote");
  expect(r.candles.map((c) => c.close)).toEqual([0.001, 0.002]);
});

test("a quiet token still shows its last price", async () => {
  const { sql } = await makeWebContext();
  const id = await insertLaunch(sql);
  await trade(sql, id, 60 * 24 * 3, 0.002);
  const r = await candles(sql, id, "1H", NOW);
  expect(r.candles).toHaveLength(1);
  expect(r.candles[0]!.close).toBeCloseTo(0.2, 6);
});

test("market gives price, change, market cap and volume over 24 hours", async () => {
  const { sql } = await makeWebContext();
  const id = await insertLaunch(sql);
  expect(await market(sql, id, NOW)).toBeNull();
  await trade(sql, id, 60 * 30, 0.001, { quote_value: 5 });
  await trade(sql, id, 60, 0.0015, { quote_value: 2, side: "sell" });
  await trade(sql, id, 5, 0.002, { quote_value: 3 });
  const m = (await market(sql, id, NOW))!;
  expect(m.price).toBe(0.002);
  expect(m.priceUsd).toBeCloseTo(0.2, 9);
  expect(m.fdvUsd).toBeCloseTo(0.2 * 1e9, 0);
  expect(m.change24h).toBeCloseTo(100, 6);
  expect(m.volume24h).toBe(5);
  expect(m.volume24hUsd).toBe(500);
  expect(m.trades24h).toBe(2);
});

test("change is measured from the first trade for a token younger than a day", async () => {
  const { sql } = await makeWebContext();
  const id = await insertLaunch(sql);
  await trade(sql, id, 120, 0.001);
  await trade(sql, id, 5, 0.0015, { quote_usd: null });
  const m = (await market(sql, id, NOW))!;
  expect(m.change24h).toBeCloseTo(50, 6);
  expect(m.priceUsd).toBeNull();
  expect(m.volume24hUsd).toBeNull();
});

test("chart route returns candles and market for a mint, and 404 for an unknown one", async () => {
  const { sql } = await makeWebContext();
  const id = await insertLaunch(sql, { mint: "M1" });
  await trade(sql, id, 1, 0.001, { quote_usd: 100 });
  const r = await (await GET(new Request("http://x/api/chart/M1?tf=1D"), { params: Promise.resolve({ mint: "M1" }) })).json();
  expect(r.candles.length).toBeGreaterThan(0);
  expect(r.unit).toBe("usd");
  expect(r.market.price).toBe(0.001);
  expect((await GET(new Request("http://x/api/chart/NOPE"), { params: Promise.resolve({ mint: "NOPE" }) })).status).toBe(404);
});
