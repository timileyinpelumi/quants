import type { SQL } from "bun";

const WINDOWS = [["5m", 300_000], ["1h", 3_600_000], ["6h", 21_600_000], ["24h", 86_400_000]] as const;
const BASE_UNIT = 1e-6; // launched tokens have 6 decimals

export type Activity = { window: (typeof WINDOWS)[number][0]; buys: number; sells: number; buyValue: number; sellValue: number; buyers: number; sellers: number; change: number | null };
export type Trader = { wallet: string; trades: number; bought: number; sold: number; spent: number; received: number; position: number; pnl: number; firstAt: string; lastAt: string };

export async function activity(sql: SQL, launchId: number, now = Date.now()): Promise<Activity[]> {
  return Promise.all(WINDOWS.map(async ([window, ms]) => {
    const since = new Date(now - ms);
    const [r] = await sql`
      select count(*) filter (where side = 'buy')::int as buys, count(*) filter (where side = 'sell')::int as sells,
        coalesce(sum(quote_value) filter (where side = 'buy'), 0) as buy_value, coalesce(sum(quote_value) filter (where side = 'sell'), 0) as sell_value,
        count(distinct trader) filter (where side = 'buy')::int as buyers, count(distinct trader) filter (where side = 'sell')::int as sellers,
        (select price from trades where launch_id = ${launchId} order by slot desc, seq desc limit 1) as last,
        coalesce((select price from trades where launch_id = ${launchId} and block_time <= ${since} order by slot desc, seq desc limit 1),
                 (select price from trades where launch_id = ${launchId} order by slot, seq limit 1)) as ref
      from trades where launch_id = ${launchId} and block_time > ${since}`;
    return {
      window, buys: r.buys, sells: r.sells, buyValue: Number(r.buy_value), sellValue: Number(r.sell_value), buyers: r.buyers, sellers: r.sellers,
      change: r.last !== null && r.ref ? (r.last / r.ref - 1) * 100 : null,
    };
  }));
}

/** Values are in the quote token. Profit uses average cost: realized on sells, unrealized on what is still held at `price`. */
export async function topTraders(sql: SQL, launchId: number, price: number, limit: number): Promise<Trader[]> {
  const rows = await sql`
    select trader, count(*)::int as n,
      coalesce(sum(base_amount::float8) filter (where side = 'buy'), 0) as bought, coalesce(sum(base_amount::float8) filter (where side = 'sell'), 0) as sold,
      coalesce(sum(quote_value) filter (where side = 'buy'), 0) as spent, coalesce(sum(quote_value) filter (where side = 'sell'), 0) as received,
      min(block_time) as first_at, max(block_time) as last_at
    from trades where launch_id = ${launchId}
    group by trader order by sum(quote_value) desc limit ${limit}`;
  return rows.map((r: any) => {
    const bought = r.bought * BASE_UNIT, sold = r.sold * BASE_UNIT;
    const avg = bought > 0 ? r.spent / bought : 0;
    const position = Math.max(0, bought - sold);
    const realized = r.received - avg * Math.min(sold, bought);
    const unrealized = position * (price - avg);
    return {
      wallet: r.trader, trades: r.n, bought, sold, spent: r.spent, received: r.received, position, pnl: realized + unrealized,
      firstAt: new Date(r.first_at).toISOString(), lastAt: new Date(r.last_at).toISOString(),
    };
  });
}

export async function curveProgress(sql: SQL, launchId: number): Promise<{ reserve: string; threshold: string; progress: number } | null> {
  const [r] = await sql`select curve_reserve::text as reserve, curve_threshold::text as threshold from trades
    where launch_id = ${launchId} and curve_reserve is not null order by slot desc, seq desc limit 1`;
  if (!r) return null;
  const t = BigInt(r.threshold);
  return { reserve: r.reserve, threshold: r.threshold, progress: t === 0n ? 100 : Math.min(100, Number((BigInt(r.reserve) * 100n) / t)) };
}

export type HolderRow = { owner: string; amount: number; pct: number; label: string | null };
export type Holders = { count: number | null; top10Pct: number; stakedPct: number; list: HolderRow[] };
export interface HolderChain {
  largest(mint: string): Promise<{ address: string; amount: bigint }[]>;
  owners(accounts: string[]): Promise<(string | null)[]>;
  supply(mint: string): Promise<bigint>;
  count(mint: string): Promise<number | null>;
}

const POOL_LABELS = new Set(["Bonding curve", "Pool"]);

export async function holders(chain: HolderChain, mint: string, labels: Record<string, string>): Promise<Holders> {
  const [largest, supply, count] = await Promise.all([chain.largest(mint), chain.supply(mint), chain.count(mint).catch(() => null)]);
  const held = largest.filter((a) => a.amount > 0n);
  const owners = await chain.owners(held.map((a) => a.address));
  const total = Number(supply) || 1;
  const list = held.map((a, i) => {
    const owner = owners[i] ?? a.address;
    return { owner, amount: Number(a.amount) * BASE_UNIT, pct: (Number(a.amount) / total) * 100, label: labels[owner] ?? null };
  });
  const people = list.filter((h) => !POOL_LABELS.has(h.label ?? ""));
  return {
    count, list,
    top10Pct: people.slice(0, 10).reduce((s, h) => s + h.pct, 0),
    stakedPct: list.filter((h) => h.label === "Staked").reduce((s, h) => s + h.pct, 0),
  };
}
