import { test, expect } from "bun:test";
import type { SQL } from "bun";
import { freshDb } from "../helpers/db";
import { landing, exploreTokens, featured, recentBuys, sparklines, withSparks, HOME_TABS, HOME_PAGE } from "../../src/web/server/landing";
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
  const v = await saveSettings(sql, defaultSettings("OURS1111111111111111111111111111111111111111"), "test");
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

test("home serves the first tab, and each tab is an explore query", async () => {
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
  expect(HOME_TABS.map((t) => t.label)).toEqual(["Trending", "Bonding", "New", "Graduating", "Graduated"]);
  expect(d.tokens.map((t) => t.symbol)).toEqual(["AAA", "GGG", "BBB", "CCC"]);
  expect(d.nextOffset).toBeNull();
  expect(d.tokens[0]!.basket).toEqual([{ mint: "zec", symbol: "ZEC", icon: null }, { mint: "jup", symbol: "JUP", icon: null }]);
  expect(d.tokens[0]!.quote).toMatchObject({ symbol: "SOL" });
  const withIcons = await landing(sql, NOW, async (mints) => Object.fromEntries(mints.map((m) => [m, `https://icons/${m}`])));
  expect(withIcons.tokens[0]!.basket[0]!.icon).toBe("https://icons/zec");
  expect(withIcons.tokens[0]!.quote.icon).toBe("https://icons/So11111111111111111111111111111111111111112");
  const tab = async (key: string) => {
    const t = HOME_TABS.find((x) => x.key === key)!;
    return (await exploreTokens(sql, { sort: t.sort, filter: t.filter }, NOW)).map((r) => r.symbol);
  };
  // Bonding: live tokens, most recently traded first, untraded last
  expect(await tab("bonding")).toEqual(["BBB", "AAA", "CCC"]);
  expect(await tab("new")).toEqual(["CCC", "GGG", "BBB", "AAA"]);
  expect(await tab("graduating")).toEqual(["AAA", "BBB"]);
  expect(await tab("graduated")).toEqual(["GGG"]);
});

test("home pages the first tab", async () => {
  const sql = await freshDb();
  for (let i = 0; i < HOME_PAGE + 2; i++) await launch(sql, `T${i}`, i + 1);
  const d = await landing(sql, NOW);
  expect(d.tokens).toHaveLength(HOME_PAGE);
  expect(d.nextOffset).toBe(HOME_PAGE);
});

test("recent buys are the newest buys across every launch", async () => {
  const sql = await freshDb();
  const a = await launch(sql, "AAA", 4);
  const b = await launch(sql, "BBB", 3);
  await trade(sql, a, 30, 0.001, { trader: "w1" });
  await trade(sql, b, 20, 0.001, { trader: "w2", side: "sell" });
  await trade(sql, b, 10, 0.001, { trader: "w3" });
  const r = await recentBuys(sql, 10);
  expect(r.map((x) => [x.symbol, x.trader])).toEqual([["BBB", "w3"], ["AAA", "w1"]]);
  expect(r[0]!.amount).toBeCloseTo(0.000001, 12);
  const { GET } = await import("../../src/app/api/trades/recent/route");
  const { makeWebContext } = await import("../helpers/web-context");
  const c = await makeWebContext();
  const id = await launch(c.sql, "CCC", 1);
  await trade(c.sql, id, 5, 0.001, { trader: "w9" });
  const j = await (await GET(new Request("http://x/api/trades/recent"))).json();
  expect(j.buys.map((x: any) => x.trader)).toEqual(["w9"]);
  expect((await GET(new Request("http://x/api/trades/recent?limit=500"))).status).toBe(400);
});

test("the featured platform token shows its market when it launched here, else its pairs", async () => {
  const sql = await freshDb();
  const coins = [{ mint: "mint-QUANTS", symbol: "QUANTS", name: "quants", decimals: 6, graduation: 1, iconMint: null, platform: true, payoutMin: 0n, kind: "crypto" as const, tradingOnly: false, enabled: true }];
  await launch(sql, "AAA", 2);
  await sql`update launches set quote_mint = 'mint-QUANTS' where symbol = 'AAA'`;
  expect(await featured(sql, NOW, undefined, coins)).toEqual({ mint: "mint-QUANTS", symbol: "QUANTS", name: "quants", pairs: 1, token: null });
  const q = await launch(sql, "QUANTS", 1);
  await trade(sql, q, 5, 0.002);
  const f = (await featured(sql, NOW, undefined, coins))!;
  expect(f.token).toMatchObject({ mint: "mint-QUANTS", symbol: "QUANTS" });
  expect(f.token!.priceUsd).toBeCloseTo(0.2, 9);
  expect(await featured(sql, NOW, undefined, [])).toBeNull();
});

test("explore filters by pair token", async () => {
  const sql = await freshDb();
  await launch(sql, "AAA", 2);
  await launch(sql, "BBB", 1);
  await sql`update launches set quote_mint = 'mint-QUANTS' where symbol = 'BBB'`;
  expect((await exploreTokens(sql, { sort: "new", quote: "mint-QUANTS" }, NOW)).map((t) => t.symbol)).toEqual(["BBB"]);
});

test("token rows show staking progress until staking opens", async () => {
  const sql = await freshDb();
  const a = await launch(sql, "AAA", 3);
  const b = await launch(sql, "BBB", 2);
  await launch(sql, "CCC", 1);
  await sql`insert into stake_pools (launch_id, backend, max_penalty_bps, spill_account, status, rent_lamports, basket_value_lamports)
    values (${a}, 'kamino', 3000, 's', 'pending', 1000, 420), (${b}, 'kamino', 3000, 's', 'ready', 1000, 1000)`;
  const rows = await exploreTokens(sql, { sort: "new" }, NOW);
  expect(rows.map((t) => [t.symbol, t.stakingPct])).toEqual([["CCC", null], ["BBB", null], ["AAA", 42]]);
  expect((await landing(sql, NOW)).tokens.find((t) => t.symbol === "AAA")!.stakingPct).toBe(42);
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

test("sparklines bucket the last 24h of prices per token in one query, carrying the last price forward", async () => {
  const sql = await freshDb();
  const a = await launch(sql, "AAA", 48);
  const b = await launch(sql, "BBB", 30);
  await launch(sql, "CCC", 1);
  await trade(sql, a, 60 * 30, 1);
  await trade(sql, a, 60 * 20 + 10, 2);
  await trade(sql, a, 60 * 20 + 5, 3);
  await trade(sql, a, 30, 4);
  await trade(sql, b, 60 * 26, 5);
  const s = await sparklines(sql, ["mint-AAA", "mint-BBB", "mint-CCC", "mint-nope"], NOW, 6);
  // 4 hour buckets: AAA starts at the price before the window, closes 3 in the bucket 20h ago, 4 in the last
  expect(s["mint-AAA"]).toEqual([1, 3, 3, 3, 3, 3, 4]);
  expect(s["mint-BBB"]).toEqual([5, 5, 5, 5, 5, 5, 5]);
  expect(s["mint-CCC"]).toEqual([]);
  expect(s["mint-nope"]).toBeUndefined();
  expect(await sparklines(sql, [], NOW)).toEqual({});
  const rows = await withSparks(sql, await exploreTokens(sql, { sort: "new" }, NOW), NOW);
  expect(rows.find((r) => r.symbol === "AAA")!.spark).toHaveLength(25);
});

test("explore route adds sparklines when asked", async () => {
  const { makeWebContext } = await import("../helpers/web-context");
  const { GET } = await import("../../src/app/api/explore/route");
  const { sql } = await makeWebContext();
  const a = await launch(sql, "AAA", 3);
  await trade(sql, a, 30, 0.001);
  const plain = await (await GET(new Request("http://x/api/explore?sort=new"))).json();
  expect(plain.tokens[0].spark).toBeUndefined();
  const withSpark = await (await GET(new Request("http://x/api/explore?sort=new&spark=1"))).json();
  expect(withSpark.tokens[0].spark.length).toBeGreaterThan(1);
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

test("trading only launches are flagged and their splits pay no stakers", async () => {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS1111111111111111111111111111111111111111"), "t");
  const [r] = await sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol, trading_only, created_at)
    values ('mint-STK', 'pool-STK', 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', 200, 'c', 'cr', 'live', 1, 'STK', true, ${new Date(NOW - 3_600_000)}) returning id`;
  await trade(sql, Number(r.id), 30, 0.01, { value: 2 });
  await sql`insert into distributions (launch_id, idem_key, step_key, kind, status, detail, settings_version)
    values (${r.id}, 'split:s', 'split:s', 'split', 'confirmed', ${JSON.stringify({ amount: "1000000000", tradingOnly: true })}::text::jsonb, 1)`;
  const d = await landing(sql, NOW);
  expect(d.tokens[0]).toMatchObject({ symbol: "STK", tradingOnly: true, stakingPct: null, basket: [] });
  expect(d.stats.stakersUsd).toBe(0);
});
