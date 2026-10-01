import type { SQL } from "bun";

export type StakerToken = { mint: string; symbol: string; image: string | null; setAsideUsd: number; payments: number; basket: string[] };
export type RewardPayment = { id: number; mint: string; symbol: string; reward: string; rewardMint: string; amount: number; signature: string; at: string };
export type RewardsOverview = {
  stats: { setAsideUsd: number; payments: number; payingTokens: number; burns: number };
  top: StakerToken[];
  topNext: number | null;
  recent: RewardPayment[];
  recentNext: string | null;
};

// the basket share of every fee split, valued at the latest USD price of its quote token
const aside = (sql: SQL) => sql`
  select d.launch_id, sum((d.detail->>'amount')::float8 * (s.data->'split'->>'basketBps')::float8 / 10000 * px.unit * px.quote_usd) as usd
  from distributions d join settings s on s.version = d.settings_version
  join lateral (
    select quote_usd, quote_value / nullif(quote_amount, 0)::float8 as unit from trades
    where launch_id = d.launch_id and quote_usd is not null order by slot desc, seq desc limit 1
  ) px on true
  where d.kind = 'split' and d.status = 'confirmed' group by 1`;

export async function stakerTokens(sql: SQL, limit: number, offset = 0): Promise<StakerToken[]> {
  const rows = await sql`
    with aside as (${aside(sql)}), paid as (
      select launch_id, count(*)::int as n from distributions where kind = 'fund' and status = 'confirmed' group by 1
    )
    select l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, l.image, coalesce(aside.usd, 0) as usd, coalesce(paid.n, 0) as n,
      coalesce((select json_agg(coalesce(b.symbol, left(b.reward_mint, 4)) order by b.weight_bps desc) from baskets b where b.launch_id = l.id), '[]') as basket
    from launches l left join aside on aside.launch_id = l.id left join paid on paid.launch_id = l.id
    where aside.usd is not null or paid.n is not null
    order by coalesce(aside.usd, 0) desc, l.created_at desc, l.id desc
    limit ${limit} offset ${offset}`;
  return rows.map((r: any) => ({
    mint: r.mint, symbol: r.symbol, image: r.image, setAsideUsd: Number(r.usd), payments: r.n,
    basket: typeof r.basket === "string" ? JSON.parse(r.basket) : r.basket,
  }));
}

/** Newest first; `before` is the id of the last payment already shown. */
export async function rewardPayments(sql: SQL, limit: number, before: number | null = null): Promise<RewardPayment[]> {
  const rows = await sql`
    select d.id, l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, d.detail->>'rewardMint' as reward_mint, (d.detail->>'amount')::float8 as amount,
      d.signature, d.updated_at, b.symbol as reward, b.decimals
    from distributions d join launches l on l.id = d.launch_id
    left join baskets b on b.launch_id = d.launch_id and b.reward_mint = d.detail->>'rewardMint'
    where d.kind = 'fund' and d.status = 'confirmed' and d.signature is not null
      and (${before}::bigint is null or (d.updated_at, d.id) < (select updated_at, id from distributions where id = ${before}::bigint))
    order by d.updated_at desc, d.id desc limit ${limit}`;
  return rows.map((r: any) => ({
    id: Number(r.id), mint: r.mint, symbol: r.symbol, reward: r.reward ?? r.reward_mint.slice(0, 4), rewardMint: r.reward_mint,
    amount: r.amount / 10 ** (r.decimals ?? 0), signature: r.signature, at: new Date(r.updated_at).toISOString(),
  }));
}

export async function rewardsOverview(sql: SQL, limit = 20): Promise<RewardsOverview> {
  const [[total], [counts], top, recent] = await Promise.all([
    sql`select coalesce(sum(usd), 0) as usd from (${aside(sql)}) a`,
    sql`select count(*) filter (where kind = 'fund')::int as payments, count(distinct launch_id) filter (where kind = 'fund')::int as paying,
      count(*) filter (where kind = 'burn')::int as burns from distributions where status = 'confirmed'`,
    stakerTokens(sql, limit + 1),
    rewardPayments(sql, limit + 1),
  ]);
  return {
    stats: { setAsideUsd: Number(total.usd), payments: counts.payments, payingTokens: counts.paying, burns: counts.burns },
    top: top.slice(0, limit),
    topNext: top.length > limit ? limit : null,
    recent: recent.slice(0, limit),
    recentNext: recent.length > limit ? String(recent[limit - 1]!.id) : null,
  };
}
