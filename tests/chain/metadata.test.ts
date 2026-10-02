import { test, expect } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createMetadataIx, metadataAddress, TOKEN_METADATA_PROGRAM } from "../../src/chain/metadata";

test("encodes CreateMetadataAccountV3 with borsh strings and no creators", () => {
  const mint = Keypair.generate().publicKey, keeper = Keypair.generate().publicKey;
  const ix = createMetadataIx({ mint, authority: keeper, payer: keeper, name: "ab", symbol: "C", uri: "https://u" });
  expect(ix.programId.equals(TOKEN_METADATA_PROGRAM)).toBe(true);
  expect([...ix.data]).toEqual([
    33,
    2, 0, 0, 0, 97, 98,
    1, 0, 0, 0, 67,
    9, 0, 0, 0, ...Buffer.from("https://u"),
    0, 0,
    0, 0, 0,
    1,
    0,
  ]);
  expect(ix.keys[0]!.pubkey.equals(metadataAddress(mint))).toBe(true);
  expect(ix.keys[0]!.isWritable).toBe(true);
  expect(ix.keys[2]!.isSigner && ix.keys[3]!.isSigner && ix.keys[3]!.isWritable).toBe(true);
});

test("the metadata address is the Metaplex PDA", () => {
  const mint = new PublicKey("So11111111111111111111111111111111111111112");
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA_PROGRAM.toBuffer(), mint.toBuffer()], TOKEN_METADATA_PROGRAM);
  expect(metadataAddress(mint).equals(pda)).toBe(true);
});
