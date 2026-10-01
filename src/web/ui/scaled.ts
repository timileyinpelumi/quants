// Token-2022 scaled UI amounts: wallets show raw * multiplier, while the chain and every transaction use raw amounts.
const ONE = 1_000_000_000n;
const fixed = (m: number) => BigInt(Math.round(m * 1e9));

/** Raw base units to the base units a wallet shows. */
export const rawToUi = (raw: bigint, multiplier = 1) => (multiplier === 1 ? raw : (raw * fixed(multiplier)) / ONE);

/** Base units a person typed (as a wallet shows them) back to raw base units, rounded down. */
export const uiToRaw = (ui: bigint, multiplier = 1) => (multiplier === 1 ? ui : (ui * ONE) / fixed(multiplier));
