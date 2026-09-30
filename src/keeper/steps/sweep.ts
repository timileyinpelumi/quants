import { PublicKey } from "@solana/web3.js";
import type { KeeperDeps } from "../deps";
import { recordLaunch } from "../../launch/confirm";

// A launch whose browser never reached /api/launch/confirm (closed tab, confirm timeout) would never have its fees routed.
export async function sweepPreparedLaunches(deps: KeeperDeps) {
  const rows = await deps.sql`
    select p.* from prepared_launches p
    where not exists (select 1 from launches l where l.mint = p.mint) and p.created_at < now() - interval '2 minutes'
    order by p.created_at limit 50`;
  for (const prep of rows) {
    const pool = await deps.meteora.poolInfo(prep.pool).catch(() => undefined);
    if (pool && pool.baseMint === prep.mint && pool.config === prep.config_key && pool.creator === prep.creator) {
      await recordLaunch(deps.sql, prep, new PublicKey(deps.wallets.spill));
    } else if (pool === null && new Date(prep.created_at).getTime() < Date.now() - 86_400_000) {
      await deps.sql`delete from prepared_launches where mint = ${prep.mint}`;
    }
  }
}
