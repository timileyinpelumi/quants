import { test, expect } from "bun:test";
import type { SQL } from "bun";
import { freshDb } from "../helpers/db";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { recordKeeperRun, pruneAnalytics } from "../../src/ops/keeper-runs";
import { feeFlow, health, overview, series, topTokens, windowOf, type AnalyticsDeps } from "../../src/web/server/analytics";

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

test("daily series fill empty days and bucket by UTC day", async () => {
  const { sql } = await seed();
  const pts = await series(sql, windowOf("7d", NOW));
  expect(pts.map((p) => p.t.slice(0, 10))).toEqual(["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
  const day = (d: string) => { const p = pts.find((x) => x.t.startsWith(d))!; return { ...p, volumeUsd: round(p.volumeUsd), feesUsd: round(p.feesUsd) }; };
  expect(day("2026-10-01")).toMatchObject({ launches: 1, trades: 3, traders: 2, volumeUsd: 300, feesUsd: 100 });
  expect(day("2026-09-30")).toMatchObject({ launches: 0, trades: 1, traders: 1, volumeUsd: 200, feesUsd: 100 });
  expect(day("2026-09-29")).toMatchObject({ launches: 1, trades: 0, feesUsd: 0 });
});

test("24h series is hourly and all time starts at the first launch", async () => {
  const { sql } = await seed();
  const hours = await series(sql, windowOf("24h", NOW));
  expect(hours).toHaveLength(25);
  expect(hours.at(-1)!.t).toBe("2026-10-01T12:00:00.000Z");
  expect(hours.find((p) => p.t === "2026-10-01T11:00:00.000Z")).toMatchObject({ launches: 1, trades: 1 });
  const all = await series(sql, windowOf("all", NOW));
  expect(all[0]!.t).toBe("2026-09-21T00:00:00.000Z");
  expect(all.reduce((s, p) => s + p.trades, 0)).toBe(5);
});

test("top tokens rank by volume in the range with fees, traders and staking state", async () => {
  const { sql, b } = await seed();
  await sql`update stake_pools set rent_lamports = 1000, basket_value_lamports = 250 where launch_id = ${b}`;
  const rows = await topTokens(sql, windowOf("7d", NOW));
  expect(rows.map((r) => ({ ...r, volumeUsd: round(r.volumeUsd), feesUsd: round(r.feesUsd) }))).toEqual([
    { mint: "mint-AAA", symbol: "AAA", name: null, status: "live", volumeUsd: 300, trades: 2, traders: 2, feesUsd: 100, staking: { state: "open", percent: null } },
    { mint: "mint-BBB", symbol: "BBB", name: null, status: "graduated", volumeUsd: 100, trades: 1, traders: 1, feesUsd: 0, staking: { state: "opening", percent: 25 } },
    { mint: "mint-CCC", symbol: "CCC", name: null, status: "live", volumeUsd: 100, trades: 1, traders: 1, feesUsd: 100, staking: { state: "trading", percent: null } },
  ]);
  expect(await topTokens(sql, windowOf("7d", NOW), 1)).toHaveLength(1);
});

test("fee flow splits what was collected into rewards bought, rent, creator, treasury and what is held", async () => {
  const { sql, a, b } = await seed();
  await step(sql, a, "rent", 15 * H, { amount: "100000000" });
  await step(sql, a, "swap", 14 * H, { inputMint: SOL, outputMint: "jup", amountIn: "300000000" });
  await step(sql, a, "swap", 14 * H, { direct: true, inputMint: SOL, outputMint: SOL, amountIn: "50000000" });
  await step(sql, a, "swap", 16 * H, { inputMint: SOL, outputMint: SOL, amountIn: "999000000000", toBucket: "basket" });
  await step(sql, b, "rent", 8 * D, { amount: "500000000" });
  await sql`insert into escrow (launch_id, bucket, mint, amount) values
    (${a}, 'unsplit', ${SOL}, 100000000), (${a}, 'reward', 'jup', 4000000), (${b}, 'creator', ${SOL}, 200000000), (${b}, 'penalty', ${"mint-BBB"}, 7)`;
  const f = await feeFlow(deps(sql), windowOf("7d", NOW));
  const r = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));
  expect(round(f.collectedUsd)).toBe(200);
  expect(r(f.flow)).toEqual({ bought: 35, rent: 10, creator: 87.5, treasury: 52.5, held: 15 });
  expect(r(f.escrow)).toEqual({ unsplit: 10, basket: 0, reward: 2, creator: 20, treasury: 0 });
});

test("health reads keeper runs, ledger steps and indexer cursors", async () => {
  const { sql, a } = await seed();
  await recordKeeperRun(sql, { startedAt: new Date(NOW - 9 * D), launches: 2, errors: [] });
  await recordKeeperRun(sql, { startedAt: new Date(NOW - 2 * H), launches: 3, errors: [{ error: "boom" }, { error: "bang" }] });
  await recordKeeperRun(sql, { startedAt: new Date(NOW - H), fatal: "rpc down" });
  await sql`update keeper_runs set finished_at = started_at + interval '5 seconds'`;
  await step(sql, a, "claim", 3 * H, {}, { status: "failed", error: "transaction failed on-chain" });
  await step(sql, a, "claim", 2 * H, {}, { status: "failed", error: "abandoned before send" });
  await step(sql, a, "fund", 9 * D, {}, { status: "failed", error: "old" });
  await step(sql, a, "payout", 30 * 60_000, {}, { status: "sent" });
  await step(sql, a, "swap", 2 * 60_000, {}, { status: "pending" });
  await sql`insert into index_cursors (address, checked_at, finished) values
    ('p1', ${new Date(NOW - 5_000)}, false), ('p2', ${new Date(NOW - 65_000)}, false), ('p3', ${new Date(NOW - 9 * D)}, true)`;
  const h = await health(deps(sql), windowOf("24h", NOW));
  expect(h.keeper).toEqual({ lastAt: new Date(NOW - H + 5_000).toISOString(), ok: false, error: "rpc down", launches: 0, runs: 2, failedRuns: 2, errors: 3 });
  expect(h.wallet).toEqual({ address: "Keeper1", lamports: "5000000", low: true });
  expect(h.steps.failed).toBe(1);
  expect(h.steps.stuck).toBe(1);
  expect(h.steps.recent).toEqual([{ kind: "claim", mint: "mint-AAA", symbol: "AAA", error: "transaction failed on-chain", at: new Date(NOW - 3 * H).toISOString() }]);
  expect(h.indexer).toEqual({
    lastPassAt: new Date(NOW - 5_000).toISOString(), stalestAt: new Date(NOW - 65_000).toISOString(), lagSeconds: 65, addresses: 2,
    lastTradeAt: new Date(NOW - 30 * 60_000).toISOString(),
  });
  const failing = await health(deps(sql, { keeperWallet: async () => { throw new Error("rpc"); } }), windowOf("24h", NOW));
  expect(failing.wallet).toBeNull();
});

test("pruning drops page views and keeper runs past 90 days, a batch at a time", async () => {
  const { sql } = await seed();
  await recordKeeperRun(sql, { startedAt: new Date(NOW - 91 * D) });
  await recordKeeperRun(sql, { startedAt: new Date(NOW - 89 * D) });
  await sql`insert into page_views (at, path, visitor) values (${new Date(NOW - 91 * D)}, '/', 'v'), (${new Date(NOW - 89 * D)}, '/', 'v')`;
  expect(await pruneAnalytics(sql, NOW)).toEqual({ views: 1, runs: 1 });
  expect(await pruneAnalytics(sql, NOW)).toEqual({ views: 0, runs: 0 });
  const [left] = await sql`select (select count(*)::int from page_views) as v, (select count(*)::int from keeper_runs) as r`;
  expect(left).toEqual({ v: 1, r: 1 });
});

test("all time has no previous period", async () => {
  const { sql } = await seed();
  const o = await overview(deps(sql), windowOf("all", NOW));
  expect(o.launches).toEqual({ value: 3, prev: null });
  expect(o.trades).toEqual({ value: 5, prev: null });
  expect(round(o.feesUsd.value)).toBe(400);
});
