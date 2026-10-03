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
  /** A logo served by quants itself, for pairs whose Jupiter logo sits on an IPFS gateway that rate limits. */
  iconUrl?: string;
  platform: boolean;
  /** Default smallest creator payout, in base units, when settings do not set one for this mint. */
  payoutMin: bigint;
  kind: "crypto" | "xstocks" | "backpack";
  /** Tokenized stocks cannot back Kamino farms, so launches against them have no basket and no staking. */
  tradingOnly: boolean;
  /** New launches may pair with it (admin setting). Stocks are gated by the stock pairs switch instead. */
  enabled: boolean;
}

type Env = Record<string, string | undefined>;

/** The quote coin part of the admin settings: graduation targets and which pairs new launches may use. */
export type QuoteSettings = {
  quotes: Record<string, { enabled: boolean; graduation: number }>;
  platformToken: { mint: string; symbol: string; decimals: number; graduation: number; enabled: boolean };
};

const MAINNET: Pick<QuoteCoin, "mint" | "symbol" | "name" | "decimals" | "graduation" | "iconMint" | "iconUrl" | "payoutMin">[] = [
  { mint: NATIVE_MINT, symbol: "SOL", name: "Solana", decimals: 9, graduation: 85, iconMint: NATIVE_MINT, payoutMin: 50_000_000n },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, graduation: 12_000, iconMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payoutMin: 5_000_000n },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6, graduation: 12_000, iconMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", payoutMin: 5_000_000n },
  // Classic SPL, Jupiter verified, checked on mainnet 2026-10-03. Targets are near $10,000 and payout minimums near $5 at
  // that day's prices. BONK's target stays at 2B because the DBC curve does not build above about 2.0B BONK (5 decimals).
  ...([
    ["JitoSOL", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", "Jito Staked SOL", 9, 64, 40_000_000n],
    ["mSOL", "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", "Marinade staked SOL", 9, 60, 40_000_000n],
    ["cbBTC", "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", "Coinbase Wrapped BTC", 8, 0.12, 6_000n, "/tokens/cbbtc.png"],
    ["ETH", "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", "Ether (Wormhole)", 8, 3.7, 200_000n],
    ["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "Bonk", 5, 2_000_000_000, 150_000_000_000n],
    ["WIF", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "dogwifhat", 6, 40_000, 20_000_000n, "/tokens/wif.png"],
    ["RAY", "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", "Raydium", 6, 4_800, 2_500_000n],
  ] as [string, string, string, number, number, bigint, string?][]).map(([symbol, mint, name, decimals, graduation, payoutMin, iconUrl]) => ({ mint, symbol, name, decimals, graduation, iconMint: mint, payoutMin, ...(iconUrl ? { iconUrl } : {}) })),
];
export const BUILTIN_QUOTE_SYMBOLS = MAINNET.map((c) => c.symbol);

/** What the env says, used to seed the first settings version on a fresh database. */
export function seedQuoteSettings(env: Env = process.env): QuoteSettings {
  const quotes = Object.fromEntries(MAINNET.map((c) => [c.symbol, { enabled: true, graduation: c.graduation }]));
  const mint = env.OURTOKEN_MINT ?? "";
  const platformToken = {
    mint, symbol: env.OURTOKEN_SYMBOL ?? "QUANTS",
    decimals: Number(env.OURTOKEN_DECIMALS ?? 6), graduation: Number(env.OURTOKEN_GRADUATION ?? 0), enabled: !!mint,
  };
  const targets = env.QUOTE_GRADUATIONS ? (JSON.parse(env.QUOTE_GRADUATIONS) as Record<string, unknown>) : {};
  for (const [symbol, target] of Object.entries(targets)) {
    const own = mint && symbol === platformToken.symbol;
    if (!quotes[symbol] && !own) throw new Error(`QUOTE_GRADUATIONS names ${symbol}, which is not a pair token`);
    if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) throw new Error(`QUOTE_GRADUATIONS target for ${symbol} must be a positive number`);
    if (own) platformToken.graduation = target;
    else quotes[symbol]!.graduation = target;
  }
  return { quotes, platformToken };
}

// The quote settings this process last loaded (loadLatestSettings sets it), so synchronous lookups follow the admin page.
const g = globalThis as { __quantsStocks?: QuoteCoin[]; __quantsQuoteSettings?: QuoteSettings };
export const setQuoteSettings = (s: QuoteSettings) => { g.__quantsQuoteSettings = s; };

/** With an explicit env the env seed is used (scripts, tests); otherwise the last loaded settings. */
export function quoteCoins(env?: Env, s?: QuoteSettings): QuoteCoin[] {
  const e = env ?? process.env;
  const q = s ?? (env ? seedQuoteSettings(env) : g.__quantsQuoteSettings ?? seedQuoteSettings(process.env));
  const local = e.QUOTE_MINTS ? (JSON.parse(e.QUOTE_MINTS) as Record<string, string>) : {};
  const list: QuoteCoin[] = MAINNET.map((c) => ({
    ...c, mint: local[c.symbol] ?? c.mint, graduation: q.quotes[c.symbol]?.graduation ?? c.graduation, enabled: q.quotes[c.symbol]?.enabled ?? true,
    platform: false, kind: "crypto", tradingOnly: false,
  }));
  const p = q.platformToken;
  // The platform token leads the list so every launch form shows it first.
  if (p.mint) {
    list.unshift({
      mint: p.mint, symbol: p.symbol, name: "quants", decimals: p.decimals, graduation: p.graduation, enabled: p.enabled,
      iconMint: null, platform: true, payoutMin: 0n, kind: "crypto", tradingOnly: false,
    });
  }
  return list;
}

export const setStockQuotes = (list: QuoteCoin[]) => { g.__quantsStocks = list; };
export const stockQuotes = (): QuoteCoin[] => g.__quantsStocks ?? [];

export const quoteCoin = (mint: string, list = [...quoteCoins(), ...stockQuotes()]) => list.find((c) => c.mint === mint);

/** Tokens the platform does not offer as a pair or as a reward. */
export const EXCLUDED_MINTS = new Set(["JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"]);
