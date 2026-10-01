import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { SolanaChain } from "../../src/chain/solana";
import { NATIVE_MINT } from "../../src/domain/types";
import { localJupiter } from "../../scripts/lib/local-jupiter";

const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const up = await conn.getVersion().then(() => true, () => false);

test.skipIf(!up)("the local stand-in swaps a quote token to SOL for the keeper", async () => {
  const keeper = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(keeper.publicKey, 2 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, Keypair.generate());
  const mint = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(conn, keeper, mint, keeper.publicKey);
  await mintTo(conn, keeper, mint, ata.address, keeper, 5_000_000n);

  const jup = localJupiter(chain, []);
  expect(await jup.quote(mint.toBase58(), "Other", 1n, 100)).toBeNull();
  const q = (await jup.quote(mint.toBase58(), NATIVE_MINT, 3_000_000n, 100))!;
  expect(q.outAmount).toBe(3_000_000n);
  const t = await jup.buildSwap(q);
  await t.send();
  expect(await chain.waitForConfirmation(t.signature, t.lastValidBlockHeight)).toBe("confirmed");
  expect(await chain.received(t.signature, keeper.publicKey.toBase58(), NATIVE_MINT)).toBe(3_000_000n);
  expect(await chain.balance(keeper.publicKey.toBase58(), mint.toBase58())).toBe(2_000_000n);
});
