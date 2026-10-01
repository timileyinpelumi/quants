import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenInstruction, createInitializeMintInstruction, getAssociatedTokenAddressSync,
  getMintLen, getOrCreateAssociatedTokenAccount, mintTo, createInitializePausableConfigInstruction, createPauseInstruction, ExtensionType,
} from "@solana/spl-token";
import { SolanaChain } from "../../src/chain/solana";
import { mintAccount, mintData, pausable } from "../helpers/mint-data";

function fakeConn(accounts: Map<string, ReturnType<typeof mintAccount>>) {
  const balanceReads: string[] = [];
  const sent: Transaction[] = [];
  const conn = {
    getAccountInfo: async (k: PublicKey) => accounts.get(k.toBase58()) ?? null,
    getTokenAccountBalance: async (k: PublicKey) => {
      balanceReads.push(k.toBase58());
      return { value: { amount: "42" } };
    },
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 }),
    sendRawTransaction: async (raw: Buffer) => { sent.push(Transaction.from(raw)); return "sig"; },
  } as unknown as Connection;
  return { conn, balanceReads, sent };
}

const keeper = Keypair.generate(), spill = Keypair.generate(), owner = Keypair.generate().publicKey;
const t22 = Keypair.generate().publicKey, classic = Keypair.generate().publicKey;
const accounts = new Map([
  [t22.toBase58(), mintAccount(mintData(8, [pausable(false)]))],
  [classic.toBase58(), mintAccount(mintData(6), false)],
]);

test("balance reads the ATA under the mint's own token program", async () => {
  const { conn, balanceReads } = fakeConn(accounts);
  const chain = new SolanaChain(conn, keeper, spill);
  expect(await chain.balance(owner.toBase58(), t22.toBase58())).toBe(42n);
  expect(await chain.balance(owner.toBase58(), classic.toBase58())).toBe(42n);
  expect(balanceReads).toEqual([
    getAssociatedTokenAddressSync(t22, owner, true, TOKEN_2022_PROGRAM_ID).toBase58(),
    getAssociatedTokenAddressSync(classic, owner, true, TOKEN_PROGRAM_ID).toBase58(),
  ]);
  expect(await chain.balance(owner.toBase58(), Keypair.generate().publicKey.toBase58())).toBe(0n);
});

test("transfers use TransferChecked against the mint's token program", async () => {
  const { conn, sent } = fakeConn(accounts);
  const chain = new SolanaChain(conn, keeper, spill);
  for (const [mint, program, decimals] of [[t22, TOKEN_2022_PROGRAM_ID, 8], [classic, TOKEN_PROGRAM_ID, 6]] as const) {
    await (await chain.buildTransfer(mint.toBase58(), owner.toBase58(), 5n)).send();
    const [create, transfer] = sent.at(-1)!.instructions;
    expect(create!.keys.map((k) => k.pubkey.toBase58())).toContain(program.toBase58());
    expect(transfer!.programId.toBase58()).toBe(program.toBase58());
    expect(transfer!.data[0]).toBe(TokenInstruction.TransferChecked);
    expect(transfer!.data[9]).toBe(decimals);
    expect(transfer!.keys[0]!.pubkey.toBase58()).toBe(getAssociatedTokenAddressSync(mint, keeper.publicKey, false, program).toBase58());
    expect(transfer!.keys[2]!.pubkey.toBase58()).toBe(getAssociatedTokenAddressSync(mint, owner, true, program).toBase58());
  }
});

test("isPaused reads the pausable extension fresh each time", async () => {
  const { conn } = fakeConn(accounts);
  const chain = new SolanaChain(conn, keeper, spill);
  expect(await chain.isPaused(t22.toBase58())).toBe(false);
  accounts.set(t22.toBase58(), mintAccount(mintData(8, [pausable(true)])));
  expect(await chain.isPaused(t22.toBase58())).toBe(true);
  expect(await chain.isPaused(classic.toBase58())).toBe(false);
  expect(await chain.isPaused("So11111111111111111111111111111111111111112")).toBe(false);
  accounts.set(t22.toBase58(), mintAccount(mintData(8, [pausable(false)])));
});

const rpc = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const up = await rpc.getVersion().then(() => true, () => false);

async function token2022Mint(payer: Keypair, decimals: number, pauseAuthority?: PublicKey) {
  const mint = Keypair.generate();
  const exts = pauseAuthority ? [ExtensionType.PausableConfig] : [];
  const len = getMintLen(exts);
  const tx = new Transaction().add(SystemProgram.createAccount({
    fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: len,
    lamports: await rpc.getMinimumBalanceForRentExemption(len), programId: TOKEN_2022_PROGRAM_ID,
  }));
  if (pauseAuthority) tx.add(createInitializePausableConfigInstruction(mint.publicKey, pauseAuthority, TOKEN_2022_PROGRAM_ID));
  tx.add(createInitializeMintInstruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID));
  await sendAndConfirmTransaction(rpc, tx, [payer, mint]);
  return mint.publicKey;
}

test.skipIf(!up)("Token-2022 mint on a validator: balance, transfer and pause", async () => {
  const k = Keypair.generate(), s = Keypair.generate(), dest = Keypair.generate();
  await rpc.confirmTransaction(await rpc.requestAirdrop(k.publicKey, 5 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(rpc, k, s);

  const mint = await token2022Mint(k, 8);
  const ata = await getOrCreateAssociatedTokenAccount(rpc, k, mint, k.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(rpc, k, mint, ata.address, k, 1_000n, [], undefined, TOKEN_2022_PROGRAM_ID);
  expect(await chain.balance(k.publicKey.toBase58(), mint.toBase58())).toBe(1_000n);

  const t = await chain.buildTransfer(mint.toBase58(), dest.publicKey.toBase58(), 400n);
  await t.send();
  expect(await chain.waitForConfirmation(t.signature, t.lastValidBlockHeight)).toBe("confirmed");
  expect(await chain.received(t.signature, dest.publicKey.toBase58(), mint.toBase58())).toBe(400n);
  expect(await chain.balance(k.publicKey.toBase58(), mint.toBase58())).toBe(600n);
  expect(await chain.balance(dest.publicKey.toBase58(), mint.toBase58())).toBe(400n);
  expect(await chain.isPaused(mint.toBase58())).toBe(false);

  const paused = await token2022Mint(k, 8, k.publicKey);
  const pata = await getOrCreateAssociatedTokenAccount(rpc, k, paused, k.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(rpc, k, paused, pata.address, k, 10n, [], undefined, TOKEN_2022_PROGRAM_ID);
  await sendAndConfirmTransaction(rpc, new Transaction().add(createPauseInstruction(paused, k.publicKey, [], TOKEN_2022_PROGRAM_ID)), [k]);
  expect(await chain.isPaused(paused.toBase58())).toBe(true);
  const err = await (await chain.buildTransfer(paused.toBase58(), dest.publicKey.toBase58(), 1n)).send().then(() => null, (e) => e);
  expect(err).not.toBeNull();
  const { isPausedError } = await import("../../src/chain/mints");
  expect(isPausedError(err)).toBe(true);
});
