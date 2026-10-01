import type { JupiterPort, VerifiedToken } from "@/jupiter/port";
import { ttlCache } from "@/domain/lru";

const caches = new WeakMap<JupiterPort, ReturnType<typeof ttlCache<VerifiedToken[]>>>();

/** Verified token search, cached for a minute per lowercased query. */
export function searchTokens(jupiter: JupiterPort, q: string): Promise<VerifiedToken[]> {
  let c = caches.get(jupiter);
  if (!c) { c = ttlCache<VerifiedToken[]>(60_000, 1_000); caches.set(jupiter, c); }
  return c.get(q.toLowerCase(), async () => (await jupiter.searchVerified(q)).slice(0, 20));
}
