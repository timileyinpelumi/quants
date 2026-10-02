import { test, expect } from "bun:test";
import type { SQL } from "bun";
import { freshDb } from "../helpers/db";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { DexScreener, pairStats, platformCard, platformLinks } from "../../src/web/server/platform-token";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const Q = "mint-QUANTS";
const COINS = [{ mint: Q, symbol: "QUANTS", name: "quants", decimals: 6, graduation: 1, iconMint: null, platform: true, payoutMin: 0n, kind: "crypto" as const, tradingOnly: false }];
let n = 0;

async function launch(sql: SQL, symbol: string, quote = Q) {
  const [r] = await sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol, created_at)
    values (${`mint-${symbol}`}, ${`pool-${symbol}`}, ${quote}, 200, 'c', 'cr', 'live', 1, ${symbol}, ${new Date(NOW - 3_600_000)}) returning id`;
  return Number(r.id);
}
async function trade(sql: SQL, id: number, minutesAgo: number, value: number, usd: number) {
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
    values (${`s${n++}`}, 0, ${id}, 'curve', 'buy', 'w', 1, ${value * 1e6}, 0, ${value}, 0.001, ${usd}, ${new Date(NOW - minutesAgo * 60_000)}, ${n})`;
}

const dexBody = [
  { baseToken: { address: Q }, quoteToken: { address: "So1" }, priceUsd: "0.5", priceChange: { h24: -3.2 }, volume: { h24: 1000 }, liquidity: { usd: 50_000 }, marketCap: 400_000 },
  { baseToken: { address: Q }, quoteToken: { address: "USDC" }, priceUsd: "0.49", priceChange: { h24: 9 }, volume: { h24: 200 }, liquidity: { usd: 1_000 } },
  { baseToken: { address: "mint-AAA" }, quoteToken: { address: Q }, priceUsd: "0.01", priceChange: { h24: 50 }, volume: { h24: 70 }, liquidity: { usd: 9_000_000 } },
];

test("pair stats count QUANTS pairs, their volume and the fees they sent to stakers", async () => {
  const sql = await freshDb();
  const v = await saveSettings(sql, defaultSettings("OURS"), "t");
  const a = await launch(sql, "AAA");
  const b = await launch(sql, "BBB");
  const sol = await launch(sql, "SOLPAIR", "So11111111111111111111111111111111111111112");
  await trade(sql, a, 60 * 30, 100, 0.5);
  await trade(sql, a, 30, 40, 0.5);
  await trade(sql, b, 10, 10, 1);
  await trade(sql, sol, 10, 999, 100);
  // 1000 QUANTS of fees split for AAA, 60% to the basket, valued at its last QUANTS price of $0.5
  await sql`insert into distributions (launch_id, idem_key, step_key, kind, status, detail, settings_version)
    values (${a}, 'split:1', 'split:1', 'split', 'confirmed', ${JSON.stringify({ amount: "1000000000" })}::text::jsonb, ${v}),
           (${sol}, 'split:2', 'split:2', 'split', 'confirmed', ${JSON.stringify({ amount: "1000000000" })}::text::jsonb, ${v})`;
  const s = await pairStats(sql, Q, NOW);
  expect({ ...s, stakersUsd: Math.round(s.stakersUsd * 1e6) / 1e6 }).toEqual({ pairs: 2, volume24hUsd: 30, volumeAllUsd: 80, stakersUsd: 300 });
  expect(await pairStats(sql, "nothing", NOW)).toEqual({ pairs: 0, volume24hUsd: 0, volumeAllUsd: 0, stakersUsd: 0 });
});

test("DexScreener stats come from the most liquid pair the token is the base of, with volume summed", async () => {
  const urls: string[] = [];
  const dex = new DexScreener(async (u) => { urls.push(String(u)); return Response.json(dexBody); });
  expect(await dex.stats(Q)).toEqual({ priceUsd: 0.5, change24h: -3.2, volume24hUsd: 1270, mcapUsd: 400_000 });
  await dex.stats(Q);
  expect(urls).toEqual([`https://api.dexscreener.com/tokens/v1/solana/${Q}`]);
});

test("DexScreener gives null when it has nothing or fails", async () => {
  expect(await new DexScreener(async () => Response.json([])).stats(Q)).toBeNull();
  expect(await new DexScreener(async () => new Response("no", { status: 500 })).stats(Q)).toBeNull();
  expect(await new DexScreener(async () => { throw new Error("down"); }).stats(Q)).toBeNull();
});

test("the card takes price from the price layer, market cap from supply, change and volume from DexScreener", async () => {
  const sql = await freshDb();
  await launch(sql, "AAA");
  const c = (await platformCard({ sql, now: NOW, coins: COINS, price: async () => 0.25, supply: async () => 1_000_000, dex: async () => ({ priceUsd: 0.5, change24h: -3.2, volume24hUsd: 1270, mcapUsd: 400_000 }) }))!;
  expect(c).toMatchObject({ mint: Q, symbol: "QUANTS", priceUsd: 0.25, mcapUsd: 250_000, change24h: -3.2, volume24hUsd: 1270 });
  expect(c.pairs.pairs).toBe(1);
});

test("the card shows what is known and leaves the rest null", async () => {
  const sql = await freshDb();
  const bare = (await platformCard({ sql, now: NOW, coins: COINS, price: async () => null, supply: async () => null, dex: async () => null }))!;
  expect(bare).toMatchObject({ priceUsd: null, mcapUsd: null, change24h: null, volume24hUsd: null });
  const dexOnly = (await platformCard({ sql, now: NOW, coins: COINS, price: async () => null, supply: async () => 1_000_000, dex: async () => ({ priceUsd: 0.5, change24h: 1, volume24hUsd: 5, mcapUsd: null }) }))!;
  expect(dexOnly).toMatchObject({ priceUsd: 0.5, mcapUsd: 500_000 });
  const failing = (await platformCard({ sql, now: NOW, coins: COINS, price: async () => { throw new Error("x"); }, supply: async () => { throw new Error("x"); }, dex: async () => null }))!;
  expect(failing.priceUsd).toBeNull();
  expect(await platformCard({ sql, now: NOW, coins: [], price: async () => 1, supply: async () => 1, dex: async () => null })).toBeNull();
});

test("when the platform token launched here its own trades fill in change and volume", async () => {
  const sql = await freshDb();
  const q = await launch(sql, "QUANTS", "So11111111111111111111111111111111111111112");
  await sql`update launches set mint = ${Q} where id = ${q}`;
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
    values ('x1', 0, ${q}, 'curve', 'buy', 'w', 1, 1, 0, 2, 0.001, 100, ${new Date(NOW - 30 * 3_600_000)}, 1),
           ('x2', 0, ${q}, 'curve', 'buy', 'w', 1, 1, 0, 3, 0.002, 100, ${new Date(NOW - 600_000)}, 2)`;
  const c = (await platformCard({ sql, now: NOW, coins: COINS, price: async () => 0.2, supply: async () => null, dex: async () => null }))!;
  expect(c.change24h).toBeCloseTo(100, 6);
  expect(c.volume24hUsd).toBe(300);
  expect(c.mcapUsd).toBeCloseTo(0.2 * 1e9, 3);
});

test("buy goes to Jupiter on mainnet and stays on site elsewhere; launch preselects the pair", () => {
  expect(platformLinks(Q, "mainnet", false)).toEqual({ buy: `https://jup.ag/swap/SOL-${Q}`, buyExternal: true, launch: `/launch?pair=${Q}` });
  expect(platformLinks(Q, "devnet", false)).toEqual({ buy: `/explore?quote=${Q}`, buyExternal: false, launch: `/launch?pair=${Q}` });
  expect(platformLinks(Q, "localnet", true).buy).toBe(`/t/${Q}`);
});
