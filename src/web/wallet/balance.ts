import type { PublicKey } from "@solana/web3.js";

/** Balance of the owner's associated account for `mint`, read through the server; null when it could not be read. */
export async function tokenBalance(_connection: unknown, mint: string, owner: PublicKey): Promise<bigint | null> {
  const r = await fetch(`/api/wallet/${owner.toBase58()}/balance?mint=${mint}`, { cache: "no-store" }).catch(() => null);
  if (!r?.ok) return null;
  const { amount } = await r.json() as { amount: string | null };
  return amount === null ? null : BigInt(amount);
}
