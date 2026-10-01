import { test, expect } from "bun:test";
import { Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { signAndSendAll, SendError } from "../../src/web/wallet/send";

const kp = Keypair.generate();
const legacy = () => {
  const t = new Transaction({ feePayer: kp.publicKey, recentBlockhash: "11111111111111111111111111111111" })
    .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  return { base64: t.serialize({ requireAllSignatures: false }).toString("base64"), versioned: false };
};
const wallet = (reject = false) => ({
  publicKey: kp.publicKey,
  signAllTransactions: async (txs: any[]) => { if (reject) throw new Error("User rejected the request."); txs.forEach((t) => t.partialSign(kp)); return txs; },
}) as any;
const conn = (fail = false) => {
  const sent: string[] = [];
  return {
    sent,
    sendRawTransaction: async () => { sent.push(`sig${sent.length}`); return `sig${sent.length - 1}`; },
    confirmTransaction: async () => ({ value: { err: fail ? { InstructionError: [0, "Custom"] } : null } }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 }),
  } as any;
};

test("signs once and sends in order", async () => {
  expect(await signAndSendAll(wallet(), conn(), [legacy(), legacy()])).toEqual(["sig0", "sig1"]);
});
test("a rejection becomes a readable error", async () => {
  await expect(signAndSendAll(wallet(true), conn(), [legacy()])).rejects.toThrow(new SendError("Transaction cancelled in your wallet."));
});
test("an on-chain failure stops the sequence", async () => {
  const c = conn(true);
  await expect(signAndSendAll(wallet(), c, [legacy(), legacy()])).rejects.toBeInstanceOf(SendError);
  expect(c.sent.length).toBe(1);
});
test("no wallet is a readable error", async () => {
  await expect(signAndSendAll({ publicKey: null } as any, conn(), [legacy()])).rejects.toThrow(new SendError("Connect a wallet first."));
});

test("a confirmation that errors reports which signature is still unconfirmed", async () => {
  const c = conn();
  c.confirmTransaction = async () => { throw new Error("block height exceeded"); };
  const err = await signAndSendAll(wallet(), c, [legacy(), legacy()]).catch((e) => e);
  expect(err).toBeInstanceOf(SendError);
  expect(err.unconfirmed).toBe("sig0");
  expect(err.confirmed).toEqual([]);
});
