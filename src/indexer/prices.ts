type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

// One lookup per quote mint per minute; a failure returns null and the trade is stored without a USD value.
export class JupiterPrices {
  private cache = new Map<string, { at: number; usd: number | null }>();
  constructor(private base: string, private apiKey: string | undefined, private fetchFn: Fetch = fetch, private ttlMs = 60_000) {}

  async usd(mint: string): Promise<number | null> {
    const hit = this.cache.get(mint);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.usd;
    let usd: number | null = null;
    try {
      const res = await this.fetchFn(`${this.base}?ids=${mint}`, { headers: this.apiKey ? { "x-api-key": this.apiKey } : {}, signal: AbortSignal.timeout(10_000) });
      if (res.ok) usd = ((await res.json()) as Record<string, { usdPrice?: number }>)[mint]?.usdPrice ?? null;
    } catch {
      usd = null;
    }
    this.cache.set(mint, { at: Date.now(), usd });
    return usd;
  }
}
