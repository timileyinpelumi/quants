import type { SQL } from "bun";
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { NATIVE_MINT } from "../../domain/types";
import { launchCost } from "../../domain/launch-cost";
import { getBalance } from "../../ledger/ledger";
import { runDbStep, runTxStep } from "../../ledger/run-step";
import { swapResolver } from "./swap";
import { GLOBAL_CONFIG_COST } from "../../domain/launch-cost";
import { owesGlobalConfig } from "./global-config";

export async function rentFor(sql: SQL, launchId: number): Promise<bigint> {
  const tiers = await sql`select tier_id as id, lock_seconds as "lockSeconds", multiplier_bps as "multiplierBps" from stake_tiers where launch_id = ${launchId}`;
  const [b] = await sql`select count(*)::int as n from baskets where launch_id = ${launchId}`;
  return launchCost({ tiers: [...tiers] }, b.n).rent;
}

async function rentTaken(sql: SQL, launchId: number) {
  const [r] = await sql`select 1 from distributions where launch_id = ${launchId} and kind = 'rent' and status = 'confirmed'`;
  return !!r;
}

const record = (sql: SQL, launchId: number, rent: bigint, value: bigint) =>
  sql`update stake_pools set rent_lamports = ${rent.toString()}, basket_value_lamports = ${value.toString()} where launch_id = ${launchId}`;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * Staking opens once the stakers' share of fees covers the farm rent. Until then the basket stays in escrow in the
 * quote token; the run it covers the rent, the keeper swaps just enough of it to SOL and debits the rent from it,
 * because the keeper wallet pays that rent when it creates the farms.
 */
export async function openStakingStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<boolean> {
  const [pool] = await deps.sql`select status from stake_pools where launch_id = ${launch.id}`;
  if (!pool) return false;
  if (pool.status === "ready" || (await rentTaken(deps.sql, launch.id))) return true;
  const globalConfig = await owesGlobalConfig(deps, launch.id);
  const rent = (await rentFor(deps.sql, launch.id)) + (globalConfig ? GLOBAL_CONFIG_COST : 0n);
  // Launches made while the launch fee existed already paid their rent.
  const [prepaid] = await deps.sql`select coalesce((s.data->>'launchFeeLamports')::numeric, 0) > 0 as yes
    from launches l join settings s on s.version = l.settings_version where l.id = ${launch.id}`;
  if (prepaid?.yes) {
    await record(deps.sql, launch.id, rent, rent);
    return true;
  }
  let sol = await getBalance(deps.sql, launch.id, "basket", NATIVE_MINT);
  const other = launch.quoteMint === NATIVE_MINT ? 0n : await getBalance(deps.sql, launch.id, "basket", launch.quoteMint);
  const full = sol < rent && other > 0n ? await toSolQuote(deps, launch.quoteMint, other, s) : null;
  const value = sol + (full?.outAmount ?? 0n);
  await record(deps.sql, launch.id, rent, value);
  if (value < rent) return false;

  if (sol < rent) {
    // Sized from the quote for the whole balance, plus the slippage cap so the fill still covers the rent.
    let amountIn = ceilDiv((rent - sol) * other * BigInt(10_000 + s.slippageBps), full!.outAmount * 10_000n);
    if (amountIn > other) amountIn = other;
    const q = await toSolQuote(deps, launch.quoteMint, amountIn, s);
    if (!q || q.priceImpactBps > s.slippageBps) return false;
    const r = await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: `rent_swap:${launch.id}:${runId}`, stepKey: `rent_swap:${launch.id}`, kind: "swap", settingsVersion: s.version,
      detail: { inputMint: launch.quoteMint, outputMint: NATIVE_MINT, amountIn: amountIn.toString(), quotedOut: q.outAmount.toString(), toBucket: "basket" },
      build: () => deps.jupiter.buildSwap(q),
      resolve: swapResolver(deps),
    });
    if (r !== "confirmed") return false;
    sol = await getBalance(deps.sql, launch.id, "basket", NATIVE_MINT);
    if (sol < rent) return false;
  }

  await runDbStep(deps.sql, {
    launchId: launch.id, idemKey: `rent:${launch.id}:${runId}`, stepKey: `rent:${launch.id}`, kind: "rent", settingsVersion: s.version,
    detail: { amount: rent.toString(), ...(globalConfig ? { globalConfig: true } : {}) },
    deltas: [{ bucket: "basket", mint: NATIVE_MINT, amount: -rent }],
  });
  if (!(await rentTaken(deps.sql, launch.id))) return false;
  await record(deps.sql, launch.id, rent, rent);
  return true;
}

async function toSolQuote(deps: KeeperDeps, input: string, amount: bigint, s: VersionedSettings) {
  return deps.jupiter.quote(input, NATIVE_MINT, amount, s.slippageBps).catch((e) => {
    console.error(`quote ${input} to SOL failed`, e);
    return null;
  });
}
