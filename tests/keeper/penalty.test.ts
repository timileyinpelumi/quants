import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { loadLaunches } from "../../src/keeper/launch-row";
import { penaltyStep } from "../../src/keeper/steps/penalty";
import { getBalance } from "../../src/ledger/ledger";

async function readyPool(sql: any, id: number) {
  await sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'ready')`;
  await sql`insert into stake_tiers values (${id}, '7d', 604800, 10000, 'FarmA'), (${id}, '30d', 2592000, 15000, 'FarmB')`;
}

test("collects slashed amounts from every farm and burns all of it", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql, { mint: "CAT" });
  await readyPool(f.sql, id);
  staking.slashed.set("FarmA", 300n).set("FarmB", 200n);
  const collected = [300n, 200n];
  const orig = f.chain.tx.bind(f.chain);
  f.chain.tx = (label) => {
    const t = orig(label);
    if (label === "collect") f.chain.receipts.set(t.signature, collected.shift()!);
    return t;
  };
  const [launch] = await loadLaunches(f.sql);
  await penaltyStep(deps, launch!, f.settings, "r1");
  expect(f.chain.sent.filter((s) => s.startsWith("collect")).length).toBe(2);
  expect(f.chain.sent.filter((s) => s.startsWith("burn")).length).toBe(1);
  expect(await getBalance(f.sql, id, "penalty", "CAT")).toBe(0n);
  const [burn] = await f.sql`select detail->>'amount' as amount from distributions where kind = 'burn'`;
  expect(burn.amount).toBe("500");
});

test("no transactions when nothing was slashed", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql, { mint: "CAT" });
  await readyPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql);
  await penaltyStep(deps, launch!, f.settings, "r1");
  expect(f.chain.sent.length).toBe(0);
});
