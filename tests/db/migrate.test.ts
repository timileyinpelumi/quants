import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { migrate } from "../../src/db/migrate";

test("migrations create tables and are idempotent", async () => {
  const sql = await freshDb();
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  expect(tables.map((t: { table_name: string }) => t.table_name)).toEqual(
    ["admin_codes", "admin_logins", "admin_sessions", "alerts_sent", "analytics_salts", "baskets", "config_keys", "cosign_requests", "distributions", "escrow", "index_cursors", "keeper_runs", "launches", "page_views", "platform_accounts", "prepared_launches", "schema_migrations", "settings", "stake_pools", "stake_tiers", "stock_quotes", "token_votes", "trades", "verified_tokens"],
  );
  expect(await migrate(sql)).toEqual([]);
});
