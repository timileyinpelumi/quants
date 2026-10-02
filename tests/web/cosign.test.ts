import { test, expect } from "bun:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { freshDb } from "../helpers/db";
import { cosignAndSend, issueCosign, LIGHTHOUSE_PROGRAM } from "../../src/web/server/cosign";
import { walletTx } from "../../src/web/server/tx-check";

const user = Keypair.generate();
const BLOCKHASH = "11111111111111111111111111111111";
const READONLY = Keypair.generate().publicKey;

function issued() {
  const mint = Keypair.generate();
  const t = new Transaction({ feePayer: user.publicKey, recentBlockhash: BLOCKHASH })
    .add(SystemProgram.createAccount({ fromPubkey: user.publicKey, newAccountPubkey: mint.publicKey, lamports: 1, space: 82, programId: SystemProgram.programId }))
    .add(new TransactionInstruction({ programId: SystemProgram.programId, keys: [{ pubkey: READONLY, isSigner: false, isWritable: false }], data: Buffer.from([1, 2]) }));
  t.partialSign(mint);
  return { mint, base64: t.serialize({ requireAllSignatures: false }).toString("base64") };
}

// What a wallet does: take the issued transaction, optionally change it, sign as the user.
function walletSigned(base64: string, change?: (t: Transaction) => Transaction) {
  let t = Transaction.from(Buffer.from(base64, "base64"));
  if (change) t = change(t);
  t.partialSign(user);
  return t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}
const rebuild = (t: Transaction, ixs: TransactionInstruction[]) => new Transaction({ feePayer: t.feePayer, recentBlockhash: t.recentBlockhash }).add(...ixs);

function fakeConn(errs: unknown[] = []) {
  const calls = { simulated: [] as { tx: VersionedTransaction; config: any }[], sent: [] as Buffer[] };
  return {
    calls,
    conn: {
      simulateTransaction: async (tx: VersionedTransaction, config: any) => { calls.simulated.push({ tx, config }); return { context: { slot: 1 }, value: { err: errs.shift() ?? null, logs: [] } }; },
      sendRawTransaction: async (raw: Buffer) => { calls.sent.push(Buffer.from(raw)); return "sig-sent"; },
    } as any,
  };
}

async function setup() {
  const sql = await freshDb();
  const { mint, base64 } = issued();
  const w = await issueCosign(sql, walletTx(base64), [mint]);
  return { sql, mint, w };
}

test("the issued transaction carries no signatures and an id; the server signs only after the wallet", async () => {
  const { sql, mint, w } = await setup();
  expect(w.cosign).toBeDefined();
  expect(VersionedTransaction.deserialize(Buffer.from(w.base64, "base64")).signatures.every((s) => s.every((b) => b === 0))).toBe(true);
  const { calls, conn } = fakeConn();
  expect(await cosignAndSend({ sql, conn }, { id: w.cosign!, transaction: walletSigned(w.base64) })).toBe("sig-sent");
  expect(calls.simulated[0]!.config).toEqual({ sigVerify: true, commitment: "confirmed" });
  const sent = Transaction.from(calls.sent[0]!);
  expect(sent.verifySignatures()).toBe(true);
  expect(sent.signatures.map((s) => s.publicKey.toBase58()).sort()).toEqual([user.publicKey.toBase58(), mint.publicKey.toBase58()].sort());
});

test("compute budget and Lighthouse instructions a wallet adds are accepted and signed over", async () => {
  const { sql, w } = await setup();
  const guard = Keypair.generate().publicKey;
  const signed = walletSigned(w.base64, (t) => rebuild(t, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ...t.instructions,
    new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM), keys: [{ pubkey: guard, isSigner: false, isWritable: false }, { pubkey: user.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([9]) }),
  ]));
  const { calls, conn } = fakeConn();
  expect(await cosignAndSend({ sql, conn }, { id: w.cosign!, transaction: signed })).toBe("sig-sent");
  const sent = Transaction.from(calls.sent[0]!);
  expect(sent.verifySignatures()).toBe(true);
  expect(sent.instructions.length).toBe(5);
});

test("any other change is refused and nothing is simulated or sent", async () => {
  const other = Keypair.generate();
  const changes: [string, (t: Transaction) => Transaction][] = [
    ["added transfer", (t) => rebuild(t, [...t.instructions, SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: other.publicKey, lamports: 5 })])],
    ["removed instruction", (t) => rebuild(t, [t.instructions[0]!])],
    ["reordered", (t) => rebuild(t, [t.instructions[1]!, t.instructions[0]!])],
    ["changed data", (t) => rebuild(t, [t.instructions[0]!, new TransactionInstruction({ ...t.instructions[1]!, data: Buffer.from([7]) })])],
    ["original account made writable", (t) => rebuild(t, [...t.instructions, new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM), keys: [{ pubkey: t.instructions[1]!.keys[0]!.pubkey, isSigner: false, isWritable: true }], data: Buffer.from([1]) })])],
  ];
  const sql = await freshDb();
  for (const [label, change] of changes) {
    const { mint, base64 } = issued();
    const w = await issueCosign(sql, walletTx(base64), [mint]);
    const { calls, conn } = fakeConn();
    const err = await cosignAndSend({ sql, conn }, { id: w.cosign!, transaction: walletSigned(w.base64, change) }).catch((e) => e);
    expect([label, err.code ?? String(err)]).toEqual([label, "cosign_refused"]);
    expect(calls.simulated.length + calls.sent.length).toBe(0);
  }
});

test("a different fee payer is refused", async () => {
  const { sql, w } = await setup();
  const { conn } = fakeConn();
  const payer = Keypair.generate();
  const t = Transaction.from(Buffer.from(w.base64, "base64"));
  const changed = new Transaction({ feePayer: payer.publicKey, recentBlockhash: BLOCKHASH }).add(...t.instructions);
  changed.partialSign(payer, user);
  const err = await cosignAndSend({ sql, conn }, { id: w.cosign!, transaction: changed.serialize({ requireAllSignatures: false }).toString("base64") }).catch((e) => e);
  expect(err.code).toBe("cosign_refused");
});

test("a transaction the wallet did not sign is refused", async () => {
  const { sql, w } = await setup();
  const { calls, conn } = fakeConn();
  const err = await cosignAndSend({ sql, conn }, { id: w.cosign!, transaction: w.base64 }).catch((e) => e);
  expect(err.code).toBe("cosign_refused");
  expect(calls.sent.length).toBe(0);
});

test("an unknown id is refused", async () => {
  const { sql, w } = await setup();
  const { conn } = fakeConn();
  const err = await cosignAndSend({ sql, conn }, { id: crypto.randomUUID(), transaction: walletSigned(w.base64) }).catch((e) => e);
  expect(err.code).toBe("blockhash_expired");
});

test("BlockhashNotFound from a lagging RPC is checked once more, then reported as expired", async () => {
  const { sql, w } = await setup();
  const once = fakeConn(["BlockhashNotFound"]);
  expect(await cosignAndSend({ sql, conn: once.conn, retryDelayMs: 0 }, { id: w.cosign!, transaction: walletSigned(w.base64) })).toBe("sig-sent");
  expect(once.calls.simulated.length).toBe(2);
  const twice = fakeConn(["BlockhashNotFound", "BlockhashNotFound"]);
  const err = await cosignAndSend({ sql, conn: twice.conn, retryDelayMs: 0 }, { id: w.cosign!, transaction: walletSigned(w.base64) }).catch((e) => e);
  expect(err.code).toBe("blockhash_expired");
  expect(twice.calls.sent.length).toBe(0);
});

test("a failed simulation is readable and nothing is sent", async () => {
  const { sql, w } = await setup();
  const { calls, conn } = fakeConn([{ InstructionError: [0, { Custom: 1 }] }]);
  const err = await cosignAndSend({ sql, conn }, { id: w.cosign!, transaction: walletSigned(w.base64) }).catch((e) => e);
  expect(err.code).toBe("simulation_failed");
  expect(calls.sent.length).toBe(0);
});

test("a shortage of SOL found after the wallet signed says how much the launch needs", async () => {
  const sql = await freshDb();
  const { mint, base64 } = issued();
  const w = await issueCosign(sql, walletTx(base64), [mint], 50_000_000n);
  const { conn } = fakeConn([{ InsufficientFundsForRent: { account_index: 0 } }]);
  const err = await cosignAndSend({ sql, conn }, { id: w.cosign!, transaction: walletSigned(w.base64) }).catch((e) => e);
  expect(err.message).toBe("Your wallet needs about 0.05 SOL for this launch. Add SOL and try again.");
});
