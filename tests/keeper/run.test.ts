import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { FakeJupiter } from "../helpers/fake-jupiter";
import { runKeeper, resume, reconcile, ReconcileError } from "../../src/keeper/run";
import { beginStep, markSent, getBalance, confirmStep } from "../../src/ledger/ledger";
import { NATIVE_MINT } from "../../src/domain/types";

async function full() {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 1);
  f.chain.balances.set(`Keeper:${NATIVE_MINT}`, 10n ** 18n);
  return { ...f, staking, jupiter, deps: { ...f.deps, staking, jupiter } };
}

test("a full run claims, splits, pays out, creates farms, swaps and funds", async () => {
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
  expect(f.staking.funded[0]!.amount).toBe(600_000_000n);
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
