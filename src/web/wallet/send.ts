import { Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export class SendError extends Error {
  constructor(message: string, public confirmed: string[] = [], public unconfirmed: string | null = null) { super(message); }
}
export type UnsignedTx = { base64: string; versioned: boolean };

export async function signAndSendAll(wallet: Pick<WalletContextState, "publicKey" | "signAllTransactions">, conn: Connection, txs: UnsignedTx[]): Promise<string[]> {
  if (!wallet.publicKey || !wallet.signAllTransactions) throw new SendError("Connect a wallet first.");
  const decoded = txs.map((t) => {
    const bytes = Buffer.from(t.base64, "base64");
    return t.versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes);
  });
  let signed: (Transaction | VersionedTransaction)[];
  try {
    signed = await wallet.signAllTransactions(decoded);
  } catch {
    throw new SendError("Transaction cancelled in your wallet.");
  }
  const sigs: string[] = [];
  for (const tx of signed) {
    let sig: string;
    try {
      sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    } catch (e) {
      throw new SendError(`The network rejected the transaction: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`, [...sigs]);
    }
    let res: Awaited<ReturnType<Connection["confirmTransaction"]>>;
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    } catch {
      throw new SendError("Transaction not confirmed yet. Check your wallet before trying again.", [...sigs], sig);
    }
    if (res.value.err) throw new SendError(`Transaction failed: ${JSON.stringify(res.value.err)}`, [...sigs]);
    sigs.push(sig);
  }
  return sigs;
}
