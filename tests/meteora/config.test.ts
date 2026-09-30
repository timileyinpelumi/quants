import { test, expect } from "bun:test";
import { validateConfigParameters, bpsToFeeNumerator } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Keypair } from "@solana/web3.js";
import { buildQuantsConfig, FEE_TIERS_BPS } from "../../src/meteora/config";
import { NATIVE_MINT } from "../../src/domain/types";

const SOL = { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 85 };

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
