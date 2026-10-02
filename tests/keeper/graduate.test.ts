import { test, expect } from "bun:test";
import { keeperFixture, OURS } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { loadLaunches } from "../../src/keeper/launch-row";
import { graduateStep } from "../../src/keeper/steps/graduate";

test("a platform token launch with a full curve is migrated by the keeper", async () => {
  const f = await keeperFixture();
  await insertLaunch(f.sql, { mint: "CAT", pool: "P1", quote_mint: OURS });
  f.meteora.curve.set("P1", { migrated: false, complete: true });
  const [launch] = await loadLaunches(f.sql);
  await graduateStep(f.deps, launch!, f.settings, "r1");
  expect(f.chain.sent.some((s) => s.startsWith("migrate-P1"))).toBe(true);
});

test("a full SOL curve that Meteora has not migrated yet is migrated by the keeper", async () => {
  const f = await keeperFixture();
  await insertLaunch(f.sql, { mint: "CAT", pool: "P2" });
  f.meteora.curve.set("P2", { migrated: false, complete: true });
  const [launch] = await loadLaunches(f.sql);
  await graduateStep(f.deps, launch!, f.settings, "r1");
  expect(f.chain.sent.some((s) => s.startsWith("migrate-P2"))).toBe(true);
});

test("a curve that is not full is left alone", async () => {
  const f = await keeperFixture();
  await insertLaunch(f.sql, { mint: "CAT", pool: "P4" });
  f.meteora.curve.set("P4", { migrated: false, complete: false });
  const [launch] = await loadLaunches(f.sql);
  await graduateStep(f.deps, launch!, f.settings, "r1");
  expect(f.chain.sent.length).toBe(0);
});

test("a migrated launch records its DAMM position and becomes graduated", async () => {
  const f = await keeperFixture();
  const id = await insertLaunch(f.sql, { mint: "CAT", pool: "P3" });
  f.meteora.curve.set("P3", { migrated: true, complete: true });
  f.meteora.graduated.set("CAT", { dammPool: "D3", position: "Pos3", positionNftAccount: "Nft3" });
  const [launch] = await loadLaunches(f.sql);
  const updated = await graduateStep(f.deps, launch!, f.settings, "r1");
  expect(updated.status).toBe("graduated");
  const [l] = await f.sql`select status, damm_pool, damm_position from launches where id = ${id}`;
  expect([l.status, l.damm_pool, l.damm_position]).toEqual(["graduated", "D3", "Pos3"]);
});
