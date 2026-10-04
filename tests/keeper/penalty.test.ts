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

test("collects slashed amounts from every farm and burns only after approval", async () => {
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
  expect(f.chain.sent.filter((s) => s.startsWith("burn")).length).toBe(0);
  expect(await getBalance(f.sql, id, "penalty", "CAT")).toBe(500n);
  const [req] = await f.sql`select id, amount::text, status from burn_requests`;
  expect([req.amount, req.status]).toEqual(["500", "pending"]);

  staking.slashed.clear();
  await penaltyStep(deps, launch!, f.settings, "r2");
  expect((await f.sql`select count(*)::int as n from burn_requests`)[0].n).toBe(1);

  await f.sql`update burn_requests set status = 'approved' where id = ${req.id}`;
  await penaltyStep(deps, launch!, f.settings, "r3");
  expect(f.chain.sent.filter((s) => s.startsWith("burn")).length).toBe(1);
  expect(await getBalance(f.sql, id, "penalty", "CAT")).toBe(0n);
  const [done] = await f.sql`select status from burn_requests where id = ${req.id}`;
  expect(done.status).toBe("burned");
  await penaltyStep(deps, launch!, f.settings, "r4");
  expect(f.chain.sent.filter((s) => s.startsWith("burn")).length).toBe(1);
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
