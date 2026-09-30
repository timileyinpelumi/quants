import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { confirmLaunch } from "../../src/launch/confirm";
import { NATIVE_MINT } from "../../src/domain/types";
import { defaultSettings, saveSettings } from "../../src/domain/settings";

const conn = (ok: boolean) => ({
  getSignatureStatuses: async () => ({ value: [ok ? { err: null, confirmationStatus: "confirmed" } : null] }),
  getAccountInfo: async () => (ok ? { data: Buffer.alloc(0) } : null),
}) as any;

const input = {
  signature: "sig", mint: "Mint1", pool: "11111111111111111111111111111111", creator: "Creator1", quoteMint: NATIVE_MINT, feeTierBps: 200,
  basket: [{ mint: "Zec", weightBps: 10_000 }], settingsVersion: 1, spillAccount: "Spill1",
};

test("records launch, basket, and a pending stake pool with tiers from the settings version", async () => {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS"), "t");
  const id = await confirmLaunch({ sql, conn: conn(true), configKeys: { [`${NATIVE_MINT}:200`]: "Cfg" } }, input);
  const [l] = await sql`select * from launches where id = ${id}`;
  expect(l.config_key).toBe("Cfg");
  expect((await sql`select * from baskets where launch_id = ${id}`).length).toBe(1);
  const [sp] = await sql`select * from stake_pools where launch_id = ${id}`;
  expect(sp.status).toBe("pending");
  expect(sp.max_penalty_bps).toBe(3000);
  expect((await sql`select tier_id from stake_tiers where launch_id = ${id} order by lock_seconds`).map((r: any) => r.tier_id)).toEqual(["7d", "30d", "90d", "180d"]);
});

test("confirm is idempotent on mint", async () => {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS"), "t");
  const deps = { sql, conn: conn(true), configKeys: { [`${NATIVE_MINT}:200`]: "Cfg" } };
  expect(await confirmLaunch(deps, input)).toBe(await confirmLaunch(deps, input));
});

test("rejects when the pool is not on-chain", async () => {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS"), "t");
  await expect(confirmLaunch({ sql, conn: conn(false), configKeys: { [`${NATIVE_MINT}:200`]: "Cfg" } }, input)).rejects.toMatchObject({ code: "not_found_on_chain" });
});
