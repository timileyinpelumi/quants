import type { SQL } from "bun";
import { PublicKey } from "@solana/web3.js";
import { quoteCoins, type QuoteCoin } from "@/domain/quotes";
import { ttlCache } from "@/domain/lru";
import type { Cluster } from "@/cluster";
import type { WebContext } from "./context";
import { usdPrices } from "./prices";
import { featured } from "./landing";

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
const DAY = 86_400_000;

export type DexStats = { priceUsd: number | null; change24h: number | null; volume24hUsd: number | null; mcapUsd: number | null };
export type PairStats = { pairs: number; volume24hUsd: number; volumeAllUsd: number; stakersUsd: number };
export type PlatformCard = {
  mint: string; symbol: string; name: string;
  priceUsd: number | null; mcapUsd: number | null; change24h: number | null; volume24hUsd: number | null;
  pairs: PairStats;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** DexScreener's public token endpoint, one request per mint per minute. */
export class DexScreener {
  private cache = ttlCache<DexStats | null>(60_000, 100);
  constructor(private fetchFn: Fetch = fetch) {}

  stats(mint: string): Promise<DexStats | null> {
    return this.cache.get(mint, () => this.load(mint)).catch(() => null);
  }

  private async load(mint: string): Promise<DexStats | null> {
    try {
      const res = await this.fetchFn(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      const pairs = (await res.json()) as any[];
      if (!Array.isArray(pairs) || pairs.length === 0) return null;
      const own = pairs.filter((p) => p?.baseToken?.address === mint)
        .sort((a, b) => (num(b?.liquidity?.usd) ?? 0) - (num(a?.liquidity?.usd) ?? 0));
      const top = own[0];
      const volume = pairs.reduce((s, p) => s + (num(p?.volume?.h24) ?? 0), 0);
      return {
        priceUsd: num(top?.priceUsd),
        change24h: num(top?.priceChange?.h24),
        volume24hUsd: volume,
        mcapUsd: num(top?.marketCap) ?? num(top?.fdv),
      };
    } catch {
      return null;
    }
  }
}

/** Launches paired with the platform token: how many, their volume, and the fees their splits set aside for stakers. */
export async function pairStats(sql: SQL, mint: string, now = Date.now()): Promise<PairStats> {
  const since = new Date(now - DAY);
  const [r] = await sql`
    with l as (select id from launches where quote_mint = ${mint}),
    px as (
      select distinct on (launch_id) launch_id, quote_usd, quote_value / nullif(quote_amount, 0)::float8 as unit
      from trades where launch_id in (select id from l) and quote_usd is not null order by launch_id, slot desc, seq desc
    )
    select (select count(*)::int from l) as pairs,
      (select coalesce(sum(quote_value * quote_usd), 0)::float8 from trades where launch_id in (select id from l) and block_time > ${since}) as v24,
      (select coalesce(sum(quote_value * quote_usd), 0)::float8 from trades where launch_id in (select id from l)) as vall,
      (select coalesce(sum((d.detail->>'amount')::float8 * (s.data->'split'->>'basketBps')::float8 / 10000 * px.unit * px.quote_usd), 0)::float8
         from distributions d join settings s on s.version = d.settings_version join px on px.launch_id = d.launch_id
         where d.kind = 'split' and d.status = 'confirmed' and d.detail->>'tradingOnly' is null) as stakers`;
  return { pairs: r.pairs, volume24hUsd: Number(r.v24), volumeAllUsd: Number(r.vall), stakersUsd: Number(r.stakers) };
}

export type PlatformDeps = {
  sql: SQL; now?: number; coins?: QuoteCoin[];
  price: (mint: string) => Promise<number | null>;
  supply: (mint: string) => Promise<number | null>;
  dex: (mint: string) => Promise<DexStats | null>;
};

const safe = <T>(p: () => Promise<T>) => p().catch(() => null);

export async function platformCard(d: PlatformDeps): Promise<PlatformCard | null> {
  const coin = (d.coins ?? quoteCoins()).find((c) => c.platform);
  if (!coin) return null;
  const now = d.now ?? Date.now();
  const [price, supply, dex, pairs, own] = await Promise.all([
    safe(() => d.price(coin.mint)), safe(() => d.supply(coin.mint)), safe(() => d.dex(coin.mint)),
    pairStats(d.sql, coin.mint, now), featured(d.sql, now, undefined, [coin]),
  ]);
  const row = own?.token ?? null;
  const priceUsd = price ?? dex?.priceUsd ?? row?.priceUsd ?? null;
  const mcapUsd = priceUsd !== null && supply !== null ? priceUsd * supply : dex?.mcapUsd ?? row?.mcapUsd ?? null;
  return {
    mint: coin.mint, symbol: coin.symbol, name: coin.name, priceUsd, mcapUsd,
    change24h: dex?.change24h ?? (row && row.price !== null ? row.change24h : null),
    volume24hUsd: dex?.volume24hUsd ?? row?.volume24hUsd ?? null,
    pairs,
  };
}

export function platformLinks(mint: string, cluster: Cluster, launchedHere: boolean) {
  const launch = `/launch?pair=${mint}`;
  if (cluster === "mainnet") return { buy: `https://jup.ag/swap/SOL-${mint}`, buyExternal: true, launch };
  return { buy: launchedHere ? `/t/${mint}` : `/explore?quote=${mint}`, buyExternal: false, launch };
}

const g = globalThis as { __quantsDex?: DexScreener; __quantsSupply?: ReturnType<typeof ttlCache<number | null>> };

export function platformCardFor(ctx: WebContext, now = Date.now()) {
  const dex = (g.__quantsDex ??= new DexScreener());
  const supplies = (g.__quantsSupply ??= ttlCache<number | null>(10 * 60_000, 10));
  return platformCard({
    sql: ctx.sql, now,
    price: async (m) => (await usdPrices(ctx, [m]))[m] ?? null,
    supply: (m) => supplies.get(m, async () => (await ctx.conn.getTokenSupply(new PublicKey(m))).value.uiAmount),
    dex: (m) => dex.stats(m),
  });
}
