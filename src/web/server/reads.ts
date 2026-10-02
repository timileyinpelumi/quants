import type { SQL } from "bun";
import type { WebContext } from "./context";
import { opensAt } from "@/domain/launch-cost";
import { splitFees } from "@/domain/weights";

export type StakingOpens = { percent: number; rentLamports: string; neededLamports: string | null };
type PoolRow = { status: string; rent_lamports: string | number | bigint | null; basket_value_lamports: string | number | bigint } | undefined;

/** How close a launch is to opening staking; null once its farms are ready or when it has no stake pool. */
export function stakingOpens(p: PoolRow): StakingOpens | null {
  if (!p || p.status === "ready") return null;
  if (p.rent_lamports == null) return { percent: 0, rentLamports: "0", neededLamports: null };
  const rent = BigInt(p.rent_lamports), value = BigInt(p.basket_value_lamports);
  return { percent: opensAt({ valueLamports: value, rentLamports: rent }), rentLamports: rent.toString(), neededLamports: (value >= rent ? 0n : rent - value).toString() };
}

export interface LaunchListItem {
  mint: string; name: string | null; symbol: string | null; image: string | null; pool: string; quoteMint: string;
  feeTierBps: number; status: "live" | "graduated"; createdAt: string; basket: { mint: string; symbol: string | null }[]; burned: string;
  tradingOnly: boolean;
}

export async function listLaunches(sql: SQL, opts: { graduated?: boolean; limit?: number; offset?: number; mint?: string }): Promise<LaunchListItem[]> {
  const graduated = opts.graduated ?? null;
  const mint = opts.mint ?? null;
  const rows = await sql`
    select l.mint, l.name, l.symbol, l.image, l.pool, l.quote_mint, l.fee_tier_bps, l.status, l.created_at, l.trading_only,
      coalesce((select json_agg(json_build_object('mint', b.reward_mint, 'symbol', b.symbol) order by b.weight_bps desc, b.reward_mint)
                from baskets b where b.launch_id = l.id), '[]') as basket,
      coalesce((select sum((d.detail->>'amount')::numeric) from distributions d
                where d.launch_id = l.id and d.kind = 'burn' and d.status = 'confirmed'), 0)::text as burned
    from launches l
    where (${graduated}::boolean is null or (l.status = 'graduated') = ${graduated}::boolean)
      and (${mint}::text is null or l.mint = ${mint}::text)
    order by l.id desc
    limit ${opts.limit ?? 100} offset ${opts.offset ?? 0}`;
  return rows.map((r: any) => ({
    mint: r.mint, name: r.name, symbol: r.symbol, image: r.image, pool: r.pool, quoteMint: r.quote_mint, feeTierBps: r.fee_tier_bps,
    status: r.status, createdAt: new Date(r.created_at).toISOString(), basket: typeof r.basket === "string" ? JSON.parse(r.basket) : r.basket, burned: r.burned,
    tradingOnly: r.trading_only === true,
  }));
}

export interface LaunchDetail {
  launch: LaunchListItem & { id: number; creator: string; dammPool: string | null };
  basket: { mint: string; symbol: string | null; decimals: number | null; weightBps: number; paidOut: string }[];
  tiers: { tierId: string; lockSeconds: number; multiplierBps: number; farm: string | null; staked: string | null; sharePct: number }[];
  burned: string;
  maxPenaltyBps: number;
  stakeReady: boolean;
  stakingOpens: StakingOpens | null;
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
  const [pool] = await ctx.sql`select status, max_penalty_bps, rent_lamports, basket_value_lamports from stake_pools where launch_id = ${row.id}`;
  const tierRows = await ctx.sql`select tier_id, lock_seconds, multiplier_bps, farm from stake_tiers where launch_id = ${row.id} order by lock_seconds`;
  const staked: (bigint | null)[] = await Promise.all(tierRows.map((t: any) => (t.farm ? ctx.staking.totalStaked(t.farm).catch(() => null) : Promise.resolve(0n))));
  const weights = tierRows.map((t: any, i: number) => (staked[i] ?? 0n) * BigInt(t.multiplier_bps));
  const total = weights.reduce((a: bigint, b: bigint) => a + b, 0n);
  const progress = await ctx.meteora.curveProgress(item!.pool).catch(() => ({ quoteReserve: 0n, threshold: 0n, migrated: item!.status === "graduated" }));
  return {
    launch: { ...item!, id: Number(row.id), creator: row.creator, dammPool: row.damm_pool },
    basket: basket.map((b: any) => ({ mint: b.reward_mint, symbol: b.symbol, decimals: b.decimals, weightBps: b.weight_bps, paidOut: b.paid })),
    tiers: tierRows.map((t: any, i: number) => ({
      tierId: t.tier_id, lockSeconds: t.lock_seconds, multiplierBps: t.multiplier_bps, farm: t.farm, staked: staked[i] === null ? null : staked[i]!.toString(),
      sharePct: total === 0n ? 0 : Math.round(Number((weights[i]! * 10_000n) / total) / 100),
    })),
    burned: item!.burned,
    maxPenaltyBps: pool?.max_penalty_bps ?? 0,
    stakeReady: pool?.status === "ready",
    stakingOpens: stakingOpens(pool),
    curve: { quoteReserve: progress.quoteReserve.toString(), threshold: progress.threshold.toString(), migrated: progress.migrated },
  };
}

/**
 * All in the launch's quote token, base units. `earned` is what reached quants after Meteora's cut, including fees not yet split.
 * `lp`: fees from the graduated pool's locked LP position, which all go to the platform; `platform` includes them.
 */
export type FeeSummary = { earned: string; stakers: string; creator: string; platform: string; lp: string; meteora: string; held: string; lastPaidAt: string | null };

export async function feeSummary(sql: SQL, launchId: number): Promise<FeeSummary> {
  const splits = await sql`
    select d.detail->>'amount' as amount, (d.detail->>'lp') = 'true' as lp, s.data->'split' as split
    from distributions d join settings s on s.version = d.settings_version
    where d.launch_id = ${launchId} and d.kind = 'split' and d.status = 'confirmed'`;
  let stakers = 0n, creator = 0n, platform = 0n, lp = 0n;
  for (const r of splits) {
    if (r.lp) { lp += BigInt(r.amount ?? "0"); continue; }
    const split = typeof r.split === "string" ? JSON.parse(r.split) : r.split;
    const f = splitFees(BigInt(r.amount ?? "0"), split);
    stakers += f.basket; creator += f.creator; platform += f.platform;
  }
  const [e] = await sql`
    select coalesce(sum(e.amount) filter (where e.bucket = 'unsplit'), 0)::text as unsplit,
      coalesce(sum(e.amount) filter (where e.bucket = 'lp'), 0)::text as lp_unsplit,
      coalesce(sum(e.amount) filter (where e.bucket = 'basket'), 0)::text as held,
      (select max(updated_at) from distributions where launch_id = ${launchId} and kind = 'fund' and status = 'confirmed') as last_paid
    from escrow e join launches l on l.id = e.launch_id and e.mint = l.quote_mint where e.launch_id = ${launchId}`;
  lp += BigInt(e?.lp_unsplit ?? "0");
  platform += lp;
  const earned = stakers + creator + platform + BigInt(e?.unsplit ?? "0");
  return {
    earned: earned.toString(), stakers: stakers.toString(), creator: creator.toString(), platform: platform.toString(), lp: lp.toString(),
    meteora: ((earned * 20n) / 80n).toString(), held: e?.held ?? "0", lastPaidAt: e?.last_paid ? new Date(e.last_paid).toISOString() : null,
  };
}
