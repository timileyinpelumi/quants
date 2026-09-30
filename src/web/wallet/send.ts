import { Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export class SendError extends Error {}
export type UnsignedTx = { base64: string; versioned: boolean };

export async function signAndSendAll(wallet: Pick<WalletContextState, "publicKey" | "signAllTransactions">, conn: Connection, txs: UnsignedTx[]): Promise<string[]> {
  if (!wallet.publicKey || !wallet.signAllTransactions) throw new SendError("Connect a wallet first");
  const decoded = txs.map((t) => {
    const bytes = Buffer.from(t.base64, "base64");
    return t.versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes);
  });
  let signed: (Transaction | VersionedTransaction)[];
  try {
    signed = await wallet.signAllTransactions(decoded);
  } catch {
    throw new SendError("You cancelled in your wallet");
  }
  const sigs: string[] = [];
  for (const tx of signed) {
    let sig: string;
    try {
      sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    } catch (e) {
      throw new SendError(`The network rejected the transaction: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new SendError(`The transaction failed: ${JSON.stringify(res.value.err)}`);
    sigs.push(sig);
  }
  return sigs;
}
