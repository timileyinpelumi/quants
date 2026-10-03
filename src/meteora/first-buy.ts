import BN from "bn.js";
import { swapQuoteExactIn, type ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";

type Fees = { baseFee: { cliffFeeNumerator: BN; firstFactor: number; secondFactor: BN; thirdFactor: BN; baseFeeMode: number }; dynamicFee: { initialized: number } };

/** The parts of a DBC config a first buy depends on: an on-chain PoolConfig has them, and so does curveOfParams. */
export type CurveConfig = {
  poolFees: Fees; collectFeeMode: number; migrationQuoteThreshold: BN; sqrtStartPrice: BN; migrationSqrtPrice: BN;
  curve: { sqrtPrice: BN; liquidity: BN }[];
};

/** The curve a config key created from these parameters will have; it ends at the migration price. */
export function curveOfParams(p: ConfigParameters): CurveConfig {
  const curve = p.curve.filter((c) => !c.sqrtPrice.isZero() && !c.liquidity.isZero());
  return {
    poolFees: { baseFee: p.poolFees.baseFee as Fees["baseFee"], dynamicFee: { initialized: 0 } },
    collectFeeMode: p.collectFeeMode, migrationQuoteThreshold: p.migrationQuoteThreshold, sqrtStartPrice: p.sqrtStartPrice,
    migrationSqrtPrice: curve.at(-1)!.sqrtPrice, curve,
  };
}

const ZERO = new BN(0);
const freshPool = (cfg: CurveConfig) => ({
  poolState: {
    sqrtPrice: cfg.sqrtStartPrice, quoteReserve: ZERO, activationPoint: ZERO,
    volatilityTracker: { lastUpdateTimestamp: ZERO, padding: [], sqrtPriceReference: ZERO, volatilityAccumulator: ZERO, volatilityReference: ZERO },
  },
});

/**
 * Base units a first buy of `quoteAmount` gets from a fresh curve, with the trading fee taken from the input as the
 * program does, or null when the buy is larger than the whole curve.
 */
export function firstBuyOut(cfg: CurveConfig, quoteAmount: bigint): bigint | null {
  if (quoteAmount <= 0n) return 0n;
  try {
    const r = swapQuoteExactIn(freshPool(cfg) as never, cfg as never, false, new BN(quoteAmount.toString()), 0, false, ZERO, false);
    return BigInt(r.outputAmount.toString());
  } catch (e) {
    if (e instanceof Error && /Insufficient Liquidity/.test(e.message)) return null;
    throw e;
  }
}
