import { PublicKey } from "@solana/web3.js";
import type { KeeperDeps } from "../deps";
import { recordLaunch } from "../../launch/confirm";

// A launch whose browser never reached /api/launch/confirm (closed tab, confirm timeout) would never have its fees routed.
// Expired rows go in one statement first so a flood of never-sent prepares cannot fill the batch; newest are checked first.
export async function sweepPreparedLaunches(deps: Pick<KeeperDeps, "sql" | "meteora" | "wallets">, o: { minAgeSeconds?: number } = {}) {
  await deps.sql`delete from prepared_launches p
    where p.created_at < now() - interval '1 day' and not exists (select 1 from launches l where l.mint = p.mint)`;
  const rows = await deps.sql`
    select p.* from prepared_launches p
    where not exists (select 1 from launches l where l.mint = p.mint) and p.created_at < now() - make_interval(secs => ${o.minAgeSeconds ?? 120})
    order by p.created_at desc limit 50`;
  for (const prep of rows) {
    const pool = await deps.meteora.poolInfo(prep.pool).catch(() => undefined);
    if (pool && pool.baseMint === prep.mint && pool.config === prep.config_key && pool.creator === prep.creator) {
      await recordLaunch(deps.sql, prep, new PublicKey(deps.wallets.spill));
    }
  }
}
