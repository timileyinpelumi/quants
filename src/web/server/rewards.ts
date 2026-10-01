import type { SQL } from "bun";

export type RewardsOverview = {
  stats: { setAsideUsd: number; payments: number; payingTokens: number; burns: number };
  top: { mint: string; symbol: string; image: string | null; setAsideUsd: number; payments: number; basket: string[] }[];
  recent: { mint: string; symbol: string; reward: string; rewardMint: string; amount: number; signature: string; at: string }[];
};

export async function rewardsOverview(sql: SQL): Promise<RewardsOverview> {
  // the basket share of every fee split, valued at the latest USD price of its quote token
  const perLaunch = await sql`
    with px as (
      select distinct on (launch_id) launch_id, quote_usd, quote_value / nullif(quote_amount, 0)::float8 as unit
      from trades where quote_usd is not null order by launch_id, slot desc, seq desc
    ), aside as (
      select d.launch_id, sum((d.detail->>'amount')::float8 * (s.data->'split'->>'basketBps')::float8 / 10000 * px.unit * px.quote_usd) as usd
      from distributions d join settings s on s.version = d.settings_version join px on px.launch_id = d.launch_id
      where d.kind = 'split' and d.status = 'confirmed' group by 1
    ), paid as (
      select launch_id, count(*)::int as n from distributions where kind = 'fund' and status = 'confirmed' group by 1
    )
    select l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, l.image, coalesce(aside.usd, 0) as usd, coalesce(paid.n, 0) as n,
      coalesce((select json_agg(coalesce(b.symbol, left(b.reward_mint, 4)) order by b.weight_bps desc) from baskets b where b.launch_id = l.id), '[]') as basket
    from launches l left join aside on aside.launch_id = l.id left join paid on paid.launch_id = l.id
    where aside.usd is not null or paid.n is not null`;
  const [counts] = await sql`select count(*) filter (where kind = 'fund')::int as payments, count(distinct launch_id) filter (where kind = 'fund')::int as paying,
    count(*) filter (where kind = 'burn')::int as burns from distributions where status = 'confirmed'`;
  const recent = await sql`
    select l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, d.detail->>'rewardMint' as reward_mint, (d.detail->>'amount')::float8 as amount,
      d.signature, d.updated_at, b.symbol as reward, b.decimals
    from distributions d join launches l on l.id = d.launch_id
    left join baskets b on b.launch_id = d.launch_id and b.reward_mint = d.detail->>'rewardMint'
    where d.kind = 'fund' and d.status = 'confirmed' and d.signature is not null
    order by d.updated_at desc limit 30`;
  const top = perLaunch.map((r: any) => ({
    mint: r.mint, symbol: r.symbol, image: r.image, setAsideUsd: Number(r.usd), payments: r.n,
    basket: typeof r.basket === "string" ? JSON.parse(r.basket) : r.basket,
  })).sort((a: any, b: any) => b.setAsideUsd - a.setAsideUsd).slice(0, 20);
  return {
    stats: { setAsideUsd: perLaunch.reduce((s: number, r: any) => s + Number(r.usd), 0), payments: counts.payments, payingTokens: counts.paying, burns: counts.burns },
    top,
    recent: recent.map((r: any) => ({
      mint: r.mint, symbol: r.symbol, reward: r.reward ?? r.reward_mint.slice(0, 4), rewardMint: r.reward_mint,
      amount: r.amount / 10 ** (r.decimals ?? 0), signature: r.signature, at: new Date(r.updated_at).toISOString(),
    })),
  };
}
