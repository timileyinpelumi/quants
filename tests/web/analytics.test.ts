import { test, expect } from "bun:test";
import type { SQL } from "bun";
import { freshDb } from "../helpers/db";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { overview, windowOf, type AnalyticsDeps } from "../../src/web/server/analytics";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const H = 3_600_000;
const D = 24 * H;
const SOL = "So11111111111111111111111111111111111111112";
let n = 0;

async function launch(sql: SQL, symbol: string, ago: number, o: Partial<{ status: string; tradingOnly: boolean; graduatedAgo: number }> = {}) {
  const [r] = await sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol, created_at, trading_only, graduated_at)
    values (${`mint-${symbol}`}, ${`pool-${symbol}`}, ${SOL}, 200, 'c', 'cr', ${o.status ?? "live"}, 1, ${symbol}, ${new Date(NOW - ago)}, ${o.tradingOnly ?? false},
            ${o.graduatedAgo === undefined ? null : new Date(NOW - o.graduatedAgo)}) returning id`;
  return Number(r.id);
}

async function trade(sql: SQL, id: number, ago: number, value: number, trader: string, usd = 100) {
  const at = NOW - ago;
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
    values (${`s${n++}`}, 0, ${id}, 'curve', 'buy', ${trader}, 1, ${value * 1e9}, 0, ${value}, 0.001, ${usd}, ${new Date(at)}, ${Math.floor(at / 400)})`;
}

export async function step(sql: SQL, id: number, kind: string, ago: number, detail: object, o: Partial<{ status: string; version: number; error: string }> = {}) {
  const key = `${kind}:${n++}`;
  await sql`insert into distributions (launch_id, idem_key, step_key, kind, status, detail, settings_version, error, created_at, updated_at)
    values (${id}, ${key}, ${key}, ${kind}, ${o.status ?? "confirmed"}, ${JSON.stringify(detail)}::text::jsonb, ${o.version ?? 1}, ${o.error ?? null},
            ${new Date(NOW - ago)}, ${new Date(NOW - ago)})`;
}

export function deps(sql: SQL, over: Partial<AnalyticsDeps> = {}): AnalyticsDeps {
  return {
    sql,
    usd: async (mints) => Object.fromEntries(mints.map((m) => [m, m === "jup" ? 0.5 : m === SOL ? 100 : null])),
    stakers: async (farms) => farms.length * 7,
    keeperWallet: async () => ({ address: "Keeper1", lamports: "5000000", low: true }),
    ...over,
  };
}

export async function seed() {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS1111111111111111111111111111111111111111"), "t");
  const a = await launch(sql, "AAA", 2 * D);
  const b = await launch(sql, "BBB", 10 * D, { status: "graduated", graduatedAgo: 3 * D });
  const c = await launch(sql, "CCC", H, { tradingOnly: true });
  await sql`insert into baskets (launch_id, reward_mint, weight_bps, symbol, decimals) values (${a}, 'jup', 10000, 'JUP', 6)`;
  await sql`insert into stake_pools (launch_id, backend, max_penalty_bps, spill_account, status, opened_at) values (${a}, 'kamino', 3000, 'sp', 'ready', ${new Date(NOW - D)})`;
  await sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps, farm) values (${a}, '1d', 86400, 10000, 'farmA')`;
  await sql`insert into stake_pools (launch_id, backend, max_penalty_bps, spill_account, status) values (${b}, 'kamino', 3000, 'sp', 'pending')`;
  await trade(sql, a, 2 * H, 1, "w1");
  await trade(sql, a, 30 * H, 2, "w2");
  await trade(sql, b, 9 * D, 5, "w1");
  await trade(sql, b, 5 * H, 1, "w3");
  await trade(sql, c, 30 * 60_000, 1, "w1");
  await step(sql, a, "split", D, { amount: "1000000000" });
  await step(sql, b, "split", 9 * D, { amount: "2000000000" });
  await step(sql, c, "split", 20 * 60_000, { amount: "1000000000", tradingOnly: true });
  await step(sql, b, "split", 2 * D, { amount: "5000000000" }, { status: "failed" });
  await step(sql, a, "payout", 20 * H, { bucket: "creator", mint: SOL, amount: "250000000" });
  await step(sql, a, "payout", 20 * H, { bucket: "treasury", mint: SOL, amount: "150000000" });
  await step(sql, a, "fund", 10 * H, { rewardMint: "jup", amount: "2000000", farm: "farmA" });
  return { sql, a, b, c };
}

const round = (x: number | null) => (x === null ? null : Math.round(x * 1e6) / 1e6);

test("windows cover the range and the period before it", () => {
  const w = windowOf("7d", NOW);
  expect(w.from.toISOString()).toBe("2026-09-24T12:00:00.000Z");
  expect(w.prevFrom!.toISOString()).toBe("2026-09-17T12:00:00.000Z");
  expect(w.unit).toBe("day");
  expect(windowOf("24h", NOW).unit).toBe("hour");
  expect(windowOf("all", NOW).prevFrom).toBeNull();
});

test("overview counts the range and the period before it, in USD from the latest trade price", async () => {
  const { sql } = await seed();
  const o = await overview(deps(sql), windowOf("7d", NOW));
  const flat = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [round(v.value), round(v.prev)]]));
  expect(flat).toEqual({
    launches: [2, 1],
    trades: [4, 1],
    traders: [3, 1],
    volumeUsd: [500, 500],
    feesUsd: [200, 200],
    stakersUsd: [1, 0],
    creatorsUsd: [25, 0],
    treasuryUsd: [15, 0],
    stakers: [7, null],
    stakingOpen: [1, null],
    stakingOpened: [1, 0],
    graduated: [1, 0],
  });
});

test("all time has no previous period", async () => {
  const { sql } = await seed();
  const o = await overview(deps(sql), windowOf("all", NOW));
  expect(o.launches).toEqual({ value: 3, prev: null });
  expect(o.trades).toEqual({ value: 5, prev: null });
  expect(round(o.feesUsd.value)).toBe(400);
});
