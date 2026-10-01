import { test, expect } from "bun:test";
import type { SQL } from "bun";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { activity, topTraders, curveProgress } from "../../src/web/server/live";

const NOW = Date.parse("2026-10-01T12:00:00Z");
let n = 0;
async function trade(sql: SQL, id: number, minutesAgo: number, o: { side: "buy" | "sell"; trader: string; tokens: number; quote: number; price: number; reserve?: number }) {
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, curve_reserve, curve_threshold, block_time, slot)
    values (${`s${n++}`}, 0, ${id}, 'curve', ${o.side}, ${o.trader}, ${o.tokens * 1e6}, ${o.quote * 1e9}, 0, ${o.quote}, ${o.price}, 100,
            ${o.reserve === undefined ? null : o.reserve * 1e9}, ${o.reserve === undefined ? null : 85e9}, ${new Date(NOW - minutesAgo * 60_000)}, ${Math.floor((NOW - minutesAgo * 60_000) / 400)})`;
}

test("activity counts buys, sells, value and wallets per window", async () => {
  const sql = await freshDb();
  const id = await insertLaunch(sql);
  await trade(sql, id, 2, { side: "buy", trader: "a", tokens: 100, quote: 1, price: 0.02 });
  await trade(sql, id, 3, { side: "sell", trader: "b", tokens: 50, quote: 0.5, price: 0.01 });
  await trade(sql, id, 30, { side: "buy", trader: "a", tokens: 100, quote: 2, price: 0.01 });
  await trade(sql, id, 60 * 5, { side: "buy", trader: "c", tokens: 100, quote: 4, price: 0.005 });
  const w = Object.fromEntries((await activity(sql, id, NOW)).map((x) => [x.window, x]));
  expect(w["5m"]).toMatchObject({ buys: 1, sells: 1, buyValue: 1, sellValue: 0.5, buyers: 1, sellers: 1 });
  expect(w["1h"]).toMatchObject({ buys: 2, sells: 1, buyValue: 3, buyers: 1 });
  expect(w["6h"]).toMatchObject({ buys: 3, buyers: 2 });
  expect(w["6h"]!.change).toBeCloseTo(300, 6);
  expect(w["24h"]).toMatchObject({ buys: 3, sells: 1 });
});

test("top traders rank by volume with position and profit at the current price", async () => {
  const sql = await freshDb();
  const id = await insertLaunch(sql);
  await trade(sql, id, 50, { side: "buy", trader: "a", tokens: 1000, quote: 1, price: 0.001 });
  await trade(sql, id, 40, { side: "sell", trader: "a", tokens: 500, quote: 1, price: 0.002 });
  await trade(sql, id, 30, { side: "buy", trader: "b", tokens: 100, quote: 0.4, price: 0.004 });
  const t = await topTraders(sql, id, 0.004, 10);
  expect(t.map((x) => x.wallet)).toEqual(["a", "b"]);
  expect(t[0]).toMatchObject({ trades: 2, bought: 1000, sold: 500, spent: 1, received: 1, position: 500 });
  // realized 1 - 0.5 = 0.5, unrealized 500 * 0.004 - 0.5 = 1.5
  expect(t[0]!.pnl).toBeCloseTo(2, 9);
  expect(t[1]!.pnl).toBeCloseTo(0, 9);
});

test("graduation progress comes from the latest curve trade", async () => {
  const sql = await freshDb();
  const id = await insertLaunch(sql);
  expect(await curveProgress(sql, id)).toBeNull();
  await trade(sql, id, 10, { side: "buy", trader: "a", tokens: 1, quote: 1, price: 1, reserve: 10 });
  await trade(sql, id, 5, { side: "buy", trader: "a", tokens: 1, quote: 1, price: 1, reserve: 42.5 });
  expect(await curveProgress(sql, id)).toEqual({ reserve: "42500000000", threshold: "85000000000", progress: 50 });
});

test("holders lists the largest accounts by owner with labels, concentration and staked share", async () => {
  const { holders } = await import("../../src/web/server/live");
  const chain = {
    async largest() { return [{ address: "acc1", amount: 600_000_000n * 1_000_000n }, { address: "acc2", amount: 100_000_000n * 1_000_000n }, { address: "acc3", amount: 50_000_000n * 1_000_000n }, { address: "acc4", amount: 0n }]; },
    async owners(a: string[]) { return a.map((x) => ({ acc1: "curveAuth", acc2: "vaultAuth", acc3: "alice", acc4: "bob" } as Record<string, string>)[x] ?? null); },
    async supply() { return 1_000_000_000n * 1_000_000n; },
    async count() { return 42; },
  };
  const h = await holders(chain, "MINT", { curveAuth: "Bonding curve", vaultAuth: "Staked" });
  expect(h.count).toBe(42);
  expect(h.list.map((x) => [x.owner, x.amount, x.pct, x.label])).toEqual([
    ["curveAuth", 600_000_000, 60, "Bonding curve"], ["vaultAuth", 100_000_000, 10, "Staked"], ["alice", 50_000_000, 5, null],
  ]);
  expect(h.stakedPct).toBe(10);
  // concentration leaves out the curve and the pool, which hold tokens for everyone
  expect(h.top10Pct).toBe(15);
});

test("live route returns market, graduation, activity, traders and trades for a mint", async () => {
  const { makeWebContext } = await import("../helpers/web-context");
  const { GET } = await import("../../src/app/api/token/[mint]/live/route");
  const { sql } = await makeWebContext();
  const id = await insertLaunch(sql, { mint: "LIVE1" });
  await trade(sql, id, 1, { side: "buy", trader: "a", tokens: 10, quote: 1, price: 0.1, reserve: 17 });
  const r = await GET(new Request("http://x"), { params: Promise.resolve({ mint: "LIVE1" }) });
  const j = await r.json();
  expect(j.status).toBe("live");
  expect(j.market.price).toBe(0.1);
  expect(j.quoteUsd).toBe(100);
  expect(j.curve.progress).toBe(20);
  expect(j.activity).toHaveLength(4);
  expect(j.traders[0].wallet).toBe("a");
  expect(j.trades).toHaveLength(1);
  expect(j.holders).toBeNull();
  expect((await GET(new Request("http://x"), { params: Promise.resolve({ mint: "nope" }) })).status).toBe(404);
});

test("live route carries the staking progress until staking opens", async () => {
  const { makeWebContext } = await import("../helpers/web-context");
  const { GET } = await import("../../src/app/api/token/[mint]/live/route");
  const { sql } = await makeWebContext();
  const id = await insertLaunch(sql, { mint: "LIVE2" });
  await sql`insert into stake_pools (launch_id, backend, max_penalty_bps, spill_account, status, rent_lamports, basket_value_lamports)
    values (${id}, 'kamino', 3000, 'Spill', 'pending', 400, 100)`;
  const get = async () => (await GET(new Request("http://x"), { params: Promise.resolve({ mint: "LIVE2" }) })).json();
  expect((await get()).staking).toEqual({ percent: 25, rentLamports: "400", neededLamports: "300" });
  await sql`update stake_pools set status = 'ready' where launch_id = ${id}`;
  await Bun.sleep(2_100);
  expect((await get()).staking).toBeNull();
});
