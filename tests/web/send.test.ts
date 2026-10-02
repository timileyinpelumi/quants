import { test, expect } from "bun:test";
import { Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { sendOne, sendSequence, SendError, type UnsignedTx } from "../../src/web/wallet/send";

const kp = Keypair.generate();
const mint = Keypair.generate();
const BLOCKHASH = "11111111111111111111111111111111";

const single = (): UnsignedTx => {
  const t = new Transaction({ feePayer: kp.publicKey, recentBlockhash: BLOCKHASH })
    .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  return { base64: t.serialize({ requireAllSignatures: false }).toString("base64"), versioned: false };
};
// A server signer (a new mint) signs on the server after the wallet, through cosign.
const cosigned = (): UnsignedTx => {
  const t = new Transaction({ feePayer: kp.publicKey, recentBlockhash: BLOCKHASH })
    .add(SystemProgram.createAccount({ fromPubkey: kp.publicKey, newAccountPubkey: mint.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId }));
  return { base64: t.serialize({ requireAllSignatures: false }).toString("base64"), versioned: false, cosign: "req-1" };
};

type Calls = { sent: Transaction[]; signed: Transaction[]; raw: Buffer[]; presigned: number[]; cosigned: { id: string; tx: Transaction }[] };
const wallet = (calls: Calls, opts: { reject?: boolean; sendFail?: string; tamper?: boolean } = {}) => ({
  publicKey: kp.publicKey,
  sendTransaction: async (tx: Transaction) => {
    if (opts.reject) throw new Error("User rejected the request.");
    if (opts.sendFail) throw new Error(opts.sendFail);
    calls.sent.push(tx);
    return `sig${calls.sent.length + calls.cosigned.length - 1}`;
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
const fresh = (): Calls => ({ sent: [], signed: [], raw: [], presigned: [], cosigned: [] });
const server = (calls: Calls, fail?: string) => async (id: string, base64: string) => {
  if (fail) throw new SendError(fail);
  calls.cosigned.push({ id, tx: Transaction.from(Buffer.from(base64, "base64")) });
  return `sig${calls.sent.length + calls.cosigned.length - 1}`;
};

test("a wallet only transaction goes through the wallet's send, one prompt, no batch signing", async () => {
  const c = fresh();
  expect(await sendOne(wallet(c), conn(c), single())).toBe("sig0");
  expect(c.sent.length).toBe(1);
  expect(c.signed.length).toBe(0);
  expect(c.raw.length).toBe(0);
});

test("a transaction with a server signer is signed by the wallet first, then handed to the server, which sends it", async () => {
  const c = fresh();
  expect(await sendOne(wallet(c), conn(c), cosigned(), server(c))).toBe("sig0");
  expect(c.sent.length).toBe(0);
  expect(c.raw.length).toBe(0);
  expect(c.presigned).toEqual([0]);
  expect(c.cosigned.length).toBe(1);
  expect(c.cosigned[0]!.id).toBe("req-1");
  const sigs = c.cosigned[0]!.tx.signatures;
  expect(sigs.find((s) => s.publicKey.equals(kp.publicKey))!.signature).not.toBeNull();
  expect(sigs.find((s) => s.publicKey.equals(mint.publicKey))!.signature).toBeNull();
});

test("whatever the wallet changed goes to the server as signed; the server's refusal is the error shown", async () => {
  const c = fresh();
  const err = await sendOne(wallet(c, { tamper: true }), conn(c), cosigned(), server(c, "Your wallet changed this transaction in a way quants cannot accept (an instruction was added or changed). Nothing was sent. Try again.")).catch((e) => e);
  expect(err).toBeInstanceOf(SendError);
  expect(err.message).toContain("cannot accept");
  expect(c.raw.length).toBe(0);
});

test("a rejection becomes a readable error on both paths", async () => {
  for (const t of [single(), cosigned()]) {
    const c = fresh();
    await expect(sendOne(wallet(c, { reject: true }), conn(c), t, server(c))).rejects.toThrow(new SendError("Transaction cancelled in your wallet."));
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
    expect(c.sent.length + c.cosigned.length).toBe(done.length);
    return steps[done.length] ?? null;
  }, server(c));
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

test("a failed setup transaction stops the flow with its own error, nothing after it is asked for", async () => {
  const c = fresh();
  let asked = 0;
  const err = await sendSequence(wallet(c), conn(c), async () => { asked++; return cosigned(); }, server(c, "Your wallet does not have enough SOL.")).catch((e) => e);
  expect(err).toBeInstanceOf(SendError);
  expect(err.message).toBe("Your wallet does not have enough SOL.");
  expect(asked).toBe(1);
  const f = fresh();
  const failed = await sendSequence(wallet(f), conn(f, true), async (done) => (done.length < 2 ? cosigned() : null), server(f)).catch((e) => e);
  expect(failed.message).toContain("Transaction failed");
  expect(failed.confirmed).toEqual([]);
});
