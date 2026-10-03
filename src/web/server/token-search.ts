import { POPULAR_SIZE, type JupiterPort, type VerifiedToken } from "@/jupiter/port";
import type { RewardMintCheck } from "@/chain/reward-mint";
import { ttlCache } from "@/domain/lru";

const caches = new WeakMap<JupiterPort, ReturnType<typeof ttlCache<VerifiedToken[]>>>();

/** Verified token search, cached for a minute per lowercased query. */
export function searchTokens(jupiter: JupiterPort, q: string): Promise<VerifiedToken[]> {
  let c = caches.get(jupiter);
  if (!c) { c = ttlCache<VerifiedToken[]>(60_000, 1_000); caches.set(jupiter, c); }
  return c.get(q.toLowerCase(), async () => (await jupiter.searchVerified(q)).slice(0, 20));
}

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Tokens a basket can hold: classic ones, and Token-2022 ones whose extensions the on-chain check allows. */
export async function rewardTokens(check: RewardMintCheck, list: VerifiedToken[]): Promise<VerifiedToken[]> {
  const t22 = list.filter((t) => t.tokenProgram === TOKEN_2022).map((t) => t.mint);
  const found = t22.length ? await check(t22).catch(() => new Map<string, { problem: string | null }>()) : new Map();
  return list.filter((t) => t.tokenProgram !== TOKEN_2022 || found.get(t.mint)?.problem === null);
}

export const popularRewardTokens = async (jupiter: JupiterPort, check: RewardMintCheck) =>
  (await rewardTokens(check, await jupiter.popularVerified())).slice(0, POPULAR_SIZE);
