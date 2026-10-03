import { test, expect } from "bun:test";
import { quoteCoins, quoteCoin, seedQuoteSettings } from "../../src/domain/quotes";
import { curveProblem } from "../../src/meteora/config";

const env = { OURTOKEN_MINT: "Ours111111111111111111111111111111111111111", OURTOKEN_SYMBOL: "QUANTS", OURTOKEN_DECIMALS: "6", OURTOKEN_GRADUATION: "100000" };

test("mainnet list is SOL, the stables, the added majors and the platform token", () => {
  const q = quoteCoins(env);
  expect(q.map((c) => c.symbol)).toEqual(["SOL", "USDC", "USDT", "JitoSOL", "mSOL", "cbBTC", "ETH", "BONK", "WIF", "RAY", "QUANTS"]);
  expect(q[1]).toMatchObject({ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, iconMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
  expect(q.at(-1)).toMatchObject({ mint: env.OURTOKEN_MINT, decimals: 6, graduation: 100_000, platform: true, iconMint: null });
  expect(q.every((c) => c.graduation > 0)).toBe(true);
});

test("a local validator swaps in its own mints but keeps mainnet icons", () => {
  const q = quoteCoins({ ...env, QUOTE_MINTS: JSON.stringify({ USDC: "LocalUsdc11111111111111111111111111111111111" }) });
  expect(quoteCoin("LocalUsdc11111111111111111111111111111111111", q)).toMatchObject({ symbol: "USDC", iconMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
  expect(quoteCoin("nope", q)).toBeUndefined();
});

test("QUOTE_GRADUATIONS overrides graduation targets by symbol", () => {
  const q = quoteCoins({ ...env, QUOTE_GRADUATIONS: JSON.stringify({ SOL: 120, QUANTS: 250000 }) });
  expect(q.map((c) => [c.symbol, c.graduation]).filter(([s]) => ["SOL", "USDC", "QUANTS", "BONK"].includes(s as string)))
    .toEqual([["SOL", 120], ["USDC", 12_000], ["BONK", 2_000_000_000], ["QUANTS", 250_000]]);
});

test("QUOTE_GRADUATIONS rejects unknown symbols and targets that are not positive", () => {
  expect(() => quoteCoins({ ...env, QUOTE_GRADUATIONS: JSON.stringify({ PEPE: 5 }) })).toThrow("PEPE");
  expect(() => quoteCoins({ ...env, QUOTE_GRADUATIONS: JSON.stringify({ SOL: 0 }) })).toThrow("SOL");
  expect(() => quoteCoins({ ...env, QUOTE_GRADUATIONS: JSON.stringify({ SOL: "lots" }) })).toThrow("SOL");
});

test("the platform token ticker defaults to QUANTS", () => {
  expect(quoteCoins({ OURTOKEN_MINT: env.OURTOKEN_MINT }).at(-1)).toMatchObject({ symbol: "QUANTS", platform: true });
});

test("the platform token is left out when it is not configured", () => {
  expect(quoteCoins({}).map((c) => c.symbol)).toEqual(["SOL", "USDC", "USDT", "JitoSOL", "mSOL", "cbBTC", "ETH", "BONK", "WIF", "RAY"]);
});

test("the added pairs are classic mainnet mints with icons, enabled by default, and every target builds a curve at every fee tier", () => {
  const q = quoteCoins({});
  for (const c of q) {
    expect(c.iconMint).toBe(c.mint);
    expect(c.enabled).toBe(true);
    expect(c.payoutMin).toBeGreaterThan(0n);
    expect(curveProblem({ mint: c.mint, decimals: c.decimals, migrationQuoteThreshold: c.graduation }, [25, 50, 100, 200, 300, 500, 1000]), c.symbol).toBeNull();
  }
  expect(quoteCoin("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", q)).toMatchObject({ symbol: "cbBTC", decimals: 8, graduation: 0.12 });
  expect(quoteCoin("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", q)).toMatchObject({ symbol: "BONK", decimals: 5, payoutMin: 150_000_000_000n });
});

test("settings saved before the added pairs existed load with them enabled at their default targets", () => {
  const s = seedQuoteSettings({});
  const old = { quotes: { SOL: s.quotes.SOL!, USDC: s.quotes.USDC!, USDT: { enabled: false, graduation: 40_000 } }, platformToken: s.platformToken };
  const q = quoteCoins(undefined, old);
  expect(quoteCoin("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", q)).toMatchObject({ symbol: "JitoSOL", enabled: true, graduation: 64 });
  expect(quoteCoin("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", q)).toMatchObject({ enabled: false, graduation: 40_000 });
});

test("the curve check refuses a target the SDK cannot build", () => {
  expect(curveProblem({ mint: "x", decimals: 5, migrationQuoteThreshold: 2_500_000_000 }, [200])).toMatch(/liquidity/i);
  expect(curveProblem({ mint: "x", decimals: 5, migrationQuoteThreshold: 2_000_000_000 }, [200])).toBeNull();
});
