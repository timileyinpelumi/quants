import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { Farms, GlobalConfigOption } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc, none } from "@solana/kit";
import Decimal from "decimal.js";
import { SolanaChain, fromKitInstruction, kitSigner } from "../../src/chain/solana";
import { KaminoBackend } from "../../src/staking/kamino";
import { kaminoRawRps } from "../../src/domain/rate";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const up = await conn.getAccountInfo(new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr")).then((a) => a !== null, () => false);

test.skipIf(!up)("create, configure, fund, early exit, collect penalty", async () => {
  const keeper = Keypair.generate(), spill = Keypair.generate(), user = Keypair.generate();
  for (const k of [keeper, spill, user]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, spill);
  const farms = new Farms(createSolanaRpc(RPC));
  const gc = Keypair.generate();
  await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
  await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.updateGlobalConfigIx(kitSigner(keeper), address(gc.publicKey.toBase58()), GlobalConfigOption.SetTreasuryFeeBps, "0", "number"))), [keeper]);
  const kamino = new KaminoBackend(chain, RPC, gc.publicKey.toBase58());

  const stakeMint = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const rewards = await Promise.all([6, 9, 6].map((d) => createMint(conn, keeper, keeper.publicKey, null, d)));
  const farm = Keypair.generate();
  const spillAccount = getAssociatedTokenAddressSync(stakeMint, spill.publicKey).toBase58();

  const run = async (t: Promise<{ send(): Promise<void>; signature: string; lastValidBlockHeight: bigint }>) => {
    const tx = await t; await tx.send();
    expect(await chain.waitForConfirmation(tx.signature, tx.lastValidBlockHeight)).toBe("confirmed");
  };
  await run(kamino.buildCreateFarm(stakeMint.toBase58(), farm.secretKey));
  expect(await kamino.farmExists(farm.publicKey.toBase58())).toBe(true);
  await run(kamino.buildConfigureFarm({
    farm: farm.publicKey.toBase58(), stakeMint: stakeMint.toBase58(), lockSeconds: 60, maxPenaltyBps: 3000,
    spillAccount, rewardMints: rewards.map((m) => m.toBase58()),
  }));

  const ata = await getOrCreateAssociatedTokenAccount(conn, keeper, stakeMint, user.publicKey);
  await mintTo(conn, keeper, stakeMint, ata.address, keeper, 100_000_000n);
  const f = address(farm.publicKey.toBase58());
  await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.createNewUserIx(kitSigner(user), f))), [user]);
  await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.stakeIx(kitSigner(user), f, new Decimal(100_000_000), address(stakeMint.toBase58()), none()))), [user]);
  expect(await kamino.totalStaked(farm.publicKey.toBase58())).toBe(100_000_000n);

  const keeperReward = await getOrCreateAssociatedTokenAccount(conn, keeper, rewards[0]!, keeper.publicKey);
  await mintTo(conn, keeper, rewards[0]!, keeperReward.address, keeper, 1_000_000n);
  const rs = await kamino.rewardState(farm.publicKey.toBase58(), rewards[0]!.toBase58());
  await run(kamino.buildFund({
    farm: farm.publicKey.toBase58(), rewardMint: rewards[0]!.toBase58(), amount: 1_000_000n,
    rawRps: kaminoRawRps(rs.available + 1_000_000n, 3_600, rs.rpsDecimals), decimals: rs.decimals,
  }));
  expect((await kamino.rewardState(farm.publicKey.toBase58(), rewards[0]!.toBase58())).available).toBe(1_000_000n);

  const [us] = await farms.getUserStatesForUserAndFarm(address(user.publicKey.toBase58()), f);
  await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.unstakeIx(kitSigner(user), f, new Decimal(us!.userState.activeStakeScaled.toString()), none()))), [user]);
  const slashed = await kamino.slashedAmount(farm.publicKey.toBase58());
  expect(slashed).toBeGreaterThan(0n);
  await run(kamino.buildCollectPenalty(farm.publicKey.toBase58(), spillAccount));
  expect((await getAccount(conn, new PublicKey(spillAccount))).amount).toBe(slashed);
});
