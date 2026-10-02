import { PublicKey, Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export class SendError extends Error {
  constructor(message: string, public confirmed: string[] = [], public unconfirmed: string | null = null) { super(message); }
}
/**
 * `signatures`: signatures the server already made over this exact message (a new mint, a new config key). They are
 * added after the wallet signs, so the wallet sees and signs the transaction first.
 * `optional`: the flow goes on if it fails (a config key another launch created first).
 */
export type UnsignedTx = { base64: string; versioned: boolean; optional?: boolean; signatures?: { publicKey: string; signature: string }[] };
export type Wallet = Pick<WalletContextState, "publicKey" | "sendTransaction" | "signTransaction">;

const decode = (t: UnsignedTx) => {
  const bytes = Buffer.from(t.base64, "base64");
  return t.versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes);
};
const messageOf = (tx: Transaction | VersionedTransaction) => (tx instanceof Transaction ? tx.serializeMessage() : Buffer.from(tx.message.serialize()));
const firstLine = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const CANCELLED = "Transaction cancelled in your wallet.";
const cancelled = (e: unknown) => /reject|cancel|denied|declined|closed/i.test(firstLine(e) ?? "");

// Phantom can only check a transaction it signs and sends itself, one at a time; a wallet-only transaction goes that way.
async function walletSends(wallet: Wallet, conn: Connection, t: UnsignedTx): Promise<string> {
  try {
    return await wallet.sendTransaction(decode(t), conn, { preflightCommitment: "confirmed", maxRetries: 3 });
  } catch (e) {
    if (cancelled(e)) throw new SendError(CANCELLED);
    throw new SendError(`The network rejected the transaction: ${firstLine(e)}`);
  }
}

async function cosignAndSend(wallet: Wallet, conn: Connection, t: UnsignedTx): Promise<string> {
  if (!wallet.signTransaction) throw new SendError("This wallet cannot sign this transaction. Try another wallet.");
  const tx = decode(t);
  const message = messageOf(tx);
  let signed: Transaction | VersionedTransaction;
  try {
    signed = await wallet.signTransaction(tx);
  } catch {
    throw new SendError(CANCELLED);
  }
  let raw: Uint8Array;
  try {
    if (!messageOf(signed).equals(message)) throw new Error("changed");
    for (const s of t.signatures ?? []) signed.addSignature(new PublicKey(s.publicKey), Buffer.from(s.signature, "base64"));
    raw = signed.serialize();
  } catch {
    throw new SendError("Your wallet changed this transaction, so it cannot be sent. Nothing was sent. Try again.");
  }
  try {
    return await conn.sendRawTransaction(raw, { preflightCommitment: "confirmed", maxRetries: 3 });
  } catch (e) {
    throw new SendError(`The network rejected the transaction: ${firstLine(e)}`);
  }
}

/** Sends one transaction and waits for it to confirm. Errors carry no confirmed signatures; `sendSequence` adds them. */
export async function sendOne(wallet: Wallet, conn: Connection, t: UnsignedTx): Promise<string> {
  if (!wallet.publicKey) throw new SendError("Connect a wallet first.");
  const sig = t.signatures?.length ? await cosignAndSend(wallet, conn, t) : await walletSends(wallet, conn, t);
  let res: Awaited<ReturnType<Connection["confirmTransaction"]>>;
  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  } catch {
    throw new SendError("Transaction not confirmed yet. Check your wallet before trying again.", [], sig);
  }
  if (res.value.err) throw new SendError(`Transaction failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

/**
 * Runs a flow one wallet prompt at a time. `next` is asked for each transaction only after the previous one
 * confirmed, so the server builds it against current chain state and the wallet can simulate it on its own.
 * It returns null when the flow is done. A failed optional transaction leaves an empty slot.
 */
export async function sendSequence(wallet: Wallet, conn: Connection, next: (sigs: string[]) => Promise<UnsignedTx | null>): Promise<string[]> {
  if (!wallet.publicKey) throw new SendError("Connect a wallet first.");
  const sigs: string[] = [];
  for (;;) {
    let t: UnsignedTx | null;
    try {
      t = await next([...sigs]);
    } catch (e) {
      throw e instanceof SendError ? new SendError(e.message, [...sigs], e.unconfirmed) : new SendError(firstLine(e) ?? "Something went wrong. Try again.", [...sigs]);
    }
    if (!t) return sigs;
    try {
      sigs.push(await sendOne(wallet, conn, t));
    } catch (e) {
      const err = e instanceof SendError ? e : new SendError(firstLine(e) ?? "Something went wrong. Try again.");
      if (t.optional && !err.unconfirmed && err.message !== CANCELLED) { sigs.push(""); continue; }
      throw new SendError(err.message, [...sigs], err.unconfirmed);
    }
  }
}
