import { Lru } from "../domain/lru";

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const BATCH = 50;

// One lookup per mint per minute; a failure returns null and callers show amounts without a USD value.
export class JupiterPrices {
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
      let found: Record<string, { usdPrice?: number }> = {};
      try {
        const res = await this.fetchFn(`${this.base}?ids=${batch.map(encodeURIComponent).join(",")}`, { headers: this.apiKey ? { "x-api-key": this.apiKey } : {}, signal: AbortSignal.timeout(10_000) });
        if (res.ok) found = (await res.json()) as typeof found;
      } catch {
        found = {};
      }
      for (const m of batch) {
        out[m] = found[m]?.usdPrice ?? null;
        this.cache.set(m, { at: now, usd: out[m] });
      }
    }
    return Object.fromEntries(mints.map((m) => [m, m in out ? out[m]! : this.cache.get(m)?.usd ?? null]));
  }
}
