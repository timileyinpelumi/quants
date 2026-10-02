import { VersionedTransaction, type Connection, type TransactionError } from "@solana/web3.js";
import { LaunchError } from "@/launch/prepare";

/** What the wallet gets: server signatures travel beside the transaction and are added after the wallet signs. */
export type WalletTx = { base64: string; versioned: boolean; optional?: boolean; signatures?: { publicKey: string; signature: string }[] };

export const TX_LIMIT = 1232;

/** Moves any signatures already on the transaction (server signers) out of it, leaving empty slots for the wallet to sign first. */
export function walletTx(base64: string, opts: { versioned?: boolean; optional?: boolean } = {}): WalletTx {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const keys = tx.message.staticAccountKeys;
  const signatures: { publicKey: string; signature: string }[] = [];
  tx.signatures.forEach((s, i) => {
    if (!s.some((b) => b !== 0)) return;
    signatures.push({ publicKey: keys[i]!.toBase58(), signature: Buffer.from(s).toString("base64") });
    tx.signatures[i] = new Uint8Array(64);
  });
  return {
    base64: Buffer.from(tx.serialize()).toString("base64"), versioned: opts.versioned ?? false,
    ...(opts.optional ? { optional: true } : {}), ...(signatures.length ? { signatures } : {}),
  };
}

function readable(err: TransactionError, logs: string[]): string {
  const text = `${JSON.stringify(err)}\n${logs.join("\n")}`;
  if (err === "AccountNotFound") return "Your wallet has no SOL yet. Add SOL for network fees and try again.";
  if (err === "InsufficientFundsForFee") return "Your wallet does not have enough SOL for the network fee.";
  if (/InsufficientFundsForRent/.test(text)) return "Your wallet does not have enough SOL to cover the account rent for this.";
  if (/insufficient lamports|insufficient funds/i.test(text)) return "Your wallet does not have enough balance for this. Lower the amount and try again.";
  if (/slippage/i.test(text)) return "The price moved past your slippage. Get a fresh quote and try again.";
  if (err === "BlockhashNotFound") return "The network is busy. Try again in a moment.";
  return "This transaction would fail on chain right now, so it was not sent to your wallet. Try again in a moment.";
}

/** Refuses a transaction that is over the size limit or does not simulate on its own against current chain state. */
export async function checkTx(conn: Pick<Connection, "simulateTransaction">, t: { base64: string }): Promise<void> {
  const bytes = Buffer.from(t.base64, "base64");
  if (bytes.length > TX_LIMIT) throw new LaunchError("tx_too_large", "This transaction is too large to send. Try a shorter name or symbol.");
  const tx = VersionedTransaction.deserialize(bytes);
  let res: Awaited<ReturnType<Connection["simulateTransaction"]>>;
  try {
    res = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
  } catch {
    throw new LaunchError("simulation_failed", "Could not check this transaction with the network right now. Try again in a moment.");
  }
  if (!res.value.err) return;
  const logs = res.value.logs ?? [];
  console.error(JSON.stringify({ at: new Date().toISOString(), simulationFailed: res.value.err, logs: logs.slice(-8) }));
  throw new LaunchError("simulation_failed", readable(res.value.err, logs));
}
