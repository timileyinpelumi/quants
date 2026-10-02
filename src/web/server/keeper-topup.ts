import { PublicKey } from "@solana/web3.js";
import { ttlCache } from "@/domain/lru";
import { KEEPER_LOW_LAMPORTS } from "@/domain/platform-wallets";
import type { WebContext } from "./context";

/** What brings the keeper back to its floor; never more than the floor, nothing once it is funded. */
export const topUpFor = (balance: bigint): bigint => (balance >= KEEPER_LOW_LAMPORTS ? 0n : KEEPER_LOW_LAMPORTS - (balance < 0n ? 0n : balance));

const g = globalThis as { __quantsKeeperBalance?: ReturnType<typeof ttlCache<bigint | null>> };

/** The keeper's balance is read at most every 20 seconds; an RPC failure adds nothing. */
export async function keeperTopUp(ctx: Pick<WebContext, "conn" | "keeperAddress">): Promise<{ to: string; lamports: bigint } | null> {
  if (!ctx.keeperAddress) return null;
  const cache = (g.__quantsKeeperBalance ??= ttlCache<bigint | null>(20_000, 4));
  const balance = await cache.get(ctx.keeperAddress, async () =>
    BigInt(await ctx.conn.getBalance(new PublicKey(ctx.keeperAddress), "confirmed"))).catch(() => null);
  if (balance === null) return null;
  const lamports = topUpFor(balance);
  return lamports > 0n ? { to: ctx.keeperAddress, lamports } : null;
}

export const resetKeeperBalanceCache = () => { g.__quantsKeeperBalance = undefined; };
