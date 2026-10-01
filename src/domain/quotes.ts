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
}

type Env = Record<string, string | undefined>;

const MAINNET: Omit<QuoteCoin, "platform">[] = [
  { mint: NATIVE_MINT, symbol: "SOL", name: "Solana", decimals: 9, graduation: 85, iconMint: NATIVE_MINT, payoutMin: 50_000_000n },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, graduation: 12_000, iconMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payoutMin: 5_000_000n },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6, graduation: 12_000, iconMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", payoutMin: 5_000_000n },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, graduation: 30_000, iconMint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", payoutMin: 10_000_000n },
];

export function quoteCoins(env: Env = process.env): QuoteCoin[] {
  const local = env.QUOTE_MINTS ? (JSON.parse(env.QUOTE_MINTS) as Record<string, string>) : {};
  const list: QuoteCoin[] = MAINNET.map((c) => ({ ...c, mint: local[c.symbol] ?? c.mint, platform: false }));
  const ours = env.OURTOKEN_MINT ?? env.NEXT_PUBLIC_OURTOKEN_MINT;
  if (ours) {
    list.push({
      mint: ours, symbol: env.OURTOKEN_SYMBOL ?? env.NEXT_PUBLIC_OURTOKEN_SYMBOL ?? "OURTOKEN", name: "quants",
      decimals: Number(env.OURTOKEN_DECIMALS ?? 6), graduation: Number(env.OURTOKEN_GRADUATION ?? env.NEXT_PUBLIC_OURTOKEN_GRADUATION ?? 0),
      iconMint: null, platform: true, payoutMin: 0n,
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

export const quoteCoin = (mint: string, list = quoteCoins()) => list.find((c) => c.mint === mint);
