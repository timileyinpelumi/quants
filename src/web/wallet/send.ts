import { Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export class SendError extends Error {
  constructor(message: string, public confirmed: string[] = [], public unconfirmed: string | null = null) { super(message); }
}
/**
 * `cosign`: the transaction also needs server signatures (a new mint, a new config key). The wallet signs it first and
 * the server checks what the wallet signed, adds its signatures and sends it.
 */
export type UnsignedTx = { base64: string; versioned: boolean; cosign?: string };
export type Wallet = Pick<WalletContextState, "publicKey" | "sendTransaction" | "signTransaction">;
/** Hands the wallet-signed transaction to the server, which signs, sends and returns the signature. */
export type Cosign = (id: string, signedBase64: string) => Promise<string>;

const decode = (t: UnsignedTx) => {
  const bytes = Buffer.from(t.base64, "base64");
  return t.versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes);
};
const firstLine = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const CANCELLED = "Transaction cancelled in your wallet.";
const cancelled = (e: unknown) => /reject|cancel|denied|declined|closed/i.test(firstLine(e) ?? "");

export const postCosign: Cosign = async (id, transaction) => {
  const r = await fetch("/api/launch/cosign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, transaction }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new SendError(j.error?.message ?? "Something went wrong. Try again.");
  return j.signature as string;
};

// Phantom can only check a transaction it signs and sends itself, one at a time; a wallet-only transaction goes that way.
async function walletSends(wallet: Wallet, conn: Connection, t: UnsignedTx): Promise<string> {
  try {
    return await wallet.sendTransaction(decode(t), conn, { preflightCommitment: "confirmed", maxRetries: 3 });
  } catch (e) {
    if (cancelled(e)) throw new SendError(CANCELLED);
    throw new SendError(`The network rejected the transaction: ${firstLine(e)}`);
  }
}

async function walletSignsFirst(wallet: Wallet, t: UnsignedTx & { cosign: string }, cosign: Cosign): Promise<string> {
  if (!wallet.signTransaction) throw new SendError("This wallet cannot sign this transaction. Try another wallet.");
  let signed: Transaction | VersionedTransaction;
  try {
    signed = await wallet.signTransaction(decode(t));
  } catch {
    throw new SendError(CANCELLED);
  }
  const raw = signed instanceof Transaction ? signed.serialize({ requireAllSignatures: false, verifySignatures: false }) : signed.serialize();
  return cosign(t.cosign, Buffer.from(raw).toString("base64"));
}

/** Sends one transaction and waits for it to confirm. Errors carry no confirmed signatures; `sendSequence` adds them. */
export async function sendOne(wallet: Wallet, conn: Connection, t: UnsignedTx, cosign: Cosign = postCosign): Promise<string> {
  if (!wallet.publicKey) throw new SendError("Connect a wallet first.");
  const sig = t.cosign ? await walletSignsFirst(wallet, { ...t, cosign: t.cosign }, cosign) : await walletSends(wallet, conn, t);
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
 * It returns null when the flow is done. Any failure stops the flow with its own error.
 */
export async function sendSequence(wallet: Wallet, conn: Connection, next: (sigs: string[]) => Promise<UnsignedTx | null>, cosign: Cosign = postCosign): Promise<string[]> {
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
      sigs.push(await sendOne(wallet, conn, t, cosign));
    } catch (e) {
      const err = e instanceof SendError ? e : new SendError(firstLine(e) ?? "Something went wrong. Try again.");
      throw new SendError(err.message, [...sigs], err.unconfirmed);
    }
  }
}
