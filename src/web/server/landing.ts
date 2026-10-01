import type { SQL } from "bun";
import { quoteCoin } from "@/domain/quotes";
import { stakingOpens } from "./reads";

export type Icons = (mints: string[]) => Promise<Record<string, string | null>>;
export type CoinRef = { mint: string; symbol: string; icon: string | null };

const SUPPLY = 1_000_000_000;
const DAY = 86_400_000;
const LIST = 6;

export type TokenRow = {
  mint: string; symbol: string; name: string | null; image: string | null; status: string; createdAt: string;
  basket: CoinRef[];
  quote: CoinRef;
  price: number | null; priceUsd: number | null; mcapUsd: number | null; change24h: number; volume24hUsd: number; trades24h: number;
  progress: number | null;
  /** Percent of the way to opening staking; null once open. */
  stakingPct: number | null;
};
export type TradeRow = {
  signature: string; eventIndex: number; mint: string; symbol: string; side: "buy" | "sell"; valueUsd: number | null; quoteValue: number; quoteMint: string;
  amount: number; trader: string; at: string; slot: number; seq: number;
};
export type Landing = {
  stats: { launches: number; graduated: number; volume24hUsd: number; volumeAllUsd: number; traders24h: number; stakersUsd: number };
  trending: TokenRow[]; newest: TokenRow[]; soon: TokenRow[]; graduated: TokenRow[]; recent: TradeRow[];
};
export type ExploreSort = "trending" | "mcap" | "new" | "gainers" | "graduating";
export type ExploreFilter = "all" | "live" | "graduated";
export type TokenQuery = { sort: ExploreSort; filter?: ExploreFilter; q?: string; traded?: boolean; limit?: number; offset?: number };

export const EXPLORE_SORTS = ["trending", "mcap", "new", "gainers", "graduating"] as const satisfies readonly ExploreSort[];
export const EXPLORE_FILTERS = ["all", "live", "graduated"] as const satisfies readonly ExploreFilter[];

// Fixed strings only: these are spliced into the query text.
const ORDER: Record<ExploreSort, string> = {
  trending: "vol desc,",
  mcap: "mcap desc nulls last,",
  new: "",
  gainers: "change desc, vol desc,",
  graduating: "progress desc,",
};

type RawToken = {
  mint: string; symbol: string; name: string | null; image: string | null; status: string; created_at: Date; quote_mint: string;
  price: number | null; quote_usd: number | null; vol: number; n: number; change: number; progress: number | null;
  pool_status: string | null; rent_lamports: string | null; basket_value_lamports: string | null; basket: string | { mint: string; symbol: string }[];
};

async function tokenQuery(sql: SQL, o: TokenQuery, now: number): Promise<RawToken[]> {
  const since = new Date(now - DAY);
  const q = o.q?.trim().toLowerCase() ?? "";
  const status = o.filter === "live" ? "live" : o.filter === "graduated" ? "graduated" : null;
  return sql`
    select * from (
      select l.id, l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, l.name, l.image, l.status, l.created_at, l.quote_mint,
        last.price, last.quote_usd, d.vol, d.n, sp.status as pool_status, sp.rent_lamports, sp.basket_value_lamports,
        case when last.price is not null and coalesce(ref.price, first.price) <> 0 then (last.price / coalesce(ref.price, first.price) - 1) * 100 else 0 end as change,
        last.price * last.quote_usd * ${SUPPLY} as mcap,
        case when l.status = 'live' and curve.threshold <> 0 then least(100, round((curve.reserve / curve.threshold * 100)::numeric))::int end as progress,
        coalesce((select json_agg(json_build_object('mint', b.reward_mint, 'symbol', coalesce(b.symbol, left(b.reward_mint, 4))) order by b.weight_bps desc, b.reward_mint)
                  from baskets b where b.launch_id = l.id), '[]') as basket
      from launches l
      left join stake_pools sp on sp.launch_id = l.id
      left join lateral (select price, quote_usd from trades where launch_id = l.id order by slot desc, seq desc limit 1) last on true
      left join lateral (select price from trades where launch_id = l.id and block_time <= ${since} order by slot desc, seq desc limit 1) ref on true
      left join lateral (select price from trades where launch_id = l.id order by slot, seq limit 1) first on true
      cross join lateral (select coalesce(sum(quote_value * quote_usd), 0)::float8 as vol, count(*)::int as n from trades where launch_id = l.id and block_time > ${since}) d
      left join lateral (select curve_reserve::float8 as reserve, curve_threshold::float8 as threshold from trades
                         where launch_id = l.id and curve_reserve is not null order by slot desc, seq desc limit 1) curve on true
      where (${status}::text is null or l.status = ${status}::text)
        and (${q} = '' or lower(l.mint) = ${q} or strpos(lower(coalesce(l.symbol, left(l.mint, 4))), ${q}) > 0 or strpos(lower(coalesce(l.name, '')), ${q}) > 0)
    ) t
    where (${o.sort !== "graduating"} or progress is not null) and (${!o.traded} or vol > 0)
    order by ${sql.unsafe(ORDER[o.sort])} created_at desc, id desc
    limit ${o.limit ?? 30} offset ${o.offset ?? 0}`;
}

async function toTokenRows(rows: RawToken[], icons?: Icons): Promise<TokenRow[]> {
  const baskets = rows.map((r) => (typeof r.basket === "string" ? JSON.parse(r.basket) : r.basket) as { mint: string; symbol: string }[]);
  const allMints = [...new Set([...baskets.flat().map((b) => b.mint), ...rows.map((r) => r.quote_mint)])];
  const icon = icons && allMints.length ? await icons(allMints) : {};
  return rows.map((r, i) => {
    const priceUsd = r.price === null || r.quote_usd === null ? null : r.price * r.quote_usd;
    return {
      mint: r.mint, symbol: r.symbol, name: r.name, image: r.image, status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      basket: baskets[i]!.map((b) => ({ ...b, icon: icon[b.mint] ?? null })),
      quote: { mint: r.quote_mint, symbol: quoteCoin(r.quote_mint)?.symbol ?? r.quote_mint.slice(0, 4), icon: icon[r.quote_mint] ?? null },
      price: r.price, priceUsd, mcapUsd: priceUsd === null ? null : priceUsd * SUPPLY,
      change24h: r.change, volume24hUsd: Number(r.vol), trades24h: r.n, progress: r.progress,
      stakingPct: r.pool_status ? stakingOpens({ status: r.pool_status, rent_lamports: r.rent_lamports, basket_value_lamports: r.basket_value_lamports ?? 0 })?.percent ?? null : null,
    };
  });
}

export async function landing(sql: SQL, now = Date.now(), icons?: Icons): Promise<Landing> {
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
  const lists = await Promise.all([
    tokenQuery(sql, { sort: "trending", traded: true, limit: LIST }, now),
    tokenQuery(sql, { sort: "new", limit: LIST }, now),
    tokenQuery(sql, { sort: "graduating", limit: LIST }, now),
    tokenQuery(sql, { sort: "trending", filter: "graduated", limit: LIST }, now),
  ]);
  const all = await toTokenRows(lists.flat(), icons);
  let at = 0;
  const [trending, newest, soon, graduated] = lists.map((l) => all.slice(at, (at += l.length)));
  const recent = await recentTrades(sql, null, 8);
  return {
    stats: {
      launches: stats.launches, graduated: stats.graduated, volume24hUsd: Number(stats.v24), volumeAllUsd: Number(stats.vall),
      traders24h: stats.traders, stakersUsd: Number(stats.stakers),
    },
    trending: trending!, newest: newest!, soon: soon!, graduated: graduated!, recent,
  };
}

export async function exploreTokens(sql: SQL, o: TokenQuery, now = Date.now(), icons?: Icons): Promise<TokenRow[]> {
  return toTokenRows(await tokenQuery(sql, o, now), icons);
}

const BASE_UNIT = 1e-6; // launched tokens have 6 decimals

export type TradeCursor = { slot: number; seq: number };
export const tradeCursor = (t: TradeCursor) => `${t.slot}:${t.seq}`;
export function parseTradeCursor(s: string): TradeCursor | null {
  const m = /^(\d{1,15}):(\d{1,15})$/.exec(s);
  return m ? { slot: Number(m[1]), seq: Number(m[2]) } : null;
}

/** Newest first; with `before`, only trades older than that cursor. */
export async function recentTrades(sql: SQL, launchId: number | null, limit: number, before: TradeCursor | null = null): Promise<TradeRow[]> {
  const bSlot = before ? String(before.slot) : null;
  const bSeq = before ? String(before.seq) : null;
  const rows = await sql`
    select t.signature, t.event_index, l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, t.side, t.quote_value * t.quote_usd as value_usd,
      t.quote_value, l.quote_mint, t.base_amount::float8 as base, t.trader, t.block_time, t.slot::float8 as slot, t.seq::float8 as seq
    from trades t join launches l on l.id = t.launch_id
    where (${launchId}::bigint is null or t.launch_id = ${launchId}::bigint)
      and (${bSlot}::bigint is null or (t.slot, t.seq) < (${bSlot}::bigint, ${bSeq}::bigint))
    order by t.slot desc, t.seq desc limit ${limit}`;
  return rows.map((r: any) => ({
    signature: r.signature, eventIndex: r.event_index, mint: r.mint, symbol: r.symbol, side: r.side, valueUsd: r.value_usd,
    quoteValue: r.quote_value, quoteMint: r.quote_mint, amount: r.base * BASE_UNIT, trader: r.trader, at: new Date(r.block_time).toISOString(),
    slot: r.slot, seq: r.seq,
  }));
}
