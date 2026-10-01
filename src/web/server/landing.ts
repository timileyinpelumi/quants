import type { SQL } from "bun";

const SUPPLY = 1_000_000_000;
const DAY = 86_400_000;
const LIST = 6;

export type TokenRow = {
  mint: string; symbol: string; name: string | null; image: string | null; status: string; createdAt: string;
  basket: string[];
  price: number | null; priceUsd: number | null; mcapUsd: number | null; change24h: number; volume24hUsd: number; trades24h: number;
  progress: number | null;
};
export type TradeRow = { signature: string; eventIndex: number; mint: string; symbol: string; side: "buy" | "sell"; valueUsd: number | null; quoteValue: number; quoteMint: string; amount: number; trader: string; at: string };
export type Landing = {
  stats: { launches: number; graduated: number; volume24hUsd: number; volumeAllUsd: number; traders24h: number; stakersUsd: number };
  trending: TokenRow[]; newest: TokenRow[]; soon: TokenRow[]; graduated: TokenRow[]; recent: TradeRow[];
};
export type ExploreSort = "trending" | "mcap" | "new" | "gainers" | "graduating";
export type ExploreFilter = "all" | "live" | "graduated";

async function tokenRows(sql: SQL, now: number): Promise<TokenRow[]> {
  const since = new Date(now - DAY);
  const rows = await sql`
    with last as (
      select distinct on (launch_id) launch_id, price, quote_usd from trades order by launch_id, slot desc, seq desc
    ), ref as (
      select distinct on (launch_id) launch_id, price from trades where block_time <= ${since} order by launch_id, slot desc, seq desc
    ), first as (
      select distinct on (launch_id) launch_id, price from trades order by launch_id, slot, seq
    ), day as (
      select launch_id, coalesce(sum(quote_value * quote_usd), 0) as vol, count(*)::int as n from trades where block_time > ${since} group by 1
    ), curve as (
      select distinct on (launch_id) launch_id, curve_reserve, curve_threshold from trades
      where curve_reserve is not null order by launch_id, slot desc, seq desc
    )
    select l.mint, l.symbol, l.name, l.image, l.status, l.created_at, last.price, last.quote_usd,
      coalesce(ref.price, first.price) as ref_price, coalesce(day.vol, 0) as vol, coalesce(day.n, 0) as n,
      curve.curve_reserve::float8 as reserve, curve.curve_threshold::float8 as threshold,
      coalesce((select json_agg(coalesce(b.symbol, left(b.reward_mint, 4)) order by b.weight_bps desc, b.reward_mint)
                from baskets b where b.launch_id = l.id), '[]') as basket
    from launches l
    left join last on last.launch_id = l.id left join ref on ref.launch_id = l.id left join first on first.launch_id = l.id
    left join day on day.launch_id = l.id left join curve on curve.launch_id = l.id`;
  return rows.map((r: any) => {
    const priceUsd = r.price === null || r.quote_usd === null ? null : r.price * r.quote_usd;
    return {
      mint: r.mint, symbol: r.symbol ?? r.mint.slice(0, 4), name: r.name, image: r.image, status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      basket: typeof r.basket === "string" ? JSON.parse(r.basket) : r.basket,
      price: r.price, priceUsd, mcapUsd: priceUsd === null ? null : priceUsd * SUPPLY,
      change24h: r.price !== null && r.ref_price ? (r.price / r.ref_price - 1) * 100 : 0,
      volume24hUsd: Number(r.vol), trades24h: r.n,
      progress: r.status === "live" && r.threshold ? Math.min(100, Math.round((r.reserve / r.threshold) * 100)) : null,
    };
  });
}

const byNew = (a: TokenRow, b: TokenRow) => b.createdAt.localeCompare(a.createdAt);
const byVolume = (a: TokenRow, b: TokenRow) => b.volume24hUsd - a.volume24hUsd || byNew(a, b);

export async function landing(sql: SQL, now = Date.now()): Promise<Landing> {
  const since = new Date(now - DAY);
  const [stats] = await sql`
    with px as (
      select distinct on (launch_id) launch_id, quote_usd, quote_value / nullif(quote_amount, 0)::float8 as unit
      from trades where quote_usd is not null order by launch_id, slot desc, seq desc
    )
    select (select count(*)::int from launches) as launches,
      (select count(*)::int from launches where status = 'graduated') as graduated,
      (select coalesce(sum(quote_value * quote_usd), 0) from trades where block_time > ${since}) as v24,
      (select coalesce(sum(quote_value * quote_usd), 0) from trades) as vall,
      (select count(distinct trader)::int from trades where block_time > ${since}) as traders,
      (select coalesce(sum((d.detail->>'amount')::float8 * (s.data->'split'->>'basketBps')::float8 / 10000 * px.unit * px.quote_usd), 0)
         from distributions d join settings s on s.version = d.settings_version join px on px.launch_id = d.launch_id
         where d.kind = 'split' and d.status = 'confirmed') as stakers`;
  const tokens = await tokenRows(sql, now);
  const recent = await recentTrades(sql, null, 8);
  return {
    stats: {
      launches: stats.launches, graduated: stats.graduated, volume24hUsd: Number(stats.v24), volumeAllUsd: Number(stats.vall),
      traders24h: stats.traders, stakersUsd: Number(stats.stakers),
    },
    trending: tokens.filter((t) => t.volume24hUsd > 0).sort(byVolume).slice(0, LIST),
    newest: [...tokens].sort(byNew).slice(0, LIST),
    soon: tokens.filter((t) => t.progress !== null).sort((a, b) => b.progress! - a.progress! || byNew(a, b)).slice(0, LIST),
    graduated: tokens.filter((t) => t.status === "graduated").sort(byVolume).slice(0, LIST),
    recent,
  };
}

export async function exploreTokens(sql: SQL, o: { sort: ExploreSort; filter?: ExploreFilter; q?: string }, now = Date.now()): Promise<TokenRow[]> {
  const q = o.q?.trim().toLowerCase() ?? "";
  let list = (await tokenRows(sql, now))
    .filter((t) => o.filter === "live" ? t.status === "live" : o.filter === "graduated" ? t.status === "graduated" : true)
    .filter((t) => !q || t.mint.toLowerCase() === q || t.symbol.toLowerCase().includes(q) || (t.name ?? "").toLowerCase().includes(q));
  if (o.sort === "graduating") list = list.filter((t) => t.progress !== null);
  const cmp: Record<ExploreSort, (a: TokenRow, b: TokenRow) => number> = {
    trending: byVolume,
    mcap: (a, b) => (b.mcapUsd ?? -1) - (a.mcapUsd ?? -1) || byNew(a, b),
    new: byNew,
    gainers: (a, b) => b.change24h - a.change24h || byVolume(a, b),
    graduating: (a, b) => b.progress! - a.progress! || byNew(a, b),
  };
  return list.sort(cmp[o.sort]).slice(0, 100);
}

const BASE_UNIT = 1e-6; // launched tokens have 6 decimals

export async function recentTrades(sql: SQL, launchId: number | null, limit: number): Promise<TradeRow[]> {
  const rows = await sql`
    select t.signature, t.event_index, l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, t.side, t.quote_value * t.quote_usd as value_usd,
      t.quote_value, l.quote_mint, t.base_amount::float8 as base, t.trader, t.block_time
    from trades t join launches l on l.id = t.launch_id
    where (${launchId}::bigint is null or t.launch_id = ${launchId}::bigint)
    order by t.slot desc, t.seq desc limit ${limit}`;
  return rows.map((r: any) => ({
    signature: r.signature, eventIndex: r.event_index, mint: r.mint, symbol: r.symbol, side: r.side, valueUsd: r.value_usd,
    quoteValue: r.quote_value, quoteMint: r.quote_mint, amount: r.base * BASE_UNIT, trader: r.trader, at: new Date(r.block_time).toISOString(),
  }));
}
