import { PublicKey, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// A mint's owner program never changes; stocks are Token-2022, so their ATAs differ from classic ones.
const programs = new Map<string, PublicKey>();

/** Balance of the owner's associated account for `mint`, derived under the mint's own token program. */
export async function tokenBalance(connection: Pick<Connection, "getAccountInfo" | "getTokenAccountBalance">, mint: string, owner: PublicKey): Promise<bigint> {
  let program = programs.get(mint);
  if (!program) {
    const info = await connection.getAccountInfo(new PublicKey(mint)).catch(() => null);
    if (!info) return 0n;
    program = info.owner;
    programs.set(mint, program);
  }
  const r = await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, program)).catch(() => null);
  return r ? BigInt(r.value.amount) : 0n;
}
