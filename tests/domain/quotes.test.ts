import { test, expect } from "bun:test";
import { quoteCoins, quoteCoin } from "../../src/domain/quotes";

const env = { OURTOKEN_MINT: "Ours111111111111111111111111111111111111111", OURTOKEN_SYMBOL: "QUANTS", OURTOKEN_DECIMALS: "6", OURTOKEN_GRADUATION: "100000" };

test("mainnet list is SOL, USDC, USDT, JUP and the platform token", () => {
  const q = quoteCoins(env);
  expect(q.map((c) => c.symbol)).toEqual(["SOL", "USDC", "USDT", "JUP", "QUANTS"]);
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
  expect(q.map((c) => [c.symbol, c.graduation])).toEqual([["SOL", 120], ["USDC", 12_000], ["USDT", 12_000], ["JUP", 30_000], ["QUANTS", 250_000]]);
});

test("QUOTE_GRADUATIONS rejects unknown symbols and targets that are not positive", () => {
  expect(() => quoteCoins({ ...env, QUOTE_GRADUATIONS: JSON.stringify({ BONK: 5 }) })).toThrow("BONK");
  expect(() => quoteCoins({ ...env, QUOTE_GRADUATIONS: JSON.stringify({ SOL: 0 }) })).toThrow("SOL");
  expect(() => quoteCoins({ ...env, QUOTE_GRADUATIONS: JSON.stringify({ SOL: "lots" }) })).toThrow("SOL");
});

test("the platform token ticker defaults to QUANTS", () => {
  expect(quoteCoins({ OURTOKEN_MINT: env.OURTOKEN_MINT }).at(-1)).toMatchObject({ symbol: "QUANTS", platform: true });
});

test("the platform token is left out when it is not configured", () => {
  expect(quoteCoins({}).map((c) => c.symbol)).toEqual(["SOL", "USDC", "USDT", "JUP"]);
});
