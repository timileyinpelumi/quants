import { SQL } from "bun";
import { migrate } from "../../src/db/migrate";
import { invalidateSettingsCache } from "../../src/domain/settings";

let shared: SQL | undefined;

export async function freshDb(): Promise<SQL> {
  shared ??= new SQL({ url: process.env.TEST_DATABASE_URL!, max: 4 });
  await shared.unsafe("drop schema if exists public cascade; create schema public;");
  await migrate(shared);
  invalidateSettingsCache();
  return shared;
}
