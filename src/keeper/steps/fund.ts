import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";
import { allocateAcrossTiers } from "../../domain/weights";
import { kaminoRawRps } from "../../domain/rate";

export const fundResolver: DeltaResolver = async (row) => [{ bucket: "reward", mint: row.detail.rewardMint, amount: -BigInt(row.detail.amount) }];

export async function fundStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const [pool] = await deps.sql`select status from stake_pools where launch_id = ${launch.id}`;
  if (pool?.status !== "ready") return;
  const tiers = await deps.sql`select tier_id, farm, multiplier_bps from stake_tiers where launch_id = ${launch.id} order by lock_seconds`;
  const staked = await Promise.all(tiers.map(async (t: any) => ({
    tierId: t.tier_id as string, farm: t.farm as string, staked: await deps.staking.totalStaked(t.farm), multiplierBps: t.multiplier_bps as number,
  })));
  const mints = (await deps.sql`select reward_mint from baskets where launch_id = ${launch.id} order by reward_mint`).map((r: any) => r.reward_mint as string);
  for (const mint of mints) {
    const total = await getBalance(deps.sql, launch.id, "reward", mint);
    if (total === 0n) continue;
    for (const [tierId, amount] of allocateAcrossTiers(total, staked)) {
      if (amount === 0n) continue;
      const farm = staked.find((t) => t.tierId === tierId)!.farm;
      const rs = await deps.staking.rewardState(farm, mint);
      const rawRps = kaminoRawRps(rs.available + amount, s.rewardPeriodSeconds, rs.rpsDecimals);
      await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey: `fund:${launch.id}:${runId}:${tierId}:${mint}`, stepKey: `fund:${launch.id}:${tierId}:${mint}`, kind: "fund", settingsVersion: s.version,
        detail: { farm, rewardMint: mint, amount: amount.toString(), rawRps: rawRps.toString() },
        build: () => deps.staking.buildFund({ farm, rewardMint: mint, amount, rawRps, decimals: rs.decimals }),
        resolve: fundResolver,
      });
    }
  }
}
