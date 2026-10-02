import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";

export const TOKEN_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const CREATE_METADATA_ACCOUNT_V3 = 33;

export const metadataAddress = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA_PROGRAM.toBuffer(), mint.toBuffer()], TOKEN_METADATA_PROGRAM)[0];

const str = (s: string) => {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

/** Metaplex CreateMetadataAccountV3, hand encoded so scripts do not need the Metaplex SDK. Mutable, no creators, no collection. */
export function createMetadataIx(i: { mint: PublicKey; authority: PublicKey; payer: PublicKey; name: string; symbol: string; uri: string }): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([CREATE_METADATA_ACCOUNT_V3]),
    str(i.name), str(i.symbol), str(i.uri),
    Buffer.from([0, 0]), // seller fee bps (u16)
    Buffer.from([0, 0, 0]), // creators, collection, uses: None
    Buffer.from([1]), // is mutable
    Buffer.from([0]), // collection details: None
  ]);
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM,
    keys: [
      { pubkey: metadataAddress(i.mint), isSigner: false, isWritable: true },
      { pubkey: i.mint, isSigner: false, isWritable: false },
      { pubkey: i.authority, isSigner: true, isWritable: false },
      { pubkey: i.payer, isSigner: true, isWritable: true },
      { pubkey: i.authority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}
