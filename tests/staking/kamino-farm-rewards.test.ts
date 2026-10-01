import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Farms } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import { SolanaChain, fromKitInstruction, kitSigner } from "../../src/chain/solana";
import { KaminoBackend } from "../../src/staking/kamino";
import { createFarmsStep } from "../../src/keeper/steps/farms";
import { loadLaunches } from "../../src/keeper/launch-row";
import { defaultSettings, loadLatestSettings, saveSettings } from "../../src/domain/settings";
import type { LockTier } from "../../src/domain/types";
import { launchCost } from "../../src/domain/launch-cost";
import type { KeeperDeps } from "../../src/keeper/deps";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const up = await conn.getAccountInfo(new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr")).then((a) => a !== null, () => false);
const EMPTY_MINT = "11111111111111111111111111111111";

// Runs the keeper's farm step against the validator and returns what the keeper wallet paid.
async function keeperFarm(rewardCount: number, tiers: LockTier[] = [{ id: "7d", lockSeconds: 604800, multiplierBps: 10000 }]) {
  const keeper = Keypair.generate(), spill = Keypair.generate();
  for (const k of [keeper, spill]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, spill);
  const farms = new Farms(createSolanaRpc(RPC));
  const gc = Keypair.generate();
  await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
  const staking = new KaminoBackend(chain, RPC, gc.publicKey.toBase58());
  const stakeMint = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const rewards: string[] = [];
  for (let i = 0; i < rewardCount; i++) rewards.push((await createMint(conn, keeper, keeper.publicKey, null, 6)).toBase58());

  const sql = await freshDb();
  await saveSettings(sql, defaultSettings(stakeMint.toBase58()), "t");
  const id = await insertLaunch(sql, { mint: stakeMint.toBase58() });
  for (const m of rewards) await sql`insert into baskets (launch_id, reward_mint, weight_bps) values (${id}, ${m}, 1000)`;
  const spillAccount = getAssociatedTokenAddressSync(stakeMint, spill.publicKey).toBase58();
  await sql`insert into stake_pools values (${id}, 'kamino', 3000, ${spillAccount}, 'pending')`;
  for (const t of tiers) await sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps) values (${id}, ${t.id}, ${t.lockSeconds}, ${t.multiplierBps})`;
  const deps = { sql, chain, staking, wallets: { keeper: keeper.publicKey.toBase58(), spill: spill.publicKey.toBase58(), treasury: "" }, ourtokenMint: stakeMint.toBase58() } as unknown as KeeperDeps;
  const settings = await loadLatestSettings(sql);
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);

  const before = BigInt(await conn.getBalance(keeper.publicKey, "confirmed"));
  let status = "pending";
  for (let i = 0; i < 5 && status !== "ready"; i++) status = await createFarmsStep(deps, launch!, settings, `r${i}`);
  const spent = before - BigInt(await conn.getBalance(keeper.publicKey, "confirmed"));
  const failed = await sql`select idem_key, status, error from distributions where status <> 'confirmed'`;
  expect({ status, failed }).toEqual({ status: "ready", failed: [] });

  const [tier] = await sql`select farm from stake_tiers where launch_id = ${id} order by lock_seconds`;
  const [fs] = await farms.getAllFarmStatesByPubkeys([address(tier.farm)]);
  const onChain = fs!.farmState.rewardInfos.map((r) => r.token.mint as string).filter((m) => m !== EMPTY_MINT);
  return { spent, rewards, onChain, farmState: fs!.farmState };
}

test.skipIf(!up)("the keeper registers all 10 reward mints on one farm", async () => {
  const r = await keeperFarm(10);
  expect([...r.onChain].sort()).toEqual([...r.rewards].sort());
  expect(Number(r.farmState.lockingDuration)).toBe(604800);
  expect(Number(r.farmState.lockingEarlyWithdrawalPenaltyBps)).toBe(3000);
});

test.skipIf(!up)("the launch cost estimate covers what the keeper spends", async () => {
  const all = defaultSettings("x").tiers;
  for (const [n, t] of [[1, 1], [3, 1], [10, 1], [1, all.length], [3, all.length], [10, all.length]] as const) {
    const s = { launchFeeLamports: 0n, tiers: all.slice(0, t) };
    const { spent } = await keeperFarm(n, s.tiers);
    const estimate = launchCost(s, n).rent;
    console.log(`${t} farms, ${n} rewards: spent ${spent} lamports, estimate ${estimate}`);
    expect(estimate).toBeGreaterThanOrEqual(spent);
    expect(estimate - spent).toBeLessThan(BigInt(t) * 100_000n);
  }
});
