import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../../db/migrations");

export async function migrate(sql: SQL): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r: { name: string }) => r.name));
  const applied: string[] = [];
  for (const name of (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const body = await Bun.file(join(DIR, name)).text();
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    applied.push(name);
  }
  return applied;
}

if (import.meta.main) {
  const sql = new SQL(process.env.DATABASE_URL!);
  console.log(await migrate(sql));
  await sql.close();
}
