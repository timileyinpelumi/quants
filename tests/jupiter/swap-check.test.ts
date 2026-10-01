import { test, expect } from "bun:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  NATIVE_MINT, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction,
  createTransferInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assertSafeSwap, JupiterLive } from "../../src/jupiter/port";

const JUP = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const keeper = Keypair.generate().publicKey;
const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, keeper);
const stranger = Keypair.generate().publicKey;
const jupIx = new TransactionInstruction({ programId: JUP, keys: [{ pubkey: keeper, isSigner: true, isWritable: true }, { pubkey: wsol, isSigner: false, isWritable: true }], data: Buffer.from([1, 2, 3]) });

const build = (ixs: TransactionInstruction[], payer = keeper) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message());

const jupiterLike = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  createAssociatedTokenAccountIdempotentInstruction(keeper, wsol, keeper, NATIVE_MINT),
  SystemProgram.transfer({ fromPubkey: keeper, toPubkey: wsol, lamports: 1_000n }),
  createSyncNativeInstruction(wsol),
  jupIx,
  createCloseAccountInstruction(wsol, keeper, keeper),
];

test("a normal Jupiter swap with SOL wrapping passes", () => {
  expect(() => assertSafeSwap(build(jupiterLike()), keeper)).not.toThrow();
});

test("a different fee payer is refused", () => {
  expect(() => assertSafeSwap(build([jupIx], stranger), keeper)).toThrow(/fee payer/);
});

test("a SOL transfer to anyone but the keeper's wSOL account is refused", () => {
  expect(() => assertSafeSwap(build([SystemProgram.transfer({ fromPubkey: keeper, toPubkey: stranger, lamports: 1n }), jupIx]), keeper)).toThrow(/System/);
});

test("other System instructions are refused", () => {
  const ix = SystemProgram.assign({ accountPubkey: keeper, programId: stranger });
  expect(() => assertSafeSwap(build([ix, jupIx]), keeper)).toThrow(/System/);
});

test("an unknown program is refused", () => {
  const ix = new TransactionInstruction({ programId: stranger, keys: [{ pubkey: keeper, isSigner: true, isWritable: true }], data: Buffer.alloc(0) });
  expect(() => assertSafeSwap(build([ix, jupIx]), keeper)).toThrow(/program/);
});

test("a token transfer out of the keeper's accounts is refused", () => {
  const mint = Keypair.generate().publicKey;
  const ix = createTransferInstruction(getAssociatedTokenAddressSync(mint, keeper), getAssociatedTokenAddressSync(mint, stranger), keeper, 5n);
  expect(() => assertSafeSwap(build([ix, jupIx]), keeper)).toThrow(/Token/);
});

test("closing the wSOL account to someone else is refused", () => {
  expect(() => assertSafeSwap(build([createCloseAccountInstruction(wsol, stranger, keeper), jupIx]), keeper)).toThrow(/Token/);
});

test("buildSwap does not sign a transaction that fails the check", async () => {
  let signed = false;
  const chain = { keeper: { publicKey: keeper }, signVersioned: async () => { signed = true; return {} as any; } } as any;
  const bad = build([SystemProgram.transfer({ fromPubkey: keeper, toPubkey: stranger, lamports: 1n }), jupIx]);
  const j = new JupiterLive("https://jup.test", chain, async () => Response.json({ swapTransaction: Buffer.from(bad.serialize()).toString("base64"), lastValidBlockHeight: 10 }));
  await expect(j.buildSwap({ inAmount: 1n, outAmount: 1n, priceImpactBps: 0, raw: {} })).rejects.toThrow();
  expect(signed).toBe(false);
});
