import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { FakeJupiter } from "../helpers/fake-jupiter";
import { runKeeper, resume, reconcile, ReconcileError } from "../../src/keeper/run";
import { beginStep, markSent, getBalance, confirmStep } from "../../src/ledger/ledger";
import { NATIVE_MINT } from "../../src/domain/types";
import { launchCost } from "../../src/domain/launch-cost";

async function full() {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 1);
  f.chain.balances.set(`Keeper:${NATIVE_MINT}`, 10n ** 18n);
  return { ...f, staking, jupiter, deps: { ...f.deps, staking, jupiter } };
}

test("a full run claims, splits, pays out, takes the farm rent, creates farms, swaps and funds", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql, { mint: "CAT", pool: "P1" });
  await f.sql`insert into baskets values (${id}, 'ZEC', 10000)`;
  await f.sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'pending')`;
  await f.sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps) values (${id}, '7d', 604800, 10000)`;
  f.meteora.partnerFee.set("P1", 1_000_000_000n);
  f.staking.totalStaked = async () => 1n;
  const r = await runKeeper(f.deps);
  expect(r.errors).toEqual([]);
  expect(f.staking.funded.length).toBe(1);
  expect(f.staking.funded[0]!.amount).toBe(600_000_000n - launchCost({ tiers: [{ id: "7d", lockSeconds: 604800, multiplierBps: 10000 }] }, 1).rent);
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(0n);
});

test("resume confirms a sent step whose transaction landed, without resending", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql, { pool: "P2" });
  const row = await beginStep(f.sql, { launchId: id, idemKey: "claim:x", kind: "claim", settingsVersion: 1, detail: { source: "dbc", quoteMint: NATIVE_MINT, amount: "42" } });
  await markSent(f.sql, row.id, "landed-sig", 10_000n);
  f.chain.states.set("landed-sig", "confirmed");
  await resume(f.deps);
  expect(await getBalance(f.sql, id, "unsplit", NATIVE_MINT)).toBe(42n);
  expect(f.chain.sent.length).toBe(0);
});

test("reconcile halts when the ledger holds more than the wallet", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql);
  const row = await beginStep(f.sql, { launchId: id, idemKey: "s", kind: "split", settingsVersion: 1, detail: {} });
  await confirmStep(f.sql, row, [{ bucket: "reward", mint: "ZEC", amount: 100n }]);
  f.chain.balances.set("Keeper:ZEC", 99n);
  await expect(reconcile(f.deps)).rejects.toBeInstanceOf(ReconcileError);
  await expect(runKeeper(f.deps)).rejects.toBeInstanceOf(ReconcileError);
});

test("one launch failing does not stop the others", async () => {
  const f = await full();
  await insertLaunch(f.sql, { pool: "BAD" });
  const good = await insertLaunch(f.sql, { pool: "GOOD" });
  f.meteora.partnerFee.set("GOOD", 1_000n);
  const orig = f.meteora.curveState.bind(f.meteora);
  f.meteora.curveState = async (pool) => { if (pool === "BAD") throw new Error("rpc"); return orig(pool); };
  const r = await runKeeper(f.deps);
  expect(r.errors.length).toBe(1);
  expect(await getBalance(f.sql, good, "unsplit", NATIVE_MINT) + await getBalance(f.sql, good, "basket", NATIVE_MINT)).toBeGreaterThan(0n);
});

function transfersEndAs(f: Awaited<ReturnType<typeof full>>, state: "unknown" | "failed") {
  const orig = f.chain.buildTransfer.bind(f.chain);
  const built: string[] = [];
  f.chain.buildTransfer = async (...a) => {
    const t = await orig(...a);
    built.push(t.signature);
    return { ...t, send: async () => { await t.send(); f.chain.states.set(t.signature, state); } };
  };
  return { built, restore: () => { f.chain.buildTransfer = orig; } };
}

test("restart with a transfer still in flight does not pay the balance a second time", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql, { pool: "P9" });
  f.meteora.partnerFee.set("P9", 100_000_000n);
  const t = transfersEndAs(f, "unknown");
  await runKeeper(f.deps);
  expect(t.built.length).toBe(1);
  await runKeeper(f.deps);
  expect(t.built.length).toBe(1);
  f.chain.states.set(t.built[0]!, "confirmed");
  t.restore();
  const r = await runKeeper(f.deps);
  expect(r.errors).toEqual([]);
  expect(t.built.length).toBe(1);
  expect(await getBalance(f.sql, id, "treasury", NATIVE_MINT)).toBe(0n);
});

test("a row whose resolver throws does not stop other launches", async () => {
  const f = await full();
  const stuck = await insertLaunch(f.sql, { pool: "S1" });
  const good = await insertLaunch(f.sql, { pool: "G1" });
  const row = await beginStep(f.sql, { launchId: stuck, idemKey: "claim:bad", kind: "claim", settingsVersion: 1, detail: { source: "damm", quoteMint: NATIVE_MINT } });
  await markSent(f.sql, row.id, "landed", 10_000n);
  f.chain.states.set("landed", "confirmed");
  f.chain.received = async () => { throw new Error("rpc lag"); };
  f.meteora.partnerFee.set("G1", 1_000n);
  const r = await runKeeper(f.deps);
  expect(await getBalance(f.sql, good, "unsplit", NATIVE_MINT) + await getBalance(f.sql, good, "basket", NATIVE_MINT)).toBeGreaterThan(0n);
  expect(r.errors).toEqual([]);
});

test("a transfer that fails on-chain every run stops after MAX_ATTEMPTS runs", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql, { pool: "P10" });
  f.meteora.partnerFee.set("P10", 100_000_000n);
  const t = transfersEndAs(f, "failed");
  for (let i = 0; i < 8; i++) await runKeeper(f.deps);
  expect(t.built.length).toBe(5);
  expect(await getBalance(f.sql, id, "treasury", NATIVE_MINT)).toBe(15_000_000n);
});

test("a farm creation whose build throws once is retried on the next run", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql, { pool: "P11" });
  await f.sql`insert into baskets values (${id}, 'ZEC', 10000)`;
  await f.sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'pending')`;
  await f.sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps) values (${id}, '7d', 604800, 10000)`;
  f.meteora.partnerFee.set("P11", 1_000_000_000n);
  f.chain.balances.set("Keeper:ZEC", 10n ** 18n);
  const orig = f.staking.buildCreateFarm.bind(f.staking);
  let calls = 0;
  f.staking.buildCreateFarm = async (...a) => { if (calls++ === 0) throw new Error("rpc blip"); return orig(...a); };
  await runKeeper(f.deps);
  await runKeeper(f.deps);
  const [p] = await f.sql`select status from stake_pools where launch_id = ${id}`;
  expect(p.status).toBe("ready");
});

test("the keeper records launches that landed but were never confirmed, and drops stale ones", async () => {
  const f = await full();
  const { Keypair } = await import("@solana/web3.js");
  const LATE = Keypair.generate().publicKey.toBase58(), GONE = Keypair.generate().publicKey.toBase58(), FRESH = Keypair.generate().publicKey.toBase58();
  f.deps.wallets = { ...f.deps.wallets, spill: Keypair.generate().publicKey.toBase58() };
  const insertPrepared = (mint: string, pool: string, age: string) => f.sql`
    insert into prepared_launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, basket, settings_version, name, symbol, uri, created_at)
    values (${mint}, ${pool}, ${NATIVE_MINT}, 200, 'Cfg', 'Creator111111111111111111111111111111111111',
            ${JSON.stringify([{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }])}::text::jsonb, 1, 'Late', 'LATE', 'https://x', now() - ${age}::interval)`;
  await insertPrepared(LATE, "LatePool", "10 minutes");
  await insertPrepared(GONE, "GonePool", "2 days");
  await insertPrepared(FRESH, "FreshPool", "10 seconds");
  f.meteora.pools.set("LatePool", { baseMint: LATE, config: "Cfg", creator: "Creator111111111111111111111111111111111111" });
  f.meteora.pools.set("FreshPool", { baseMint: FRESH, config: "Cfg", creator: "Creator111111111111111111111111111111111111" });
  await runKeeper(f.deps);
  const launches = (await f.sql`select mint from launches order by mint`).map((r: any) => r.mint);
  expect(launches).toEqual([LATE]);
  const [sp] = await f.sql`select sp.status from stake_pools sp join launches l on l.id = sp.launch_id where l.mint = ${LATE}`;
  expect(sp.status).toBeDefined();
  const prepared = (await f.sql`select mint from prepared_launches order by mint`).map((r: any) => r.mint);
  expect(prepared).not.toContain(GONE);
});

test("a flood of prepared launches that never landed does not keep a real one from being swept", async () => {
  const f = await full();
  const { Keypair } = await import("@solana/web3.js");
  f.deps.wallets = { ...f.deps.wallets, spill: Keypair.generate().publicKey.toBase58() };
  const basket = JSON.stringify([{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }]);
  await f.sql`
    insert into prepared_launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, basket, settings_version, name, symbol, uri, created_at)
    select 'Junk' || g, 'JunkPool' || g, ${NATIVE_MINT}, 200, 'Cfg', 'C', ${basket}::text::jsonb, 1, 'J', 'J', 'https://x', now() - interval '20 minutes' - g * interval '1 second'
    from generate_series(1, 120) g`;
  await f.sql`
    insert into prepared_launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, basket, settings_version, name, symbol, uri, created_at)
    select 'Old' || g, 'OldPool' || g, ${NATIVE_MINT}, 200, 'Cfg', 'C', ${basket}::text::jsonb, 1, 'J', 'J', 'https://x', now() - interval '3 days'
    from generate_series(1, 60) g`;
  const REAL = Keypair.generate().publicKey.toBase58();
  await f.sql`
    insert into prepared_launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, basket, settings_version, name, symbol, uri, created_at)
    values (${REAL}, 'RealPool', ${NATIVE_MINT}, 200, 'Cfg', 'Creator111111111111111111111111111111111111', ${basket}::text::jsonb, 1, 'Real', 'REAL', 'https://x', now() - interval '5 minutes')`;
  f.meteora.pools.set("RealPool", { baseMint: REAL, config: "Cfg", creator: "Creator111111111111111111111111111111111111" });
  await runKeeper(f.deps);
  expect((await f.sql`select mint from launches`).map((r: any) => r.mint)).toEqual([REAL]);
  const [{ n }] = await f.sql`select count(*)::int as n from prepared_launches where mint like 'Old%'`;
  expect(n).toBe(0);
});

test("an unfunded keeper skips the run without touching any launch or burning attempts", async () => {
  const f = await full();
  f.chain.balances.set(`Keeper:${NATIVE_MINT}`, 1_000_000n);
  const id = await insertLaunch(f.sql, { mint: "CAT", pool: "P1" });
  f.meteora.partnerFee.set("P1", 1_000_000_000n);
  const r = await runKeeper(f.deps);
  expect(r.skipped).toBe("keeper_unfunded");
  expect((await f.sql`select 1 from distributions where launch_id = ${id}`).length).toBe(0);
  f.chain.balances.set(`Keeper:${NATIVE_MINT}`, 10n ** 18n);
  const r2 = await runKeeper(f.deps);
  expect(r2.skipped).toBeUndefined();
  expect(await getBalance(f.sql, id, "unsplit", NATIVE_MINT) + await getBalance(f.sql, id, "basket", NATIVE_MINT)).toBeGreaterThan(0n);
});
