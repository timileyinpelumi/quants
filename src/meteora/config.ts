import {
  buildCurve, ActivationType, BaseFeeMode, CollectFeeMode, MigrationOption, MigrationFeeOption, TokenDecimal, TokenType,
  TokenAuthorityOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export { FEE_TIERS_BPS } from "../domain/fees";
export interface QuoteSpec { mint: string; decimals: number; migrationQuoteThreshold: number }

export function buildQuantsConfig(feeBps: number, quote: QuoteSpec): ConfigParameters {
  return buildCurve({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: quote.decimals,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: feeBps, endingFeeBps: feeBps, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.QuoteToken, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: feeBps },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: quote.migrationQuoteThreshold,
  });
}

/** Why this target cannot become a config key at one of these fees (the SDK refuses some), or null when it can. */
export function curveProblem(quote: QuoteSpec, feesBps: number[]): string | null {
  for (const fee of feesBps) {
    try {
      buildQuantsConfig(fee, quote);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  return null;
}

export const configKeyName = (quoteMint: string, feeBps: number) => `${quoteMint}:${feeBps}`;
