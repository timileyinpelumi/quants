import { NATIVE_MINT } from "../domain/types";
import type { KeeperDeps } from "./deps";
import { loadLaunches, type LaunchRow } from "./launch-row";
import { makeResolvers } from "./resolvers";
import { loadLatestSettings, type VersionedSettings } from "../domain/settings";
import { abandonUnsent, launchesWithSentSteps, ledgerTotals, openSentSteps } from "../ledger/ledger";
import { resolveSent } from "../ledger/run-step";
import { graduateStep } from "./steps/graduate";
import { claimStep } from "./steps/claim";
import { splitStep } from "./steps/split";
import { payoutStep } from "./steps/payout";
import { createFarmsStep } from "./steps/farms";
import { openStakingStep } from "./steps/open";
import { swapStep } from "./steps/swap";
import { earnStep, stakePayoutStep } from "./steps/earn";
import { penaltyStep } from "./steps/penalty";
import { sweepPreparedLaunches } from "./steps/sweep";

export class ReconcileError extends Error {}

export async function resume(deps: KeeperDeps) {
  await abandonUnsent(deps.sql);
  const resolvers = makeResolvers(deps);
  for (const row of await openSentSteps(deps.sql)) {
    try {
      await resolveSent(deps.sql, deps.chain, row, resolvers[row.kind]);
    } catch (e) {
      console.error(`resume ${row.idemKey} failed`, e);
    }
  }
}

export async function reconcile(deps: KeeperDeps) {
  const short: string[] = [];
  for (const [key, owed] of await ledgerTotals(deps.sql)) {
    const [group, mint] = key.split(":") as ["keeper" | "spill", string];
    const have = await deps.chain.balance(group === "spill" ? deps.wallets.spill : deps.wallets.keeper, mint);
    if (have < owed) short.push(`${key} ledger=${owed} wallet=${have}`);
  }
  if (short.length) throw new ReconcileError(`ledger exceeds wallet: ${short.join(", ")}`);
}

export async function processLaunch(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  // Every transfer of a paused quote mint fails, so the steps that move it wait for the issuer to resume it.
  const paused = await deps.chain.isPaused(launch.quoteMint);
  const l = await graduateStep(deps, launch, s, runId, paused);
  if (!paused) await claimStep(deps, l, s, runId);
  await splitStep(deps, l, s, runId);
  if (!paused) await payoutStep(deps, l, s, runId);
  if (l.tradingOnly) return;
  if (await openStakingStep(deps, l, s, runId)) {
    await createFarmsStep(deps, l, s, runId);
    await swapStep(deps, l, s, runId);
    await earnStep(deps, l, s);
    await stakePayoutStep(deps, l, s);
  }
  await penaltyStep(deps, l, s, runId);
}

// Below this the keeper cannot pay for a claim plus its wrapped SOL account. Fees wait in the pools, so nothing is lost.
export const KEEPER_MIN_LAMPORTS = 5_000_000n;

export async function runKeeper(deps: KeeperDeps): Promise<{ runId: string; launches: number; errors: { launchId: number; error: string }[]; skipped?: "keeper_unfunded" }> {
  await resume(deps);
  await reconcile(deps);
  const sol = await deps.chain.balance(deps.wallets.keeper, NATIVE_MINT);
  if (sol < KEEPER_MIN_LAMPORTS) return { runId: crypto.randomUUID(), launches: 0, errors: [], skipped: "keeper_unfunded" };
  await sweepPreparedLaunches(deps).catch((e) => console.error("sweep failed", e));
  const settings = await loadLatestSettings(deps.sql);
  const runId = crypto.randomUUID();
  const launches = await loadLaunches(deps.sql);
  const errors: { launchId: number; error: string }[] = [];
  // A launch with a transaction still in flight is skipped: its balances are not final until that step resolves.
  const inFlight = await launchesWithSentSteps(deps.sql);
  for (const launch of launches) {
    if (inFlight.has(launch.id)) continue;
    try {
      await processLaunch(deps, launch, settings, runId);
    } catch (e) {
      errors.push({ launchId: launch.id, error: String(e) });
    }
  }
  return { runId, launches: launches.length, errors };
}
