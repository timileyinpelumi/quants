import type { SQL } from "bun";

export interface LaunchRow {
  id: number; mint: string; pool: string; quoteMint: string; creator: string; configKey: string; status: "live" | "graduated";
  dammPool: string | null; dammPosition: string | null; dammPositionNftAccount: string | null; tradingOnly: boolean;
}

export async function loadLaunches(sql: SQL): Promise<LaunchRow[]> {
  const rows = await sql`select * from launches order by id`;
  return rows.map((r: any) => ({
    id: Number(r.id), mint: r.mint, pool: r.pool, quoteMint: r.quote_mint, creator: r.creator, configKey: r.config_key,
    status: r.status, dammPool: r.damm_pool, dammPosition: r.damm_position, dammPositionNftAccount: r.damm_position_nft_account,
    tradingOnly: r.trading_only === true,
  }));
}
