import type { SQL } from "bun";
import type { WebContext } from "./context";
import { usdPrices } from "./prices";
import { platformWallets } from "./platform-wallets";
import { ttlCache } from "@/domain/lru";
import { stakingOpens } from "./reads";

export type Range = "24h" | "7d" | "30d" | "all";
export const RANGES = ["24h", "7d", "30d", "all"] as const satisfies readonly Range[];
export type Unit = "hour" | "day";
export type Window = { range: Range; from: Date; to: Date; prevFrom: Date | null; unit: Unit };

export type AnalyticsDeps = {
  sql: SQL;
  /** USD per whole token from the price layer. */
  usd: (mints: string[]) => Promise<Record<string, number | null>>;
  /** Users across these farms, or null when the chain read fails. */
  stakers: (farms: string[]) => Promise<number | null>;
  keeperWallet: () => Promise<{ address: string | null; lamports: string | null; low: boolean } | null>;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LENGTH: Record<Exclude<Range, "all">, number> = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };

export function windowOf(range: Range, now = Date.now()): Window {
  const to = new Date(now);
  if (range === "all") return { range, from: new Date(0), to, prevFrom: null, unit: "day" };
  const len = LENGTH[range];
  return { range, from: new Date(now - len), to, prevFrom: new Date(now - 2 * len), unit: range === "24h" ? "hour" : "day" };
}

// USD per base unit of a launch's quote token, from its latest priced trade, the same reference the home stats use.
export const pxJoin = (sql: SQL, launchId: unknown) => sql`
  left join lateral (
    select quote_usd * quote_value / nullif(quote_amount, 0)::float8 as usd from trades
    where launch_id = ${launchId} and quote_usd is not null order by slot desc, seq desc limit 1
  ) px on true`;

/** Each confirmed fee split in [from, to) cut into stakers, platform and creator shares, in quote base units. */
export const splitShares = (sql: SQL, from: Date, to: Date, unit: Unit | null) => sql`
  select d.launch_id, ${unit === null ? sql`null::timestamptz` : sql`date_trunc(${unit}, d.updated_at, 'UTC')`} as b,
    sum(v.amt) as amt, sum(w.platform) as platform, sum(z.creator) as creator, sum(v.amt - w.platform - z.creator) as basket
  from distributions d join settings s on s.version = d.settings_version
  cross join lateral (select (d.detail->>'amount')::float8 as amt, (s.data->'split'->>'platformBps')::float8 as p,
    (s.data->'split'->>'creatorBps')::float8 as c, d.detail->>'tradingOnly' is not null as only) v
  cross join lateral (select case when not v.only then v.amt * v.p / 10000 when v.p + v.c = 0 then v.amt else v.amt * v.p / (v.p + v.c) end as platform) w
  cross join lateral (select case when v.only then v.amt - w.platform else v.amt * v.c / 10000 end as creator) z
  where d.kind = 'split' and d.status = 'confirmed' and d.updated_at >= ${from} and d.updated_at < ${to}
  group by 1, 2`;

type Period = {
  launches: number; trades: number; traders: number; volumeUsd: number; feesUsd: number;
  creatorsUsd: number; treasuryUsd: number; stakingOpened: number; graduated: number;
};

async function period(sql: SQL, from: Date, to: Date): Promise<Period> {
  const [r] = await sql`
    with t as (
      select count(*)::int as trades, count(distinct trader)::int as traders, coalesce(sum(quote_value * quote_usd), 0)::float8 as vol
      from trades where block_time >= ${from} and block_time < ${to}
    ), f as (
      select coalesce(sum(s.amt * px.usd), 0)::float8 as fees from (${splitShares(sql, from, to, null)}) s ${pxJoin(sql, sql`s.launch_id`)}
    ), p as (
      select coalesce(sum(x.amt * px.usd) filter (where x.bucket = 'creator'), 0)::float8 as creator,
        coalesce(sum(x.amt * px.usd) filter (where x.bucket = 'treasury'), 0)::float8 as treasury
      from (
        select launch_id, detail->>'bucket' as bucket, sum((detail->>'amount')::float8) as amt from distributions
        where kind = 'payout' and status = 'confirmed' and updated_at >= ${from} and updated_at < ${to} group by 1, 2
      ) x ${pxJoin(sql, sql`x.launch_id`)}
    )
    select t.*, f.fees, p.creator, p.treasury,
      (select count(*)::int from launches where created_at >= ${from} and created_at < ${to}) as launches,
      (select count(*)::int from launches where graduated_at >= ${from} and graduated_at < ${to}) as graduated,
      (select count(*)::int from stake_pools where opened_at >= ${from} and opened_at < ${to}) as opened
    from t, f, p`;
  return {
    launches: r.launches, trades: r.trades, traders: r.traders, volumeUsd: Number(r.vol), feesUsd: Number(r.fees),
    creatorsUsd: Number(r.creator), treasuryUsd: Number(r.treasury), stakingOpened: r.opened, graduated: r.graduated,
  };
}

/** Rewards paid into farms in [from, to), by reward mint in whole tokens. */
async function funded(sql: SQL, from: Date, to: Date): Promise<Map<string, number>> {
  const rows = await sql`
    select x.mint, x.amt / power(10, coalesce((select decimals from baskets where reward_mint = x.mint and decimals is not null limit 1), 0))::float8 as amount
    from (
      select detail->>'rewardMint' as mint, sum((detail->>'amount')::float8) as amt from distributions
      where kind = 'fund' and status = 'confirmed' and updated_at >= ${from} and updated_at < ${to} group by 1
    ) x`;
  return new Map(rows.map((r: any) => [r.mint as string, Number(r.amount)]));
}

const usdOf = (amounts: Map<string, number>, px: Record<string, number | null>) =>
  [...amounts].reduce((sum, [m, a]) => sum + a * (px[m] ?? 0), 0);

export type Stat = { value: number | null; prev: number | null };
export type Overview = Record<
  "launches" | "trades" | "traders" | "volumeUsd" | "feesUsd" | "stakersUsd" | "creatorsUsd" | "treasuryUsd" | "stakers" | "stakingOpen" | "stakingOpened" | "graduated",
  Stat
>;

export async function overview(d: AnalyticsDeps, w: Window): Promise<Overview> {
  const { sql } = d;
  const [cur, prev, fundCur, fundPrev, farms, [open]] = await Promise.all([
    period(sql, w.from, w.to),
    w.prevFrom ? period(sql, w.prevFrom, w.from) : null,
    funded(sql, w.from, w.to),
    w.prevFrom ? funded(sql, w.prevFrom, w.from) : new Map<string, number>(),
    sql`select t.farm from stake_tiers t join stake_pools p on p.launch_id = t.launch_id where p.status = 'ready' and t.farm is not null limit 2000`,
    sql`select count(*)::int as n from stake_pools where status = 'ready'`,
  ]);
  const mints = [...new Set([...fundCur.keys(), ...fundPrev.keys()])];
  const [px, stakers] = await Promise.all([
    mints.length ? d.usd(mints) : Promise.resolve({}),
    d.stakers(farms.map((f: any) => f.farm as string)).catch(() => null),
  ]);
  const pair = (k: keyof Period): Stat => ({ value: cur[k], prev: prev ? prev[k] : null });
  return {
    launches: pair("launches"), trades: pair("trades"), traders: pair("traders"), volumeUsd: pair("volumeUsd"), feesUsd: pair("feesUsd"),
    stakersUsd: { value: usdOf(fundCur, px), prev: w.prevFrom ? usdOf(fundPrev, px) : null },
    creatorsUsd: pair("creatorsUsd"), treasuryUsd: pair("treasuryUsd"),
    stakers: { value: stakers, prev: null },
    stakingOpen: { value: open.n, prev: null },
    stakingOpened: pair("stakingOpened"), graduated: pair("graduated"),
  };
}

export type Point = { t: string; launches: number; volumeUsd: number; trades: number; traders: number; feesUsd: number };
const MAX_POINTS = 1000;

const truncate = (ms: number, unit: Unit) => {
  const d = new Date(ms);
  return unit === "hour" ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()) : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** One point per hour (24h) or UTC day, empty buckets included. All time starts at the first launch. */
export async function series(sql: SQL, w: Window): Promise<Point[]> {
  const step = w.unit === "hour" ? HOUR : DAY;
  let from = w.from;
  if (w.range === "all") {
    const [r] = await sql`select min(created_at) as at from launches`;
    from = r?.at ? new Date(r.at) : w.to;
  }
  const end = truncate(w.to.getTime(), w.unit);
  const start = Math.max(truncate(from.getTime(), w.unit), end - (MAX_POINTS - 1) * step);
  const lo = new Date(Math.max(from.getTime(), start));
  const [trades, launches, fees] = await Promise.all([
    sql`select date_trunc(${w.unit}, block_time, 'UTC') as b, count(*)::int as n, count(distinct trader)::int as traders,
          coalesce(sum(quote_value * quote_usd), 0)::float8 as vol
        from trades where block_time >= ${lo} and block_time < ${w.to} group by 1`,
    sql`select date_trunc(${w.unit}, created_at, 'UTC') as b, count(*)::int as n from launches where created_at >= ${lo} and created_at < ${w.to} group by 1`,
    sql`select s.b, coalesce(sum(s.amt * px.usd), 0)::float8 as usd from (${splitShares(sql, lo, w.to, w.unit)}) s ${pxJoin(sql, sql`s.launch_id`)} group by 1`,
  ]);
  const at = (r: any) => new Date(r.b).getTime();
  const tm = new Map<number, any>(trades.map((r: any) => [at(r), r]));
  const lm = new Map<number, number>(launches.map((r: any) => [at(r), r.n as number]));
  const fm = new Map<number, number>(fees.map((r: any) => [at(r), Number(r.usd)]));
  const out: Point[] = [];
  for (let t = start; t <= end; t += step) {
    const tr = tm.get(t);
    out.push({ t: new Date(t).toISOString(), launches: lm.get(t) ?? 0, volumeUsd: tr ? Number(tr.vol) : 0, trades: tr?.n ?? 0, traders: tr?.traders ?? 0, feesUsd: fm.get(t) ?? 0 });
  }
  return out;
}

export type Staking = { state: "open" | "opening" | "trading" | "none"; percent: number | null };
export type TopToken = {
  mint: string; symbol: string; name: string | null; status: string;
  volumeUsd: number; trades: number; traders: number; feesUsd: number; staking: Staking;
};
export const TOP_TOKENS = 20;

export async function topTokens(sql: SQL, w: Window, limit = TOP_TOKENS): Promise<TopToken[]> {
  const rows = await sql`
    with t as (
      select launch_id, count(*)::int as n, count(distinct trader)::int as traders, coalesce(sum(quote_value * quote_usd), 0)::float8 as vol
      from trades where block_time >= ${w.from} and block_time < ${w.to}
      group by 1 order by 4 desc, 2 desc, 1 limit ${limit}
    ), f as (
      select s.launch_id, sum(s.amt * px.usd)::float8 as fees
      from (${splitShares(sql, w.from, w.to, null)}) s ${pxJoin(sql, sql`s.launch_id`)}
      where s.launch_id in (select launch_id from t) group by 1
    )
    select l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, l.name, l.status, l.trading_only, t.n, t.traders, t.vol, coalesce(f.fees, 0) as fees,
      sp.status as pool_status, sp.rent_lamports, sp.basket_value_lamports
    from t join launches l on l.id = t.launch_id left join f on f.launch_id = t.launch_id left join stake_pools sp on sp.launch_id = t.launch_id
    order by t.vol desc, t.n desc, l.id`;
  return rows.map((r: any) => {
    const opens = r.pool_status ? stakingOpens({ status: r.pool_status, rent_lamports: r.rent_lamports, basket_value_lamports: r.basket_value_lamports ?? 0 }) : null;
    const staking: Staking = r.trading_only ? { state: "trading", percent: null }
      : r.pool_status === "ready" ? { state: "open", percent: null }
      : r.pool_status ? { state: "opening", percent: opens?.percent ?? 0 }
      : { state: "none", percent: null };
    return { mint: r.mint, symbol: r.symbol, name: r.name, status: r.status, volumeUsd: Number(r.vol), trades: r.n, traders: r.traders, feesUsd: Number(r.fees), staking };
  });
}

export type Report = { range: Range; from: string; to: string; unit: Unit; overview: Overview; series: Point[]; tokens: TopToken[] };

export async function report(d: AnalyticsDeps, range: Range, now = Date.now()): Promise<Report> {
  const w = windowOf(range, now);
  const [ov, pts, tokens] = await Promise.all([overview(d, w), series(d.sql, w), topTokens(d.sql, w)]);
  return { range, from: w.from.toISOString(), to: w.to.toISOString(), unit: w.unit, overview: ov, series: pts, tokens };
}

export function contextDeps(ctx: WebContext): AnalyticsDeps {
  return {
    sql: ctx.sql,
    usd: (mints) => usdPrices(ctx, mints),
    stakers: (farms) => ctx.staking.farmUsers(farms),
    keeperWallet: async () => (await platformWallets(ctx)).find((w) => w.role === "keeper") ?? null,
  };
}

const g = globalThis as { __quantsAnalytics?: ReturnType<typeof ttlCache<Report>> };
export const resetAnalyticsCache = () => g.__quantsAnalytics?.clear();

/** One report per range, shared for 30 seconds. */
export function cachedReport(ctx: WebContext, range: Range): Promise<Report> {
  const cache = (g.__quantsAnalytics ??= ttlCache<Report>(30_000, RANGES.length));
  return cache.get(range, () => report(contextDeps(ctx), range));
}
