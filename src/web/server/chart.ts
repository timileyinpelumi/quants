import type { SQL } from "bun";

export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Timeframe = "1H" | "1D" | "1W";
export type Market = {
  price: number;
  priceUsd: number | null;
  fdvUsd: number | null;
  change24h: number;
  volume24h: number;
  volume24hUsd: number | null;
  trades24h: number;
};

const SUPPLY = 1_000_000_000;
const DAY = 86_400_000;
const TF: Record<Timeframe, { bucket: string; bucketMs: number; rangeMs: number }> = {
  "1H": { bucket: "1 minute", bucketMs: 60_000, rangeMs: 3_600_000 },
  "1D": { bucket: "15 minutes", bucketMs: 900_000, rangeMs: DAY },
  "1W": { bucket: "4 hours", bucketMs: 14_400_000, rangeMs: 7 * DAY },
};

export async function candles(sql: SQL, launchId: number, tf: Timeframe, now = Date.now()): Promise<{ unit: "usd" | "quote"; candles: Candle[] }> {
  const t = TF[tf];
  const since = new Date(now - t.rangeMs);
  const rows = await sql`
    select extract(epoch from date_bin(${t.bucket}::interval, block_time, timestamptz '2000-01-01'))::bigint as time,
      (array_agg(price order by slot, seq))[1] as q_open,
      max(price) as q_high, min(price) as q_low,
      (array_agg(price order by slot desc, seq desc))[1] as q_close,
      (array_agg(price * quote_usd order by slot, seq))[1] as u_open,
      max(price * quote_usd) as u_high, min(price * quote_usd) as u_low,
      (array_agg(price * quote_usd order by slot desc, seq desc))[1] as u_close,
      count(*) filter (where quote_usd is null)::int as no_usd
    from trades where launch_id = ${launchId} and block_time >= ${since}
    group by 1 order by 1`;
  if (rows.length === 0) {
    const [last] = await sql`select price, quote_usd from trades where launch_id = ${launchId} order by slot desc, seq desc limit 1`;
    if (!last) return { unit: "quote", candles: [] };
    const v = last.quote_usd === null ? last.price : last.price * last.quote_usd;
    const time = Math.floor(now / t.bucketMs) * t.bucketMs / 1000;
    return { unit: last.quote_usd === null ? "quote" : "usd", candles: [{ time, open: v, high: v, low: v, close: v }] };
  }
  const usd = rows.every((r: any) => r.no_usd === 0);
  const p = usd ? "u_" : "q_";
  return {
    unit: usd ? "usd" : "quote",
    candles: rows.map((r: any) => ({ time: Number(r.time), open: r[`${p}open`], high: r[`${p}high`], low: r[`${p}low`], close: r[`${p}close`] })),
  };
}

export async function market(sql: SQL, launchId: number, now = Date.now()): Promise<Market | null> {
  const since = new Date(now - DAY);
  const [r] = await sql`
    with last as (select price, quote_usd from trades where launch_id = ${launchId} order by slot desc, seq desc limit 1),
    ref as (
      select price from (
        (select price, 0 as k from trades where launch_id = ${launchId} and block_time <= ${since} order by slot desc, seq desc limit 1)
        union all
        (select price, 1 as k from trades where launch_id = ${launchId} order by slot, seq limit 1)
      ) x order by k limit 1
    ),
    day as (
      select count(*)::int as n, coalesce(sum(quote_value), 0) as vol, sum(quote_value * quote_usd) as vol_usd,
        count(*) filter (where quote_usd is null)::int as no_usd
      from trades where launch_id = ${launchId} and block_time > ${since}
    )
    select last.price, last.quote_usd, ref.price as ref_price, day.n, day.vol, day.vol_usd, day.no_usd from last, ref, day`;
  if (!r) return null;
  const priceUsd = r.quote_usd === null ? null : r.price * r.quote_usd;
  return {
    price: r.price,
    priceUsd,
    fdvUsd: priceUsd === null ? null : priceUsd * SUPPLY,
    change24h: r.ref_price ? (r.price / r.ref_price - 1) * 100 : 0,
    volume24h: Number(r.vol),
    volume24hUsd: r.no_usd > 0 || r.vol_usd === null ? (r.n === 0 ? 0 : null) : Number(r.vol_usd),
    trades24h: r.n,
  };
}
