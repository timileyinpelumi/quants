import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { migrate } from "../../src/db/migrate";

test("migrations create tables and are idempotent", async () => {
  const sql = await freshDb();
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  expect(tables.map((t: { table_name: string }) => t.table_name)).toEqual(
    ["admin_nonces", "alerts_sent", "baskets", "distributions", "escrow", "index_cursors", "launches", "prepared_launches", "schema_migrations", "settings", "stake_pools", "stake_tiers", "trades"],
  );
  expect(await migrate(sql)).toEqual([]);
});
