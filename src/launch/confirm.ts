import type { SQL } from "bun";
import { PublicKey, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LaunchError } from "./prepare";
import type { MeteoraPort } from "../meteora/port";

// Everything except the mint and signature comes from what prepareLaunch stored, checked against the pool on-chain.
export async function confirmLaunch(
  deps: { sql: SQL; conn: Pick<Connection, "getSignatureStatuses">; meteora: Pick<MeteoraPort, "poolInfo">; spillWallet: PublicKey },
  i: { signature: string; mint: string },
): Promise<number> {
  const [existing] = await deps.sql`select id from launches where mint = ${i.mint}`;
  if (existing) return Number(existing.id);
  const [prep] = await deps.sql`select * from prepared_launches where mint = ${i.mint}`;
  if (!prep) throw new LaunchError("not_found_on_chain", "This launch was not prepared on quants");
  const { value } = await deps.conn.getSignatureStatuses([i.signature], { searchTransactionHistory: true });
  const status = value[0];
  if (!status || status.err) throw new LaunchError("not_found_on_chain", "Launch transaction not found");
  const pool = await deps.meteora.poolInfo(prep.pool);
  if (!pool) throw new LaunchError("not_found_on_chain", "Launch pool not found");
  if (pool.baseMint !== i.mint || pool.config !== prep.config_key || pool.creator !== prep.creator) {
    throw new LaunchError("pool_mismatch", "The on-chain pool does not match the prepared launch");
  }
  return recordLaunch(deps.sql, prep, deps.spillWallet);
}

// Shared by confirmLaunch and the keeper's sweep of launches that landed but were never confirmed.
export async function recordLaunch(sql: SQL, prep: any, spillWallet: PublicKey): Promise<number> {
  const i = { mint: prep.mint as string };
  const deps = { sql };
  const spillAccount = getAssociatedTokenAddressSync(new PublicKey(i.mint), spillWallet).toBase58();
  const [row] = await deps.sql`
    with s as (select data from settings where version = ${prep.settings_version}),
    l as (
      insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, name, symbol, uri, image)
      values (${i.mint}, ${prep.pool}, ${prep.quote_mint}, ${prep.fee_tier_bps}, ${prep.config_key}, ${prep.creator}, 'live', ${prep.settings_version},
              ${prep.name}, ${prep.symbol}, ${prep.uri}, ${prep.image})
      on conflict (mint) do nothing returning id
    ), b as (
      insert into baskets (launch_id, reward_mint, weight_bps, symbol, decimals)
      select l.id, x.mint, x."weightBps", x.symbol, x.decimals
      from l cross join jsonb_to_recordset(${JSON.stringify(prep.basket)}::text::jsonb) as x(mint text, "weightBps" int, symbol text, decimals int)
    ), p as (
      insert into stake_pools (launch_id, backend, max_penalty_bps, spill_account, status)
      select l.id, s.data->>'defaultBackend', (s.data->>'maxPenaltyBps')::int, ${spillAccount}, 'pending' from l, s
      returning launch_id
    ), t as (
      insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps)
      select p.launch_id, x.id, x."lockSeconds", x."multiplierBps"
      from p, s, jsonb_to_recordset(s.data->'tiers') as x(id text, "lockSeconds" int, "multiplierBps" int)
    )
    select id from l`;
  if (row) return Number(row.id);
  const [again] = await deps.sql`select id from launches where mint = ${i.mint}`;
  return Number(again.id);
}
