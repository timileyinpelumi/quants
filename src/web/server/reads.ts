import type { SQL } from "bun";
import type { WebContext } from "./context";

export interface LaunchListItem {
  mint: string; name: string | null; symbol: string | null; image: string | null; pool: string; quoteMint: string;
  feeTierBps: number; status: "live" | "graduated"; createdAt: string; basket: { mint: string; symbol: string | null }[]; burned: string;
}

export async function listLaunches(sql: SQL, opts: { graduated?: boolean; limit?: number; mint?: string }): Promise<LaunchListItem[]> {
  const graduated = opts.graduated ?? null;
  const mint = opts.mint ?? null;
  const rows = await sql`
    select l.mint, l.name, l.symbol, l.image, l.pool, l.quote_mint, l.fee_tier_bps, l.status, l.created_at,
      coalesce((select json_agg(json_build_object('mint', b.reward_mint, 'symbol', b.symbol) order by b.weight_bps desc, b.reward_mint)
                from baskets b where b.launch_id = l.id), '[]') as basket,
      coalesce((select sum((d.detail->>'amount')::numeric) from distributions d
                where d.launch_id = l.id and d.kind = 'burn' and d.status = 'confirmed'), 0)::text as burned
    from launches l
    where (${graduated}::boolean is null or (l.status = 'graduated') = ${graduated}::boolean)
      and (${mint}::text is null or l.mint = ${mint}::text)
    order by l.id desc
    limit ${opts.limit ?? 100}`;
  return rows.map((r: any) => ({
    mint: r.mint, name: r.name, symbol: r.symbol, image: r.image, pool: r.pool, quoteMint: r.quote_mint, feeTierBps: r.fee_tier_bps,
    status: r.status, createdAt: new Date(r.created_at).toISOString(), basket: typeof r.basket === "string" ? JSON.parse(r.basket) : r.basket, burned: r.burned,
  }));
}

export interface LaunchDetail {
  launch: LaunchListItem & { creator: string; dammPool: string | null };
  basket: { mint: string; symbol: string | null; decimals: number | null; weightBps: number; paidOut: string }[];
  tiers: { tierId: string; lockSeconds: number; multiplierBps: number; farm: string | null; staked: string; sharePct: number }[];
  burned: string;
  maxPenaltyBps: number;
  stakeReady: boolean;
  curve: { quoteReserve: string; threshold: string; migrated: boolean };
}

export async function launchDetail(ctx: WebContext, mint: string): Promise<LaunchDetail | null> {
  const [row] = await ctx.sql`select id, creator, damm_pool from launches where mint = ${mint}`;
  if (!row) return null;
  const [item] = await listLaunches(ctx.sql, { mint, limit: 1 });
  const basket = await ctx.sql`
    select b.reward_mint, b.symbol, b.decimals, b.weight_bps,
      coalesce((select sum((d.detail->>'amount')::numeric) from distributions d
                where d.launch_id = b.launch_id and d.kind = 'fund' and d.status = 'confirmed' and d.detail->>'rewardMint' = b.reward_mint), 0)::text as paid
    from baskets b where b.launch_id = ${row.id} order by b.weight_bps desc, b.reward_mint`;
  const [pool] = await ctx.sql`select status, max_penalty_bps from stake_pools where launch_id = ${row.id}`;
  const tierRows = await ctx.sql`select tier_id, lock_seconds, multiplier_bps, farm from stake_tiers where launch_id = ${row.id} order by lock_seconds`;
  const staked = await Promise.all(tierRows.map((t: any) => (t.farm ? ctx.staking.totalStaked(t.farm) : Promise.resolve(0n))));
  const weights = tierRows.map((t: any, i: number) => staked[i]! * BigInt(t.multiplier_bps));
  const total = weights.reduce((a: bigint, b: bigint) => a + b, 0n);
  const progress = await ctx.meteora.curveProgress(item!.pool).catch(() => ({ quoteReserve: 0n, threshold: 0n, migrated: item!.status === "graduated" }));
  return {
    launch: { ...item!, creator: row.creator, dammPool: row.damm_pool },
    basket: basket.map((b: any) => ({ mint: b.reward_mint, symbol: b.symbol, decimals: b.decimals, weightBps: b.weight_bps, paidOut: b.paid })),
    tiers: tierRows.map((t: any, i: number) => ({
      tierId: t.tier_id, lockSeconds: t.lock_seconds, multiplierBps: t.multiplier_bps, farm: t.farm, staked: staked[i]!.toString(),
      sharePct: total === 0n ? 0 : Math.round(Number((weights[i]! * 10_000n) / total) / 100),
    })),
    burned: item!.burned,
    maxPenaltyBps: pool?.max_penalty_bps ?? 0,
    stakeReady: pool?.status === "ready",
    curve: { quoteReserve: progress.quoteReserve.toString(), threshold: progress.threshold.toString(), migrated: progress.migrated },
  };
}
