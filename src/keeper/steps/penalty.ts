import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";

export const collectResolver = (deps: KeeperDeps): DeltaResolver => async (row, sig) =>
  [{ bucket: "penalty", mint: row.detail.mint, amount: await deps.chain.received(sig, deps.wallets.spill, row.detail.mint) }];

export const burnResolver: DeltaResolver = async (row) => [{ bucket: "penalty", mint: row.detail.mint, amount: -BigInt(row.detail.amount) }];

export async function penaltyStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const [pool] = await deps.sql`select status, spill_account from stake_pools where launch_id = ${launch.id}`;
  if (pool?.status !== "ready") return;
  const tiers = await deps.sql`select tier_id, farm from stake_tiers where launch_id = ${launch.id}`;
  for (const t of tiers) {
    if ((await deps.staking.slashedAmount(t.farm)) === 0n) continue;
    await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: `collect_penalty:${launch.id}:${runId}:${t.tier_id}`, kind: "collect_penalty", settingsVersion: s.version,
      detail: { farm: t.farm, mint: launch.mint },
      build: () => deps.staking.buildCollectPenalty(t.farm, pool.spill_account),
      resolve: collectResolver(deps),
    });
  }
  const amount = await getBalance(deps.sql, launch.id, "penalty", launch.mint);
  if (amount === 0n) return;
  await runTxStep(deps.sql, deps.chain, {
    launchId: launch.id, idemKey: `burn:${launch.id}:${runId}`, kind: "burn", settingsVersion: s.version,
    detail: { mint: launch.mint, amount: amount.toString() },
    build: () => deps.chain.buildBurn(launch.mint, amount),
    resolve: burnResolver,
  });
}
