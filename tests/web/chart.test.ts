import { test, expect } from "bun:test";
import { GeckoChart } from "../../src/web/server/chart";
import { makeWebContext, FakeChart } from "../helpers/web-context";
import { GET } from "../../src/app/api/chart/[mint]/route";

const ok = (list: number[][]) => new Response(JSON.stringify({ data: { attributes: { ohlcv_list: list } } }));

test("maps timeframes and returns oldest first", async () => {
  let url = "";
  const g = new GeckoChart("https://gt", async (u) => { url = String(u); return ok([[200, 1, 2, 0.5, 1.5, 9], [100, 1, 1, 1, 1, 1]]); });
  const c = await g.candles("P", "1D");
  expect(url).toBe("https://gt/networks/solana/pools/P/ohlcv/minute?aggregate=15&limit=96&currency=usd");
  expect(c.map((x) => x.time)).toEqual([100, 200]);
  expect(c[1]).toEqual({ time: 200, open: 1, high: 2, low: 0.5, close: 1.5 });
});

test("rate limits give an empty chart, and the cache serves the last good data", async () => {
  let n = 0;
  const g = new GeckoChart("https://gt", async () => (n++ === 0 ? ok([[100, 1, 1, 1, 1, 1]]) : new Response("", { status: 429 })), 0);
  expect((await g.candles("P", "1H")).length).toBe(1);
  expect((await g.candles("P", "1H")).length).toBe(1);
  const fresh = new GeckoChart("https://gt", async () => new Response("", { status: 429 }), 0);
  expect(await fresh.candles("Q", "1H")).toEqual([]);
  expect(await fresh.market("Q")).toBeNull();
  const broken = new GeckoChart("https://gt", async () => { throw new Error("network"); }, 0);
  expect(await broken.candles("Q", "1W")).toEqual([]);
});

test("cache avoids a second request inside the ttl", async () => {
  let n = 0;
  const g = new GeckoChart("https://gt", async () => { n++; return ok([]); }, 60_000);
  await g.candles("P", "1W");
  await g.candles("P", "1W");
  expect(n).toBe(1);
});

test("market parses pool attributes", async () => {
  const g = new GeckoChart("https://gt", async () => new Response(JSON.stringify({ data: { attributes: { base_token_price_usd: "0.00041", fdv_usd: "410000", price_change_percentage: { h24: "38.2" } } } })));
  expect(await g.market("P")).toEqual({ priceUsd: 0.00041, fdvUsd: 410000, change24h: 38.2 });
});

test("chart route returns candles and market, and an empty chart for an unknown mint", async () => {
  const c = await makeWebContext();
  await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('M1', 'P1', 'q', 200, 'c', 'cr', 'live', 1)`;
  const r = await (await GET(new Request("http://x/api/chart/M1?tf=1D"), { params: Promise.resolve({ mint: "M1" }) })).json();
  expect(r.candles.length).toBe(1);
  expect(r.market.fdvUsd).toBe(410000);
  (c.chart as FakeChart).fail = true;
  const r2 = await (await GET(new Request("http://x/api/chart/M1?tf=1D"), { params: Promise.resolve({ mint: "M1" }) })).json();
  expect(r2).toEqual({ candles: [], market: null });
  const r3 = await GET(new Request("http://x/api/chart/nope"), { params: Promise.resolve({ mint: "nope" }) });
  expect(r3.status).toBe(404);
});
