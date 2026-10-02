import type { SQL } from "bun";
import { Keypair } from "@solana/web3.js";
import type { MeteoraPort, NewConfig } from "../meteora/port";
import { configKeyName } from "../meteora/config";

export type ResolvedConfig = { configKey: string; create?: NewConfig };
export type ConfigFor = (quoteMint: string, feeBps: number) => Promise<ResolvedConfig | null>;
export type ConfigCoin = { mint: string; decimals: number; graduation: number; tradingOnly: boolean };

/** Fixed config keys by `<quote mint>:<fee bps>`, for scripts and tests that create their own. */
export const staticConfigs = (map: Record<string, string>): ConfigFor => async (q, f) => {
  const k = map[configKeyName(q, f)];
  return k ? { configKey: k } : null;
};

/** Whole units to quote base units, exact for whole-number targets. */
export const thresholdOf = (graduation: number, decimals: number): bigint =>
  Number.isInteger(graduation) ? BigInt(graduation) * 10n ** BigInt(decimals) : BigInt(Math.round(graduation * 10 ** decimals));

/** Records config keys from CONFIG_KEYS or config-keys.json as live, with the threshold read from chain. */
export async function seedConfigKeys(sql: SQL, meteora: Pick<MeteoraPort, "configThreshold">, map: Record<string, string>) {
  const entries = Object.entries(map);
  if (entries.length === 0) return 0;
  const known = new Set((await sql`select address from config_keys`).map((r: { address: string }) => r.address));
  let added = 0;
  for (const [name, address] of entries) {
    if (known.has(address)) continue;
    const [quoteMint, fee] = name.split(":");
    const threshold = await meteora.configThreshold(address).catch(() => null);
    if (threshold === null || !quoteMint || !fee) continue;
    const r = await sql`insert into config_keys (quote_mint, fee_bps, threshold, address, status)
      values (${quoteMint}, ${Number(fee)}, ${threshold.toString()}::numeric, ${address}, 'live') on conflict do nothing returning address`;
    added += r.length;
  }
  return added;
}

const select = (sql: SQL, mint: string, fee: number, threshold: bigint) =>
  sql`select address, secret, status, issued_at < now() - interval '2 minutes' as stale from config_keys where quote_mint = ${mint} and fee_bps = ${fee} and threshold = ${threshold.toString()}::numeric`;

/**
 * The config key a launch on (pair, fee) uses at the current graduation target. When none exists yet, the first
 * caller claims a row with a fresh keypair and every caller until it lands gets the same address, so two first
 * launches on a pair race to create one account instead of two. A pending row not handed out for 2 minutes and still
 * not on chain is dropped for a fresh keypair, so a setup transaction that failed or expired never blocks the pair.
 */
export async function resolveConfig(deps: { sql: SQL; meteora: Pick<MeteoraPort, "configState">; keeper: string }, coin: ConfigCoin, feeBps: number): Promise<ResolvedConfig | null> {
  const { sql } = deps;
  if (coin.tradingOnly) {
    const [row] = await sql`select address from config_keys where quote_mint = ${coin.mint} and fee_bps = ${feeBps} and status = 'live' order by created_at limit 1`;
    return row ? { configKey: row.address } : null;
  }
  if (!(coin.graduation > 0)) return null;
  const threshold = thresholdOf(coin.graduation, coin.decimals);
  let [row] = await select(sql, coin.mint, feeBps, threshold);
  if (row?.status === "live") return { configKey: row.address };
  if (row) {
    const st = await deps.meteora.configState(row.address);
    if (st && st.feeClaimer === deps.keeper && st.quoteMint === coin.mint && st.threshold === threshold) {
      await markConfigLive(sql, row.address);
      return { configKey: row.address };
    }
    if (st) {
      // The address exists with other parameters; it is not ours to use.
      console.error(JSON.stringify({ at: new Date().toISOString(), configMismatch: row.address }));
      await sql`delete from config_keys where address = ${row.address} and status = 'pending'`;
      row = undefined;
    } else if (row.stale) {
      await sql`delete from config_keys where address = ${row.address} and status = 'pending' and issued_at < now() - interval '2 minutes'`;
      row = undefined;
    }
  }
  if (!row) {
    const kp = Keypair.generate();
    await sql`insert into config_keys (quote_mint, fee_bps, threshold, address, secret, status)
      values (${coin.mint}, ${feeBps}, ${threshold.toString()}::numeric, ${kp.publicKey.toBase58()}, ${JSON.stringify(Array.from(kp.secretKey))}::text::jsonb, 'pending')
      on conflict do nothing`;
    [row] = await select(sql, coin.mint, feeBps, threshold);
    if (row.status === "live") return { configKey: row.address };
  }
  await sql`update config_keys set issued_at = now() where address = ${row.address} and status = 'pending'`;
  const secret = typeof row.secret === "string" ? JSON.parse(row.secret) : row.secret;
  return {
    configKey: row.address,
    create: {
      config: Keypair.fromSecretKey(Uint8Array.from(secret as number[])), feeBps, keeper: deps.keeper,
      quote: { mint: coin.mint, decimals: coin.decimals, migrationQuoteThreshold: coin.graduation },
    },
  };
}

export const markConfigLive = (sql: SQL, address: string) =>
  sql`update config_keys set status = 'live', secret = null where address = ${address} and status = 'pending'`;
