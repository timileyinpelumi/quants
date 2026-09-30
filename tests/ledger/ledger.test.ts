import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { beginStep, confirmStep, getBalance, abandonUnsent, markSent, ledgerTotals } from "../../src/ledger/ledger";

const M = "mintA";

test("confirmStep applies deltas once", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  const row = await beginStep(sql, { launchId, idemKey: "k1", kind: "claim", settingsVersion: 1, detail: {} });
  expect(await confirmStep(sql, row, [{ bucket: "unsplit", mint: M, amount: 500n }])).toBe(true);
  expect(await confirmStep(sql, row, [{ bucket: "unsplit", mint: M, amount: 500n }])).toBe(false);
  expect(await getBalance(sql, launchId, "unsplit", M)).toBe(500n);
});

test("beginStep with the same idem key returns the existing row", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  const a = await beginStep(sql, { launchId, idemKey: "same", kind: "claim", settingsVersion: 1, detail: { x: 1 } });
  const b = await beginStep(sql, { launchId, idemKey: "same", kind: "claim", settingsVersion: 1, detail: { x: 2 } });
  expect(b.id).toBe(a.id);
  expect(b.detail).toEqual({ x: 1 });
});

test("a delta that would make a balance negative rejects the whole step", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  const row = await beginStep(sql, { launchId, idemKey: "k2", kind: "split", settingsVersion: 1, detail: {} });
  await expect(confirmStep(sql, row, [{ bucket: "unsplit", mint: M, amount: -1n }, { bucket: "basket", mint: M, amount: 1n }])).rejects.toThrow();
  expect(await getBalance(sql, launchId, "basket", M)).toBe(0n);
  const [r] = await sql`select status from distributions where id = ${row.id}`;
  expect(r.status).toBe("pending");
});

test("abandonUnsent fails pending rows with no signature and leaves sent rows", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  await beginStep(sql, { launchId, idemKey: "p", kind: "claim", settingsVersion: 1, detail: {} });
  const s = await beginStep(sql, { launchId, idemKey: "s", kind: "claim", settingsVersion: 1, detail: {} });
  await markSent(sql, s.id, "sig", 10n);
  expect(await abandonUnsent(sql)).toBe(1);
  const rows = await sql`select idem_key, status from distributions order by idem_key`;
  expect(rows.map((r: any) => [r.idem_key, r.status])).toEqual([["p", "failed"], ["s", "sent"]]);
});

test("ledgerTotals groups penalty under spill and the rest under keeper", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  const row = await beginStep(sql, { launchId, idemKey: "t", kind: "claim", settingsVersion: 1, detail: {} });
  await confirmStep(sql, row, [
    { bucket: "basket", mint: M, amount: 10n }, { bucket: "creator", mint: M, amount: 5n }, { bucket: "penalty", mint: M, amount: 3n },
  ]);
  const t = await ledgerTotals(sql);
  expect(t.get(`keeper:${M}`)).toBe(15n);
  expect(t.get(`spill:${M}`)).toBe(3n);
});
