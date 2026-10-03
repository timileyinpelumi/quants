import { test, expect } from "bun:test";
import BN from "bn.js";
import { calculateQuoteToBaseFromAmountIn, getFeeOnAmount } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { buildQuantsConfig, type QuoteSpec } from "../../src/meteora/config";
import { curveOfParams, firstBuyOut } from "../../src/meteora/first-buy";

const SOL: QuoteSpec = { mint: "So11111111111111111111111111111111111111112", decimals: 9, migrationQuoteThreshold: 85 };
const BONK: QuoteSpec = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5, migrationQuoteThreshold: 2_000_000_000 };
const CBBTC: QuoteSpec = { mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", decimals: 8, migrationQuoteThreshold: 0.12 };

// The same buy worked out by hand from the SDK's own pieces: fee off the input, then the curve from its start price.
function byHand(feeBps: number, quote: QuoteSpec, amountIn: bigint): bigint {
  const p = buildQuantsConfig(feeBps, quote);
  const curve = p.curve.filter((c) => !c.sqrtPrice.isZero() && !c.liquidity.isZero());
  const fee = getFeeOnAmount(p.poolFees.baseFee.cliffFeeNumerator, new BN(amountIn.toString()), p.poolFees as never, false);
  const r = calculateQuoteToBaseFromAmountIn({ curve } as never, p.sqrtStartPrice, fee.amount, curve.at(-1)!.sqrtPrice);
  return BigInt(r.outputAmount.toString());
}

// Before the fee, as prepare's cap check sees it.
function noFee(quote: QuoteSpec, amountIn: bigint): bigint {
  const p = buildQuantsConfig(200, quote);
  const curve = p.curve.filter((c) => !c.sqrtPrice.isZero() && !c.liquidity.isZero());
  return BigInt(calculateQuoteToBaseFromAmountIn({ curve } as never, p.sqrtStartPrice, new BN(amountIn.toString()), curve.at(-1)!.sqrtPrice).outputAmount.toString());
}

test("a first buy matches the SDK swap math with the fee taken from the input", () => {
  for (const [quote, amount] of [[SOL, 1_000_000_000n], [SOL, 123_456_789n], [BONK, 50_000_000_000_000n], [CBBTC, 100_000n]] as const) {
    for (const fee of [100, 200, 300]) {
      const out = firstBuyOut(curveOfParams(buildQuantsConfig(fee, quote)), amount);
      expect(out).toBe(byHand(fee, quote, amount));
    }
  }
});

test("the fee lowers what a first buy gets, and a higher fee lowers it more", () => {
  const amount = 2_000_000_000n;
  const at = (fee: number) => firstBuyOut(curveOfParams(buildQuantsConfig(fee, SOL)), amount)!;
  expect(at(100)).toBeLessThan(noFee(SOL, amount));
  expect(at(200)).toBeLessThan(at(100));
  expect(at(300)).toBeLessThan(at(200));
  // 2% off the input buys about 2% fewer tokens near the start of the curve
  expect(Number(at(200)) / Number(noFee(SOL, amount))).toBeCloseTo(0.98, 2);
});

test("1 SOL on a fresh 85 SOL curve buys a few percent of supply, and more SOL buys more", () => {
  const cfg = curveOfParams(buildQuantsConfig(200, SOL));
  const one = firstBuyOut(cfg, 1_000_000_000n)!;
  const share = Number(one) / 1e15;
  expect(share).toBeGreaterThan(0.005);
  expect(share).toBeLessThan(0.1);
  expect(firstBuyOut(cfg, 5_000_000_000n)!).toBeGreaterThan(one);
  expect(firstBuyOut(cfg, 0n)).toBe(0n);
});

test("a buy larger than the whole curve gets at most the curve's 80% of supply", () => {
  const out = firstBuyOut(curveOfParams(buildQuantsConfig(200, SOL)), 500n * 1_000_000_000n)!;
  expect(out).toBeLessThanOrEqual(800_000_000_000_000n);
  expect(out).toBeGreaterThan(790_000_000_000_000n);
});

test("pair tokens with few or many decimals and fractional targets build curves a first buy can use", () => {
  const permille = (quote: QuoteSpec) => firstBuyOut(curveOfParams(buildQuantsConfig(200, quote)), BigInt(Math.round((quote.migrationQuoteThreshold / 1000) * 10 ** quote.decimals)))!;
  // Every curve has the same shape relative to its target, so a thousandth of the target buys about the same share.
  const bonk = permille(BONK), btc = permille(CBBTC), sol = permille(SOL);
  for (const v of [bonk, btc, sol]) expect(Number(v) / 1e15).toBeGreaterThan(0.0001);
  expect(Number(bonk) / Number(sol)).toBeCloseTo(1, 1);
  expect(Number(btc) / Number(sol)).toBeCloseTo(1, 1);
});
