import { test, expect } from "bun:test";
import { validateConfigParameters, bpsToFeeNumerator } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Keypair } from "@solana/web3.js";
import { buildQuantsConfig, FEE_TIERS_BPS } from "../../src/meteora/config";
import { NATIVE_MINT } from "../../src/domain/types";

const SOL = { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 85 };

test("creators pick a 1%, 2% or 3% trading fee", () => {
  expect([...FEE_TIERS_BPS]).toEqual([100, 200, 300]);
});

test("every tier builds a valid config with the fee we asked for", () => {
  for (const bps of FEE_TIERS_BPS) {
    const p = buildQuantsConfig(bps, SOL);
    expect(() => validateConfigParameters({ ...p, leftoverReceiver: Keypair.generate().publicKey })).not.toThrow();
    expect(p.poolFees.baseFee.cliffFeeNumerator.toString()).toBe(bpsToFeeNumerator(bps).toString());
    expect(p.creatorTradingFeePercentage).toBe(0);
    expect(p.collectFeeMode).toBe(0);
    expect(p.migrationOption).toBe(1);
    expect(p.partnerPermanentLockedLiquidityPercentage).toBe(100);
    expect(p.creatorPermanentLockedLiquidityPercentage + p.creatorLiquidityPercentage + p.partnerLiquidityPercentage).toBe(0);
  }
});

test("a first buy on a config that does not exist yet is quoted from its parameters", async () => {
  const { Connection } = await import("@solana/web3.js");
  const { MeteoraLive } = await import("../../src/meteora/port");
  const m = new MeteoraLive({ conn: new Connection("http://127.0.0.1:1") } as any, "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck");
  const small = await m.firstBuyMaxOut({ feeBps: 200, quote: SOL }, 100_000_000n);
  const big = await m.firstBuyMaxOut({ feeBps: 200, quote: SOL }, 10_000_000_000n);
  expect(small > 0n).toBe(true);
  expect(big > small).toBe(true);
  expect(big < 1_000_000_000n * 1_000_000n).toBe(true);
});
