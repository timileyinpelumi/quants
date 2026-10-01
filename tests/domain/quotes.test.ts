import { test, expect } from "bun:test";
import { quoteCoins, quoteCoin } from "../../src/domain/quotes";

const env = { OURTOKEN_MINT: "Ours111111111111111111111111111111111111111", OURTOKEN_SYMBOL: "QNT", OURTOKEN_DECIMALS: "6", OURTOKEN_GRADUATION: "100000" };

test("mainnet list is SOL, USDC, USDT, JUP and the platform token", () => {
  const q = quoteCoins(env);
  expect(q.map((c) => c.symbol)).toEqual(["SOL", "USDC", "USDT", "JUP", "QNT"]);
  expect(q[1]).toMatchObject({ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, iconMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
  expect(q.at(-1)).toMatchObject({ mint: env.OURTOKEN_MINT, decimals: 6, graduation: 100_000, platform: true, iconMint: null });
  expect(q.every((c) => c.graduation > 0)).toBe(true);
});

test("a local validator swaps in its own mints but keeps mainnet icons", () => {
  const q = quoteCoins({ ...env, QUOTE_MINTS: JSON.stringify({ USDC: "LocalUsdc11111111111111111111111111111111111" }) });
  expect(quoteCoin("LocalUsdc11111111111111111111111111111111111", q)).toMatchObject({ symbol: "USDC", iconMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
  expect(quoteCoin("nope", q)).toBeUndefined();
});

test("the platform token is left out when it is not configured", () => {
  expect(quoteCoins({}).map((c) => c.symbol)).toEqual(["SOL", "USDC", "USDT", "JUP"]);
});
