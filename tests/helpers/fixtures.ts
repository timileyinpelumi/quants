import type { SQL } from "bun";

export async function insertLaunch(sql: SQL, over: Partial<{ mint: string; pool: string; quote_mint: string; status: string; trading_only: boolean }> = {}) {
  const n = crypto.randomUUID().slice(0, 8);
  const [r] = await sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, trading_only)
    values (${over.mint ?? `mint-${n}`}, ${over.pool ?? `pool-${n}`}, ${over.quote_mint ?? "So11111111111111111111111111111111111111112"},
            200, 'cfg', 'creator-wallet', ${over.status ?? "live"}, 1, ${over.trading_only ?? false}) returning id`;
  return Number(r.id);
}
