import { Lru, ttlCache } from "../domain/lru";
import { NATIVE_MINT } from "../domain/types";

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const BATCH = 50;

export interface PricePort {
  usd(mint: string): Promise<number | null>;
  usdMany(mints: string[]): Promise<Record<string, number | null>>;
}

// One lookup per mint per minute; a failure returns null and callers show amounts without a USD value.
export class JupiterPrices implements PricePort {
  private cache: Lru<string, { at: number; usd: number | null }>;
  constructor(private base: string, private apiKey: string | undefined, private fetchFn: Fetch = fetch, private ttlMs = 60_000, maxEntries = 5_000) {
    this.cache = new Lru(maxEntries);
  }

  async usd(mint: string): Promise<number | null> {
    return (await this.usdMany([mint]))[mint] ?? null;
  }

  async usdMany(mints: string[]): Promise<Record<string, number | null>> {
    const now = Date.now();
    const missing = [...new Set(mints)].filter((m) => { const c = this.cache.get(m); return !c || now - c.at > this.ttlMs; });
    const out: Record<string, number | null> = {};
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      let found: Record<string, { usdPrice?: number }> | null = null;
      try {
        const res = await this.fetchFn(`${this.base}?ids=${batch.map(encodeURIComponent).join(",")}`, { headers: this.apiKey ? { "x-api-key": this.apiKey } : {}, signal: AbortSignal.timeout(10_000) });
        if (res.ok) found = (await res.json()) as Record<string, { usdPrice?: number }>;
      } catch {
        found = null;
      }
      // A failed lookup (rate limit, timeout) keeps the last good price and is not cached, so the next call asks again.
      if (!found) continue;
      for (const m of batch) {
        out[m] = found[m]?.usdPrice ?? null;
        this.cache.set(m, { at: now, usd: out[m] });
      }
    }
    return Object.fromEntries(mints.map((m) => [m, m in out ? out[m]! : this.cache.get(m)?.usd ?? null]));
  }
}

/**
 * Prices for a cluster Jupiter does not serve: mints with a stand-in (devnet USDC) use their mainnet mint's price, mints
 * with a pool against SOL use the pool price times SOL's, and anything else goes to Jupiter as is.
 */
export class PoolPrices implements PricePort {
  private pool = ttlCache<number | null>(60_000, 1_000);
  constructor(
    private jupiter: PricePort,
    private mainnetOf: Record<string, string>,
    private pooled: Set<string>,
    private priceInSol: (mint: string) => Promise<number | null>,
  ) {}

  async usd(mint: string): Promise<number | null> {
    return (await this.usdMany([mint]))[mint] ?? null;
  }

  async usdMany(mints: string[]): Promise<Record<string, number | null>> {
    const unique = [...new Set(mints)];
    const pooled = unique.filter((m) => this.pooled.has(m));
    const rest = unique.filter((m) => !this.pooled.has(m));
    const lookup = [...new Set([...rest.map((m) => this.mainnetOf[m] ?? m), ...(pooled.length ? [NATIVE_MINT] : [])])];
    const found = lookup.length ? await this.jupiter.usdMany(lookup) : {};
    const out: Record<string, number | null> = {};
    for (const m of rest) out[m] = found[this.mainnetOf[m] ?? m] ?? null;
    const sol = found[NATIVE_MINT] ?? null;
    await Promise.all(pooled.map(async (m) => {
      const inSol = await this.pool.get(m, () => this.priceInSol(m)).catch(() => null);
      out[m] = sol !== null && inSol !== null ? sol * inSol : null;
    }));
    return Object.fromEntries(mints.map((m) => [m, out[m] ?? null]));
  }
}
