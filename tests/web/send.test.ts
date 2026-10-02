import { test, expect } from "bun:test";
import { Keypair, Transaction, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { sendOne, sendSequence, SendError, type UnsignedTx } from "../../src/web/wallet/send";

const kp = Keypair.generate();
const mint = Keypair.generate();
const BLOCKHASH = "11111111111111111111111111111111";

const single = (): UnsignedTx => {
  const t = new Transaction({ feePayer: kp.publicKey, recentBlockhash: BLOCKHASH })
    .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  return { base64: t.serialize({ requireAllSignatures: false }).toString("base64"), versioned: false };
};
// A server signer (a new mint) whose signature travels beside the transaction, not inside it.
const cosigned = (): UnsignedTx => {
  const t = new Transaction({ feePayer: kp.publicKey, recentBlockhash: BLOCKHASH })
    .add(SystemProgram.createAccount({ fromPubkey: kp.publicKey, newAccountPubkey: mint.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId }));
  const base64 = t.serialize({ requireAllSignatures: false }).toString("base64");
  t.partialSign(mint);
  const sig = Buffer.from(t.signatures.find((s) => s.publicKey.equals(mint.publicKey))!.signature!).toString("base64");
  return { base64, versioned: false, signatures: [{ publicKey: mint.publicKey.toBase58(), signature: sig }] };
};

type Calls = { sent: Transaction[]; signed: Transaction[]; raw: Buffer[]; presigned: number[] };
const wallet = (calls: Calls, opts: { reject?: boolean; sendFail?: string; tamper?: boolean } = {}) => ({
  publicKey: kp.publicKey,
  sendTransaction: async (tx: Transaction) => {
    if (opts.reject) throw new Error("User rejected the request.");
    if (opts.sendFail) throw new Error(opts.sendFail);
    calls.sent.push(tx);
    return `sig${calls.sent.length + calls.raw.length - 1}`;
  },
  signTransaction: async (tx: Transaction) => {
    if (opts.reject) throw new Error("User rejected the request.");
    calls.presigned.push(tx.signatures.filter((s) => s.signature).length);
    const out = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
    if (opts.tamper) out.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 2 }));
    out.partialSign(kp);
    calls.signed.push(out);
    return out;
  },
}) as any;
const conn = (calls: Calls, fail = false) => ({
  sendRawTransaction: async (raw: Buffer) => { calls.raw.push(Buffer.from(raw)); return `sig${calls.sent.length + calls.raw.length - 1}`; },
  confirmTransaction: async () => ({ value: { err: fail ? { InstructionError: [0, "Custom"] } : null } }),
  getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 10 }),
}) as any;
const fresh = (): Calls => ({ sent: [], signed: [], raw: [], presigned: [] });

test("a wallet only transaction goes through the wallet's send, one prompt, no batch signing", async () => {
  const c = fresh();
  expect(await sendOne(wallet(c), conn(c), single())).toBe("sig0");
  expect(c.sent.length).toBe(1);
  expect(c.signed.length).toBe(0);
  expect(c.raw.length).toBe(0);
});

test("a transaction with a server signer is signed by the wallet first, then gets the server signature and is sent by us", async () => {
  const c = fresh();
  expect(await sendOne(wallet(c), conn(c), cosigned())).toBe("sig0");
  expect(c.sent.length).toBe(0);
  expect(c.signed.length).toBe(1);
  // the wallet saw no signatures before its own
  expect(c.presigned).toEqual([0]);
  const landed = VersionedTransaction.deserialize(c.raw[0]!);
  expect(landed.signatures.every((s) => s.some((b) => b !== 0))).toBe(true);
  expect(Transaction.from(c.raw[0]!).verifySignatures()).toBe(true);
});

test("a wallet that changes a cosigned transaction is refused before anything is sent", async () => {
  const c = fresh();
  const err = await sendOne(wallet(c, { tamper: true }), conn(c), cosigned()).catch((e) => e);
  expect(err).toBeInstanceOf(SendError);
  expect(err.message).toContain("changed this transaction");
  expect(c.raw.length).toBe(0);
});

test("a rejection becomes a readable error on both paths", async () => {
  for (const t of [single(), cosigned()]) {
    const c = fresh();
    await expect(sendOne(wallet(c, { reject: true }), conn(c), t)).rejects.toThrow(new SendError("Transaction cancelled in your wallet."));
  }
});

test("a wallet send failure is a readable network error", async () => {
  const c = fresh();
  await expect(sendOne(wallet(c, { sendFail: "Simulation failed.\nmore" }), conn(c), single())).rejects.toThrow("The network rejected the transaction: Simulation failed.");
});

test("no wallet is a readable error", async () => {
  const c = fresh();
  await expect(sendOne({ publicKey: null } as any, conn(c), single())).rejects.toThrow(new SendError("Connect a wallet first."));
  await expect(sendSequence({ publicKey: null } as any, conn(c), async () => single())).rejects.toThrow(new SendError("Connect a wallet first."));
});

test("a sequence asks for each transaction only after the one before confirmed", async () => {
  const c = fresh();
  const seen: string[][] = [];
  const steps = [single(), cosigned(), single()];
  const sigs = await sendSequence(wallet(c), conn(c), async (done) => {
    seen.push(done);
    expect(c.sent.length + c.raw.length).toBe(done.length);
    return steps[done.length] ?? null;
  });
  expect(sigs).toEqual(["sig0", "sig1", "sig2"]);
  expect(seen).toEqual([[], ["sig0"], ["sig0", "sig1"], ["sig0", "sig1", "sig2"]]);
});

test("an on-chain failure stops the sequence and reports what confirmed", async () => {
  const c = fresh();
  let n = 0;
  const failing = conn(c);
  failing.confirmTransaction = async () => ({ value: { err: n++ === 1 ? { InstructionError: [0, "Custom"] } : null } });
  const err = await sendSequence(wallet(c), failing, async (done) => (done.length < 3 ? single() : null)).catch((e) => e);
  expect(err).toBeInstanceOf(SendError);
  expect(err.confirmed).toEqual(["sig0"]);
  expect(c.sent.length).toBe(2);
});

test("a confirmation that errors reports which signature is still unconfirmed", async () => {
  const c = fresh();
  const cn = conn(c);
  let n = 0;
  cn.confirmTransaction = async () => { if (n++ === 1) throw new Error("block height exceeded"); return { value: { err: null } }; };
  const err = await sendSequence(wallet(c), cn, async (done) => (done.length < 2 ? single() : null)).catch((e) => e);
  expect(err).toBeInstanceOf(SendError);
  expect(err.unconfirmed).toBe("sig1");
  expect(err.confirmed).toEqual(["sig0"]);
});

test("a server error fetching the next step keeps the confirmed list", async () => {
  const c = fresh();
  const err = await sendSequence(wallet(c), conn(c), async (done) => {
    if (done.length === 1) throw new Error("This transaction would fail right now.");
    return single();
  }).catch((e) => e);
  expect(err).toBeInstanceOf(SendError);
  expect(err.message).toBe("This transaction would fail right now.");
  expect(err.confirmed).toEqual(["sig0"]);
});

test("an optional transaction that fails leaves an empty slot and the flow goes on; a required one stops it", async () => {
  const c = fresh();
  let n = 0;
  const cn = conn(c);
  cn.confirmTransaction = async () => ({ value: { err: n++ === 0 ? { InstructionError: [0, "Custom"] } : null } });
  const sigs = await sendSequence(wallet(c), cn, async (done) => (done.length === 0 ? { ...cosigned(), optional: true } : done.length === 1 ? single() : null));
  expect(sigs).toEqual(["", "sig1"]);
  const f = fresh();
  const err = await sendSequence(wallet(f), conn(f, true), async (done) => (done.length === 0 ? { ...single(), optional: true } : done.length === 1 ? single() : null)).catch((e) => e);
  expect(err).toBeInstanceOf(SendError);
  expect(err.confirmed).toEqual([""]);
});

test("cancelling an optional transaction still stops the flow", async () => {
  const c = fresh();
  await expect(sendSequence(wallet(c, { reject: true }), conn(c), async () => ({ ...single(), optional: true }))).rejects.toThrow("cancelled");
});
