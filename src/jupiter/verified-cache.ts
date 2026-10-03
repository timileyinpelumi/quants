import type { SQL } from "bun";
import type { JupiterPort } from "./port";

/** Remembers every token Jupiter has confirmed as verified, in memory and in the database, so it is never asked again. */
export function withVerifiedCache(j: JupiterPort, sql: SQL): JupiterPort {
  const known = new Set<string>();
  const save = (mints: string[]) => {
    const fresh = mints.filter((m) => !known.has(m));
    for (const m of fresh) known.add(m);
    if (fresh.length) sql`insert into verified_tokens ${sql(fresh.map((mint) => ({ mint })))} on conflict do nothing`.catch(() => {});
  };
  return Object.assign(Object.create(j), {
    async isVerified(mint: string) {
      if (known.has(mint)) return true;
      const [row] = await sql`select 1 from verified_tokens where mint = ${mint}`;
      if (row) { known.add(mint); return true; }
      const ok = await j.isVerified(mint);
      if (ok) save([mint]);
      return ok;
    },
    async searchVerified(query: string) {
      const list = await j.searchVerified(query);
      save(list.map((t) => t.mint));
      return list;
    },
    async popularVerified() {
      const list = await j.popularVerified();
      save(list.map((t) => t.mint));
      return list;
    },
  }) as JupiterPort;
}
