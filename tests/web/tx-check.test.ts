import { test, expect } from "bun:test";
import { Keypair, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { checkTx, walletTx, TX_LIMIT } from "../../src/web/server/tx-check";
import { LaunchError } from "../../src/launch/prepare";

const payer = Keypair.generate();
const extra = Keypair.generate();
const BLOCKHASH = "11111111111111111111111111111111";

const presigned = () => {
  const t = new Transaction({ feePayer: payer.publicKey, recentBlockhash: BLOCKHASH })
    .add(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: extra.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId }));
  t.partialSign(extra);
  return t;
};
const ok = { context: { slot: 1 }, value: { err: null, logs: [], accounts: null, unitsConsumed: 0, returnData: null } };
const sim = (value: object = ok.value) => {
  const calls: { tx: VersionedTransaction; config: any }[] = [];
  return { calls, conn: { simulateTransaction: async (tx: VersionedTransaction, config: any) => { calls.push({ tx, config }); return { context: { slot: 1 }, value }; } } as any };
};

test("server signatures move out of the transaction so the wallet signs first", () => {
  const t = presigned();
  const w = walletTx(t.serialize({ requireAllSignatures: false }).toString("base64"), { optional: true });
  expect(w.optional).toBe(true);
  expect(w.versioned).toBe(false);
  expect(w.signatures).toEqual([{ publicKey: extra.publicKey.toBase58(), signature: Buffer.from(t.signatures[1]!.signature!).toString("base64") }]);
  const back = Transaction.from(Buffer.from(w.base64, "base64"));
  expect(back.signatures.every((s) => s.signature === null)).toBe(true);
  expect(back.serializeMessage().equals(t.serializeMessage())).toBe(true);
  back.partialSign(payer);
  back.addSignature(extra.publicKey, Buffer.from(w.signatures![0]!.signature, "base64"));
  expect(back.verifySignatures()).toBe(true);
});

test("a wallet only transaction carries no signatures field", () => {
  const t = new Transaction({ feePayer: payer.publicKey, recentBlockhash: BLOCKHASH }).add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }));
  expect(walletTx(t.serialize({ requireAllSignatures: false }).toString("base64"))).toEqual({ base64: t.serialize({ requireAllSignatures: false }).toString("base64"), versioned: false });
});

test("simulation runs on the transaction as is, without signature checks and without a new blockhash", async () => {
  const { calls, conn } = sim();
  const w = walletTx(presigned().serialize({ requireAllSignatures: false }).toString("base64"));
  await checkTx(conn, w);
  expect(calls.length).toBe(1);
  expect(calls[0]!.config).toEqual({ sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
  expect(Buffer.from(calls[0]!.tx.serialize()).toString("base64")).toBe(w.base64);
});

test("a failed simulation is a readable error", async () => {
  const cases: [object, string][] = [
    [{ err: "AccountNotFound", logs: [] }, "Your wallet has no SOL yet. Add SOL for network fees and try again."],
    [{ err: "InsufficientFundsForFee", logs: [] }, "Your wallet does not have enough SOL for the network fee."],
    [{ err: { InsufficientFundsForRent: { account_index: 0 } }, logs: [] }, "Your wallet does not have enough SOL to cover the account rent for this."],
    [{ err: { InstructionError: [0, { Custom: 1 }] }, logs: ["Transfer: insufficient lamports 5, need 10"] }, "Your wallet does not have enough balance for this. Lower the amount and try again."],
    [{ err: { InstructionError: [1, { Custom: 6004 }] }, logs: ["Program log: AnchorError occurred. Error Code: ExceededSlippage."] }, "The price moved past your slippage. Get a fresh quote and try again."],
    [{ err: { InstructionError: [1, { Custom: 42 }] }, logs: [] }, "This transaction would fail on chain right now, so it was not sent to your wallet. Try again in a moment."],
  ];
  for (const [value, message] of cases) {
    const err = await checkTx(sim(value).conn, walletTx(presigned().serialize({ requireAllSignatures: false }).toString("base64"))).catch((e) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect(err.code).toBe("simulation_failed");
    expect(err.message).toBe(message);
  }
});

test("an RPC that cannot simulate is a readable error, not a transaction sent blind", async () => {
  const conn = { simulateTransaction: async () => { throw new Error("fetch failed"); } } as any;
  await expect(checkTx(conn, walletTx(presigned().serialize({ requireAllSignatures: false }).toString("base64")))).rejects.toMatchObject({ code: "simulation_failed" });
});

test("a transaction over the size limit is refused before simulation", async () => {
  const { calls, conn } = sim();
  await expect(checkTx(conn, { base64: Buffer.alloc(TX_LIMIT + 1, 1).toString("base64") })).rejects.toMatchObject({ code: "tx_too_large" });
  expect(calls.length).toBe(0);
});
