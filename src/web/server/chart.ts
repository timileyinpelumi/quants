export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Market = { priceUsd: number; fdvUsd: number; change24h: number };
export type Timeframe = "1H" | "1D" | "1W";

export interface ChartSource {
  candles(pool: string, tf: Timeframe): Promise<Candle[]>;
  market(pool: string): Promise<Market | null>;
}

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const TF: Record<Timeframe, string> = {
  "1H": "minute?aggregate=1&limit=60",
  "1D": "minute?aggregate=15&limit=96",
  "1W": "hour?aggregate=4&limit=42",
};

// GeckoTerminal's free tier allows about 10 calls a minute, so every answer is cached and the last good one is served on failure.
export class GeckoChart implements ChartSource {
  private cache = new Map<string, { at: number; value: unknown }>();
  constructor(private base: string, private fetchFn: Fetch = fetch, private ttlMs = 120_000) {}

  private async cached<T>(key: string, empty: T, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as T;
    try {
      const value = await load();
      this.cache.set(key, { at: Date.now(), value });
      return value;
    } catch {
      return hit ? (hit.value as T) : empty;
    }
  }

  candles(pool: string, tf: Timeframe): Promise<Candle[]> {
    return this.cached(`c:${pool}:${tf}`, [], async () => {
      const res = await this.fetchFn(`${this.base}/networks/solana/pools/${pool}/ohlcv/${TF[tf]}&currency=usd`);
      if (!res.ok) throw new Error(`gecko ${res.status}`);
      const list = ((await res.json()) as { data: { attributes: { ohlcv_list: number[][] } } }).data.attributes.ohlcv_list;
      return list.map(([time, open, high, low, close]) => ({ time: time!, open: open!, high: high!, low: low!, close: close! })).reverse();
    });
  }

  market(pool: string): Promise<Market | null> {
    return this.cached<Market | null>(`m:${pool}`, null, async () => {
      const res = await this.fetchFn(`${this.base}/networks/solana/pools/${pool}`);
      if (!res.ok) throw new Error(`gecko ${res.status}`);
      const a = ((await res.json()) as { data: { attributes: any } }).data.attributes;
      return { priceUsd: Number(a.base_token_price_usd), fdvUsd: Number(a.fdv_usd), change24h: Number(a.price_change_percentage?.h24 ?? 0) };
    });
  }
}
