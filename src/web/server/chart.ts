export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Market = { priceUsd: number; fdvUsd: number; change24h: number };
export type Timeframe = "1H" | "1D" | "1W";

export interface ChartSource {
  candles(pool: string, tf: Timeframe): Promise<Candle[]>;
  market(pool: string): Promise<Market | null>;
}
