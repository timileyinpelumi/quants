import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { SolanaChain } from "../../src/chain/solana";
import { NATIVE_MINT } from "../../src/domain/types";

const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const up = await conn.getVersion().then(() => true, () => false);

test.skipIf(!up)("transfer, received and burn round trip", async () => {
  const keeper = Keypair.generate(), spill = Keypair.generate(), dest = Keypair.generate();
  for (const k of [keeper, spill]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 5 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, spill);

  const mint = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(conn, keeper, mint, keeper.publicKey);
  await mintTo(conn, keeper, mint, ata.address, keeper, 1_000n);

  const t = await chain.buildTransfer(mint.toBase58(), dest.publicKey.toBase58(), 400n);
  await t.send();
  expect(await chain.waitForConfirmation(t.signature, t.lastValidBlockHeight)).toBe("confirmed");
  expect(await chain.received(t.signature, dest.publicKey.toBase58(), mint.toBase58())).toBe(400n);
  expect(await chain.balance(keeper.publicKey.toBase58(), mint.toBase58())).toBe(600n);

  const s = await chain.buildTransfer(NATIVE_MINT, dest.publicKey.toBase58(), 1_000_000n);
  await s.send();
  await chain.waitForConfirmation(s.signature, s.lastValidBlockHeight);
  expect(await chain.received(s.signature, dest.publicKey.toBase58(), NATIVE_MINT)).toBe(1_000_000n);

  const spillAta = await getOrCreateAssociatedTokenAccount(conn, keeper, mint, spill.publicKey);
  await mintTo(conn, keeper, mint, spillAta.address, keeper, 50n);
  const b = await chain.buildBurn(mint.toBase58(), 50n);
  await b.send();
  expect(await chain.waitForConfirmation(b.signature, b.lastValidBlockHeight)).toBe("confirmed");
  expect(await chain.balance(spill.publicKey.toBase58(), mint.toBase58())).toBe(0n);
  expect(await chain.status("1111111111111111111111111111111111111111111111111111111111111111")).toBe("unknown");
});

test("waitForConfirmation reads the height before the status", async () => {
  let height = 100;
  let landed = false;
  const conn = {
    getBlockHeight: async () => height,
    getSignatureStatuses: async () => {
      const value = [landed ? { err: null, confirmationStatus: "confirmed" } : null];
      // the node catches up right after answering: past expiry, and the tx is in
      height = 1_000; landed = true;
      return { value };
    },
  } as any;
  const chain = new SolanaChain(conn, Keypair.generate(), Keypair.generate());
  expect(await chain.waitForConfirmation("sig", 200n)).toBe("confirmed");
});
