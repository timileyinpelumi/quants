import { SQL } from "bun";
import { migrate } from "../../src/db/migrate";

export async function freshDb(): Promise<SQL> {
  const sql = new SQL(process.env.TEST_DATABASE_URL!);
  await sql.unsafe("drop schema if exists public cascade; create schema public;");
  await migrate(sql);
  return sql;
}
