import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { loadLaunches } from "../../src/keeper/launch-row";
import { createFarmsStep } from "../../src/keeper/steps/farms";
import { fundStep } from "../../src/keeper/steps/fund";
import { beginStep, confirmStep, getBalance } from "../../src/ledger/ledger";

async function pendingPool(sql: any, id: number) {
  await sql`insert into baskets values (${id}, 'ZEC', 10000)`;
  await sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'pending')`;
  await sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps) values
    (${id}, '7d', 604800, 10000), (${id}, '180d', 15552000, 30000)`;
}

test("creates and configures one farm per tier, then marks the pool ready", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql);
  expect(await createFarmsStep(deps, launch!, f.settings, "r1")).toBe("ready");
  const tiers = await f.sql`select farm from stake_tiers where launch_id = ${id}`;
  expect(tiers.every((t: any) => t.farm)).toBe(true);
  const [p] = await f.sql`select status from stake_pools where launch_id = ${id}`;
  expect(p.status).toBe("ready");
  expect(await createFarmsStep(deps, launch!, f.settings, "r2")).toBe("ready");
  expect(f.chain.sent.filter((s) => s.startsWith("create_farm")).length).toBe(2);
});

test("a retried farm creation reuses the stored farm keypair", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql);
  f.chain.nextOutcome = "unknown";
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const [a] = await f.sql`select detail->>'farm' as farm from distributions where kind = 'create_farm' order by id limit 1`;
  f.chain.height += 1_000n;
  f.chain.nextOutcome = "confirmed";
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const [b] = await f.sql`select detail->>'farm' as farm from distributions where kind = 'create_farm' order by id limit 1`;
  expect(b.farm).toBe(a.farm);
});

test("adds rewards in batches sized for one transaction and skips rewards already on the farm", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const mints = Array.from({ length: 9 }, (_, i) => `R${i}`);
  for (const m of mints) await f.sql`insert into baskets values (${id}, ${m}, 1000)`;
  const [launch] = await loadLaunches(f.sql);
  f.chain.nextOutcome = "unknown";
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const [first] = await f.sql`select detail->>'farm' as farm from distributions where kind = 'create_farm' order by id limit 1`;
  staking.farms.add(first.farm);
  staking.rewards.set(first.farm, ["R0", "R1", "R2", "R3"]);
  f.chain.height += 1_000n;
  f.chain.nextOutcome = "confirmed";
  expect(await createFarmsStep(deps, launch!, f.settings, "r2")).toBe("ready");
  const farms = await f.sql`select farm from stake_tiers where launch_id = ${id} order by lock_seconds`;
  for (const t of farms) expect([...staking.rewards.get(t.farm)!].sort()).toEqual(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "ZEC"]);
  for (const b of staking.rewardBatches) expect(b.length).toBeLessThanOrEqual(staking.capabilities().rewardsPerTx);
  expect(staking.rewardBatches.flat().filter((m) => m === "R0").length).toBe(1);
  expect(f.chain.sent.filter((s) => s.startsWith("configure_farm")).length).toBe(2);
});

test("fund allocates by stake times multiplier and sets rate over the period", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql);
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const farms = await f.sql`select tier_id, farm from stake_tiers where launch_id = ${id} order by lock_seconds`;
  staking.staked.set(farms[0].farm, 100n).set(farms[1].farm, 100n);
  staking.available.set(`${farms[1].farm}:ZEC`, 86_400n);
  const r = await beginStep(f.sql, { launchId: id, idemKey: "seed", kind: "swap", settingsVersion: 1, detail: {} });
  await confirmStep(f.sql, r, [{ bucket: "reward", mint: "ZEC", amount: 86_400n * 4n }]);
  await fundStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(0n);
  const byFarm = Object.fromEntries(staking.funded.map((x) => [x.farm, x]));
  expect(byFarm[farms[0].farm]!.amount).toBe(86_400n);
  expect(byFarm[farms[1].farm]!.amount).toBe(259_200n);
  expect(byFarm[farms[1].farm]!.rawRps).toBe(4n);
});

test("fund holds rewards in escrow when nobody has staked", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql);
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const r = await beginStep(f.sql, { launchId: id, idemKey: "seed", kind: "swap", settingsVersion: 1, detail: {} });
  await confirmStep(f.sql, r, [{ bucket: "reward", mint: "ZEC", amount: 1_000n }]);
  await fundStep(deps, launch!, f.settings, "r1");
  expect(staking.funded.length).toBe(0);
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(1_000n);
});

test("fund does nothing while the stake pool is pending", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql);
  const r = await beginStep(f.sql, { launchId: id, idemKey: "seed", kind: "swap", settingsVersion: 1, detail: {} });
  await confirmStep(f.sql, r, [{ bucket: "reward", mint: "ZEC", amount: 1_000n }]);
  await fundStep(deps, launch!, f.settings, "r1");
  expect(staking.funded.length).toBe(0);
});
