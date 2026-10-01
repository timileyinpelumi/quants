import { test, expect } from "bun:test";
import type { SQL } from "bun";
import { freshDb } from "../helpers/db";
import { landing, exploreTokens } from "../../src/web/server/landing";
import { defaultSettings, saveSettings } from "../../src/domain/settings";

const NOW = Date.parse("2026-10-01T12:00:00Z");
let n = 0;

async function launch(sql: SQL, symbol: string, hoursAgo: number, status = "live") {
  const [r] = await sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol, name, image, created_at)
    values (${`mint-${symbol}`}, ${`pool-${symbol}`}, 'So11111111111111111111111111111111111111112', 200, 'c', 'cr', ${status}, 1, ${symbol}, ${symbol + " coin"}, 'https://img', ${new Date(NOW - hoursAgo * 3_600_000)}) returning id`;
  await sql`insert into baskets (launch_id, reward_mint, weight_bps, symbol) values (${r.id}, 'zec', 6000, 'ZEC'), (${r.id}, 'jup', 4000, 'JUP')`;
  return Number(r.id);
}
async function trade(sql: SQL, id: number, minutesAgo: number, price: number, o: Partial<{ trader: string; value: number; usd: number | null; reserve: number; side: string }> = {}) {
  const value = o.value ?? 1;
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, curve_reserve, curve_threshold, block_time, slot)
    values (${`s${n++}`}, 0, ${id}, 'curve', ${o.side ?? "buy"}, ${o.trader ?? "w1"}, 1, ${value * 1e9}, 0, ${value}, ${price}, ${o.usd === undefined ? 100 : o.usd},
            ${o.reserve ?? null}, ${o.reserve === undefined ? null : 10}, ${new Date(NOW - minutesAgo * 60_000)}, ${Math.floor((NOW - minutesAgo * 60_000) / 400)})`;
}

test("stats count launches, graduations, volume, traders and what stakers earned", async () => {
  const sql = await freshDb();
  const v = await saveSettings(sql, defaultSettings("OURS"), "test");
  const a = await launch(sql, "AAA", 48);
  const b = await launch(sql, "BBB", 2, "graduated");
  await launch(sql, "CCC", 1);
  await trade(sql, a, 60 * 30, 0.001, { value: 10 });
  await trade(sql, a, 30, 0.002, { value: 2, trader: "w2" });
  await trade(sql, b, 10, 0.01, { value: 3, trader: "w2", usd: 200 });
  // 0.5 SOL of fees split for AAA: 60% to the basket at $100
  await sql`insert into distributions (launch_id, idem_key, step_key, kind, status, detail, settings_version)
    values (${a}, 'split:1', 'split:1', 'split', 'confirmed', ${JSON.stringify({ amount: "500000000" })}::text::jsonb, ${v}),
           (${a}, 'split:2', 'split:2', 'split', 'failed', ${JSON.stringify({ amount: "900000000" })}::text::jsonb, ${v})`;
  const { stats } = await landing(sql, NOW);
  expect({ ...stats, stakersUsd: Math.round(stats.stakersUsd * 1e6) / 1e6 }).toEqual({ launches: 3, graduated: 1, volume24hUsd: 800, volumeAllUsd: 1800, traders24h: 1, stakersUsd: 30 });
});

test("home lists trending, new, about to graduate, graduated and recent trades", async () => {
  const sql = await freshDb();
  const a = await launch(sql, "AAA", 48);
  const b = await launch(sql, "BBB", 30);
  await launch(sql, "CCC", 1);
  const g = await launch(sql, "GGG", 5, "graduated");
  await trade(sql, a, 60 * 30, 0.001, { reserve: 2 });
  await trade(sql, a, 60, 0.003, { reserve: 9, value: 5 });
  await trade(sql, b, 60 * 40, 0.02, { reserve: 5 });
  await trade(sql, b, 30, 0.01, { reserve: 4, value: 1 });
  await trade(sql, g, 10, 0.1, { value: 2 });
  const d = await landing(sql, NOW);
  expect(d.trending.map((t) => t.symbol)).toEqual(["AAA", "GGG", "BBB"]);
  expect(d.trending[0]!.basket).toEqual([{ mint: "zec", symbol: "ZEC", icon: null }, { mint: "jup", symbol: "JUP", icon: null }]);
  expect(d.trending[0]!.quote).toMatchObject({ symbol: "SOL" });
  const withIcons = await landing(sql, NOW, async (mints) => Object.fromEntries(mints.map((m) => [m, `https://icons/${m}`])));
  expect(withIcons.trending[0]!.basket[0]!.icon).toBe("https://icons/zec");
  expect(withIcons.trending[0]!.quote.icon).toBe("https://icons/So11111111111111111111111111111111111111112");
  expect(d.newest.map((t) => t.symbol)).toEqual(["CCC", "GGG", "BBB", "AAA"]);
  expect(d.soon.map((t) => [t.symbol, t.progress])).toEqual([["AAA", 90], ["BBB", 40]]);
  expect(d.graduated.map((t) => t.symbol)).toEqual(["GGG"]);
  expect(d.recent.map((t) => t.symbol)).toEqual(["GGG", "BBB", "AAA", "AAA", "BBB"]);
});

test("explore sorts, filters and searches", async () => {
  const sql = await freshDb();
  const a = await launch(sql, "AAA", 48);
  const b = await launch(sql, "BBB", 30);
  const g = await launch(sql, "GGG", 5, "graduated");
  await trade(sql, a, 60 * 30, 0.001, { reserve: 2 });
  await trade(sql, a, 60, 0.003, { reserve: 9 });
  await trade(sql, b, 30, 0.01, { reserve: 4, value: 9 });
  await trade(sql, g, 10, 0.05, { value: 2 });
  const sym = async (o: Parameters<typeof exploreTokens>[1]) => (await exploreTokens(sql, o, NOW)).map((t) => t.symbol);
  expect(await sym({ sort: "trending" })).toEqual(["BBB", "GGG", "AAA"]);
  expect(await sym({ sort: "mcap" })).toEqual(["GGG", "BBB", "AAA"]);
  expect(await sym({ sort: "new" })).toEqual(["GGG", "BBB", "AAA"]);
  expect(await sym({ sort: "gainers" })).toEqual(["AAA", "BBB", "GGG"]);
  expect(await sym({ sort: "graduating" })).toEqual(["AAA", "BBB"]);
  expect(await sym({ sort: "trending", filter: "graduated" })).toEqual(["GGG"]);
  expect(await sym({ sort: "trending", filter: "live" })).toEqual(["BBB", "AAA"]);
  expect(await sym({ sort: "new", q: "bb" })).toEqual(["BBB"]);
  expect(await sym({ sort: "new", q: "mint-GGG" })).toEqual(["GGG"]);
});

test("token trades route lists the newest trades for one token", async () => {
  const { makeWebContext } = await import("../helpers/web-context");
  const { GET } = await import("../../src/app/api/trades/[mint]/route");
  const { sql } = await makeWebContext();
  const a = await launch(sql, "AAA", 2);
  const b = await launch(sql, "BBB", 2);
  await trade(sql, a, 30, 0.001, { side: "sell", trader: "seller" });
  await trade(sql, a, 10, 0.002, { value: 3 });
  await trade(sql, b, 5, 0.1);
  const r = await (await GET(new Request("http://x"), { params: Promise.resolve({ mint: "mint-AAA" }) })).json();
  expect(r.trades.map((t: any) => [t.side, t.valueUsd, t.trader])).toEqual([["buy", 300, "w1"], ["sell", 100, "seller"]]);
  expect(r.trades[0].amount).toBeCloseTo(0.000001, 12);
  expect((await GET(new Request("http://x"), { params: Promise.resolve({ mint: "nope" }) })).status).toBe(404);
});

test("explore pages continue without overlap or gaps, ties broken by newest then id", async () => {
  const sql = await freshDb();
  const ids: number[] = [];
  for (const s of ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]) ids.push(await launch(sql, s, s === "P7" ? 1 : 3));
  await trade(sql, ids[0]!, 10, 0.001, { value: 5 });
  await trade(sql, ids[3]!, 10, 0.001, { value: 2 });
  for (const sort of ["trending", "mcap", "new", "gainers"] as const) {
    const all = (await exploreTokens(sql, { sort, limit: 50 }, NOW)).map((t) => t.symbol);
    expect(all).toHaveLength(7);
    const pages: string[] = [];
    for (let offset = 0; offset < 9; offset += 3) pages.push(...(await exploreTokens(sql, { sort, limit: 3, offset }, NOW)).map((t) => t.symbol));
    expect(pages).toEqual(all);
  }
  expect((await exploreTokens(sql, { sort: "trending", limit: 50 }, NOW)).map((t) => t.symbol)).toEqual(["P1", "P4", "P7", "P6", "P5", "P3", "P2"]);
  expect(await exploreTokens(sql, { sort: "new", limit: 3, offset: 7 }, NOW)).toEqual([]);
});

test("explore search treats like wildcards as text", async () => {
  const sql = await freshDb();
  await launch(sql, "A_B", 1);
  await launch(sql, "AXB", 1);
  expect((await exploreTokens(sql, { sort: "new", q: "a_b" }, NOW)).map((t) => t.symbol)).toEqual(["A_B"]);
  expect(await exploreTokens(sql, { sort: "new", q: "%" }, NOW)).toEqual([]);
});

test("explore route validates input and returns the next offset", async () => {
  const { makeWebContext } = await import("../helpers/web-context");
  const { GET } = await import("../../src/app/api/explore/route");
  const { sql } = await makeWebContext();
  for (const [s, h] of [["AAA", 3], ["BBB", 2], ["CCC", 1]] as const) await launch(sql, s, h);
  const page = (qs: string) => GET(new Request(`http://x/api/explore?${qs}`));
  const first = await (await page("sort=new&limit=2")).json();
  expect(first.tokens.map((t: any) => t.symbol)).toEqual(["CCC", "BBB"]);
  expect(first.nextOffset).toBe(2);
  const second = await (await page("sort=new&limit=2&offset=2")).json();
  expect(second.tokens.map((t: any) => t.symbol)).toEqual(["AAA"]);
  expect(second.nextOffset).toBeNull();
  expect((await (await page("sort=new&filter=graduated")).json()).tokens).toEqual([]);
  expect((await page("sort=bogus")).status).toBe(400);
  expect((await page("sort=new&limit=51")).status).toBe(400);
  expect((await page("sort=new&offset=-1")).status).toBe(400);
});

test("token trades route pages back from a cursor", async () => {
  const { makeWebContext } = await import("../helpers/web-context");
  const { GET } = await import("../../src/app/api/trades/[mint]/route");
  const { sql } = await makeWebContext();
  const a = await launch(sql, "AAA", 2);
  for (let i = 0; i < 5; i++) await trade(sql, a, 50 - i, 0.001, { value: i + 1 });
  const get = async (qs: string) => (await GET(new Request(`http://x/api/trades/mint-AAA?${qs}`), { params: Promise.resolve({ mint: "mint-AAA" }) })).json();
  const p1 = await get("limit=2");
  expect(p1.trades.map((t: any) => t.quoteValue)).toEqual([5, 4]);
  const p2 = await get(`limit=2&before=${p1.next}`);
  expect(p2.trades.map((t: any) => t.quoteValue)).toEqual([3, 2]);
  const p3 = await get(`limit=2&before=${p2.next}`);
  expect(p3.trades.map((t: any) => t.quoteValue)).toEqual([1]);
  expect(p3.next).toBeNull();
  expect((await GET(new Request("http://x/api/trades/mint-AAA?before=junk"), { params: Promise.resolve({ mint: "mint-AAA" }) })).status).toBe(400);
});

test("top traders route pages by offset", async () => {
  const { makeWebContext } = await import("../helpers/web-context");
  const { GET } = await import("../../src/app/api/token/[mint]/traders/route");
  const { sql } = await makeWebContext();
  const a = await launch(sql, "AAA", 2);
  for (let i = 0; i < 5; i++) await trade(sql, a, 30, 0.001, { trader: `w${i}`, value: i + 1 });
  const get = async (qs: string) => (await GET(new Request(`http://x?${qs}`), { params: Promise.resolve({ mint: "mint-AAA" }) })).json();
  const p1 = await get("limit=3");
  expect(p1.traders.map((t: any) => t.wallet)).toEqual(["w4", "w3", "w2"]);
  expect(p1.nextOffset).toBe(3);
  const p2 = await get("limit=3&offset=3");
  expect(p2.traders.map((t: any) => t.wallet)).toEqual(["w1", "w0"]);
  expect(p2.nextOffset).toBeNull();
  expect((await GET(new Request("http://x"), { params: Promise.resolve({ mint: "nope" }) })).status).toBe(404);
});
