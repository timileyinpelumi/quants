import type { SQL } from "bun";
import nacl from "tweetnacl";
import { Keypair, VersionedTransaction, type Connection, type VersionedMessage } from "@solana/web3.js";
import { LaunchError } from "@/launch/prepare";
import { simulationError, type WalletTx } from "./tx-check";

export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
const TTL_MS = 5 * 60_000;

/** Stores what the server built and the keypairs that sign it once the wallet has. The wallet gets the transaction with no signatures. */
export async function issueCosign(sql: SQL, t: WalletTx, signers: Keypair[], needLamports: bigint | null = null): Promise<WalletTx> {
  const id = crypto.randomUUID();
  const secrets = JSON.stringify(signers.map((k) => Array.from(k.secretKey)));
  await sql`delete from cosign_requests where created_at < now() - interval '1 hour'`;
  await sql`insert into cosign_requests (id, transaction, signers, need_lamports)
    values (${id}, ${t.base64}, ${secrets}::text::jsonb, ${needLamports === null ? null : needLamports.toString()}::numeric)`;
  return { ...t, cosign: id };
}

type Ix = { programId: string; keys: string[]; data: string };
const refuse = (why: string) => new LaunchError("cosign_refused", `Your wallet changed this transaction in a way quants cannot accept (${why}). Nothing was sent. Try again.`);

function instructions(m: VersionedMessage): Ix[] {
  if (m.addressTableLookups.length) throw refuse("address lookup tables");
  const keys = m.staticAccountKeys;
  return m.compiledInstructions.map((ix) => ({
    programId: keys[ix.programIdIndex]!.toBase58(),
    keys: ix.accountKeyIndexes.map((i) => `${keys[i]!.toBase58()}:${m.isAccountSigner(i) ? 1 : 0}${m.isAccountWritable(i) ? 1 : 0}`),
    data: Buffer.from(ix.data).toString("base64"),
  }));
}
const same = (a: Ix, b: Ix) => a.programId === b.programId && a.data === b.data && a.keys.join() === b.keys.join();
const signerKeys = (m: VersionedMessage) => m.staticAccountKeys.slice(0, m.header.numRequiredSignatures).map((k) => k.toBase58());
const writableKeys = (m: VersionedMessage) => new Set(m.staticAccountKeys.filter((_, i) => m.isAccountWritable(i)).map((k) => k.toBase58()));

/**
 * Wallets such as Phantom may add compute budget and Lighthouse guard instructions when they sign. Anything else is refused:
 * every original instruction must be there unchanged and in order, with the same fee payer, the same signers and no
 * account made writable except by an added Lighthouse instruction.
 */
export function checkWalletChanges(original: VersionedMessage, signed: VersionedMessage): void {
  if (!signed.staticAccountKeys[0]?.equals(original.staticAccountKeys[0]!)) throw refuse("fee payer");
  if (signerKeys(signed).sort().join() !== signerKeys(original).sort().join()) throw refuse("signers");
  const orig = instructions(original);
  let next = 0;
  const addedKeys = new Set<string>();
  for (const ix of instructions(signed)) {
    if (next < orig.length && same(ix, orig[next]!)) { next++; continue; }
    if (ix.programId === COMPUTE_BUDGET_PROGRAM || ix.programId === LIGHTHOUSE_PROGRAM) {
      for (const k of ix.keys) addedKeys.add(k.split(":")[0]!);
      continue;
    }
    throw refuse("an instruction was added or changed");
  }
  if (next < orig.length) throw refuse("an instruction is missing");
  const was = writableKeys(original);
  for (const k of writableKeys(signed)) if (!was.has(k) && !addedKeys.has(k)) throw refuse("a new writable account");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Checks the wallet-signed transaction against the one issued under `id`, adds the server signatures, simulates it
 * with signature checks and sends it. Returns the signature for the client to confirm.
 */
export async function cosignAndSend(
  deps: { sql: SQL; conn: Pick<Connection, "simulateTransaction" | "sendRawTransaction"> & Partial<Pick<Connection, "getSignatureStatuses">>; retryDelayMs?: number },
  i: { id: string; transaction: string },
): Promise<string> {
  const [row] = await deps.sql`select transaction, signers, need_lamports, created_at from cosign_requests where id = ${i.id}`;
  if (!row || Date.now() - new Date(row.created_at).getTime() > TTL_MS) {
    throw new LaunchError("blockhash_expired", "This transaction expired before it was sent. Nothing was sent. Try again.");
  }
  const original = VersionedTransaction.deserialize(Buffer.from(row.transaction, "base64"));
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(i.transaction, "base64"));
  } catch {
    throw new LaunchError("invalid_input", "The signed transaction could not be read. Try again.");
  }
  checkWalletChanges(original.message, tx.message);
  const secrets = (typeof row.signers === "string" ? JSON.parse(row.signers) : row.signers) as number[][];
  const servers = secrets.map((s) => Keypair.fromSecretKey(Uint8Array.from(s)));
  const serverKeys = new Set(servers.map((k) => k.publicKey.toBase58()));
  const message = tx.message.serialize();
  signerKeys(tx.message).forEach((k, idx) => {
    if (serverKeys.has(k)) return;
    if (!nacl.sign.detached.verify(message, tx.signatures[idx]!, tx.message.staticAccountKeys[idx]!.toBytes())) {
      throw new LaunchError("cosign_refused", "Your wallet did not sign this transaction. Nothing was sent. Try again.");
    }
  });
  tx.sign(servers);
  const need = row.need_lamports == null ? undefined : BigInt(row.need_lamports);
  for (let attempt = 0; ; attempt++) {
    let res: Awaited<ReturnType<Connection["simulateTransaction"]>>;
    try {
      res = await deps.conn.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
    } catch {
      throw new LaunchError("simulation_failed", "Could not check this transaction with the network right now. Nothing was sent. Try again in a moment.");
    }
    const err = res.value.err;
    if (!err) break;
    // A load balanced RPC can be a few slots behind the node the wallet read its blockhash from.
    if (err === "BlockhashNotFound" && attempt === 0) { await sleep(deps.retryDelayMs ?? 1500); continue; }
    if (err === "BlockhashNotFound") throw new LaunchError("blockhash_expired", "The network moved on before this was sent. Nothing was sent. Try again.");
    throw simulationError(err, res.value.logs ?? [], need);
  }
  try {
    const raw = tx.serialize();
    const sig = await deps.conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
    if (deps.conn.getSignatureStatuses) void rebroadcast(deps.conn as Pick<Connection, "sendRawTransaction" | "getSignatureStatuses">, raw, sig);
    return sig;
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), cosignSendFailed: String(e).slice(0, 300) }));
    throw new LaunchError("simulation_failed", "The network did not accept this transaction. Nothing was sent. Try again in a moment.");
  }
}

// RETRY-LOOP-SAFETY: at most 30 resends, 2s apart (about a minute, inside the blockhash lifetime); stops as soon as the
//   signature is confirmed or failed. Resending the same signed bytes cannot double spend: it is one transaction.
async function rebroadcast(conn: Pick<Connection, "sendRawTransaction" | "getSignatureStatuses">, raw: Uint8Array, sig: string) {
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    try {
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st?.err || st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return;
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (e) {
      if (/blockhash not found|expired/i.test(String(e))) return;
    }
  }
}
