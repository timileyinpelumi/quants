import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackMint, getPausableConfig, getScaledUiAmountConfig, getTransferFeeConfig, getTransferHook,
  type Mint,
} from "@solana/spl-token";

export const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
export const TOKEN_2022_PROGRAM = TOKEN_2022_PROGRAM_ID.toBase58();

export interface MintInfo { program: PublicKey; decimals: number; mint: Mint }

export function readMint(address: PublicKey, info: AccountInfo<Buffer>): MintInfo {
  if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(`${address.toBase58()} is not a token mint`);
  }
  const mint = unpackMint(address, info, info.owner);
  return { program: info.owner, decimals: mint.decimals, mint };
}

/** Reads a classic or Token-2022 mint; spl-token's getMint assumes the classic program unless told otherwise. */
export async function fetchMint(conn: Pick<Connection, "getAccountInfo">, mint: string): Promise<MintInfo> {
  const key = new PublicKey(mint);
  const info = await conn.getAccountInfo(key, "confirmed");
  if (!info) throw new Error(`mint ${mint} not found`);
  return readMint(key, info);
}

export const mintPaused =(m: Mint) => getPausableConfig(m)?.paused ?? false;

/** The multiplier wallets apply to raw amounts for display; 1 for mints without the scaled UI amount extension. */
export function uiMultiplier(m: Mint, nowSeconds = Math.floor(Date.now() / 1000)): number {
  const c = getScaledUiAmountConfig(m);
  if (!c) return 1;
  return nowSeconds >= Number(c.newMultiplierEffectiveTimestamp) ? c.newMultiplier : c.multiplier;
}

/** Why a mint cannot be a stock pair, or null when it can. */
export function stockMintProblem(info: MintInfo): string | null {
  if (!info.program.equals(TOKEN_2022_PROGRAM_ID)) return "not a Token-2022 mint";
  if (getTransferFeeConfig(info.mint)) return "has a transfer fee";
  const hook = getTransferHook(info.mint);
  if (hook && !hook.programId.equals(PublicKey.default)) return "has a transfer hook program";
  return null;
}

// Token-2022 fails transfers on a paused mint with custom error 0x43 and logs that it is paused.
export function isPausedError(e: unknown): boolean {
  const logs = (e as { logs?: unknown })?.logs;
  const text = `${e instanceof Error ? e.message : String(e)} ${Array.isArray(logs) ? logs.join(" ") : ""}`;
  return /custom program error: 0x43\b/.test(text) || /\bis paused\b/i.test(text);
}
