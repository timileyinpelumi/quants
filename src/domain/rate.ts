export function kaminoRawRps(totalBaseUnits: bigint, periodSeconds: number, rpsDecimals: number): bigint {
  if (periodSeconds <= 0) throw new Error("period must be positive");
  return (totalBaseUnits * 10n ** BigInt(rpsDecimals)) / BigInt(periodSeconds);
}
