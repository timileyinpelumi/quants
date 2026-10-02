import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { runTxStep } from "../../ledger/run-step";

// Meteora's keepers migrate SOL curves and leave other quotes to us; migrating every full curve covers both and any delay on theirs.
export async function graduateStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, _runId: string, quotePaused = false): Promise<LaunchRow> {
  if (launch.status === "graduated") return launch;
  const curve = await deps.meteora.curveState(launch.pool);
  if (!curve.migrated) {
    if (curve.complete && !quotePaused) {
      await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey: `migrate:${launch.id}`, kind: "migrate", settingsVersion: s.version, detail: { pool: launch.pool },
        build: () => deps.meteora.buildMigrate(launch.pool), resolve: async () => [],
      });
    }
    return launch;
  }
  const pos = await deps.meteora.findGraduatedPosition(launch.configKey, launch.mint, launch.quoteMint);
  if (!pos) return launch;
  await deps.sql`update launches set status = 'graduated', graduated_at = coalesce(graduated_at, now()), damm_pool = ${pos.dammPool}, damm_position = ${pos.position},
    damm_position_nft_account = ${pos.positionNftAccount} where id = ${launch.id}`;
  return { ...launch, status: "graduated", dammPool: pos.dammPool, dammPosition: pos.position, dammPositionNftAccount: pos.positionNftAccount };
}
