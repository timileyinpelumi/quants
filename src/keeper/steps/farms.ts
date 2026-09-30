import { Keypair } from "@solana/web3.js";
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { beginStep } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";

// Farm keypairs are stored before sending so a retry after an expired blockhash reuses the same address.
export async function createFarmsStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, _runId: string): Promise<"ready" | "pending"> {
  const [pool] = await deps.sql`select * from stake_pools where launch_id = ${launch.id}`;
  if (!pool) return "pending";
  if (pool.status === "ready") return "ready";
  const tiers = await deps.sql`select * from stake_tiers where launch_id = ${launch.id} order by lock_seconds`;
  const rewardMints = (await deps.sql`select reward_mint from baskets where launch_id = ${launch.id} order by reward_mint`).map((r: any) => r.reward_mint);
  let allDone = true;
  for (const t of tiers) {
    if (t.farm) continue;
    const idemKey = `create_farm:${launch.id}:${t.tier_id}`;
    const kp = Keypair.generate();
    const row = await beginStep(deps.sql, {
      launchId: launch.id, idemKey, kind: "create_farm", settingsVersion: s.version,
      detail: { farm: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey), tier: t.tier_id },
    });
    const farm = row.detail.farm as string;
    const secret = Uint8Array.from(row.detail.secret as number[]);
    const created = row.status === "confirmed" || (await deps.staking.farmExists(farm))
      ? "confirmed"
      : await runTxStep(deps.sql, deps.chain, {
          launchId: launch.id, idemKey, kind: "create_farm", settingsVersion: s.version, detail: row.detail,
          build: () => deps.staking.buildCreateFarm(launch.mint, secret), resolve: async () => [],
        });
    if (created !== "confirmed") { allDone = false; continue; }
    const configured = await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: `configure_farm:${launch.id}:${t.tier_id}`, kind: "configure_farm", settingsVersion: s.version,
      detail: { farm },
      build: () => deps.staking.buildConfigureFarm({
        farm, stakeMint: launch.mint, lockSeconds: t.lock_seconds, maxPenaltyBps: pool.max_penalty_bps,
        spillAccount: pool.spill_account, rewardMints,
      }),
      resolve: async () => [],
    });
    if (configured !== "confirmed") { allDone = false; continue; }
    await deps.sql`update stake_tiers set farm = ${farm} where launch_id = ${launch.id} and tier_id = ${t.tier_id}`;
  }
  if (!allDone) return "pending";
  await deps.sql`update stake_pools set status = 'ready' where launch_id = ${launch.id}`;
  return "ready";
}
