import { NATIVE_MINT } from "./types";

export interface QuoteCoin {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Quote raised on the curve, in whole units, at which a token graduates. Fixed into each config key when it is created. */
  graduation: number;
  /** Mainnet mint used to look up the logo; differs from `mint` on a local validator. */
  iconMint: string | null;
  platform: boolean;
  /** Default smallest creator payout, in base units, when settings do not set one for this mint. */
  payoutMin: bigint;
  kind: "crypto" | "xstocks" | "backpack";
  /** Tokenized stocks cannot back Kamino farms, so launches against them have no basket and no staking. */
  tradingOnly: boolean;
}

type Env = Record<string, string | undefined>;

const MAINNET: Omit<QuoteCoin, "platform" | "kind" | "tradingOnly">[] = [
  { mint: NATIVE_MINT, symbol: "SOL", name: "Solana", decimals: 9, graduation: 85, iconMint: NATIVE_MINT, payoutMin: 50_000_000n },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, graduation: 12_000, iconMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payoutMin: 5_000_000n },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6, graduation: 12_000, iconMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", payoutMin: 5_000_000n },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, graduation: 30_000, iconMint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", payoutMin: 10_000_000n },
];

export function quoteCoins(env: Env = process.env): QuoteCoin[] {
  const local = env.QUOTE_MINTS ? (JSON.parse(env.QUOTE_MINTS) as Record<string, string>) : {};
  const list: QuoteCoin[] = MAINNET.map((c) => ({ ...c, mint: local[c.symbol] ?? c.mint, platform: false, kind: "crypto", tradingOnly: false }));
  const ours = env.OURTOKEN_MINT ?? env.NEXT_PUBLIC_OURTOKEN_MINT;
  if (ours) {
    list.push({
      mint: ours, symbol: env.OURTOKEN_SYMBOL ?? env.NEXT_PUBLIC_OURTOKEN_SYMBOL ?? "QUANTS", name: "quants",
      decimals: Number(env.OURTOKEN_DECIMALS ?? 6), graduation: Number(env.OURTOKEN_GRADUATION ?? env.NEXT_PUBLIC_OURTOKEN_GRADUATION ?? 0),
      iconMint: null, platform: true, payoutMin: 0n, kind: "crypto", tradingOnly: false,
    });
  }
  const targets = env.QUOTE_GRADUATIONS ? (JSON.parse(env.QUOTE_GRADUATIONS) as Record<string, unknown>) : {};
  for (const [symbol, target] of Object.entries(targets)) {
    const coin = list.find((c) => c.symbol === symbol);
    if (!coin) throw new Error(`QUOTE_GRADUATIONS names ${symbol}, which is not a pair token`);
    if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) throw new Error(`QUOTE_GRADUATIONS target for ${symbol} must be a positive number`);
    coin.graduation = target;
  }
  return list;
}

// The stock pairs this process last loaded, so synchronous lookups by mint also find stocks.
const g = globalThis as { __quantsStocks?: QuoteCoin[] };
export const setStockQuotes = (list: QuoteCoin[]) => { g.__quantsStocks = list; };
export const stockQuotes = (): QuoteCoin[] => g.__quantsStocks ?? [];

/** Stock pairs are trading only (no staking), so new launches against them stay off unless STOCK_PAIRS=1. Existing stock launches keep trading. */
export const stockPairsEnabled = (env: Env = process.env) => env.STOCK_PAIRS === "1";

export const quoteCoin = (mint: string, list = [...quoteCoins(), ...stockQuotes()]) => list.find((c) => c.mint === mint);
