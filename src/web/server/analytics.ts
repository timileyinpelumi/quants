import type { SQL } from "bun";
import type { WebContext } from "./context";
import { usdPrices } from "./prices";
import { platformWallets } from "./platform-wallets";
import { ttlCache } from "@/domain/lru";
import { stakingOpens } from "./reads";
import { NATIVE_MINT } from "@/domain/types";

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

export type FeeFlow = {
  collectedUsd: number;
  /** Where the fees split in the range went; held is the stakers' share not yet spent on rent or rewards. */
  flow: { bought: number; rent: number; creator: number; treasury: number; held: number };
  /** Balances still in escrow right now, whatever range is picked. */
  escrow: { unsplit: number; basket: number; reward: number; creator: number; treasury: number };
};

export async function feeFlow(d: AnalyticsDeps, w: Window): Promise<FeeFlow> {
  const { sql } = d;
  const sol = (await d.usd([NATIVE_MINT]).catch(() => ({} as Record<string, number | null>)))[NATIVE_MINT] ?? null;
  const [[split], [spent], escrow] = await Promise.all([
    sql`select coalesce(sum(s.amt * px.usd), 0)::float8 as amt, coalesce(sum(s.creator * px.usd), 0)::float8 as creator,
          coalesce(sum(s.platform * px.usd), 0)::float8 as platform, coalesce(sum(s.basket * px.usd), 0)::float8 as basket
        from (${splitShares(sql, w.from, w.to, null)}) s ${pxJoin(sql, sql`s.launch_id`)}`,
    sql`select coalesce(sum(v.usd) filter (where x.k = 'rent'), 0)::float8 as rent, coalesce(sum(v.usd) filter (where x.k = 'buy'), 0)::float8 as bought
        from (
          select launch_id, 'rent' as k, ${NATIVE_MINT}::text as mint, sum((detail->>'amount')::float8) as amt from distributions
          where kind = 'rent' and status = 'confirmed' and updated_at >= ${w.from} and updated_at < ${w.to} group by 1
          union all
          select launch_id, 'buy', detail->>'inputMint', sum((detail->>'amountIn')::float8) from distributions
          where kind = 'swap' and status = 'confirmed' and updated_at >= ${w.from} and updated_at < ${w.to}
            and detail->>'toBucket' is null and detail ? 'amountIn' group by 1, 3
        ) x join launches l on l.id = x.launch_id ${pxJoin(sql, sql`x.launch_id`)}
        cross join lateral (select case when x.mint = l.quote_mint then x.amt * px.usd else x.amt / 1e9 * ${sol}::float8 end as usd) v`,
    sql`select e.bucket, e.mint, sum(e.amount::float8 * px.usd) filter (where e.mint = l.quote_mint) as quote_usd,
          sum(e.amount::float8) filter (where e.mint <> l.quote_mint) as other,
          (select decimals from baskets where reward_mint = e.mint and decimals is not null limit 1) as decimals
        from escrow e join launches l on l.id = e.launch_id ${pxJoin(sql, sql`e.launch_id`)}
        where e.bucket <> 'penalty' and e.amount > 0 group by 1, 2 limit 1000`,
  ]);
  const others = [...new Set<string>(escrow.filter((r: any) => r.other).map((r: any) => r.mint as string))];
  const px = others.length ? await d.usd(others).catch(() => ({} as Record<string, number | null>)) : {};
  const held = { unsplit: 0, basket: 0, reward: 0, creator: 0, treasury: 0 };
  for (const r of escrow as any[]) {
    const dec = r.mint === NATIVE_MINT ? 9 : r.decimals ?? 0;
    const usd = Number(r.quote_usd ?? 0) + (r.other ? (Number(r.other) / 10 ** dec) * (px[r.mint] ?? 0) : 0);
    if (r.bucket in held) held[r.bucket as keyof typeof held] += usd;
  }
  const rent = Number(spent.rent), bought = Number(spent.bought);
  return {
    collectedUsd: Number(split.amt),
    flow: { bought, rent, creator: Number(split.creator), treasury: Number(split.platform), held: Math.max(0, Number(split.basket) - rent - bought) },
    escrow: held,
  };
}

export const STUCK_MINUTES = 10;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export type Health = {
  keeper: { lastAt: string | null; ok: boolean | null; error: string | null; launches: number | null; runs: number; failedRuns: number; errors: number };
  wallet: { address: string | null; lamports: string | null; low: boolean } | null;
  steps: { failed: number; stuck: number; recent: { kind: string; mint: string; symbol: string; error: string | null; at: string }[] };
  indexer: { lastPassAt: string | null; stalestAt: string | null; lagSeconds: number | null; addresses: number; lastTradeAt: string | null };
};

export async function health(d: AnalyticsDeps, w: Window): Promise<Health> {
  const { sql } = d;
  const stuckBefore = new Date(w.to.getTime() - STUCK_MINUTES * 60_000);
  const [[last], [runs], [steps], recent, [ix], wallet] = await Promise.all([
    sql`select finished_at, fatal, errors, error, launches from keeper_runs order by started_at desc, id desc limit 1`,
    sql`select count(*)::int as n, count(*) filter (where fatal or errors > 0)::int as bad, coalesce(sum(errors), 0)::int + count(*) filter (where fatal)::int as errors
        from keeper_runs where started_at >= ${w.from} and started_at < ${w.to}`,
    sql`select (select count(*)::int from distributions where status = 'failed' and updated_at >= ${w.from} and updated_at < ${w.to}
                  and coalesce(error, '') <> 'abandoned before send') as failed,
               (select count(*)::int from distributions where status in ('pending', 'sent') and updated_at < ${stuckBefore}) as stuck`,
    sql`select d.kind, l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, d.error, d.updated_at from distributions d join launches l on l.id = d.launch_id
        where d.status = 'failed' and d.updated_at >= ${w.from} and d.updated_at < ${w.to} and coalesce(d.error, '') <> 'abandoned before send'
        order by d.updated_at desc limit 5`,
    sql`select max(checked_at) as last, min(checked_at) filter (where not finished) as stalest, count(*) filter (where not finished)::int as n,
          (select max(block_time) from trades) as trade
        from index_cursors`,
    d.keeperWallet().catch(() => null),
  ]);
  const stalest = ix?.stalest ? new Date(ix.stalest).getTime() : null;
  return {
    keeper: {
      lastAt: iso(last?.finished_at), ok: last ? !last.fatal && last.errors === 0 : null, error: last?.error ?? null, launches: last ? last.launches : null,
      runs: runs.n, failedRuns: runs.bad, errors: runs.errors,
    },
    wallet,
    steps: {
      failed: steps.failed, stuck: steps.stuck,
      recent: recent.map((r: any) => ({ kind: r.kind, mint: r.mint, symbol: r.symbol, error: r.error, at: new Date(r.updated_at).toISOString() })),
    },
    indexer: {
      lastPassAt: iso(ix?.last), stalestAt: iso(ix?.stalest), lagSeconds: stalest === null ? null : Math.max(0, Math.round((w.to.getTime() - stalest) / 1000)),
      addresses: ix?.n ?? 0, lastTradeAt: iso(ix?.trade),
    },
  };
}

export type Traffic = {
  views: Stat;
  /** Unique visitors summed by day: the salt changes daily, so one person on two days counts twice. */
  visitors: Stat;
  days: { t: string; views: number; visitors: number }[];
  pages: { path: string; views: number; visitors: number }[];
  referrers: { host: string; views: number }[];
};

const trafficTotals = async (sql: SQL, from: Date, to: Date) => {
  const [r] = await sql`
    select coalesce(sum(n), 0)::int as views, coalesce(sum(v), 0)::int as visitors from (
      select count(*) as n, count(distinct visitor) as v from page_views where at >= ${from} and at < ${to} group by date_trunc('day', at, 'UTC')
    ) x`;
  return { views: r.views as number, visitors: r.visitors as number };
};

export async function traffic(sql: SQL, w: Window): Promise<Traffic> {
  const [cur, prev, days, pages, refs, [first]] = await Promise.all([
    trafficTotals(sql, w.from, w.to),
    w.prevFrom ? trafficTotals(sql, w.prevFrom, w.from) : null,
    sql`select date_trunc(${w.unit}, at, 'UTC') as b, count(*)::int as n, count(distinct visitor)::int as v
        from page_views where at >= ${w.from} and at < ${w.to} group by 1`,
    sql`select path, count(*)::int as n, count(distinct (date_trunc('day', at, 'UTC'), visitor))::int as v
        from page_views where at >= ${w.from} and at < ${w.to} group by 1 order by 2 desc, 1 limit 10`,
    sql`select referrer, count(*)::int as n from page_views where at >= ${w.from} and at < ${w.to} and referrer is not null
        group by 1 order by 2 desc, 1 limit 10`,
    w.range === "all" ? sql`select min(at) as at from page_views` : Promise.resolve([{ at: w.from }]),
  ]);
  const step = w.unit === "hour" ? HOUR : DAY;
  const end = truncate(w.to.getTime(), w.unit);
  const start = first?.at ? Math.max(truncate(new Date(first.at).getTime(), w.unit), end - (MAX_POINTS - 1) * step) : end;
  const byT = new Map<number, any>(days.map((r: any) => [new Date(r.b).getTime(), r]));
  const out: Traffic["days"] = [];
  for (let t = start; t <= end; t += step) out.push({ t: new Date(t).toISOString(), views: byT.get(t)?.n ?? 0, visitors: byT.get(t)?.v ?? 0 });
  return {
    views: { value: cur.views, prev: prev?.views ?? null },
    visitors: { value: cur.visitors, prev: prev?.visitors ?? null },
    days: out,
    pages: pages.map((r: any) => ({ path: r.path, views: r.n, visitors: r.v })),
    referrers: refs.map((r: any) => ({ host: r.referrer, views: r.n })),
  };
}

export type Report = {
  range: Range; from: string; to: string; unit: Unit;
  overview: Overview; series: Point[]; tokens: TopToken[]; fees: FeeFlow; health: Health; traffic: Traffic;
};

export async function report(d: AnalyticsDeps, range: Range, now = Date.now()): Promise<Report> {
  const w = windowOf(range, now);
  const [ov, pts, tokens, fees, h, tr] = await Promise.all([
    overview(d, w), series(d.sql, w), topTokens(d.sql, w), feeFlow(d, w), health(d, w), traffic(d.sql, w),
  ]);
  return { range, from: w.from.toISOString(), to: w.to.toISOString(), unit: w.unit, overview: ov, series: pts, tokens, fees, health: h, traffic: tr };
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
