import { PublicKey } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountType, ExtensionType, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export type Ext = { type: ExtensionType; data: Buffer };

/** Raw mint account data; Token-2022 extensions go in the TLV area after the account type byte. */
export function mintData(decimals: number, exts: Ext[] = []): Buffer {
  const base = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({
    mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 0n, decimals, isInitialized: true,
    freezeAuthorityOption: 0, freezeAuthority: PublicKey.default,
  }, base);
  if (!exts.length) return base;
  const tlv = exts.map((e) => {
    const h = Buffer.alloc(4);
    h.writeUInt16LE(e.type, 0);
    h.writeUInt16LE(e.data.length, 2);
    return Buffer.concat([h, e.data]);
  });
  return Buffer.concat([base, Buffer.alloc(ACCOUNT_SIZE - MINT_SIZE), Buffer.from([AccountType.Mint]), ...tlv]);
}

export const pausable = (paused: boolean): Ext => ({ type: ExtensionType.PausableConfig, data: Buffer.concat([PublicKey.default.toBuffer(), Buffer.from([paused ? 1 : 0])]) });

export function scaledUi(multiplier: number, newMultiplier = multiplier, effectiveAt = 0n): Ext {
  const d = Buffer.alloc(32 + 8 + 8 + 8);
  d.writeDoubleLE(multiplier, 32);
  d.writeBigInt64LE(effectiveAt, 40);
  d.writeDoubleLE(newMultiplier, 48);
  return { type: ExtensionType.ScaledUiAmountConfig, data: d };
}

export const transferHook = (program: PublicKey): Ext => ({ type: ExtensionType.TransferHook, data: Buffer.concat([PublicKey.default.toBuffer(), program.toBuffer()]) });

export function transferFee(): Ext {
  return { type: ExtensionType.TransferFeeConfig, data: Buffer.alloc(108) };
}

export const mintAccount = (data: Buffer, token2022 = true) => ({
  owner: token2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID, data, lamports: 1_000_000, executable: false, rentEpoch: 0,
});
