import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import { Farms } from "@kamino-finance/farms-sdk";
import { createSolanaRpc } from "@solana/kit";
import { SolanaChain, fromKitInstruction, kitSigner } from "../../src/chain/solana";
import { KaminoBackend } from "../../src/staking/kamino";
import { kaminoRawRps } from "../../src/domain/rate";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const up = await conn.getAccountInfo(new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr")).then((a) => a !== null, () => false);

async function signSend(base64: string, signer: Keypair) {
  const tx = Transaction.from(Buffer.from(base64, "base64"));
  tx.partialSign(signer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const res = await conn.confirmTransaction(sig, "confirmed");
  expect(res.value.err).toBeNull();
}

test.skipIf(!up)("user stake, pending rewards, claim, early exit and claim after exit", async () => {
  const keeper = Keypair.generate(), spill = Keypair.generate(), user = Keypair.generate();
  for (const k of [keeper, spill, user]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, spill);
  const farms = new Farms(createSolanaRpc(RPC));
  const gc = Keypair.generate();
  await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
  const kamino = new KaminoBackend(chain, RPC, gc.publicKey.toBase58());

  const stakeMint = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const rewards = await Promise.all([6, 9].map((d) => createMint(conn, keeper, keeper.publicKey, null, d)));
  const farm = Keypair.generate();
  const f = farm.publicKey.toBase58();
  const run = async (t: Promise<{ send(): Promise<void>; signature: string; lastValidBlockHeight: bigint }>) => {
    const tx = await t; await tx.send();
    expect(await chain.waitForConfirmation(tx.signature, tx.lastValidBlockHeight)).toBe("confirmed");
  };
  await run(kamino.buildCreateFarm(stakeMint.toBase58(), farm.secretKey));
  await run(kamino.buildConfigureFarm({
    farm: f, stakeMint: stakeMint.toBase58(), lockSeconds: 120, maxPenaltyBps: 3000,
    spillAccount: getAssociatedTokenAddressSync(stakeMint, spill.publicKey).toBase58(),
  }));
  await run(kamino.buildAddRewards(f, rewards.map((m) => m.toBase58())));
  const kr = await getOrCreateAssociatedTokenAccount(conn, keeper, rewards[0]!, keeper.publicKey);
  await mintTo(conn, keeper, rewards[0]!, kr.address, keeper, 10_000_000n);
  const rs = await kamino.rewardState(f, rewards[0]!.toBase58());
  await run(kamino.buildFund({ farm: f, rewardMint: rewards[0]!.toBase58(), amount: 10_000_000n, rawRps: kaminoRawRps(10_000_000n, 100, rs.rpsDecimals), decimals: rs.decimals }));

  const userAta = await getOrCreateAssociatedTokenAccount(conn, keeper, stakeMint, user.publicKey);
  await mintTo(conn, keeper, stakeMint, userAta.address, keeper, 1_000_000n);
  const owner = user.publicKey.toBase58();

  expect(await kamino.position(owner, f)).toBeNull();
  await signSend(await kamino.buildStakeTx(owner, f, stakeMint.toBase58(), 1_000_000n), user);
  const p1 = (await kamino.position(owner, f))!;
  expect(p1.staked).toBe(1_000_000n);
  expect(p1.lockSeconds).toBe(120);
  expect(p1.lastStakeTs).toBeGreaterThan(0);
  expect(await kamino.userFarms(owner)).toEqual([f]);

  await Bun.sleep(4_000);
  const p2 = (await kamino.position(owner, f))!;
  expect(p2.pending.find((r) => r.mint === rewards[0]!.toBase58())!.amount).toBeGreaterThan(0n);

  await signSend(await kamino.buildClaimTx(owner, f), user);
  const got = (await getAccount(conn, getAssociatedTokenAddressSync(rewards[0]!, user.publicKey))).amount;
  expect(got).toBeGreaterThan(0n);

  await Bun.sleep(3_000);
  await signSend(await kamino.buildExitTx(owner, f, stakeMint.toBase58()), user);
  const back = (await getAccount(conn, userAta.address)).amount;
  const slashed = await kamino.slashedAmount(f);
  expect(slashed).toBeGreaterThan(0n);
  expect(back + slashed).toBe(1_000_000n);
  const p3 = (await kamino.position(owner, f))!;
  expect(p3.staked).toBe(0n);
  expect(p3.pending.find((r) => r.mint === rewards[0]!.toBase58())!.amount).toBeGreaterThan(0n);
  await signSend(await kamino.buildClaimTx(owner, f), user);
  expect((await getAccount(conn, getAssociatedTokenAddressSync(rewards[0]!, user.publicKey))).amount).toBeGreaterThan(got);
});
