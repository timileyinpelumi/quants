import type { SQL } from "bun";

const SUPPLY = 1_000_000_000;
const DAY = 86_400_000;
const LIST = 5;

export type TokenRow = {
  mint: string; symbol: string; name: string | null; image: string | null; status: string; createdAt: string;
  price: number | null; priceUsd: number | null; mcapUsd: number | null; change24h: number; volume24hUsd: number; progress: number | null;
};
export type TradeRow = { signature: string; eventIndex: number; mint: string; symbol: string; side: "buy" | "sell"; valueUsd: number | null; trader: string; at: string };
export type Landing = {
  stats: { launches: number; graduated: number; volume24hUsd: number; volumeAllUsd: number; traders24h: number };
  biggest: TokenRow[]; gainers: TokenRow[]; newest: TokenRow[]; closest: TokenRow[]; recent: TradeRow[];
};

export async function landing(sql: SQL, now = Date.now()): Promise<Landing> {
  const since = new Date(now - DAY);
  const [stats] = await sql`
    select (select count(*)::int from launches) as launches,
      (select count(*)::int from launches where status = 'graduated') as graduated,
      (select coalesce(sum(quote_value * quote_usd), 0) from trades where block_time > ${since}) as v24,
      (select coalesce(sum(quote_value * quote_usd), 0) from trades) as vall,
      (select count(distinct trader)::int from trades where block_time > ${since}) as traders`;
  const rows = await sql`
    with last as (
      select distinct on (launch_id) launch_id, price, quote_usd from trades order by launch_id, slot desc, seq desc
    ), ref as (
      select distinct on (launch_id) launch_id, price from trades where block_time <= ${since} order by launch_id, slot desc, seq desc
    ), first as (
      select distinct on (launch_id) launch_id, price from trades order by launch_id, slot, seq
    ), day as (
      select launch_id, coalesce(sum(quote_value * quote_usd), 0) as vol from trades where block_time > ${since} group by 1
    ), curve as (
      select distinct on (launch_id) launch_id, curve_reserve, curve_threshold from trades
      where curve_reserve is not null order by launch_id, slot desc, seq desc
    )
    select l.mint, l.symbol, l.name, l.image, l.status, l.created_at, last.price, last.quote_usd,
      coalesce(ref.price, first.price) as ref_price, coalesce(day.vol, 0) as vol,
      curve.curve_reserve::float8 as reserve, curve.curve_threshold::float8 as threshold
    from launches l
    left join last on last.launch_id = l.id left join ref on ref.launch_id = l.id left join first on first.launch_id = l.id
    left join day on day.launch_id = l.id left join curve on curve.launch_id = l.id`;
  const tokens: TokenRow[] = rows.map((r: any) => {
    const priceUsd = r.price === null || r.quote_usd === null ? null : r.price * r.quote_usd;
    return {
      mint: r.mint, symbol: r.symbol ?? r.mint.slice(0, 4), name: r.name, image: r.image, status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      price: r.price, priceUsd, mcapUsd: priceUsd === null ? null : priceUsd * SUPPLY,
      change24h: r.price !== null && r.ref_price ? (r.price / r.ref_price - 1) * 100 : 0,
      volume24hUsd: Number(r.vol),
      progress: r.status === "live" && r.threshold ? Math.min(100, Math.round((r.reserve / r.threshold) * 100)) : null,
    };
  });
  const recent = await sql`
    select t.signature, t.event_index, l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, t.side, t.quote_value * t.quote_usd as value_usd, t.trader, t.block_time
    from trades t join launches l on l.id = t.launch_id order by t.slot desc, t.seq desc limit 8`;
  return {
    stats: { launches: stats.launches, graduated: stats.graduated, volume24hUsd: Number(stats.v24), volumeAllUsd: Number(stats.vall), traders24h: stats.traders },
    biggest: tokens.filter((t) => t.mcapUsd !== null).sort((a, b) => b.mcapUsd! - a.mcapUsd!).slice(0, LIST),
    gainers: tokens.filter((t) => t.change24h > 0).sort((a, b) => b.change24h - a.change24h).slice(0, LIST),
    newest: [...tokens].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, LIST),
    closest: tokens.filter((t) => t.progress !== null).sort((a, b) => b.progress! - a.progress!).slice(0, LIST),
    recent: recent.map((r: any) => ({
      signature: r.signature, eventIndex: r.event_index, mint: r.mint, symbol: r.symbol, side: r.side, valueUsd: r.value_usd, trader: r.trader, at: new Date(r.block_time).toISOString(),
    })),
  };
}
