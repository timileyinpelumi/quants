import type { SQL } from "bun";
import { PublicKey, type Connection } from "@solana/web3.js";
import { LaunchError } from "./prepare";
import { configKeyName } from "../meteora/config";

export async function confirmLaunch(
  deps: { sql: SQL; conn: Connection; configKeys: Record<string, string> },
  i: { signature: string; mint: string; pool: string; creator: string; quoteMint: string; feeTierBps: number;
       basket: { mint: string; weightBps: number }[]; settingsVersion: number; spillAccount: string },
): Promise<number> {
  const [existing] = await deps.sql`select id from launches where mint = ${i.mint}`;
  if (existing) return Number(existing.id);
  const { value } = await deps.conn.getSignatureStatuses([i.signature], { searchTransactionHistory: true });
  const status = value[0];
  const pool = await deps.conn.getAccountInfo(new PublicKey(i.pool), "confirmed").catch(() => null);
  if (!status || status.err || !pool) throw new LaunchError("not_found_on_chain", "launch transaction or pool not found");
  const configKey = deps.configKeys[configKeyName(i.quoteMint, i.feeTierBps)]!;
  const basket = JSON.stringify(i.basket);
  const [row] = await deps.sql`
    with s as (select data from settings where version = ${i.settingsVersion}),
    l as (
      insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version)
      values (${i.mint}, ${i.pool}, ${i.quoteMint}, ${i.feeTierBps}, ${configKey}, ${i.creator}, 'live', ${i.settingsVersion})
      on conflict (mint) do nothing returning id
    ), b as (
      insert into baskets (launch_id, reward_mint, weight_bps)
      select l.id, x.mint, x."weightBps" from l cross join jsonb_to_recordset(${basket}::text::jsonb) as x(mint text, "weightBps" int)
    ), p as (
      insert into stake_pools (launch_id, backend, max_penalty_bps, spill_account, status)
      select l.id, s.data->>'defaultBackend', (s.data->>'maxPenaltyBps')::int, ${i.spillAccount}, 'pending' from l, s
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
