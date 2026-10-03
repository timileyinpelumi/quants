import { PublicKey } from "@solana/web3.js";
import { KEEPER_LOW_LAMPORTS, ROLES, rolePath, solscanAccount } from "@/domain/platform-wallets";
import { clusterOf } from "@/cluster";
import type { WebContext } from "./context";

export type PlatformWallet = {
  role: string; index: number; path: string; address: string | null; solscan: string | null;
  lamports: string | null; low: boolean; usd: number | null;
};

export async function platformWallets(ctx: Pick<WebContext, "conn" | "platformAddresses">, solUsd: number | null = null): Promise<PlatformWallet[]> {
  const cluster = clusterOf();
  return Promise.all(ROLES.map(async (role, index) => {
    const address = ctx.platformAddresses[role] ?? null;
    const lamports = address
      ? await ctx.conn.getBalance(new PublicKey(address), "confirmed").then((n) => BigInt(n), () => null)
      : null;
    return {
      role, index, path: rolePath(role), address,
      solscan: address ? solscanAccount(address, cluster) : null,
      lamports: lamports === null ? null : lamports.toString(),
      low: role === "keeper" && lamports !== null && lamports < KEEPER_LOW_LAMPORTS,
      usd: lamports === null || solUsd === null ? null : (Number(lamports) / 1e9) * solUsd,
    };
  }));
}
