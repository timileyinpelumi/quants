import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const BLOCKHASH = "11111111111111111111111111111111";
const payer = (owner?: string) => {
  try { return owner ? new PublicKey(owner) : Keypair.generate().publicKey; } catch { return Keypair.generate().publicKey; }
};

/** An unsigned legacy transaction paid by `owner`, standing in for what a builder returns. */
export function fakeTx(owner?: string): string {
  const p = payer(owner);
  return new Transaction({ feePayer: p, recentBlockhash: BLOCKHASH })
    .add(SystemProgram.transfer({ fromPubkey: p, toPubkey: p, lamports: 1 }))
    .serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/** An unsigned v0 transaction, like a Jupiter swap. */
export function fakeV0Tx(owner?: string): string {
  const p = payer(owner);
  const msg = new TransactionMessage({ payerKey: p, recentBlockhash: BLOCKHASH, instructions: [SystemProgram.transfer({ fromPubkey: p, toPubkey: p, lamports: 1 })] }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}
