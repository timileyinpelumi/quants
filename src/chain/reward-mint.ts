import { PublicKey, type Connection } from "@solana/web3.js";
import { ExtensionType, getExtensionTypes } from "@solana/spl-token";
import { readMint, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, type MintInfo } from "./mints";

/**
 * Token-2022 extensions a reward mint may carry. Kamino Farms accepts more (transfer fee, transfer hook, permanent
 * delegate, default account state), but those can tax, block or take tokens out of a reward vault, so they stay out.
 */
export const REWARD_EXTENSIONS: ReadonlySet<ExtensionType> = new Set([
  ExtensionType.MetadataPointer, ExtensionType.TokenMetadata, ExtensionType.MintCloseAuthority, ExtensionType.ConfidentialTransferMint,
]);

const name = (e: ExtensionType) => (ExtensionType[e] ?? `extension ${e}`).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** Why this mint cannot be a reward token, or null when it can: classic SPL, or Token-2022 with allowed extensions only. */
export function rewardMintProblem(info: MintInfo): string | null {
  const program = info.program.toBase58();
  if (program === TOKEN_PROGRAM) return null;
  if (program !== TOKEN_2022_PROGRAM) return "is not a token mint";
  const other = getExtensionTypes(info.mint.tlvData).filter((e) => !REWARD_EXTENSIONS.has(e));
  return other.length ? `has the ${other.map(name).join(" and ")} extension${other.length > 1 ? "s" : ""}` : null;
}

/**
 * Checks reward mints on chain, a hundred per request. Extensions are fixed when a mint is created, so each answer is
 * kept for the life of the process; a mint that does not exist is not remembered.
 */
export function rewardMintChecker(conn: Pick<Connection, "getMultipleAccountsInfo">) {
  const known = new Map<string, { program: string; problem: string | null }>();
  return async (mints: string[]): Promise<Map<string, { program: string; problem: string | null }>> => {
    const missing = [...new Set(mints.filter((m) => !known.has(m)))];
    for (let i = 0; i < missing.length; i += 100) {
      const keys = missing.slice(i, i + 100);
      const infos = await conn.getMultipleAccountsInfo(keys.map((k) => new PublicKey(k)), "confirmed");
      keys.forEach((m, j) => {
        const info = infos[j];
        if (!info) return;
        try {
          const mint = readMint(new PublicKey(m), info);
          known.set(m, { program: mint.program.toBase58(), problem: rewardMintProblem(mint) });
        } catch {
          known.set(m, { program: info.owner.toBase58(), problem: "is not a token mint" });
        }
      });
    }
    return new Map(mints.map((m) => [m, known.get(m) ?? { program: "", problem: "was not found on chain" }]));
  };
}
export type RewardMintCheck = ReturnType<typeof rewardMintChecker>;
