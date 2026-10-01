import { BPS, type FeeSplit } from "./types";

export function splitByWeights<K extends string>(amount: bigint, entries: { key: K; weight: bigint }[]): Map<K, bigint> {
  const out = new Map<K, bigint>();
  const total = entries.reduce((a, e) => a + e.weight, 0n);
  if (total === 0n || amount === 0n) return out;
  let given = 0n;
  let last: K | undefined;
  for (const e of entries) {
    if (e.weight === 0n) continue;
    const share = (amount * e.weight) / total;
    out.set(e.key, share);
    given += share;
    last = e.key;
  }
  out.set(last!, out.get(last!)! + amount - given);
  return out;
}

// Trading only launches have no stakers, so the basket share goes to the platform and creator in proportion to theirs.
export function splitFees(amount: bigint, s: FeeSplit, tradingOnly = false) {
  if (amount < 0n) throw new Error("negative amount");
  if (tradingOnly) {
    const total = BigInt(s.platformBps + s.creatorBps);
    const platform = total === 0n ? amount : (amount * BigInt(s.platformBps)) / total;
    return { basket: 0n, platform, creator: amount - platform };
  }
  const platform = (amount * BigInt(s.platformBps)) / BPS;
  const creator = (amount * BigInt(s.creatorBps)) / BPS;
  return { basket: amount - platform - creator, platform, creator };
}

export function allocateAcrossTiers(amount: bigint, tiers: { tierId: string; staked: bigint; multiplierBps: number }[]) {
  return splitByWeights(amount, tiers.map((t) => ({ key: t.tierId, weight: t.staked * BigInt(t.multiplierBps) })));
}
